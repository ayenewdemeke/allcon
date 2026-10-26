import type { ArcEntity, EllipseEntity, Entity, HAlign, ImageEntity, InsertEntity, VAlign, Vec } from "./types";

// Plane geometry for drafting: entities as segments and arcs, their extents, distances,
// intersections, and the grips that edit them.

export const TAU = Math.PI * 2;
const EPS = 1e-9;

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const angleOf = (from: Vec, to: Vec) => Math.atan2(to.y - from.y, to.x - from.x);
export const polar = (p: Vec, angle: number, d: number): Vec => ({ x: p.x + d * Math.cos(angle), y: p.y + d * Math.sin(angle) });
export const same = (a: Vec, b: Vec, tolerance = 1e-7) => dist(a, b) <= tolerance;
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });
export const unit = (a: Vec): Vec => {
  const l = len(a);
  return l < EPS ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
};

/** How far construction lines and rays reach when drawn and measured (they're infinite). */
export const FAR = 1e7;

// --- what objects look like ---------------------------------------------------------------

/** A run of text to draw: `height` is the capitals' height. */
export type TextRun = { at: Vec; text: string; height: number; rotation: number; font: string; widthFactor: number; halign: HAlign; valign: VAlign };
/** An object's drawing: lines, filled polygons, and text. */
export type Graphics = { lines: Vec[][]; fills: Vec[][]; texts: TextRun[] };

const ANNOTATION_TYPES = new Set(["text", "mtext", "dimension", "leader", "hatch", "attdef"]);
export const isAnnotation = (e: Entity) => ANNOTATION_TYPES.has(e.type);

// Annotations' drawing depends on styles: graphics.ts provides it (see there).
let annotate: (e: Entity) => Graphics = () => ({ lines: [], fills: [], texts: [] });
let boxOf: (run: TextRun) => Vec[] = () => [];
export function setAnnotationGraphics(fn: typeof annotate, box: typeof boxOf) {
  annotate = fn;
  boxOf = box;
}

// Block references are drawn as their block's objects in place: blocks.ts provides them.
let partsOf: (e: InsertEntity) => Entity[] = () => [];
export function setBlockParts(fn: typeof partsOf) {
  partsOf = fn;
}

export function graphicsOf(e: Entity): Graphics {
  if (e.type === "insert") {
    const g: Graphics = { lines: [], fills: [], texts: [] };
    for (const part of partsOf(e)) {
      const pg = graphicsOf(part);
      g.lines.push(...pg.lines);
      g.fills.push(...pg.fills);
      g.texts.push(...pg.texts);
    }
    return g;
  }
  return isAnnotation(e) ? annotate(e) : { lines: tessellate(e), fills: [], texts: [] };
}

/** An image's corners, counter-clockwise from its lower left. */
export function imageCorners(e: Pick<ImageEntity, "at" | "width" | "height" | "rotation">): Vec[] {
  const u = polar({ x: 0, y: 0 }, e.rotation, e.width);
  const v = polar({ x: 0, y: 0 }, e.rotation + Math.PI / 2, e.height);
  return [e.at, add(e.at, u), add(add(e.at, u), v), add(e.at, v)];
}

/** The boxes around an object's text (text, mtext, a dimension's or a leader's). */
export function textBoxes(e: Entity): Vec[][] {
  return isAnnotation(e) ? annotate(e).texts.map(boxOf).filter((b) => b.length >= 3) : [];
}

/** An annotation's outline: its lines, the boxes of its text, and the edges of its fills. */
function annotationOutline(e: Entity): Vec[][] {
  const g = annotate(e);
  const out = g.lines.slice();
  for (const run of g.texts) {
    const box = boxOf(run);
    if (box.length) out.push([...box, box[0]]);
  }
  if (e.type === "hatch") {
    for (const loop of e.loops) if (loop.length) out.push([...loop, loop[0]]);
  } else {
    for (const f of g.fills) out.push([...f, f[0]]);
  }
  return out;
}

