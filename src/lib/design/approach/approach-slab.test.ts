import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { WORKSHEET_TOLERANCE } from "../calc-style";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { approachSlabInputs } from "../kinds";
import { takeoffFor, takeoffPayLines } from "../takeoff";
import { unitWeight } from "../rebar/bars";
import { APPROACH_SLAB_DEFAULTS, designApproachSlab, movingLoad, SLEEPER_OF, TANDEM, TRUCK_AXLE, type ApproachSlabInputs } from "./approach-slab";
import { approachSlabCalcLines } from "./approach-slab-calc";
import { slabLength, sleeperBentBar } from "./approach-slab-detail";

// The approach slab against a hand calculation of the default slab (20 ft long, so a 10 ft design
// span by CDOT's 50%, 44 ft wide, 12 in thick under 3 in of HMA, B-601-1EA's #6 @ 6 in bottom), the calc package worked out by
// Calcs against the engine, and the take-off.

const close = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe("approach slab: hand calculation of the default", () => {
  const r = designApproachSlab(APPROACH_SLAB_DEFAULTS);
  it("design span and equivalent strip (AASHTO 4.6.2.3)", () => {
    expect(r.span.S).toBe(10);
    expect(r.span.NL).toBe(3);
    close(r.span.E1, 10 + 5 * Math.sqrt(10 * 30)); // 96.603 in
    close(r.span.Em, 84 + 1.44 * Math.sqrt(10 * 44)); // 114.205 in
    close(r.span.E, 96.603);
    expect(r.span.r).toBe(1);
    expect(r.span.axlesOnly).toBe(true);
  });
  it("moving loads: the 32 kip axle and the tandem both give 80 kip·ft on a 10 ft span; the tandem's reaction is 40 kip", () => {
    close(movingLoad(TRUCK_AXLE, 10).M, 80);
    close(movingLoad(TANDEM, 10).M, 80); // (2P/L)(L/2 − d/4)² = 5 × 4²
    close(movingLoad(TANDEM, 10).R, 40);
    close(movingLoad(TRUCK_AXLE, 10).R, 32);
  });
  it("moments and shear per foot", () => {
    close(r.loads.MDC, (0.15 * 100) / 8); // 1.875
    close(r.loads.MLL, (80 * 1.33) / (96.603 / 12)); // 13.217
    close(r.loads.MDW, (0.14667 * 0.25 * 100) / 8); // 0.458, 3 in of HMA
    close(r.loads.Mu, 1.25 * 1.875 + 1.5 * 0.45834 + 1.75 * 13.217); // 26.162
    close(r.loads.VLL, (40 * 1.33) / (96.603 / 12)); // 6.609
    close(r.loads.Vu, 1.25 * 0.75 + 1.5 * 0.18334 + 1.75 * 6.609);
  });
  it("main bars: #6 @ 6 in, de = 8.625 in, φMn = 31.88 kip·ft/ft", () => {
    close(r.main.de, 12 - 3 - 0.375);
    const As = 0.88;
    const a = (As * 60) / (0.85 * 4.5 * 12);
    close(r.main.MR, (0.9 * As * 60 * (8.625 - a / 2)) / 12);
    close(r.main.MR, 31.88, 2e-3);
  });
  it("fatigue: one 32 kip axle, 15% IM, the one-lane strip × 1.2", () => {
    close(r.fatigue.Mfat, (80 * 1.15) / ((1.2 * 96.603) / 12));
  });
  it("distribution: 100/√10 = 31.6% of the main bars", () => {
    close(r.dist.pct, 1 / Math.sqrt(10));
  });
  it("the default (the worksheet's slab) passes every required check; fatigue, for information, does not", () => {
    expect(r.checks.filter((c) => !c.ok && !c.advisory).map((c) => c.id)).toEqual([]);
    expect(r.checks.find((c) => c.id === "main-fatigue")!.ok).toBe(false);
    expect(r.worksheet).toEqual({ bar: 6, spacing: 6 });
    expect(designApproachSlab({ ...APPROACH_SLAB_DEFAULTS, L: 25 }).worksheet).toEqual({ bar: 9, spacing: 6 });
    expect(designApproachSlab({ ...APPROACH_SLAB_DEFAULTS, L: 31 }).worksheet).toBeNull();
  });
  it("over 15 ft the full HL-93 with the lane load applies (3.6.1.3.3)", () => {
    const f = designApproachSlab({ ...APPROACH_SLAB_DEFAULTS, L: 30, supportLoss: 1 });
    expect(f.span.axlesOnly).toBe(false);
    close(f.loads.laneM, (0.64 * 900) / 8);
  });
  it("skew reduces the live load moment by r = 1.05 − 0.25 tan θ", () => {
    const f = designApproachSlab({ ...APPROACH_SLAB_DEFAULTS, skew: 30 });
    close(f.span.r, 1.05 - 0.25 * Math.tan(Math.PI / 6));
  });
  it("too thin a slab or too few bars fails", () => {
    const f = designApproachSlab({ ...APPROACH_SLAB_DEFAULTS, t: 6, mainBars: { bar: 4, spacing: 12 } });
    expect(f.checks.find((c) => c.id === "depth")!.ok).toBe(false);
    expect(f.checks.find((c) => c.id === "main-flexure")!.ok).toBe(false);
  });
});

