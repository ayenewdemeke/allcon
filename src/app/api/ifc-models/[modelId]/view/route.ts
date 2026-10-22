import type { NextRequest } from "next/server";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { hasViewCopy, viewSource } from "@/lib/ifc/view-cache";
import { deleteFiles, newFileKey, signedReadUrl, signedWriteUrl } from "@/lib/storage";

// The 3D viewer's saved copy of a model: read it (GET), or save one after converting the
// model's current file in the browser: ask for an upload link (POST), upload straight to
// file storage, then confirm (PATCH). `for` is the file it was converted from.

async function findModel(modelId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(modelId)) return null;
  return db.ifcModel.findFirst({
    where: { id: modelId, project: { orgId: user.orgId } },
    select: { id: true, fileKey: true, viewKey: true, viewFor: true },
  });
}

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/ifc-models/[modelId]/view">) {
  const model = await findModel((await ctx.params).modelId);
  if (!model || !hasViewCopy(model)) return new Response("Not saved", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: await signedReadUrl(model.viewKey!), "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/ifc-models/[modelId]/view">) {
  const model = await findModel((await ctx.params).modelId);
  if (!model) return new Response("Not found", { status: 404 });
  // A copy of an older file (the model changed while it was open) isn't kept.
  if (request.nextUrl.searchParams.get("for") !== model.fileKey) return new Response("Stale", { status: 409 });
  const key = newFileKey(`views/${model.id}`, ".frag");
  return Response.json({ key, upload: await signedWriteUrl(key, { contentType: "application/octet-stream" }) });
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/ifc-models/[modelId]/view">) {
  const model = await findModel((await ctx.params).modelId);
  if (!model) return new Response("Not found", { status: 404 });
  const forFile = request.nextUrl.searchParams.get("for");
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (forFile !== model.fileKey || !key.startsWith(`views/${model.id}/`)) return new Response("Stale", { status: 409 });
  const { count } = await db.ifcModel.updateMany({ where: { id: model.id, fileKey: forFile }, data: { viewKey: key, viewFor: viewSource(forFile) } });
  if (!count) {
    await deleteFiles([key]);
    return new Response("Stale", { status: 409 });
  }
  if (model.viewKey && model.viewKey !== key) await deleteFiles([model.viewKey]).catch(() => {});
  return new Response(null, { status: 204 });
}
