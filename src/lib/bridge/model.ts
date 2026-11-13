// The analysis model of a bridge: the objects a frame analysis works on, named and laid out as
// midas Civil's are (its MCT file's *NODE, *ELEMENT, *MATERIAL, *SECTION, *CONSTRAINT, *SPRING,
// *ELASTICLINK, *FRAME-RLS, *STLDCASE, *CONLOAD, *BEAMLOAD), so a midas model maps onto it one to
// one. Generated from a bridge's definition (generate.ts), or imported.
//
// Units: kip, ft, radians (inputs in degrees where marked). Global Z is up; gravity acts in −Z.
//
// Local axes of a beam or a link (midas's): x from its first node to its second; z "up" (the global
// Z's side) and y = z × x, so a horizontal member along global X has y along global Y and z along
// global Z. A vertical member has y along global Y. `angle` (degrees) turns y and z about x.
// Section properties: Iy for bending about local y (a girder's strong axis, under gravity), Iz
// about local z; Asy and Asz the shear areas along y and z (0: no shear deformation).

export type Dof6<T> = [T, T, T, T, T, T]; // x, y, z, rx, ry, rz

export type ModelNode = { id: number; x: number; y: number; z: number };
export type Material = { id: number; name: string; E: number; G: number; density: number; alpha: number }; // ksf, ksf, kcf, per °F
export type Section = { id: number; name: string; A: number; Asy: number; Asz: number; J: number; Iy: number; Iz: number }; // ft², ft⁴
export type Releases = { i: Dof6<boolean>; j: Dof6<boolean> }; // in local axes: true = released
export type Element = { id: number; type: "beam" | "truss"; mat: number; sec: number; n1: number; n2: number; angle?: number; releases?: Releases };
export type Support = { node: number; fixed: Dof6<boolean> };
export type Spring = { node: number; k: Dof6<number> }; // kip/ft, kip·ft/rad, global axes
/** A spring between two nodes, in the link's local axes, acting at mid-length (midas's elastic link, shear at 0.5). */
export type ElasticLink = { id: number; n1: number; n2: number; k: Dof6<number>; angle?: number };

export type LoadType = "DC" | "DW" | "LL" | "TU" | "WS" | "USER";
export type LoadCase = { name: string; type: LoadType; description?: string };
export type Direction = "GX" | "GY" | "GZ" | "LX" | "LY" | "LZ";
export type Load =
  | { case: string; kind: "nodal"; node: number; F: Dof6<number> } // global
  | { case: string; kind: "uniform"; element: number; dir: Direction; w: number } // kip/ft over the whole element
  | { case: string; kind: "point"; element: number; dir: Direction; P: number; a: number }; // kip at a (ft) from the first node

export type Model = {
  nodes: ModelNode[];
  materials: Material[];
  sections: Section[];
  elements: Element[];
  supports: Support[];
  springs: Spring[];
  links: ElasticLink[];
  loadCases: LoadCase[];
  loads: Load[];
};

export const emptyModel = (): Model => ({ nodes: [], materials: [], sections: [], elements: [], supports: [], springs: [], links: [], loadCases: [], loads: [] });

export const DOF_NAMES = ["Dx", "Dy", "Dz", "Rx", "Ry", "Rz"] as const;

/** A model that can't be analyzed: what's wrong, said plainly. */
export class ModelError extends Error {}
