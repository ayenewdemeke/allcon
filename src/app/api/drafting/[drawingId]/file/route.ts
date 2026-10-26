import type { NextRequest } from "next/server";
import { findAccessibleDrawing } from "@/lib/drafting/server";
import { signedReadUrl } from "@/lib/storage";

/** A drawing's current file (a redirect straight to file storage), or 204 before its first save. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/drafting/[drawingId]/file">) {
  const drawing = await findAccessibleDrawing((await ctx.params).drawingId);
  if (!drawing) return new Response("Not found", { status: 404 });
  if (!drawing.fileKey) return new Response(null, { status: 204 });
  return new Response(null, { status: 302, headers: { Location: await signedReadUrl(drawing.fileKey), "Cache-Control": "private, no-store" } });
}
