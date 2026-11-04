import {
  beginText,
  clip,
  closePath,
  concatTransformationMatrix,
  drawObject,
  endPath,
  endText,
  fill,
  lineTo,
  LineCapStyle,
  LineJoinStyle,
  moveTo,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  setTextMatrix,
  showText,
  StandardFonts,
  stroke,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
} from "@cantoo/pdf-lib";
import { displayColor } from "./aci";
import { blockParts } from "./blocks";
import type { DraftDocument } from "./document";
import { graphicsOf, imageCorners, type TextRun } from "./geometry";
import { LW_BYBLOCK, LW_BYLAYER, LW_DEFAULT, type Entity, type ImageEntity, type PlotSettings, type Units, type Vec } from "./types";

// Plotting to PDF, as AutoCAD's DWG To PDF: vector linework at its real lineweights, filled
// areas, text in the standard PDF fonts, attached pictures, and each viewport's view of the
// model clipped to its frame. Black and white (monochrome.ctb) or in colour.

/** A window onto model space on the sheet: paper = center + (model − view) × scale. */
export type PlotView = { center: Vec; width: number; height: number; view: Vec; scale: number };

/** One sheet: its paper (in the drawing's paper units), what's drawn on it 1:1, and its views. */
export type PlotSheet = { paper: { width: number; height: number }; plot: PlotSettings; paperEntities: Entity[]; views: PlotView[] };

/** PDF points per paper unit (inches, or millimetres for metric drawings). */
export const pointsPerUnit = (units: Units) => (units === "mm" ? 72 / 25.4 : 72);

const DEFAULT_LINEWEIGHT = 25; // AutoCAD's LWDEFAULT: 0.25 mm
const THIN = 0.24; // points: lines when lineweights aren't plotted
const CAP = { [StandardFonts.Helvetica]: 0.718, [StandardFonts.TimesRoman]: 0.662, [StandardFonts.Courier]: 0.571 } as Record<string, number>;

const fontFor = (family: string) => (/times|georgia/i.test(family) ? StandardFonts.TimesRoman : /courier/i.test(family) ? StandardFonts.Courier : StandardFonts.Helvetica);

function rgbOf(css: string): [number, number, number] {
  const hex = css.replace("#", "");
  return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];
}

export async function plotPdf(doc: DraftDocument, sheets: PlotSheet[], options: { title: string; loadPicture?: (key: string) => Promise<Uint8Array | null> }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(options.title);
  pdf.setCreator("allcon drafting");
  pdf.setProducer("allcon");
  const k = pointsPerUnit(doc.units);
  // Fonts and pictures are embedded first; then every sheet is drawn in one go, with nothing
  // awaited, so the drawing's styles and blocks stay the ones in use (a server plots many).
  const fonts = new Map<string, { font: PDFFont; chars: Set<number> }>();
  for (const name of [StandardFonts.Helvetica, StandardFonts.TimesRoman, StandardFonts.Courier]) {
    const embedded = await pdf.embedFont(name);
    fonts.set(name, { font: embedded, chars: new Set(embedded.getCharacterSet()) });
  }
  const pictures = new Map<string, PDFImage | null>();
  const keys = new Set<string>();
  for (const space of [doc.entitiesIn("model"), ...[...doc.layouts.keys()].map((id) => doc.entitiesIn(id))]) for (const e of space.values()) if (e.type === "image") keys.add(e.key);
  for (const key of keys) {
    const bytes = await options.loadPicture?.(key).catch(() => null);
    let image: PDFImage | null = null;
    if (bytes && bytes[0] === 0x89 && bytes[1] === 0x50) image = await pdf.embedPng(bytes);
    else if (bytes && bytes[0] === 0xff && bytes[1] === 0xd8) image = await pdf.embedJpg(bytes);
    pictures.set(key, image);
  }
  const font = (name: string) => fonts.get(name)!;
  const picture = (key: string) => pictures.get(key) ?? null;

  doc.activate();
  for (const sheet of sheets) {
    const page = pdf.addPage([sheet.paper.width * k, sheet.paper.height * k]);
    const ops: PDFOperator[] = [setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round)];
    const ctx = { doc, page, ops, sheet, font, picture, k, pdf };
    drawSpace(ctx, sheet.paperEntities, (p) => ({ x: p.x * k, y: p.y * k }), 1);
    for (const v of sheet.views) {
      const map = (p: Vec) => ({ x: (v.center.x + (p.x - v.view.x) * v.scale) * k, y: (v.center.y + (p.y - v.view.y) * v.scale) * k });
      const half = { x: v.width / 2 / v.scale, y: v.height / 2 / v.scale };
      const box = { minX: v.view.x - half.x, minY: v.view.y - half.y, maxX: v.view.x + half.x, maxY: v.view.y + half.y };
      ops.push(pushGraphicsState(), rectangle((v.center.x - v.width / 2) * k, (v.center.y - v.height / 2) * k, v.width * k, v.height * k), clip(), endPath());
      drawSpace(ctx, doc.query(box, "model"), map, v.scale);
      ops.push(popGraphicsState());
    }
    page.pushOperators(...ops);
  }
  return pdf.save();
}

