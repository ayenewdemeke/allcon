import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUploadUrls, MAX_FILE_SIZE, PART_SIZE } from "@/lib/aps/oss";
import { DRAWING_EXTENSIONS, extensionOf } from "@/lib/model-files";
import { getCurrentUser } from "@/lib/auth/session";

const body = z.object({
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
  title: z.string().trim().min(1).max(200),
});

/** Registers a manual for the organization's library and returns signed upload URLs. */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid file" }, { status: 400 });
  const { fileName, fileSize, title } = parsed.data;
  if (!DRAWING_EXTENSIONS.includes(extensionOf(fileName))) {
    return Response.json({ error: "Manuals must be PDF files" }, { status: 400 });
  }

  const reference = await db.reference.create({
    data: { orgId: user.orgId, title, fileName, fileSize, uploadedById: user.id },
  });
  const objectKey = `library/${user.orgId}/${reference.id}/${fileName.replace(/[^\w.-]+/g, "_")}`;
  try {
    const { uploadKey, urls } = await getUploadUrls(objectKey, Math.ceil(fileSize / PART_SIZE));
    await db.reference.update({ where: { id: reference.id }, data: { objectKey } });
    return Response.json({ referenceId: reference.id, uploadKey, urls, partSize: PART_SIZE });
  } catch (err) {
    console.error("Could not start reference upload", err);
    await db.reference.update({ where: { id: reference.id }, data: { status: "failed" } });
    return Response.json({ error: "Could not start upload. Please try again." }, { status: 502 });
  }
}
