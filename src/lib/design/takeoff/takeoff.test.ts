import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { designInputs } from "../kinds";
import { hookLeg, unitWeight } from "../rebar/bars";
import { countAt } from "../rebar/runs";
import { takeoffFor, takeoffPayLines, TAKEOFF_KINDS } from ".";
import { takeoffQuantityLines } from "./calc";
import { CBC_DEFAULTS } from "../culverts/cbc";
import { headwallPerLf } from "./tools";
import { fitsAcross } from "@/lib/calcs/library/fit";

// Every design tool's take-off: bars detailed as CDOT details them, quantities, and pay lines.

describe("design take-offs", () => {
  for (const kind of TAKEOFF_KINDS)
    it(`${kind}: builds with its defaults, weights and pay lines consistent`, () => {
      const i = designInputs(kind, {});
      const t = takeoffFor(kind, i)!;
      expect(t).not.toBeNull();
      const total = t.schedule.groups.reduce((s, g) => s + ((g.count * g.length) / 12) * unitWeight(g.size), 0) + (t.schedule.extra ?? []).reduce((s, e) => s + e.weight, 0);
      expect(t.schedule.total).toBeCloseTo(total, 6);
      // Every part's concrete is worked out as math, and every measured quantity too (counts and lump sums aside).
      expect(t.schedule.concrete.filter((c) => !c.math && !c.terms).map((c) => c.label)).toEqual([]);
      expect(Object.entries(t.quantities).filter(([role, q]) => q && !q.math && !q.terms && !["bearing", "shaft", "removal"].includes(role)).map(([role]) => role)).toEqual([]);
      const lines = takeoffPayLines(kind, t, {}, i, "cdot");
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l.code).toMatch(/^\d{3}-\d{5}$/);
      // Generic by default: the same quantities, each under its MasterFormat section.
      const generic = takeoffPayLines(kind, t, {}, i);
      expect(generic.map((l) => [l.role, l.quantity])).toEqual(lines.map((l) => [l.role, l.quantity]));
      for (const l of generic) expect(l.code).toMatch(/^\d{2} \d{2} \d{2}(\.\d{2})?$/);
      // The quantity sheet's lines: a summary and, with bars, their tabulation.
      const q = takeoffQuantityLines(kind, t, "Test", {}, { ...i, takeoff: { agency: "cdot" } });
      // Every line of math fits on the page (beside its note, or across it), so the sheet prints.
      expect(q.flatMap((l) => ("math" in l && !fitsAcross(l.math) ? [l.math] : []))).toEqual([]);
      expect(q.some((l) => "text" in l && l.text.startsWith(lines[0].code))).toBe(true);
      // Worked out in Calcs: no errors, and the total weight as the schedule's.
      const regions = readingOrder(layout(q, { x: 0, y: 0 }));
      const values = new Map<string, Value>();
      const results = evaluateSheet(regions.filter((x) => x.kind !== "text" && x.kind !== "image") as SheetItem[], DEFAULT_SETTINGS, values);
      expect(regions.filter((x) => results.get(x.id)?.kind === "error").map((x) => (x.kind === "math" ? x.latex : x.kind))).toEqual([]);
      const w = regions.find((x) => x.kind === "math" && x.latex.startsWith("W_{rebar}"));
      if (w) expect(Math.abs((values.get(w.id) as Unit).toNumber("lb") - t.schedule.total)).toBeLessThan(0.01 * t.schedule.total);
    });

  it("a box culvert by M-601-1: transverse bars by face along the barrel, d1 bars #4 @ 1'-0\" in every mat and face, Class D (Box Culvert)", () => {
    const t = takeoffFor("box-culvert", CBC_DEFAULTS, { length: 100 })!;
    const g = (use: string) => t.schedule.groups.filter((x) => x.use === use);
    // Top mat of the top slab: the design's #5 @ 12" across the barrel, hooked down into the walls.
    const top = g("Top slab, top mat")[0];
    expect(top.size).toBe(CBC_DEFAULTS.bars.topOut.bar);
    expect(top.count).toBe(countAt(100 * 12 - 2 * CBC_DEFAULTS.cover, CBC_DEFAULTS.bars.topOut.spacing));
    expect(top.shape.dims[0]).toBe(Math.floor(hookLeg(5).leg));
    // Longitudinal: #4 in both mats of each slab, pieces lapped (100 ft over 40 ft stock).
    expect(g("Top slab, longitudinal").every((x) => x.size === 4)).toBe(true);
    expect(g("Top slab, longitudinal")[0].splice).toMatch(/Class B/);
    // Concrete: the barrel's section (10 × 10 ft cell, 9/10/8 in members, 12 in haunches) by its length.
    const W = 120 + 16;
    const H = 120 + 19;
    expect(t.schedule.concrete[0].cy).toBeCloseTo((((W * H - 120 * 120 + 4 * 72) / 144) * 100) / 27, 6);
    // Headwalls and toewalls by M-601-1 Sheet 2: a 10 ft span, square: 28.5 lb and 0.086 CY per LF of headwall, two ends.
    expect(headwallPerLf(10, 90)).toEqual({ lb: 28.5 });
    expect(headwallPerLf(10, 50)).toEqual({ lb: 68.7 });
    expect(headwallPerLf(16, 50)).toBeNull(); // a special design
    expect(t.schedule.concrete[1].cy).toBeCloseTo(2 * (W / 12) * 0.086, 6);
    expect(t.schedule.extra![0].weight).toBeCloseTo(2 * (W / 12) * 28.5, 6);
    // M-206-1: excavation 1'-6" outside the walls and past the ends, from the original ground (here the
    // finished surface, 6 ft of fill over the box) to the box's bottom; backfill to the finished surface less the box.
    const plan = ((W + 36) / 12) * ((1200 + 36) / 12);
    const depth = H / 12 + 6;
    // Plus the toewalls at both ends (M-601-1: 8 in wide, 3'-0" below the floor's top), 1'-6" each side (M-206-1 Sheet 2).
    const toes = 2 * (44 / 12) * ((W + 36) / 12) * (3 - CBC_DEFAULTS.Tb / 12);
    expect(t.quantities.excavation!.value).toBeCloseTo((plan * depth + toes) / 27, 6);
    // Backfill 1'-6" outside the walls, from the box's bottom to 1 ft over its top, less the box (M-206-1, Cases 1 and 2).
    expect(t.quantities.backfill!.value).toBeCloseTo((plan * (H / 12 + 1) - (W / 12) * 100 * (H / 12)) / 27, 6);
    // Case 1: the original ground less than 1 ft above the box's bottom: the trench isn't paid, the toewalls' are.
    expect(takeoffFor("box-culvert", CBC_DEFAULTS, { length: 100, ground: 0.5 })!.quantities.excavation!.value).toBeCloseTo(toes / 27, 6);
    expect(takeoffPayLines("box-culvert", t, {}, undefined, "cdot")[0].code).toBe("601-03030");
    // Black bars by default (CDOT culverts), waterproofing only for fill of 2 ft or less (M-601-1 note 16).
    expect(takeoffPayLines("box-culvert", t, {}, undefined, "cdot")[1].code).toBe("602-00000");
    expect(t.quantities.waterproofing).toBeUndefined();
    expect(takeoffFor("box-culvert", { ...CBC_DEFAULTS, fill: 1.5 }, { length: 100 })!.quantities.waterproofing!.value).toBeCloseTo((((W + 36) / 12) * 100) / 9, 6);
  });

  it("the take-off settings (length, pay items, heading) are kept with the design's inputs", () => {
    const i = designInputs("cip-cantilever-wall", { takeoff: { length: 80, items: { concrete: "601-03055", bogus: "x" }, headingId: "h" } }) as { takeoff?: unknown };
    expect(i.takeoff).toEqual({ length: 80, agency: "generic", items: { concrete: "601-03055" }, headingId: "h" });
    const c = designInputs("cip-cantilever-wall", { takeoff: { agency: "cdot", items: { concrete: "03 30 00" } } }) as { takeoff?: unknown };
    expect(c.takeoff).toEqual({ agency: "cdot", items: { concrete: "03 30 00" }, headingId: null });
  });
});
