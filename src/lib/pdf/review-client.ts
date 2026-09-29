"use client";

import { groupLines, type SheetLine } from "@/lib/review/lines";
import { splitManual, type ManualSection } from "@/lib/review/sections";
import { getDrawingDocument, loadPdfjs } from "./client";
import { flatOutline, pageTextPieces } from "./text-pieces";

/** Reads a manual on the user's machine and splits it into sections, before upload. */
export async function readManual(file: File, onProgress?: (done: number, total: number) => void) {
  const pdfjs = await loadPdfjs();
  const transport = new pdfjs.PDFDataRangeTransport(file.size, null);
  transport.requestDataRange = (begin: number, end: number) => {
    void file
      .slice(begin, end)
      .arrayBuffer()
      .then((buf) => transport.onDataRange(begin, new Uint8Array(buf)));
  };
  const doc = await pdfjs.getDocument({ range: transport, rangeChunkSize: 1024 * 1024 }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      pages.push({ page: n, lines: groupLines(await pageTextPieces(page)).map((l) => l.text) });
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
    const sections: ManualSection[] = splitManual(pages, await flatOutline(doc));
    return { pageCount: doc.numPages, sections };
  } finally {
    await doc.loadingTask.destroy();
  }
}

const IMAGE_LONG_EDGE = 1568; // px; about 2k image tokens

/** A sheet's text lines (with boxes in sheet points) and a JPEG of it, for review. */
export async function captureSheet(drawingSetId: string, pageIndex: number): Promise<{ lines: SheetLine[]; image: string }> {
  const doc = await getDrawingDocument(drawingSetId);
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = IMAGE_LONG_EDGE / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  const image = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  const lines = groupLines(await pageTextPieces(page));
  page.cleanup();
  return { lines, image };
}
