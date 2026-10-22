import type { NextRequest } from "next/server";
import { modelFileRedirect } from "@/lib/ifc/model-file";
import { findActiveModelShare } from "@/lib/ifc/model-share";

/** A shared model's IFC, for the shared viewer (and as a download when the link allows it). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/share/model/[token]/ifc">) {
  const share = await findActiveModelShare((await ctx.params).token);
  if (!share) return new Response("Not found", { status: 404 });
  const download = request.nextUrl.searchParams.has("download");
  if (download && !share.allowDownload) return new Response("Downloads are off for this link", { status: 403 });
  return modelFileRedirect(share.model, download);
}
