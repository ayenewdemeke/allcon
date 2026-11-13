// CDOT Standard Plan M-601-20, Wingwalls for Pipe or Box Culverts (July 31, 2019): the standard's
// tables and how it says to use them. A wingwall that fits the standard isn't designed: its c-bars and
// reinforcing steel per foot come from Sheet 2's table (by m, k and L as a multiple of m), its
// footing and concrete per foot from Sheet 1's table (by h, stepped along the wall as the sheet's
// design example shows), and its toe wall from Sheet 1's toe wall note. Outside the tables it's a
// special design, flagged. Feet unless noted.

import type { Bars, Check } from "../walls/cip";

/** One wingwall as the plans give it (M-601-20 Sheet 1, Box Elevation; general note 3). */
export type CulvertWingwall = {
  name: string; // "NE", "SW", …
  m: number; // ft, wall height above the footing at the barrel: the rise + 1'-4" unless the plans show otherwise
  k: number; // ft, height at the tip
  L: number; // ft, length
  theta: number; // deg, angle from the barrel (layout only: the tables don't depend on it)
  toeWall: boolean; // a toe wall along the footing (Sheet 1, "With toe wall")
  end?: "inlet" | "outlet"; // which end of the culvert it's at (for the excavation's depth there)
};

/** Sheet 2's column heads: L no more than this multiple of m. */
export const L_MULTIPLES = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5];

