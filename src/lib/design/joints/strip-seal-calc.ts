import type { Line } from "@/lib/calcs/library/templates";
import { COLOR_NOTE, INPUT_COLOR, isInput } from "../calc-style";
import type { Figure } from "../figures";
import { designStripSeal, type StripSealInputs } from "./strip-seal";

// A strip seal joint as a Calcs worksheet: the movements and the setting at the planned
// installation temperature as live math, and the table of settings.

const num = (v: number, d = 6) => String(+v.toFixed(d));
const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;
const STATUS: Record<string, string> = { ok: "", wait: " (under the installation opening: wait for the structure to cool)", "too small": " (the seal can't take the movements from here)", outside: " (outside the design temperatures)" };

export function stripSealCalcLines(i: StripSealInputs, title: string, figures?: { section?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note") => lines.push({ text: t, ...(style ? { style } : {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const r = designStripSeal(i);

  text(title.toUpperCase(), "heading");
  text("A strip seal expansion joint's movements and setting, AASHTO LRFD: temperature (with γTU), creep and shrinkage, normal to the skewed joint, and the gap to set at installation.");
  text(COLOR_NOTE, "note");

  text("Movements (AASHTO 3.12.2, 14.5.3.2)", "subheading");
  m(`L\\coloneq ${num(i.L)}\\mathrm{ft}`, "Expansion length");
  m(`\\theta\\coloneq ${num(i.skew)}\\mathrm{deg}`, "Skew");
  m(`\\alpha_T\\coloneq ${num(i.alpha * 1e6)}\\cdot10^{-6}`, "Per °F, AASHTO 5.4.2.2 / 6.4.1");
  m(`\\varepsilon_{cs}\\coloneq ${num(i.creepShrink)}`, "Creep and shrinkage still to come, AASHTO 5.4.2.3");
  m(`T_{max}\\coloneq ${num(i.Tmax)}`, "°F, AASHTO 3.12.2");
  m(`T_{min}\\coloneq ${num(i.Tmin)}`, "°F");
  m(`\\gamma_{TU}\\coloneq ${num(i.gammaTU)}`, "AASHTO T. 3.4.1-1");
  m("\\Delta_{tot}\\coloneq L\\cdot\\left(\\gamma_{TU}\\cdot\\left(T_{max}-T_{min}\\right)\\cdot\\alpha_T+\\varepsilon_{cs}\\right)\\cdot\\cos\\left(\\theta\\right)=", "Normal to the joint", "in");
  m(`A_C\\coloneq ${num(i.maxOpening)}\\mathrm{in}`, "The seal's largest opening");
  m(`A_H\\coloneq ${num(i.minOpening)}\\mathrm{in}`, "Its smallest");
  m(ok("\\Delta_{tot}", "A_C-A_H"), "Within the seal's range");
  if (figures?.section) lines.push({ region: figures.section });

  text(`Setting at ${num(i.Ti)}°F`, "subheading");
  m(`T_i\\coloneq ${num(i.Ti)}`, "°F, installation temperature");
  m("\\Delta_c\\coloneq L\\cdot\\left(\\gamma_{TU}\\cdot\\left(T_i-T_{min}\\right)\\cdot\\alpha_T+\\varepsilon_{cs}\\right)\\cdot\\cos\\left(\\theta\\right)=", "Opening as it cools and shrinks", "in");
  m("\\Delta_h\\coloneq L\\cdot\\left(\\gamma_{TU}\\cdot\\left(T_{max}-T_i\\right)\\cdot\\alpha_T-\\varepsilon_{cs}\\right)\\cdot\\cos\\left(\\theta\\right)=", "Closing as it warms", "in");
  m("A_{max}\\coloneq A_C-\\Delta_c=", undefined, "in");
  m("A_{min}\\coloneq A_H+\\Delta_h=", undefined, "in");
  m(ok("A_{min}", "A_{max}"), "The openings fit");
  m("A\\coloneq\\frac{A_{max}+A_{min}}{2}=", "Gap to set", "in");
  m(`A_i\\coloneq ${num(i.installMin)}\\mathrm{in}`, "Least opening to place the gland");
  m(ok("A_i", "A"), "Enough to place the gland");
  m(`W\\coloneq A+2\\cdot ${num(i.rail)}\\mathrm{in}=`, "Overall width, with the rails", "in");

  text("Settings by installation temperature", "subheading");
  for (const row of r.table) text(`${num(row.Ti)}°F: A = ${row.status === "too small" ? "—" : `${num(row.A, 3)} in, W = ${num(row.W, 3)} in`}${STATUS[row.status]}`);
  return lines;
}
