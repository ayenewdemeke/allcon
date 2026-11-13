import { bar } from "./aashto";
import { pointLocation, type Pt } from "./geometry";
import { resolveBearings, type StmTemplate } from "./templates";

// The finite geometry of a standard cap's strut-and-tie model, AASHTO LRFD 10th Edition: each
// node's zone from what bounds it (5.8.2.5.2, Figure 5.8.2.2-1), the faces of struts entering it
// (lb sin θ + ha cos θ, with a shared bearing split between its struts as in Figure C5.8.2.2-4),
// the confinement factor m (5.8.2.5.3a, with A2 by Article 5.6.5), how the bars fit across the
// section (5.10.3.1), and whether the struts and nodal zones fit within the concrete. Inches.
//
// Which nodes are singular follows the FHWA design examples' practice (C5.8.2.2): a node under a
// bearing, over a column, or where the arm's struts land on the column bars' tie is checked; a
// node with no bearing or boundary (panel points, crossings) is smeared, and the corner where the
// top bars bend into the column is a curved-bar node; neither needs a stress check.

export type ZoneKind = "bearing" | "column" | "tie-line" | "curved-bar" | "smeared" | "boundary";
export type Confinement = { A1: number; A2: number; basis: string };
export type Zone = {
  kind: ZoneKind;
  wx: number; // in, the zone's length along the cap (its horizontal faces); 0 where not bounded
  hy: number; // in, its height (its vertical faces) where the chord through it is a tie: twice the bars' centroid depth (5.8.2.5.2); 0 where not bounded
  hyC: number; // in, its height where the chord through it is a strut (a CCC node's back face): the flexural compression block's depth (5.8.2.5.2)
  steelC?: number; // kip, As fy of the chord's bars within that compression block: may augment a CCC back face (5.8.2.5.1)
  steelBasis?: string;
  t: number; // in, its thickness out of plane
  bearingMember: string | null; // the member delivering the bearing force, where it isn't an applied load or reaction (a hammerhead's column strut)
  confinement: Confinement | null;
  basis: string;
};

export const SINGULAR: ZoneKind[] = ["bearing", "column", "tie-line"];

/** How a group of bars fits across the section: bars per layer, layers, clear spacing and the centroid's depth from the face (in). */
export function barsFit(width: number, sideCover: number, stirrupSize: number, count: number, size: number) {
  const db = bar(size).db;
  const ds = bar(stirrupSize).db;
  const room = width - 2 * (sideCover + ds); // between the stirrups' inside faces
  const minClear = Math.max(1.5 * db, 1.5); // AASHTO 5.10.3.1.1 (aggregate size not given)
  const most = Math.max(1, Math.min(count, Math.floor((room + minClear) / (db + minClear))));
  const layers = Math.ceil(count / most);
  const perLayer = Math.ceil(count / layers); // shared evenly between the layers
  const inLayer = Math.min(count, perLayer);
  const clearSpacing = inLayer > 1 ? (room - inLayer * db) / (inLayer - 1) : room - db;
  const layerGap = Math.max(1, db); // AASHTO 5.10.3.1.3: layers at least 1 in or db apart
  // Layers filled from the face; the centroid of equal layers (the last may be partial).
  let sum = 0;
  for (let k = 0; k < layers; k++) {
    const n = k < layers - 1 ? perLayer : count - perLayer * (layers - 1);
    sum += n * (sideCover + ds + db / 2 + k * (db + layerGap));
  }
  return { perLayer, layers, clearSpacing, centroid: sum / count, minClear, layerGap, db };
}

/**
 * Confinement of a bearing (5.8.2.5.3a and 5.6.5): A2 is the largest area of the supporting surface
 * similar to and concentric with the bearing, limited across by the cap's width, along it by the cap's
 * end and halfway to the next bearing, and by the 1V:2H spread through the cap's depth.
 */
