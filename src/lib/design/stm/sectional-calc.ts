import type { Line } from "@/lib/calcs/library/templates";
import { INPUT_COLOR, isInput, num } from "../calc-style";
import { bar } from "./aashto";
import type { SectionalResult, SectionResult } from "./sectional";
import type { StmInputs } from "./strut-tie";

// The sectional design of a standard cap's B-Regions as live math (AASHTO 5.6, 5.7): per region,
// its governing section for flexure and for shear, the forces from the cap analyzed as a beam
// given, the resistances worked out. Follows the STM package, whose f'c, fy and bw it uses.

const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;

export function sectionalCalcLines(i: StmInputs, s: SectionalResult): Line[] {
  const t = i.template!;
  const lines: Line[] = [];
  const text = (x: string, style?: "heading" | "subheading" | "note", extra?: { keepWithNext?: boolean; newPage?: boolean }) => lines.push({ text: x, ...(style ? { style } : {}), ...(extra ?? {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  text("Sectional design of the B-Regions (AASHTO 5.6, 5.7)", "subheading", { newPage: true, keepWithNext: true });
  text(
    `Regions:- AASHTO 5.8.2.1 calls for the strut-and-tie method where the distance between the centers of an applied load and its supporting reaction is less than twice the member's depth; beyond about one depth from loads and reactions the cap is a B-Region, where beam theory applies (AASHTO 5.5.1.2.1). Each region's nearest load to a column face, over the cap's depth of ${num(t.depth)} ft: ${s.regions
      .filter((g) => g.kind !== "none")
      .map((g) => `${g.label} ${num(g.ratio!)}h (${g.kind === "B" ? "B-Region, sectional" : "D-Region, strut-and-tie"})`)
      .join("; ")}.`,
  );
  text("Forces:- The cap analyzed as a beam for every load case: a hammerhead's arms by statics from their tips, a bent as a continuous beam on its columns' centerlines. Moments and shears below are the governing case's at each section.");
  m(`E_s\\coloneq 29000\\mathrm{ksi}`, "AASHTO 5.4.3.2");
  m(`\\beta_{1}\\coloneq\\max\\left(0.65,\\min\\left(0.85,0.85-0.05\\cdot\\left(\\frac{f'_{c}}{\\mathrm{ksi}}-4\\right)\\right)\\right)=`, "AASHTO 5.6.2.2");
  m(`\\phi_v\\coloneq 0.9`, "AASHTO 5.5.4.2");
  const Av = Math.max(2, Math.round(t.stirrups.legs)) * bar(t.stirrups.size).area;
  m(`A_{vx}\\coloneq ${num(Av)}\\mathrm{in}^{2}`, `${Math.round(t.stirrups.legs)} legs of #${t.stirrups.size} stirrups`);
  m(`s_{x}\\coloneq ${num(t.stirrups.spacing)}\\mathrm{in}`, "Stirrup spacing");
  m(ok("0.0316\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot\\frac{b_w\\cdot s_{x}}{f_y}", "A_{vx}"), "Minimum transverse reinforcement, AASHTO Eq. 5.7.2.5-1");

  const regions = s.regions.filter((g) => g.kind === "B");
  regions.forEach((g, gi) => {
    const mine = s.sections.filter((q) => q.region === g.label);
    if (!mine.length) return;
    const n = gi + 1;
    const flex = mine.reduce((p, q) => (q.Mu / q.Mr > p.Mu / p.Mr ? q : p));
    text(`${g.label}: flexure ${flex.label}, ${flex.negative ? "top bars in tension" : "bottom bars in tension"} (case ${flex.case + 1})`, undefined, { keepWithNext: true });
    const bars = flex.negative ? t.topBars : t.bottomBars;
    m(`M_{ux${n}}\\coloneq ${num(flex.Mu)}\\mathrm{kip}\\cdot\\mathrm{ft}`, "Factored moment, from the analysis");
    m(`A_{sx${n}}\\coloneq ${bars.count}\\cdot ${num(bar(bars.size).area)}\\mathrm{in}^{2}=`, `${bars.count} #${bars.size}`, "in^2");
    m(`h_{x${n}}\\coloneq ${num(flex.h)}\\mathrm{in}`, "Depth there");
    m(`d_{sx${n}}\\coloneq ${num(flex.ds)}\\mathrm{in}`, "To the bars' centroid");
    m(`c_{x${n}}\\coloneq\\frac{A_{sx${n}}\\cdot f_y}{0.85\\cdot f'_{c}\\cdot\\beta_{1}\\cdot b_w}=`, "AASHTO Eq. 5.6.3.1.1-4", "in");
    m(`M_{nx${n}}\\coloneq A_{sx${n}}\\cdot f_y\\cdot\\left(d_{sx${n}}-\\frac{\\beta_{1}\\cdot c_{x${n}}}{2}\\right)=`, "AASHTO Eq. 5.6.3.2.2-1", "kip*ft");
    m(`\\varepsilon_{tx${n}}\\coloneq 0.003\\cdot\\frac{d_{sx${n}}-c_{x${n}}}{c_{x${n}}}=`, "Net tensile strain");
    m(`\\phi_{fx${n}}\\coloneq\\max\\left(0.75,\\min\\left(0.9,0.75+0.15\\cdot\\frac{\\varepsilon_{tx${n}}-0.002}{0.003}\\right)\\right)=`, "AASHTO Eq. 5.5.4.2-2");
    m(ok(`M_{ux${n}}`, `\\phi_{fx${n}}\\cdot M_{nx${n}}`), "AASHTO 5.6.3.2");
    m(`M_{crx${n}}\\coloneq 0.67\\cdot 1.6\\cdot 0.24\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot\\frac{b_w\\cdot h_{x${n}}^{2}}{6}=`, "AASHTO Eq. 5.6.3.3-1, fr by 5.4.2.6", "kip*ft");
    m(ok(`\\min\\left(M_{crx${n}},1.33\\cdot M_{ux${n}}\\right)`, `\\phi_{fx${n}}\\cdot M_{nx${n}}`), "AASHTO 5.6.3.3");
    const sh = mine.filter((q) => q.shear);
    if (!sh.length) return;
    const v: SectionResult = sh.reduce((p, q) => (q.Vu / q.Vr > p.Vu / p.Vr ? q : p));
    const vb = v.negative ? t.topBars : t.bottomBars;
    text(`${g.label}: shear ${v.label} (case ${v.case + 1}), General Procedure`, undefined, { keepWithNext: true });
    m(`V_{uv${n}}\\coloneq ${num(v.Vu)}\\mathrm{kip}`, "Factored shear");
    m(`M_{uv${n}}\\coloneq ${num(v.Mu)}\\mathrm{kip}\\cdot\\mathrm{ft}`, "With its moment");
    m(`A_{sv${n}}\\coloneq ${vb.count}\\cdot ${num(bar(vb.size).area)}\\mathrm{in}^{2}=`, "Flexural tension bars", "in^2");
    m(`h_{v${n}}\\coloneq ${num(v.h)}\\mathrm{in}`);
    m(`d_{ev${n}}\\coloneq ${num(v.ds)}\\mathrm{in}`);
    m(`a_{v${n}}\\coloneq\\frac{A_{sv${n}}\\cdot f_y}{0.85\\cdot f'_{c}\\cdot b_w}=`, undefined, "in");
    m(`d_{v${n}}\\coloneq\\max\\left(\\max\\left(d_{ev${n}}-\\frac{a_{v${n}}}{2},0.9\\cdot d_{ev${n}}\\right),0.72\\cdot h_{v${n}}\\right)=`, "AASHTO 5.7.2.8", "in");
    m(`\\varepsilon_{sv${n}}\\coloneq\\min\\left(0.006,\\frac{\\frac{\\max\\left(M_{uv${n}},V_{uv${n}}\\cdot d_{v${n}}\\right)}{d_{v${n}}}+V_{uv${n}}}{E_s\\cdot A_{sv${n}}}\\right)=`, "AASHTO Eq. 5.7.3.4.2-4");
    if (Av >= (0.0316 * Math.sqrt(i.fc) * t.capWidth * t.stirrups.spacing) / i.fy - 1e-9) m(`\\beta_{v${n}}\\coloneq\\frac{4.8}{1+750\\cdot\\varepsilon_{sv${n}}}=`, "AASHTO Eq. 5.7.3.4.2-1");
    else m(`\\beta_{v${n}}\\coloneq ${num(v.beta)}`, "AASHTO Eq. 5.7.3.4.2-2 (below the minimum stirrups; aggregate 0.75 in assumed)");
    m(`\\theta_{v${n}}\\coloneq\\left(29+3500\\cdot\\varepsilon_{sv${n}}\\right)\\cdot\\mathrm{deg}=`, "AASHTO Eq. 5.7.3.4.2-3", "deg");
    m(`V_{cv${n}}\\coloneq 0.0316\\cdot\\beta_{v${n}}\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot b_w\\cdot d_{v${n}}=`, "AASHTO Eq. 5.7.3.3-3", "kip");
    m(`V_{sv${n}}\\coloneq\\frac{A_{vx}\\cdot f_y\\cdot d_{v${n}}}{s_{x}\\cdot\\tan\\left(\\theta_{v${n}}\\right)}=`, "AASHTO Eq. 5.7.3.3-4", "kip");
    m(`V_{nv${n}}\\coloneq\\min\\left(V_{cv${n}}+V_{sv${n}},0.25\\cdot f'_{c}\\cdot b_w\\cdot d_{v${n}}\\right)=`, "AASHTO Eqs. 5.7.3.3-1, -2", "kip");
    m(ok(`V_{uv${n}}`, `\\phi_v\\cdot V_{nv${n}}`), "AASHTO 5.7.3.3");
  });
  for (const note of s.notes) text(note, "note");
  return lines;
}
