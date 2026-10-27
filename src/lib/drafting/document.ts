import RBush from "rbush";
import { applyBlocks } from "./blocks";
import { findBoundary } from "./boundary";
import { bounds, emptyBox, isAnnotation, type Box } from "./geometry";
import { applyStyles } from "./graphics";
import { defaultStyles, type Block, type DimStyle, type DrawingData, type Entity, type HatchEntity, type Layer, type Layout, type TextStyle, type Units } from "./types";

// The open drawing: its entities and layers, a spatial index for picking and snapping, and
// undo. Every change happens inside a transaction (one command is one undo step, as in
// AutoCAD), and listeners hear about each one. Associative hatches follow their boundaries
// within the same undo step.
//
// Entities live in spaces, as AutoCAD's: model space, and the paper space of each layout.
// Layers, styles and blocks are shared; `entities` and the index are the active space's.

type Item = Box & { id: string };
type Space = { entities: Map<string, Entity>; tree: RBush<Item>; items: Map<string, Item> };
/** A layout without its objects (they're in its space). */
export type LayoutInfo = Omit<Layout, "entities">;
export const MODEL = "model";
export type Setting = "currentTextStyle" | "currentDimStyle" | "annoScale";
type Change =
  | { kind: "entity"; space: string; before: Entity | null; after: Entity | null }
  | { kind: "layout"; before: LayoutInfo | null; after: LayoutInfo | null }
  | { kind: "layer"; before: Layer | null; after: Layer | null }
  | { kind: "current"; before: string; after: string }
  | { kind: "textStyle"; before: TextStyle | null; after: TextStyle | null }
  | { kind: "dimStyle"; before: DimStyle | null; after: DimStyle | null }
  | { kind: "block"; before: Block | null; after: Block | null }
  | { kind: "setting"; key: Setting; before: string | number; after: string | number };
type Transaction = { label: string; changes: Change[] };

/** What PURGE can remove: the names nothing uses. */
export type Unused = { blocks: string[]; layers: string[]; textStyles: string[]; dimStyles: string[] };

// Versions are unique across documents, so a view of one never mistakes another for it (the
// block editor swaps documents in and out).
let versions = 0;

export { newId } from "./ids";

export class DraftDocument {
  units: Units;
  layers = new Map<string, Layer>();
  /** The layouts, in tab order. */
  layouts = new Map<string, LayoutInfo>();
  /** The space being worked in: model space, or a layout's id. */
  space = MODEL;
  currentLayer: string;
  textStyles = new Map<string, TextStyle>();
  dimStyles = new Map<string, DimStyle>();
  blocks = new Map<string, Block>();
  currentTextStyle: string;
  currentDimStyle: string;
  /** The annotation scale factor (48 for 1/4" = 1'-0", 50 for 1:50): new text, dimensions and hatches are sized for it. */
  annoScale: number;
  /** Changes on every change; the renderer redraws when it moves. */
  version = ++versions;

  private spaces = new Map<string, Space>();
  /** What changed here since the last save (by key: e:space:id, l:layer, b:block...), and when. */
  private dirty = new Map<string, number>();
  /** Counts local edits; a save covers the edits up to the count it was made at. */
  editSeq = 0;
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private open: Transaction | null = null;
  private listeners = new Set<() => void>();

  constructor(data: DrawingData) {
    this.units = data.units;
    for (const layer of data.layers) this.layers.set(layer.name, layer);
    if (!this.layers.has("0")) this.layers.set("0", { name: "0", color: 7, lineweight: -3, linetype: "Continuous", on: true, frozen: false, locked: false });
    this.currentLayer = this.layers.has(data.currentLayer) ? data.currentLayer : "0";
    const defaults = defaultStyles(data.units);
    for (const t of data.textStyles?.length ? data.textStyles : defaults.textStyles) this.textStyles.set(t.name, t);
    for (const d of data.dimStyles?.length ? data.dimStyles : defaults.dimStyles) this.dimStyles.set(d.name, d);
    this.currentTextStyle = data.currentTextStyle && this.textStyles.has(data.currentTextStyle) ? data.currentTextStyle : this.textStyles.keys().next().value!;
    this.currentDimStyle = data.currentDimStyle && this.dimStyles.has(data.currentDimStyle) ? data.currentDimStyle : this.dimStyles.keys().next().value!;
    this.annoScale = data.annoScale ?? defaults.annoScale;
    for (const b of data.blocks ?? []) this.blocks.set(b.name, b);
    this.activate();
    for (const e of data.entities) this.place(e, MODEL);
    for (const { entities, ...layout } of data.layouts ?? []) {
      this.layouts.set(layout.id, layout);
      for (const e of entities) this.place(e, layout.id);
    }
  }

