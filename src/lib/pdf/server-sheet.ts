import "server-only";
import path from "node:path";
import { getDownloadUrl } from "@/lib/aps/oss";
import { groupLines, type SheetLine } from "@/lib/review/lines";
import { pageTextPieces } from "./text-pieces";

// Reads one sheet of a stored drawing set on the server (for connector tools): its text as
// numbered lines with positions, and optionally a JPEG of the page. pdf.js fetches only the
// byte ranges the page needs, so large sets aren't downloaded whole.

const IMAGE_LONG_EDGE = 1568; // px; about 2k image tokens for the client's model

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | undefined;
const loadPdfjs = () => (pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs"));

export async function readStoredSheet(objectKey: string, pageIndex: number, opts: { image: boolean }) {
  const lib = await loadPdfjs();
  const { url } = await getDownloadUrl(objectKey, 15);
  const doc = await lib.getDocument({
    url,
    rangeChunkSize: 256 * 1024,
    disableAutoFetch: true,
    disableStream: true,
    // Metrics for the 14 standard PDF fonts, which drawings often use without embedding.
    standardFontDataUrl: path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/"),
  }).promise;
  try {
    const page = await doc.getPage(pageIndex + 1);
    const lines: SheetLine[] = groupLines(await pageTextPieces(page));
    let image: string | null = null;
    if (opts.image) {
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: IMAGE_LONG_EDGE / Math.max(base.width, base.height) });
      // pdf.js draws on @napi-rs/canvas in Node.
      const factory = doc.canvasFactory as {
        create(w: number, h: number): { canvas: { encode(format: "jpeg", quality: number): Promise<Buffer> }; context: CanvasRenderingContext2D };
      };
      const { canvas, context } = factory.create(Math.round(viewport.width), Math.round(viewport.height));
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context, viewport, background: "#ffffff" }).promise;
      image = (await canvas.encode("jpeg", 82)).toString("base64");
    }
    page.cleanup();
    return { lines, image };
  } finally {
    await doc.loadingTask.destroy();
  }
}
