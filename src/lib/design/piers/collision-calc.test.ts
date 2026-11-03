import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { COLLISION_DEFAULTS, designCollision, type CollisionInputs } from "./collision";
import { collisionCalcLines } from "./collision-calc";

// The calc package, worked out by Calcs, agrees with the design engine.

function workOut(inputs: CollisionInputs) {
  const regions = readingOrder(layout(collisionCalcLines(inputs, "Test column"), { x: 0, y: 0 }));
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

describe("pier collision calc package", () => {
  for (const [name, inputs] of [
    ["the default column", COLLISION_DEFAULTS],
    ["forces from a frame analysis, a light column that fails", { ...COLLISION_DEFAULTS, useFrame: true, Vu: 700, Mu: 4000, D: 36, bars: 12, bar: 8, tieSpacing: 30, phiV: 0.9 }],
  ] as [string, CollisionInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designCollision(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      close(c.value("V_u\\coloneq", "kip"), r.Vu);
      close(c.value("d_v\\coloneq", "in"), r.shear.dv);
      close(c.value("V_n\\coloneq", "kip"), r.shear.Vn);
      expect(c.checks.filter((x) => x.includes("NG")).length).toBe(r.checks.filter((x) => !x.ok).length);
      expect(c.checks.length).toBe(r.checks.length);
    });
  }
});
