import { Command, EXIT, parseNumber, SelectingCommand, UNDO, type Prompt } from "./command-base";
import { breakBetween, chamferLines, cuts, explode, extendTo, filletLines, join, offset, offsetDistanceTo, paramOf, stretch, trimAt } from "./edit-ops";
import type { Editor } from "./editor";
import { angleOf, bounds, dist, emptyBox, extendBox, reflection, rotation, scaling, sub, transform, translate, type Box } from "./geometry";
import { formatLength, parseAngle, parseLength } from "./units";
import type { Entity, LineEntity, Vec } from "./types";

// The modify commands, with AutoCAD's prompts and options.

const DEG = Math.PI / 180;
const YES_NO = [
  { key: "Y", label: "Yes" },
  { key: "N", label: "No" },
];

export class EraseCommand extends SelectingCommand {
  name = "ERASE";
  prompt() {
    return this.selectPrompt();
  }
  protected selected() {
    for (const e of this.targets()) this.ed.doc.remove(e.id);
    this.ed.finish();
  }
}

export class MoveCommand extends SelectingCommand {
  name = "MOVE";
  protected copies = false;
  protected base: Vec | null = null;
  private placed = 0;
  prompt(): Prompt {
    if (this.selecting) return this.selectPrompt();
    if (!this.base) return { text: "Specify base point" };
    if (this.copies) return { text: "Specify second point", keywords: this.placed ? [EXIT, UNDO] : [EXIT], base: this.base, enterLabel: "Exit" };
    return { text: "Specify second point", base: this.base, enterLabel: "use first point as displacement" };
  }
  protected place(d: Vec) {
    for (const e of this.targets()) {
      if (this.copies) this.ed.doc.add({ ...translate(e, d), id: this.ed.newId() });
      else this.ed.doc.update(translate(e, d));
    }
  }
  point(p: Vec) {
    if (this.selecting) return;
    if (!this.base) return void (this.base = p);
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

export class CopyCommand extends MoveCommand {
  name = "COPY";
  protected copies = true;
}

/** ROTATE and SCALE: a base point, then an angle or factor, typed or shown, with Copy and Reference. */
abstract class TransformCommand extends SelectingCommand {
  protected base: Vec | null = null;
  protected copy = false;
  protected step: "base" | "amount" | "ref1" | "ref2" | "new" = "base";
  protected refFirst: Vec | null = null;
  protected ref = 0;
  protected abstract amountFrom(p: Vec): number;
  protected abstract parseAmount(text: string): number | null;
  protected abstract apply(e: Entity, amount: number): Entity;

  protected finishWith(amount: number) {
    for (const e of this.targets()) {
      const moved = this.apply(e, amount);
      if (this.copy) this.ed.doc.add({ ...moved, id: this.ed.newId() });
      else this.ed.doc.update(moved);
    }
    this.ed.finish();
  }
  point(p: Vec) {
    if (this.selecting) return;
    if (this.step === "base") {
      this.base = p;
      this.step = "amount";
    } else if (this.step === "amount") this.finishWith(this.amountFrom(p));
    else if (this.step === "ref1") {
      this.refFirst = p;
      this.step = "ref2";
    } else if (this.step === "ref2") {
      this.ref = this.referenceFrom(this.refFirst!, p);
      this.step = "new";
    } else if (this.step === "new") this.finishWith(this.combine(this.amountFrom(p)));
  }
  protected abstract referenceFrom(a: Vec, b: Vec): number;
  protected abstract combine(newAmount: number): number;
  keyword(key: string) {
    if (this.step !== "amount") return;
    if (key === "C") {
      this.copy = !this.copy;
      this.ed.print(this.copy ? `${this.name === "ROTATE" ? "Rotating" : "Scaling"} a copy of the selected objects.` : "Copying turned off.", "info");
    } else if (key === "R") this.step = "ref1";
  }
  value(text: string) {
    if (this.selecting || this.step === "base") return false;
    const n = this.parseAmount(text);
    if (n === null) return false;
    if (this.step === "amount") this.finishWith(n);
    else if (this.step === "ref1" || this.step === "ref2") {
      this.ref = n;
      this.step = "new";
    } else this.finishWith(this.combine(n));
    return true;
  }
  enter() {
    if (this.selecting) return super.enter();
    this.ed.finish();
  }
  preview(c: Vec): Entity[] {
    if (this.selecting || !this.base || (this.step !== "amount" && this.step !== "new")) return [];
    const amount = this.step === "amount" ? this.amountFrom(c) : this.combine(this.amountFrom(c));
    return this.targets().slice(0, 2000).map((e) => this.apply(e, amount));
  }
}

export class RotateCommand extends TransformCommand {
  name = "ROTATE";
  prompt(): Prompt {
    if (this.selecting) return this.selectPrompt();
    switch (this.step) {
      case "base":
        return { text: "Specify base point" };
      case "amount":
        return { text: "Specify rotation angle", keywords: [{ key: "C", label: "Copy" }, { key: "R", label: "Reference" }], base: this.base };
      case "ref1":
        return { text: "Specify the reference angle", base: this.base };
      case "ref2":
        return { text: "Specify second point", base: this.refFirst };
      case "new":
        return { text: "Specify the new angle", base: this.base };
    }
  }
  protected amountFrom(p: Vec) {
    return angleOf(this.base!, p);
  }
  protected parseAmount(text: string) {
    return parseAngle(text);
  }
  protected referenceFrom(a: Vec, b: Vec) {
    return angleOf(a, b);
  }
  protected combine(newAngle: number) {
    return newAngle - this.ref;
  }
  protected apply(e: Entity, angle: number) {
    return transform(e, rotation(this.base!, angle));
  }
}

export class ScaleCommand extends TransformCommand {
  name = "SCALE";
  prompt(): Prompt {
    if (this.selecting) return this.selectPrompt();
    switch (this.step) {
      case "base":
        return { text: "Specify base point" };
      case "amount":
        return { text: "Specify scale factor", keywords: [{ key: "C", label: "Copy" }, { key: "R", label: "Reference" }], base: this.base };
      case "ref1":
        return { text: "Specify reference length", base: this.base };
      case "ref2":
        return { text: "Specify second point", base: this.refFirst };
      case "new":
        return { text: "Specify new length", base: this.base };
    }
  }
  protected amountFrom(p: Vec) {
    return Math.max(dist(this.base!, p), 1e-9);
  }
  protected parseAmount(text: string) {
    // Factors are plain numbers; reference lengths are lengths.
    const n = this.step === "amount" ? parseNumber(text) : parseLength(text, this.ed.doc.units);
    return n !== null && n > 0 ? n : null;
  }
  protected referenceFrom(a: Vec, b: Vec) {
    return dist(a, b);
  }
  protected combine(newLength: number) {
    return this.ref > 1e-12 ? newLength / this.ref : 1;
  }
  protected apply(e: Entity, factor: number) {
    return transform(e, scaling(this.base!, factor));
  }
}

export class MirrorCommand extends SelectingCommand {
  name = "MIRROR";
  private first: Vec | null = null;
  private second: Vec | null = null;
  prompt(): Prompt {
    if (this.selecting) return this.selectPrompt();
    if (!this.first) return { text: "Specify first point of mirror line" };
    if (!this.second) return { text: "Specify second point of mirror line", base: this.first };
    return { text: "Erase source objects?", keywords: YES_NO, enterLabel: "No" };
  }
  private done(erase: boolean) {
    const x = reflection(this.first!, this.second!);
    for (const e of this.targets()) {
      if (erase) this.ed.doc.update(transform(e, x));
      else this.ed.doc.add({ ...transform(e, x), id: this.ed.newId() });
    }
    this.ed.finish();
  }
  point(p: Vec) {
    if (this.selecting) return;
    if (!this.first) this.first = p;
    else if (!this.second && dist(this.first, p) > 1e-9) this.second = p;
  }
  keyword(key: string) {
    if (this.second) this.done(key === "Y");
  }
  enter() {
    if (this.selecting) return super.enter();
    if (this.second) return this.done(false);
    this.ed.finish();
  }
  preview(c: Vec): Entity[] {
    if (this.selecting || !this.first || dist(this.first, c) < 1e-9) return [];
    const x = reflection(this.first, this.second ?? c);
    return this.targets().slice(0, 2000).map((e) => transform(e, x));
  }
}

export class OffsetCommand extends Command {
  name = "OFFSET";
  private distance: number | "through" | null = null;
  private distanceFrom: Vec | null = null;
  private source: Entity | null = null;
  private made: number[] = []; // changes per offset, for Undo
  start() {
    this.ed.doc.begin("OFFSET");
    const last = this.ed.memory.offset;
    this.ed.print(`Current settings: Erase source=No Layer=Source OFFSETGAPTYPE=0`, "info");
    if (last === undefined) this.ed.memory.offset = "through";
  }
  private get last() {
    const m = this.ed.memory.offset;
    return m === "through" || m === undefined ? "Through" : formatLength(Number(m), this.ed.doc.units);
  }
  prompt(): Prompt {
    if (this.distance === null) {
      if (this.distanceFrom) return { text: "Specify second point", base: this.distanceFrom };
      return { text: "Specify offset distance", keywords: [{ key: "T", label: "Through" }], enterLabel: this.last };
    }
    if (!this.source) return { text: "Select object to offset", keywords: this.made.length ? [EXIT, UNDO] : [EXIT], picking: true, enterLabel: "Exit" };
    if (this.distance === "through") return { text: "Specify through point", keywords: [EXIT, UNDO], enterLabel: "Exit" };
    return { text: "Specify point on side to offset", keywords: [EXIT, UNDO], enterLabel: "Exit" };
  }
  private setDistance(d: number | "through") {
    this.distance = d;
    this.ed.memory.offset = d;
  }
  point(p: Vec) {
    if (this.distance === null) {
      if (!this.distanceFrom) this.distanceFrom = p;
      else this.setDistance(dist(this.distanceFrom, p));
      return;
    }
    if (!this.source) return;
    const d = this.distance === "through" ? offsetDistanceTo(this.source, p) : this.distance;
    const result = offset(this.source, d, p);
    if (!result) this.ed.print("Cannot offset that object by that distance.", "error");
    else {
      this.ed.doc.add({ ...result, id: this.ed.newId() });
      this.made.push(1);
    }
    this.source = null;
  }
  pick(e: Entity | null) {
    if (!e) return;
    this.source = e;
  }
  keyword(key: string) {
    if (this.distance === null && key === "T") return this.setDistance("through");
    if (key === "E") return this.ed.finish();
    if (key === "U" && this.made.length) {
      this.ed.doc.undoLastChange();
      this.made.pop();
      this.source = null;
    }
  }
  value(text: string) {
    if (this.distance !== null) return false;
    const d = parseLength(text, this.ed.doc.units);
    if (d === null || d <= 0) return false;
    this.setDistance(d);
    return true;
  }
  enter() {
    if (this.distance === null) {
      const m = this.ed.memory.offset;
      this.setDistance(m === undefined || m === "through" ? "through" : Number(m));
      return;
    }
    this.ed.finish();
  }
  preview(c: Vec): Entity[] {
    if (!this.source || this.distance === null) return [];
    const d = this.distance === "through" ? offsetDistanceTo(this.source, c) : this.distance;
    const result = offset(this.source, d, c);
    return result ? [result] : [];
  }
}

const EVERYWHERE: Box = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };

/** The visible objects other than `e` within a box (by default, where `e` is: the ones that can cut it). */
function others(ed: Editor, e: Entity, box: Box = bounds(e)): Entity[] {
  return ed.doc.query(box).filter((o) => o.id !== e.id && ed.doc.isVisible(o));
}

/** TRIM and EXTEND (AutoCAD's Quick mode): every object is a cutting edge or boundary; Shift switches between them. */
abstract class TrimExtendCommand extends Command {
  private steps: number[] = [];
  protected abstract trims: boolean;
  start() {
    this.ed.doc.begin(this.name);
    this.ed.print("Current settings: Projection=UCS, Edge=None, Mode=Quick", "info");
  }
  prompt(): Prompt {
    return this.trims
      ? { text: "Select object to trim or shift-select to extend", keywords: this.steps.length ? [UNDO] : [], picking: true }
      : { text: "Select object to extend or shift-select to trim", keywords: this.steps.length ? [UNDO] : [], picking: true };
  }
  private changes = 0;
  private count<T>(work: () => T) {
    this.changes = 0;
    const off = this.ed.doc.subscribe(() => this.changes++);
    const out = work();
    off();
    if (this.changes) this.steps.push(this.changes);
    return out;
  }
  private trim(e: Entity, at: Vec) {
    const pieces = trimAt(e, paramOf(e, at), cuts(e, others(this.ed, e)));
    if (pieces === null) return this.ed.print("That object can't be trimmed there.", "error");
    this.count(() => {
      if (!pieces.length) this.ed.doc.remove(e.id);
      else {
        this.ed.doc.update({ ...pieces[0], id: e.id });
        for (const p of pieces.slice(1)) this.ed.doc.add({ ...p, id: this.ed.newId() });
      }
    });
  }
  private extend(e: Entity, at: Vec) {
    const result = extendTo(e, at, others(this.ed, e, EVERYWHERE));
    if (!result) return this.ed.print("No boundary to extend to in that direction.", "error");
    this.count(() => this.ed.doc.update(result));
  }
  pick(e: Entity | null, at: Vec, shift: boolean) {
    if (!e) return;
    if (this.trims !== shift) this.trim(e, at);
    else this.extend(e, at);
  }
  keyword(key: string) {
    if (key !== "U") return;
    const n = this.steps.pop();
    for (let i = 0; i < (n ?? 0); i++) this.ed.doc.undoLastChange();
  }
}

export class TrimCommand extends TrimExtendCommand {
  name = "TRIM";
  protected trims = true;
}

export class ExtendCommand extends TrimExtendCommand {
  name = "EXTEND";
  protected trims = false;
}

/** FILLET and CHAMFER: two lines picked, then joined at a corner. */
abstract class CornerCommand extends Command {
  protected first: { e: LineEntity; at: Vec } | null = null;
  protected step: "first" | "second" | "setting1" | "setting2" = "first";
  protected abstract settingsLine(): string;
  protected abstract apply(a: { e: LineEntity; at: Vec }, b: { e: LineEntity; at: Vec }, corner: boolean): string | null;
  start() {
    this.ed.print(this.settingsLine(), "info");
  }
  pick(e: Entity | null, at: Vec, shift: boolean) {
    if (!e) return;
    if (e.type !== "line") return this.ed.print(`Only lines can be ${this.name === "FILLET" ? "filleted" : "chamfered"} for now.`, "error");
    if (this.step === "first") {
      this.first = { e, at };
      this.step = "second";
      return;
    }
    if (this.step !== "second" || !this.first) return;
    if (e.id === this.first.e.id) return this.ed.print("Pick a different line.", "error");
    this.ed.doc.begin(this.name);
    const error = this.apply(this.first, { e, at }, shift);
    if (error) {
      this.ed.doc.rollback();
      this.ed.print(error, "error");
      this.first = null;
      this.step = "first";
      return;
    }
    this.ed.finish();
  }
}

export class FilletCommand extends CornerCommand {
  name = "FILLET";
  private get radius() {
    return Number(this.ed.memory.filletRadius ?? 0);
  }
  protected settingsLine() {
    return `Current settings: Mode = TRIM, Radius = ${formatLength(this.radius, this.ed.doc.units)}`;
  }
  prompt(): Prompt {
    if (this.step === "setting1") return { text: "Specify fillet radius", enterLabel: formatLength(this.radius, this.ed.doc.units) };
    if (this.step === "second") return { text: "Select second object or shift-select to apply corner", picking: true };
    return { text: "Select first object", keywords: [{ key: "R", label: "Radius" }], picking: true };
  }
  keyword(key: string) {
    if (key === "R" && this.step === "first") this.step = "setting1";
  }
  value(text: string) {
    if (this.step !== "setting1") return false;
    const r = parseLength(text, this.ed.doc.units);
    if (r === null || r < 0) return false;
    this.ed.memory.filletRadius = r;
    this.step = "first";
    return true;
  }
  enter() {
    if (this.step === "setting1") this.step = "first";
    else this.ed.finish();
  }
  protected apply(a: { e: LineEntity; at: Vec }, b: { e: LineEntity; at: Vec }, corner: boolean) {
    const result = filletLines(a.e, a.at, b.e, b.at, corner ? 0 : this.radius);
    if (typeof result === "string") return result;
    this.ed.doc.update(result.lines[0]);
    this.ed.doc.update(result.lines[1]);
    if (result.arc) this.ed.doc.add({ ...result.arc, id: this.ed.newId() });
    return null;
  }
}

export class ChamferCommand extends CornerCommand {
  name = "CHAMFER";
  private get d1() {
    return Number(this.ed.memory.chamfer1 ?? 0);
  }
  private get d2() {
    return Number(this.ed.memory.chamfer2 ?? 0);
  }
  protected settingsLine() {
    const u = this.ed.doc.units;
    return `(TRIM mode) Current chamfer Dist1 = ${formatLength(this.d1, u)}, Dist2 = ${formatLength(this.d2, u)}`;
  }
  prompt(): Prompt {
    const u = this.ed.doc.units;
    if (this.step === "setting1") return { text: "Specify first chamfer distance", enterLabel: formatLength(this.d1, u) };
    if (this.step === "setting2") return { text: "Specify second chamfer distance", enterLabel: formatLength(this.d1, u) };
    if (this.step === "second") return { text: "Select second line or shift-select to apply corner", picking: true };
    return { text: "Select first line", keywords: [{ key: "D", label: "Distance" }], picking: true };
  }
  keyword(key: string) {
    if (key === "D" && this.step === "first") this.step = "setting1";
  }
  value(text: string) {
    if (this.step !== "setting1" && this.step !== "setting2") return false;
    const d = parseLength(text, this.ed.doc.units);
    if (d === null || d < 0) return false;
    if (this.step === "setting1") {
      this.ed.memory.chamfer1 = d;
      this.ed.memory.chamfer2 = d;
      this.step = "setting2";
    } else {
      this.ed.memory.chamfer2 = d;
      this.step = "first";
    }
    return true;
  }
  enter() {
    if (this.step === "setting1") this.step = "setting2";
    else if (this.step === "setting2") this.step = "first";
    else this.ed.finish();
  }
  protected apply(a: { e: LineEntity; at: Vec }, b: { e: LineEntity; at: Vec }, corner: boolean) {
    const result = chamferLines(a.e, a.at, b.e, b.at, corner ? 0 : this.d1, corner ? 0 : this.d2);
    if (typeof result === "string") return result;
    this.ed.doc.update(result.lines[0]);
    this.ed.doc.update(result.lines[1]);
    if (result.bevel) {
      const { layer, color, lineweight, linetype } = a.e;
      this.ed.doc.add({ id: this.ed.newId(), type: "line", a: result.bevel[0], b: result.bevel[1], layer, color, lineweight, linetype });
    }
    return null;
  }
}

function extentsOf(entities: Entity[]): Box {
  const box = emptyBox();
  for (const e of entities) {
    const b = bounds(e);
    extendBox(box, { x: b.minX, y: b.minY });
    extendBox(box, { x: b.maxX, y: b.maxY });
  }
  return box;
}

/** ARRAY: copies in rows and columns, or around a centre (as separate objects). */
export class ArrayCommand extends SelectingCommand {
  name = "ARRAY";
  protected kind: "rect" | "polar" | null = null;
  private step = 0;
  private columns = 4;
  private rows = 3;
  private colGap = 0;
  private rowGap = 0;
  private center: Vec | null = null;
  private items = 6;
  private fill = 360;
  protected selected() {
    super.selected();
    const box = extentsOf(this.targets());
    // AutoCAD's default spacing: one and a half times the objects' size.
    this.colGap = Math.max((box.maxX - box.minX) * 1.5, 1);
    this.rowGap = Math.max((box.maxY - box.minY) * 1.5, 1);
  }
  prompt(): Prompt {
    if (this.selecting) return this.selectPrompt();
    const u = this.ed.doc.units;
    if (!this.kind) return { text: "Enter array type", keywords: [{ key: "R", label: "Rectangular" }, { key: "PO", label: "POlar" }], enterLabel: "Rectangular" };
    if (this.kind === "rect") {
      return [
        { text: "Enter number of columns", enterLabel: String(this.columns) },
        { text: "Enter number of rows", enterLabel: String(this.rows) },
        { text: "Specify distance between columns", enterLabel: formatLength(this.colGap, u) },
        { text: "Specify distance between rows", enterLabel: formatLength(this.rowGap, u) },
      ][this.step];
    }
    return [
      { text: "Specify center point of array" },
      { text: "Enter number of items", enterLabel: String(this.items) },
      { text: "Specify the angle to fill (+=ccw, -=cw)", enterLabel: String(this.fill) },
    ][this.step];
  }
  keyword(key: string) {
    if (this.kind || this.selecting) return;
    this.kind = key === "PO" ? "polar" : "rect";
  }
  private advance() {
    this.step++;
    const last = this.kind === "rect" ? 4 : 3;
    if (this.step >= last) this.build();
  }
  private build() {
    const targets = this.targets();
    if (this.kind === "rect") {
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.columns; c++) if (r || c) for (const e of targets) this.ed.doc.add({ ...translate(e, { x: c * this.colGap, y: r * this.rowGap }), id: this.ed.newId() });
    } else {
      const full = Math.abs(Math.abs(this.fill) - 360) < 1e-9;
      const step = (this.fill * DEG) / (full ? this.items : Math.max(this.items - 1, 1));
      for (let i = 1; i < this.items; i++) for (const e of targets) this.ed.doc.add({ ...transform(e, rotation(this.center!, step * i)), id: this.ed.newId() });
    }
    this.ed.finish();
  }
  point(p: Vec) {
    if (this.selecting || this.kind !== "polar" || this.step !== 0) return;
    this.center = p;
    this.advance();
  }
  value(text: string) {
    if (this.selecting || !this.kind) return false;
    const u = this.ed.doc.units;
    if (this.kind === "rect") {
      if (this.step <= 1) {
        const n = parseNumber(text);
        if (n === null || !Number.isInteger(n) || n < 1 || n > 10000) return false;
        if (this.step === 0) this.columns = n;
        else this.rows = n;
      } else {
        const d = parseLength(text, u);
        if (d === null) return false;
        if (this.step === 2) this.colGap = d;
        else this.rowGap = d;
      }
    } else {
      if (this.step === 1) {
        const n = parseNumber(text);
        if (n === null || !Number.isInteger(n) || n < 2 || n > 10000) return false;
        this.items = n;
      } else if (this.step === 2) {
        const a = parseNumber(text.replace(/[d°]$/i, ""));
        if (a === null || a === 0 || Math.abs(a) > 360) return false;
        this.fill = a;
      } else return false;
    }
    this.advance();
    return true;
  }
  enter() {
    if (this.selecting) return super.enter();
    if (!this.kind) {
      this.kind = "rect";
      return;
    }
    if (this.kind === "polar" && this.step === 0) return;
    this.advance();
  }
}