  /** The active space's entities. */
  get entities() {
    return this.spaceOf(this.space).entities;
  }

  /** A space's entities (model space, or a layout's paper space). */
  entitiesIn(space: string) {
    return this.spaceOf(space).entities;
  }

  private spaceOf(id: string): Space {
    let space = this.spaces.get(id);
    if (!space) this.spaces.set(id, (space = { entities: new Map(), tree: new RBush<Item>(), items: new Map() }));
    return space;
  }

  /** The layout being worked in (null in model space). */
  get layout() {
    return this.layouts.get(this.space) ?? null;
  }

  /** Moves to model space or a layout (not an undoable change, as in AutoCAD). */
  setSpace(id: string) {
    if (id !== MODEL && !this.layouts.has(id)) return;
    if (this.open) this.commit();
    this.space = id;
    this.changed();
  }

  /** The scale new text, dimensions and hatches are sized for: the annotation scale in model
   * space, 1:1 on a layout's paper. */
  get newScale() {
    return this.space === MODEL ? this.annoScale : 1;
  }

  /** Makes this the document being drawn: annotations use its styles, references its blocks. */
  activate() {
    this.syncStyles();
    applyBlocks(this.blocks);
  }

  /** Annotations are drawn with these styles. */
  private syncStyles() {
    applyStyles({ units: this.units, text: this.textStyles, dim: this.dimStyles });
  }

