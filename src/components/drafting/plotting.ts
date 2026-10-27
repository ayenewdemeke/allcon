"use client";

import { postJson, uploadParts } from "@/lib/upload-client";

// Plotting from the browser: pictures for the PDF, downloading it, and publishing it into a
// project's Sheets the way an uploaded drawing set arrives, with each sheet's number, title
// and scale already known.

/** An attached picture's bytes as PNG or JPEG (the formats a PDF holds). */
export function pictureLoader(drawingId: string) {
  return async (key: string): Promise<Uint8Array | null> => {
    const res = await fetch(`/api/drafting/${drawingId}/attachments?key=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.type === "image/png" || blob.type === "image/jpeg") return new Uint8Array(await blob.arrayBuffer());
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return png ? new Uint8Array(await png.arrayBuffer()) : null;
  };
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "drawing";

export function downloadPdf(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName(name)}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type PublishedPage = { width: number; height: number; number: string | null; title: string | null; metersPerPoint: number | null; scaleLabel: string | null };

/** Uploads a plotted PDF as a new drawing set of a project: its sheets come in numbered,
 * titled and to scale. */
export async function publishToSheets(projectId: string, name: string, bytes: Uint8Array, pages: PublishedPage[], onProgress: (percent: number) => void) {
  const file = new File([bytes as BlobPart], `${safeName(name)}.pdf`, { type: "application/pdf" });
  const start = await postJson<{ drawingSetId: string; uploadKey: string; urls: string[]; partSize: number }>(`/api/projects/${projectId}/drawings`, { fileName: file.name, fileSize: file.size });
  await uploadParts(file, start.urls, start.partSize, onProgress);
  await postJson(`/api/drawings/${start.drawingSetId}/complete`, { uploadKey: start.uploadKey, pages });
  return start.drawingSetId;
}
