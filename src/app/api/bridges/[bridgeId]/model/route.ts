import { gunzipSync } from "node:zlib";
import type { NextRequest } from "next/server";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { importedOf } from "@/lib/bridge/imported";
import { db } from "@/lib/db";
import { getFile } from "@/lib/storage";

/** An imported bridge's analysis model (JSON), for its owner's organization. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/bridges/[bridgeId]/model">) {
  const user = await getCurrentUser();
  const { bridgeId } = await ctx.params;
  const bridge = user && isUuid(bridgeId) ? await db.bridge.findFirst({ where: { id: bridgeId, orgId: user.orgId }, select: { definition: true } }) : null;
  const info = bridge ? importedOf(bridge.definition) : null;
  if (!info) return new Response("Not found", { status: 404 });
  const bytes = await getFile(info.fileKey);
  // Stored gzipped; storage may hand it back already unpacked.
  const json = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  return new Response(new Uint8Array(json), { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
}
