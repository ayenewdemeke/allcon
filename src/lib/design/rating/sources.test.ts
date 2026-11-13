import { describe, expect, it } from "vitest";
import { dtRatingInputs } from "../kinds";
import fixtures from "./cdot-bridges.json";
import { dtInputsFromBridgeFile, type DtInputs } from "./double-tee";
import { applySia, readSia } from "./sia";
import { applyBrm, brmMaterials, legacySources, missingInputs, requiredKeys, setPath, withFileSources } from "./sources";

// A rating's inputs come from the SIA, the sketch, the BRM's tables, a bridge file or the engineer;
// nothing is ALLCON's own, and nothing is rated until every input the rating needs has a source.

const SNBI = [
  "Structure Key: | AUR07.0-H.0",
  "n | G02 - Total Length: | 33.4 | n | G11 - Skew: | 0",
  "n | G03 - Maximum Span: | 32.8 | n | G12 - Curved Bridge: | N - Not curved",
  "n | G05 - Out To Out: | 50 | n | G14 - Sidehill Bridge: | N",
  "n | G06 - Width Curb to Curb: | 40 | n | G15 - Irregular Deck Area:",
  "n | G07 - Left Curb Or Sidewalk: | 5 | n | G16 - Federal Deck Area: | 1670",
  "n | G08 - Right Curb Or Sidewalk: | 5 | n | G17A - Asphalt / Fill Thickness: | 6",
  "n | IE03 - Inspection Date: | 2025-10-14 | n | IE09 - QA Date:",
  "n | SP02 - Number of Spans: | 1 | n | SP09 - Deck Material and Type: | C01 - Reinforced concrete, cast-in-place",
  "n | SP03 - Number of Beam Lines: | 7 | n | SP10 - Wearing Surface: | B01 - Bituminous (asphalt)",
  "n | W01 - Year Built: | 1970 | n | W03A - Work Performed:",
];

describe("a new rating", () => {
  const blank = dtRatingInputs({});
  it("starts blank: every input it needs is missing", () => {
    expect(blank.blankStart).toBe(true);
    expect(missingInputs(blank)).toEqual(requiredKeys(blank));
    expect(missingInputs(blank)).toContain("units.depth");
  });
  it("takes the SIA's values with their items, and the BRM's materials for the year built", () => {
    const r = readSia(SNBI);
    const o = applySia(blank, r, r.values);
    expect(o.sources.span).toMatchObject({ kind: "sia" });
    expect(o.sources.span.note).toMatch(/G03 Maximum Span: 32\.8/);
    expect([o.materials.fpu, o.materials.aps, o.deck.fc]).toEqual([250, 0.144, 3]);
    expect(o.sources["materials.aps"]).toMatchObject({ kind: "brm" });
    expect(o.sources["materials.fc"]).toMatchObject({ kind: "assumed" });
    // The SIA doesn't give the double tees' dimensions, the rail, diaphragms or utilities.
    expect(missingInputs(o)).toEqual(["units.spacing", "units.flangeWidth", "units.stemSpacing", "units.depth", "units.flangeThk", "units.stemTop", "units.stemBot", "deck.thk", "roadway.railFaceOffset", "loads.railKlf", "loads.diaphragmKip", "loads.utilities"]);
  });
  it("is rated once the rest is entered", () => {
    const r = readSia(SNBI);
    let o = applySia(blank, r, r.values);
    for (const [p, v] of [
      ["units.spacing", 96],
      ["units.flangeWidth", 96],
      ["units.stemSpacing", 48],
      ["units.depth", 24],
      ["units.flangeThk", 2],
      ["units.stemTop", 8],
      ["units.stemBot", 5.75],
      ["deck.thk", 4.5],
      ["roadway.railFaceOffset", 4],
      ["loads.railKlf", 0.045],
      ["loads.diaphragmKip", 0],
      ["loads.utilities", []],
    ] as [string, unknown][])
      o = setPath(o, p, v);
    expect(missingInputs(o)).toEqual([]);
    expect(o.sources["units.depth"]).toEqual({ kind: "entered" });
  });
});

describe("the BRM's materials", () => {
  it("by era, and nothing for years the tables here don't cover", () => {
    const at = (y: number) => Object.fromEntries(brmMaterials(y).map((m) => [m.path, m.value]));
    expect(at(1970)).toMatchObject({ "materials.fpu": 250, "materials.aps": 0.144, "deck.fc": 3, "materials.fc": 6 });
    expect(at(1985)).toMatchObject({ "materials.fpu": 270, "materials.aps": 0.153, "deck.fc": 4.5 });
    expect(at(1978)["deck.fc"]).toBeUndefined(); // 1977–1981: not in the table here
    expect(at(1995)["materials.fpu"]).toBeUndefined();
  });
  it("never replaces a value with another source", () => {
    const i = setPath({ ...dtRatingInputs({}), bridge: { ...dtRatingInputs({}).bridge, yearBuilt: 1970 } }, "materials.aps", 0.153);
    const o = applyBrm(i);
    expect(o.materials.aps).toBe(0.153);
    expect(o.sources["materials.aps"]).toEqual({ kind: "entered" });
    expect(o.materials.fpu).toBe(250);
  });
});

it("a bridge file gives every input, sourced to it", () => {
  const f = (fixtures as unknown as { name: string; bridge: Record<string, unknown> }[])[0];
  const o = withFileSources(dtInputsFromBridgeFile(f.bridge), "CENT 19-2.5.json");
  expect(missingInputs(o)).toEqual([]);
  expect(o.sources.span.kind).toBe("file");
});

describe("a design saved before sources were kept", () => {
  it("keeps the SIA's and sketch's values, takes changed ones as entered, and asks about starting values", () => {
    const saved = { ...dtRatingInputs({}), span: 32.75, units: { ...dtRatingInputs({}).units, count: 7 }, notes: { "units.count": "SIA 2025-10-14, SP03 Number of Beam Lines: 7" } } as Partial<DtInputs>;
    delete saved.sources;
    delete saved.blankStart;
    const o = dtRatingInputs(saved);
    expect(o.blankStart).toBe(false);
    expect(o.sources["units.count"]).toMatchObject({ kind: "sia" });
    expect(o.sources.span).toMatchObject({ kind: "entered" });
    expect(missingInputs(o)).toContain("units.depth"); // still the old 17 in
    expect(legacySources(o)).toEqual(o.sources);
  });
});
