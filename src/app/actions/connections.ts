"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { restore3dModel } from "@/lib/tools/models3d";

/** Disconnects an AI app: removes its permission and revokes its tokens. Takes effect at once. */
export async function disconnectApp(clientId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  const id = z.string().min(1).max(2000).parse(clientId);
  const now = new Date();
  await db.$transaction([
    db.oauthConsent.deleteMany({ where: { userId: user.id, clientId: id } }),
    db.oauthAccessToken.updateMany({ where: { userId: user.id, clientId: id, revoked: null }, data: { revoked: now } }),
    db.oauthRefreshToken.updateMany({ where: { userId: user.id, clientId: id, revoked: null }, data: { revoked: now } }),
  ]);
  revalidatePath("/connections");
}

const modelUndo = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ifc_model_create"), modelId: z.uuid() }),
  z.object({ type: z.literal("ifc_model_restore"), modelId: z.uuid(), revision: z.number().int() }),
]);

const renameUndo = z.object({
  type: z.literal("rename_sheet"),
  sheetId: z.uuid(),
  number: z.string().nullable(),
  title: z.string().nullable(),
});

/** Reverses what an AI app did in one tool call: removes markups it added, or restores a renamed sheet. */
export async function undoActivity(activityId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(activityId)) throw new Error("Not found");
  const row = await db.mcpActivity.findFirst({ where: { id: activityId, userId: user.id } });
  const rename = renameUndo.safeParse(row?.undo);
  const model = modelUndo.safeParse(row?.undo);
  if (!row || (!row.markupIds.length && !rename.success && !model.success)) throw new Error("Nothing to undo");
  if (model.success) {
    // 3D models: delete one the app created, or put an updated one back to its earlier revision.
    if (model.data.type === "ifc_model_create") {
      await db.ifcModel.deleteMany({ where: { id: model.data.modelId, project: { orgId: user.orgId } } });
    } else {
      await restore3dModel(user.orgId, model.data.modelId, model.data.revision);
    }
  }
  const inOrg = { drawingSet: { project: { orgId: user.orgId } } };
  await db.$transaction([
    db.markup.deleteMany({ where: { id: { in: row.markupIds }, sheet: inOrg } }),
    ...(rename.success
      ? [db.sheet.updateMany({ where: { id: rename.data.sheetId, ...inOrg }, data: { number: rename.data.number, title: rename.data.title } })]
      : []),
    db.mcpActivity.update({ where: { id: row.id }, data: { markupIds: [], undo: Prisma.DbNull, summary: `${row.summary} (undone)` } }),
  ]);
  revalidatePath("/connections");
}
