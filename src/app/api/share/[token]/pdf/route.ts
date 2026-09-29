import type { NextRequest } from "next/server";
import { streamDrawingPdf } from "@/lib/pdf/stream";
import { findActiveShare } from "@/lib/sheets/share";

/** The shared drawing set's PDF, for anyone holding a valid (unexpired, unrevoked) link. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/share/[token]/pdf">) {
  const share = await findActiveShare((await ctx.params).token);
  if (!share?.drawingSet.objectKey) return new Response("Not found", { status: 404 });
  return streamDrawingPdf(request, share.drawingSet.objectKey, {
    "X-Robots-Tag": "noindex, nofollow",
    // Shared links can be revoked, so don't let the browser keep the file for a year.
    "Cache-Control": "private, max-age=3600",
  });
}
