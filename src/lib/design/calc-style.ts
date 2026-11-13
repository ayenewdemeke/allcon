// How a design's calc package is colored: checks' verdicts in green or red (Calcs colors OK and NG
// on its own). The values entered are marked with INPUT_COLOR: black as Mathcad shows them, blue
// when the worksheet's "Inputs in Blue" is on (lib/calcs/look.ts).

/** Marks a value entered (drawn black, or blue on request); not a color shown as itself. */
export const INPUT_COLOR = "#1d4ed9";

/** The most decimals any design output shows (a rule for every calc package and editor). */
export const MAX_DECIMALS = 3;

/**
 * A number written into a calc package: at most MAX_DECIMALS decimals (fewer if asked), trailing zeros
 * dropped. Below 0.1 it's written in powers of ten (4.86·10⁻⁴), so small values keep their digits
 * within the same three decimals, as Mathcad shows them.
 */
export const num = (v: number, d = MAX_DECIMALS) => {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && a < 0.1 && d >= MAX_DECIMALS) {
    let e = Math.floor(Math.log10(a));
    let m = +(v / 10 ** e).toFixed(MAX_DECIMALS);
    if (Math.abs(m) >= 10) {
      m = +(m / 10).toFixed(MAX_DECIMALS);
      e += 1;
    }
    return `${m}\\cdot10^{${e}}`;
  }
  const s = String(+v.toFixed(Math.min(d, MAX_DECIMALS)));
  return s === "-0" ? "0" : s;
};

const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

/**
 * A number shown in a design's editor or report text: at most MAX_DECIMALS decimals (fewer if asked);
 * below 0.1, in powers of ten (1.2×10⁻³), so small values keep their digits.
 */
export function showNum(v: number, d = MAX_DECIMALS): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a !== 0 && a < 0.1 && d >= MAX_DECIMALS) {
    let e = Math.floor(Math.log10(a));
    let m = +(v / 10 ** e).toFixed(MAX_DECIMALS);
    if (Math.abs(m) >= 10) {
      m = +(m / 10).toFixed(MAX_DECIMALS);
      e += 1;
    }
    return `${m}×10${String(e).replace(/./g, (c) => SUP[c] ?? c)}`;
  }
  const s = String(+v.toFixed(Math.min(d, MAX_DECIMALS)));
  return s === "-0" ? "0" : s;
}

/**
 * How closely a calc package, worked from values written to MAX_DECIMALS decimals, agrees with the
 * design engine (which carries every digit): the tests' tolerance, relative.
 */
export const WORKSHEET_TOLERANCE = 5e-3;

/** A number in a calc table's cell: a plain number (tables take no powers of ten), at most MAX_DECIMALS decimals. */
export const cell = (v: number, d = MAX_DECIMALS) => {
  const s = String(+v.toFixed(Math.min(d, MAX_DECIMALS)));
  return s === "-0" ? "0" : s;
};
export const COLOR_NOTE = "Checks show OK in green and NG in red.";

/** A value entered: a definition that's just a number, with its unit, not worked out. */
export function isInput(latex: string) {
  const body = latex.split("\\coloneq")[1];
  if (body === undefined || !/^\s*-?\d/.test(body)) return false;
  return body.replace(/\\mathrm\{[^}]*\}|\\frac|\\cdot|\\,|[{}^\s\d.-]/g, "") === "";
}
