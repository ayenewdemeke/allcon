// A drawing, as AutoCAD (and DXF) models one: entities on layers, with properties that are
// either their own or ByLayer. Kept to DXF's meaning so drawings import and export losslessly.

export type Vec = { x: number; y: number };

/** An AutoCAD Color Index (1-255), a true colour ("#rrggbb"), or null for ByLayer. */
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
};

/** A multileader: an arrowhead, a leader line to a landing, and text. */
export type LeaderEntity = EntityBase & { type: "leader"; points: Vec[]; text: string; height: number; style: string; dimStyle: string };

/** A hatch: boundary loops (filled even-odd, so loops inside loops are islands) and a pattern. */
export type HatchEntity = EntityBase & { type: "hatch"; loops: Vec[][]; pattern: string; scale: number; angle: number };

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
  | HatchEntity;
export type EntityType = Entity["type"];

export type Layer = {
  name: string;
  color: number | string; // never ByLayer
  lineweight: number; // LW_DEFAULT or a weight
  linetype: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
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

/** Drawing units: imperial drawings are in inches and read as feet and inches; metric ones in millimetres. */
export type Units = "architectural" | "mm";

export type DrawingData = {
  format: "conkit-drawing";
  version: 1;
  units: Units;
  layers: Layer[];
  currentLayer: string;
  entities: Entity[];
  textStyles?: TextStyle[];
  dimStyles?: DimStyle[];
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
