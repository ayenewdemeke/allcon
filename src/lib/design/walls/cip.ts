// Cast-in-place cantilever retaining wall, AASHTO LRFD (9th ed.), per foot of wall: earth
// pressure (Coulomb), loads and load groups (with a barrier and vehicle collision on top, if
// any), stability (eccentricity, bearing, sliding, shear key) and the reinforced concrete design
// of the stem, heel, toe and key. Kip, foot and ksf throughout; bars and covers in inches.

export type Combo = "StrIa" | "StrIb" | "StrIV" | "ExtIIa" | "ExtIIb" | "SerI";
export type Factors = { dc: number; ev: number; lsv: number; lsh: number; eh: number; ct: number };

export const COMBOS: { id: Combo; name: string; use: string }[] = [
  { id: "StrIa", name: "Strength Ia", use: "Sliding, eccentricity (LS not over the heel)" },
  { id: "StrIb", name: "Strength Ib", use: "Bearing, strength design (LS over the heel)" },
  { id: "StrIV", name: "Strength IV", use: "Bearing" },
  { id: "ExtIIa", name: "Extreme IIa", use: "Vehicle collision: sliding, eccentricity" },
  { id: "ExtIIb", name: "Extreme IIb", use: "Vehicle collision: bearing, strength design" },
  { id: "SerI", name: "Service I", use: "Crack control" },
];

/** AASHTO Table 3.4.1-1 with Table 3.4.1-2's γp (minimum for the vertical loads in the "a" groups,
 * maximum in the "b" groups); Extreme Event II takes LS at 0.50 and CT at 1.00. */
export const DEFAULT_FACTORS: Record<Combo, Factors> = {
  StrIa: { dc: 0.9, ev: 1.0, lsv: 0, lsh: 1.75, eh: 1.5, ct: 0 },
  StrIb: { dc: 1.25, ev: 1.35, lsv: 1.75, lsh: 1.75, eh: 1.5, ct: 0 },
  StrIV: { dc: 1.5, ev: 1.35, lsv: 0, lsh: 0, eh: 1.5, ct: 0 },
  ExtIIa: { dc: 0.9, ev: 1.0, lsv: 0, lsh: 0.5, eh: 1.5, ct: 1.0 },
  ExtIIb: { dc: 1.25, ev: 1.35, lsv: 0.5, lsh: 0.5, eh: 1.5, ct: 1.0 },
  SerI: { dc: 1.0, ev: 1.0, lsv: 1.0, lsh: 1.0, eh: 1.0, ct: 0 },
};

/** A bar and its spacing (in). */
export type Bars = { bar: number; spacing: number };

export type CipInputs = {
  // Backfill (retained soil)
  gammaS: number; // kcf
  phi: number; // deg
  delta: number | null; // wall–backfill friction, deg (null: 2/3 φ)
  kpOverride: number | null; // passive coefficient from AASHTO Fig. 3.11.5.4-1 (null: Coulomb)
  efwMin: number; // kcf, a minimum active equivalent fluid weight if the owner sets one (0: none)
  // Subgrade
  qn: number; // nominal bearing resistance, ksf
  phiSub: number; // deg
  // Concrete and steel
  fc: number; // ksi
  gammaC: number; // kcf (reinforced)
  fy: number; // ksi
  Es: number; // ksi
  // Resistance factors
  phiB: number;
  phiT: number;
  phiTss: number;
  phiEp: number;
  phiEE: number;
  phiF: number;
  phiV: number;
  // Live load surcharge
  liveLoad: boolean;
  trafficDistance: number; // ft, wall back face to edge of traffic
  // Pavement
  pavementThickness: number; // in
  gammaPavement: number; // kcf
  // Barrier on top of the wall
  railWeight: number; // klf (0: none)
  railCg: number; // in, its center of gravity from the stem's front face
  // Vehicle collision on the barrier (AASHTO 3.6.5, Table A13.2-1), spread at 45° down the wall
  collision: boolean;
  ctForce: number; // Ft, kip
  ctLength: number; // Lt, ft
  ctHeight: number; // ft, top of the wall to the point of impact
  ctAtEnd: boolean; // near the wall's end, so spread one way only
  // Geometry
  He: number; // exposed height, ft
  Df: number; // footing cover, ft
  Tt: number; // stem thickness at top, in
  frontBatter: number; // in per ft of height
  backBatter: number; // in per ft of height
  backslope: number; // H:V run per unit rise, 0 for level (e.g. 2 for 2H:1V)
  B: number; // base width, in
  A: number; // toe, in
  D: number; // footing thickness, in
  shearKey: boolean;
  keyDepth: number; // in
  keyWidth: number; // in
  keyFromHeel: number | null; // in, heel to the key's centerline (null: B/3)
  toeFillIgnored: number; // ft of fill over the toe neglected in passive resistance (may be removed)
  // Reinforcement
  stemBars: Bars;
  stemTemp: Bars;
  heelBars: Bars;
  heelTemp: Bars;
  toeBars: Bars;
  toeTemp: Bars;
  keyBars: Bars;
  keyTemp: Bars;
  coverStem: number; // in
  coverHeel: number;
  coverToe: number;
  coverKey: number;
  exposureStem: 1 | 2;
  exposureFooting: 1 | 2;
  factors: Record<Combo, Factors>;
};

