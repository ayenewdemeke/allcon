import type { NextRequest } from "next/server";
import { getDownloadUrl } from "@/lib/aps/oss";
import { findAccessibleDrawingSet } from "@/lib/session";

/**
 * A short-lived direct link to the PDF plus its size. The viewer fetches byte ranges
 * from it itself, so only the pages being looked at are downloaded.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/drawings/[drawingSetId]/file">) {
  const access = await findAccessibleDrawingSet((await ctx.params).drawingSetId);
  if (!access || access.drawingSet.status !== "ready" || !access.drawingSet.objectKey) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const { url } = await getDownloadUrl(access.drawingSet.objectKey);
  return Response.json(
    { url, size: Number(access.drawingSet.fileSize) },
    { headers: { "Cache-Control": "private, max-age=600" } },
  );
}
