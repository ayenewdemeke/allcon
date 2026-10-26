"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, isUuid, requireProject } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deleteFiles } from "@/lib/storage";

const name = z.string().trim().min(1, "Give the drawing a name").max(200);

export type DrawingFormState = { error?: string };

/** A new, empty drawing, opened in the editor. */
export async function createDrawing(projectId: string, _prev: DrawingFormState, formData: FormData): Promise<DrawingFormState> {
  const { user, project } = await requireProject(projectId);
  const parsed = name.safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const drawing = await db.drawing.create({ data: { projectId: project.id, name: parsed.data, createdById: user.id } });
  revalidatePath(`/projects/${project.id}/drafting`);
  redirect(`/projects/${project.id}/drafting/${drawing.id}`);
}

async function ownDrawing(drawingId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(drawingId)) throw new Error("Drawing not found");
  const drawing = await db.drawing.findFirst({ where: { id: drawingId, project: { orgId: user.orgId } }, select: { id: true, projectId: true, fileKey: true } });
  if (!drawing) throw new Error("Drawing not found");
  return drawing;
}

export async function renameDrawing(drawingId: string, newName: string) {
  const drawing = await ownDrawing(drawingId);
  const parsed = name.safeParse(newName);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  await db.drawing.update({ where: { id: drawing.id }, data: { name: parsed.data } });
  revalidatePath(`/projects/${drawing.projectId}/drafting`, "layout");
}

export async function deleteDrawing(drawingId: string) {
  const drawing = await ownDrawing(drawingId);
  await db.drawing.delete({ where: { id: drawing.id } });
  await deleteFiles([drawing.fileKey]).catch((err) => console.error("Could not delete a drawing's file", err));
  revalidatePath(`/projects/${drawing.projectId}/drafting`);
}
