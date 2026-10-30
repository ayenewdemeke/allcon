// Cast-in-place or precast reinforced concrete box culvert, one or more cells, per foot of
// barrel: AASHTO LRFD (9th ed.) Section 12.11. (Checked against the 10'×10' precast example of
// the MnDOT Bridge Design Manual, 12.5, in the tests.) Loads are worked out, a 2D plane
// frame on the members' centerlines (haunches stiffening the corners, pinned and roller supports,
// the soil's reaction balancing every load) gives the moments, shears and thrusts, and each
// member is checked for flexure, crack control, minimum and maximum steel, shear and thrust.
// Kip and foot for loads and forces; member thicknesses, covers and steel in inches.

import { abutmentHeq } from "../walls/mse";
import { BARS, type Bars, type Check, DesignError } from "../walls/cip";
import { type DistLoad, type EndForces, Frame, type FrameElement, type FrameNode, type LoadCase, type NodalLoad } from "../frame";

export type Steel = { topIn: number; topOut: number; botIn: number; botOut: number; wallIn: number; wallOut: number; intWall: number }; // in²/ft
export type Face = keyof Steel;

export type CbcInputs = {
  // Geometry
  cells: number;
  span: number; // clear span of each cell, ft
  rise: number; // clear rise, ft
  Tt: number; // top slab, in
  Tb: number; // bottom slab, in
  Ts: number; // exterior walls, in
  Ti: number; // interior walls, in
  haunch: number; // in (45°)
  fill: number; // depth of fill over the top slab, ft
  // Soil and water
  gammaS: number; // kcf
  efwMax: number; // kcf, at rest
  efwMin: number; // kcf
  ka: number; // live load surcharge
  compactedSides: boolean; // Fe ≤ 1.15 (else 1.40)
  water: boolean; // a case with the culvert full
  gammaW: number; // kcf
  // Live load
  liveLoad: boolean;
  lldf: number;
  mpf: number;
  // Concrete and steel
  fc: number; // ksi
  gammaC: number; // kcf
  fy: number; // ksi (60 bars, 65 welded wire)
  Es: number; // ksi
  cover: number; // in, clear
  gammaE: number; // exposure factor (0.75 Class 2)
  agg: number; // maximum aggregate size, in
  // Reinforcement: bars (size and spacing) on each face, or welded wire (area per foot)
  reinf: "bars" | "wwr";
  bars: Record<Face, Bars>;
  steel: Steel; // welded wire, in²/ft
  dw: number; // welded wire diameter, in
  spacing: number; // welded wire spacing, in (crack control)
  // Factors
  construction: "cip" | "precast"; // AASHTO Table 12.5.5-1's φ
  eta: number; // load modifier on EV and EH (lack of redundancy, 12.5.4)
  phiF: number;
  phiV: number;
  phiC: number;
};

/** φ for flexure and shear, AASHTO Table 12.5.5-1. */
export const PHI_BOX = { cip: { phiF: 0.9, phiV: 0.85 }, precast: { phiF: 1.0, phiV: 0.9 } } as const;

const BARS_DEFAULT: Record<Face, Bars> = {
  topIn: { bar: 6, spacing: 6 },
  topOut: { bar: 5, spacing: 12 },
  botIn: { bar: 6, spacing: 6 },
  botOut: { bar: 5, spacing: 12 },
  wallIn: { bar: 5, spacing: 12 },
  wallOut: { bar: 5, spacing: 9 },
  intWall: { bar: 5, spacing: 9 },
};

/** A face's steel: its area per foot, the bar (or wire) diameter for d, and the spacing. */
export function faceSteel(i: CbcInputs, face: Face): { As: number; db: number; s: number; bars?: Bars } {
  if (i.reinf === "wwr") return { As: i.steel[face], db: i.dw, s: i.spacing };
  const b = i.bars[face];
  return { As: (BARS[b.bar].area * 12) / b.spacing, db: BARS[b.bar].dia, s: b.spacing, bars: b };
}

export const CBC_DEFAULTS: CbcInputs = {
  cells: 1,
  span: 10,
  rise: 10,
  Tt: 9,
  Tb: 10,
  Ts: 8,
  Ti: 8,
  haunch: 12,
  fill: 6,
  gammaS: 0.12,
  efwMax: 0.06,
  efwMin: 0.03,
  ka: 0.33,
  compactedSides: true,
  water: true,
  gammaW: 0.0624,
  liveLoad: true,
  lldf: 1.15,
  mpf: 1.2,
  fc: 5,
  gammaC: 0.15,
  fy: 60,
  Es: 29000,
  cover: 2,
  gammaE: 0.75,
  agg: 0.75,
  reinf: "bars",
  bars: BARS_DEFAULT,
  steel: { topIn: 0.65, topOut: 0.22, botIn: 0.71, botOut: 0.24, wallIn: 0.2, wallOut: 0.33, intWall: 0.33 },
  dw: 1,
  spacing: 4,
  construction: "cip",
  eta: 1.05,
  phiF: 0.9,
  phiV: 0.85,
  phiC: 0.7,
};

export type CaseId = "DC" | "EV" | "EHmax" | "EHmin" | "LS" | "WA";
export const CASES: { id: CaseId; name: string }[] = [
  { id: "DC", name: "Dead load" },
  { id: "EV", name: "Vertical earth" },
  { id: "EHmax", name: "Horizontal earth, max" },
  { id: "EHmin", name: "Horizontal earth, min" },
  { id: "LS", name: "Live load surcharge" },
  { id: "WA", name: "Water inside" },
];

