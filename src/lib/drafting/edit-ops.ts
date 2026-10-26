import {
  add,
  angleOf,
  cross,
  dist,
  distanceTo,
  dot,
  ellipsePoint,
  FAR,
  intersect,
  isFullEllipse,
  len,
  mul,
  normalizeAngle,
  perp,
  polar,
  primitives,
  same,
  sub,
  sweepOf,
  TAU,
  tessellate,
  translate,
  unit,
  type Box,
  type Primitive,
} from "./geometry";
import type { ArcEntity, Entity, LineEntity, PolylineEntity, SplineEntity, Vec } from "./types";

// The editing operations behind the modify commands. Positions along an object are measured
// by a parameter (0-1 along a line, the angle along an arc, segment index plus fraction along a
// polyline...), so trimming and breaking work the same way on every kind of object.

const EPS = 1e-9;
const TOL = 1e-6;

// --- parameters ----------------------------------------------------------------------------

type Domain = { lo: number; hi: number; periodic: boolean };

/** Where along an object its parameter runs; null for objects that can't be cut (splines). */
export function domain(e: Entity): Domain | null {
  switch (e.type) {
    case "line":
      return { lo: 0, hi: 1, periodic: false };
    case "arc":
      return { lo: 0, hi: sweepOf(e.start, e.end), periodic: false };
    case "circle":
      return { lo: 0, hi: TAU, periodic: true };
    case "ellipse":
      return isFullEllipse(e) ? { lo: 0, hi: TAU, periodic: true } : { lo: 0, hi: sweepOf(e.start, e.end), periodic: false };
    case "polyline": {
      const n = e.closed && e.points.length > 2 ? e.points.length : e.points.length - 1;
      return { lo: 0, hi: n, periodic: e.closed && e.points.length > 2 };
    }
    case "xline":
      return { lo: -FAR, hi: FAR, periodic: false };
    case "ray":
      return { lo: 0, hi: FAR, periodic: false };
    default:
      return null; // splines and annotations can't be cut
  }
}

export function pointAt(e: Entity, s: number): Vec {
  const d = domain(e);
  if (d?.periodic) s = ((s % d.hi) + d.hi) % d.hi;
  switch (e.type) {
    case "line":
      return add(e.a, mul(sub(e.b, e.a), s));
    case "arc":
      return polar(e.center, e.start + s, e.radius);
    case "circle":
      return polar(e.center, s, e.radius);
    case "ellipse":
      return ellipsePoint(e, (isFullEllipse(e) ? 0 : e.start) + s);
    case "polyline": {
      const n = e.points.length;
      const i = Math.min(Math.floor(s), (d?.hi ?? 1) - 1);
      const a = e.points[i % n];
      const b = e.points[(i + 1) % n];
      return add(a, mul(sub(b, a), s - i));
    }
    case "xline":
    case "ray":
      return add(e.base, mul(e.dir, s));
    default:
      return { x: 0, y: 0 };
  }
}

/** The parameter of the point on the object nearest `p`. */
export function paramOf(e: Entity, p: Vec): number {
  switch (e.type) {
    case "line": {
      const ab = sub(e.b, e.a);
      const l2 = dot(ab, ab);
      return l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, e.a), ab) / l2));
    }
    case "arc": {
      const sweep = sweepOf(e.start, e.end);
      const s = normalizeAngle(angleOf(e.center, p) - e.start);
      if (s <= sweep) return s;
      return s - sweep < TAU - s ? sweep : 0; // past the end: the nearer end
    }
    case "circle":
      return normalizeAngle(angleOf(e.center, p));
    case "ellipse": {
      const u = unit(e.major);
      const v = perp(u);
      const rel = sub(p, e.center);
      const t = Math.atan2(dot(rel, v) / (len(e.major) * e.ratio), dot(rel, u) / len(e.major));
      if (isFullEllipse(e)) return normalizeAngle(t);
      const sweep = sweepOf(e.start, e.end);
      const s = normalizeAngle(t - e.start);
      if (s <= sweep) return s;
      return s - sweep < TAU - s ? sweep : 0;
    }
    case "polyline": {
      const d = domain(e)!;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < d.hi; i++) {
        const a = e.points[i % e.points.length];
        const b = e.points[(i + 1) % e.points.length];
        const ab = sub(b, a);
        const l2 = dot(ab, ab);
        const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
        const q = add(a, mul(ab, t));
        if (dist(p, q) < bestD) {
          bestD = dist(p, q);
          best = i + t;
        }
      }
      return best;
    }
    case "xline":
      return Math.max(-FAR, Math.min(FAR, dot(sub(p, e.base), e.dir)));
    case "ray":
      return Math.max(0, Math.min(FAR, dot(sub(p, e.base), e.dir)));
    default:
      return 0;
  }
}

