import { describe, expect, it } from "vitest";
import { convertFromSi, parseQuantity } from "./quantities";

describe("parseQuantity (Model Derivative display strings)", () => {
  it.each([
    ["365.500 CF", "volume", 365.5 * 0.028316846592],
    ["472.187 ft^2", "area", 472.187 * 0.09290304],
    ["30.323 ft-and-fractional-in", "length", 30.323 * 0.3048],
    ["1.5 m^3", "volume", 1.5],
    ["12,345.6 SF", "area", 12345.6 * 0.09290304],
  ])("parses %s", (raw, dimension, si) => {
    const q = parseQuantity(raw)!;
    expect(q.dimension).toBe(dimension);
    expect(q.value).toBeCloseTo(si, 9);
  });

  it.each(["", "Yes", "0.000 ฿", 42, null])("ignores %s (no usable unit)", (raw) => {
    expect(parseQuantity(raw)).toBeNull();
  });
});

describe("convertFromSi", () => {
  it("converts to the line item's unit", () => {
    expect(convertFromSi(10.34, "volume", "CY")).toBeCloseTo(13.524, 3);
    expect(convertFromSi(1, "length", "LF")).toBeCloseTo(3.28084, 5);
  });
  it("refuses dimensionally incompatible units", () => {
    expect(convertFromSi(5, "area", "CY")).toBeNull();
  });
});
