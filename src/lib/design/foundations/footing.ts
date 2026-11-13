import { BARS, DesignError, flexure, type Bars, type Check } from "../walls/cip";

// A spread footing under a column, AASHTO LRFD (10th Edition) with the FHWA NHI Soils and Foundations
// Reference Manual (FHWA-NHI-06-089, Ch. 8) and GEC 6 (FHWA-SA-02-054), and CDOT BDM 10.4.
//
// Geotechnical (on the footing's base, per load case): eccentricity (AASHTO 10.6.3.3), bearing on the
// effective area B′·L′ (10.6.1.3, NHI Eqs. 8-7 to 8-9) against the nominal resistance of AASHTO Eq.
// 10.6.3.1.2a-1 / NHI Eq. 8-6 (Nc, Nq, Nγ by Prandtl, Reissner and Vesić; shape, groundwater and
// optional depth factors, Tables 8-4 to 8-6; the inclination factors omitted, as NHI 8.4.3.1 and
// AASHTO C10.6.3.1.2a allow) or a nominal resistance entered from the geotechnical report (rock, a
// semi-empirical method), sliding (10.6.3.4), and settlement at the Service limit by Schmertmann's
// method (NHI Eqs. 8-16 to 8-18, Fig. 8-21).
// Structural: the column loads' factored soil pressure, linear under a rigid footing (NHI 8.4.3.1:
// the effective area for sizing, the actual distribution for the structure), flexure at the column's
// face (5.12.8.4, the short direction's bars banded), minimum steel (5.6.3.3), crack control (5.6.7),
// one-way shear at dv from the face (5.12.8.6.2, β = 2), two-way shear at dv/2 (5.12.8.6.3), the
// bars developed past the face (5.10.8.2.1), and bearing at the column (5.6.5).
//
// Kip, foot and inch; soil unit weights in pcf, strengths in psf, as geotechnical reports give them.

export type FootingCase = { name: string; limit: "strength" | "service" | "extreme"; P: number; MB: number; ML: number; HB: number; HL: number };

export type SettlementLayer = { thickness: number; gamma: number; E: number; source: "entered" | "silt" | "fine-sand" | "coarse-sand" | "gravel"; N160: number }; // ft; effective unit weight pcf; E ksf when entered

export type FootingInputs = {
  B: number; // ft, along the footing's B axis
  L: number; // ft
  t: number; // in
  Df: number; // ft, ground to the footing's base
  colShape: "rectangular" | "round";
  colB: number; // in (round: diameter)
  colL: number; // in
  fc: number;
  fy: number;
  fcCol: number; // ksi, the column's concrete (bearing at the joint)
  gammaC: number; // kcf
  cover: number; // in, bottom (cast against earth)
  barsB: Bars; // bottom, spanning along B (the lower layer)
  barsL: Bars; // bottom, spanning along L (on top of barsB)
  exposure: 1 | 2;
  // Soil
  gammaAbove: number; // pcf, total, the backfill over the footing
  onRock: boolean;
  bearing: "computed" | "entered";
  c: number; // psf, cohesion (undrained strength)
  phi: number; // deg
  gammaBelow: number; // pcf, total
  Dw: number; // ft, ground to the water table
  depthFactor: boolean;
  qn: number; // ksf, entered nominal bearing resistance
  phiB: number; // bearing resistance factor (AASHTO Table 10.5.5.2.2-1)
  // Sliding
  interface: "sand" | "clay";
  delta: number; // deg, interface friction (cast-in-place: φ of the soil)
  su: number; // psf, clay's undrained strength under the footing
  phiTau: number; // 0.80 cast on sand, 0.85 on clay
  passive: boolean;
  phiEp: number; // 0.50
  // Settlement (Service I)
  settlement: boolean;
  layers: SettlementLayer[];
  years: number; // creep, C2
  tolerable: number; // in
  cases: FootingCase[];
};

