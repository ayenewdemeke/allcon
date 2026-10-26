import { findBoundary, loopsFromObjects } from "./boundary";
import { Command, parseNumber, SelectingCommand, UNDO, type Prompt } from "./command-base";
import { angleOf, dist, perp, sub, unit } from "./geometry";
import { dimStyle, HATCH_PATTERNS } from "./graphics";
import { formatLength, parseAngle, parseLength } from "./units";
import type { Editor } from "./editor";
import type { DimensionEntity, DimKind, Entity, HAlign, HatchEntity, LeaderEntity, LineEntity, MTextEntity, PolylineEntity, TextEntity, VAlign, Vec } from "./types";

// The annotation commands, with AutoCAD's prompts: text, dimensions, multileaders and hatches.

const DEG = Math.PI / 180;

/** A new text's default height: 3/32" (or 2.5 mm) on paper at the annotation scale. */
export function defaultTextHeight(ed: Editor) {
  const remembered = ed.memory.textHeight;
  if (typeof remembered === "number") return remembered;
  return (ed.doc.units === "mm" ? 2.5 : 3 / 32) * ed.doc.annoScale;
}

export const JUSTIFY: Record<string, [HAlign, VAlign]> = {
  L: ["left", "baseline"],
  C: ["center", "baseline"],
  R: ["right", "baseline"],
  M: ["center", "middle"],
  TL: ["left", "top"],
  TC: ["center", "top"],
  TR: ["right", "top"],
  ML: ["left", "middle"],
  MC: ["center", "middle"],
  MR: ["right", "middle"],
  BL: ["left", "bottom"],
  BC: ["center", "bottom"],
  BR: ["right", "bottom"],
};

export class TextCommand extends Command {
  name = "TEXT";
  private step: "point" | "justify" | "style" | "height" | "rotation" | "typing" = "point";
  private at: Vec | null = null;
  private height = 0;
  private justify: [HAlign, VAlign] = ["left", "baseline"];
  start() {
    this.height = defaultTextHeight(this.ed);
    const units = this.ed.doc.units;
    this.ed.print(`Current text style: "${this.ed.doc.currentTextStyle}" Text height: ${formatLength(this.height, units)} Annotative: No Justify: Left`, "info");
  }
  prompt(): Prompt {
    const units = this.ed.doc.units;
    switch (this.step) {
      case "point":
        return { text: "Specify start point of text", keywords: [{ key: "J", label: "Justify" }, { key: "S", label: "Style" }] };
      case "justify":
        return { text: "Enter an option", keywords: Object.keys(JUSTIFY).map((k) => ({ key: k, label: { L: "Left", C: "Center", R: "Right", M: "Middle" }[k] ?? k })) };
      case "style":
        return { text: "Enter style name", enterLabel: this.ed.doc.currentTextStyle };
      case "height":
        return { text: "Specify height", base: this.at, enterLabel: formatLength(this.height, units) };
      case "rotation":
        return { text: "Specify rotation angle of text", base: this.at, enterLabel: "0" };
      case "typing":
        return { text: "Enter text (Esc or click outside when done)" };
    }
  }
  point(p: Vec) {
    if (this.step === "point") {
      this.at = p;
      this.step = "height";
    } else if (this.step === "height") {
      this.height = Math.max(dist(this.at!, p), 1e-9);
      this.step = "rotation";
    } else if (this.step === "rotation") this.type(angleOf(this.at!, p));
  }
  keyword(key: string) {
    if (this.step === "point" && key === "J") this.step = "justify";
    else if (this.step === "point" && key === "S") this.step = "style";
    else if (this.step === "justify" && JUSTIFY[key]) {
      this.justify = JUSTIFY[key];
      this.step = "point";
    }
  }
  value(text: string) {
    if (this.step === "style") {
      if (!this.ed.doc.textStyles.has(text)) return this.ed.print(`Cannot find text style "${text}".`, "error"), true;
      this.ed.doc.setSetting("currentTextStyle", text);
      this.step = "point";
      return true;
    }
    if (this.step === "height") {
      const h = parseLength(text, this.ed.doc.units);
      if (h === null || h <= 0) return false;
      this.height = h;
      this.step = "rotation";
      return true;
    }
    if (this.step === "rotation") {
      const a = parseAngle(text);
      if (a === null) return false;
      this.type(a);
      return true;
    }
    return false;
  }
  enter() {
    if (this.step === "height") this.step = "rotation";
    else if (this.step === "rotation") this.type(0);
    else if (this.step === "style" || this.step === "justify") this.step = "point";
    else this.ed.finish();
  }
  /** Type the text in place; each line becomes a text object, one under the other. */
  private type(rotation: number) {
    this.ed.memory.textHeight = this.height;
    this.step = "typing";
    const [halign, valign] = this.justify;
    this.ed.openTextEditor({
      at: this.at!,
      height: this.height,
      rotation,
      width: 0,
      value: "",
      style: this.ed.doc.currentTextStyle,
      done: (text) => {
        const lines = (text ?? "").split("\n");
        this.ed.doc.begin("TEXT");
        const down = { x: Math.sin(rotation), y: -Math.cos(rotation) };
        lines.forEach((line, i) => {
          if (!line.trim()) return;
          const at = { x: this.at!.x + down.x * i * this.height * (5 / 3), y: this.at!.y + down.y * i * this.height * (5 / 3) };
          this.ed.doc.add(this.ed.make<TextEntity>({ type: "text", at, text: line, height: this.height, rotation, style: this.ed.doc.currentTextStyle, halign, valign }));
        });
        this.ed.finish();
      },
    });
  }
}

