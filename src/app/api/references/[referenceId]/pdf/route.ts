import type { NextRequest } from "next/server";
import { findAccessibleReference } from "@/lib/auth/session";
import { streamDrawingPdf } from "@/lib/pdf/stream";

/** The manual's PDF, so citations can open it at the cited page (…/pdf#page=97). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/references/[referenceId]/pdf">) {
  const access = await findAccessibleReference((await ctx.params).referenceId);
  if (!access || access.reference.status !== "ready" || !access.reference.objectKey) {
    return new Response("Not found", { status: 404 });
  }
  return streamDrawingPdf(request, access.reference.objectKey, { "Content-Disposition": "inline" });
}