export function bearingConfinement(x: number, others: number[], length: number, lb: number, bw: number, capWidth: number, depth: number): Confinement {
  const along = Math.min(x, length - x, ...others.filter((o) => Math.abs(o - x) > 1e-6).map((o) => Math.abs(o - x) / 2));
  const limits = [
    { k: capWidth / bw, why: "the cap's width" },
    { k: (2 * along) / lb, why: along < Math.min(x, length - x) - 1e-6 ? "halfway to the next bearing" : "the cap's end" },
    { k: (lb + 4 * depth) / lb, why: "the spread at 1V:2H through the cap's depth" },
  ];
  const gov = limits.reduce((p, q) => (q.k < p.k ? q : p));
  const k = Math.max(1, gov.k);
  const A1 = lb * bw;
  return { A1, A2: k * k * A1, basis: `The area similar to and concentric with the ${fmt(lb)} by ${fmt(bw)} in bearing, scaled by ${fmt(k)}, limited by ${gov.why} (Article 5.6.5)` };
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

/** Each node's zone in a model built from a standard cap (geometry in inches, as the model holds it). */
export function templateZones(
  t: StmTemplate,
  nodes: Pt[],
  labels: string[],
  nodeChecks: { node: string; thickness: number; faces: { source: string; type: string; width: number }[] }[],
  supportNodes: Set<number>,
  fc: number,
  fy: number,
): Zone[] {
  // The compression block's depth from a conventional flexural analysis, a = As fy / (0.85 f'c b): at the
  // top from the bottom bars, at the bottom from the top bars (5.8.2.5.2, a CCC node's back face).
  const block = (g: { size: number; count: number }) => (g.count * bar(g.size).area * fy) / (0.85 * fc * t.capWidth);
  const aTop = block(t.bottomBars);
  // A bottom strut placed at a/2 (a hammerhead's, worked out when built) has its back face a = twice its height.
  const aBot = t.chordHeight !== undefined && t.bottomChord === "auto" ? 2 * t.chordHeight : block(t.topBars);
  const L = t.length * 12;
  const cols = [...t.columns].sort((a, b) => a - b).map((c) => c * 12);
  const wc = t.columnWidth * 12;
  const faceL = cols[0] - wc / 2;
  const faceR = cols[cols.length - 1] + wc / 2;
  const tip = t.kind === "hammerhead" ? t.tipDepth : t.depth;
  const rise = (t.depth - tip) * 12;
  const soffit = (x: number) => (x < faceL && faceL > 0 ? (rise * (faceL - x)) / faceL : x > faceR && L > faceR ? (rise * (x - faceR)) / (L - faceR) : 0);
  const yT = t.depth * 12 - t.topCover;
  // A hammerhead's bottom strut where the model put it: at a/2 (its node's back face is a, as FHWA's node E), or at the entered height.
  const ch = t.chordHeight ?? t.bottomCover;
  const yB = (x: number) => soffit(x) + ch;
  const inset = Math.max(1, t.columnBarInset);
  const tieLines = t.kind === "hammerhead" ? cols.flatMap((c) => [c - wc / 2 + inset, c + wc / 2 - inset]) : [];
  const bearingXs = resolveBearings(t).map((b) => b.x * 12);
  const lb = t.bearingLength;
  const bw = Math.min(t.bearingWidth, t.capWidth);
  // The chord's own bars, where their centroid lies within the compression block, augment a CCC node's back face (5.8.2.5.1).
  const steel = (g: { size: number; count: number }, cover: number, a: number, where: string) =>
    cover <= a + 1e-9 ? { steelC: g.count * bar(g.size).area * fy, steelBasis: `${g.count} #${g.size} ${where} bars within the ${fmt(a)} in block, ${fmt(g.count * bar(g.size).area * fy)} kip at yield (5.8.2.5.1)` } : {};
  const topSteel = steel(t.topBars, t.topCover, aTop, "top");
  const botSteel = steel(t.bottomBars, t.bottomCover, aBot, "bottom");
  const topH = `twice the top bars' ${fmt(t.topCover)} in centroid depth where they're a tie, the ${fmt(aTop)} in compression block from the bottom bars where the chord is a strut (5.8.2.5.2)`;
  const botH =
    t.chordHeight !== undefined && t.bottomChord === "auto"
      ? `twice the bottom strut's ${fmt(ch)} in height: the ${fmt(aBot)} in a whose back-face strength holds the arm's moment (5.8.2.5.2)`
      : `twice the bottom chord's ${fmt(ch)} in centroid height where it's a tie, the ${fmt(aBot)} in compression block from the top bars where it's a strut (5.8.2.5.2)`;
  return nodes.map(([x, y], n): Zone => {
    const smeared = (why: string, hy = 0, hyC = hy): Zone => ({ kind: "smeared", wx: 0, hy, hyC, t: t.capWidth, bearingMember: null, confinement: null, basis: why });
    const check = nodeChecks.find((c) => c.node.trim() === labels[n]);
    const bearingFace = check?.faces.find((f) => f.type === "bearing");
    // A support is the model's boundary, except a bent's column node, which bears on its column.
    if (supportNodes.has(n) && !bearingFace) return { kind: "boundary", wx: 0, hy: 0, hyC: 0, t: t.capWidth, bearingMember: null, confinement: null, basis: "Where the model meets the column below the disturbed region." };
    if (Math.abs(y - yT) < 0.6) {
      // An inverted-T's girders bear on its ledges, not on its top: its top nodes are interior.
      const at = t.kind === "inverted-t" ? undefined : bearingXs.find((bx) => Math.abs(bx - x) < 3);
      if (at !== undefined) {
        const width = bearingFace?.width ?? lb;
        return {
          kind: "bearing",
          wx: width,
          hy: 2 * t.topCover,
          hyC: aTop,
          ...topSteel,
          t: check?.thickness ?? bw,
          bearingMember: null,
          confinement: bearingConfinement(at, bearingXs, L, width, check?.thickness ?? bw, t.capWidth, tip * 12),
          basis: `Under a ${fmt(width)} in bearing; its height is ${topH}`,
        };
      }
      // At a corner of the concrete (the column's face at the cap's end) the top bars bend down into the
      // column: a curved-bar node, which the 10th Edition doesn't yet cover (C5.8.2.2). Elsewhere a node
      // on the column bars' line with no bearing is interior: smeared.
      const corner = x <= inset + 3.01 || L - x <= inset + 3.01;
      if (corner && tieLines.some((c) => Math.abs(c - x) < 3.01)) return { kind: "curved-bar", wx: 0, hy: 2 * t.topCover, hyC: 2 * t.topCover, t: t.capWidth, bearingMember: null, confinement: null, basis: "Where the top bars bend down into the column at the cap's corner: a curved-bar node. AASHTO's provisions don't yet cover it (C5.8.2.2): it may be used where a review shows it's appropriate, or detail the corner as a CTT node" };
      return smeared("An interior node on the top bars not bounded by a bearing plate: a smeared node, whose concrete stresses need no check (C5.8.2.2)", 2 * t.topCover, aTop);
    }
    if (Math.abs(y - yB(x)) < 0.6) {
      if (bearingFace) {
        const member = bearingFace.source === "external" ? null : bearingFace.source;
        return { kind: "column", wx: bearingFace.width, hy: 2 * ch, hyC: aBot, ...botSteel, t: check?.thickness ?? t.capWidth, bearingMember: member, confinement: null, basis: `Over the column, bearing on ${fmt(bearingFace.width)} in of it; its height is ${botH}` };
      }
      if (tieLines.some((c) => Math.abs(c - x) < 1)) return { kind: "tie-line", wx: 2 * inset, hy: 2 * ch, hyC: aBot, ...botSteel, t: t.capWidth, bearingMember: null, confinement: null, basis: `Where the arm's struts land on the column bars: twice the bars' ${fmt(inset)} in inset wide; its height is ${botH}` };
      return smeared("An interior node on the bottom chord not bounded by a bearing plate: a smeared node, whose concrete stresses need no check (C5.8.2.2)", 2 * ch, aBot);
    }
    return smeared("An interior node not bounded by a bearing plate (struts crossing): a smeared node, whose concrete stresses need no check (C5.8.2.2)");
  });
}

/** Within the polygon, or within `tol` of its boundary. */
export function insideWithin(p: Pt, poly: Pt[], tol: number) {
  if (pointLocation(p, poly) >= 0) return true;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    const d: Pt = [b[0] - a[0], b[1] - a[1]];
    const s = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1)));
    if (Math.hypot(a[0] + s * d[0] - p[0], a[1] + s * d[1] - p[1]) <= tol) return true;
  }
  return false;
}

