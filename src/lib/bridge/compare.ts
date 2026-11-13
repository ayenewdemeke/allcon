import type { Model } from "./model";
import type { Analysis } from "./solver";

// Another program's beam forces beside this solver's, for the same model: a table pasted from
// midas Civil's Beam Force result table (or one laid out like it: element, load case, part I or J,
// then axial, shear y, shear z, torsion, moment y, moment z). Compared by magnitude: each
// program has its own sign convention for end forces.

export const FORCE_NAMES = ["Axial", "Shear y", "Shear z", "Torsion", "Moment y", "Moment z"] as const;
export type CompareRow = { element: number; load: string; part: "I" | "J"; theirs: number[]; ours: number[]; diff: number[] }; // diff: |ours| − |theirs|, in kip or kip·ft
export type Comparison = { rows: CompareRow[]; unmatched: number; worst: { name: string; diff: number; percent: number }[]; within: number }; // within: share of values within 2%

const FORCE: Record<string, number> = { N: 2.248089431e-4, KN: 0.2248089431, KGF: 2.204622622e-3, TONF: 2.204622622, LBF: 1e-3, KIPS: 1 };
const LENGTH: Record<string, number> = { MM: 3.280839895e-3, CM: 3.280839895e-2, M: 3.280839895, IN: 1 / 12, FT: 1 };
export const FORCE_UNITS = Object.keys(FORCE);
export const LENGTH_UNITS = Object.keys(LENGTH);

/** The rows of a pasted table: element, load, part, six numbers (tabs, commas or runs of spaces between). */
export function parseBeamForces(text: string): { element: number; load: string; part: "I" | "J"; values: number[] }[] {
  const out: { element: number; load: string; part: "I" | "J"; values: number[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = (line.includes("\t") ? line.split("\t") : line.includes(",") ? line.split(",") : line.trim().split(/\s{2,}/)).map((c) => c.trim());
    const e = cells.findIndex((c) => /^\d+$/.test(c));
    if (e < 0) continue;
    const p = cells.findIndex((c, k) => k > e && /^[IJ](\[\d+\])?$/i.test(c));
    if (p < 0) continue;
    const nums = cells.slice(p + 1).map((c) => Number(c.replace(/,/g, ""))).filter((v) => Number.isFinite(v));
    if (nums.length < 6) continue;
    const load = cells.slice(e + 1, p).filter(Boolean)[0] ?? "";
    out.push({ element: +cells[e], load, part: cells[p][0].toUpperCase() as "I" | "J", values: nums.slice(0, 6) });
  }
  return out;
}

export function compareBeamForces(model: Model, analysis: Analysis, text: string, units: { force: string; length: string }): Comparison {
  const F = FORCE[units.force] ?? 1;
  const L = LENGTH[units.length] ?? 1;
  const scale = [F, F, F, F * L, F * L, F * L];
  const caseIndex = new Map(model.loadCases.map((c, i) => [c.name.toLowerCase(), i]));
  const elIndex = new Map(model.elements.map((e, i) => [e.id, i]));
  const rows: CompareRow[] = [];
  let unmatched = 0;
  for (const r of parseBeamForces(text)) {
    const c = caseIndex.get(r.load.toLowerCase().replace(/\(.*\)$/, "").trim());
    const k = elIndex.get(r.element);
    if (c === undefined || k === undefined) {
      unmatched++;
      continue;
    }
    const f = analysis.forcesAt(c, k, r.part === "I" ? 0 : 1);
    const ours = [f.N, f.Vy, f.Vz, f.T, f.My, f.Mz];
    const theirs = r.values.map((v, j) => v * scale[j]);
    rows.push({ element: r.element, load: model.loadCases[c].name, part: r.part, theirs, ours, diff: ours.map((v, j) => Math.abs(v) - Math.abs(theirs[j])) });
  }
  // The largest difference in each force, as a share of that force's largest value in the table.
  let close = 0;
  let total = 0;
  const worst = FORCE_NAMES.map((name, j) => {
    const peak = Math.max(1e-9, ...rows.map((r) => Math.abs(r.theirs[j])), ...rows.map((r) => Math.abs(r.ours[j])));
    let diff = 0;
    for (const r of rows) {
      if (Math.abs(r.diff[j]) > Math.abs(diff)) diff = r.diff[j];
      total++;
      if (Math.abs(r.diff[j]) <= 0.02 * peak) close++;
    }
    return { name, diff, percent: (100 * Math.abs(diff)) / peak };
  });
  return { rows, unmatched, worst, within: total ? close / total : 0 };
}
