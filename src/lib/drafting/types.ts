// A drawing, as AutoCAD (and DXF) models one: entities on layers, with properties that are
// either their own or ByLayer. Kept to DXF's meaning so drawings import and export losslessly.

export type Vec = { x: number; y: number };

/** An AutoCAD Color Index (1-255), a true colour ("#rrggbb"), null for ByLayer, or 0 for ByBlock. */
export type ColorValue = number | string | null;

/** Lineweights in hundredths of a millimetre, as DXF stores them; negative values are the special ones. */
export const LW_BYLAYER = -1;
export const LW_BYBLOCK = -2;
export const LW_DEFAULT = -3;
export const LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

type EntityBase = {
  id: string;
  layer: string;
  color: ColorValue;
  lineweight: number;
  linetype: string; // "ByLayer" or a linetype name
};

export type LineEntity = EntityBase & { type: "line"; a: Vec; b: Vec };
/** A lightweight polyline: straight segments (bulges, for arc segments, are kept for DXF). */
export type PolylineEntity = EntityBase & { type: "polyline"; points: Vec[]; bulges: number[]; closed: boolean };
export type CircleEntity = EntityBase & { type: "circle"; center: Vec; radius: number };
/** An arc, counter-clockwise from `start` to `end` (radians). */
export type ArcEntity = EntityBase & { type: "arc"; center: Vec; radius: number; start: number; end: number };

/** An ellipse (or elliptical arc): `major` is the major axis endpoint relative to the centre,
 * `ratio` the minor/major ratio, and `start`/`end` parameters (0 to 2π for a whole ellipse). */
export type EllipseEntity = EntityBase & { type: "ellipse"; center: Vec; major: Vec; ratio: number; start: number; end: number };
/** A spline through fit points. */
export type SplineEntity = EntityBase & { type: "spline"; fit: Vec[]; closed: boolean };
/** A construction line, infinite both ways, through `base` along unit `dir`. */
export type XlineEntity = EntityBase & { type: "xline"; base: Vec; dir: Vec };
/** A ray, from `base` infinitely along unit `dir`. */
export type RayEntity = EntityBase & { type: "ray"; base: Vec; dir: Vec };

/** Horizontal and vertical justification of text, as AutoCAD's (Left, Center, Middle, TR, BC...). */
export type HAlign = "left" | "center" | "right";
export type VAlign = "baseline" | "bottom" | "middle" | "top";

/** Single-line text: `height` is the height of capital letters, `rotation` in radians. */
export type TextEntity = EntityBase & { type: "text"; at: Vec; text: string; height: number; rotation: number; style: string; halign: HAlign; valign: VAlign };
/** Multiline text, wrapped to `width` (0: no wrapping), attached at its top left. */
export type MTextEntity = EntityBase & { type: "mtext"; at: Vec; text: string; height: number; width: number; rotation: number; style: string };

export type DimKind = "linear" | "aligned" | "angular" | "radius" | "diameter";
/**
 * A dimension, drawn from its definition points and its style. Linear and aligned: `p1`, `p2`
 * are the extension line origins and `loc` a point on the dimension line (linear ones measure
 * along `angle`). Angular: `p1`, `p2` on the two sides from the vertex `center`, `loc` on the
 * arc. Radius and diameter: `center`, `p1` on the circle, `loc` where the text goes.
 */
export type DimensionEntity = EntityBase & {
  type: "dimension";
  kind: DimKind;
  p1: Vec;
  p2: Vec;
  loc: Vec;
  center: Vec;
  angle: number;
  /** Replaces the measurement; "<>" stands for it. Empty: the measurement. */
  text: string;
  style: string;
  /** Overrides the style's overall scale: 1 for dimensions on a layout's paper. */
  dimScale?: number;
};

/** A multileader: an arrowhead, a leader line to a landing, and text. */
export type LeaderEntity = EntityBase & { type: "leader"; points: Vec[]; text: string; height: number; style: string; dimStyle: string; dimScale?: number };

/** A hatch: boundary loops (filled even-odd, so loops inside loops are islands) and a pattern.
 * `seeds` are the points picked inside: while set, the hatch is associative and follows its
 * boundary when that changes, as AutoCAD's. */
