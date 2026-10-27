import { attributeDefs } from "./blocks";
import type { DraftDocument } from "./document";
import type { Box } from "./geometry";
import type { PlotSheet, PlotView } from "./plot";
import { newLayer, type AttdefEntity, type Block, type Entity, type Layer, type Paper, type PlotSettings, type Units, type ViewportEntity } from "./types";
import { trimNumber } from "./units";

// Layouts as sheets: what a layout or the model plots as, the facts a published sheet carries
// (its number, title and scale), and a title block to start from.

/** The layer new viewports go on: it doesn't plot, so viewport frames stay off the sheets. */
export const VIEWPORT_LAYER: Layer = { ...newLayer("Viewports", 8), plot: false };

/** A layout as a sheet to plot: its paper objects, and a view for each viewport. */
export function layoutSheet(doc: DraftDocument, layoutId: string): PlotSheet {
  const layout = doc.layouts.get(layoutId)!;
  const entities = [...doc.entitiesIn(layoutId).values()];
  const views: PlotView[] = entities
    .filter((e): e is ViewportEntity => e.type === "viewport" && doc.isVisible(e))
    .map((v) => ({ center: v.center, width: v.width, height: v.height, view: v.view, scale: v.scale }));
  return { paper: layout.paper, plot: layout.plot, paperEntities: entities, views };
}

/** Model space on a sheet (the Model tab's Plot): an area of the drawing, centred, at a scale
 * or fitted to the paper. */
export function modelSheet(doc: DraftDocument, options: { paper: Paper; plot: PlotSettings; area: Box; scale: number | "fit" }): PlotSheet {
  const { paper, area } = options;
  const margin = doc.units === "mm" ? 6 : 0.25;
  const [w, h] = [paper.width - 2 * margin, paper.height - 2 * margin];
  const fit = Math.min(w / Math.max(area.maxX - area.minX, 1e-9), h / Math.max(area.maxY - area.minY, 1e-9));
  const view: PlotView = {
    center: { x: paper.width / 2, y: paper.height / 2 },
    width: w,
    height: h,
    view: { x: (area.minX + area.maxX) / 2, y: (area.minY + area.maxY) / 2 },
    scale: options.scale === "fit" ? fit : options.scale,
  };
  return { paper, plot: options.plot, paperEntities: [], views: [view] };
}

const METERS_PER_UNIT: Record<Units, number> = { architectural: 0.0254, mm: 0.001 };

/** What Sheets needs to know about a published layout: its number and title (from its title
 * block's attributes, else its name), its size in PDF points, and its scale, from its largest
 * viewport, so measuring works without calibrating. */
export function sheetFacts(doc: DraftDocument, layoutId: string) {
  const layout = doc.layouts.get(layoutId)!;
  const entities = [...doc.entitiesIn(layoutId).values()];
  const points = doc.units === "mm" ? 72 / 25.4 : 72;
  let number: string | null = null;
  let title: string | null = null;
  for (const e of entities) {
    if (e.type !== "insert") continue;
    const tags = attributeDefs(doc.blocks.get(e.block)).map((d) => d.tag);
    for (const tag of tags) {
      const value = (e.attribs[tag] ?? "").trim();
      if (!value) continue;
      if (!number && /^(SHEET[_ -]?(NO|NUM|NUMBER)|DWG[_ -]?(NO|NUM)|NUMBER)$/i.test(tag)) number = value;
      if (!title && /^(SHEET[_ -]?TITLE|DWG[_ -]?TITLE|TITLE)$/i.test(tag)) title = value;
    }
  }
  // A layout named like a sheet number (A-101, S2.01) is one, as AutoCAD users often name them.
  if (!number && /^[A-Z]{1,3}[-. ]?\d{1,4}(\.\d{1,3})?[A-Z]?$/i.test(layout.name.trim())) number = layout.name.trim();
  if (!title && number !== layout.name.trim()) title = layout.name;
  const viewports = entities.filter((e): e is ViewportEntity => e.type === "viewport").sort((a, b) => b.width * b.height - a.width * a.height);
  const main = viewports[0];
  const metersPerPoint = main ? ((1 / points) * METERS_PER_UNIT[doc.units]) / main.scale : null;
  return {
    number,
    title,
    width: layout.paper.width * points,
    height: layout.paper.height * points,
    metersPerPoint,
    scaleLabel: main ? viewportScaleName(main.scale, doc.units) : null,
  };
}

/** A title block for a paper size: a border and a strip down the right with the project,
 * sheet title, scale, date and sheet number as attributes. Drawn in paper units. */
