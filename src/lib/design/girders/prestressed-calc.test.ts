import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { WORKSHEET_TOLERANCE } from "../calc-style";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { designGirder, GIRDER_DEFAULTS, type GirderInputs } from "./prestressed";
import { girderCalcLines } from "./prestressed-calc";

// The calc package, worked out by Calcs, agrees with the design engine.

function workOut(inputs: GirderInputs) {
  const regions = readingOrder(layout(girderCalcLines(inputs, "Test girder"), { x: 0, y: 0 }));
  const items = regions.flatMap((r): SheetItem[] => (r.kind === "text" || r.kind === "image" ? [] : [r as SheetItem]));
  const values = new Map<string, Value>();
  const results = evaluateSheet(items, DEFAULT_SETTINGS, values);
  const errors = regions.flatMap((r) => (results.get(r.id)?.kind === "error" ? [`${r.kind === "math" ? r.latex : r.kind}: ${(results.get(r.id) as { message: string }).message}`] : []));
  const checks = regions.filter((r) => r.kind === "math" && r.latex.startsWith("\\operatorname{if}")).map((r) => (results.get(r.id) as { result?: string }).result ?? "");
  const value = (start: string, unit?: string) => {
    // The last definition (M_u is redefined as the larger of Strength I and II under CDOT criteria).
    const r = regions.findLast((x) => x.kind === "math" && x.latex.startsWith(start));
    if (!r) throw new Error(`No region ${start}`);
    const v = values.get(r.id);
    return unit ? (v as Unit).toNumber(unit) : (v as number);
  };
  return { errors, checks, value };
}

// The section's properties go in rounded (I to 0.1 in⁴), so agreement is to about 1e-5.
const close = (a: number, b: number, rel = 1e-5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(rel, WORKSHEET_TOLERANCE) * Math.max(1, Math.abs(b)));

