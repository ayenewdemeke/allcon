import { agencyChecks, type Criteria } from "../agency-checks";
import { columnSection } from "../piers/column-section";
import { BARS, DesignError, flexure, type Bars, type Check } from "../walls/cip";
import { nominalBearing } from "./footing";
import { axialResistance, fixityEmbedment, flexuralResistance, HP_SECTIONS, interaction, PHI_PILE } from "./hpile";
import { analyzeLateral, type Layer } from "./lateral";
import { pMultiplier, toLayers, type SoilLayer } from "./piles";

// A bridge abutment, CDOT BDM 11.3 with AASHTO LRFD (10th Edition) 3.11, 3.12, 4.7.4.4, 5, 6.15, 10
// and 11.6.
//
// Integral (BDM 11.3.1, CDOT's preferred type): one row of H-piles (weak axis along the abutment) or
// drilled shafts with a pin at their top; the bridge unit's thermal movement and creep and shrinkage
// from the point of no movement at its middle, the BDM's limits (unit length Table 11-1, factored
// movement ≤ 2 in, grade ≤ 5 %, skew ≤ 30°, curvature ≤ 5°, depth ≤ 13 ft, cap 3.5 to 6 ft, cap
// embedded 1.5 ft, 2 ft to the girders, foundation elements 10 ft below the cap and beyond any
// prebore, prebore d + 1 ft with pea gravel k = 300 pci, φ = 40°, γ = 95 pcf); each pile pushed through
// the movement by p–y with its head fixed in the cap (a shaft pinned), its axial load with that
// moment (AASHTO 6.9.2.2 / 5.6.4.5) and its buckling over the unconfined length plus the depth to
// fixity (10.7.3.13.4); the cap as a continuous beam over the piles under the girders (5.6.3, 5.7.3.3,
// IM included in the cap but not the foundation, BDM 11.3), half the approach slab's dead load on it;
// the end diaphragm spanning between girders under passive earth pressure (AASHTO 3.11.5.4, 11.6.1.3).
//
// Semi-integral and seat type (BDM 11.3.2, 11.3.3): a stem and backwall on a spread footing or two rows
// of H-piles, per foot of abutment: earth pressure at rest or active (3.11.5), the bridge's reactions,
// braking and the bearings' shear; stability on the footing (eccentricity, bearing on B′ by AASHTO
// 10.6.3.1.2a, sliding) or the piles' loads; the stem and backwall in flexure and shear; the seat width
// (4.7.4.4).
// Kip, foot and inch.

export type AbutmentType = "integral-piles" | "integral-shafts" | "semi-integral" | "seat";

export type AbutmentInputs = {
  /** AASHTO LRFD, or with the CDOT Bridge Design Manual's rules too (none given: AASHTO). */
  criteria?: Criteria;
  type: AbutmentType;
  // The bridge
  unitLength: number; // ft, the continuous unit (both abutments' unit for an integral bridge)
  girderMaterial: "precast" | "steel" | "cip";
  grade: number; // %, the unit's straight-line grade
  skew: number; // deg
  curvature: number; // deg, degree of curvature
  tMin: number; // °F
  tMax: number;
  alpha: number; // per °F
  csMove: number; // in, creep, shrinkage and elastic shortening toward the middle
  gammaTU: number; // the movement's factor for deformation (AASHTO 3.4.1: 1.2)
  thermalForce: number; // TU's factor on force effects at the Strength limit (AASHTO Table 3.4.1-1: 0.50; 1.20 for deformations)
  nGirders: number;
  girderSpacing: number; // ft
  RDC: number; // kip per girder
  RDW: number;
  RLL: number; // without IM
  IM: number;
  braking: number; // kip, the whole bridge's at this abutment
  bearingShear: number; // kip/ft, the bearings' shear (seat, semi-integral)
  approachDC: number; // kip/ft, the approach slab's end reaction (half carried by the abutment, BDM 11.3)
  length: number; // ft, the abutment along its centerline
  // Integral geometry
  capWidth: number; // ft, along the bridge
  capDepth: number; // ft
  totalDepth: number; // ft, top of deck to the cap's bottom
  capEmbed: number; // ft, the cap's bottom below the embankment
  girderClear: number; // ft, top of embankment to the girders' bottom
  // Semi-integral and seat geometry
  stemH: number; // ft, top of footing to the bearing seat
  stemT: number; // ft
  backwallH: number; // ft, seat to the top of deck
  backwallT: number; // ft
  seatWidth: number; // in
  toe: number; // ft
  heel: number; // ft
  footT: number; // ft
  foundation: "footing" | "piles";
  pressure: "at-rest" | "active";
  // Materials and bars
  fc: number;
  fy: number;
  gammaC: number;
  cover: number;
  capTop: { bar: number; count: number };
  capBot: { bar: number; count: number };
  stirrup: { bar: number; spacing: number; legs: number };
  diaphragmBars: Bars; // horizontal, each face
  stemBars: Bars; // back face, vertical
  backwallBars: Bars;
  toeBars: Bars; // footing bottom
  heelBars: Bars; // footing top
  exposure: 1 | 2;
  // Soil
  backfillPhi: number;
  backfillGamma: number; // pcf
  soil: SoilLayer[]; // under the cap or footing, for the piles' and shafts' lateral analysis
  // Integral on piles
  section: string;
  Fy: number;
  nPiles: number;
  pileLength: number; // ft, below the cap
  prebore: number; // ft
  peaGravel: boolean;
  holeD: number; // in
  embed: number; // in
  Rn: number; // kip, nominal geotechnical axial resistance per pile or shaft
  phiDyn: number;
  // Integral on shafts
  shaftD: number; // in
  shaftBars: number;
  shaftBar: number;
  shaftLength: number; // ft
  // Seat on piles: two rows
  rowFront: number; // ft from the toe
  rowBack: number;
  pileSpacing: number; // ft, along the abutment
  // Seat on a footing
  c: number; // psf
  phi: number;
  gammaBelow: number; // pcf
  Dw: number; // ft below the footing's base... from the ground in front
  Df: number; // ft, ground in front to the footing's base
  phiB: number;
  phiTau: number;
};