/** A square 12 ft footing, 3 ft thick, under a 3 ft round column, on medium dense sand. */
export const FOOTING_DEFAULTS: FootingInputs = {
  B: 12,
  L: 12,
  t: 36,
  Df: 6,
  colShape: "round",
  colB: 36,
  colL: 36,
  fc: 4.5,
  fy: 60,
  fcCol: 4.5,
  gammaC: 0.15,
  cover: 3,
  barsB: { bar: 8, spacing: 9 },
  barsL: { bar: 8, spacing: 9 },
  exposure: 1,
  gammaAbove: 125,
  onRock: false,
  bearing: "computed",
  c: 0,
  phi: 34,
  gammaBelow: 125,
  Dw: 30,
  depthFactor: false,
  qn: 30,
  phiB: 0.45,
  interface: "sand",
  delta: 34,
  su: 1000,
  phiTau: 0.8,
  passive: false,
  phiEp: 0.5,
  settlement: true,
  layers: [
    { thickness: 10, gamma: 125, E: 0, source: "fine-sand", N160: 20 },
    { thickness: 20, gamma: 125, E: 0, source: "coarse-sand", N160: 30 },
  ],
  years: 0.1,
  tolerable: 1,
  cases: [
    { name: "Strength I", limit: "strength", P: 900, MB: 350, ML: 120, HB: 25, HL: 10 },
    { name: "Strength III", limit: "strength", P: 700, MB: 500, ML: 80, HB: 45, HL: 10 },
    { name: "Service I", limit: "service", P: 620, MB: 230, ML: 80, HB: 17, HL: 6 },
  ],
};

const rad = (d: number) => (d * Math.PI) / 180;

/** Bearing capacity factors (AASHTO Table 10.6.3.1.2a-1, NHI Eqs. 8-2 to 8-5). */
export function bearingFactors(phi: number) {
  if (phi <= 0) return { Nc: 5.14, Nq: 1, Ng: 0 };
  const t = Math.tan(rad(phi));
  const Nq = Math.exp(Math.PI * t) * Math.tan(rad(45 + phi / 2)) ** 2;
  return { Nc: (Nq - 1) / t, Nq, Ng: 2 * (Nq + 1) * t };
}

/** Shape factors (AASHTO Table 10.6.3.1.2a-3, NHI Table 8-4), B ≤ L. */
export function shapeFactors(phi: number, B: number, L: number, Nq: number, Nc: number) {
  const r = Math.min(1, B / L);
  if (phi <= 0) return { sc: 1 + r / 5, sq: 1, sg: 1 };
  return { sc: 1 + r * (Nq / Nc), sq: 1 + r * Math.tan(rad(phi)), sg: 1 - 0.4 * r };
}

/** Groundwater factors (AASHTO Table 10.6.3.1.2a-2, NHI Table 8-5), Dw from the ground. */
export function waterFactors(Dw: number, Df: number, B: number) {
  const lim = 1.5 * B + Df;
  if (Dw <= 0) return { Cwq: 0.5, Cwg: 0.5 };
  if (Dw < Df) return { Cwq: 0.5 + (0.5 * Dw) / Df, Cwg: 0.5 };
  if (Dw < lim) return { Cwq: 1, Cwg: 0.5 + (0.5 * (Dw - Df)) / (lim - Df) };
  return { Cwq: 1, Cwg: 1 };
}

/** Depth factor dq (Hansen and Inan, AASHTO Table 10.6.3.1.2a-4, NHI Table 8-6), for φ ≥ 32°. */
export function depthFactor(phi: number, DfB: number) {
  if (phi < 32 || DfB <= 0) return 1;
  const rows: [number, number[]][] = [
    [32, [1.2, 1.3, 1.35, 1.4]],
    [37, [1.2, 1.25, 1.3, 1.35]],
    [42, [1.15, 1.2, 1.25, 1.3]],
  ];
  const xs = [1, 2, 4, 8];
  const at = (vals: number[]) => {
    if (DfB <= 1) return 1 + (vals[0] - 1) * DfB;
    for (let k = 1; k < xs.length; k++) if (DfB <= xs[k]) return vals[k - 1] + ((vals[k] - vals[k - 1]) * (DfB - xs[k - 1])) / (xs[k] - xs[k - 1]);
    return vals[vals.length - 1];
  };
  const p = Math.min(42, phi);
  for (let k = 1; k < rows.length; k++)
    if (p <= rows[k][0]) {
      const [p0, v0] = rows[k - 1];
      const [p1, v1] = rows[k];
      return at(v0) + ((at(v1) - at(v0)) * (p - p0)) / (p1 - p0);
    }
  return at(rows[rows.length - 1][1]);
}

