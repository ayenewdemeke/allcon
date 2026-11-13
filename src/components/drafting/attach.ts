"use client";

import { loadPdfjs } from "@/lib/pdf/client";
import type { Attachment } from "@/lib/drafting/editor";
import type { Units } from "@/lib/drafting/types";

// Attaching pictures and PDF pages under a drawing: the file is picked, a PDF page drawn as a
// picture (transparent where the page is blank), and stored with the drawing. Sizes are the
// real ones at scale 1: a PDF page its paper size, a picture at 96 pixels to the inch.

const MAX_SIDE = 8192; // pixels: what graphics cards draw as one picture
const PDF_DPI = 200;
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** The browser's file picker (null if closed without a file). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Stores a file with the drawing; returns its storage key. */
export async function uploadAttachment(drawingId: string, blob: Blob, ext: string) {
  const link = await fetch(`/api/drafting/${drawingId}/attachments?type=${ext}`, { method: "POST" });
  if (!link.ok) throw new Error("Could not store the file");
  const { key, upload: target } = (await link.json()) as { key: string; upload: { url: string; headers: Record<string, string> } };
  const put = await fetch(target.url, { method: "PUT", headers: target.headers, body: blob });
  if (!put.ok) throw new Error("Could not store the file");
  return key;
}

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the page"))), "image/png"));

/** A PDF's page as a picture, and the page's paper size in inches. */
async function pdfPage(file: File, choosePage: (count: number) => Promise<number | null>) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const number = doc.numPages > 1 ? await choosePage(doc.numPages) : 1;
    if (!number) return null;
    const page = await doc.getPage(number);
    const paper = page.getViewport({ scale: 1 }); // points
    const scale = Math.min(PDF_DPI / 72, MAX_SIDE / Math.max(paper.width, paper.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport, background: "rgba(0,0,0,0)" }).promise;
    return { blob: await toBlob(canvas), inches: { w: paper.width / 72, h: paper.height / 72 }, page: number };
  } finally {
    void task.destroy();
  }
}

/** Asks for a file, stores it with the drawing, and says how big it is in drawing units. */
export async function attachFile(drawingId: string, units: Units, source: "image" | "pdf", choosePage: (count: number) => Promise<number | null>): Promise<Attachment | null> {
  const file = await pickFile(source === "pdf" ? "application/pdf,.pdf" : Object.keys(IMAGE_TYPES).join(","));
  if (!file) return null;
  const toUnits = units === "mm" ? 25.4 : 1;
  if (source === "pdf") {
    const page = await pdfPage(file, choosePage);
    if (!page) return null;
    const key = await uploadAttachment(drawingId, page.blob, "png");
    const name = page.page > 1 ? `${file.name} (page ${page.page})` : file.name;
    return { key, name, source, width: page.inches.w * toUnits, height: page.inches.h * toUnits };
  }
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new Error("Attach a PNG, JPEG, WebP or GIF picture");
  const bitmap = await createImageBitmap(file);
  const size = { w: bitmap.width, h: bitmap.height };
  bitmap.close();
  const key = await uploadAttachment(drawingId, file, ext);
  return { key, name: file.name, source, width: (size.w / 96) * toUnits, height: (size.h / 96) * toUnits };
}
