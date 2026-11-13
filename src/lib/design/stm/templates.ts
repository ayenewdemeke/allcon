import { DesignError } from "../walls/cip";
import { BARS } from "./aashto";
import { capLoadCases, type GirderLink, type GirderSide } from "./cap-loads";
import type { Pt } from "./geometry";
import type { StmInputs, StmNode, StmNodeCheck, StmTie } from "./strut-tie";

// Standard pier caps as strut-and-tie models, built from their main dimensions: a hammerhead (one
// column, a cantilever each side, optionally tapered) or a multi-column bent cap. The layout
// follows AASHTO C5.8.2.2: ties on the bars' centroids, struts along the load path, and as few
// panels as keep each strut-tie angle above 25° (5.8.2.2). Each bearing's load goes by a direct
// strut to its column where that strut is steep enough; otherwise it steps inward panel by panel
// (a vertical tie of stirrups at each panel point, using inner bearings as panel points where it
// can). A hammerhead follows FHWA-NHI-17-071 Design Example 2 (TxDOT 5-5253-01 Example 2): bearings
// close together resolved into one load, the top tie on the top bars' centroid, the bottom strut at
// a/2 with a from the moment its node's back face holds (jd as large as the node allows), two column
// struts from the column's linear stress one column width below the cap (C5.5.1.2.1) and a tie at
// the lighter face's bars, each load a direct strut to its own column node; a bent cap's columns are
// each one node at the column's centerline. Feet for geometry, inches for details, kips.

/** An inverted-T cap's ledges (5.8.4.3): the girders bear on them, and hangers carry their loads up the stem. */
export type LedgeTemplate = {
  depth: number; // in, the ledge's depth hf
  projection: number; // in, each ledge's projection from the stem's face bl
  av: number; // in, the stem's face to the bearings' centerline
  cover: number; // in, top of the ledge to its primary bars' centroid
  primary: { size: number; spacing: number }; // ledge bars across the stem's face
  ties: { size: number; spacing: number }; // closed ties in the ledge
  hangers: { size: number; spacing: number }; // hanger stirrups (two legs each)
};

export type StmTemplate = {
  kind: "hammerhead" | "multicolumn" | "inverted-t" | "abutment";
  ledge?: LedgeTemplate;
  length: number; // ft, the cap's length
  depth: number; // ft, at the columns
  tipDepth: number; // ft, at the cap's ends (a tapered hammerhead); a bent cap uses `depth`
  capWidth: number; // in, out of plane
  columns: number[]; // ft, column centerlines from the cap's left end
  columnWidth: number; // ft, in the cap's plane
  columnModel: "single" | "two"; // kept for saved designs; a bent cap's columns are single nodes, a hammerhead's from its stress diagram
  columnBarInset: number; // in, a hammerhead column's face to its bars' centroid (the tie at the lighter face)
  direction: "auto" | "left" | "right"; // a hammerhead's model: laid out for the cases turning it most, or toward one side
  layoutSign?: 1 | -1; // set when built: the heavier arm's side the model is laid out for (+1 right)
  topCover: number; // in, top of the cap to the top bars' centroid
  bottomCover: number; // in, soffit to the bottom chord's centroid (a hammerhead's, where its bottom strut is entered)
  bottomChord?: "auto" | "entered"; // a hammerhead's bottom strut: at a/2, a from the moment its node's back face holds (FHWA, TxDOT), or at bottomCover
  chordHeight?: number; // in, set when built: soffit to the bottom chord's line
  resolveWithin?: number | null; // ft, a hammerhead's bearings closer than this resolve into one load at their resultant; null: half the depth at the column
  bearings: { x: number; P: number }[]; // ft from the left end; factored kip, down
  bearingLength: number; // in, along the cap
  bearingWidth: number; // in, across the cap
  topBars: { size: number; count: number };
  bottomBars: { size: number; count: number };
  stirrups: { size: number; legs: number; spacing: number }; // in
  sideCover: number; // in, clear cover to the stirrups at the sides, top and ends (the bars' fit and anchorage)
  barEnds: "hook" | "straight"; // how the top and bottom bars end at the cap's ends
};

export const HAMMERHEAD_DEFAULTS: StmTemplate = {
  kind: "hammerhead",
  length: 40,
  depth: 7,
  tipDepth: 4,
  capWidth: 72,
  columns: [20],
  columnWidth: 6,
  columnModel: "two",
  columnBarInset: 8,
  direction: "auto",
  topCover: 6,
  bottomCover: 8,
  bottomChord: "auto",
  resolveWithin: null,
  bearings: [
    { x: 4, P: 600 },
    { x: 13, P: 600 },
    { x: 27, P: 600 },
    { x: 36, P: 600 },
  ],
  bearingLength: 24,
  bearingWidth: 30,
  topBars: { size: 11, count: 26 },
  bottomBars: { size: 9, count: 8 },
  stirrups: { size: 5, legs: 4, spacing: 6 },
  sideCover: 2,
  barEnds: "hook",
};

