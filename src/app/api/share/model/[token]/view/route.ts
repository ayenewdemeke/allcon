import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { findActiveModelShare } from "@/lib/ifc/model-share";
import { viewCacheKey } from "@/lib/ifc/view-cache";

/** A shared model as the 3D viewer draws it, when its latest revision has been converted. Read-only. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/share/model/[token]/view">) {
  const share = await findActiveModelShare((await ctx.params).token);
  if (!share) return new Response("Not found", { status: 404 });
  const cache = await db.ifcModelViewCache.findUnique({ where: { modelId: share.modelId } });
  if (!cache || cache.key !== viewCacheKey(share.model.revision)) return new Response("Not cached", { status: 404 });
  return new Response(new Uint8Array(cache.data), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" } });
}
