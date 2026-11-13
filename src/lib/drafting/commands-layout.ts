import { Command, type Prompt } from "./command-base";
import type { Editor } from "./editor";
import { attributeDefs } from "./blocks";
import { drawingArea, drawingAreaBottom, titleBlock, titleBlockBottom, VIEWPORT_LAYER, viewportScaleName } from "./layouts";
import type { Box } from "./geometry";
import type { Entity, InsertEntity, Vec, ViewportEntity } from "./types";

// Layouts and viewports, with AutoCAD's prompts: LAYOUT, MVIEW, MSPACE and PSPACE, viewport
// locking, and the plot and publish dialogs.

/** LAYOUT: new, rename, delete or switch to a layout. */
export class LayoutCommand extends Command {
  name = "LAYOUT";
  private step: "option" | "new" | "rename" | "set" = "option";
  prompt(): Prompt {
    if (this.step === "new") return { text: "Enter name of new layout", spaces: true };
    if (this.step === "rename") return { text: "Enter new layout name", spaces: true };
    if (this.step === "set") return { text: "Enter layout to make current", spaces: true };
    return {
      text: "Enter layout option",
      keywords: [
        { key: "D", label: "Delete" },
        { key: "N", label: "New" },
        { key: "R", label: "Rename" },
        { key: "S", label: "Set" },
        { key: "?", label: "?" },
      ],
      enterLabel: "set",
    };
  }
  keyword(key: string) {
    if (this.step !== "option") return;
    if (key === "N") this.step = "new";
    else if (key === "S") this.step = "set";
    else if (key === "R") {
      if (!this.ed.layoutId) return this.ed.print("The Model tab can't be renamed.", "error");
      this.step = "rename";
    } else if (key === "D") {
      if (!this.ed.layoutId) return this.ed.print("The Model tab can't be deleted.", "error");
      const id = this.ed.layoutId;
      this.ed.finish();
      deleteLayout(this.ed, id);
    } else if (key === "?") {
      this.ed.print(`Layouts: ${[...this.ed.drawing.layouts.values()].map((l) => l.name).join(", ") || "none"}`, "info");
    }
  }
  value(text: string) {
    const name = text.trim();
    if (!name) return false;
    const layouts = [...this.ed.drawing.layouts.values()];
    const existing = layouts.find((l) => l.name.toUpperCase() === name.toUpperCase());
    if (this.step === "new") {
      if (existing) return this.ed.print(`Layout "${name}" already exists.`, "error"), true;
      this.ed.finish();
      this.ed.newLayout(name);
    } else if (this.step === "rename") {
      if (existing) return this.ed.print(`Layout "${name}" already exists.`, "error"), true;
      renameLayout(this.ed, this.ed.layoutId!, name);
      this.ed.finish();
    } else if (this.step === "set") {
      if (name.toUpperCase() !== "MODEL" && !existing) return this.ed.print(`Layout "${name}" not found.`, "error"), true;
      this.ed.finish();
      this.ed.setLayout(existing?.id ?? null);
    } else return false;
    return true;
  }
  enter() {
    if (this.step === "option") this.step = "set";
    else this.ed.finish();
  }
}

export function renameLayout(ed: Editor, id: string, name: string) {
  const layout = ed.drawing.layouts.get(id);
  if (!layout || !name.trim() || [...ed.drawing.layouts.values()].some((l) => l.id !== id && l.name.toUpperCase() === name.trim().toUpperCase())) return false;
  ed.drawing.begin("LAYOUT");
  ed.drawing.updateLayout({ ...layout, name: name.trim() });
  ed.drawing.commit();
  return true;
}

export function deleteLayout(ed: Editor, id: string) {
  const main = ed.drawing;
  if (!main.layouts.has(id)) return;
  if (ed.layoutId === id) ed.setLayout(null);
  main.begin("LAYOUT");
  main.removeLayout(id);
  main.commit();
  ed.emit();
}