export class ArrayRectCommand extends ArrayCommand {
  name = "ARRAYRECT";
  protected kind: "rect" | "polar" | null = "rect";
}

export class ArrayPolarCommand extends ArrayCommand {
  name = "ARRAYPOLAR";
  protected kind: "rect" | "polar" | null = "polar";
}

export class StretchCommand extends SelectingCommand {
  name = "STRETCH";
  private base: Vec | null = null;
  private boxes: Box[] = [];
  protected selectPrompt(): Prompt {
    return { text: "Select objects to stretch by crossing-window", selecting: true };
  }
  protected selected() {
    super.selected();
    this.boxes = this.ed.windows.slice();
  }
  prompt(): Prompt {
    if (this.selecting) return this.selectPrompt();
    if (!this.base) return { text: "Specify base point" };
    return { text: "Specify second point", base: this.base, enterLabel: "use first point as displacement" };
  }
  private apply(d: Vec, e: Entity) {
    // Objects picked one by one (no window) move whole, as in AutoCAD.
    return this.boxes.length ? stretch(e, this.boxes, d) : translate(e, d);
  }
  point(p: Vec) {
    if (this.selecting) return;
    if (!this.base) return void (this.base = p);
    const d = sub(p, this.base);
    for (const e of this.targets()) this.ed.doc.update(this.apply(d, e));
    this.ed.finish();
  }
  enter() {
    if (this.selecting || !this.base) return super.enter();
    for (const e of this.targets()) this.ed.doc.update(this.apply(this.base, e));
    this.ed.finish();
  }
  preview(c: Vec): Entity[] {
    if (this.selecting || !this.base) return [];
    const d = sub(c, this.base);
    return this.targets().slice(0, 2000).map((e) => this.apply(d, e));
  }
}

