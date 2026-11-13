import { INPUT_COLOR, isInput } from "../design/calc-style";
import type { Grid, Paper } from "./types";

// How a worksheet looks, as Mathcad Prime shows one: a light-blue grid with darker major lines,
// math at 11 pt, units in bold dark blue, and checks' verdicts (OK, NG) bold in green or red. The
// same on screen and in the PDF. The stored LaTeX is never changed: units are styled as drawn.

/** Gridlines: the minor ones, and the major ones every inch (every 25 mm on A4). */
export const GRID_MINOR = "#d3e5f5";
export const GRID_MAJOR = "#a9c9e8";
/** Minor squares between major lines: 5 Standard (0.2 in, 5 mm), 10 Fine. */
export const majorEvery = (_paper: Paper, grid: Grid) => (grid.size === "fine" ? 10 : 5);
/** Major gridlines show unless turned off (worksheets made before there was a choice show them). */
export const showMajor = (grid: Grid) => grid.major !== false;

/** Math's size: Mathcad Prime's 11 pt, in CSS pixels. */
export const MATH_SIZE = (11 * 4) / 3;

/** Units' color: Mathcad's dark blue. */
export const UNIT_COLOR = "#1a2a8c";

/** Values entered (a definition that's just a number and unit) in blue, when the worksheet asks. */
export const INPUT_BLUE = "#1d4ed8";

/**
 * Math as it's drawn: each unit (\mathrm{ksi}, with its power) bold, italic and dark blue, as
 * Mathcad shows units. Upright names in a subscript aren't units and are left alone.
 */
export function styleUnits(latex: string): string {
  return latex.replace(/(_\{?)?\\mathrm\{([^{}]*)\}(\^(?:\{[^{}]*\}|\d))?/g, (all, sub: string | undefined, name: string, power = "") => {
    if (sub || name === "NaN" || name === "d" || !name.trim()) return all;
    return `\\textcolor{${UNIT_COLOR}}{\\mathbfit{${name}}${power}}`;
  });
}

/**
 * A math region's color: its own, except values entered, which are black as in Mathcad, or blue
 * when the worksheet's "Inputs in Blue" is on.
 */
export function mathColor(r: { color?: string; latex: string }, grid: Grid | undefined): string | undefined {
  const blue = !!grid?.inputsBlue;
  // Packages made before the option marked their values entered in this blue itself.
  if (r.color === INPUT_COLOR || (r.color === INPUT_BLUE && isInput(r.latex))) return blue ? INPUT_BLUE : undefined;
  return r.color ?? (blue && isInput(r.latex) ? INPUT_BLUE : undefined);
}

/** A check's verdict (\text{OK}) in bold. */
export const boldVerdict = (result: string) => result.replace(/^\\text\{(.*)\}$/, "\\textbf{$1}");
