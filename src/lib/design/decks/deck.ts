import { BARS, DesignError, flexure, type Bars, type Check } from "../walls/cip";
import { railDef, railOnDeck, type RailKey, type RailSteel, type TestLevel } from "./rails";

// A cast-in-place concrete deck on parallel girders, AASHTO LRFD, by the approximate (equivalent
// strip) method: the transverse strip is a continuous beam on rigid supports at the girders, with
// the overhangs (4.6.2.1.6). Dead loads, and the 32 kip design truck's axles placed across the
// deck for the largest effects (only the axles, for spacings up to 15 ft), with multiple presence
// and dynamic load allowance, over the strip widths of 4.6.2.1.3. Then the transverse bars (top
// and bottom), the longitudinal bars, and the overhang for vehicle collision (A13.4.1). Per foot of
// deck; kip and foot, bars and thicknesses in inches.

export type DeckInputs = {
  nGirders: number;
  S: number; // ft, girder spacing
  overhang: number; // ft, deck edge to the exterior girder's centerline
  t: number; // in, deck slab
  tEdge: number; // in, overhang at the deck edge
  tFlange: number; // in, overhang at the edge of the girder flange
  flange: number; // in, girder top flange width
  dSection: number; // in, girder centerline to the negative moment design section (4.6.2.1.6)
  barrierWidth: number; // in, at its base
  barrierWeight: number; // klf
  barrierCg: number; // in, from the deck edge
  wearing: number; // in
  gammaWS: number; // kcf
  utilities: number; // ksf
  fc: number; // ksi
  fy: number; // ksi
  gammaC: number; // kcf
  coverTop: number; // in
  coverBot: number; // in
  exposure: 1 | 2;
  topBars: Bars; // transverse, top
  botBars: Bars; // transverse, bottom
  topLong: Bars; // longitudinal, top
  botLong: Bars; // longitudinal, bottom (distribution)
  // Overhang, for vehicle collision (Table A13.2-1 and the barrier's own analysis)
  Mc: number; // kip·ft/ft, the barrier's flexural resistance at its base
  T: number; // kip/ft, axial tension, Rw / (Lc + 2H) (Eq. A13.4.2-1)
  Fv: number; // kip, vertical design force
  Lv: number; // ft, its longitudinal distribution
  la: number; // ft, its lever arm to the barrier face
  /** A CDOT standard bridge rail (B-606): it sets the barrier's width, weight and c.g. and, for a parapet, Mc and T; "custom" keeps them as entered. */
  rail?: { type: RailKey; testLevel: TestLevel; steel: RailSteel };
  /** Started from a girder design, which carries the deck's concrete, the rails and the waterproofing in its quantities: this design adds the bars. */
  fromGirder?: { id: string; name: string } | null;
};

export const RAIL_DEFAULT: NonNullable<DeckInputs["rail"]> = { type: "custom", testLevel: "TL-5", steel: "A1035" };

/** The deck's inputs with a standard rail's values in place of the entered barrier, and the rail's design. */
export function withRail(i: DeckInputs) {
  const choice = { ...RAIL_DEFAULT, ...(i.rail ?? {}) };
  const def = railDef(choice.type);
  if (!def) return { inputs: i, rail: null };
  const r = railOnDeck(def, { fc: 4.5, steel: choice.steel, testLevel: choice.testLevel, gammaC: i.gammaC });
  const parapet = r.resistance;
  return {
    inputs: {
      ...i,
      barrierWidth: def.width,
      barrierWeight: r.weight,
      barrierCg: r.cg,
      Fv: r.Fv,
      Lv: r.Lv,
      la: r.la,
      // The deck develops the wall's Mc as the yield lines take it, averaged over its varying height (A13.4.2, CA13.3.1).
      ...(parapet ? { Mc: parapet.interior.Mc, T: parapet.interior.T } : {}),
    },
    rail: { ...r, choice },
  };
}

/** The defaults: a 43 ft deck on four box girders at 11 ft, with a TL-4 (MASH) barrier. */
export const DECK_DEFAULTS: DeckInputs = {
  nGirders: 4,
  S: 11,
  overhang: 5,
  t: 8,
  tEdge: 8,
  tFlange: 10,
  flange: 48,
  dSection: 24,
  barrierWidth: 18,
  barrierWeight: 0.2885,
  barrierCg: 12.6261,
  wearing: 3,
  gammaWS: 0.14667,
  utilities: 0,
  fc: 4.5,
  fy: 60,
  gammaC: 0.15,
  coverTop: 2,
  coverBot: 1,
  exposure: 1,
  topBars: { bar: 5, spacing: 5 },
  botBars: { bar: 5, spacing: 6 },
  topLong: { bar: 4, spacing: 6 },
  botLong: { bar: 5, spacing: 8 },
  Mc: 19.6645,
  T: 7.2607,
  Fv: 22,
  Lv: 18,
  la: 0.4478,
};