/** The defaults: the example wall in the firm's sheet (EB Retaining Wall). */
export const CIP_DEFAULTS: CipInputs = {
  gammaS: 0.125,
  phi: 25,
  delta: null,
  kpOverride: 9,
  efwMin: 0,
  qn: 1.5,
  phiSub: 25,
  fc: 4,
  gammaC: 0.15,
  fy: 60,
  Es: 29000,
  phiB: 0.55,
  phiT: 0.85,
  phiTss: 1.0,
  phiEp: 0.5,
  phiEE: 1.0,
  phiF: 0.9,
  phiV: 0.9,
  liveLoad: false,
  trafficDistance: 0,
  pavementThickness: 0,
  gammaPavement: 0.14667,
  railWeight: 0,
  railCg: 6,
  collision: false,
  ctForce: 80, // TL-4 (MASH), Table A13.2-1
  ctLength: 5,
  ctHeight: 2.67,
  ctAtEnd: true,
  He: 2.5,
  Df: 1,
  Tt: 8,
  frontBatter: 0,
  backBatter: 0,
  backslope: 0,
  B: 18,
  A: 5,
  D: 8,
  shearKey: true,
  keyDepth: 12,
  keyWidth: 12,
  keyFromHeel: null,
  toeFillIgnored: 1,
  stemBars: { bar: 4, spacing: 12 },
  stemTemp: { bar: 4, spacing: 12 },
  heelBars: { bar: 4, spacing: 12 },
  heelTemp: { bar: 4, spacing: 12 },
  toeBars: { bar: 4, spacing: 12 },
  toeTemp: { bar: 4, spacing: 12 },
  keyBars: { bar: 4, spacing: 12 },
  keyTemp: { bar: 4, spacing: 12 },
  coverStem: 2,
  coverHeel: 2,
  coverToe: 3,
  coverKey: 2,
  exposureStem: 2,
  exposureFooting: 2,
  factors: DEFAULT_FACTORS,
};

export const BARS: Record<number, { area: number; dia: number }> = {
  3: { area: 0.11, dia: 0.375 },
  4: { area: 0.2, dia: 0.5 },
  5: { area: 0.31, dia: 0.625 },
  6: { area: 0.44, dia: 0.75 },
  7: { area: 0.6, dia: 0.875 },
  8: { area: 0.79, dia: 1.0 },
  9: { area: 1.0, dia: 1.128 },
  10: { area: 1.27, dia: 1.27 },
  11: { area: 1.56, dia: 1.41 },
  14: { area: 2.25, dia: 1.693 },
  18: { area: 4.0, dia: 2.257 },
};

/** Inputs that can't make a wall (shown instead of results). */
export class DesignError extends Error {}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const sin = (d: number) => Math.sin(rad(d));
const cos = (d: number) => Math.cos(rad(d));

/** A check: what's asked of the wall against what it can give. */
/** A design check. An advisory one is worked out and shown, but is someone else's to satisfy (the
 * fabricator's, say): it neither fails the design nor decides what governs. */
export type Check = { id: string; name: string; demand: number; capacity: number; unit: string; ok: boolean; ref: string; note?: string; lowerIsBetter?: boolean; advisory?: boolean };
export type Load = { id: string; desc: string; force: number; arm: number; moment: number };
export type Group = { combo: Combo; V: number; MV: number; H: number; MH: number };