function insidePolygon(p: Vec, poly: Vec[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function normalizeAngle(a: number) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** How far an arc turns counter-clockwise from start to end, in (0, 2π]. */
export function sweepOf(start: number, end: number) {
  const s = normalizeAngle(end - start);
  return s < EPS ? TAU : s;
}

export function angleInSweep(angle: number, start: number, end: number) {
  return normalizeAngle(angle - start) <= sweepOf(start, end) + EPS;
}

// --- primitives -------------------------------------------------------------------------

export type Segment = { kind: "seg"; a: Vec; b: Vec };
export type ArcPrimitive = { kind: "arc"; c: Vec; r: number; start: number; end: number; full: boolean };
export type Primitive = Segment | ArcPrimitive;

/** A polyline's arc segment from `a` to `b` (DXF's bulge: the tangent of a quarter of the
 * included angle, positive counter-clockwise). */
export function bulgeArc(a: Vec, b: Vec, bulge: number) {
  const chord = dist(a, b);
  const sweep = 4 * Math.atan(bulge);
  const r = chord / (2 * Math.abs(Math.sin(sweep / 2)));
  const center = add(mid(a, b), mul(perp(unit(sub(b, a))), ((chord / 2) * (1 - bulge * bulge)) / (2 * bulge)));
  return { center, r, start: angleOf(center, a), sweep };
}

const hasBulges = (e: { bulges: number[] }) => e.bulges.some((b) => Math.abs(b) > 1e-9);

/** A polyline's segments and arcs. */
function polylinePrimitives(points: Vec[], bulges: number[], closed: boolean): Primitive[] {
  return polylineSegments(points, closed).map((s, i): Primitive => {
    const b = bulges[i] ?? 0;
    if (Math.abs(b) <= 1e-9 || same(s.a, s.b)) return s;
    const arc = bulgeArc(s.a, s.b, b);
    const [start, end] = b > 0 ? [arc.start, arc.start + arc.sweep] : [arc.start + arc.sweep, arc.start];
    return { kind: "arc", c: arc.center, r: arc.r, start: normalizeAngle(start), end: normalizeAngle(end), full: false };
  });
}

/** A polyline as points, its arc segments drawn smooth. */
function polylinePoints(points: Vec[], bulges: number[], closed: boolean): Vec[] {
  const ring = closed && points.length > 2 ? [...points, points[0]] : points;
  if (!bulges.some((b) => Math.abs(b) > 1e-9)) return ring;
  const out: Vec[] = [ring[0]];
  for (let i = 0; i + 1 < ring.length; i++) {
    const b = bulges[i] ?? 0;
    if (Math.abs(b) > 1e-9 && !same(ring[i], ring[i + 1])) {
      const arc = bulgeArc(ring[i], ring[i + 1], b);
      const n = Math.max(4, Math.ceil((128 * Math.abs(arc.sweep)) / TAU));
      for (let k = 1; k < n; k++) out.push(polar(arc.center, arc.start + (arc.sweep * k) / n, arc.r));
    }
    out.push(ring[i + 1]);
  }
  return out;
}

export function polylineSegments(points: Vec[], closed: boolean): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) segs.push({ kind: "seg", a: points[i], b: points[i + 1] });
  if (closed && points.length > 2) segs.push({ kind: "seg", a: points[points.length - 1], b: points[0] });
  return segs;
}

export function primitives(e: Entity): Primitive[] {
  switch (e.type) {
    case "line":
      return [{ kind: "seg", a: e.a, b: e.b }];
    case "polyline":
      return polylinePrimitives(e.points, e.bulges, e.closed);
    case "circle":
      return [{ kind: "arc", c: e.center, r: e.radius, start: 0, end: TAU, full: true }];
    case "arc":
      return [{ kind: "arc", c: e.center, r: e.radius, start: e.start, end: e.end, full: false }];
    case "ellipse":
    case "spline":
      // Curves without exact intersection maths: their drawn segments stand in.
      return tessellate(e).flatMap((line) => polylineSegments(line, false));
    case "xline":
      return [{ kind: "seg", a: add(e.base, mul(e.dir, -FAR)), b: add(e.base, mul(e.dir, FAR)) }];
    case "ray":
      return [{ kind: "seg", a: e.base, b: add(e.base, mul(e.dir, FAR)) }];
    case "insert":
      return partsOf(e).flatMap(primitives);
    case "image":
      return polylineSegments(imageCorners(e), true);
    default:
      return []; // annotations aren't snapped to, cut or extended
  }
}

