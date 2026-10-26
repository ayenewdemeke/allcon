import type { NextRequest } from "next/server";
import { attachmentKey, findAccessibleDrawing } from "@/lib/drafting/server";
import { signedReadUrl, signedWriteUrl } from "@/lib/storage";

// Pictures attached under a drawing (IMAGEATTACH, and PDF pages drawn as pictures): an upload
// link (POST), and the picture itself (GET, a redirect straight to file storage).

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export async function POST(request: NextRequest, ctx: RouteContext<"/api/drafting/[drawingId]/attachments">) {
  const drawing = await findAccessibleDrawing((await ctx.params).drawingId);
  if (!drawing) return new Response("Not found", { status: 404 });
  const ext = request.nextUrl.searchParams.get("type") ?? "";
  if (!TYPES[ext]) return new Response("Unsupported picture type", { status: 400 });
  const key = attachmentKey(drawing.id, ext);
  return Response.json({ key, upload: await signedWriteUrl(key, { contentType: TYPES[ext] }) });
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/drafting/[drawingId]/attachments">) {
  const drawing = await findAccessibleDrawing((await ctx.params).drawingId);
  if (!drawing) return new Response("Not found", { status: 404 });
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (!key.startsWith(`drawings/${drawing.id}/attachments/`)) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: await signedReadUrl(key, { ttl: 3600 }), "Cache-Control": "private, max-age=3000" } });
}