export type HatchEntity = EntityBase & { type: "hatch"; loops: Vec[][]; pattern: string; scale: number; angle: number; seeds?: Vec[] };

/** A block reference (INSERT): the block's objects placed at `at`, scaled and rotated about its
 * base point. `attribs` are its attribute values by tag. */
export type InsertEntity = EntityBase & { type: "insert"; block: string; at: Vec; scale: Vec; rotation: number; attribs: Record<string, string> };

/** An attribute definition (ATTDEF): in a block, where a value goes and what each insert is
 * asked for; outside a block it shows its tag. */
export type AttdefEntity = EntityBase & {
  type: "attdef";
  at: Vec;
  tag: string;
  prompt: string;
  value: string;
  height: number;
  rotation: number;
  style: string;
  halign: HAlign;
  valign: VAlign;
  invisible: boolean;
};

/** An image or a PDF page under the drawing (IMAGEATTACH, PDFATTACH), stored as a picture in
 * file storage under `key`. `at` is its lower left corner; `fade` 0 to 100. */
/** A layout viewport (MVIEW): a window on the paper showing model space around `view` at
 * `scale` (paper units per drawing unit: 1/48 for 1/4" = 1'-0"). */
export type ViewportEntity = EntityBase & { type: "viewport"; center: Vec; width: number; height: number; view: Vec; scale: number; locked: boolean };

export type ImageEntity = EntityBase & { type: "image"; key: string; name: string; source: "image" | "pdf"; at: Vec; width: number; height: number; rotation: number; fade: number };

export type Entity =
  | LineEntity
  | PolylineEntity
  | CircleEntity
  | ArcEntity
  | EllipseEntity
  | SplineEntity
  | XlineEntity
  | RayEntity
  | TextEntity
  | MTextEntity
  | DimensionEntity
  | LeaderEntity
  | HatchEntity
  | InsertEntity
  | AttdefEntity
  | ImageEntity
  | ViewportEntity;
export type EntityType = Entity["type"];

export type Layer = {
  name: string;
  color: number | string; // never ByLayer
  lineweight: number; // LW_DEFAULT or a weight
  linetype: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  /** Whether the layer plots (AutoCAD's Plot/No Plot); unset: it does. */
  plot?: boolean;
};

export type TextStyle = { name: string; font: string; widthFactor: number };

/** A dimension style (AutoCAD's DIMSTYLE): sizes are on paper, multiplied by `scale` (DIMSCALE). */
export type DimStyle = {
  name: string;
  textHeight: number; // DIMTXT
  arrowSize: number; // DIMASZ
  arrow: "closed" | "tick" | "dot" | "open";
  extOffset: number; // DIMEXO: gap from the object
  extBeyond: number; // DIMEXE: past the dimension line
  textGap: number; // DIMGAP
  baselineSpacing: number; // DIMDLI
  scale: number; // DIMSCALE
  textStyle: string;
};

/** A paper size, in the drawing's paper units (inches, or millimetres for metric drawings). */
export type Paper = { name: string; width: number; height: number };

/** How a layout plots: black lines (AutoCAD's monochrome.ctb) or in colour, with lineweights. */
export type PlotSettings = { monochrome: boolean; lineweights: boolean };

/** A layout (paper space): a sheet of paper with viewports onto the model, a title block and
 * notes, drawn 1:1 in paper units. */
export type Layout = { id: string; name: string; paper: Paper; plot: PlotSettings; entities: Entity[]; view?: { cx: number; cy: number; scale: number } };