// Sheet 2, "c-bars and reinforcing steel quantity (exclude toe wall)": by m, then k, eleven cells
// each (one per L multiple above): c-bar size @ spacing (in) and the reinforcing steel, lb per
// foot of wall, stem and footing, not the toe wall. As printed (m = 8, k = 4, L ≤ 2.75 m reads
// 33.45, likely 35.45; m = 8, k = 6–7 jumps at L ≤ 3.0 m): kept as the standard prints them.
const SHEET2: Record<number, Record<number, string>> = {
  14: {
    4: "4@10 53.60|5@10 57.95|5@10 57.10|5@8 60.22|5@7 62.43|5@7 62.09|5@6 65.38|5@6 65.15|6@8 67.10|6@8 66.94|6@7 70.66",
    5: "4@10 55.86|5@10 60.46|5@10 59.60|5@8 62.89|5@7 65.23|5@7 64.88|5@6 68.34|5@6 68.11|6@8 70.17|6@8 70.00|6@7 73.90",
    6: "5@10 64.43|6@10 70.60|6@10 69.69|6@8 74.93|6@8 74.45|6@7 78.30|6@6 83.64|6@6 83.40|6@6 83.22|6@6 83.05|7@7 89.64",
    7: "5@10 67.29|6@10 73.76|6@10 72.83|6@8 78.32|6@8 77.84|6@7 81.87|6@6 87.45|6@6 87.21|6@6 87.02|6@6 86.86|7@7 93.73",
    8: "5@8 74.71|6@8 83.46|6@7 87.09|6@6 92.54|7@7 99.47|7@7 99.08|7@6 107.11|7@6 106.86|7@6 106.66|7@6 106.49|7@6 106.35",
    9: "5@8 78.10|6@8 87.23|6@7 91.03|6@6 96.72|7@7 103.93|7@7 103.54|7@6 111.90|7@6 111.65|7@6 111.45|7@6 111.28|7@6 111.13",
  },
  13: {
    4: "4@10 50.51|4@10 49.25|5@10 53.71|5@10 53.09|5@10 52.36|5@9 53.85|5@8 55.54|5@7 57.85|5@7 57.67|5@7 57.51|6@9 59.93",
    5: "4@10 52.66|4@10 51.37|5@10 56.09|5@10 55.46|5@10 54.99|5@9 56.29|5@8 58.08|5@7 60.51|5@7 60.33|5@7 60.17|6@9 62.72",
    6: "4@10 54.92|5@10 59.48|5@9 60.31|6@9 67.56|6@9 67.08|6@9 66.70|6@8 69.53|6@8 69.28|6@7 73.12|6@7 72.95|6@7 72.81",
    7: "4@10 57.36|5@10 62.16|5@9 63.05|6@9 70.66|6@9 70.16|6@9 69.78|6@8 72.75|6@8 72.50|6@7 76.52|6@7 76.35|6@7 76.20",
    8: "5@10 66.39|6@10 72.82|6@8 77.97|6@7 81.68|6@7 81.19|6@6 86.67|6@6 86.37|7@7 93.18|7@7 92.97|7@7 92.80|7@7 92.64",
    9: "5@10 69.37|6@10 76.10|6@8 81.49|6@7 85.37|6@7 84.87|6@6 90.59|6@6 90.29|7@7 97.39|7@7 97.18|7@7 97.00|7@7 96.85",
  },
  12: {
    2: "4@10 43.91|4@10 42.65|4@10 41.82|4@10 41.22|4@10 40.78|4@9 41.29|5@10 44.61|5@10 44.37|5@10 44.18|5@10 44.01|5@10 43.87",
    3: "4@10 45.82|4@10 44.55|4@10 43.71|4@10 43.11|4@10 42.66|4@9 43.22|5@10 46.75|5@10 46.51|5@10 46.32|5@10 46.15|5@10 46.01",
    4: "4@10 47.80|4@10 46.51|4@10 45.65|5@10 50.06|5@10 49.59|5@10 49.23|5@10 48.94|5@10 48.69|5@9 50.00|5@8 51.72|5@8 51.57",
    5: "4@10 49.84|4@10 48.53|4@10 47.66|5@10 52.33|5@10 51.85|5@10 51.48|5@10 51.19|5@10 50.94|5@9 52.33|5@8 54.14|5@8 54.00",
    6: "4@10 51.99|4@10 50.65|5@10 55.34|5@8 58.41|5@8 57.93|6@10 60.60|6@10 60.29|6@9 62.42|6@9 62.22|6@9 62.04|6@8 64.89",
    7: "4@10 54.30|5@10 58.80|5@10 57.87|5@8 61.10|5@8 60.61|6@10 63.43|6@10 63.11|6@9 65.35|6@9 65.15|6@9 64.97|6@8 67.96",
    8: "5@10 62.91|5@10 61.45|5@7 67.46|5@6 70.68|5@6 70.20|6@7 76.44|6@7 76.13|6@7 75.87|6@6 81.30|6@6 81.12|6@6 80.98",
    9: "5@10 65.64|5@10 64.15|5@7 70.44|5@6 73.82|5@6 73.33|6@7 79.86|6@7 79.54|6@7 79.28|6@6 84.95|6@6 84.77|6@6 84.62",
  },
  11: {
    2: "4@10 41.70|4@10 40.42|4@10 39.57|4@10 38.96|4@10 38.50|4@10 38.15|4@10 37.87|4@10 37.63|4@9 38.25|5@10 41.46|5@10 41.31",
    3: "4@10 43.57|4@10 42.27|4@10 41.40|4@10 40.79|4@10 40.33|4@10 39.97|4@10 39.69|4@10 39.45|4@9 40.12|5@10 43.54|5@10 43.39",
    4: "4@10 45.48|4@10 44.16|4@10 43.28|4@10 42.66|4@9 43.09|5@10 46.57|5@10 46.27|5@10 46.02|5@10 45.82|5@10 45.65|5@10 45.50",
    5: "4@10 47.46|4@10 46.10|4@10 45.21|4@10 44.58|4@9 45.06|5@10 48.74|5@10 48.44|5@10 48.19|5@10 47.99|5@10 47.81|5@10 47.67",
    6: "4@10 49.52|4@10 48.14|4@9 48.23|5@10 51.88|5@10 51.38|5@9 52.57|5@9 52.27|5@8 53.99|5@8 53.79|5@7 56.16|5@7 56.01",
    7: "4@10 51.73|4@10 50.31|4@9 50.43|5@10 54.29|5@10 53.78|5@9 55.04|5@9 54.73|5@8 56.55|5@8 56.35|5@7 58.84|5@7 58.70",
    8: "4@10 54.00|5@10 58.44|5@10 57.45|5@8 60.64|5@7 62.92|5@6 66.25|5@6 65.94|5@6 65.69|6@8 67.76|6@8 67.57|6@7 71.45",
    9: "4@10 56.20|5@10 60.87|5@10 59.85|5@8 63.21|5@7 65.60|5@6 69.09|5@6 68.78|5@6 68.52|6@8 70.69|6@8 70.51|6@7 74.57",
  },
  10: {
    2: "4@10 39.84|4@10 38.53|4@10 37.65|4@10 37.03|4@10 36.57|4@10 36.20|4@10 35.91|4@10 35.67|4@10 35.48|4@9 36.07|4@9 35.93",
    3: "4@10 41.68|4@10 40.35|4@10 39.47|4@10 38.84|4@10 38.36|4@10 38.00|4@10 37.71|4@10 37.46|4@10 37.27|4@9 37.91|4@9 37.76",
    4: "4@10 43.58|4@10 42.22|4@10 41.31|4@10 40.67|4@10 40.19|4@10 39.82|4@10 39.53|4@10 39.28|4@10 39.08|4@9 39.77|4@9 39.63",
    5: "4@10 45.53|4@10 44.14|4@10 43.21|4@10 42.56|4@10 42.07|5@10 46.44|5@10 46.13|5@10 45.87|5@10 45.67|5@10 45.49|5@10 45.34",
    6: "4@10 47.58|4@10 46.14|4@10 45.20|4@10 44.53|4@10 44.03|5@10 48.67|5@10 48.35|5@10 48.08|5@10 47.88|5@10 47.69|5@10 47.54",
    7: "4@10 49.79|4@10 48.31|4@10 47.34|5@10 51.97|5@10 51.45|5@10 51.04|5@9 52.29|5@9 52.03|5@8 53.79|5@8 53.61|5@7 56.00",
    8: "4@10 52.06|4@10 50.54|4@10 49.54|5@10 54.43|5@10 53.89|5@10 53.47|5@9 54.80|5@9 54.53|5@8 56.39|5@8 56.20|5@7 58.72",
  },
  9: {
    2: "4@10 38.01|4@10 36.75|4@10 35.85|4@10 35.21|4@10 34.73|4@10 34.36|4@10 34.06|4@10 33.81|4@10 33.61|4@10 33.44|4@10 33.30",
    3: "4@10 39.93|4@10 38.56|4@10 37.64|4@10 36.99|4@10 36.51|4@10 36.13|4@10 35.83|4@10 35.58|4@10 35.38|4@10 35.21|4@10 35.06",
    4: "4@10 41.81|4@10 40.40|4@10 39.47|4@10 38.81|4@10 38.31|4@10 37.93|4@10 37.63|4@10 37.37|4@10 37.17|4@10 36.99|4@10 36.84",
    5: "4@10 43.75|4@10 42.30|4@10 41.35|4@10 40.67|4@10 40.17|4@10 39.78|4@10 39.47|4@10 39.20|4@9 39.86|5@10 43.28|5@10 43.12",
    6: "4@10 45.79|4@10 44.30|4@10 43.31|4@10 42.62|4@10 42.10|4@10 41.71|4@10 41.39|4@10 41.12|4@9 41.82|5@10 45.46|5@10 45.30",
    7: "4@10 48.04|4@10 46.50|4@10 45.49|4@10 44.77|5@10 49.29|5@10 48.86|5@10 48.53|5@10 48.24|5@10 48.03|5@10 47.84|5@10 47.67",
    8: "4@10 50.43|4@10 48.84|4@10 47.80|4@10 47.06|5@10 51.83|5@10 51.40|5@10 51.05|5@10 50.77|5@10 50.54|5@10 50.35|5@10 50.18",
  },
  8: {
    2: "4@10 36.41|4@10 35.01|4@10 34.08|4@10 33.42|4@10 32.92|4@10 32.54|4@10 32.23|4@10 31.97|4@10 31.77|4@10 31.59|4@10 31.44",
    3: "4@10 38.23|4@10 36.80|4@10 35.85|4@10 35.18|4@10 34.67|4@10 34.28|4@10 33.97|4@10 33.70|4@10 33.50|4@10 33.32|4@10 33.17",
    4: "4@10 40.09|4@10 38.61|4@10 37.64|4@10 36.95|4@10 36.44|4@10 36.04|4@10 35.72|4@10 33.45|4@10 35.25|4@10 35.07|4@10 34.91",
    5: "4@10 41.99|4@10 40.47|4@10 39.47|4@10 38.76|4@10 38.24|4@10 37.83|4@10 37.50|4@10 37.23|4@10 37.02|4@10 36.84|4@10 36.68",
    6: "4@10 43.97|4@10 42.40|4@10 41.36|4@10 40.64|4@10 40.10|4@10 39.68|4@10 39.35|4@10 39.07|4@9 43.33|5@10 43.13|5@10 42.96",
    7: "4@10 46.19|4@10 44.56|4@10 43.49|4@10 42.74|4@10 42.18|4@10 41.75|4@10 41.41|4@10 41.13|4@9 45.65|5@10 45.45|5@10 45.28",
  },
  7: {
    2: "4@10 34.90|4@10 33.44|4@10 32.47|4@10 31.78|4@10 31.27|4@10 30.86|4@10 30.54|4@10 30.27|4@10 30.06|4@10 29.88|4@10 29.72",
    3: "4@10 36.73|4@10 35.23|4@10 34.23|4@10 33.53|4@10 33.00|4@10 32.59|4@10 32.26|4@10 31.99|4@10 31.78|4@10 31.59|4@10 31.43",
    4: "4@10 38.59|4@10 37.04|4@10 36.01|4@10 35.29|4@10 34.75|4@10 34.33|4@10 33.99|4@10 33.71|4@10 33.50|4@10 33.31|4@10 33.14",
    5: "4@10 40.48|4@10 38.86|4@10 37.80|4@10 37.06|4@10 36.50|4@10 36.07|4@10 35.73|4@10 35.44|4@10 35.22|4@10 35.03|4@10 34.86",
    6: "4@10 42.39|4@10 40.71|4@10 39.61|4@10 38.84|4@10 38.26|4@10 37.82|4@10 37.47|4@10 37.17|4@10 36.95|4@10 36.75|4@10 36.58",
  },
};