export class BreakCommand extends Command {
  name = "BREAK";
  private target: Entity | null = null;
  private first: Vec | null = null;
  private choosingFirst = false;
  prompt(): Prompt {
    if (!this.target) return { text: "Select object", picking: true };
    if (this.choosingFirst) return { text: "Specify first break point" };
    return { text: "Specify second break point", keywords: [{ key: "F", label: "First point" }], base: this.first };
  }
  pick(e: Entity | null, at: Vec) {
    if (!e) return;
    this.target = e;
    this.first = at;
  }
  point(p: Vec) {
    if (!this.target) return;
    if (this.choosingFirst) {
      this.first = p;
      this.choosingFirst = false;
      return;
    }
    const pieces = breakBetween(this.target, this.first!, p);
    if (!pieces) return this.ed.print("That object can't be broken there.", "error");
    this.ed.doc.begin("BREAK");
    if (!pieces.length) this.ed.doc.remove(this.target.id);
    else {
      this.ed.doc.update({ ...pieces[0], id: this.target.id });
      for (const piece of pieces.slice(1)) this.ed.doc.add({ ...piece, id: this.ed.newId() });
    }
    this.ed.finish();
  }
  keyword(key: string) {
    if (key === "F" && this.target) this.choosingFirst = true;
  }
}

