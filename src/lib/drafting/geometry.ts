import type { ArcEntity, Entity, Vec } from "./types";

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
      return polylineSegments(e.points, e.closed);
    case "circle":
      return [{ kind: "arc", c: e.center, r: e.radius, start: 0, end: TAU, full: true }];
    case "arc":
      return [{ kind: "arc", c: e.center, r: e.radius, start: e.start, end: e.end, full: false }];
  }
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
      return [e.closed && e.points.length > 2 ? [...e.points, e.points[0]] : e.points];
    case "circle":
      return [arcPoints(e.center, e.radius, 0, TAU)];
    case "arc":
      return [arcPoints(e.center, e.radius, e.start, sweepOf(e.start, e.end))];
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
      e.points.forEach((p) => extendBox(box, p));
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

export function distanceTo(e: Entity, p: Vec) {
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
      return { ...e, center: add(e.center, d) };
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
  }
}
