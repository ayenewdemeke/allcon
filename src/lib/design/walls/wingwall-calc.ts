import type { Line } from "@/lib/calcs/library/templates";
import { COLOR_NOTE, INPUT_COLOR, isInput } from "../calc-style";
import type { Figure } from "../figures";
import { BARS } from "./cip";
import type { WingwallInputs } from "./wingwall";

// A cantilever wingwall as a Calcs worksheet: inputs as definitions and every step as live math
// with its AASHTO reference, worked out by Calcs independently of the design engine.

const num = (v: number) => String(+v.toFixed(6));
const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;

export function wingwallCalcLines(i: WingwallInputs, title: string, figures?: { section?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note") => lines.push({ text: t, ...(style ? { style } : {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const bar = BARS[i.bars.bar];

  text(title.toUpperCase(), "heading");
  text("Wingwall cantilevered off an abutment, AASHTO LRFD. Earth pressure and live load surcharge act on the retained face down to a line from the wall's height at the abutment to the end height at its tip; the buried part below that line is neglected.");
  text(COLOR_NOTE, "note");

  text("Geometry and soil", "subheading");
  m(`H\\coloneq ${num(i.H)}\\mathrm{ft}`, "Height at the abutment face");
  m(`h\\coloneq ${num(i.h)}\\mathrm{ft}`, "Pressure depth at the tip");
  m(`L\\coloneq ${num(i.L)}\\mathrm{ft}`, "Length from the abutment face");
  m(`t\\coloneq ${num(i.t)}\\mathrm{in}`, "Thickness");
  m(`A\\coloneq ${num(i.A)}\\mathrm{ft}`, "Abutment width");
  m(`\\theta\\coloneq ${num(i.skew)}\\mathrm{deg}`, "Skew");
  if (figures?.section) lines.push({ region: figures.section });
  m(`\\gamma_s\\coloneq ${num(i.gammaS)}\\mathrm{kcf}`, "Backfill unit weight");
  if (i.atRest) {
    m(`\\phi\\coloneq ${num(i.phi)}\\mathrm{deg}`, "Backfill friction angle");
    m("k\\coloneq1-\\sin\\left(\\phi\\right)=", "At rest, AASHTO Eq. 3.11.5.2-1");
  } else m(`k\\coloneq ${num(i.k)}`, "Lateral earth pressure coefficient");
  m("W\\coloneq k\\cdot\\gamma_s=", "Equivalent fluid weight", "pcf");
  m(`S\\coloneq ${num(i.heq)}\\mathrm{ft}`, "Live load surcharge height, AASHTO 3.11.6.4");
  m(`\\gamma_c\\coloneq ${num(i.gammaC)}\\mathrm{kcf}`);
  m(`\\gamma_{DC}\\coloneq ${num(i.gDC)}`, "AASHTO T. 3.4.1-2");
  m(`\\gamma_{EH}\\coloneq ${num(i.gEH)}`, i.atRest ? "At rest, AASHTO T. 3.4.1-2" : "AASHTO T. 3.4.1-2");
  m(`\\gamma_{LS}\\coloneq ${num(i.gLS)}`, "AASHTO T. 3.4.1-1");

  text("Earth pressure resultants (pressure W (z + S) over the loaded face)", "subheading");
  text("Thrust P, its moment about the abutment face (axis A) and about the top of the wall (axis C); earth pressure alone with S = 0, the surcharge as the rest.", "note");
  const P = (S: string) => `\\frac{W\\cdot L}{6}\\cdot\\left(H^{2}+\\left(h+H\\right)\\cdot\\left(h+3\\cdot ${S}\\right)\\right)`;
  const MA = (S: string) => `\\frac{W\\cdot L^{2}}{24}\\cdot\\left(3\\cdot h^{2}+\\left(H+4\\cdot ${S}\\right)\\cdot\\left(H+2\\cdot h\\right)\\right)`;
  const MC = (S: string) => `\\frac{W\\cdot L}{12}\\cdot\\left(2\\cdot ${S}\\cdot h\\cdot H+\\left(H^{2}+h^{2}\\right)\\cdot\\left(H+h+2\\cdot ${S}\\right)\\right)`;
  m(`P_{EH}\\coloneq ${P("0\\mathrm{ft}")}=`, undefined, "kip");
  m(`P_{s}\\coloneq ${P("S")}=`, "Service", "kip");
  m(`M_{AEH}\\coloneq ${MA("0\\mathrm{ft}")}=`, undefined, "kip*ft");
  m(`M_{As}\\coloneq ${MA("S")}=`, "Service", "kip*ft");
  m(`M_{CEH}\\coloneq ${MC("0\\mathrm{ft}")}=`, undefined, "kip*ft");
  m(`M_{Cs}\\coloneq ${MC("S")}=`, "Service", "kip*ft");
  m("P_u\\coloneq\\gamma_{EH}\\cdot P_{EH}+\\gamma_{LS}\\cdot\\left(P_s-P_{EH}\\right)=", "Strength I", "kip");
  m("M_{Au}\\coloneq\\gamma_{EH}\\cdot M_{AEH}+\\gamma_{LS}\\cdot\\left(M_{As}-M_{AEH}\\right)=", undefined, "kip*ft");
  m("M_{Cu}\\coloneq\\gamma_{EH}\\cdot M_{CEH}+\\gamma_{LS}\\cdot\\left(M_{Cs}-M_{CEH}\\right)=", undefined, "kip*ft");
  m("x_s\\coloneq\\frac{M_{As}}{P_s}=", "Thrust from the abutment face, service", "ft");
  m("y_s\\coloneq\\frac{M_{Cs}}{P_s}=", "From the top of the wall", "ft");
  m("x_u\\coloneq\\frac{M_{Au}}{P_u}=", "Strength", "ft");
  m("y_u\\coloneq\\frac{M_{Cu}}{P_u}=", undefined, "ft");

  text("Self weight", "subheading");
  m("V_{ws}\\coloneq t\\cdot H\\cdot L\\cdot\\gamma_c=", undefined, "kip");
  m("V_{wu}\\coloneq\\gamma_{DC}\\cdot V_{ws}=", undefined, "kip");
  m("M_{wu}\\coloneq V_{wu}\\cdot\\frac{L}{2}=", "Vertical bending at the abutment face", "kip*ft");

  text("Section A: horizontal bars on the retained face, per foot of height", "subheading");
  m("M_u\\coloneq\\frac{M_{Au}}{H}=", undefined, "kip*ft/ft");
  m("M_s\\coloneq\\frac{M_{As}}{H}=", undefined, "kip*ft/ft");
  m(`f'_{c}\\coloneq ${num(i.fc)}\\mathrm{ksi}`);
  m(`f_y\\coloneq ${num(i.fy)}\\mathrm{ksi}`);
  m("E_c\\coloneq120000\\cdot0.15^{2}\\cdot\\left(\\frac{f'_{c}}{\\mathrm{ksi}}\\right)^{0.33}\\cdot\\mathrm{ksi}=", "AASHTO Eq. 5.4.2.4-1", "ksi");
  m("n\\coloneq\\frac{29000\\mathrm{ksi}}{E_c}=");
  m(`c_c\\coloneq ${num(i.cover)}\\mathrm{in}`, "Cover");
  m(`d_b\\coloneq ${num(bar.dia)}\\mathrm{in}`, `#${i.bars.bar} bars`);
  m(`s\\coloneq ${num(i.bars.spacing)}\\mathrm{in}`, "Spacing");
  m("d_e\\coloneq t-c_c-\\frac{d_b}{2}=", "Effective depth", "in");
  m(`A_s\\coloneq\\frac{${num(bar.area)}\\mathrm{in}^{2}}{s}=`, "Steel per foot of height", "in^2/ft");
  m("\\beta_1\\coloneq\\max\\left(0.65,\\min\\left(0.85,0.85-0.05\\cdot\\frac{f'_{c}-4\\mathrm{ksi}}{\\mathrm{ksi}}\\right)\\right)=", "AASHTO 5.6.2.2");
  m("a\\coloneq\\frac{A_s\\cdot f_y}{0.85\\cdot f'_{c}}=", "Stress block depth", "in");
  m("M_r\\coloneq0.9\\cdot A_s\\cdot f_y\\cdot\\left(d_e-\\frac{a}{2}\\right)=", "AASHTO 5.6.3.2", "kip*ft/ft");
  m(ok("M_u", "M_r"), "Flexure");
  m("f_r\\coloneq0.24\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}=", "AASHTO 5.4.2.6");
  m("M_{cr}\\coloneq0.67\\cdot1.6\\cdot f_r\\cdot\\frac{t^{2}}{6}=", "AASHTO Eq. 5.6.3.3-1", "kip*ft/ft");
  m(ok("\\min\\left(1.33\\cdot M_u,M_{cr}\\right)", "M_r"), "Minimum reinforcement, AASHTO 5.6.3.3");
  m("\\rho\\coloneq\\frac{A_s}{d_e}=");
  m("k_c\\coloneq\\sqrt{2\\cdot\\rho\\cdot n+\\left(\\rho\\cdot n\\right)^{2}}-\\rho\\cdot n=");
  m("f_{ss}\\coloneq\\frac{M_s}{A_s\\cdot\\left(1-\\frac{k_c}{3}\\right)\\cdot d_e}=", "Service steel stress", "ksi");
  m("d_c\\coloneq c_c+\\frac{d_b}{2}=", undefined, "in");
  m("\\beta_s\\coloneq1+\\frac{d_c}{0.7\\cdot\\left(t-d_c\\right)}=");
  m(`s_{max}\\coloneq\\frac{700\\cdot${i.exposure === 1 ? "1.00" : "0.75"}\\cdot\\frac{\\mathrm{kip}}{\\mathrm{in}}}{\\beta_s\\cdot f_{ss}}-2\\cdot d_c=`, `Crack control, AASHTO Eq. 5.6.7-1 (Class ${i.exposure})`, "in");
  m(ok("s", "s_{max}"), "Bar spacing");
  m("V_u\\coloneq\\frac{P_u}{H}=", "Shear at the abutment face", "kip/ft");
  m("d_v\\coloneq\\max\\left(d_e-\\frac{a}{2},0.9\\cdot d_e,0.72\\cdot t\\right)=", "AASHTO 5.7.2.8", "in");
  m("V_r\\coloneq0.9\\cdot0.0316\\cdot2\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot d_v=", "AASHTO 5.7.3.3 (β = 2)", "kip/ft");
  m(ok("V_u", "V_r"), "Shear");

  text("Section B: forces the abutment takes, about its centroidal axes", "subheading");
  m("A'\\coloneq\\frac{A}{\\cos\\left(\\theta\\right)}=", "Abutment width along the skew", "ft");
  for (const [s, V, name] of [["s", "V_{ws}", "Service"], ["u", "V_{wu}", "Strength I"]] as const) {
    m(`M_{y${s}}\\coloneq P_${s}\\cdot\\left(x_${s}+\\frac{A'}{2}\\right)=`, name, "kip*ft");
    m(`M_{x${s}}\\coloneq P_${s}\\cdot\\left(\\frac{H}{2}-y_${s}\\right)=`, undefined, "kip*ft");
    m(`T_{z${s}}\\coloneq ${V}\\cdot\\left(\\frac{L}{2}+\\frac{A'}{2}\\right)=`, "Torsion from self weight", "kip*ft");
  }
  text("The tension P, shear V, torsion and both moments act together on the abutment; detail the wingwall bars to develop into it.", "note");
  return lines;
}