  toData(view?: DrawingData["view"]): DrawingData {
    return {
      format: "conkit-drawing",
      version: 1,
      units: this.units,
      layers: [...this.layers.values()],
      currentLayer: this.currentLayer,
      entities: [...this.entitiesIn(MODEL).values()],
      layouts: [...this.layouts.values()].map((l) => ({ ...l, entities: [...this.entitiesIn(l.id).values()] })),
      textStyles: [...this.textStyles.values()],
      dimStyles: [...this.dimStyles.values()],
      blocks: [...this.blocks.values()],
      currentTextStyle: this.currentTextStyle,
      currentDimStyle: this.currentDimStyle,
      annoScale: this.annoScale,
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
    this.version = ++versions;
    for (const l of this.listeners) l();
  }

  // --- collaboration ------------------------------------------------------------------------

  private markDirty(change: Change) {
    const seq = ++this.editSeq;
    const key =
      change.kind === "entity"
        ? `e:${change.space}:${(change.after ?? change.before)!.id}`
        : change.kind === "layout"
          ? `L:${(change.after ?? change.before)!.id}`
          : change.kind === "layer"
            ? `l:${(change.after ?? change.before)!.name}`
            : change.kind === "block"
              ? `b:${(change.after ?? change.before)!.name}`
              : change.kind === "textStyle"
                ? `t:${(change.after ?? change.before)!.name}`
                : change.kind === "dimStyle"
                  ? `d:${(change.after ?? change.before)!.name}`
                  : change.kind === "setting"
                    ? `s:${change.key}`
                    : "c";
    this.dirty.set(key, seq);
  }

  /** Whether there are local changes not yet saved. */
  get unsaved() {
    return this.dirty.size > 0;
  }

  /** A save made at edit count `seq` succeeded: what changed up to then is saved. */
  markSaved(seq: number) {
    for (const [key, at] of this.dirty) if (at <= seq) this.dirty.delete(key);
  }

  /** Takes in a newer saved version of the drawing (someone else's or an AI app's), keeping the
   * changes made here and not saved yet: those win, object by object. Not an undo step. */
  applyRemote(remote: DrawingData) {
    const mine = (key: string) => this.dirty.has(key);
    const merge = <T>(local: Map<string, T>, incoming: T[], keyOf: (v: T) => string, prefix: string) => {
      const out = new Map(incoming.map((v) => [keyOf(v), v] as [string, T]));
      for (const key of [...out.keys()]) if (mine(prefix + key) && !local.has(key)) out.delete(key); // deleted here
      for (const [key, v] of local) if (mine(prefix + key)) out.set(key, v); // changed or added here
      return out;
    };
    this.layers = merge(this.layers, remote.layers, (l) => l.name, "l:");
    if (!this.layers.has("0")) this.layers.set("0", { name: "0", color: 7, lineweight: -3, linetype: "Continuous", on: true, frozen: false, locked: false });
    this.blocks = merge(this.blocks, remote.blocks ?? [], (b) => b.name, "b:");
    const defaults = defaultStyles(this.units);
    this.textStyles = merge(this.textStyles, remote.textStyles?.length ? remote.textStyles : defaults.textStyles, (t) => t.name, "t:");
    this.dimStyles = merge(this.dimStyles, remote.dimStyles?.length ? remote.dimStyles : defaults.dimStyles, (d) => d.name, "d:");
    const remoteLayouts = (remote.layouts ?? []).map(({ entities, ...info }) => {
      void entities;
      return info;
    });
    this.layouts = merge(this.layouts, remoteLayouts, (l) => l.id, "L:");
    for (const key of ["currentTextStyle", "currentDimStyle", "annoScale"] as const) {
      const value = remote[key];
      if (!mine(`s:${key}`) && value !== undefined) (this as unknown as Record<string, unknown>)[key] = value;
    }
    if (!this.textStyles.has(this.currentTextStyle)) this.currentTextStyle = this.textStyles.keys().next().value!;
    if (!this.dimStyles.has(this.currentDimStyle)) this.currentDimStyle = this.dimStyles.keys().next().value!;
    this.activate();
    // Objects, space by space.
    const incoming = new Map<string, Entity[]>([[MODEL, remote.entities]]);
    for (const l of remote.layouts ?? []) incoming.set(l.id, l.entities);
    const spaceIds = new Set([...incoming.keys(), ...this.spaces.keys()]);
    for (const spaceId of spaceIds) {
      if (spaceId !== MODEL && !this.layouts.has(spaceId)) {
        this.spaces.delete(spaceId);
        continue;
      }
      const theirs = new Map((incoming.get(spaceId) ?? []).map((e) => [e.id, e]));
      const space = this.spaceOf(spaceId);
      for (const [id, e] of [...space.entities]) {
        if (mine(`e:${spaceId}:${id}`)) continue;
        const remoteVersion = theirs.get(id);
        if (!remoteVersion) this.unplace(id, spaceId);
        else if (JSON.stringify(remoteVersion) !== JSON.stringify(e)) this.place(remoteVersion, spaceId);
      }
      for (const [id, e] of theirs) if (!space.entities.has(id) && !mine(`e:${spaceId}:${id}`)) this.place(e, spaceId);
      // Blocks and styles may have changed what objects look like: re-index those.
      for (const e of space.entities.values()) if (e.type === "insert" || isAnnotation(e)) this.place(e, spaceId);
    }
    if (this.space !== MODEL && !this.layouts.has(this.space)) this.space = MODEL;
    this.changed();
  }

  // --- the index ------------------------------------------------------------------------

  /** Indexes an entity; a changed one keeps its place in the drawing order. */
  private place(e: Entity, spaceId: string) {
    const space = this.spaceOf(spaceId);
    const old = space.items.get(e.id);
    if (old) space.tree.remove(old);
    space.entities.set(e.id, e);
    const item = { ...bounds(e), id: e.id };
    space.items.set(e.id, item);
    space.tree.insert(item);
  }

  private unplace(id: string, spaceId: string) {
    const space = this.spaceOf(spaceId);
    const item = space.items.get(id);
    if (item) space.tree.remove(item);
    space.items.delete(id);
    space.entities.delete(id);
  }

  /** Every entity, in every space (to re-index when styles or blocks change). */
  private *everywhere(): Generator<[Entity, string]> {
    for (const [id, space] of this.spaces) for (const e of space.entities.values()) yield [e, id];
  }

  /** Entities whose extents touch the box (in the active space, or the one given). */
  query(box: Box, spaceId = this.space): Entity[] {
    const space = this.spaceOf(spaceId);
    return space.tree.search(box).map((i) => space.entities.get(i.id)!).filter(Boolean);
  }

  extents(onlyVisible = true, spaceId = this.space): Box {
    const box = emptyBox();
    const space = this.spaceOf(spaceId);
    for (const item of space.items.values()) {
      const e = space.entities.get(item.id)!;
      if (onlyVisible && !this.isVisible(e)) continue;
      if (e.type === "xline" || e.type === "ray") continue; // infinite: not part of the extents, as in AutoCAD
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
    if (tx?.changes.length) this.reassociate(tx);
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
    this.markDirty(change);
    if (change.kind === "entity") {
      const id = (change.after ?? change.before)!.id;
      if (target) this.place(target as Entity, change.space);
      else this.unplace(id, change.space);
    } else if (change.kind === "layout") {
      const layout = target as LayoutInfo | null;
      const gone = (backwards ? change.after : change.before) ?? layout;
      if (layout) this.layouts.set(layout.id, layout);
      else {
        this.layouts.delete(gone!.id);
        if (this.space === gone!.id) this.space = MODEL;
      }
    } else if (change.kind === "layer") {
      const layer = target as Layer | null;
      const gone = (backwards ? change.after : change.before) ?? layer;
      this.layers.delete(gone!.name);
      if (layer) this.layers.set(layer.name, layer);
    } else if (change.kind === "textStyle" || change.kind === "dimStyle") {
      const table = change.kind === "textStyle" ? this.textStyles : this.dimStyles;
      const style = target as TextStyle | DimStyle | null;
      const gone = (backwards ? change.after : change.before) ?? style;
      table.delete(gone!.name);
      if (style) (table as Map<string, typeof style>).set(style.name, style);
      this.syncStyles();
      // Annotations drawn with the style change size: re-index them.
      for (const [e, space] of [...this.everywhere()]) if (isAnnotation(e)) this.place(e, space);
    } else if (change.kind === "block") {
      const block = target as Block | null;
      const gone = (backwards ? change.after : change.before) ?? block;
      this.blocks.delete(gone!.name);
      if (block) this.blocks.set(block.name, block);
      applyBlocks(this.blocks);
      // References draw their block afresh: re-index them.
      for (const [e, space] of [...this.everywhere()]) if (e.type === "insert") this.place(e, space);
    } else if (change.kind === "setting") {
      (this as unknown as Record<Setting, string | number>)[change.key] = target as string | number;
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
    this.record({ kind: "entity", space: this.space, before: null, after: e });
    this.lastAdded = e.id;
  }

  /** The object added last (AutoCAD's "Last" selection). */
  lastAdded: string | null = null;

  update(e: Entity) {
    const before = this.entities.get(e.id) ?? null;
    if (before !== e) this.record({ kind: "entity", space: this.space, before, after: e });
  }

  remove(id: string) {
    const before = this.entities.get(id);
    if (before) this.record({ kind: "entity", space: this.space, before, after: null });
  }

  /** Changes an entity without an undo step: a viewport's view as it's panned and zoomed. */
  patch(e: Entity, spaceId = this.space) {
    if (!this.spaceOf(spaceId).entities.has(e.id)) return;
    this.dirty.set(`e:${spaceId}:${e.id}`, ++this.editSeq);
    this.place(e, spaceId);
    this.changed();
  }

  // --- layouts ------------------------------------------------------------------------------

  addLayout(layout: LayoutInfo, entities: Entity[] = []) {
    this.record({ kind: "layout", before: null, after: layout });
    for (const e of entities) this.record({ kind: "entity", space: layout.id, before: null, after: e });
  }

  /** Renames a layout or changes its paper or plot settings. */
  updateLayout(layout: LayoutInfo) {
    const before = this.layouts.get(layout.id);
    if (before) this.record({ kind: "layout", before, after: layout });
  }

  /** Deletes a layout and what's on it (AutoCAD keeps at least one: so does the caller). */
  removeLayout(id: string) {
    const layout = this.layouts.get(id);
    if (!layout) return;
    for (const e of [...this.entitiesIn(id).values()]) this.record({ kind: "entity", space: id, before: e, after: null });
    this.record({ kind: "layout", before: layout, after: null });
  }

  /** Where a layout was last looked at (kept with the drawing, not an undo step). */
  setLayoutView(id: string, view: LayoutInfo["view"]) {
    const layout = this.layouts.get(id);
    if (layout) this.layouts.set(id, { ...layout, view });
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

  setTextStyle(style: TextStyle) {
    this.record({ kind: "textStyle", before: this.textStyles.get(style.name) ?? null, after: style });
  }

  setDimStyle(style: DimStyle) {
    this.record({ kind: "dimStyle", before: this.dimStyles.get(style.name) ?? null, after: style });
  }

  setSetting(key: Setting, value: string | number) {
    if (this[key] !== value) this.record({ kind: "setting", key, before: this[key], after: value });
  }

  /** Defines (or redefines) a block. */
  setBlock(block: Block) {
    this.record({ kind: "block", before: this.blocks.get(block.name) ?? null, after: block });
  }

  // --- associative hatches -----------------------------------------------------------------

  /** Hatches whose boundary changed in this step are traced again from the points picked for
   * them; one whose boundary is gone stops following it (as AutoCAD drops associativity). */
  private reassociate(tx: Transaction) {
    const touched = new Set<string>();
    const boxes: Box[] = [];
    for (const c of tx.changes) {
      if (c.kind !== "entity" || c.space !== this.space) continue;
      for (const e of [c.before, c.after]) {
        if (!e) continue;
        touched.add(e.id);
        if (e.type !== "hatch") boxes.push(bounds(e));
      }
    }
    if (!boxes.length) return;
    const hatches = new Map<string, HatchEntity>();
    for (const box of boxes) {
      for (const e of this.query(box)) if (e.type === "hatch" && e.seeds?.length && !touched.has(e.id)) hatches.set(e.id, e);
    }
    for (const hatch of hatches.values()) {
      const region = bounds(hatch);
      for (const box of boxes) {
        region.minX = Math.min(region.minX, box.minX);
        region.minY = Math.min(region.minY, box.minY);
        region.maxX = Math.max(region.maxX, box.maxX);
        region.maxY = Math.max(region.maxY, box.maxY);
      }
      const around = this.query(region).filter((e) => e.id !== hatch.id && this.isVisible(e));
      const tolerance = Math.max(region.maxX - region.minX, region.maxY - region.minY) * 1e-7;
      const loops = [];
      for (const seed of hatch.seeds!) {
        const found = findBoundary(around, seed, tolerance);
        if (!found) {
          loops.length = 0;
          break;
        }
        loops.push(...found);
      }
      this.update(loops.length ? { ...hatch, loops } : { ...hatch, seeds: undefined });
    }
  }

  // --- purging --------------------------------------------------------------------------

  /** Blocks, layers and styles nothing in the drawing uses, as PURGE lists them. */
  unused(): Unused {
    const blocks = new Set<string>();
    const layers = new Set(["0", "Defpoints", this.currentLayer]);
    const textStyles = new Set([this.currentTextStyle]);
    const dimStyles = new Set([this.currentDimStyle]);
    const mark = (e: Entity, inModel: boolean) => {
      layers.add(e.layer);
      if (e.type === "text" || e.type === "mtext" || e.type === "attdef") textStyles.add(e.style);
      if (e.type === "dimension") dimStyles.add(e.style);
      if (e.type === "leader") {
        textStyles.add(e.style);
        dimStyles.add(e.dimStyle);
      }
      if (e.type === "insert" && inModel && !blocks.has(e.block)) {
        blocks.add(e.block);
        for (const child of this.blocks.get(e.block)?.entities ?? []) mark(child, true);
      }
    };
    for (const [e] of this.everywhere()) mark(e, true);
    // Layers and styles inside any block count as used (purge the block first).
    for (const b of this.blocks.values()) for (const e of b.entities) mark(e, false);
    for (const d of this.dimStyles.values()) if (dimStyles.has(d.name)) textStyles.add(d.textStyle);
    return {
      blocks: [...this.blocks.keys()].filter((n) => !blocks.has(n)),
      layers: [...this.layers.keys()].filter((n) => !layers.has(n)),
      textStyles: [...this.textStyles.keys()].filter((n) => !textStyles.has(n) && n !== "Standard"),
      dimStyles: [...this.dimStyles.keys()].filter((n) => !dimStyles.has(n)),
    };
  }

  /** Removes what PURGE was asked to (only what's unused). */
  purge(items: Partial<Unused>) {
    const unused = this.unused();
    for (const name of items.blocks ?? []) if (unused.blocks.includes(name)) this.record({ kind: "block", before: this.blocks.get(name)!, after: null });
    for (const name of items.layers ?? []) if (unused.layers.includes(name)) this.record({ kind: "layer", before: this.layers.get(name)!, after: null });
    for (const name of items.textStyles ?? []) if (unused.textStyles.includes(name)) this.record({ kind: "textStyle", before: this.textStyles.get(name)!, after: null });
    for (const name of items.dimStyles ?? []) if (unused.dimStyles.includes(name)) this.record({ kind: "dimStyle", before: this.dimStyles.get(name)!, after: null });
  }

  setCurrentLayer(name: string) {
    if (this.layers.has(name) && name !== this.currentLayer) this.record({ kind: "current", before: this.currentLayer, after: name });
  }
}
