import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { newDrawingKey } from "@/lib/drafting/server";
import { WorkerError, workerDxfImport } from "@/lib/ifc/worker";
import { deleteFiles, newFileKey, signedWriteUrl } from "@/lib/storage";

// Opening a DXF as a new drawing: an upload link for the file (POST), then (PUT) the worker
// converts it into a drawing, which is created with it. The uploaded DXF is deleted after.

export const maxDuration = 120;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const key = newFileKey(`imports/${user.orgId}`, ".dxf");
  return Response.json({ key, upload: await signedWriteUrl(key, { contentType: "application/dxf" }) });
}

const convert = z.object({
  key: z.string(),
  name: z.string().trim().min(1).max(200),
  units: z.enum(["auto", "architectural", "mm"]).catch("auto"),
});

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const parsed = convert.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.key.startsWith(`imports/${user.orgId}/`)) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { key, name, units } = parsed.data;
  const drawing = await db.drawing.create({ data: { orgId: user.orgId, name, units: units === "mm" ? "mm" : "architectural", createdById: user.id } });
  const fileKey = newDrawingKey(drawing.id);
  try {
    const result = await workerDxfImport(key, fileKey, units === "auto" ? null : units);
    await db.drawing.update({ where: { id: drawing.id }, data: { fileKey, units: result.units, revision: 1, entityCount: result.count } });
    return Response.json({ id: drawing.id, count: result.count, skipped: result.skipped });
  } catch (err) {
    await db.drawing.delete({ where: { id: drawing.id } });
    await deleteFiles([fileKey]).catch(() => {});
    if (err instanceof WorkerError) return Response.json({ error: `Could not read this DXF: ${err.message}` }, { status: 422 });
    throw err;
  } finally {
    await deleteFiles([key]).catch(() => {});
  }
}
