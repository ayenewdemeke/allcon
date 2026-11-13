import type { AbutmentInputs } from "../foundations/abutment";
import { ABUTMENT_DEFAULTS } from "../foundations/abutment";
import type { FootingInputs } from "../foundations/footing";
import { FOOTING_DEFAULTS } from "../foundations/footing";
import { HP_SECTIONS } from "../foundations/hpile";
import type { PileInputs } from "../foundations/piles";
import { PILE_DEFAULTS } from "../foundations/piles";
import type { ShaftInputs } from "../foundations/shaft";
import { SHAFT_DEFAULTS } from "../foundations/shaft";
import { GIRDER_DEFAULTS, girderShape } from "../girders/prestressed";
import type { ApproachSlabInputs } from "../approach/approach-slab";
import { APPROACH_SLAB_DEFAULTS } from "../approach/approach-slab";
import { railDef } from "../decks/rails";
import { deckElevation, horizontalElements, offsetPoint, pointAt, profileAt, profileGeometry, sectionAt, stationOffset } from "./alignment";
import type { BridgeInputs, BridgeRun } from "./bridge";
import type { IfcRebar, RebarBox } from "./ifc-rebar";

// The Bridge as an IFC 4.3 model (phase 2, docs/bridge-model.md): a neutral description the IFC
// worker (api/_bridge.py) writes with IfcOpenShell: the alignment by the PI method (horizontal PIs
// and radii, vertical PVIs and curve lengths, the start station), the spatial structure (IfcBridge,
// its SUPERSTRUCTURE and SUBSTRUCTURE parts, an ABUTMENT or PIER part for each support), and each
// element as a profile swept along a local axis from a placement, with its IFC class and predefined
// type and property sets (its design, the ALLCON design's id and verdict, the CDOT pay item).
//
// Units: feet, the model's length unit. Coordinates: x east and y north from the first abutment's
// alignment point (its northing and easting kept in the site's property set), z the elevation.
// Level of development 300: each element at its designed size and place (decks flat across, along the
// span's grade; girders straight between their bearings, as precast girders are).

export type V3 = [number, number, number];
export type Profile =
  | { kind: "poly"; pts: [number, number][] } // ft, in the placement's x–y
  | { kind: "rect"; x: number; y: number } // centered
  | { kind: "circle"; r: number }
  | { kind: "ishape"; width: number; depth: number; web: number; flange: number }
  | { kind: "mesh"; pts: V3[]; tris: [number, number, number][] }; // a closed solid in the placement's frame (no sweep)
export type IfcElement = {
  cls: string;
  type: string;
  name: string;
  part: string; // the spatial part's key
  origin: V3;
  xdir: V3;
  zdir: V3; // the sweep's direction
  profile: Profile;
  depth: number; // ft, along zdir
  material: string;
  /** The surface colour the viewer draws it in (0–1 RGB): concrete, steel, elastomer told apart. */
  color?: [number, number, number];
  psets: Record<string, Record<string, string | number | boolean>>;
  /** ft, its run's length, for a swept element whose quantities need it (a barrier along the deck's edge). */
  length?: number;
  /** Its reinforcing bars (ifc-rebar.ts attachRebar): written as IfcReinforcingBar sets aggregated into it. */
  rebar?: IfcRebar;
  /** Where its bars are laid out, when its profile doesn't say (a deck span's surface solid). */
  box?: RebarBox;
};

/** Colours by what an element is, so the deck, girders, barriers and substructure read apart. */
export const COLORS = {
  deck: [0.78, 0.76, 0.72],
  girder: [0.62, 0.64, 0.68],
  barrier: [0.86, 0.85, 0.82],
  sub: [0.55, 0.55, 0.53],
  foundation: [0.47, 0.45, 0.42],
  steel: [0.36, 0.43, 0.52],
  bearing: [0.15, 0.15, 0.15],
  approach: [0.72, 0.7, 0.66],
} as const satisfies Record<string, [number, number, number]>;
/** A horizontal alignment segment as IfcAlignmentHorizontalSegment takes it: its start, direction (rad), radii (+ left, 0 straight) and length. */
export type IfcSegment = { type: "LINE" | "CIRCULARARC" | "CLOTHOID"; start: [number, number]; dir: number; r0: number; r1: number; length: number };
export type IfcPart = { key: string; type: "SUPERSTRUCTURE" | "SUBSTRUCTURE" | "ABUTMENT" | "PIER" | "FOUNDATION"; name: string; parent: string | null };
export type BridgeIfc = {
  name: string;
  origin: { northing: number; easting: number };
  alignment: { name: string; segments: IfcSegment[]; vpoints: [number, number][]; lengths: number[]; startStation: number };
  parts: IfcPart[];
  elements: IfcElement[];
};

