import { describe, expect, it } from "vitest";
import { buildItems, detectHeaderRow, guessColumns, lineValue, parseNumber } from "./import";
import { normalizeUnit, toLineItemUnit } from "./units";

// A schedule of values as contractors send them: a title block, then the table.
const sheet: unknown[][] = [
  ["Riverside Medical Office Building"],
  ["Schedule of Values", "", "", "", "", ""],
  [],
  ["Cost Code", "Description of Work", "Unit", "Qty", "Unit Rate", "Scheduled Value"],
  ["01", "GENERAL REQUIREMENTS", "", "", "", ""],
  ["01 50 00", "Temporary facilities", "lump sum", "", "", "$45,000.00"],
  ["03", "CONCRETE", "", "", "", ""],
  ["03 30 00", "Foundation walls, 12\" CIP", "cu yd", "184", "$650.00", "$119,600.00"],
  ["03 30 00", "Slab on grade, 5\"", "SF", "12,400", "", "$124,000"],
  ["", "Subtotal Concrete", "", "", "", "243,600"],
  ["08 11 00", "Hollow metal doors", "EA", "24", "1,150", "27,600"],
  ["09 51 00", "Acoustic ceilings", "sq ft", "10,000", "4.25", "(1,000)"],
];

describe("header and columns", () => {
  it("finds the header row below a title block", () => {
    expect(detectHeaderRow(sheet)).toBe(3);
  });
  it("maps columns by their titles", () => {
    expect(guessColumns(sheet[3])).toEqual({ code: 0, description: 1, unit: 2, quantity: 3, rate: 4, amount: 5 });
  });
});

describe("buildItems", () => {
  const items = buildItems(sheet, 3, guessColumns(sheet[3]));
  const byDesc = (d: string) => items.find((i) => i.description.startsWith(d))!;

  it("treats rows with no figures as section headings", () => {
    expect(items.filter((i) => i.isHeading).map((i) => i.description)).toEqual(["GENERAL REQUIREMENTS", "CONCRETE"]);
  });
  it("skips subtotal lines", () => {
    expect(items.some((i) => i.description.includes("Subtotal"))).toBe(false);
  });
  it("reads lump sums", () => {
    const ls = byDesc("Temporary facilities");
    expect(ls).toMatchObject({ billingType: "lump_sum", unit: "LS", scheduledValue: 45000, rate: null });
  });
  it("normalizes units and reads unit-price lines", () => {
    expect(byDesc("Foundation walls")).toMatchObject({ unit: "CY", contractQuantity: 184, rate: 650, warning: null });
  });
  it("derives a missing rate from amount / quantity", () => {
    expect(byDesc("Slab on grade").rate).toBeCloseTo(10, 9);
  });
  it("warns when quantity x rate disagrees with the amount", () => {
    expect(byDesc("Acoustic ceilings").warning).toMatch(/doesn't match/);
  });
  it("values lines", () => {
    expect(lineValue(byDesc("Hollow metal doors"))).toBe(27600);
    expect(lineValue(byDesc("Temporary facilities"))).toBe(45000);
  });
});

describe("parseNumber", () => {
  it.each([
    ["$1,234.50", 1234.5],
    ["(1,000)", -1000],
    ["12,400", 12400],
    [42, 42],
    ["-", null],
    ["", null],
    ["n/a", null],
  ])("%s -> %s", (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });
});

describe("units", () => {
  it("normalizes common spellings", () => {
    expect(normalizeUnit("cu yd").unit).toBe("CY");
    expect(normalizeUnit("Sq. Ft.").unit).toBe("SF");
    expect(normalizeUnit("each").unit).toBe("EA");
    expect(normalizeUnit("m²").unit).toBe("m2");
    expect(normalizeUnit("pallet")).toEqual({ unit: "pallet", dimension: null });
  });
  it("converts measured quantities into the line item's unit", () => {
    expect(toLineItemUnit(0.764554857984, "volume", "CY")).toBeCloseTo(1, 9);
    expect(toLineItemUnit(0.09290304, "area", "sq ft")).toBeCloseTo(1, 9);
    expect(toLineItemUnit(7, "count", "EA")).toBe(7);
  });
  it("refuses mismatched dimensions", () => {
    expect(toLineItemUnit(10, "area", "CY")).toBeNull();
    expect(toLineItemUnit(3, "count", "SF")).toBeNull();
  });
});
