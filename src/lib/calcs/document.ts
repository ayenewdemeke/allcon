import type { Settings } from "./evaluate";
import type { CalcData, Header, Paper, Region } from "./types";

// The open worksheet: its regions and settings, undo (one step per edit), and what's changed
// since the last save. Listeners hear about every change.

type Meta = { paper: Paper; settings: Settings; header: Header };
type Change = { kind: "region"; before: Region | null; after: Region | null } | { kind: "meta"; before: Meta; after: Meta };

let versions = 0;

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export class CalcDocument {
  regions = new Map<string, Region>();
  paper: Paper;
  settings: Settings;
  header: Header;
  version = ++versions;
  /** Counts edits; a save covers the edits up to the count it was made at. */
  editSeq = 0;
  private savedSeq = 0;
  private undoStack: Change[][] = [];
  private redoStack: Change[][] = [];
  private open: Change[] | null = null;
  private listeners = new Set<() => void>();

  constructor(data: CalcData) {
    this.paper = data.paper;
    this.settings = data.settings;
    this.header = data.header;
    for (const r of data.regions) this.regions.set(r.id, r);
  }

  toData(): CalcData {
    return { format: "conkit-calc", version: 1, paper: this.paper, settings: this.settings, header: this.header, regions: [...this.regions.values()] };
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
    return this.editSeq > this.savedSeq;
  }
  markSaved(seq: number) {
    this.savedSeq = Math.max(this.savedSeq, seq);
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
    this.transact(() => {
      this.open!.push(change);
      this.apply(change, false);
    });
    this.editSeq++;
    this.changed();
  }

  private apply(change: Change, backwards: boolean) {
    if (change.kind === "region") {
      const target = backwards ? change.before : change.after;
      const id = (change.after ?? change.before)!.id;
      if (target) this.regions.set(id, target);
      else this.regions.delete(id);
    } else {
      const m = backwards ? change.before : change.after;
      this.paper = m.paper;
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
    const before = { paper: this.paper, settings: this.settings, header: this.header };
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
    for (const c of [...step].reverse()) this.apply(c, true);
    this.redoStack.push(step);
    this.editSeq++;
    this.changed();
    return true;
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return false;
    for (const c of step) this.apply(c, false);
    this.undoStack.push(step);
    this.editSeq++;
    this.changed();
    return true;
  }
}
