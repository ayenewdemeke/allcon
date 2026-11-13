import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { takeoffFor, takeoffPayLines } from "../takeoff";
import { DECK_DEFAULTS, designDeck, type DeckInputs } from "./deck";
import { deckCalcLines } from "./deck-calc";
import { parapetResistance, polygonProps, railDef, RAILS, RAIL_FORCES } from "./rails";

// CDOT's standard bridge rails on the deck: their sections against the worksheets' quantities, the
// yield line analysis (A13.3.1), and the deck designed, detailed and paid with them.

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(tol);

describe("CDOT bridge rails (B-606)", () => {
  it("the sections' concrete matches the worksheets' tables (CY per foot)", () => {
    for (const r of RAILS) close(polygonProps(r.outline).A / 144 / 27, r.perFoot.concrete, 0.03);
  });

  it("Type 9's yield lines: Lc and Rw by Eqs. A13.3.1-1 to -4 from its Mw and Mc", () => {
    const r = railDef("type9-4")!;
    const p = parapetResistance(r, 4.5, 100, "TL-5");
    const H = 43 / 12;
    const Lt = RAIL_FORCES["TL-5"].Lt;
    const Lc = Lt / 2 + Math.sqrt((Lt / 2) ** 2 + (8 * H * p.Mw) / p.interior.Mc);
    close(p.interior.Lc, Lc, 1e-9);
    close(p.interior.Rw, (2 / (2 * Lc - Lt)) * (8 * p.Mw + (p.interior.Mc * Lc ** 2) / H), 1e-9);
    close(p.interior.T, p.interior.Rw / (Lc + 2 * H), 1e-9);
    // With its Grade 100 bars the parapet develops more than TL-5's 124 kip within a segment, as the worksheet designs it.
    expect(p.interior.Rw).toBeGreaterThan(124);
    // The end zones' closer front bars make the wall stronger about the longitudinal axis there.
    expect(p.end.Mc).toBeGreaterThan(p.interior.Mc);
    // Stainless (fy 75) is weaker than Grade 100.
    expect(parapetResistance(r, 4.5, 75, "TL-5").interior.Rw).toBeLessThan(p.interior.Rw);
  });
});

describe("the deck with a standard rail", () => {
  const withType = (type: "type9-4" | "type9-3" | "type10-mash"): DeckInputs => ({ ...DECK_DEFAULTS, rail: { type, testLevel: "TL-5", steel: "A1035" } });

  it("the rail sets the barrier's width, weight and c.g., and a parapet's Mc and T", () => {
    const r = designDeck(withType("type9-4"));
    const A = polygonProps(railDef("type9-4")!.outline).A;
    expect(r.applied.barrierWidth).toBe(18);
    close(r.applied.barrierWeight, (A / 144) * 0.15, 1e-9);
    close(r.applied.T, r.rail!.resistance!.interior.T, 1e-9);
    close(r.applied.Mc, r.rail!.resistance!.interior.Mc, 1e-9);
    expect(r.applied.Fv).toBe(80);
    expect(r.checks.find((c) => c.id === "rail-height")!.ok).toBe(true);
    // The curb-and-posts rail keeps the entered Mc and T.
    const t10 = designDeck(withType("type10-mash"));
    expect(t10.applied.Mc).toBe(DECK_DEFAULTS.Mc);
    close(t10.applied.barrierWeight, (polygonProps(railDef("type10-mash")!.outline).A / 144) * 0.15 + 0.0496, 1e-9);
  });

  for (const type of ["type9-4", "type9-3", "type10-mash"] as const)
    it(`${type}: the calc package works out in Calcs; the take-off pays the rail by the foot, its bars apart from 602`, () => {
      const i = withType(type);
      const regions = readingOrder(layout(deckCalcLines(i, "Deck"), { x: 0, y: 0 }));
      const values = new Map<string, Value>();
      const res = evaluateSheet(regions.filter((x) => x.kind !== "text" && x.kind !== "image") as SheetItem[], DEFAULT_SETTINGS, values);
      expect(regions.flatMap((x) => (res.get(x.id)?.kind === "error" ? [x.kind === "math" ? x.latex : x.kind] : []))).toEqual([]);
      const t = takeoffFor("deck-slab", i, { length: 100 })!;
      const rail = t.schedule.groups.filter((g) => g.paid);
      expect(rail.length).toBeGreaterThanOrEqual(2);
      const own = t.schedule.groups.filter((g) => !g.paid).reduce((s, g) => s + (g.count * g.length) / 12 * [0, 0, 0, 0.376, 0.668, 1.043, 1.502][g.size], 0);
      close(t.schedule.total, own, 1e-9);
      // The rail's bars per foot, near the worksheet's table (its joints and end anchorages aside).
      const perFoot = t.schedule.elsewhere![0].weight / 200;
      close(perFoot, railDef(type)!.perFoot.rebar, 0.35);
      const pay = takeoffPayLines("deck-slab", t, {}, i, "cdot");
      const line = pay.find((p) => p.role === "rail")!;
      expect(line.code).toBe(railDef(type)!.payItem);
      expect(line.quantity).toBe(200);
      expect(t.views.length).toBe(2);
    });

  it("an entered barrier is unchanged and has no rail line", () => {
    const t = takeoffFor("deck-slab", DECK_DEFAULTS, { length: 100 })!;
    expect(takeoffPayLines("deck-slab", t, {}, DECK_DEFAULTS).some((p) => p.role === "rail")).toBe(false);
    expect(designDeck(DECK_DEFAULTS).rail).toBeNull();
  });
});
