import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { WORKSHEET_TOLERANCE } from "../calc-style";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { designWingwall, WINGWALL_DEFAULTS, type WingwallInputs } from "./wingwall";
import { wingwallCalcLines } from "./wingwall-calc";

// The calc package, worked out by Calcs, agrees with the design engine.

function workOut(inputs: WingwallInputs) {
  const regions = readingOrder(layout(wingwallCalcLines(inputs, "Test wingwall"), { x: 0, y: 0 }));
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

describe("wingwall calc package", () => {
  for (const [name, inputs] of [
    ["the default wingwall", WINGWALL_DEFAULTS],
    ["active pressure, no skew, light bars that fail", { ...WINGWALL_DEFAULTS, atRest: false, k: 0.28, skew: 0, gEH: 1.5, bars: { bar: 5, spacing: 12 }, exposure: 1 }],
  ] as [string, WingwallInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designWingwall(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      close(c.value("P_{s}\\coloneq", "kip"), r.service.P);
      close(c.value("M_{Au}\\coloneq", "kip*ft"), r.strength.MA);
      close(c.value("M_{Cu}\\coloneq", "kip*ft"), r.strength.MC);
      close(c.value("M_r\\coloneq", "kip*ft/ft"), r.sectionA.flex.MR);
      close(c.value("s_{max}\\coloneq", "in"), r.sectionA.flex.sMax);
      close(c.value("V_r\\coloneq", "kip/ft"), r.sectionA.VR);
      close(c.value("M_{yu}\\coloneq", "kip*ft"), r.sectionB.strength.My);
      close(c.value("T_{zu}\\coloneq", "kip*ft"), r.sectionB.strength.Tz);
      expect(c.checks.filter((x) => x.includes("NG")).length).toBe(r.checks.filter((x) => !x.ok).length);
      expect(c.checks.length).toBe(r.checks.length);
    });
  }
});
