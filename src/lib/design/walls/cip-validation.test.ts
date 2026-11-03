import { describe, expect, it } from "vitest";
import { CIP_DEFAULTS, DEFAULT_FACTORS, designCipWall, type CipInputs } from "./cip";

// Validation against a state DOT's worked example (CIP cantilever wall, 2024): a 15 ft stem on a
// 10 ft footing with a barrier, TL-4 collision at the wall's end, live load surcharge and a shear
// key. With the example's own assumptions as inputs (its 36 pcf minimum fluid weight, key
// location, and no earth pressure or surcharge in Extreme Event II), the engine reproduces its
// numbers, which were rounded as displayed.

const example: CipInputs = {
  ...CIP_DEFAULTS,
  gammaS: 0.13, phi: 34, delta: null, kpOverride: 7.6, efwMin: 0.036,
  qn: 7.5, phiSub: 20, fc: 4.5, gammaC: 0.15, fy: 60, Es: 29000,
  phiB: 0.55, phiT: 1.0, phiTss: 1.0, phiEp: 0.5, phiEE: 1.0, phiF: 0.9, phiV: 0.9,
  liveLoad: true, trafficDistance: 2, pavementThickness: 0,
  railWeight: 0.486, railCg: 6.84, collision: true, ctForce: 54, ctLength: 3.5, ctHeight: 2.67, ctAtEnd: true,
  He: 13, Df: 3.25, Tt: 18, frontBatter: 0, backBatter: 0.2, backslope: 0,
  B: 120, A: 33, D: 15, shearKey: true, keyDepth: 12, keyWidth: 18, keyFromHeel: 42, toeFillIgnored: 1,
  stemBars: { bar: 5, spacing: 6 }, heelBars: { bar: 6, spacing: 6 }, toeBars: { bar: 5, spacing: 6 }, keyBars: { bar: 4, spacing: 6 },
  coverStem: 2, coverHeel: 2, coverToe: 3, coverKey: 3, exposureStem: 2, exposureFooting: 2,
  factors: { ...DEFAULT_FACTORS, ExtIIa: { dc: 0.9, ev: 1, lsv: 0, lsh: 0, eh: 0, ct: 1 }, ExtIIb: { dc: 1.25, ev: 1.35, lsv: 0, lsh: 0, eh: 0, ct: 1 } },
};
const r = designCipWall(example);
/** Within the example's rounding (1%, or 0.03 for small values). */
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(0.03, 0.01 * Math.abs(b)));

describe("CIP wall: a DOT worked example", () => {
  it("loads, with the barrier, collision and surcharge beyond the edge of traffic", () => {
    const { vertical: v, horizontal: h } = r.loads;
    near(v.DC2.force, 3.38);
    near(v.DC5.force, 0.49);
    near(v.DC5.arm, 3.32);
    near(v.EV1.moment, 77.79);
    near(v.EHV.force, 1.83);
    near(v.LSV.force, 0.98);
    near(v.LSV.arm, 8.13);
    near(h.EHH.force, 4.39);
    near(h.LSH.force, 1.17);
    near(h.CT.force, 2.61);
    near(h.CT.arm, 18.92);
  });

  it("load groups", () => {
    const expected = { StrIa: [19.86, 128.95, 8.63, 52.33], StrIb: [27.78, 179.27, 8.63, 52.33], StrIV: [27.57, 171.34, 6.59, 35.69], ExtIIa: [17.12, 101.5, 2.61, 49.38], ExtIIb: [23.32, 137.87, 2.61, 49.38], SerI: [20.53, 130.18, 5.56, 33.3] };
    for (const [combo, [V, MV, H, MH]] of Object.entries(expected)) {
      const g = r.groups[combo as keyof typeof expected];
      near(g.V, V);
      near(g.MV, MV);
      near(g.H, H);
      near(g.MH, MH);
    }
  });

  it("eccentricity and bearing", () => {
    const check = (id: string) => r.checks.find((c) => c.id === id)!.demand;
    near(check("ecc-StrIa"), 1.14);
    near(check("ecc-ExtIIa"), 1.96);
    near(check("brg-StrIb"), 3.04);
    near(check("brg-StrIV"), 2.8);
    near(check("brg-ExtIIb"), 3.08);
  });

  it("sliding needs the key; with it, the inert block and resistance match", () => {
    const k = r.stability.key;
    expect(r.stability.keyNeeded).toBe(true);
    near(k.c, 2.36);
    near(k.y1, 2.25);
    near(k.y2, 4.61);
    near(k.Rep, 8.0);
    near(k.StrIa.RR, 11.04);
    near(k.ExtIIa.RR, 10.07);
    // The base pressure acts over B − 2e, so the two parts carry the vertical load, no more.
    near(k.StrIa.R1 + k.StrIa.R2, r.groups.StrIa.V);
  });

  it("stem, heel, toe and key", () => {
    near(r.stem.flex.MR, 51.01);
    near(r.stem.flex.Mcr, 40.11);
    near(r.stem.flex.sMax, 10.45);
    near(r.stem.shear.Nu, -5.19);
    near(r.heel.Mu, 44.08);
    near(r.heel.flex.MR, 47.74);
    near(r.heel.VR, 17.46);
    near(r.toe.Mu, 11.65);
    near(r.toe.Ms, 8.21);
    near(r.toe.flex.MR, 31.48);
    near(r.keyDesign!.flex.MR, 26.08);
    expect(r.ok).toBe(true);
  });

  it("checks the stem under the collision too, which governs it here", () => {
    // The example designs the stem for Strength Ib (42.23 kip·ft/ft) and leaves the extreme event
    // to the designer; with CT at the base of the stem it's 49.1, still within 51.0.
    expect(r.stem.Mu).toBeGreaterThan(42.23 + 5);
    expect(r.checks.find((c) => c.id === "stem-flexure")!.ok).toBe(true);
  });

  it("with AASHTO's Extreme Event II factors (earth pressure and surcharge on), sliding and eccentricity under collision are harder", () => {
    const aashto = designCipWall({ ...example, factors: DEFAULT_FACTORS });
    expect(aashto.groups.ExtIIa.H).toBeGreaterThan(r.groups.ExtIIa.H);
    expect(aashto.checks.find((c) => c.id === "ecc-ExtIIa")!.demand).toBeGreaterThan(1.96);
  });
});
