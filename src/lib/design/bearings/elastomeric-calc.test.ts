import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { WORKSHEET_TOLERANCE } from "../calc-style";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { BEARING_DEFAULTS, designBearing, PTFE_DEFAULTS, type BearingInputs } from "./elastomeric";
import { bearingCalcLines } from "./elastomeric-calc";

// The calc package, worked out by Calcs, agrees with the design engine.

function workOut(inputs: BearingInputs) {
  const regions = readingOrder(layout(bearingCalcLines(inputs, "Test bearing"), { x: 0, y: 0 }));
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

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(WORKSHEET_TOLERANCE * Math.max(1, Math.abs(b)));

describe("elastomeric bearing calc package", () => {
  for (const [name, inputs] of [
    ["the default steel-reinforced pad (Method B)", BEARING_DEFAULTS],
    ["Method B, long and narrow, deck fixed, unstable", { ...BEARING_DEFAULTS, L: 24, W: 10, n: 14, deckFree: false }],
    ["steel-reinforced by Method A, by hardness, shear prevented", { ...BEARING_DEFAULTS, method: "A", byHardness: true, hardness: 50, L: 12, W: 25, n: 5, shearPrevented: true }],
    ["a PTFE sliding bearing", PTFE_DEFAULTS],
    ["a PTFE sliding bearing by Method A, its edge overstressed", { ...PTFE_DEFAULTS, method: "A", thetaL: 0.02, edgeTotal: 1.2 }],
    ["a plain pad that slips, no deck joint", { ...BEARING_DEFAULTS, pad: "plain", method: "A", L: 12, W: 25, hri: 2, DL: 40, LL: 20, expansionLength: 40, jointed: false }],
  ] as [string, BearingInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designBearing(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      close(c.value("S\\coloneq"), r.pad.S);
      close(c.value("h_{rt}\\coloneq", "in"), r.pad.hrt);
      close(c.value("\\Delta_s\\coloneq", "in"), r.movement.ds);
      close(c.value("\\delta_L\\coloneq", "in"), r.deflection.dL);
      close(c.value("\\delta_{lt}\\coloneq", "in"), r.deflection.dLong);
      if (!inputs.sliding) close(c.value("\\Delta_{allow}\\coloneq", "in"), r.anchorage.dsAllow);
      else close(c.value("\\Delta_{pt}\\coloneq", "in"), r.ptfe.slide);
      if (r.method === "B") {
        close(c.value("\\gamma_{tot}\\coloneq"), r.strains.total);
        close(c.value("A_s\\coloneq"), r.stability.reduce((a, b) => (b.limit < a.limit ? b : a)).A);
      }
      // The worksheet's OK/NG lines agree with the engine's checks.
      expect(c.checks.filter((x) => x.includes("NG")).length).toBe(r.checks.filter((x) => !x.ok).length);
      expect(c.checks.length).toBe(r.checks.length);
    });
  }
});
