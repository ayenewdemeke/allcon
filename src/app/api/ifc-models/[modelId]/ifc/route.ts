import type { NextRequest } from "next/server";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { modelFileRedirect } from "@/lib/ifc/model-file";

/** A 3D model's IFC file, for the viewer and downloads. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/ifc-models/[modelId]/ifc">) {
  const { modelId } = await ctx.params;
  const user = await getCurrentUser();
  const model =
    user && isUuid(modelId)
      ? await db.ifcModel.findFirst({ where: { id: modelId, project: { orgId: user.orgId } }, select: { name: true, revision: true, fileKey: true } })
      : null;
  if (!model) return new Response("Not found", { status: 404 });
  return modelFileRedirect(model, request.nextUrl.searchParams.has("download"));
}