export class MTextCommand extends Command {
  name = "MTEXT";
  private first: Vec | null = null;
  private step: "first" | "second" | "height" | "rotation" = "first";
  private height = 0;
  private rotation = 0;
  start() {
    this.height = defaultTextHeight(this.ed);
    this.ed.print(`Current text style: "${this.ed.doc.currentTextStyle}" Text height: ${formatLength(this.height, this.ed.doc.units)} Annotative: No`, "info");
  }
  prompt(): Prompt {
    if (this.step === "first") return { text: "Specify first corner" };
    if (this.step === "height") return { text: "Specify height", enterLabel: formatLength(this.height, this.ed.doc.units) };
    if (this.step === "rotation") return { text: "Specify rotation angle", enterLabel: "0" };
    return { text: "Specify opposite corner", keywords: [{ key: "H", label: "Height" }, { key: "R", label: "Rotation" }], base: this.first };
  }
  point(p: Vec) {
    if (this.step === "first") {
      this.first = p;
      this.step = "second";
      return;
    }
    if (this.step !== "second") return;
    const box = { minX: Math.min(this.first!.x, p.x), maxX: Math.max(this.first!.x, p.x), maxY: Math.max(this.first!.y, p.y) };
    const at = { x: box.minX, y: box.maxY };
    const width = box.maxX - box.minX;
    this.ed.memory.textHeight = this.height;
    this.ed.openTextEditor({
      at,
      height: this.height,
      rotation: this.rotation,
      width,
      value: "",
      style: this.ed.doc.currentTextStyle,
      multiline: true,
      done: (text) => {
        if (text?.trim()) {
          this.ed.doc.begin("MTEXT");
          this.ed.doc.add(this.ed.make<MTextEntity>({ type: "mtext", at, text, height: this.height, width, rotation: this.rotation, style: this.ed.doc.currentTextStyle }));
        }
        this.ed.finish();
      },
    });
  }
  keyword(key: string) {
    if (this.step !== "second") return;
    if (key === "H") this.step = "height";
    if (key === "R") this.step = "rotation";
  }
  value(text: string) {
    if (this.step === "height") {
      const h = parseLength(text, this.ed.doc.units);
      if (h === null || h <= 0) return false;
      this.height = h;
    } else if (this.step === "rotation") {
      const a = parseAngle(text);
      if (a === null) return false;
      this.rotation = a;
    } else return false;
    this.step = "second";
    return true;
  }
  enter() {
    if (this.step === "height" || this.step === "rotation") this.step = "second";
    else this.ed.finish();
  }
  preview(c: Vec): Entity[] {
    if (this.step !== "second" || !this.first) return [];
    const a = this.first;
    return [this.ed.make<PolylineEntity>({ type: "polyline", points: [a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }], bulges: [0, 0, 0, 0], closed: true })];
  }
}

