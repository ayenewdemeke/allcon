import { describe, expect, it } from "vitest";
import {
  calibrate,
  formatMeasure,
  measureMarkup,
  parseDistance,
  polygonArea,
  polygonPerimeter,
  SCALE_PRESETS,
  type Point,
} from "./takeoff";

const FOOT = 0.3048;
const preset = (label: string) => SCALE_PRESETS.flatMap((g) => g.presets).find((p) => p.label === label)!;

describe("scale presets", () => {
  it('1/8" = 1\'-0": one inch of paper (72 pt) is 8 ft', () => {
    expect(72 * preset(`1/8" = 1'-0"`).metersPerPoint).toBeCloseTo(8 * FOOT, 9);
  });
  it("1\" = 20': one inch of paper is 20 ft", () => {
    expect(72 * preset(`1" = 20'`).metersPerPoint).toBeCloseTo(20 * FOOT, 9);
  });
  it("1:100: one inch of paper is 2.54 m", () => {
    expect(72 * preset("1:100").metersPerPoint).toBeCloseTo(2.54, 9);
  });
});

describe("geometry", () => {
  const square: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  it("area is the same either winding direction", () => {
    expect(polygonArea(square)).toBe(100);
    expect(polygonArea([...square].reverse())).toBe(100);
  });
  it("perimeter closes the polygon", () => {
    expect(polygonPerimeter(square)).toBe(40);
  });
});

describe("parseDistance", () => {
  it.each([
    [`24'-6"`, 24.5 * FOOT],
    [`24' 6`, 24.5 * FOOT],
    ["24.5 ft", 24.5 * FOOT],
    ["294 in", 24.5 * FOOT],
  ])("reads %s", (input, meters) => {
    expect(parseDistance(input, "imperial")).toBeCloseTo(meters, 9);
  });
  it("treats a bare number as feet (imperial) or meters (metric)", () => {
    expect(parseDistance("30", "imperial")).toBeCloseTo(30 * FOOT, 9);
    expect(parseDistance("5", "metric")).toBe(5);
  });
  it("reads metric units", () => {
    expect(parseDistance("7470 mm", "metric")).toBeCloseTo(7.47, 9);
  });
  it("rejects text it can't read", () => {
    expect(parseDistance("abc", "imperial")).toBeNull();
  });
});

describe("measureMarkup", () => {
  // A 100 pt line is really 50 ft, so a 200 x 100 pt rectangle is 100 ft x 50 ft.
  const mpp = calibrate(100, 50 * FOOT);
  const rect = { kind: "area", points: [[0, 0], [200, 0], [200, 100], [0, 100]] as Point[] };

  it("measures area and perimeter", () => {
    const m = measureMarkup(rect, mpp)!;
    expect(formatMeasure(m.value, "area", "imperial")).toBe("5,000.0 SF");
    expect(formatMeasure(m.perimeter!, "length", "imperial")).toBe("300.0 LF");
  });
  it("turns an area with depth into a volume (4 in gravel base)", () => {
    const m = measureMarkup({ ...rect, depth: 4 * 0.0254 }, mpp)!;
    expect(m.kind).toBe("volume");
    expect(formatMeasure(m.value, "volume", "imperial")).toBe("61.73 CY");
  });
  it("needs a scale for lengths and areas, but not for counts", () => {
    expect(measureMarkup({ kind: "length", points: [[0, 0], [1, 1]] }, null)).toBeNull();
    expect(measureMarkup({ kind: "count", points: [[0, 0], [1, 1], [2, 2]] }, null)?.value).toBe(3);
  });
});