/** MVIEW: a rectangular viewport, from two corners or filling the paper's margins. */
export class MviewCommand extends Command {
  name = "MVIEW";
  private corner: Vec | null = null;
  start() {
    if (!this.ed.doc.layout) {
      this.ed.print("MVIEW works on a layout's paper: switch to a layout tab first.", "error");
      this.ed.finish();
    }
  }
  prompt(): Prompt {
    if (this.corner) return { text: "Specify opposite corner", base: this.corner };
    return { text: "Specify corner of viewport", keywords: [{ key: "F", label: "Fit" }] };
  }
  private make(a: Vec, b: Vec): ViewportEntity {
    const paper = this.ed.doc.layout!.paper;
    const rect = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    return { ...this.ed.fittedViewport(paper, rect), layer: VIEWPORT_LAYER.name };
  }
  preview(cursor: Vec): Entity[] {
    return this.corner ? [{ ...this.make(this.corner, cursor), id: "preview" }] : [];
  }
  point(p: Vec) {
    if (!this.corner) {
      this.corner = p;
      return;
    }
    if (Math.abs(p.x - this.corner.x) < 1e-9 || Math.abs(p.y - this.corner.y) < 1e-9) return;
    this.place(this.make(this.corner, p));
  }
  keyword(key: string) {
    if (key !== "F" || this.corner) return;
    const paper = this.ed.doc.layout!.paper;
    this.place({ ...this.ed.fittedViewport(paper), layer: VIEWPORT_LAYER.name });
  }
  private place(vp: ViewportEntity) {
    const doc = this.ed.doc;
    doc.begin("MVIEW");
    if (!doc.layers.has(VIEWPORT_LAYER.name)) doc.setLayer(VIEWPORT_LAYER);
    doc.add(vp);
    this.ed.finish();
  }
}

/** MSPACE: work through a viewport (the one under the last click, or the only one). */
export class MspaceCommand extends Command {
  name = "MSPACE";
  prompt(): Prompt {
    return { text: "" };
  }
  start() {
    if (!this.ed.layoutId) this.ed.print("Already in model space.", "info");
    else if (!this.ed.viewport) {
      const vps = [...this.ed.drawing.entitiesIn(this.ed.layoutId).values()].filter((e) => e.type === "viewport");
      const selected = this.ed.selected().find((e) => e.type === "viewport");
      const vp = selected ?? vps.at(-1);
      this.ed.finish();
      if (vp) this.ed.enterViewport(vp.id);
      else this.ed.print("There are no viewports on this layout. Make one with MVIEW.", "error");
      return;
    }
    this.ed.finish();
  }
}

/** Locks or unlocks viewports' scale and view (the selected ones, or the one worked through). */
export function lockViewports(ed: Editor, locked: boolean) {
  const layout = ed.layoutId;
  if (!layout) return;
  const main = ed.drawing;
  const targets = ed.viewport
    ? [main.entitiesIn(layout).get(ed.viewport)]
    : ed.selected().filter((e) => e.type === "viewport");
  const viewports = targets.filter((e): e is ViewportEntity => e?.type === "viewport");
  if (!viewports.length) return ed.print("Select viewports to lock or unlock.", "error");
  const space = main.space;
  main.setSpace(layout);
  main.begin(locked ? "VPLOCK" : "VPUNLOCK");
  for (const vp of viewports) main.update({ ...vp, locked });
  main.commit();
  main.setSpace(space);
  ed.print(`${viewports.length} viewport${viewports.length === 1 ? "" : "s"} ${locked ? "locked" : "unlocked"}.`, "info");
}

/** Sets a viewport's scale about its centre (the selected one, or the one worked through). */
export function setViewportScale(ed: Editor, scale: number) {
  const layout = ed.layoutId;
  if (!layout || !(scale > 0)) return;
  const main = ed.drawing;
  const vp = ed.viewport ? main.entitiesIn(layout).get(ed.viewport) : ed.selected().find((e) => e.type === "viewport");
  if (vp?.type !== "viewport") return;
  const space = main.space;
  main.setSpace(layout);
  main.begin("VPSCALE");
  main.update({ ...vp, scale });
  // A title block showing the old scale shows the new one (as a scale field would).
  const [before, after] = [viewportScaleName(vp.scale, main.units), viewportScaleName(scale, main.units)];
  for (const e of main.entitiesIn(layout).values()) {
    if (e.type === "insert" && e.attribs.SCALE === before) main.update({ ...e, attribs: { ...e.attribs, SCALE: after } });
  }
  main.commit();
  main.setSpace(space);
  // Working through it: the view follows its new scale.
  if (ed.viewport === vp.id) {
    ed.exitViewport();
    ed.enterViewport(vp.id);
  }
}

