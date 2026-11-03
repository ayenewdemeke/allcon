import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { designStripSeal, STRIP_SEAL_DEFAULTS, type StripSealInputs } from "./strip-seal";
import { stripSealCalcLines } from "./strip-seal-calc";

// The calc package, worked out by Calcs, agrees with the design engine.

function workOut(inputs: StripSealInputs) {
  const regions = readingOrder(layout(stripSealCalcLines(inputs, "Test joint"), { x: 0, y: 0 }));
  const items = regions.flatMap((r): SheetItem[] => (r.kind === "text" ? [] : [r as SheetItem]));
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

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(b)));

describe("strip seal calc package", () => {
  for (const [name, inputs] of [
    ["the default joint", STRIP_SEAL_DEFAULTS],
    ["a steel bridge installed warm, under the installation opening", { ...STRIP_SEAL_DEFAULTS, alpha: 6.5e-6, creepShrink: 0, Ti: 90, L: 250 }],
  ] as [string, StripSealInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designStripSeal(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      close(c.value("\\Delta_{tot}\\coloneq", "in"), r.total);
      close(c.value("A\\coloneq", "in"), r.design.A);
      close(c.value("W\\coloneq", "in"), r.design.W);
      expect(c.checks.filter((x) => x.includes("NG")).length).toBe(r.checks.filter((x) => !x.ok).length);
      expect(c.checks.length).toBe(r.checks.length);
    });
  }
});