/** TEXTEDIT (double-click): edits text, multiline text, a dimension's text or a leader's text. */
export class TextEditCommand extends Command {
  name = "TEXTEDIT";
  constructor(
    ed: Editor,
    private target: Entity | null = null,
  ) {
    super(ed);
  }
  start() {
    if (this.target) this.edit(this.target);
  }
  prompt(): Prompt {
    return { text: "Select an annotation object", picking: true };
  }
  pick(e: Entity | null) {
    if (e) this.edit(e);
  }
  private edit(e: Entity) {
    const done = (apply: (text: string) => Entity | null) => (text: string | null) => {
      if (text !== null) {
        const next = apply(text);
        this.ed.doc.begin("TEXTEDIT");
        if (next) this.ed.doc.update(next);
        else this.ed.doc.remove(e.id);
      }
      this.ed.finish();
    };
    if (e.type === "text" || e.type === "mtext")
      this.ed.openTextEditor({
        at: e.at,
        height: e.height,
        rotation: e.rotation,
        width: e.type === "mtext" ? e.width : 0,
        value: e.text,
        style: e.style,
        multiline: e.type === "mtext",
        editing: e.id,
        done: done((text) => (text.trim() ? { ...e, text: e.type === "text" ? text.replace(/\n/g, " ") : text } : null)),
      });
    else if (e.type === "dimension" || e.type === "leader") {
      const st = dimStyle(e.type === "dimension" ? e.style : e.dimStyle);
      this.ed.openTextEditor({
        at: e.type === "dimension" ? e.loc : e.points[e.points.length - 1],
        height: e.type === "leader" ? e.height : st.textHeight * st.scale,
        rotation: 0,
        width: 0,
        value: e.text,
        style: st.textStyle,
        multiline: e.type === "leader",
        editing: e.id,
        done: done((text) => ({ ...e, text })),
      });
    } else {
      this.ed.print("That isn't an annotation object.", "error");
      if (this.target) this.ed.finish();
    }
  }
}

// --- dimensions ------------------------------------------------------------------------------

/** What a linear dimension measures along, from where its line is placed (AutoCAD picks horizontal or vertical). */
function autoAngle(p1: Vec, p2: Vec, loc: Vec) {
  const outX = Math.max(0, Math.min(p1.x, p2.x) - loc.x, loc.x - Math.max(p1.x, p2.x));
  const outY = Math.max(0, Math.min(p1.y, p2.y) - loc.y, loc.y - Math.max(p1.y, p2.y));
  return outX > outY ? Math.PI / 2 : 0;
}

abstract class DimCommand extends Command {
  start() {
    this.ed.doc.begin(this.name);
  }
  protected makeDim(kind: DimKind, fields: Partial<DimensionEntity>): DimensionEntity {
    return this.ed.make<DimensionEntity>({
      type: "dimension",
      kind,
      p1: { x: 0, y: 0 },
      p2: { x: 0, y: 0 },
      loc: { x: 0, y: 0 },
      center: { x: 0, y: 0 },
      angle: 0,
      text: "",
      style: this.ed.doc.currentDimStyle,
      ...fields,
    });
  }
  protected place(d: DimensionEntity) {
    this.ed.doc.add(d);
    this.ed.memory.lastDim = d.id;
  }
}

