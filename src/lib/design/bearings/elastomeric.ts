import { DesignError, type Check } from "../walls/cip";

// An elastomeric bearing pad, plain or steel-reinforced, AASHTO LRFD Section 14: Method A
// (14.7.6) or, for steel-reinforced pads, Method B (14.7.5). Per bearing, at the service limit
// state: the shape factor, compressive stress (A) or shear strains (B), deflections, shear
// deformation, stability, the steel shims, and anchorage. Kip, inch and ksi throughout; rotations
// in radians, temperatures in °F.

export type Pad = "plain" | "steel";
export type Method = "A" | "B";
export type Hardness = 50 | 60 | 70;

export type BearingInputs = {
  pad: Pad;
  method: Method;
  // Plan (rectangular, no holes)
  L: number; // in, parallel to the bridge's longitudinal axis
  W: number; // in, across it
  // Layers: a plain pad is one layer hri thick
  hri: number; // in, each interior layer
  n: number; // interior layers
  hre: number; // in, each of the two cover layers
  hs: number; // in, steel shim thickness
  Fy: number; // ksi, shims
  dFth: number; // ksi, constant-amplitude fatigue threshold (Table 6.6.1.2.3-1, Category A)
  // Elastomer: by hardness (Method A only) or a specified shear modulus (±15%)
  byHardness: boolean;
  hardness: Hardness;
  G: number; // ksi, specified
  creep: number; // creep deflection factor, acr (Table 14.7.6.2-1)
  // Service loads per bearing
  DL: number; // kip
  LL: number; // kip, without dynamic load allowance (14.4.1)
  jointed: boolean; // a deck joint at the bearing: live load deflection limited to 1/8 in
  // Shear deformation
  alpha: number; // /°F
  expansionLength: number; // ft
  Tmax: number; // °F
  Tmin: number; // °F
  gammaTU: number; // Service I load factor on TU (Table 3.4.1-1)
  thermalFactor: number; // part of the thermal range the pad takes (1.0 if set before the range is known)
  otherStatic: number; // in, creep, shrinkage, prestress and other static movements
  cyclic: number; // in, live load and other cyclic movements
  shearPrevented: boolean; // shear deformation prevented: Method A stress limits up 10% (14.7.6.3.2)
  // Rotations (Method B)
  thetaD: number; // rad, dead load (with camber)
  thetaU: number; // rad, allowance for uncertainties (14.4.2.1)
  thetaL: number; // rad, live load (cyclic)
  deckFree: boolean; // the deck is free to translate horizontally (stability, 14.7.5.3.4)
  // Anchorage
  mu: number; // friction coefficient (C14.8.3.1)
};

/** The defaults: a steel-reinforced pad designed by Method B. */
export const BEARING_DEFAULTS: BearingInputs = {
  pad: "steel",
  method: "B",
  L: 15,
  W: 20,
  hri: 0.5,
  n: 9,
  hre: 0.125,
  hs: 0.125,
  Fy: 36,
  dFth: 24,
  byHardness: false,
  hardness: 60,
  G: 0.15,
  creep: 0.35,
  DL: 115,
  LL: 85,
  jointed: true,
  alpha: 6.5e-6,
  expansionLength: 80,
  Tmax: 120,
  Tmin: -30,
  gammaTU: 1.2,
  thermalFactor: 1,
  otherStatic: 0.5,
  cyclic: 0.04,
  shearPrevented: false,
  thetaD: 0.002,
  thetaU: 0.005,
  thetaL: 0.001,
  deckFree: true,
  mu: 0.2,
};

/** AASHTO Table 14.7.6.2-1: shear modulus at 73°F (ksi) and creep deflection factor, by hardness. */
export const HARDNESS: Record<Hardness, { Gmin: number; Gmax: number; creep: number }> = {
  50: { Gmin: 0.095, Gmax: 0.13, creep: 0.25 },
  60: { Gmin: 0.13, Gmax: 0.2, creep: 0.35 },
  70: { Gmin: 0.2, Gmax: 0.3, creep: 0.45 },
};

/** Compressive strain of a layer under a stress, AASHTO Eq. C14.7.5.3.6-1. */
const strain = (sigma: number, G: number, S: number) => sigma / (4.8 * G * S ** 2);

