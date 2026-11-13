import { DEFAULT_SETTINGS, type Settings } from "./evaluate";

// A calculation worksheet, as Mathcad lays one out: regions placed on pages (positions in CSS
// pixels at 100%), read top to bottom, then left to right. Pages stack: page n's content area
// starts at y = n × the content height.

/** Text and math can have a color (hex); none is black. */
export type MathRegion = { id: string; kind: "math"; x: number; y: number; latex: string; displayUnit?: string; color?: string };
export type TextStyle = "normal" | "heading" | "subheading" | "note";
export type TextFont = "sans" | "serif" | "mono";
/** Text in a style (heading, note...), with its own font, size (CSS px), bold, italic and
 * underline on top where they're set (see text-format.ts). */
export type TextRegion = {
  id: string;
  kind: "text";
  x: number;
  y: number;
  text: string;
  style: TextStyle;
  width: number;
  color?: string;
  font?: TextFont;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};
/** A table (Mathcad's): each column a vector, named by its header, in its unit. */
export type TableRegion = { id: string; kind: "table"; x: number; y: number; columns: { name: string; unit: string }[]; rows: string[][] };
/** An X-Y plot: traces of y against x (expressions, usually in a range variable or vectors). */
export type PlotRegion = { id: string; kind: "plot"; x: number; y: number; width: number; height: number; traces: { x: string; y: string }[]; xUnit?: string; yUnit?: string };
/** A solve block (Mathcad's): guess values, constraints, and the solver line (find). */
export type SolveRegion = { id: string; kind: "solve"; x: number; y: number; guesses: string[]; constraints: string[]; solver: string; displayUnit?: string };
/** A steel shape from the AISC tables: defines its properties (A, I_x, Z_x...), with an optional
 * subscript added to each name (A_b, I_{x,b}) to tell several apart. */
export type SectionRegion = { id: string; kind: "section"; x: number; y: number; shape: string; suffix?: string; compact?: boolean };
/** A picture (Mathcad's image region): an SVG drawing, such as a design's sketch, shown at its size. */
export type ImageRegion = { id: string; kind: "image"; x: number; y: number; width: number; height: number; svg: string };
export type Region = MathRegion | TextRegion | TableRegion | PlotRegion | SolveRegion | SectionRegion | ImageRegion;

/** The calc paper's header: what each printed page carries. */
export type Header = { project: string; title: string; by: string; checked: string; date: string; number: string };

export type Paper = "letter" | "a4";

/** The grid regions snap to, as Mathcad's: shown (and printed) or not, Standard or Fine. */
export type Grid = {
  show: boolean;
  size: "standard" | "fine";
  /** Mathcad's major gridlines (every inch, or 25 mm): shown unless false. */
  major?: boolean;
  /** Values entered shown in blue (an allcon option; Mathcad shows them black). */
  inputsBlue?: boolean;
};
export const DEFAULT_GRID: Grid = { show: true, size: "standard", major: true };

/** Grid spacing in CSS pixels: 0.2 in (Fine 0.1 in) on US paper, 5 mm (Fine 2.5 mm) on A4. */
export const gridStep = (paper: Paper, grid: Grid) => (paper === "a4" ? 96 / 25.4 : 96) * (paper === "a4" ? 5 : 0.2) * (grid.size === "fine" ? 0.5 : 1);

export type CalcData = {
  format: "conkit-calc";
  version: 1;
  paper: Paper;
  /** Missing in worksheets made before there was a choice: the default. */
  grid?: Grid;
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
  grid: DEFAULT_GRID,
  settings: { ...DEFAULT_SETTINGS, system },
  header: { project: "", title: "", by: "", checked: "", date: new Date().toLocaleDateString("en-US"), number: "" },
  regions: [],
});

/** Reading order: top to bottom, then left to right (as Mathcad evaluates). */
export function readingOrder<T extends { x: number; y: number }>(regions: T[]): T[] {
  return [...regions].sort((a, b) => a.y - b.y || a.x - b.x);
}
