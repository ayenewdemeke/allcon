import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { CBC_DEFAULTS, designCbc, type CbcInputs } from "./cbc";
import { cbcCalcLines } from "./cbc-calc";

// The calc package, worked out by Calcs, agrees with the design engine.

function workOut(inputs: CbcInputs) {
  const regions = readingOrder(layout(cbcCalcLines(inputs, "Test culvert"), { x: 0, y: 0 }));
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

describe("Box culvert calc package", () => {
  for (const [name, inputs] of [
    ["the defaults (bars, cast in place)", CBC_DEFAULTS],
    ["the MnDOT example (precast, welded wire)", { ...CBC_DEFAULTS, construction: "precast", phiF: 1.0, phiV: 0.9, reinf: "wwr", fy: 65 }],
    ["two cells under shallow fill", { ...CBC_DEFAULTS, cells: 2, span: 16, rise: 8, Tt: 12, Tb: 12, fill: 1.5 }],
    ["three cells, no water, deep fill", { ...CBC_DEFAULTS, cells: 3, span: 8, rise: 6, fill: 14, water: false }],
    ["an under-reinforced box", { ...CBC_DEFAULTS, bars: { ...CBC_DEFAULTS.bars, topIn: { bar: 4, spacing: 8 }, wallOut: { bar: 4, spacing: 12 } } }],
  ] as [string, CbcInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designCbc(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      close(c.value("EV\\coloneq", "klf"), r.loads.EV);
      close(c.value("DC_{bot}\\coloneq", "klf"), r.loads.DCbottom);
      if (inputs.liveLoad) {
        close(c.value("w_{td}\\coloneq", "ksf"), r.live.vehicles.find((v) => v.id === "tandem")!.w);
        close(c.value("w_{tr}\\coloneq", "ksf"), r.live.vehicles.find((v) => v.id === "truck")!.w);
      }
      for (const g of r.governs) {
        const k = `${g.kind[0]}${g.key[0]}`;
        close(Math.abs(c.value(`M_{u${k}}\\coloneq`, "kip*in")), g.flex.Mu * 12);
        close(c.value(`M_{r${k}}\\coloneq`, "kip*in"), g.flex.flex.Mr * 12);
        close(c.value(`A_{q${k}}\\coloneq`, "in^2"), g.flex.flex.AsReq);
        if (g.crack) {
          close(c.value(`f_{s${k}}\\coloneq`, "ksi"), g.crack.crack!.fs);
          close(c.value(`f_{ss${k}}\\coloneq`, "ksi"), g.crack.crack!.fss);
        }
      }
      for (const g of ["t", "b", "w", "i"]) {
        const s = r.checks.find((x) => x.id.startsWith(`${({ t: "top", b: "bottom", w: "wall", i: "iwall" } as const)[g as "t"]}-shear`));
        if (s) close(c.value(`V_{r${g}v}\\coloneq`, "kip"), s.capacity);
      }
      const failing = c.checks.filter((x) => x.includes("NG")).length;
      expect(failing === 0).toBe(r.ok);
    });
  }
});
