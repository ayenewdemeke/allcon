import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { designMseWall, MSE_DEFAULTS, type MseInputs } from "./mse";
import { mseCalcLines } from "./mse-calc";

// The calc package, worked out by Calcs, agrees with the design engine.

function workOut(inputs: MseInputs) {
  const regions = readingOrder(layout(mseCalcLines(inputs, "Test wall"), { x: 0, y: 0 }));
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

describe("MSE wall calc package", () => {
  for (const [name, inputs] of [
    ["the default wall (geogrid, backslope, live load, seismic)", MSE_DEFAULTS],
    ["a level wall with ribbed steel strips", { ...MSE_DEFAULTS, backslope: 0, reinforcement: "steelstrip", wallType: "wall", H: 24, L: 17 }],
    ["a steel grid wall without live load or seismic", { ...MSE_DEFAULTS, reinforcement: "steelgrid", liveLoad: false, seismic: false, delta: 10 }],
    ["a geosynthetic strip wall that fails", { ...MSE_DEFAULTS, reinforcement: "geostrip", L: 12, Tal: 3 }],
  ] as [string, MseInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = designMseWall(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      close(c.value("K_a\\coloneq"), r.soil.Ka);
      close(c.value("P_{EH}\\coloneq", "kip/ft"), r.loads.PEH);
      for (const [key, g] of [["Imax", r.groups.StrMax], ["Imin", r.groups.StrMin], ["EEmax", r.groups.EEMax], ["EEmin", r.groups.EEMin]] as const) {
        if (!g) continue;
        close(c.value(`V_{${key}}\\coloneq`, "kip/ft"), g.V);
        close(c.value(`H_{${key}}\\coloneq`, "kip/ft"), g.H);
        close(c.value(`M_{${key}}\\coloneq`, "kip*ft/ft"), g.M);
        close(c.value(`\\sigma_{${key}}\\coloneq`, "ksf"), g.sigma);
      }
      if (inputs.seismic) close(c.value("K_{AE}\\coloneq"), r.soil.KAE!);
      r.internal.layers.forEach((l, idx) => {
        const k = idx + 1;
        close(c.value(`T_{${k}}\\coloneq`, "kip/ft"), l.Tstr);
        close(c.value(`L_{A${k}}\\coloneq`, "ft"), l.LA);
        close(c.value(`P_{r${k}}\\coloneq`, "kip/ft"), l.Pr);
        if (inputs.seismic) {
          close(c.value(`T_{ee${k}}\\coloneq`, "kip/ft"), l.Tee);
          close(c.value(`P_{rEE${k}}\\coloneq`, "kip/ft"), l.PrEE);
        }
      });
      close(c.value("T_r\\coloneq", "kip/ft"), r.internal.layers[0].Tr);
      close(c.value("p_u\\coloneq", "ksf"), r.panel.pu);
      for (const [k, p] of [["vp", r.panel.vertPos], ["vn", r.panel.vertNeg], ["hp", r.panel.horPos], ["hn", r.panel.horNeg]] as const) {
        close(c.value(`M_{r${k}}\\coloneq`, "kip*ft/ft"), p.MR);
        close(c.value(`s_{max${k}}\\coloneq`, "in"), p.sMax);
      }
      close(c.value("V_{rv}\\coloneq", "kip/ft"), r.panel.shear[0].Vr);
      // Failing lines: none when the engine passes; some when it doesn't.
      const failing = c.checks.filter((x) => x.includes("NG")).length;
      expect(failing === 0).toBe(r.ok);
    });
  }
});
