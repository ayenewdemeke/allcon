import type { NextRequest } from "next/server";
import { findActiveModelShare } from "@/lib/ifc/model-share";
import { hasViewCopy } from "@/lib/ifc/view-cache";
import { signedReadUrl } from "@/lib/storage";

/** A shared model's saved viewer copy, when there is one for its current file. Read-only. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/share/model/[token]/view">) {
  const share = await findActiveModelShare((await ctx.params).token);
  if (!share || !hasViewCopy(share.model)) return new Response("Not saved", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: await signedReadUrl(share.model.viewKey!), "Cache-Control": "private, no-store" } });
}
