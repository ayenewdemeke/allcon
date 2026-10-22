import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { findAccessibleProject, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { workerSummary } from "@/lib/ifc/worker";

const body = z.object({ key: z.string().min(1).max(300), fileName: z.string().min(1).max(255), fileSize: z.number().int().positive() });

/** Finishes an IFC upload: the file is in storage, so the model is registered and summarized. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/ifc-uploads/[modelId]">) {
  const { projectId, modelId } = await ctx.params;
  const access = await findAccessibleProject(projectId);
  if (!access || !isUuid(modelId)) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = body.safeParse(await request.json());
  if (!parsed.success || !parsed.data.key.startsWith(`models/${modelId}/`)) return Response.json({ error: "Invalid upload" }, { status: 400 });
  const { key, fileName, fileSize } = parsed.data;

  // The IFC engine reads it to check it's a model and count what's in it. If it can't (a very
  // large file), the model still opens in the viewer, which reads the file itself.
  let summary: Awaited<ReturnType<typeof workerSummary>> | null = null;
  try {
    summary = await workerSummary(key);
  } catch (err) {
    console.error("Could not summarize an uploaded IFC", err);
  }
  await db.ifcModel.create({
    data: {
      id: modelId,
      projectId: access.project.id,
      name: fileName.replace(/\.ifc$/i, "").slice(0, 200),
      fileKey: key,
      fileSize,
      summary: summary ? (summary as unknown as object) : undefined,
      elementCount: summary?.elements ?? 0,
      sourceSheetIds: [],
      createdById: access.user.id,
    },
  });
  revalidatePath(`/projects/${access.project.id}`, "layout");
  return Response.json({ modelId, link: `/projects/${access.project.id}/models/ifc/${modelId}` });
}