export type BridgeComponents = {
  verdicts?: Record<string, string>; // design id → its verdict
  abutments?: Record<number, { id?: string | null; inputs?: AbutmentInputs } | undefined>;
  approachSlabs?: Record<number, { id?: string | null; inputs?: ApproachSlabInputs } | undefined>;
  foundations?: Record<number, { id?: string | null; kind: "spread-footing" | "pile-foundation" | "drilled-shaft"; inputs?: FootingInputs | PileInputs | ShaftInputs } | undefined>;
  deckId?: string | null;
  ids?: { girders?: (string | null)[]; caps?: Record<number, string | null>; columns?: Record<number, string | null> };
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => mul(a, 1 / Math.hypot(...a));
const UP: V3 = [0, 0, 1];
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const v3 = (a: V3): V3 => [r6(a[0]), r6(a[1]), r6(a[2])];

/**
 * A closed solid from a grid of top points (rows along the span, columns across), the bottom a thickness
 * below: its points and triangles (0-based, outward).
 */
export function gridSolid(top: V3[][], t: number) {
  const n = top.length;
  const m = top[0].length;
  const pts: V3[] = [...top.flat(), ...top.flat().map((p) => [p[0], p[1], p[2] - t] as V3)].map(v3);
  const T = (i: number, j: number) => i * m + j;
  const B = (i: number, j: number) => n * m + i * m + j;
  const tris: [number, number, number][] = [];
  const quad = (a: number, b: number, c: number, d: number) => tris.push([a, b, c], [a, c, d]);
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < m - 1; j++) {
      quad(T(i, j), T(i, j + 1), T(i + 1, j + 1), T(i + 1, j)); // rows run ahead, columns to the right: this way round faces up
      quad(B(i, j), B(i + 1, j), B(i + 1, j + 1), B(i, j + 1));
    }
  for (let i = 0; i < n - 1; i++) {
    quad(T(i, 0), T(i + 1, 0), B(i + 1, 0), B(i, 0)); // the left edge
    quad(T(i, m - 1), B(i, m - 1), B(i + 1, m - 1), T(i + 1, m - 1));
  }
  for (let j = 0; j < m - 1; j++) {
    quad(T(0, j), B(0, j), B(0, j + 1), T(0, j + 1)); // the back end
    quad(T(n - 1, j), T(n - 1, j + 1), B(n - 1, j + 1), B(n - 1, j));
  }
  return outward({ pts, tris });
}

