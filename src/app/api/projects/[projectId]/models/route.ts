import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUploadUrls, MAX_FILE_SIZE, PART_SIZE } from "@/lib/aps/oss";
import { ACCEPTED_EXTENSIONS, extensionOf } from "@/lib/model-files";
import { findAccessibleProject } from "@/lib/session";

const body = z.object({
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
});

/** Registers a new model version and returns signed URLs for a direct browser-to-APS upload. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/models">) {
  const access = await findAccessibleProject((await ctx.params).projectId);
  if (!access) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid file" }, { status: 400 });
  const { fileName, fileSize } = parsed.data;

  const ext = extensionOf(fileName);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return Response.json({ error: `Supported formats: ${ACCEPTED_EXTENSIONS.join(", ")}` }, { status: 400 });
  }

  const model = await db.modelVersion.create({
    data: {
      projectId: access.project.id,
      fileName,
      fileSize,
      uploadedById: access.user.id,
      schemaVersion: ext === ".ifc" ? "IFC" : "Revit",
    },
  });

  const safeName = fileName.replace(/[^\w.-]+/g, "_");
  const objectKey = `${access.project.id}/${model.id}/${safeName}`;

  try {
    const { uploadKey, urls } = await getUploadUrls(objectKey, Math.ceil(fileSize / PART_SIZE));
    await db.modelVersion.update({ where: { id: model.id }, data: { objectKey } });
    return Response.json({ modelId: model.id, uploadKey, urls, partSize: PART_SIZE });
  } catch (err) {
    console.error("Could not start upload", err);
    await db.modelVersion.update({
      where: { id: model.id },
      data: { status: "failed", errorMessage: "Could not start upload" },
    });
    return Response.json({ error: "Could not start upload. Please try again." }, { status: 502 });
  }
}
