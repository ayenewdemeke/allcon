import { newId } from "../document";
import type { UnitSystem } from "../evaluate";
import { contentSize, GRID, type ImageRegion, type Paper, type PlotRegion, type Region, type SolveRegion, type TableRegion, type TextRegion } from "../types";
import type { Snippet } from "./materials";

// Worksheet templates: complete calcs to start from (AISC 360-22 and ACI 318-19, LRFD), laid out
// as an engineer would, with the code reference beside each step. Also the layout used to insert
// materials (a note, then their math).

/** A region without its id and place (distributes over the kinds). */
export type Body<T> = T extends unknown ? Omit<T, "id" | "x" | "y"> : never;

/** A line of a template: text, math (with the code reference beside it, or above it for math too
 * wide to share the line), a steel section, or a table, plot, solve block or picture. */
export type Line =
  | { text: string; style?: TextRegion["style"]; color?: string }
  | { math: string; ref?: string; unit?: string; wide?: boolean; color?: string }
  | { shape: string; suffix?: string; compact?: boolean }
  | { region: Body<TableRegion> | Body<PlotRegion> | Body<SolveRegion> | Body<ImageRegion> };

/** Space a math region takes on the page, roughly: taller for fractions, piecewise and roots. */
function mathHeight(latex: string) {
  if (latex.includes("\\begin{cases}")) {
    const rows = latex.split("\\\\").length;
    return rows * (latex.includes("\\frac") ? 34 : 26) + 16;
  }
  if ((latex.match(/\\frac/g) ?? []).length >= 3 && latex.includes("\\sqrt")) return 72; // fractions within fractions
  if (/\\frac[^]*\\frac/.test(latex) && latex.includes("\\sqrt")) return 56;
  if (latex.includes("\\frac") || latex.includes("\\sum") || latex.includes("\\int")) return 48;
  return 32;
}

const textHeight = (text: string, style: TextRegion["style"] = "normal", width = 600) =>
  style === "heading" ? 40 : style === "subheading" ? 36 : 8 + text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil((line.length * (style === "note" ? 6 : 7)) / width)), 0) * 20;

/** Roughly how tall a region is on the page (before it's drawn and measured). */
export function regionHeight(r: Body<Region>): number {
  switch (r.kind) {
    case "math":
      return mathHeight(r.latex);
    case "text":
      return textHeight(r.text, r.style, r.width || 600);
    case "section":
      return r.compact ? 64 : 176;
    case "table":
      return 52 + r.rows.length * 22;
    case "plot":
      return r.height + 48;
    case "solve":
      return 72 + (r.guesses.length + r.constraints.length + 1) * 30;
    case "image":
      return r.height + 8;
  }
}

const REF_X = 440;
const snap = (v: number) => Math.ceil(v / GRID) * GRID;

/** Regions for lines, from (x, y) down; a region that would cross a page's foot starts the next page. */
export function layout(lines: Line[], at: { x: number; y: number }, paper: Paper = "letter"): Region[] {
  const page = contentSize(paper).height;
  const out: Region[] = [];
  let y = at.y;
  for (const line of lines) {
    const h = "text" in line ? textHeight(line.text, line.style) : "math" in line ? mathHeight(line.math) : "shape" in line ? (line.compact ? 64 : 176) : regionHeight(line.region);
    const above = "math" in line && line.wide && line.ref ? 24 : 0;
    if (Math.floor(y / page) !== Math.floor((y + above + h - 8) / page)) y = Math.ceil(y / page) * page;
    if ("math" in line && line.wide && line.ref) {
      out.push({ id: newId(), kind: "text", x: at.x, y, text: line.ref, style: "note", width: 600 });
      y += above;
    }
    if ("text" in line) {
      const style = line.style ?? "normal";
      out.push({ id: newId(), kind: "text", x: at.x, y, text: line.text, style, width: style === "normal" || style === "note" ? 600 : 640, ...(line.color ? { color: line.color } : {}) });
    } else if ("math" in line) {
      out.push({ id: newId(), kind: "math", x: at.x, y, latex: line.math, ...(line.unit ? { displayUnit: line.unit } : {}), ...(line.color ? { color: line.color } : {}) });
      if (line.ref && !line.wide) out.push({ id: newId(), kind: "text", x: at.x + REF_X, y: y + Math.max(0, (h - 32) / 2), text: line.ref, style: "note", width: 230 });
    } else if ("shape" in line) out.push({ id: newId(), kind: "section", x: at.x, y, shape: line.shape, ...(line.suffix ? { suffix: line.suffix } : {}), ...(line.compact ? { compact: true } : {}) });
    else out.push({ ...line.region, id: newId(), x: at.x, y } as Region);
    y = snap(y + h + GRID);
  }
  return out;
}

