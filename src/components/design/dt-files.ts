"use client";

import { loadPdfjs } from "@/lib/pdf/client";
import type { DtSketch } from "@/lib/design/rating/double-tee";
import { brrReportsToTable, readBrrReport } from "@/lib/design/rating/brr-report";
import { readSia, textLines } from "@/lib/design/rating/sia";

// The rating's files, handled in the browser: an SIA is read here and never uploaded; a sketch's
// pages are drawn as pictures here and stored under the design.

const SIA_PAGES = 12; // the inventory items are on the first few pages

/** A PDF's pages as text lines (its first maxPages). */
async function pdfPages(file: File, maxPages: number) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages: string[][] = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.flatMap((it) => ("str" in it ? [{ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number }] : []));
      pages.push(textLines(items));
      page.cleanup();
    }
    if (!pages.some((l) => l.length)) throw new Error(`${file.name} has no text (a scan?), so it can't be read.`);
    return pages;
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Reads an SIA PDF's items. */
export async function readSiaFile(file: File) {
  return readSia((await pdfPages(file, SIA_PAGES)).flat());
}

const BRR_PAGES = 200; // a whole rating package; only the Rating Results Summary pages are read

/** Reads BrR Rating Results Summary Reports (one PDF, or two runs) as the comparison's table text. */
export async function readBrrFiles(files: File[]) {
  const reports = [];
  for (const f of files) {
    try {
      reports.push(readBrrReport(await pdfPages(f, BRR_PAGES)));
    } catch (e) {
      throw new Error(`${f.name}: ${e instanceof Error ? e.message : "can't be read"}`);
    }
  }
  return brrReportsToTable(reports, files.map((f) => f.name));
}

const MAX_PAGES = 4;
const TARGET_WIDTH = 2200; // px, enough to read a sketch's dimensions zoomed in

async function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the page"))), "image/png"));
}

async function store(designId: string, blob: Blob, ext: "png" | "jpg" | "webp") {
  const link = await fetch(`/api/designs/${designId}/attachments?type=${ext}`, { method: "POST" });
  if (!link.ok) throw new Error("Could not store the sketch");
  const { key, upload } = (await link.json()) as { key: string; upload: { url: string; headers: Record<string, string> } };
  const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: blob });
  if (!put.ok) throw new Error("Could not store the sketch");
  return key;
}

/** Stores a sketch (a PDF's pages as pictures, or a picture as it is) under the design. */
export async function uploadSketch(designId: string, file: File): Promise<DtSketch> {
  const name = file.name;
  if (/\.(png|jpe?g|webp)$/i.test(name) || file.type.startsWith("image/")) {
    const ext = /png/i.test(file.type) || /\.png$/i.test(name) ? "png" : /webp/i.test(file.type) || /\.webp$/i.test(name) ? "webp" : "jpg";
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return { name, pages: [{ key: await store(designId, file, ext), ...size }] };
  }
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const pages: DtSketch["pages"] = [];
    const text: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      // Its callouts' text (a CAD sketch has it; a scan has none).
      const tc = await page.getTextContent();
      text.push(...textLines(tc.items.flatMap((it) => ("str" in it ? [{ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number }] : []))));
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(4, TARGET_WIDTH / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // "print": drawn straight through. The display intent continues on animation frames, which stop
      // while the window is minimized or covered, and a busy sketch would never finish.
      await page.render({ canvasContext: ctx, viewport: vp, canvas, intent: "print" }).promise;
      pages.push({ key: await store(designId, await canvasBlob(canvas), "png"), width: canvas.width, height: canvas.height });
      page.cleanup();
    }
    return { name, pages, ...(text.length ? { text } : {}) };
  } finally {
    await doc.loadingTask.destroy();
  }
}

export const sketchUrl = (designId: string, key: string) => `/api/designs/${designId}/attachments?key=${encodeURIComponent(key)}`;
