import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { calcPdf } from "./pdf";
import { emptyCalc, type TextRegion } from "./types";

vi.mock("server-only", () => ({}));

const text = (id: string, y: number, extra: Partial<TextRegion> = {}): TextRegion => ({ id, kind: "text", x: 0, y, text: `Text ${id}`, style: "normal", width: 480, ...extra });

/** The standard fonts a PDF uses. */
async function fontsOf(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const fonts = pdf.getPages()[0].node.Resources()?.lookup(PDFName.of("Font"));
  const names = new Set<string>();
  for (const [, ref] of (fonts as unknown as { entries: () => [unknown, unknown][] }).entries()) {
    const font = pdf.context.lookup(ref as never) as unknown as { get: (n: PDFName) => { toString(): string } };
    names.add(font.get(PDFName.of("BaseFont")).toString().replace("/", ""));
  }
  return names;
}

describe("calcPdf text formatting", () => {
  it("draws each text region in its font, bold and italic", async () => {
    const data = {
      ...emptyCalc(),
      regions: [
        text("a", 0),
        text("b", 40, { font: "serif", bold: true, italic: true, size: 24 }),
        text("c", 100, { font: "mono", underline: true }),
        text("d", 140, { style: "heading", bold: false }),
      ],
    };
    const { bytes, pages } = await calcPdf(data, new Map(), { title: "Formatting" });
    expect(pages).toBe(1);
    const fonts = await fontsOf(bytes);
    expect(fonts).toContain("Times-BoldItalic");
    expect(fonts).toContain("Courier");
    expect(fonts).toContain("Helvetica");
    expect(fonts).not.toContain("Courier-Bold");
  });
});
