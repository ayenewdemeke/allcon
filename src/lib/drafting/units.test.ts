import { describe, expect, it } from "vitest";
import { formatAngle, formatLength, parseAngle, parseLength, parsePointInput } from "./units";

describe("architectural lengths", () => {
  it("formats feet, inches and sixteenths", () => {
    expect(formatLength(126.5, "architectural")).toBe(`10'-6 1/2"`);
    expect(formatLength(120, "architectural")).toBe(`10'-0"`);
    expect(formatLength(6, "architectural")).toBe(`0'-6"`);
    expect(formatLength(0.0625, "architectural")).toBe(`0'-0 1/16"`);
    expect(formatLength(-18, "architectural")).toBe(`-1'-6"`);
  });

  it("reads what people type", () => {
    expect(parseLength(`10'6`, "architectural")).toBe(126);
    expect(parseLength(`10'-6"`, "architectural")).toBe(126);
    expect(parseLength(`10' 6 1/2"`, "architectural")).toBe(126.5);
    expect(parseLength(`10'-6-1/2"`, "architectural")).toBe(126.5);
    expect(parseLength(`10'`, "architectural")).toBe(120);
    expect(parseLength(`2.5'`, "architectural")).toBe(30);
    expect(parseLength(`6"`, "architectural")).toBe(6);
    expect(parseLength("126", "architectural")).toBe(126); // bare numbers are inches
    expect(parseLength("1/2", "architectural")).toBe(0.5);
    expect(parseLength(`-3'`, "architectural")).toBe(-36);
  });

  it("rejects what isn't a length", () => {
    expect(parseLength("abc", "architectural")).toBeNull();
    expect(parseLength("'6", "architectural")).toBeNull();
    expect(parseLength("", "architectural")).toBeNull();
  });
});

describe("metric lengths", () => {
  it("are millimetres", () => {
    expect(formatLength(1250, "mm")).toBe("1250");
    expect(formatLength(12.345, "mm")).toBe("12.35");
    expect(parseLength("1250.5", "mm")).toBe(1250.5);
    expect(parseLength(`10'`, "mm")).toBeNull();
  });
});

describe("angles", () => {
  it("are degrees counter-clockwise from east", () => {
    expect(formatAngle(Math.PI / 2)).toBe("90°");
    expect(formatAngle(-Math.PI / 2)).toBe("270°");
    expect(parseAngle("45")).toBeCloseTo(Math.PI / 4);
    expect(parseAngle("30d")).toBeCloseTo(Math.PI / 6);
  });
});

describe("typed points", () => {
  const base = { x: 100, y: 100 };
  const close = (p: unknown, x: number, y: number) => {
    const pt = (p as { point: { x: number; y: number } }).point;
    expect(pt.x).toBeCloseTo(x);
    expect(pt.y).toBeCloseTo(y);
  };

  it("are absolute for the first point", () => close(parsePointInput("10,20", "mm", null, true), 10, 20));
  it("are relative after it, with dynamic input on (as in AutoCAD)", () => close(parsePointInput("10,20", "mm", base, true), 110, 120));
  it("are absolute with dynamic input off", () => close(parsePointInput("10,20", "mm", base, false), 10, 20));
  it("are relative with @, absolute with #", () => {
    close(parsePointInput("@10,0", "mm", base, false), 110, 100);
    close(parsePointInput("#10,0", "mm", base, true), 10, 0);
  });
  it("take polar input", () => close(parsePointInput("@10<90", "mm", base, false), 100, 110));
  it("take architectural coordinates", () => close(parsePointInput(`@10',6"`, "architectural", base, false), 220, 106));
  it("give a bare number as a distance along the cursor", () => expect(parsePointInput(`5'`, "architectural", base, true)).toEqual({ kind: "distance", distance: 60 }));
});
