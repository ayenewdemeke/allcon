import type { DtInputs } from "./double-tee";
import { setPath } from "./sources";

// The Colorado Division of Highways' Double T Bridge Standard (sheets dated 3-82, issued with the
// Staff Bridge memo of November 15, 1982): simple spans of 36 to 66 ft, 30'-6" to 38'-6" wide, of
// adjacent double tees with a 7" integral top slab (no CIP deck), 1'-3" curbs and Type 3 rail.
// Dwg. B-3 tabulates, for each span and width, the units, the section and the prestress; Dwg. B-7
// harps the strands, their centroid E_E above the bottom at the ends and E_MS from 0.4 span to
// midspan. 1/2" 270 ksi stress-relieved strand (0.153 in²), f′c 6,000 psi. Values only.

export const DT_STANDARD_NAME = "CDOH Double T Bridge Standard (1982)";
export const DT_STANDARD_YEAR = 1982;
export const DT_STANDARD_SLAB = 7; // in, the integral top slab
export const DT_STANDARD_FC = 6; // ksi
export const DT_STANDARD_STRAND = { strand: '1/2" 270 ksi stress-relieved', fpu: 270, aps: 0.153, lowRelaxation: false };
export const DT_STANDARD_HARP_AT = 0.4; // of the span, Dwg. B-7

export type DtStandardRow = {
  span: number; // ft
  width: number; // ft, out to out
  units: number;
  unitWidth: number; // in, W
  S: number; // in, stem spacing
  D: number; // in, depth
  Tt: number; // in, stem width at the top
  Tb: number; // in, stem width at the bottom
  EE: number; // in, strand centroid above the bottom at the ends
  EMS: number; // in, at midspan
  Fi: number; // kip per unit, jacking force before losses
  Ff: number; // kip per unit, after all losses
  ri: number; // Fi / (f′s A*s)
  rf: number; // Ff / (f′s A*s)
  fci: number; // psi
};

