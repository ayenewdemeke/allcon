"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, isUuid, requireUser } from "@/lib/auth/session";
import { BRIDGE_DEFAULTS, bridgeDefinition } from "@/lib/bridge/definition";
import { db } from "@/lib/db";

const name = z.string().trim().min(1, "Give the bridge a name").max(200);

async function ownBridge(bridgeId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in first");
  const bridge = isUuid(bridgeId) ? await db.bridge.findFirst({ where: { id: bridgeId, orgId: user.orgId } }) : null;
  if (!bridge) throw new Error("Bridge not found");
  return { user, bridge };
}

/** A new bridge with the wizard's defaults, opened. */
export async function createBridge() {
  const user = await requireUser();
  const count = await db.bridge.count({ where: { orgId: user.orgId } });
  const bridge = await db.bridge.create({ data: { orgId: user.orgId, name: `Bridge ${count + 1}`, definition: BRIDGE_DEFAULTS as unknown as Prisma.InputJsonValue, createdById: user.id } });
  revalidatePath("/bridges");
  redirect(`/bridges/${bridge.id}`);
}

/** The bridge's definition as it's edited (saved as you go). */
export async function saveBridgeDefinition(bridgeId: string, definition: unknown) {
  const { bridge } = await ownBridge(bridgeId);
  await db.bridge.update({ where: { id: bridge.id }, data: { definition: bridgeDefinition(definition) as unknown as Prisma.InputJsonValue } });
}

export async function renameBridge(bridgeId: string, newName: string) {
  const { bridge } = await ownBridge(bridgeId);
  const parsed = name.safeParse(newName);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  await db.bridge.update({ where: { id: bridge.id }, data: { name: parsed.data } });
  revalidatePath("/bridges", "layout");
}

export async function setBridgeProject(bridgeId: string, projectId: string | null) {
  const { user, bridge } = await ownBridge(bridgeId);
  const project = projectId && isUuid(projectId) ? await db.project.findFirst({ where: { id: projectId, orgId: user.orgId }, select: { id: true } }) : null;
  if (projectId && !project) throw new Error("Project not found");
  await db.bridge.update({ where: { id: bridge.id }, data: { projectId: project?.id ?? null } });
  revalidatePath("/bridges");
}

export async function deleteBridge(bridgeId: string) {
  const { bridge } = await ownBridge(bridgeId);
  await db.bridge.delete({ where: { id: bridge.id } });
  revalidatePath("/bridges");
}
