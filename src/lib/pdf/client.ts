"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { guessSheetNumber } from "@/lib/sheets/sheet-number";
import { pagePlacedText } from "./text-pieces";

// pdf.js is large and browser-only, so it is loaded on first use.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | undefined;

export function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs;
  });
  return pdfjsPromise;
}

// --- remote drawings, loaded by byte range ---------------------------------

// Storage answers Range requests but doesn't expose the headers pdf.js needs to detect
// that, so we feed it ranges ourselves: only the parts of the file a page needs are fetched.
const RANGE_CHUNK = 256 * 1024;

async function fileLink(drawingSetId: string) {
  const res = await fetch(`/api/drawings/${drawingSetId}/file`, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not open this drawing set");
  return (await res.json()) as { url: string; size: number };
}

async function openRemote(drawingSetId: string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  let link = await fileLink(drawingSetId);

  const transport = new pdfjs.PDFDataRangeTransport(link.size, null);
  transport.requestDataRange = (begin: number, end: number) => {
    const fetchRange = () => fetch(link.url, { headers: { Range: `bytes=${begin}-${end - 1}` } });
    void (async () => {
      let res = await fetchRange();
      // Signed links expire after an hour; get a fresh one and retry once.
      if (res.status === 403) {
        link = await fileLink(drawingSetId);
        res = await fetchRange();
      }
      if (!res.ok) throw new Error(`Range request failed (${res.status})`);
      transport.onDataRange(begin, new Uint8Array(await res.arrayBuffer()));
    })();
  };

  return pdfjs.getDocument({
    range: transport, // carries the file length
    rangeChunkSize: RANGE_CHUNK,
    disableAutoFetch: true, // don't pull the rest of the file in the background
    disableStream: true,
  }).promise;
}

// A few recently used documents stay open so moving between sheets is instant.
const MAX_OPEN = 3;
const openDocs = new Map<string, Promise<PDFDocumentProxy>>();

export function getDrawingDocument(drawingSetId: string) {
  let doc = openDocs.get(drawingSetId);
  if (doc) {
    openDocs.delete(drawingSetId); // re-insert as most recent
  } else {
    doc = openRemote(drawingSetId);
    doc.catch(() => openDocs.delete(drawingSetId));
  }
  openDocs.set(drawingSetId, doc);
  while (openDocs.size > MAX_OPEN) {
    const [oldestId, oldest] = openDocs.entries().next().value!;
    openDocs.delete(oldestId);
    void oldest.then((d) => d.loadingTask.destroy()).catch(() => {});
  }
  return doc;
}

// --- local files, read before upload -----------------------------------------

export type PageInfo = { width: number; height: number; number: string | null; title: string | null };

/** Reads page sizes and sheet numbers from a PDF on the user's machine. */
export async function readLocalPdf(file: File, onProgress?: (done: number, total: number) => void) {
  const pdfjs = await loadPdfjs();
  // Read the file in slices rather than all at once: a 300 MB set never sits in memory whole.
  const transport = new pdfjs.PDFDataRangeTransport(file.size, null);
  transport.requestDataRange = (begin: number, end: number) => {
    void file
      .slice(begin, end)
      .arrayBuffer()
      .then((buf) => transport.onDataRange(begin, new Uint8Array(buf)));
  };
  const doc = await pdfjs.getDocument({ range: transport, rangeChunkSize: 1024 * 1024 }).promise;
  try {
    const pages: PageInfo[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      // Plotted/scanned sets have no text layer: no number, and the user names the sheet.
      const { items, width, height } = await pagePlacedText(page);
      pages.push({ width, height, number: guessSheetNumber(items, width, height), title: null });
      page.cleanup();
      onProgress?.(n, doc.numPages);
    }
    return pages;
  } finally {
    await doc.loadingTask.destroy();
  }
}
