import type { NextRequest } from "next/server";
import { getDownloadUrl } from "@/lib/aps/oss";
import { findAccessibleDrawingSet } from "@/lib/auth/session";

// The APS Viewer's PDF loader only takes a URL. Storage hides the headers pdf.js needs to
// use range requests, so we serve the file from our own origin: Range is passed through,
// the headers are visible, and the browser can cache the file (it never changes).

const LINK_TTL_MS = 50 * 60 * 1000; // signed links last 60 minutes
const links = new Map<string, { url: string; expires: number }>();

async function signedUrl(drawingSetId: string, objectKey: string, fresh = false) {
  const hit = links.get(drawingSetId);
  if (hit && !fresh && hit.expires > Date.now()) return hit.url;
  const { url } = await getDownloadUrl(objectKey);
  links.set(drawingSetId, { url, expires: Date.now() + LINK_TTL_MS });
  return url;
}

const PASS_HEADERS = ["content-length", "content-range", "etag", "last-modified"];

export async function GET(request: NextRequest, ctx: RouteContext<"/api/drawings/[drawingSetId]/pdf">) {
  const { drawingSetId } = await ctx.params;
  const access = await findAccessibleDrawingSet(drawingSetId);
  if (!access || access.drawingSet.status !== "ready" || !access.drawingSet.objectKey) {
    return new Response("Not found", { status: 404 });
  }
  const { objectKey } = access.drawingSet;

  const range = request.headers.get("range");
  const fetchUpstream = async (fresh: boolean) =>
    fetch(await signedUrl(drawingSetId, objectKey, fresh), {
      headers: range ? { Range: range } : {},
      signal: request.signal, // stop pulling from storage if the viewer cancels
    });

  let upstream = await fetchUpstream(false);
  if (upstream.status === 403) upstream = await fetchUpstream(true); // expired link
  if (!upstream.ok) return new Response("Could not read the drawing", { status: 502 });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  });
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
