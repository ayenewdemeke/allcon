import RBush from "rbush";
import { bounds, emptyBox, type Box } from "./geometry";
import type { DrawingData, Entity, Layer, Units } from "./types";

// The open drawing: its entities and layers, a spatial index for picking and snapping, and
// undo. Every change happens inside a transaction (one command is one undo step, as in
// AutoCAD), and listeners hear about each one.

type Item = Box & { id: string };
type Change =
  | { kind: "entity"; before: Entity | null; after: Entity | null }
  | { kind: "layer"; before: Layer | null; after: Layer | null }
  | { kind: "current"; before: string; after: string };
type Transaction = { label: string; changes: Change[] };

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export class DraftDocument {
  units: Units;
  layers = new Map<string, Layer>();
  entities = new Map<string, Entity>();
  currentLayer: string;
  /** Bumped on every change; the renderer redraws when it moves. */
  version = 0;

  private tree = new RBush<Item>();
  private items = new Map<string, Item>();
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private open: Transaction | null = null;
  private listeners = new Set<() => void>();

  constructor(data: DrawingData) {
    this.units = data.units;
    for (const layer of data.layers) this.layers.set(layer.name, layer);
    if (!this.layers.has("0")) this.layers.set("0", { name: "0", color: 7, lineweight: -3, linetype: "Continuous", on: true, frozen: false, locked: false });
    this.currentLayer = this.layers.has(data.currentLayer) ? data.currentLayer : "0";
    for (const e of data.entities) this.place(e);
  }

  toData(view?: DrawingData["view"]): DrawingData {
    return {
      format: "conkit-drawing",
      version: 1,
      units: this.units,
      layers: [...this.layers.values()],
      currentLayer: this.currentLayer,
      entities: [...this.entities.values()],
      ...(view ? { view } : {}),
    };
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed() {
    this.version++;
    for (const l of this.listeners) l();
  }

  // --- the index ------------------------------------------------------------------------

  /** Indexes an entity; a changed one keeps its place in the drawing order. */
  private place(e: Entity) {
    const old = this.items.get(e.id);
    if (old) this.tree.remove(old);
    this.entities.set(e.id, e);
    const item = { ...bounds(e), id: e.id };
    this.items.set(e.id, item);
    this.tree.insert(item);
  }

  private unplace(id: string) {
    const item = this.items.get(id);
    if (item) this.tree.remove(item);
    this.items.delete(id);
    this.entities.delete(id);
  }

  /** Entities whose extents touch the box. */
  query(box: Box): Entity[] {
    return this.tree.search(box).map((i) => this.entities.get(i.id)!).filter(Boolean);
  }

  extents(onlyVisible = true): Box {
    const box = emptyBox();
    for (const item of this.items.values()) {
      if (onlyVisible && !this.isVisible(this.entities.get(item.id)!)) continue;
      box.minX = Math.min(box.minX, item.minX);
      box.minY = Math.min(box.minY, item.minY);
      box.maxX = Math.max(box.maxX, item.maxX);
      box.maxY = Math.max(box.maxY, item.maxY);
    }
    return box;
  }

  layerOf(e: Entity) {
    return this.layers.get(e.layer);
  }

  isVisible(e: Entity) {
    const layer = this.layers.get(e.layer);
    return !layer || (layer.on && !layer.frozen);
  }

  /** Visible and on an unlocked layer: can be selected and changed. */
  isEditable(e: Entity) {
    const layer = this.layers.get(e.layer);
    return this.isVisible(e) && !layer?.locked;
  }

  // --- transactions ----------------------------------------------------------------------

  begin(label: string) {
    if (this.open) this.commit();
    this.open = { label, changes: [] };
  }

  commit() {
    const tx = this.open;
    this.open = null;
    if (tx && tx.changes.length) {
      this.undoStack.push(tx);
      if (this.undoStack.length > 500) this.undoStack.shift();
      this.redoStack = [];
    }
  }

  /** Undoes the open transaction's changes and closes it. */
  rollback() {
    const tx = this.open;
    this.open = null;
    if (!tx) return;
    for (const change of tx.changes.slice().reverse()) this.apply(change, true);
    this.changed();
  }

  get inTransaction() {
    return !!this.open;
  }

  private record(change: Change) {
    const auto = !this.open;
    if (auto) this.begin("edit");
    this.open!.changes.push(change);
    this.apply(change, false);
    if (auto) this.commit();
    this.changed();
  }

  private apply(change: Change, backwards: boolean) {
    const target = backwards ? change.before : change.after;
    if (change.kind === "entity") {
      const id = (change.after ?? change.before)!.id;
      if (target) this.place(target as Entity);
      else this.unplace(id);
    } else if (change.kind === "layer") {
      const layer = target as Layer | null;
      const gone = (backwards ? change.after : change.before) ?? layer;
      this.layers.delete(gone!.name);
      if (layer) this.layers.set(layer.name, layer);
    } else {
      this.currentLayer = target as string;
    }
  }

  /** Takes back the last undo step's change of the open transaction (a command's Undo option). */
  undoLastChange() {
    const change = this.open?.changes.pop();
    if (!change) return false;
    this.apply(change, true);
    this.changed();
    return true;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo(): string | null {
    if (this.open) this.commit();
    const tx = this.undoStack.pop();
    if (!tx) return null;
    for (const change of tx.changes.slice().reverse()) this.apply(change, true);
    this.redoStack.push(tx);
    this.changed();
    return tx.label;
  }

  redo(): string | null {
    const tx = this.redoStack.pop();
    if (!tx) return null;
    for (const change of tx.changes) this.apply(change, false);
    this.undoStack.push(tx);
    this.changed();
    return tx.label;
  }

  // --- edits ---------------------------------------------------------------------------

  add(e: Entity) {
    this.record({ kind: "entity", before: null, after: e });
  }

  update(e: Entity) {
    const before = this.entities.get(e.id) ?? null;
    if (before !== e) this.record({ kind: "entity", before, after: e });
  }

  remove(id: string) {
    const before = this.entities.get(id);
    if (before) this.record({ kind: "entity", before, after: null });
  }

  setLayer(layer: Layer) {
    this.record({ kind: "layer", before: this.layers.get(layer.name) ?? null, after: layer });
  }

  /** Renames a layer and moves its entities with it. */
  renameLayer(from: string, to: string) {
    const layer = this.layers.get(from);
    if (!layer || this.layers.has(to) || from === "0") return false;
    this.record({ kind: "layer", before: layer, after: null });
    this.record({ kind: "layer", before: null, after: { ...layer, name: to } });
    for (const e of [...this.entities.values()]) if (e.layer === from) this.update({ ...e, layer: to });
    if (this.currentLayer === from) this.setCurrentLayer(to);
    return true;
  }

  /** Deletes an empty layer (not 0, not the current one). */
  removeLayer(name: string) {
    const layer = this.layers.get(name);
    if (!layer || name === "0" || name === this.currentLayer) return false;
    for (const e of this.entities.values()) if (e.layer === name) return false;
    this.record({ kind: "layer", before: layer, after: null });
    return true;
  }

  setCurrentLayer(name: string) {
    if (this.layers.has(name) && name !== this.currentLayer) this.record({ kind: "current", before: this.currentLayer, after: name });
  }
}