type PointLoad = { x: number; P: number };

/** The strip as a continuous beam on rigid supports (equal EI), by the three-moment equation:
 * its bending moment (positive sagging) anywhere, under point loads. */
export function stripBeam(supports: number[]) {
  const n = supports.length;
  return (loads: PointLoad[]) => {
    const M = new Array<number>(n).fill(0);
    for (const l of loads) {
      if (l.x < supports[0]) M[0] -= l.P * (supports[0] - l.x);
      if (l.x > supports[n - 1]) M[n - 1] -= l.P * (l.x - supports[n - 1]);
    }
    if (n >= 3) {
      // Interior supports 1..n−2: L_i M_{i−1} + 2 (L_i + L_{i+1}) M_i + L_{i+1} M_{i+1} = rhs.
      const m = n - 2;
      const a = new Array<number>(m).fill(0);
      const b = new Array<number>(m).fill(0);
      const c = new Array<number>(m).fill(0);
      const d = new Array<number>(m).fill(0);
      for (let k = 0; k < m; k++) {
        const i = k + 1;
        const Li = supports[i] - supports[i - 1];
        const Lj = supports[i + 1] - supports[i];
        a[k] = Li;
        b[k] = 2 * (Li + Lj);
        c[k] = Lj;
        let rhs = 0;
        for (const l of loads) {
          if (l.x > supports[i - 1] && l.x < supports[i]) {
            const p = l.x - supports[i - 1];
            rhs -= (l.P * p * (Li ** 2 - p ** 2)) / Li;
          } else if (l.x > supports[i] && l.x < supports[i + 1]) {
            const q = supports[i + 1] - l.x;
            rhs -= (l.P * q * (Lj ** 2 - q ** 2)) / Lj;
          }
        }
        if (k === 0) rhs -= Li * M[0];
        if (k === m - 1) rhs -= Lj * M[n - 1];
        d[k] = rhs;
      }
      // Tridiagonal solve (Thomas).
      for (let k = 1; k < m; k++) {
        const w = a[k] / b[k - 1];
        b[k] -= w * c[k - 1];
        d[k] -= w * d[k - 1];
      }
      const x = new Array<number>(m);
      x[m - 1] = d[m - 1] / b[m - 1];
      for (let k = m - 2; k >= 0; k--) x[k] = (d[k] - c[k] * x[k + 1]) / b[k];
      for (let k = 0; k < m; k++) M[k + 1] = x[k];
    }
    return (at: number) => {
      if (at <= supports[0]) return -loads.reduce((s, l) => s + (l.x < at ? l.P * (at - l.x) : 0), 0);
      if (at >= supports[n - 1]) return -loads.reduce((s, l) => s + (l.x > at ? l.P * (l.x - at) : 0), 0);
      const i = supports.findIndex((g) => g >= at);
      const g0 = supports[i - 1];
      const L = supports[i] - g0;
      const xi = (at - g0) / L;
      let m0 = 0;
      for (const l of loads) {
        if (l.x <= g0 || l.x >= supports[i]) continue;
        const p = l.x - g0;
        m0 += at <= l.x ? (l.P * (L - p) * (at - g0)) / L : (l.P * p * (L - (at - g0))) / L;
      }
      return M[i - 1] * (1 - xi) + M[i] * xi + m0;
    };
  };
}

const WHEEL = 16; // kip, half the design truck's 32 kip axle
const GAUGE = 6; // ft between a truck's wheels
const CLEAR = 4; // ft between the nearest wheels of adjacent trucks
const PRESENCE = [1.2, 1.0, 0.85, 0.65]; // Table 3.6.1.1.2-1
const IM = 0.33; // 3.6.2.1

