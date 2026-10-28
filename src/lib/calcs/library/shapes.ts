// Steel shapes from the AISC Shapes Database (v16.0, as the 16th edition Manual): their
// dimensions and properties, in US customary units. The table is loaded on first use (it's
// about 75 KB); scripts/aisc-shapes.py makes it from AISC's spreadsheet.

type Table = { source: string; types: Record<string, { props: string[]; shapes: (string | number | null)[][] }> };

export type Shape = { type: string; label: string; metric: string; values: Record<string, number> };

/** What each AISC property is called in a worksheet, its unit, and what it is. */
export type Property = { name: string; unit: string; what: string };

const PROPERTIES: Record<string, Property> = {
  W: { name: "w_sw", unit: "lbf/ft", what: "Self-weight" },
  A: { name: "A", unit: "in^2", what: "Area" },
  d: { name: "d", unit: "in", what: "Depth (angles: shorter leg)" },
  Ht: { name: "H", unit: "in", what: "Overall height" },
  h: { name: "h", unit: "in", what: "Flat height of the longer wall" },
  OD: { name: "D", unit: "in", what: "Outside diameter" },
  bf: { name: "b_f", unit: "in", what: "Flange width" },
  B: { name: "B", unit: "in", what: "Overall width" },
  b: { name: "b", unit: "in", what: "Flat width of the shorter wall (angles: longer leg)" },
  ID: { name: "D_i", unit: "in", what: "Inside diameter" },
  tw: { name: "t_w", unit: "in", what: "Web thickness" },
  tf: { name: "t_f", unit: "in", what: "Flange thickness" },
  t: { name: "t", unit: "in", what: "Leg thickness" },
  tnom: { name: "t_nom", unit: "in", what: "Nominal wall thickness" },
  tdes: { name: "t", unit: "in", what: "Design wall thickness" },
  kdes: { name: "k_des", unit: "in", what: "Flange face to web toe of fillet (design)" },
  k1: { name: "k_1", unit: "in", what: "Web center to flange toe of fillet" },
  x: { name: "x_c", unit: "in", what: "Centroid from the back of the shape (x)" },
  y: { name: "y_c", unit: "in", what: "Centroid from the flange face or heel (y)" },
  eo: { name: "e_o", unit: "in", what: "Shear center from the web" },
  xp: { name: "x_p", unit: "in", what: "Plastic neutral axis (x)" },
  yp: { name: "y_p", unit: "in", what: "Plastic neutral axis (y)" },
  "bf/2tf": { name: "lambda_f", unit: "", what: "Flange slenderness, bf/2tf" },
  "b/t": { name: "lambda_f", unit: "", what: "Flange or leg slenderness, b/t" },
  "b/tdes": { name: "lambda_b", unit: "", what: "Wall slenderness, b/t" },
  "h/tw": { name: "lambda_w", unit: "", what: "Web slenderness, h/tw" },
  "h/tdes": { name: "lambda_h", unit: "", what: "Wall slenderness, h/t" },
  "D/t": { name: "lambda_D", unit: "", what: "Slenderness, D/t (tees: d/tw)" },
  Ix: { name: "I_x", unit: "in^4", what: "Moment of inertia, x" },
  Zx: { name: "Z_x", unit: "in^3", what: "Plastic modulus, x" },
  Sx: { name: "S_x", unit: "in^3", what: "Elastic modulus, x" },
  rx: { name: "r_x", unit: "in", what: "Radius of gyration, x" },
  Iy: { name: "I_y", unit: "in^4", what: "Moment of inertia, y" },
  Zy: { name: "Z_y", unit: "in^3", what: "Plastic modulus, y" },
  Sy: { name: "S_y", unit: "in^3", what: "Elastic modulus, y" },
  ry: { name: "r_y", unit: "in", what: "Radius of gyration, y" },
  Iz: { name: "I_z", unit: "in^4", what: "Moment of inertia, z (principal)" },
  rz: { name: "r_z", unit: "in", what: "Radius of gyration, z (principal)" },
  Sz: { name: "S_z", unit: "in^3", what: "Elastic modulus, z" },
  J: { name: "J", unit: "in^4", what: "Torsional constant" },
  Cw: { name: "C_w", unit: "in^6", what: "Warping constant" },
  C: { name: "C", unit: "in^3", what: "HSS torsional constant" },
  ro: { name: "r_o", unit: "in", what: "Polar radius of gyration about the shear center" },
  H: { name: "H", unit: "", what: "Flexural constant" },
  rts: { name: "r_ts", unit: "in", what: "Effective radius of gyration" },
  ho: { name: "h_o", unit: "in", what: "Distance between flange centroids" },
};

