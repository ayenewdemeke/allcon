import { agencyChecks, type Criteria } from "../agency-checks";
import { BARS, DesignError, flexure, type Bars, type Check } from "../walls/cip";
import { development } from "../stm/anchorage";

// A cast-in-place bridge approach slab, AASHTO LRFD (10th Edition) with the CDOT Bridge Design
// Manual: the slab rests on the abutment's approach slab notch at one end and on a sleeper slab at
// the other, and is designed as a one-way slab spanning along the roadway over the length the fill
// beneath it may settle away from it. CDOT designs that span as 50% of the slab's length (BDM
// 11.3.7, the PCI method). Dead load and the vehicle's axles (3.6.1.3.3: axles only for spans up to
// 15 ft, the full HL-93 beyond) over the equivalent strip of a slab-type bridge (4.6.2.3), then the
// main bars (flexure, minimum, crack control, fatigue), shear, distribution bars (9.7.3.2),
// temperature bars (5.10.6), the dowels into the abutment, the sleeper slab, and a barrier on the
// slab's edge if there is one (A13.4.1). Per foot of width; kip, foot, and inches for sections.
//
// The layout, bars and sleeper are CDOT worksheet B-601-1EA's (Approach Slab Details, Asphalt with
// 0–4" Joint; B-601-1 without the device): 20'-0" minimum along the roadway, 1'-0" thick, Class DF,
// #6 @ 6" bottom (#9 for slabs over 20 ft and under 31 ft), #5 @ 1'-0" bottom transverse, #5 @ 1'-0"
// top transverse, #4 @ 1'-6" top longitudinal, 2" top and 3" bottom clear, #5 @ 1'-0" anchorage bars
// projecting 1'-6" into the slab, and a 4'-0" by 1'-0" sleeper slab with a 1'-0" wide block under
// the device.

export type ApproachSlabInputs = {
  /** AASHTO LRFD, or with the CDOT Bridge Design Manual and worksheet B-601 too (none given: AASHTO). */
  criteria?: Criteria;
  L: number; // ft, along the roadway from the abutment's back face to the slab's end (B-601-1EA's 20'-0"); the slab also sits `seat` on the notch
  W: number; // ft, the slab's width, normal to the roadway
  roadway: number; // ft, clear roadway width on the slab (for the number of design lanes)
  skew: number; // deg
  t: number; // in, slab thickness
  supportLoss: number; // fraction of L taken as the design span (CDOT: 0.5)
  wearing: number; // in, HMA overlay (0 for bare concrete)
  gammaWS: number; // kcf
  fc: number; // ksi
  fy: number; // ksi
  gammaC: number; // kcf
  coverTop: number; // in
  coverBot: number; // in
  exposure: 1 | 2;
  mainBars: Bars; // bottom, along the roadway
  distBars: Bars; // bottom, across the roadway
  topLong: Bars; // top, along the roadway
  topTrans: Bars; // top, across the roadway
  // Anchorage to the abutment (BDM 2.13)
  dowels: Bars;
  dowelSlab: number; // in, embedment into the slab
  dowelAbut: number; // in, embedment into the abutment, hooked
  dowelHook: number; // in, the anchorage bar's hooked leg (B-601-1EA: 10")
  seat: number; // in, the slab's seat on the notch, normal to the abutment (B-601-1EA: 6")
  // Sleeper slab under the free end
  sleeper: boolean;
  sleeperB: number; // ft, its width along the roadway
  sleeperT: number; // in, its thickness
  sleeperBars: Bars; // bottom, across its width (along the roadway)
  sleeperLong: Bars; // along its length (across the roadway), top and bottom
  sleeperSeat: number; // in, width of the slab's bearing on it
  blockW: number; // in, the block under the expansion device (B-601-1EA: 1'-0")
  qR: number; // ksf, factored bearing resistance (geotechnical report)
  // A barrier on the slab's edge
  barrier: boolean;
  Mc: number; // kip·ft/ft
  T: number; // kip/ft
  // The joint at the slab's end (BDM 14.4.2): B-601-1EA's 0–4" expansion device on the sleeper, or B-601-1's poured joint (movement ≤ ¾" and an asphalt approach)
  joint: "device" | "none";
};