/** An integral abutment on twelve HP 12x53 piles in 10 ft prebores with pea gravel, for a 240 ft precast girder unit. */
export const ABUTMENT_DEFAULTS: AbutmentInputs = {
  type: "integral-piles",
  unitLength: 240,
  girderMaterial: "precast",
  grade: 2,
  skew: 0,
  curvature: 0,
  tMin: 0,
  tMax: 100,
  alpha: 6e-6,
  csMove: 0.4,
  gammaTU: 1.2,
  thermalForce: 0.5,
  nGirders: 6,
  girderSpacing: 7.5,
  RDC: 140,
  RDW: 18,
  RLL: 75,
  IM: 0.33,
  braking: 40,
  bearingShear: 0,
  approachDC: 1.5,
  length: 44,
  capWidth: 3,
  capDepth: 4,
  totalDepth: 10,
  capEmbed: 2,
  girderClear: 2.5,
  stemH: 12,
  stemT: 3,
  backwallH: 6,
  backwallT: 1.5,
  seatWidth: 36,
  toe: 4,
  heel: 7,
  footT: 3,
  foundation: "footing",
  pressure: "at-rest",
  fc: 4.5,
  fy: 60,
  gammaC: 0.15,
  cover: 3,
  capTop: { bar: 8, count: 6 },
  capBot: { bar: 8, count: 6 },
  stirrup: { bar: 5, spacing: 12, legs: 2 },
  diaphragmBars: { bar: 6, spacing: 12 },
  stemBars: { bar: 8, spacing: 9 },
  backwallBars: { bar: 6, spacing: 12 },
  toeBars: { bar: 8, spacing: 9 },
  heelBars: { bar: 8, spacing: 9 },
  exposure: 1,
  backfillPhi: 34,
  backfillGamma: 125,
  soil: [
    { name: "Embankment fill", thickness: 10, kind: "sand", gamma: 125, phi: 34, k: 90, su: 0, e50: 0.007, qu: 0, Em: 0, rqd: 0 },
    { name: "Silty sand", thickness: 15, kind: "sand", gamma: 60, phi: 32, k: 60, su: 0, e50: 0.007, qu: 0, Em: 0, rqd: 0 },
    { name: "Claystone", thickness: 30, kind: "weak-rock", gamma: 65, phi: 0, k: 0, su: 0, e50: 0, qu: 300, Em: 30000, rqd: 50 },
  ],
  section: "HP12x53",
  Fy: 50,
  nPiles: 12,
  pileLength: 40,
  prebore: 10,
  peaGravel: true,
  holeD: 24,
  embed: 24,
  Rn: 450,
  phiDyn: 0.65,
  shaftD: 36,
  shaftBars: 12,
  shaftBar: 8,
  shaftLength: 30,
  rowFront: 1.5,
  rowBack: 12.5,
  pileSpacing: 4,
  c: 0,
  phi: 34,
  gammaBelow: 125,
  Dw: 30,
  Df: 4,
  phiB: 0.45,
  phiTau: 0.8,
};

const rad = (d: number) => (d * Math.PI) / 180;