export type ComboId = "StrIa" | "StrIb" | "StrIc" | "SerIa" | "SerIb" | "SerIc";
/** Strength I and Service I (AASHTO Table 3.4.1-1), with the permanent loads' maximum and minimum
 * factors (Table 3.4.1-2: DC, EV for rigid buried structures, EH at rest) arranged for the worst
 * of each effect: EH at its maximum, or at its minimum (half, 3.11.7) with the culvert full, or
 * the vertical loads at their minimum. η (1.3.2, 12.5.4) multiplies the maximum factors on EV
 * and EH and divides the minimum ones. */
export function combos(eta: number): { id: ComboId; name: string; strength: boolean; f: Record<CaseId | "LL", number> }[] {
  return [
    { id: "StrIa", name: "Strength I, max EH", strength: true, f: { DC: 1.25, EV: 1.3 * eta, LL: 1.75, EHmax: 1.35 * eta, EHmin: 0, LS: 1.75, WA: 0 } },
    { id: "StrIb", name: "Strength I, min EH, water", strength: true, f: { DC: 1.25, EV: 1.3 * eta, LL: 1.75, EHmax: 0, EHmin: 0.9 / eta, LS: 0, WA: 1.0 } },
    { id: "StrIc", name: "Strength I, min vertical", strength: true, f: { DC: 0.9, EV: 0.9 / eta, LL: 0, EHmax: 1.35 * eta, EHmin: 0, LS: 1.75, WA: 0 } },
    { id: "SerIa", name: "Service I, max EH", strength: false, f: { DC: 1, EV: 1, LL: 1, EHmax: 1, EHmin: 0, LS: 1, WA: 0 } },
    { id: "SerIb", name: "Service I, min EH, water", strength: false, f: { DC: 1, EV: 1, LL: 1, EHmax: 0, EHmin: 1, LS: 0, WA: 1 } },
    { id: "SerIc", name: "Service I, no live load", strength: false, f: { DC: 1, EV: 1, LL: 0, EHmax: 1, EHmin: 0, LS: 1, WA: 0 } },
  ];
}

export type MemberKind = "top" | "bottom" | "wall" | "iwall";
export const GROUPS: { kind: MemberKind; name: string }[] = [
  { kind: "top", name: "Top slab" },
  { kind: "bottom", name: "Bottom slab" },
  { kind: "wall", name: "Exterior walls" },
  { kind: "iwall", name: "Interior walls" },
];

/** A section the members are designed at. */
export type Station = { id: string; name: string; kind: MemberKind; member: number; el: number; end: "i" | "j"; role: "end" | "center" | "shear" };

type Member = { kind: MemberKind; name: string; start: number; end: number; t: number; L: number; els: number[]; s: number[] };


