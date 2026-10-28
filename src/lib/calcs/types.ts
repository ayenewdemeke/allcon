import { DEFAULT_SETTINGS, type Settings } from "./evaluate";

// A calculation worksheet, as Mathcad lays one out: regions placed on pages (positions in CSS
// pixels at 100%), read top to bottom, then left to right. Pages stack: page n's content area
// starts at y = n × the content height.

export type MathRegion = { id: string; kind: "math"; x: number; y: number; latex: string; displayUnit?: string };
export type TextStyle = "normal" | "heading" | "subheading" | "note";
export type TextRegion = { id: string; kind: "text"; x: number; y: number; text: string; style: TextStyle; width: number };
export type Region = MathRegion | TextRegion;

/** The calc paper's header: what each printed page carries. */
export type Header = { project: string; title: string; by: string; checked: string; date: string; number: string };

export type Paper = "letter" | "a4";

export type CalcData = {
  format: "conkit-calc";
  version: 1;
  paper: Paper;
  settings: Settings;
  header: Header;
  regions: Region[];
};

/** Page sizes and margins in CSS pixels (96 per inch). The top margin holds the header. */
export const PAGES: Record<Paper, { width: number; height: number; left: number; right: number; top: number; bottom: number; label: string }> = {
  letter: { width: 816, height: 1056, left: 72, right: 72, top: 120, bottom: 72, label: "Letter (8.5 x 11 in)" },
  a4: { width: 794, height: 1123, left: 68, right: 68, top: 120, bottom: 68, label: "A4 (210 x 297 mm)" },
};

export const contentSize = (paper: Paper) => {
  const p = PAGES[paper];
  return { width: p.width - p.left - p.right, height: p.height - p.top - p.bottom };
};

/** The grid regions snap to. */
export const GRID = 8;

export const emptyCalc = (system: Settings["system"] = "USCS"): CalcData => ({
  format: "conkit-calc",
  version: 1,
  paper: system === "SI" ? "a4" : "letter",
  settings: { ...DEFAULT_SETTINGS, system },
  header: { project: "", title: "", by: "", checked: "", date: new Date().toLocaleDateString("en-US"), number: "" },
  regions: [],
});

/** Reading order: top to bottom, then left to right (as Mathcad evaluates). */
export function readingOrder<T extends { x: number; y: number }>(regions: T[]): T[] {
  return [...regions].sort((a, b) => a.y - b.y || a.x - b.x);
}