// --- ellipses and splines ------------------------------------------------------------------

export const ellipseMinor = (e: Pick<EllipseEntity, "major" | "ratio">) => mul(perp(e.major), e.ratio);
export const isFullEllipse = (e: Pick<EllipseEntity, "start" | "end">) => sweepOf(e.start, e.end) >= TAU - 1e-9;

export function ellipsePoint(e: Pick<EllipseEntity, "center" | "major" | "ratio">, t: number): Vec {
  const minor = ellipseMinor(e);
  return { x: e.center.x + e.major.x * Math.cos(t) + minor.x * Math.sin(t), y: e.center.y + e.major.y * Math.cos(t) + minor.y * Math.sin(t) };
}

/** The ellipse parameter for a direction from the centre (an angle measured from the major axis). */
export function ellipseParamAt(e: Pick<EllipseEntity, "major" | "ratio">, angleFromMajor: number) {
  return Math.atan2(Math.sin(angleFromMajor) / e.ratio, Math.cos(angleFromMajor));
}

/** A smooth curve through fit points (centripetal Catmull-Rom). */
export function splinePoints(fit: Vec[], closed: boolean, perSegment = 16): Vec[] {
  if (fit.length < 2) return fit.slice();
  if (fit.length === 2 && !closed) return fit.slice();
  const pts = closed ? [fit[fit.length - 1], ...fit, fit[0], fit[1]] : [add(fit[0], sub(fit[0], fit[1])), ...fit, add(fit[fit.length - 1], sub(fit[fit.length - 1], fit[fit.length - 2]))];
  const out: Vec[] = [];
  const count = closed ? fit.length : fit.length - 1;
  for (let i = 0; i < count; i++) {
    const [p0, p1, p2, p3] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const t1 = Math.sqrt(Math.max(dist(p0, p1), EPS));
    const t2 = t1 + Math.sqrt(Math.max(dist(p1, p2), EPS));
    const t3 = t2 + Math.sqrt(Math.max(dist(p2, p3), EPS));
    for (let k = 0; k < perSegment; k++) {
      const t = t1 + ((t2 - t1) * k) / perSegment;
      const lerp = (a: Vec, b: Vec, ta: number, tb: number) => add(mul(a, (tb - t) / (tb - ta)), mul(b, (t - ta) / (tb - ta)));
      const a1 = lerp(p0, p1, 0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, 0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  out.push(closed ? fit[0] : fit[fit.length - 1]);
  return out;
}

export const arcStart = (e: { center: Vec; radius: number; start: number }) => polar(e.center, e.start, e.radius);
export const arcEnd = (e: { center: Vec; radius: number; end: number }) => polar(e.center, e.end, e.radius);
export const arcMid = (e: ArcEntity) => polar(e.center, e.start + sweepOf(e.start, e.end) / 2, e.radius);

/** Points along an arc for drawing: enough segments to look smooth at any zoom. */
export function arcPoints(c: Vec, r: number, start: number, sweep: number, segmentsPerTurn = 128): Vec[] {
  const n = Math.max(4, Math.ceil((segmentsPerTurn * sweep) / TAU));
  return Array.from({ length: n + 1 }, (_, i) => polar(c, start + (sweep * i) / n, r));
}

/** An entity as polylines of points, for drawing and for testing against windows. */
export function tessellate(e: Entity): Vec[][] {
  switch (e.type) {
    case "line":
      return [[e.a, e.b]];
    case "polyline":
      return [polylinePoints(e.points, e.bulges, e.closed)];
    case "circle":
      return [arcPoints(e.center, e.radius, 0, TAU)];
    case "arc":
      return [arcPoints(e.center, e.radius, e.start, sweepOf(e.start, e.end))];
    case "ellipse": {
      const sweep = sweepOf(e.start, e.end);
      const n = Math.max(8, Math.ceil((128 * sweep) / TAU));
      return [Array.from({ length: n + 1 }, (_, i) => ellipsePoint(e, e.start + (sweep * i) / n))];
    }
    case "spline":
      return [splinePoints(e.fit, e.closed)];
    case "xline":
    case "ray":
      return primitives(e).map((p) => [(p as Segment).a, (p as Segment).b]);
    case "insert":
      return partsOf(e).flatMap(tessellate);
    case "image": {
      const c = imageCorners(e);
      return [[...c, c[0]]];
    }
    default:
      return annotationOutline(e);
  }
}

// --- extents ------------------------------------------------------------------------------

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

export const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

export function extendBox(box: Box, p: Vec) {
  box.minX = Math.min(box.minX, p.x);
  box.minY = Math.min(box.minY, p.y);
  box.maxX = Math.max(box.maxX, p.x);
  box.maxY = Math.max(box.maxY, p.y);
  return box;
}

export function bounds(e: Entity): Box {
  const box = emptyBox();
  switch (e.type) {
    case "line":
      extendBox(box, e.a);
      extendBox(box, e.b);
      break;
    case "polyline":
      if (hasBulges(e)) tessellate(e)[0].forEach((p) => extendBox(box, p));
      else e.points.forEach((p) => extendBox(box, p));
      break;
    case "circle":
      extendBox(box, { x: e.center.x - e.radius, y: e.center.y - e.radius });
      extendBox(box, { x: e.center.x + e.radius, y: e.center.y + e.radius });
      break;
    case "arc":
      extendBox(box, arcStart(e));
      extendBox(box, arcEnd(e));
      for (let q = 0; q < 4; q++) {
        const a = (q * Math.PI) / 2;
        if (angleInSweep(a, e.start, e.end)) extendBox(box, polar(e.center, a, e.radius));
      }
      break;
    default:
      for (const line of tessellate(e)) line.forEach((p) => extendBox(box, p));
      break;
  }
  return box;
}

// --- distances ----------------------------------------------------------------------------

export function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return add(a, mul(ab, t));
}

export function closestOnPrimitive(p: Vec, prim: Primitive): Vec {
  if (prim.kind === "seg") return closestOnSegment(p, prim.a, prim.b);
  const a = angleOf(prim.c, p);
  if (prim.full || angleInSweep(a, prim.start, prim.end)) return polar(prim.c, a, prim.r);
  const s = polar(prim.c, prim.start, prim.r);
  const e = polar(prim.c, prim.end, prim.r);
  return dist(p, s) < dist(p, e) ? s : e;
}

export function distanceTo(e: Entity, p: Vec): number {
  if (e.type === "insert") return Math.min(Infinity, ...partsOf(e).map((part) => distanceTo(part, p)));
  if (isAnnotation(e)) {
    // Inside a text box or a hatched area counts as on it.
    const g = annotate(e);
    if (g.texts.some((run) => insidePolygon(p, boxOf(run)))) return 0;
    if (e.type === "hatch" && e.loops.filter((loop) => insidePolygon(p, loop)).length % 2 === 1) return 0;
    let best = Infinity;
    for (const line of annotationOutline(e)) for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, dist(p, closestOnSegment(p, line[i], line[i + 1])));
    return best;
  }
  let best = Infinity;
  for (const prim of primitives(e)) best = Math.min(best, dist(p, closestOnPrimitive(p, prim)));
  return best;
}

// --- intersections ------------------------------------------------------------------------

function segSeg(s: Segment, t: Segment): Vec[] {
  const r = sub(s.b, s.a);
  const q = sub(t.b, t.a);
  const d = cross(r, q);
  if (Math.abs(d) < EPS) return [];
  const u = cross(sub(t.a, s.a), q) / d;
  const v = cross(sub(t.a, s.a), r) / d;
  return u >= -EPS && u <= 1 + EPS && v >= -EPS && v <= 1 + EPS ? [add(s.a, mul(r, u))] : [];
}

function onArc(p: Vec, arc: ArcPrimitive) {
  return arc.full || angleInSweep(angleOf(arc.c, p), arc.start, arc.end);
}

function segArc(s: Segment, arc: ArcPrimitive): Vec[] {
  const d = sub(s.b, s.a);
  const f = sub(s.a, arc.c);
  const a = dot(d, d);
  const b = 2 * dot(f, d);
  const c = dot(f, f) - arc.r * arc.r;
  const disc = b * b - 4 * a * c;
  if (a < EPS || disc < -EPS) return [];
  const root = Math.sqrt(Math.max(0, disc));
  const ts = disc < EPS ? [-b / (2 * a)] : [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  return ts.filter((t) => t >= -EPS && t <= 1 + EPS).map((t) => add(s.a, mul(d, t))).filter((p) => onArc(p, arc));
}

function arcArc(p: ArcPrimitive, q: ArcPrimitive): Vec[] {
  const d = dist(p.c, q.c);
  if (d < EPS || d > p.r + q.r + EPS || d < Math.abs(p.r - q.r) - EPS) return [];
  const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
  const m = add(p.c, mul(sub(q.c, p.c), a / d));
  const off = { x: (-(q.c.y - p.c.y) * h) / d, y: ((q.c.x - p.c.x) * h) / d };
  const points = h < EPS ? [m] : [add(m, off), sub(m, off)];
  return points.filter((pt) => onArc(pt, p) && onArc(pt, q));
}

export function intersect(p: Primitive, q: Primitive): Vec[] {
  if (p.kind === "seg" && q.kind === "seg") return segSeg(p, q);
  if (p.kind === "seg" && q.kind === "arc") return segArc(p, q);
  if (p.kind === "arc" && q.kind === "seg") return segArc(q, p);
  return arcArc(p as ArcPrimitive, q as ArcPrimitive);
}

// --- windows ------------------------------------------------------------------------------

const inBox = (p: Vec, b: Box) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** Wholly inside a selection window. */
export function insideBox(e: Entity, box: Box) {
  const b = bounds(e);
  return b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY;
}

/** Inside or crossing a selection window. */
export function crossesBox(e: Entity, box: Box) {
  const b = bounds(e);
  if (b.maxX < box.minX || b.minX > box.maxX || b.maxY < box.minY || b.minY > box.maxY) return false;
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  const edges = polylineSegments(corners, true);
  for (const line of tessellate(e)) {
    for (let i = 0; i < line.length; i++) {
      if (inBox(line[i], box)) return true;
      if (i + 1 < line.length && edges.some((edge) => segSeg({ kind: "seg", a: line[i], b: line[i + 1] }, edge).length)) return true;
    }
  }
  return false;
}

// --- construction -------------------------------------------------------------------------

/** The circle through three points, or null when they're in a line. */
export function circleThrough(a: Vec, b: Vec, c: Vec): { center: Vec; radius: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < EPS) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const center = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
  return { center, radius: dist(center, a) };
}

/** The arc from `a` through `b` to `c`, as a counter-clockwise arc. */
export function arcThrough(a: Vec, b: Vec, c: Vec): { center: Vec; radius: number; start: number; end: number } | null {
  const circle = circleThrough(a, b, c);
  if (!circle) return null;
  const counterClockwise = cross(sub(b, a), sub(c, b)) > 0;
  const sa = angleOf(circle.center, a);
  const ea = angleOf(circle.center, c);
  return counterClockwise ? { ...circle, start: sa, end: ea } : { ...circle, start: ea, end: sa };
}

// --- moving ------------------------------------------------------------------------------

export function translate<T extends Entity>(e: T, d: Vec): T {
  switch (e.type) {
    case "line":
      return { ...e, a: add(e.a, d), b: add(e.b, d) };
    case "polyline":
      return { ...e, points: e.points.map((p) => add(p, d)) };
    case "circle":
    case "arc":
    case "ellipse":
      return { ...e, center: add(e.center, d) };
    case "spline":
      return { ...e, fit: e.fit.map((p) => add(p, d)) };
    case "xline":
    case "ray":
      return { ...e, base: add(e.base, d) };
    case "text":
    case "mtext":
      return { ...e, at: add(e.at, d) };
    case "dimension":
      return { ...e, p1: add(e.p1, d), p2: add(e.p2, d), loc: add(e.loc, d), center: add(e.center, d) };
    case "leader":
      return { ...e, points: e.points.map((p) => add(p, d)) };
    case "hatch":
      return { ...e, loops: e.loops.map((loop) => loop.map((p) => add(p, d))), ...(e.seeds ? { seeds: e.seeds.map((p) => add(p, d)) } : {}) };
    case "insert":
    case "attdef":
    case "image":
      return { ...e, at: add(e.at, d) };
  }
}

// --- transforms ---------------------------------------------------------------------------

/** A similarity transform (rotation, uniform scale, mirror, move): p → M·p + t. */
export type Xform = { a: number; b: number; c: number; d: number; tx: number; ty: number };

export const applyXf = (x: Xform, p: Vec): Vec => ({ x: x.a * p.x + x.b * p.y + x.tx, y: x.c * p.x + x.d * p.y + x.ty });
const applyLinear = (x: Xform, v: Vec): Vec => ({ x: x.a * v.x + x.b * v.y, y: x.c * v.x + x.d * v.y });
const scaleOf = (x: Xform) => Math.sqrt(Math.abs(x.a * x.d - x.b * x.c));
const mirrors = (x: Xform) => x.a * x.d - x.b * x.c < 0;

/** Rotation by `angle` (counter-clockwise) about `base`. */
export function rotation(base: Vec, angle: number): Xform {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { a: c, b: -s, c: s, d: c, tx: base.x - c * base.x + s * base.y, ty: base.y - s * base.x - c * base.y };
}

export function scaling(base: Vec, k: number): Xform {
  return { a: k, b: 0, c: 0, d: k, tx: base.x * (1 - k), ty: base.y * (1 - k) };
}

/** Reflection across the line through `p` and `q`. */
export function reflection(p: Vec, q: Vec): Xform {
  const u = unit(sub(q, p));
  const a = u.x * u.x - u.y * u.y;
  const b = 2 * u.x * u.y;
  return { a, b, c: b, d: -a, tx: p.x - a * p.x - b * p.y, ty: p.y - b * p.x + a * p.y };
}

export function transform<T extends Entity>(e: T, x: Xform): T {
  const k = scaleOf(x);
  const flip = mirrors(x);
  const mapAngle = (angle: number) => {
    const v = applyLinear(x, { x: Math.cos(angle), y: Math.sin(angle) });
    return Math.atan2(v.y, v.x);
  };
  switch (e.type) {
    case "line":
      return { ...e, a: applyXf(x, e.a), b: applyXf(x, e.b) };
    case "polyline":
      return { ...e, points: e.points.map((p) => applyXf(x, p)), bulges: flip ? e.bulges.map((b) => -b) : e.bulges };
    case "circle":
      return { ...e, center: applyXf(x, e.center), radius: e.radius * k };
    case "arc": {
      const start = mapAngle(e.start);
      const end = mapAngle(e.end);
      return { ...e, center: applyXf(x, e.center), radius: e.radius * k, start: flip ? end : start, end: flip ? start : end };
    }
    case "ellipse": {
      const full = isFullEllipse(e);
      return {
        ...e,
        center: applyXf(x, e.center),
        major: applyLinear(x, e.major),
        start: full ? 0 : flip ? -e.end : e.start,
        end: full ? TAU : flip ? -e.start : e.end,
      };
    }
    case "spline":
      return { ...e, fit: e.fit.map((p) => applyXf(x, p)) };
    case "xline":
    case "ray":
      return { ...e, base: applyXf(x, e.base), dir: unit(applyLinear(x, e.dir)) };
    case "text":
    case "mtext":
    case "attdef": {
      // Mirrored text still reads forwards (AutoCAD's MIRRTEXT 0): it keeps its mirrored "up".
      let rotation = mapAngle(e.rotation);
      if (flip) {
        const up = applyLinear(x, { x: -Math.sin(e.rotation), y: Math.cos(e.rotation) });
        rotation = Math.atan2(-up.x, up.y);
      }
      return { ...e, at: applyXf(x, e.at), height: e.height * k, rotation, ...(e.type === "mtext" ? { width: e.width * k } : {}) };
    }
    case "dimension":
      return { ...e, p1: applyXf(x, e.p1), p2: applyXf(x, e.p2), loc: applyXf(x, e.loc), center: applyXf(x, e.center), angle: mapAngle(e.angle) };
    case "leader":
      return { ...e, points: e.points.map((p) => applyXf(x, p)), height: e.height * k };
    case "hatch":
      return {
        ...e,
        loops: e.loops.map((loop) => loop.map((p) => applyXf(x, p))),
        scale: e.scale * k,
        angle: mapAngle(e.angle),
        ...(e.seeds ? { seeds: e.seeds.map((p) => applyXf(x, p)) } : {}),
      };
    case "insert": {
      // Folded into the reference's own placement; mirrored, it's mirrored in its own Y.
      const phi = Math.atan2(x.c, x.a);
      return flip
        ? { ...e, at: applyXf(x, e.at), rotation: phi - e.rotation, scale: { x: e.scale.x * k, y: -e.scale.y * k } }
        : { ...e, at: applyXf(x, e.at), rotation: e.rotation + phi, scale: { x: e.scale.x * k, y: e.scale.y * k } };
    }
    case "image":
      // Pictures aren't mirrored: a mirrored one keeps reading the right way.
      return flip
        ? { ...e, at: applyXf(x, imageCorners(e)[1]), rotation: mapAngle(e.rotation + Math.PI), width: e.width * k, height: e.height * k }
        : { ...e, at: applyXf(x, e.at), rotation: mapAngle(e.rotation), width: e.width * k, height: e.height * k };
  }
}

// --- grips ------------------------------------------------------------------------------

export type Grip = { point: Vec; kind: "move" | "stretch" | "radius" | "segment"; index: number };

/** The grips a selected entity shows, as in AutoCAD. */
export function grips(e: Entity): Grip[] {
  switch (e.type) {
    case "line":
      return [
        { point: e.a, kind: "stretch", index: 0 },
        { point: mid(e.a, e.b), kind: "move", index: 1 },
        { point: e.b, kind: "stretch", index: 2 },
      ];
    case "polyline": {
      const list: Grip[] = e.points.map((p, i) => ({ point: p, kind: "stretch", index: i }));
      polylineSegments(e.points, e.closed).forEach((s, i) => list.push({ point: mid(s.a, s.b), kind: "segment", index: i }));
      return list;
    }
    case "circle":
      return [
        { point: e.center, kind: "move", index: 0 },
        ...[0, 1, 2, 3].map((q) => ({ point: polar(e.center, (q * Math.PI) / 2, e.radius), kind: "radius" as const, index: q + 1 })),
      ];
    case "arc":
      return [
        { point: e.center, kind: "move", index: 0 },
        { point: arcStart(e), kind: "stretch", index: 1 },
        { point: arcMid(e), kind: "radius", index: 2 },
        { point: arcEnd(e), kind: "stretch", index: 3 },
      ];
    case "ellipse": {
      const minor = ellipseMinor(e);
      return [
        { point: e.center, kind: "move", index: 0 },
        { point: add(e.center, e.major), kind: "radius", index: 1 },
        { point: sub(e.center, e.major), kind: "radius", index: 2 },
        { point: add(e.center, minor), kind: "radius", index: 3 },
        { point: sub(e.center, minor), kind: "radius", index: 4 },
      ];
    }
    case "spline":
      return e.fit.map((p, i) => ({ point: p, kind: "stretch" as const, index: i }));
    case "xline":
      return [{ point: e.base, kind: "move", index: 0 }];
    case "ray":
      return [{ point: e.base, kind: "stretch", index: 0 }];
    case "text":
    case "mtext":
    case "attdef":
    case "insert":
      return [{ point: e.at, kind: "move", index: 0 }];
    case "image":
      return imageCorners(e).map((point, index) => ({ point, kind: "stretch" as const, index }));
    case "dimension":
      return e.kind === "radius" || e.kind === "diameter"
        ? [
            { point: e.p1, kind: "stretch", index: 0 },
            { point: e.loc, kind: "stretch", index: 2 },
          ]
        : [
            { point: e.p1, kind: "stretch", index: 0 },
            { point: e.p2, kind: "stretch", index: 1 },
            { point: e.loc, kind: "stretch", index: 2 },
          ];
    case "leader":
      return e.points.map((p, i) => ({ point: p, kind: "stretch" as const, index: i }));
    case "hatch": {
      const box = bounds(e);
      return [{ point: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, kind: "move", index: 0 }];
    }
  }
}

/** The entity with a grip moved from where it was to `to`. */
export function moveGrip<T extends Entity>(e: T, grip: Grip, to: Vec): T {
  const d = sub(to, grip.point);
  if (grip.kind === "move") return translate(e, d);
  switch (e.type) {
    case "line":
      return grip.index === 0 ? { ...e, a: to } : { ...e, b: to };
    case "polyline": {
      const points = e.points.slice();
      if (grip.kind === "stretch") points[grip.index] = to;
      else {
        const i = grip.index;
        const j = (i + 1) % points.length;
        points[i] = add(points[i], d);
        points[j] = add(points[j], d);
      }
      return { ...e, points };
    }
    case "circle":
      return { ...e, radius: Math.max(dist(e.center, to), EPS) };
    case "arc":
      if (grip.kind === "radius") return { ...e, radius: Math.max(dist(e.center, to), EPS) };
      return grip.index === 1 ? { ...e, start: angleOf(e.center, to) } : { ...e, end: angleOf(e.center, to) };
    case "ellipse": {
      // A major axis end changes the major radius (and its direction); a minor end the ratio.
      const majorLength = len(e.major);
      if (grip.index <= 2) {
        const r = Math.max(dist(e.center, to), EPS);
        const v = mul(unit(sub(to, e.center)), grip.index === 1 ? r : -r);
        return { ...e, major: v, ratio: Math.min((majorLength * e.ratio) / r, 1) };
      }
      return { ...e, ratio: Math.min(Math.max(dist(e.center, to) / majorLength, 1e-6), 1) };
    }
    case "spline": {
      const fit = e.fit.slice();
      fit[grip.index] = to;
      return { ...e, fit };
    }
    case "xline":
      return translate(e, d);
    case "ray":
      return { ...e, base: to };
    case "dimension":
      return grip.index === 0 ? { ...e, p1: to } : grip.index === 1 ? { ...e, p2: to } : { ...e, loc: to };
    case "leader": {
      const points = e.points.slice();
      points[grip.index] = to;
      return { ...e, points };
    }
    case "image": {
      // A corner scales the picture about the opposite one, keeping its proportions.
      const corners = imageCorners(e);
      const anchor = corners[(grip.index + 2) % 4];
      const k = Math.max(dist(anchor, to) / Math.max(dist(anchor, grip.point), EPS), 1e-6);
      return { ...e, at: add(anchor, mul(sub(e.at, anchor), k)), width: e.width * k, height: e.height * k };
    }
    default:
      return translate(e, d);
  }
}