/** The part of an object between two parameters (`to` past the period wraps round a closed one). */
export function piece(e: Entity, from: number, to: number): Entity | null {
  if (to - from < EPS) return null;
  switch (e.type) {
    case "line": {
      const a = pointAt(e, from);
      const b = pointAt(e, to);
      return same(a, b, TOL) ? null : { ...e, a, b };
    }
    case "arc":
      return { ...e, start: e.start + from, end: e.start + to };
    case "circle":
      return { id: e.id, layer: e.layer, color: e.color, lineweight: e.lineweight, linetype: e.linetype, type: "arc", center: e.center, radius: e.radius, start: from, end: to };
    case "ellipse": {
      const base = isFullEllipse(e) ? 0 : e.start;
      return { ...e, start: base + from, end: base + to };
    }
    case "polyline": {
      const n = e.points.length;
      const points = [pointAt(e, from)];
      for (let k = Math.floor(from) + 1; k < to - EPS; k++) points.push(e.points[k % n]);
      points.push(pointAt(e, to));
      const clean = points.filter((p, i) => i === 0 || !same(p, points[i - 1], TOL));
      return clean.length < 2 ? null : { ...e, points: clean, bulges: clean.map(() => 0), closed: false };
    }
    case "xline": {
      const startsAtInfinity = from <= -FAR + 1;
      const endsAtInfinity = to >= FAR - 1;
      if (startsAtInfinity && endsAtInfinity) return e;
      if (startsAtInfinity) return { ...e, type: "ray", base: pointAt(e, to), dir: mul(e.dir, -1) };
      if (endsAtInfinity) return { ...e, type: "ray", base: pointAt(e, from) };
      return line(e, pointAt(e, from), pointAt(e, to));
    }
    case "ray":
      return to >= FAR - 1 ? { ...e, base: pointAt(e, from) } : line(e, pointAt(e, from), pointAt(e, to));
    default:
      return null;
  }
}

function line(props: Entity, a: Vec, b: Vec): LineEntity {
  return { id: props.id, layer: props.layer, color: props.color, lineweight: props.lineweight, linetype: props.linetype, type: "line", a, b };
}

/** Parameters where other objects cross this one. */
export function cuts(e: Entity, others: Entity[]): number[] {
  const mine = primitives(e);
  const out: number[] = [];
  for (const o of others) {
    if (o.id === e.id) continue;
    for (const p of primitives(o)) for (const m of mine) for (const pt of intersect(m, p)) out.push(paramOf(e, pt));
  }
  out.sort((a, b) => a - b);
  return out.filter((v, i) => i === 0 || v - out[i - 1] > 1e-9);
}

// --- trim and break ---------------------------------------------------------------------

/**
 * Trims the part of `e` around parameter `at` between the cutting points (AutoCAD's Quick
 * mode: with nothing crossing it, the whole object goes). Returns the pieces that stay, or
 * null when there's nothing to trim.
 */
