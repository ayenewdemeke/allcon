"use client";

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** PUTs a file to signed storage URLs, one part per URL, reporting 0-100 progress. */
export async function uploadParts(
  file: File,
  urls: string[],
  partSize: number,
  onProgress: (percent: number) => void,
) {
  for (const [i, url] of urls.entries()) {
    const part = file.slice(i * partSize, (i + 1) * partSize);
    const res = await fetch(url, { method: "PUT", body: part });
    if (!res.ok) throw new Error(`Upload failed on part ${i + 1} (${res.status})`);
    onProgress(Math.round(((i + 1) / urls.length) * 100));
  }
}
