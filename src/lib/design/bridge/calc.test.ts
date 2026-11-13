import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem } from "@/lib/calcs/evaluate";
import { layout, type Line } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { designApproachSlab } from "../approach/approach-slab";
import { approachSlabCalcLines } from "../approach/approach-slab-calc";
import { designBearing } from "../bearings/elastomeric";
import { bearingCalcLines } from "../bearings/elastomeric-calc";
import { designDeck } from "../decks/deck";
import { deckCalcLines } from "../decks/deck-calc";
import { foundationCalcLines } from "../foundations/calc";
import { abutmentInputs, footingInputs } from "../foundations/kinds";
import { runFoundation } from "../foundations/run";
import { girderCalcLines } from "../girders/prestressed-calc";
import { approachSlabInputs, bearingInputs, deckInputs, wingwallInputs } from "../kinds";
import { columnInputs, designColumn } from "../piers/column";
import { columnCalcLines } from "../piers/column-calc";
import { columnLinkFrom } from "../piers/column-link";
import { nodeLpSolver } from "../stm/lp-node";
import { stmPackageLines } from "../stm/package";
import { designStm, stmInputs } from "../stm/strut-tie";
import { takeoffFor, takeoffPayLines } from "../takeoff";
import { designWingwall } from "../walls/wingwall";
import { wingwallCalcLines } from "../walls/wingwall-calc";
import { BRIDGE_DEFAULTS, runBridge, type BridgeInputs } from "./bridge";
import { bridgeCalcLines, soqRows, type CalcPart, type SupportCalc } from "./calc";
import { bridgeIfc } from "./ifc";
import { abutmentFromBridge, approachSlabFromBridge, bearingFromBridge, capFromBridge, columnFromBridge, deckFromBridge, footingFromColumn, wingwallFromBridge } from "./loadpath";
import { renderBridgeSvg } from "./render3d";

// The Bridge's whole calc package, built from the default bridge's components as the Bridge sets them:
// laid out and worked out as one worksheet, with every component's checks coming out as they do alone.

function workOut(lines: Line[]) {
  const regions = readingOrder(layout(lines, { x: 0, y: 0 }));
  const items = regions.flatMap((r): SheetItem[] => (r.kind === "text" || r.kind === "image" ? [] : [r as SheetItem]));
  const results = evaluateSheet(items, DEFAULT_SETTINGS, new Map());
  const errors = regions.flatMap((r) => (results.get(r.id)?.kind === "error" ? [`${r.kind === "math" ? r.latex.slice(0, 60) : r.kind}: ${(results.get(r.id) as { message: string }).message}`] : []));
  const checks = regions.filter((r) => r.kind === "math" && r.latex.startsWith("\\operatorname{if}")).map((r) => (results.get(r.id) as { result?: string }).result ?? "");
  return { regions, errors, checks };
}