export function trimAt(e: Entity, at: number, cutAt: number[]): Entity[] | null {
  const d = domain(e);
  if (!d) return null;
  if (!d.periodic) {
    const inside = cutAt.filter((c) => c > d.lo + TOL && c < d.hi - TOL);
    if (!inside.length) return [];
    const prev = Math.max(d.lo, ...inside.filter((c) => c < at));
    const next = Math.min(d.hi, ...inside.filter((c) => c > at));
    const pieces = [prev > d.lo + TOL ? piece(e, d.lo, prev) : null, next < d.hi - TOL ? piece(e, next, d.hi) : null];
    return pieces.filter((p): p is Entity => !!p).map((p, i) => (i === 0 ? p : { ...p, id: "" }));
  }
  const period = d.hi;
  const sorted = [...new Set(cutAt.map((c) => ((c % period) + period) % period))].sort((a, b) => a - b);
  if (!sorted.length) return [];
  if (sorted.length < 2) return null; // a closed shape needs two cuts
  const next = sorted.find((c) => c > at) ?? sorted[0] + period;
  const prevCandidates = sorted.filter((c) => c < at);
  const prev = prevCandidates.length ? prevCandidates[prevCandidates.length - 1] : sorted[sorted.length - 1] - period;
  const kept = piece(e, next, prev + period);
  return kept ? [kept] : [];
}

/** Removes the part of `e` between two points (the same point: splits it there). */
export function breakBetween(e: Entity, p1: Vec, p2: Vec): Entity[] | null {
  const d = domain(e);
  if (!d) return null;
  let a = paramOf(e, p1);
  let b = paramOf(e, p2);
  if (d.periodic) {
    if (Math.abs(a - b) < TOL) return null; // a closed shape needs a gap
    // AutoCAD breaks circles counter-clockwise from the first point to the second.
    const kept = piece(e, b, a > b ? a : a + d.hi);
    return kept ? [kept] : [];
  }
  if (a > b) [a, b] = [b, a];
  if (b - a < TOL) {
    const left = piece(e, d.lo, a);
    const right = piece(e, a, d.hi);
    return [left, right ? { ...right, id: "" } : null].filter((p): p is Entity => !!p);
  }
  const left = a > d.lo + TOL ? piece(e, d.lo, a) : null;
  const right = b < d.hi - TOL ? piece(e, b, d.hi) : null;
  return [left, right ? { ...right, id: left ? "" : right.id } : null].filter((p): p is Entity => !!p);
}

// --- extend --------------------------------------------------------------------------------

function nearestAlong(from: Vec, dir: Vec, boundaries: Entity[], selfId: string): Vec | null {
  const ray: Primitive = { kind: "seg", a: add(from, mul(dir, TOL)), b: add(from, mul(dir, FAR)) };
  let best: Vec | null = null;
  let bestT = Infinity;
  for (const o of boundaries) {
    if (o.id === selfId) continue;
    for (const p of primitives(o)) {
      for (const pt of intersect(ray, p)) {
        const t = dot(sub(pt, from), dir);
        if (t > TOL && t < bestT) {
          bestT = t;
          best = pt;
        }
      }
    }
  }
  return best;
}