const W = { 30.5: [4, 91.25], 32.5: [4, 97.25], 34.5: [4, 103.25], 36.5: [5, 87.375], 38.5: [5, 92.125] } as const;
const SEC = {
  36: [54, 34.5, 8, 6],
  40: [60, 37, 7.5, 5.125],
  44: [60, 37, 7.5, 5.125],
  48: [60, 37, 7.5, 5.125],
  52: [60, 45, 7.5, 4.5],
  56: [60, 45, 7.5, 4.5],
  60: [60, 45, 7.5, 4.5],
  64: [60, 45, 7.5, 4.5],
  66: [60, 45, 7.5, 4.5],
} as const;
// [span, width, EE, EMS, Fi, Ff, Fi/fsAs, Ff/fsAs, f′ci] as Dwg. B-3 prints them.
const P: [number, keyof typeof W, number, number, number, number, number, number, number][] = [
  [36, 30.5, 23.32, 3.25, 326.63, 229.12, 0.658, 0.462, 4000],
  [36, 32.5, 23.32, 3.25, 331.9, 234.83, 0.669, 0.473, 4000],
  [36, 34.5, 23.28, 3.25, 337.15, 240.52, 0.68, 0.485, 4000],
  [36, 36.5, 23.95, 3.0, 268.76, 193.49, 0.65, 0.468, 4000],
  [36, 38.5, 22.94, 3.25, 348.33, 250.12, 0.702, 0.504, 4000],
  [40, 30.5, 24.49, 3.25, 352.71, 253.63, 0.711, 0.511, 4000],
  [40, 32.5, 24.56, 3.5, 385.44, 262.75, 0.666, 0.454, 4100],
  [40, 34.5, 24.57, 3.5, 391.3, 269.25, 0.676, 0.465, 4000],
  [40, 36.5, 25.08, 3.25, 317.4, 218.98, 0.64, 0.441, 4000],
  [40, 38.5, 24.22, 3.5, 403.52, 279.42, 0.697, 0.483, 4000],
  [44, 30.5, 23.86, 3.5, 428.72, 307.56, 0.741, 0.531, 4000],
  [44, 32.5, 23.94, 3.75, 464.39, 318.37, 0.702, 0.481, 4000],
  [44, 34.5, 23.97, 3.75, 471.42, 326.28, 0.713, 0.493, 4000],
  [44, 36.5, 24.26, 3.25, 361.65, 265.0, 0.729, 0.534, 4000],
  [44, 38.5, 23.64, 3.75, 485.49, 337.7, 0.734, 0.511, 4000],
  [48, 30.5, 23.45, 4.0, 541.77, 370.7, 0.728, 0.498, 4100],
  [48, 32.5, 23.53, 4.0, 546.66, 376.87, 0.735, 0.507, 4000],
  [48, 34.5, 23.56, 4.0, 554.76, 386.14, 0.746, 0.519, 4100],
  [48, 36.5, 23.71, 3.5, 433.75, 315.77, 0.75, 0.546, 4000],
  [48, 38.5, 29.51, 3.5, 424.0, 306.28, 0.733, 0.529, 4000],
  [52, 30.5, 30.45, 3.75, 466.56, 327.4, 0.705, 0.495, 4000],
  [52, 32.5, 29.33, 3.75, 473.88, 335.62, 0.716, 0.507, 4000],
  [52, 34.5, 29.36, 3.75, 481.52, 344.14, 0.728, 0.52, 4000],
  [52, 36.5, 29.76, 3.5, 398.99, 284.99, 0.689, 0.492, 4000],
  [52, 38.5, 28.97, 3.75, 494.91, 354.85, 0.748, 0.537, 4000],
  [56, 30.5, 28.8, 4.0, 540.52, 378.37, 0.726, 0.509, 4000],
  [56, 32.5, 28.84, 4.0, 548.94, 387.96, 0.738, 0.521, 4000],
  [56, 34.5, 28.88, 4.0, 557.33, 397.5, 0.749, 0.534, 4000],
  [56, 36.5, 29.13, 3.75, 466.91, 331.22, 0.706, 0.501, 4000],
  [56, 38.5, 28.58, 4.25, 602.48, 411.76, 0.729, 0.498, 4000],
  [60, 30.5, 28.41, 4.25, 617.51, 431.94, 0.747, 0.522, 4000],
  [60, 32.5, 28.53, 4.5, 658.7, 446.1, 0.724, 0.491, 4200],
  [60, 34.5, 28.58, 4.5, 668.09, 457.12, 0.735, 0.503, 4200],
  [60, 36.5, 28.7, 4.0, 537.78, 379.77, 0.723, 0.51, 4000],
  [60, 38.5, 28.32, 4.75, 717.86, 472.04, 0.724, 0.476, 4600],
  [64, 30.5, 26.37, 4.75, 730.4, 492.15, 0.736, 0.496, 4700], // E_E 26.37 as printed (checked against the sheet)
  [64, 32.5, 28.27, 4.75, 741.97, 506.05, 0.748, 0.51, 4600],
  [64, 34.5, 28.37, 5.0, 788.69, 522.41, 0.734, 0.486, 4900],
  [64, 36.5, 28.31, 4.25, 611.86, 431.09, 0.74, 0.521, 4000],
  [64, 38.5, 28.12, 5.25, 841.16, 538.18, 0.727, 0.465, 5300],
  [66, 30.5, 28.1, 5.0, 793.25, 525.55, 0.738, 0.489, 4900],
  [66, 32.5, 28.17, 5.0, 803.39, 538.45, 0.748, 0.501, 4900],
  [66, 34.5, 28.29, 5.25, 849.59, 555.95, 0.734, 0.48, 5200],
  [66, 36.5, 28.19, 4.5, 667.38, 460.86, 0.734, 0.507, 4000],
  [66, 38.5, 27.99, 5.25, 867.55, 567.83, 0.749, 0.491, 5400],
];

export const DT_STANDARD_1982: DtStandardRow[] = P.map(([span, width, EE, EMS, Fi, Ff, ri, rf, fci]) => {
  // The 38'-6" width at 48 ft takes the deeper section of the longer spans.
  const [S, D, Tt, Tb] = span === 48 && width === 38.5 ? [60, 45, 7.5, 4.5] : SEC[span as keyof typeof SEC];
  const [units, unitWidth] = W[width];
  return { span, width, units, unitWidth, S, D, Tt, Tb, EE, EMS, Fi, Ff, ri, rf, fci };
});

