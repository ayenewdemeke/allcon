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

export type Entity = LineEntity | PolylineEntity | CircleEntity | ArcEntity | EllipseEntity | SplineEntity | XlineEntity | RayEntity;
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

/** Drawing units: imperial drawings are in inches and read as feet and inches; metric ones in millimetres. */
export type Units = "architectural" | "mm";

export type DrawingData = {
  format: "conkit-drawing";
  version: 1;
  units: Units;
  layers: Layer[];
  currentLayer: string;
  entities: Entity[];
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
};

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