export function titleBlock(paper: Paper, units: Units): Block {
  const u = (inches: number) => (units === "mm" ? Math.round(inches * 25.4 * 10) / 10 : inches);
  const base = { layer: "0", color: null, lineweight: -2, linetype: "ByLayer" };
  let n = 0;
  const id = () => `tb${n++}`;
  const m = u(0.5);
  const strip = Math.min(u(3.5), paper.width * 0.14);
  const [x0, y0, x1, y1] = [m, m, paper.width - m, paper.height - m];
  const sx = x1 - strip;
  const entities: Entity[] = [
    { ...base, id: id(), lineweight: 70, type: "polyline", points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], bulges: [0, 0, 0, 0], closed: true },
    { ...base, id: id(), lineweight: 50, type: "line", a: { x: sx, y: y0 }, b: { x: sx, y: y1 } },
  ];
  // Boxes up the strip, bottom first: sheet number, date, scale, sheet title; the project at the top.
  const rows: { label: string; tag: string; prompt: string; height: number; size: number }[] = [
    { label: "SHEET", tag: "SHEET_NUMBER", prompt: "Sheet number", height: u(1.4), size: u(0.45) },
    { label: "DATE", tag: "DATE", prompt: "Date", height: u(0.55), size: u(0.12) },
    { label: "SCALE", tag: "SCALE", prompt: "Scale", height: u(0.55), size: u(0.12) },
    { label: "SHEET TITLE", tag: "SHEET_TITLE", prompt: "Sheet title", height: u(1.1), size: u(0.18) },
  ];
  const pad = u(0.1);
  const label = u(0.08);
  let y = y0;
  for (const row of rows) {
    const top = y + row.height;
    entities.push({ ...base, id: id(), lineweight: 35, type: "line", a: { x: sx, y: top }, b: { x: x1, y: top } });
    entities.push({ ...base, id: id(), type: "text", at: { x: sx + pad, y: top - pad - label }, text: row.label, height: label, rotation: 0, style: "Standard", halign: "left", valign: "baseline" });
    const attr: AttdefEntity = {
      ...base,
      id: id(),
      type: "attdef",
      tag: row.tag,
      prompt: row.prompt,
      value: "",
      at: { x: sx + strip / 2, y: y + (row.height - label - pad) / 2 },
      height: row.size,
      rotation: 0,
      style: "Standard",
      halign: "center",
      valign: "middle",
      invisible: false,
    };
    entities.push(attr);
    y = top;
  }
  entities.push({ ...base, id: id(), type: "text", at: { x: sx + pad, y: y1 - pad - label }, text: "PROJECT", height: label, rotation: 0, style: "Standard", halign: "left", valign: "baseline" });
  entities.push({ ...base, id: id(), type: "attdef", tag: "PROJECT", prompt: "Project", value: "", at: { x: sx + strip / 2, y: y1 - u(0.6) }, height: u(0.2), rotation: 0, style: "Standard", halign: "center", valign: "middle", invisible: false });
  return { name: `Title Block ${paper.name.split(" (")[0]}`, base: { x: 0, y: 0 }, entities, description: `Border and title strip for ${paper.name} paper` };
}

/** The area inside a title block's border, left of its strip: where viewports go. */
export function drawingArea(paper: Paper, units: Units): Box {
  const u = (inches: number) => (units === "mm" ? inches * 25.4 : inches);
  const m = u(0.5);
  const strip = Math.min(u(3.5), paper.width * 0.14);
  const gap = u(0.25);
  return { minX: m + gap, minY: m + gap, maxX: paper.width - m - strip - gap, maxY: paper.height - m - gap };
}

/** Standard viewport scales (paper units per drawing unit), largest first. */
export const VIEWPORT_SCALES = {
  architectural: [
    ['3" = 1\'-0"', 1 / 4],
    ['1 1/2" = 1\'-0"', 1 / 8],
    ['1" = 1\'-0"', 1 / 12],
    ['3/4" = 1\'-0"', 1 / 16],
    ['1/2" = 1\'-0"', 1 / 24],
    ['3/8" = 1\'-0"', 1 / 32],
    ['1/4" = 1\'-0"', 1 / 48],
    ['3/16" = 1\'-0"', 1 / 64],
    ['1/8" = 1\'-0"', 1 / 96],
    ['3/32" = 1\'-0"', 1 / 128],
    ['1/16" = 1\'-0"', 1 / 192],
    ['1/32" = 1\'-0"', 1 / 384],
    ['1" = 20\'', 1 / 240],
    ['1" = 50\'', 1 / 600],
    ['1" = 100\'', 1 / 1200],
  ],
  mm: [
    ["1:1", 1],
    ["1:2", 1 / 2],
    ["1:5", 1 / 5],
    ["1:10", 1 / 10],
    ["1:20", 1 / 20],
    ["1:25", 1 / 25],
    ["1:50", 1 / 50],
    ["1:100", 1 / 100],
    ["1:200", 1 / 200],
    ["1:500", 1 / 500],
    ["1:1000", 1 / 1000],
    ["1:2000", 1 / 2000],
    ["1:5000", 1 / 5000],
  ],
} as const;

/** The largest standard scale no bigger than `fit` (or `fit` itself, beyond the list). */
export function standardScaleBelow(fit: number, units: "architectural" | "mm") {
  return VIEWPORT_SCALES[units].find(([, k]) => k <= fit * (1 + 1e-9))?.[1] ?? fit;
}

/** A viewport scale's name (1/4" = 1'-0", 1:50), or a ratio when it isn't a standard one. */
export function viewportScaleName(scale: number, units: "architectural" | "mm") {
  const named = VIEWPORT_SCALES[units].find(([, k]) => Math.abs(k - scale) <= 1e-9 * k);
  if (named) return named[0];
  const ratio = 1 / scale;
  return ratio >= 1 ? `1:${trimNumber(ratio, 2)}` : `${trimNumber(scale, 2)}:1`;
}