/** Nominal bearing resistance (ksf) on an effective footing B′ × L′ (AASHTO Eq. 10.6.3.1.2a-1, NHI Eq. 8-6). */
export function nominalBearing(o: { c: number; phi: number; gammaAbove: number; gammaBelow: number; Df: number; Dw: number; B: number; L: number; depthFactor: boolean }) {
  const Bs = Math.min(o.B, o.L);
  const Ls = Math.max(o.B, o.L);
  const { Nc, Nq, Ng } = bearingFactors(o.phi);
  const { sc, sq, sg } = shapeFactors(o.phi, Bs, Ls, Nq, Nc);
  const { Cwq, Cwg } = waterFactors(o.Dw, o.Df, Bs);
  const dq = o.depthFactor ? depthFactor(o.phi, o.Df / Bs) : 1;
  const c = o.c / 1000;
  const q = (o.gammaAbove / 1000) * o.Df;
  const g = o.gammaBelow / 1000;
  const termC = c * Nc * sc;
  const termQ = q * Nq * sq * dq * Cwq;
  const termG = 0.5 * g * Bs * Ng * sg * Cwg;
  return { Nc, Nq, Ng, sc, sq, sg, Cwq, Cwg, dq, termC, termQ, termG, qn: termC + termQ + termG, Bs, Ls };
}

/** Elastic modulus of a layer (ksf): entered, or from N160 by NHI Table 5-16 (tsf × 2). */
export function layerModulus(l: SettlementLayer) {
  const per = { silt: 4, "fine-sand": 7, "coarse-sand": 10, gravel: 12 } as const;
  return l.source === "entered" ? l.E : per[l.source] * l.N160 * 2;
}

/** Schmertmann's immediate settlement (in) of a footing B ≤ L under a net pressure Δp (ksf), NHI Eqs. 8-16 to 8-18. */
export function schmertmann(o: { B: number; L: number; dp: number; p0: number; layers: SettlementLayer[]; years: number }) {
  const B = Math.min(o.B, o.L);
  const r = Math.min(10, Math.max(1, Math.max(o.B, o.L) / B));
  const f = (r - 1) / 9; // 0 axisymmetric, 1 plane strain
  const IzB = 0.1 + 0.1 * f;
  const DI = B * (2 + 2 * f);
  const DIP = B * (0.5 + 0.5 * f);
  // σ'vp at the peak's depth: p0 at the base plus the layers' weight down to DIP.
  let pop = o.p0;
  {
    let z = 0;
    for (const l of o.layers) {
      const dz = Math.max(0, Math.min(l.thickness, DIP - z));
      pop += (l.gamma / 1000) * dz;
      z += l.thickness;
    }
  }
  const Izp = 0.5 + 0.1 * Math.sqrt(Math.max(0, o.dp) / pop);
  const Iz = (z: number) => (z <= DIP ? IzB + ((Izp - IzB) * z) / DIP : z <= DI ? (Izp * (DI - z)) / (DI - DIP) : 0);
  const correlated = o.layers.some((l) => l.source !== "entered");
  const X = correlated ? 1.25 + 0.5 * f : 1;
  // Integrate over thin slices.
  let sum = 0; // in per ksf
  let top = 0;
  const rows: { top: number; bottom: number; E: number; Iz: number }[] = [];
  for (const l of o.layers) {
    const bot = top + l.thickness;
    const E = layerModulus(l);
    const a = Math.min(top, DI);
    const b = Math.min(bot, DI);
    if (b > a && E > 0) {
      const n = Math.max(4, Math.ceil((b - a) / 0.1));
      const dz = (b - a) / n;
      for (let k = 0; k < n; k++) sum += (Iz(a + (k + 0.5) * dz) * dz * 12) / (X * E);
      rows.push({ top, bottom: bot, E, Iz: Iz((a + b) / 2) });
    }
    top = bot;
  }
  if (top < DI) sum += 0; // below the layers given: taken as incompressible
  const C1 = Math.max(0.5, 1 - 0.5 * (o.p0 / Math.max(o.dp, 1e-9)));
  const C2 = 1 + 0.2 * Math.log10(Math.max(o.years, 0.1) / 0.1);
  return { Si: C1 * C2 * Math.max(0, o.dp) * sum, C1, C2, IzB, Izp, DI, DIP, X, pop, sum, rows, covered: top >= DI };
}

