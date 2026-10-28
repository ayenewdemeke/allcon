import type { NextRequest } from "next/server";
import { findAccessibleCalc } from "@/lib/calcs/server";
import { signedReadUrl } from "@/lib/storage";

/** A worksheet's current file (a redirect straight to file storage), or 204 before its first save.
 * With ?meta=1, its revision and a link to it, for pulling in others' changes. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/calcs/[calcId]/file">) {
  const calc = await findAccessibleCalc((await ctx.params).calcId);
  if (!calc) return new Response("Not found", { status: 404 });
  if (request.nextUrl.searchParams.get("meta")) {
    return Response.json({ revision: calc.revision, url: calc.fileKey ? await signedReadUrl(calc.fileKey) : null }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!calc.fileKey) return new Response(null, { status: 204 });
  return new Response(null, { status: 302, headers: { Location: await signedReadUrl(calc.fileKey), "Cache-Control": "private, no-store" } });
}
