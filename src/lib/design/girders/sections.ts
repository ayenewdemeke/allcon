// Precast girder shapes for the LRFD Bridge Design Check, as symmetric outlines: the half-width
// at heights up the girder, straight lines between. Section properties come from the outline
// (the small chamfers are left out). Each standard shape keeps its published properties so tests
// can hold the outline to them.
//
// Sources:
// - AASHTO I-beams Types I–VI and AASHTO-PCI bulb-tees BT-54/63/72: the standard dimensions and
//   properties as tabulated in the PCI Bridge Design Manual and common bridge software libraries.
// - CDOT Colorado Bulb Tees CBT 37.5–90: CDOT Staff Bridge standard sheet B-618-CBT2.

export type Profile = [y: number, halfWidth: number][]; // in, from the bottom up

export type GirderShape = {
  id: string;
  name: string;
  family: "AASHTO I-beam" | "AASHTO-PCI bulb-tee" | "CDOT Colorado Bulb Tee" | "Custom";
  depth: number; // in
  topWidth: number; // in, top flange (for interface shear and the haunch)
  web: number; // in, web thickness (bv)
  profile: Profile;
  published?: { A: number; I: number; yb: number; source: string };
};

export type SectionProps = {
  A: number; // in²
  I: number; // in⁴ about the centroid
  Iy: number; // in⁴ about the vertical axis (weak axis, for lateral stability)
  yb: number; // in, centroid above the bottom
  yt: number; // in, centroid below the top
  Sb: number; // in³
  St: number; // in³
  perimeter: number; // in
  h: number; // in
};

/** Properties of a symmetric outline (trapezoids between the profile's points). */
export function profileProps(p: Profile): SectionProps {
  let A = 0;
  let Ay = 0;
  let Io = 0; // about the bottom
  let Iy = 0; // about the vertical axis: ∫ w³/12 dy, w linear on each piece
  let perimeter = 2 * p[0][1] + 2 * p[p.length - 1][1]; // bottom and top edges
  for (let k = 1; k < p.length; k++) {
    const [y0, h0] = p[k - 1];
    const [y1, h1] = p[k];
    const h = y1 - y0;
    const w0 = 2 * h0;
    const w1 = 2 * h1;
    perimeter += 2 * Math.hypot(h, h1 - h0);
    if (h <= 0) continue;
    const a = (h * (w0 + w1)) / 2;
    if (a <= 0) continue;
    const yc = y0 + (h * (w0 + 2 * w1)) / (3 * (w0 + w1));
    const ic = (h ** 3 * (w0 ** 2 + 4 * w0 * w1 + w1 ** 2)) / (36 * (w0 + w1));
    A += a;
    Ay += a * yc;
    Io += ic + a * yc ** 2;
    Iy += (h * (w0 + w1) * (w0 ** 2 + w1 ** 2)) / 48;
  }
  const yb = Ay / A;
  const I = Io - A * yb ** 2;
  const h = p[p.length - 1][0] - p[0][0];
  return { A, I, Iy, yb, yt: h - yb, Sb: I / yb, St: I / (h - yb), perimeter, h };
}

/** The half-width of an outline at a height (0 outside it). */
export function widthAt(p: Profile, y: number): number {
  if (y < p[0][0] || y > p[p.length - 1][0]) return 0;
  for (let k = 1; k < p.length; k++) {
    const [y0, h0] = p[k - 1];
    const [y1, h1] = p[k];
    if (y <= y1) return y1 === y0 ? 2 * Math.max(h0, h1) : 2 * (h0 + ((h1 - h0) * (y - y0)) / (y1 - y0));
  }
  return 2 * p[p.length - 1][1];
}

// --- the families ------------------------------------------------------------------------------

/** An I-beam: bottom flange (width, thickness, taper to the web), web, top flange (one or two tapers). */
function iBeam(o: { H: number; B: number; bf: number; bt: number; w: number; top: [number, number][] }): Profile {
  // `top`: [height, width] from the top down: the flange, then each taper's bottom.
  const p: Profile = [
    [0, o.B / 2],
    [o.bf, o.B / 2],
    [o.bf + o.bt, o.w / 2],
  ];
  let y = o.H;
  const down: Profile = [];
  for (const [h, width] of o.top) {
    down.push([y, width / 2]);
    y -= h;
  }
  down.push([y, o.w / 2]);
  // down: top first; the outline runs bottom-up.
  const topPart = down.reverse();
  // Between the last taper and the top flange's underside the width changes along the tapers.
  // topPart[0] is the web at the tapers' bottom; then each width at its height going up; the top
  // flange's underside carries the full flange width up to the top.
  const out: Profile = [...p, ...topPart.slice(0, 1)];
  for (let k = 1; k < topPart.length; k++) out.push(topPart[k]);
  return out;
}