/** Extends the end of `e` nearest `pick` to the nearest boundary it would meet; null if none. */
export function extendTo(e: Entity, pick: Vec, boundaries: Entity[]): Entity | null {
  switch (e.type) {
    case "line": {
      const atEnd = dist(pick, e.b) <= dist(pick, e.a);
      const from = atEnd ? e.b : e.a;
      const hit = nearestAlong(from, unit(atEnd ? sub(e.b, e.a) : sub(e.a, e.b)), boundaries, e.id);
      return hit ? (atEnd ? { ...e, b: hit } : { ...e, a: hit }) : null;
    }
    case "polyline": {
      if (e.closed || e.points.length < 2) return null;
      const n = e.points.length;
      const atEnd = dist(pick, e.points[n - 1]) <= dist(pick, e.points[0]);
      const [from, prev] = atEnd ? [e.points[n - 1], e.points[n - 2]] : [e.points[0], e.points[1]];
      const hit = nearestAlong(from, unit(sub(from, prev)), boundaries, e.id);
      if (!hit) return null;
      const points = e.points.slice();
      points[atEnd ? n - 1 : 0] = hit;
      return { ...e, points };
    }
    case "arc": {
      const atEnd = dist(pick, polar(e.center, e.end, e.radius)) <= dist(pick, polar(e.center, e.start, e.radius));
      const circle: Primitive = { kind: "arc", c: e.center, r: e.radius, start: 0, end: TAU, full: true };
      const sweep = sweepOf(e.start, e.end);
      let best: number | null = null;
      for (const o of boundaries) {
        if (o.id === e.id) continue;
        for (const p of primitives(o)) {
          for (const pt of intersect(circle, p)) {
            const angle = angleOf(e.center, pt);
            const beyond = atEnd ? normalizeAngle(angle - e.end) : normalizeAngle(e.start - angle);
            if (beyond > TOL && beyond < TAU - sweep - TOL && (best === null || beyond < best)) best = beyond;
          }
        }
      }
      if (best === null) return null;
      return atEnd ? { ...e, end: e.end + best } : { ...e, start: e.start - best };
    }
    case "ray": {
      const hit = nearestAlong(e.base, mul(e.dir, -1), boundaries, e.id);
      return hit ? { ...e, base: hit } : null;
    }
    default:
      return null;
  }
}

// --- fillet and chamfer ------------------------------------------------------------------

type Corner = { P: Vec; u1: Vec; u2: Vec; far1: Vec; far2: Vec };

function corner(l1: LineEntity, pick1: Vec, l2: LineEntity, pick2: Vec): Corner | string {
  const d1 = sub(l1.b, l1.a);
  const d2 = sub(l2.b, l2.a);
  const denom = cross(d1, d2);
  if (Math.abs(denom) < EPS * len(d1) * len(d2)) return "The lines are parallel.";
  const t = cross(sub(l2.a, l1.a), d2) / denom;
  const P = add(l1.a, mul(d1, t));
  // Each line keeps the side it was picked on.
  const side = (l: LineEntity, pick: Vec) => {
    const d = unit(sub(l.b, l.a));
    return dot(sub(pick, P), d) >= 0 ? d : mul(d, -1);
  };
  const u1 = side(l1, pick1);
  const u2 = side(l2, pick2);
  const far = (l: LineEntity, u: Vec) => (dot(sub(l.a, P), u) >= dot(sub(l.b, P), u) ? l.a : l.b);
  return { P, u1, u2, far1: far(l1, u1), far2: far(l2, u2) };
}

/** The line from its kept end to a new end, in its original direction. */
function reshape(l: LineEntity, far: Vec, to: Vec): LineEntity {
  return same(far, l.a) ? { ...l, b: to } : { ...l, a: to };
}

/** Fillets two lines with an arc of radius `r` (0: extends or trims them to meet). */
export function filletLines(l1: LineEntity, pick1: Vec, l2: LineEntity, pick2: Vec, r: number): { lines: [LineEntity, LineEntity]; arc: Omit<ArcEntity, "id"> | null } | string {
  const c = corner(l1, pick1, l2, pick2);
  if (typeof c === "string") return c;
  const { P, u1, u2, far1, far2 } = c;
  if (r < EPS) return { lines: [reshape(l1, far1, P), reshape(l2, far2, P)], arc: null };
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  if (theta < 1e-6 || Math.PI - theta < 1e-6) return "The lines are parallel.";
  const d = r / Math.tan(theta / 2);
  if (dot(sub(far1, P), u1) < d - TOL || dot(sub(far2, P), u2) < d - TOL) return "The radius is too large for those lines.";
  const T1 = add(P, mul(u1, d));
  const T2 = add(P, mul(u2, d));
  const center = add(P, mul(unit(add(u1, u2)), r / Math.sin(theta / 2)));
  const a1 = angleOf(center, T1);
  const a2 = angleOf(center, T2);
  const [start, end] = sweepOf(a1, a2) <= Math.PI ? [a1, a2] : [a2, a1];
  return {
    lines: [reshape(l1, far1, T1), reshape(l2, far2, T2)],
    arc: { type: "arc", center, radius: r, start, end, layer: l1.layer, color: l1.color, lineweight: l1.lineweight, linetype: l1.linetype },
  };
}

