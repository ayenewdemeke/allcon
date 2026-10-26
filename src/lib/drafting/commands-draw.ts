import { CLOSE, Command, parseNumber, UNDO, type Prompt } from "./command-base";
import { angleOf, arcThrough, circleThrough, dist, ellipseParamAt, len, mid, mul, perp, polar, sub, sweepOf, TAU, unit } from "./geometry";
import { formatLength, parseAngle, parseLength } from "./units";
import type { ArcEntity, CircleEntity, EllipseEntity, Entity, LineEntity, PolylineEntity, RayEntity, SplineEntity, Vec, XlineEntity } from "./types";

// The drawing commands, with AutoCAD's prompts and options.

export class LineCommand extends Command {
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

/** Commands that build up one object point by point (polylines, splines), updating it as they go. */
abstract class PointsCommand extends Command {
  protected points: Vec[] = [];
  protected id: string | null = null;
  protected abstract build(points: Vec[], closed: boolean): Entity | null;
  start() {
    this.ed.doc.begin(this.name);
  }
  protected save(closed = false) {
    const e = this.points.length >= 2 ? this.build(this.points.slice(), closed) : null;
    if (!e) {
      if (this.id) this.ed.doc.remove(this.id);
      this.id = null;
      return;
    }
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
}

export class PlineCommand extends PointsCommand {
  name = "PLINE";
  prompt(): Prompt {
    const last = this.points.at(-1);
    if (!last) return { text: "Specify start point" };
    return { text: "Specify next point", keywords: this.points.length >= 3 ? [CLOSE, UNDO] : [UNDO], base: last };
  }
  protected build(points: Vec[], closed: boolean) {
    return this.ed.make<PolylineEntity>({ type: "polyline", points, bulges: points.map(() => 0), closed });
  }
  preview(c: Vec): Entity[] {
    const last = this.points.at(-1);
    return last ? [this.ed.make<LineEntity>({ type: "line", a: last, b: c })] : [];
  }
}

export class SplineCommand extends PointsCommand {
  name = "SPLINE";
  prompt(): Prompt {
    const last = this.points.at(-1);
    if (!last) return { text: "Specify first point" };
    return { text: "Enter next point", keywords: this.points.length >= 3 ? [CLOSE, UNDO] : [UNDO], base: last };
  }
  protected build(fit: Vec[], closed: boolean) {
    return this.ed.make<SplineEntity>({ type: "spline", fit, closed });
  }
  preview(c: Vec): Entity[] {
    if (!this.points.length) return [];
    return [this.ed.make<SplineEntity>({ type: "spline", fit: [...this.points, c], closed: false })];
  }
}

export class CircleCommand extends Command {
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

export class ArcCommand extends Command {
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
    if (this.picks.length === 1) return [this.ed.make<LineEntity>({ type: "line", a: this.picks[0], b: c })];
    return [];
  }
}

export class RectangCommand extends Command {
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
    this.ed.doc.begin("RECTANG");
    this.ed.doc.add(this.ed.make<PolylineEntity>({ type: "polyline", points: this.corners(a, b), bulges: [0, 0, 0, 0], closed: true }));
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

export class EllipseCommand extends Command {
  name = "ELLIPSE";
  private arc = false;
  private mode: "axis" | "center" = "axis";
  private picks: Vec[] = [];
  private shape: Omit<EllipseEntity, "id" | "layer" | "color" | "lineweight" | "linetype" | "type" | "start" | "end"> | null = null;
  private startParam: number | null = null;
  prompt(): Prompt {
    if (this.shape) {
      if (this.startParam === null) return { text: "Specify start angle", base: this.shape.center };
      return { text: "Specify end angle", base: this.shape.center };
    }
    if (this.mode === "axis") {
      if (!this.picks.length) return { text: this.arc ? "Specify axis endpoint of elliptical arc" : "Specify axis endpoint of ellipse", keywords: this.arc ? [{ key: "C", label: "Center" }] : [{ key: "A", label: "Arc" }, { key: "C", label: "Center" }] };
      if (this.picks.length === 1) return { text: "Specify other endpoint of axis", base: this.picks[0] };
      return { text: "Specify distance to other axis", base: mid(this.picks[0], this.picks[1]) };
    }
    if (!this.picks.length) return { text: "Specify center of ellipse" };
    if (this.picks.length === 1) return { text: "Specify endpoint of axis", base: this.picks[0] };
    return { text: "Specify distance to other axis", base: this.picks[0] };
  }
  /** The ellipse from its axis and the other half-axis length (the longer one is the major). */
  private ellipseFrom(other: number) {
    const [center, axisEnd] = this.mode === "axis" ? [mid(this.picks[0], this.picks[1]), this.picks[1]] : [this.picks[0], this.picks[1]];
    const major = sub(axisEnd, center);
    const a = len(major);
    if (a < 1e-9 || other < 1e-9) return null;
    if (other <= a) return { center, major, ratio: other / a };
    return { center, major: mul(unit(perp(major)), other), ratio: a / other };
  }
  private add(start: number, end: number) {
    this.ed.doc.begin("ELLIPSE");
    this.ed.doc.add(this.ed.make<EllipseEntity>({ type: "ellipse", ...this.shape!, start, end }));
    this.ed.finish();
  }
  private otherAxis(d: number) {
    const shape = this.ellipseFrom(d);
    if (!shape) return;
    if (!this.arc) {
      this.shape = shape;
      return this.add(0, TAU);
    }
    this.shape = shape;
  }
  private paramFor(p: Vec) {
    const s = this.shape!;
    return ellipseParamAt(s, angleOf(s.center, p) - Math.atan2(s.major.y, s.major.x));
  }
  point(p: Vec) {
    if (this.shape) {
      const t = this.paramFor(p);
      if (this.startParam === null) this.startParam = t;
      else this.add(this.startParam, t);
      return;
    }
    if (this.picks.length < 2) return void this.picks.push(p);
    const center = this.mode === "axis" ? mid(this.picks[0], this.picks[1]) : this.picks[0];
    this.otherAxis(dist(center, p));
  }
  keyword(key: string) {
    if (this.picks.length || this.shape) return;
    if (key === "A") this.arc = true;
    if (key === "C") this.mode = "center";
  }
  value(text: string) {
    if (this.shape) {
      const a = parseAngle(text);
      if (a === null) return false;
      const t = ellipseParamAt(this.shape, a);
      if (this.startParam === null) this.startParam = t;
      else this.add(this.startParam, t);
      return true;
    }
    if (this.picks.length !== 2) return false;
    const d = parseLength(text, this.ed.doc.units);
    if (d === null || d <= 0) return false;
    this.otherAxis(d);
    return true;
  }
  preview(c: Vec): Entity[] {
    if (this.shape) {
      const t = this.paramFor(c);
      const [start, end] = this.startParam === null ? [0, TAU] : [this.startParam, t];
      return [this.ed.make<EllipseEntity>({ type: "ellipse", ...this.shape, start, end })];
    }
    if (this.picks.length === 1) return [this.ed.make<LineEntity>({ type: "line", a: this.picks[0], b: c })];
    if (this.picks.length === 2) {
      const center = this.mode === "axis" ? mid(this.picks[0], this.picks[1]) : this.picks[0];
      const shape = this.ellipseFrom(dist(center, c));
      return shape ? [this.ed.make<EllipseEntity>({ type: "ellipse", ...shape, start: 0, end: TAU })] : [];
    }
    return [];
  }
}

export class PolygonCommand extends Command {
  name = "POLYGON";
  private step: "sides" | "center" | "option" | "radius" | "edge1" | "edge2" = "sides";
  private center: Vec | null = null;
  private edgeStart: Vec | null = null;
  private inscribed = true;
  private get sides() {
    return Number(this.ed.memory.polygonSides ?? 4);
  }
  start() {
    this.inscribed = this.ed.memory.polygonInscribed !== false;
  }
  prompt(): Prompt {
    switch (this.step) {
      case "sides":
        return { text: "Enter number of sides", enterLabel: String(this.sides) };
      case "center":
        return { text: "Specify center of polygon", keywords: [{ key: "E", label: "Edge" }] };
      case "option":
        return { text: "Enter an option", keywords: [{ key: "I", label: "Inscribed in circle" }, { key: "C", label: "Circumscribed about circle" }], enterLabel: this.inscribed ? "I" : "C" };
      case "radius":
        return { text: "Specify radius of circle", base: this.center };
      case "edge1":
        return { text: "Specify first endpoint of edge" };
      case "edge2":
        return { text: "Specify second endpoint of edge", base: this.edgeStart };
    }
  }
  private vertices(center: Vec, toward: Vec): Vec[] {
    const n = this.sides;
    const r = dist(center, toward);
    // Inscribed: the point is a vertex. Circumscribed: it's the middle of an edge.
    const vertexR = this.inscribed ? r : r / Math.cos(Math.PI / n);
    const first = angleOf(center, toward) + (this.inscribed ? 0 : Math.PI / n);
    return Array.from({ length: n }, (_, i) => polar(center, first + (TAU * i) / n, vertexR));
  }
  private fromEdge(a: Vec, b: Vec): Vec[] {
    const n = this.sides;
    const pts = [a, b];
    let dir = angleOf(a, b);
    for (let i = 2; i < n; i++) {
      dir += TAU / n;
      pts.push(polar(pts[i - 1], dir, dist(a, b)));
    }
    return pts;
  }
  private add(points: Vec[]) {
    this.ed.doc.begin("POLYGON");
    this.ed.doc.add(this.ed.make<PolylineEntity>({ type: "polyline", points, bulges: points.map(() => 0), closed: true }));
    this.ed.finish();
  }
  point(p: Vec) {
    if (this.step === "sides") return;
    if (this.step === "center") {
      this.center = p;
      this.step = "option";
    } else if (this.step === "radius") this.add(this.vertices(this.center!, p));
    else if (this.step === "edge1") {
      this.edgeStart = p;
      this.step = "edge2";
    } else if (this.step === "edge2") this.add(this.fromEdge(this.edgeStart!, p));
  }
  keyword(key: string) {
    if (this.step === "center" && key === "E") this.step = "edge1";
    else if (this.step === "option" && (key === "I" || key === "C")) {
      this.inscribed = key === "I";
      this.ed.memory.polygonInscribed = this.inscribed;
      this.step = "radius";
    }
  }
  value(text: string) {
    if (this.step === "sides") {
      const n = parseNumber(text);
      if (n === null || !Number.isInteger(n) || n < 3 || n > 1024) {
        this.ed.print("Requires an integer between 3 and 1024.", "error");
        return true;
      }
      this.ed.memory.polygonSides = n;
      this.step = "center";
      return true;
    }
    if (this.step === "radius") {
      const r = parseLength(text, this.ed.doc.units);
      if (r === null || r <= 0) return false;
      // A typed radius puts an edge (or vertex) straight down, as AutoCAD does.
      this.add(this.vertices(this.center!, polar(this.center!, -Math.PI / 2 + (this.inscribed ? Math.PI / this.sides : 0), r)));
      return true;
    }
    return false;
  }
  enter() {
    if (this.step === "sides") this.step = "center";
    else if (this.step === "option") this.step = "radius";
    else this.ed.finish();
  }
  preview(c: Vec): Entity[] {
    const pts = this.step === "radius" ? this.vertices(this.center!, c) : this.step === "edge2" ? this.fromEdge(this.edgeStart!, c) : null;
    return pts ? [this.ed.make<PolylineEntity>({ type: "polyline", points: pts, bulges: pts.map(() => 0), closed: true })] : [];
  }
}

export class XlineCommand extends Command {
  name = "XLINE";
  private root: Vec | null = null;
  private fixed: Vec | null = null; // Hor / Ver: the direction, with points placing each line
  start() {
    this.ed.doc.begin("XLINE");
  }
  prompt(): Prompt {
    if (this.fixed) return { text: "Specify through point" };
    if (!this.root) return { text: "Specify a point", keywords: [{ key: "H", label: "Hor" }, { key: "V", label: "Ver" }] };
    return { text: "Specify through point", base: this.root };
  }
  point(p: Vec) {
    if (this.fixed) return this.ed.doc.add(this.ed.make<XlineEntity>({ type: "xline", base: p, dir: this.fixed }));
    if (!this.root) return void (this.root = p);
    if (dist(this.root, p) < 1e-9) return;
    this.ed.doc.add(this.ed.make<XlineEntity>({ type: "xline", base: this.root, dir: unit(sub(p, this.root)) }));
  }
  keyword(key: string) {
    if (this.root) return;
    if (key === "H") this.fixed = { x: 1, y: 0 };
    if (key === "V") this.fixed = { x: 0, y: 1 };
  }
  preview(c: Vec): Entity[] {
    if (this.fixed) return [this.ed.make<XlineEntity>({ type: "xline", base: c, dir: this.fixed })];
    if (!this.root || dist(this.root, c) < 1e-9) return [];
    return [this.ed.make<XlineEntity>({ type: "xline", base: this.root, dir: unit(sub(c, this.root)) })];
  }
}

export class RayCommand extends Command {
  name = "RAY";
  private base: Vec | null = null;
  start() {
    this.ed.doc.begin("RAY");
  }
  prompt(): Prompt {
    return this.base ? { text: "Specify through point", base: this.base } : { text: "Specify start point" };
  }
  point(p: Vec) {
    if (!this.base) return void (this.base = p);
    if (dist(this.base, p) < 1e-9) return;
    this.ed.doc.add(this.ed.make<RayEntity>({ type: "ray", base: this.base, dir: unit(sub(p, this.base)) }));
  }
  preview(c: Vec): Entity[] {
    if (!this.base || dist(this.base, c) < 1e-9) return [];
    return [this.ed.make<RayEntity>({ type: "ray", base: this.base, dir: unit(sub(c, this.base)) })];
  }
}