/** Rigid footing pressure q = a + b·x + c·y (ksf) under V (kip) with base moments MB (tilting along B) and ML, without tension: Newton on the contact plane. */
export function contactPressure(B: number, L: number, V: number, MB: number, ML: number) {
  const n = 40;
  const dx = B / n;
  const dy = L / n;
  let a = V / (B * L);
  let b = (MB * 12) / (B ** 3 * L);
  let c = (ML * 12) / (L ** 3 * B);
  for (let it = 0; it < 60; it++) {
    let F = 0;
    let Mx = 0;
    let My = 0;
    const J = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = -B / 2 + (i + 0.5) * dx;
        const y = -L / 2 + (j + 0.5) * dy;
        const q = a + b * x + c * y;
        if (q <= 0) continue;
        const w = dx * dy;
        F += q * w;
        Mx += q * x * w;
        My += q * y * w;
        const g = [1, x, y];
        for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) J[r][s] += g[r] * g[s] * w;
      }
    const R = [F - V, Mx - MB, My - ML];
    if (Math.max(...R.map(Math.abs)) < 1e-6 * Math.max(1, V)) break;
    // Solve J·Δ = −R (3×3).
    const d = solve3(J, R.map((v) => -v));
    a += d[0];
    b += d[1];
    c += d[2];
  }
  const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => a + b * (sx * B) / 2 + c * (sy * L) / 2));
  return { a, b, c, qmax: Math.max(...corners), qmin: Math.min(...corners), q: (x: number, y: number) => Math.max(0, a + b * x + c * y) };
}

function solve3(A: number[][], r: number[]) {
  const m = A.map((row, i) => [...row, r[i]]);
  for (let k = 0; k < 3; k++) {
    let p = k;
    for (let i = k + 1; i < 3; i++) if (Math.abs(m[i][k]) > Math.abs(m[p][k])) p = i;
    [m[k], m[p]] = [m[p], m[k]];
    if (Math.abs(m[k][k]) < 1e-14) return [0, 0, 0];
    for (let i = k + 1; i < 3; i++) {
      const f = m[i][k] / m[k][k];
      for (let j = k; j < 4; j++) m[i][j] -= f * m[k][j];
    }
  }
  const x = [0, 0, 0];
  for (let k = 2; k >= 0; k--) x[k] = (m[k][3] - (k < 2 ? m[k][k + 1] * x[k + 1] : 0) - (k < 1 ? m[k][2] * x[2] : 0)) / m[k][k];
  return x;
}

/** Load factors on the footing's own weight and the soil over it: largest for bearing, least for sliding and eccentricity. */
const weightFactors = (limit: FootingCase["limit"]) => (limit === "strength" ? { maxDC: 1.25, maxEV: 1.35, minDC: 0.9, minEV: 1.0 } : { maxDC: 1, maxEV: 1, minDC: 1, minEV: 1 });

