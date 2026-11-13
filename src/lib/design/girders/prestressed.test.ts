import { describe, expect, it } from "vitest";
import { designGirder, distributionFactors, GIRDER_DEFAULTS, leverRule, liveLoad, rigidSection, type GirderInputs } from "./prestressed";
import { GIRDER_SHAPES, profileProps, shapeById } from "./sections";

const near = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));

describe("girder section library", () => {
  it("every standard outline matches its published A, I and yb within 0.2%", () => {
    for (const s of GIRDER_SHAPES) {
      const p = profileProps(s.profile);
      const pub = s.published!;
      near(p.A, pub.A, 0.002);
      near(p.I, pub.I, 0.002);
      near(p.yb, pub.yb, 0.002);
    }
  });
  it("has the AASHTO, AASHTO-PCI and CDOT families", () => {
    expect(GIRDER_SHAPES.filter((s) => s.family === "AASHTO I-beam")).toHaveLength(6);
    expect(GIRDER_SHAPES.filter((s) => s.family === "AASHTO-PCI bulb-tee")).toHaveLength(3);
    expect(GIRDER_SHAPES.filter((s) => s.family === "CDOT Colorado Bulb Tee").map((s) => s.depth)).toEqual([37.5, 45, 54, 63, 72, 81, 90]);
  });
});

describe("HL-93 live load (3.6.1.2), per lane", () => {
  it("120 ft span at midspan: truck 1880, tandem 1450, lane 1152 kip·ft", () => {
    const ll = liveLoad(120, 60);
    near(ll.truckM, 1880, 1e-9);
    near(ll.tandemM, 1450, 1e-9);
    near(ll.laneM, 1152, 1e-9);
    near(ll.M, 1.33 * 1880 + 1152, 1e-9);
  });
  it("end shear of a 120 ft span: truck 32(1 + 106/120) + 8(92/120)", () => {
    const ll = liveLoad(120, 0);
    near(ll.truckV, 32 + (32 * 106) / 120 + (8 * 92) / 120, 1e-6); // the axle sits 1e-6 ft past the section
    near(ll.laneV, (0.64 * 120) / 2, 1e-9);
  });
});

// FHWA NHI-04-043, "LRFD Design Example for Prestressed Concrete Girder Superstructure Bridge"
// (2003), Design Step 5.1: AASHTO Type VI (72 in), 8 in deck, 110 ft spans, girders at 9'-8",
// 20° skew, n = 4,696 / 3,834, de = 1'-10". Its published distribution factors.
describe("distribution factors, FHWA design example (Design Step 5.1)", () => {
  const i: GirderInputs = { ...GIRDER_DEFAULTS, shape: "aashto-vi", L: 110, S: 9 + 8 / 12, nGirders: 6, overhang: 3.5, barrierWidth: 3.5 - (1 + 10 / 12), skew: 20, deckT: 8, sacrificial: 0, skewShearInterior: true, rigidMethod: true };
  const shape = shapeById("aashto-vi")!;
  const g = profileProps(shape.profile);
  const n = 4696 / 3834;
  const deckCg = shape.depth + 4; // haunch ignored, as the example does
  const interior = distributionFactors(i, g, 8, n, deckCg, false);
  const exterior = distributionFactors(i, g, 8, n, deckCg, true);

  it("Kg = 2,984,704 in⁴", () => near(interior.Kg, 2984704, 2e-4));
  it("interior moment: 0.796 (two lanes), 0.542 (one lane)", () => {
    near(interior.momentMulti, 0.796, 1.5e-3);
    near(interior.momentOne, 0.542, 1.5e-3);
    near(interior.moment, 0.796, 1.5e-3);
  });
  it("interior shear with the skew correction 1.047: 0.973", () => {
    near(interior.skewShear, 1.047, 1e-3);
    near(interior.shear, 0.973, 1.5e-3);
  });
  it("exterior moment: lever rule 0.806 governs (e·g 0.772, rigid 0.776)", () => {
    near(exterior.lever!, 0.806, 1.5e-3);
    near(exterior.e!.moment * exterior.momentMulti, 0.772, 2e-3);
    near(exterior.rigid!, 0.776, 1.5e-3);
    near(exterior.moment, 0.806, 1.5e-3);
  });
  it("exterior shear: lever rule with skew 0.845 governs (e·g 0.762)", () => {
    near(exterior.e!.shear * exterior.shearMulti * exterior.skewShear, 0.762, 2e-3);
    near(exterior.shear, 0.845, 1.5e-3);
  });
  it("rigid cross-section reactions: one lane 0.572, two 0.776, three 0.764 (with m)", () => {
    // One, two and three lanes alone.
    near(rigidSection(6, 9 + 8 / 12, 1 + 10 / 12, 1), 0.572, 2e-3);
    near(rigidSection(6, 9 + 8 / 12, 1 + 10 / 12, 3), 0.776, 2e-3); // the most of 1–3 lanes
  });
  it("lever rule by itself", () => near(leverRule(9 + 8 / 12, 1 + 10 / 12), 0.806, 1.5e-3));
});

describe("the design check", () => {
  it("passes the default BT-72 on both girders", () => {
    const d = designGirder(GIRDER_DEFAULTS);
    expect(d.interior.checks.filter((c) => !c.ok)).toEqual([]);
    expect(d.exterior.checks.filter((c) => !c.ok)).toEqual([]);
  });
  it("flags release tension, asking for bonded bars, with straight strands only", () => {
    const d = designGirder({ ...GIRDER_DEFAULTS, harped: { ...GIRDER_DEFAULTS.harped, count: 0 }, strands: [{ y: 2, count: 12 }, { y: 4, count: 12 }, { y: 6, count: 10 }] });
    const c = d.interior.checks.find((x) => x.id === "rel-tens")!;
    expect(c.ok).toBe(false);
    expect(c.note).toMatch(/bonded bars/);
  });
  it("effective prestress and losses are in the expected range for a long-span bulb-tee", () => {
    const g = designGirder(GIRDER_DEFAULTS).interior;
    const loss = (g.losses.fpj - g.losses.fpe) / g.losses.fpj;
    expect(loss).toBeGreaterThan(0.15);
    expect(loss).toBeLessThan(0.3);
  });
  it("more strands, more flexural resistance; a longer span, more moment", () => {
    const a = designGirder(GIRDER_DEFAULTS).interior;
    const b = designGirder({ ...GIRDER_DEFAULTS, strands: [...GIRDER_DEFAULTS.strands, { y: 8, count: 4 }] }).interior;
    expect(b.flexMid.Mn).toBeGreaterThan(a.flexMid.Mn);
    const c = designGirder({ ...GIRDER_DEFAULTS, L: 130 }).interior;
    expect(c.stations.at(-1)!.Mu).toBeGreaterThan(a.stations.at(-1)!.Mu);
  });
  it("works every library shape without errors", () => {
    for (const s of GIRDER_SHAPES) {
      const L = Math.min(150, s.depth * 1.7);
      const d = designGirder({ ...GIRDER_DEFAULTS, shape: s.id, L, strands: [{ y: 2, count: 8 }, { y: 4, count: 6 }], harped: { count: 2, yEnd: s.depth - 4, yHarp: 6, harpPoint: 0.4 }, custom: GIRDER_DEFAULTS.custom });
      expect(Number.isFinite(d.interior.flexMid.Mn)).toBe(true);
      expect(d.interior.stations.every((st) => Number.isFinite(st.service.botIII))).toBe(true);
    }
  });
});