export function designDeck(entered: DeckInputs) {
  const { inputs: i, rail } = withRail(entered);
  if (i.nGirders < 2) throw new DesignError("The deck needs at least two girders.");
  if (i.S <= 0 || i.S > 15) throw new DesignError("Girder spacing must be over 0 and at most 15 ft: beyond 15 ft AASHTO 4.6.2.1.6 adds the lane load and wider-spaced axles, which this tool doesn't cover.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });

  // --- the cross-section ------------------------------------------------------------------------
  const W = 2 * i.overhang + (i.nGirders - 1) * i.S;
  const girders = Array.from({ length: i.nGirders }, (_, k) => i.overhang + k * i.S);
  const bw = i.barrierWidth / 12;
  const flangeEdge = Math.max(i.overhang - i.flange / 24, 0); // from the deck edge
  /** Slab thickness (in) across the deck: tapering in the overhangs to the flange edge. */
  const thickness = (x: number) => {
    const e = Math.min(x, W - x);
    return e < flangeEdge ? i.tEdge + ((i.tFlange - i.tEdge) * e) / flangeEdge : i.t;
  };
  const beam = stripBeam(girders);

  // --- dead loads, as point loads every 0.05 ft ----------------------------------------------------
  const dx = 0.05;
  const steps = Math.ceil(W / dx);
  const DC: PointLoad[] = [];
  const DW: PointLoad[] = [];
  for (let k = 0; k < steps; k++) {
    const x = Math.min((k + 0.5) * dx, W);
    const len = Math.min(dx, W - k * dx);
    DC.push({ x, P: (i.gammaC * thickness(x) * len) / 12 });
    if (x > bw && x < W - bw) DW.push({ x, P: ((i.gammaWS * i.wearing) / 12 + i.utilities) * len });
  }
  DC.push({ x: i.barrierCg / 12, P: i.barrierWeight }, { x: W - i.barrierCg / 12, P: i.barrierWeight });
  const mDC = beam(DC);
  const mDW = beam(DW);

  // --- the design sections -------------------------------------------------------------------------
  const positive: number[] = [];
  for (let k = 0; k < i.nGirders - 1; k++) for (let f = 0.05; f < 0.96; f += 0.05) positive.push(girders[k] + f * i.S);
  const d = i.dSection / 12;
  const interior = i.nGirders >= 3 ? girders.slice(1, -1) : [];
  const negative = interior.length ? interior.flatMap((g) => [g - d, g + d]) : [girders[0] + d, girders[girders.length - 1] - d];

  // --- live load: influence lines and the trucks placed for the largest effects -------------------------
  const step = 0.1;
  const xMin = bw + 2; // wheel 2 ft from the barrier face (3.6.1.3.1)
  const xMax = W - bw - 2 - GAUGE;
  const lanes = Math.max(1, Math.min(PRESENCE.length, Math.floor((W - 2 * bw) / 12)));
  const grid: number[] = [];
  for (let x = xMin; x <= xMax + 1e-9; x += step) grid.push(x);
  // influence[s][p]: moment at section s from a unit load at grid point p (and p + 6 ft).
  const unitAt = new Map<number, (at: number) => number>();
  const unit = (x: number) => {
    const key = Math.round(x / step);
    if (!unitAt.has(key)) unitAt.set(key, beam([{ x, P: 1 }]));
    return unitAt.get(key)!;
  };
  const gap = Math.round((GAUGE + CLEAR) / step);
  const truckEffect = (section: number, sign: 1 | -1) => {
    const f = grid.map((x) => sign * (unit(x)(section) + unit(x + GAUGE)(section)) * WHEEL);
    // Largest sum of k trucks, each at least 10 ft (6 + 4) past the one before.
    let best = 0;
    let prev = f.map(() => 0);
    for (let k = 1; k <= lanes; k++) {
      const cur = new Array<number>(f.length).fill(-Infinity);
      for (let p = 0; p < f.length; p++) {
        const place = k === 1 ? f[p] : p - gap >= 0 ? prev[p - gap] + f[p] : -Infinity;
        cur[p] = Math.max(p > 0 ? cur[p - 1] : -Infinity, place);
      }
      const top = cur[cur.length - 1];
      if (Number.isFinite(top)) best = Math.max(best, PRESENCE[k - 1] * top);
      prev = cur;
    }
    return sign * best;
  };
  const stripPos = (26 + 6.6 * i.S) / 12; // ft (4.6.2.1.3)
  const stripNeg = (48 + 3.0 * i.S) / 12;

  // --- design moments, per foot ---------------------------------------------------------------------
  const pick = (sign: 1 | -1, list: number[], strip: number) => {
    let best: { x: number; MDC: number; MDW: number; MLL: number; Mu: number; Ms: number } | null = null;
    for (const x of list) {
      const MDC = mDC(x);
      const MDW = mDW(x);
      const MLL = ((1 + IM) * truckEffect(x, sign)) / strip;
      const gDC = sign * MDC > 0 ? 1.25 : 0.9;
      const gDW = sign * MDW > 0 ? 1.5 : 0.65;
      const Mu = gDC * MDC + gDW * MDW + 1.75 * MLL;
      if (!best || sign * Mu > sign * best.Mu) best = { x, MDC, MDW, MLL, Mu, Ms: MDC + MDW + MLL };
    }
    return best!;
  };
  const pos = pick(1, positive, stripPos);
  const neg = pick(-1, negative, stripNeg);

  // --- transverse bars --------------------------------------------------------------------------------
  const beta1 = Math.min(0.85, Math.max(0.65, 0.85 - (i.fc - 4) * 0.05));
  const Ec = 120000 * i.gammaC ** 2 * i.fc ** 0.33; // AASHTO Eq. 5.4.2.4-1
  const n = 29000 / Ec;
  const common = { fc: i.fc, fy: i.fy, Es: 29000, phiF: 0.9, exposure: i.exposure, n, beta1 };
  const bottom = flexure({ ...common, Mu: pos.Mu, Ms: pos.Ms, h: i.t, cover: i.coverBot, bars: i.botBars });
  const top = flexure({ ...common, Mu: -neg.Mu, Ms: -neg.Ms, h: i.t, cover: i.coverTop, bars: i.topBars });
  for (const [key, name, f, bars] of [["pos", "Bottom bars (positive moment)", bottom, i.botBars], ["neg", "Top bars (negative moment)", top, i.topBars]] as const) {
    const Mu = key === "pos" ? pos.Mu : -neg.Mu;
    add({ id: `${key}-flexure`, name: `${name}, flexure`, demand: Mu, capacity: f.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2" });
    add({ id: `${key}-min`, name: `${name}, minimum reinforcement`, demand: f.minRequired, capacity: f.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
    add({ id: `${key}-crack`, name: `${name}, crack control (spacing)`, demand: bars.spacing, capacity: f.sMax, unit: "in", ref: "AASHTO 5.6.7" });
    add({ id: `${key}-fss`, name: `${name}, service stress ≤ 0.6 fy`, demand: f.fss, capacity: 0.6 * i.fy, unit: "ksi", ref: "AASHTO 5.6.7" });
  }

  // --- longitudinal bars ---------------------------------------------------------------------------------
  const area = (b: Bars) => (BARS[b.bar].area * 12) / b.spacing;
  const tempRequired = (1.3 * W * 12 * i.t) / (2 * (W * 12 + i.t) * i.fy); // AASHTO Eq. 5.10.6-1
  const topLong = area(i.topLong);
  add({ id: "long-temp", name: "Top longitudinal: shrinkage and temperature steel", demand: Math.max(tempRequired, 0.11), capacity: topLong, unit: "in²/ft", ok: topLong >= Math.max(tempRequired, 0.11) && topLong <= 0.6, ref: "AASHTO 5.10.6" });
  const Se = i.S - i.flange / 12; // effective span (9.7.2.3), between flanges
  const pct = Math.min(220 / Math.sqrt(Math.max(Se, 1e-6)), 67) / 100; // AASHTO 9.7.3.2
  const distRequired = pct * area(i.botBars);
  add({ id: "long-dist", name: `Bottom longitudinal: distribution, ${Math.round(pct * 100)}% of the bottom transverse bars`, demand: distRequired, capacity: area(i.botLong), unit: "in²/ft", ref: "AASHTO 9.7.3.2" });

  // --- the overhang (A13.4.1) ------------------------------------------------------------------------------
  const barrier = { x: i.barrierCg / 12, P: i.barrierWeight };
  const slabMoment = (x: number) => {
    let m = 0;
    for (let k = 0; k * dx < x; k++) {
      const len = Math.min(dx, x - k * dx);
      const xc = k * dx + len / 2;
      m += ((i.gammaC * thickness(xc) * len) / 12) * (x - xc);
    }
    return m;
  };
  const dcAt = (x: number) => barrier.P * Math.max(x - barrier.x, 0) + slabMoment(x);
  const dwAt = (x: number) => ((i.gammaWS * i.wearing) / 12 + i.utilities) * (Math.max(x - bw, 0) ** 2 / 2);
  const bar = BARS[i.topBars.bar];
  const asTop = area(i.topBars);
  const capacity = (h: number, As: number, phi: number) => {
    const dTop = h - i.coverTop - bar.dia / 2;
    const a = (As * i.fy) / (0.85 * i.fc * 12);
    return (phi * As * i.fy * (dTop - a / 2)) / 12;
  };
  // Case 1: transverse collision at the barrier face, the barrier's moment with the axial tension.
  const h1 = thickness(bw);
  const case1 = { x: bw, h: h1, MDC: dcAt(bw), MDW: dwAt(bw), Mu: dcAt(bw) + dwAt(bw) + i.Mc, As: asTop - (0.5 * i.T) / i.fy, MR: 0 };
  case1.MR = capacity(h1, case1.As, 1.0);
  add({ id: "oh-case1", name: "Overhang, Case 1: transverse collision at the barrier face", demand: case1.Mu, capacity: case1.MR, unit: "kip·ft/ft", ref: "AASHTO A13.4.1" });
  // Case 2: vertical collision.
  const case2 = { Mv: (i.Fv * i.la) / i.Lv, Mu: dcAt(bw) + (i.Fv * i.la) / i.Lv, MR: capacity(h1, asTop, 1.0) };
  add({ id: "oh-case2", name: "Overhang, Case 2: vertical collision", demand: case2.Mu, capacity: case2.MR, unit: "kip·ft/ft", ref: "AASHTO A13.4.1" });
  // Case 3: Strength I at the design section by the exterior girder.
  const x3 = i.overhang - d;
  const toFace = i.overhang - bw; // exterior girder centerline to the barrier face
  const arm = Math.max(x3 - bw - 1, 0); // wheel or line load 1 ft from the barrier face
  const lineLoad = toFace <= 6; // 3.6.1.3.4: a 1.0 klf line load in place of the outside wheels
  const MLL3 = lineLoad ? 1.0 * arm : (WHEEL * arm) / ((45 + 10 * arm) / 12);
  const m3 = lineLoad ? 1 : 1.2;
  const case3 = { x: x3, h: thickness(x3), MDC: dcAt(x3), MDW: dwAt(x3), MLL: MLL3, m: m3, lineLoad, Mu: 1.25 * dcAt(x3) + 1.5 * dwAt(x3) + 1.75 * m3 * (1 + IM) * MLL3, MR: 0 };
  case3.MR = capacity(case3.h, asTop, 0.9);
  add({ id: "oh-case3", name: "Overhang, Case 3: dead and live load at the girder", demand: case3.Mu, capacity: case3.MR, unit: "kip·ft/ft", ref: "AASHTO A13.4.1" });

  // --- the bridge rail ------------------------------------------------------------------------------------------
  let endCase1: { Mc: number; T: number; Mu: number; MR: number } | null = null;
  if (rail) {
    const f = rail.forces;
    add({ id: "rail-height", name: `Rail height for ${rail.choice.testLevel}`, demand: f.H, capacity: rail.rail.height, unit: "in", ref: "AASHTO 13.7.3.2" });
    const p = rail.resistance;
    if (p) {
      // The standard is crash tested or designed by Staff Bridge: its resistance is shown, not a pass or fail of the standard.
      add({ id: "rail-rw", name: `Rail resistance Rw within a segment, ${rail.choice.testLevel} (yield lines)`, demand: f.Ft, capacity: p.interior.Rw, unit: "kip", ref: "AASHTO A13.3.1", advisory: true, ok: p.interior.Rw >= f.Ft });
      add({ id: "rail-rw-end", name: `Rail resistance Rw at an end or joint, ${rail.choice.testLevel}`, demand: f.Ft, capacity: p.end.Rw, unit: "kip", ref: "AASHTO A13.3.1", advisory: true, ok: p.end.Rw >= f.Ft });
      // At the rail's ends (its end zones' closer bars): the deck there carries the larger Mc and T.
      const McE = p.end.Mc;
      const AsE = asTop - (0.5 * p.end.T) / i.fy;
      endCase1 = { Mc: McE, T: p.end.T, Mu: dcAt(bw) + dwAt(bw) + McE, MR: capacity(h1, AsE, 1.0) };
      add({ id: "oh-case1-end", name: "Overhang, Case 1 at the rail's ends and joints (its end zones)", demand: endCase1.Mu, capacity: endCase1.MR, unit: "kip·ft/ft", ref: "AASHTO A13.4.2", advisory: true, ok: endCase1.Mu <= endCase1.MR });
    }
  }

  return {
    rail,
    applied: i,
    endCase1,
    ok: checks.every((c) => c.ok),
    checks,
    geometry: { W, girders, bw, flangeEdge, lanes, stripPos, stripNeg, Se },
    thickness,
    moments: { DC: mDC, DW: mDW },
    pos,
    neg,
    bottom,
    top,
    long: { tempRequired, topLong, pct, distRequired, botLong: area(i.botLong) },
    overhang: { case1, case2, case3 },
    concrete: { Ec, n, beta1 },
  };
}

export type DeckResult = ReturnType<typeof designDeck>;
