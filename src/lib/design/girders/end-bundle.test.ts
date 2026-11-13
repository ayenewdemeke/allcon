import { describe, expect, it } from "vitest";
import { girderInputs } from "../kinds";
import { CDOT_END_BUNDLE, designGirder, splittingAs, zoneAv, zoneCallout } from "./prestressed";

// CDOT's bundled end detail (B-618-CBT1): 2-#4 and a D20 wire bundled in each set, at 3 in for 6 spaces.

describe("CDOT's bundled end stirrups", () => {
  const bundle = { length: 0.75, bar: 4, legs: 2, spacing: 3, bundle: CDOT_END_BUNDLE };

  it("each set's area: 2 legs × (2 #4 + D20) = 1.20 in²; called out as CDOT does", () => {
    expect(zoneAv(bundle)).toBeCloseTo(2 * (2 * 0.2 + 0.2), 12);
    expect(zoneAv({ bar: 6, legs: 2 })).toBeCloseTo(0.88, 12);
    expect(zoneCallout(bundle)).toBe('2-#4 + D20 @ 3"');
  });

  it("counts in the splitting resistance within h/4: more than #6 @ 2½ in", () => {
    const h4 = 13.5; // a CBT54
    const asBundle = splittingAs([{ ...bundle, length: 18 }, { length: 44, bar: 4, legs: 2, spacing: 4 }], h4);
    expect(asBundle).toBeCloseTo((1.2 * 13.5) / 3, 9);
    const asSix = splittingAs([{ length: 29, bar: 6, legs: 2, spacing: 2.5 }, { length: 44, bar: 4, legs: 2, spacing: 4 }], h4);
    expect(asBundle).toBeGreaterThan(asSix);
  });

  it("in a design: the splitting check and the shear take the bundle's area", () => {
    const six = girderInputs({ shape: "cbt-54", stirrups: [{ length: 1.6667, bar: 6, legs: 2, spacing: 2.5 }, { length: 3.6667, bar: 4, legs: 2, spacing: 4 }, { length: 10, bar: 4, legs: 2, spacing: 6 }, { length: 0, bar: 4, legs: 2, spacing: 12 }] });
    const cdot = { ...six, stirrups: [{ length: 0.75, bar: 4, legs: 2, spacing: 3, bundle: CDOT_END_BUNDLE }, ...six.stirrups.slice(1)] };
    const a = designGirder(six).interior;
    const b = designGirder(cdot).interior;
    expect(b.splitting.As).toBeGreaterThan(a.splitting.As);
    expect(b.checks.find((c) => c.id === "splitting")!.ok).toBe(true);
  });
});