/** Chamfers two lines: each cut back by its distance from where they meet, joined by a line. */
export function chamferLines(l1: LineEntity, pick1: Vec, l2: LineEntity, pick2: Vec, d1: number, d2: number): { lines: [LineEntity, LineEntity]; bevel: [Vec, Vec] | null } | string {
  const c = corner(l1, pick1, l2, pick2);
  if (typeof c === "string") return c;
  const { P, u1, u2, far1, far2 } = c;
  if (dot(sub(far1, P), u1) < d1 - TOL || dot(sub(far2, P), u2) < d2 - TOL) return "The chamfer distances are too large for those lines.";
  const C1 = add(P, mul(u1, d1));
  const C2 = add(P, mul(u2, d2));
  return { lines: [reshape(l1, far1, C1), reshape(l2, far2, C2)], bevel: same(C1, C2) ? null : [C1, C2] };
}

// --- offset --------------------------------------------------------------------------------

function lineIntersection(a1: Vec, a2: Vec, b1: Vec, b2: Vec): Vec | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const d = cross(r, s);
  if (Math.abs(d) < EPS) return null;
  return add(a1, mul(r, cross(sub(b1, a1), s) / d));
}

/** Offsets points along a path (open or closed) by `d` to the left (`sign` 1) or right (-1), joining corners. */
function offsetPath(points: Vec[], closed: boolean, d: number, sign: number): Vec[] {
  const n = points.length;
  const segs: [Vec, Vec][] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const normal = mul(unit(perp(sub(b, a))), d * sign);
    segs.push([add(a, normal), add(b, normal)]);
  }
  const out: Vec[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (!closed && i === 0) {
      out.push(segs[0][0]);
      continue;
    }
    const prev = segs[(i - 1 + segs.length) % segs.length];
    out.push(lineIntersection(prev[0], prev[1], segs[i][0], segs[i][1]) ?? segs[i][0]);
  }
  if (!closed) out.push(segs[segs.length - 1][1]);
  return out;
}

/** Which side of a path a point is on: 1 left, -1 right (of the nearest segment's direction). */
function sideOf(points: Vec[], closed: boolean, p: Vec) {
  let best = 0;
  let bestD = Infinity;
  const n = points.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(dot(ab, ab), EPS)));
    const q = add(a, mul(ab, t));
    if (dist(p, q) < bestD) {
      bestD = dist(p, q);
      best = i;
    }
  }
  const a = points[best];
  const b = points[(best + 1) % n];
  return cross(sub(b, a), sub(p, a)) >= 0 ? 1 : -1;
}