/** Coulomb's active coefficient, AASHTO Eq. 3.11.5.3-1 (θ the back face angle, 90 for vertical). */
export function coulombKa(phi: number, beta: number, theta: number, delta: number) {
  const gamma = (1 + Math.sqrt((sin(phi + delta) * sin(phi - beta)) / (sin(theta - delta) * sin(theta + beta)))) ** 2;
  return sin(theta + phi) ** 2 / (gamma * sin(theta) ** 2 * sin(theta - delta));
}

/** Coulomb's passive coefficient. */
export function coulombKp(phi: number, beta: number, theta: number, delta: number) {
  const gamma = (1 - Math.sqrt((sin(phi + delta) * sin(phi + beta)) / (sin(theta + delta) * sin(theta + beta)))) ** 2;
  return sin(theta - phi) ** 2 / (gamma * sin(theta) ** 2 * sin(theta + delta));
}

/** Equivalent height of soil for live load surcharge, AASHTO Table 3.11.6.4-2 (interpolated). */
export function liveLoadHeq(H: number, trafficDistance: number) {
  const near = [
    [5, 5.0],
    [10, 3.5],
    [20, 2.0],
  ];
  const far = [
    [5, 2.0],
    [10, 2.0],
    [20, 2.0],
  ];
  const table = trafficDistance >= 1 ? far : near;
  if (H <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [h0, v0] = table[i - 1];
    const [h1, v1] = table[i];
    if (H <= h1) return v0 + ((v1 - v0) * (H - h0)) / (h1 - h0);
  }
  return table[table.length - 1][1];
}

/** Flexure of a 12 in strip with one layer of bars: resistance, minimum steel and crack control. */
export function flexure(opts: { Mu: number; Ms: number; h: number; cover: number; bars: Bars; fc: number; fy: number; Es: number; phiF: number; exposure: 1 | 2; n: number; beta1: number }) {
  const b = 12;
  const { area, dia } = BARS[opts.bars.bar];
  const de = opts.h - opts.cover - dia / 2;
  const As = (area * b) / opts.bars.spacing;
  const c = (As * opts.fy) / (opts.beta1 * 0.85 * opts.fc * b);
  const a = opts.beta1 * c;
  const Mn = (As * opts.fy * (de - a / 2)) / 12;
  const MR = opts.phiF * Mn;
  // Minimum: MR at least the lesser of 1.33 Mu and Mcr (AASHTO 5.6.3.3), fr = 0.24 √f'c (5.4.2.6).
  const fr = 0.24 * Math.sqrt(opts.fc);
  const Sc = (b * opts.h ** 2) / 6;
  const Mcr = (0.67 * (1.6 * fr) * Sc) / 12;
  const minRequired = Math.min(1.33 * opts.Mu, Mcr);
  // Crack control (5.6.7).
  const rho = As / (b * de);
  const k = Math.sqrt(2 * rho * opts.n + (rho * opts.n) ** 2) - rho * opts.n;
  const j = 1 - k / 3;
  const dc = opts.cover + dia / 2;
  const betaS = 1 + dc / (0.7 * (opts.h - dc));
  const fss = Math.max((opts.Ms * 12) / (As * j * de), 1e-9);
  const gammaE = opts.exposure === 1 ? 1.0 : 0.75;
  const sMax = (700 * gammaE) / (betaS * fss) - 2 * dc;
  return { de, As, c, a, Mn, MR, fr, Sc, Mcr, minRequired, rho, k, j, dc, betaS, fss, gammaE, sMax, dia, area };
}

/** Shrinkage and temperature steel at each face (AASHTO 5.10.6). */
function temperature(bars: Bars, thicknessIn: number, fy: number) {
  const provided = (BARS[bars.bar].area * 12) / bars.spacing;
  const required = (1.3 * 12 * thicknessIn) / (2 * (12 + thicknessIn) * fy);
  return { provided, required, ok: provided >= required && provided >= 0.11 && provided <= 0.6 };
}

