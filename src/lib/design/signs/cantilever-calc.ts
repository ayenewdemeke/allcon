import type { Line } from "@/lib/calcs/library/templates";
import { COLOR_NOTE, INPUT_COLOR, isInput } from "../calc-style";
import type { Figure } from "../figures";
import { BARS } from "../walls/cip";
import { designSign, type SignInputs } from "./cantilever";

// A cantilever sign's shaft foundation as a Calcs worksheet: the wind and the shaft's checks as live
// math, the members' weights and areas, and the shaft's moment resistance (strain compatibility),
// as given values.

const num = (v: number, d = 6) => String(+v.toFixed(d));
const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;

export function signCalcLines(i: SignInputs, title: string, figures?: { section?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note") => lines.push({ text: t, ...(style ? { style } : {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const given = (math: string, ref?: string) => lines.push({ math, ...(ref ? { ref } : {}) });
  const r = designSign(i);
  const bar = BARS[i.bar];
  const tie = BARS[i.tieBar];

  text(title.toUpperCase(), "heading");
  text("A cantilever sign structure's drilled shaft foundation: loads by the AASHTO LRFD Specifications for Structural Supports for Highway Signs, Luminaires, and Traffic Signals (LTS), the shaft by AASHTO LRFD.");
  text(COLOR_NOTE, "note");

  text("Dead loads (LTS 3.5)", "subheading");
  given(`DC_p\\coloneq ${num(r.dead.pole, 8)}\\mathrm{kip}`, `Pole, ${num(i.poleLength)} ft, ${num(i.poleBase)} to ${num(i.poleTop)} in, ${num(i.poleWall)} in wall (steel)`);
  given(`DC_a\\coloneq ${num(r.dead.arm, 8)}\\mathrm{kip}`, `Arm, ${num(i.armLength)} ft, ${num(i.armBase)} to ${num(i.armEnd)} in`);
  given(`x_a\\coloneq ${num(r.dead.armCentroid, 8)}\\mathrm{ft}`, "Its centroid from the pole");
  m(`A_s\\coloneq ${num(i.signLength)}\\mathrm{ft}\\cdot ${num(i.signHeight)}\\mathrm{ft}=`, "Sign panel", "ft^2");
  m(`DC_s\\coloneq A_s\\cdot ${num(i.signThickness)}\\mathrm{in}\\cdot0.175\\mathrm{kcf}=`, "Aluminum panel", "kip");
  m(`DC_m\\coloneq ${num(i.miscPct / 100)}\\cdot DC_s=`, "Its supports and anchors", "kip");
  m(`e_s\\coloneq ${num(i.signOffset)}\\mathrm{ft}`, "Pole to the panel's center");
  m("DC\\coloneq DC_p+DC_a+DC_s+DC_m=", undefined, "kip");
  m("M_{DC}\\coloneq DC_a\\cdot x_a+\\left(DC_s+DC_m\\right)\\cdot e_s=", "About the pole", "kip*ft");
  if (figures?.section) lines.push({ region: figures.section });

  text("Wind (LTS 3.8)", "subheading");
  m(`z\\coloneq ${num(r.wind.zArm)}`, "Height of the arm and sign, ft");
  m("K_z\\coloneq2.00\\cdot\\left(\\frac{\\max\\left(z,16\\right)}{900}\\right)^{\\frac{2}{9.5}}=", "LTS Eq. 3.8.4-1, exposure C");
  m(`V\\coloneq ${num(i.V)}`, "Basic wind speed, mph");
  m(`K_d\\coloneq ${num(i.Kd)}`, "LTS 3.8.5");
  m(`G\\coloneq ${num(i.G)}`, "LTS 3.8.6");
  given(`C_{dm}\\coloneq ${num(r.wind.CdMember)}`, `Round members, Cv V d = ${num(r.wind.CvVd, 2)} mph·ft, LTS T. 3.8.7-1`);
  m(`C_{ds}\\coloneq ${num(i.CdSign)}`, "Sign panel, LTS T. 3.8.7-1");
  m("p_m\\coloneq0.00256\\cdot K_z\\cdot K_d\\cdot G\\cdot V^{2}\\cdot C_{dm}\\cdot\\mathrm{psf}=", "Members, LTS Eq. 3.8.1-1", "psf");
  m("p_s\\coloneq0.00256\\cdot K_z\\cdot K_d\\cdot G\\cdot V^{2}\\cdot C_{ds}\\cdot\\mathrm{psf}=", "Sign panel", "psf");
  given(`A_p\\coloneq ${num(r.wind.poleArea, 8)}\\mathrm{ft}^{2}`, "Pole, projected");
  given(`A_a\\coloneq ${num(r.wind.armArea, 8)}\\mathrm{ft}^{2}`, "Arm, projected");
  given(`z_p\\coloneq ${num(r.wind.poleCentroid, 8)}\\mathrm{ft}`, "The pole area's centroid");
  given(`x_w\\coloneq ${num(r.wind.armCentroid, 8)}\\mathrm{ft}`, "The arm area's centroid from the pole");
  m("W_p\\coloneq p_m\\cdot A_p=", undefined, "kip");
  m("W_a\\coloneq p_m\\cdot A_a=", undefined, "kip");
  m("W_s\\coloneq p_s\\cdot A_s=", undefined, "kip");
  m("M_W\\coloneq\\left(W_s+W_a\\right)\\cdot z\\cdot\\mathrm{ft}+W_p\\cdot z_p=", "Overturning at the top of the shaft", "kip*ft");
  m("T_W\\coloneq W_s\\cdot e_s+W_a\\cdot x_w=", "Torsion", "kip*ft");
  m("H_W\\coloneq W_s+W_a+W_p=", "Shear", "kip");

  text("At the top of the shaft (LTS Table 3.4-1)", "subheading");
  text("Strength I: 1.25 DC. Extreme I: 1.1 DC (or 0.9 DC) and the wind. Moments combine as vectors.", "note");
  m("P_{max}\\coloneq1.25\\cdot DC=", undefined, "kip");
  m("P_{min}\\coloneq0.9\\cdot DC=", undefined, "kip");
  m("M_{top}\\coloneq\\sqrt{M_W^{2}+\\left(1.1\\cdot M_{DC}\\right)^{2}}=", "Extreme I", "kip*ft");

  text("Shaft (AASHTO LRFD)", "subheading");
  m(`D\\coloneq ${num(i.shaftD)}\\mathrm{in}`, "Diameter");
  m(`L_s\\coloneq ${num(i.shaftLength)}\\mathrm{ft}`, "Length");
  m(`f'_{c}\\coloneq ${num(i.fc)}\\mathrm{ksi}`);
  m(`f_y\\coloneq ${num(i.fy)}\\mathrm{ksi}`);
  m("W_{sh}\\coloneq\\frac{\\pi\\cdot D^{2}}{4}\\cdot L_s\\cdot0.15\\mathrm{kcf}=", "Its weight", "kip");
  m(`R_p\\coloneq ${num(i.phiQp)}\\cdot ${num(i.qp)}\\mathrm{ksf}\\cdot\\frac{\\pi\\cdot D^{2}}{4}=`, "Tip, AASHTO Eq. 10.8.3.5-2", "kip");
  m(`R_s\\coloneq ${num(i.phiQs)}\\cdot ${num(i.qs)}\\mathrm{ksf}\\cdot\\pi\\cdot D\\cdot ${num(i.sideLength)}\\mathrm{ft}=`, "Side, AASHTO Eq. 10.8.3.5-3", "kip");
  m(ok("P_{max}+W_{sh}", "R_p+R_s"), "Axial resistance, AASHTO 10.8.3.5");
  m(`M_{py}\\coloneq ${num(i.pyMoment)}\\mathrm{kip}\\cdot\\mathrm{ft}`, "Largest in the shaft, from the p–y analysis");
  m(`V_{py}\\coloneq ${num(i.pyShear)}\\mathrm{kip}`, "From the p–y analysis");
  m("M_u\\coloneq\\max\\left(M_{top},M_{py}\\right)=", undefined, "kip*ft");
  given(`M_n\\coloneq ${num(r.shaft.Mn, 8)}\\mathrm{kip}\\cdot\\mathrm{ft}`, `At P_min, by strain compatibility: ${i.bars} #${i.bar} on a ${num(r.shaft.Dr, 3)} in circle (β1 = ${num(r.shaft.beta1, 3)})`);
  m(`\\phi_f\\coloneq ${num(i.phiM)}`, "AASHTO 5.5.4.2");
  m(ok("M_u", "\\phi_f\\cdot M_n"), "Axial load and bending, AASHTO 5.6.4");
  m(`D_r\\coloneq D-2\\cdot ${num(i.cover)}\\mathrm{in}-2\\cdot ${num(tie.dia)}\\mathrm{in}-${num(bar.dia)}\\mathrm{in}=`, "Circle through the bars", "in");
  m("d_e\\coloneq\\frac{D}{2}+\\frac{D_r}{\\pi}=", "AASHTO Eq. C5.7.2.8-2", "in");
  m(`A_f\\coloneq\\frac{${num(i.bars)}\\cdot ${num(bar.area)}\\mathrm{in}^{2}}{2}=`, "Half the bars in tension", "in^2");
  m("d_v\\coloneq\\max\\left(\\frac{M_n}{A_f\\cdot f_y},0.9\\cdot d_e,0.72\\cdot D\\right)=", "AASHTO 5.7.2.8", "in");
  m("V_u\\coloneq\\max\\left(H_W,V_{py}\\right)=", undefined, "kip");
  m(`s\\coloneq ${num(i.tieSpacing)}\\mathrm{in}`, `#${i.tieBar} ties`);
  m(`A_v\\coloneq2\\cdot ${num(tie.area)}\\mathrm{in}^{2}=`, undefined, "in^2");
  m("V_n\\coloneq\\min\\left(0.0316\\cdot2\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot D\\cdot d_v+\\frac{A_v\\cdot f_y\\cdot d_v}{s},0.25\\cdot f'_{c}\\cdot D\\cdot d_v\\right)=", "AASHTO 5.7.3.3, β = 2, θ = 45°", "kip");
  m(ok("V_u", "0.9\\cdot V_n"), "Shear");
  m(ok("0.0316\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot\\frac{D\\cdot s}{f_y}", "A_v"), "Minimum transverse reinforcement, AASHTO Eq. 5.7.2.5-1");
  m("v_u\\coloneq\\frac{V_u}{0.9\\cdot D\\cdot d_v}=", "AASHTO Eq. 5.7.2.8-1", "ksi");
  m(r.shaft.vu < 0.125 * i.fc ? "s_{max}\\coloneq\\min\\left(0.8\\cdot d_v,24\\mathrm{in}\\right)=" : "s_{max}\\coloneq\\min\\left(0.4\\cdot d_v,12\\mathrm{in}\\right)=", "AASHTO 5.7.2.6", "in");
  m(ok("s", "s_{max}"), "Tie spacing");
  m("T_{cr}\\coloneq0.126\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot\\frac{\\left(\\frac{\\pi\\cdot D^{2}}{4}\\right)^{2}}{\\pi\\cdot D}=", "Torsional cracking, AASHTO Eq. 5.7.2.1-4", "kip*in");
  m(ok("T_W", "0.25\\cdot0.9\\cdot T_{cr}"), "Torsion may be neglected, AASHTO 5.7.2.1");
  text(`The p–y analysis gave a top deflection of ${num(i.pyDeflection, 4)} in. The soil's resistance to torsion is checked by the geotechnical engineer.`, "note");
  return lines;
}