/** DIMLINEAR and DIMALIGNED: two extension line origins (or an object), then where the line goes. */
export class DimLinearCommand extends DimCommand {
  name = "DIMLINEAR";
  protected aligned = false;
  private p1: Vec | null = null;
  private p2: Vec | null = null;
  private selecting = false;
  private fixed: number | null = null; // Horizontal / Vertical / Rotated
  private text = "";
  private step: "points" | "text" | "rotated" = "points";
  prompt(): Prompt {
    if (this.selecting) return { text: "Select object to dimension", picking: true };
    if (this.step === "text") return { text: "Enter dimension text", enterLabel: "measurement", spaces: true };
    if (this.step === "rotated") return { text: "Specify angle of dimension line", base: this.p1, enterLabel: "0" };
    if (!this.p1) return { text: "Specify first extension line origin", enterLabel: "select object" };
    if (!this.p2) return { text: "Specify second extension line origin", base: this.p1 };
    const keywords = this.aligned
      ? [{ key: "T", label: "Text" }]
      : [
          { key: "T", label: "Text" },
          { key: "H", label: "Horizontal" },
          { key: "V", label: "Vertical" },
          { key: "R", label: "Rotated" },
        ];
    return { text: "Specify dimension line location", keywords };
  }
  private dim(loc: Vec) {
    const angle = this.aligned ? angleOf(this.p1!, this.p2!) : (this.fixed ?? autoAngle(this.p1!, this.p2!, loc));
    return this.makeDim(this.aligned ? "aligned" : "linear", { p1: this.p1!, p2: this.p2!, loc, angle, text: this.text });
  }
  point(p: Vec) {
    if (this.selecting || this.step !== "points") {
      if (this.step === "rotated") {
        this.fixed = angleOf(this.p1!, p);
        this.step = "points";
      }
      return;
    }
    if (!this.p1) this.p1 = p;
    else if (!this.p2) this.p2 = p;
    else {
      this.place(this.dim(p));
      this.ed.finish();
    }
  }
  pick(e: Entity | null) {
    if (!e) return;
    if (e.type === "line") [this.p1, this.p2] = [e.a, e.b];
    else if (e.type === "polyline" && e.points.length >= 2) [this.p1, this.p2] = [e.points[0], e.points[1]];
    else if (e.type === "circle" || e.type === "arc") [this.p1, this.p2] = [sub(e.center, { x: e.radius, y: 0 }), { x: e.center.x + e.radius, y: e.center.y }];
    else return this.ed.print("Select a line, polyline, arc or circle.", "error");
    this.selecting = false;
  }
  keyword(key: string) {
    if (!this.p2) return;
    if (key === "T") this.step = "text";
    else if (key === "H") this.fixed = 0;
    else if (key === "V") this.fixed = Math.PI / 2;
    else if (key === "R") this.step = "rotated";
  }
  value(text: string) {
    if (this.step === "text") {
      this.text = text;
      this.step = "points";
      return true;
    }
    if (this.step === "rotated") {
      const a = parseAngle(text);
      if (a === null) return false;
      this.fixed = a;
      this.step = "points";
      return true;
    }
    return false;
  }
  enter() {
    if (!this.p1 && !this.selecting) this.selecting = true;
    else if (this.step === "text") {
      this.text = "";
      this.step = "points";
    } else if (this.step === "rotated") {
      this.fixed = 0;
      this.step = "points";
    } else this.ed.finish();
  }
  preview(c: Vec): Entity[] {
    if (!this.p1) return [];
    if (!this.p2) return [this.ed.make<LineEntity>({ type: "line", a: this.p1, b: c })];
    return this.step === "points" ? [this.dim(c)] : [];
  }
}

export class DimAlignedCommand extends DimLinearCommand {
  name = "DIMALIGNED";
  protected aligned = true;
}