async function defaultPackage(b: BridgeInputs) {
  const run = runBridge(b);
  const g = run.groups[0].inputs;
  const deck = deckFromBridge(b, run, deckInputs({}), { id: "girder", name: "Girders" });
  const parts = {
    deck: { label: "Deck, overhang and rail", name: "Deck", lines: deckCalcLines(deck, "Deck"), checks: [{ checks: designDeck(deck).checks }] },
    girders: { label: "Girders, spans 1–2", name: "Girders", lines: girderCalcLines(g, "Girders"), checks: [{ checks: run.groups[0].result.spans[0].interior.checks }] },
  };
  const supports: SupportCalc[] = [];
  for (let k = 0; k < b.supports.length; k++) {
    const s = b.supports[k];
    const list: CalcPart[] = [];
    const br = bearingFromBridge(b, run, k, bearingInputs({}));
    list.push({ label: "Bearings", name: `${s.name} bearings`, lines: bearingCalcLines(br, `${s.name} bearings`), checks: [{ checks: designBearing(br).checks }] });
    if (s.type.endsWith("abutment")) {
      const a = abutmentFromBridge(b, run, k, abutmentInputs({}));
      list.push({ label: "Abutment", name: s.name, lines: foundationCalcLines("abutment", a, s.name), checks: [{ checks: runFoundation("abutment", a).checks }] });
      const w = wingwallFromBridge(b, k, a, wingwallInputs({}));
      list.push({ label: "Wingwalls", name: `${s.name} wingwall`, lines: wingwallCalcLines(w, `${s.name} wingwall`), checks: [{ checks: designWingwall(w).checks }] });
      const ap = approachSlabFromBridge(b, k, approachSlabInputs({}));
      list.push({ label: "Approach slab", name: `${s.name} approach slab`, lines: approachSlabCalcLines(ap, `${s.name} approach slab`), checks: [{ checks: designApproachSlab(ap).checks }] });
    } else {
      const cap = capFromBridge(b, run, k, stmInputs({}), ["girder"], ["Girders"]);
      const r = await designStm(cap, nodeLpSolver);
      list.push({ label: "Pier cap", name: `${s.name} cap`, lines: stmPackageLines(cap, r, `${s.name} cap`), checks: [{ checks: r.checks }] });
      const col = columnFromBridge(b, run, k, columnInputs({}), columnLinkFrom("cap", `${s.name} cap`, cap, new Map([["girder", g]])));
      const cr = designColumn(col);
      list.push({ label: "Columns", name: `${s.name} column`, lines: columnCalcLines(col, `${s.name} column`), checks: [{ checks: cr.checks }] });
      const ft = footingFromColumn(cr, footingInputs({}));
      list.push({ label: "Foundation", name: `${s.name} footing`, lines: foundationCalcLines("spread-footing", ft, `${s.name} footing`), checks: [{ checks: runFoundation("spread-footing", ft).checks }] });
    }
    supports.push({ name: s.name, type: s.type, parts: list });
  }
  const t = takeoffFor("lrfd-girder-check", g)!;
  const pay = [{ label: "Superstructure", lines: takeoffPayLines("lrfd-girder-check", t, {}, g) }];
  const svg = renderBridgeSvg(bridgeIfc(b, run), { width: 720, height: 400 });
  const lines = bridgeCalcLines({ title: "Test bridge", b, run, figures: { render: { kind: "image", width: 720, height: 400, svg } }, superstructure: [parts.deck, parts.girders], supports, pay, tabulations: [], missing: [] });
  return { lines, parts, supports };
}

describe("the Bridge's calc package", async () => {
  const p = await defaultPackage(BRIDGE_DEFAULTS);
  const all = workOut(p.lines);

  it("opens with the bridge in 3D, then the description, the summaries, the parts and the quantities, in that order", () => {
    const texts = p.lines.flatMap((l) => ("text" in l ? [l.text] : []));
    const at = (t: string) => texts.findIndex((x) => x.startsWith(t));
    expect("region" in p.lines[2] && p.lines[2].region.kind === "image" && p.lines[2].region.svg.includes("<polygon")).toBe(true);
    const order = ["Bridge description", "Summary of design checks", "Summary of superstructure design checks", "Summary of substructure design checks", "PART 1: SUPERSTRUCTURE", "Load path:", "PART 2: SUBSTRUCTURE", "Abutment 1 (", "Pier 2 (", "Abutment 3 (", "PART 3: QUANTITIES"].map(at);
    expect(order.every((k) => k >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("works out as one worksheet with no errors", () => {
    expect(all.errors).toEqual([]);
  });

  it("gives every component's checks the results they have alone (no value leaks from one part to the next)", () => {
    const alone = [p.parts.deck, p.parts.girders, ...p.supports.flatMap((s) => s.parts)].flatMap((x) => workOut(x.lines).checks);
    expect(all.checks).toEqual(alone);
  });

  it("names no software in what it prints", () => {
    const printed = all.regions.map((r) => (r.kind === "text" ? r.text : r.kind === "math" ? r.latex : r.kind === "image" ? r.svg : "")).join("\n");
    expect(printed).not.toMatch(/PGSuper|BridgeLink|Mathcad|AutoCAD|IfcOpenShell/);
  });
});

describe("the summary of quantities", () => {
  it("adds each item across the parts, by pay item", () => {
    const r = soqRows([
      { label: "Superstructure", lines: [{ code: "602-00020", description: "Reinforcing Steel (Epoxy Coated)", unit: "LB", quantity: 1000, role: "rebar" }] },
      { label: "Abutment 1", lines: [{ code: "601-03040", description: "Concrete Class D (Bridge)", unit: "CY", quantity: 12.3, role: "concrete" }, { code: "602-00020", description: "Reinforcing Steel (Epoxy Coated)", unit: "LB", quantity: 250, role: "rebar" }] },
    ]);
    expect(r.map((x) => [x.code, x.values, x.total])).toEqual([
      ["601-03040", [0, 12.3], 12.3],
      ["602-00020", [1000, 250], 1250],
    ]);
  });
});