const AASHTO_I: { n: string; H: number; T: number; tf: number; tt: number; w: number; B: number; bf: number; bt: number; A: number; I: number; yb: number }[] = [
  { n: "I", H: 28, T: 12, tf: 4, tt: 3, w: 6, B: 16, bf: 5, bt: 5, A: 276, I: 22750, yb: 12.59 },
  { n: "II", H: 36, T: 12, tf: 6, tt: 3, w: 6, B: 18, bf: 6, bt: 6, A: 369, I: 50980, yb: 15.83 },
  { n: "III", H: 45, T: 16, tf: 7, tt: 4.5, w: 7, B: 22, bf: 7, bt: 7.5, A: 560, I: 125390, yb: 20.27 },
  { n: "IV", H: 54, T: 20, tf: 8, tt: 6, w: 8, B: 26, bf: 8, bt: 9, A: 789, I: 260730, yb: 24.73 },
];

function aashto(t: (typeof AASHTO_I)[number]): GirderShape {
  // Top: the flange (T wide, tf thick), then one taper (tt) to the web.
  const profile: Profile = [
    [0, t.B / 2],
    [t.bf, t.B / 2],
    [t.bf + t.bt, t.w / 2],
    [t.H - t.tf - t.tt, t.w / 2],
    [t.H - t.tf, t.T / 2],
    [t.H, t.T / 2],
  ];
  return { id: `aashto-${t.n.toLowerCase()}`, name: `AASHTO Type ${t.n}`, family: "AASHTO I-beam", depth: t.H, topWidth: t.T, web: t.w, profile, published: { A: t.A, I: t.I, yb: t.yb, source: "AASHTO standard I-beam properties" } };
}

function aashtoV(n: "V" | "VI", H: number, A: number, I: number, yb: number): GirderShape {
  // 42 in × 5 in top flange, a 3 in taper to 16 in, a 4 in taper to the 8 in web; 28 × 8 bottom
  // flange with a 10 in taper.
  const profile: Profile = [
    [0, 14],
    [8, 14],
    [18, 4],
    [H - 12, 4],
    [H - 8, 8],
    [H - 5, 21],
    [H, 21],
  ];
  return { id: `aashto-${n.toLowerCase()}`, name: `AASHTO Type ${n}`, family: "AASHTO I-beam", depth: H, topWidth: 42, web: 8, profile, published: { A, I, yb, source: "AASHTO standard I-beam properties" } };
}

function bulbTee(H: number, A: number, I: number, yb: number): GirderShape {
  // 42 in × 3.5 in top flange, a 2 in taper to 10 in, a 2 in fillet to the 6 in web; 26 × 6 bottom
  // flange with a 4.5 in taper.
  const profile: Profile = [
    [0, 13],
    [6, 13],
    [10.5, 3],
    [H - 7.5, 3],
    [H - 5.5, 5],
    [H - 3.5, 21],
    [H, 21],
  ];
  return { id: `bt-${H}`, name: `AASHTO-PCI BT-${H}`, family: "AASHTO-PCI bulb-tee", depth: H, topWidth: 42, web: 6, profile, published: { A, I, yb, source: "AASHTO-PCI bulb-tee properties" } };
}

/** CDOT Colorado Bulb Tee (sheet B-618-CBT2): 50 in top flange, 39.5 in bottom flange, 7 in web. */
function cbt(H: number, A: number, I: number, yb: number): GirderShape {
  const profile: Profile = [
    [0, 19.75],
    [5.875, 19.75], // bottom flange edge (with its 3/4 in chamfer)
    [10.375, 6.5], // 4.5 in slope
    [13.375, 3.5], // 3 in fillet to the web
    [H - 9.75, 3.5],
    [H - 6.75, 6.5], // 3 in fillet
    [H - 3.75, 25], // 3 in slope to the flange edge
    [H, 25], // 3.75 in flange edge
  ];
  const label = Number.isInteger(H) ? String(H) : H.toFixed(1);
  return { id: `cbt-${label}`, name: `CBT ${label}`, family: "CDOT Colorado Bulb Tee", depth: H, topWidth: 50, web: 7, profile, published: { A, I, yb, source: "CDOT sheet B-618-CBT2" } };
}

export const GIRDER_SHAPES: GirderShape[] = [
  ...AASHTO_I.map(aashto),
  aashtoV("V", 63, 1013, 521180, 31.96),
  aashtoV("VI", 72, 1085, 733320, 36.38),
  bulbTee(54, 659, 268077, 27.63),
  bulbTee(63, 713, 392638, 32.12),
  bulbTee(72, 767, 545894, 36.6),
  cbt(37.5, 792, 151579, 18.5),
  cbt(45, 845, 240424, 22.08),
  cbt(54, 908, 378473, 26.4),
  cbt(63, 971, 553233, 30.74),
  cbt(72, 1034, 767268, 35.1),
  cbt(81, 1097, 1023130, 39.48),
  cbt(90, 1160, 1323390, 43.87),
];

export const shapeById = (id: string) => GIRDER_SHAPES.find((s) => s.id === id);

/** A custom girder from its outline (half-widths), checked for sense. */
export function customShape(profile: Profile, web: number, topWidth: number): GirderShape {
  const depth = profile[profile.length - 1][0] - profile[0][0];
  return { id: "custom", name: "Custom section", family: "Custom", depth, topWidth, web, profile };
}

// iBeam is kept for custom outlines built from flange dimensions.
export { iBeam };
