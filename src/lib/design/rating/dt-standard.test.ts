import { describe, expect, it } from "vitest";
import { dtRatingInputs } from "../kinds";
import { TELLRD } from "./benchmarks";
import { DT_DEFAULTS, rateDoubleTee, type DtInputs } from "./double-tee";
import { dtRatingCalcLines } from "./double-tee-calc";
import { applyStandard, checkStandard, DT_STANDARD_1982, standardStrands } from "./dt-standard";

// The 1982 double-tee standard (Dwg. B-3): the table as transcribed, matching a bridge against it,
// and rating one built to it with the standard's prestress.

describe("the standard's table, as transcribed", () => {
  it("has every span and width", () => {
    expect(DT_STANDARD_1982).toHaveLength(45);
    expect([...new Set(DT_STANDARD_1982.map((r) => r.span))]).toEqual([36, 40, 44, 48, 52, 56, 60, 64, 66]);
  });
  it.each(DT_STANDARD_1982.map((r) => [`${r.span} ft, ${r.width} ft`, r] as const))("%s: whole strands, and forces consistent with their ratios", (_, r) => {
    // Fi / (ri f′s) is the strands' area: a whole number of 0.153 in² strands.
    const n = standardStrands(r);
    expect(Math.abs(n - Math.round(n))).toBeLessThan(0.05);
    // Ff / Fi = rf / ri.
    expect(Math.abs(r.Ff / r.Fi - r.rf / r.ri)).toBeLessThan(2e-3);
    expect(r.EMS).toBeLessThan(r.EE);
  });
});

/** A bridge built to the standard's 44 ft span, 30'-6" wide row. */
const built: DtInputs = {
  ...DT_DEFAULTS,
  bridge: { ...DT_DEFAULTS.bridge, yearBuilt: 1984 },
  span: 44,
  structureLength: 45,
  numSpans: 1,
  units: { count: 4, spacing: 91.25, flangeWidth: 91.25, depth: 37, flangeThk: 7, stemSpacing: 60, stemTop: 8, stemBot: 5, exteriorTrimmed: false, layout: null, jointGap: 0 },
  deck: { ...DT_DEFAULTS.deck, present: false },
  roadway: { railToRail: 30.5, railFaceOffset: 15, curbToCurb: 28, curbFaceOffset: 15 },
  loads: { ...DT_DEFAULTS.loads, asphalt: 0, sidewalks: [{ width: 1.25, thk: 12 }, { width: 1.25, thk: 12 }], sidewalkMountable: false, pedestrians: false, pedWidth: 0 },
};

describe("matching a bridge against the standard", () => {
  it("matches a bridge built to a row", () => {
    const c = checkStandard(built);
    expect(c.items.filter((x) => !x.ok)).toEqual([]);
    expect(c.applies).toBe(true);
    expect(c.row).toMatchObject({ span: 44, width: 30.5, Fi: 428.72 });
  });
  it("says why it doesn't apply: built before the standard", () => {
    const c = checkStandard({ ...built, bridge: { ...built.bridge, yearBuilt: 1963 } });
    expect(c.applies).toBe(false);
    expect(c.summary).toMatch(/year built 1963 \(standard: 1982 or later\)/);
  });
  it("says why it doesn't apply: a topping on a thin flange, other units", () => {
    const c = checkStandard(TELLRD);
    expect(c.applies).toBe(false);
    const misses = c.items.filter((x) => !x.ok).map((x) => x.label);
    // (Its BrR model's 6.5 in flange is within the standard's 7 in; the sketch's 2 in isn't.)
    expect(misses).toEqual(expect.arrayContaining(["Span", "Units", "Unit width", "Stem spacing", "Depth", "CIP deck or topping"]));
  });
});

describe("rating a bridge built to the standard", () => {
  const i = dtRatingInputs(JSON.parse(JSON.stringify(applyStandard(built, checkStandard(built).row!))));
  const r = rateDoubleTee(i);
  it("takes its prestress from the standard: 14 strands jacked to Fi, harped", () => {
    expect(i.prestress).toMatchObject({ mode: "known", strands: 14, harp: { end: 23.86, mid: 3.5, at: 0.4 } });
    expect(Math.abs(r.solve.Pj - 428.72) / 428.72).toBeLessThan(5e-3);
    expect(i.materials).toMatchObject({ fpu: 270, aps: 0.153, lowRelaxation: false, fc: 6, fci: 4 });
    expect(i.options.tensionLimit).toBeNull();
    expect(i.sources["prestress.strands"].kind).toBe("standard");
  });
  it("rates HS-20 at about the design load (a design for HS-20)", () => {
    const hs = r.ratings[0];
    expect(hs.govInv.inv.inv).toBeGreaterThan(0.85);
  });
  it("documents the standard in its calc package", () => {
    const text = dtRatingCalcLines(i, "Test")
      .flatMap((l) => ("text" in l ? [l.text] : "math" in l && l.ref ? [l.ref] : []))
      .join("\n");
    expect(text).toMatch(/Standard plans:- .*CDOH Double T Bridge Standard \(1982\), Dwg\. B-3/);
    expect(text).toMatch(/harped from 23\.86 in at the ends/);
    expect(text).not.toMatch(/back-calculate the prestress/);
  });
  it("tells a back-calculated bridge why the standard doesn't apply", () => {
    const text = dtRatingCalcLines({ ...TELLRD, prestress: { mode: "back-calculate", strands: 0 } }, "Test")
      .flatMap((l) => ("text" in l ? [l.text] : []))
      .join("\n");
    expect(text).toMatch(/The CDOH Double T Bridge Standard \(1982\) does not apply: /);
  });
});
