import "server-only";
import path from "node:path";
import type { DraftDocument } from "./document";
import { MODEL } from "./document";
import { layoutSheet, modelSheet } from "./layouts";
import { plotPdf, type PlotSheet } from "./plot";
import { formatLength } from "./units";
import type { TextEntity } from "./types";

// A picture of a drawing for AI apps: plotted as it would print (in colour), then drawn to a
// JPEG with pdf.js on the server, as sheets are for read_sheet. Model space is shown whole,
// with the coordinates of its corners written on it, so the app can tell where things are.

const LONG_EDGE = 1568; // px; about 2k image tokens for the client's model

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | undefined;
const loadPdfjs = () => (pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs"));

/** The sheet showing all of model space, on paper of its proportions, with corner coordinates. */
function wholeModel(doc: DraftDocument): PlotSheet | null {
  const box = doc.extents(true, MODEL);
  if (!Number.isFinite(box.minX)) return null;
  const metric = doc.units === "mm";
  const long = metric ? 432 : 17;
  const w = Math.max(box.maxX - box.minX, 1e-9);
  const h = Math.max(box.maxY - box.minY, 1e-9);
  const aspect = Math.min(Math.max(w / h, 0.5), 2.5);
  const paper = aspect >= 1 ? { name: "View", width: long, height: long / aspect } : { name: "View", width: long * aspect, height: long };
  const sheet = modelSheet(doc, { paper: { ...paper, height: paper.height + (metric ? 16 : 0.6) }, plot: { monochrome: false, lineweights: true }, area: box, scale: "fit" });
  const label = (text: string, x: number, halign: "left" | "right"): TextEntity => ({
    id: `label-${halign}`,
    layer: "0",
    color: 8,
    lineweight: -1,
    linetype: "ByLayer",
    type: "text",
    at: { x, y: metric ? 4 : 0.15 },
    text,
    height: metric ? 3 : 0.12,
    rotation: 0,
    style: "Standard",
    halign,
    valign: "baseline",
  });
  const fmt = (x: number, y: number) => `(${formatLength(x, doc.units)}, ${formatLength(y, doc.units)})`;
  const margin = metric ? 6 : 0.25;
  sheet.paperEntities = [label(`lower left ${fmt(box.minX, box.minY)}`, margin, "left"), label(`upper right ${fmt(box.maxX, box.maxY)}`, sheet.paper.width - margin, "right")];
  return sheet;
}

/** A JPEG (base64) of model space or a layout, or null when there's nothing to show. */
export async function drawingImage(doc: DraftDocument, options: { layoutId?: string; loadPicture?: (key: string) => Promise<Uint8Array | null> } = {}) {
  const sheet = options.layoutId ? { ...layoutSheet(doc, options.layoutId), plot: { monochrome: false, lineweights: true } } : wholeModel(doc);
  if (!sheet) return null;
  const bytes = await plotPdf(doc, [sheet], { title: "view", loadPicture: options.loadPicture });
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: bytes, standardFontDataUrl: path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/") });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: LONG_EDGE / Math.max(base.width, base.height) });
    // pdf.js draws on @napi-rs/canvas in Node.
    const factory = pdf.canvasFactory as {
      create(w: number, h: number): { canvas: { encode(format: "jpeg", quality: number): Promise<Buffer> }; context: CanvasRenderingContext2D };
    };
    const { canvas, context } = factory.create(Math.round(viewport.width), Math.round(viewport.height));
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context, viewport, background: "#ffffff" }).promise;
    return (await canvas.encode("jpeg", 85)).toString("base64");
  } finally {
    await task.destroy();
  }
}
