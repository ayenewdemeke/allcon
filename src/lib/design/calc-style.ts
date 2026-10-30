// How a design's calc package is colored: the values entered in blue (the usual convention for
// inputs), and checks' verdicts in green or red (Calcs colors OK and NG on its own).

export const INPUT_COLOR = "#1d4ed8";
export const COLOR_NOTE = "Values entered are in blue; checks show OK in green and NG in red.";

/** A value entered: a definition that's just a number, with its unit, not worked out. */
export function isInput(latex: string) {
  const body = latex.split("\\coloneq")[1];
  if (body === undefined || !/^\s*-?\d/.test(body)) return false;
  return body.replace(/\\mathrm\{[^}]*\}|\\frac|\\cdot|\\,|[{}^\s\d.-]/g, "") === "";
}