/** A continuous beam on point supports (stiffness method, Euler–Bernoulli): moments and shears along it. */
export function continuousBeam(L: number, supports: number[], loads: { x: number; P: number }[], w: number) {
  const xs = [...new Set([0, L, ...supports, ...loads.map((l) => l.x), ...Array.from({ length: 41 }, (_, k) => (L * k) / 40)])].filter((x) => x >= 0 && x <= L).sort((a, b) => a - b);
  const n = xs.length;
  const N = 2 * n;
  const K = Array.from({ length: N }, () => new Array(N).fill(0));
  const F = new Array(N).fill(0);
  for (let e = 0; e < n - 1; e++) {
    const l = xs[e + 1] - xs[e];
    if (l <= 0) continue;
    const k = [
      [12 / l ** 3, 6 / l ** 2, -12 / l ** 3, 6 / l ** 2],
      [6 / l ** 2, 4 / l, -6 / l ** 2, 2 / l],
      [-12 / l ** 3, -6 / l ** 2, 12 / l ** 3, -6 / l ** 2],
      [6 / l ** 2, 2 / l, -6 / l ** 2, 4 / l],
    ];
    const dof = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) K[dof[a]][dof[b]] += k[a][b];
    const fe = [(-w * l) / 2, (-w * l * l) / 12, (-w * l) / 2, (w * l * l) / 12];
    for (let a = 0; a < 4; a++) F[dof[a]] += fe[a];
  }
  for (const p of loads) F[2 * xs.indexOf(p.x)] -= p.P;
  const fixed = new Set(supports.map((s) => 2 * xs.indexOf(s)));
  const free = Array.from({ length: N }, (_, k) => k).filter((k) => !fixed.has(k));
  const A = free.map((r) => free.map((c) => K[r][c]));
  const b = free.map((r) => F[r]);
  // Gaussian elimination.
  const m = A.length;
  for (let k = 0; k < m; k++) {
    let p = k;
    for (let r = k + 1; r < m; r++) if (Math.abs(A[r][k]) > Math.abs(A[p][k])) p = r;
    [A[k], A[p]] = [A[p], A[k]];
    [b[k], b[p]] = [b[p], b[k]];
    for (let r = k + 1; r < m; r++) {
      const f = A[r][k] / A[k][k];
      for (let c = k; c < m; c++) A[r][c] -= f * A[k][c];
      b[r] -= f * b[k];
    }
  }
  const x = new Array(m).fill(0);
  for (let k = m - 1; k >= 0; k--) {
    let s = b[k];
    for (let c = k + 1; c < m; c++) s -= A[k][c] * x[c];
    x[k] = s / A[k][k];
  }
  const d = new Array(N).fill(0);
  free.forEach((k, j) => (d[k] = x[j]));
  // Element end moments (sagging positive) and shears.
  const M: number[] = new Array(n).fill(0);
  let Vmax = 0;
  for (let e = 0; e < n - 1; e++) {
    const l = xs[e + 1] - xs[e];
    if (l <= 0) continue;
    const [v1, t1, v2, t2] = [d[2 * e], d[2 * e + 1], d[2 * e + 2], d[2 * e + 3]];
    const m1 = (6 / l ** 2) * v1 + (4 / l) * t1 - (6 / l ** 2) * v2 + (2 / l) * t2 + (w * l * l) / 12;
    const s1 = (12 / l ** 3) * v1 + (6 / l ** 2) * t1 - (12 / l ** 3) * v2 + (6 / l ** 2) * t2 + (w * l) / 2;
    M[e] = -m1;
    M[e + 1] = -m1 + s1 * l - (w * l * l) / 2;
    Vmax = Math.max(Vmax, Math.abs(s1), Math.abs(s1 - w * l));
  }
  return { xs, M, Mpos: Math.max(0, ...M), Mneg: Math.max(0, ...M.map((v) => -v)), Vmax };
}

