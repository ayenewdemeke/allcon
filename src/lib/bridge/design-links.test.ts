import { describe, expect, it } from "vitest";
import { evaluateSheet, DEFAULT_SETTINGS, type SheetItem } from "@/lib/calcs/evaluate";
import { layout } from "@/lib/calcs/library/templates";
import { designBearing } from "../design/bearings/elastomeric";
import { designDeck } from "../design/decks/deck";
import { designGirder } from "../design/girders/prestressed";
import { designStripSeal } from "../design/joints/strip-seal";
import { bearingInputs, deckInputs, designInputs, girderInputs, stripSealInputs } from "../design/kinds";
import { columnInputs, designColumn } from "../design/piers/column";
import { runBridge } from "../design/bridge/bridge";
import { bridgeInputs } from "../design/bridge/kinds";
import { analyzeBridge } from "./bridge";
import { BRIDGE_DEFAULTS, bridgeDefinition, supportsFor } from "./definition";
import { designPrefill, designTargets } from "./design-links";
import { movingLoad } from "./moving";
import { bridgeCalcLines } from "./report";

// Designs started from a bridge: every part's inputs go through its design tool, and carry the
// model's values. And the analysis calc package lays out.

const def = bridgeDefinition({ ...BRIDGE_DEFAULTS, spans: [100, 120], supports: supportsFor(2), skew: 15 });
const a = analyzeBridge(def);
const live = movingLoad(a.generated, a.stage(2));
const targets = designTargets(def);
const fill = (key: string) => designPrefill(targets.find((t) => t.key === key)!, def, a, live);

describe("designs from the bridge model", () => {
  it("offers the girders, the deck, each line's bearings, the pier's columns and the expansion abutments' joints", () => {
    expect(targets.map((t) => t.key)).toEqual(["girders", "deck", "description", "bearing-0", "bearing-1", "bearing-2", "column-1", "joint-0", "joint-2"]);
  });
  it("the girder check takes the spans, section and loads, and works out", () => {
    const i = girderInputs(designInputs("lrfd-girder-check", fill("girders").inputs));
    expect([i.L, i.extraSpans.map((s) => s.L), i.nGirders, i.S, i.skew, i.shape]).toEqual([100, [120], 6, 8, 15, "bt-72"]);
    expect(designGirder(i).spans).toHaveLength(2);
  });
  it("the deck takes the spacing and thickness", () => {
    const i = deckInputs(fill("deck").inputs);
    expect([i.S, i.overhang, i.t]).toEqual([8, 3.5, 8]);
    expect(designDeck(i).checks.length).toBeGreaterThan(5);
  });
  it("a bearing takes the largest reaction on its line, dead and live, and the length that expands to it", () => {
    const pier = bearingInputs(fill("bearing-1").inputs);
    const end = bearingInputs(fill("bearing-2").inputs);
    const rows = a.bearings({ kind: "combination", name: "Service I" }, live).filter((b) => b.support === 2);
    expect(pier.DL).toBeCloseTo(Math.max(...rows.map((b) => b.vertical)), 0);
    expect(pier.LL).toBeGreaterThan(50);
    expect(pier.expansionLength).toBe(0); // the fixed line
    expect(end.expansionLength).toBe(120);
    expect(designBearing(end).checks.length).toBeGreaterThan(3);
  });
  it("a pier column takes Strength I cases at its top with their concurrent forces, and is designed", () => {
    const i = columnInputs(fill("column-1").inputs);
    expect(i.loads).toBe("entered");
    expect(i.cases).toHaveLength(4);
    expect(i.cases[0].P).toBeGreaterThan(i.cases[1].P); // most and least axial load
    expect(i.cases[0].P).toBeGreaterThan(800);
    expect(i.T).toBe(42);
    expect(designColumn(i).checks.length).toBeGreaterThan(5);
  });
  it("the description record takes the supports at their stations, the piers and the deck, and runs its load path", () => {
    const b = bridgeInputs(fill("description").inputs);
    expect(b.supports.map((s) => [s.station, s.type, s.skew])).toEqual([[1000, "seat-abutment", 15], [1100, "continuous-pier", 15], [1220, "seat-abutment", 15]]);
    expect([b.nGirders, b.spacing, b.leftEdge, b.slabOffset]).toEqual([6, 8, 23.5, 10.5]);
    expect(b.supports[1].pier?.columnSize).toBe(42);
    expect(runBridge(b).layout.supports).toHaveLength(3);
  });
  it("a joint takes the expansion length and the skew", () => {
    const i = stripSealInputs(fill("joint-0").inputs);
    expect([i.L, i.skew]).toEqual([100, 15]);
    expect(designStripSeal(i).checks.length).toBeGreaterThan(0);
  });
  it("the analysis calc package lays out, with its tables, and nothing in it fails to work out", () => {
    const lines = bridgeCalcLines(def, a, live, "Test bridge");
    const regions = layout(lines, { x: 0, y: 0 });
    expect(regions.filter((r) => r.kind === "image").length).toBeGreaterThan(10);
    const results = evaluateSheet(regions.filter((r) => r.kind !== "text" && r.kind !== "image") as SheetItem[], DEFAULT_SETTINGS, new Map());
    expect([...results.values()].filter((r) => r.kind === "error")).toEqual([]);
    const text = lines.flatMap((l) => ("text" in l ? [l.text] : [])).join(" ");
    expect(text).toMatch(/Not verified/);
    expect(text).toMatch(/3 design lanes/);
  });
});