export const MULTICOLUMN_DEFAULTS: StmTemplate = {
  kind: "multicolumn",
  length: 56,
  depth: 4.5,
  tipDepth: 4.5,
  capWidth: 48,
  columns: [8, 28, 48],
  columnWidth: 3.5,
  columnModel: "single",
  columnBarInset: 8,
  direction: "auto",
  topCover: 5,
  bottomCover: 5,
  bearings: [4, 13, 22, 34, 43, 52].map((x) => ({ x, P: 250 })),
  bearingLength: 16,
  bearingWidth: 24,
  topBars: { size: 10, count: 8 },
  bottomBars: { size: 10, count: 8 },
  stirrups: { size: 5, legs: 4, spacing: 6 },
  sideCover: 2,
  barEnds: "hook",
};

/** An inverted-T bent cap: a stem (the cap's width) with a ledge each side carrying the girders. */
export const INVERTED_T_DEFAULTS: StmTemplate = {
  ...MULTICOLUMN_DEFAULTS,
  kind: "inverted-t",
  depth: 5,
  tipDepth: 5,
  capWidth: 36,
  bearingLength: 16,
  bearingWidth: 12,
  ledge: { depth: 24, projection: 24, av: 12, cover: 3, primary: { size: 6, spacing: 6 }, ties: { size: 5, spacing: 6 }, hangers: { size: 5, spacing: 4 } },
};

/** A stub or semi-integral abutment's cap on a row of piles: the piles are its supports. */
export const ABUTMENT_DEFAULTS: StmTemplate = {
  ...MULTICOLUMN_DEFAULTS,
  kind: "abutment",
  length: 44,
  depth: 3.5,
  tipDepth: 3.5,
  capWidth: 36,
  columns: [2, 9, 16, 22, 28, 35, 42],
  columnWidth: 1.17,
  bearings: [4, 13, 22, 31, 40].map((x) => ({ x, P: 150 })),
  bearingLength: 14,
  bearingWidth: 20,
  topBars: { size: 8, count: 6 },
  bottomBars: { size: 8, count: 6 },
};

const MIN_ANGLE = (27 * Math.PI) / 180; // struts kept steeper than 27°, a margin over the 25° limit
const MAX_TAN = Math.tan(MIN_ANGLE);