export type Sheet2Cell = { cBars: Bars; lbPerLf: number };

const parsed = new Map<string, Sheet2Cell[]>();
/** Sheet 2's row for m and k (whole feet), or null outside the table. */
export function sheet2Row(m: number, k: number): Sheet2Cell[] | null {
  const key = `${m}/${k}`;
  if (parsed.has(key)) return parsed.get(key)!;
  const raw = SHEET2[m]?.[k];
  if (!raw) return null;
  const row = raw.split("|").map((cell) => {
    const [bars, lb] = cell.trim().split(" ");
    const [bar, spacing] = bars.split("@").map(Number);
    return { cBars: { bar, spacing }, lbPerLf: Number(lb) };
  });
  parsed.set(key, row);
  return row;
}

/** The k values Sheet 2 has for m (whole feet). */
export function kRange(m: number): { min: number; max: number } | null {
  const ks = Object.keys(SHEET2[m] ?? {}).map(Number);
  return ks.length ? { min: Math.min(...ks), max: Math.max(...ks) } : null;
}
export const M_RANGE = { min: 7, max: 14 };

// Sheet 1, the footing by h (the wall's height above the footing, 2 to 14 ft): heel a and toe b
// (ft), width w, d-bars (the footing's transverse bars), and concrete per foot of wall (stem and
// footing, not the toe wall). The stem is 10 in, the footing 1'-0" deep.
const SHEET1: { h: number; a: string; b: string; w: string; d: string; cy: number }[] = [
  { h: 2, a: "1'-0\"", b: "1'-8\"", w: "2'-8\"", d: "4@9", cy: 0.161 },
  { h: 3, a: "1'-2\"", b: "2'-0\"", w: "3'-2\"", d: "4@9", cy: 0.21 },
  { h: 4, a: "1'-4\"", b: "2'-4\"", w: "3'-8\"", d: "4@9", cy: 0.259 },
  { h: 5, a: "1'-6\"", b: "2'-8\"", w: "4'-2\"", d: "4@9", cy: 0.309 },
  { h: 6, a: "1'-8\"", b: "3'-0\"", w: "4'-8\"", d: "4@9", cy: 0.358 },
  { h: 7, a: "1'-10\"", b: "3'-4\"", w: "5'-2\"", d: "4@9", cy: 0.407 },
  { h: 8, a: "2'-0\"", b: "3'-8\"", w: "5'-8\"", d: "5@11", cy: 0.457 },
  { h: 9, a: "2'-2\"", b: "4'-0\"", w: "6'-2\"", d: "5@10", cy: 0.506 },
  { h: 10, a: "2'-4\"", b: "4'-4\"", w: "6'-8\"", d: "5@10", cy: 0.556 },
  { h: 11, a: "2'-6\"", b: "4'-8\"", w: "7'-2\"", d: "5@8", cy: 0.605 },
  { h: 12, a: "2'-8\"", b: "5'-0\"", w: "7'-8\"", d: "6@8", cy: 0.654 },
  { h: 13, a: "2'-10\"", b: "5'-4\"", w: "8'-2\"", d: "7@9", cy: 0.704 },
  { h: 14, a: "3'-0\"", b: "5'-8\"", w: "8'-8\"", d: "7@7", cy: 0.753 },
];
export const sheet1 = (h: number) => SHEET1.find((r) => r.h === h) ?? null;
/** The footing's width w (ft) for h (Sheet 1). */
export function footingW(h: number) {
  const w = sheet1(h)?.w ?? "0'-0\"";
  const [ft, inch] = w.split("'-").map((s) => parseFloat(s));
  return ft + inch / 12;
}
/** The footing's heel behind the stem (ft): its width less the toe a and the 10 in stem (Sheet 1, Typical Section). */
export function heelW(h: number) {
  const a = sheet1(h)?.a ?? "0'-0\"";
  const [ft, inch] = a.split("'-").map((s) => parseFloat(s));
  return Math.max(0, footingW(h) - (ft + inch / 12) - 10 / 12);
}
/** A wingwall's toe wall: along the footing's front and across its end at the tip (the footing's width there). */
export function toeLength(w: CulvertWingwall) {
  return w.L + footingW(designH(w.k));
}

