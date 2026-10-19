import type { NextRequest } from "next/server";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { MAX_VIEW_CACHE_BYTES, viewCacheKey } from "@/lib/ifc/view-cache";

async function findModel(modelId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(modelId)) return null;
  return db.ifcModel.findFirst({ where: { id: modelId, project: { orgId: user.orgId } }, select: { id: true, revision: true } });
}

/** The model as the 3D viewer draws it, if a browser has already converted this revision. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/ifc-models/[modelId]/view">) {
  const model = await findModel((await ctx.params).modelId);
  if (!model) return new Response("Not found", { status: 404 });
  const cache = await db.ifcModelViewCache.findUnique({ where: { modelId: model.id } });
  if (!cache || cache.key !== viewCacheKey(model.revision)) return new Response("Not cached", { status: 404 });
  return new Response(new Uint8Array(cache.data), {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" },
  });
}

/** Saves the viewer's conversion of a revision (sent by the browser that converted it). */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/ifc-models/[modelId]/view">) {
  const model = await findModel((await ctx.params).modelId);
  if (!model) return new Response("Not found", { status: 404 });
  // A conversion of an older revision (the model changed while it was open) is not kept.
  if (Number(request.nextUrl.searchParams.get("revision")) !== model.revision) return new Response("Stale revision", { status: 409 });
  const data = new Uint8Array(await request.arrayBuffer());
  if (!data.length || data.length > MAX_VIEW_CACHE_BYTES) return new Response("Too large", { status: 413 });
  const key = viewCacheKey(model.revision);
  await db.ifcModelViewCache.upsert({
    where: { modelId: model.id },
    create: { modelId: model.id, key, data },
    update: { key, data, createdAt: new Date() },
  });
  return new Response(null, { status: 204 });
}
