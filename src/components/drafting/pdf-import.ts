"use client";

import { loadPdfjs } from "@/lib/pdf/client";
import type { Editor } from "@/lib/drafting/editor";
import { convertPdfPage, type PdfImportReady, type PdfImportSettings, type PdfOp } from "@/lib/drafting/pdf-import";
import { pickFile, uploadAttachment } from "./attach";

// PDFIMPORT's browser side: the file, the Import PDF dialog, reading the page with pdf.js, and
// storing its pictures with the drawing. The conversion itself is in lib/drafting/pdf-import.

const MAX_SIDE = 8192;

type PdfImage = { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray; bitmap?: ImageBitmap };

/** A pdf.js image as a PNG (null if it can't be drawn). */
async function imageToPng(img: PdfImage): Promise<Blob | null> {
  const { width, height } = img;
  if (!width || !height) return null;
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0, canvas.width, canvas.height);
  else if (img.data) {
    // kind: 1 one bit grey, 2 RGB, 3 RGBA (pdf.js's ImageKind).
    const rgba = new Uint8ClampedArray(width * height * 4);
    const d = img.data;
    if (img.kind === 3) rgba.set(d.subarray(0, rgba.length));
    else if (img.kind === 2)
      for (let i = 0, j = 0; i < width * height; i++, j += 3) {
        rgba[i * 4] = d[j];
        rgba[i * 4 + 1] = d[j + 1];
        rgba[i * 4 + 2] = d[j + 2];
        rgba[i * 4 + 3] = 255;
      }
    else if (img.kind === 1) {
      const rowBytes = Math.ceil(width / 8);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const v = (d[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
          const i = (y * width + x) * 4;
          rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
          rgba[i + 3] = 255;
        }
    } else return null;
    const full = document.createElement("canvas");
    full.width = width;
    full.height = height;
    full.getContext("2d")!.putImageData(new ImageData(rgba, width, height), 0, 0);
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  } else return null;
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

type ObjStore = { has?: (id: string) => boolean; get: (id: string, callback?: (v: unknown) => void) => unknown };
const getObj = (store: ObjStore, id: string) =>
  new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => resolve(null), 10000);
    try {
      store.get(id, (v) => {
        clearTimeout(timer);
        resolve(v);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });

export async function importPdf(editor: Editor, drawingId: string): Promise<PdfImportReady | null> {
  const file = await pickFile("application/pdf,.pdf");
  if (!file) return null;
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const settings = await new Promise<PdfImportSettings | null>((resolve) => editor.openDialog({ kind: "pdf-import", file: file.name, pages: doc.numPages, done: resolve }));
    if (!settings) return null;
    editor.print(`Reading ${file.name}…`, "info");
    const page = await doc.getPage(Math.min(Math.max(1, settings.page), doc.numPages));
    const list = await page.getOperatorList();
    const names: Record<number, string> = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]));
    const ops: PdfOp[] = list.fnArray.map((fn, i) => {
      const args = list.argsArray[i] as unknown[] | null;
      if (names[fn] === "constructPath" && args) return { fn: "constructPath", args: [names[args[0] as number], ...args.slice(1)] };
      return { fn: names[fn] ?? String(fn), args };
    });

    const layerNames: Record<string, string> = {};
    try {
      const config = await doc.getOptionalContentConfig();
      for (const [id, group] of config) layerNames[id] = (group as { name: string }).name;
    } catch {
      // no layers
    }
    const fontNames: Record<string, string> = {};
    const commonObjs = page.commonObjs as unknown as ObjStore;
    for (const op of ops)
      if (op.fn === "setFont" && op.args && typeof op.args[0] === "string" && !(op.args[0] in fontNames)) {
        const id = op.args[0];
        let name = id;
        try {
          if (commonObjs.has?.(id)) name = ((commonObjs.get(id) as { name?: string } | null)?.name ?? id).replace(/^[A-Z]{6}\+/, "");
        } catch {
          // keep the id
        }
        fontNames[id] = name;
      }

    const result = convertPdfPage({ ops, view: page.view, layerNames, fontNames }, settings, editor.doc.units, editor.doc.currentLayer);

    // Pictures: drawn to PNGs and stored with the drawing, as AutoCAD saves them beside it.
    const pictures: PdfImportReady["pictures"] = [];
    const base = file.name.replace(/\.pdf$/i, "");
    for (const placement of result.images) {
      const args = list.argsArray[placement.opIndex] as unknown[];
      const fn = names[list.fnArray[placement.opIndex]];
      let img: PdfImage | null = null;
      if (fn === "paintInlineImageXObject") img = args[0] as PdfImage;
      else if (fn === "paintImageXObject") {
        const id = String(args[0]);
        img = (await getObj((id.startsWith("g_") ? page.commonObjs : page.objs) as unknown as ObjStore, id)) as PdfImage | null;
      }
      if (!img) continue;
      const blob = await imageToPng(img);
      if (!blob) continue;
      const key = await uploadAttachment(drawingId, blob, "png");
      pictures.push({ placement, key, name: `${base} picture ${pictures.length + 1}` });
    }
    return { name: file.name, result, pictures, settings };
  } finally {
    void task.destroy();
  }
}
