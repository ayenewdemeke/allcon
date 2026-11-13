import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { WORKSHEET_TOLERANCE } from "../calc-style";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { designHaunch, HAUNCH_DEFAULTS, type HaunchInputs } from "./haunch";
import { haunchCalcLines } from "./haunch-calc";

// The calc package, worked out by Calcs, agrees with the design engine.

function workOut(inputs: HaunchInputs) {
  const regions = readingOrder(layout(haunchCalcLines(inputs, "Test span"), { x: 0, y: 0 }));
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

describe("haunch calc package", () => {
  for (const [name, inputs] of [
    ["the default span", HAUNCH_DEFAULTS],
    ["box beams with shims, on a tangent, under-cambered too much", { ...HAUNCH_DEFAULTS, D1: 8, slopedGirders: true, gradeIn: 2, gradeOut: 2, radius: 0, camber: 4.628, deflection: -1.677, deflectionUnder: -3, shims: true, minMidspan: 5 }],
  ] as [string, HaunchInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designHaunch(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      close(c.value("\\delta_{PE}\\coloneq", "in"), r.deckEffect);
      close(c.value("D_2\\coloneq", "in"), r.D2);
      close(c.value("D_{2u}\\coloneq", "in"), r.D2under);
      expect(c.checks.filter((x) => x.includes("NG")).length).toBe(r.checks.filter((x) => !x.ok).length);
      expect(c.checks.length).toBe(r.checks.length);
    });
  }
});
