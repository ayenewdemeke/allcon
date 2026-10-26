import { angleInSweep, arcEnd, arcMid, arcStart, closestOnPrimitive, dist, intersect, mid, polar, polylineSegments, primitives, type Primitive } from "./geometry";
import type { Entity, Vec } from "./types";

// Object snaps, as in AutoCAD: the snap point nearest the cursor within the aperture wins,
// "nearest" only when nothing else is close, and a circle or arc offers its centre when the
// cursor is over its edge.

export type SnapKind = "endpoint" | "midpoint" | "center" | "quadrant" | "intersection" | "perpendicular" | "nearest";
export type Snap = { point: Vec; kind: SnapKind };

export const SNAP_KINDS: { kind: SnapKind; label: string }[] = [
  { kind: "endpoint", label: "Endpoint" },
  { kind: "midpoint", label: "Midpoint" },
  { kind: "center", label: "Center" },
  { kind: "quadrant", label: "Quadrant" },
  { kind: "intersection", label: "Intersection" },
  { kind: "perpendicular", label: "Perpendicular" },
  { kind: "nearest", label: "Nearest" },
];

/** AutoCAD's default running snaps. */
export const DEFAULT_SNAPS: SnapKind[] = ["endpoint", "midpoint", "center", "intersection"];

type Candidate = Snap & { score: number };

function pointSnaps(e: Entity, kinds: Set<SnapKind>): Snap[] {
  const out: Snap[] = [];
  const push = (kind: SnapKind, point: Vec) => kinds.has(kind) && out.push({ kind, point });
  switch (e.type) {
    case "line":
      push("endpoint", e.a);
      push("endpoint", e.b);
      push("midpoint", mid(e.a, e.b));
      break;
    case "polyline":
      e.points.forEach((p) => push("endpoint", p));
      polylineSegments(e.points, e.closed).forEach((s) => push("midpoint", mid(s.a, s.b)));
      break;
    case "circle":
      for (let q = 0; q < 4; q++) push("quadrant", polar(e.center, (q * Math.PI) / 2, e.radius));
      break;
    case "arc":
      push("endpoint", arcStart(e));
      push("endpoint", arcEnd(e));
      push("midpoint", arcMid(e));
      for (let q = 0; q < 4; q++) {
        const a = (q * Math.PI) / 2;
        if (angleInSweep(a, e.start, e.end)) push("quadrant", polar(e.center, a, e.radius));
      }
      break;
  }
  return out;
}

function perpendicularFoot(from: Vec, prim: Primitive): Vec | null {
  if (prim.kind === "seg") {
    const foot = closestOnPrimitive(from, prim);
    return foot === prim.a || foot === prim.b ? null : foot;
  }
  return closestOnPrimitive(from, prim);
}

export function findSnap(entities: Entity[], cursor: Vec, aperture: number, kinds: Set<SnapKind>, from: Vec | null): Snap | null {
  const candidates: Candidate[] = [];
  const consider = (kind: SnapKind, point: Vec, score = dist(point, cursor)) => {
    if (score <= aperture) candidates.push({ kind, point, score });
  };
  const near: { e: Entity; prims: Primitive[] }[] = [];

  for (const e of entities) {
    const prims = primitives(e);
    const edge = Math.min(...prims.map((p) => dist(cursor, closestOnPrimitive(cursor, p))));
    if (edge <= aperture) near.push({ e, prims });
    for (const s of pointSnaps(e, kinds)) consider(s.kind, s.point);
    if (kinds.has("center") && (e.type === "circle" || e.type === "arc")) {
      // Over the edge or the centre itself; a little behind real points on the edge.
      consider("center", e.center, Math.min(dist(e.center, cursor), edge + aperture * 0.3));
    }
    if (kinds.has("perpendicular") && from && edge <= aperture) {
      for (const p of prims) {
        const foot = perpendicularFoot(from, p);
        if (foot) consider("perpendicular", foot, dist(foot, cursor) + aperture * 0.2);
      }
    }
    if (kinds.has("nearest") && edge <= aperture) {
      for (const p of prims) consider("nearest", closestOnPrimitive(cursor, p), dist(cursor, closestOnPrimitive(cursor, p)) + aperture * 0.5);
    }
  }

  if (kinds.has("intersection")) {
    const prims = near.flatMap((n) => n.prims.map((p) => ({ p, owner: n.e.id })));
    for (let i = 0; i < prims.length; i++) {
      for (let j = i + 1; j < prims.length; j++) {
        // Neighbouring polyline segments meet at a vertex: the endpoint, found first, wins the tie.
        for (const point of intersect(prims[i].p, prims[j].p)) consider("intersection", point);
      }
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  return best ? { kind: best.kind, point: best.point } : null;
}