export class DimRadialCommand extends DimCommand {
  name = "DIMRADIUS";
  protected kind: "radius" | "diameter" = "radius";
  private target: { center: Vec; radius: number } | null = null;
  prompt(): Prompt {
    if (!this.target) return { text: "Select arc or circle", picking: true };
    return { text: "Specify dimension line location", base: this.target.center };
  }
  pick(e: Entity | null) {
    if (!e) return;
    if (e.type !== "circle" && e.type !== "arc") return this.ed.print("Select an arc or a circle.", "error");
    this.target = { center: e.center, radius: e.radius };
  }
  private dim(loc: Vec) {
    const { center, radius } = this.target!;
    const dir = unit(sub(loc, center));
    return this.makeDim(this.kind, { center, p1: { x: center.x + dir.x * radius, y: center.y + dir.y * radius }, loc });
  }
  point(p: Vec) {
    if (!this.target) return;
    this.place(this.dim(p));
    this.ed.finish();
  }
  preview(c: Vec): Entity[] {
    return this.target && dist(c, this.target.center) > 1e-9 ? [this.dim(c)] : [];
  }
}

export class DimDiameterCommand extends DimRadialCommand {
  name = "DIMDIAMETER";
  protected kind: "radius" | "diameter" = "diameter";
}

export class DimAngularCommand extends DimCommand {
  name = "DIMANGULAR";
  private first: { e: Entity; at: Vec } | null = null;
  private vertexMode = false;
  private picks: Vec[] = [];
  private def: { center: Vec; p1: Vec; p2: Vec } | null = null;
  prompt(): Prompt {
    if (this.def) return { text: "Specify dimension arc line location", base: this.def.center };
    if (this.vertexMode) return { text: ["Specify angle vertex", "Specify first angle endpoint", "Specify second angle endpoint"][this.picks.length], base: this.picks[0] ?? null };
    if (!this.first) return { text: "Select arc, circle, line", picking: true, enterLabel: "specify vertex" };
    return { text: "Select second line", picking: true };
  }
  pick(e: Entity | null, at: Vec) {
    if (!e) return;
    if (!this.first) {
      if (e.type === "arc") {
        this.def = { center: e.center, p1: { x: e.center.x + Math.cos(e.start) * e.radius, y: e.center.y + Math.sin(e.start) * e.radius }, p2: { x: e.center.x + Math.cos(e.end) * e.radius, y: e.center.y + Math.sin(e.end) * e.radius } };
        return;
      }
      if (e.type !== "line") return this.ed.print("Select an arc or a line.", "error");
      this.first = { e, at };
      return;
    }
    if (e.type !== "line" || e.id === this.first.e.id) return this.ed.print("Select a second line.", "error");
    const l1 = this.first.e as Extract<Entity, { type: "line" }>;
    const d1 = sub(l1.b, l1.a);
    const d2 = sub(e.b, e.a);
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) < 1e-12) return this.ed.print("The lines are parallel.", "error");
    const t = ((e.a.x - l1.a.x) * d2.y - (e.a.y - l1.a.y) * d2.x) / den;
    const center = { x: l1.a.x + d1.x * t, y: l1.a.y + d1.y * t };
    // Each side runs from the vertex towards where its line was picked.
    const side = (pick: Vec, d: Vec) => {
      const u = unit(d);
      const s = (pick.x - center.x) * u.x + (pick.y - center.y) * u.y >= 0 ? 1 : -1;
      return { x: center.x + u.x * s * Math.max(dist(center, pick), 1), y: center.y + u.y * s * Math.max(dist(center, pick), 1) };
    };
    this.def = { center, p1: side(this.first.at, d1), p2: side(at, d2) };
  }
  point(p: Vec) {
    if (this.vertexMode && !this.def) {
      this.picks.push(p);
      if (this.picks.length === 3) this.def = { center: this.picks[0], p1: this.picks[1], p2: this.picks[2] };
      return;
    }
    if (!this.def) return;
    this.place(this.makeDim("angular", { ...this.def, loc: p }));
    this.ed.finish();
  }
  enter() {
    if (!this.first && !this.def && !this.vertexMode) this.vertexMode = true;
    else this.ed.finish();
  }
  preview(c: Vec): Entity[] {
    return this.def && dist(c, this.def.center) > 1e-9 ? [this.makeDim("angular", { ...this.def, loc: c })] : [];
  }
}