export class JoinCommand extends SelectingCommand {
  name = "JOIN";
  prompt() {
    return this.selectPrompt();
  }
  protected selected() {
    const targets = this.targets();
    const { removed, added } = join(targets);
    if (!removed.length) {
      this.ed.print("Those objects can't be joined (they need to meet end to end).", "error");
      return this.ed.finish();
    }
    for (const id of removed) if (!added.some((a) => a.id === id)) this.ed.doc.remove(id);
    for (const e of added) {
      if (this.ed.doc.entities.has(e.id)) this.ed.doc.update(e);
      else this.ed.doc.add(e);
    }
    this.ed.print(`${removed.length} objects joined into ${added.length}.`, "info");
    this.ed.finish();
  }
}

export class ExplodeCommand extends SelectingCommand {
  name = "EXPLODE";
  prompt() {
    return this.selectPrompt();
  }
  protected selected() {
    let skipped = 0;
    for (const e of this.targets()) {
      const parts = explode(e);
      if (!parts) {
        skipped++;
        continue;
      }
      this.ed.doc.remove(e.id);
      for (const part of parts) this.ed.doc.add({ ...part, id: this.ed.newId() });
    }
    if (skipped) this.ed.print(`${skipped} ${skipped === 1 ? "object was" : "objects were"} not able to be exploded.`, "info");
    this.ed.finish();
  }
}

export class MatchpropCommand extends Command {
  name = "MATCHPROP";
  private source: Entity | null = null;
  start() {
    this.ed.doc.begin("MATCHPROP");
  }
  prompt(): Prompt {
    if (!this.source) return { text: "Select source object", picking: true };
    return { text: "Select destination object(s)", picking: true, enterLabel: "done" };
  }
  pick(e: Entity | null) {
    if (!e) return;
    if (!this.source) {
      this.source = e;
      this.ed.print("Current active settings: Color Layer Lineweight Linetype", "info");
      return;
    }
    const { layer, color, lineweight, linetype } = this.source;
    this.ed.doc.update({ ...e, layer, color, lineweight, linetype } as Entity);
  }
}

