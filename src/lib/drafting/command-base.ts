import type { Editor } from "./editor";
import type { Entity, Vec } from "./types";

// What every command is: a short conversation, as in AutoCAD. A prompt, the points, objects and
// options it takes, a rubber-band preview, and one undo step for the whole command.

export type Keyword = { key: string; label: string };
export type Prompt = {
  text: string;
  keywords?: Keyword[];
  /** The point the next one is measured from (rubber band, polar tracking, typed relative input). */
  base?: Vec | null;
  /** Clicks pick and window-select objects into the selection. */
  selecting?: boolean;
  /** A click picks one object (Select object to trim, Select first object...). */
  picking?: boolean;
  /** The default Enter takes, shown as <...>. */
  enterLabel?: string;
};

export abstract class Command {
  abstract readonly name: string;
  /** Left-drag pans instead of picking (PAN). */
  readonly pans: boolean = false;
  constructor(protected ed: Editor) {}
  abstract prompt(): Prompt;
  start() {}
  point?(p: Vec): void;
  /** An object picked at a picking prompt (null: nothing there). Shift held is `shift`. */
  pick?(e: Entity | null, at: Vec, shift: boolean): void;
  keyword?(key: string): void;
  /** Typed text that isn't a point or keyword (a radius, a count). Returns false if it isn't understood. */
  value?(text: string): boolean;
  /** What the command would make with the cursor here (the rubber band). */
  preview?(cursor: Vec): Entity[];
  /** Enter or Space with nothing typed. */
  enter() {
    this.ed.finish();
  }
  cancel() {
    this.ed.finish();
  }
}

export const UNDO: Keyword = { key: "U", label: "Undo" };
export const CLOSE: Keyword = { key: "C", label: "Close" };
export const EXIT: Keyword = { key: "E", label: "Exit" };

/** A plain number typed (a count, a scale factor); null if it isn't one. */
export function parseNumber(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() && Number.isFinite(n) ? n : null;
}

/** Commands that work on objects: they take the current selection, or ask for one. */
export abstract class SelectingCommand extends Command {
  /** The selection is used up: it's cleared when the command ends, as in AutoCAD. */
  readonly clearsSelection = true;
  protected selecting = true;
  start() {
    this.ed.doc.begin(this.name);
    if (this.ed.selection.size) this.selected();
  }
  protected selectPrompt(): Prompt {
    return { text: "Select objects", selecting: true };
  }
  enter() {
    if (this.selecting) {
      if (this.ed.selection.size) this.selected();
      else this.ed.finish();
    } else this.ed.finish();
  }
  /** The selection is made: on to the command's own steps. */
  protected selected() {
    this.selecting = false;
    this.ed.print(`${this.ed.selection.size} found`, "info");
  }
  protected targets(): Entity[] {
    return [...this.ed.selection].map((id) => this.ed.doc.entities.get(id)!).filter((e) => e && this.ed.doc.isEditable(e));
  }
}
