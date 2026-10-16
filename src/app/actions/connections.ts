"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, isUuid } from "@/lib/auth/session";

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

/** Removes the markups an AI app added in one tool call. */
export async function undoActivity(activityId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(activityId)) throw new Error("Not found");
  const row = await db.mcpActivity.findFirst({ where: { id: activityId, userId: user.id } });
  if (!row || !row.markupIds.length) throw new Error("Nothing to undo");
  await db.$transaction([
    db.markup.deleteMany({ where: { id: { in: row.markupIds }, sheet: { drawingSet: { project: { orgId: user.orgId } } } } }),
    db.mcpActivity.update({ where: { id: row.id }, data: { markupIds: [], summary: `${row.summary} (undone)` } }),
  ]);
  revalidatePath("/connections");
}