export function designFooting(i: FootingInputs) {
  if (!(i.B > 0 && i.L > 0 && i.t > 0)) throw new DesignError("The footing needs a width, a length and a thickness.");
  if (!(i.colB > 0 && i.colL > 0)) throw new DesignError("The column needs its size.");
  if (i.colB / 12 >= i.B || (i.colShape === "rectangular" && i.colL / 12 >= i.L)) throw new DesignError("The column is wider than the footing.");
  if (i.Df < i.t / 12) throw new DesignError("The footing's base must be at least its thickness below the ground.");
  if (!i.cases.length) throw new DesignError("Enter at least one load case.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? (c.lowerIsBetter ? c.demand >= c.capacity : c.demand <= c.capacity) });
  const A = i.B * i.L;
  const tF = i.t / 12;
  // The column's footprint (a round column as its equivalent square, AASHTO 5.12.8.4).
  const colArea = i.colShape === "round" ? (Math.PI * (i.colB / 12) ** 2) / 4 : (i.colB / 12) * (i.colL / 12);
  const cB = i.colShape === "round" ? Math.sqrt(colArea) : i.colB / 12; // ft
  const cL = i.colShape === "round" ? Math.sqrt(colArea) : i.colL / 12;
  const Wf = A * tF * i.gammaC; // kip
  const Ws = Math.max(0, A - colArea) * Math.max(0, i.Df - tF) * (i.gammaAbove / 1000);

  add({ id: "embedment", name: "Footing base at least 3 ft below the ground", demand: 3, capacity: i.Df, unit: "ft", ref: "CDOT BDM 10.4.2", ok: i.onRock || i.Df >= 3, advisory: i.onRock });

  // --- the geotechnical checks, each case ----------------------------------------------------------------------
  const cases = i.cases.map((lc) => {
    const f = weightFactors(lc.limit);
    const MBb = lc.MB + lc.HB * tF; // kip·ft at the base
    const MLb = lc.ML + lc.HL * tF;
    const Vmax = lc.P + f.maxDC * Wf + f.maxEV * Ws;
    const Vmin = lc.P + f.minDC * Wf + f.minEV * Ws;
    // Eccentricity with the least vertical load (the most eccentric).
    const eB = Math.abs(MBb) / Vmin;
    const eL = Math.abs(MLb) / Vmin;
    // Bearing with the largest vertical load on its effective area.
    const eBb = Math.abs(MBb) / Vmax;
    const eLb = Math.abs(MLb) / Vmax;
    const Bp = Math.max(0.01, i.B - 2 * eBb);
    const Lp = Math.max(0.01, i.L - 2 * eLb);
    const qeq = Vmax / (Bp * Lp);
    const nb = i.bearing === "computed" ? nominalBearing({ c: i.c, phi: i.phi, gammaAbove: i.gammaAbove, gammaBelow: i.gammaBelow, Df: i.Df, Dw: i.Dw, B: Bp, L: Lp, depthFactor: i.depthFactor }) : null;
    const qn = nb ? nb.qn : i.qn;
    const phiB = lc.limit === "extreme" ? 1.0 : i.phiB;
    // Sliding with the least vertical load.
    const H = Math.hypot(lc.HB, lc.HL);
    const Rtau = i.interface === "sand" ? Vmin * Math.tan(rad(i.delta)) : Math.min((i.su / 1000) * A, 0.5 * Vmin);
    const Kp = Math.tan(rad(45 + i.phi / 2)) ** 2;
    const g = i.gammaAbove / 1000;
    const width = lc.HB >= lc.HL ? i.L : i.B;
    const Rep = i.passive ? 0.5 * Kp * g * (i.Df ** 2 - Math.max(0, i.Df - tF) ** 2) * width : 0;
    const phiTau = lc.limit === "extreme" ? 1.0 : i.phiTau;
    const phiEp = lc.limit === "extreme" ? 1.0 : i.phiEp;
    const RR = phiTau * Rtau + phiEp * Rep;
    return { lc, MBb, MLb, Vmax, Vmin, eB, eL, Bp, Lp, qeq, nb, qn, phiB, qR: phiB * qn, H, Rtau, Rep, RR, Kp };
  });
  const factored = cases.filter((c) => c.lc.limit !== "service");
  const eLimit = i.onRock ? 0.45 : 1 / 3;
  const govE = (dir: "B" | "L") => factored.reduce((a, b) => ((dir === "B" ? b.eB / i.B : b.eL / i.L) > (dir === "B" ? a.eB / i.B : a.eL / i.L) ? b : a), factored[0]);
  if (factored.length) {
    const gB = govE("B");
    add({ id: "ecc-B", name: `Eccentricity along B (${gB.lc.name})`, demand: gB.eB, capacity: eLimit * i.B, unit: "ft", ref: "AASHTO 10.6.3.3" });
    const gL = govE("L");
    add({ id: "ecc-L", name: `Eccentricity along L (${gL.lc.name})`, demand: gL.eL, capacity: eLimit * i.L, unit: "ft", ref: "AASHTO 10.6.3.3" });
    const gb = factored.reduce((a, b) => (b.qeq / b.qR > a.qeq / a.qR ? b : a));
    add({ id: "bearing", name: `Bearing on the effective area B′L′ (${gb.lc.name})`, demand: gb.qeq, capacity: gb.qR, unit: "ksf", ref: i.bearing === "computed" ? "AASHTO 10.6.3.1.2a" : "AASHTO 10.6.3.1, 10.6.3.2" });
    const gs = factored.reduce((a, b) => (b.H / Math.max(b.RR, 1e-9) > a.H / Math.max(a.RR, 1e-9) ? b : a));
    add({ id: "sliding", name: `Sliding (${gs.lc.name})`, demand: gs.H, capacity: gs.RR, unit: "kip", ref: "AASHTO 10.6.3.4" });
  }

  // --- settlement, Service I ---------------------------------------------------------------------------------------
  const service = cases.filter((c) => c.lc.limit === "service");
  let settle: (ReturnType<typeof schmertmann> & { dp: number; p0: number; name: string }) | null = null;
  if (i.settlement && service.length && !i.onRock && i.layers.length) {
    const s = service.reduce((a, b) => (b.Vmax > a.Vmax ? b : a));
    const p = s.Vmax / A;
    const p0 = (i.gammaAbove / 1000) * i.Df;
    const dp = p - p0;
    settle = { ...schmertmann({ B: i.B, L: i.L, dp, p0, layers: i.layers, years: i.years }), dp, p0, name: s.lc.name };
    add({ id: "settlement", name: `Settlement, Schmertmann (${s.lc.name})`, demand: settle.Si, capacity: i.tolerable, unit: "in", ref: "AASHTO 10.6.2.4.2, FHWA NHI-06-089 8.5.1" });
  }

  // --- structure: factored pressure from the column's loads --------------------------------------------------------
  const strength = cases.filter((c) => c.lc.limit !== "service");
  const ec = 120000 * i.gammaC ** 2 * i.fc ** 0.33; // AASHTO Eq. 5.4.2.4-1
  const n = 29000 / ec;
  const beta1 = Math.min(0.85, Math.max(0.65, 0.85 - (i.fc - 4) * 0.05));
  const dbB = BARS[i.barsB.bar].dia;
  const dbL = BARS[i.barsL.bar].dia;
  const dB = i.t - i.cover - dbB / 2; // in, bars along B the lower layer
  const dL = i.t - i.cover - dbB - dbL / 2;
  const dvOf = (d: number) => Math.max(0.9 * d, 0.72 * i.t);
  const struct = strength.map((c) => {
    // The column's loads only: the footing and the soil over it bear directly.
    const P = c.lc.P;
    const cp = contactPressure(i.B, i.L, P, c.lc.MB + c.lc.HB * tF, c.lc.ML + c.lc.HL * tF);
    const nx = 60;
    // Moments at the column's faces: the pressure beyond each face times its arm, both sides, the larger.
    const momentB = (side: 1 | -1) => {
      const x0 = (side * cB) / 2;
      const x1 = (side * i.B) / 2;
      let m = 0;
      for (let a = 0; a < nx; a++)
        for (let b = 0; b < nx; b++) {
          const x = x0 + ((x1 - x0) * (a + 0.5)) / nx;
          const y = -i.L / 2 + (i.L * (b + 0.5)) / nx;
          m += cp.q(x, y) * Math.abs(x - x0) * (Math.abs(x1 - x0) / nx) * (i.L / nx);
        }
      return m;
    };
    const momentL = (side: 1 | -1) => {
      const y0 = (side * cL) / 2;
      const y1 = (side * i.L) / 2;
      let m = 0;
      for (let a = 0; a < nx; a++)
        for (let b = 0; b < nx; b++) {
          const y = y0 + ((y1 - y0) * (a + 0.5)) / nx;
          const x = -i.B / 2 + (i.B * (b + 0.5)) / nx;
          m += cp.q(x, y) * Math.abs(y - y0) * (Math.abs(y1 - y0) / nx) * (i.B / nx);
        }
      return m;
    };
    const MuB = Math.max(momentB(1), momentB(-1)); // kip·ft over the footing's length L, bars along B
    const MuL = Math.max(momentL(1), momentL(-1));
    // One-way shear at dv from the face.
    const shearB = (side: 1 | -1, dv: number) => {
      const x0 = (side * (cB / 2 + dv / 12));
      const x1 = (side * i.B) / 2;
      if (Math.abs(x0) >= Math.abs(x1)) return 0;
      let v = 0;
      for (let a = 0; a < nx; a++)
        for (let b = 0; b < nx; b++) v += cp.q(x0 + ((x1 - x0) * (a + 0.5)) / nx, -i.L / 2 + (i.L * (b + 0.5)) / nx) * (Math.abs(x1 - x0) / nx) * (i.L / nx);
      return v;
    };
    const shearL = (side: 1 | -1, dv: number) => {
      const y0 = (side * (cL / 2 + dv / 12));
      const y1 = (side * i.L) / 2;
      if (Math.abs(y0) >= Math.abs(y1)) return 0;
      let v = 0;
      for (let a = 0; a < nx; a++)
        for (let b = 0; b < nx; b++) v += cp.q(-i.B / 2 + (i.B * (b + 0.5)) / nx, y0 + ((y1 - y0) * (a + 0.5)) / nx) * (Math.abs(y1 - y0) / nx) * (i.B / nx);
      return v;
    };
    const VuB = Math.max(shearB(1, dvOf(dB)), shearB(-1, dvOf(dB)));
    const VuL = Math.max(shearL(1, dvOf(dL)), shearL(-1, dvOf(dL)));
    // Two-way: the column's load less the pressure inside the critical perimeter at dv/2.
    const dvAvg = dvOf((dB + dL) / 2);
    const pb = cB + dvAvg / 12;
    const pl = cL + dvAvg / 12;
    let inside = 0;
    for (let a = 0; a < nx; a++)
      for (let b = 0; b < nx; b++) inside += cp.q(-pb / 2 + (pb * (a + 0.5)) / nx, -pl / 2 + (pl * (b + 0.5)) / nx) * (pb / nx) * (pl / nx);
    const Vpunch = P - inside;
    return { c, cp, MuB, MuL, VuB, VuL, Vpunch, P };
  });

  const gov = (f: (s: (typeof struct)[number]) => number) => struct.reduce((a, b) => (f(b) > f(a) ? b : a), struct[0]);
  const flexCommon = { fc: i.fc, fy: i.fy, Es: 29000, phiF: 0.9, exposure: i.exposure, n, beta1 };
  // Service moments for crack control: the service cases' column loads, the same way.
  const servMom = service.map((c) => {
    const cp = contactPressure(i.B, i.L, c.lc.P, c.lc.MB + c.lc.HB * tF, c.lc.ML + c.lc.HL * tF);
    const along = (B: number, L: number, cB0: number, q: (x: number, y: number) => number) => {
      const nx = 40;
      let best = 0;
      for (const side of [1, -1]) {
        const x0 = (side * cB0) / 2;
        const x1 = (side * B) / 2;
        let m = 0;
        for (let a = 0; a < nx; a++)
          for (let b = 0; b < nx; b++) {
            const x = x0 + ((x1 - x0) * (a + 0.5)) / nx;
            m += q(x, -L / 2 + (L * (b + 0.5)) / nx) * Math.abs(x - x0) * (Math.abs(x1 - x0) / nx) * (L / nx);
          }
        best = Math.max(best, m);
      }
      return best;
    };
    return { MsB: along(i.B, i.L, cB, cp.q), MsL: along(i.L, i.B, cL, (x, y) => cp.q(y, x)) };
  });
  const MsB = Math.max(0, ...servMom.map((s) => s.MsB));
  const MsL = Math.max(0, ...servMom.map((s) => s.MsL));

  let flexB: ReturnType<typeof flexure> | null = null;
  let flexL: ReturnType<typeof flexure> | null = null;
  let band = { beta: 1, frac: 1, short: "B" as "B" | "L" };
  if (struct.length) {
    const gB = gov((s) => s.MuB);
    const gL = gov((s) => s.MuL);
    // The bars spanning the short side carry 2/(β+1) of their total in a central band as wide as the
    // short side (5.12.8.4); the bars spanning the long side are spread evenly.
    const beta = Math.max(i.B, i.L) / Math.min(i.B, i.L);
    const frac = 2 / (beta + 1);
    const shortIsB = i.B <= i.L; // the bars along B span the short side
    band = { beta, frac, short: shortIsB ? "B" : "L" };
    const short = Math.min(i.B, i.L);
    const perFtB = shortIsB ? (frac * gB.MuB) / short : gB.MuB / i.L;
    const perFtL = shortIsB ? gL.MuL / i.B : (frac * gL.MuL) / short;
    const msB = shortIsB ? (frac * MsB) / short : MsB / i.L;
    const msL = shortIsB ? MsL / i.B : (frac * MsL) / short;
    flexB = flexure({ ...flexCommon, Mu: perFtB, Ms: msB, h: i.t, cover: i.cover, bars: i.barsB });
    flexL = flexure({ ...flexCommon, Mu: perFtL, Ms: msL, h: i.t, cover: i.cover + dbB, bars: i.barsL });
    const banded = beta > 1.0001;
    add({ id: "flex-B", name: `Bars along B: flexure at the column's face (${gB.c.lc.name})${banded && shortIsB ? ", central band" : ""}`, demand: perFtB, capacity: flexB.MR, unit: "kip·ft/ft", ref: "AASHTO 5.12.8.4, 5.6.3.2" });
    add({ id: "flex-L", name: `Bars along L: flexure at the column's face (${gL.c.lc.name})${banded && !shortIsB ? ", central band" : ""}`, demand: perFtL, capacity: flexL.MR, unit: "kip·ft/ft", ref: "AASHTO 5.12.8.4, 5.6.3.2" });
    add({ id: "min-B", name: "Bars along B: minimum reinforcement", demand: flexB.minRequired, capacity: flexB.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
    add({ id: "min-L", name: "Bars along L: minimum reinforcement", demand: flexL.minRequired, capacity: flexL.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
    if (service.length) {
      add({ id: "crack-B", name: "Bars along B: crack control (spacing)", demand: i.barsB.spacing, capacity: flexB.sMax, unit: "in", ref: "AASHTO 5.6.7" });
      add({ id: "crack-L", name: "Bars along L: crack control (spacing)", demand: i.barsL.spacing, capacity: flexL.sMax, unit: "in", ref: "AASHTO 5.6.7" });
    }
    add({ id: "spacing", name: "Bar spacing ≤ 18 in", demand: Math.max(i.barsB.spacing, i.barsL.spacing), capacity: 18, unit: "in", ref: "AASHTO 5.10.3.2" });
    // One-way shear, β = 2 (5.12.8.6.2 → 5.7.3.3; Vc = 0.0316·β·√f'c·bv·dv).
    const vc = (b: number, dv: number) => 0.9 * 0.0316 * 2 * Math.sqrt(i.fc) * b * dv;
    const sB = gov((s) => s.VuB);
    const sL = gov((s) => s.VuL);
    add({ id: "shear-B", name: `One-way shear at dv from the face, along B (${sB.c.lc.name})`, demand: sB.VuB, capacity: vc(i.L * 12, dvOf(dB)), unit: "kip", ref: "AASHTO 5.12.8.6.2, 5.7.3.3" });
    add({ id: "shear-L", name: `One-way shear at dv from the face, along L (${sL.c.lc.name})`, demand: sL.VuL, capacity: vc(i.B * 12, dvOf(dL)), unit: "kip", ref: "AASHTO 5.12.8.6.2, 5.7.3.3" });
    // Two-way.
    const dv = dvOf((dB + dL) / 2);
    const bo = i.colShape === "round" ? Math.PI * (i.colB + dv) : 2 * (i.colB + dv) + 2 * (i.colL + dv);
    const betaC = i.colShape === "round" ? 1 : Math.max(i.colB, i.colL) / Math.min(i.colB, i.colL);
    const Vn2 = Math.min(0.063 + 0.126 / betaC, 0.126) * Math.sqrt(i.fc) * bo * dv;
    const sp = gov((s) => s.Vpunch);
    add({ id: "punching", name: `Two-way shear at dv/2 from the column (${sp.c.lc.name})`, demand: sp.Vpunch, capacity: 0.9 * Vn2, unit: "kip", ref: "AASHTO 5.12.8.6.3" });
    // Development past the face, straight (5.10.8.2.1a): ℓdb = 2.4·db·fy/√f'c times the confinement
    // factor λrc = db/(cb + ktr), 0.4 ≤ λrc ≤ 1.0 (5.10.8.2.1c), cb the lesser of the cover to the bar's
    // center and half the spacing, ktr = 0 (no transverse bars); bottom bars, uncoated.
    const ld = (b: Bars) => {
      const db = BARS[b.bar].dia;
      const cb = Math.min(i.cover + db / 2, b.spacing / 2);
      const lrc = Math.min(1, Math.max(0.4, db / cb));
      return Math.max(12, ((2.4 * db * i.fy) / Math.sqrt(i.fc)) * lrc);
    };
    const availB = ((i.B - cB) / 2) * 12 - i.cover;
    const availL = ((i.L - cL) / 2) * 12 - i.cover;
    add({ id: "dev-B", name: `Bars along B: developed past the column's face`, demand: ld(i.barsB), capacity: availB, unit: "in", ref: "AASHTO 5.10.8.2.1a, 5.12.8.4" });
    add({ id: "dev-L", name: `Bars along L: developed past the column's face`, demand: ld(i.barsL), capacity: availL, unit: "in", ref: "AASHTO 5.10.8.2.1a, 5.12.8.4" });
    // Bearing at the column (5.6.5): φ·0.85·f'c·A1·m, m = √(A2/A1) ≤ 2, on the weaker concrete.
    const A1 = colArea * 144;
    const A2side = Math.min(cB + 2 * 2 * tF, i.B) * Math.min(cL + 2 * 2 * tF, i.L) * 144; // the frustum at 1:2 to the base
    const m = Math.min(2, Math.sqrt(A2side / A1));
    const Pr = 0.7 * 0.85 * Math.min(i.fc, i.fcCol) * A1 * m;
    const pp = gov((s) => s.P);
    add({ id: "col-bearing", name: `Bearing at the column (${pp.c.lc.name})`, demand: pp.P, capacity: Pr, unit: "kip", ref: "AASHTO 5.6.5, 5.12.8.8" });
  }
  return { checks, cases, settle, struct, flexB, flexL, band, dB, dL, Wf, Ws, A, colArea, cB, cL, ec };
}

export type FootingResult = ReturnType<typeof designFooting>;