/** A title block for the layout's paper, at its origin (the block is made the first time):
 * a strip along the bottom (fields for client, designer, project, legend, title, seal and map
 * boxes) or a strip down the right side. */
export function insertTitleBlock(ed: Editor, style: "bottom" | "side" = "side") {
  const layout = ed.doc.layout;
  if (!layout || ed.viewport) return ed.print("Title blocks go on a layout's paper: switch to a layout tab.", "error");
  const block = style === "bottom" ? titleBlockBottom(layout.paper, ed.doc.units) : titleBlock(layout.paper, ed.doc.units);
  const viewport = [...ed.doc.entities.values()].find((e): e is ViewportEntity => e.type === "viewport");
  const scale = viewport ? viewportScaleName(viewport.scale, ed.doc.units) : "";
  const attribs: Record<string, string> =
    style === "bottom"
      ? Object.fromEntries(attributeDefs(block).map((d) => [d.tag, d.value]))
      : { SCALE: scale, DATE: new Date().toLocaleDateString("en-US"), SHEET_NUMBER: "" };
  Object.assign(attribs, { PROJECT: ed.drawingName, SHEET_TITLE: layout.name });
  ed.doc.begin("TITLEBLOCK");
  // A layout has one title block: the one there (a new layout's, say) is replaced, and the
  // viewports are fitted inside the new one's border, clear of its strip.
  let old: Box | null = null;
  for (const e of [...ed.doc.entities.values()]) {
    if (e.type !== "insert" || !/^Title Block /.test(e.block)) continue;
    old = /^Title Block Bottom /.test(e.block) ? drawingAreaBottom(layout.paper, ed.doc.units) : drawingArea(layout.paper, ed.doc.units);
    ed.doc.remove(e.id);
  }
  const area = style === "bottom" ? drawingAreaBottom(layout.paper, ed.doc.units) : drawingArea(layout.paper, ed.doc.units);
  const at = (v: number, edge: number | undefined) => edge !== undefined && Math.abs(v - edge) < 1e-6;
  for (const e of [...ed.doc.entities.values()]) {
    if (e.type !== "viewport") continue;
    // An edge on the old title block's drawing area moves to the new one's; others stay, inside it.
    const [l, r, b, t] = [e.center.x - e.width / 2, e.center.x + e.width / 2, e.center.y - e.height / 2, e.center.y + e.height / 2];
    const minX = at(l, old?.minX) ? area.minX : Math.max(l, area.minX);
    const maxX = at(r, old?.maxX) ? area.maxX : Math.min(r, area.maxX);
    const minY = at(b, old?.minY) ? area.minY : Math.max(b, area.minY);
    const maxY = at(t, old?.maxY) ? area.maxY : Math.min(t, area.maxY);
    if (maxX - minX < 1e-6 || maxY - minY < 1e-6) continue;
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    // The model stays where it was on the paper: the view moves with the frame's centre.
    const view = { x: e.view.x + (center.x - e.center.x) / e.scale, y: e.view.y + (center.y - e.center.y) / e.scale };
    if (minX !== e.center.x - e.width / 2 || maxX !== e.center.x + e.width / 2 || minY !== e.center.y - e.height / 2 || maxY !== e.center.y + e.height / 2)
      ed.doc.update({ ...e, center, width: maxX - minX, height: maxY - minY, view });
  }
  if (!ed.doc.blocks.has(block.name)) ed.doc.setBlock(block);
  ed.doc.add(ed.make<InsertEntity>({ type: "insert", block: block.name, at: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, attribs }));
  ed.doc.commit();
  if (style === "bottom") ed.print("Title block placed. Double-click it to fill in the client, project and sheet; the print date and file name fill themselves in.", "info");
}

/** TITLEBLOCK: which style, then it's placed on the layout's paper. */
export class TitleBlockCommand extends Command {
  name = "TITLEBLOCK";
  prompt(): Prompt {
    return { text: "Enter title block style", keywords: [{ key: "B", label: "Bottom" }, { key: "S", label: "Side" }], enterLabel: "Bottom" };
  }
  keyword(key: string) {
    this.ed.finish();
    insertTitleBlock(this.ed, key === "S" ? "side" : "bottom");
  }
  enter() {
    this.keyword("B");
  }
}