/**
 * Structure backfill around a wingwall by M-206-1 Sheet 2 ("Wingwall"), ft³: behind the stem from the
 * footing's back edge plus 1'-6" (down to the footing's bottom) up to the finished surface, which per
 * M-601-20's Typical Section meets the wall 6 in under its top and rises at 2:1 behind it; in front,
 * a 1'-6" strip beside the toe wall from its bottom to the footing's top (the grading plane). Stretch
 * by stretch, the wall's height straight from m to k, the heel the footing's b less the 10 in stem.
 */
export function wingwallBackfill(w: CulvertWingwall) {
  const r = m60120Wingwall(w);
  const at = (x: number) => w.m + ((w.k - w.m) * x) / w.L;
  // The section behind the stem, per foot of wall: the surface z(x) = h − ½ + x/2 over the heel, and
  // the 1'-6" strip beyond it down to the footing's bottom (1 ft lower).
  const section = (h: number, heel: number) => {
    const z0 = h - 0.5;
    const overHeel = heel * z0 + heel ** 2 / 4;
    const strip = 1.5 * (z0 + 1) + ((heel + 1.5) ** 2 - heel ** 2) / 4;
    return overHeel + strip;
  };
  const back = r.segments.reduce((s, g) => s + g.length * section((at(g.from) + at(g.to)) / 2, heelW(g.h)), 0);
  const front = (w.toeWall ? toeLength(w) : w.L) * 1.5 * (w.toeWall ? TOE_BELOW_FOOTING + 1 : 1);
  return { back, front, total: back + front, sectionAtM: section(w.m, heelW(designH(w.m))), sectionAtK: section(w.k, heelW(designH(w.k))) };
}