/** DIMCONTINUE and DIMBASELINE: more dimensions from the last linear or aligned one. */
export class DimContinueCommand extends DimCommand {
  name = "DIMCONTINUE";
  protected baseline = false;
  private base: DimensionEntity | null = null;
  private made = 0;
  start() {
    super.start();
    const last = this.ed.doc.entities.get(String(this.ed.memory.lastDim ?? ""));
    if (last?.type === "dimension" && (last.kind === "linear" || last.kind === "aligned")) this.base = last;
    else this.ed.print("Select a linear or aligned dimension to continue from.", "info");
  }
  prompt(): Prompt {
    if (!this.base) return { text: this.baseline ? "Select base dimension" : "Select continued dimension", picking: true };
    return { text: "Specify a second extension line origin", keywords: this.made ? [UNDO] : [], base: this.baseline ? this.base.p1 : this.base.p2, enterLabel: "done" };
  }
  pick(e: Entity | null) {
    if (e?.type === "dimension" && (e.kind === "linear" || e.kind === "aligned")) this.base = e;
    else this.ed.print("Select a linear or aligned dimension.", "error");
  }
  private next(p: Vec): DimensionEntity {
    const b = this.base!;
    const angle = b.kind === "aligned" ? angleOf(b.p1, b.p2) : b.angle;
    if (!this.baseline) return this.makeDim("linear", { p1: b.p2, p2: p, loc: b.loc, angle, style: b.style });
    // Baseline: each new one a spacing further out, from the first origin.
    const st = dimStyle(b.style);
    const n = perp({ x: Math.cos(angle), y: Math.sin(angle) });
    const side = (b.loc.x - b.p1.x) * n.x + (b.loc.y - b.p1.y) * n.y >= 0 ? 1 : -1;
    return this.makeDim("linear", { p1: b.p1, p2: p, loc: { x: b.loc.x + n.x * side * st.baselineSpacing * st.scale, y: b.loc.y + n.y * side * st.baselineSpacing * st.scale }, angle, style: b.style });
  }
  point(p: Vec) {
    if (!this.base) return;
    const d = this.next(p);
    this.place(d);
    this.made++;
    this.base = d;
    if (this.baseline) this.base = { ...d, p1: d.p1 };
  }
  keyword(key: string) {
    if (key !== "U" || !this.made) return;
    this.ed.doc.undoLastChange();
    this.made--;
    const last = [...this.ed.doc.entities.values()].reverse().find((e): e is DimensionEntity => e.type === "dimension");
    if (last) this.base = last;
  }
  preview(c: Vec): Entity[] {
    return this.base ? [this.next(c)] : [];
  }
}

export class DimBaselineCommand extends DimContinueCommand {
  name = "DIMBASELINE";
  protected baseline = true;
}

/** DIM: AutoCAD's smart dimension. Over a line: aligned; over a circle: diameter; over an arc: radius; else linear from two points. */
export class DimCommandSmart extends DimCommand {
  name = "DIM";
  private p1: Vec | null = null;
  private p2: Vec | null = null;
  private radial: { kind: "radius" | "diameter"; center: Vec; radius: number } | null = null;
  prompt(): Prompt {
    if (this.radial) return { text: `Specify ${this.radial.kind} dimension location`, base: this.radial.center };
    if (!this.p1) return { text: "Select objects or specify first extension line origin", enterLabel: "done" };
    if (!this.p2) return { text: "Specify second extension line origin", base: this.p1 };
    return { text: "Specify dimension line location" };
  }
  private build(loc: Vec): DimensionEntity | null {
    if (this.radial) {
      const { center, radius, kind } = this.radial;
      const dir = unit(sub(loc, center));
      return this.makeDim(kind, { center, p1: { x: center.x + dir.x * radius, y: center.y + dir.y * radius }, loc });
    }
    if (!this.p1 || !this.p2) return null;
    return this.makeDim("linear", { p1: this.p1, p2: this.p2, loc, angle: autoAngle(this.p1, this.p2, loc) });
  }
  point(p: Vec) {
    if (this.radial || (this.p1 && this.p2)) {
      const d = this.build(p);
      if (d) this.place(d);
      this.p1 = this.p2 = null;
      this.radial = null;
      return;
    }
    if (!this.p1) {
      // Picked an object rather than a point?
      const e = this.ed.snap ? null : this.ed.pick(this.ed.cursor);
      if (e?.type === "line") [this.p1, this.p2] = [e.a, e.b];
      else if (e?.type === "circle" || e?.type === "arc") this.radial = { kind: e.type === "circle" ? "diameter" : "radius", center: e.center, radius: e.radius };
      else this.p1 = p;
      return;
    }
    this.p2 = p;
  }
  preview(c: Vec): Entity[] {
    if (this.p1 && !this.p2) return [this.ed.make<LineEntity>({ type: "line", a: this.p1, b: c })];
    const d = this.build(c);
    return d ? [d] : [];
  }
}

