"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteObject } from "@/lib/aps/oss";
import { db } from "@/lib/db";
import { detectStoredSheetNumbers } from "@/lib/pdf/server-sheet";
import { findAccessibleDrawingSet, findAccessibleSheet, getCurrentUser, isUuid } from "@/lib/auth/session";

// Every action checks access itself: server actions are public endpoints.

const pointList = z
  .array(z.tuple([z.number().finite(), z.number().finite()]))
  .min(1)
  .max(10_000);

const markupFields = z.object({
  points: pointList,
  label: z.string().trim().max(200).nullish(),
  text: z.string().trim().max(2000).nullish(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  depth: z.number().positive().max(1000).nullish(),
});

const newMarkup = markupFields.extend({
  kind: z.enum(["length", "area", "count", "note", "arrow", "cloud"]),
});

export type SavedMarkup = {
  id: string;
  kind: z.infer<typeof newMarkup>["kind"];
  points: [number, number][];
  label: string | null;
  text: string | null;
  color: string;
  depth: number | null;
  lineItemId: string | null;
};

async function requireSheet(sheetId: string) {
  const access = await findAccessibleSheet(sheetId);
  if (!access) throw new Error("Sheet not found");
  return access;
}

async function requireMarkup(markupId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(markupId)) throw new Error("Markup not found");
  const markup = await db.markup.findFirst({
    where: { id: markupId, sheet: { drawingSet: { project: { orgId: user.orgId } } } },
  });
  if (!markup) throw new Error("Markup not found");
  return markup;
}

const toSaved = (m: { id: string; kind: SavedMarkup["kind"]; points: unknown; label: string | null; text: string | null; color: string; depth: number | null; lineItemId: string | null }): SavedMarkup => ({
  id: m.id,
  kind: m.kind,
  points: m.points as [number, number][],
  label: m.label,
  text: m.text,
  color: m.color,
  depth: m.depth,
  lineItemId: m.lineItemId,
});

export async function renameSheet(sheetId: string, input: { number?: string | null; title?: string | null }) {
  await requireSheet(sheetId);
  const data = z
    .object({ number: z.string().trim().max(40).nullish(), title: z.string().trim().max(200).nullish() })
    .parse(input);
  await db.sheet.update({
    where: { id: sheetId },
    data: {
      ...(data.number !== undefined && { number: data.number || null }),
      ...(data.title !== undefined && { title: data.title || null }),
    },
  });
}

export async function setSheetScale(sheetId: string, metersPerPoint: number | null, label: string | null) {
  await requireSheet(sheetId);
  const mpp = z.number().positive().finite().nullable().parse(metersPerPoint);
  await db.sheet.update({
    where: { id: sheetId },
    data: { metersPerPoint: mpp, scaleLabel: mpp ? z.string().max(60).parse(label ?? "Calibrated") : null },
  });
}

export async function createMarkup(sheetId: string, input: unknown): Promise<SavedMarkup> {
  const { user } = await requireSheet(sheetId);
  const data = newMarkup.parse(input);
  const markup = await db.markup.create({ data: { ...data, sheetId, createdById: user.id } });
  return toSaved(markup);
}

export async function updateMarkup(markupId: string, input: unknown): Promise<SavedMarkup> {
  await requireMarkup(markupId);
  const data = markupFields.partial().parse(input);
  return toSaved(await db.markup.update({ where: { id: markupId }, data }));
}

export async function deleteMarkup(markupId: string) {
  await requireMarkup(markupId);
  await db.markup.delete({ where: { id: markupId } });
}

export async function setProjectUnits(projectId: string, unitSystem: "imperial" | "metric") {
  const user = await getCurrentUser();
  if (!user || !isUuid(projectId)) throw new Error("Project not found");
  const system = z.enum(["imperial", "metric"]).parse(unitSystem);
  const { count } = await db.project.updateMany({ where: { id: projectId, orgId: user.orgId }, data: { unitSystem: system } });
  if (!count) throw new Error("Project not found");
}

/**
 * Deletes a drawing set with its sheets, markups, share links and reviews, and removes the
 * PDF from storage.
 */
export async function deleteDrawingSet(drawingSetId: string) {
  const access = await findAccessibleDrawingSet(drawingSetId);
  if (!access) throw new Error("Drawing set not found");
  const { drawingSet } = access;
  await db.drawingSet.delete({ where: { id: drawingSet.id } });
  if (drawingSet.objectKey) {
    await deleteObject(drawingSet.objectKey).catch((err) => console.error("Could not delete the drawing file", err));
  }
  revalidatePath(`/projects/${drawingSet.projectId}/sheets`);
}

export type SheetNumberChange = { sheetId: string; page: number; title: string | null; current: string | null; detected: string };

/** Reads each page's title block again and lists sheets whose number would change. */
export async function previewSheetNumbers(drawingSetId: string): Promise<SheetNumberChange[]> {
  const access = await findAccessibleDrawingSet(drawingSetId);
  if (!access?.drawingSet.objectKey || access.drawingSet.status !== "ready") throw new Error("Drawing set not found");
  const [detected, sheets] = await Promise.all([
    detectStoredSheetNumbers(access.drawingSet.objectKey).catch((err) => {
      console.error("Could not read title blocks", err); // the browser only sees a generic error
      throw err;
    }),
    db.sheet.findMany({ where: { drawingSetId }, orderBy: { pageIndex: "asc" } }),
  ]);
  return sheets.flatMap((s) => {
    const found = detected[s.pageIndex];
    return found && found !== s.number ? [{ sheetId: s.id, page: s.pageIndex + 1, title: s.title, current: s.number, detected: found }] : [];
  });
}

export async function applySheetNumbers(drawingSetId: string, changes: { sheetId: string; number: string }[]) {
  const access = await findAccessibleDrawingSet(drawingSetId);
  if (!access) throw new Error("Drawing set not found");
  const list = z.array(z.object({ sheetId: z.uuid(), number: z.string().trim().min(1).max(40) })).max(5000).parse(changes);
  await db.$transaction(list.map((c) => db.sheet.updateMany({ where: { id: c.sheetId, drawingSetId }, data: { number: c.number } })));
  revalidatePath(`/projects/${access.drawingSet.projectId}/sheets`);
}
