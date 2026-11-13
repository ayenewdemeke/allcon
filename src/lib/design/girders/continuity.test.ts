import { describe, expect, it } from "vitest";
import { BARS } from "../walls/cip";
import { designGirder, GIRDER_DEFAULTS, type GirderInputs } from "./prestressed";

// Precast girders made continuous (5.12.3.3): the continuous-beam effects, the negative moment
// section, the restraint moments and the joint, checked by hand against closed forms.

// Supports at the bearings (no pier offset), for the closed forms.
const two: GirderInputs = { ...GIRDER_DEFAULTS, pierBearingOffset: 0, extraSpans: [{ L: 120, strands: null, harped: null }] };
const near = (a: number, b: number, rel = 1e-3, abs = 1e-6) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(rel * Math.abs(b) + abs);

describe("two equal 120 ft spans", () => {
  const d = designGirder(two);
  const g = d.spans[0].interior;
  const pier = g.stations.find((s) => s.pier)!;

  it("is continuous, with one pier, and the spans mirror each other", () => {
    expect(d.continuous).toBe(true);
    expect(d.piers).toHaveLength(1);
    const a = d.spans[0].interior.stations.find((s) => Math.abs(s.x - 36) < 1e-9)!;
    const b = d.spans[1].interior.stations.find((s) => Math.abs(s.x - 84) < 1e-9)!;
    near(a.Mu, b.Mu, 1e-6);
    near(a.negative!.Mu, b.negative!.Mu, 1e-6);
  });

  it("barriers and overlay act on the continuous beam: −wL²/8 at the pier", () => {
    near(pier.negative!.Mdc2, (-g.loads.wDC2 * 120 ** 2) / 8);
    near(pier.negative!.Mdw, (-g.loads.wDW * 120 ** 2) / 8);
    // The girder and the deck stay on simple spans: nothing at the pier.
    expect(pier.Mg).toBe(0);
    expect(pier.Mdeck).toBe(0);
  });

  it("live load at the pier: 90% of two trucks and the lane load, by hand (3.6.1.3.1)", () => {
    // Influence of the pier moment for a load at a in either span: −a(L² − a²)/(4L²).
    const L = 120;
    const il = (X: number) => {
      const a = X <= L ? X : 2 * L - X;
      return X < 0 || X > 2 * L ? 0 : (-a * (L * L - a * a)) / (4 * L * L);
    };
    const truckAt = (p: number) => il(p) * 8 + il(p + 14) * 32 + il(p + 28) * 32; // first axle at p, heading +X
    let best = 0;
    for (let p = -28; p <= 2 * L; p += 0.25) for (let q = p + 78; q <= 2 * L; q += 0.25) best = Math.min(best, truckAt(p) + truckAt(q));
    const lane = (-0.64 * L * L) / 8;
    const expected = 0.9 * (best * 1.33 + lane);
    near(pier.negative!.Mll / pier.negative!.df, expected, 2e-3);
    expect(pier.negative!.governs).toBe("90% of two trucks with the lane (3.6.1.3.1)");
  });

  it("the section over the pier: deck bars yielding, the girder's bottom flange in compression", () => {
    const n = g.negativeSection!;
    const pb = GIRDER_DEFAULTS.pierBars;
    const top = BARS[pb.topBar];
    const bot = BARS[pb.botBar];
    const As1 = (top.area * 96) / pb.topSpacing;
    const As2 = (bot.area * 96) / pb.botSpacing;
    // BT-72 bottom flange, 26 in wide: a = T / (0.85 f′c b)
    const a = ((As1 + As2) * 60) / (0.85 * 8.5 * 26);
    const y1 = 80 + 0.5 - 2.5 - top.dia / 2;
    const y2 = 72 + 1 + bot.dia / 2;
    const Mn = (As1 * 60 * (y1 - a / 2) + As2 * 60 * (y2 - a / 2)) / 12;
    near(n.Mn, Mn, 0.01);
    expect(n.phi).toBe(0.9);
  });

  it("restraint moments: the differential shrinkage's uniform curvature, restrained: −1.5·EIκ at the pier, relaxed by creep", () => {
    const r = g.restraintLoads!;
    const EIk = (r.Fsh * r.ed) / 12;
    near(d.restraint!.interior.shrinkage[1], -1.5 * EIk * r.relax, 1e-6);
    // (1 − e^−φ)/φ
    near(r.relax, (1 - Math.exp(-r.phi)) / r.phi, 1e-12);
  });

  it("restraint from creep: the prestress alone cambers the girders up, giving a positive moment at the pier", () => {
    // Continuity made later than the deck: the deck's own creep before then no longer counts, the
    // prestress's still does; with no deck shrinkage left either, what remains is positive.
    const late = designGirder({ ...two, harped: { ...two.harped, count: 0 }, strands: [{ y: 2, count: 16 }, { y: 4, count: 16 }, { y: 6, count: 8 }], tContinuity: 400 });
    const lr = late.spans[0].interior.restraintLoads!;
    expect(lr.dPsiG).toBeGreaterThan(0);
    // The prestress (hogging) outweighs the girder's weight: the free rotation is upward (negative EIθ).
    expect(late.restraint!.interior.creep[1]).toBeGreaterThan(0);
  });

  it("restraint moments can be limited to positive ones, or left out", () => {
    const none = designGirder({ ...two, restraintMoments: "none" });
    expect(none.restraint!.interior.Mr[1]).toBe(0);
    const pos = designGirder({ ...two, restraintMoments: "positive" });
    expect(pos.restraint!.interior.Mr[1]).toBeGreaterThanOrEqual(0);
  });

  it("a joint in compression under the superimposed loads and restraint is fully effective", () => {
    const p = d.piers[0].interior;
    near(p.Mfe, p.Mdc2 + p.Mdw + p.Mr + 0.5 * p.MllPos, 1e-9);
    expect(p.effective).toBe(p.Mfe <= 1e-9);
  });

  it("the abutment end keeps 5.7.3.5-2; the pier end doesn't", () => {
    const ids0 = d.spans[0].interior.checks.map((c) => c.id);
    expect(ids0).toContain("long-brg");
    expect(d.spans[0].interior.checks.find((c) => c.id === "long-brg")!.note).toContain("left");
    expect(d.spans[1].interior.checks.find((c) => c.id === "long-brg")!.note).toContain("right");
  });
});

