import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { findAccessibleProject } from "@/lib/auth/session";
import { extensionOf } from "@/lib/model-files";
import { newFileKey, signedWriteUrl } from "@/lib/storage";

// Uploaded IFC files skip Autodesk's translation: the browser sends the file straight to file
// storage, and it becomes a 3D model like the ones AI apps build (same viewer, mapping,
// sharing, and AI editing). This starts the upload; ./[modelId] finishes it.

export const MAX_IFC_UPLOAD = 1024 * 1024 * 1024; // 1 GB

const body = z.object({ fileName: z.string().min(1).max(255), fileSize: z.number().int().positive().max(MAX_IFC_UPLOAD) });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/ifc-uploads">) {
  const access = await findAccessibleProject((await ctx.params).projectId);
  if (!access) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid file (IFC up to 1 GB)" }, { status: 400 });
  if (extensionOf(parsed.data.fileName) !== ".ifc") return Response.json({ error: "Only .ifc files go this way" }, { status: 400 });

  const modelId = randomUUID();
  const key = newFileKey(`models/${modelId}`, ".ifc");
  const upload = await signedWriteUrl(key, { contentType: "application/x-step" }, 60 * 60);
  return Response.json({ modelId, key, upload });
}