/** Where a member's centerline leaves a node's zone (the zone's rectangle), from the node toward the other end. */
export function exitPoint(p: Pt, u: Pt, z: Zone | null): Pt {
  if (!z || !(z.wx > 0) || !(z.hy > 0)) return p;
  const s = Math.min(Math.abs(u[0]) > 1e-9 ? z.wx / 2 / Math.abs(u[0]) : Infinity, Math.abs(u[1]) > 1e-9 ? z.hy / 2 / Math.abs(u[1]) : Infinity);
  return [p[0] + s * u[0], p[1] + s * u[1]];
}

/**
 * Whether a strut's band, from width wa at a to wb at b, stays within the concrete (tolerance in
 * inches), over the stretch from 0 to `upto` of its length: from a singular end the strut is taken as
 * prismatic to midlength, beyond which it may fan out to a smeared node (C5.8.2.2).
 */
export function bandFits(a: Pt, b: Pt, wa: number, wb: number, outline: Pt[], tol = 1, from = 0, upto = 1) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-9) return { ok: true };
  const n: Pt = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  let ok = true;
  for (let k = 0; k <= 10; k++) {
    const s = from + ((upto - from) * k) / 10;
    const c: Pt = [a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])];
    const w = wa + s * (wb - wa);
    for (const side of [1, -1]) if (!insideWithin([c[0] + (side * n[0] * w) / 2, c[1] + (side * n[1] * w) / 2], outline, tol)) ok = false;
  }
  return { ok };
}

/** The overlap of two nodes' zones (rectangles centered on the nodes), in inches along x and y. */
export function zoneOverlap(p: Pt, a: Zone, q: Pt, b: Zone) {
  const ox = (a.wx + b.wx) / 2 - Math.abs(p[0] - q[0]);
  const oy = (a.hy + b.hy) / 2 - Math.abs(p[1] - q[1]);
  return { ox, oy };
}
