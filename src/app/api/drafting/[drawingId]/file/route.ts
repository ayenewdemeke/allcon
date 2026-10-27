import type { NextRequest } from "next/server";
import { findAccessibleDrawing } from "@/lib/drafting/server";
import { signedReadUrl } from "@/lib/storage";

/** A drawing's current file (a redirect straight to file storage), or 204 before its first save.
 * With ?meta=1, its revision and a link to it, for pulling in others' changes. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/drafting/[drawingId]/file">) {
  const drawing = await findAccessibleDrawing((await ctx.params).drawingId);
  if (!drawing) return new Response("Not found", { status: 404 });
  if (request.nextUrl.searchParams.get("meta")) {
    return Response.json({ revision: drawing.revision, url: drawing.fileKey ? await signedReadUrl(drawing.fileKey) : null }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!drawing.fileKey) return new Response(null, { status: 204 });
  return new Response(null, { status: 302, headers: { Location: await signedReadUrl(drawing.fileKey), "Cache-Control": "private, no-store" } });
}
