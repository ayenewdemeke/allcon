import { describe, expect, it } from "vitest";
import { attributeDefs } from "./blocks";
import { evaluateFields, FIELD_CODES, formatDate } from "./fields";
import { drawingAreaBottom, titleBlockBottom } from "./layouts";

const ctx = { fileName: "5545 Rome St", layout: "S-01", now: new Date(2026, 9, 28) };

describe("fields", () => {
  it("fills in the file name, dates and layout, as AutoCAD's fields", () => {
    expect(evaluateFields(`File: ${FIELD_CODES.Filename}`, ctx)).toBe("File: 5545 Rome St");
    expect(evaluateFields(FIELD_CODES.PlotDate, ctx)).toBe("10/28/2026");
    expect(evaluateFields(FIELD_CODES.Layout, ctx)).toBe("S-01");
    expect(evaluateFields('%<\\AcVar Date \\f "MMMM d, yyyy">%', ctx)).toBe("October 28, 2026");
    expect(evaluateFields("%<\\AcVar Nonsense>%", ctx)).toBe("####");
    expect(evaluateFields("no fields", ctx)).toBe("no fields");
  });

  it("formats dates with AutoCAD's codes", () => {
    expect(formatDate(new Date(2026, 0, 5), "MM/dd/yy")).toBe("01/05/26");
    expect(formatDate(new Date(2026, 0, 5), "MMM d")).toBe("Jan 5");
  });
});

describe("bottom title block", () => {
  const paper = { name: "ANSI B (17 x 11 in)", width: 17, height: 11 };
  const block = titleBlockBottom(paper, "architectural");

  it("has the fields of a sheet like the owner's, with the print date and file name as fields", () => {
    const defs = attributeDefs(block);
    const tags = defs.map((d) => d.tag);
    for (const tag of ["CLIENT", "CLIENT_EMAIL", "CLIENT_ADDRESS", "CLIENT_PHONE", "DESIGNER", "PROJECT_NUMBER", "STRUCTURE_TYPE", "PROJECT_LOCATION", "PRINT_DATE", "FILE_NAME", "PROJECT", "SHEET_TITLE", "SHEET_NUMBER"])
      expect(tags).toContain(tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(defs.find((d) => d.tag === "PRINT_DATE")!.value).toBe(FIELD_CODES.PlotDate);
    expect(defs.find((d) => d.tag === "FILE_NAME")!.value).toBe(FIELD_CODES.Filename);
  });

  it("stays inside the paper's border, and leaves the area above the strip for the drawing", () => {
    for (const e of block.entities) {
      const pts = e.type === "line" ? [e.a, e.b] : e.type === "polyline" ? e.points : "at" in e ? [e.at] : [];
      for (const p of pts) {
        expect(p.x).toBeGreaterThanOrEqual(0.5 - 1e-9);
        expect(p.x).toBeLessThanOrEqual(16.5 + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(0.5 - 1e-9);
        expect(p.y).toBeLessThanOrEqual(10.5 + 1e-9);
      }
    }
    const area = drawingAreaBottom(paper, "architectural");
    expect(area.minY).toBeCloseTo(0.5 + 2.2 + 0.25);
    expect(area.maxX).toBeCloseTo(16.25);
  });

  it("is drawn in millimetres on metric paper", () => {
    const a3 = titleBlockBottom({ name: "ISO A3 (420 x 297 mm)", width: 420, height: 297 }, "mm");
    const border = a3.entities[0];
    expect(border.type === "polyline" && border.points[0]).toEqual({ x: 12.7, y: 12.7 });
  });
});
