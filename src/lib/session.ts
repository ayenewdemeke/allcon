import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (id: string) => UUID.test(id);

/** The signed-in user, or null. Cached per request. */
export const getCurrentUser = cache(async () => {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return db.user.findUnique({ where: { id: session.user.id } });
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}

/** Loads a project the current user may access; 404s otherwise so ids can't be probed. */
export async function requireProject(projectId: string) {
  const user = await requireUser();
  if (!isUuid(projectId)) notFound();
  const project = await db.project.findFirst({ where: { id: projectId, orgId: user.orgId } });
  if (!project) notFound();
  return { user, project };
}

/** Same check for API routes, returning null instead of redirecting. */
export async function findAccessibleModel(modelId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(modelId)) return null;
  return db.modelVersion.findFirst({
    where: { id: modelId, project: { orgId: user.orgId } },
  });
}

export async function findAccessibleProject(projectId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(projectId)) return null;
  const project = await db.project.findFirst({ where: { id: projectId, orgId: user.orgId } });
  return project && { user, project };
}

export async function findAccessibleDrawingSet(drawingSetId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(drawingSetId)) return null;
  const drawingSet = await db.drawingSet.findFirst({
    where: { id: drawingSetId, project: { orgId: user.orgId } },
  });
  return drawingSet && { user, drawingSet };
}

/** A sheet the current user may access, with its project (for unit settings). */
export async function findAccessibleSheet(sheetId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(sheetId)) return null;
  const sheet = await db.sheet.findFirst({
    where: { id: sheetId, drawingSet: { project: { orgId: user.orgId } } },
    include: { drawingSet: { include: { project: true } } },
  });
  return sheet && { user, sheet };
}
