import { describe, expect, it } from "vitest";
import { TELLRD } from "./benchmarks";
import { compareBrrDf } from "./brr";
import { rateDoubleTee } from "./double-tee";

// The BrR benchmark (benchmarks.ts): TELLRD-PINE ST with its BrR model's values, against BrR's rating
// factors for girder B (interior) and girder E (exterior, curb side).

// BrR's rating factors: [girder B, girder E]. Legal and permit at operating; HS-20 axle load at both.
const BRR: [string, "inv" | "opr", number, number][] = [
  ["HS-20", "inv", 0.812, 0.924],
  ["HS-20", "opr", 1.356, 1.543],
  ["CO Type 3", "opr", 1.939, 1.734],
  ["CO Type 3-2", "opr", 1.864, 1.666],
  ["CO Type 3S2", "opr", 1.94, 1.735],
  ["CO Permit", "opr", 1.161, 1.038],
  ["EV2", "opr", 1.962, 1.754],
  ["EV3", "opr", 1.264, 1.13],
];

describe("BrR benchmark: TELLRD-PINE ST", () => {
  const r = rateDoubleTee(TELLRD);
  it("has BrR's prestress, strand centroid and distribution factors", () => {
    expect(r.solve.Pj).toBeCloseTo(404, 6);
    expect(r.solve.cg).toBe(7.5);
    for (const d of compareBrrDf(TELLRD, r)) expect(Math.abs(d.diff), d.label).toBeLessThan(0.005);
  });
  it("has BrR's dead load moments (girder 208.9, deck 116.7, sidewalk 19.6, rail 16.9, asphalt 45.1 kip·ft)", () => {
    const g = r.girders[1].dlNow;
    const M = (w: number) => (w * 45.5 ** 2) / 8;
    expect(M(g.self)).toBeCloseTo(208.9, 0);
    expect(M(g.deck)).toBeCloseTo(116.7, 0);
    expect(M(g.sidewalk)).toBeCloseTo(19.6, 0);
    expect(M(g.rail)).toBeCloseTo(16.9, 0);
    expect(M(g.asphalt)).toBeCloseTo(45.1, 0);
  });
  it.each(BRR)("rates %s %s within 0.5% of BrR, girders B and E, in flexure", (name, level, gb, ge) => {
    const v = r.ratings.find((x) => x.name === name)!;
    for (const [girder, brr] of [
      ["G2", gb],
      ["G5", ge],
    ] as const) {
      const p = v.per.find((x) => x.g === girder)!;
      const pt = level === "inv" ? p.inv : p.opr;
      const rf = level === "inv" ? p.inv.inv : p.opr.opr;
      expect(Math.abs(rf / brr - 1), `${name} ${level} ${girder}: ALLCON ${rf.toFixed(3)}, BrR ${brr}`).toBeLessThan(0.005);
      expect(pt.check).toBe("flexure");
    }
  });
});
