import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { readStoredSheet } from "@/lib/pdf/server-sheet";
import { drawIssueMarkups } from "@/lib/review/markups";
import { sheetName } from "@/lib/sheets/export-data";
import { formatMeasure, measureMarkup } from "@/lib/takeoff";
import { requireProject, requireSheet, ToolError, type ToolContext } from "./context";

const KIND_LABELS: Record<string, string> = { length: "Length", area: "Area", count: "Count", note: "Note", arrow: "Arrow", cloud: "Cloud" };
const round = (n: number) => Math.round(n);

export async function listSheets(ctx: ToolContext, projectId: string, drawingSetId?: string) {
  await requireProject(ctx, projectId);
  const sets = await db.drawingSet.findMany({
    where: { projectId, status: "ready", ...(drawingSetId ? { id: drawingSetId } : {}) },
    orderBy: { uploadedAt: "desc" },
    include: { sheets: { orderBy: { pageIndex: "asc" }, include: { _count: { select: { markups: true } } } } },
  });
  return sets.map((set) => ({
    drawingSetId: set.id,
    fileName: set.fileName,
    sheets: set.sheets.map((s) => ({
      id: s.id,
      name: sheetName(s),
      page: s.pageIndex + 1,
      scale: s.metersPerPoint ? (s.scaleLabel ?? "calibrated") : null,
      markups: s._count.markups,
    })),
  }));
}

/**
 * A sheet's text as numbered lines, each with its box in sheet points ([x0, y0, x1, y1],
 * origin top-left), plus a JPEG of the sheet when asked. The boxes are what add_cloud and
 * flag_issue take.
 */
export async function readSheet(ctx: ToolContext, sheetId: string, includeImage: boolean) {
  const sheet = await requireSheet(ctx, sheetId);
  if (!sheet.drawingSet.objectKey) throw new ToolError("This sheet's file isn't available.");
  const { lines, image } = await readStoredSheet(sheet.drawingSet.objectKey, sheet.pageIndex, { image: includeImage });
  return {
    sheet: {
      id: sheet.id,
      name: sheetName(sheet),
      drawingSet: sheet.drawingSet.fileName,
      project: sheet.drawingSet.project.name,
      projectId: sheet.drawingSet.projectId,
      sizePoints: [round(sheet.width), round(sheet.height)],
      scale: sheet.metersPerPoint ? (sheet.scaleLabel ?? "calibrated") : "not scaled",
      link: `/projects/${sheet.drawingSet.projectId}/sheets/${sheet.id}`,
    },
    note: lines.length
      ? "Lines are in reading order: L<id> [x0,y0,x1,y1] text. Coordinates are PDF points from the sheet's top-left."
      : "This sheet has no text layer (likely scanned or plotted); read it from the image.",
    lines: lines.map((l) => `L${l.id} [${l.box.map(round).join(",")}] ${l.text}`),
    image,
  };
}

export async function listMarkups(ctx: ToolContext, sheetId: string) {
  const sheet = await requireSheet(ctx, sheetId);
  const markups = await db.markup.findMany({
    where: { sheetId },
    orderBy: { createdAt: "asc" },
    include: { lineItem: { select: { code: true, description: true, unit: true } } },
  });
  const units = sheet.drawingSet.project.unitSystem;
  return {
    sheet: sheetName(sheet),
    projectId: sheet.drawingSet.projectId,
    scale: sheet.metersPerPoint ? (sheet.scaleLabel ?? "calibrated") : "not scaled (lengths and areas unmeasured)",
    markups: markups.map((m) => {
      const pts = m.points as [number, number][];
      const measured = measureMarkup({ kind: m.kind, points: pts, depth: m.depth }, sheet.metersPerPoint);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return {
        id: m.id,
        type: KIND_LABELS[m.kind],
        label: m.label,
        text: m.text,
        quantity: measured ? formatMeasure(measured.value, measured.kind, units) : null,
        lineItem: m.lineItem ? [m.lineItem.code, m.lineItem.description].filter(Boolean).join(" · ") : null,
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(round),
      };
    }),
  };
}

export const boxSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .describe("[x0, y0, x1, y1] in sheet points from the top-left, e.g. a line's box from read_sheet");
const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i).optional();

function inSheet(sheet: { width: number; height: number }, box: number[]) {
  const [x0, y0, x1, y1] = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
  if (x1 < 0 || y1 < 0 || x0 > sheet.width || y0 > sheet.height) {
    throw new ToolError(`That box is outside the sheet (${round(sheet.width)} × ${round(sheet.height)} points).`);
  }
  return [Math.max(0, x0), Math.max(0, y0), Math.min(sheet.width, x1), Math.min(sheet.height, y1)];
}

export async function addNote(ctx: ToolContext, input: { sheetId: string; x: number; y: number; text: string; color?: string }) {
  const sheet = await requireSheet(ctx, input.sheetId);
  colorSchema.parse(input.color);
  const [x, y] = inSheet(sheet, [input.x, input.y, input.x, input.y]);
  const m = await db.markup.create({
    data: { sheetId: sheet.id, kind: "note", points: [[x, y]], text: input.text.slice(0, 2000), color: input.color ?? "#ca8a04", createdById: ctx.userId },
  });
  return { markupId: m.id, sheet: sheetName(sheet), projectId: sheet.drawingSet.projectId };
}

export async function addCloud(ctx: ToolContext, input: { sheetId: string; box: number[]; label?: string; color?: string }) {
  const sheet = await requireSheet(ctx, input.sheetId);
  colorSchema.parse(input.color);
  const [x0, y0, x1, y1] = inSheet(sheet, input.box);
  const m = await db.markup.create({
    data: {
      sheetId: sheet.id,
      kind: "cloud",
      points: [[x0, y0], [x1, y1]],
      label: input.label?.slice(0, 200) ?? null,
      color: input.color ?? "#dc2626",
      createdById: ctx.userId,
    },
  });
  return { markupId: m.id, sheet: sheetName(sheet), projectId: sheet.drawingSet.projectId };
}

/** A review finding: cloud around the evidence plus a note with the explanation and citation. */
export async function flagIssue(
  ctx: ToolContext,
  input: { sheetId: string; box?: number[]; title: string; detail: string; severity: "major" | "minor"; citation?: string },
) {
  const sheet = await requireSheet(ctx, input.sheetId);
  const box = input.box ? inSheet(sheet, input.box) : null;
  const markupIds = await drawIssueMarkups({
    sheet,
    box,
    title: input.title.slice(0, 200),
    detail: input.detail.slice(0, 2000),
    citation: input.citation?.slice(0, 300) ?? null,
    severity: input.severity,
    userId: ctx.userId,
  });
  return { markupIds, sheet: sheetName(sheet), projectId: sheet.drawingSet.projectId, link: `/projects/${sheet.drawingSet.projectId}/sheets/${sheet.id}` };
}
