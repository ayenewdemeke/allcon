import "server-only";
import { db } from "@/lib/db";

// Tools act on behalf of one signed-in user and see only their organization's data. Every
// tool takes this context and checks access itself, whoever calls it (connector, app, AI).

export type ToolContext = { userId: string; orgId: string; clientId: string | null };

/** A clear, user-facing failure (shown to the AI app as the tool's error). */
export class ToolError extends Error {}

export async function requireProject(ctx: ToolContext, projectId: string) {
  const project = await db.project.findFirst({ where: { id: projectId, orgId: ctx.orgId } });
  if (!project) throw new ToolError("Project not found. Use list_projects to see the available projects and their ids.");
  return project;
}

export async function requireSheet(ctx: ToolContext, sheetId: string) {
  const sheet = await db.sheet.findFirst({
    where: { id: sheetId, drawingSet: { project: { orgId: ctx.orgId }, status: "ready" } },
    include: { drawingSet: { include: { project: true } } },
  });
  if (!sheet) throw new ToolError("Sheet not found. Use list_sheets to see a project's sheets and their ids.");
  return sheet;
}
