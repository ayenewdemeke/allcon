import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { designZone1, ZONE1_DEFAULTS, type Zone1Inputs } from "./zone1";
import { zone1CalcLines } from "./zone1-calc";

// The calc package, worked out by Calcs, agrees with the design engine.

function workOut(inputs: Zone1Inputs) {
  const regions = readingOrder(layout(zone1CalcLines(inputs, "Test bridge"), { x: 0, y: 0 }));
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

describe("seismic zone 1 calc package", () => {
  for (const [name, inputs] of [
    ["the default bridge", ZONE1_DEFAULTS],
    ["As < 0.05, the column's spirals too far apart, live load during the quake", { ...ZONE1_DEFAULTS, As: 0.04, gammaEQ: 0.5, supports: ZONE1_DEFAULTS.supports.map((s) => ({ ...s, LL: 100 })), columns: [{ ...ZONE1_DEFAULTS.columns[0], pitch: 5 }] }],
  ] as [string, Zone1Inputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designZone1(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      close(c.value("F_L\\coloneq", "kip"), r.connections[1].longPerBearing);
      close(c.value("F_{T1}\\coloneq", "kip"), r.connections[0].transPerBearing);
      close(c.value("N_{1}\\coloneq", "in"), r.supports[0].N);
      close(c.value("\\rho_{s1}\\coloneq"), r.columns[0].rho);
      expect(c.checks.filter((x) => x.includes("NG")).length).toBe(r.checks.filter((x) => !x.ok).length);
      expect(c.checks.length).toBe(r.checks.length);
    });
  }
});
