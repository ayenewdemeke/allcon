"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { drawingExtraFiles } from "@/lib/drafting/server";
import { deleteFiles } from "@/lib/storage";
import { drawingUndo } from "@/lib/tools/drafting";
import { removeModel, restoreModel } from "@/lib/tools/models3d";

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
  z.object({ type: z.literal("ifc_model_restore"), modelId: z.uuid(), backupKey: z.string().min(1) }),
]);

const drawingCreateUndo = z.object({ type: z.literal("drawing_create"), drawingId: z.uuid() });

/** Drafting: a drawing the app made goes; an edited one goes back to before the app's request
 * (unless someone has changed it since, which undoing would lose). */
async function undoDrawing(orgId: string, undo: unknown) {
  const created = drawingCreateUndo.safeParse(undo);
  const edited = drawingUndo.safeParse(undo);
  const drawingId = created.success ? created.data.drawingId : edited.success ? edited.data.drawingId : null;
  if (!drawingId) return false;
  const drawing = await db.drawing.findFirst({ where: { id: drawingId, orgId } });
  if (!drawing) throw new Error("That drawing no longer exists");
  if (created.success) {
    const extra = await drawingExtraFiles(drawing.id, drawing.fileKey);
    await db.drawing.delete({ where: { id: drawing.id } });
    await deleteFiles([drawing.fileKey, drawing.backupKey, ...extra]).catch(() => {});
    return true;
  }
  if (!edited.success) return false;
  if (drawing.revision !== edited.data.revision) throw new Error("The drawing has changed since; open it and undo there instead");
  const { count } = await db.drawing.updateMany({
    where: { id: drawing.id, revision: drawing.revision },
    data: { fileKey: edited.data.backupKey, backupKey: null, revision: drawing.revision + 1 },
  });
  if (!count) throw new Error("The drawing has changed since; open it and undo there instead");
  if (drawing.fileKey && drawing.fileKey !== edited.data.backupKey) await deleteFiles([drawing.fileKey]).catch(() => {});
  return true;
}

const mappingUndo = z.object({ type: z.literal("mapping_rules_create"), ruleIds: z.array(z.uuid()) });

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
  const mapping = mappingUndo.safeParse(row?.undo);
  const drawing = row ? await undoDrawing(user.orgId, row.undo) : false;
  if (!row || (!row.markupIds.length && !rename.success && !model.success && !mapping.success && !drawing)) throw new Error("Nothing to undo");
  if (model.success) {
    // 3D models: delete one the app created, or put an edited one back as it was before.
    if (model.data.type === "ifc_model_create") await removeModel(user.orgId, model.data.modelId);
    else await restoreModel(user.orgId, model.data.modelId, model.data.backupKey);
  }
  const inOrg = { drawingSet: { project: { orgId: user.orgId } } };
  await db.$transaction([
    db.markup.deleteMany({ where: { id: { in: row.markupIds }, sheet: inOrg } }),
    // Mappings the app made: its rules and the element mappings they created.
    ...(mapping.success
      ? [
          db.elementMapping.deleteMany({ where: { ruleId: { in: mapping.data.ruleIds }, rule: { project: { orgId: user.orgId } } } }),
          db.mappingRule.deleteMany({ where: { id: { in: mapping.data.ruleIds }, project: { orgId: user.orgId } } }),
        ]
      : []),
    ...(rename.success
      ? [db.sheet.updateMany({ where: { id: rename.data.sheetId, ...inOrg }, data: { number: rename.data.number, title: rename.data.title } })]
      : []),
    db.mcpActivity.update({ where: { id: row.id }, data: { markupIds: [], undo: Prisma.DbNull, summary: `${row.summary} (undone)` } }),
  ]);
  revalidatePath("/connections");
}