describe("three spans, 100–130–100 ft", () => {
  const d = designGirder({ ...GIRDER_DEFAULTS, L: 100, extraSpans: [{ L: 130, strands: null, harped: null }, { L: 100, strands: null, harped: null }] });
  it("has two piers, a symmetric result, and a middle span whose ends are both continuous", () => {
    expect(d.piers).toHaveLength(2);
    near(d.restraint!.interior.Mr[1], d.restraint!.interior.Mr[2], 1e-6);
    const mid = d.spans[1].interior;
    expect(mid.checks.some((c) => c.id === "long-brg")).toBe(false);
    expect(mid.stations.filter((s) => s.pier)).toHaveLength(2);
  });
  it("negative moment distribution factors use the average of the two spans at each pier", () => {
    const g = d.spans[0].interior;
    expect(g.dfNeg!.right.Kg).toBeCloseTo(g.df.Kg, 6);
    // L = (100 + 130)/2 = 115 ft gives a smaller factor than the 100 ft span's own.
    expect(g.dfNeg!.right.moment).toBeLessThan(g.df.moment);
  });
});

describe("the pier's bearing offset", () => {
  it("spans the continuous beam to the pier's centerline: with the bearings 2.708 ft either side, as PGSuper", () => {
    // Two 120 ft girders, bearings 0.8255 m off the pier: −w·La²/8 with La = 120 + 2.708 ft, read at the bearing.
    const off = 0.8255 / 0.3048;
    const d = designGirder({ ...two, pierBearingOffset: off });
    const g = d.spans[0].interior;
    const s = g.stations.find((st) => st.pier && st.x > 1)!;
    const La = 120 + off;
    const w = g.loads.wDC2;
    // Moment at x = 120 on a span La with its support moment −w·La²/8.
    near(s.negative!.Mdc2, (w * 120 * (La - 120)) / 2 + ((-w * La * La) / 8) * (120 / La), 1e-6);
  });
});

describe("a single span", () => {
  it("is unchanged: no piers, no negative moment", () => {
    const d = designGirder(GIRDER_DEFAULTS);
    expect(d.continuous).toBe(false);
    expect(d.piers).toHaveLength(0);
    expect(d.interior.stations.every((s) => !s.negative)).toBe(true);
  });
});