/** The defaults: B-601-1EA's slab, 20 ft by 44 ft, square to the roadway, with its bars and sleeper. */
export const APPROACH_SLAB_DEFAULTS: ApproachSlabInputs = {
  L: 20,
  W: 44,
  roadway: 40,
  skew: 0,
  t: 12,
  supportLoss: 0.5,
  wearing: 3,
  gammaWS: 0.14667,
  fc: 4.5,
  fy: 60,
  gammaC: 0.15,
  coverTop: 2,
  coverBot: 3,
  exposure: 1,
  mainBars: { bar: 6, spacing: 6 },
  distBars: { bar: 5, spacing: 12 },
  topLong: { bar: 4, spacing: 18 },
  topTrans: { bar: 5, spacing: 12 },
  dowels: { bar: 5, spacing: 12 },
  dowelSlab: 18,
  dowelAbut: 15,
  dowelHook: 10,
  seat: 6,
  sleeper: true,
  sleeperB: 4,
  sleeperT: 12,
  sleeperBars: { bar: 5, spacing: 12 },
  sleeperLong: { bar: 5, spacing: 10.5 },
  sleeperSeat: 18,
  blockW: 12,
  qR: 4,
  barrier: false,
  Mc: 17,
  T: 7,
  joint: "device",
};

/** The sleeper slab of each worksheet: B-601-1EA's 4'-0" by 1'-0" under the device (two #5 bars at each 1'-0", #5 Tot 10 along it, the slab on 1'-6"), B-601-1's 3'-0" by 1'-0" without it (#4 closed hoops @ 1'-6", #5 6 Tot, 1'-0" past the slab's end). */
export const SLEEPER_OF = {
  device: { sleeperB: 4, sleeperT: 12, sleeperBars: { bar: 5, spacing: 12 }, sleeperLong: { bar: 5, spacing: 10.5 }, sleeperSeat: 18 },
  none: { sleeperB: 3, sleeperT: 12, sleeperBars: { bar: 4, spacing: 18 }, sleeperLong: { bar: 5, spacing: 15 }, sleeperSeat: 24 },
} satisfies Record<ApproachSlabInputs["joint"], Partial<ApproachSlabInputs>>;

/** B-601-1EA's bottom bars for a slab of this length: #6 @ 6" at 20 ft, #9 @ 6" over 20 ft and under 31 ft; none beyond (a special design). */
export function worksheetMainBars(L: number): { bar: number; spacing: number } | null {
  if (L <= 20 + 1e-9) return { bar: 6, spacing: 6 };
  if (L < 31) return { bar: 9, spacing: 6 };
  return null;
}

/** A vehicle: axle loads (kip) and their positions from the first (ft). */
type Vehicle = { name: string; axles: { P: number; x: number }[]; lane?: number };

export const TRUCK_AXLE: Vehicle = { name: "Design truck axle (32 kip)", axles: [{ P: 32, x: 0 }] };
export const TANDEM: Vehicle = { name: "Design tandem (2 × 25 kip at 4 ft)", axles: [{ P: 25, x: 0 }, { P: 25, x: 4 }] };
const TRUCK: Vehicle = { name: "Design truck (8, 32, 32 kip at 14 ft)", axles: [{ P: 8, x: 0 }, { P: 32, x: 14 }, { P: 32, x: 28 }] };
const FATIGUE_TRUCK: Vehicle = { name: "Fatigue truck (8, 32, 32 kip at 14 and 30 ft)", axles: [{ P: 8, x: 0 }, { P: 32, x: 14 }, { P: 32, x: 44 }] };
const LANE = 0.64; // klf, 3.6.1.2.4
const IM = 0.33; // 3.6.2.1
const IM_FATIGUE = 0.15;

