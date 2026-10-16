import type { NextRequest } from "next/server";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { compileIfc } from "@/lib/ifc/compile";
import { modelSpecSchema } from "@/lib/ifc/spec";

/** A 3D model as an IFC file, compiled from its current revision (for the viewer and downloads). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/ifc-models/[modelId]/ifc">) {
  const { modelId } = await ctx.params;
  const user = await getCurrentUser();
  const model =
    user && isUuid(modelId)
      ? await db.ifcModel.findFirst({ where: { id: modelId, project: { orgId: user.orgId } }, include: { project: { select: { name: true } } } })
      : null;
  if (!model) return new Response("Not found", { status: 404 });

  const { text } = compileIfc(modelSpecSchema.parse(model.spec), { modelId: model.id, name: model.name, author: user?.name || user?.email });
  const fileName = `${model.name.replace(/[^\w.-]+/g, "_")}-r${model.revision}.ifc`;
  const download = request.nextUrl.searchParams.has("download");
  return new Response(text, {
    headers: {
      "Content-Type": "application/x-step; charset=utf-8",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
