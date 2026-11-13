import { Command, type Prompt } from "./command-base";
import { newId } from "./document";
import { transform, type Xform } from "./geometry";
import type { PdfImportReady } from "./pdf-import";
import { newLayer, type Entity, type ImageEntity, type PolylineEntity, type Vec } from "./types";

// PDFIMPORT, as AutoCAD's: choose a PDF, set what to import in the Import PDF dialog, then pick
// the insertion point (or it goes at 0,0). Everything comes in as one undoable step.

export class PdfImportCommand extends Command {
  name = "PDFIMPORT";
  private ready: PdfImportReady | null = null;
  private waiting = true;

  start() {
    this.ed.doc.begin(this.name);
    void this.ed.ui.importPdf().then((ready) => {
      if (this.ed.command !== this) return;
      this.waiting = false;
      if (!ready) return this.ed.finish();
      this.ready = ready;
      if (!ready.settings.onScreen) return this.place({ x: 0, y: 0 });
      this.ed.emit();
    });
  }

  prompt(): Prompt {
    if (this.waiting) return { text: "Choose a PDF" };
    return { text: "Specify insertion point" };
  }

  private xform(at: Vec): Xform {
    const { scale, rotation } = this.ready!.settings;
    const r = (rotation * Math.PI) / 180;
    const c = Math.cos(r) * scale;
    const s = Math.sin(r) * scale;
    return { a: c, b: -s, c: s, d: c, tx: at.x, ty: at.y };
  }

  /** The page's outline at the cursor. */
  preview(cursor: Vec): Entity[] {
    if (!this.ready) return [];
    const { width, height } = this.ready.result.size;
    const outline = this.ed.make<PolylineEntity>({
      type: "polyline",
      points: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
      bulges: [0, 0, 0, 0],
      closed: true,
    });
    return [transform(outline, this.xform(cursor))];
  }

  point(p: Vec) {
    if (this.ready) this.place(p);
  }

  enter() {
    if (!this.ready) this.ed.finish();
  }

  private place(at: Vec) {
    const { result, pictures, settings, name } = this.ready!;
    const doc = this.ed.doc;
    const x = this.xform(at);
    const current = doc.currentLayer;
    const layerOf = (layer: string) => (settings.layers === "current" ? current : layer);
    for (const l of result.layers) if (!doc.layers.has(l.name)) doc.setLayer(newLayer(l.name, l.color));
    for (const t of result.textStyles) if (!doc.textStyles.has(t.name)) doc.setTextStyle(t);
    // Pictures first, so lines and text draw over them.
    for (const pic of pictures) {
      const p = pic.placement;
      const image: ImageEntity = {
        id: newId(),
        layer: layerOf(p.layer),
        color: null,
        lineweight: -1,
        linetype: "ByLayer",
        type: "image",
        key: pic.key,
        name: pic.name,
        source: "image",
        at: p.at,
        width: p.width,
        height: p.height,
        rotation: p.rotation,
        fade: 0,
      };
      doc.add(transform(image, x));
    }
    for (const e of result.entities) doc.add(transform({ ...e, id: newId(), layer: layerOf(e.layer) } as Entity, x));
    const c = result.counts;
    const parts = [
      c.geometry && `${c.geometry} lines and curves`,
      c.fills && `${c.fills} fills`,
      c.text && `${c.text} texts`,
      pictures.length && `${pictures.length} picture${pictures.length === 1 ? "" : "s"}`,
    ].filter(Boolean);
    this.ed.print(`Imported ${name}: ${parts.join(", ") || "nothing to import"}.${c.recognized ? " Text drawn as lines was recognized and made editable." : ""}`, "info");
    this.ed.finish();
  }
}
