import type { NextRequest } from "next/server";
import { findAccessibleDrawingSet } from "@/lib/auth/session";
import { streamDrawingPdf } from "@/lib/pdf/stream";

/** The drawing set's PDF for signed-in project members (see lib/pdf/stream for why it's proxied). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/drawings/[drawingSetId]/pdf">) {
  const access = await findAccessibleDrawingSet((await ctx.params).drawingSetId);
  if (!access || access.drawingSet.status !== "ready" || !access.drawingSet.objectKey) {
    return new Response("Not found", { status: 404 });
  }
  return streamDrawingPdf(request, access.drawingSet.objectKey);
}
