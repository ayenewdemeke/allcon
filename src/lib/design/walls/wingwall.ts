import { BARS, DesignError, flexure, type Bars, type Check } from "./cip";

// A wingwall cantilevered off an abutment, AASHTO LRFD: earth pressure (at rest by default, AASHTO
// 3.11.5.2) and live load surcharge on the retained face, down to a line from the wall's full
// height at the abutment to the end height at its tip (the buried part below that is neglected);
// the moments and thrust at the abutment face (Section A), where the horizontal bars are
// designed; and the forces it hands the abutment (Section B). Kip and foot; bars and covers in
// inches.

export type WingwallInputs = {
  H: number; // ft, wall height (and earth pressure depth) at the abutment face
  h: number; // ft, earth pressure depth at the wingwall's tip
  L: number; // ft, length from the abutment face
  t: number; // in, wall thickness
  A: number; // ft, abutment width (square to it)
  skew: number; // deg
  gammaS: number; // kcf
  phi: number; // deg
  atRest: boolean; // k0 = 1 − sin φ (else k as entered)
  k: number;
  heq: number; // ft, live load surcharge height (AASHTO 3.11.6.4)
  gammaC: number; // kcf
  gDC: number;
  gEH: number; // at rest: 1.35 (Table 3.4.1-2)
  gLS: number;
  fc: number; // ksi
  fy: number; // ksi
  bars: Bars; // horizontal bars, retained face
  cover: number; // in
  exposure: 1 | 2;
};

/** The defaults: a 10 ft wingwall, 20 ft long, off an abutment skewed 30°. */
export const WINGWALL_DEFAULTS: WingwallInputs = {
  H: 10,
  h: 3,
  L: 20,
  t: 12,
  A: 3,
  skew: 30,
  gammaS: 0.13,
  phi: 34,
  atRest: true,
  k: 0.3,
  heq: 2,
  gammaC: 0.15,
  gDC: 1.25,
  gEH: 1.35,
  gLS: 1.75,
  fc: 4,
  fy: 60,
  bars: { bar: 8, spacing: 6 },
  cover: 2,
  exposure: 2,
};

/** Thrust, and its moments about the abutment face (A) and the top of the wall (C), of pressure
 * W (z + S) over the face from z = 0 down to a depth running from H at the abutment to h at L. */
export function pressureResultants(W: number, H: number, h: number, L: number, S: number) {
  return {
    P: ((W * L) / 6) * (H ** 2 + (h + H) * (h + 3 * S)),
    MA: ((W * L ** 2) / 24) * (3 * h ** 2 + (H + 4 * S) * (H + 2 * h)),
    MC: ((W * L) / 12) * (2 * S * h * H + (H ** 2 + h ** 2) * (H + h + 2 * S)),
  };
}

export function designWingwall(i: WingwallInputs) {
  if (i.H <= 0 || i.L <= 0 || i.t <= 0) throw new DesignError("The wingwall needs a height, a length and a thickness.");
  if (i.h < 0 || i.h > i.H) throw new DesignError("The end height must be between 0 and the height at the abutment.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });

  // --- earth pressure and surcharge -------------------------------------------------------------
  const k = i.atRest ? 1 - Math.sin((i.phi * Math.PI) / 180) : i.k; // AASHTO Eq. 3.11.5.2-1
  const W = k * i.gammaS;
  const earth = pressureResultants(W, i.H, i.h, i.L, 0);
  const all = pressureResultants(W, i.H, i.h, i.L, i.heq);
  const surcharge = { P: all.P - earth.P, MA: all.MA - earth.MA, MC: all.MC - earth.MC };
  const factored = (key: "P" | "MA" | "MC") => i.gEH * earth[key] + i.gLS * surcharge[key];
  const service = { P: all.P, MA: all.MA, MC: all.MC, x: all.MA / all.P, y: all.MC / all.P };
  const strength = { P: factored("P"), MA: factored("MA"), MC: factored("MC"), x: factored("MA") / factored("P"), y: factored("MC") / factored("P") };

  // --- self weight ------------------------------------------------------------------------------
  const V = (i.t / 12) * i.H * i.L * i.gammaC;
  const wall = { Vs: V, Vu: i.gDC * V, Ms: (V * i.L) / 2, Mu: (i.gDC * V * i.L) / 2 };

  // --- Section A: the horizontal bars, per foot of wall height -------------------------------------
  const Mu = strength.MA / i.H;
  const Ms = service.MA / i.H;
  const Vu = strength.P / i.H;
  const beta1 = Math.min(0.85, Math.max(0.65, 0.85 - (i.fc - 4) * 0.05));
  const Ec = 120000 * 0.15 ** 2 * i.fc ** 0.33; // AASHTO Eq. 5.4.2.4-1
  const flex = flexure({ Mu, Ms, h: i.t, cover: i.cover, bars: i.bars, fc: i.fc, fy: i.fy, Es: 29000, phiF: 0.9, exposure: i.exposure, n: 29000 / Ec, beta1 });
  const dv = Math.max(flex.de - flex.a / 2, 0.9 * flex.de, 0.72 * i.t);
  const VR = 0.9 * 0.0316 * 2 * Math.sqrt(i.fc) * 12 * dv; // β = 2 (5.7.3.4.1)
  add({ id: "a-flexure", name: "Horizontal bars, flexure", demand: Mu, capacity: flex.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.2" });
  add({ id: "a-min", name: "Horizontal bars, minimum reinforcement", demand: flex.minRequired, capacity: flex.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
  add({ id: "a-crack", name: "Horizontal bars, crack control (spacing)", demand: i.bars.spacing, capacity: flex.sMax, unit: "in", ref: "AASHTO 5.6.7" });
  add({ id: "a-shear", name: "Shear at the abutment face", demand: Vu, capacity: VR, unit: "kip/ft", ref: "AASHTO 5.7.3.3 (β = 2)" });

  // --- Section B: what the abutment takes, about its centroidal axes --------------------------------
  const Askew = i.A / Math.cos((i.skew * Math.PI) / 180);
  const sectionB = (r: typeof service, Vw: number) => ({ P: r.P, V: Vw, ex: r.x + Askew / 2, ez: i.H / 2 - r.y, My: r.P * (r.x + Askew / 2), Mx: r.P * (i.H / 2 - r.y), Tz: Vw * (i.L / 2 + Askew / 2) });

  return {
    ok: checks.every((c) => c.ok),
    checks,
    soil: { k, W },
    earth,
    surcharge,
    service,
    strength,
    wall,
    sectionA: { Mu, Ms, Vu, flex, dv, VR, bar: BARS[i.bars.bar] },
    Askew,
    sectionB: { service: sectionB(service, wall.Vs), strength: sectionB(strength, wall.Vu) },
  };
}

export type WingwallResult = ReturnType<typeof designWingwall>;