// --- multileaders -------------------------------------------------------------------------

export class MLeaderCommand extends Command {
  name = "MLEADER";
  private points: Vec[] = [];
  prompt(): Prompt {
    if (!this.points.length) return { text: "Specify leader arrowhead location" };
    return { text: "Specify leader landing location", base: this.points[this.points.length - 1] };
  }
  point(p: Vec) {
    this.points.push(p);
    if (this.points.length < 2) return;
    const st = dimStyle(this.ed.doc.currentDimStyle);
    const height = st.textHeight * st.scale;
    const points = this.points.slice();
    const end = points[points.length - 1];
    const right = end.x >= points[points.length - 2].x;
    const arrow = st.arrowSize * st.scale;
    this.ed.openTextEditor({
      at: { x: end.x + (right ? arrow * 2.5 : -arrow * 12), y: end.y + height / 2 },
      height,
      rotation: 0,
      width: 0,
      value: "",
      style: st.textStyle,
      multiline: true,
      done: (text) => {
        this.ed.doc.begin("MLEADER");
        this.ed.doc.add(this.ed.make<LeaderEntity>({ type: "leader", points, text: text ?? "", height, style: st.textStyle, dimStyle: this.ed.doc.currentDimStyle }));
        this.ed.finish();
      },
    });
  }
  preview(c: Vec): Entity[] {
    if (!this.points.length) return [];
    const st = dimStyle(this.ed.doc.currentDimStyle);
    return [this.ed.make<LeaderEntity>({ type: "leader", points: [...this.points, c], text: "", height: st.textHeight * st.scale, style: st.textStyle, dimStyle: this.ed.doc.currentDimStyle })];
  }
}

// --- hatches ---------------------------------------------------------------------------------

/** The hatch settings in use (also set from the Hatch Creation tab). */
export function hatchSettings(ed: Editor) {
  return {
    pattern: String(ed.memory.hatchPattern ?? "ANSI31"),
    scale: Number(ed.memory.hatchScale ?? ed.doc.annoScale),
    angle: Number(ed.memory.hatchAngle ?? 0),
  };
}

