import { describe, expect, it } from "vitest";
import type { Unit } from "mathjs";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { takeoffFor, takeoffPayLines } from "../takeoff";
import { takeoffQuantityLines } from "../takeoff/calc";
import { fitsAcross } from "@/lib/calcs/library/fit";
import type { CulvertWingwall } from "./m601-20";
import { cbcCalcLines } from "./cbc-calc";
import { CBC_DEFAULTS, designCbc, type CbcInputs } from "./cbc";
import { M6011_ROWS, m6011Row } from "./m601-1";

// 25250 (CBC 007D064470BR), sheets C04/C05: a 10 × 10 ft single cell, 10/11/11 in, t1/b1 #4, t2/b2 #6,
// c1/c2 #5, w #4, all @ 6", under up to 12 ft of fill; extended 33 ft, two joints with #5 × 3'-0" @ 12" dowels.
const b = (bar: number) => ({ bar, spacing: 6 });
const C25250: CbcInputs = {
  ...CBC_DEFAULTS,
  span: 10, rise: 10, Tt: 10, Tb: 11, Ts: 11, Ti: 11, haunch: 0, fill: 12, fc: 4.5, gammaS: 0.12,
  bars: { topIn: b(6), topOut: b(4), botIn: b(6), botOut: b(4), wallIn: b(4), wallOut: b(5), intWall: b(5) },
  cornerBars: true,
  extension: { pieces: [{ name: "South", length: 19 }, { name: "North", length: 14 }], bar: 5, length: 36, spacing: 12 },
};