/** The box's centerline frame: joints, members broken into elements (deeper in the haunches), and the stations. */
export function buildModel(i: CbcInputs) {
  const n = Math.round(i.cells);
  const th = i.haunch / 12;
  const tt = i.Tt / 12;
  const tb = i.Tb / 12;
  const ts = i.Ts / 12;
  const ti = i.Ti / 12;
  // Joint x: wall centerlines.
  const xs = [0];
  for (let k = 0; k < n; k++) xs.push(xs[k] + (k === 0 ? ts / 2 : ti / 2) + i.span + (k === n - 1 ? ts / 2 : ti / 2));
  const yTop = tb / 2 + i.rise + tt / 2;
  const B = xs[n];
  const nodes: FrameNode[] = [];
  const elements: FrameElement[] = [];
  const stations: Station[] = [];
  const members: Member[] = [];
  const joint = (x: number, y: number) => {
    const found = nodes.findIndex((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);
    if (found >= 0) return found;
    nodes.push({ x, y });
    return nodes.length - 1;
  };
  const wallT = (k: number) => (k === 0 || k === n ? ts : ti);
  // dv at a face (the lesser for slabs), to place the shear sections.
  const dvOf = (h: number, ...faces: Face[]) => {
    const f = faces.map((x) => faceSteel(i, x)).reduce((w, x) => (x.As < w.As ? x : w));
    const d = h * 12 - i.cover - f.db / 2;
    const a = (f.As * i.fy) / (0.85 * i.fc * 12);
    return Math.max(0.72 * h * 12, 0.9 * d, d - a / 2) / 12;
  };
  const addMember = (kind: MemberKind, name: string, a: FrameNode, b: FrameNode, t: number, tA: number, tB: number, nH: number, dv: number) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const tipA = tA / 2 + th;
    const tipB = tB / 2 + th;
    if (tipA + tipB >= L) throw new DesignError("The haunches meet: the cells are too small for these members");
    const cuts = new Set<number>([0, L, tA / 2, L - tB / 2, tipA, L - tipB, L / 2]);
    for (const f of [1 / 3, 2 / 3]) {
      cuts.add(tA / 2 + f * th);
      cuts.add(L - tB / 2 - f * th);
    }
    if (tipA + dv < L / 2) cuts.add(tipA + dv);
    if (L - tipB - dv > L / 2) cuts.add(L - tipB - dv);
    let pts = [...cuts].filter((v) => v >= 0 && v <= L).sort((p, q) => p - q);
    // No element longer than 1 ft.
    pts = pts.flatMap((v, k) => {
      if (k === 0) return [v];
      const gap = v - pts[k - 1];
      const parts = Math.ceil(gap / 1 - 1e-9);
      return Array.from({ length: parts }, (_, m) => pts[k - 1] + (gap * (m + 1)) / parts);
    });
    pts = pts.filter((v, k) => k === 0 || v - pts[k - 1] > 1e-6);
    const depth = (u: number) => {
      const fromA = u;
      const fromB = L - u;
      const extra = (from: number, tj: number) => (from < tj / 2 ? th : from < tj / 2 + th ? th - (from - tj / 2) : 0);
      return t + nH * Math.max(extra(fromA, tA), extra(fromB, tB));
    };
    const ids = pts.map((u) => joint(a.x + ((b.x - a.x) * u) / L, a.y + ((b.y - a.y) * u) / L));
    const m = members.length;
    const els: number[] = [];
    for (let k = 0; k + 1 < ids.length; k++) {
      const h = depth((pts[k] + pts[k + 1]) / 2);
      elements.push({ i: ids[k], j: ids[k + 1], A: h, I: h ** 3 / 12 });
      els.push(elements.length - 1);
    }
    members.push({ kind, name, start: ids[0], end: ids[ids.length - 1], t, L, els, s: pts });
    const at = (u: number) => {
      const k = pts.findIndex((p) => Math.abs(p - u) < 1e-6);
      return k === 0 ? { el: els[0], end: "i" as const } : { el: els[k - 1], end: "j" as const };
    };
    const words = kind === "top" || kind === "bottom" ? (["left end", "right end"] as const) : (["bottom", "top"] as const);
    // Bottom slabs run right to left: their start is the right end.
    const [startWord, endWord] = kind === "bottom" ? [words[1], words[0]] : kind === "wall" && a.y > b.y ? [words[1], words[0]] : words;
    const st = (role: Station["role"], u: number, label: string) => stations.push({ id: `${m}-${role}-${+u.toFixed(4)}`, name: `${name}, ${label}`, kind, member: m, ...at(u), role });
    st("end", tipA, `${startWord} (haunch tip)`);
    st("center", L / 2, "center");
    st("end", L - tipB, `${endWord} (haunch tip)`);
    if (tipA + dv < L / 2) st("shear", tipA + dv, `${startWord}, dv past the haunch`);
    if (L - tipB - dv > L / 2) st("shear", L - tipB - dv, `${endWord}, dv past the haunch`);
  };
  const cellName = (k: number) => (n > 1 ? ` (cell ${k + 1})` : "");
  for (let k = 0; k < n; k++) {
    addMember("top", `Top slab${cellName(k)}`, { x: xs[k], y: yTop }, { x: xs[k + 1], y: yTop }, tt, wallT(k), wallT(k + 1), 1, dvOf(tt, "topIn", "topOut"));
    addMember("bottom", `Bottom slab${cellName(k)}`, { x: xs[k + 1], y: 0 }, { x: xs[k], y: 0 }, tb, wallT(k + 1), wallT(k), 1, dvOf(tb, "botIn", "botOut"));
  }
  addMember("wall", "Left wall", { x: 0, y: 0 }, { x: 0, y: yTop }, ts, tb, tt, 1, dvOf(ts, "wallOut"));
  addMember("wall", "Right wall", { x: B, y: yTop }, { x: B, y: 0 }, ts, tt, tb, 1, dvOf(ts, "wallOut"));
  for (let k = 1; k < n; k++) addMember("iwall", `Interior wall ${n > 2 ? k : ""}`.trim(), { x: xs[k], y: 0 }, { x: xs[k], y: yTop }, ti, tb, tt, 2, dvOf(ti, "intWall"));
  const pin = joint(0, 0);
  const roller = joint(B, 0);
  const frame = new Frame(nodes, elements, [
    { node: pin, ux: true, uy: true },
    { node: roller, uy: true },
  ]);
  return { n, xs, B, yTop, nodes, elements, members, stations, frame };
}

type Model = ReturnType<typeof buildModel>;
export type Effect = { M: number; V: number; N: number }; // kip·ft/ft, kip/ft, kip/ft (compression +)

/** A load on a member, by distance along it. */
function onMember(model: Model, m: number, dir: "x" | "y", u0: number, u1: number, q0: number, q1: number): DistLoad[] {
  const mem = model.members[m];
  const out: DistLoad[] = [];
  mem.els.forEach((el, k) => {
    const a = mem.s[k];
    const b = mem.s[k + 1];
    if (u1 <= a || u0 >= b) return;
    out.push({ el, dir, s0: u0 - a, s1: u1 - a, q0, q1 });
  });
  return out;
}

/** The soil's reaction under the bottom slab balancing a vertical force R (down) whose moment about the center is Mc: linear. */
function soilReaction(model: Model, R: number, Mc: number): DistLoad[] {
  const { B } = model;
  const a = R / B;
  const b = (12 * Mc) / B ** 3;
  const out: DistLoad[] = [];
  model.members.forEach((mem, m) => {
    if (mem.kind !== "bottom") return;
    const x0 = model.nodes[mem.start].x; // bottoms run right to left: u = x0 − x
    const q = (x: number) => a + b * (x - B / 2);
    out.push(...onMember(model, m, "y", 0, mem.L, q(x0), q(x0 - mem.L)));
  });
  return out;
}

export function liveLoadParams(i: CbcInputs) {
  const H = i.fill;
  const IM = Math.max(0, 33 * (1 - 0.125 * H)) / 100; // AASHTO Eq. 3.6.2.2-1
  const shallow = H < 2;
  // Parallel to the span (L) and across it (W), ft.
  const Lp = shallow ? (10 + i.lldf * H * 12) / 12 : 10 / 12 + i.lldf * H; // AASHTO 4.6.2.10.2 / 3.6.1.2.6
  const Wp = shallow ? (96 + 1.44 * i.span) / 12 : 6 + 20 / 12 + i.lldf * H;
  const lane = i.span > 15; // AASHTO 3.6.1.3.3: the lane load too on spans over 15 ft
  const wLane = lane ? (0.64 * i.mpf) / (10 + (shallow ? 0 : i.lldf * H)) : 0;
  return { IM, shallow, Lp, Wp, lane, wLane };
}