/** A row's strands per unit: A*s = Fi / (ri f′s), in 0.153 in² strands. */
export const standardStrands = (r: DtStandardRow) => r.Fi / (r.ri * DT_STANDARD_STRAND.fpu * DT_STANDARD_STRAND.aps);
/** The same, as the whole strands it is (every row works out within 0.05 of a whole number). */
export const standardStrandCount = (r: DtStandardRow) => Math.round(standardStrands(r));

const ftIn = (inches: number) => {
  const ft = Math.floor(inches / 12 + 1e-9);
  const rest = +(inches - ft * 12).toFixed(3);
  return `${ft}'-${rest}"`;
};

export type DtStandardItem = { label: string; bridge: string; standard: string; ok: boolean };
export type DtStandardCheck = { applies: boolean; row: DtStandardRow | null; items: DtStandardItem[]; summary: string };

/**
 * Whether the bridge was built to the 1982 standard: built in 1982 or later, a single simple span at
 * one of its spans and widths, with its units (number and width), stem spacing, depth and integral
 * top slab, and no CIP deck. Each comparison is listed, so a mismatch says why the standard doesn't apply.
 */
export function checkStandard(i: DtInputs): DtStandardCheck {
  const items: DtStandardItem[] = [];
  const year = i.bridge.yearBuilt;
  items.push({ label: "Year built", bridge: String(year), standard: `${DT_STANDARD_YEAR} or later`, ok: year >= DT_STANDARD_YEAR });
  const L = i.span;
  const span = [...new Set(DT_STANDARD_1982.map((r) => r.span))].reduce((a, s) => (Math.abs(s - L) < Math.abs(a - L) ? s : a));
  items.push({ label: "Span", bridge: `${+L.toFixed(2)} ft`, standard: L < 34 || L > 68 ? "36 to 66 ft" : `${span} ft`, ok: Math.abs(span - L) <= 0.5 });
  const width = i.roadway.railToRail;
  const wRow = [...new Set(DT_STANDARD_1982.map((r) => r.width))].reduce((a, w) => (Math.abs(w - width) < Math.abs(a - width) ? w : a));
  items.push({ label: "Width, out to out", bridge: ftIn(width * 12), standard: ftIn(wRow * 12), ok: Math.abs(wRow - width) <= 0.25 });
  const row = DT_STANDARD_1982.find((r) => r.span === span && r.width === wRow)!;
  const u = i.units;
  const widths = u.layout ? u.layout.map((x) => x.flangeWidth) : Array(u.count).fill(u.flangeWidth);
  const stems = u.layout ? u.layout.map((x) => x.stemSpacing) : Array(u.count).fill(u.stemSpacing);
  items.push({ label: "Units", bridge: String(u.count), standard: String(row.units), ok: u.count === row.units });
  items.push({
    label: "Unit width",
    bridge: [...new Set(widths.map((w) => ftIn(w)))].join(", "),
    standard: ftIn(row.unitWidth),
    ok: widths.every((w) => Math.abs(w - row.unitWidth) <= 1),
  });
  items.push({ label: "Stem spacing", bridge: [...new Set(stems.map((s) => ftIn(s)))].join(", "), standard: ftIn(row.S), ok: stems.every((s) => Math.abs(s - row.S) <= 1) });
  items.push({ label: "Depth", bridge: `${+u.depth.toFixed(3)} in`, standard: `${row.D} in`, ok: Math.abs(u.depth - row.D) <= 0.5 });
  items.push({ label: "Top slab", bridge: `${+u.flangeThk.toFixed(3)} in`, standard: `${DT_STANDARD_SLAB} in, integral`, ok: Math.abs(u.flangeThk - DT_STANDARD_SLAB) <= 0.5 });
  items.push({ label: "CIP deck or topping", bridge: i.deck.present ? `${+i.deck.thk.toFixed(3)} in` : "None", standard: "None", ok: !i.deck.present });
  items.push({ label: "Spans", bridge: String(i.numSpans), standard: "1 (simple span)", ok: i.numSpans === 1 });
  const applies = items.every((x) => x.ok);
  const misses = items.filter((x) => !x.ok);
  const summary = applies
    ? `The bridge matches the ${DT_STANDARD_NAME}, Dwg. B-3, ${row.span} ft span, ${ftIn(row.width * 12)} wide: its prestress can be taken from the standard.`
    : `The ${DT_STANDARD_NAME} does not apply: ${misses.map((x) => `${x.label.toLowerCase()} ${x.bridge} (standard: ${x.standard})`).join("; ")}.`;
  return { applies, row: applies ? row : null, items, summary };
}

