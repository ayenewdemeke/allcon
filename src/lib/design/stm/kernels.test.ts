import { describe, expect, it } from "vitest";
import { confinementFactor, crackGrid, efficiency, nodeFace, rcTie } from "./aashto";
import { anchorageCheck, development, type DevelopmentInput } from "./anchorage";
import { barLayout, hookDimensions, minimumCover } from "./detailing";
import { diagonalCrackScreen, flexuralCrackSpacing, skinReinforcement } from "./serviceability";

// Hand solutions for the AASHTO LRFD 10th Edition kernels, ported from the Python release's
// test_aashto.py and test_design_completion.py.

describe("strut-and-tie strength (5.8.2)", () => {
  it("ties and node faces", () => {
    const tie = rcTie(100, 4, 60);
    expect(tie.capacity).toBeCloseTo(216);
    expect(tie.requiredArea).toBeCloseTo(100 / 54);
    expect(efficiency(4, "CCC", "bearing", true)).toBe(0.85);
    expect(efficiency(4, "CCT", "back", true)).toBe(0.7);
    expect(efficiency(4, "CTT", "bearing", true)).toBeCloseTo(0.65);
    expect(efficiency(6, "CCC", "interface", true)).toBeCloseTo(0.55);
    expect(efficiency(10, "CCC", "interface", true)).toBe(0.45);
    expect(efficiency(4, "CCC", "bearing", false)).toBe(0.45);
    expect(nodeFace(100, 100, 4, "CCC", "bearing", true).capacity).toBeCloseTo(0.7 * 0.85 * 4 * 100);
    expect(() => nodeFace(100, 100, 11, "CCC", "bearing", true)).toThrow();
  });

  it("confinement factor m = √(A2/A1) ≤ 2 (Eq. 5.8.2.5.3a-1)", () => {
    expect(confinementFactor(null)).toBe(1);
    expect(confinementFactor({ A1: 100, A2: 225, basis: "test" })).toBeCloseTo(1.5);
    expect(confinementFactor({ A1: 100, A2: 900, basis: "test" })).toBe(2);
    expect(nodeFace(100, 100, 6, "CCT", "bearing", true, { A1: 100, A2: 225, basis: "test" }).capacity).toBeCloseTo(1.5 * 0.7 * 0.7 * 6 * 100);
    expect(() => confinementFactor({ A1: 100, A2: 90, basis: "x" })).toThrow();
    expect(() => confinementFactor({ A1: 100, A2: 200, basis: " " })).toThrow();
  });

  it("crack-control grid (5.8.2.6)", () => {
    expect(crackGrid(24, 60, 0.72, 10, 0.72, 10).ok).toBe(true);
    expect(crackGrid(24, 60, 0.4, 10, 0.72, 10).ok).toBe(false);
    expect(crackGrid(24, 40, 0.72, 10, 0.72, 11).ok).toBe(false); // over d/4 = 10 in
  });
});

