import { describe, expect, it } from "vitest";
import { analyzeHauling, analyzeLifting, type HaulingProblem, type LiftingProblem, type StabilitySection } from "./stability";

// PCI's worked examples (CB-02-16-E, 6.1 lifting and 6.2 hauling), with the results WSDOT's WBFL
// Stability library asserts for them (Stability/StabilityUnitTests/PCILiftingExamples.cpp and
// PCIHaulingExamples.cpp): a BT-72, 136 ft long, the harp point at 0.4L.

const BT72: StabilitySection = { A: 767, Ix: 545894, Iy: 37634, yt: 72 - 36.6, yb: 36.6, H: 72, wTop: 42, wBot: 26 };
const L = 136 * 12;
const w = (767 / 144) * 0.155 / 12; // kip/in, weight density 0.155 kcf
// Ec of the 9th and 10th editions (5.4.2.4-1, unchanged), K1 = 1, wc = 0.150 kcf.
const Ec = (fc: number) => 120000 * 0.15 ** 2 * fc ** 0.33;
const near = (a: number, b: number, tol = 0.001) => expect(Math.abs(a - b), `${a.toFixed(4)} vs ${b}`).toBeLessThanOrEqual(tol);

describe("lifting, PCI 6.1", () => {
  const base: LiftingProblem = {
    section: BT72,
    L,
    w,
    Ec: Ec(5.5),
    fr: 0.24 * Math.sqrt(5.5),
    left: 9 * 12,
    right: 9 * 12,
    sweep: 0.000520833333,
    placement: 0.25,
    camber: 2.92,
    impactUp: 0,
    impactDown: 0,
    points: [{ X: 0.4 * L, Fpe: 1232, e: 36.6 - 5 }],
  };
  const corner = (r: ReturnType<typeof analyzeLifting>, c: "topLeft" | "bottomRight", i = 0, j = 0) => r.sections[0].corners.find((k) => k.corner === c)!.byCase[i].byWind[j];

  it("6.1.1: FScr 1.844, stresses 0.113 and −3.290 ksi, FSf 1.839", () => {
    const r = analyzeLifting(base);
    near(r.summary.FScr, 1.844);
    near(corner(r, "topLeft").f, 0.113);
    near(corner(r, "bottomRight").f, -3.29);
    near(r.failure[0][0].FSf, 1.839);
  });
  it("6.1.2: 20% impact down, FScr 1.708 and FSf 1.593 for it", () => {
    const r = analyzeLifting({ ...base, impactDown: 0.2 });
    const down = 2;
    near(Math.min(...r.sections[0].corners.map((c) => c.byCase[down].byWind[0].fscr)), 1.708);
    near(r.failure[down][0].FSf, 1.593);
    near(r.failure[0][0].FSf, 1.839);
  });
  it("6.1.3: wind 2.5 psf, FScr 2.541 (left) / 1.578 (right), FSf 2.241 / 1.658", () => {
    const r = analyzeLifting({ ...base, windPressure: 2.5 / 144000 });
    const tl = r.sections[0].corners.find((k) => k.corner === "topLeft")!.byCase[0];
    near(tl.byWind[0].fscr, 2.541);
    near(tl.byWind[1].fscr, 1.578);
    near(r.failure[0][0].FSf, 2.241);
    near(r.failure[0][1].FSf, 1.658);
    near(r.failure[0][0].adjFSf, 2.541);
  });
  it("6.1.4: cables at 45°, FScr 2.398 / 1.628, FSf 2.033 / 1.568", () => {
    const r = analyzeLifting({ ...base, windPressure: 2.5 / 144000, liftAngle: Math.PI / 4 });
    const tl = r.sections[0].corners.find((k) => k.corner === "topLeft")!.byCase[0];
    near(tl.byWind[0].fscr, 2.398);
    near(tl.byWind[1].fscr, 1.628);
    near(r.failure[0][0].FSf, 2.033);
    near(r.failure[0][1].FSf, 1.568);
  });
});

describe("hauling, PCI 6.2", () => {
  const base: HaulingProblem = {
    section: BT72,
    L,
    w,
    Ec: Ec(7),
    fr: 0.24 * Math.sqrt(7),
    left: 10 * 12,
    right: 10 * 12,
    sweep: 2 * 0.000520833333,
    sweepGrowth: 1,
    placement: 1,
    camber: 2.92,
    impactUp: 0,
    impactDown: 0,
    impactUsage: "both",
    Ktheta: 40500,
    crown: 0.06,
    superelevation: 0.06,
    Hrc: 24,
    Hbg: 72,
    Wcc: 72,
    points: [{ X: 0.4 * L, Fpe: 1251.5, e: 36.6 - 7.91 }],
  };
  const tl = (r: ReturnType<typeof analyzeHauling>) => r.superelevation.sections[0].corners.find((k) => k.corner === "topLeft")!.byCase[0].byWind[0];
  const br = (r: ReturnType<typeof analyzeHauling>) => r.superelevation.sections[0].corners.find((k) => k.corner === "bottomRight")!.byCase[0].byWind[0];

  it("6.2.1: 6% superelevation, FScr 1.428, stresses 0.466 / −3.486 ksi, FSf 2.825, FSr 1.994", () => {
    const r = analyzeHauling(base);
    near(tl(r).fscr, 1.428);
    near(tl(r).f, 0.466);
    near(br(r).f, -3.486);
    near(r.superelevation.failure[0][0].FSf, 2.825);
    near(r.superelevation.failure[0][0].FSr, 1.994);
  });
  it("6.2.2: a 120 ft turn at 10 mph on a 2% slope, FScr 0.970, FSf 2.787, FSr 1.835", () => {
    const r = analyzeHauling({ ...base, radius: 120 * 12, velocity: (10 * 5280 * 12) / 3600, cfAdverse: true, crown: 0.02, superelevation: 0.02 });
    near(tl(r).fscr, 0.97);
    near(tl(r).f, 0.647);
    near(br(r).f, -3.598);
    near(r.superelevation.failure[0][0].FSf, 2.787);
    near(r.superelevation.failure[0][0].FSr, 1.835);
  });
});