/** A material's note and math, as lines. */
export const snippetLines = (s: Snippet): Line[] => [{ text: s.note, style: "note" }, ...s.lines.map((math) => ({ math }))];

export type Template = { id: string; name: string; description: string; system: UnitSystem; lines: Line[] };

const check = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le${capacity},\\text{OK},\\text{NG}\\right)=`;

export const TEMPLATES: Template[] = [
  {
    id: "steel-beam",
    name: "Steel beam: flexure and shear",
    description: "W-shape beam, uniform load, braced at intervals (AISC 360-22 F2, G2, LRFD)",
    system: "USCS",
    lines: [
      { text: "STEEL BEAM: FLEXURE AND SHEAR", style: "heading" },
      { text: "Simply supported W-shape under uniform load, laterally braced at intervals Lb. AISC 360-22, LRFD. Doubly symmetric compact I-shape, bent about its major axis (F2)." },
      { text: "Loads and geometry", style: "subheading" },
      { math: "L\\coloneq35ft", ref: "Span" },
      { math: "L_b\\coloneq\\frac{L}{3}=", ref: "Unbraced length: braced at third points" },
      { math: "w_D\\coloneq0.45klf", ref: "Superimposed dead load" },
      { math: "w_L\\coloneq0.75klf", ref: "Live load" },
      { text: "Section and material", style: "subheading" },
      { shape: "W18X50" },
      { math: "F_y\\coloneq50ksi", ref: "ASTM A992" },
      { math: "E\\coloneq29000ksi" },
      { text: "Required strength", style: "subheading" },
      { math: "w_u\\coloneq1.2\\cdot\\left(w_D+w_{sw}\\right)+1.6\\cdot w_L=", ref: "ASCE 7 load combination 1.2D + 1.6L" },
      { math: "M_u\\coloneq\\frac{w_u\\cdot L^2}{8}=" },
      { math: "V_u\\coloneq\\frac{w_u\\cdot L}{2}=" },
      { text: "Flexure: compactness", style: "subheading" },
      { math: "\\lambda_{pf}\\coloneq0.38\\cdot\\sqrt{\\frac{E}{F_y}}=", ref: "Table B4.1b, case 10" },
      { math: "\\operatorname{if}\\left(\\lambda_f\\le\\lambda_{pf},\\text{compact flange},\\text{noncompact flange: use F3}\\right)=" },
      { math: "\\lambda_{pw}\\coloneq3.76\\cdot\\sqrt{\\frac{E}{F_y}}=", ref: "Table B4.1b, case 15" },
      { math: "\\operatorname{if}\\left(\\lambda_w\\le\\lambda_{pw},\\text{compact web},\\text{noncompact web: use F4}\\right)=" },
      { text: "Flexure: yielding and lateral-torsional buckling", style: "subheading" },
      { math: "C_b\\coloneq1.01", ref: "Middle segment, third-point bracing (Manual Table 3-1)" },
      { math: "M_p\\coloneq F_y\\cdot Z_x=", ref: "Eq. F2-1" },
      { math: "L_p\\coloneq1.76\\cdot r_y\\cdot\\sqrt{\\frac{E}{F_y}}=", unit: "ft", ref: "Eq. F2-5" },
      { math: "c\\coloneq1", ref: "Doubly symmetric I-shape, Eq. F2-8a" },
      { math: "L_r\\coloneq1.95\\cdot r_{ts}\\cdot\\frac{E}{0.7\\cdot F_y}\\cdot\\sqrt{\\frac{J\\cdot c}{S_x\\cdot h_o}+\\sqrt{\\left(\\frac{J\\cdot c}{S_x\\cdot h_o}\\right)^2+6.76\\cdot\\left(\\frac{0.7\\cdot F_y}{E}\\right)^2}}=", unit: "ft", ref: "Eq. F2-6", wide: true },
      { math: "F_{cr}\\coloneq\\frac{C_b\\cdot\\pi^2\\cdot E}{\\left(\\frac{L_b}{r_{ts}}\\right)^2}\\cdot\\sqrt{1+0.078\\cdot\\frac{J\\cdot c}{S_x\\cdot h_o}\\cdot\\left(\\frac{L_b}{r_{ts}}\\right)^2}=", ref: "Eq. F2-4" },
      {
        math: "M_n\\coloneq\\begin{cases}M_p & L_b\\le L_p\\\\ \\min\\left(C_b\\cdot\\left(M_p-\\left(M_p-0.7\\cdot F_y\\cdot S_x\\right)\\cdot\\frac{L_b-L_p}{L_r-L_p}\\right),M_p\\right) & L_b\\le L_r\\\\ \\min\\left(F_{cr}\\cdot S_x,M_p\\right) & \\text{otherwise}\\end{cases}=",
        ref: "Eqs. F2-1, F2-2, F2-3",
        wide: true,
      },
      { math: "\\phi_b\\coloneq0.90", ref: "F1(1)" },
      { math: "\\phi_b\\cdot M_n=" },
      { math: "\\frac{M_u}{\\phi_b\\cdot M_n}=" },
      { math: check("M_u", "\\phi_b\\cdot M_n") },
      { text: "Shear", style: "subheading" },
      { math: "A_w\\coloneq d\\cdot t_w=" },
      { math: "k_v\\coloneq5.34", ref: "Webs without transverse stiffeners, G2.1(b)(2)" },
      { math: "C_{v1}\\coloneq\\begin{cases}1.0 & \\lambda_w\\le1.10\\cdot\\sqrt{\\frac{k_v\\cdot E}{F_y}}\\\\ \\frac{1.10}{\\lambda_w}\\cdot\\sqrt{\\frac{k_v\\cdot E}{F_y}} & \\text{otherwise}\\end{cases}=", ref: "Eqs. G2-3, G2-4" },
      { math: "\\phi_v\\coloneq\\begin{cases}1.00 & \\lambda_w\\le2.24\\cdot\\sqrt{\\frac{E}{F_y}}\\\\ 0.90 & \\text{otherwise}\\end{cases}=", ref: "G2.1(a)" },
      { math: "V_n\\coloneq0.6\\cdot F_y\\cdot A_w\\cdot C_{v1}=", ref: "Eq. G2-1" },
      { math: "\\phi_v\\cdot V_n=" },
      { math: check("V_u", "\\phi_v\\cdot V_n") },
      { text: "Live load deflection", style: "subheading" },
      { math: "\\Delta_L\\coloneq\\frac{5\\cdot w_L\\cdot L^4}{384\\cdot E\\cdot I_x}=", unit: "in" },
      { math: "\\Delta_{allow}\\coloneq\\frac{L}{360}=", unit: "in", ref: "Live load limit L/360 (IBC Table 1604.3)" },
      { math: check("\\Delta_L", "\\Delta_{allow}") },
    ],
  },
  {
    id: "steel-column",
    name: "Steel column: axial compression",
    description: "W-shape column, flexural buckling (AISC 360-22 E3, LRFD)",
    system: "USCS",
    lines: [
      { text: "STEEL COLUMN: AXIAL COMPRESSION", style: "heading" },
      { text: "Axially loaded W-shape column. AISC 360-22, LRFD. Flexural buckling of members without slender elements (E3)." },
      { text: "Loads and geometry", style: "subheading" },
      { math: "P_D\\coloneq140kip", ref: "Dead load" },
      { math: "P_L\\coloneq420kip", ref: "Live load" },
      { math: "L\\coloneq30ft", ref: "Story height" },
      { math: "K_x\\coloneq1.0", ref: "Effective length factors (pinned ends)" },
      { math: "K_y\\coloneq1.0" },
      { text: "Section and material", style: "subheading" },
      { shape: "W14X132" },
      { math: "F_y\\coloneq50ksi", ref: "ASTM A992" },
      { math: "E\\coloneq29000ksi" },
      { text: "Required strength", style: "subheading" },
      { math: "P_u\\coloneq1.2\\cdot P_D+1.6\\cdot P_L=", ref: "ASCE 7 load combination 1.2D + 1.6L" },
      { text: "Width-to-thickness ratios", style: "subheading" },
      { math: "\\lambda_{rf}\\coloneq0.56\\cdot\\sqrt{\\frac{E}{F_y}}=", ref: "Table B4.1a, case 1" },
      { math: "\\operatorname{if}\\left(\\lambda_f\\le\\lambda_{rf},\\text{nonslender flange},\\text{slender flange: use E7}\\right)=" },
      { math: "\\lambda_{rw}\\coloneq1.49\\cdot\\sqrt{\\frac{E}{F_y}}=", ref: "Table B4.1a, case 5" },
      { math: "\\operatorname{if}\\left(\\lambda_w\\le\\lambda_{rw},\\text{nonslender web},\\text{slender web: use E7}\\right)=" },
      { text: "Flexural buckling", style: "subheading" },
      { math: "L_{cx}\\coloneq K_x\\cdot L=" },
      { math: "L_{cy}\\coloneq K_y\\cdot L=" },
      { math: "\\lambda_c\\coloneq\\max\\left(\\frac{L_{cx}}{r_x},\\frac{L_{cy}}{r_y}\\right)=", ref: "Governing slenderness Lc/r" },
      { math: "\\operatorname{if}\\left(\\lambda_c\\le200,\\text{OK},\\text{over 200: see E2}\\right)=", ref: "E2 user note" },
      { math: "F_e\\coloneq\\frac{\\pi^2\\cdot E}{\\lambda_c^2}=", ref: "Eq. E3-4" },
      { math: "F_{cr}\\coloneq\\begin{cases}0.658^{\\frac{F_y}{F_e}}\\cdot F_y & \\frac{F_y}{F_e}\\le2.25\\\\ 0.877\\cdot F_e & \\text{otherwise}\\end{cases}=", ref: "Eqs. E3-2, E3-3" },
      { math: "P_n\\coloneq F_{cr}\\cdot A=", ref: "Eq. E3-1" },
      { math: "\\phi_c\\coloneq0.90", ref: "E1" },
      { math: "\\phi_c\\cdot P_n=" },
      { math: "\\frac{P_u}{\\phi_c\\cdot P_n}=" },
      { math: check("P_u", "\\phi_c\\cdot P_n") },
    ],
  },
  {
    id: "concrete-beam",
    name: "Concrete beam: flexure and shear",
    description: "Rectangular beam, tension steel only, with stirrups (ACI 318-19, LRFD)",
    system: "USCS",
    lines: [
      { text: "REINFORCED CONCRETE BEAM: FLEXURE AND SHEAR", style: "heading" },
      { text: "Rectangular, singly reinforced beam with vertical stirrups. ACI 318-19. Normal-weight concrete." },
      { text: "Required strength", style: "subheading" },
      { math: "M_u\\coloneq250kip\\cdot ft", ref: "Factored moment" },
      { math: "V_u\\coloneq45kip", ref: "Factored shear at the critical section" },
      { text: "Section", style: "subheading" },
      { math: "b\\coloneq12in", ref: "Width" },
      { math: "h\\coloneq24in", ref: "Depth" },
      { math: "c_c\\coloneq1.5in", ref: "Clear cover to stirrups (20.5.1.3.1)" },
      { math: "d_s\\coloneq0.5in", ref: "#4 stirrups" },
      { math: "n\\coloneq4", ref: "Number of bars" },
      { math: "d_b\\coloneq1.0in", ref: "#8 bars" },
      { math: "A_b\\coloneq0.79in^2" },
      { math: "d\\coloneq h-c_c-d_s-\\frac{d_b}{2}=", unit: "in", ref: "Effective depth" },
      { text: "Materials", style: "subheading" },
      { math: "f'_{c}\\coloneq4ksi", ref: "Concrete" },
      { math: "\\lambda\\coloneq1.0", ref: "Normal weight (19.2.4)" },
      { math: "f_y\\coloneq60ksi", ref: "ASTM A615 Grade 60" },
      { math: "E_s\\coloneq29000ksi", ref: "20.2.2.2" },
      { math: "\\beta_1\\coloneq\\begin{cases}0.85 & f'_{c}\\le4ksi\\\\ 0.65 & f'_{c}\\ge8ksi\\\\ 0.85-0.05\\cdot\\frac{f'_{c}-4ksi}{1ksi} & \\text{otherwise}\\end{cases}=", ref: "Table 22.2.2.4.3" },
      { text: "Flexure", style: "subheading" },
      { math: "A_s\\coloneq n\\cdot A_b=" },
      { math: "a\\coloneq\\frac{A_s\\cdot f_y}{0.85\\cdot f'_{c}\\cdot b}=", unit: "in", ref: "Equivalent stress block (22.2.2.4.1)" },
      { math: "c\\coloneq\\frac{a}{\\beta_1}=", unit: "in" },
      { math: "\\varepsilon_t\\coloneq0.003\\cdot\\frac{d-c}{c}=", ref: "Strain in the tension steel" },
      { math: "\\varepsilon_{ty}\\coloneq\\frac{f_y}{E_s}=", ref: "21.2.2.1" },
      { math: "\\phi\\coloneq\\begin{cases}0.90 & \\varepsilon_t\\ge\\varepsilon_{ty}+0.003\\\\ 0.65 & \\varepsilon_t\\le\\varepsilon_{ty}\\\\ 0.65+0.25\\cdot\\frac{\\varepsilon_t-\\varepsilon_{ty}}{0.003} & \\text{otherwise}\\end{cases}=", ref: "Table 21.2.2" },
      { math: "M_n\\coloneq A_s\\cdot f_y\\cdot\\left(d-\\frac{a}{2}\\right)=" },
      { math: "\\phi\\cdot M_n=" },
      { math: check("M_u", "\\phi\\cdot M_n") },
      { math: "A_{s,min}\\coloneq\\max\\left(\\frac{3\\cdot\\sqrt{\\frac{f'_{c}}{psi}}\\cdot psi}{f_y},\\frac{200psi}{f_y}\\right)\\cdot b\\cdot d=", ref: "9.6.1.2" },
      { math: "\\operatorname{if}\\left(A_s\\ge A_{s,min},\\text{OK},\\text{NG}\\right)=" },
      { text: "Shear", style: "subheading" },
      { math: "\\phi_v\\coloneq0.75", ref: "Table 21.2.1" },
      { math: "A_v\\coloneq2\\cdot0.20in^2", ref: "#4 stirrups, two legs" },
      { math: "f_{yt}\\coloneq60ksi" },
      { math: "s\\coloneq10in", ref: "Stirrup spacing" },
      { math: "V_c\\coloneq2\\cdot\\lambda\\cdot\\sqrt{\\frac{f'_{c}}{psi}}\\cdot psi\\cdot b\\cdot d=", ref: "Table 22.5.5.1(a), with Av ≥ Av,min" },
      { math: "V_s\\coloneq\\frac{A_v\\cdot f_{yt}\\cdot d}{s}=", ref: "Eq. 22.5.8.5.3" },
      { math: "\\phi_v\\cdot\\left(V_c+V_s\\right)=" },
      { math: check("V_u", "\\phi_v\\cdot\\left(V_c+V_s\\right)") },
      { math: "A_{v,min}\\coloneq\\max\\left(0.75\\cdot\\sqrt{\\frac{f'_{c}}{psi}}\\cdot psi,50psi\\right)\\cdot\\frac{b\\cdot s}{f_{yt}}=", ref: "Table 9.6.3.4" },
      { math: "\\operatorname{if}\\left(A_v\\ge A_{v,min},\\text{OK},\\text{NG}\\right)=" },
      { math: "s_{max}\\coloneq\\min\\left(\\frac{d}{2},24in\\right)=", unit: "in", ref: "Table 9.7.6.2.2, for Vs ≤ 4√f'c b d" },
      { math: "\\operatorname{if}\\left(s\\le s_{max},\\text{OK},\\text{NG}\\right)=" },
    ],
  },
];

export const findTemplate = (id: string | undefined) => TEMPLATES.find((t) => t.id === id);