const VEHICLES = [
  { id: "truck", name: "HL-93 truck", axles: [8, 32, 32], gaps: [14, 14] },
  { id: "tandem", name: "HL-93 tandem", axles: [25, 25], gaps: [4] },
];

/** A vehicle's axles as patches on the top of the box: overlapping footprints merge into one (AASHTO 3.6.1.2.6). */
export function patches(i: CbcInputs, axles: number[], gaps: number[], x0: number) {
  const { IM, Lp, Wp } = liveLoadParams(i);
  const xs = axles.map((_, k) => x0 + gaps.slice(0, k).reduce((s, g) => s + g, 0));
  const out: { a: number; b: number; w: number }[] = [];
  let k = 0;
  while (k < axles.length) {
    let j = k;
    while (j + 1 < axles.length && xs[j + 1] - xs[j] < Lp) j++;
    const a = xs[k] - Lp / 2;
    const b = xs[j] + Lp / 2;
    const P = axles.slice(k, j + 1).reduce((s, p) => s + p, 0);
    out.push({ a, b, w: (P * i.mpf * (1 + IM)) / (Wp * (b - a)) });
    k = j + 1;
  }
  return out;
}

function liveCase(model: Model, ps: { a: number; b: number; w: number }[]): LoadCase {
  const dist: DistLoad[] = [];
  let R = 0;
  let Mc = 0;
  for (const p of ps) {
    const a = Math.max(p.a, 0);
    const b = Math.min(p.b, model.B);
    if (b <= a) continue;
    R += p.w * (b - a);
    Mc += p.w * (b - a) * ((a + b) / 2 - model.B / 2);
    model.members.forEach((mem, m) => {
      if (mem.kind !== "top") return;
      const x0 = model.nodes[mem.start].x;
      dist.push(...onMember(model, m, "y", a - x0, b - x0, -p.w, -p.w));
    });
  }
  return { dist: [...dist, ...soilReaction(model, R, Mc)] };
}