/** Units the properties are shown in, in SI worksheets. */
export const SI_UNITS: Record<string, string> = { in: "mm", "in^2": "mm^2", "in^3": "mm^3", "in^4": "mm^4", "in^6": "mm^6", "lbf/ft": "kN/m" };

export const SHAPE_TYPES: [string, string][] = [
  ["W", "W (wide flange)"],
  ["HSS", "HSS (rectangular, square, round)"],
  ["PIPE", "Pipe"],
  ["C", "C (channel)"],
  ["MC", "MC (channel)"],
  ["L", "L (angle)"],
  ["WT", "WT (tee)"],
  ["HP", "HP (bearing pile)"],
  ["S", "S (American standard beam)"],
  ["M", "M"],
  ["MT", "MT (tee)"],
  ["ST", "ST (tee)"],
];

let table: Table | null = null;
let index: Map<string, Shape> | null = null;
let loading: Promise<void> | null = null;

/** Loads the shapes table (once). */
export function loadShapes(): Promise<void> {
  loading ??= import("./aisc-shapes.json").then((m) => {
    table = (m.default ?? m) as Table;
    index = new Map();
    for (const [type, { props, shapes }] of Object.entries(table.types)) {
      for (const [label, metric, ...vals] of shapes) {
        const values: Record<string, number> = {};
        props.forEach((p, i) => {
          if (typeof vals[i] === "number") values[p] = vals[i] as number;
        });
        const shape: Shape = { type, label: String(label), metric: String(metric), values };
        index.set(key(shape.label), shape);
        index.set(key(shape.metric), shape);
      }
    }
  });
  return loading;
}

export const shapesLoaded = () => index !== null;

/** A designation as looked up: W14x22, w 14 X 22 and W14×22 are all W14X22. */
const key = (label: string) => label.toUpperCase().replace(/[\s]/g, "").replace(/×/g, "X");

export function findShape(label: string): Shape | null {
  return index?.get(key(label)) ?? null;
}

/** Shapes whose designation starts with (or contains) what's typed, of a type or any. */
export function searchShapes(query: string, type?: string, limit = 60): Shape[] {
  if (!table || !index) return [];
  const q = key(query);
  const out: Shape[] = [];
  const later: Shape[] = [];
  for (const shape of new Set(index.values())) {
    if (type && shape.type !== type) continue;
    const l = key(shape.label);
    if (!q || l.startsWith(q) || key(shape.metric).startsWith(q)) out.push(shape);
    else if (l.includes(q)) later.push(shape);
    if (out.length >= limit) break;
  }
  // An exact designation first.
  const exact = out.findIndex((s) => key(s.label) === q || key(s.metric) === q);
  if (exact > 0) out.unshift(...out.splice(exact, 1));
  return [...out, ...later].slice(0, limit);
}

/** What an AISC property is called in a worksheet (angles' b/t is λ, a tee's d/tw is λ_s). */
export function property(type: string, prop: string): Property | null {
  const p = PROPERTIES[prop];
  if (!p) return null;
  if (prop === "b/t" && type === "L") return { ...p, name: "lambda" };
  if (prop === "D/t" && /T$/.test(type)) return { ...p, name: "lambda_s", what: "Stem slenderness, d/tw" };
  return p;
}

/** A property by its AISC name (Zx) or its worksheet name (Z_x). */
export function shapeProperty(shape: Shape, name: string): { value: number; unit: string } | null {
  const wanted = name.replace(/[{}\s\\]/g, "");
  for (const [prop, value] of Object.entries(shape.values)) {
    const p = property(shape.type, prop);
    if (p && (prop.toLowerCase() === wanted.toLowerCase() || p.name === wanted || p.name === wanted.replace(/^λ/, "lambda"))) return { value, unit: p.unit };
  }
  return null;
}

export const SHAPES_SOURCE = "AISC Shapes Database v16.0";