export function designAbutment(i: AbutmentInputs) {
  if (!(i.length > 0 && i.unitLength > 0)) throw new DesignError("Give the abutment's length and the bridge unit's length.");
  if (!(i.nGirders >= 1)) throw new DesignError("Give the girders.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });
  const integral = i.type === "integral-piles" || i.type === "integral-shafts";
  const ec = 120000 * i.gammaC ** 2 * i.fc ** 0.33;
  const beta1 = Math.min(0.85, Math.max(0.65, 0.85 - (i.fc - 4) * 0.05));
  const common = { fc: i.fc, fy: i.fy, Es: 29000, phiF: 0.9, exposure: i.exposure, n: 29000 / ec, beta1 };

  // --- movement toward the abutment from the unit's middle ----------------------------------------------------------
  const half = (i.unitLength / 2) * 12;
  const expansion = i.alpha * half * Math.max(0, i.tMax - 60);
  const contraction = i.alpha * half * Math.max(0, 60 - i.tMin) + i.csMove;
  const move = Math.max(expansion, contraction);
  const totalGirderR = { DC: i.nGirders * i.RDC, DW: i.nGirders * i.RDW, LL: i.nGirders * i.RLL };

  let integralOut: ReturnType<typeof integralDesign> | null = null;
  let seatOut: ReturnType<typeof seatDesign> | null = null;
  if (integral) integralOut = integralDesign();
  else seatOut = seatDesign();
  return { checks: agencyChecks(checks, i.criteria), expansion, contraction, move, integral: integralOut, seat: seatOut, totalGirderR };

  function integralDesign() {
    add({ id: "unit-length", name: "Bridge unit length (BDM Table 11-1)", demand: i.unitLength, capacity: 460, unit: "ft", ref: "CDOT BDM 11.3.1" });
    add({ id: "movement", name: "Factored movement at the abutment, one direction", demand: i.gammaTU * move, capacity: 2, unit: "in", ref: "CDOT BDM 11.3.1, AASHTO 3.12" });
    add({ id: "grade", name: "Grade between the unit's ends", demand: i.grade, capacity: 5, unit: "%", ref: "CDOT BDM 11.3.1" });
    add({ id: "skew", name: "Skew", demand: i.skew, capacity: 30, unit: "deg", ref: "CDOT BDM 11.3.1" });
    add({ id: "curvature", name: "Degree of curvature", demand: i.curvature, capacity: 5, unit: "deg", ref: "CDOT BDM 11.3.1" });
    add({ id: "depth", name: "Depth, top of deck to the cap's bottom (typically 13 ft or less)", demand: i.totalDepth, capacity: 13, unit: "ft", ref: "CDOT BDM 11.3.1", advisory: true });
    add({ id: "cap-max", name: "Pile cap depth at most 6 ft", demand: i.capDepth, capacity: 6, unit: "ft", ref: "CDOT BDM 11.3.1" });
    add({ id: "cap-min", name: "Pile cap depth at least 3.5 ft", demand: 3.5, capacity: i.capDepth, unit: "ft", ref: "CDOT BDM 11.3.1" });
    add({ id: "cap-embed", name: "Cap's bottom embedded in the embankment", demand: 1.5, capacity: i.capEmbed, unit: "ft", ref: "CDOT BDM 11.3.1" });
    add({ id: "girder-clear", name: "Embankment to the girders' bottom", demand: 2, capacity: i.girderClear, unit: "ft", ref: "CDOT BDM 11.3.1" });
    if (i.girderMaterial === "precast" && contraction > 1) add({ id: "flex-detail", name: "Girder contraction over 1 in: add details for foundation flexibility", demand: contraction, capacity: 1, unit: "in", ref: "CDOT BDM 11.3.1", advisory: true });

    // Vertical loads on the cap and the foundation (foundation: no IM, BDM 11.3).
    const capW = i.gammaC * i.capWidth * i.totalDepth; // kip/ft, cap and diaphragm (solid)
    const apr = 0.5 * i.approachDC; // kip/ft
    const n = i.type === "integral-piles" ? i.nPiles : Math.max(2, i.nPiles);
    const factoredStrength = 1.25 * (totalGirderR.DC + (capW + apr) * i.length) + 1.5 * totalGirderR.DW + 1.75 * totalGirderR.LL;
    const service = totalGirderR.DC + (capW + apr) * i.length + totalGirderR.DW + totalGirderR.LL;
    const Pu = factoredStrength / n;
    const Ps = service / n;
    // Supports along the abutment.
    const edge = (i.length - (n - 1) * ((i.length - 2) / Math.max(1, n - 1))) / 2;
    const sp = n > 1 ? (i.length - 2 * Math.max(1, edge)) / (n - 1) : 0;
    const supports = Array.from({ length: n }, (_, k) => Math.max(1, edge) + k * sp);
    const girders = Array.from({ length: i.nGirders }, (_, k) => i.length / 2 - ((i.nGirders - 1) * i.girderSpacing) / 2 + k * i.girderSpacing);
    if (girders[0] < 0) throw new DesignError("The girders don't fit on the abutment: check the spacing and the length.");

    // The foundation elements under the imposed movement.
    const pea: Layer = { thickness: i.prebore, model: i.peaGravel ? { kind: "sand", phi: 40, gamma: 95, k: 300 } : { kind: "none" } };
    let foundation: { kind: "piles"; lat: ReturnType<typeof analyzeLateral>; inter: ReturnType<typeof interaction>; KL: number; Pr: number; Mry: number } | { kind: "shafts"; lat: ReturnType<typeof analyzeLateral>; phiMn: number } | null = null;
    const delta = i.thermalForce * move;
    if (i.type === "integral-piles") {
      const s = HP_SECTIONS[i.section];
      if (!s) throw new DesignError("Choose an H-pile section.");
      add({ id: "pile-length", name: "Piles at least 10 ft below the cap and 10 ft past the prebore", demand: Math.max(10, i.prebore + 10), capacity: i.pileLength, unit: "ft", ref: "CDOT BDM 11.3, 11.3.1" });
      if (i.prebore > 0) add({ id: "prebore", name: "Prebore diameter at least the pile's depth plus 1 ft", demand: s.d + 12, capacity: i.holeD, unit: "in", ref: "CDOT BDM 11.3.1" });
      add({ id: "embed", name: "Pile embedment into the cap, for information: the BDM 10.5.3 fixed-head length (the design takes a pin)", demand: Math.round(fixityEmbedment(s, i.Fy, i.fc)), capacity: i.embed, unit: "in", ref: "CDOT BDM 10.5.3, 11.3.1", advisory: true });
      const layers: Layer[] = [...(i.prebore > 0 ? [pea] : []), ...toLayers(i.soil).map((l, k) => (k === 0 && i.prebore > 0 ? { ...l, thickness: Math.max(0, l.thickness - i.prebore) } : l))];
      // BDM 11.3.1: a pin is taken to form between the cap and the pile; the pile's head moves with the cap.
      const lat = analyzeLateral({ length: i.pileLength, D: s.bf, EI: 29000 * s.Iy, Q: Pu, head: { kind: "displaced", y: delta, pinned: true }, layers });
      // Buckling: the length without confinement plus the depth to fixity, K = 2.1 (pinned head free to sway, fixed below).
      const unconfined = i.peaGravel ? 0 : i.prebore;
      const KL = unconfined > 0 ? 2.1 * (unconfined + (lat.zZero ?? 0)) * 12 : 0;
      const ax = axialResistance(s, i.Fy, KL);
      const Pr = PHI_PILE.combinedAxial * ax.Pn;
      const fy = flexuralResistance(s, i.Fy, "y");
      const Mry = PHI_PILE.flexure * fy.Mn;
      const inter = interaction(Pu, Pr, 0, 1, lat.Mmax * 12, Mry, fy.compact);
      add({ id: "pile-interaction", name: "Pile: axial with the movement's weak-axis moment", demand: inter.value, capacity: 1, unit: "", ref: `AASHTO 6.15.3.2, Eq. ${inter.eq}; CDOT BDM 11.3.1` });
      const axOnly = axialResistance(s, i.Fy, 0);
      add({ id: "pile-axial", name: "Pile: structural axial", demand: Pu, capacity: PHI_PILE.axialGood * axOnly.Pn, unit: "kip", ref: "AASHTO 6.15.3.1" });
      add({ id: "pile-geo", name: "Pile: geotechnical axial", demand: Pu, capacity: i.phiDyn * (n <= 3 ? 0.8 : 1) * i.Rn, unit: "kip", ref: "AASHTO 10.5.5.2.3, CDOT BDM 10.5.2.2" });
      foundation = { kind: "piles", lat, inter, KL, Pr, Mry };
    } else {
      add({ id: "shaft-length", name: "Shafts at least 10 ft below the cap", demand: 10, capacity: i.shaftLength, unit: "ft", ref: "CDOT BDM 11.3" });
      add({ id: "shaft-d", name: "Shaft diameter at least 24 in", demand: 24, capacity: i.shaftD, unit: "in", ref: "CDOT BDM 10.6.1.1" });
      const Ec = ec;
      const EI = 0.5 * Ec * ((Math.PI * i.shaftD ** 4) / 64);
      const lat = analyzeLateral({ length: i.shaftLength, D: i.shaftD, EI, Q: Pu, head: { kind: "displaced", y: delta, pinned: true }, layers: toLayers(i.soil) });
      const sec = columnSection({ shape: "round", T: i.shaftD, W: i.shaftD, cover: i.cover, bar: i.shaftBar, bars: i.shaftBars, barsT: 0, barsL: 0, barsEnd: 0, tieBar: 5, transverse: "spiral", fc: i.fc, fy: i.fy });
      const res = sec.resistance(Pu, lat.Mmax * 12, 0);
      const phiMn = res ? res.phiMn / 12 : 0;
      add({ id: "shaft-pm", name: "Shaft: axial with the movement's moment (pinned top)", demand: lat.Mmax, capacity: phiMn, unit: "kip·ft", ref: "AASHTO 5.6.4.5; CDOT BDM 11.3.1" });
      add({ id: "shaft-geo", name: "Shaft: axial resistance (from the Drilled Shaft tool)", demand: Pu, capacity: i.phiDyn * i.Rn, unit: "kip", ref: "AASHTO 10.8.3.5" });
      foundation = { kind: "shafts", lat, phiMn };
    }

    // The cap: a continuous beam over the piles, the girders with IM.
    const Pg = 1.25 * i.RDC + 1.5 * i.RDW + 1.75 * i.RLL * (1 + i.IM);
    const wCap = 1.25 * (capW + apr);
    const beam = continuousBeam(i.length, supports, girders.map((x) => ({ x, P: Pg })), wCap);
    const b = i.capWidth * 12;
    const h = i.totalDepth * 12; // the cap and diaphragm act together once cast
    const asTop = i.capTop.count * BARS[i.capTop.bar].area;
    const asBot = i.capBot.count * BARS[i.capBot.bar].area;
    const dCap = h - i.cover - 0.625 - BARS[i.capBot.bar].dia / 2;
    const Mr = (As: number) => {
      const a = (As * i.fy) / (0.85 * i.fc * b);
      return (0.9 * As * i.fy * (dCap - a / 2)) / 12;
    };
    add({ id: "cap-pos", name: "Cap: positive moment between supports", demand: beam.Mpos, capacity: Mr(asBot), unit: "kip·ft", ref: "AASHTO 5.6.3.2" });
    add({ id: "cap-neg", name: "Cap: negative moment over the supports", demand: beam.Mneg, capacity: Mr(asTop), unit: "kip·ft", ref: "AASHTO 5.6.3.2" });
    const fr = 0.24 * Math.sqrt(i.fc);
    const Mcr = (1.6 * fr * ((b * h * h) / 6) * 0.67) / 12;
    add({ id: "cap-min", name: "Cap: minimum reinforcement (bottom)", demand: Math.min(1.33 * beam.Mpos, Mcr), capacity: Mr(asBot), unit: "kip·ft", ref: "AASHTO 5.6.3.3" });
    const dv = Math.max(0.9 * dCap, 0.72 * h);
    const Vc = 0.0316 * 2 * Math.sqrt(i.fc) * b * dv;
    const Vs = (i.stirrup.legs * BARS[i.stirrup.bar].area * i.fy * dv) / i.stirrup.spacing;
    add({ id: "cap-shear", name: "Cap: shear", demand: beam.Vmax, capacity: 0.9 * Math.min(Vc + Vs, 0.25 * i.fc * b * dv), unit: "kip", ref: "AASHTO 5.7.3.3" });

    // The end diaphragm under passive pressure, spanning between girders (per foot of height at its bottom).
    const Kp = Math.tan(rad(45 + i.backfillPhi / 2)) ** 2;
    const pBottom = Kp * (i.backfillGamma / 1000) * i.totalDepth; // ksf
    const Mdia = (1.35 * pBottom * i.girderSpacing ** 2) / 10;
    const dia = flexure({ ...common, Mu: Mdia, Ms: Mdia / 1.35, h: i.capWidth * 12, cover: 2, bars: i.diaphragmBars });
    add({ id: "diaphragm", name: "End diaphragm: horizontal bars under passive pressure between girders", demand: Mdia, capacity: dia.MR, unit: "kip·ft/ft", ref: "AASHTO 3.11.5.4, 11.6.1.3, 5.6.3.2" });
    return { capW, apr, n, Pu, Ps, supports, girders, beam, foundation, delta, Kp, pBottom, Mdia, Pg };
  }

  function seatDesign() {
    // Per foot of abutment.
    const perFt = (v: number) => v / i.length;
    const Hs = i.stemH;
    const Hb = i.backwallH;
    const H = i.footT + Hs + Hb;
    const B = i.toe + i.stemT + i.heel;
    const g = i.backfillGamma / 1000;
    const phiS = rad(i.backfillPhi);
    const K = i.pressure === "at-rest" ? 1 - Math.sin(phiS) : Math.tan(rad(45 - i.backfillPhi / 2)) ** 2;
    const gEH = i.pressure === "at-rest" ? { max: 1.35, min: 0.9 } : { max: 1.5, min: 0.9 };
    // Forces per foot, moments about the toe (x from the toe).
    const xStem = i.toe + i.stemT / 2;
    const xBack = i.toe + i.stemT - i.backwallT / 2;
    const items = {
      stem: { V: i.gammaC * i.stemT * Hs, x: xStem },
      backwall: { V: i.gammaC * i.backwallT * Hb, x: xBack },
      footing: { V: i.gammaC * B * i.footT, x: B / 2 },
      soil: { V: g * i.heel * (Hs + Hb), x: i.toe + i.stemT + i.heel / 2 },
      DC: { V: perFt(totalGirderR.DC) + 0.5 * i.approachDC, x: xStem },
      DW: { V: perFt(totalGirderR.DW), x: xStem },
      LL: { V: perFt(totalGirderR.LL), x: xStem },
    };
    const EH = 0.5 * K * g * H * H; // kip/ft at H/3
    const BR = perFt(i.braking);
    const yBR = i.footT + Hs + (i.type === "semi-integral" ? Hb : 0);
    const TU = i.bearingShear;
    // Strength I, two sets: the most vertical (bearing) and the least (sliding, eccentricity).
    const combos = [
      { name: "Strength I, maximum", dc: 1.25, dw: 1.5, ev: 1.35, eh: gEH.max, ll: 1.75, tu: 0.5 },
      { name: "Strength I, minimum", dc: 0.9, dw: 0.65, ev: 1.0, eh: gEH.max, ll: 0, tu: 0.5 },
      { name: "Service I", dc: 1, dw: 1, ev: 1, eh: 1, ll: 1, tu: 1 },
    ];
    const rows = combos.map((c) => {
      const V = c.dc * (items.stem.V + items.backwall.V + items.footing.V + items.DC.V) + c.dw * items.DW.V + c.ev * items.soil.V + c.ll * items.LL.V;
      const Mr = c.dc * (items.stem.V * items.stem.x + items.backwall.V * items.backwall.x + items.footing.V * items.footing.x + items.DC.V * items.DC.x) + c.dw * items.DW.V * items.DW.x + c.ev * items.soil.V * items.soil.x + c.ll * items.LL.V * items.LL.x;
      const Hh = c.eh * EH + (c.ll > 0 ? 1.75 : 0) * BR + c.tu * TU;
      const Mo = c.eh * EH * (H / 3) + (c.ll > 0 ? 1.75 : 0) * BR * yBR + c.tu * TU * yBR;
      const xR = (Mr - Mo) / V;
      const e = B / 2 - xR;
      return { c, V, Mr, Mo, Hh, xR, e };
    });
    const strength = rows.filter((r) => r.c.name.startsWith("Strength"));
    const worstE = strength.reduce((a, b) => (Math.abs(b.e) > Math.abs(a.e) ? b : a));
    let footing: null | { qeq: number; qR: number; slide: number; RR: number; nb: ReturnType<typeof nominalBearing> } = null;
    let piles: null | { Pfront: number; Pback: number; Hp: number; inter: ReturnType<typeof interaction>; lat: ReturnType<typeof analyzeLateral> } = null;
    if (i.foundation === "footing") {
      add({ id: "ecc", name: `Eccentricity (${worstE.c.name})`, demand: Math.abs(worstE.e), capacity: B / 3, unit: "ft", ref: "AASHTO 10.6.3.3, 11.6.3.3" });
      const bmax = strength[0];
      const Bp = Math.max(0.01, B - 2 * Math.abs(bmax.e));
      const nb = nominalBearing({ c: i.c, phi: i.phi, gammaAbove: i.backfillGamma, gammaBelow: i.gammaBelow, Df: i.Df, Dw: i.Dw, B: Bp, L: 1e6, depthFactor: false });
      const qeq = bmax.V / Bp;
      add({ id: "bearing", name: `Bearing on B′ (${bmax.c.name})`, demand: qeq, capacity: i.phiB * nb.qn, unit: "ksf", ref: "AASHTO 10.6.3.1.2a, 11.6.3.2" });
      const smin = strength[1];
      const RR = i.phiTau * smin.V * Math.tan(rad(i.phi));
      add({ id: "sliding", name: `Sliding (${smin.c.name})`, demand: smin.Hh, capacity: RR, unit: "kip/ft", ref: "AASHTO 10.6.3.4, 11.6.3.6" });
      footing = { qeq, qR: i.phiB * nb.qn, slide: smin.Hh, RR, nb };
    } else {
      const s = HP_SECTIONS[i.section];
      if (!s) throw new DesignError("Choose an H-pile section.");
      const xf = i.rowFront;
      const xb = i.rowBack;
      const xc = (xf + xb) / 2;
      const r = strength[0];
      const Mc = r.V * (xc - r.xR); // about the group's center
      const half = (xb - xf) / 2;
      const perRow = (sign: number) => (r.V / 2 + (sign * Mc) / (2 * half)) * i.pileSpacing;
      const Pfront = perRow(1);
      const Pback = perRow(-1);
      add({ id: "pile-geo", name: "Front row pile: geotechnical axial", demand: Math.max(Pfront, Pback), capacity: i.phiDyn * i.Rn, unit: "kip", ref: "AASHTO 10.5.5.2.3" });
      if (Math.min(Pfront, Pback) < 0) add({ id: "pile-uplift", name: "Back row pile in uplift: check it against the uplift resistance from the geotechnical report", demand: -Math.min(Pfront, Pback), capacity: 0, unit: "kip", ref: "AASHTO 10.7.3.10", advisory: true });
      const Hp = (r.Hh * i.pileSpacing) / 2;
      const ratio = ((xb - xf) * 12) / s.bf;
      const pm = (pMultiplier(1, ratio) + pMultiplier(2, ratio)) / 2;
      // The piles' strong axis bends under the earth pressure along the bridge; the head fixed in the footing.
      const lat = analyzeLateral({ length: i.pileLength, D: s.bf, EI: 29000 * s.Ix, Q: Math.max(Pfront, Pback), pm, head: { kind: "fixed", H: Hp }, layers: toLayers(i.soil) });
      const ax = axialResistance(s, i.Fy, 0);
      const fxx = flexuralResistance(s, i.Fy, "x");
      const inter = interaction(Math.max(Pfront, Pback), PHI_PILE.combinedAxial * ax.Pn, lat.Mmax * 12, fxx.Mn, 0, 1, fxx.compact);
      add({ id: "pile-interaction", name: "Pile: axial with flexure", demand: inter.value, capacity: 1, unit: "", ref: `AASHTO 6.15.3.2, Eq. ${inter.eq}` });
      piles = { Pfront, Pback, Hp, inter, lat };
    }
    // The stem at the footing's top: earth over Hs + Hb, braking and the bearings' shear at the seat.
    const Hst = Hs + Hb;
    const Mstem = gEH.max * K * g * Hst ** 3 / 6 + 1.75 * BR * (yBR - i.footT) + 0.5 * TU * (yBR - i.footT);
    const Mstem_s = K * g * Hst ** 3 / 6 + BR * (yBR - i.footT) + TU * (yBR - i.footT);
    const Vstem = gEH.max * 0.5 * K * g * Hst ** 2 + 1.75 * BR + 0.5 * TU;
    const fs = flexure({ ...common, Mu: Mstem, Ms: Mstem_s, h: i.stemT * 12, cover: 2, bars: i.stemBars });
    add({ id: "stem-flex", name: "Stem: flexure at the footing", demand: Mstem, capacity: fs.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2" });
    add({ id: "stem-min", name: "Stem: minimum reinforcement", demand: fs.minRequired, capacity: fs.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
    add({ id: "stem-crack", name: "Stem: crack control (spacing)", demand: i.stemBars.spacing, capacity: fs.sMax, unit: "in", ref: "AASHTO 5.6.7" });
    const dvS = Math.max(0.9 * fs.de, 0.72 * i.stemT * 12);
    add({ id: "stem-shear", name: "Stem: shear at the footing", demand: Vstem, capacity: 0.9 * 0.0316 * 2 * Math.sqrt(i.fc) * 12 * dvS, unit: "kip/ft", ref: "AASHTO 5.7.3.3" });
    const Mbw = (gEH.max * K * g * Hb ** 3) / 6;
    const fb = flexure({ ...common, Mu: Mbw, Ms: Mbw / gEH.max, h: i.backwallT * 12, cover: 2, bars: i.backwallBars });
    add({ id: "backwall", name: "Backwall: flexure at the seat", demand: Mbw, capacity: fb.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2, 3.11.5" });
    // The seat width (4.7.4.4): N = (8 + 0.02 L + 0.08 H)(1 + 0.000125 S²), H = 0 at an abutment.
    if (i.type === "seat") {
      const N = (8 + 0.02 * i.unitLength) * (1 + 0.000125 * i.skew ** 2);
      add({ id: "seat", name: "Bearing seat width", demand: N, capacity: i.seatWidth, unit: "in", ref: "AASHTO 4.7.4.4" });
    }
    // The footing (or pile cap) as cantilevers from the stem: the toe under the bearing pressure.
    const r0 = strength[0];
    const qToe = i.foundation === "footing" ? (() => {
      const e = r0.e;
      const q1 = Math.abs(e) <= B / 6 ? (r0.V / B) * (1 + (6 * e) / B) : (2 * r0.V) / (3 * (B / 2 - e));
      return q1;
    })() : 0;
    const Mtoe = i.foundation === "footing" ? (qToe * i.toe ** 2) / 2 - 1.25 * i.gammaC * i.footT * i.toe ** 2 / 2 : (piles ? (piles.Pfront / i.pileSpacing) * Math.max(0, i.toe - i.rowFront) : 0);
    const ft = flexure({ ...common, Mu: Math.max(0, Mtoe), Ms: Math.max(0, Mtoe) / 1.4, h: i.footT * 12, cover: 3, bars: i.toeBars });
    add({ id: "toe", name: "Footing toe: flexure at the stem", demand: Math.max(0, Mtoe), capacity: ft.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2" });
    const Mheel = 1.35 * g * (Hs + Hb) * i.heel ** 2 / 2 + 1.25 * i.gammaC * i.footT * i.heel ** 2 / 2;
    const fh = flexure({ ...common, Mu: Mheel, Ms: Mheel / 1.3, h: i.footT * 12, cover: 2, bars: i.heelBars });
    add({ id: "heel", name: "Footing heel: flexure at the stem (soil and footing, no pressure under it)", demand: Mheel, capacity: fh.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2" });
    return { H, B, K, EH, BR, rows, footing, piles, Mstem, Vstem, Mbw, Mtoe, Mheel, items };
  }
}

export type AbutmentResult = ReturnType<typeof designAbutment>;
