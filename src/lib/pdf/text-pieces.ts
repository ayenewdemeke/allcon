import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextPiece } from "@/lib/review/lines";

// pdf.js helpers that work in the browser and in Node (scripts), so they take pdf.js objects
// rather than loading pdf.js themselves.

/** Text pieces of a page with boxes in displayed page points (rotation applied, top-left origin). */
export async function pageTextPieces(page: PDFPageProxy): Promise<TextPiece[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const pieces: TextPiece[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    const along = Math.hypot(a, b) || 1;
    const up = Math.hypot(c, d) || 1;
    const height = item.height || up;
    // Corners of the text run in PDF user space: along the baseline, then up by its height.
    const ux = a / along, uy = b / along, vx = c / up, vy = d / up;
    const corners = [
      [e, f],
      [e + ux * item.width, f + uy * item.width],
      [e + vx * height, f + vy * height],
      [e + ux * item.width + vx * height, f + uy * item.width + vy * height],
    ].map(([x, y]) => viewport.convertToViewportPoint(x, y));
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    pieces.push({ text: item.str, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  return pieces;
}

/** The PDF's bookmarks, flattened in order, with 1-based page numbers. */
export async function flatOutline(doc: PDFDocumentProxy) {
  const outline = (await doc.getOutline()) ?? [];
  const out: { title: string; page: number }[] = [];
  type Node = (typeof outline)[number];
  const walk = async (nodes: Node[]) => {
    for (const node of nodes) {
      try {
        const dest = typeof node.dest === "string" ? await doc.getDestination(node.dest) : node.dest;
        const ref = dest?.[0];
        const index = ref == null ? null : typeof ref === "number" ? ref : await doc.getPageIndex(ref);
        if (index !== null && node.title?.trim()) out.push({ title: node.title.trim(), page: index + 1 });
      } catch {
        // A broken bookmark is skipped; the rest still help.
      }
      if (node.items?.length) await walk(node.items);
    }
  };
  await walk(outline);
  return out;
}
