import "server-only";
import { getDownloadUrl } from "@/lib/aps/oss";

// Serves a drawing set's PDF from our own origin. The APS Viewer's PDF loader only takes a
// URL, and storage hides the headers pdf.js needs for range requests, so Range is passed
// through and the headers made visible; the file never changes, so browsers may cache it.

const LINK_TTL_MS = 50 * 60 * 1000; // signed links last 60 minutes
const links = new Map<string, { url: string; expires: number }>();

async function signedUrl(objectKey: string, fresh = false) {
  const hit = links.get(objectKey);
  if (hit && !fresh && hit.expires > Date.now()) return hit.url;
  const { url } = await getDownloadUrl(objectKey);
  links.set(objectKey, { url, expires: Date.now() + LINK_TTL_MS });
  return url;
}

const PASS_HEADERS = ["content-length", "content-range", "etag", "last-modified"];

export async function streamDrawingPdf(request: Request, objectKey: string, extraHeaders: Record<string, string> = {}) {
  const range = request.headers.get("range");
  const fetchUpstream = async (fresh: boolean) =>
    fetch(await signedUrl(objectKey, fresh), {
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
    ...extraHeaders,
  });
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
