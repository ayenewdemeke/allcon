import type { Unit } from "mathjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { MAX_DECIMALS, WORKSHEET_TOLERANCE } from "../calc-style";
import { girderInputs } from "../kinds";
import { girderSide } from "./cap-loads";
import { nodeLpSolver } from "./lp-node";
import { designStm, STM_DEFAULTS, type StmInputs } from "./strut-tie";
import { stmCalcLines } from "./strut-tie-calc";
import { ABUTMENT_DEFAULTS, buildTemplate, HAMMERHEAD_DEFAULTS } from "./templates";
import type { Line } from "@/lib/calcs/library/templates";
import { fitsAcross, mathChars } from "@/lib/calcs/library/fit";
import { detailCap } from "./detail";
import { stmPackageLines, stmPayLines, stmQuantityLines } from "./package";
import { sectionalDesign } from "./sectional";

// The calc package, worked out by Calcs, agrees with the design engine, and follows the house
// style: three decimals at most and references to design codes only.

/** Lines worked out in Calcs: its errors, and a value by the start of its region. */
function workLines(lines: Line[]) {
  const regions = readingOrder(layout(lines, { x: 0, y: 0 }));
  const items = regions.flatMap((x): SheetItem[] => (x.kind === "text" || x.kind === "image" ? [] : [x as SheetItem]));
  const values = new Map<string, Value>();
  const results = evaluateSheet(items, DEFAULT_SETTINGS, values);
  const errors = regions.flatMap((x) => (results.get(x.id)?.kind === "error" ? [`${x.kind === "math" ? x.latex : x.kind}: ${(results.get(x.id) as { message: string }).message}`] : []));
  const value = (start: string, unit?: string) => {
    const x = regions.find((y) => y.kind === "math" && y.latex.startsWith(start));
    if (!x) throw new Error(`No region ${start}`);
    const v = values.get(x.id);
    return unit ? (v as Unit).toNumber(unit) : (v as number);
  };
  return { errors, value };
}

async function workOut(inputs: StmInputs) {
  const r = await designStm(inputs, nodeLpSolver);
  const lines = stmCalcLines(inputs, r, "Test cap");
  const regions = readingOrder(layout(lines, { x: 0, y: 0 }));
  const items = regions.flatMap((x): SheetItem[] => (x.kind === "text" || x.kind === "image" ? [] : [x as SheetItem]));
  const values = new Map<string, Value>();
  const results = evaluateSheet(items, DEFAULT_SETTINGS, values);
  const errors = regions.flatMap((x) => (results.get(x.id)?.kind === "error" ? [`${x.kind === "math" ? x.latex : x.kind}: ${(results.get(x.id) as { message: string }).message}`] : []));
  const checks = regions.filter((x) => x.kind === "math" && x.latex.startsWith("\\operatorname{if}")).map((x) => (results.get(x.id) as { result?: string }).result ?? "");
  const value = (start: string, unit?: string) => {
    const x = regions.find((y) => y.kind === "math" && y.latex.startsWith(start));
    if (!x) throw new Error(`No region ${start}`);
    const v = values.get(x.id);
    return unit ? (v as Unit).toNumber(unit) : (v as number);
  };
  return { r, lines, errors, checks, value };
}

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(WORKSHEET_TOLERANCE * Math.max(1, Math.abs(b)));
const hooked: StmInputs = { ...STM_DEFAULTS, grid: { ...STM_DEFAULTS.grid, provided: false }, ties: STM_DEFAULTS.ties.map((t) => (t.member === "B-C" ? { ...t, ends: [{ ...t.ends[0], kind: "hook", coating: "epoxy" }] } : t)) };

const girders = girderInputs({});
const fromGirders: StmInputs = {
  ...STM_DEFAULTS,
  girders: { enabled: true, back: girderSide({ ...girders, nGirders: 4, S: 6, overhang: 3, barrierWidth: 1.5 }, 0, "b", "Back"), ahead: null, x0: 14.21, reverse: false, loadNodes: ["B", "C"], selfWeight: true, soffit: 0, wc: 0.15 },
};