/** The toe wall's depth below the footing's bottom (Sheet 1, "With toe wall": 3'-0" from the footing's top, the footing 1'-0"). */
export const TOE_BELOW_FOOTING = 2;

/** Toe wall quantities, Sheet 1 ("Quantities for toe wall only"), per foot. */
export const TOE_WALL = { cyPerLf: 0.049, lbPerLf: 5.1 };
/** Drainage behind the wingwall is required where h ≥ 12 ft (general note 6). */
export const DRAIN_H = 12;

/** The h a section is designed for: its height rounded to the nearest foot, a half rounding down (Sheet 1's design example: 4'-6" max for h = 4'). */
export const designH = (height: number) => Math.min(14, Math.max(2, Math.ceil(height - 0.5 - 1e-9)));

/** The wall cut into stretches of one design h, from the barrel (m) to the tip (k), height straight between. */
export function segments(m: number, k: number, L: number) {
  const out: { h: number; from: number; to: number; length: number; cyPerLf: number }[] = [];
  const at = (x: number) => m + ((k - m) * x) / L;
  // Where the design h changes: the heights h + ½ between k and m.
  const cuts = new Set<number>([0, L]);
  if (Math.abs(m - k) > 1e-9) for (let h = 2; h <= 14; h++) {
    const y = h + 0.5;
    const x = ((y - m) / (k - m)) * L;
    if (x > 1e-9 && x < L - 1e-9) cuts.add(x);
  }
  const xs = [...cuts].sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i++) {
    const h = designH(at((xs[i] + xs[i + 1]) / 2));
    const row = sheet1(h)!;
    const last = out[out.length - 1];
    if (last && last.h === h) {
      last.to = xs[i + 1];
      last.length = last.to - last.from;
    } else out.push({ h, from: xs[i], to: xs[i + 1], length: xs[i + 1] - xs[i], cyPerLf: row.cy });
  }
  return out;
}

