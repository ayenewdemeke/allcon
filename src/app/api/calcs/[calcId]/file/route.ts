import type { NextRequest } from "next/server";
import { findAccessibleCalc } from "@/lib/calcs/server";
import { signedReadUrl } from "@/lib/storage";

/** A worksheet's current file (a redirect straight to file storage), or 204 before its first save. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/calcs/[calcId]/file">) {
  const calc = await findAccessibleCalc((await ctx.params).calcId);
  if (!calc) return new Response("Not found", { status: 404 });
  if (!calc.fileKey) return new Response(null, { status: 204 });
  return new Response(null, { status: 302, headers: { Location: await signedReadUrl(calc.fileKey), "Cache-Control": "private, no-store" } });
}