export function designBearing(i: BearingInputs) {
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });
  const steel = i.pad === "steel";
  const method: Method = steel ? i.method : "A";
  if (i.L <= 0 || i.W <= 0 || i.hri <= 0) throw new DesignError("The pad needs a length, a width and a layer thickness.");
  if (steel && i.n < 1) throw new DesignError("A steel-reinforced pad needs at least one interior layer.");

  // --- the pad ---------------------------------------------------------------------------------
  const A = i.L * i.W;
  const hrt = steel ? i.n * i.hri + 2 * i.hre : i.hri;
  const n = steel ? i.n : 1;
  const shims = steel ? i.n + 1 : 0;
  const height = hrt + shims * i.hs;
  const S = A / (2 * i.hri * (i.L + i.W)); // AASHTO Eq. 14.7.5.1-1
  const byHardness = method === "A" && i.byHardness;
  const G = byHardness ? HARDNESS[i.hardness] : { Gmin: 0.85 * i.G, Gmax: 1.15 * i.G, creep: i.creep };
  const acr = byHardness ? HARDNESS[i.hardness].creep : i.creep;

  // --- loads and movements -----------------------------------------------------------------------
  const sigmaD = i.DL / A;
  const sigmaL = i.LL / A;
  const sigmaS = sigmaD + sigmaL;
  const thermal = i.alpha * i.expansionLength * 12 * (i.Tmax - i.Tmin); // AASHTO Eq. 3.12.2.3-1
  const dsStatic = i.gammaTU * i.thermalFactor * thermal + i.otherStatic;
  const ds = dsStatic + i.cyclic;

  // --- material and proportions ------------------------------------------------------------------
  const gLimit = method === "A" ? 0.25 : 0.175;
  add({ id: "mat-G", name: `Shear modulus within 0.080–${gLimit === 0.25 ? "0.250" : "0.175"} ksi`, demand: G.Gmax, capacity: gLimit, unit: "ksi", ok: G.Gmin >= 0.08 - 1e-9 && G.Gmax <= gLimit + 1e-9, ref: method === "A" ? "AASHTO 14.7.6.2" : "AASHTO 14.7.5.2" });
  if (steel) {
    add({ id: "geo-cover", name: "Cover layers at most 70% of an interior layer", demand: i.hre, capacity: 0.7 * i.hri, unit: "in", ref: method === "A" ? "AASHTO 14.7.6.1" : "AASHTO 14.7.5.1" });
    if (method === "A") add({ id: "geo-S2n", name: "Method A applies: S²/n < 22", demand: S ** 2 / n, capacity: 22, unit: "", ref: "AASHTO 14.7.6.1" });
  }

  // --- compressive stress (Method A) --------------------------------------------------------------
  const boost = method === "A" && i.shearPrevented ? 1.1 : 1;
  if (method === "A") {
    const k = steel ? 1.25 : 1.0;
    const cap = steel ? 1.25 : 0.8;
    add({ id: "comp-GS", name: `Compressive stress ≤ ${steel ? "1.25" : "1.00"} G S`, demand: sigmaS, capacity: boost * k * G.Gmin * S, unit: "ksi", ref: "AASHTO 14.7.6.3.2" });
    add({ id: "comp-max", name: `Compressive stress ≤ ${cap.toFixed(2)} ksi`, demand: sigmaS, capacity: boost * cap, unit: "ksi", ref: "AASHTO 14.7.6.3.2" });
  }

  // --- deflections ----------------------------------------------------------------------------
  const epsL = strain(sigmaL, G.Gmin, S);
  const epsD = strain(sigmaD, G.Gmin, S);
  const epsS = strain(sigmaS, G.Gmin, S);
  const dL = epsL * hrt;
  const dD = epsD * hrt;
  const dLong = dD * (1 + acr); // AASHTO Eq. 14.7.5.3.6-3
  if (i.jointed) add({ id: "defl-LL", name: "Live load deflection ≤ 1/8 in (deck joint)", demand: dL, capacity: 0.125, unit: "in", ref: "AASHTO 14.7.5.3.6" });
  if (method === "A") add({ id: "defl-layer", name: "Deflection of a layer ≤ 0.09 hri", demand: epsS * i.hri, capacity: 0.09 * i.hri, unit: "in", ref: "AASHTO 14.7.6.3.3" });

  // --- shear deformation ------------------------------------------------------------------------
  add({ id: "shear-hrt", name: "Elastomer thickness hrt ≥ 2 Δs", demand: 2 * ds, capacity: hrt, unit: "in", ref: method === "A" ? "AASHTO 14.7.6.3.4" : "AASHTO 14.7.5.3.2" });

  // --- shear strains: compression, rotation and shear (Method B) ----------------------------------
  const Da = 1.4;
  const Dr = 0.5;
  const thetaSt = Math.abs(i.thetaD) + i.thetaU; // the allowance for uncertainties adds (14.4.2.1)
  const thetaCy = Math.abs(i.thetaL);
  const gamma = {
    aSt: (Da * sigmaD) / (G.Gmin * S), // AASHTO Eq. 14.7.5.3.3-3
    aCy: (Da * sigmaL) / (G.Gmin * S),
    rSt: (Dr * (i.L / i.hri) ** 2 * thetaSt) / n, // AASHTO Eq. 14.7.5.3.3-6
    rCy: (Dr * (i.L / i.hri) ** 2 * thetaCy) / n,
    sSt: dsStatic / hrt, // AASHTO Eq. 14.7.5.3.3-10
    sCy: i.cyclic / hrt,
  };
  const gammaTotal = gamma.aSt + gamma.rSt + gamma.sSt + 1.75 * (gamma.aCy + gamma.rCy + gamma.sCy);
  if (method === "B") {
    add({ id: "strain-a", name: "Static axial shear strain γa,st ≤ 3.0", demand: gamma.aSt, capacity: 3, unit: "", ref: "AASHTO 14.7.5.3.3-1" });
    add({ id: "strain-total", name: "Combined shear strains ≤ 5.0", demand: gammaTotal, capacity: 5, unit: "", ref: "AASHTO 14.7.5.3.3-2" });
  }

  // --- stability -----------------------------------------------------------------------------------
  // Method B: with L longer than W, both ways round (14.7.5.3.4).
  const orientations = i.L > i.W ? [[i.L, i.W], [i.W, i.L]] : [[i.L, i.W]];
  const stab = orientations.map(([l, w]) => {
    const As = (1.92 * (hrt / l)) / Math.sqrt(1 + (2 * l) / w); // AASHTO Eq. 14.7.5.3.4-2
    const Bs = 2.67 / ((S + 2) * (1 + l / (4 * w))); // AASHTO Eq. 14.7.5.3.4-3
    const stable = 2 * As <= Bs;
    const limit = stable ? Infinity : i.deckFree ? (G.Gmin * S) / (2 * As - Bs) : As - Bs > 0 ? (G.Gmin * S) / (As - Bs) : Infinity;
    return { l, w, A: As, B: Bs, stable, limit };
  });
  if (method === "A") {
    add({ id: "stab-height", name: "Total height ≤ L/3 and W/3", demand: height, capacity: Math.min(i.L, i.W) / 3, unit: "in", ref: "AASHTO 14.7.6.3.6" });
  } else {
    const worst = stab.reduce((a, b) => (b.limit < a.limit ? b : a));
    if (worst.limit === Infinity) add({ id: "stab", name: "Stable without further investigation: 2A ≤ B", demand: 2 * worst.A, capacity: worst.B, unit: "", ref: "AASHTO 14.7.5.3.4-1" });
    else add({ id: "stab", name: `Stability, deck ${i.deckFree ? "free to translate" : "fixed"}: σs ≤ G S / (${i.deckFree ? "2A" : "A"} − B)`, demand: sigmaS, capacity: worst.limit, unit: "ksi", ref: i.deckFree ? "AASHTO 14.7.5.3.4-4" : "AASHTO 14.7.5.3.4-5" });
  }

  // --- steel shims -------------------------------------------------------------------------------
  const hsService = (3 * i.hri * sigmaS) / i.Fy; // AASHTO Eq. 14.7.5.3.5-1
  const hsFatigue = (2 * i.hri * sigmaL) / i.dFth; // AASHTO Eq. 14.7.5.3.5-2
  if (steel) {
    add({ id: "shim-service", name: "Shim thickness, service", demand: hsService, capacity: i.hs, unit: "in", ref: "AASHTO 14.7.5.3.5-1" });
    add({ id: "shim-fatigue", name: "Shim thickness, fatigue", demand: hsFatigue, capacity: i.hs, unit: "in", ref: "AASHTO 14.7.5.3.5-2" });
  }

  // --- anchorage --------------------------------------------------------------------------------
  // Method B, without bonded external plates: a restraint system unless θ/n ≤ 3 εa / S (14.7.5.4).
  const thetaS = thetaSt + 1.75 * thetaCy;
  const epsA = epsD + 1.75 * epsL;
  if (method === "B") add({ id: "anchor-restraint", name: "No restraint system needed: θs/n ≤ 3 εa/S", demand: thetaS / n, capacity: (3 * epsA) / S, unit: "", ref: "AASHTO 14.7.5.4-1" });
  // The pad doesn't slip while the shear force stays under friction on the permanent load (14.8.3).
  const dsAllow = (i.mu * i.DL * hrt) / (G.Gmax * A); // AASHTO Eqs. 14.6.3.1-1 and -2
  add({ id: "anchor-slip", name: "Pad doesn't slip: Δs ≤ μ DL hrt / (Gmax A)", demand: ds, capacity: dsAllow, unit: "in", ref: "AASHTO 14.8.3" });

  return {
    ok: checks.every((c) => c.ok),
    checks,
    method,
    pad: { A, hrt, n, shims, height, S, G, acr },
    loads: { sigmaD, sigmaL, sigmaS },
    movement: { thermal, dsStatic, ds },
    deflection: { epsL, epsD, epsS, dL, dD, dLong },
    strains: { Da, Dr, thetaSt, thetaCy, ...gamma, total: gammaTotal },
    stability: stab,
    shims: { service: hsService, fatigue: hsFatigue },
    anchorage: { thetaS, epsA, dsAllow },
  };
}

export type BearingResult = ReturnType<typeof designBearing>;