describe("M-601-1 corner bars and extension dowels", () => {
  it("the design check counts t1 + c1 (b1 + c2) at a slab's end against an exterior wall: 25250 passes; t1 alone doesn't", () => {
    const r = designCbc(C25250);
    expect(r.ok).toBe(true);
    const top = r.governs.find((g) => g.kind === "top" && g.key === "out")!;
    expect(top.steel.corner).toEqual(b(5));
    expect(top.As).toBeCloseTo((0.2 * 12) / 6 + (0.31 * 12) / 6, 9);
    // Minimum steel and spacing stay the face's own bars.
    expect(r.checks.find((c) => c.id === "top-out-min")!.capacity).toBeCloseTo(0.4, 9);
    const plain = designCbc({ ...C25250, cornerBars: false });
    expect(plain.checks.find((c) => c.id === "top-out-flex")!.ok).toBe(false);
    // The calc package works it out with both sets.
    expect(cbcCalcLines(C25250, "25250").some((l) => "text" in l && l.text.startsWith("Outside face at the slab's end: t1 #4"))).toBe(true);
  });

  it("the take-off details c1/c2/w1/w2 with M-601-1's legs, t1/b1 straight, and the dowels at both joints", () => {
    const t = takeoffFor("box-culvert", C25250, { length: 33 })!;
    const g = (use: string) => t.schedule.groups.find((x) => x.use === use)!;
    const n = 66; // bars @ 6" along 33 ft
    expect(g("Corner bars, top (c1)")).toMatchObject({ size: 5, count: 2 * n, length: 128 + 52 });
    expect(g("Corner bars, bottom (c2)")).toMatchObject({ size: 5, count: 2 * n, length: 38 + 32 });
    expect(g("Exterior walls, inside face (w1)")).toMatchObject({ size: 4, count: 2 * n, length: 128 });
    expect(g("Exterior walls, inside face (w2)")).toMatchObject({ size: 4, count: 2 * n, length: 23 });
    expect(g("Top slab, top mat (t1)").shape.kind).toBe("straight");
    // 12 across each slab, 11 up each wall: 46 a joint.
    expect(g("Dowels into the existing barrel")).toMatchObject({ size: 5, count: 92, length: 36 });
    expect(t.notes.some((x) => x.startsWith("Check set: M-601-1 Sheet 2 gives 1.446 CY and 285 lb"))).toBe(true);
    // Not in the table (a 2-cell box): the hooked layout, said so.
    const two = takeoffFor("box-culvert", { ...C25250, cells: 2 }, { length: 33 })!;
    expect(two.schedule.groups.some((x) => x.use === "Exterior walls, outside face")).toBe(true);
    expect(two.notes.some((x) => x.startsWith("Corner bars: a 2-cell"))).toBe(true);
  });

  it("25250's quantity sheet works out in Calcs: every part as math (no text lead-ins), totals equal to the schedule's", () => {
    const ww = (name: string, m: number, k: number, L: number): CulvertWingwall => ({ name, m, k, L, theta: 45, toeWall: true });
    const i = { ...C25250, wingwalls: [ww("NE", 11.3, 5.2, 13.1), ww("NW", 11.3, 2.4, 21.2), ww("SE", 11.3, 5.5, 20.5), ww("SW", 11.3, 9.0, 17.8)] };
    const t = takeoffFor("box-culvert", i, { length: 33 })!;
    expect(t.schedule.concrete.every((c) => c.math || c.terms)).toBe(true);
    expect(t.schedule.extra!.every((e) => e.math || e.terms)).toBe(true);
    const q = takeoffQuantityLines("box-culvert", t, "25250", {}, i);
    // No "…:- basis" lines for the parts: each is its math with a note beside it.
    expect(q.some((l) => "text" in l && l.text.includes("wingwall (M-601-20):-"))).toBe(false);
    // The grouped stretches: NW (k 2.4 to m 11.3 over 21.2 ft) has eight equal stretches of 2.382 ft, four rates a term.
    expect(q.some((l) => "math" in l && l.math.includes("2.382\\mathrm{ft}\\cdot \\left(0.556+0.506+0.457+0.407\\right)"))).toBe(true);
    // The #4 bars don't fit one line: split into parts. Every line fits the page; bars are named by size and use, never by mark.
    expect(q.some((l) => "math" in l && l.math.startsWith("W_{s4}\\coloneq W_{s4a}+W_{s4b}"))).toBe(true);
    expect(q.flatMap((l) => ("math" in l && !fitsAcross(l.math) ? [l.math] : []))).toEqual([]);
    expect(q.some((l) => ("math" in l && /marks? \d/.test(l.ref ?? "")) || ("text" in l && /marks? \d/.test(l.text)))).toBe(false);
    const regions = readingOrder(layout(q, { x: 0, y: 0 }));
    const values = new Map<string, Value>();
    const results = evaluateSheet(regions.filter((x) => x.kind !== "text" && x.kind !== "image") as SheetItem[], DEFAULT_SETTINGS, values);
    expect(regions.filter((x) => results.get(x.id)?.kind === "error").map((x) => (x.kind === "math" ? x.latex : x.kind))).toEqual([]);
    const at = (start: string, unit: string) => (values.get(regions.find((x) => x.kind === "math" && x.latex.startsWith(start))!.id) as Unit).toNumber(unit);
    expect(at("V_{conc}", "yd^3")).toBeCloseTo(t.schedule.concreteTotal, 1);
    expect(Math.abs(at("W_{rebar}", "lb") - t.schedule.total)).toBeLessThan(2);
  });

  it("25250's excavation below the box to bedrock (5095.00), refilled with Class 1 (drainage sheet 8 of 10; C01 note 2)", () => {
    // Inverts 5100.15 in, 5097.77 out (C02); the box's bottom 11 in lower: 4.233 ft above bedrock at the inlet, 1.85 ft at the outlet.
    const ex = { to: 5095, inletInvert: 5100.15, outletInvert: 5097.77, wingwalls: false };
    const pieces = [{ name: "Inlet", length: 19 }, { name: "Outlet", length: 14 }];
    const i: CbcInputs = { ...C25250, extension: { ...C25250.extension!, pieces }, excavation: ex };
    const t = takeoffFor("box-culvert", i, { ground: 0 })!;
    const W = (142 + 36) / 12;
    const dIn = 5100.15 - 11 / 12 - 5095;
    const dOut = 5097.77 - 11 / 12 - 5095;
    const below = W * (19 + 1.5) * dIn + W * (14 + 1.5) * dOut;
    // The toewalls reach 3'-0" below the floor's top, 2.083 ft below the box: deeper than the excavation at the outlet only.
    const toe = (44 / 12) * W * (3 - 11 / 12 - dOut);
    expect(t.quantities.excavation!.value).toBeCloseTo((below + toe) / 27, 6);
    const without = takeoffFor("box-culvert", { ...i, excavation: undefined }, { ground: 0 })!;
    expect(t.quantities.backfill!.value - without.quantities.backfill!.value).toBeCloseTo(below / 27, 6);
    // The wingwalls' excavation (M-206-1 Sheet 2) when it's measured: footings 1'-6" all round, the outlet ones less deep.
    const ww = { name: "NE", m: 11.3, k: 5.2, L: 13.1, theta: 74, toeWall: true, end: "outlet" as const };
    const withWalls = takeoffFor("box-culvert", { ...i, wingwalls: [ww], excavation: { ...ex, wingwalls: true } }, { ground: 0 })!;
    expect(withWalls.quantities.excavation!.value).toBeGreaterThan(t.quantities.excavation!.value);
  });

  it("25250 on its original calc's basis (Final Quantities, Alt-1): the barrel's backfill, the over-excavation and the waterproofing as the calc has them; the rest by the M-standards", () => {
    const ww = (name: string, k: number, L: number, end: "inlet" | "outlet"): CulvertWingwall => ({ name, m: 11.3, k, L, theta: 45, toeWall: true, end });
    const i: CbcInputs = {
      ...C25250,
      extension: { ...C25250.extension!, pieces: [{ name: "Inlet", length: 19 }, { name: "Outlet", length: 14 }], removalBackfill: 24.81, waterproofJoints: true },
      wingwalls: [ww("NE", 5.2, 13.1, "outlet"), ww("NW", 2.4, 21.2, "outlet"), ww("SE", 5.5, 20.5, "inlet"), ww("SW", 9.0, 17.8, "inlet")],
      excavation: { to: null, depth: 0.5, inletInvert: null, outletInvert: null, wingwalls: true },
    };
    const t = takeoffFor("box-culvert", i, { ground: 1.5 })!;
    const plan = (33 + 3) * (142 / 12 + 3); // ft², the calc's (K6 + 3)(11.83 + 3)
    const terms = t.quantities.backfill!.terms!;
    // Its I17: around the extensions to 1 ft over the box, less the box = 82.23 CY; its M17: 0.5 ft below = 9.89 CY.
    expect(terms[0]).toContain("12\\mathrm{in}");
    const barrel = (plan * (141 / 12 + 1) - (142 / 12) * (141 / 12) * 33) / 27;
    expect(barrel).toBeCloseTo(82.23, 1);
    expect((plan * 0.5) / 27).toBeCloseTo(9.89, 1);
    // Its I16: the trench 1.5 ft deep = 29.67 CY, in the excavation.
    expect(t.quantities.excavation!.value).toBeGreaterThan((plan * 1.5 + plan * 0.5) / 27);
    // Its J11 waterproofing, 93.4 SY (the record 93, the check 94).
    expect(t.quantities.waterproofing!.value).toBeGreaterThan(93);
    expect(t.quantities.waterproofing!.value).toBeLessThan(95);
    // The backfill around the wingwalls by M-601-20's section (b less the stem, the 2:1 fill from 6 in under the top),
    // where the calc's own sections give 146 CY: within 15%.
    const walls = t.quantities.backfill!.value - barrel - (plan * 0.5) / 27 - 24.81;
    expect(walls).toBeGreaterThan(146 * 0.85);
    expect(walls).toBeLessThan(146);
  });

  it("a new culvert and an extension: pieces run on their own, headwalls only at new ends, dowels at each joint, the removal item", () => {
    const sch = (i: CbcInputs, length = 33) => takeoffFor("box-culvert", i, { length })!;
    const hw = (t: ReturnType<typeof sch>) => t.schedule.extra!.find((e) => e.label === "Headwalls and toewalls")!.weight;
    const Lh = (120 + 22) / 12;
    // New: one 33 ft barrel, a headwall at each end, no dowels, no removal; d1 bars one run of 32'-8".
    const fresh = sch({ ...C25250, extension: undefined });
    expect(hw(fresh)).toBeCloseTo(2 * Lh * 28.5, 9);
    expect(fresh.schedule.groups.some((g) => g.use.startsWith("Dowels"))).toBe(false);
    expect(fresh.quantities.removal).toBeUndefined();
    expect(fresh.schedule.groups.filter((g) => g.use === "Top slab, longitudinal").map((g) => g.length)).toEqual([392]);
    expect(fresh.length?.value).toBe(33);
    // Both ends extended (25250): 19 ft and 14 ft pieces, two new headwalls, two joints, d1 bars stopping at the joints.
    const both = sch(C25250, 99); // the take-off's length is the pieces', not this
    expect(hw(both)).toBeCloseTo(2 * Lh * 28.5, 9);
    expect(both.schedule.groups.filter((g) => g.use === "Top slab, longitudinal").map((g) => [g.length, g.where])).toEqual([
      [19 * 12 - 4, "South piece"],
      [14 * 12 - 4, "North piece"],
    ]);
    expect(both.schedule.groups.find((g) => g.use === "Corner bars, top (c1)")!.count).toBe(2 * (38 + 28)); // 38 rows in 19 ft, 28 in 14 ft
    expect(both.schedule.concrete[0].cy).toBeCloseTo((39.04166 * 33) / 27, 3);
    expect(both.quantities.removal!.value).toBe(1);
    expect(both.length).toBeUndefined();
    // One end extended: one new headwall, one joint.
    const one = sch({ ...C25250, extension: { ...C25250.extension!, pieces: [{ name: "South", length: 19 }] } });
    expect(hw(one)).toBeCloseTo(Lh * 28.5, 9);
    expect(one.schedule.groups.find((g) => g.use.startsWith("Dowels"))!.count).toBe(46);
    // Removal is a lump sum under 202-00495.
    expect(takeoffPayLines("box-culvert", one, {}, undefined, "cdot").find((l) => l.code === "202-00495")).toMatchObject({ quantity: 1, unit: "LS" });
  });
});