export function designCipWall(i: CipInputs) {
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? (c.lowerIsBetter ? c.demand <= c.capacity : c.demand <= c.capacity) });

  // --- soil -----------------------------------------------------------------------------------
  const beta = i.backslope > 0 ? deg(Math.atan(1 / i.backslope)) : 0;
  if (beta >= i.phi) throw new DesignError(`The backslope (${beta.toFixed(1)}°) is steeper than the backfill's friction angle (${i.phi}°): the backfill wouldn't stand, and Coulomb's Ka has no value.`);
  const delta = i.delta ?? (2 * i.phi) / 3;
  const Ka = coulombKa(i.phi, beta, 90, delta);
  const KpCoulomb = coulombKp(i.phi, beta, 90, delta);
  const Kp = i.kpOverride ?? KpCoulomb;
  const efwA = Math.max(i.gammaS * Ka, i.efwMin);
  const efwP = i.gammaS * Kp;
  const deltaSub = (2 * i.phiSub) / 3;
  const mu = Math.tan(rad(i.phiSub));

  // --- geometry (ft) --------------------------------------------------------------------------
  const D = i.D / 12;
  const B = i.B / 12;
  const A = i.A / 12;
  const Tt = i.Tt / 12;
  const H = i.Df === 0 ? i.He + D : i.He + i.Df;
  const hStem = H - D;
  const T1 = (i.frontBatter * hStem) / 12;
  const T2 = (i.backBatter * hStem) / 12;
  const Tb = Tt + T1 + T2;
  const C = B - A - Tb;
  if (C < 0) throw new DesignError("The toe and the stem are wider than the footing: there's no heel.");
  const t = i.pavementThickness / 12;
  const h = H - t + (T2 + C) * Math.tan(rad(beta));
  const heq = i.liveLoad ? liveLoadHeq(H, i.trafficDistance) : 0;

  // --- loads (per ft, moments about the toe) ---------------------------------------------------
  // Earth pressure on the vertical plane through the heel, over the full retained height
  // (AASHTO 3.11.5.1), inclined at δ to the normal.
  const Pa = 0.5 * efwA * h ** 2;
  const tilt = delta;
  // Live load surcharge: a horizontal pressure k γs heq (AASHTO 3.11.6.4), and vertically over the
  // heel beyond the edge of traffic.
  const Fsur = efwA * heq * h;
  const lsWidth = Math.max(T2 + C - i.trafficDistance, 0);
  // Vehicle collision, spread at 45° from the impact down to a section z below it.
  const ctAt = (z: number) => (i.collision ? i.ctForce / (i.ctAtEnd ? i.ctLength / 2 + z : i.ctLength + 2 * z) : 0);
  const hCT = i.ctHeight + H;
  const L = (id: string, desc: string, force: number, arm: number): Load => ({ id, desc, force, arm, moment: force * arm });
  const vertical = {
    DC1: L("DC1", "Front batter stem dead load", 0.5 * T1 * hStem * i.gammaC, A + (2 / 3) * T1),
    DC2: L("DC2", "Stem dead load", Tt * hStem * i.gammaC, A + T1 + Tt / 2),
    DC3: L("DC3", "Back batter stem dead load", 0.5 * T2 * hStem * i.gammaC, A + T1 + Tt + T2 / 3),
    DC4: L("DC4", "Footing dead load", B * D * i.gammaC, B / 2),
    DC5: L("DC5", "Barrier dead load", i.railWeight, A + T1 + i.railCg / 12),
    DC6: L("DC6", "Pavement dead load", t * i.gammaPavement * (T2 + C), B - (T2 + C) / 2),
    EV1: L("EV1", "Fill on the heel", C * (hStem - t) * i.gammaS, B - C / 2),
    EV2: L("EV2", "Fill on the heel (batter)", 0.5 * T2 * (hStem - t) * i.gammaS, A + T1 + Tt + (2 / 3) * T2),
    EV3: L("EV3", "Fill on the toe", A * Math.max(i.Df - D, 0) * i.gammaS, A / 2),
    EV4: L("EV4", "Fill in the backslope", 0.5 * (T2 + C) * ((T2 + C) * Math.tan(rad(beta))) * i.gammaS, A + T1 + Tt + (2 / 3) * (T2 + C)),
    EHV: L("EHV", "Vertical component of earth pressure", Pa * sin(tilt), B),
    LSV: L("LSV", "Live load surcharge over the heel", heq * lsWidth * i.gammaS, B - lsWidth / 2),
  };
  const horizontal = {
    EHH: L("EHH", "Horizontal component of earth pressure", Pa * cos(tilt), h / 3),
    LSH: L("LSH", "Live load surcharge", Fsur, h / 2),
    CT: L("CT", "Vehicle collision", ctAt(hCT), hCT),
  };
  const v = vertical;
  const sum = (ls: Load[], key: "force" | "moment") => ls.reduce((s, l) => s + l[key], 0);
  const DCs = [v.DC1, v.DC2, v.DC3, v.DC4, v.DC5, v.DC6];
  const EVs = [v.EV1, v.EV2, v.EV3, v.EV4];
  const groups = Object.fromEntries(
    (Object.keys(i.factors) as Combo[]).map((combo) => {
      const f = i.factors[combo];
      return [
        combo,
        {
          combo,
          V: f.dc * sum(DCs, "force") + f.ev * sum(EVs, "force") + f.lsv * v.LSV.force + f.eh * v.EHV.force,
          MV: f.dc * sum(DCs, "moment") + f.ev * sum(EVs, "moment") + f.lsv * v.LSV.moment + f.eh * v.EHV.moment,
          H: f.lsh * horizontal.LSH.force + f.eh * horizontal.EHH.force + f.ct * horizontal.CT.force,
          MH: f.lsh * horizontal.LSH.moment + f.eh * horizontal.EHH.moment + f.ct * horizontal.CT.moment,
        } satisfies Group,
      ];
    }),
  ) as Record<Combo, Group>;
  const resultant = (g: Group) => {
    const X = (g.MV - g.MH) / g.V;
    const e = Math.abs(B / 2 - X);
    // A resultant outside the base leaves no bearing width: the pressure has no limit.
    return { X, e, sigma: g.V / Math.max(B - 2 * e, 1e-3) };
  };

  // --- stability ------------------------------------------------------------------------------
  // Extreme Event II is checked when there's a collision load.
  const ext = (...combos: Combo[]) => (i.collision ? combos : []);
  const eMax = B / 3;
  for (const combo of ["StrIa", "StrIb", ...ext("ExtIIa")] as Combo[]) {
    const r = resultant(groups[combo]);
    add({ id: `ecc-${combo}`, name: `Eccentricity, ${COMBOS.find((c) => c.id === combo)!.name}`, demand: r.e, capacity: eMax, unit: "ft", ref: "AASHTO 11.6.3.3" });
  }
  const qR = i.phiB * i.qn;
  const qREE = i.phiEE * i.qn;
  for (const combo of ["StrIb", "StrIV", ...ext("ExtIIb")] as Combo[]) {
    const r = resultant(groups[combo]);
    add({ id: `brg-${combo}`, name: `Bearing, ${COMBOS.find((c) => c.id === combo)!.name}`, demand: r.sigma, capacity: combo === "ExtIIb" ? qREE : qR, unit: "ksf", ref: "AASHTO 11.6.3.2" });
  }
  // Sliding without a key: passive pressure in front of the toe neglected (11.6.3.5); each group
  // with its own vertical load.
  const sliding = (combo: Combo) => {
    const g = groups[combo];
    const phi = combo === "ExtIIa" ? i.phiEE : i.phiT;
    return { H: g.H, RR: phi * 1.0 * g.V * mu };
  };
  const slideIa = sliding("StrIa");
  const slideEE = sliding("ExtIIa");
  const keyNeeded = slideIa.RR < slideIa.H || (i.collision && slideEE.RR < slideEE.H);

  // Shear key: passive resistance of the inert block in front of it, with the fill over the toe
  // that may be removed neglected (AASHTO 11.6.3.5).
  const key = (() => {
    const dKey = i.keyDepth / 12;
    const Dw = i.keyWidth / 12;
    const K = i.keyFromHeel !== null ? i.keyFromHeel / 12 : B / 3;
    const Xkey = B - K - Dw / 2;
    const c = dKey + Xkey * Math.tan(rad(deltaSub));
    const y1 = Math.max(i.Df - i.toeFillIgnored, 0);
    const y2 = y1 + c;
    const Rep = efwP * ((y1 + y2) / 2) * c;
    const muSoil = i.phiT * mu;
    const muSoilSoil = i.phiTss * mu;
    const muEE = i.phiEE * mu;
    // The base pressure, uniform over B − 2e on the resultant's side (as for bearing), in front
    // of the key (R1) and behind it (R2): together, the vertical load.
    const resist = (combo: Combo) => {
      const g = groups[combo];
      const r = resultant(g);
      const [s0, s1] = r.X <= B / 2 ? [0, 2 * r.X] : [2 * r.X - B, B];
      const over = (a: number, b: number) => Math.max(0, Math.min(b, s1) - Math.max(a, s0));
      const R1 = Math.max(r.sigma, 0) * over(0, Xkey);
      const R2 = Math.max(r.sigma, 0) * over(Xkey, B);
      const ee = combo === "ExtIIa";
      const Rtau = R1 * (ee ? muEE : muSoilSoil) * Math.cos(rad(deltaSub)) + R2 * (ee ? muEE : muSoil);
      return { ...r, R1, R2, Rtau, RR: Rtau + i.phiEp * Rep, H: g.H };
    };
    return { dKey, Dw, K, Xkey, c, y1, y2, Rep, muSoil, muSoilSoil, muEE, StrIa: resist("StrIa"), ExtIIa: resist("ExtIIa") };
  })();
  if (i.shearKey) {
    add({ id: "slide-StrIa", name: "Sliding with shear key, Strength Ia", demand: key.StrIa.H, capacity: key.StrIa.RR, unit: "kip/ft", ref: "AASHTO 10.6.3.4" });
    if (i.collision) add({ id: "slide-ExtIIa", name: "Sliding with shear key, Extreme IIa", demand: key.ExtIIa.H, capacity: key.ExtIIa.RR, unit: "kip/ft", ref: "AASHTO 10.6.3.4" });
  } else {
    add({ id: "slide-StrIa", name: "Sliding, Strength Ia", demand: slideIa.H, capacity: slideIa.RR, unit: "kip/ft", ref: "AASHTO 10.6.3.4" });
    if (i.collision) add({ id: "slide-ExtIIa", name: "Sliding, Extreme IIa", demand: slideEE.H, capacity: slideEE.RR, unit: "kip/ft", ref: "AASHTO 10.6.3.4" });
  }

  // --- concrete ----------------------------------------------------------------------------------
  const beta1 = Math.min(0.85, Math.max(0.65, 0.85 - (i.fc - 4) * 0.05));
  const Ec = 120000 * 1.0 * i.gammaC ** 2 * i.fc ** 0.33; // AASHTO 5.4.2.4
  const n = i.Es / Ec;
  const common = { fc: i.fc, fy: i.fy, Es: i.Es, phiF: i.phiF, n, beta1 };
  const factored = (combo: Combo, force: { eh?: number; lsh?: number; dc?: number; ev?: number; ct?: number }) => {
    const f = i.factors[combo];
    return f.eh * (force.eh ?? 0) + f.lsh * (force.lsh ?? 0) + f.dc * (force.dc ?? 0) + f.ev * (force.ev ?? 0) + f.ct * (force.ct ?? 0);
  };
  const designCombos: Combo[] = ["StrIb", "StrIV", ...ext("ExtIIb")];

  // Stem, at its base.
  const hs = hStem - t;
  const stemEH = { force: cos(delta) * 0.5 * efwA * hs ** 2, arm: hs / 3 };
  const stemLS = { force: efwA * heq * hs, arm: hs / 2 };
  const stemCT = { force: ctAt(i.ctHeight + hStem), arm: i.ctHeight + hStem };
  const stemV = Math.max(...designCombos.map((c) => factored(c, { eh: stemEH.force, lsh: stemLS.force, ct: stemCT.force })));
  const stemMu = Math.max(...designCombos.map((c) => factored(c, { eh: stemEH.force * stemEH.arm, lsh: stemLS.force * stemLS.arm, ct: stemCT.force * stemCT.arm })));
  const stemMs = factored("SerI", { eh: stemEH.force * stemEH.arm, lsh: stemLS.force * stemLS.arm });
  const stem = flexure({ ...common, Mu: stemMu, Ms: stemMs, h: Tb * 12, cover: i.coverStem, bars: i.stemBars, exposure: i.exposureStem });
  add({ id: "stem-flexure", name: "Stem flexure", demand: stemMu, capacity: stem.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2" });
  add({ id: "stem-min", name: "Stem minimum reinforcement", demand: stem.minRequired, capacity: stem.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
  add({ id: "stem-crack", name: "Stem crack control (bar spacing)", demand: i.stemBars.spacing, capacity: stem.sMax, unit: "in", ref: "AASHTO 5.6.7" });
  // Stem shear, general procedure without transverse reinforcement (5.7.3.4.2).
  const stemShear = (() => {
    const dv = Math.max(stem.de - stem.a / 2, 0.9 * stem.de, 0.72 * Tb * 12);
    const Mu = Math.max(stemMu, (stemV * dv) / 12) * 12; // kip·in
    const Nu = -1.25 * (v.DC1.force + v.DC2.force + v.DC3.force + v.DC5.force); // compression
    const epsS = Math.min(Math.max((Mu / dv + 0.5 * Nu + stemV) / (i.Es * stem.As), 0), 0.006);
    const tempAs = (BARS[i.stemTemp.bar].area * 12) / i.stemTemp.spacing;
    const sx = 2 * tempAs >= 0.003 * stem.de * i.stemTemp.spacing ? Math.min(dv, i.stemTemp.spacing) : dv;
    const sxe = Math.min(Math.max((sx * 1.38) / (0.75 + 0.63), 12), 80);
    const betaV = (4.8 / (1 + 750 * epsS)) * (51 / (39 + sxe));
    const Vc = 0.0316 * betaV * 1.0 * Math.sqrt(i.fc) * 12 * dv;
    return { dv, Mu, Nu, epsS, sx, sxe, beta: betaV, Vc, VR: i.phiV * Vc };
  })();
  add({ id: "stem-shear", name: "Stem shear", demand: stemV, capacity: stemShear.VR, unit: "kip/ft", ref: "AASHTO 5.7.3.3" });
  add({ id: "stem-noStirrups", name: "Stem needs no stirrups (Vu ≤ 0.5 φVc)", demand: stemV, capacity: 0.5 * stemShear.VR, unit: "kip/ft", ref: "AASHTO 5.7.2.3" });
  const stemTemp = temperature(i.stemTemp, Tb * 12, i.fy);
  add({ id: "stem-temp", name: "Stem shrinkage and temperature steel", demand: stemTemp.required, capacity: stemTemp.provided, unit: "in²/ft", ok: stemTemp.ok, ref: "AASHTO 5.10.6" });

  // Heel, at the back face of the stem (fill and self weight; bearing pressure conservatively neglected).
  const heelDC = { force: i.gammaC * C * D, arm: C / 2 };
  const heelEV = { force: i.gammaS * hStem * C, arm: C / 2 };
  const heelV = Math.max(...designCombos.map((c) => factored(c, { dc: heelDC.force, ev: heelEV.force })));
  const heelMu = Math.max(...designCombos.map((c) => factored(c, { dc: heelDC.force * heelDC.arm, ev: heelEV.force * heelEV.arm })));
  const heelMs = factored("SerI", { dc: heelDC.force * heelDC.arm, ev: heelEV.force * heelEV.arm });
  const heel = flexure({ ...common, Mu: heelMu, Ms: heelMs, h: D * 12, cover: i.coverHeel, bars: i.heelBars, exposure: i.exposureFooting });
  const heelDv = Math.max(heel.de - heel.a / 2, 0.9 * heel.de, 0.72 * D * 12);
  const heelVR = i.phiV * 0.0316 * 2 * Math.sqrt(i.fc) * 12 * heelDv;
  add({ id: "heel-flexure", name: "Heel flexure", demand: heelMu, capacity: heel.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2" });
  add({ id: "heel-min", name: "Heel minimum reinforcement", demand: heel.minRequired, capacity: heel.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
  add({ id: "heel-crack", name: "Heel crack control (bar spacing)", demand: i.heelBars.spacing, capacity: heel.sMax, unit: "in", ref: "AASHTO 5.6.7" });
  add({ id: "heel-shear", name: "Heel shear", demand: heelV, capacity: heelVR, unit: "kip/ft", ref: "AASHTO 5.7.3.3 (β = 2)" });
  const heelTemp = temperature(i.heelTemp, D * 12, i.fy);
  add({ id: "heel-temp", name: "Heel shrinkage and temperature steel", demand: heelTemp.required, capacity: heelTemp.provided, unit: "in²/ft", ok: heelTemp.ok, ref: "AASHTO 5.10.6" });

  // Toe, under the greatest factored bearing pressure (its weight and fill conservatively neglected).
  const sigmaMax = Math.max(...designCombos.map((c) => resultant(groups[c]).sigma));
  const toeVu = sigmaMax * A;
  const toeMu = (toeVu * A) / 2;
  const sigmaSer = resultant(groups.SerI).sigma;
  const toeMs = (sigmaSer * A * A) / 2;
  const toe = flexure({ ...common, Mu: toeMu, Ms: toeMs, h: D * 12, cover: i.coverToe, bars: i.toeBars, exposure: i.exposureFooting });
  const toeDv = Math.max(toe.de - toe.a / 2, 0.9 * toe.de, 0.72 * D * 12);
  const toeVR = i.phiV * 0.0316 * 2 * Math.sqrt(i.fc) * 12 * toeDv;
  add({ id: "toe-flexure", name: "Toe flexure", demand: toeMu, capacity: toe.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2" });
  add({ id: "toe-min", name: "Toe minimum reinforcement", demand: toe.minRequired, capacity: toe.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
  add({ id: "toe-crack", name: "Toe crack control (bar spacing)", demand: i.toeBars.spacing, capacity: toe.sMax, unit: "in", ref: "AASHTO 5.6.7" });
  add({ id: "toe-shear", name: "Toe shear", demand: toeVu, capacity: toeVR, unit: "kip/ft", ref: "AASHTO 5.7.3.3 (β = 2)" });
  const toeTemp = temperature(i.toeTemp, D * 12, i.fy);
  add({ id: "toe-temp", name: "Toe shrinkage and temperature steel", demand: toeTemp.required, capacity: toeTemp.provided, unit: "in²/ft", ok: toeTemp.ok, ref: "AASHTO 5.10.6" });

  // Shear key: a cantilever below the footing, bent by the passive pressure on the inert block.
  let keyDesign: ReturnType<typeof flexure> | null = null;
  let keyMu = 0;
  if (i.shearKey) {
    const arm = (0.5 * Kp * i.gammaS * key.y1 * key.c ** 2 + (1 / 3) * Kp * i.gammaS * key.c ** 3) / key.Rep;
    keyMu = key.Rep * arm;
    keyDesign = flexure({ ...common, Mu: keyMu, Ms: keyMu, h: i.keyWidth, cover: i.coverKey, bars: i.keyBars, exposure: 1 });
    add({ id: "key-flexure", name: "Shear key flexure", demand: keyMu, capacity: keyDesign.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2" });
    add({ id: "key-min", name: "Shear key minimum reinforcement", demand: keyDesign.minRequired, capacity: keyDesign.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
    add({ id: "key-crack", name: "Shear key crack control (bar spacing)", demand: i.keyBars.spacing, capacity: keyDesign.sMax, unit: "in", ref: "AASHTO 5.6.7" });
    const keyTemp = temperature(i.keyTemp, i.keyWidth, i.fy);
    add({ id: "key-temp", name: "Shear key shrinkage and temperature steel", demand: keyTemp.required, capacity: keyTemp.provided, unit: "in²/ft", ok: keyTemp.ok, ref: "AASHTO 5.10.6" });
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
    soil: { beta, delta, Ka, KpCoulomb, Kp, efwA, efwP, deltaSub, mu },
    geometry: { H, hStem, T1, T2, Tb, C, t, h, heq, lsWidth, hCT, D, B, A, Tt },
    loads: { Pa, Fsur, vertical, horizontal },
    groups,
    stability: { eMax, qR, qREE, slideIa, slideEE, keyNeeded, key },
    concrete: { beta1, Ec, n },
    stem: { V: stemV, Mu: stemMu, Ms: stemMs, flex: stem, shear: stemShear, temp: stemTemp, EH: stemEH, LS: stemLS, CT: stemCT },
    heel: { V: heelV, Mu: heelMu, Ms: heelMs, flex: heel, VR: heelVR, temp: heelTemp },
    toe: { sigmaMax, Vu: toeVu, Mu: toeMu, Ms: toeMs, flex: toe, VR: toeVR, temp: toeTemp },
    keyDesign: keyDesign && { Mu: keyMu, flex: keyDesign },
  };
}

export type CipResult = ReturnType<typeof designCipWall>;