/** The largest midspan-region moment (kip·ft) and end reaction (kip) of a vehicle moving over a simple span S. */
export function movingLoad(v: Vehicle, S: number) {
  const len = v.axles[v.axles.length - 1].x;
  let M = 0;
  let at = S / 2;
  let R = 0;
  const step = Math.min(0.05, S / 200);
  for (let x0 = -len; x0 <= S + 1e-9; x0 += step) {
    const on = v.axles.map((a) => ({ P: a.P, x: x0 + a.x })).filter((a) => a.x >= -1e-9 && a.x <= S + 1e-9);
    if (!on.length) continue;
    const Ra = on.reduce((s, a) => s + (a.P * (S - a.x)) / S, 0);
    R = Math.max(R, Ra);
    // The moment is largest under an axle.
    for (const a of on) {
      const m = Ra * a.x - on.filter((b) => b.x < a.x).reduce((s, b) => s + b.P * (a.x - b.x), 0);
      if (m > M) {
        M = m;
        at = a.x;
      }
    }
  }
  return { M, R, at };
}

/** The sleeper's bars across its bottom: with the device, B-601-1EA's two bent bars at each place. */
export const sleeperBottom = (i: ApproachSlabInputs): Bars => (i.joint === "device" ? { bar: i.sleeperBars.bar, spacing: i.sleeperBars.spacing / 2 } : i.sleeperBars);

