import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { CIP_DEFAULTS, designCipWall, type CipInputs } from "./cip";
import { cipCalcLines } from "./cip-calc";

// The calc package, worked out by Calcs, agrees with the design engine: two separate
// implementations of the same design.

function workOut(inputs: CipInputs) {
  const regions = readingOrder(layout(cipCalcLines(inputs, "Test wall"), { x: 0, y: 0 }));
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

describe("CIP wall calc package", () => {
  for (const [name, inputs] of [
    ["the sheet's wall", CIP_DEFAULTS],
    ["a taller wall with batters, backslope, live load, pavement and toe fill", { ...CIP_DEFAULTS, He: 9, Df: 3, B: 84, A: 24, D: 18, Tt: 12, frontBatter: 0.25, backBatter: 0.5, backslope: 3, liveLoad: true, pavementThickness: 6, kpOverride: null, stemBars: { bar: 6, spacing: 8 } }],
  ] as [string, CipInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designCipWall(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      close(c.value("K_a\\coloneq"), r.soil.Ka);
      close(c.value("P_a\\coloneq", "kip/ft"), r.loads.Pa);
      close(c.value("V_{Ib}\\coloneq", "kip/ft"), r.groups.StrIb.V);
      close(c.value("M_{VIb}\\coloneq", "kip*ft/ft"), r.groups.StrIb.MV);
      close(c.value("\\sigma_{IV}\\coloneq", "ksf"), r.checks.find((x) => x.id === "brg-StrIV")!.demand);
      close(c.value("M_{ust}\\coloneq", "kip*ft/ft"), r.stem.Mu);
      close(c.value("M_{rst}\\coloneq", "kip*ft/ft"), r.stem.flex.MR);
      close(c.value("M_{crst}\\coloneq", "kip*ft/ft"), r.stem.flex.Mcr);
      close(c.value("s_{maxst}\\coloneq", "in"), r.stem.flex.sMax);
      close(c.value("V_{rst}\\coloneq", "kip/ft"), r.stem.shear.VR);
      close(c.value("M_{uhe}\\coloneq", "kip*ft/ft"), r.heel.Mu);
      close(c.value("M_{rto}\\coloneq", "kip*ft/ft"), r.toe.flex.MR);
      close(c.value("M_{uto}\\coloneq", "kip*ft/ft"), r.toe.Mu);
      close(c.value("R_{ep}\\coloneq", "kip/ft"), r.stability.key.Rep);
      close(c.value("R_{RIa}\\coloneq", "kip/ft"), r.stability.key.StrIa.RR);
      close(c.value("M_{rk}\\coloneq", "kip*ft/ft"), r.keyDesign!.flex.MR);
      // The worksheet's OK/NG lines agree with the engine's checks.
      const failing = c.checks.filter((x) => x.includes("NG")).length;
      expect(failing).toBe(r.checks.filter((x) => !x.ok && !x.id.endsWith("-temp") && x.id !== "stem-noStirrups").length);
    });
  }
});