function workOut(inputs: ApproachSlabInputs) {
  const regions = readingOrder(layout(approachSlabCalcLines(inputs, "Test slab"), { x: 0, y: 0 }));
  const items = regions.flatMap((r): SheetItem[] => (r.kind === "text" || r.kind === "image" ? [] : [r as SheetItem]));
  const values = new Map<string, Value>();
  const results = evaluateSheet(items, DEFAULT_SETTINGS, values);
  const errors = regions.flatMap((r) => (results.get(r.id)?.kind === "error" ? [`${r.kind === "math" ? r.latex : r.kind}: ${(results.get(r.id) as { message: string }).message}`] : []));
  const checks = regions.filter((r) => r.kind === "math" && r.latex.startsWith("\\operatorname{if}")).map((r) => (results.get(r.id) as { result?: string }).result ?? "");
  const value = (start: string, unit?: string) => {
    const r = regions.find((x) => x.kind === "math" && x.latex.startsWith(start));
    if (!r) throw new Error(`No region ${start}`);
    const v = values.get(r.id);
    return unit ? (v as Unit).toNumber(unit) : (v as number);
  };
  return { errors, checks, value };
}

describe("approach slab calc package", () => {
  for (const [name, inputs] of [
    ["the default slab", approachSlabInputs({})],
    ["a skewed 30 ft span with an overlay and a barrier", approachSlabInputs({ L: 30, supportLoss: 1, skew: 25, wearing: 3, barrier: true, mainBars: { bar: 8, spacing: 6 } })],
    ["one lane, no sleeper, failing bars", approachSlabInputs({ W: 16, roadway: 12, sleeper: false, mainBars: { bar: 5, spacing: 12 } })],
  ] as [string, ApproachSlabInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designApproachSlab(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      const tol = WORKSHEET_TOLERANCE;
      const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
      near(c.value("E_s\\coloneq", "in"), r.span.E);
      near(c.value("M_u\\coloneq", "kip*ft/ft"), r.loads.Mu);
      near(c.value("V_u\\coloneq", "kip/ft"), r.loads.Vu);
      near(c.value("M_r\\coloneq", "kip*ft/ft"), r.main.MR);
      near(c.value("f_{ss}\\coloneq", "ksi"), r.main.fss);
      near(c.value("s_{max}\\coloneq", "in"), r.main.sMax);
      near(c.value("f_{rng}\\coloneq", "ksi"), r.fatigue.fRange);
      if (r.sleeper) near(c.value("q_u\\coloneq", "ksf"), r.sleeper.qu);
      expect(c.checks.length).toBe(r.checks.length);
      expect(c.checks.filter((x) => x.includes("NG")).length).toBe(r.checks.filter((x) => !x.ok).length);
    });
  }
});