type Ctx = {
  doc: DraftDocument;
  page: PDFPage;
  ops: PDFOperator[];
  sheet: PlotSheet;
  k: number;
  pdf: PDFDocument;
  font: (name: string) => { font: PDFFont; chars: Set<number> };
  picture: (key: string) => PDFImage | null;
};

/** Whether an object plots: on a visible layer that plots (Defpoints never does). */
function plots(doc: DraftDocument, e: Entity) {
  const layer = doc.layerOf(e);
  return doc.isVisible(e) && e.layer !== "Defpoints" && layer?.plot !== false;
}

/** Draws a space's objects: pictures underneath, then each object's fills, lines and text. */
function drawSpace(ctx: Ctx, entities: Entity[], map: (p: Vec) => Vec, scale: number) {
  const { doc, ops, sheet, k } = ctx;
  const flat: Entity[] = [];
  for (const e of entities) {
    if (!plots(doc, e)) continue;
    if (e.type !== "insert") flat.push(e);
    else for (const part of blockParts(e)) if (plots(doc, part)) flat.push(part);
  }
  for (const e of flat) if (e.type === "image") drawPicture(ctx, e, map);
  for (const e of flat) {
    if (e.type === "image") continue;
    const layer = doc.layerOf(e);
    const css = sheet.plot.monochrome ? "#000000" : displayColor(e.color ?? layer?.color ?? 7, false);
    const [r, g, b] = rgbOf(css);
    let lw = e.lineweight === LW_BYLAYER || e.lineweight === LW_BYBLOCK ? (layer?.lineweight ?? LW_DEFAULT) : e.lineweight;
    if (lw === LW_DEFAULT || lw < 0) lw = DEFAULT_LINEWEIGHT;
    const width = sheet.plot.lineweights ? Math.max((lw / 100) * (72 / 25.4), 0.1) : THIN;
    const graphics = graphicsOf(e);
    if (graphics.fills.length) {
      ops.push(setFillingRgbColor(r, g, b));
      for (const f of graphics.fills) {
        f.forEach((p, i) => {
          const q = map(p);
          ops.push(i ? lineTo(q.x, q.y) : moveTo(q.x, q.y));
        });
        ops.push(closePath());
      }
      ops.push(fill());
    }
    if (graphics.lines.length) {
      ops.push(setStrokingRgbColor(r, g, b), setLineWidth(width));
      for (const line of graphics.lines) {
        line.forEach((p, i) => {
          const q = map(p);
          ops.push(i ? lineTo(q.x, q.y) : moveTo(q.x, q.y));
        });
      }
      ops.push(stroke());
    }
    for (const run of graphics.texts) drawText(ctx, run, map, scale * k, [r, g, b]);
  }
}

function drawText(ctx: Ctx, run: TextRun, map: (p: Vec) => Vec, pointsPerUnit: number, [r, g, b]: [number, number, number]) {
  const name = fontFor(run.font);
  const { font, chars } = ctx.font(name);
  const text = [...run.text].map((c) => (chars.has(c.codePointAt(0)!) ? c : "?")).join("");
  if (!text.trim()) return;
  const cap = run.height * pointsPerUnit; // capital height on the sheet, in points
  if (cap < 0.5) return;
  const size = cap / (CAP[name] ?? 0.718);
  const width = font.widthOfTextAtSize(text, size) * run.widthFactor;
  // Where the baseline starts, from the justification (as the editor lays text out).
  const x0 = run.halign === "left" ? 0 : run.halign === "center" ? -width / 2 : -width;
  const y0 = run.valign === "baseline" ? 0 : run.valign === "bottom" ? cap * 0.3 : run.valign === "middle" ? -cap / 2 : -cap;
  const at = map(run.at);
  const [c, s] = [Math.cos(run.rotation), Math.sin(run.rotation)];
  const key = ctx.page.node.newFontDictionary(font.name, font.ref);
  ctx.ops.push(
    setFillingRgbColor(r, g, b),
    beginText(),
    setFontAndSize(key, size),
    setTextMatrix(run.widthFactor * c, run.widthFactor * s, -s, c, at.x + x0 * c - y0 * s, at.y + x0 * s + y0 * c),
    showText(font.encodeText(text)),
    endText(),
  );
}

function drawPicture(ctx: Ctx, e: ImageEntity, map: (p: Vec) => Vec) {
  const image = ctx.picture(e.key);
  if (!image) return;
  const [a, b, , d] = imageCorners(e).map(map);
  const name = ctx.page.node.newXObject("Image", image.ref);
  const opacity = 1 - Math.min(Math.max(e.fade, 0), 100) / 100;
  ctx.ops.push(pushGraphicsState());
  if (opacity < 1) ctx.ops.push(setGraphicsState(ctx.page.node.newExtGState("GS", ctx.pdf.context.obj({ ca: opacity, CA: opacity }))));
  ctx.ops.push(concatTransformationMatrix(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y, a.x, a.y), drawObject(name), popGraphicsState());
}
