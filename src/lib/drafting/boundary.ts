import RBush from "rbush";
import { intersect, isAnnotation, tessellate, textBoxes, type Segment } from "./geometry";
import type { Entity, Vec } from "./types";

// Hatch boundaries from a picked point, as AutoCAD's "Pick internal point": the linework around
// it becomes a network (split where lines cross), dead ends are dropped, and the smallest
// enclosed area around the point is traced. Closed shapes and text inside it become islands, so
// the hatch leaves a clear box around a room name, as AutoCAD does.

const closedShape = (e: Entity) =>
  e.type === "circle" || (e.type === "polyline" && e.closed) || (e.type === "ellipse" && Math.abs(e.end - e.start) >= Math.PI * 2 - 1e-9) || (e.type === "spline" && e.closed);

function insidePolygon(p: Vec, poly: Vec[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const signedArea = (poly: Vec[]) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
};

/** The loops enclosing `p` (the boundary first, then islands), or null if `p` isn't enclosed. */
export function findBoundary(entities: Entity[], p: Vec, tolerance: number): Vec[][] | null {
  const shapes = entities.filter((e) => !isAnnotation(e) && e.type !== "xline" && e.type !== "ray");
  // Every object as segments.
  type Seg = { a: Vec; b: Vec; minX: number; minY: number; maxX: number; maxY: number; i: number };
  const segs: Seg[] = [];
  for (const e of shapes) {
    for (const line of tessellate(e)) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [a, b] = [line[i], line[i + 1]];
        if (Math.hypot(a.x - b.x, a.y - b.y) < tolerance) continue;
        segs.push({ a, b, minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y), i: segs.length });
      }
    }
  }
  if (segs.length > 60000) return null;
  const tree = new RBush<Seg>();
  tree.load(segs);
  // Split each segment where others cross it.
  const cutsOn: number[][] = segs.map(() => [0, 1]);
  for (const s of segs) {
    for (const o of tree.search(s)) {
      if (o.i <= s.i) continue;
      const hits = intersect({ kind: "seg", a: s.a, b: s.b } as Segment, { kind: "seg", a: o.a, b: o.b } as Segment);
      for (const h of hits) {
        const ts = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
        const to = Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y);
        cutsOn[s.i].push(Math.hypot(h.x - s.a.x, h.y - s.a.y) / ts);
        cutsOn[o.i].push(Math.hypot(h.x - o.a.x, h.y - o.a.y) / to);
      }
    }
  }
  // Nodes, merged within the tolerance.
  const nodes: Vec[] = [];
  const index = new Map<string, number>();
  const nodeAt = (v: Vec) => {
    const key = `${Math.round(v.x / tolerance)},${Math.round(v.y / tolerance)}`;
    let id = index.get(key);
    if (id === undefined) {
      id = nodes.length;
      nodes.push(v);
      index.set(key, id);
    }
    return id;
  };
  const edges = new Set<string>();
  const adj = new Map<number, Set<number>>();
  const link = (u: number, v: number) => {
    if (u === v) return;
    const key = u < v ? `${u}-${v}` : `${v}-${u}`;
    if (edges.has(key)) return;
    edges.add(key);
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  };
  segs.forEach((s, i) => {
    const ts = [...new Set(cutsOn[i].map((t) => Math.min(1, Math.max(0, t))))].sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const a = { x: s.a.x + (s.b.x - s.a.x) * ts[k], y: s.a.y + (s.b.y - s.a.y) * ts[k] };
      const b = { x: s.a.x + (s.b.x - s.a.x) * ts[k + 1], y: s.a.y + (s.b.y - s.a.y) * ts[k + 1] };
      link(nodeAt(a), nodeAt(b));
    }
  });
  // Drop dead ends.
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [u, ns] of adj) {
      if (ns.size < 2) {
        for (const v of ns) adj.get(v)?.delete(u);
        adj.delete(u);
        pruned = true;
      }
    }
  }
  // The nearest edge to the right of the point.
  let start: [number, number] | null = null;
  let nearest = Infinity;
  for (const [u, ns] of adj) {
    for (const v of ns) {
      if (u > v) continue;
      const a = nodes[u];
      const b = nodes[v];
      if (a.y > p.y === b.y > p.y) continue;
      const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (x > p.x && x - p.x < nearest) {
        nearest = x - p.x;
        // Travel so the point is on the left.
        start = b.y > a.y ? [u, v] : [v, u];
      }
    }
  }
  if (!start) return null;
  // Trace the face on the left: at each node, the edge furthest clockwise from where we came.
  const loop: Vec[] = [];
  let [from, at] = start;
  for (let guard = 0; guard < 200000; guard++) {
    loop.push(nodes[from]);
    const back = Math.atan2(nodes[from].y - nodes[at].y, nodes[from].x - nodes[at].x);
    let best = -1;
    let bestTurn = Infinity;
    for (const next of adj.get(at) ?? []) {
      if (next === from && (adj.get(at)?.size ?? 0) > 1) continue;
      const angle = Math.atan2(nodes[next].y - nodes[at].y, nodes[next].x - nodes[at].x);
      // Clockwise from the way back, in (0, 2π].
      let turn = back - angle;
      while (turn <= 1e-12) turn += Math.PI * 2;
      while (turn > Math.PI * 2) turn -= Math.PI * 2;
      if (turn < bestTurn) {
        bestTurn = turn;
        best = next;
      }
    }
    if (best < 0) return null;
    [from, at] = [at, best];
    if (from === start[0] && at === start[1]) break;
  }
  if (loop.length < 3 || signedArea(loop) <= 0 || !insidePolygon(p, loop)) return null;
  // Islands: closed shapes wholly inside the boundary (not around the point).
  const islands: Vec[][] = [];
  for (const e of shapes) {
    if (!closedShape(e)) continue;
    const pts = tessellate(e)[0];
    const ring = pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y ? pts.slice(0, -1) : pts;
    if (ring.length < 3 || insidePolygon(p, ring)) continue;
    if (ring.every((q) => insidePolygon(q, loop))) islands.push(ring);
  }
  for (const e of entities) {
    if (e.type === "hatch") continue;
    for (const box of textBoxes(e)) if (!insidePolygon(p, box) && box.every((q) => insidePolygon(q, loop))) islands.push(box);
  }
  return [loop, ...islands];
}

/** Loops from closed objects (Select objects), the largest first. */
export function loopsFromObjects(entities: Entity[]): Vec[][] {
  return entities
    .filter(closedShape)
    .map((e) => {
      const pts = tessellate(e)[0];
      return pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y ? pts.slice(0, -1) : pts;
    })
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
}
