import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { WORKSHEET_TOLERANCE } from "../calc-style";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { designSign, SIGN_DEFAULTS, type SignInputs } from "./cantilever";
import { signCalcLines } from "./cantilever-calc";

// The calc package, worked out by Calcs, agrees with the design engine.

function workOut(inputs: SignInputs) {
  const regions = readingOrder(layout(signCalcLines(inputs, "Test sign"), { x: 0, y: 0 }));
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

describe("cantilever sign calc package", () => {
  for (const [name, inputs] of [
    ["the default sign", SIGN_DEFAULTS],
    ["a big panel in high wind on a small shaft", { ...SIGN_DEFAULTS, V: 150, signLength: 14, signHeight: 10, signOffset: 13, armLength: 20, shaftD: 24, bars: 8, tieSpacing: 24 }],
  ] as [string, SignInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designSign(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      close(c.value("p_s\\coloneq", "psf"), r.wind.qSign);
      close(c.value("M_W\\coloneq", "kip*ft"), r.wind.Mx);
      close(c.value("T_W\\coloneq", "kip*ft"), r.wind.T);
      close(c.value("d_v\\coloneq", "in"), r.shaft.dv);
      expect(c.checks.filter((x) => x.includes("NG")).length).toBe(r.checks.filter((x) => !x.ok).length);
      expect(c.checks.length).toBe(r.checks.length);
    });
  }
});
