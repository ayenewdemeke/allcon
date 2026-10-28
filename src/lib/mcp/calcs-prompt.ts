import { APP_NAME } from "@/lib/app-config";
import { TEMPLATES } from "@/lib/calcs/library/templates";

// The write_calc skill: how an AI app writes engineering calculations in conkit's Calcs, which
// works like Mathcad. Also the reference edit_calc points to, so it stays in one place.

export const CALC_GUIDE = `Math is LaTeX, as a math editor writes it, worked out with units in reading order (top to bottom, then left to right): define a name before using it.

- Define: L\\coloneq35ft. Show the value too by ending with =: M_u\\coloneq\\frac{w_u\\cdot L^2}{8}=. Show a result: \\phi_b\\cdot M_n=. A function: f\\left(x\\right)\\coloneq x^2+1.
- Names: letters together are ONE name (Mu is a name, not M times u), with an optional subscript and primes: M_u, A_{s,min}, f'_{c}, \\phi_b, \\lambda_{pf}, \\Delta_L, \\varepsilon_t. Multiply with \\cdot: w_u\\cdot L. A name you define wins over a unit of the same name.
- Units follow numbers: 35ft, 0.45klf, 50ksi, 250kip\\cdot ft, 0.79in^2, 12in, 30deg, 4.2kN/m (or \\frac{kN}{m}), 200GPa, 145pcf. Units include in ft yd mm cm m, lbf kip kips tonf N kN MN kgf, psi ksi psf ksf Pa kPa MPa GPa, plf klf, pcf kcf, deg rad, s min hr. Results show in the worksheet's units (kip, ft, ksi; or kN, m, MPa); display_unit chooses one (in, kip*ft, MPa).
- Operators and functions: + - \\cdot / \\frac{a}{b} x^2 \\sqrt{x} \\sqrt[3]{x} \\left|x\\right| \\left(...\\right); \\sin \\cos \\tan \\arctan (angles in rad, or 30deg) \\ln \\log \\exp \\min\\left(a,b\\right) \\max\\left(a,b\\right) \\operatorname{round}\\left(x,2\\right) \\operatorname{ceil} \\operatorname{floor}; constants \\pi, e, g.
- Checks and choices: \\operatorname{if}\\left(M_u\\le\\phi_b\\cdot M_n,\\text{OK},\\text{NG}\\right)= ; piecewise \\begin{cases}0.90 & \\varepsilon_t\\ge0.005\\\\ 0.65 & \\varepsilon_t\\le0.002\\\\ 0.65+0.25\\cdot\\frac{\\varepsilon_t-0.002}{0.003} & \\text{otherwise}\\end{cases}. Comparisons: < > \\le \\ge \\ne and = (inside if and cases).
- Ranges, sums, calculus: i\\coloneq0..4 ; x\\coloneq0,0.5..10 ; \\sum_{i=1}^{n}i^2 ; \\prod ; \\int_{0}^{L}w\\left(x\\right)\\,dx ; \\frac{d}{dx}f\\left(x\\right) (at x's value).
- Matrices: \\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}, M^{-1}, M^{T}, \\left|M\\right| (determinant), v\\left[0\\right] (indexes start at 0), \\operatorname{rows}, \\operatorname{cols}, \\operatorname{length}, \\operatorname{augment}, \\operatorname{stack}, \\operatorname{identity}, \\operatorname{sum}, \\operatorname{mean}, \\operatorname{sort}.
- Solving: \\operatorname{root}\\left(f\\left(x\\right),x\\right) from x's value (or root(f(x), x, a, b) within a..b); \\operatorname{minimize}\\left(f,x\\right); \\operatorname{maximize}; \\operatorname{polyroots}\\left(v\\right). For simultaneous equations use a solve region: guesses, constraints, and a solver line with find.
- Steel sections: a section region (shape W18X50, HSS6X6X1/4, C10X15.3, L4X4X1/2, WT, PIPE...) defines the AISC properties: A, d, b_f, t_f, t_w, k_des, I_x, S_x, Z_x, r_x, I_y, S_y, Z_y, r_y, J, C_w, r_ts, h_o, w_sw (self-weight), \\lambda_f (bf/2tf), \\lambda_w (h/tw); HSS: H, B, t (design wall), h, b, \\lambda_b, \\lambda_h, C; round HSS and pipe: D, t, \\lambda_D; angles: d, b, t, x_c, y_c, I_z, r_z. With suffix "b" the names become A_b, I_{x,b}. Or look one up: \\operatorname{section}\\left(\\text{W14X22},\\text{Zx}\\right).
- Text: \\text{...} is a string. Text regions (style heading, subheading, normal, note) hold the explanation; give math a ref (e.g. "AISC 360-22 Eq. F2-1") to show the code reference beside it.

Each edit returns what the changed regions work out to, and every error in the worksheet: fix errors before going on (a misspelt name, a name used before it's defined, units that don't add up).`;

export function writeCalcPrompt(args: { task: string; calc?: string }) {
  return `Write this engineering calculation in ${APP_NAME}'s Calcs (a worksheet that works like Mathcad, with live units): ${args.task}${args.calc ? `\n\nWorksheet: ${args.calc}` : ""}

1. Find or make the worksheet: list_calcs, or create_calc (US customary or SI; a template to start from when one fits: ${TEMPLATES.map((t) => `${t.id} (${t.name})`).join(", ")}). Read it with get_calc.
2. Plan it as an engineer would lay out a calc package: a heading, a short description of what's checked and to which code, then sections (subheadings) for inputs and loads, section and material properties, each design check, and a conclusion.
3. Write it with edit_calc, a section at a time: text for the explanation, math for every input and step (with its code reference as ref), section regions for steel shapes. Show intermediate values (end lines with =) so a checker can follow, and finish each check with an if(...,"OK","NG") line and the demand/capacity ratio.
4. Read each edit's results. Fix every error, and look at the numbers: are the magnitudes and units sensible? Cite the code edition you used, and don't invent code values: if unsure of a coefficient, say so in a note.
5. Fill in the header (project, title, calc number, by) with edit_calc.
6. To file it with a project's drawings, publish_calc adds it to the project's Sheets as a PDF.
7. Finish with a summary of the results (each check's ratio and OK/NG) and the link. The user sees your changes live if they have the worksheet open, and can undo the whole request from Connections.

${CALC_GUIDE}`;
}