/** Paper sizes as AutoCAD's DWG To PDF lists them (landscape). */
export const PAPER_SIZES: Record<Units, Paper[]> = {
  architectural: [
    { name: "ARCH E1 (42 x 30 in)", width: 42, height: 30 },
    { name: "ARCH E (48 x 36 in)", width: 48, height: 36 },
    { name: "ARCH D (36 x 24 in)", width: 36, height: 24 },
    { name: "ARCH C (24 x 18 in)", width: 24, height: 18 },
    { name: "ARCH B (18 x 12 in)", width: 18, height: 12 },
    { name: "ANSI E (44 x 34 in)", width: 44, height: 34 },
    { name: "ANSI D (34 x 22 in)", width: 34, height: 22 },
    { name: "ANSI C (22 x 17 in)", width: 22, height: 17 },
    { name: "ANSI B (17 x 11 in)", width: 17, height: 11 },
    { name: "Letter (11 x 8.5 in)", width: 11, height: 8.5 },
  ],
  mm: [
    { name: "ISO A0 (1189 x 841 mm)", width: 1189, height: 841 },
    { name: "ISO A1 (841 x 594 mm)", width: 841, height: 594 },
    { name: "ISO A2 (594 x 420 mm)", width: 594, height: 420 },
    { name: "ISO A3 (420 x 297 mm)", width: 420, height: 297 },
    { name: "ISO A4 (297 x 210 mm)", width: 297, height: 210 },
  ],
};

/** A new layout's paper: ARCH D for architectural drawings, A1 for metric ones. */
export const defaultPaper = (units: Units): Paper => PAPER_SIZES[units][units === "mm" ? 1 : 2];

/** A block definition: objects drawn about a base point, placed by inserts. */
export type Block = { name: string; base: Vec; entities: Entity[]; description?: string };

/** Drawing units: imperial drawings are in inches and read as feet and inches; metric ones in millimetres. */
export type Units = "architectural" | "mm";

export type DrawingData = {
  format: "conkit-drawing";
  version: 1;
  units: Units;
  layers: Layer[];
  currentLayer: string;
  entities: Entity[];
  layouts?: Layout[];
  textStyles?: TextStyle[];
  dimStyles?: DimStyle[];
  blocks?: Block[];
  currentTextStyle?: string;
  currentDimStyle?: string;
  /** The annotation scale (as a factor: 48 for 1/4" = 1'-0"), for the size of new text, dimensions and hatches. */
  annoScale?: number;
  /** Where the drawing was last looked at. */
  view?: { cx: number; cy: number; scale: number };
};

export const ENTITY_NAMES: Record<EntityType, string> = {
  line: "Line",
  polyline: "Polyline",
  circle: "Circle",
  arc: "Arc",
  ellipse: "Ellipse",
  spline: "Spline",
  xline: "Xline",
  ray: "Ray",
  text: "Text",
  mtext: "MText",
  dimension: "Dimension",
  leader: "MultiLeader",
  hatch: "Hatch",
  insert: "Block Reference",
  attdef: "Attribute Definition",
  image: "Image",
  viewport: "Viewport",
};

/** AutoCAD's starting styles: Standard (imperial, architectural ticks) or ISO-25 (metric). */
export function defaultStyles(units: Units): { textStyles: TextStyle[]; dimStyles: DimStyle[]; annoScale: number } {
  const textStyles = [{ name: "Standard", font: "Arial", widthFactor: 1 }];
  const annoScale = units === "mm" ? 50 : 48;
  const dimStyles: DimStyle[] =
    units === "mm"
      ? [{ name: "ISO-25", textHeight: 2.5, arrowSize: 2.5, arrow: "closed", extOffset: 0.625, extBeyond: 1.25, textGap: 0.625, baselineSpacing: 3.75, scale: annoScale, textStyle: "Standard" }]
      : [{ name: "Standard", textHeight: 3 / 32, arrowSize: 3 / 32, arrow: "tick", extOffset: 1 / 16, extBeyond: 1 / 8, textGap: 1 / 32, baselineSpacing: 3 / 8, scale: annoScale, textStyle: "Standard" }];
  return { textStyles, dimStyles, annoScale };
}

export const newLayer = (name: string, color: number | string = 7): Layer => ({
  name,
  color,
  lineweight: LW_DEFAULT,
  linetype: "Continuous",
  on: true,
  frozen: false,
  locked: false,
});

export const emptyDrawing = (units: Units): DrawingData => ({
  format: "conkit-drawing",
  version: 1,
  units,
  layers: [newLayer("0")],
  currentLayer: "0",
  entities: [],
});
