import { arcThrough, angleOf, circleThrough, dist, mid, sub, sweepOf, translate } from "./geometry";
import { formatLength, parseLength } from "./units";
import type { Editor } from "./editor";
import type { ArcEntity, CircleEntity, Entity, LineEntity, PolylineEntity, Vec } from "./types";

// The commands, each a short conversation as in AutoCAD: a prompt, the points and options it
// takes, a rubber-band preview, and one undo step for the whole command.

export type Keyword = { key: string; label: string };
export type Prompt = {
  text: string;
  keywords?: Keyword[];
  /** The point the next one is measured from (rubber band, polar tracking, typed relative input). */
  base?: Vec | null;
  /** Clicks pick and window-select objects instead of giving points. */
  selecting?: boolean;
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
  keyword?(key: string): void;
  /** Typed text that isn't a point or keyword (a radius, a length). Returns false if it isn't understood. */
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

const UNDO = { key: "U", label: "Undo" };
const CLOSE = { key: "C", label: "Close" };

class LineCommand extends Command {
  name = "LINE";
  private points: Vec[] = [];
  start() {
    this.ed.doc.begin("LINE");
  }
  prompt(): Prompt {
    const last = this.points.at(-1);
    if (!last) return { text: "Specify first point" };
    return { text: "Specify next point", keywords: this.points.length >= 3 ? [CLOSE, UNDO] : [UNDO], base: last };
  }
  point(p: Vec) {
    const last = this.points.at(-1);
    if (last && dist(last, p) < 1e-9) return;
    if (last) this.ed.doc.add(this.ed.make<LineEntity>({ type: "line", a: last, b: p }));
    this.points.push(p);
  }
  keyword(key: string) {
    if (key === "U") {
      if (this.points.length > 1) this.ed.doc.undoLastChange();
      this.points.pop();
    } else if (key === "C" && this.points.length >= 3) {
      this.ed.doc.add(this.ed.make<LineEntity>({ type: "line", a: this.points.at(-1)!, b: this.points[0] }));
      this.ed.finish();
    }
  }
  preview(c: Vec): Entity[] {
    const last = this.points.at(-1);
    return last ? [this.ed.make<LineEntity>({ type: "line", a: last, b: c })] : [];
  }
}

class PlineCommand extends Command {
  name = "PLINE";
  private points: Vec[] = [];
  private id: string | null = null;
  start() {
    this.ed.doc.begin("PLINE");
  }
  prompt(): Prompt {
    const last = this.points.at(-1);
    if (!last) return { text: "Specify start point" };
    return { text: "Specify next point", keywords: this.points.length >= 3 ? [CLOSE, UNDO] : [UNDO], base: last };
  }
  private save(closed = false) {
    if (this.points.length < 2) {
      if (this.id) this.ed.doc.remove(this.id);
      this.id = null;
      return;
    }
    const e = this.ed.make<PolylineEntity>({ type: "polyline", points: this.points.slice(), bulges: this.points.map(() => 0), closed });
    if (this.id) this.ed.doc.update({ ...e, id: this.id });
    else {
      this.id = e.id;
      this.ed.doc.add(e);
    }
  }
  point(p: Vec) {
    const last = this.points.at(-1);
    if (last && dist(last, p) < 1e-9) return;
    this.points.push(p);
    this.save();
  }
  keyword(key: string) {
    if (key === "U") {
      this.points.pop();
      this.save();
    } else if (key === "C" && this.points.length >= 3) {
      this.save(true);
      this.ed.finish();
    }
  }
  preview(c: Vec): Entity[] {
    const last = this.points.at(-1);
    return last ? [this.ed.make<LineEntity>({ type: "line", a: last, b: c })] : [];
  }
}

class CircleCommand extends Command {
  name = "CIRCLE";
  private step: "center" | "radius" | "diameter" | "3p" | "2p" = "center";
  private center: Vec | null = null;
  private picks: Vec[] = [];
  prompt(): Prompt {
    switch (this.step) {
      case "center":
        return { text: "Specify center point for circle", keywords: [{ key: "3P", label: "3P" }, { key: "2P", label: "2P" }] };
      case "radius":
        return { text: "Specify radius of circle", keywords: [{ key: "D", label: "Diameter" }], base: this.center };
      case "diameter":
        return { text: "Specify diameter of circle", base: this.center };
      case "3p":
        return { text: ["Specify first point on circle", "Specify second point on circle", "Specify third point on circle"][this.picks.length], base: this.picks.at(-1) };
      case "2p":
        return { text: this.picks.length ? "Specify second end point of circle's diameter" : "Specify first end point of circle's diameter", base: this.picks.at(-1) };
    }
  }
  private make(center: Vec, radius: number) {
    if (radius <= 1e-9) return;
    this.ed.doc.begin("CIRCLE");
    this.ed.doc.add(this.ed.make<CircleEntity>({ type: "circle", center, radius }));
    this.ed.finish();
  }
  point(p: Vec) {
    if (this.step === "center") {
      this.center = p;
      this.step = "radius";
    } else if (this.step === "radius") this.make(this.center!, dist(this.center!, p));
    else if (this.step === "diameter") this.make(this.center!, dist(this.center!, p) / 2);
    else {
      this.picks.push(p);
      if (this.step === "2p" && this.picks.length === 2) this.make(mid(this.picks[0], this.picks[1]), dist(this.picks[0], this.picks[1]) / 2);
      if (this.step === "3p" && this.picks.length === 3) {
        const c = circleThrough(this.picks[0], this.picks[1], this.picks[2]);
        if (c) this.make(c.center, c.radius);
        else {
          this.ed.print("The points are in a line.", "error");
          this.picks.pop();
        }
      }
    }
  }
  keyword(key: string) {
    if (this.step === "center" && (key === "3P" || key === "2P")) this.step = key === "3P" ? "3p" : "2p";
    else if (this.step === "radius" && key === "D") this.step = "diameter";
  }
  value(text: string) {
    if (this.step !== "radius" && this.step !== "diameter") return false;
    const n = parseLength(text, this.ed.doc.units);
    if (n === null || n <= 0) return false;
    this.make(this.center!, this.step === "radius" ? n : n / 2);
    return true;
  }
  preview(c: Vec): Entity[] {
    const circle = (center: Vec, radius: number) => (radius > 1e-9 ? [this.ed.make<CircleEntity>({ type: "circle", center, radius })] : []);
    if (this.step === "radius") return circle(this.center!, dist(this.center!, c));
    if (this.step === "diameter") return circle(this.center!, dist(this.center!, c) / 2);
    if (this.step === "2p" && this.picks.length === 1) return circle(mid(this.picks[0], c), dist(this.picks[0], c) / 2);
    if (this.step === "3p" && this.picks.length === 2) {
      const through = circleThrough(this.picks[0], this.picks[1], c);
      return through ? circle(through.center, through.radius) : [];
    }
    return [];
  }
}

class ArcCommand extends Command {
  name = "ARC";
  private mode: "3p" | "center" = "3p";
  private picks: Vec[] = [];
  prompt(): Prompt {
    if (this.mode === "3p") {
      if (!this.picks.length) return { text: "Specify start point of arc", keywords: [{ key: "C", label: "Center" }] };
      return { text: this.picks.length === 1 ? "Specify second point of arc" : "Specify end point of arc", base: this.picks.at(-1) };
    }
    return { text: ["Specify center point of arc", "Specify start point of arc", "Specify end point of arc"][this.picks.length], base: this.picks[0] ?? null };
  }
  private arcFromPicks(end: Vec): { center: Vec; radius: number; start: number; end: number } | null {
    if (this.mode === "3p") return this.picks.length === 2 ? arcThrough(this.picks[0], this.picks[1], end) : null;
    if (this.picks.length !== 2) return null;
    const [center, start] = this.picks;
    return { center, radius: dist(center, start), start: angleOf(center, start), end: angleOf(center, end) };
  }
  point(p: Vec) {
    if (this.picks.length === 2) {
      const arc = this.arcFromPicks(p);
      if (!arc || sweepOf(arc.start, arc.end) < 1e-9) return this.ed.print("Those points don't make an arc.", "error");
      this.ed.doc.begin("ARC");
      this.ed.doc.add(this.ed.make<ArcEntity>({ type: "arc", ...arc }));
      this.ed.finish();
      return;
    }
    this.picks.push(p);
  }
  keyword(key: string) {
    if (key === "C" && this.mode === "3p" && !this.picks.length) this.mode = "center";
  }
  preview(c: Vec): Entity[] {
    const arc = this.arcFromPicks(c);
    if (arc) return [this.ed.make<ArcEntity>({ type: "arc", ...arc })];
    if (this.mode === "center" && this.picks.length === 1) return [this.ed.make<LineEntity>({ type: "line", a: this.picks[0], b: c })];
    if (this.mode === "3p" && this.picks.length === 1) return [this.ed.make<LineEntity>({ type: "line", a: this.picks[0], b: c })];
    return [];
  }
}

class RectangCommand extends Command {
  name = "RECTANG";
  private first: Vec | null = null;
  private step: "first" | "other" | "length" | "width" | "side" = "first";
  private size: { length: number; width: number } | null = null;
  prompt(): Prompt {
    const units = this.ed.doc.units;
    switch (this.step) {
      case "first":
        return { text: "Specify first corner point" };
      case "other":
        return { text: "Specify other corner point", keywords: [{ key: "D", label: "Dimensions" }], base: this.first };
      case "length":
        return { text: "Specify length for rectangles", base: this.first };
      case "width":
        return { text: `Specify width for rectangles (length ${formatLength(this.size!.length, units)})`, base: this.first };
      case "side":
        return { text: "Specify other corner point (click the side to place it)", base: this.first };
    }
  }
  private corners(a: Vec, b: Vec): Vec[] {
    return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  }
  private sized(c: Vec) {
    const { length, width } = this.size!;
    return { x: this.first!.x + (c.x >= this.first!.x ? length : -length), y: this.first!.y + (c.y >= this.first!.y ? width : -width) };
  }
  private make(b: Vec) {
    const a = this.first!;
    if (Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9) return this.ed.print("A rectangle needs both a length and a width.", "error");
    const points = this.corners(a, b);
    this.ed.doc.begin("RECTANG");
    this.ed.doc.add(this.ed.make<PolylineEntity>({ type: "polyline", points, bulges: [0, 0, 0, 0], closed: true }));
    this.ed.finish();
  }
  point(p: Vec) {
    if (this.step === "first") {
      this.first = p;
      this.step = "other";
    } else if (this.step === "other") this.make(p);
    else if (this.step === "side") this.make(this.sized(p));
  }
  keyword(key: string) {
    if (key === "D" && this.step === "other") this.step = "length";
  }
  value(text: string) {
    if (this.step !== "length" && this.step !== "width") return false;
    const n = parseLength(text, this.ed.doc.units);
    if (n === null || n <= 0) return false;
    if (this.step === "length") {
      this.size = { length: n, width: 0 };
      this.step = "width";
    } else {
      this.size!.width = n;
      this.step = "side";
    }
    return true;
  }
  preview(c: Vec): Entity[] {
    if (!this.first || this.step === "first") return [];
    const b = this.step === "side" ? this.sized(c) : this.step === "other" ? c : null;
    if (!b) return [];
    return [this.ed.make<PolylineEntity>({ type: "polyline", points: this.corners(this.first, b), bulges: [0, 0, 0, 0], closed: true })];
  }
}

/** Commands that work on objects: they take the current selection, or ask for one. */
abstract class SelectingCommand extends Command {
  /** The selection is used up: it's cleared when the command ends, as in AutoCAD. */
  readonly clearsSelection = true;
  protected selecting = true;
  start() {
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

class EraseCommand extends SelectingCommand {
  name = "ERASE";
  prompt() {
    return this.selectPrompt();
  }
  protected selected() {
    const targets = this.targets();
    this.ed.doc.begin("ERASE");
    for (const e of targets) this.ed.doc.remove(e.id);
    this.ed.clearSelection();
    this.ed.finish();
  }
}

class MoveCommand extends SelectingCommand {
  name = "MOVE";
  protected copies = false;
  protected base: Vec | null = null;
  private placed = 0;
  prompt(): Prompt {
    if (this.selecting) return this.selectPrompt();
    if (!this.base) return { text: "Specify base point" };
    if (this.copies)
      return { text: "Specify second point", keywords: this.placed ? [{ key: "E", label: "Exit" }, UNDO] : [{ key: "E", label: "Exit" }], base: this.base, enterLabel: "Exit" };
    return { text: "Specify second point", base: this.base, enterLabel: "use first point as displacement" };
  }
  start() {
    this.ed.doc.begin(this.name);
    super.start();
  }
  protected place(d: Vec) {
    for (const e of this.targets()) {
      if (this.copies) this.ed.doc.add({ ...translate(e, d), id: this.ed.newId() });
      else this.ed.doc.update(translate(e, d));
    }
  }
  point(p: Vec) {
    if (this.selecting) return;
    if (!this.base) {
      this.base = p;
      return;
    }
    this.place(sub(p, this.base));
    if (this.copies) this.placed++;
    else this.ed.finish();
  }
  keyword(key: string) {
    if (key === "E") this.ed.finish();
    else if (key === "U" && this.copies && this.placed) {
      for (let i = 0; i < this.targets().length; i++) this.ed.doc.undoLastChange();
      this.placed--;
    }
  }
  enter() {
    if (this.selecting || !this.base) return super.enter();
    if (!this.copies) this.place(this.base); // the first point as the displacement
    this.ed.finish();
  }
  preview(c: Vec): Entity[] {
    if (this.selecting || !this.base) return [];
    const d = sub(c, this.base);
    return this.targets().slice(0, 2000).map((e) => translate(e, d));
  }
}

class CopyCommand extends MoveCommand {
  name = "COPY";
  protected copies = true;
}

class ZoomCommand extends Command {
  name = "ZOOM";
  private corner: Vec | null = null;
  prompt(): Prompt {
    if (this.corner) return { text: "Specify opposite corner", base: this.corner };
    return { text: "Specify corner of window", keywords: [{ key: "A", label: "All" }, { key: "E", label: "Extents" }, { key: "W", label: "Window" }] };
  }
  point(p: Vec) {
    if (!this.corner) this.corner = p;
    else {
      this.ed.zoomWindow(this.corner, p);
      this.ed.finish();
    }
  }
  keyword(key: string) {
    if (key === "A" || key === "E") {
      this.ed.zoomExtents();
      this.ed.finish();
    }
  }
}

class PanCommand extends Command {
  name = "PAN";
  readonly pans = true;
  prompt(): Prompt {
    return { text: "Press Esc or Enter to exit" };
  }
}

/** Commands that act at once. */
class ImmediateCommand extends Command {
  constructor(
    ed: Editor,
    readonly name: string,
    private run: (ed: Editor) => void,
  ) {
    super(ed);
  }
  prompt(): Prompt {
    return { text: "" };
  }
  start() {
    this.run(this.ed);
    this.ed.finish();
  }
}

export type CommandInfo = { name: string; aliases: string[]; description: string; create: (ed: Editor) => Command };

export const COMMANDS: CommandInfo[] = [
  { name: "LINE", aliases: ["L"], description: "Creates straight line segments", create: (ed) => new LineCommand(ed) },
  { name: "PLINE", aliases: ["PL"], description: "Creates a polyline", create: (ed) => new PlineCommand(ed) },
  { name: "CIRCLE", aliases: ["C"], description: "Creates a circle", create: (ed) => new CircleCommand(ed) },
  { name: "ARC", aliases: ["A"], description: "Creates an arc", create: (ed) => new ArcCommand(ed) },
  { name: "RECTANG", aliases: ["REC", "RECTANGLE"], description: "Creates a rectangular polyline", create: (ed) => new RectangCommand(ed) },
  { name: "ERASE", aliases: ["E"], description: "Removes objects from the drawing", create: (ed) => new EraseCommand(ed) },
  { name: "MOVE", aliases: ["M"], description: "Moves objects a specified distance in a specified direction", create: (ed) => new MoveCommand(ed) },
  { name: "COPY", aliases: ["CO", "CP"], description: "Copies objects a specified distance in a specified direction", create: (ed) => new CopyCommand(ed) },
  { name: "ZOOM", aliases: ["Z"], description: "Increases or decreases the magnification of the view", create: (ed) => new ZoomCommand(ed) },
  { name: "PAN", aliases: ["P"], description: "Moves the view", create: (ed) => new PanCommand(ed) },
  { name: "LAYER", aliases: ["LA"], description: "Manages layers and layer properties", create: (ed) => new ImmediateCommand(ed, "LAYER", (e) => e.ui.openPalette("layers")) },
  { name: "PROPERTIES", aliases: ["PR", "CH", "MO"], description: "Controls properties of existing objects", create: (ed) => new ImmediateCommand(ed, "PROPERTIES", (e) => e.ui.openPalette("properties")) },
  { name: "U", aliases: [], description: "Reverses the most recent operation", create: (ed) => new ImmediateCommand(ed, "U", (e) => e.undo()) },
  { name: "UNDO", aliases: [], description: "Reverses the effect of commands", create: (ed) => new ImmediateCommand(ed, "UNDO", (e) => e.undo()) },
  { name: "REDO", aliases: [], description: "Reverses the effects of the previous UNDO", create: (ed) => new ImmediateCommand(ed, "REDO", (e) => e.redo()) },
];

export function findCommand(text: string): CommandInfo | undefined {
  const t = text.trim().toUpperCase().replace(/^[_.\-']+/, "");
  return COMMANDS.find((c) => c.name === t || c.aliases.includes(t));
}

/** AutoComplete for the command line: names and aliases starting with what's typed. */
export function suggestCommands(text: string): CommandInfo[] {
  const t = text.trim().toUpperCase();
  if (!t) return [];
  return COMMANDS.filter((c) => c.name.startsWith(t) || c.aliases.some((a) => a.startsWith(t))).sort(
    (a, b) => Number(!(a.aliases.includes(t) || a.name === t)) - Number(!(b.aliases.includes(t) || b.name === t)),
  );
}