export class HatchCommand extends SelectingCommand {
  name = "HATCH";
  readonly clearsSelection = true;
  private step: "pick" | "pattern" | "scale" | "angle" = "pick";
  private id: string | null = null;
  start() {
    this.ed.doc.begin("HATCH");
    this.selecting = false; // picking internal points first, as AutoCAD
  }
  prompt(): Prompt {
    if (this.selecting) return { text: "Select objects", selecting: true };
    const s = hatchSettings(this.ed);
    if (this.step === "pattern") return { text: `Enter a pattern name (${Object.keys(HATCH_PATTERNS).join(", ")})`, enterLabel: s.pattern };
    if (this.step === "scale") return { text: "Specify a scale for the pattern", enterLabel: String(s.scale) };
    if (this.step === "angle") return { text: "Specify an angle for the pattern", enterLabel: String(s.angle) };
    return {
      text: "Pick internal point",
      keywords: [
        { key: "S", label: "Select objects" },
        { key: "P", label: "Pattern" },
        { key: "SC", label: "Scale" },
        { key: "A", label: "Angle" },
        ...(this.id ? [UNDO] : []),
      ],
      enterLabel: "done",
    };
  }
  /** Adds loops to the hatch being made (one hatch object for all the picks). Picked points
   * make it associative; loops from selected objects don't. */
  private addLoops(loops: Vec[][], seed: Vec | null) {
    const s = hatchSettings(this.ed);
    const existing = this.id ? (this.ed.doc.entities.get(this.id) as HatchEntity | undefined) : undefined;
    if (existing) {
      const seeds = seed && existing.seeds ? [...existing.seeds, seed] : undefined;
      this.ed.doc.update({ ...existing, loops: [...existing.loops, ...loops], seeds });
    } else {
      const e = this.ed.make<HatchEntity>({ type: "hatch", loops, pattern: s.pattern, scale: s.scale, angle: s.angle * DEG, ...(seed ? { seeds: [seed] } : {}) });
      this.id = e.id;
      this.ed.doc.add(e);
    }
  }
  point(p: Vec) {
    if (this.step !== "pick" || this.selecting) return;
    const view = { minX: this.ed.toWorld({ x: 0, y: this.ed.size.h }).x, minY: this.ed.toWorld({ x: 0, y: this.ed.size.h }).y, maxX: this.ed.toWorld({ x: this.ed.size.w, y: 0 }).x, maxY: this.ed.toWorld({ x: this.ed.size.w, y: 0 }).y };
    // AutoCAD looks for boundaries among what's on screen.
    const candidates = this.ed.doc.query(view).filter((e) => this.ed.doc.isVisible(e));
    const loops = findBoundary(candidates, p, this.ed.px(0.5));
    if (!loops) return this.ed.print("Valid hatch boundary not found.", "error");
    this.addLoops(loops, p);
  }
  keyword(key: string) {
    if (this.step !== "pick") return;
    if (key === "S") this.selecting = true;
    else if (key === "P") this.step = "pattern";
    else if (key === "SC") this.step = "scale";
    else if (key === "A") this.step = "angle";
    else if (key === "U" && this.id) {
      const e = this.ed.doc.entities.get(this.id) as HatchEntity | undefined;
      if (!e) return;
      this.ed.doc.undoLastChange();
      if (!this.ed.doc.entities.has(this.id)) this.id = null;
    }
  }
  value(text: string) {
    const t = text.trim();
    if (this.step === "pattern") {
      const name = t.toUpperCase();
      if (!HATCH_PATTERNS[name]) return this.ed.print(`Unknown pattern "${t}".`, "error"), true;
      this.ed.memory.hatchPattern = name;
    } else if (this.step === "scale") {
      const n = parseNumber(t);
      if (n === null || n <= 0) return false;
      this.ed.memory.hatchScale = n;
    } else if (this.step === "angle") {
      const n = parseNumber(t.replace(/[d°]$/i, ""));
      if (n === null) return false;
      this.ed.memory.hatchAngle = n;
    } else return false;
    this.step = "pick";
    this.restyle();
    return true;
  }
  /** Settings changed while hatching apply to the hatch being made. */
  restyle() {
    const e = this.id ? (this.ed.doc.entities.get(this.id) as HatchEntity | undefined) : undefined;
    if (!e) return;
    const s = hatchSettings(this.ed);
    this.ed.doc.update({ ...e, pattern: s.pattern, scale: s.scale, angle: s.angle * DEG });
  }
  enter() {
    if (this.selecting) {
      const loops = loopsFromObjects(this.targets());
      if (!loops.length) this.ed.print("Select closed objects (circles, closed polylines...).", "error");
      else this.addLoops(loops, null);
      this.selecting = false;
      this.ed.clearSelection();
      return;
    }
    if (this.step !== "pick") {
      this.step = "pick";
      return;
    }
    this.ed.finish();
  }
}