export function designCbc(i: CbcInputs) {
  if (!(i.cells >= 1 && i.cells <= 6)) throw new DesignError("One to six cells");
  if (!(i.span > 0 && i.rise > 0 && i.Tt > 0 && i.Tb > 0 && i.Ts > 0 && i.Ti > 0 && i.fill >= 0)) throw new DesignError("The box needs a span, rise and member thicknesses");
  const model = buildModel(i);
  const { members, stations, frame, B, n } = model;
  const tt = i.Tt / 12;
  const tb = i.Tb / 12;
  const ts = i.Ts / 12;
  const ti = i.Ti / 12;
  const th = i.haunch / 12;
  const H = i.fill;
  const H2 = H + tt + i.rise + tb;
  const Bc = n * i.span + 2 * ts + (n - 1) * ti; // outside width
  const Fe = Math.min(1 + (0.2 * H) / Bc, i.compactedSides ? 1.15 : 1.4); // AASHTO Eq. 12.11.2.2.1-2
  const wallLen = i.rise + tt / 2 + tb / 2;

  // --- loads ---------------------------------------------------------------------------------
  const topAll = (q: number) => members.flatMap((mem, m) => (mem.kind === "top" ? onMember(model, m, "y", 0, mem.L, q, q) : []));
  const botAll = (q: number) => members.flatMap((mem, m) => (mem.kind === "bottom" ? onMember(model, m, "y", 0, mem.L, q, q) : []));
  // Lateral pressures on the exterior walls, pushing in: p at the top node and the bottom node.
  const sides = (pTop: number, pBot: number) =>
    members.flatMap((mem, m) => {
      if (mem.kind !== "wall") return [];
      const left = model.nodes[mem.start].x < B / 2;
      // The left wall runs up (u from the bottom), the right wall down (u from the top).
      return left ? onMember(model, m, "x", 0, mem.L, pBot, pTop) : onMember(model, m, "x", 0, mem.L, -pTop, -pBot);
    });

  const DCtop = i.gammaC * tt; // klf on the top slab
  const haunchW = 0.5 * th * th * i.gammaC;
  const wallsW = members.filter((mem) => mem.kind === "wall" || mem.kind === "iwall").reduce((s, mem) => s + mem.t * wallLen * i.gammaC, 0);
  const haunches = 4 * n; // two at the top and two at the bottom of each cell
  const DCbottom = (DCtop * B + haunches * haunchW + wallsW) / B;
  const haunchLoads: NodalLoad[] = [];
  for (let k = 0; k <= n; k++) {
    const count = k === 0 || k === n ? 1 : 2;
    haunchLoads.push({ node: model.nodes.findIndex((p) => Math.abs(p.x - model.xs[k]) < 1e-9 && Math.abs(p.y - model.yTop) < 1e-9), fy: -count * haunchW });
    haunchLoads.push({ node: model.nodes.findIndex((p) => Math.abs(p.x - model.xs[k]) < 1e-9 && Math.abs(p.y) < 1e-9), fy: -count * haunchW });
  }
  const wallSelf = members.flatMap((mem, m) => (mem.kind === "wall" || mem.kind === "iwall" ? onMember(model, m, "y", 0, mem.L, -mem.t * i.gammaC, -mem.t * i.gammaC) : []));
  const EV = Fe * i.gammaS * H; // klf, AASHTO Eq. 12.11.2.2.1-1
  const EHtop = { max: i.efwMax * H, min: i.efwMin * H };
  const EHbot = { max: i.efwMax * H2, min: i.efwMin * H2 };
  const heq1 = abutmentHeq(H);
  const heq2 = abutmentHeq(H2);
  const LStop = i.ka * i.gammaS * heq1;
  const LSbot = i.ka * i.gammaS * heq2;
  const WAbot = i.gammaW * i.rise;
  // Water inside each cell: on its walls (outward) over the clear rise, and its weight on the bottom slab.
  const water = (): DistLoad[] => {
    const out: DistLoad[] = [];
    members.forEach((mem, m) => {
      if (mem.kind !== "wall") return; // interior walls: the cells on both sides cancel
      const left = model.nodes[mem.start].x < B / 2;
      // q as a function of height y above the bottom node: γw (Tb/2 + rise − y) over Tb/2..Tb/2 + rise.
      if (left) out.push(...onMember(model, m, "x", tb / 2, tb / 2 + i.rise, -WAbot, 0));
      else out.push(...onMember(model, m, "x", tt / 2, tt / 2 + i.rise, 0, WAbot));
    });
    members.forEach((mem, m) => {
      if (mem.kind !== "bottom") return;
      const wallAt = (node: number) => (Math.abs(model.nodes[node].x) < 1e-9 || Math.abs(model.nodes[node].x - B) < 1e-9 ? ts : ti);
      out.push(...onMember(model, m, "y", wallAt(mem.start) / 2, mem.L - wallAt(mem.end) / 2, -WAbot, -WAbot));
    });
    return [...out, ...botAll((WAbot * n * i.span) / B)];
  };
  const cases: Record<CaseId, LoadCase> = {
    DC: { dist: [...topAll(-DCtop), ...wallSelf, ...botAll(DCbottom)], nodal: haunchLoads },
    EV: { dist: [...topAll(-EV), ...botAll(EV)] },
    EHmax: { dist: sides(EHtop.max, EHbot.max) },
    EHmin: { dist: sides(EHtop.min, EHbot.min) },
    LS: { dist: sides(LStop, LSbot) },
    WA: { dist: i.water ? water() : [] },
  };
  // Results at the stations, then at every element end (for the moment diagram).
  type Point = { el: number; end: "i" | "j" };
  const diagramPts = members.flatMap((mem, mi) => [...mem.els.map((el, k) => ({ el, end: "i" as const, member: mi, s: mem.s[k] })), { el: mem.els[mem.els.length - 1], end: "j" as const, member: mi, s: mem.L }]);
  const points: Point[] = [...stations, ...diagramPts];
  const at = (res: EndForces[], p: Point): Effect => {
    const f = res[p.el];
    return p.end === "i" ? { M: f.Mi, V: f.Vi, N: f.Ni } : { M: f.Mj, V: f.Vj, N: f.Nj };
  };
  const unfactoredAll = {} as Record<CaseId, Effect[]>;
  for (const c of CASES) {
    const res = frame.solve(cases[c.id]);
    unfactoredAll[c.id] = points.map((p) => at(res, p));
  }

  // --- live load: the vehicles moved across the box, enveloped ----------------------------------
  const ll = liveLoadParams(i);
  const zero = (): Effect => ({ M: 0, V: 0, N: 0 });
  const envAll = points.map(() => ({ pos: zero(), neg: zero(), vmax: 0, vmin: 0 }));
  const vehicles: { id: string; name: string; w: number; L: number }[] = [];
  const record = (res: EndForces[]) =>
    points.forEach((p, m) => {
      const e = at(res, p);
      const E = envAll[m];
      if (e.M > E.pos.M) E.pos = e;
      if (e.M < E.neg.M) E.neg = e;
      E.vmax = Math.max(E.vmax, e.V);
      E.vmin = Math.min(E.vmin, e.V);
    });
  if (i.liveLoad) {
    for (const v of VEHICLES) {
      const length = v.gaps.reduce((s, g) => s + g, 0);
      const steps = Math.max(40, Math.ceil((B + length + ll.Lp) / Math.min(0.5, ll.Lp / 3)));
      const dirs = v.axles[0] === v.axles[v.axles.length - 1] ? [1] : [1, -1];
      for (const dir of dirs) {
        const axles = dir === 1 ? v.axles : [...v.axles].reverse();
        const gaps = dir === 1 ? v.gaps : [...v.gaps].reverse();
        for (let k = 0; k <= steps; k++) {
          const x0 = -length - ll.Lp / 2 + ((B + length + ll.Lp) * k) / steps;
          const ps = patches(i, axles, gaps, x0);
          if (!ps.some((p) => p.b > 0 && p.a < B)) continue;
          record(frame.solve(liveCase(model, ps)));
        }
      }
      // The heaviest footprint, for the record.
      const ps = patches(i, v.axles, v.gaps, 0);
      const big = ps.reduce((a, p) => (p.w * (p.b - p.a) > a.w * (a.b - a.a) ? p : a), ps[0]);
      vehicles.push({ id: v.id, name: v.name, w: big.w, L: big.b - big.a });
    }
    if (ll.lane) {
      const res = frame.solve(liveCase(model, [{ a: 0, b: B, w: ll.wLane }]));
      points.forEach((p, m) => {
        const e = at(res, p);
        const E = envAll[m];
        if (e.M > 0) E.pos = { M: E.pos.M + e.M, V: E.pos.V + e.V, N: E.pos.N + e.N };
        else E.neg = { M: E.neg.M + e.M, V: E.neg.V + e.V, N: E.neg.N + e.N };
        if (e.V > 0) E.vmax += e.V;
        else E.vmin += e.V;
      });
    }
  }
  const S = stations.length;
  const unfactored = Object.fromEntries(CASES.map((c) => [c.id, unfactoredAll[c.id].slice(0, S)])) as Record<CaseId, Effect[]>;
  const env = envAll.slice(0, S);

  // --- combinations ----------------------------------------------------------------------------
  const C = combos(i.eta);
  type Variant = { combo: ComboId; strength: boolean; ll: "pos" | "neg" | "none" | "vmax" | "vmin"; M: number; V: number; N: number };
  const variants = stations.map((s, m) => {
    const out: Variant[] = [];
    for (const c of C) {
      const base = (key: "M" | "V" | "N") => CASES.reduce((sum, cs) => sum + c.f[cs.id] * unfactored[cs.id][m][key], 0);
      const b = { M: base("M"), V: base("V"), N: base("N") };
      const lls = c.f.LL ? ([["pos", env[m].pos], ["neg", env[m].neg]] as const) : ([["none", zero()]] as const);
      for (const [ll, e] of lls) out.push({ combo: c.id, strength: c.strength, ll, M: b.M + c.f.LL * e.M, V: b.V + c.f.LL * e.V, N: b.N + c.f.LL * e.N });
      if (c.f.LL) {
        // Shear: the live load envelope's extreme in the direction that adds.
        const up = b.V >= 0;
        out.push({ combo: c.id, strength: c.strength, ll: up ? "vmax" : "vmin", M: b.M, V: b.V + c.f.LL * (up ? env[m].vmax : env[m].vmin), N: b.N });
      }
    }
    return { station: s, list: out };
  });
  const pick = (m: number, strength: boolean, sign: 1 | -1) => variants[m].list.filter((v) => v.strength === strength).reduce<Variant | null>((best, v) => (sign * v.M > (best ? sign * best.M : 0) ? v : best), null);

  // The factored (strength) moment envelope along each member, for the diagram.
  const diagram = members.map(() => [] as { s: number; max: number; min: number }[]);
  const jointHalf = (node: number) => {
    const p = model.nodes[node];
    const atTop = Math.abs(p.y - model.yTop) < 1e-9;
    const atBottom = Math.abs(p.y) < 1e-9;
    const exterior = Math.abs(p.x) < 1e-9 || Math.abs(p.x - B) < 1e-9;
    return { slab: exterior ? ts / 2 : ti / 2, wall: atTop ? tt / 2 : atBottom ? tb / 2 : 0 };
  };
  diagramPts.forEach((p, k) => {
    const mem = members[p.member];
    const isSlab = mem.kind === "top" || mem.kind === "bottom";
    const a = jointHalf(mem.start)[isSlab ? "slab" : "wall"];
    const bEnd = jointHalf(mem.end)[isSlab ? "slab" : "wall"];
    if (p.s < a - 1e-9 || p.s > mem.L - bEnd + 1e-9) return; // inside the joints
    const m = S + k;
    let max = -Infinity;
    let min = Infinity;
    for (const c of C) {
      if (!c.strength) continue;
      const base = CASES.reduce((sum, cs) => sum + c.f[cs.id] * unfactoredAll[cs.id][m].M, 0);
      for (const e of c.f.LL ? [envAll[m].pos.M, envAll[m].neg.M] : [0]) {
        max = Math.max(max, base + c.f.LL * e);
        min = Math.min(min, base + c.f.LL * e);
      }
    }
    diagram[p.member].push({ s: p.s, max, min });
  });

  // --- design ----------------------------------------------------------------------------------
  const beta1 = Math.max(0.65, Math.min(0.85, 0.85 - 0.05 * (i.fc - 4)));
  const thickness = (kind: MemberKind) => (kind === "top" ? i.Tt : kind === "bottom" ? i.Tb : kind === "wall" ? i.Ts : i.Ti);
  const faceOf = (kind: MemberKind, sign: 1 | -1): Face => (kind === "top" ? (sign > 0 ? "topIn" : "topOut") : kind === "bottom" ? (sign > 0 ? "botIn" : "botOut") : kind === "wall" ? (sign > 0 ? "wallIn" : "wallOut") : "intWall");
  type FaceSteel = ReturnType<typeof faceSteel>;
  const faceName = (kind: MemberKind, sign: 1 | -1) => (kind === "iwall" ? (sign > 0 ? "right face" : "left face") : sign > 0 ? "inside face" : "outside face");
  const b = 12;
  const flexure = (h: number, st: FaceSteel, Mu: number) => {
    const As = st.As;
    const d = h - i.cover - st.db / 2;
    const a = (As * i.fy) / (0.85 * i.fc * b);
    const Mr = (i.phiF * As * i.fy * (d - a / 2)) / 12; // kip·ft/ft
    // Steel needed: φ As fy (d − As fy / (1.7 f'c b)) = Mu.
    const A2 = (i.phiF * i.fy ** 2) / (1.7 * i.fc * b);
    const B1 = i.phiF * i.fy * d;
    const disc = B1 ** 2 - 4 * A2 * Mu * 12;
    const AsReq = disc >= 0 ? (B1 - Math.sqrt(disc)) / (2 * A2) : Infinity;
    const c = (As * i.fy) / (0.85 * i.fc * beta1 * b);
    return { d, a, Mr, AsReq, c };
  };
  const crack = (h: number, st: FaceSteel, Ms: number, Ns: number) => {
    const As = st.As;
    const d = h - i.cover - st.db / 2;
    const dc = i.cover + st.db / 2;
    const betaS = 1 + dc / (0.7 * (h - dc));
    const fss = Math.min((700 * i.gammaE) / (betaS * (st.s + 2 * dc)), 0.6 * i.fy);
    const M = Math.abs(Ms) * 12; // kip·in
    const N = Math.max(Ns, 0);
    let fs: number;
    let e = Infinity;
    let j = 0.9;
    let ii = 1;
    // With thrust, AASHTO C12.11.3 (for e/d over 1.15); otherwise the thrust's benefit is left out.
    const eN = N > 1e-9 ? M / N + d - h / 2 : Infinity;
    const thrust = Number.isFinite(eN) && eN / d >= 1.15;
    if (thrust) {
      e = eN;
      j = Math.min(0.9, 0.74 + (0.1 * e) / d);
      ii = 1 / (1 - (j * d) / e);
      fs = (M + N * (d - h / 2)) / (As * j * ii * d);
    } else fs = M / (As * j * d);
    return { d, dc, betaS, fss, e, j, i: ii, fs, thrust, AsReq: (As * fs) / fss };
  };

  type FaceResult = { station: Station; index: number; sign: 1 | -1; face: string; key: Face; steel: FaceSteel; h: number; As: number; Mu: number; combo: ComboId; u: Variant; flex: ReturnType<typeof flexure>; Ms: number; Ns: number; serCombo: ComboId | null; s: Variant | null; crack: ReturnType<typeof crack> | null };
  const faces: FaceResult[] = [];
  stations.forEach((s, m) => {
    if (s.role === "shear") return;
    const h = thickness(s.kind);
    for (const sign of [1, -1] as const) {
      const u = pick(m, true, sign);
      if (!u) continue;
      const key = faceOf(s.kind, sign);
      const st = faceSteel(i, key);
      const sv = pick(m, false, sign);
      faces.push({ station: s, index: m, sign, face: faceName(s.kind, sign), key, steel: st, h, As: st.As, Mu: Math.abs(u.M), combo: u.combo, u, flex: flexure(h, st, Math.abs(u.M)), Ms: sv ? Math.abs(sv.M) : 0, Ns: sv?.N ?? 0, serCombo: sv?.combo ?? null, s: sv, crack: sv ? crack(h, st, sv.M, sv.N) : null });
    }
  });

  type ShearResult = { station: Station; index: number; h: number; face: Face; rule: "slab" | "beam"; Vu: number; Mu: number; combo: ComboId; gov: Variant; d: number; As: number; ratio: number; Vr: number; raw: number; lo: number; hi: number; dv: number; beta: number; epsS: number; sxe: number };
  const shears = stations.flatMap((s, m): ShearResult[] => {
    if (s.role !== "shear") return [];
    const h = thickness(s.kind);
    const strength = variants[m].list.filter((v) => v.strength);
    const gov = strength.reduce((w, v) => (Math.abs(v.V) > Math.abs(w.V) ? v : w), strength[0]);
    const Vu = Math.abs(gov.V);
    const slabRule = s.kind === "bottom" || (s.kind === "top" && H >= 2); // AASHTO 5.12.7.3
    const sign: 1 | -1 = (strength.reduce((w, v) => (Math.abs(v.M) > Math.abs(w.M) ? v : w), strength[0]).M >= 0 ? 1 : -1) as 1 | -1;
    // The lesser face for the slab rule, else the tension face.
    const face = slabRule ? ([faceOf(s.kind, 1), faceOf(s.kind, -1)] as const).reduce((w, x) => (faceSteel(i, x).As < faceSteel(i, w).As ? x : w)) : faceOf(s.kind, sign);
    const st = faceSteel(i, face);
    const As = st.As;
    const d = h - i.cover - st.db / 2;
    const Mu = Math.max(...strength.map((v) => Math.abs(v.M)), Vu * (d / 12));
    if (slabRule) {
      const ratio = Math.min(1, (Vu * d) / (Mu * 12));
      const raw = i.phiV * (0.0676 * Math.sqrt(i.fc) + (4.6 * As * ratio) / (b * d)) * b * d;
      const lo = i.phiV * 0.0948 * Math.sqrt(i.fc) * b * d; // monolithic with the walls
      const hi = i.phiV * 0.126 * Math.sqrt(i.fc) * b * d;
      return [{ station: s, index: m, h, face, rule: "slab", Vu, Mu, combo: gov.combo, gov, d, As, ratio, Vr: Math.min(Math.max(raw, lo), hi), raw, lo, hi, dv: d, beta: 0, epsS: 0, sxe: 0 }];
    }
    const a = (As * i.fy) / (0.85 * i.fc * b);
    const dv = Math.max(0.72 * h, 0.9 * d, d - a / 2);
    const MuDesign = Math.max(Mu * 12, Vu * dv);
    const epsS = (MuDesign / dv + Vu) / (i.Es * As); // Nu = 0: no benefit taken from thrust
    const sxe = Math.max(12, Math.min(80, (dv * 1.38) / (i.agg + 0.63)));
    const general = (4.8 / (1 + 750 * epsS)) * (51 / (39 + sxe));
    const beta = Math.max(general, h <= 16 ? 2 : 0); // either is permitted (5.7.3.4.1, 5.7.3.4.2): the greater
    const Vr = Math.min(i.phiV * 0.0316 * beta * Math.sqrt(i.fc) * b * dv, i.phiV * 0.25 * i.fc * b * dv);
    return [{ station: s, index: m, h, face, rule: "beam", Vu, Mu, combo: gov.combo, gov, d, As, ratio: 0, Vr, raw: Vr, lo: 0, hi: 0, dv, beta, epsS, sxe }];
  });

  // --- checks ----------------------------------------------------------------------------------
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity + 1e-9 });
  // What governs each group and face, for the calc package.
  const governs: { kind: MemberKind; key: "in" | "out" | "each"; face: Face; steel: FaceSteel; label: string; flex: FaceResult; crack: FaceResult | null; As: number; h: number }[] = [];
  const comboName = (id: ComboId | null) => C.find((c) => c.id === id)?.name ?? "";
  const epsTl = i.fy <= 75 ? 0.005 : Math.min(0.008, 0.005 + (0.003 * (i.fy - 75)) / 25); // AASHTO 5.6.2.1
  const cdMax = 0.003 / (0.003 + epsTl);
  const thrusts: { kind: MemberKind; Pu: number; h: number; station: Station; combo: ComboId }[] = [];
  const governing = <T,>(list: T[], ratio: (x: T) => number) => list.reduce((w, x) => (ratio(x) > ratio(w) ? x : w), list[0]);
  for (const g of GROUPS) {
    const mine = faces.filter((f) => f.station.kind === g.kind);
    if (!mine.length) continue;
    const h = thickness(g.kind);
    const faceKeys = g.kind === "iwall" ? [0] : [1, -1];
    for (const key of faceKeys) {
      const list = g.kind === "iwall" ? mine : mine.filter((f) => f.sign === key);
      if (!list.length) continue;
      const label = g.kind === "iwall" ? "each face" : key > 0 ? "inside face" : "outside face";
      const id = `${g.kind}-${g.kind === "iwall" ? "each" : key > 0 ? "in" : "out"}`;
      const fl = governing(list, (f) => f.Mu / f.flex.Mr);
      add({ id: `${id}-flex`, name: `${g.name}, ${label}: flexure`, demand: fl.Mu, capacity: fl.flex.Mr, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2, 12.11.4.2", note: `${fl.station.name}, ${comboName(fl.combo)}; needs ${fl.flex.AsReq.toFixed(3)} in²/ft` });
      const withCrack = list.filter((f) => f.crack && f.Ms > 1e-9);
      if (withCrack.length) {
        const cr = governing(withCrack, (f) => f.crack!.fs / f.crack!.fss);
        add({ id: `${id}-crack`, name: `${g.name}, ${label}: crack control`, demand: cr.crack!.fs, capacity: cr.crack!.fss, unit: "ksi", ref: "AASHTO 5.6.7, C12.11.3", note: `${cr.station.name}, ${comboName(cr.serCombo)}; needs ${cr.crack!.AsReq.toFixed(3)} in²/ft` });
      }
      const { As, steel } = list[0];
      const d = h - i.cover - steel.db / 2;
      governs.push({ kind: g.kind, key: g.kind === "iwall" ? "each" : key > 0 ? "in" : "out", face: list[0].key, steel, label: `${g.name}, ${label}`, flex: fl, crack: withCrack.length ? governing(withCrack, (f) => f.crack!.fs / f.crack!.fss) : null, As, h });
      add({ id: `${id}-min`, name: `${g.name}, ${label}: minimum steel`, demand: 0.002 * b * h, capacity: As, unit: "in²/ft", ref: "AASHTO 12.11.4.3.2 (0.002 Ag)" });
      // Tension controlled, so φ applies as given: c/d ≤ 0.003/(0.003 + εtl), 0.375 up to fy 75 ksi.
      add({ id: `${id}-max`, name: `${g.name}, ${label}: tension controlled`, demand: As, capacity: (cdMax * d * 0.85 * i.fc * beta1 * b) / i.fy, unit: "in²/ft", ref: "AASHTO 5.6.2.1" });
      if (steel.bars) add({ id: `${id}-spacing`, name: `${g.name}, ${label}: bar spacing`, demand: steel.s, capacity: Math.min(1.5 * h, 18), unit: "in", ref: "AASHTO 5.10.3.2 (1.5 h, 18 in)" });
    }
    const sh = shears.filter((x) => x.station.kind === g.kind);
    if (sh.length) {
      const s = governing(sh, (x) => x.Vu / x.Vr);
      add({ id: `${g.kind}-shear`, name: `${g.name}: shear`, demand: s.Vu, capacity: s.Vr, unit: "kip/ft", ref: s.rule === "slab" ? "AASHTO 5.12.7.3" : "AASHTO 5.7.3.3", note: `${s.station.name}, ${comboName(s.combo)}` });
    }
    if (g.kind === "wall" || g.kind === "iwall") {
      const idx = stations.map((s, m) => (s.kind === g.kind ? m : -1)).filter((m) => m >= 0);
      const all = idx.flatMap((m) => variants[m].list.filter((v) => v.strength).map((v) => ({ m, v })));
      const top = all.reduce((w, x) => (x.v.N > w.v.N ? x : w), all[0]);
      const Pu = top.v.N;
      thrusts.push({ kind: g.kind, Pu, h, station: stations[top.m], combo: top.v.combo });
      add({ id: `${g.kind}-thrust`, name: `${g.name}: thrust`, demand: Pu, capacity: i.phiC * 0.1 * i.fc * b * h, unit: "kip/ft", ref: "AASHTO 5.6.4.5 (0.10 f'c Ag)" });
    }
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
    model,
    loads: { DCtop, haunchW, wallsW, DCbottom, Fe, Bc, EV, EHtop, EHbot, heq1, heq2, LStop, LSbot, WAbot, H2, wallLen },
    live: { ...ll, vehicles },
    unfactored,
    env,
    variants,
    faces,
    shears,
    governs,
    thrusts,
    diagram,
    beta1,
    cdMax,
  };
}

export type CbcResult = ReturnType<typeof designCbc>;
