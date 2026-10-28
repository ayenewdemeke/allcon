import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { CALC_FILE, findAccessibleCalc, newCalcKey } from "@/lib/calcs/server";
import { deleteFiles, signedWriteUrl } from "@/lib/storage";

// Saving a worksheet: ask for an upload link (POST), upload the file straight to file storage,
// then confirm (PATCH) with the revision it was based on. If it was saved meanwhile (another
// tab), the confirmation is refused rather than overwriting that work.

export async function POST(_request: NextRequest, ctx: RouteContext<"/api/calcs/[calcId]/save">) {
  const calc = await findAccessibleCalc((await ctx.params).calcId);
  if (!calc) return new Response("Not found", { status: 404 });
  const key = newCalcKey(calc.id);
  return Response.json({ key, upload: await signedWriteUrl(key, CALC_FILE) });
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/calcs/[calcId]/save">) {
  const calc = await findAccessibleCalc((await ctx.params).calcId);
  if (!calc) return new Response("Not found", { status: 404 });
  const params = request.nextUrl.searchParams;
  const key = params.get("key") ?? "";
  const revision = Number(params.get("revision"));
  const count = Math.max(0, Math.floor(Number(params.get("count")) || 0));
  if (!key.startsWith(`calcs/${calc.id}/`) || !Number.isInteger(revision)) return new Response("Invalid", { status: 400 });
  const { count: updated } = await db.calc.updateMany({ where: { id: calc.id, revision }, data: { fileKey: key, revision: revision + 1, regionCount: count } });
  if (!updated) {
    await deleteFiles([key]);
    return Response.json({ error: "This worksheet was saved somewhere else meanwhile." }, { status: 409 });
  }
  if (calc.fileKey && calc.fileKey !== key) await deleteFiles([calc.fileKey]).catch(() => {});
  return Response.json({ revision: revision + 1 });
}