/** A copy of `e` offset by `d` towards `side`, or null if it can't be (a circle shrunk to nothing). */
export function offset(e: Entity, d: number, side: Vec): Entity | null {
  if (d <= EPS) return null;
  switch (e.type) {
    case "line": {
      const n = unit(perp(sub(e.b, e.a)));
      const s = Math.sign(dot(sub(side, e.a), n)) || 1;
      return translate(e, mul(n, d * s));
    }
    case "xline":
    case "ray": {
      const n = perp(e.dir);
      const s = Math.sign(dot(sub(side, e.base), n)) || 1;
      return translate(e, mul(n, d * s));
    }
    case "circle":
    case "arc": {
      const r = dist(side, e.center) > e.radius ? e.radius + d : e.radius - d;
      return r > EPS ? { ...e, radius: r } : null;
    }
    case "polyline": {
      if (e.points.length < 2) return null;
      const closed = e.closed && e.points.length > 2;
      const points = offsetPath(e.points, closed, d, sideOf(e.points, closed, side));
      return { ...e, points, bulges: points.map(() => 0) };
    }
    case "ellipse":
    case "spline": {
      // Offset curves of ellipses and splines are splines, as in AutoCAD (here through 48 points).
      const pts = tessellate(e)[0];
      const closed = e.type === "spline" ? e.closed : isFullEllipse(e);
      const path = closed && same(pts[0], pts[pts.length - 1]) ? pts.slice(0, -1) : pts;
      const shifted = offsetPath(path, closed, d, sideOf(path, closed, side));
      const step = Math.max(1, Math.floor(shifted.length / 48));
      const fit = shifted.filter((_, i) => i % step === 0);
      if (!closed && !same(fit[fit.length - 1], shifted[shifted.length - 1])) fit.push(shifted[shifted.length - 1]);
      return { id: e.id, layer: e.layer, color: e.color, lineweight: e.lineweight, linetype: e.linetype, type: "spline", fit, closed } satisfies SplineEntity;
    }
    default:
      return null;
  }
}

/** The distance from an object to a point (for Offset Through). */
export const offsetDistanceTo = (e: Entity, p: Vec) => distanceTo(e, p);

// --- join, explode, stretch ------------------------------------------------------------------

export function explode(e: Entity): Entity[] | null {
  if (e.type !== "polyline" || e.points.length < 2) return null;
  const n = e.points.length;
  const count = e.closed && n > 2 ? n : n - 1;
  return Array.from({ length: count }, (_, i) => line(e, e.points[i], e.points[(i + 1) % n])).filter((l) => !same(l.a, l.b));
}