export type WingwallResult = ReturnType<typeof m60120Wingwall>;

/** One wingwall by M-601-20: whether it's within the standard, its c-bars and quantities. */
export function m60120Wingwall(w: CulvertWingwall) {
  const issues: string[] = [];
  const mR = Math.round(w.m); // Sheet 2 example, step 2: m and k to the nearest whole foot
  const kR = Math.round(w.k);
  const ratio = w.L / w.m; // step 1, with the wall's own m
  const col = L_MULTIPLES.findIndex((x) => ratio <= x + 1e-9);
  const kr = kRange(mR);
  if (!(w.m > 0 && w.L > 0 && w.k >= 0)) issues.push("The wingwall needs m, k and L.");
  if (w.k > w.m + 1e-9) issues.push("k is more than m: the wall rises toward its tip, which M-601-20 doesn't cover.");
  if (mR < M_RANGE.min || mR > M_RANGE.max) issues.push(`m rounds to ${mR} ft: Sheet 2 covers ${M_RANGE.min} to ${M_RANGE.max} ft. A special design.`);
  else if (kr && (kR < kr.min || kR > kr.max)) issues.push(`k rounds to ${kR} ft: for m = ${mR} ft Sheet 2 covers k = ${kr.min} to ${kr.max} ft. A special design.`);
  if (col < 0) issues.push(`L is ${(ratio).toFixed(2)} m: Sheet 2 goes to 3.5 m. A special design.`);
  const cell = col >= 0 ? sheet2Row(mR, kR)?.[col] ?? null : null;
  const inTable = !!cell && issues.length === 0;
  const segs = w.m > 0 && w.L > 0 && w.k >= 0 && w.k <= w.m ? segments(w.m, w.k, w.L) : [];
  const concrete = segs.reduce((s, x) => s + x.length * x.cyPerLf, 0);
  const atBarrel = sheet1(designH(w.m));
  return {
    wall: w,
    mR,
    kR,
    ratio,
    col,
    colLabel: col >= 0 ? `L ≤ ${L_MULTIPLES[col]} m` : "L > 3.5 m",
    cell,
    inTable,
    issues,
    rebar: cell ? cell.lbPerLf * w.L : 0, // step 4: lb/LF by the whole wall's length
    segments: segs,
    concrete, // CY, stem and footing
    // The toe wall along the footing's front and across its end at the tip (the footing's width there).
    toe: w.toeWall ? { length: toeLength(w), cy: TOE_WALL.cyPerLf * toeLength(w), lb: TOE_WALL.lbPerLf * toeLength(w) } : null,
    footing: atBarrel, // the footing at the barrel end (the widest)
    drain: w.m >= DRAIN_H, // general note 6
  };
}