// CDOT M-601-1 Sheet 2 as transcribed: every row consistent with itself.

describe("M-601-1 Sheet 2", () => {
  it("every row: HT = R + Tt + Tb, WIDTH = S + 2 TW, and concrete per foot = the section's area (no haunches)", () => {
    expect(M6011_ROWS).toHaveLength(92);
    for (const r of M6011_ROWS) {
      const at = `S ${r.S} R ${r.R} fill ${r.fill.join("-")}`;
      expect(Math.abs(r.HT - (r.R * 12 + r.Tt + r.Tb)), at).toBeLessThanOrEqual(0.5);
      expect(Math.abs(r.WIDTH - (r.S * 12 + 2 * r.TW)), at).toBeLessThanOrEqual(0.5);
      const cy = ((r.S * 12 + 2 * r.TW) * (r.R * 12 + r.Tt + r.Tb) - r.S * r.R * 144) / 3888; // in² per foot to CY
      expect(Math.abs(r.cy - cy), at).toBeLessThan(0.002);
      // v1: the outside corner bar down the wall, from 2 in under the top of the top slab to the top of the bottom slab.
      expect(Math.abs(r.v1 - (r.R * 12 + r.Tt - 2)), at).toBeLessThanOrEqual(1);
      expect(r.bars.c1, at).toBe(r.bars.c2);
    }
  });

  it("finds the row for a box and its fill: 25250's 10 × 10 under 10–15 ft", () => {
    const r = m6011Row(1, 10, 10, 12)!;
    expect([r.Tt, r.Tb, r.TW, r.h1, r.v1, r.h2, r.v2, r.v3, r.lb]).toEqual([10, 11, 11, 52, 128, 32, 38, 23, 285]);
    expect(m6011Row(1, 10, 10, 1.5)!.fill).toEqual([0, 2]);
    expect(m6011Row(1, 10, 10, 10)!.fill).toEqual([2, 10]);
    expect(m6011Row(2, 10, 10, 12)).toBeNull();
    expect(m6011Row(1, 11, 10, 12)).toBeNull();
  });
});
