import type { Line } from "@/lib/calcs/library/templates";
import { checksSummary } from "../checks-summary";
import { COLOR_NOTE, INPUT_COLOR, isInput, num } from "../calc-style";
import type { Figure } from "../figures";
import { designHaunch, type HaunchInputs } from "./haunch";

// Camber and haunch as a Calcs worksheet: the profile grade's elevations as given values, then
// every step as live math.

const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;

export function haunchCalcLines(i: HaunchInputs, title: string, figures?: { section?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note") => lines.push({ text: t, ...(style ? { style } : {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const given = (math: string, ref?: string) => lines.push({ math, ...(ref ? { ref } : {}) });
  const r = designHaunch(i);

  text(title.toUpperCase(), "heading");
  text("Camber and haunch for a girder span: the haunch at the supports and midspan from the deck's profile over the girder and the girder's camber and dead load deflection, with tolerances on the camber. Positive camber and deflection are upward.");
  text(COLOR_NOTE, "note");

  text("The deck's profile over the girder", "subheading");
  m(`L\\coloneq ${num(i.L)}\\mathrm{ft}`, "Span");
  given(`E_1\\coloneq ${num(r.e1, 8)}\\mathrm{ft}`, `Profile grade at the first bearing, station ${num(i.startStation)}`);
  given(`E_2\\coloneq ${num(r.e2, 8)}\\mathrm{ft}`, "At midspan");
  given(`E_3\\coloneq ${num(r.e3, 8)}\\mathrm{ft}`, "At the second bearing");
  if (figures?.section) lines.push({ region: figures.section });
  m("\\delta_V\\coloneq E_2-\\frac{E_1+E_3}{2}=", "The vertical curve's rise over the chord", "in");
  if (i.radius > 0) {
    m(`R\\coloneq ${num(i.radius)}\\mathrm{ft}`, "Radius at the girder");
    m(`c_s\\coloneq ${num(i.crossSlope)}`, "Cross-slope");
    m("M_o\\coloneq R\\cdot\\left(1-\\cos\\left(\\frac{L}{2\\cdot R}\\right)\\right)=", "Middle ordinate of the chorded girder", "ft");
    m(`\\delta_H\\coloneq ${i.slopeTowardCenter ? "-" : ""}M_o\\cdot c_s=`, i.slopeTowardCenter ? "The deck slopes down toward the center: lower over the girder" : "The deck slopes up toward the center: higher over the girder", "in");
  } else m("\\delta_H\\coloneq0\\mathrm{in}", "Tangent");
  m("\\delta_{PE}\\coloneq\\delta_V+\\delta_H=", "The profile's effect at midspan", "in");
  m(`b_{tf}\\coloneq ${num(i.flange)}\\mathrm{in}`, "Top flange");
  m(i.slopedGirders ? "\\delta_{CS}\\coloneq0\\mathrm{in}" : `\\delta_{CS}\\coloneq\\frac{b_{tf}\\cdot ${num(i.crossSlope)}}{2}=`, i.slopedGirders ? "Girders sloped to match the cross-slope" : "Cross-slope across half the flange", "in");

  text("Haunch", "subheading");
  m(`D_1\\coloneq ${num(i.D1)}\\mathrm{in}`, "At the supports, girder centerline");
  m(`C_{dp}\\coloneq ${num(i.camber)}\\mathrm{in}`, "Predicted camber at deck placement");
  m(`\\Delta_{DL}\\coloneq ${num(i.deflection)}\\mathrm{in}`, "Dead load deflection");
  m(`D_{s}\\coloneq ${num(i.minSupport)}\\mathrm{in}`, "Owner's minimum at the supports");
  m(`D_{m}\\coloneq ${num(i.minMidspan)}\\mathrm{in}`, "Owner's minimum at midspan");
  m(ok("D_{s}", "D_1-\\delta_{CS}"), "At the supports, flange edge");
  m("D_2\\coloneq D_1-\\Delta_{DL}-C_{dp}+\\delta_{PE}=", "At midspan, girder centerline", "in");
  m(ok("D_{m}", "D_2-\\delta_{CS}"), "At midspan, as predicted");
  m("D_{avg}\\coloneq\\frac{D_1}{3}+\\frac{2\\cdot D_2}{3}=", "Average of a parabolic haunch", "in");
  m(`D_{as}\\coloneq ${num(i.assumedAverage)}\\mathrm{in}`, "Assumed for the dead load");
  m(ok("D_{avg}", "1.02\\cdot D_{as}"), "The assumption covers it");

  text("Camber tolerances", "subheading");
  m(`\\delta_{ov}\\coloneq\\max\\left(${num(i.overPct / 100)}\\cdot C_{dp},${num(i.overMin)}\\mathrm{in}\\right)=`, "Over-camber", "in");
  if (i.shims) m("h_{sh}\\coloneq\\delta_{ov}=", "Shims at the bearings take it", "in");
  else m(ok("D_{m}", "D_2-\\delta_{ov}-\\delta_{CS}"), "Over-cambered: at midspan, flange edge");
  m(`\\delta_{un}\\coloneq-\\max\\left(${num(i.underPct / 100)}\\cdot C_{dp},${num(i.underMin)}\\mathrm{in}\\right)=`, "Under-camber", "in");
  m("D_{2u}\\coloneq D_2-\\delta_{un}=", "Under-cambered: the most haunch at midspan", "in");
  m("D_{avgu}\\coloneq\\frac{D_1}{3}+\\frac{2\\cdot D_{2u}}{3}=", "Its average, for the girder's dead load", "in");
  m(`\\Delta_{DLu}\\coloneq ${num(i.deflectionUnder)}\\mathrm{in}`, "Dead load deflection with that haunch (from the girder's design)");
  m(ok("0\\mathrm{in}", "C_{dp}+\\delta_{un}+\\Delta_{DLu}"), "The girder keeps a positive camber");
  lines.push(...checksSummary([{ checks: r.checks }]));
  return lines;
}
