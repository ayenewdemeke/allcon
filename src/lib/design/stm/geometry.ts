import { DesignError } from "../walls/cip";

// Planar geometry for the strut-and-tie model: validated points and polygons, point location,
// segment intersection, and the candidate members that stay inside the concrete. Inches.

export type Pt = [number, number];
export const TOL = 1e-8;
const EPS = 1e-9;

export const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const norm = (a: Pt) => Math.hypot(a[0], a[1]);

export function points(value: unknown, name: string, minimum = 1): Pt[] {
  if (!Array.isArray(value) || value.length < minimum || !value.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v))))
    throw new DesignError(`${name}: needs at least ${minimum} x, y points.`);
  const p = value as Pt[];
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (norm(sub(p[j], p[i])) <= TOL) throw new DesignError(`${name}: two points coincide.`);
  return p;
}

const orient = (a: Pt, b: Pt, p: Pt) => cross(sub(b, a), sub(p, a));

export function onSegment(p: Pt, a: Pt, b: Pt) {
  const length = norm(sub(b, a));
  return Math.abs(orient(a, b, p)) <= TOL * Math.max(length, 1) && p[0] >= Math.min(a[0], b[0]) - TOL && p[1] >= Math.min(a[1], b[1]) - TOL && p[0] <= Math.max(a[0], b[0]) + TOL && p[1] <= Math.max(a[1], b[1]) + TOL;
}

/** Whether segments ab and cd touch or cross. */
export function intersects(a: Pt, b: Pt, c: Pt, d: Pt) {
  if (onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)) return true;
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

/** A simple polygon (no closing repeat): no self-intersection, backtracking or zero area. */
export function polygon(value: unknown, name: string): Pt[] {
  const p = points(value, name, 3);
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    const c = p[(i + 2) % n];
    if (onSegment(c, a, b) || onSegment(a, b, c)) throw new DesignError(`${name}: adjacent edges overlap.`);
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (intersects(a, b, p[j], p[(j + 1) % n])) throw new DesignError(`${name}: edges cross.`);
    }
  }
  let area = 0;
  for (let i = 0; i < n; i++) area += cross(sub(p[i], p[0]), sub(p[(i + 1) % n], p[0]));
  if (Math.abs(area) / 2 <= TOL * TOL) throw new DesignError(`${name}: has no area.`);
  return p;
}

/** 0 on the boundary, 1 inside, −1 outside a simple polygon. */
export function pointLocation(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d = sub(b, a);
    const v = sub(p, a);
    if (Math.abs(cross(d, v)) < EPS && Math.min(a[0], b[0]) - EPS <= p[0] && p[0] <= Math.max(a[0], b[0]) + EPS && Math.min(a[1], b[1]) - EPS <= p[1] && p[1] <= Math.max(a[1], b[1]) + EPS) return 0;
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = a[0] + ((p[1] - a[1]) * d[0]) / d[1];
      if (x > p[0]) inside = !inside;
    }
  }
  return inside ? 1 : -1;
}

/** Whether segment ab stays in the concrete: split at every polygon crossing and test each piece. */
export function visible(a: Pt, b: Pt, boundary: Pt[], holes: Pt[][]) {
  const d = sub(b, a);
  const params = [0, 1];
  for (const poly of [boundary, ...holes]) {
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i];
      const e = poly[(i + 1) % poly.length];
      const edge = sub(e, c);
      const v = sub(c, a);
      const den = cross(d, edge);
      if (Math.abs(den) > EPS) {
        const t = cross(v, edge) / den;
        const u = cross(v, d) / den;
        if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) params.push(Math.max(0, Math.min(1, t)));
      } else if (Math.abs(cross(v, d)) < EPS) {
        const axis = Math.abs(d[0]) >= Math.abs(d[1]) ? 0 : 1;
        for (const p of [c, e]) {
          const t = (p[axis] - a[axis]) / d[axis];
          if (t >= 0 && t <= 1) params.push(t);
        }
      }
    }
  }
  const sorted = [...new Set(params)].sort((x, y) => x - y);
  const samples = [...sorted, ...sorted.slice(1).map((t, k) => (sorted[k] + t) / 2)];
  return samples.every((t) => {
    const p: Pt = [a[0] + t * d[0], a[1] + t * d[1]];
    return pointLocation(p, boundary) >= 0 && holes.every((h) => pointLocation(p, h) < 0);
  });
}

/** Every pair of nodes joined by a line inside the concrete that passes through no other node. */
export function candidates(nodesIn: unknown, boundaryIn: unknown, holesIn: unknown[] = []) {
  const nodes = points(nodesIn, "Nodes", 2);
  const boundary = polygon(boundaryIn, "Concrete outline");
  const holes = holesIn.map((h, i) => polygon(h, `Opening ${i + 1}`));
  holes.forEach((hole, i) => {
    if (hole.some((p) => pointLocation(p, boundary) !== 1)) throw new DesignError("An opening must lie inside the outline.");
    for (const other of [boundary, ...holes.slice(0, i)])
      for (let a = 0; a < hole.length; a++)
        for (let c = 0; c < other.length; c++)
          if (intersects(hole[a], hole[(a + 1) % hole.length], other[c], other[(c + 1) % other.length])) throw new DesignError("Openings can't touch the outline or each other.");
    for (const other of holes.slice(0, i)) if (pointLocation(hole[0], other) >= 0 || pointLocation(other[0], hole) >= 0) throw new DesignError("Openings can't overlap.");
  });
  nodes.forEach((p, i) => {
    if (pointLocation(p, boundary) < 0 || holes.some((h) => pointLocation(p, h) >= 0)) throw new DesignError(`Node ${i + 1} is outside the concrete.`);
  });
  const members: [number, number][] = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (!visible(a, b, boundary, holes)) continue;
      const d = sub(b, a);
      const dd = d[0] * d[0] + d[1] * d[1];
      const through = nodes.some((p, k) => {
        if (k === i || k === j) return false;
        const v = sub(p, a);
        const t = (v[0] * d[0] + v[1] * d[1]) / dd;
        return Math.abs(cross(d, v)) < EPS && t > EPS && t < 1 - EPS;
      });
      if (!through) members.push([i, j]);
    }
  return members;
}

/** Nodes, members and supports checked as a model (members as sorted pairs, no repeats). */
export function topology(nodesIn: unknown, members: [number, number][], supports: [number, number][]) {
  const nodes = points(nodesIn, "Nodes", 2);
  const idx = (v: number, size: number, what: string) => {
    if (!Number.isInteger(v) || v < 0 || v >= size) throw new DesignError(`${what} refers to a node that doesn't exist.`);
    return v;
  };
  const edges: [number, number][] = [];
  for (const pair of members) {
    if (pair.length !== 2) throw new DesignError("A member joins two nodes.");
    const i = idx(pair[0], nodes.length, "A member");
    const j = idx(pair[1], nodes.length, "A member");
    if (i === j) throw new DesignError("A member can't start and end at the same node.");
    const e: [number, number] = i < j ? [i, j] : [j, i];
    if (edges.some((x) => x[0] === e[0] && x[1] === e[1])) throw new DesignError("A member is listed twice.");
    edges.push(e);
  }
  const restraints: [number, number][] = [];
  for (const s of supports) {
    const r: [number, number] = [idx(s[0], nodes.length, "A support"), idx(s[1], 2, "A support's direction")];
    if (restraints.some((x) => x[0] === r[0] && x[1] === r[1])) throw new DesignError("A support is listed twice.");
    restraints.push(r);
  }
  return { nodes, edges, restraints };
}
