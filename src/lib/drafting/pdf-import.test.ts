import { describe, expect, it } from "vitest";
import { bezierBulge, convertPdfPage, DEFAULT_PDF_IMPORT, type PdfOp, type PdfPageInput } from "./pdf-import";
import type { ArcEntity, CircleEntity, HatchEntity, LineEntity, PolylineEntity, TextEntity } from "./types";

// Path data as pdf.js gives it: 0 moveTo, 1 lineTo, 2 curveTo, 4 closePath.
const path = (paint: string, data: number[]): PdfOp => ({ fn: "constructPath", args: [paint, [data], null] });
const page = (ops: PdfOp[], extra: Partial<PdfPageInput> = {}): PdfPageInput => ({ ops, view: [0, 0, 1224, 792], ...extra });
const run = (ops: PdfOp[], extra: Partial<PdfPageInput> = {}, options = {}) => convertPdfPage(page(ops, extra), { ...DEFAULT_PDF_IMPORT, ...options }, "architectural", "0");

// A circle of radius r about (cx, cy) as four Beziers, as PDF writers draw one.
function circleData(cx: number, cy: number, r: number) {
  const k = 0.5523 * r;
  return [
    0, cx + r, cy,
    2, cx + r, cy + k, cx + k, cy + r, cx, cy + r,
    2, cx - k, cy + r, cx - r, cy + k, cx - r, cy,
    2, cx - r, cy - k, cx - k, cy - r, cx, cy - r,
    2, cx + k, cy - r, cx + r, cy - k, cx + r, cy,
    4,
  ];
}

const glyph = (ch: string, width = 600) => ({ unicode: ch, width, isSpace: ch === " " });
const text = (s: string, mode = 0, size = 10, at = [100, 100]): PdfOp[] => [
  { fn: "beginText", args: null },
  { fn: "setFont", args: ["F1", size] },
  { fn: "setTextRenderingMode", args: [mode] },
  { fn: "setTextMatrix", args: [[1, 0, 0, 1, at[0], at[1]]] },
  { fn: "showText", args: [[...s].map((c) => glyph(c))] },
  { fn: "endText", args: null },
];