describe("approach slab take-off", () => {
  it("two slabs by default: concrete, epoxy bars, CDOT pay items", () => {
    const i = approachSlabInputs({});
    const t = takeoffFor("approach-slab", i)!;
    // 2 × (20 ft + the 6 in seat) × 44 × 1 ft / 27 + 2 sleepers (4 ft × 1 ft + the 1 ft × 1'-3" block) × 44 / 27
    expect(slabLength(i)).toBe(246);
    close(t.schedule.concreteTotal, (2 * 20.5 * 44) / 27 + (2 * 5.25 * 44) / 27);
    const main = t.schedule.groups.filter((g) => g.use === "Main bars, bottom");
    // 88 bars across 44 ft at 6 in per slab, 2 slabs; each 20'-6" less 4 in clear (under 60 ft stock: one piece)
    expect(main.reduce((s, g) => s + g.count, 0)).toBe(2 * 88);
    expect(main[0].length).toBe(242);
    // The #4 top bar is one ⊏: 1'-0" returns, down 7 in at both ends, 20'-2" along the top
    const top = t.schedule.groups.find((g) => g.use === "Longitudinal, top")!;
    expect(top.shape).toEqual({ kind: "bent", dims: [12, 7, 242, 7, 12], hooks: 0 });
    expect(t.schedule.groups.some((g) => g.use === "End bars at the abutment")).toBe(false);
    // The sleeper: two #5 bars (2'-8", 7", 2'-2", 1'-9", 8") at each 1'-0", 44 places, 2 slabs; Tot 10 along it; Tot 2 in the block
    expect(sleeperBentBar(i)).toEqual([32, 7, 26, 21, 8]);
    const sl = t.schedule.groups.find((g) => g.use === "Sleeper bars")!;
    expect(sl.count).toBe(2 * 2 * 44);
    expect(sl.length).toBe(94);
    // 44 ft bars, lapped: two end pieces each
    expect(t.schedule.groups.find((g) => g.use === "Sleeper, along")!.count).toBe(2 * 2 * 10);
    expect(t.schedule.groups.find((g) => g.use === "Sleeper, in the block")!.count).toBe(2 * 2 * 2);
    const lines = takeoffPayLines("approach-slab", t, {}, i, "cdot");
    expect(lines.map((l) => l.code).sort()).toEqual(["408-01100", "515-00120", "518-01004", "601-03056", "602-00020"]);
    close(t.quantities.sealant!.value, 2 * 44);
    close(t.quantities.joint!.value, 2 * 44);
    // The anchorage bars: #5, 2'-9" + 10" (B-601-1EA)
    expect(t.schedule.groups.find((g) => g.use === "Anchorage bars")!.length).toBe(43);
    expect(t.schedule.total).toBeCloseTo(t.schedule.bySize.reduce((s, b) => s + b.weight, 0), 6);
    expect(unitWeight(6)).toBe(1.502);
  });
  it("an overlay adds the waterproofing and a joint its skewed length", () => {
    const i = approachSlabInputs({ wearing: 3, joint: "device", skew: 30 });
    const t = takeoffFor("approach-slab", i, { length: 1 })!;
    close(t.quantities.waterproofing!.value, ((slabLength(i) / 12) * 44) / 9);
    close(slabLength(i), 240 + 6 / Math.cos(Math.PI / 6));
    close(t.quantities.joint!.value, 44 / Math.cos(Math.PI / 6));
    const codes = takeoffPayLines("approach-slab", t, {}, i, "cdot").map((l) => l.code);
    expect(codes).toContain("515-00120");
    expect(codes).toContain("518-01004");
  });
  it("without the device, B-601-1's sleeper: 3'-0\" by 1'-0\", #4 closed hoops @ 1'-6\", #5 (6 Tot), no block", () => {
    const i = approachSlabInputs({ joint: "none", ...SLEEPER_OF.none });
    const t = takeoffFor("approach-slab", i)!;
    const hoops = t.schedule.groups.find((g) => g.use === "Sleeper hoops")!;
    expect(hoops.shape).toMatchObject({ kind: "closed", dims: [30, 6] });
    expect(hoops.size).toBe(4);
    expect(t.schedule.groups.find((g) => g.use === "Sleeper, along")!.count).toBe(2 * 2 * 6);
    expect(t.schedule.groups.some((g) => g.use === "Sleeper, in the block")).toBe(false);
    close(t.schedule.concreteTotal, (2 * 20.5 * 44) / 27 + (2 * 3 * 44) / 27);
    // Its narrower sleeper bears about 4.5 ksf factored: over the 4 ksf default resistance, within 5 ksf
    const fails = (q: number) => designApproachSlab({ ...i, qR: q }).checks.filter((c) => !c.ok && !c.advisory).map((c) => c.id);
    expect(fails(4)).toEqual(["sleeper-bearing"]);
    expect(fails(5)).toEqual([]);
  });
});