export function designApproachSlab(i: ApproachSlabInputs) {
  if (!(i.L > 0 && i.W > 0 && i.t > 0)) throw new DesignError("The slab needs a length, a width and a thickness.");
  if (!(i.supportLoss > 0 && i.supportLoss <= 1)) throw new DesignError("The design span is a fraction of the slab's length, over 0 and at most 1 (CDOT: 0.5).");
  if (i.skew < 0 || i.skew >= 60) throw new DesignError("The skew must be from 0° up to (not including) 60°.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });
  const rad = (i.skew * Math.PI) / 180;

  // --- span and strip -------------------------------------------------------------------------------
  const S = i.supportLoss * i.L; // ft, the design span along the roadway
  const NL = Math.max(1, Math.floor(i.roadway / 12)); // 3.6.1.1.1
  const L1 = Math.min(S, 60);
  const E1 = 10 + 5 * Math.sqrt(L1 * Math.min(i.W, 30)); // in, Eq. 4.6.2.3-1
  const Em = Math.min(84 + 1.44 * Math.sqrt(L1 * Math.min(i.W, 60)), (12 * i.W) / NL); // in, Eq. 4.6.2.3-2
  const E = NL > 1 ? Math.min(E1, Em) : E1;
  const r = Math.min(1, 1.05 - 0.25 * Math.tan(rad)); // Eq. 4.6.2.3-3

  // --- loads ------------------------------------------------------------------------------------------
  const wDC = (i.gammaC * i.t) / 12; // ksf, per ft of width: klf
  const wDW = (i.gammaWS * i.wearing) / 12;
  const MDC = (wDC * S ** 2) / 8;
  const MDW = (wDW * S ** 2) / 8;
  const VDC = (wDC * S) / 2;
  const VDW = (wDW * S) / 2;
  const axlesOnly = S <= 15; // 3.6.1.3.3
  const vehicles = axlesOnly ? [TRUCK_AXLE, TANDEM] : [TRUCK, TANDEM];
  const runs = vehicles.map((v) => ({ v, ...movingLoad(v, S) }));
  const govM = runs.reduce((a, b) => (b.M > a.M ? b : a));
  const govV = runs.reduce((a, b) => (b.R > a.R ? b : a));
  const laneM = axlesOnly ? 0 : (LANE * S ** 2) / 8;
  const laneV = axlesOnly ? 0 : (LANE * S) / 2;
  const MLLlane = govM.M * (1 + IM) + laneM; // kip·ft per lane
  const VLLlane = govV.R * (1 + IM) + laneV;
  const MLL = (MLLlane / (E / 12)) * r; // kip·ft/ft
  const VLL = VLLlane / (E / 12);
  const Mu = 1.25 * MDC + 1.5 * MDW + 1.75 * MLL;
  const Ms = MDC + MDW + MLL;
  const Vu = 1.25 * VDC + 1.5 * VDW + 1.75 * VLL;

  // --- concrete -----------------------------------------------------------------------------------------
  const area = (b: Bars) => (BARS[b.bar].area * 12) / b.spacing;
  const beta1 = Math.min(0.85, Math.max(0.65, 0.85 - (i.fc - 4) * 0.05));
  const Ec = 120000 * i.gammaC ** 2 * i.fc ** 0.33; // Eq. 5.4.2.4-1
  const n = 29000 / Ec;
  const common = { fc: i.fc, fy: i.fy, Es: 29000, phiF: 0.9, exposure: i.exposure, n, beta1 };
  add({ id: "depth", name: "Slab depth, at least 7.0 in", demand: 7, capacity: i.t, unit: "in", ref: "AASHTO 9.7.1.1" });
  add({ id: "main-length", name: "Slab length, at least B-601-1EA's 20'-0\" minimum", demand: 20, capacity: i.L, unit: "ft", ref: "CDOT B-601-1EA", advisory: true });
  const ws = worksheetMainBars(i.L);
  const wsAs = ws ? (BARS[ws.bar].area * 12) / ws.spacing : 0;

  // --- main bars (bottom, along the roadway) -----------------------------------------------------------
  const main = flexure({ ...common, Mu, Ms, h: i.t, cover: i.coverBot, bars: i.mainBars });
  add({ id: "main-flexure", name: "Main bars, flexure (Strength I)", demand: Mu, capacity: main.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2" });
  add({ id: "main-min", name: "Main bars, minimum reinforcement", demand: main.minRequired, capacity: main.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
  add({ id: "main-crack", name: "Main bars, crack control (spacing)", demand: i.mainBars.spacing, capacity: main.sMax, unit: "in", ref: "AASHTO 5.6.7" });
  add({ id: "main-fss", name: "Main bars, service stress ≤ 0.6 fy", demand: main.fss, capacity: 0.6 * i.fy, unit: "ksi", ref: "AASHTO 5.6.7" });
  add({ id: "main-spacing", name: "Main bars, spacing ≤ 1.5h and 18 in", demand: i.mainBars.spacing, capacity: Math.min(1.5 * i.t, 18), unit: "in", ref: "AASHTO 5.10.3.2" });

  // Fatigue (Fatigue I): one fatigue truck, 15% IM, over the single-lane strip without its 1.2 multiple presence (C4.6.2.3).
  const fat = movingLoad(FATIGUE_TRUCK, S);
  const Efat = 1.2 * E1;
  const Mfat = ((fat.M * (1 + IM_FATIGUE)) / (Efat / 12)) * r;
  const jd = main.j * main.de;
  const fRange = (1.75 * Mfat * 12) / (main.As * jd);
  const fMin = ((MDC + MDW) * 12) / (main.As * jd);
  const thresh = 26 - (22 * fMin) / i.fy; // Eq. 5.5.3.2-1
  // CDOT's predesigned worksheet (the PCI method, BDM 11.3.7) doesn't check fatigue; shown for information.
  add({ id: "main-fatigue", name: "Main bars, fatigue stress range (Fatigue I), for information", demand: fRange, capacity: thresh, unit: "ksi", ref: "AASHTO 5.5.3.2", advisory: true });
  if (ws) add({ id: "main-worksheet", name: `Main bars, at least B-601-1EA's #${ws.bar} @ ${ws.spacing}" for a ${i.L} ft slab`, demand: wsAs, capacity: area(i.mainBars), unit: "in²/ft", ref: "CDOT B-601-1EA", advisory: true });
  else add({ id: "main-worksheet", name: "Slab under 31 ft, B-601-1EA's range (longer: a special design)", demand: i.L, capacity: 31, unit: "ft", ref: "CDOT B-601-1EA", advisory: true, ok: false });

  // --- shear ------------------------------------------------------------------------------------------
  const dv = Math.max(0.9 * main.de, 0.72 * i.t);
  const Vc = 0.0316 * 2 * Math.sqrt(i.fc) * 12 * dv; // kip/ft, β = 2 (5.7.3.4.1)
  add({ id: "shear", name: "Shear at the support, φVc (β = 2)", demand: Vu, capacity: 0.9 * Vc, unit: "kip/ft", ref: "AASHTO 5.7.3.3, 5.12.2.1", advisory: true });

  // --- distribution and temperature bars --------------------------------------------------------------
  const pct = Math.min(100 / Math.sqrt(S), 50) / 100; // 9.7.3.2, main bars parallel to traffic
  const distRequired = pct * area(i.mainBars);
  // CDOT's standard slab (B-601-1EA, B-601-1) details #5 at 12 in here, less than 9.7.3.2 asks for at CDOT's
  // half-span design assumption: with those bars the check is shown for information, the standard detail governing.
  const worksheetDist = i.criteria === "cdot" && i.distBars.bar === APPROACH_SLAB_DEFAULTS.distBars.bar && i.distBars.spacing === APPROACH_SLAB_DEFAULTS.distBars.spacing;
  add({
    id: "dist",
    name: `Bottom transverse: distribution, ${(pct * 100).toFixed(1)}% of the main bars${worksheetDist ? " (CDOT B-601 standard detail, for information)" : ""}`,
    demand: distRequired,
    capacity: area(i.distBars),
    unit: "in²/ft",
    ref: worksheetDist ? "AASHTO 9.7.3.2; CDOT B-601-1EA" : "AASHTO 9.7.3.2",
    ...(worksheetDist ? { advisory: true } : {}),
  });
  const bIn = i.W * 12;
  const tempRequired = Math.max(0.11, (1.3 * bIn * i.t) / (2 * (bIn + i.t) * i.fy)); // Eq. 5.10.6-1, per face
  const sTemp = Math.min(3 * i.t, 18);
  for (const [id, name, b] of [["temp-long", "Top longitudinal", i.topLong], ["temp-trans", "Top transverse", i.topTrans]] as const) {
    const As = area(b);
    add({ id, name: `${name}: shrinkage and temperature`, demand: tempRequired, capacity: As, unit: "in²/ft", ok: As >= tempRequired && As <= 0.6, ref: "AASHTO 5.10.6" });
    add({ id: `${id}-s`, name: `${name}: spacing ≤ 3h and 18 in`, demand: b.spacing, capacity: sTemp, unit: "in", ref: "AASHTO 5.10.6" });
  }

  // --- anchorage to the abutment (BDM 2.13) ---------------------------------------------------------------
  const db = BARS[i.dowels.bar].dia;
  const clearSpacing = Math.max(0.5, i.dowels.spacing - db);
  const ldSlab = development({ barSize: i.dowels.bar, fy: i.fy, fc: i.fc, clearCover: i.coverTop, clearSpacing, horizontal: true, concreteBelow: i.t - i.coverTop, coating: "epoxy", kind: "straight" });
  const ldhAbut = development({ barSize: i.dowels.bar, fy: i.fy, fc: i.fc, clearCover: 2, clearSpacing, horizontal: false, concreteBelow: 0, coating: "epoxy", kind: "hook" });
  add({ id: "dowel-slab", name: `Dowels #${i.dowels.bar}: development into the slab (straight)`, demand: ldSlab.required, capacity: i.dowelSlab, unit: "in", ref: "AASHTO 5.10.8.2.1" });
  add({ id: "dowel-abut", name: `Dowels #${i.dowels.bar}: development into the abutment (hooked)`, demand: ldhAbut.required, capacity: i.dowelAbut, unit: "in", ref: "AASHTO 5.10.8.2.4" });

  // --- sleeper slab --------------------------------------------------------------------------------------------
  let sleeper: null | { RDC: number; RDW: number; RLL: number; wS: number; qu: number; c: number; qNet: number; Mu: number; Ms: number; f: ReturnType<typeof flexure>; Pu: number } = null;
  if (i.sleeper) {
    if (!(i.sleeperB > 0 && i.sleeperT > 0)) throw new DesignError("The sleeper slab needs a width and a thickness.");
    const seat = i.sleeperSeat / 12;
    if (seat > i.sleeperB) throw new DesignError("The slab's seat on the sleeper is wider than the sleeper.");
    const RDC = VDC;
    const RDW = VDW;
    const RLL = VLL; // the end reaction: an axle over the sleeper
    const blockH = i.joint === "device" ? i.t + i.wearing : 0; // in, the block under the device, up to the roadway's surface
    const wS = (i.gammaC * (i.sleeperT + (blockH * i.blockW) / (12 * i.sleeperB))) / 12; // ksf, its own weight with the device block, spread over its width
    const Pu = 1.25 * RDC + 1.5 * RDW + 1.75 * RLL; // kip/ft along the sleeper
    const qu = Pu / i.sleeperB + 1.25 * wS; // ksf
    add({ id: "sleeper-bearing", name: "Sleeper slab: factored bearing pressure", demand: qu, capacity: i.qR, unit: "ksf", ref: "AASHTO 10.6.3.1" });
    const c = i.sleeperB - seat; // ft, the sleeper beyond the slab's ledge (B-601-1EA), a cantilever under uniform soil pressure
    const qNet = Pu / i.sleeperB; // the soil's pressure from the slab's reaction (its own weight goes straight down)
    const Mus = (qNet * c ** 2) / 2;
    const Mss = (((RDC + RDW + RLL) / i.sleeperB) * c ** 2) / 2;
    const f = flexure({ ...common, Mu: Mus, Ms: Mss, h: i.sleeperT, cover: 3, bars: sleeperBottom(i) });
    add({ id: "sleeper-flexure", name: "Sleeper slab: bottom bars, flexure", demand: Mus, capacity: f.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2" });
    add({ id: "sleeper-min", name: "Sleeper slab: minimum reinforcement", demand: f.minRequired, capacity: f.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
    const sTempS = (1.3 * i.sleeperB * 12 * i.sleeperT) / (2 * (i.sleeperB * 12 + i.sleeperT) * i.fy);
    add({ id: "sleeper-temp", name: "Sleeper slab: bars along it, shrinkage and temperature", demand: Math.max(0.11, sTempS), capacity: area(i.sleeperLong), unit: "in²/ft", ok: area(i.sleeperLong) >= Math.max(0.11, sTempS) && area(i.sleeperLong) <= 0.6, ref: "AASHTO 5.10.6" });
    sleeper = { RDC, RDW, RLL, wS, qu, c, qNet, Mu: Mus, Ms: Mss, f, Pu };
  }

  // --- a barrier on the slab's edge (A13.4.1 Case 1, BDM 11.3.7) -------------------------------------------------
  let barrier: null | { As: number; d: number; MR: number } = null;
  if (i.barrier) {
    const bt = BARS[i.topTrans.bar];
    const As = area(i.topTrans) - (0.5 * i.T) / i.fy;
    const d = i.t - i.coverTop - bt.dia / 2;
    const a = (As * i.fy) / (0.85 * i.fc * 12);
    const MR = (1.0 * As * i.fy * (d - a / 2)) / 12;
    barrier = { As, d, MR };
    add({ id: "barrier", name: "Barrier on the edge: Case 1, the top transverse bars at its face", demand: i.Mc, capacity: MR, unit: "kip·ft/ft", ref: "AASHTO A13.4.1" });
  }

  const shown = agencyChecks(checks, i.criteria);
  return {
    worksheet: ws,
    ok: shown.every((c) => c.ok || c.advisory),
    checks: shown,
    span: { S, NL, L1, E1, Em, E, r, axlesOnly },
    loads: { wDC, wDW, MDC, MDW, VDC, VDW, gov: { M: govM.v.name, V: govV.v.name }, runs: runs.map((x) => ({ name: x.v.name, M: x.M, R: x.R })), laneM, laneV, MLLlane, VLLlane, MLL, VLL, Mu, Ms, Vu },
    main,
    fatigue: { M: fat.M, E: Efat, Mfat, fRange, fMin, thresh, jd },
    shear: { dv, Vc },
    dist: { pct, required: distRequired },
    temp: { required: tempRequired, sMax: sTemp },
    dowels: { ld: ldSlab.required, ldh: ldhAbut.required },
    sleeper,
    barrier,
    concrete: { Ec, n, beta1 },
  };
}

export type ApproachSlabResult = ReturnType<typeof designApproachSlab>;
