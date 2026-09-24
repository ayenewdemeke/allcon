import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUploadUrls, MAX_FILE_SIZE, PART_SIZE } from "@/lib/aps/oss";
import { DRAWING_EXTENSIONS, extensionOf } from "@/lib/model-files";
import { findAccessibleProject } from "@/lib/session";

const body = z.object({
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
});

/** Registers a PDF drawing set and returns signed URLs for a direct browser-to-storage upload. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/drawings">) {
  const access = await findAccessibleProject((await ctx.params).projectId);
  if (!access) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid file" }, { status: 400 });
  const { fileName, fileSize } = parsed.data;
  if (!DRAWING_EXTENSIONS.includes(extensionOf(fileName))) {
    return Response.json({ error: "Drawings must be PDF files" }, { status: 400 });
  }

  const drawingSet = await db.drawingSet.create({
    data: { projectId: access.project.id, fileName, fileSize, uploadedById: access.user.id },
  });
  const objectKey = `${access.project.id}/drawings/${drawingSet.id}/${fileName.replace(/[^\w.-]+/g, "_")}`;

  try {
    const { uploadKey, urls } = await getUploadUrls(objectKey, Math.ceil(fileSize / PART_SIZE));
    await db.drawingSet.update({ where: { id: drawingSet.id }, data: { objectKey } });
    return Response.json({ drawingSetId: drawingSet.id, uploadKey, urls, partSize: PART_SIZE });
  } catch (err) {
    console.error("Could not start drawing upload", err);
    await db.drawingSet.update({ where: { id: drawingSet.id }, data: { status: "failed" } });
    return Response.json({ error: "Could not start upload. Please try again." }, { status: 502 });
  }
}
