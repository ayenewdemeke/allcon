import { describe, expect, it } from "vitest";
import { BARS } from "../walls/cip";
import { changeShape, designGirder, GIRDER_DEFAULTS, splittingAs } from "./prestressed";
import { GIRDER_SHAPES } from "./sections";
import { overhangMoment } from "./stability";

// Phase 4 by hand: the fatigue truck, the Fatigue I stress, splitting and confinement, and the
// handling moments.

const near = (a: number, b: number, rel = 1e-3, abs = 1e-6) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(rel * Math.abs(b) + abs);
const d = designGirder(GIRDER_DEFAULTS);

describe("Fatigue I (5.5.3.1)", () => {
  const g = d.interior;
  const mid = g.stations.find((s) => Math.abs(s.x - 60) < 1e-9)!;
  it("the fatigue truck at midspan of a 120 ft span: 1,624 kip·ft per lane", () => {
    // 32 kip at midspan (ordinate 30 ft), the 8 kip 14 ft ahead (23 ft), the other 32 kip 30 ft behind (15 ft).
    near(mid.fatigue.Mfat / g.df.fatigue, 8 * 23 + 32 * 30 + 32 * 15);
  });
  it("one lane without the multiple presence factor", () => {
    near(g.df.fatigue, (g.df.momentOne * g.df.skewMoment) / 1.2, 1e-12);
  });
  it("half the permanent stress plus 1.75 × 1.15 × the fatigue truck's", () => {
    near(mid.fatigue.top, 0.5 * mid.service.topPerm + (1.75 * 1.15 * mid.fatigue.Mfat * 12) / g.comp.Stc, 1e-12);
    const c = g.checks.find((k) => k.id === "fatigue")!;
    expect(c.capacity).toBeCloseTo(0.4 * GIRDER_DEFAULTS.fc, 12);
  });
});

describe("anchorage zone (5.9.4.4)", () => {
  const g = d.interior;
  it("splitting: the #5 pairs at 3.5 in within h/4 = 18 in of the end, at 20 ksi", () => {
    const As = (2 * BARS[5].area * 18) / 3.5;
    near(g.splitting.As, As, 1e-9);
    near(g.splitting.Pr, 20 * As, 1e-9);
    expect(g.splitting.zone).toBe(18);
  });
  it("splitting: zones are summed by length over spacing", () => {
    near(splittingAs([{ length: 6, bar: 5, legs: 2, spacing: 3 }, { length: 100, bar: 4, legs: 2, spacing: 6 }], 18), 0.62 * 2 + 0.4 * 2, 1e-9);
  });
  it("confinement: #3 at 6 in for 1.5d = 9 ft of a BT-72", () => {
    expect(g.checks.find((c) => c.id === "conf-length")!.demand).toBeCloseTo(9, 12);
    expect(g.checks.filter((c) => c.id.startsWith("conf-")).every((c) => c.ok)).toBe(true);
  });
});

describe("handling", () => {
  it("self-weight with overhangs: wL(ℓ/8 ... ) at midspan, −wa²/2 over the supports", () => {
    const w = 1;
    const L = 100;
    const a = 10;
    near(overhangMoment(w, L, a, a, L / 2), (w * (L - 2 * a) ** 2) / 8 - (w * a * a) / 2);
    near(overhangMoment(w, L, a, a, a), (-w * a * a) / 2);
  });
  it("is checked on the default girder, and can be turned off", () => {
    expect(d.interior.checks.some((c) => c.id === "lift-fscr")).toBe(true);
    const off = designGirder({ ...GIRDER_DEFAULTS, handling: { ...GIRDER_DEFAULTS.handling, check: false } });
    expect(off.interior.checks.some((c) => c.id.startsWith("lift-") || c.id.startsWith("haul-"))).toBe(false);
  });
});

describe("every library girder", () => {
  it("runs every check with finite numbers (Phase 4 included)", () => {
    for (const s of GIRDER_SHAPES) {
      const L = Math.round((s.depth * 20) / 12 / 5) * 5;
      for (const fc of [8.5, 10.5]) {
        const d = designGirder({ ...GIRDER_DEFAULTS, shape: s.id, L, fc, strands: [{ y: 2, count: 6 }, { y: 4, count: 6 }], harped: { ...GIRDER_DEFAULTS.harped, count: 0 } });
        for (const g of [d.interior, d.exterior]) {
          for (const c of g.checks) expect(Number.isFinite(c.demand) && !Number.isNaN(c.capacity), `${s.id} ${c.id}`).toBe(true);
          expect(g.checks.some((c) => c.id === "principal"), `${s.id} principal at ${fc} ksi`).toBe(fc > 10);
          expect(g.checks.find((c) => c.id === "conf-length")!.ok, `${s.id} default confinement length`).toBe(true);
        }
      }
    }
  });
  it("the weak-axis moment of inertia: BT-72 as PCI's lateral stability examples (37,634 in⁴)", () => {
    const g = designGirder(GIRDER_DEFAULTS).interior.g;
    near(g.Iy, 37634, 1e-4);
  });
});

describe("changing the girder section", () => {
  it("keeps the harped strands' distance below the top, and fixes strands outside the girder", () => {
    // BT-72 → CBT 63: the harped ends 8 in below the top stay 8 in below it.
    const cbt = changeShape(GIRDER_DEFAULTS, "cbt-63");
    expect(cbt.harped.yEnd).toBe(55);
    expect(() => designGirder(cbt)).not.toThrow();
    // A design left with them outside its girder (64 in in a 63 in CBT) is fixed by fitting to its own section.
    const bad = { ...GIRDER_DEFAULTS, shape: "cbt-63", harped: { ...GIRDER_DEFAULTS.harped, yEnd: 64 } };
    expect(() => designGirder(bad)).toThrow(/harped strands' centroid at the girder's ends \(64\.00 in\) is outside the CBT 63, which is 63 in deep/);
    expect(changeShape(bad, "cbt-63").harped.yEnd).toBe(55);
    // Straight rows above a shallower girder come down; a span's own strands follow too.
    const two = { ...GIRDER_DEFAULTS, strands: [{ y: 2, count: 10 }, { y: 50, count: 2 }], extraSpans: [{ L: 120, strands: null, harped: { ...GIRDER_DEFAULTS.harped } }] };
    const iv = changeShape(two, "aashto-iii");
    expect(iv.strands[1].y).toBe(43);
    expect(iv.extraSpans[0].harped!.yEnd).toBe(45 - 8);
  });
});