/** A mesh's volume by the divergence theorem (+ when its faces point outward). */
export function meshVolume(pts: V3[], tris: [number, number, number][]) {
  return tris.reduce((v, [a, b, c]) => {
    const [p, q, r] = [pts[a], pts[b], pts[c]];
    return v + (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
  }, 0);
}

/** The same mesh with its faces turned outward (a viewer draws only a face's front). */
export function outward(m: { pts: V3[]; tris: [number, number, number][] }) {
  return meshVolume(m.pts, m.tris) < 0 ? { pts: m.pts, tris: m.tris.map(([a, b, c]) => [a, c, b] as [number, number, number]) } : m;
}

/** A simple polygon's triangles by ear clipping (indices into it), either winding. */
export function earcut(poly: [number, number][]): [number, number, number][] {
  const area = poly.reduce((s, p, k) => s + (poly[(k + poly.length - 1) % poly.length][0] - p[0]) * (poly[(k + poly.length - 1) % poly.length][1] + p[1]), 0);
  const idx = poly.map((_, k) => k);
  if (area < 0) idx.reverse(); // counterclockwise (the sum above is + for a counterclockwise outline)
  const cross = (a: number, b: number, c: number) => (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
  const inside = (p: number, a: number, b: number, c: number) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  const out: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length];
      const b = idx[k];
      const c = idx[(k + 1) % idx.length];
      if (cross(a, b, c) <= 1e-12) continue; // reflex
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break; // degenerate: give up on the rest
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/**
 * A closed solid swept through frames: the outline's (x, y) placed at each frame's point p + x·u + y·v, the
 * sides between frames, the ends capped. Outward-facing.
 */
export function sweepSolid(frames: { p: V3; u: V3; v: V3 }[], shape: [number, number][]) {
  // Counterclockwise, so the sides and the caps turn the same way (outward() then faces them all out).
  const signed = shape.reduce((t, p, k) => t + p[0] * shape[(k + 1) % shape.length][1] - shape[(k + 1) % shape.length][0] * p[1], 0);
  const outline = signed < 0 ? [...shape].reverse() : shape;
  const m = outline.length;
  const pts: V3[] = frames.flatMap((f) => outline.map(([x, y]) => v3([f.p[0] + x * f.u[0] + y * f.v[0], f.p[1] + x * f.u[1] + y * f.v[1], f.p[2] + x * f.u[2] + y * f.v[2]])));
  const tris: [number, number, number][] = [];
  for (let i = 0; i < frames.length - 1; i++)
    for (let j = 0; j < m; j++) {
      const a = i * m + j;
      const b = i * m + ((j + 1) % m);
      tris.push([a, b, b + m], [a, b + m, a + m]);
    }
  const cap = earcut(outline);
  const last = (frames.length - 1) * m;
  for (const [a, b, c] of cap) tris.push([a, c, b], [last + a, last + b, last + c]);
  return outward({ pts, tris });
}

/** The barrier's concrete outline (in, x from the deck's edge inward, y up from the deck's top) and steel, by rail. */
export function barrierShape(b: Pick<BridgeInputs, "rail" | "barrierWidth">) {
  const def = b.rail ? railDef(b.rail.type) : null;
  if (def) return { def, outline: def.outline.map(([x, y]) => [x, y] as [number, number]), name: def.name, payItem: def.payItem };
  // A generic 42 in parapet, the barrier width at its base, 9 in at its top.
  const w = Math.max(9, b.barrierWidth * 12);
  return { def: null, outline: [[0, 0], [w, 0], [w - 3, 10], [9, 42], [0, 42]] as [number, number][], name: "Concrete barrier", payItem: "606 (bridge rail)" };
}

/** A sweep's length through its frames' points (ft). */
const runLength = (frames: { p: V3 }[]) => r6(frames.slice(1).reduce((t, f, k) => t + Math.hypot(...sub(f.p, frames[k].p)), 0));

/** A horizontal frame: x along a plan direction, z up. */
const flat = (dirX: number, dirY: number) => ({ xdir: unit([dirX, dirY, 0]), zdir: UP });

export function bridgeIfc(b: BridgeInputs, run: BridgeRun, c: BridgeComponents = {}, name = "Bridge"): BridgeIfc {
  const lay = run.layout;
  const cache = horizontalElements(b.alignment);
  const vcs = profileGeometry(b.profile);
  const s0 = lay.supports[0];
  const O = { x: s0.x, y: s0.y };
  const P = (x: number, y: number, z: number): V3 => [x - O.x, y - O.y, z];
  const verdict = (id?: string | null) => (id && c.verdicts?.[id]) || "";
  const designPset = (kind: string, id?: string | null, extra: Record<string, string | number | boolean> = {}) => ({ ALLCON_Design: { DesignKind: kind, DesignId: id ?? "", Verdict: verdict(id), ...extra } });

  // --- the alignment: from 100 ft before the first abutment to 100 ft past the last, widened to take in
  // whole spirals and vertical curves; the horizontal layout element by element (lines, arcs, clothoids), the
  // vertical by its PVIs.
  let sA = lay.supports[0].station - 100;
  let sB = lay.supports[lay.supports.length - 1].station + 100;
  for (const e of cache.els) {
    if (e.kind === "spiral" && e.s0 < sA && e.s1 > sA) sA = e.s0;
    if (e.kind === "spiral" && e.s0 < sB && e.s1 > sB) sB = e.s1;
  }
  for (const v of vcs) {
    if (v.L > 0 && v.bvc < sA && v.evc > sA) sA = v.bvc - 10;
    if (v.L > 0 && v.bvc < sB && v.evc > sB) sB = v.evc + 10;
  }
  const segments: IfcSegment[] = [];
  for (const e of cache.els) {
    const s0 = Math.max(e.s0, sA);
    const s1 = Math.min(e.s1, sB);
    if (!(s1 - s0 > 1e-3)) continue;
    const p = pointAt(b.alignment, s0, cache);
    const dir = r6(((90 - p.az) * Math.PI) / 180); // IFC: radians counterclockwise from +x
    // IFC's radii: + turning left (counterclockwise), 0 straight.
    const signed = e.kind === "tangent" ? 0 : -e.turn * e.R;
    const seg = (type: IfcSegment["type"], r0: number, r1: number): IfcSegment => ({ type, start: [r6(p.x - O.x), r6(p.y - O.y)], dir, r0: r6(r0), r1: r6(r1), length: r6(s1 - s0) });
    if (e.kind === "tangent") segments.push(seg("LINE", 0, 0));
    else if (e.kind === "arc") segments.push(seg("CIRCULARARC", signed, signed));
    else segments.push(e.out ? seg("CLOTHOID", signed, 0) : seg("CLOTHOID", 0, signed));
  }
  const vsel = vcs.filter((v) => v.pvi > sA && v.pvi < sB);
  const vpoints: [number, number][] = [[0, profileAt(b.profile, sA, vcs).elevation], ...vsel.map((v) => [v.pvi - sA, v.elev] as [number, number]), [sB - sA, profileAt(b.profile, sB, vcs).elevation]];

  // --- spatial parts --------------------------------------------------------------------------------------------------
  const parts: IfcPart[] = [
    { key: "super", type: "SUPERSTRUCTURE", name: "Superstructure", parent: null },
    { key: "sub", type: "SUBSTRUCTURE", name: "Substructure", parent: null },
    ...lay.supports.map((s, i): IfcPart => ({ key: `support-${i}`, type: s.type.endsWith("abutment") ? "ABUTMENT" : "PIER", name: s.name, parent: "sub" })),
  ];
  const els: IfcElement[] = [];
  const shape = girderShape({ ...GIRDER_DEFAULTS, shape: b.shape });
  const outline: [number, number][] = [...shape.profile.map(([y, hw]) => [hw / 12, y / 12] as [number, number]), ...[...shape.profile].reverse().map(([y, hw]) => [-hw / 12, y / 12] as [number, number])];

  // --- girders, bearings and the deck, span by span ------------------------------------------------------------------
  for (const span of lay.spans) {
    const sa = lay.supports[span.index];
    const sb = lay.supports[span.index + 1];
    const gid = (() => {
      const g = run.groups.findIndex((x) => x.spans.includes(span.index));
      return c.ids?.girders?.[g] ?? null;
    })();
    for (const g of span.girders) {
      const zA = g.start.seat + sa.bearingHeight / 12; // the girder's bottom over each bearing
      const zB = g.end.seat + sb.bearingHeight / 12;
      const A = P(g.start.x, g.start.y, zA);
      const B = P(g.end.x, g.end.y, zB);
      const along = unit(sub(B, A));
      const start = sub(A, mul(along, sa.endDistance / Math.cos(Math.atan2(zB - zA, Math.hypot(B[0] - A[0], B[1] - A[1])))));
      const xdir = unit(cross(UP, along));
      els.push({
        cls: "IfcBeam",
        type: "GIRDER_SEGMENT",
        name: `Girder ${g.k + 1}, span ${span.index + 1}`,
        part: "super",
        origin: v3(start),
        xdir: v3(xdir),
        zdir: v3(along),
        profile: { kind: "poly", pts: outline },
        depth: r6(g.length),
        material: `Prestressed concrete (${shape.name})`,
        psets: designPset("lrfd-girder-check", gid, { Section: shape.name, SpanBearingToBearing: r6(g.L), PayItem: "618 (prestressed girder)" }),
      });
      for (const [pt, z, s, end] of [[A, zA, sa, "start"], [B, zB, sb, "end"]] as const) {
        els.push({
          cls: "IfcBearing",
          type: "ELASTOMERIC",
          name: `Bearing, girder ${g.k + 1}, span ${span.index + 1} ${end}`,
          part: "super",
          origin: v3([pt[0], pt[1], z - s.bearingHeight / 12]),
          ...flat(Math.sin((s.lineAz * Math.PI) / 180), Math.cos((s.lineAz * Math.PI) / 180)),
          profile: { kind: "rect", x: 2, y: 1 },
          depth: r6(Math.max(0.05, s.bearingHeight / 12)),
          material: "Elastomer",
          psets: designPset("elastomeric-bearing", null, { PayItem: "512 (bearing device)" }),
        });
      }
    }
    // The deck: its top on the profile and the crown, between the support lines and the deck's edges, a
    // surface along the alignment (its curves, vertical curves and cross slopes), the soffit deckT below it.
    const corner = (s: (typeof lay.supports)[number], o: number) => {
      const t = o / Math.cos((s.skew * Math.PI) / 180);
      return stationOffset(b.alignment, s.x + t * Math.sin((s.lineAz * Math.PI) / 180), s.y + t * Math.cos((s.lineAz * Math.PI) / 180), s.station, cache).station;
    };
    const oL = b.bridgeLineOffset - b.leftEdge;
    const oR = b.bridgeLineOffset + b.rightEdge;
    const crowns = [b.roadway.crownOffset, ...(b.roadway.sections ?? []).map((t) => t.crownOffset), sectionAt(b.roadway, sa.station).crownOffset, sectionAt(b.roadway, sb.station).crownOffset];
    const nAcross = Math.max(1, Math.ceil((oR - oL) / 6));
    const offs = [...new Set([...Array.from({ length: nAcross + 1 }, (_, k) => oL + ((oR - oL) * k) / nAcross), ...crowns.filter((c) => c > oL && c < oR)].map((o) => r6(o)))].sort((p, q) => p - q);
    const n = Math.max(2, Math.ceil((sb.station - sa.station) / 10) + 1);
    const top: V3[][] = Array.from({ length: n }, (_, k) =>
      offs.map((o) => {
        const st = corner(sa, o) + ((corner(sb, o) - corner(sa, o)) * k) / (n - 1);
        const p = offsetPoint(b.alignment, st, o, cache);
        return P(p.x, p.y, deckElevation(b.profile, b.roadway, st, o, vcs));
      }),
    );
    els.push({
      cls: "IfcSlab",
      type: "FLOOR",
      name: `Deck, span ${span.index + 1}`,
      part: "super",
      origin: [0, 0, 0],
      xdir: [1, 0, 0],
      zdir: UP,
      profile: { kind: "mesh", ...gridSolid(top, b.deckT / 12) },
      depth: r6(b.deckT / 12),
      material: `Concrete Class DF, f'c ${b.fcDeck} ksi`,
      color: [...COLORS.deck],
      psets: { ALLCON_Design: { DesignKind: "deck-slab", DesignId: c.deckId ?? "", Verdict: verdict(c.deckId), Thickness_in: b.deckT, PayItem: "601-03056 Concrete Class DF" } },
      box: deckBox(),
    });
    // The span's deck as a box for its bars: along the chord at mid-width, across the deck, its thickness.
    function deckBox(): RebarBox {
      const om = (oL + oR) / 2;
      const end = (s: typeof sa): V3 => {
        const st = corner(s, om);
        const p = offsetPoint(b.alignment, st, om, cache);
        return P(p.x, p.y, deckElevation(b.profile, b.roadway, st, om, vcs) - b.deckT / 24);
      };
      const [A, B] = [end(sa), end(sb)];
      const x = unit(sub(B, A));
      const y = unit(cross(UP, x));
      return { c: v3(mul([A[0] + B[0], A[1] + B[1], A[2] + B[2]], 0.5)), ax: [v3(x), v3(y), v3(cross(x, y))], half: [r6(Math.hypot(...sub(B, A)) / 2), r6((oR - oL) / 2), r6(b.deckT / 24)] };
    }
    // The bridge rail on both edges, swept along them on the deck's top (its traffic face inward).
    const railShape = barrierShape(b);
    for (const [side, o, inward] of [["left", oL, 1], ["right", oR, -1]] as const) {
      const frames = Array.from({ length: n }, (_, k) => {
        const st = corner(sa, o) + ((corner(sb, o) - corner(sa, o)) * k) / (n - 1);
        const p = offsetPoint(b.alignment, st, o, cache);
        const nAz = ((p.az + 90) * Math.PI) / 180; // to the right
        const u: V3 = [(inward * Math.sin(nAz)) / 12, (inward * Math.cos(nAz)) / 12, 0];
        return { p: P(p.x, p.y, deckElevation(b.profile, b.roadway, st, o, vcs)), u, v: [0, 0, 1 / 12] as V3 };
      });
      // The outline mirrored on the right edge keeps the sweep's faces consistent; outward() fixes any turn.
      els.push({
        cls: "IfcRailing",
        type: "GUARDRAIL",
        name: `${railShape.name}, ${side}, span ${span.index + 1}`,
        part: "super",
        origin: [0, 0, 0],
        xdir: [1, 0, 0],
        zdir: UP,
        profile: { kind: "mesh", ...sweepSolid(frames, railShape.outline) },
        depth: 1,
        length: runLength(frames),
        material: "Concrete Class D (Bridge)",
        color: [...COLORS.barrier],
        psets: { ALLCON_Design: { DesignKind: "bridge-rail", Rail: railShape.name, PayItem: railShape.payItem } },
      });
      // Steel tubes on a curb-and-post rail.
      for (const [t, tube] of (railShape.def?.posts?.tubes ?? []).entries()) {
        const box: [number, number][] = [[tube.x0, tube.y0], [tube.x1, tube.y0], [tube.x1, tube.y1], [tube.x0, tube.y1]];
        els.push({ cls: "IfcRailing", type: "GUARDRAIL", name: `${railShape.name} tube ${t + 1}, ${side}, span ${span.index + 1}`, part: "super", origin: [0, 0, 0], xdir: [1, 0, 0], zdir: UP, profile: { kind: "mesh", ...sweepSolid(frames, box) }, depth: 1, length: runLength(frames), material: "Structural steel (galvanized)", color: [...COLORS.steel], psets: { ALLCON_Design: { DesignKind: "bridge-rail", Rail: railShape.name, PayItem: railShape.payItem } } });
      }
    }
  }

  // --- each support's substructure -----------------------------------------------------------------------------------
  lay.supports.forEach((s, i) => {
    const part = `support-${i}`;
    const lineX = Math.sin((s.lineAz * Math.PI) / 180);
    const lineY = Math.cos((s.lineAz * Math.PI) / 180);
    // Along the bridge, horizontal: square to the support line, pointing ahead.
    const fw = { x: -lineY, y: lineX };
    const seats = [...(i > 0 ? lay.spans[i - 1].girders.map((g) => g.end.seat) : []), ...(i < lay.spans.length ? lay.spans[i].girders.map((g) => g.start.seat) : [])];
    const capTop = Math.min(...seats);
    const center = (along: number) => ({ x: s.x + along * lineX, y: s.y + along * lineY });
    const mid = b.bridgeLineOffset / Math.cos((s.skew * Math.PI) / 180);
    if (s.type.endsWith("abutment")) {
      const a = c.abutments?.[i]?.inputs ?? ABUTMENT_DEFAULTS;
      const aid = c.abutments?.[i]?.id ?? null;
      const length = (b.leftEdge + b.rightEdge) / Math.cos((s.skew * Math.PI) / 180);
      const integral = a.type.startsWith("integral");
      const cc = center(mid);
      const sign = i === 0 ? -1 : 1; // the abutment sits behind its bearings, toward the approach
      if (integral) {
        const bottom = capTop - a.capDepth;
        const cap = { x: cc.x + sign * fw.x * (a.capWidth / 2 - s.bearingOffset), y: cc.y + sign * fw.y * (a.capWidth / 2 - s.bearingOffset) };
        els.push({ cls: "IfcFooting", type: "PILE_CAP", name: `${s.name} pile cap`, part, origin: v3(P(cap.x, cap.y, bottom)), ...flat(lineX, lineY), profile: { kind: "rect", x: length, y: a.capWidth }, depth: a.capDepth, material: "Concrete Class D (Bridge)", psets: designPset("abutment", aid, { AbutmentType: a.type, PayItem: "601-03040 Concrete Class D (Bridge)" }) });
        const deckTop = profileAt(b.profile, s.station, vcs).elevation;
        els.push({ cls: "IfcBeam", type: "DIAPHRAGM", name: `${s.name} end diaphragm`, part, origin: v3(P(cap.x, cap.y, capTop)), ...flat(lineX, lineY), profile: { kind: "rect", x: length, y: a.capWidth }, depth: r6(Math.max(0.5, deckTop - b.deckT / 12 - capTop)), material: "Concrete Class D (Bridge)", psets: designPset("abutment", aid) });
        const n = a.type === "integral-piles" ? a.nPiles : a.nPiles;
        for (let k = 0; k < n; k++) {
          const t = -length / 2 + 1 + (k * (length - 2)) / Math.max(1, n - 1);
          const p = { x: cap.x + t * lineX, y: cap.y + t * lineY };
          if (a.type === "integral-piles") {
            const hp = HP_SECTIONS[a.section] ?? HP_SECTIONS["HP12x53"];
            els.push({ cls: "IfcPile", type: "DRIVEN", name: `${s.name} pile ${k + 1}`, part, origin: v3(P(p.x, p.y, bottom + a.embed / 12)), xdir: v3([lineX, lineY, 0]), zdir: [0, 0, -1], profile: { kind: "ishape", width: r6(hp.bf / 12), depth: r6(hp.d / 12), web: r6(hp.tw / 12), flange: r6(hp.tf / 12) }, depth: r6(a.pileLength + a.embed / 12), material: `Steel ${a.section} Grade 50`, psets: designPset("abutment", aid, { Section: a.section, PayItem: "502 Steel Piling" }) });
          } else {
            els.push({ cls: "IfcPile", type: "BORED", name: `${s.name} shaft ${k + 1}`, part, origin: v3(P(p.x, p.y, bottom)), xdir: v3([lineX, lineY, 0]), zdir: [0, 0, -1], profile: { kind: "circle", r: r6(a.shaftD / 24) }, depth: a.shaftLength, material: "Concrete (drilled shaft)", psets: designPset("abutment", aid, { Diameter_in: a.shaftD, PayItem: `503-000${a.shaftD}` }) });
          }
        }
      } else {
        const B = a.toe + a.stemT + a.heel;
        const footBottom = capTop - a.stemH - a.footT;
        const stem = { x: cc.x + sign * fw.x * (a.stemT / 2), y: cc.y + sign * fw.y * (a.stemT / 2) };
        els.push({ cls: "IfcWall", type: "RETAININGWALL", name: `${s.name} stem`, part, origin: v3(P(stem.x, stem.y, footBottom + a.footT)), ...flat(lineX, lineY), profile: { kind: "rect", x: length, y: a.stemT }, depth: a.stemH, material: "Concrete Class D (Bridge)", psets: designPset("abutment", aid, { AbutmentType: a.type }) });
        const bw = { x: stem.x + sign * fw.x * (a.stemT / 2 - a.backwallT / 2), y: stem.y + sign * fw.y * (a.stemT / 2 - a.backwallT / 2) };
        els.push({ cls: "IfcWall", type: "PARAPET", name: `${s.name} backwall`, part, origin: v3(P(bw.x, bw.y, capTop)), ...flat(lineX, lineY), profile: { kind: "rect", x: length, y: a.backwallT }, depth: a.backwallH, material: "Concrete Class D (Bridge)", psets: designPset("abutment", aid) });
        const fc = { x: stem.x + sign * fw.x * (a.heel - a.toe) / 2, y: stem.y + sign * fw.y * (a.heel - a.toe) / 2 };
        els.push({ cls: "IfcFooting", type: "STRIP_FOOTING", name: `${s.name} footing`, part, origin: v3(P(fc.x, fc.y, footBottom)), ...flat(lineX, lineY), profile: { kind: "rect", x: length, y: B }, depth: a.footT, material: "Concrete Class D (Bridge)", psets: designPset("abutment", aid) });
      }
      // The approach slab behind it.
      const ap = c.approachSlabs?.[i]?.inputs ?? APPROACH_SLAB_DEFAULTS;
      const apid = c.approachSlabs?.[i]?.id ?? null;
      const behind = (integral ? a.capWidth - s.bearingOffset : a.stemT) + ap.L / 2; // from the abutment's back face
      const back = { x: cc.x + sign * fw.x * behind, y: cc.y + sign * fw.y * behind };
      const zTop = profileAt(b.profile, s.station + sign * ap.L / 2, vcs).elevation;
      els.push({ cls: "IfcSlab", type: "APPROACH_SLAB", name: `${s.name} approach slab`, part, origin: v3(P(back.x, back.y, zTop - ap.t / 12)), ...flat(lineX, lineY), profile: { kind: "rect", x: length, y: ap.L }, depth: r6(ap.t / 12), material: "Concrete Class DF", psets: designPset("approach-slab", apid, { PayItem: "601-03056 Concrete Class DF" }) });
      return;
    }
    // A pier: its cap, columns and foundations.
    const p = s.pier;
    const lp = lay.piers[i];
    if (!p || !lp) return;
    const capC = center(mid);
    const capId = c.ids?.caps?.[i] ?? null;
    const colId = c.ids?.columns?.[i] ?? null;
    els.push({ cls: "IfcBeam", type: "PIERCAP", name: `${s.name} cap`, part, origin: v3(P(capC.x, capC.y, lp.soffit)), ...flat(lineX, lineY), profile: { kind: "rect", x: p.capLength, y: p.capWidth / 12 }, depth: p.capDepth, material: "Concrete Class D (Bridge)", psets: designPset("stm-d-region", capId, { CapType: p.kind, PayItem: "601-03040 Concrete Class D (Bridge)" }) });
    const xs = p.kind === "hammerhead" ? [p.capLength / 2] : lp.columnsX;
    const f = c.foundations?.[i];
    xs.forEach((x, k) => {
      const t = x - p.capLength / 2;
      const q = { x: capC.x + t * lineX, y: capC.y + t * lineY };
      els.push({ cls: "IfcColumn", type: "PIERSTEM", name: `${s.name} column ${k + 1}`, part, origin: v3(P(q.x, q.y, lp.foundationTop)), ...flat(lineX, lineY), profile: p.columnShape === "round" ? { kind: "circle", r: r6(p.columnSize / 24) } : { kind: "rect", x: p.columnSize / 12, y: p.columnDepth / 12 }, depth: r6(lp.columnHeight), material: "Concrete Class D (Bridge)", psets: designPset("pier-column", colId, { PayItem: "601-03040 Concrete Class D (Bridge)" }) });
      if (p.foundation === "drilled-shaft") {
        const sh = (f?.kind === "drilled-shaft" ? (f.inputs as ShaftInputs) : null) ?? SHAFT_DEFAULTS;
        els.push({ cls: "IfcPile", type: "BORED", name: `${s.name} shaft ${k + 1}`, part, origin: v3(P(q.x, q.y, lp.foundationTop)), xdir: v3([lineX, lineY, 0]), zdir: [0, 0, -1], profile: { kind: "circle", r: r6(sh.D / 24) }, depth: sh.length, material: "Concrete (drilled shaft)", psets: designPset("drilled-shaft", f?.id, { Diameter_in: sh.D, PayItem: `503-000${sh.D}` }) });
      } else if (p.foundation === "pile-foundation") {
        const pf = (f?.kind === "pile-foundation" ? (f.inputs as PileInputs) : null) ?? PILE_DEFAULTS;
        const capB = (pf.nB - 1) * pf.sB + 2 * pf.edge;
        const capL = (pf.nL - 1) * pf.sL + 2 * pf.edge;
        const bot = lp.foundationTop - pf.capT / 12;
        els.push({ cls: "IfcFooting", type: "PILE_CAP", name: `${s.name} pile cap ${k + 1}`, part, origin: v3(P(q.x, q.y, bot)), ...flat(lineX, lineY), profile: { kind: "rect", x: capB, y: capL }, depth: r6(pf.capT / 12), material: "Concrete Class D (Bridge)", psets: designPset("pile-foundation", f?.id, { PayItem: "601-03040 Concrete Class D (Bridge)" }) });
        const hp = HP_SECTIONS[pf.section] ?? HP_SECTIONS["HP12x53"];
        for (let a = 0; a < pf.nB; a++)
          for (let bb = 0; bb < pf.nL; bb++) {
            const u = -((pf.nB - 1) * pf.sB) / 2 + a * pf.sB;
            const w = -((pf.nL - 1) * pf.sL) / 2 + bb * pf.sL;
            const pp = { x: q.x + u * lineX + w * fw.x, y: q.y + u * lineY + w * fw.y };
            els.push({ cls: "IfcPile", type: "DRIVEN", name: `${s.name} pile ${k + 1}-${a * pf.nL + bb + 1}`, part, origin: v3(P(pp.x, pp.y, bot + pf.embed / 12)), xdir: v3([lineX, lineY, 0]), zdir: [0, 0, -1], profile: { kind: "ishape", width: r6(hp.bf / 12), depth: r6(hp.d / 12), web: r6(hp.tw / 12), flange: r6(hp.tf / 12) }, depth: r6(pf.length + pf.embed / 12), material: `Steel ${pf.section} Grade 50`, psets: designPset("pile-foundation", f?.id, { Section: pf.section, PayItem: "502 Steel Piling" }) });
          }
      } else {
        const ft = (f?.kind === "spread-footing" ? (f.inputs as FootingInputs) : null) ?? FOOTING_DEFAULTS;
        els.push({ cls: "IfcFooting", type: "PAD_FOOTING", name: `${s.name} footing ${k + 1}`, part, origin: v3(P(q.x, q.y, lp.foundationTop - ft.t / 12)), ...flat(lineX, lineY), profile: { kind: "rect", x: ft.B, y: ft.L }, depth: r6(ft.t / 12), material: "Concrete Class D (Bridge)", psets: designPset("spread-footing", f?.id, { PayItem: "601-03040 Concrete Class D (Bridge)" }) });
      }
    });
  });

  // Every element a colour by what it is.
  for (const e of els) {
    if (e.color) continue;
    const col =
      e.cls === "IfcBearing" ? COLORS.bearing
      : e.cls === "IfcBeam" && e.type === "GIRDER_SEGMENT" ? COLORS.girder
      : e.cls === "IfcPile" && e.type === "DRIVEN" ? COLORS.steel
      : e.cls === "IfcPile" || e.cls === "IfcFooting" ? COLORS.foundation
      : e.cls === "IfcSlab" ? COLORS.approach
      : COLORS.sub;
    e.color = [...col];
  }

  return {
    name,
    origin: { northing: s0.y, easting: s0.x },
    alignment: { name: "Alignment", segments, vpoints: vpoints.map(([d, z]) => [r6(d), r6(z)]), lengths: vsel.map((v) => v.L), startStation: sA },
    parts,
    elements: els,
  };
}
