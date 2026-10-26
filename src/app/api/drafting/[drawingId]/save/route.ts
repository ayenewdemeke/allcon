import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { DRAWING_FILE, findAccessibleDrawing, newDrawingKey } from "@/lib/drafting/server";
import { deleteFiles, signedWriteUrl } from "@/lib/storage";

// Saving a drawing: ask for an upload link (POST), upload the file straight to file storage,
// then confirm (PATCH) with the revision it was based on. If someone saved meanwhile (another
// tab), the confirmation is refused rather than overwriting their work.

export async function POST(_request: NextRequest, ctx: RouteContext<"/api/drafting/[drawingId]/save">) {
  const drawing = await findAccessibleDrawing((await ctx.params).drawingId);
  if (!drawing) return new Response("Not found", { status: 404 });
  const key = newDrawingKey(drawing.id);
  return Response.json({ key, upload: await signedWriteUrl(key, DRAWING_FILE) });
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/drafting/[drawingId]/save">) {
  const drawing = await findAccessibleDrawing((await ctx.params).drawingId);
  if (!drawing) return new Response("Not found", { status: 404 });
  const params = request.nextUrl.searchParams;
  const key = params.get("key") ?? "";
  const revision = Number(params.get("revision"));
  const count = Math.max(0, Math.floor(Number(params.get("count")) || 0));
  if (!key.startsWith(`drawings/${drawing.id}/`) || !Number.isInteger(revision)) return new Response("Invalid", { status: 400 });
  const { count: updated } = await db.drawing.updateMany({
    where: { id: drawing.id, revision },
    data: { fileKey: key, revision: revision + 1, entityCount: count },
  });
  if (!updated) {
    await deleteFiles([key]);
    return Response.json({ error: "This drawing was saved somewhere else meanwhile." }, { status: 409 });
  }
  if (drawing.fileKey && drawing.fileKey !== key) await deleteFiles([drawing.fileKey]).catch(() => {});
  return Response.json({ revision: revision + 1 });
}