describe("strut-and-tie calc package", () => {
  for (const [name, inputs] of [
    ["the default bent cap", STM_DEFAULTS],
    ["hooked epoxy bars with no grid", hooked],
    ["loads from a girder design, lanes placed across the cap", fromGirders],
  ] as [string, StmInputs][]) {
    it(`works out ${name} with no errors, matching the engine`, async () => {
      const c = await workOut(inputs);
      expect(c.errors).toEqual([]);
      expect(c.checks.length).toBe(c.r.checks.length);
      expect(c.checks.filter((x) => x.includes("NG")).length).toBe(c.r.checks.filter((x) => !x.ok).length);
      const bc = c.r.ties.findIndex((t) => t.member === "B-C");
      close(c.value(`P_{rt${bc + 1}}\\coloneq`, "kip"), c.r.ties[bc].capacity);
      close(c.value(`l_{req${bc + 1}a}\\coloneq`, "in"), c.r.ties[bc].ends[0].required);
      c.r.faces.forEach((f, k) => close(c.value(`P_{rn${k + 1}}\\coloneq`, "kip"), f.capacity));
      if (c.r.service) close(c.value("V_{cr}\\coloneq", "kip"), c.r.service.Vcr);
    });
  }

  it("works out a standard cap's geometry, anchorage and service screens from the girders", async () => {
    const link = { enabled: true, back: girderSide({ ...girders, nGirders: 6, S: 8, overhang: 3.5, barrierWidth: 1.5 }, 0, "b", "Girders"), ahead: null, x0: 21.5, reverse: false, loadNodes: [], selfWeight: true, soffit: 0, wc: 0.15 };
    const inputs = buildTemplate({ ...HAMMERHEAD_DEFAULTS, length: 43, bearings: [1.5, 9.5, 17.5, 25.5, 33.5, 41.5].map((x) => ({ x, P: 0 })) }, { ...STM_DEFAULTS, fc: 4.5, girders: link });
    const c = await workOut(inputs);
    expect(c.errors).toEqual([]);
    // Every check but the geometry ones (written as text) is worked out, with the same verdict.
    const worked = c.r.checks.filter((x) => !x.id.startsWith("fit-"));
    expect(c.checks.length).toBe(worked.length);
    expect(c.checks.filter((x) => x.includes("NG")).length).toBe(worked.filter((x) => !x.ok).length);
    c.r.faces.forEach((f, k) => close(c.value(`P_{rn${k + 1}}\\coloneq`, "kip"), f.capacity));
    c.r.services.forEach((s, k) => close(c.value(`V_{cr${k + 1}}\\coloneq`, "kip"), s.Vcr));
    const texts = c.lines.flatMap((l) => ("math" in l ? [l.math, l.ref ?? ""] : "text" in l ? [l.text] : []));
    expect(texts.join(" ")).not.toMatch(/allcon|fhwa|example/i);
    expect(texts.some((t) => t.startsWith("Strut "))).toBe(true);
  });

  for (const [name, inputs] of [
    ["the default hammerhead (bottom strut at a/2)", buildTemplate(HAMMERHEAD_DEFAULTS, STM_DEFAULTS)],
    ["the cantilever bent of the hammerhead layout's benchmark", buildTemplate({ ...HAMMERHEAD_DEFAULTS, length: 28.42, depth: 8.5, tipDepth: 8.5, capWidth: 96, columns: [5], columnWidth: 10, topCover: 5.16, columnBarInset: 8, bearings: [{ x: 6.97, P: 2005 }, { x: 22.99, P: 926 }], bearingLength: 48.2, bearingWidth: 48.2 }, { ...STM_DEFAULTS, fc: 6 })],
  ] as [string, StmInputs][])
    it(`works out ${name} with no errors, matching the engine`, async () => {
      const c = await workOut(inputs);
      expect(c.errors).toEqual([]);
      const worked = c.r.checks.filter((x) => !x.id.startsWith("fit-"));
      expect(c.checks.length).toBe(worked.length);
      expect(c.checks.filter((x) => x.includes("NG")).length).toBe(worked.filter((x) => !x.ok).length);
      c.r.faces.forEach((f, k) => close(c.value(`P_{rn${k + 1}}\\coloneq`, "kip"), f.capacity));
    });

  it("with the sectional design of its B-Regions and its details: works out with no errors, matching the engine", async () => {
    const t = { ...HAMMERHEAD_DEFAULTS, length: 70, depth: 6, tipDepth: 4, columns: [35], bearings: [{ x: 4, P: 300 }, { x: 15, P: 300 }, { x: 55, P: 300 }, { x: 66, P: 300 }] };
    const inputs = { ...buildTemplate(t, STM_DEFAULTS), sectional: true };
    const r = await designStm(inputs, nodeLpSolver);
    const sec = sectionalDesign(inputs, r);
    const lines = stmPackageLines(inputs, r, "Test cap");
    const c = workLines(lines);
    expect(c.errors).toEqual([]);
    const flex = sec.sections.filter((q) => q.region === "Left arm").reduce((p, q) => (q.Mu / q.Mr > p.Mu / p.Mr ? q : p));
    close(c.value("M_{nx1}\\coloneq", "kip*ft"), flex.Mn);
    const v = sec.sections.filter((q) => q.region === "Left arm" && q.shear).reduce((p, q) => (q.Vu / q.Vr > p.Vu / p.Vr ? q : p));
    close(c.value("V_{nv1}\\coloneq", "kip"), v.Vn);
    const texts = lines.flatMap((l) => ("math" in l ? [l.math, l.ref ?? ""] : "text" in l ? [l.text] : []));
    expect(texts.join(" ")).not.toMatch(/allcon|fhwa|example/i);
    // Every line fits on the page (and the quantity sheet's too).
    const tooWide = (ls: Line[]) => ls.flatMap((l) => ("math" in l && !fitsAcross(l.math) ? [`${mathChars(l.math)}: ${l.math.slice(0, 90)}`] : []));
    expect(tooWide(lines)).toEqual([]);
    expect(tooWide(stmQuantityLines(inputs, "Test cap"))).toEqual([]);
  });

  it("the quantity sheet works out the schedule's weights and the concrete", () => {
    const inputs = buildTemplate(HAMMERHEAD_DEFAULTS, STM_DEFAULTS);
    const d = detailCap(inputs);
    const q = stmQuantityLines({ ...inputs, payItems: { agency: "cdot", concrete: "601-03040", rebar: "602-00020" } }, "Test cap");
    const c = workLines(q);
    expect(c.errors).toEqual([]);
    // The summary of approximate quantities by CDOT pay item, in columns as CDOT's quantity sets carry it.
    const table = q.flatMap((l) => ("region" in l && l.region.kind === "image" ? [l.region.svg] : [])).find((s) => s.includes("Item No."))!;
    for (const s of ["601-03040", "Concrete Class D (Bridge)", "602-00020", "Reinforcing Steel (Epoxy Coated)", "Description", "Quantity", "Unit"]) expect(table).toContain(`>${s}</text>`);
    close(c.value("W_{rebar}\\coloneq", "lb"), d.schedule.total);
    close(c.value("V_{conc}\\coloneq", "yd^3"), d.schedule.concreteTotal);
    // A pier's excavation and backfill are around its columns: the Pier Column tool's, not the cap's.
    expect(table).not.toContain("206-00000");
  });

  it("an abutment cap's excavation and backfill follow M-206-2", () => {
    const inputs = buildTemplate(ABUTMENT_DEFAULTS, STM_DEFAULTS);
    const d = detailCap(inputs);
    const { lines } = stmPayLines({ ...inputs, payItems: { agency: "cdot", concrete: "601-03040", rebar: "602-00020", ground: 3.5 } }, d);
    const q = (code: string) => lines.find((l) => l.code === code)?.quantity;
    expect(q("206-00000")).toBe(Number(((8.5 * 47 * 3.5) / 27).toFixed(1)));
    expect(q("206-00100")).toBe(Number(((4 * 44 * 3.5) / 27).toFixed(1)));
    expect(q("206-00360")).toBe(q("206-00100"));
    expect(q("206-00200")).toBe(Number(((8.5 * 47 * 3.5 - 3 * 44 * 3.5 - 4 * 44 * 3.5) / 27).toFixed(1)));
    // Refill chosen as Class 1 adds to the zone's Class 1 under one line.
    const one = stmPayLines({ ...inputs, payItems: { agency: "cdot", concrete: "601-03040", rebar: "602-00020", ground: 3.5, refill: "206-00100" } }, d).lines;
    expect(one.filter((l) => l.code === "206-00100")).toHaveLength(1);
    const c = workLines(stmQuantityLines(inputs, "Abutment 1"));
    expect(c.errors).toEqual([]);
  });

  it("follows the house style", async () => {
    const { lines } = await workOut(STM_DEFAULTS);
    const long = new RegExp(String.raw`(?<![\^{\w])\d+\.\d{${MAX_DECIMALS + 1},}`, "g");
    const texts = lines.flatMap((l) => ("math" in l ? [l.math, l.ref ?? ""] : "text" in l ? [l.text] : []));
    expect(texts.flatMap((t) => (t.match(long) ?? []).filter((m) => m !== "0.0632"))).toEqual([]);
    expect(texts.join(" ")).not.toMatch(/allcon|fhwa|example/i);
    expect(lines.some((l) => "text" in l && l.newPage)).toBe(true);
  });
});
