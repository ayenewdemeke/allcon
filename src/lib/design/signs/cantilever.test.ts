import { describe, expect, it } from "vitest";
import { designSign, Kz, roundCd, SIGN_DEFAULTS } from "./cantilever";

// Validation against a state DOT's worked example (a cantilever sign's drilled shaft, AASHTO LTS
// with AASHTO LRFD), whose shaft moment resistance came from L-Pile.

const near = (a: number, b: number, tol = 2e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
const r = designSign(SIGN_DEFAULTS);

describe("cantilever sign: a DOT worked example", () => {
  it("dead loads of the pole, arm, panel and its supports", () => {
    near(r.dead.pole, 0.6091);
    near(r.dead.arm, 0.2546);
    near(r.dead.sign, 0.1531);
    near(r.dead.misc, 0.0766);
  });
  it("wind (LTS 3.8): Kz, drag coefficients and pressures", () => {
    near(Kz(20.5), 0.9021);
    near(Kz(10), Kz(16)); // z at least 16 ft
    near(r.wind.CvVd, 140);
    expect(roundCd(140)).toBe(0.45);
    expect(roundCd(30)).toBe(1.1);
    near(r.wind.qMember, 14.5005);
    near(r.wind.qSign, 38.3457);
    near(r.wind.poleArea, 25.6667);
    near(r.wind.armArea, 10.8333);
    near(r.wind.Wpole, 0.3722);
    near(r.wind.Warm, 0.1571);
    near(r.wind.Wsign, 1.8406);
  });
  it("moments at the top of the shaft (the pole's and arm's wind at their areas' centroids)", () => {
    // The example put the pole's wind at mid-height (45.05 kip·ft) and the arm's nearer the pole (20.92).
    near(r.wind.Mx, 44.9, 0.005);
    near(r.wind.T, 21.41, 0.005);
  });
  it("axial resistance: tip and side", () => {
    near(r.shaft.Rp, 50.8938);
    near(r.shaft.Rs, 23.3263);
    near(r.shaft.Pu, 15.1504);
  });
  it("moment resistance agrees with L-Pile's (706.07 kip·ft at the smallest axial load)", () => {
    near(r.shaft.Mn, 706.07, 0.02);
  });
  it("shear depths, minimum ties, spacing and torsion", () => {
    near(r.shaft.Dr, 27.75);
    near(r.shaft.de, 26.8331);
    near(r.shaft.dv, 27.5004, 0.02);
    near(r.shaft.AvMin, 0.455);
    near(r.shaft.sMax, 22.0003, 0.02);
    near(r.shaft.Tcr, 2308.5428);
    expect(r.ok).toBe(true);
  });
});