/** Where the girders' bearings fall on the cap, from the girder link (ft from the cap's left end, as the link places them). */
export function bearingsFromLink(link: GirderLink): number[] {
  const sides = [link.back, link.ahead].filter((s): s is GirderSide => !!s);
  const xs: number[] = [];
  for (const s of sides)
    for (let g = 0; g < s.n; g++) {
      const z = -((s.n - 1) * s.S) / 2 + g * s.S;
      xs.push(link.x0 + ((link.reverse ? -1 : 1) * z) / Math.cos((s.skew * Math.PI) / 180));
    }
  return [...new Set(xs.map((x) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * The template's bearings as the model's load points (ft; kip; in): within 0.25 ft merged, and a
 * hammerhead's closer than `resolveWithin` (half the depth at the column by default) resolved into
 * one load at their resultant, as FHWA and TxDOT resolve loads in close proximity. A resolved load's
 * bearing face is its bearings' lengths together, no longer than they span.
 */
export function resolveBearings(t: StmTemplate) {
  const tol = t.kind === "hammerhead" ? Math.max(0.25, t.resolveWithin ?? t.depth / 2) : 0.25;
  const groups: { x: number; P: number; xs: number[]; Ps: number[] }[] = [];
  for (const b of [...t.bearings].sort((p, q) => p.x - q.x)) {
    const g = groups[groups.length - 1];
    if (g && b.x - g.xs[0] < tol - 1e-9) {
      g.xs.push(b.x);
      g.Ps.push(b.P);
    } else groups.push({ x: b.x, P: b.P, xs: [b.x], Ps: [b.P] });
  }
  return groups.map((g) => {
    const P = g.Ps.reduce((s, p) => s + p, 0);
    const x = P > 0 ? g.xs.reduce((s, xi, k) => s + xi * g.Ps[k], 0) / P : g.xs.reduce((s, xi) => s + xi, 0) / g.xs.length;
    const span = (g.xs[g.xs.length - 1] - g.xs[0]) * 12;
    return { x: round(x), P, count: g.xs.length, width: g.xs.length > 1 ? Math.min(g.xs.length * t.bearingLength, span + t.bearingLength) : t.bearingLength };
  });
}

/** The load cases the layout is drawn for: the girder link's Strength I cases (on the bearings), or the bearings' entered loads. */
function layoutCases(t: StmTemplate, base: StmInputs, bearings: { x: number; P: number; node: string }[], outline: Pt[], yT: number, c: number) {
  const link = base.girders;
  if (link?.enabled && (link.back || link.ahead)) {
    const nodes = bearings.map((b) => ({ label: b.node, x: b.x, y: yT }));
    const cl = capLoadCases({ ...link, loadNodes: bearings.map((b) => b.node) }, nodes, outline, t.capWidth, c);
    return cl.cases.map((k) => ({ name: k.name, loads: k.loads.map((l) => ({ x: bearings.find((b) => b.node === l.node)!.x, P: -l.fy })) }));
  }
  return [{ name: "Strength I", loads: bearings.map((b) => ({ x: b.x, P: b.P })) }];
}

/** The model for a template, replacing the geometry, layout, ties, node checks and entered loads. */
export function buildTemplate(t: StmTemplate, base: StmInputs): StmInputs {
  const L = t.length;
  const cols = [...t.columns].sort((a, b) => a - b);
  const wc = t.columnWidth;
  if (!(L > 0 && t.depth > 0 && wc > 0)) throw new DesignError("Give the cap's length and depth and the columns' width.");
  if (!cols.length) throw new DesignError("Give at least one column.");
  if (cols[0] - wc / 2 < -1e-9 || cols[cols.length - 1] + wc / 2 > L + 1e-9) throw new DesignError("Every column must sit within the cap's length.");
  for (let k = 1; k < cols.length; k++) if (cols[k] - cols[k - 1] < wc + 1) throw new DesignError("The columns overlap or are closer than a foot apart.");
  const tip = t.kind === "hammerhead" ? t.tipDepth : t.depth;
  if (!(tip > 0) || tip > t.depth) throw new DesignError("The depth at the ends must be positive and no more than at the column.");
  if ((t.topCover + t.bottomCover) / 12 >= tip * 0.8) throw new DesignError("The covers to the top and bottom chords leave too little depth.");
  if (!t.bearings.length) throw new DesignError("Give the bearings.");
  for (const b of t.bearings) if (!(b.x > 0 && b.x < L)) throw new DesignError("Every bearing must be on the cap.");

  const two = t.kind === "hammerhead"; // a bent cap's columns are single nodes (gravity bents)
  const faceL = cols[0] - wc / 2;
  const faceR = cols[cols.length - 1] + wc / 2;
  const rise = t.depth - tip;
  const soffit = (x: number) => (x < faceL && faceL > 0 ? (rise * (faceL - x)) / faceL : x > faceR && L > faceR ? (rise * (x - faceR)) / (L - faceR) : 0);
  const yT = t.depth - t.topCover / 12;
  let bc = t.bottomCover / 12; // soffit to the bottom chord: a hammerhead's worked out below unless entered
  const yB = (x: number) => soffit(x) + bc;
  const h = (x: number) => yT - yB(x);
  const dcol = wc; // the disturbed region reaches one column width below the cap

  // Outline: left along the soffit, down and up around each column, then the right end and the top.
  const outline: Pt[] = [];
  const push = (p: Pt) => {
    const last = outline[outline.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) outline.push([round(p[0]), round(p[1])]);
  };
  push([0, soffit(0)]);
  for (const c of cols) {
    push([c - wc / 2, 0]);
    push([c - wc / 2, -dcol]);
    push([c + wc / 2, -dcol]);
    push([c + wc / 2, 0]);
  }
  push([L, soffit(L)]);
  push([L, t.depth]);
  push([0, t.depth]);

  // Nodes: tops on the top bars' line, bottoms on the bottom chord, found again within 0.25 ft.
  const nodes: StmNode[] = [];
  const tops: { label: string; x: number }[] = [];
  const bottoms: { label: string; x: number; col: number | null }[] = [];
  const topAt = (x: number) => {
    const found = tops.find((n) => Math.abs(n.x - x) < 0.25);
    if (found) return found.label;
    const label = `T${tops.length + 1}`;
    tops.push({ label, x });
    nodes.push({ label, x: round(x), y: round(yT) });
    return label;
  };
  const bottomAt = (x: number, col: number | null = null) => {
    const found = bottoms.find((n) => Math.abs(n.x - x) < 0.25);
    if (found) return found;
    const label = col === null ? `M${bottoms.filter((n) => n.col === null).length + 1}` : `C${bottoms.filter((n) => n.col !== null).length + 1}`;
    const n = { label, x, col };
    bottoms.push(n);
    nodes.push({ label, x: round(x), y: round(yB(x)) });
    return n;
  };

  // Bearings, merged or resolved (resolveBearings), each a top node.
  const bearings = resolveBearings(t).map((b) => ({ ...b, node: "" }));
  for (const b of bearings) b.node = topAt(b.x);

  // Column nodes on the bottom chord. A bent cap's: one at each column's centerline. A hammerhead's,
  // by FHWA's method (Design Example 2): the column's linear stress where the disturbed region ends
  // (one column width below the cap), P/A ± Mc/I, for the case that turns the column most; its
  // compression split into the part carrying the heavier arm and the rest, a strut at each part's
  // centroid, each node as wide as its part; and a tie at the lighter face's bars.
  type Target = { label: string; x: number; col: number | null; width: number };
  let colNodes: Target[];
  let hammer: { c: number; L: Target; R: Target; tieL: number; tieR: number; governing: string; sign: 1 | -1 } | null = null;
  if (two) {
    const c = cols[0];
    const all = layoutCases(t, base, bearings, outline, yT, c);
    const moment = (k: (typeof all)[number]) => k.loads.reduce((m, l) => m + l.P * (l.x - c), 0);
    // One direction per model (as FHWA lays out one model per case): the cases turning the column
    // toward the chosen side, or toward whichever side the case turning it most does.
    const want = t.direction === "right" ? 1 : t.direction === "left" ? -1 : null;
    const toward = (k: (typeof all)[number]) => (moment(k) >= 0 ? 1 : -1);
    const most = all.reduce((p, k) => (Math.abs(moment(k)) > Math.abs(moment(p)) ? k : p), all[0]);
    const sign = want ?? toward(most);
    const cases = all.filter((k) => toward(k) === sign || Math.abs(moment(k)) < 1e-9);
    if (!cases.length) cases.push(most);
    let gov = cases[0];
    for (const k of cases) if (Math.abs(moment(k)) > Math.abs(moment(gov))) gov = k;
    const P = gov.loads.reduce((m, l) => m + l.P, 0);
    const M = moment(gov);
    const s = Math.abs(M) < 1e-9 ? sign : M >= 0 ? 1 : -1; // the heavier arm's side
    const w = wc;
    const a = P / w; // per unit depth: σ(v) = a + b·v, v from the centerline toward the heavier side
    const b = (12 * Math.abs(M)) / w ** 3;
    const area = (v1: number, v2: number) => a * (v2 - v1) + (b * (v2 * v2 - v1 * v1)) / 2;
    const centroid = (v1: number, v2: number) => (a * (v2 * v2 - v1 * v1) / 2 + (b * (v2 ** 3 - v1 ** 3)) / 3) / area(v1, v2);
    const v0 = P > 0 && b > 0 ? Math.max(-w / 2, -a / b) : -w / 2; // compression from v0 to the heavier face
    // A tie at a face's bars wherever any case puts that face in tension (as FHWA's A–A′): σ = P/w ± 6M/w².
    const inset = Math.max(1, t.columnBarInset) / 12;
    const tieAt = (f: number) =>
      cases.some((k) => {
        const Pk = k.loads.reduce((m, l) => m + l.P, 0);
        return Pk / w + (f * 6 * moment(k)) / w ** 2 < -1e-6;
      })
        ? c + f * (w / 2 - inset)
        : NaN;
    // Only the lighter face: cases putting the heavier face in tension belong to a model laid out the other way.
    const tieL = s > 0 ? tieAt(-1) : NaN;
    const tieR = s < 0 ? tieAt(1) : NaN;
    let vD = -w / 4;
    let vE = w / 4;
    let vs = 0;
    if (P > 0) {
      const C = area(v0, w / 2);
      // FHWA sizes the heavier part to carry the arm's loads beyond the column's face (P2); loads over the column go to the other.
      const heavy = gov.loads.reduce((m, l) => m + (s * (l.x - c) >= w / 2 - 1e-9 ? l.P : 0), 0);
      const share = heavy > 0.05 * C && heavy < 0.95 * C ? heavy : C / 2;
      let lo = v0;
      let hi = w / 2;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2;
        if (area(mid, w / 2) > share) lo = mid;
        else hi = mid;
      }
      vs = (lo + hi) / 2;
      vE = centroid(vs, w / 2);
      vD = centroid(v0, vs);
    } else vs = 0;
    if (vE - vD < 0.5) [vD, vE] = [(vD + vE) / 2 - 0.25, (vD + vE) / 2 + 0.25];
    const widthD = (vs - (P > 0 ? v0 : -w / 2)) * 12;
    const widthE = (w / 2 - vs) * 12;
    // In plan, left to right; each kept 0.3 ft or more inside a tie at its face.
    let xL = c + s * (s > 0 ? vD : vE);
    let xR = c + s * (s > 0 ? vE : vD);
    if (Number.isFinite(tieL)) xL = Math.max(xL, tieL + 0.3);
    if (Number.isFinite(tieR)) xR = Math.min(xR, tieR - 0.3);
    // The bottom strut (FHWA Example 2's node E, TxDOT 2.8.2): jd as large as the column node's back
    // face allows. The arm's moment about that node, for every case in this model and either arm, is
    // held by the back face's strength over a: M = φ ν f'c b a (d − a/2), φ = 0.7 (5.5.4.2), ν = 0.85 for
    // a CCC node (0.45 without the crack-control grid, Table 5.8.2.5.3a-1); the strut at a/2 above the
    // soffit, 1% clear of that strength.
    if ((t.bottomChord ?? "entered") === "auto") {
      const armMoment = (k: (typeof cases)[number], f: -1 | 1, xn: number) => k.loads.reduce((m, l) => m + l.P * Math.max(0, f * (l.x - xn)), 0);
      // An arm crossing the column bars' tie lands on a CCT node there (ν 0.70); otherwise its chord ends at the CCC column node.
      const nu = (f: -1 | 1) => (!base.grid.provided ? 0.45 : Number.isFinite(f < 0 ? tieL : tieR) ? 0.7 : 0.85);
      const Mu = Math.max(0, ...cases.flatMap((k) => [armMoment(k, -1, xL) / nu(-1), armMoment(k, 1, xR) / nu(1)])) * 12 * 1.01; // kip·in, over ν
      const d = t.depth * 12 - t.topCover;
      const kk = 0.7 * base.fc * t.capWidth;
      const disc = d * d - (2 * Mu) / kk;
      const a = disc > 0 ? d - Math.sqrt(disc) : d;
      bc = Math.max(1, Math.min(a / 2, (tip * 12 - t.topCover) / 3)) / 12;
    }
    const Lnode = { ...bottomAt(xL, 0), width: s > 0 ? widthD : widthE };
    const Rnode = { ...bottomAt(xR, 0), width: s > 0 ? widthE : widthD };
    colNodes = [Lnode, Rnode];
    hammer = { c, L: Lnode, R: Rnode, tieL, tieR, governing: gov.name, sign: s as 1 | -1 };
  } else colNodes = cols.map((c, ci) => ({ ...bottomAt(c, ci), width: wc * 12 }));

  const members = new Map<string, string>(); // sorted pair → entry as written (with any role)
  const add = (a: string, b: string, role?: "strut") => {
    const key = [a, b].sort().join("|");
    if (a === b) return;
    // A member added twice with different roles (a bearing's strut on a column's face line) takes either sign.
    const had = members.get(key);
    if (had !== undefined) {
      if (had.endsWith(":strut") && !role) members.set(key, had.replace(/:strut$/, ""));
      return;
    }
    members.set(key, `${a}-${b}${role ? `:${role}` : ""}`);
  };
  const ties: StmTie[] = [];
  const steep = (x1: number, y1: number, x2: number, y2: number) => Math.abs(x2 - x1) < 1e-6 || Math.atan2(Math.abs(y1 - y2), Math.abs(x2 - x1)) >= MIN_ANGLE - 1e-9;
  const verticals: { m: string; t: string; width: number }[] = [];

  /** A bearing's load to a column node: a direct strut, or panels stepping inward (inner bearings first). */
  const route = (bx: number, top: string, target: { label: string; x: number }) => {
    let cur = bx;
    let prevTop = top;
    const dir = Math.sign(target.x - bx);
    for (let guard = 0; guard < 40; guard++) {
      if (steep(cur, yT, target.x, yB(target.x))) {
        add(prevTop, target.label, "strut");
        return;
      }
      // The farthest inner bearing still within a steep panel, else a new panel point.
      const reach = (x: number) => Math.abs(x - cur) <= Math.min(h(cur), h(x)) / MAX_TAN + 1e-9;
      // Panel points already in the model (bearings, or other loads' panel points) are reused first.
      const between = tops.filter((b) => (b.x - cur) * dir > 0.25 && (target.x - b.x) * dir > 0.25);
      const inner = between.filter((b) => reach(b.x)).sort((p, q) => (q.x - p.x) * dir);
      let x: number;
      if (inner.length) x = inner[0].x;
      else {
        // Out of reach of the next stop (the nearest inner bearing, or the column): equal panels to it,
        // as few as keep each strut steep enough (C5.8.2.2), so no panel is left short.
        const stop = between.sort((p, q) => (p.x - q.x) * dir)[0]?.x ?? target.x;
        const D = Math.abs(stop - cur);
        const step = Math.min(h(cur), h(stop)) / MAX_TAN;
        x = cur + (dir * D) / Math.max(2, Math.ceil(D / step - 1e-9));
      }
      if ((target.x - x) * dir <= 0.25) x = target.x - dir * 0.5;
      const m = bottomAt(x);
      const tp = topAt(x);
      add(prevTop, m.label, "strut");
      verticals.push({ m: m.label, t: tp, width: Math.abs(x - cur) * 12 });
      prevTop = tp;
      cur = x;
    }
    throw new DesignError("The cap is too shallow for a strut-and-tie model at these spans.");
  };

  // An inverted-T's girders bear on its ledges: each load enters at the bottom chord and a hanger tie
  // (the hanger stirrups within W + 2df, two legs each, 5.8.4.3.5) carries it up the stem to the top,
  // from where it goes to the columns as any bearing's load. Over a column the load goes straight in.
  const loadNode = new Map<number, string>(); // bearing → the node taking its load
  if (t.kind === "inverted-t") {
    const lg = t.ledge ?? INVERTED_T_DEFAULTS.ledge!;
    const df = Math.max(1, lg.depth - t.bottomCover);
    bearings.forEach((b, k) => {
      const col = colNodes.find((c) => Math.abs(c.x - b.x) < 0.25);
      if (col) return loadNode.set(k, col.label);
      const m = bottomAt(b.x);
      add(m.label, b.node);
      ties.push({ member: `${m.label}-${b.node}`, barSize: lg.hangers.size, bars: 2 * Math.max(1, Math.floor((t.bearingLength + 2 * df) / lg.hangers.spacing)), ends: [] });
      loadNode.set(k, m.label);
    });
  }

  // A hammerhead's arm reaches the column across a tie at that face: its struts land on a node on the
  // tie's line (a CCT node, as the tie anchors there), then a strut along the bottom to the column node.
  const tieNodes: Record<"L" | "R", { label: string; x: number } | null> = { L: null, R: null };
  const onTie = (side: "L" | "R") => (tieNodes[side] ??= bottomAt(side === "L" ? hammer!.tieL : hammer!.tieR));

  const routedTo: Record<string, (typeof bearings)[number][]> = {}; // a hammerhead's bearings by the column node they strut to
  for (const b of bearings) {
    let targets: { label: string; x: number }[];
    if (hammer) {
      const { L: l, R: r, tieL, tieR } = hammer;
      // A bearing on the column bars' line loads the corner node itself: its corner strut carries it to the column node.
      if ((Number.isFinite(tieL) && Math.abs(b.x - tieL) < 0.25) || (Number.isFinite(tieR) && Math.abs(b.x - tieR) < 0.25)) continue;
      if (Number.isFinite(tieL) && b.x < tieL) targets = [onTie("L")];
      else if (Number.isFinite(tieR) && b.x > tieR) targets = [onTie("R")];
      else if (b.x <= l.x + 1e-9) targets = [l];
      else if (b.x >= r.x - 1e-9) targets = [r];
      else targets = [b.x - l.x <= r.x - b.x ? l : r]; // over the column, between its two struts: the nearer (FHWA's strut BD)
    } else {
      const left = [...colNodes].reverse().find((c) => c.x <= b.x + 1e-9);
      const right = colNodes.find((c) => c.x >= b.x - 1e-9);
      // In a span between columns the load needs a path to both (statics sets how it divides between
      // them): a direct strut where steep enough, panels stepping in where not.
      targets = !left ? [right!] : !right ? [left] : left === right ? [left] : [left, right];
    }
    for (const c of targets) route(b.x, b.node, c);
    if (hammer && targets.length === 1) (routedTo[targets[0].label] ??= []).push(b);
  }

  // A hammerhead's column: the two struts down to one column width below the cap, and a tie at each
  // face that some case puts in tension, from the top bars down the column (FHWA's A–A′), through its
  // node if the arm uses it, with the corner strut into the near column strut (FHWA's A–D).
  const supports: string[] = [];
  if (hammer) {
    let n = 0;
    for (const strut of [hammer.L, hammer.R]) {
      const sl = `S${++n}`;
      nodes.push({ label: sl, x: round(strut.x), y: -dcol });
      add(strut.label, sl);
      supports.push(sl);
    }
    for (const side of ["L", "R"] as const) {
      const x = side === "L" ? hammer.tieL : hammer.tieR;
      if (!Number.isFinite(x)) continue;
      const top = topAt(x);
      const sl = `S${++n}`;
      nodes.push({ label: sl, x: round(x), y: -dcol });
      supports.push(sl);
      const used = tieNodes[side];
      const line = used ? [top, used.label, sl] : [top, sl];
      for (let k = 0; k + 1 < line.length; k++) {
        add(line[k], line[k + 1]);
        ties.push({ member: `${line[k]}-${line[k + 1]}`, barSize: t.topBars.size, bars: t.topBars.count, ends: [] });
      }
      add(top, (side === "L" ? hammer.L : hammer.R).label, "strut");
    }
    // Each arm's loads go to their own column node (FHWA). With the column's struts fixed, one geometry
    // carries every case only if the two arms can trade moment: FHWA's model does it through the column
    // tie A–A′ (its geometry drawn for one case). Where that isn't enough, the innermost girder strutting
    // to each column node also struts to the far column node,
    // crossing at a node: the heavier arm's always, the lighter arm's only where the lighter face has no
    // tie. Not in the references; it carries nothing where FHWA's own path suffices.
    const [cl, cr] = colNodes;
    const clear = (x: number) => !(Number.isFinite(hammer!.tieL) && x <= hammer!.tieL + 0.25) && !(Number.isFinite(hammer!.tieR) && x >= hammer!.tieR - 0.25);
    // The innermost girder strutting to each column node (so the new strut fans from it and crosses none of that arm's).
    const innerL = (routedTo[cl.label] ?? []).filter((b) => clear(b.x)).sort((p, q) => q.x - p.x)[0];
    const innerR = (routedTo[cr.label] ?? []).filter((b) => clear(b.x)).sort((p, q) => p.x - q.x)[0];
    const lighterTie = Number.isFinite(hammer.sign > 0 ? hammer.tieL : hammer.tieR);
    // The lighter face's tie adds moment to the lighter arm, as the lighter arm's strut to the far node would; the heavier arm's strut does the opposite and is always needed.
    const fromL = innerL && steep(innerL.x, yT, cr.x, yB(cr.x)) && !(hammer.sign > 0 && lighterTie) ? innerL : null;
    const fromR = innerR && steep(innerR.x, yT, cl.x, yB(cl.x)) && !(hammer.sign < 0 && lighterTie) ? innerR : null;
    if (fromL && fromR) {
      // Where T(left)→R and T(right)→L cross.
      const [x1, y1, x2, y2] = [fromL.x, yT, cr.x, yB(cr.x)];
      const [x3, y3, x4, y4] = [fromR.x, yT, cl.x, yB(cl.x)];
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      const u = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      const k = "K1";
      nodes.push({ label: k, x: round(x1 + u * (x2 - x1)), y: round(y1 + u * (y2 - y1)) });
      for (const [p, q] of [[fromL.node, k], [k, cr.label], [fromR.node, k], [k, cl.label]]) add(p, q, "strut");
    } else if (fromL) add(fromL.node, cr.label, "strut");
    else if (fromR) add(fromR.node, cl.label, "strut");
  } else colNodes.forEach((c) => supports.push(c.label));

  // Verticals (stirrups), top chord (top bars), bottom chord (bottom bars between columns).
  for (const v of verticals) {
    const before = members.size;
    add(v.m, v.t);
    if (members.size > before) ties.push({ member: `${v.m}-${v.t}`, barSize: t.stirrups.size, bars: t.stirrups.legs * Math.max(1, Math.round(v.width / t.stirrups.spacing)), ends: [] });
  }
  const topSorted = [...tops].sort((a, b) => a.x - b.x);
  for (let k = 0; k + 1 < topSorted.length; k++) {
    add(topSorted[k].label, topSorted[k + 1].label);
    ties.push({ member: `${topSorted[k].label}-${topSorted[k + 1].label}`, barSize: t.topBars.size, bars: t.topBars.count, ends: [] });
  }
  const botSorted = [...bottoms].sort((a, b) => a.x - b.x);
  const firstCol = colNodes[0].x;
  const lastCol = colNodes[colNodes.length - 1].x;
  for (let k = 0; k + 1 < botSorted.length; k++) {
    const [a, b] = [botSorted[k], botSorted[k + 1]];
    add(a.label, b.label);
    const sameColumn = a.col !== null && a.col === b.col;
    if (!sameColumn && a.x >= firstCol - 1e-9 && b.x <= lastCol + 1e-9) ties.push({ member: `${a.label}-${b.label}`, barSize: t.bottomBars.size, bars: t.bottomBars.count, ends: [] });
  }

  // The bearings' nodes (an inverted-T's girders bear on its ledges, out of this plane: checked under 5.8.4.3 instead).
  const nodeChecks: StmNodeCheck[] = t.kind === "inverted-t" ? [] : bearings.map((b) => ({ node: b.node, thickness: Math.min(t.bearingWidth, t.capWidth), faces: [{ source: "external", type: "bearing", width: round(b.width) }], confinement: null }));
  // Each column node bears on its part of the column's compression (a hammerhead's), or on the whole column (a bent's).
  if (hammer) [hammer.L, hammer.R].forEach((c, k) => nodeChecks.push({ node: c.label, thickness: t.capWidth, faces: [{ source: `${c.label}-S${k + 1}`, type: "bearing", width: round(c.width) }], confinement: null }));
  else colNodes.forEach((c) => nodeChecks.push({ node: c.label, thickness: t.capWidth, faces: [{ source: "external", type: "bearing", width: wc * 12 }], confinement: null }));

  return {
    ...base,
    b: t.capWidth,
    outline,
    nodes,
    // A bent's first column takes the cap's horizontal force; a hammerhead's column takes it where it meets
    // the cap, at its first node (the struts below are vertical, so a horizontal load has no other path).
    // Under gravity loads the horizontal reaction is zero either way.
    supports: hammer
      ? [{ node: hammer.L.label, x: true, y: false, upwardOnly: false }, ...supports.map((label) => ({ node: label, x: false, y: true, upwardOnly: false }))]
      : supports.map((label, k) => ({ node: label, x: k === 0, y: true, upwardOnly: false })),
    component: t.kind === "abutment" ? "abutment" : "pier_cap",
    cases: [{ name: "Strength I", loads: bearings.map((b, k) => ({ b, node: loadNode.get(k) ?? b.node })).filter(({ b }) => b.P > 0).map(({ b, node }) => ({ node, fx: 0, fy: -b.P })) }],
    layout: "entered",
    members: [...members.values()],
    ties,
    nodeChecks,
    grid: { ...base.grid, d: round(t.depth * 12 - t.topCover) },
    // The diagonal-cracking screen needs this cap's service shear and shear span: off until entered.
    service: { check: false, V: 0, a: 0, d: round(t.depth * 12 - t.topCover) },
    girders: base.girders ? { ...base.girders, loadNodes: bearings.map((b, k) => loadNode.get(k) ?? b.node) } : null,
    template: hammer ? { ...t, layoutSign: hammer.sign, chordHeight: round(bc * 12) } : t,
  };
}

/** A saved template, filled in from its kind's defaults. */
export function templateOf(v: unknown): StmTemplate | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const d = s.kind === "multicolumn" ? MULTICOLUMN_DEFAULTS : s.kind === "inverted-t" ? INVERTED_T_DEFAULTS : s.kind === "abutment" ? ABUTMENT_DEFAULTS : HAMMERHEAD_DEFAULTS;
  const lg = (s.ledge ?? {}) as Record<string, unknown>;
  const dl = INVERTED_T_DEFAULTS.ledge!;
  const grp = (x: unknown, def: { size: number; spacing: number }) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const size = typeof o.size === "number" && BARS[o.size] ? o.size : def.size;
    return { size, spacing: typeof o.spacing === "number" && o.spacing > 0 ? o.spacing : def.spacing };
  };
  const ledge = d.kind === "inverted-t" ? { ledge: { depth: typeof lg.depth === "number" ? lg.depth : dl.depth, projection: typeof lg.projection === "number" ? lg.projection : dl.projection, av: typeof lg.av === "number" ? lg.av : dl.av, cover: typeof lg.cover === "number" ? lg.cover : dl.cover, primary: grp(lg.primary, dl.primary), ties: grp(lg.ties, dl.ties), hangers: grp(lg.hangers, dl.hangers) } } : {};
  const n = (x: unknown, def: number) => (typeof x === "number" && Number.isFinite(x) ? x : def);
  const bars = (x: unknown, def: { size: number; count: number }) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const size = n(o.size, def.size);
    return { size: BARS[size] ? size : def.size, count: n(o.count, def.count) };
  };
  const st = (s.stirrups ?? {}) as Record<string, unknown>;
  return {
    kind: d.kind,
    ...ledge,
    length: n(s.length, d.length),
    depth: n(s.depth, d.depth),
    tipDepth: n(s.tipDepth, d.tipDepth),
    capWidth: n(s.capWidth, d.capWidth),
    columns: Array.isArray(s.columns) ? (s.columns as unknown[]).filter((x): x is number => typeof x === "number" && Number.isFinite(x)).slice(0, 12) : d.columns,
    columnWidth: n(s.columnWidth, d.columnWidth),
    columnModel: s.columnModel === "two" ? "two" : s.columnModel === "single" ? "single" : d.columnModel,
    columnBarInset: n(s.columnBarInset, d.columnBarInset),
    direction: s.direction === "left" || s.direction === "right" ? s.direction : "auto",
    ...(s.layoutSign === 1 || s.layoutSign === -1 ? { layoutSign: s.layoutSign } : {}),
    topCover: n(s.topCover, d.topCover),
    bottomCover: n(s.bottomCover, d.bottomCover),
    ...(d.kind === "hammerhead" ? { bottomChord: s.bottomChord === "entered" ? "entered" : "auto", resolveWithin: typeof s.resolveWithin === "number" && s.resolveWithin >= 0 ? s.resolveWithin : null } : {}),
    ...(typeof s.chordHeight === "number" && Number.isFinite(s.chordHeight) ? { chordHeight: s.chordHeight } : {}),
    bearings: Array.isArray(s.bearings) ? (s.bearings as Record<string, unknown>[]).filter((b) => b && typeof b === "object").slice(0, 40).map((b) => ({ x: n(b.x, 0), P: n(b.P, 0) })) : d.bearings,
    bearingLength: n(s.bearingLength, d.bearingLength),
    bearingWidth: n(s.bearingWidth, d.bearingWidth),
    topBars: bars(s.topBars, d.topBars),
    bottomBars: bars(s.bottomBars, d.bottomBars),
    stirrups: { size: BARS[n(st.size, d.stirrups.size)] ? n(st.size, d.stirrups.size) : d.stirrups.size, legs: n(st.legs, d.stirrups.legs), spacing: n(st.spacing, d.stirrups.spacing) },
    sideCover: n(s.sideCover, d.sideCover),
    barEnds: s.barEnds === "straight" ? "straight" : "hook",
  };
}