/** Joins objects end to end: collinear lines into one line, contiguous arcs of one circle into one arc, and chains of lines and polylines into a polyline. */
export function join(entities: Entity[]): { removed: string[]; added: Entity[] } {
  const removed = new Set<string>();
  const added: Entity[] = [];
  let lines = entities.filter((e): e is LineEntity => e.type === "line");
  const arcs = entities.filter((e): e is ArcEntity => e.type === "arc");

  // Collinear, touching or overlapping lines become one.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i];
        const b = lines[j];
        const u = unit(sub(a.b, a.a));
        if (Math.abs(cross(u, unit(sub(b.b, b.a)))) > 1e-9 || Math.abs(cross(u, sub(b.a, a.a))) > TOL) continue;
        const ts = [a.a, a.b, b.a, b.b].map((p) => dot(sub(p, a.a), u));
        const [a0, a1] = [Math.min(ts[0], ts[1]), Math.max(ts[0], ts[1])];
        const [b0, b1] = [Math.min(ts[2], ts[3]), Math.max(ts[2], ts[3])];
        if (b0 > a1 + TOL || a0 > b1 + TOL) continue;
        const lo = Math.min(...ts);
        const hi = Math.max(...ts);
        const joined = { ...a, a: add(a.a, mul(u, lo)), b: add(a.a, mul(u, hi)) };
        removed.add(a.id).add(b.id);
        lines = [...lines.filter((_, k) => k !== i && k !== j), joined];
        merged = true;
        break outer;
      }
    }
  }

  // Arcs of the same circle, end to start.
  const arcPool = arcs.slice();
  for (let i = 0; i < arcPool.length; i++) {
    for (let j = 0; j < arcPool.length; j++) {
      if (i === j) continue;
      const a = arcPool[i];
      const b = arcPool[j];
      if (!same(a.center, b.center, TOL) || Math.abs(a.radius - b.radius) > TOL) continue;
      if (Math.abs(normalizeAngle(b.start - a.end)) > 1e-6 && Math.abs(normalizeAngle(b.start - a.end) - TAU) > 1e-6) continue;
      removed.add(a.id).add(b.id);
      arcPool[i] = { ...a, end: a.end + sweepOf(b.start, b.end) };
      arcPool.splice(j, 1);
      i = -1;
      break;
    }
  }
  for (const a of arcPool) if (removed.has(a.id)) added.push(a);

  // Chains of lines and polylines meeting end to end become a polyline.
  type Chain = { points: Vec[]; ids: string[]; props: Entity };
  const chains: Chain[] = [
    ...lines.map((l) => ({ points: [l.a, l.b], ids: [l.id], props: l as Entity })),
    ...entities.filter((e): e is PolylineEntity => e.type === "polyline" && !e.closed).map((p) => ({ points: p.points.slice(), ids: [p.id], props: p as Entity })),
  ];
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = 0; i < chains.length && !grew; i++) {
      for (let j = 0; j < chains.length && !grew; j++) {
        if (i === j) continue;
        const a = chains[i];
        const b = chains[j];
        const [aS, aE, bS, bE] = [a.points[0], a.points[a.points.length - 1], b.points[0], b.points[b.points.length - 1]];
        let points: Vec[] | null = null;
        if (same(aE, bS, TOL)) points = [...a.points, ...b.points.slice(1)];
        else if (same(aE, bE, TOL)) points = [...a.points, ...b.points.slice(0, -1).reverse()];
        else if (same(aS, bE, TOL)) points = [...b.points, ...a.points.slice(1)];
        else if (same(aS, bS, TOL)) points = [...b.points.slice().reverse(), ...a.points.slice(1)];
        if (points) {
          chains[i] = { points, ids: [...a.ids, ...b.ids], props: a.props };
          chains.splice(j, 1);
          grew = true;
        }
      }
    }
  }
  for (const chain of chains) {
    const original = entities.find((e) => e.id === chain.ids[0])!;
    if (chain.ids.length === 1 && !removed.has(chain.ids[0])) continue;
    chain.ids.forEach((id) => removed.add(id));
    if (chain.ids.length === 1 && original.type === "line") {
      added.push(lines.find((l) => l.id === chain.ids[0]) ?? (chain.props as LineEntity));
      continue;
    }
    const closed = chain.points.length > 3 && same(chain.points[0], chain.points[chain.points.length - 1], TOL);
    const points = closed ? chain.points.slice(0, -1) : chain.points;
    if (points.length === 2 && !closed) {
      added.push(line(chain.props, points[0], points[1]));
      continue;
    }
    const p = chain.props;
    added.push({ id: p.id, layer: p.layer, color: p.color, lineweight: p.lineweight, linetype: p.linetype, type: "polyline", points, bulges: points.map(() => 0), closed });
  }
  return { removed: [...removed], added };
}

const inAny = (p: Vec, boxes: Box[]) => boxes.some((b) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY);

/** STRETCH: the points inside the crossing windows move by `d`; the rest stay. */
export function stretch(e: Entity, boxes: Box[], d: Vec): Entity {
  const move = (p: Vec) => (inAny(p, boxes) ? add(p, d) : p);
  switch (e.type) {
    case "line":
      return { ...e, a: move(e.a), b: move(e.b) };
    case "polyline":
      return { ...e, points: e.points.map(move) };
    case "spline":
      return { ...e, fit: e.fit.map(move) };
    case "circle":
    case "arc":
    case "ellipse":
      return inAny(e.center, boxes) ? translate(e, d) : e;
    case "xline":
    case "ray":
      return inAny(e.base, boxes) ? translate(e, d) : e;
    case "text":
    case "mtext":
      return inAny(e.at, boxes) ? translate(e, d) : e;
    case "dimension":
      // Dimensions stretch with what they measure, as in AutoCAD.
      return { ...e, p1: move(e.p1), p2: move(e.p2), loc: move(e.loc), center: move(e.center) };
    case "leader":
      return { ...e, points: e.points.map(move) };
    case "hatch":
      return { ...e, loops: e.loops.map((loop) => loop.map(move)) };
  }
}
