import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { dxfExportKey, findAccessibleDrawing } from "@/lib/drafting/server";
import { WorkerError, workerDxfExport } from "@/lib/ifc/worker";
import { signedReadUrl } from "@/lib/storage";

// DXF export (DXFOUT): the saved drawing, converted by the worker, downloaded as name.dxf.

export const maxDuration = 120;

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/drafting/[drawingId]/dxf">) {
  const drawing = await findAccessibleDrawing((await ctx.params).drawingId);
  if (!drawing) return new Response("Not found", { status: 404 });
  if (!drawing.fileKey) return Response.json({ error: "Draw something first: the drawing is empty." }, { status: 409 });
  const key = dxfExportKey(drawing.id);
  try {
    const { skipped } = await workerDxfExport(drawing.fileKey, key);
    const { name } = await db.drawing.findUniqueOrThrow({ where: { id: drawing.id }, select: { name: true } });
    const filename = `${name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "drawing"}.dxf`;
    return Response.json({ url: await signedReadUrl(key, { downloadAs: filename }), skipped });
  } catch (err) {
    if (err instanceof WorkerError) return Response.json({ error: err.message }, { status: 502 });
    throw err;
  }
}
