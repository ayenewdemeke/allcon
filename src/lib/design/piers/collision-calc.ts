import type { Line } from "@/lib/calcs/library/templates";
import { COLOR_NOTE, INPUT_COLOR, isInput } from "../calc-style";
import type { Figure } from "../figures";
import { BARS } from "../walls/cip";
import { designCollision, type CollisionInputs } from "./collision";

// A pier column for vehicle collision as a Calcs worksheet: the forces and the shear design as live
// math, and the column's moment resistance at each axial load from the strain compatibility
// analysis as given values.

const num = (v: number, d = 6) => String(+v.toFixed(d));
const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;

export function collisionCalcLines(i: CollisionInputs, title: string, figures?: { section?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note") => lines.push({ text: t, ...(style ? { style } : {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const given = (math: string, ref?: string) => lines.push({ math, ...(ref ? { ref } : {}) });
  const r = designCollision(i);
  const bar = BARS[i.bar];
  const tie = BARS[i.tieBar];

  text(title.toUpperCase(), "heading");
  text("A round pier column for vehicle collision, AASHTO LRFD 3.6.5.1, in Extreme Event II: the equivalent static force on one column, its shear and moments, and the column's resistance.");
  text(COLOR_NOTE, "note");

  text("Collision force and the column's forces", "subheading");
  m(`CT\\coloneq ${num(i.CT)}\\mathrm{kip}`, "Equivalent static force, AASHTO 3.6.5.1");
  m(`h_{CT}\\coloneq ${num(i.impact)}\\mathrm{ft}`, "Above the ground");
  m(`H_c\\coloneq ${num(i.height)}\\mathrm{ft}`, "Column, top of the shaft to the cap");
  m(`d_{cap}\\coloneq ${num(i.capDepth)}\\mathrm{ft}`, "Cap depth");
  m(`h_s\\coloneq ${num(i.shaftCover)}\\mathrm{ft}`, "Ground above the top of the shaft");
  m(`z_f\\coloneq ${num(i.fixity)}\\mathrm{ft}`, "Top of the shaft to its point of fixity");
  m("L\\coloneq z_f+H_c+\\frac{d_{cap}}{2}=", "Fixity to the cap's mid-depth", "ft");
  m("a\\coloneq z_f+h_s+h_{CT}=", "Impact above the fixity", "ft");
  m("b\\coloneq L-a=", undefined, "ft");
  if (figures?.section) lines.push({ region: figures.section });
  if (i.useFrame) {
    m(`V_u\\coloneq ${num(i.Vu)}\\mathrm{kip}`, "From the frame analysis");
    m(`M_u\\coloneq ${num(i.Mu)}\\mathrm{kip}\\cdot\\mathrm{ft}`, "From the frame analysis");
  } else {
    text(`In the bent's plane: the column and its ${num(i.shaftD)} in shaft as one member, fixed at the shaft's point of fixity, its top fixed against rotation at the cap and swaying against the bent's other ${Math.max(1, Math.round(i.columns)) - 1} columns, alike (stiffness method). Out of the bent's plane, and second-order effects, call for a frame analysis.`, "note");
    given(`V_{bot}\\coloneq ${num(r.fixed.Vbottom, 8)}\\mathrm{kip}`, "Below the impact");
    given(`V_{top}\\coloneq ${num(r.fixed.Vtop, 8)}\\mathrm{kip}`, "Above it");
    given(`M_{col}\\coloneq ${num(Math.abs(r.fixed.M(i.fixity)), 8)}\\mathrm{kip}\\cdot\\mathrm{ft}`, "At the column's base (top of the shaft)");
    given(`M_{CT}\\coloneq ${num(r.fixed.Mimpact, 8)}\\mathrm{kip}\\cdot\\mathrm{ft}`, "At the impact");
    given(`M_{cap}\\coloneq ${num(Math.abs(r.fixed.M(r.L - i.capDepth / 2)), 8)}\\mathrm{kip}\\cdot\\mathrm{ft}`, "At the cap's soffit");
    given(`M_{fix}\\coloneq ${num(r.fixed.Mbottom, 8)}\\mathrm{kip}\\cdot\\mathrm{ft}`, "At the shaft's point of fixity (for the shaft's design)");
    m("V_u\\coloneq\\max\\left(V_{bot},V_{top}\\right)=", "Extreme Event II, γCT = 1.0", "kip");
    m("M_u\\coloneq\\max\\left(M_{col},M_{CT},M_{cap}\\right)=", "Over the column", "kip*ft");
  }

  text("Shear (AASHTO 5.7.3.3, simplified: β = 2, θ = 45°)", "subheading");
  m(`D\\coloneq ${num(i.D)}\\mathrm{in}`, "Diameter");
  m(`f'_{c}\\coloneq ${num(i.fc)}\\mathrm{ksi}`);
  m(`f_y\\coloneq ${num(i.fy)}\\mathrm{ksi}`);
  m(`D_r\\coloneq D-2\\cdot ${num(i.cover)}\\mathrm{in}-2\\cdot ${num(tie.dia)}\\mathrm{in}-${num(bar.dia)}\\mathrm{in}=`, `Circle through the #${i.bar} bars' centers`, "in");
  m("d_e\\coloneq\\frac{D}{2}+\\frac{D_r}{\\pi}=", "AASHTO Eq. C5.7.2.8-2", "in");
  m("d_v\\coloneq\\max\\left(0.9\\cdot d_e,0.72\\cdot D\\right)=", "AASHTO 5.7.2.8", "in");
  m(`s\\coloneq ${num(i.tieSpacing)}\\mathrm{in}`, `#${i.tieBar} ties`);
  m(`A_v\\coloneq ${num(i.tieLegs)}\\cdot ${num(tie.area)}\\mathrm{in}^{2}=`, `${num(i.tieLegs)} legs in each spacing`, "in^2");
  m("V_c\\coloneq0.0316\\cdot2\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot D\\cdot d_v=", "AASHTO Eq. 5.7.3.3-3, bv = D", "kip");
  m("V_s\\coloneq\\frac{A_v\\cdot f_y\\cdot d_v}{s}=", "AASHTO Eq. 5.7.3.3-4", "kip");
  m("V_n\\coloneq\\min\\left(V_c+V_s,0.25\\cdot f'_{c}\\cdot D\\cdot d_v\\right)=", "AASHTO Eqs. 5.7.3.3-1, -2", "kip");
  m(`\\phi_v\\coloneq ${num(i.phiV)}`, "Extreme event");
  m(ok("V_u", "\\phi_v\\cdot V_n"), "Shear");
  m(ok("0.0316\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot\\frac{D\\cdot s}{f_y}", "A_v"), "Minimum transverse reinforcement, AASHTO Eq. 5.7.2.5-1");
  m("v_u\\coloneq\\frac{V_u}{\\phi_v\\cdot D\\cdot d_v}=", "AASHTO Eq. 5.7.2.8-1", "ksi");
  m(r.shear.vu < 0.125 * i.fc ? "s_{max}\\coloneq\\min\\left(0.8\\cdot d_v,24\\mathrm{in}\\right)=" : "s_{max}\\coloneq\\min\\left(0.4\\cdot d_v,12\\mathrm{in}\\right)=", r.shear.vu < 0.125 * i.fc ? "vu < 0.125 f'c, AASHTO Eq. 5.7.2.6-1" : "vu ≥ 0.125 f'c, AASHTO Eq. 5.7.2.6-2", "in");
  m(ok("s", "s_{max}"), "Tie spacing");

  text("Axial load and bending (AASHTO 5.6.2, 5.6.4)", "subheading");
  text(`By strain compatibility (εcu = 0.003, rectangular stress block, β1 = ${num(r.section.beta1, 3)}), ${i.bars} #${i.bar} bars on a ${num(r.shear.Dr, 3)} in circle. The moment resistance at each axial load:`, "note");
  m(`P_{DC}\\coloneq ${num(i.PDC)}\\mathrm{kip}`, "Axial dead load on the column");
  m(`\\phi_m\\coloneq ${num(i.phiM)}`, "Extreme event");
  for (const c of r.cases) {
    const k = c.gamma === 0.9 ? "1" : "2";
    m(`P_{u${k}}\\coloneq ${c.gamma}\\cdot P_{DC}=`, `DC × ${c.gamma}, AASHTO T. 3.4.1-2`, "kip");
    given(`M_{n${k}}\\coloneq ${num(c.Mn, 8)}\\mathrm{kip}\\cdot\\mathrm{ft}`, "Nominal moment resistance at that axial load");
    m(ok("M_u", `\\phi_m\\cdot M_{n${k}}`));
  }
  given(`P_0\\coloneq ${num(r.section.P0, 8)}\\mathrm{kip}`, "AASHTO Eq. 5.6.4.4-3");
  m(ok("P_{u2}", "0.85\\cdot\\phi_m\\cdot P_0"), "AASHTO 5.6.4.4");
  text("Second-order effects (4.5.3.2.2) and the shaft below the column are designed separately for these forces.", "note");
  return lines;
}