describe("girder calc package", () => {
  for (const [name, inputs] of [
    ["the default BT-72: harped strands, refined losses with elastic gains", GIRDER_DEFAULTS],
    ["a skewed CBT 72 with the haunch in the section", { ...GIRDER_DEFAULTS, shape: "cbt-72", skew: 40, haunchInSection: true, S: 9, overhang: 4.5, harped: { count: 8, yEnd: 66, yHarp: 6, harpPoint: 0.4 } }],
    ["an AASHTO Type IV, 80 ft, straight strands, approximate losses", { ...GIRDER_DEFAULTS, shape: "aashto-iv", L: 80, S: 6, nGirders: 7, overhang: 3, barriersOnExterior: true, losses: "approximate", elasticGain: false, harped: { ...GIRDER_DEFAULTS.harped, count: 0 }, strands: [{ y: 2, count: 10 }, { y: 4, count: 10 }, { y: 6, count: 4 }] }],
    ["a BT-72 with debonded strands, refined losses without gains, LL deflection", { ...GIRDER_DEFAULTS, elasticGain: false, llDeflection: true, harped: { ...GIRDER_DEFAULTS.harped, count: 0 }, strands: [{ y: 2, count: 12, debonded: 4, debondLength: 10 }, { y: 4, count: 12, debonded: 2, debondLength: 20 }, { y: 6, count: 8 }] }],
    ["two 120 ft spans made continuous, all restraint moments", { ...GIRDER_DEFAULTS, extraSpans: [{ L: 120, strands: null, harped: null }], pierBars: { ...GIRDER_DEFAULTS.pierBars, topBar: 8, topSpacing: 5 } }],
    ["three spans 100–130–100 ft, the middle span's own strands, positive restraint only", { ...GIRDER_DEFAULTS, L: 100, restraintMoments: "positive", extraSpans: [{ L: 130, strands: [{ y: 2, count: 14 }, { y: 4, count: 14 }, { y: 6, count: 6 }], harped: { count: 10, yEnd: 64, yHarp: 6, harpPoint: 0.4 } }, { L: 100, strands: null, harped: null }] }],
    ["CDOT criteria: a simple 120 ft span (permit at Strength II)", { ...GIRDER_DEFAULTS, criteria: "cdot", humidity: 55 }],
    ["CDOT criteria: three spans 100–130–100 ft, girders 90 days old (continuous)", { ...GIRDER_DEFAULTS, criteria: "cdot", L: 100, extraSpans: [{ L: 130, strands: [{ y: 2, count: 14 }, { y: 4, count: 14 }, { y: 6, count: 6 }], harped: { count: 10, yEnd: 64, yHarp: 6, harpPoint: 0.4 } }, { L: 100, strands: null, harped: null }] }],
    ["CDOT criteria: the same, enveloped with simple spans", { ...GIRDER_DEFAULTS, criteria: "cdot", continuity: "envelope", L: 100, extraSpans: [{ L: 130, strands: [{ y: 2, count: 14 }, { y: 4, count: 14 }, { y: 6, count: 6 }], harped: { count: 10, yEnd: 64, yHarp: 6, harpPoint: 0.4 } }, { L: 100, strands: null, harped: null }] }],
  ] as [string, GirderInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, () => {
      const d = designGirder(inputs);
      const g = d[d.controlling];
      const c = workOut(inputs);
      expect(c.errors).toEqual([]);
      if (d.continuous) {
        const gov = d.piers.map((p) => d.spans[p.index - 1][d.controlling].stations.find((s) => s.pier && s.x > 1e-6)!).reduce((a, b) => (b.negative!.Mu < a.negative!.Mu ? b : a));
        close(c.value("M_{un}\\coloneq", "kip*ft"), -gov.negative!.Mu, 1e-5);
        // The section over the piers is the same in every span (one girder shape, one set of deck bars).
        close(c.value("M_{nn}\\coloneq", "kip*ft"), g.negativeSection!.Mn, 1e-4);
        close(c.value("\\phi_n\\coloneq"), g.negativeSection!.phi, 1e-6);
      }
      close(c.value("I_c\\coloneq", "in^4"), g.comp.I);
      close(c.value("g_M\\coloneq"), g.df.moment);
      close(c.value("g_V\\coloneq"), g.df.shear);
      close(c.value("f_{pt}\\coloneq", "ksi"), g.losses.fpt, 1e-5);
      close(c.value("f_{pe}\\coloneq", "ksi"), g.losses.fpe, 1e-5);
      close(c.value("\\Delta_{pLT}\\coloneq", "ksi"), g.losses.dLT, 1e-5);
      const mid = g.stations.find((s) => Math.abs(s.x - g.L / 2) < 1e-6)!;
      close(c.value("M_u\\coloneq", "kip*ft"), mid.Mu, 1e-5);
      close(c.value("f_{b3}\\coloneq", "ksi"), mid.service.botIII, 1e-5);
      close(c.value("f_{tt}\\coloneq", "ksi"), mid.service.topTotal, 1e-5);
      close(c.value("M_n\\coloneq", "kip*ft"), g.flexMid.Mn, 2e-3);
      close(c.value("C_d\\coloneq", "in"), g.camber.cDeck, 1e-5);
      // Phase 4: fatigue at midspan, splitting, and lifting and hauling without impact or wind.
      close(c.value("f_{fat}\\coloneq", "ksi"), mid.fatigue.top, 1e-5);
      close(c.value("P_{rs}\\coloneq", "kip"), g.splitting.Pr, 1e-5);
      const L = g.handling!.lifting;
      close(c.value("z_{oL}\\coloneq", "in"), L.zo, 1e-4);
      close(c.value("\\theta_{eL}\\coloneq"), L.cases[0].winds[0].thetaEq, 1e-4);
      close(c.value("FS_{fL}\\coloneq"), L.failure[0][0].FSf, 1e-4);
      const S = g.handling!.hauling.superelevation;
      close(c.value("\\theta_{eH}\\coloneq"), S.cases[0].winds[0].thetaEq, 1e-4);
      close(c.value("FS_{rH}\\coloneq"), S.failure[0][0].FSr, 1e-4);
      close(c.value("FS_{fH}\\coloneq"), S.failure[0][0].FSf, 1e-4);
      const minScr = (secs: { corners: { byCase: { byWind: { fscr: number }[] }[] }[] }[]) => Math.min(...secs.flatMap((s) => s.corners.map((k) => k.byCase[0].byWind[0].fscr)));
      if (Number.isFinite(minScr(L.sections)) && minScr(L.sections) > 0) close(c.value("FS_{cL}\\coloneq"), minScr(L.sections), 1e-4);
      if (Number.isFinite(minScr(S.sections)) && minScr(S.sections) > 0) close(c.value("FS_{cH}\\coloneq"), minScr(S.sections), 1e-4);
      expect(c.checks.every((x) => x.includes("OK") || x.includes("NG"))).toBe(true);
    });
  }
});
