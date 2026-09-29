import "server-only";
import { db } from "@/lib/db";
import type { UnitSystem } from "@/lib/takeoff";

// What a marked-up PDF export (or a share link) needs: the sheets, their markups and scale,
// and, only when prices are included, the line items with their rates.

export type ExportMarkupData = {
  id: string;
  kind: "length" | "area" | "count" | "note" | "arrow" | "cloud";
  points: [number, number][];
  label: string | null;
  text: string | null;
  color: string;
  depth: number | null;
  lineItemId: string | null;
};

export type ExportData = {
  title: string; // drawing set file name, without extension
  currency: string;
  unitSystem: UnitSystem;
  includePrices: boolean;
  sheets: { id: string; pageIndex: number; name: string; metersPerPoint: number | null; scaleLabel: string | null; markups: ExportMarkupData[] }[];
  lineItems: { id: string; code: string | null; description: string; unit: string | null; rate: number | null }[];
};

export const sheetName = (s: { number: string | null; title: string | null; pageIndex: number }) =>
  [s.number ?? `Page ${s.pageIndex + 1}`, s.title].filter(Boolean).join(" · ");

/** Caller must have checked access to the drawing set. `sheetIds` null = every sheet. */
export async function loadExportData(drawingSetId: string, sheetIds: string[] | null, includePrices: boolean): Promise<ExportData> {
  const set = await db.drawingSet.findUniqueOrThrow({ where: { id: drawingSetId }, include: { project: true } });
  const sheets = await db.sheet.findMany({
    where: { drawingSetId, ...(sheetIds ? { id: { in: sheetIds } } : {}) },
    orderBy: { pageIndex: "asc" },
    include: { markups: { orderBy: { createdAt: "asc" } } },
  });
  const lineItems = includePrices
    ? await db.lineItem.findMany({
        where: { projectId: set.projectId, isHeading: false },
        select: { id: true, code: true, description: true, unit: true, rate: true },
      })
    : [];

  return {
    title: set.fileName.replace(/\.pdf$/i, ""),
    currency: set.project.currency,
    unitSystem: set.project.unitSystem,
    includePrices,
    sheets: sheets.map((s) => ({
      id: s.id,
      pageIndex: s.pageIndex,
      name: sheetName(s),
      metersPerPoint: s.metersPerPoint,
      scaleLabel: s.scaleLabel,
      markups: s.markups.map((m) => ({
        id: m.id,
        kind: m.kind,
        points: m.points as [number, number][],
        label: m.label,
        text: m.text,
        color: m.color,
        depth: m.depth,
        // Without prices, shared data doesn't reveal which lines things are priced against.
        lineItemId: includePrices ? m.lineItemId : null,
      })),
    })),
    lineItems: lineItems.map((i) => ({ ...i, rate: i.rate === null ? null : Number(i.rate) })),
  };
}
