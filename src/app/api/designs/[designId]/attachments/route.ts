import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { signedReadUrl, signedWriteUrl } from "@/lib/storage";

// Pictures attached to a design (a rating's inspection sketch, its PDF pages drawn as pictures): an
// upload link (POST), and the picture itself (GET, a redirect straight to file storage). Only the
// design's own folder is served.

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

async function ownDesign(designId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(designId)) return null;
  return db.design.findFirst({ where: { id: designId, orgId: user.orgId }, select: { id: true } });
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/designs/[designId]/attachments">) {
  const design = await ownDesign((await ctx.params).designId);
  if (!design) return new Response("Not found", { status: 404 });
  const ext = request.nextUrl.searchParams.get("type") ?? "";
  if (!TYPES[ext]) return new Response("Unsupported picture type", { status: 400 });
  const key = `designs/${design.id}/attachments/${randomUUID()}.${ext}`;
  return Response.json({ key, upload: await signedWriteUrl(key, { contentType: TYPES[ext] }) });
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/designs/[designId]/attachments">) {
  const design = await ownDesign((await ctx.params).designId);
  if (!design) return new Response("Not found", { status: 404 });
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (!new RegExp(`^designs/${design.id}/attachments/[\\w-]+\\.(png|jpg|webp)$`).test(key)) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: await signedReadUrl(key, { ttl: 3600 }), "Cache-Control": "private, max-age=3000" } });
}
