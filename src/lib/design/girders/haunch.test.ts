import { describe, expect, it } from "vitest";
import { designHaunch, HAUNCH_DEFAULTS, profile } from "./haunch";

// Validation against a state DOT's worked examples: a bulb tee span on a crest vertical curve and a
// horizontal curve (Case 1), and adjacent box beams with shims taking the over-camber (Case 2). The
// average haunch here is a parabola's (1/3 the ends, 2/3 midspan); the examples weight it as their
// agency specifies.

const near = (a: number, b: number, tol = 2e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe("haunch: a bulb tee on vertical and horizontal curves", () => {
  const r = designHaunch(HAUNCH_DEFAULTS);
  it("profile on the vertical curve", () => {
    near(r.e1, 5271.5);
    near(r.e2, 5272);
    near(r.vertical, 6);
    near(profile(HAUNCH_DEFAULTS, 300), 5264); // the curve's start
  });
  it("chorded girder on the horizontal curve: middle ordinate and its effect", () => {
    near(r.middleOrdinate, 0.9824, 3e-3); // the example's approximation; exactly R (1 − cos(L/2R))
    near(r.chord, -0.7073, 3e-3);
    near(r.deckEffect, 5.2927);
  });
  it("haunches at the supports and midspan", () => {
    near(r.crossEffect, 1.29);
    near(r.D1edge, 1.71);
    near(r.D2, 6.3677);
  });
  it("tolerances: over-camber and under-camber", () => {
    near(r.over, 1);
    near(r.under, -1.715);
    near(r.D2over, 4.0777);
    near(r.D2under, 8.0827);
    near(r.residual, 0.132);
    expect(r.ok).toBe(true);
  });
  it("the average haunch for dead load of a parabolic haunch", () => {
    near(r.avg, 3 / 3 + (2 * r.D2) / 3);
  });
});

describe("haunch: adjacent box beams, shims taking the over-camber", () => {
  const r = designHaunch({ ...HAUNCH_DEFAULTS, D1: 8, slopedGirders: true, gradeIn: 0, gradeOut: 0, radius: 0, camber: 4.628, deflection: -1.677, deflectionUnder: -2.064, assumedAverage: 6.6, minMidspan: 5, overPct: 50, underPct: 50, shims: true });
  it("deck thickness at midspan, the shims and the residual camber", () => {
    near(r.D2, 5.049);
    near(r.shim, 2.314);
    near(r.D2under, 7.363);
    near(r.residual, 0.25);
    expect(r.checks.some((c) => c.id === "over")).toBe(false);
    expect(r.ok).toBe(true);
  });
});
