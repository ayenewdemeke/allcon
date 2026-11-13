import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { WORKSHEET_TOLERANCE } from "../calc-style";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import fixtures from "./cdot-bridges.json";
import { DT_DEFAULTS, dtInputsFromBridgeFile, rateDoubleTee, type DtInputs } from "./double-tee";
import { dtRatingCalcLines } from "./double-tee-calc";
import { applyStandard, checkStandard } from "./dt-standard";

// The rating's calc package, worked out by Calcs, agrees with the rating engine.

function workOut(inputs: DtInputs) {
  const lines = dtRatingCalcLines(inputs, "Test bridge");
  const regions = readingOrder(layout(lines, { x: 0, y: 0 }));
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
  return { errors, checks, value, text: lines.flatMap((l) => ("text" in l ? [l.text] : [])).join("\n") };
}

const close = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(Math.max(rel, WORKSHEET_TOLERANCE) * Math.max(1, Math.abs(b)));

/** A bridge built to the 1982 standard's 44 ft, 30'-6" row, with the standard's harped prestress. */
const standardBuilt = (() => {
  const b: DtInputs = {
    ...DT_DEFAULTS,
    bridge: { ...DT_DEFAULTS.bridge, yearBuilt: 1984 },
    span: 44,
    structureLength: 45,
    units: { count: 4, spacing: 91.25, flangeWidth: 91.25, depth: 37, flangeThk: 7, stemSpacing: 60, stemTop: 8, stemBot: 5, exteriorTrimmed: false, layout: null, jointGap: 0 },
    deck: { ...DT_DEFAULTS.deck, present: false },
    roadway: { railToRail: 30.5, railFaceOffset: 15, curbToCurb: 28, curbFaceOffset: 15 },
  };
  return applyStandard(b, checkStandard(b).row!);
})();

const cases: [string, DtInputs][] = [
  ["a bridge built to the 1982 standard", standardBuilt],
  ["the defaults, final tension ignored (BRM 1.7.2)", { ...DT_DEFAULTS, options: { ...DT_DEFAULTS.options, ignoreTension: true } }],
  ["the defaults", DT_DEFAULTS],
  ["the defaults, known strands, shear rated", { ...DT_DEFAULTS, prestress: { mode: "known", strands: 12 }, options: { ...DT_DEFAULTS.options, checkShear: true } }],
  ...(fixtures as unknown as { name: string; bridge: Record<string, unknown> }[]).map((f): [string, DtInputs] => [f.name, dtInputsFromBridgeFile(f.bridge)]),
];

describe("double-tee rating calc package", () => {
  for (const [name, inputs] of cases) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const r = rateDoubleTee(inputs);
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      const hs = r.ratings[0];
      const hsFlex = hs.per.reduce((a, p) => (p.flexInv.inv < a.flexInv.inv ? p : a));
      close(c.value("RF_{inv,HS}\\coloneq"), hsFlex.flexInv.inv);
      close(c.value("RF_{opr,HS}\\coloneq"), hsFlex.flexOpr.opr!);
      close(c.value("P_j\\coloneq", "kip"), r.solve.Pj);
      close(c.value("I_m\\coloneq"), r.impact);
      // Service at the same point and girder.
      const svc = (check: string) => hsFlex.points.find((p) => p.check === check && Math.abs(p.x - hsFlex.flexInv.x) < 1e-9)!.inv;
      if (inputs.options.ignoreTension && inputs.prestress.mode === "back-calculate") expect(c.text).toMatch(/final tension limit is ignored/);
      else close(c.value("RF_{t,HS}\\coloneq"), svc("tension"));
      close(c.value("RF_{c1,HS}\\coloneq"), svc("compression"));
      close(c.value("RF_{c2,HS}\\coloneq"), svc("compression-ll"));
      // Every legal and permit vehicle's operating flexure rating.
      for (const v of r.ratings.slice(1)) {
        const p = v.per.reduce((a, q) => (q.flexOpr.opr! < a.flexOpr.opr! ? q : a));
        const code = { "CO Type 3": "T3", "CO Type 3S2": "T3S2", "CO Type 3-2": "T32", "CO SU6": "SU6", "CO SU7": "SU7", "CO Permit": "PMT", "CO Mod Tandem": "MT" }[v.name] ?? v.name;
        close(c.value(`RF_{opr,${code}}\\coloneq`), p.flexOpr.opr!);
      }
      expect(c.checks.filter((x) => x.includes("NG"))).toEqual([]);
      // No one is credited by name.
      expect(c.text).not.toMatch(/\b[A-Z][a-z]+'s (rule|sheet|era table|approach|model|setup|checklist)/);
      // References are design codes (AASHTO, MBE, CDOT BRM/BDM), never the software or background files.
      const refs = [c.text, ...dtRatingCalcLines(inputs, "Test bridge").flatMap((l) => ("ref" in l && l.ref ? [l.ref] : []))].join("\n");
      expect(refs).not.toMatch(/ALLCON|sample BrR|sample model|BrR model\)|B-17-DL|TELLRD|rating scripts|reference sheet|bridge file|BrR's value|as BrR\b/i);
    });
  }
});