describe("development (5.10.8.2)", () => {
  const base: DevelopmentInput = { barSize: 8, fy: 60, fc: 4, clearCover: 2.5, clearSpacing: 6, horizontal: true, concreteBelow: 12, coating: "uncoated" };

  it("straight bars: hand solution and modifiers", () => {
    const r = development(base);
    // cb = 3, no transverse bars: λrc = 1/3.
    expect(r.required).toBeCloseTo((0.17 * (60 / (1.97 * Math.SQRT2)) ** 2) / 3);
    expect(r.confinement).toBeCloseTo(1 / 3);
    const coated = development({ ...base, concreteBelow: 13, coating: "epoxy", clearCover: 2 });
    expect(coated.castCoat).toBe(1.7);
    expect(coated.required).toBeGreaterThan(r.required);
    expect(development({ ...base, barSize: 3, fy: 40, concreteBelow: 0, clearCover: 4, clearSpacing: 10 }).required).toBe(12);
    expect(development({ ...base, transverseArea: 20, transverseSpacing: 1, modularRatio: 8 }).confinement).toBe(0.3);
  });

  it("hooks and heads", () => {
    const hook = development({ ...base, kind: "hook" });
    // #8: inside 6 in, R = 3.5 in; Fh = 1(3.5)(0.65)(4) = 9.1 kip.
    expect(hook.required).toBeCloseTo(Math.max(8, (0.17 * ((60 - 9.1 / 0.79) / (1.97 * Math.SQRT2)) ** 2) / 3 + 4));
    const head = development({ ...base, kind: "headed", headNetArea: 3.16, headClearCover: 2, headSpacing: 3, astmA970ClassHA: true });
    expect(head.required).toBeCloseTo(Math.max(8, (0.17 * ((60 - (0.5 * 0.65 * 4 * 3.16) / 0.79) / (1.97 * Math.SQRT2)) ** 2) / 3));
    expect(() => development({ ...base, kind: "headed", headNetArea: 3.15, headClearCover: 2, headSpacing: 3, astmA970ClassHA: true })).toThrow();
    expect(() => development({ ...base, kind: "hook", discontinuousEnd: true, sideCover: 2, topBottomCover: 2 })).toThrow();
    expect(development({ ...base, kind: "hook", discontinuousEnd: true, sideCover: 2, topBottomCover: 2, transverseArea: 0.22, transverseSpacing: 3, modularRatio: 8 }).mandatoryTies).toBe(true);
    expect(anchorageCheck(30, 29).ok).toBe(false);
    expect(anchorageCheck(30, 30).ok).toBe(true);
  });
});

describe("detailing (5.10)", () => {
  it("bend table, cover and layout", () => {
    expect(hookDimensions(5, 90).inside).toBeCloseTo(6 * 0.625);
    expect(hookDimensions(5, 90, "uncoated", "transverse").inside).toBeCloseTo(4 * 0.625);
    expect(hookDimensions(6, 90, "uncoated", "transverse").inside).toBeCloseTo(6 * 0.75);
    expect(hookDimensions(8, 90, "galvanized").inside).toBe(8);
    expect(hookDimensions(10, 90).inside).toBeCloseTo(8 * 1.27);
    expect(minimumCover("deicing_salts", "A", 0.45, 8).required).toBe(2.5);
    expect(minimumCover("deicing_salts", "A", 0.4, 8).required).toBe(2);
    expect(minimumCover("cast_against_earth", "A", 0.5, 8).required).toBeCloseTo(3.6);
    const args = { barSize: 8, count: 4, layers: 1, width: 24, depth: 30, cover: 3, layerClear: 1.5, aggregate: 0.75, requiredCover: 2.5 };
    const good = barLayout(args);
    expect(good.ok).toBe(true);
    expect(good.area).toBeCloseTo(3.16);
    expect(barLayout({ ...args, count: 12 }).ok).toBe(false);
    expect(barLayout({ ...args, layers: 2, layerClear: 0.5 }).ok).toBe(false);
  });
});

describe("service (5.6.7, C5.8.2.2)", () => {
  it("crack spacing is never clipped; diagonal cracking bounds; skin bars", () => {
    const r = flexuralCrackSpacing(20, 60, 3, 60, 10, 2);
    expect(r.allowable).toBeCloseTo((700 * 0.75) / ((1 + 3 / (0.7 * 57)) * 20) - 6);
    expect(r.ok).toBe(true);
    expect(flexuralCrackSpacing(40, 60, 3, 60, 5, 2).ok).toBe(false);
    expect(diagonalCrackScreen(50, 60, 60, 24, 4).Vcr).toBeCloseTo(288);
    expect(diagonalCrackScreen(50, 1, 60, 24, 4).coefficient).toBeCloseTo(0.158);
    expect(diagonalCrackScreen(50, 200, 60, 24, 4).coefficient).toBeCloseTo(0.0632);
    expect(skinReinforcement(60, 8, 1, 8).required).toBeCloseTo(0.9);
    expect(skinReinforcement(60, 8, 0.8, 8).ok).toBe(false);
    expect(skinReinforcement(60, 8, 2, 11).ok).toBe(false);
  });
});
