import { describe, expect, it } from "vitest";
import { describeSheet } from "./describe";
import type { ExportData, ExportMarkupData } from "./export-data";

const FOOT_PER_INCH = 0.3048 / 72; // 1 in on paper (72 pt) = 1 ft
const markup = (m: Partial<ExportMarkupData> & Pick<ExportMarkupData, "id" | "kind" | "points">): ExportMarkupData => ({
  label: null,
  text: null,
  color: "#000",
  depth: null,
  lineItemId: null,
  ...m,
});

function data(includePrices: boolean, metersPerPoint: number | null = FOOT_PER_INCH): ExportData {
  return {
    title: "Set",
    currency: "USD",
    unitSystem: "imperial",
    includePrices,
    sheets: [
      {
        id: "s1",
        pageIndex: 0,
        name: "A-101",
        metersPerPoint,
        scaleLabel: null,
        markups: [
          markup({ id: "a", kind: "area", points: [[0, 0], [720, 0], [720, 720], [0, 720]], lineItemId: "slab" }),
          markup({ id: "b", kind: "length", points: [[0, 0], [720, 0]] }),
          markup({ id: "c", kind: "area", points: [[0, 0], [72, 0], [72, 72]], label: "Pad" }),
          markup({ id: "d", kind: "note", points: [[0, 0]], text: "Check this\nsecond line" }),
          markup({ id: "e", kind: "count", points: [[1, 1], [2, 2], [3, 3]] }),
        ],
      },
    ],
    lineItems: includePrices ? [{ id: "slab", code: "03 30 00", description: "Slab", unit: "SF", rate: 5 }] : [],
  };
}

describe("describeSheet", () => {
  it("names, measures and prices markups", () => {
    const d = data(true);
    const rows = describeSheet(d.sheets[0], d);
    expect(rows.map((r) => r.name)).toEqual(["Area 1", "Length 1", "Pad", "Check this", "Count 1"]);
    expect(rows[0].quantity).toMatch(/^100(\.0+)? SF$/);
    expect(rows[0].lineItem).toBe("03 30 00 · Slab");
    expect(rows[0].amount).toBeCloseTo(500, 6);
    expect(rows[1].quantity).toMatch(/^10(\.0+)? LF$/);
    expect(rows[3].quantity).toBeNull(); // notes aren't quantities
    expect(rows[4].quantity).toMatch(/^3/);
  });

  it("reveals no line items or amounts when prices aren't shared", () => {
    const d = data(false);
    const rows = describeSheet(d.sheets[0], d);
    expect(rows.every((r) => r.lineItem === null && r.amount === null)).toBe(true);
  });

  it("marks lengths and areas on unscaled sheets", () => {
    const d = data(false, null);
    const rows = describeSheet(d.sheets[0], d);
    expect(rows[0].quantity).toBe("Not scaled");
    expect(rows[4].quantity).toMatch(/^3/); // counts need no scale
  });
});
