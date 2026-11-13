import { describe, expect, it } from "vitest";
import type { Line } from "@/lib/calcs/library/templates";
import { checksSummary, verdictOf } from "./checks-summary";
import { cbcCalcLines } from "./culverts/cbc-calc";
import { deckCalcLines } from "./decks/deck-calc";
import { bearingCalcLines } from "./bearings/elastomeric-calc";
import { signCalcLines } from "./signs/cantilever-calc";
import { zone1CalcLines } from "./seismic/zone1-calc";
import { columnCalcLines } from "./piers/column-calc";
import { approachSlabCalcLines } from "./approach/approach-slab-calc";
import { foundationCalcLines } from "./foundations/calc";
import { foundationInputs } from "./foundations/kinds";
import { stripSealCalcLines } from "./joints/strip-seal-calc";
import { mseCalcLines } from "./walls/mse-calc";
import { haunchCalcLines } from "./girders/haunch-calc";
import { cipCalcLines } from "./walls/cip-calc";
import { wingwallCalcLines } from "./walls/wingwall-calc";
import { girderCalcLines } from "./girders/prestressed-calc";
import { approachSlabInputs, bearingInputs, cbcInputs, cipInputs, deckInputs, girderInputs, haunchInputs, mseInputs, signInputs, stripSealInputs, wingwallInputs, zone1Inputs } from "./kinds";
import { columnInputs } from "./piers/column";

// The summary of the checks at the end of every calc package: a table with its columns described.

const svgOf = (l: Line) => ("region" in l && l.region.kind === "image" ? l.region.svg : "");

describe("summary of the checks", () => {
  it("a table of each check: demand, capacity, unit, ratio, result, reference; the verdict above it", () => {
    const lines = checksSummary([{ title: "Girder", checks: [{ name: "Flexure", demand: 900, capacity: 1000, unit: "kip·ft", ok: true, ref: "AASHTO 5.6.3.2" }, { name: "Shear", demand: 120, capacity: 100, unit: "kip", ok: false, ref: "AASHTO 5.7.3.3" }, { name: "Lifting", demand: 1, capacity: 2, unit: "", ok: true, ref: "PCI", advisory: true }] }]);
    const texts = lines.flatMap((l) => ("text" in l ? [l.text] : []));
    expect(texts[0]).toBe("Summary of the checks");
    expect(texts.some((t) => t.startsWith("Columns:- Check is what is checked."))).toBe(true);
    expect(texts).toContain("Girder:- 1 of 2 checks fail; 1 for information.");
    const svg = lines.map(svgOf).join("");
    for (const s of ["Check", "Demand", "Capacity", "Unit", "Ratio", "Result", "Reference", "0.90", "1.20", ">OK<", ">NG<", ">Info<", "AASHTO 5.7.3.3"]) expect(svg).toContain(s);
    expect(verdictOf([{ name: "a", demand: 1, capacity: 2, unit: "", ok: true, ref: "" }])).toBe("all 1 checks pass");
  });

  const packages: [string, () => Line[]][] = [
    ["Box culvert", () => cbcCalcLines(cbcInputs({}), "T")],
    ["Deck slab", () => deckCalcLines(deckInputs({}), "T")],
    ["Elastomeric bearing", () => bearingCalcLines(bearingInputs({}), "T")],
    ["Cantilever sign", () => signCalcLines(signInputs({}), "T")],
    ["Seismic Zone 1", () => zone1CalcLines(zone1Inputs({}), "T")],
    ["Pier column", () => columnCalcLines(columnInputs({}), "T")],
    ["Strip seal", () => stripSealCalcLines(stripSealInputs({}), "T")],
    ["Approach slab", () => approachSlabCalcLines(approachSlabInputs({}), "T")],
    ["spread-footing", () => foundationCalcLines("spread-footing", foundationInputs("spread-footing", {}), "T")],
    ["pile-foundation", () => foundationCalcLines("pile-foundation", foundationInputs("pile-foundation", {}), "T")],
    ["drilled-shaft", () => foundationCalcLines("drilled-shaft", foundationInputs("drilled-shaft", {}), "T")],
    ["micropile", () => foundationCalcLines("micropile", foundationInputs("micropile", {}), "T")],
    ["abutment", () => foundationCalcLines("abutment", foundationInputs("abutment", {}), "T")],
    ["abutment, seat on piles", () => foundationCalcLines("abutment", foundationInputs("abutment", { type: "seat", foundation: "piles" }), "T")],
    ["MSE wall", () => mseCalcLines(mseInputs({}), "T")],
    ["Camber and haunch", () => haunchCalcLines(haunchInputs({}), "T")],
    ["CIP wall", () => cipCalcLines(cipInputs({}), "T")],
    ["Wingwall", () => wingwallCalcLines(wingwallInputs({}), "T")],
    ["Girder", () => girderCalcLines(girderInputs({}), "T")],
  ];
  for (const [name, make] of packages)
    it(`${name}: the calc package ends with the summary table`, () => {
      const lines = make();
      const at = lines.findIndex((l) => "text" in l && l.text === "Summary of the checks");
      expect(at).toBeGreaterThan(0);
      expect(lines.slice(at).some((l) => svgOf(l).includes(">Result<"))).toBe(true);
    });
});
