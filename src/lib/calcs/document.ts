import type { Settings } from "./evaluate";
import { DEFAULT_GRID, type CalcData, type Grid, type Header, type Paper, type Region } from "./types";

// The open worksheet: its regions and settings, undo (one step per edit), and what's changed
// since the last save, region by region, so others' saved changes can be merged in without
// losing what's changed here. Listeners hear about every change.

type Meta = { paper: Paper; grid: Grid; settings: Settings; header: Header };
type Change = { kind: "region"; before: Region | null; after: Region | null } | { kind: "meta"; before: Meta; after: Meta };

let versions = 0;

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export class CalcDocument {
  regions = new Map<string, Region>();
  paper: Paper;
  grid: Grid;
  settings: Settings;
  header: Header;
  version = ++versions;
  /** Counts edits; a save covers the edits up to the count it was made at. */
  editSeq = 0;
  private savedSeq = 0;
  /** What's changed here and not saved yet ("r:" and a region's id, or "meta"), at which edit. */
  private dirty = new Map<string, number>();
  private undoStack: Change[][] = [];
  private redoStack: Change[][] = [];
  private open: Change[] | null = null;
  private listeners = new Set<() => void>();

  constructor(data: CalcData) {
    this.paper = data.paper;
    this.grid = data.grid ?? DEFAULT_GRID;
    this.settings = data.settings;
    this.header = data.header;
    for (const r of data.regions) this.regions.set(r.id, r);
  }

  toData(): CalcData {
    return { format: "conkit-calc", version: 1, paper: this.paper, grid: this.grid, settings: this.settings, header: this.header, regions: [...this.regions.values()] };
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

  get unsaved() {
    return this.editSeq > this.savedSeq || this.dirty.size > 0;
  }
  /** A worksheet made here (from a template) that isn't saved yet. */
  markUnsaved() {
    this.editSeq++;
  }
  markSaved(seq: number) {
    this.savedSeq = Math.max(this.savedSeq, seq);
    for (const [key, at] of this.dirty) if (at <= seq) this.dirty.delete(key);
  }

  /** Takes in a version saved elsewhere (another person, an AI app): their regions and settings,
   * except where there are changes here not saved yet, which win. */
  applyRemote(remote: CalcData) {
    const mine = (key: string) => this.dirty.has(key);
    const incoming = new Map(remote.regions.map((r) => [r.id, r]));
    for (const id of [...this.regions.keys()]) if (!incoming.has(id) && !mine(`r:${id}`)) this.regions.delete(id);
    for (const [id, r] of incoming) if (!mine(`r:${id}`)) this.regions.set(id, r);
    if (!mine("meta")) {
      this.paper = remote.paper;
      this.grid = remote.grid ?? DEFAULT_GRID;
      this.settings = remote.settings;
      this.header = remote.header;
    }
    this.changed();
  }

  // --- edits, as undo steps ---------------------------------------------------------------

  /** Groups the edits made in `work` into one undo step. */
  transact(work: () => void) {
    const outer = !this.open;
    if (outer) this.open = [];
    try {
      work();
    } finally {
      if (outer) {
        const step = this.open!;
        this.open = null;
        if (step.length) {
          this.undoStack.push(step);
          if (this.undoStack.length > 300) this.undoStack.shift();
          this.redoStack = [];
        }
      }
    }
  }

  private record(change: Change) {
    this.editSeq++;
    this.transact(() => {
      this.open!.push(change);
      this.apply(change, false);
    });
    this.changed();
  }

  private apply(change: Change, backwards: boolean) {
    if (change.kind === "region") {
      const target = backwards ? change.before : change.after;
      const id = (change.after ?? change.before)!.id;
      this.dirty.set(`r:${id}`, this.editSeq);
      if (target) this.regions.set(id, target);
      else this.regions.delete(id);
    } else {
      const m = backwards ? change.before : change.after;
      this.dirty.set("meta", this.editSeq);
      this.paper = m.paper;
      this.grid = m.grid;
      this.settings = m.settings;
      this.header = m.header;
    }
  }

  put(region: Region) {
    const before = this.regions.get(region.id) ?? null;
    if (before !== region) this.record({ kind: "region", before, after: region });
  }

  remove(id: string) {
    const before = this.regions.get(id);
    if (before) this.record({ kind: "region", before, after: null });
  }

  setMeta(patch: Partial<Meta>) {
    const before = { paper: this.paper, grid: this.grid, settings: this.settings, header: this.header };
    this.record({ kind: "meta", before, after: { ...before, ...patch } });
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return false;
    this.editSeq++;
    for (const c of [...step].reverse()) this.apply(c, true);
    this.redoStack.push(step);
    this.changed();
    return true;
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return false;
    this.editSeq++;
    for (const c of step) this.apply(c, false);
    this.undoStack.push(step);
    this.changed();
    return true;
  }
}
