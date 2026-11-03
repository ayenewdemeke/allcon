import { describe, expect, it } from "vitest";
import { DesignError } from "../walls/cip";
import { DECK_DEFAULTS, designDeck, stripBeam } from "./deck";

// The strip analysis against textbook continuous beams, and the deck against a state DOT's worked
// example (an 8 in deck on four box girders at 11 ft, TL-4 MASH barrier), whose live load
// moments come from AASHTO Table A4-1.

const near = (a: number, b: number, tol = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

/** A uniform load as many point loads. */
const uniform = (from: number, to: number, w: number, n = 4000) => Array.from({ length: n }, (_, k) => ({ x: from + ((k + 0.5) * (to - from)) / n, P: (w * (to - from)) / n }));

describe("the strip as a continuous beam (three-moment equation)", () => {
  it("two equal spans under a uniform load: −wL²/8 over the middle support", () => {
    const M = stripBeam([0, 10, 20])(uniform(0, 20, 1));
    near(M(10), -12.5, 1e-3);
    near(M(3.75), (9 / 128) * 100, 1e-3); // the span's largest sagging moment, 9wL²/128
  });
  it("three equal spans: −wL²/10 over the interior supports, 0.08 wL² in the end spans", () => {
    const M = stripBeam([0, 10, 20, 30])(uniform(0, 30, 1));
    near(M(10), -10, 1e-3);
    near(M(4), 8, 1e-3);
  });
  it("a cantilever's moment at its support", () => {
    const M = stripBeam([2, 12])([{ x: 0, P: 3 }]);
    near(M(2), -6, 1e-9);
    near(M(7), -3, 1e-9);
  });
});

describe("deck: a DOT worked example", () => {
  const r = designDeck(DECK_DEFAULTS);
  it("live load moments agree with AASHTO Table A4-1 (S = 11 ft): +7.46 and −4.52 kip·ft/ft", () => {
    near(r.pos.MLL, 7.46, 0.02);
    near(r.neg.MLL, -4.52, 0.01);
    expect(r.geometry.lanes).toBe(3);
  });
  it("dead load moments from the strip itself, where the overhangs relieve the interior spans", () => {
    // The example's continuous-beam coefficients (0.08 and 0.10 wL²) ignore the overhangs and give
    // 14.80 and −10.09; the strip's own moments are smaller.
    expect(r.pos.Mu).toBeLessThan(14.8);
    expect(r.neg.Mu).toBeGreaterThan(-10.09);
  });
  it("flexural resistance of the bars", () => {
    near(r.bottom.MR, 17.5275);
    near(r.top.MR, 17.4137);
    near(r.bottom.Mcr, 5.8216);
  });
  it("longitudinal bars: 67% distribution (220/√7 = 83%)", () => {
    near(r.long.pct, 0.67);
    near(r.long.distRequired, 0.4154);
  });
  it("overhang, Cases 1–3", () => {
    const { case1, case2, case3 } = r.overhang;
    near(case1.Mu, 19.9156, 0.002);
    near(case1.As, 0.6835);
    near(case1.MR, 21.3276);
    near(case2.Mu, 0.7984, 0.01);
    near(case3.MDC, 1.0495, 0.002);
    near(case3.MDW, 0.0413);
    near(case3.Mu, 2.5376, 0.002);
    expect(case3.lineLoad).toBe(true);
  });
  it("passes, with the example's bars", () => {
    expect(r.ok).toBe(true);
  });
});

describe("deck: limits", () => {
  it("light bars fail; a spacing over 15 ft is refused", () => {
    const light = designDeck({ ...DECK_DEFAULTS, botBars: { bar: 4, spacing: 12 } });
    expect(light.checks.find((c) => c.id === "pos-flexure")!.ok).toBe(false);
    expect(() => designDeck({ ...DECK_DEFAULTS, S: 16 })).toThrow(DesignError);
  });
  it("two girders: the negative moment design sections are inside the girders", () => {
    const two = designDeck({ ...DECK_DEFAULTS, nGirders: 2 });
    expect([5 + 2, 16 - 2]).toContain(Math.round(two.neg.x * 10) / 10);
  });
});
