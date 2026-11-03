import { describe, expect, it } from "vitest";
import { BEARING_DEFAULTS, designBearing, type BearingInputs } from "./elastomeric";

// Validation against a state DOT's worked examples (elastomeric pads, AASHTO 7th edition
// provisions, which these follow): a plain leveling pad and a plain pad (Method A), and
// steel-reinforced pads by Methods A and B. The examples round as displayed; where Method A's
// deflections came from AASHTO's design-aid graph, the equation (C14.7.5.3.6-1) is used instead.

const near = (a: number, b: number, tol = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(0.0005, tol * Math.abs(b)));
const check = (r: ReturnType<typeof designBearing>, id: string) => r.checks.find((c) => c.id === id)!;

const plain: BearingInputs = { ...BEARING_DEFAULTS, pad: "plain", method: "A", byHardness: true, hardness: 60, otherStatic: 0, cyclic: 0, expansionLength: 0, thetaD: 0, thetaL: 0 };

describe("elastomeric bearing: plain leveling pad (Method A)", () => {
  const r = designBearing({ ...plain, L: 10, W: 37, hri: 0.75, DL: 136, LL: 0 });
  it("shape factor, stress, deflection and stability", () => {
    near(r.pad.S, 5.2482);
    near(r.loads.sigmaS, 0.3676);
    near(check(r, "comp-GS").capacity, 0.6823);
    near(check(r, "defl-layer").demand, 0.016, 0.02);
    near(check(r, "stab-height").capacity, 3.3333);
    expect(r.ok).toBe(true);
  });
});

describe("elastomeric bearing: plain pad with movement (Method A)", () => {
  const r = designBearing({ ...plain, L: 12, W: 25, hri: 2, DL: 40, LL: 20, alpha: 6e-6, expansionLength: 40, Tmax: 100, Tmin: -20, otherStatic: 0.336 });
  it("movement, stress, deflections, shear and stability", () => {
    near(r.movement.ds, 0.7507);
    near(r.pad.S, 2.027);
    near(check(r, "comp-GS").capacity, 0.2635);
    near(r.deflection.dL, 0.052, 0.02);
    near(check(r, "defl-layer").demand, 0.156, 0.02);
    near(check(r, "shear-hrt").demand, 1.5014);
    near(check(r, "stab-height").capacity, 4);
  });
  it("slips, as in the example, so it needs anchoring", () => {
    near(r.anchorage.dsAllow, 0.2667);
    expect(check(r, "anchor-slip").ok).toBe(false);
  });
});

describe("elastomeric bearing: steel-reinforced (Method A)", () => {
  const r = designBearing({ ...BEARING_DEFAULTS, method: "A", byHardness: true, hardness: 50, L: 12, W: 25, hri: 0.5, n: 5, DL: 102, LL: 43, alpha: 6e-6, expansionLength: 75, Tmax: 100, Tmin: -20, otherStatic: 0.28, cyclic: 0.01 });
  it("layers, shape factor and Method A's limits", () => {
    near(r.pad.hrt, 2.75);
    near(r.pad.height, 3.5);
    near(r.pad.S, 8.1081);
    near(check(r, "geo-S2n").demand, 13.1483);
    near(check(r, "comp-GS").capacity, 0.9628);
    near(r.loads.sigmaS, 0.4833);
  });
  it("live load deflection (by the equation; the example read 0.0138 in off the graph)", () => {
    near(r.deflection.dL, 0.0138, 0.06);
  });
  it("shear, stability, shims and slip", () => {
    near(r.movement.ds, 1.0676);
    near(check(r, "shear-hrt").demand, 2.1352);
    near(r.shims.service, 0.0201);
    near(r.shims.fatigue, 0.006, 0.02);
    near(r.anchorage.dsAllow, 1.4385);
    expect(r.ok).toBe(true);
  });
});

describe("elastomeric bearing: steel-reinforced (Method B)", () => {
  const ex3 = { ...BEARING_DEFAULTS, thetaD: -0.002 };
  const r = designBearing(ex3);
  it("shear modulus ±15%, shape factor and stresses", () => {
    near(r.pad.G.Gmin, 0.1275);
    near(r.pad.G.Gmax, 0.1725);
    near(r.pad.S, 8.5714);
    near(r.loads.sigmaS, 0.6667);
  });
  it("shear strains", () => {
    near(r.strains.aSt, 0.4911);
    near(r.strains.aCy, 0.363);
    near(r.strains.rCy, 0.05);
    near(r.strains.sCy, 0.0084, 0.02);
    // The example nets the 0.005 allowance against the dead load rotation (−0.002 + 0.005); AASHTO
    // 14.4.2.1 adds it to the rotation's size: 0.007, not 0.003.
    near(r.strains.thetaSt, 0.007);
    near(r.strains.rSt, (0.5 * 30 ** 2 * 0.007) / 9);
    // The example counted the 0.04 in cyclic movement in the static shear strain as well.
    near(r.strains.sSt, (1.6632 - 0.04) / 4.75);
    expect(check(r, "strain-total").ok).toBe(true);
  });
  it("live load deflection and long-term dead load deflection", () => {
    near(r.deflection.dL, 0.0299);
    near(r.deflection.dLong, 0.0547, 0.02);
  });
  it("stability: 2A > B, so σs is checked against G S / (2A − B) for a deck free to translate", () => {
    near(r.stability[0].A, 0.3845);
    near(r.stability[0].B, 0.2127);
    near(check(r, "stab").capacity, 1.9642);
    near(designBearing({ ...ex3, deckFree: false }).checks.find((c) => c.id === "stab")!.capacity, 6.3596);
  });
  it("shims and slip", () => {
    near(r.shims.service, 0.0278);
    near(r.shims.fatigue, 0.0118);
    near(r.anchorage.dsAllow, 2.1111);
  });
  it("needs no restraint system: θs/n stays under 3εa/S (the example's 'fails' reads the check backwards)", () => {
    near(r.anchorage.epsA, 0.0196, 0.02);
    near(check(r, "anchor-restraint").capacity, 0.0068, 0.02);
    expect(check(r, "anchor-restraint").ok).toBe(true);
  });
});

describe("elastomeric bearing: checks that bite", () => {
  it("checks stability both ways round when L is longer than W", () => {
    const r = designBearing({ ...BEARING_DEFAULTS, L: 24, W: 12 });
    expect(r.stability).toHaveLength(2);
  });
  it("a thin pad fails shear deformation; a tall one fails Method A stability", () => {
    expect(check(designBearing({ ...BEARING_DEFAULTS, n: 2 }), "shear-hrt").ok).toBe(false);
    expect(check(designBearing({ ...BEARING_DEFAULTS, method: "A", n: 12 }), "stab-height").ok).toBe(false);
  });
});