/**
 * The standard's prestress and materials as input changes: the strands (A*s = Fi / (ri f′s)), the
 * jacking ratio, the losses (Fi − Ff) / A*s, the harped centroid and the concrete, each sourced to the standard.
 */
export function standardPrestress(r: DtStandardRow) {
  const n = standardStrandCount(r);
  const As = n * DT_STANDARD_STRAND.aps;
  const note = `${DT_STANDARD_NAME}, Dwg. B-3: ${r.span} ft span, ${ftIn(r.width * 12)} wide`;
  return {
    note,
    strands: n,
    jackingRatio: r.ri,
    lossLumpSum: (r.Fi - r.Ff) / As,
    harp: { end: r.EE, mid: r.EMS, at: DT_STANDARD_HARP_AT },
    fci: r.fci / 1000,
    fc: DT_STANDARD_FC,
    stems: { top: r.Tt, bottom: r.Tb },
  };
}

/**
 * A design built to the standard, given the standard's prestress (known strands, harped), strand,
 * concrete and losses, each sourced to it; the stem widths too, unless the sketch dimensions them.
 */
export function applyStandard(i: DtInputs, r: DtStandardRow): DtInputs {
  const p = standardPrestress(r);
  const src = (what: string) => ({ kind: "standard" as const, note: `${p.note}: ${what}` });
  let o = i;
  o = setPath(o, "prestress.mode", "known", null);
  o = setPath(o, "prestress.strands", p.strands, src(`${p.strands} strands, Fi ${r.Fi} kip = ${r.ri} f′s A*s`));
  o = setPath(o, "prestress.harp", p.harp, src(`strands harped at 0.4 span, centroid ${r.EE} in at the ends and ${r.EMS} in at midspan (Dwg. B-7)`));
  o = setPath(o, "materials.strand", DT_STANDARD_STRAND.strand, src("1/2 in, 270 ksi stress-relieved strand"));
  o = setPath(o, "materials.fpu", DT_STANDARD_STRAND.fpu, src("f′s 270 ksi"));
  o = setPath(o, "materials.aps", DT_STANDARD_STRAND.aps, src("0.153 in² strands"));
  o = setPath(o, "materials.lowRelaxation", false, src("stress-relieved strand"));
  o = setPath(o, "materials.jackingRatio", p.jackingRatio, src(`Fi / f′s A*s = ${r.ri}`));
  o = setPath(o, "materials.fc", p.fc, src("f′c 6,000 psi at 28 days"));
  o = setPath(o, "materials.fci", p.fci, src(`f′ci ${r.fci} psi`));
  o = setPath(o, "options.lossLumpSum", +p.lossLumpSum.toFixed(3), src(`losses (Fi − Ff) / A*s, Ff ${r.Ff} kip`));
  // With the prestress known, the code's final tension limit applies (the 1 ksi is for back-calculating).
  o = { ...o, options: { ...o.options, tensionLimit: null, ignoreTension: false } };
  const sketched = (k: string) => i.sources[k]?.kind === "sketch";
  if (!sketched("units.stemTop")) o = setPath(o, "units.stemTop", r.Tt, src(`stem ${r.Tt} in at the top`));
  if (!sketched("units.stemBot")) o = setPath(o, "units.stemBot", r.Tb, src(`stem ${r.Tb} in at the bottom`));
  return o;
}
