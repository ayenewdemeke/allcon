import { describe, expect, it } from "vitest";
import { nodeLpSolver } from "./lp-node";
import { capRegions, sectionalDesign } from "./sectional";
import { designStm, STM_DEFAULTS } from "./strut-tie";
import { buildTemplate, HAMMERHEAD_DEFAULTS, MULTICOLUMN_DEFAULTS, type StmTemplate } from "./templates";

// Where a cap may be designed by the sectional method (AASHTO 5.8.2.1, 5.5.1.2.1), and that design
// (5.6.3, 5.7.3) checked by hand.

const longArms: StmTemplate = { ...HAMMERHEAD_DEFAULTS, length: 70, depth: 6, tipDepth: 4, columns: [35], bearings: [{ x: 4, P: 300 }, { x: 15, P: 300 }, { x: 55, P: 300 }, { x: 66, P: 300 }] };

describe("strut-and-tie or sectional", () => {
  it("classes each arm or span by its nearest load to a column face, over the depth", () => {
    // Default hammerhead: the girder 4 ft from the 17 ft face is 13 ft out... the one at 13 ft is 4 ft from it: 4/7 = 0.57h, a D-Region.
    const h = capRegions(HAMMERHEAD_DEFAULTS);
    expect(h.map((g) => g.kind)).toEqual(["D", "D"]);
    expect(h[0].ratio).toBeCloseTo(4 / 7, 6);
    // Long arms: 32 - 15 = 17 ft from the face, 6 ft deep: 2.83h, B-Regions.
    const l = capRegions(longArms);
    expect(l.map((g) => g.kind)).toEqual(["B", "B"]);
    expect(l[0].ratio).toBeCloseTo(17 / 6, 6);
    // A bent: overhangs and spans.
    expect(capRegions(MULTICOLUMN_DEFAULTS).map((g) => g.label)).toEqual(["Left overhang", "Span 1", "Span 2", "Right overhang"]);
  });

  it("flexure at the face by hand (5.6.3.2), φ by the net tensile strain (5.5.4.2)", async () => {
    const m = buildTemplate(longArms, STM_DEFAULTS);
    const r = await designStm(m, nodeLpSolver);
    const s = sectionalDesign(m, r);
    expect(s.allB).toBe(true);
    const face = s.sections.find((q) => q.region === "Left arm" && q.label === "at the column's face")!;
    expect(face.Mu).toBeCloseTo(300 * (32 - 4) + 300 * (32 - 15), 6);
    const fc = STM_DEFAULTS.fc;
    const As = 26 * 1.56;
    const b1 = Math.max(0.65, Math.min(0.85, 0.85 - 0.05 * (fc - 4)));
    const c = (As * 60) / (0.85 * fc * b1 * 72);
    const ds = 72 - 6;
    expect(face.c).toBeCloseTo(c, 6);
    expect(face.Mn).toBeCloseTo((As * 60 * (ds - (b1 * c) / 2)) / 12, 6);
    expect(face.phiF).toBe(0.9);
    const flex = s.checks.find((x) => x.id === "sec-left-arm-flexure")!;
    expect(flex.ok).toBe(false); // 13,500 kip-ft on 26 #11
  });

  it("shear by the General Procedure (5.7.3.4.2) at dv from the face", async () => {
    const m = buildTemplate(longArms, STM_DEFAULTS);
    const r = await designStm(m, nodeLpSolver);
    const v = sectionalDesign(m, r).sections.find((q) => q.region === "Left arm" && q.shear)!;
    expect(v.Vu).toBeCloseTo(600, 6);
    const es = Math.min(0.006, ((Math.max(v.Mu * 12, v.Vu * v.dv) / v.dv + v.Vu) / (29000 * v.As)));
    expect(v.epsS).toBeCloseTo(es, 9);
    expect(v.beta).toBeCloseTo(4.8 / (1 + 750 * es), 9);
    expect(v.theta).toBeCloseTo(29 + 3500 * es, 9);
    expect(v.Vc).toBeCloseTo(0.0316 * v.beta * Math.sqrt(STM_DEFAULTS.fc) * 72 * v.dv, 6);
  });

  it("a bent: continuous over pinned columns; reactions balance the loads", async () => {
    const t = { ...MULTICOLUMN_DEFAULTS, depth: 2.5, tipDepth: 2.5, columns: [4, 28, 52], bearings: [16, 40].map((x) => ({ x, P: 200 })) };
    const m = buildTemplate(t, STM_DEFAULTS);
    const r = await designStm(m, nodeLpSolver);
    const s = sectionalDesign(m, r);
    // Spans of 24 ft with loads 12 ft from the faces... 10.25 ft from the faces over 2.5 ft: B-Regions.
    expect(s.regions.filter((g) => g.label.startsWith("Span")).every((g) => g.kind === "B")).toBe(true);
    // Symmetric: the midspan sections' moments are equal and sagging.
    const mids = s.sections.filter((q) => q.label.startsWith("at the load"));
    expect(mids.length).toBe(2);
    expect(mids[0].Mu).toBeCloseTo(mids[1].Mu, 3);
    expect(mids[0].negative).toBe(false);
  });
});
