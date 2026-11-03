import { describe, expect, it } from "vitest";
import { ptToPx, pxToPt, stepSize, textLook, textMiddle } from "./text-format";

describe("textLook", () => {
  it("takes the style's look by default", () => {
    expect(textLook({ style: "normal" })).toEqual({ font: "sans", size: 14, bold: false, italic: false, underline: false, color: "#171717" });
    expect(textLook({ style: "heading" })).toMatchObject({ size: 20, bold: true });
    expect(textLook({ style: "note" })).toMatchObject({ size: 12, italic: true, color: "#525252" });
  });

  it("puts the region's own format on top", () => {
    expect(textLook({ style: "heading", bold: false, size: 32, font: "serif", underline: true, color: "#dc2626" })).toEqual({ font: "serif", size: 32, bold: false, italic: false, underline: true, color: "#dc2626" });
    expect(textLook({ style: "note", italic: false })).toMatchObject({ italic: false });
  });
});

describe("sizes", () => {
  it("converts between points and pixels", () => {
    expect(ptToPx(10.5)).toBe(14);
    expect(pxToPt(20)).toBe(15);
  });

  it("steps up and down the list, staying at the ends", () => {
    expect(pxToPt(stepSize(14, 1))).toBe(11);
    expect(pxToPt(stepSize(14, -1))).toBe(10);
    expect(pxToPt(stepSize(ptToPx(36), 1))).toBe(36);
    expect(pxToPt(stepSize(ptToPx(8), -1))).toBe(8);
    expect(pxToPt(stepSize(ptToPx(13), 1))).toBe(14); // a size between steps goes to the next one
  });

  it("matches the line middles the worksheet used", () => {
    expect(Math.round(textMiddle(14))).toBe(12);
    expect(Math.round(textMiddle(20))).toBe(16);
  });
});
