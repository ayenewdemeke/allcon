import type { CalcData } from "@/lib/calcs/types";

// Saving a worksheet's file the way the editor does (an upload link, the upload, a confirmation
// against the revision it's based on), for worksheets made outside the editor (imports).

async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function uploadCalc(calcId: string, data: CalcData, revision = 0) {
  const body = await gzip(JSON.stringify(data));
  const link = await fetch(`/api/calcs/${calcId}/save`, { method: "POST" });
  if (!link.ok) throw new Error("Could not save the worksheet");
  const { key, upload } = (await link.json()) as { key: string; upload: { url: string; headers: Record<string, string> } };
  const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body });
  if (!put.ok) throw new Error("Could not save the worksheet");
  const done = await fetch(`/api/calcs/${calcId}/save?key=${encodeURIComponent(key)}&revision=${revision}&count=${data.regions.length}`, { method: "PATCH" });
  if (!done.ok) throw new Error("Could not save the worksheet");
}
