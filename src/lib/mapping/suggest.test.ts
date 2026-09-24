import { describe, expect, it } from "vitest";
import { HIGH_CONFIDENCE, quantityKeyFor, suggest, tokens, type GroupForSuggestion, type LineItemForSuggestion } from "./suggest";

// Line items from samples/riverside-schedule-of-values.xlsx
const items: LineItemForSuggestion[] = [
  ["ls", "01 50 00", "Temporary facilities and controls", "LS"],
  ["fdn", "03 30 00", "Cast-in-place foundation walls, 12\"", "CY"],
  ["sog", "03 30 00", "Slab on grade, 5\"", "SF"],
  ["brick", "04 20 00", "Brick veneer on metal stud backup", "SF"],
  ["beams", "05 12 00", "Structural steel framing, beams", "LF"],
  ["cols", "05 12 00", "Structural steel columns", "EA"],
  ["doors", "08 11 13", "Hollow metal doors and frames", "EA"],
  ["cw", "08 44 13", "Glazed aluminum curtain wall", "SF"],
  ["gyp", "09 21 16", "Gypsum board partitions", "SF"],
  ["act", "09 51 13", "Acoustical panel ceilings", "SF"],
  ["plumb", "22 42 00", "Commercial plumbing fixtures", "EA"],
  ["paving", "32 12 16", "Asphalt paving, 3\" on 6\" aggregate base", "SF"],
].map(([id, code, description, unit]) => ({ id, code, description, unit }));

// Element groups as they come out of the Riverside Revit model
const g = (category: string, typeName: string, assemblyCode: string | null, assemblyDescription: string | null, quantities: GroupForSuggestion["quantities"] = {}): GroupForSuggestion => ({
  category, typeName, assemblyCode, assemblyDescription, quantities,
});

describe("suggest (real Riverside groups -> sample SOV)", () => {
  it.each([
    [g("Walls", "12\" Concrete Foundation Wall", "A1010210", "Foundation Walls - CIP", { volume: 142.7, area: 468, length: 128 }), "fdn", "volume"],
    [g("Walls", "Exterior - Brick on Mtl. Stud", "B2010158", "Ext. Wall - Brick Veneer w/ Stud", { volume: 139, area: 394, length: 128 }), "brick", "area"],
    [g("Walls", "Int - S1A (4 7/8\") 3-5/8\" stud w/ 5/8\" gyp both sides", "C1010145", "Partitions - Drywall w/ Metal Stud", { volume: 120, area: 970, length: 263 }), "gyp", "area"],
    [g("Structural Framing", "W12X26", "B10", "Superstructure", { volume: 6.1, length: 1224 }), "beams", "length"],
    [g("Structural Columns", "W10X49", "B10", "Superstructure", { volume: 3.5, length: 375 }), "cols", "count"],
    [g("Doors", "36\" x 84\" HM Interior", "C1020", "Interior Doors"), "doors", "count"],
    [g("Walls", "Glazed", "B2020220", "Curtain Walls - Panels", { area: 453 }), "cw", "area"],
    [g("Plumbing Fixtures", "Toilet-Domestic-3D", "D2010110", "Water Closets - Single"), "plumb", "count"],
    // "Wall" here means wall-hung, not a wall
    [g("Plumbing Fixtures", "Urinal-Wall-3D", "D2010210", "Urinals - Single"), "plumb", "count"],
    [g("Ceilings", "2' x 4' ACT System", "C3030210", "Suspended Ceilings - Acoustical", { volume: 93, area: 1637 }), "act", "area"],
  ])("%# maps to the right line item", (group, expected, key) => {
    const s = suggest(group, items);
    expect(s?.lineItemId).toBe(expected);
    expect(s?.quantityKey).toBe(key);
  });

  // The bill has no footing, joist or ceiling-board line; the nearest line describes a
  // different element and must not be offered as a confident match.
  it.each([
    [g("Structural Foundations", "Bearing Footing - 36\" x 12\"", "A1010110", "Strip Footings", { volume: 35.7, length: 128 }), "fdn"],
    [g("Structural Framing", "16K4", "B1010350", "Joists - Steel", { volume: 2.6, length: 1640 }), "beams"],
    [g("Ceilings", "GWB on Mtl. Stud", "C3030220", "Suspended Ceilings - Gypsum Board", { volume: 5.9, area: 54.6 }), "gyp"],
  ])("%# doesn't match a line for a different kind of element", (group, wrong) => {
    const s = suggest(group, items);
    expect(s === null || s.lineItemId !== wrong || s.score < HIGH_CONFIDENCE).toBe(true);
  });

  it("won't suggest a line whose unit the group can't supply (mullions have no area)", () => {
    const mullions = g("Walls", "2.5\" x 5\" rectangular", "B2020210", "Curtain Walls - Framing", { length: 1232 });
    const s = suggest(mullions, items);
    expect(s?.lineItemId).not.toBe("cw");
    // ...nor fall back to an unrelated line in the same division (doors are also division 08)
    expect(s?.lineItemId).not.toBe("doors");
  });

  it("stays quiet when nothing in the bill fits", () => {
    expect(suggest(g("Furniture", "Chair-Breuer", "E2020200", "Furniture & Accessories"), items)).toBeNull();
  });
});

describe("helpers", () => {
  it("expands abbreviations and steel shapes", () => {
    expect([...tokens("Exterior - Brick on Mtl. Stud")]).toEqual(expect.arrayContaining(["brick", "metal", "stud", "exterior"]));
    expect([...tokens("W12X26")]).toEqual(expect.arrayContaining(["steel", "wide", "flange"]));
  });
  it("picks the quantity that matches the unit", () => {
    expect(quantityKeyFor("CY", { volume: 1 })).toBe("volume");
    expect(quantityKeyFor("SF", { volume: 1 })).toBeNull();
    expect(quantityKeyFor("EA", {})).toBe("count");
    expect(quantityKeyFor("LS", {})).toBe("count");
  });
});
