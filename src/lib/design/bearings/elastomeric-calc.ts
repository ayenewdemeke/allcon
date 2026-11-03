import type { Line } from "@/lib/calcs/library/templates";
import { COLOR_NOTE, INPUT_COLOR, isInput } from "../calc-style";
import type { Figure } from "../figures";
import { designBearing, HARDNESS, type BearingInputs } from "./elastomeric";

// An elastomeric bearing design as a Calcs worksheet: inputs as definitions and every step as live
// math with its AASHTO reference, worked out by Calcs independently of the design engine.

const num = (v: number) => String(+v.toFixed(6));
const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;

export function bearingCalcLines(i: BearingInputs, title: string, figures?: { section?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note") => lines.push({ text: t, ...(style ? { style } : {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });

  const r = designBearing(i);
  const steel = i.pad === "steel";
  const A = r.method === "A";
  const byHardness = A && i.byHardness;

  text(title.toUpperCase(), "heading");
  text(`${steel ? "Steel-reinforced" : "Plain"} elastomeric bearing pad, Method ${r.method} (AASHTO LRFD ${A ? "14.7.6" : "14.7.5"}), per bearing at the service limit state. Rectangular, without holes.`);
  text(COLOR_NOTE, "note");

  // --- the pad ---------------------------------------------------------------------------------
  text("Pad", "subheading");
  m(`L\\coloneq ${num(i.L)}\\mathrm{in}`, "Along the bridge");
  m(`W\\coloneq ${num(i.W)}\\mathrm{in}`, "Across the bridge");
  m(`h_{ri}\\coloneq ${num(i.hri)}\\mathrm{in}`, steel ? "Interior layer" : "Pad thickness");
  if (steel) {
    m(`n\\coloneq ${num(i.n)}`, "Interior layers");
    m(`h_{re}\\coloneq ${num(i.hre)}\\mathrm{in}`, "Cover layer (top and bottom)");
    m(`h_s\\coloneq ${num(i.hs)}\\mathrm{in}`, "Steel shim");
    m("h_{rt}\\coloneq n\\cdot h_{ri}+2\\cdot h_{re}=", "Total elastomer", "in");
    m("h_t\\coloneq h_{rt}+\\left(n+1\\right)\\cdot h_s=", "Total height", "in");
  } else {
    m("n\\coloneq1");
    m("h_{rt}\\coloneq h_{ri}=", "Total elastomer", "in");
    m("h_t\\coloneq h_{rt}=", "Total height", "in");
  }
  m("A_b\\coloneq L\\cdot W=", "Plan area", "in^2");
  m("S\\coloneq\\frac{L\\cdot W}{2\\cdot h_{ri}\\cdot\\left(L+W\\right)}=", "Shape factor, AASHTO Eq. 14.7.5.1-1");
  if (figures?.section) lines.push({ region: figures.section });

  // --- materials ----------------------------------------------------------------------------------
  text("Elastomer and steel", "subheading");
  if (byHardness) {
    const h = HARDNESS[i.hardness];
    text(`Specified by hardness (${i.hardness} durometer): the least favorable shear modulus in AASHTO Table 14.7.6.2-1's range is used in each check.`, "note");
    m(`G_{min}\\coloneq ${num(h.Gmin)}\\mathrm{ksi}`, "AASHTO T. 14.7.6.2-1");
    m(`G_{max}\\coloneq ${num(h.Gmax)}\\mathrm{ksi}`);
    m(`a_{cr}\\coloneq ${num(h.creep)}`, "Creep deflection factor, T. 14.7.6.2-1");
  } else {
    text("Specified by shear modulus: the least favorable value within ±15% is used in each check.", "note");
    m(`G\\coloneq ${num(i.G)}\\mathrm{ksi}`, "Shear modulus at 73°F");
    m("G_{min}\\coloneq0.85\\cdot G=", A ? "AASHTO 14.7.6.2" : "AASHTO 14.7.5.2", "ksi");
    m("G_{max}\\coloneq1.15\\cdot G=", undefined, "ksi");
    m(`a_{cr}\\coloneq ${num(i.creep)}`, "Creep deflection factor, T. 14.7.6.2-1");
  }
  const gLimit = A ? "0.25" : "0.175";
  m(`\\operatorname{if}\\left(0.08\\mathrm{ksi}\\le G_{min},\\operatorname{if}\\left(G_{max}\\le ${gLimit}\\mathrm{ksi},\\text{OK},\\text{NG}\\right),\\text{NG}\\right)=`, `Shear modulus within 0.080–${gLimit} ksi, ${A ? "AASHTO 14.7.6.2" : "AASHTO 14.7.5.2"}`);
  if (steel) {
    m(`F_y\\coloneq ${num(i.Fy)}\\mathrm{ksi}`, "Shims");
    m(`F_{TH}\\coloneq ${num(i.dFth)}\\mathrm{ksi}`, "Fatigue threshold, T. 6.6.1.2.3-1");
    m(ok("h_{re}", "0.7\\cdot h_{ri}"), `Cover layers, ${A ? "AASHTO 14.7.6.1" : "AASHTO 14.7.5.1"}`);
    if (A) m(ok("\\frac{S^{2}}{n}", "22"), "Method A applies, AASHTO 14.7.6.1");
  }

  // --- loads and movements ---------------------------------------------------------------------
  text("Loads and movements (Service I, per bearing)", "subheading");
  m(`DL\\coloneq ${num(i.DL)}\\mathrm{kip}`, "Dead load");
  m(`LL\\coloneq ${num(i.LL)}\\mathrm{kip}`, "Live load, without dynamic load allowance (14.4.1)");
  m("\\sigma_d\\coloneq\\frac{DL}{A_b}=", undefined, "ksi");
  m("\\sigma_L\\coloneq\\frac{LL}{A_b}=", undefined, "ksi");
  m("\\sigma_s\\coloneq\\sigma_d+\\sigma_L=", "Total", "ksi");
  m(`\\alpha_T\\coloneq ${num(i.alpha * 1e6)}\\cdot10^{-6}`, "Coefficient of thermal expansion, per °F");
  m(`L_{exp}\\coloneq ${num(i.expansionLength)}\\mathrm{ft}`, "Expansion length");
  m(`T_{max}\\coloneq ${num(i.Tmax)}`, "°F, AASHTO 3.12.2");
  m(`T_{min}\\coloneq ${num(i.Tmin)}`, "°F");
  m("\\Delta_T\\coloneq\\alpha_T\\cdot L_{exp}\\cdot\\left(T_{max}-T_{min}\\right)=", "AASHTO Eq. 3.12.2.3-1", "in");
  m(`\\gamma_{TU}\\coloneq ${num(i.gammaTU)}`, "Service I, AASHTO T. 3.4.1-1");
  m(`f_T\\coloneq ${num(i.thermalFactor)}`, "Part of the thermal range the pad takes");
  m(`\\Delta_o\\coloneq ${num(i.otherStatic)}\\mathrm{in}`, "Creep, shrinkage and other static movement");
  m(`\\Delta_{cy}\\coloneq ${num(i.cyclic)}\\mathrm{in}`, "Live load and other cyclic movement");
  m("\\Delta_{st}\\coloneq\\gamma_{TU}\\cdot f_T\\cdot\\Delta_T+\\Delta_o=", "Static shear deformation", "in");
  m("\\Delta_s\\coloneq\\Delta_{st}+\\Delta_{cy}=", "Total shear deformation", "in");

  // --- compressive stress (Method A) ---------------------------------------------------------------
  if (A) {
    text("Compressive stress (AASHTO 14.7.6.3.2)", "subheading");
    const boost = i.shearPrevented ? "1.1\\cdot" : "";
    if (i.shearPrevented) text("Shear deformation is prevented: the limits go up 10%.", "note");
    m(ok("\\sigma_s", `${boost}${steel ? "1.25" : "1.00"}\\cdot G_{min}\\cdot S`), steel ? "AASHTO Eq. 14.7.6.3.2-7" : "AASHTO Eq. 14.7.6.3.2-1");
    m(ok("\\sigma_s", `${boost}${steel ? "1.25" : "0.80"}\\mathrm{ksi}`), steel ? "AASHTO Eq. 14.7.6.3.2-8" : "AASHTO Eq. 14.7.6.3.2-2");
  }

  // --- deflections ----------------------------------------------------------------------------------
  text("Compressive deflection (AASHTO 14.7.5.3.6)", "subheading");
  m("\\varepsilon_L\\coloneq\\frac{\\sigma_L}{4.8\\cdot G_{min}\\cdot S^{2}}=", "Live load strain, AASHTO Eq. C14.7.5.3.6-1");
  m("\\varepsilon_d\\coloneq\\frac{\\sigma_d}{4.8\\cdot G_{min}\\cdot S^{2}}=", "Dead load strain");
  m("\\delta_L\\coloneq\\varepsilon_L\\cdot h_{rt}=", "Live load deflection, AASHTO Eq. 14.7.5.3.6-1", "in");
  if (i.jointed) m(ok("\\delta_L", "0.125\\mathrm{in}"), "With a deck joint");
  m("\\delta_d\\coloneq\\varepsilon_d\\cdot h_{rt}=", "Initial dead load deflection, AASHTO Eq. 14.7.5.3.6-2", "in");
  m("\\delta_{lt}\\coloneq\\delta_d\\cdot\\left(1+a_{cr}\\right)=", "Long-term dead load deflection, AASHTO Eq. 14.7.5.3.6-3", "in");
  if (A) {
    m("\\varepsilon_s\\coloneq\\frac{\\sigma_s}{4.8\\cdot G_{min}\\cdot S^{2}}=", "Total load strain");
    m(ok("\\varepsilon_s\\cdot h_{ri}", "0.09\\cdot h_{ri}"), "Deflection of a layer, AASHTO 14.7.6.3.3");
  }

  // --- shear deformation -----------------------------------------------------------------------------
  text(`Shear deformation (${A ? "AASHTO 14.7.6.3.4" : "AASHTO 14.7.5.3.2"})`, "subheading");
  m(ok("2\\cdot\\Delta_s", "h_{rt}"));

  // --- shear strains (Method B) -----------------------------------------------------------------------
  if (!A) {
    text("Combined compression, rotation and shear (AASHTO 14.7.5.3.3)", "subheading");
    text("Static loads, and cyclic ones (live load) weighted 1.75. The allowance for uncertainties adds to the dead load rotation (AASHTO 14.4.2.1).", "note");
    m(`\\theta_d\\coloneq ${num(i.thetaD)}`, "Dead load rotation, rad");
    m(`\\theta_u\\coloneq ${num(i.thetaU)}`, "Allowance for uncertainties, rad");
    m(`\\theta_L\\coloneq ${num(i.thetaL)}`, "Live load rotation, rad");
    m("\\theta_{st}\\coloneq\\left|\\theta_d\\right|+\\theta_u=", "Static rotation");
    m("\\theta_{cy}\\coloneq\\left|\\theta_L\\right|=", "Cyclic rotation");
    m("D_a\\coloneq1.4", "Rectangular, AASHTO Eq. 14.7.5.3.3-4");
    m("D_r\\coloneq0.5", "Rectangular, AASHTO Eq. 14.7.5.3.3-7");
    m("\\gamma_{ast}\\coloneq\\frac{D_a\\cdot\\sigma_d}{G_{min}\\cdot S}=", "AASHTO Eq. 14.7.5.3.3-3");
    m("\\gamma_{acy}\\coloneq\\frac{D_a\\cdot\\sigma_L}{G_{min}\\cdot S}=");
    m("\\gamma_{rst}\\coloneq\\frac{D_r\\cdot\\left(\\frac{L}{h_{ri}}\\right)^{2}\\cdot\\theta_{st}}{n}=", "AASHTO Eq. 14.7.5.3.3-6");
    m("\\gamma_{rcy}\\coloneq\\frac{D_r\\cdot\\left(\\frac{L}{h_{ri}}\\right)^{2}\\cdot\\theta_{cy}}{n}=");
    m("\\gamma_{sst}\\coloneq\\frac{\\Delta_{st}}{h_{rt}}=", "AASHTO Eq. 14.7.5.3.3-10");
    m("\\gamma_{scy}\\coloneq\\frac{\\Delta_{cy}}{h_{rt}}=");
    m(ok("\\gamma_{ast}", "3"), "AASHTO Eq. 14.7.5.3.3-1");
    m("\\gamma_{tot}\\coloneq\\gamma_{ast}+\\gamma_{rst}+\\gamma_{sst}+1.75\\cdot\\left(\\gamma_{acy}+\\gamma_{rcy}+\\gamma_{scy}\\right)=");
    m(ok("\\gamma_{tot}", "5"), "AASHTO Eq. 14.7.5.3.3-2");
  }

  // --- stability ----------------------------------------------------------------------------------
  if (A) {
    text("Stability (AASHTO 14.7.6.3.6)", "subheading");
    m(ok("h_t", "\\frac{\\min\\left(L,W\\right)}{3}"));
  } else {
    text("Stability (AASHTO 14.7.5.3.4)", "subheading");
    const worst = r.stability.reduce((a, b) => (b.limit < a.limit ? b : a));
    const swapped = worst.l !== i.L;
    if (r.stability.length > 1) text(`L is longer than W, so the pad is checked both ways round; ${swapped ? "with L and W interchanged" : "as it is"} governs.`, "note");
    const [l, w] = swapped ? ["W", "L"] : ["L", "W"];
    m(`A_s\\coloneq\\frac{1.92\\cdot\\frac{h_{rt}}{${l}}}{\\sqrt{1+\\frac{2\\cdot ${l}}{${w}}}}=`, "AASHTO Eq. 14.7.5.3.4-2");
    m(`B_s\\coloneq\\frac{2.67}{\\left(S+2\\right)\\cdot\\left(1+\\frac{${l}}{4\\cdot ${w}}\\right)}=`, "AASHTO Eq. 14.7.5.3.4-3");
    if (worst.limit === Infinity) m(ok("2\\cdot A_s", "B_s"), "Stable without further investigation, AASHTO Eq. 14.7.5.3.4-1");
    else if (i.deckFree) m(ok("\\sigma_s", "\\frac{G_{min}\\cdot S}{2\\cdot A_s-B_s}"), "Deck free to translate, AASHTO Eq. 14.7.5.3.4-4");
    else m(ok("\\sigma_s", "\\frac{G_{min}\\cdot S}{A_s-B_s}"), "Deck fixed, AASHTO Eq. 14.7.5.3.4-5");
  }

  // --- shims ----------------------------------------------------------------------------------------
  if (steel) {
    text("Steel shims (AASHTO 14.7.5.3.5)", "subheading");
    m(ok("\\frac{3\\cdot h_{ri}\\cdot\\sigma_s}{F_y}", "h_s"), "Service, AASHTO Eq. 14.7.5.3.5-1");
    m(ok("\\frac{2\\cdot h_{ri}\\cdot\\sigma_L}{F_{TH}}", "h_s"), "Fatigue, AASHTO Eq. 14.7.5.3.5-2");
  }

  // --- anchorage ----------------------------------------------------------------------------------------
  text("Anchorage", "subheading");
  if (!A) {
    m("\\theta_s\\coloneq\\theta_{st}+1.75\\cdot\\theta_{cy}=", "Design rotation");
    m("\\varepsilon_a\\coloneq\\varepsilon_d+1.75\\cdot\\varepsilon_L=", "Axial strain");
    m(ok("\\frac{\\theta_s}{n}", "\\frac{3\\cdot\\varepsilon_a}{S}"), "No restraint system needed (NG: provide one), AASHTO Eq. 14.7.5.4-1");
  }
  m(`\\mu\\coloneq ${num(i.mu)}`, "Friction coefficient, AASHTO C14.8.3.1");
  m("\\Delta_{allow}\\coloneq\\frac{\\mu\\cdot DL\\cdot h_{rt}}{G_{max}\\cdot A_b}=", "Shear force under friction on the dead load, AASHTO Eqs. 14.6.3.1-1, -2", "in");
  m(ok("\\Delta_s", "\\Delta_{allow}"), "The pad doesn't slip (NG: anchor it), AASHTO 14.8.3");
  return lines;
}