/** The checks for a culvert's wingwalls: each within M-601-20's tables (or a special design). */
export function wingwallChecks(walls: CulvertWingwall[]): Check[] {
  const checks: Check[] = [];
  for (const [n, w] of walls.entries()) {
    const r = m60120Wingwall(w);
    const id = `ww-${n}`;
    const label = `${w.name || `Wingwall ${n + 1}`} wingwall`;
    const kr = kRange(r.mR);
    checks.push({ id: `${id}-m`, name: `${label}: m in the table`, demand: r.mR, capacity: M_RANGE.max, unit: "ft", ok: r.mR >= M_RANGE.min && r.mR <= M_RANGE.max && w.k <= w.m + 1e-9, ref: "M-601-20 Sheet 2", note: `m = ${fmtFt(w.m)}, rounds to ${r.mR} ft (table: ${M_RANGE.min}–${M_RANGE.max} ft)` });
    checks.push({ id: `${id}-k`, name: `${label}: k in the table`, demand: r.kR, capacity: kr?.max ?? 0, unit: "ft", ok: !!kr && r.kR >= kr.min && r.kR <= kr.max, ref: "M-601-20 Sheet 2", note: kr ? `k = ${fmtFt(w.k)}, rounds to ${r.kR} ft (table for m = ${r.mR}: ${kr.min}–${kr.max} ft)` : "No row for this m" });
    checks.push({ id: `${id}-L`, name: `${label}: length`, demand: w.L, capacity: 3.5 * w.m, unit: "ft", ok: r.col >= 0, ref: "M-601-20 Sheet 2 (L ≤ 3.5 m)", note: r.cell ? `L/m = ${r.ratio.toFixed(3)}, column ${r.colLabel}: c-bars #${r.cell.cBars.bar} @ ${r.cell.cBars.spacing}", ${r.cell.lbPerLf.toFixed(2)} lb/LF` : undefined });
  }
  return checks;
}

const fmtFt = (x: number) => `${+x.toFixed(3)} ft`;

/** A culvert's wingwalls as the plans usually tabulate them, defaulting m to the rise + 1'-4" (Sheet 1). */
export function defaultWingwall(name: string, rise: number): CulvertWingwall {
  const m = Math.round((rise + 4 / 3) * 1000) / 1000;
  return { name, m, k: Math.min(m, 4), L: Math.round(2 * m * 10) / 10, theta: 45, toeWall: true };
}

/** Saved wingwalls, cleaned up. */
export function cleanWingwalls(v: unknown): CulvertWingwall[] {
  if (!Array.isArray(v)) return [];
  const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  return v.slice(0, 8).filter((x) => x && typeof x === "object").map((x, i) => {
    const o = x as Record<string, unknown>;
    return { name: typeof o.name === "string" ? o.name.slice(0, 20) : `W${i + 1}`, m: n(o.m, 11.333), k: n(o.k, 4), L: n(o.L, 20), theta: n(o.theta, 45), toeWall: o.toeWall !== false, end: o.end === "outlet" ? "outlet" : o.end === "inlet" ? "inlet" : i < 2 ? "inlet" : "outlet" };
  });
}
