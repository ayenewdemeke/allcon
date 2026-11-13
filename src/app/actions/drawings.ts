"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, isUuid, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { copyDrawingFile, drawingExtraFiles } from "@/lib/drafting/server";
import { deleteFiles } from "@/lib/storage";

const name = z.string().trim().min(1, "Give the drawing a name").max(200);
const units = z.enum(["architectural", "mm"]).catch("architectural");

export type DrawingFormState = { error?: string };

/** A new drawing, empty or a copy of a template (AutoCAD's NEW with a DWT), opened in the editor. */
export async function createDrawing(_prev: DrawingFormState, formData: FormData): Promise<DrawingFormState> {
  const user = await requireUser();
  const parsed = name.safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const templateId = String(formData.get("template") ?? "");
  const template = isUuid(templateId)
    ? await db.drawing.findFirst({ where: { id: templateId, orgId: user.orgId, isTemplate: true }, select: { id: true, units: true, fileKey: true, entityCount: true } })
    : null;
  if (templateId && !template) return { error: "That template isn't there any more" };
  const drawing = await db.drawing.create({
    data: { orgId: user.orgId, name: parsed.data, units: template ? template.units : units.parse(formData.get("units")), createdById: user.id },
  });
  if (template?.fileKey) {
    try {
      const fileKey = await copyDrawingFile(template.id, template.fileKey, drawing.id);
      await db.drawing.update({ where: { id: drawing.id }, data: { fileKey, entityCount: template.entityCount } });
    } catch (err) {
      console.error("Could not copy a template", err);
      await db.drawing.delete({ where: { id: drawing.id } });
      return { error: "Could not copy the template" };
    }
  }
  revalidatePath("/drafting");
  redirect(`/drafting/${drawing.id}`);
}

const description = z.string().trim().max(500);

/**
 * Save As (AutoCAD's SAVEAS): a copy of the drawing under a new name, as a drawing or as a
 * drawing template (DWT) with a description. The copy is what the person goes on working in.
 */
export async function saveDrawingAs(drawingId: string, input: { name: string; template: boolean; description?: string }): Promise<{ id: string }> {
  const user = await requireUser();
  if (!isUuid(drawingId)) throw new Error("Drawing not found");
  const source = await db.drawing.findFirst({
    where: { id: drawingId, orgId: user.orgId },
    select: { id: true, units: true, fileKey: true, entityCount: true, projectId: true },
  });
  if (!source) throw new Error("Drawing not found");
  const parsed = name.safeParse(input.name);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  const drawing = await db.drawing.create({
    data: {
      orgId: user.orgId,
      // A template is the organization's, not a project's.
      projectId: input.template ? null : source.projectId,
      name: parsed.data,
      units: source.units,
      isTemplate: input.template,
      description: input.template ? description.parse(input.description ?? "") || null : null,
      createdById: user.id,
    },
  });
  if (source.fileKey) {
    try {
      const fileKey = await copyDrawingFile(source.id, source.fileKey, drawing.id);
      await db.drawing.update({ where: { id: drawing.id }, data: { fileKey, entityCount: source.entityCount } });
    } catch (err) {
      await db.drawing.delete({ where: { id: drawing.id } });
      throw err;
    }
  }
  revalidatePath("/drafting");
  return { id: drawing.id };
}
async function ownDrawing(drawingId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(drawingId)) throw new Error("Drawing not found");
  const drawing = await db.drawing.findFirst({ where: { id: drawingId, orgId: user.orgId }, select: { id: true, fileKey: true, backupKey: true } });
  if (!drawing) throw new Error("Drawing not found");
  return drawing;
}

export async function renameDrawing(drawingId: string, newName: string) {
  const drawing = await ownDrawing(drawingId);
  const parsed = name.safeParse(newName);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  await db.drawing.update({ where: { id: drawing.id }, data: { name: parsed.data } });
  revalidatePath("/drafting", "layout");
}

export async function deleteDrawing(drawingId: string) {
  const drawing = await ownDrawing(drawingId);
  const extra = await drawingExtraFiles(drawing.id, drawing.fileKey);
  await db.drawing.delete({ where: { id: drawing.id } });
  await deleteFiles([drawing.fileKey, drawing.backupKey, ...extra]).catch((err) => console.error("Could not delete a drawing's files", err));
  revalidatePath("/drafting");
}
