import { describe, expect, it } from "vitest";
import { DT_DEFAULTS } from "./double-tee";
import { applySia } from "./sia";
import { dimInches, readSketchCallouts } from "./sketch-callouts";

// Reading an inspection sketch's callouts. The lines follow how pdf.js gives a CAD sketch's text
// (pieces on a line joined with " | ", a stacked ½ as "1" over "4 | 2 | ""), with the callouts of
// the 2025 sketches of three of the bridges rated; checked against those sketches (not kept here).

const val = (r: ReturnType<typeof readSketchCallouts>, input: string) => r.values.find((v) => v.input === input)?.value;

it("reads dimensions", () => {
  expect(["6'-10 1/2\"", "4 1/2\"", "8\"", "32'-9\"", "4 ½\"", "66'", "6'-5 1/4\"", "CONC."].map(dimInches)).toEqual([82.5, 4.5, 8, 393, 4.5, 792, 77.25, null]);
});

describe("a sketch with edge units of another width, a stacked fraction and sidewalks", () => {
  const lines = [
    "AUR07.0-H.0",
    "33'-5\"",
    "STR. LEN.",
    "50'-0\" O/O | APPR. RDWY.",
    "C BRG. | L | C BRG. | L",
    "32'-9\"",
    "31'-5\"",
    "5'-0\" | 40'-0\" C/C | 5'-0\"",
    "CONCRETE | CONCRETE",
    "SIDEWALK | 5\" STL. POSTS w/ | SIDEWALK | 1'-3\"",
    "6\" ASPHALT ON",
    "1",
    "4 | 2 | \" CONC. TOPPING ON",
    "2\" PC. CONC. FLANGE | 2'-3\"",
    "2\" AVG.",
    "22\"",
    "(1) PC./PS. | (5) PRECAST, PRESTRESSED CONC. DBL. TEE GIRDERS AT 8'-0\" o.c. | (1) PC./PS.",
    "CONC. DBL. TEE | CONC. DBL. TEE",
    "GIR. AT 5'-0\" | GIR. AT 5'-0\"",
  ];
  const r = readSketchCallouts(lines, "AUR07.0-H.0 SKETCH 2025 10 14.pdf", DT_DEFAULTS);
  it("reads the units, deck, flange, asphalt, span and widths", () => {
    expect(r.format).toBe("sketch");
    expect(r.structure).toBe("AUR07.0-H.0");
    expect([val(r, "units.count"), val(r, "units.spacing"), val(r, "units.flangeWidth")]).toEqual([7, 96, 96]);
    expect((val(r, "units.layout") as { flangeWidth: number }[]).map((u) => u.flangeWidth)).toEqual([60, 96, 96, 96, 96, 96, 60]);
    expect([val(r, "deck.present"), val(r, "deck.thk"), val(r, "units.flangeThk"), val(r, "loads.asphalt")]).toEqual([true, 4.5, 2, 6]);
    expect([val(r, "span"), val(r, "roadway.railToRail"), val(r, "roadway.curbToCurb"), val(r, "roadway.curbFaceOffset")]).toEqual([32.75, 50, 40, 60]);
    expect(val(r, "loads.sidewalks")).toEqual([
      { width: 5, thk: 6 },
      { width: 5, thk: 6 },
    ]);
  });
  it("leaves bare dimensions alone and flags the second asphalt dimension", () => {
    expect(val(r, "units.depth")).toBeUndefined();
    expect(val(r, "structureLength")).toBeUndefined(); // "STR. LEN." on its own line: which dimension isn't certain
    expect(r.findings.join(" ")).toMatch(/2" AVG\./);
  });
  it("applies the layout with the count, keeping the stem spacing and sidewalk thickness entered", () => {
    const start = { ...DT_DEFAULTS, loads: { ...DT_DEFAULTS.loads, sidewalks: [{ width: 4, thk: 10 }] } };
    const o = applySia(start, r, r.values);
    expect([o.units.count, o.units.layout?.length, o.units.flangeThk, o.deck.thk]).toEqual([7, 7, 2, 4.5]);
    expect(o.units.layout!.map((u) => u.stemSpacing)).toEqual([36, 36, 36, 36, 36, 36, 36]);
    expect(o.loads.sidewalks).toEqual([
      { width: 5, thk: 10 },
      { width: 5, thk: 6 },
    ]);
    expect(o.notes["deck.thk"]).toMatch(/^Sketch AUR07\.0-H\.0 SKETCH 2025 10 14\.pdf, "4 1\/2" CONC\. TOPPING ON"/);
  });
});

describe("a sketch with sidewalks past a rail edge, diaphragms and no unit spacing callout", () => {
  const r = readSketchCallouts(
    [
      "AUR08.0-J.3",
      "134'-2\" O/O | 1ST AVENUE",
      "62'-0\" O/O",
      "C BRG. | L | C PIER | L | C BRG. | L",
      "66'-0\" | 66'-0\"",
      "12\" | 5'-0\" | 50'-0\" C/C | 5'-0\" | 12\"",
      "CONC. SW. | CONC. SW.",
      "8 1/2\" CONC. DECK ON",
      "7\" PC. CONC. FLANGE",
      "3'-2\"",
      "8\"x30\" CONC. DIAP.",
      "4 1/2\"(TYP.) | 6'-10 1/2\" | 4'-7 1/2\"",
      "(9) PRECAST, PRESTRESSED CONC. DOUBLE TEE GIRDERS",
    ],
    "AUR08 sketch.pdf",
    DT_DEFAULTS,
  );
  it("takes the width, not the length, from the O/O dimensions, and the sidewalks with the rail edge", () => {
    expect([val(r, "units.count"), val(r, "units.spacing"), val(r, "deck.thk"), val(r, "units.flangeThk"), val(r, "span")]).toEqual([9, undefined, 8.5, 7, 66]);
    expect([val(r, "roadway.railToRail"), val(r, "roadway.curbToCurb"), val(r, "roadway.curbFaceOffset")]).toEqual([62, 50, 72]);
    expect(val(r, "loads.sidewalks")).toEqual([
      { width: 6, thk: 6 },
      { width: 6, thk: 6 },
    ]);
    expect(r.values.find((v) => v.input === "span")!.note).toMatch(/2 spans/);
  });
  it("asks for the diaphragms' weight when no callout gives the unit spacing", () => {
    expect(val(r, "loads.diaphragmKip")).toBeUndefined();
    expect(r.findings.join(" ")).toMatch(/8"x30" CONC\. DIAP\./);
  });
});

it("reads the spacing from a 'DOUBLE TEES AT … o.c.' callout and a structure length on its line", () => {
  const r = readSketchCallouts(["61'-4\" STR LENGTH | JEWELL AVENUE", "APPR RDWY | 32'-6\" O/O", "C BRG. | L | C BRG. | L", "60'-0\"", "59'-0\"", "2'-9\" | 5 1/2\" CONC. DECK ON", "2\" PC. CONC. FLANGE", "(5) PRECAST, PRESTRESSED CONC. DOUBLE TEES AT 6'-5 1/4\" o.c."], "AUR12 sketch.pdf", DT_DEFAULTS);
  expect([val(r, "units.count"), val(r, "units.spacing"), val(r, "deck.thk"), val(r, "units.flangeThk"), val(r, "span"), val(r, "structureLength"), val(r, "roadway.railToRail")]).toEqual([5, 77.25, 5.5, 2, 60, 61.3333, 32.5]);
});

it("gives nothing for a sketch without text, and says so", () => {
  const r = readSketchCallouts([], "CENT 19-2.5 SKETCH.pdf", DT_DEFAULTS);
  expect(r.values).toEqual([]);
  expect(r.findings[0]).toMatch(/No callouts read/);
});