describe("PDF import", () => {
  it("reads lines in inches from points, from the page's lower left corner", () => {
    const r = run([{ fn: "transform", args: [1, 0, 0, 1, 72, 72] }, path("stroke", [0, 0, 0, 1, 144, 0])]);
    const line = r.entities[0] as LineEntity;
    expect(line.type).toBe("line");
    expect(line.a.x).toBeCloseTo(1);
    expect(line.a.y).toBeCloseTo(1);
    expect(line.b.x).toBeCloseTo(3);
    expect(r.size).toEqual({ width: 17, height: 11 });
    expect(line.layer).toBe("PDF_Geometry");
  });

  it("makes millimetres for metric drawings", () => {
    const r = convertPdfPage(page([path("stroke", [0, 0, 0, 1, 72, 0])]), DEFAULT_PDF_IMPORT, "mm", "0");
    expect((r.entities[0] as LineEntity).b.x).toBeCloseTo(25.4);
  });

  it("joins segments end to end into polylines, and closes rectangles", () => {
    const r = run([path("stroke", [0, 0, 0, 1, 72, 0]), path("stroke", [0, 72, 0, 1, 72, 72]), path("stroke", [0, 72, 72, 1, 0, 72]), path("stroke", [0, 0, 72, 1, 0, 0])]);
    expect(r.entities).toHaveLength(1);
    const pl = r.entities[0] as PolylineEntity;
    expect(pl.type).toBe("polyline");
    expect(pl.closed).toBe(true);
    expect(pl.points).toHaveLength(4);
    expect(run([path("stroke", [0, 0, 0, 1, 72, 0]), path("stroke", [0, 72, 0, 1, 72, 72])], {}, { join: false }).entities).toHaveLength(2);
  });

  it("recognizes circles and arcs drawn as Beziers", () => {
    const r = run([path("stroke", circleData(300, 300, 36))]);
    const c = r.entities[0] as CircleEntity;
    expect(c.type).toBe("circle");
    expect(c.radius).toBeCloseTo(0.5, 2);
    expect(c.center.x).toBeCloseTo(300 / 72, 3);
    const quarter = run([path("stroke", circleData(300, 300, 36).slice(0, 10))]).entities[0] as ArcEntity;
    expect(quarter.type).toBe("arc");
    expect(quarter.radius).toBeCloseTo(0.5, 2);
    expect(quarter.start).toBeCloseTo(0, 2);
    expect(quarter.end).toBeCloseTo(Math.PI / 2, 2);
  });

  it("flattens Beziers that aren't circular", () => {
    expect(bezierBulge({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: -100 }, { x: 100, y: 0 }, 0.05)).toBeNull();
    const pl = run([path("stroke", [0, 0, 0, 2, 0, 100, 100, -100, 100, 0])]).entities[0] as PolylineEntity;
    expect(pl.type).toBe("polyline");
    expect(pl.points.length).toBeGreaterThan(4);
  });

  it("splits dashed lines into their dashes", () => {
    const r = run([{ fn: "setDash", args: [[6, 3], 0] }, path("stroke", [0, 0, 0, 1, 36, 0])]);
    expect(r.entities).toHaveLength(4);
    expect((r.entities[0] as LineEntity).b.x - (r.entities[0] as LineEntity).a.x).toBeCloseTo(6 / 72);
  });

  it("makes solid fills SOLID hatches, and keeps colours and lineweights", () => {
    const r = run([
      { fn: "setFillRGBColor", args: ["#ff0000"] },
      path("fill", [0, 0, 0, 1, 72, 0, 1, 72, 72, 4]),
      { fn: "setStrokeRGBColor", args: ["#000000"] },
      { fn: "setLineWidth", args: [1.42] }, // 0.5 mm
      path("stroke", [0, 0, 100, 1, 200, 100]),
    ]);
    const hatch = r.entities.find((e) => e.type === "hatch") as HatchEntity;
    expect(hatch.pattern).toBe("SOLID");
    expect(hatch.color).toBe("#ff0000");
    expect(hatch.layer).toBe("PDF_Solid Fills");
    const line = r.entities.find((e) => e.type === "line") as LineEntity;
    expect(line.color).toBe(7);
    expect(line.lineweight).toBe(50);
    expect(run([path("fill", [0, 0, 0, 1, 72, 0, 1, 72, 72, 4])], {}, { fills: false }).entities).toHaveLength(0);
  });

  it("drops what the clipping hides", () => {
    const clip: PdfOp[] = [{ fn: "save", args: null }, { fn: "eoClip", args: null }, path("endPath", [0, 0, 0, 1, 100, 0, 1, 100, 100, 1, 0, 100, 4])];
    const r = run([...clip, path("stroke", [0, 10, 10, 1, 20, 20]), path("stroke", [0, 300, 300, 1, 320, 320]), { fn: "restore", args: null }, path("stroke", [0, 300, 300, 1, 320, 300])]);
    expect(r.entities).toHaveLength(2);
  });

  it("imports text in a PDF_ style, with the capitals' height", () => {
    const r = run(text("GENERAL NOTES"), { fontNames: { F1: "Helvetica" } });
    const t = r.entities[0] as TextEntity;
    expect(t.type).toBe("text");
    expect(t.text).toBe("GENERAL NOTES");
    expect(t.at.x).toBeCloseTo(100 / 72);
    expect(t.height).toBeCloseTo((10 * 0.716) / 72, 3);
    expect(t.style).toBe("PDF_Helvetica");
    expect(r.textStyles[0].name).toBe("PDF_Helvetica");
    expect(r.layers.map((l) => l.name)).toContain("PDF_Text");
  });

  it("takes invisible text over stroked letters as the text, and drops the strokes", () => {
    // "AB" drawn as strokes 7 points high, with invisible text over them.
    const strokes = [path("stroke", [0, 100, 100, 1, 103, 107, 1, 106, 100]), path("stroke", [0, 108, 100, 1, 108, 107, 1, 112, 107])];
    const box = path("stroke", [0, 90, 90, 1, 300, 90]); // an underline: stays
    const r = run([{ fn: "setStrokeRGBColor", args: ["#0000ff"] }, ...strokes, box, ...text("AB", 3)]);
    const t = r.entities.find((e) => e.type === "text") as TextEntity;
    expect(t.text).toBe("AB");
    expect(t.color).toBe("#0000ff");
    expect(t.height).toBeCloseTo(7 / 72, 3);
    expect(r.entities.filter((e) => e.type !== "text")).toHaveLength(1);
    expect(r.counts.recognized).toBe(2);
    // Without recognition, the strokes stay and the invisible text is skipped.
    const raw = run([...strokes, ...text("AB", 3)], {}, { recognizeText: false });
    expect(raw.entities.every((e) => e.type !== "text")).toBe(true);
    // Invisible text with nothing under it (a scan's OCR) isn't imported.
    expect(run(text("AB", 3)).entities).toHaveLength(0);
  });

  it("merges words written one at a time on a line", () => {
    const ops = [...text("Client:", 0, 10, [100, 100]), ...text("Jane", 0, 10, [100 + 7 * 6 + 3, 100])];
    const t = run(ops).entities.filter((e) => e.type === "text") as TextEntity[];
    expect(t.map((x) => x.text)).toEqual(["Client: Jane"]);
  });

  it("puts objects on PDF layers, object layers, or the current layer", () => {
    const ops: PdfOp[] = [{ fn: "beginMarkedContentProps", args: ["OC", { type: "OCG", id: "7R" }] }, path("stroke", [0, 0, 0, 1, 10, 0]), { fn: "endMarkedContent", args: null }];
    expect(run(ops, { layerNames: { "7R": "BRDG_TEXT" } }).entities[0].layer).toBe("PDF_BRDG_TEXT");
    expect(run(ops, { layerNames: { "7R": "BRDG_TEXT" } }, { layers: "object" }).entities[0].layer).toBe("PDF_Geometry");
    expect(run(ops, {}, { layers: "current" }).entities[0].layer).toBe("0");
    expect(run(ops, {}, { layers: "current" }).layers).toEqual([]);
  });

  it("places pictures where the page draws them", () => {
    const r = run([{ fn: "transform", args: [144, 0, 0, 72, 72, 36] }, { fn: "paintImageXObject", args: ["img1", 10, 5] }]);
    expect(r.images).toHaveLength(1);
    expect(r.images[0]).toMatchObject({ opIndex: 1, at: { x: 1, y: 0.5 }, width: 2, height: 1, rotation: 0, layer: "PDF_Images" });
    expect(run([{ fn: "paintImageXObject", args: ["img1", 10, 5] }], {}, { images: false }).images).toHaveLength(0);
  });
});
