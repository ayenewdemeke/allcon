import type { Line } from "@/lib/calcs/library/templates";
import { checksSummary } from "../checks-summary";
import { COLOR_NOTE, INPUT_COLOR, isInput, num } from "../calc-style";
import type { Figure } from "../figures";
import { textTable } from "../svg-table";
import { BARS } from "../walls/cip";
import { designAbutment, type AbutmentInputs } from "./abutment";
import { bearingFactors, designFooting, type FootingInputs } from "./footing";
import { FOUNDATION_INFO, type FoundationKind } from "./kinds";
import { designMicropile, type MicropileInputs } from "./micropile";
import { designPiles, type PileInputs } from "./piles";
import { runFoundation } from "./run";
import { designShaft, type ShaftInputs } from "./shaft";

// The foundation tools and the abutment as Calcs worksheets in the owner's style: the purpose and
// method, the inputs, the closed-form checks as live math with their references (bearing, eccentricity,
// sliding, the micropile's sections and bond, the pile loads on a rigid cap, the abutment's movement),
// the numerical results (the lateral p–y analysis, the footing's pressure integration, the cap's beam)
// as given tables, and the summary of every check.

const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;
const SOURCES: Record<FoundationKind, string> = {
  "spread-footing": "AASHTO LRFD 10th Edition 10.6 and 5.12.8; FHWA NHI-06-089 (Soils and Foundations Reference Manual, Vol. II) Ch. 8; FHWA GEC 6 (FHWA-SA-02-054); CDOT BDM 10.4.",
  "pile-foundation": "AASHTO LRFD 10th Edition 10.7, 6.15, 6.9 and 5.12.8; FHWA GEC 12 (FHWA-NHI-16-009); FHWA GEC 9 (FHWA-HIF-18-031) for the p–y method; CDOT BDM 10.5.",
  "drilled-shaft": "AASHTO LRFD 10th Edition 10.8 and 5.6; FHWA GEC 10 (FHWA-NHI-18-024); FHWA GEC 9 (FHWA-HIF-18-031) for the p–y method; CDOT BDM 10.6.",
  micropile: "AASHTO LRFD 10th Edition 10.9; FHWA NHI-05-039 (Micropile Design and Construction Reference Manual, 2005) and FHWA-SA-97-070 (Micropile Design and Construction Guidelines, 1997) Ch. 5; Caltrans Geotechnical Manual, Micropiles (2021).",
  abutment: "CDOT BDM 11.3 (April 2025); AASHTO LRFD 10th Edition 3.11, 3.12, 4.7.4.4, 6.15, 10.6–10.8 and 11.6; FHWA GEC 9 for the p–y method.",
};

export function foundationCalcLines(kind: FoundationKind, inputs: unknown, title: string, figures?: { section?: Figure; lateral?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note", extra?: { newPage?: boolean; keepWithNext?: boolean }) => lines.push({ text: t, ...(style ? { style } : {}), ...(extra ?? {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const table = (rows: [string, string][], t?: string) => lines.push({ region: textTable([{ title: "Quantity", x: 4 }, { title: "Value", x: 420 }], rows.map((r) => [r[0], r[1]]), 720, t) });
  const run = runFoundation(kind, inputs);
  const info = FOUNDATION_INFO[kind];

  text(title.toUpperCase(), "heading");
  text(`Purpose:- ${info.description}`);
  text(`References:- ${SOURCES[kind]}`);
  text(COLOR_NOTE, "note");
  if (figures?.section) {
    text("Elevation", "subheading", { newPage: true, keepWithNext: true });
    lines.push({ region: figures.section });
  }

  text("Calculations", "subheading", { newPage: true, keepWithNext: true });
  if (kind === "spread-footing") footing(inputs as FootingInputs);
  else if (kind === "pile-foundation") piles(inputs as PileInputs);
  else if (kind === "drilled-shaft") shaft(inputs as ShaftInputs);
  else if (kind === "micropile") micropile(inputs as MicropileInputs);
  else abutment(inputs as AbutmentInputs);

  for (const s of run.summary) {
    text(s.title, "subheading", { keepWithNext: true });
    table(s.rows);
  }
  if (run.lateral) {
    text(`Lateral analysis, p–y (FHWA GEC 9): ${run.lateral.title}`, "subheading", { newPage: true, keepWithNext: true });
    text("Method:- the pile or shaft as a beam on nonlinear soil springs (p–y curves of GEC 9 Appendix A and API sand), solved by finite differences and iterated to convergence; the axial load included (P–Δ). Results at intervals down its length:");
    if (figures?.lateral) lines.push({ region: figures.lateral });
    const r = run.lateral.r;
    const step = Math.max(1, Math.floor(r.z.length / 24));
    const rows = r.z.map((z, k) => [k, z] as const).filter(([k]) => k % step === 0 || k === r.z.length - 1).map(([k, z]) => [num(z, 2), num(r.y[k]), num(r.M[k], 2), num(r.V[k], 2), num(r.p[k], 3)]);
    lines.push({ region: textTable([{ title: "Depth (ft)", x: 60, anchor: "end" }, { title: "y (in)", x: 180, anchor: "end" }, { title: "M (kip·ft)", x: 300, anchor: "end" }, { title: "V (kip)", x: 420, anchor: "end" }, { title: "p (kip/ft)", x: 540, anchor: "end" }], rows, 720) });
    table([["Head deflection (in)", num(r.y0)], ["Largest moment (kip·ft) at depth (ft)", `${num(r.Mmax, 2)} at ${num(r.zMmax, 2)}`], ["First zero deflection, the depth to fixity (ft)", r.zZero === null ? "none" : num(r.zZero, 2)], ["Iterations, converged", `${r.iterations}, ${r.converged ? "yes" : "no"}`]]);
  }
  lines.push(...checksSummary(run.groups.map((g) => ({ title: g.title, checks: run.checks.filter((c) => g.of(c.id)) }))));
  return lines;

  function footing(i: FootingInputs) {
    const r = designFooting(i);
    m(`B\\coloneq ${num(i.B)}\\mathrm{ft}`, "Footing width");
    m(`L\\coloneq ${num(i.L)}\\mathrm{ft}`, "Footing length");
    m(`t_f\\coloneq ${num(i.t)}\\mathrm{in}`, "Thickness");
    m(`D_f\\coloneq ${num(i.Df)}\\mathrm{ft}`, "Ground to the base");
    m(ok("3\\mathrm{ft}", "D_f"), "Embedment, CDOT BDM 10.4.2");
    const g = r.cases.filter((c) => c.lc.limit !== "service").reduce<(typeof r.cases)[number] | null>((a, b) => (!a || b.qeq / b.qR > a.qeq / a.qR ? b : a), null);
    if (!g) return;
    text(`Bearing:- the governing case, ${g.lc.name}, with the footing's and soil's weight at their largest factors; the effective dimensions B′ = B − 2eB, L′ = L − 2eL (AASHTO 10.6.1.3, FHWA NHI-06-089 Eqs. 8-7, 8-8).`);
    m(`V_u\\coloneq ${num(g.Vmax)}\\mathrm{kip}`, "Vertical load on the base");
    m(`M_B\\coloneq ${num(Math.abs(g.MBb))}\\mathrm{kip}\\cdot\\mathrm{ft}`, "Moment along B at the base, with the shear's arm");
    m(`M_L\\coloneq ${num(Math.abs(g.MLb))}\\mathrm{kip}\\cdot\\mathrm{ft}`, "Moment along L at the base");
    m("e_B\\coloneq\\frac{M_B}{V_u}=", undefined, "ft");
    m("e_L\\coloneq\\frac{M_L}{V_u}=", undefined, "ft");
    m("B'\\coloneq B-2\\cdot e_B=", undefined, "ft");
    m("L'\\coloneq L-2\\cdot e_L=", undefined, "ft");
    m("q_{eq}\\coloneq\\frac{V_u}{B'\\cdot L'}=", "Equivalent uniform pressure", "ksf");
    if (i.bearing === "computed" && g.nb) {
      const f = bearingFactors(i.phi);
      m(`\\phi_f\\coloneq ${num(i.phi)}\\mathrm{deg}`, "Friction angle");
      m(`c_s\\coloneq ${num(i.c / 1000)}\\mathrm{ksf}`, "Cohesion");
      m(`\\gamma_a\\coloneq ${num(i.gammaAbove / 1000)}\\mathrm{kcf}`, "Unit weight above the base");
      m(`\\gamma_b\\coloneq ${num(i.gammaBelow / 1000)}\\mathrm{kcf}`, "Unit weight below");
      m("N_q\\coloneq e^{\\pi\\cdot\\tan\\left(\\phi_f\\right)}\\cdot\\tan\\left(45\\mathrm{deg}+\\frac{\\phi_f}{2}\\right)^{2}=", "AASHTO Table 10.6.3.1.2a-1, NHI Eq. 8-2");
      m(i.phi > 0 ? "N_c\\coloneq\\frac{N_q-1}{\\tan\\left(\\phi_f\\right)}=" : "N_c\\coloneq5.14", "NHI Eqs. 8-3, 8-4");
      m("N_{\\gamma}\\coloneq2\\cdot\\left(N_q+1\\right)\\cdot\\tan\\left(\\phi_f\\right)=", "NHI Eq. 8-5");
      m(`s_c\\coloneq ${num(g.nb.sc)}`, `Shape factors on B′/L′, NHI Table 8-4 (sq ${num(g.nb.sq)}, sγ ${num(g.nb.sg)})`);
      m(`s_q\\coloneq ${num(g.nb.sq)}`);
      m(`s_{\\gamma}\\coloneq ${num(g.nb.sg)}`);
      m(`C_{wq}\\coloneq ${num(g.nb.Cwq)}`, "Groundwater, NHI Table 8-5");
      m(`C_{w\\gamma}\\coloneq ${num(g.nb.Cwg)}`);
      m(`d_q\\coloneq ${num(g.nb.dq)}`, "Depth factor, NHI Table 8-6 (1.0 unless chosen)");
      m("q_{c}\\coloneq c_s\\cdot N_c\\cdot s_c=", "Cohesion term", "ksf");
      m("q_{q}\\coloneq\\gamma_a\\cdot D_f\\cdot N_q\\cdot s_q\\cdot d_q\\cdot C_{wq}=", "Surcharge term", "ksf");
      m("q_{g}\\coloneq0.5\\cdot\\gamma_b\\cdot\\min\\left(B',L'\\right)\\cdot N_{\\gamma}\\cdot s_{\\gamma}\\cdot C_{w\\gamma}=", "Weight term", "ksf");
      m("q_n\\coloneq q_{c}+q_{q}+q_{g}=", "AASHTO Eq. 10.6.3.1.2a-1, NHI Eq. 8-6", "ksf");
      void f;
    } else m(`q_n\\coloneq ${num(g.qn)}\\mathrm{ksf}`, "Nominal bearing resistance, geotechnical report");
    m(`\\phi_b\\coloneq ${num(g.phiB)}`, "AASHTO Table 10.5.5.2.2-1");
    m(ok("q_{eq}", "\\phi_b\\cdot q_n"), "Bearing, AASHTO 10.6.3.1");
    m(ok("e_B", `${i.onRock ? "0.45" : "\\frac{1}{3}"}\\cdot B`), "Eccentricity along B, AASHTO 10.6.3.3 (here at the bearing case's load)");
    text("Sliding:- the least vertical load (footing and soil at their least factors).");
    const s = r.cases.filter((c) => c.lc.limit !== "service").reduce((a, b) => (b.H / b.RR > a.H / a.RR ? b : a));
    m(`H_u\\coloneq ${num(s.H)}\\mathrm{kip}`, `Horizontal load (${s.lc.name})`);
    m(`V_{min}\\coloneq ${num(s.Vmin)}\\mathrm{kip}`);
    if (i.interface === "sand") {
      m(`\\delta_s\\coloneq ${num(i.delta)}\\mathrm{deg}`, "Interface friction (cast in place: φ)");
      m("R_{\\tau}\\coloneq V_{min}\\cdot\\tan\\left(\\delta_s\\right)=", "AASHTO Eq. 10.6.3.4-2", "kip");
    } else m(`R_{\\tau}\\coloneq ${num(s.Rtau)}\\mathrm{kip}`, "Clay: the lesser of Su·A and half the vertical load, AASHTO 10.6.3.4");
    m(`\\phi_{\\tau}\\coloneq ${num(i.phiTau)}`);
    m(`R_{ep}\\coloneq ${num(s.Rep)}\\mathrm{kip}`, i.passive ? "Passive resistance on the footing's face" : "Passive resistance not counted");
    m(ok("H_u", `\\phi_{\\tau}\\cdot R_{\\tau}+${num(i.phiEp)}\\cdot R_{ep}`), "Sliding, AASHTO Eq. 10.6.3.4-1");
    if (r.flexB && r.flexL) {
      text("The footing:- the column's factored loads only (the footing and the soil over it bear directly), as a linear pressure under a rigid footing; the moment and shears worked out numerically over the footing (results in the summary of checks).");
      m(`d_B\\coloneq ${num(r.dB)}\\mathrm{in}`, `Bars along B, #${i.barsB.bar} @ ${num(i.barsB.spacing)} in, the lower layer`);
      m(`A_{sB}\\coloneq\\frac{${num(BARS[i.barsB.bar].area)}\\mathrm{in}^{2}}{${num(i.barsB.spacing)}\\mathrm{in}}=`, undefined, "in^2/ft");
      m(`f'_{c}\\coloneq ${num(i.fc)}\\mathrm{ksi}`);
      m(`f_y\\coloneq ${num(i.fy)}\\mathrm{ksi}`);
      m("a_B\\coloneq\\frac{A_{sB}\\cdot f_y}{0.85\\cdot f'_{c}}=", "Per foot", "in");
      m("M_{rB}\\coloneq0.9\\cdot A_{sB}\\cdot f_y\\cdot\\left(d_B-\\frac{a_B}{2}\\right)=", "AASHTO 5.6.3.2", "kip*ft/ft");
    }
  }

  function piles(i: PileInputs) {
    const r = designPiles(i);
    m(`n_p\\coloneq ${r.n}`, `Piles, ${i.nB} along B by ${i.nL} along L, ${i.section}`);
    m(`s_B\\coloneq ${num(i.sB)}\\mathrm{ft}`);
    m(`s_L\\coloneq ${num(i.sL)}\\mathrm{ft}`);
    m(`R_n\\coloneq ${num(i.Rn)}\\mathrm{kip}`, "Nominal geotechnical resistance per pile, geotechnical report");
    m(`\\phi_{dyn}\\coloneq ${num(r.phiGeo)}`, r.smallGroup ? "AASHTO Table 10.5.5.2.3-1 × 0.8, three piles or fewer (CDOT BDM 10.5.2.2)" : "AASHTO Table 10.5.5.2.3-1");
    const g = r.cases.filter((c) => c.lc.limit !== "service").reduce((a, b) => (b.Pmax > a.Pmax ? b : a));
    const Sx2 = r.piles.reduce((t, p) => t + p.x ** 2, 0);
    const Sy2 = r.piles.reduce((t, p) => t + p.y ** 2, 0);
    const far = r.piles.reduce((a, p) => (p.x + p.y > a.x + a.y ? p : a));
    text(`Pile loads:- a rigid cap, P/n ± M·x/Σx² (GEC 12 9.8), the governing case ${g.lc.name}, the cap's and soil's weight at their largest factors.`);
    m(`V_c\\coloneq ${num(g.Vmax)}\\mathrm{kip}`);
    m(`M_B\\coloneq ${num(g.MBb)}\\mathrm{kip}\\cdot\\mathrm{ft}`);
    m(`M_L\\coloneq ${num(g.MLb)}\\mathrm{kip}\\cdot\\mathrm{ft}`);
    m(`\\Sigma_{x2}\\coloneq ${num(Sx2)}\\mathrm{ft}^{2}`);
    m(`\\Sigma_{y2}\\coloneq ${num(Sy2)}\\mathrm{ft}^{2}`);
    m(`x_c\\coloneq ${num(far.x)}\\mathrm{ft}`, "The corner pile");
    m(`y_c\\coloneq ${num(far.y)}\\mathrm{ft}`);
    m(`P_{max}\\coloneq\\frac{V_c}{n_p}${Sx2 > 0 ? "+\\frac{M_B\\cdot x_c}{\\Sigma_{x2}}" : ""}${Sy2 > 0 ? "+\\frac{M_L\\cdot y_c}{\\Sigma_{y2}}" : ""}=`, "The most loaded pile", "kip");
    m(ok("P_{max}", "\\phi_{dyn}\\cdot R_n"), "Geotechnical axial resistance");
  }

  function shaft(i: ShaftInputs) {
    const r = designShaft(i);
    m(`D_s\\coloneq ${num(i.D)}\\mathrm{in}`, "Diameter");
    m(`L_s\\coloneq ${num(i.length)}\\mathrm{ft}`, "Length");
    m(ok("24\\mathrm{in}", "D_s"), "CDOT BDM 10.6.1.1");
    text("Side and tip resistance:- by layer as the table above the lateral analysis gives (AASHTO 10.8.3.5: clay α Eq. 10.8.3.5.1b-1, the top 5 ft not counted; sand β Eq. 10.8.3.5.2b-1 with φ' from N160 and σ'p from N60; rock Eq. 10.8.3.5.4b-1; or entered).");
    m(`R_R\\coloneq ${num(r.ax.RR)}\\mathrm{kip}`, "Σφqs·Rs + φqp·Rp");
    const g = r.structural.reduce<(typeof r.structural)[number] | null>((a, b) => (!a || b.Pu > a.Pu ? b : a), null);
    if (g) {
      m(`P_u\\coloneq ${num(g.c.P + 1.25 * r.Wshaft)}\\mathrm{kip}`, `${g.c.name}, with the shaft's weight`);
      m(ok("P_u", "R_R"), "Axial, AASHTO 10.8.3.5");
    }
  }

  function micropile(i: MicropileInputs) {
    const r = designMicropile(i);
    const db = BARS[i.bar]?.dia ?? 2.5;
    m(`f'_{cg}\\coloneq ${num(i.fcGrout)}\\mathrm{ksi}`, "Grout");
    m(`f_{yb}\\coloneq ${num(Math.min(i.barFy, 87))}\\mathrm{ksi}`, "Bar, at most 87 ksi for strain compatibility (C10.9.3.10.2a)");
    m(`f_{yc}\\coloneq ${num(Math.min(i.casingFy, 87))}\\mathrm{ksi}`, "Casing, the same limit");
    m(`A_b\\coloneq ${num(r.Ab)}\\mathrm{in}^{2}`, `#${i.bar} bar (${num(db)} in)`);
    m(`A_c\\coloneq ${num(r.Ac)}\\mathrm{in}^{2}`, `Casing ${num(i.casingOD)} × ${num(i.casingT)} in`);
    m(`A_{gc}\\coloneq ${num(r.AgCased)}\\mathrm{in}^{2}`, "Grout inside the casing");
    m(`A_{gu}\\coloneq ${num(r.AgUncased)}\\mathrm{in}^{2}`, "Grout in the bond zone's hole");
    m("R_{nc}\\coloneq0.85\\cdot\\left(0.85\\cdot f'_{cg}\\cdot A_{gc}+f_{yb}\\cdot A_b+f_{yc}\\cdot A_c\\right)=", "Cased length, AASHTO Eq. 10.9.3.10.2a-2", "kip");
    m("R_{nu}\\coloneq0.85\\cdot\\left(0.85\\cdot f'_{cg}\\cdot A_{gu}+f_{yb}\\cdot A_b\\right)=", "Uncased length, AASHTO Eq. 10.9.3.10.2b-2", "kip");
    m(`d_b\\coloneq ${num(i.holeD)}\\mathrm{in}`, "Drill hole");
    m(`\\alpha_b\\coloneq ${num(r.bond.alpha)}\\mathrm{ksf}`, r.bond.range ? `Nominal bond, AASHTO Table C10.9.3.5.2-1 (FHWA NHI-05-039) Type ${i.grouting}: ${r.bond.range[0]}–${r.bond.range[1]} ksf` : "Nominal bond, load test");
    m(`L_b\\coloneq ${num(i.bond)}\\mathrm{ft}`, "Bond length");
    m("R_s\\coloneq\\pi\\cdot d_b\\cdot\\alpha_b\\cdot L_b=", "AASHTO Eq. 10.9.3.5.2-1", "kip");
    m(`\\phi_g\\coloneq ${num(i.phiBond)}`, "AASHTO Table 10.5.5.2.5-1");
    const c = i.cases.filter((x) => x.limit !== "service").reduce((a, b) => (b.compression > a.compression ? b : a));
    m(`P_c\\coloneq ${num(c.compression)}\\mathrm{kip}`, c.name);
    m(ok("P_c", "\\phi_g\\cdot R_s"), "Bond in compression (tip and plunge length aside)");
    m(ok("P_c", "0.75\\cdot R_{nc}"), "Cased length, φ 0.75 (Table 10.5.5.2.5-2)");
    m(ok("P_c", "0.75\\cdot R_{nu}"), "Uncased length (no plunge transfer counted)");
  }

  function abutment(i: AbutmentInputs) {
    const r = designAbutment(i);
    m(`L_u\\coloneq ${num(i.unitLength)}\\mathrm{ft}`, "Bridge unit length");
    m(`\\alpha_t\\coloneq ${num(i.alpha * 1e6)}\\cdot10^{-6}`, "Per °F");
    m(`T_{hi}\\coloneq ${num(Math.max(0, i.tMax - 60))}`, "°F above the 60 °F base, CDOT BDM 11.3.1");
    m(`T_{lo}\\coloneq ${num(Math.max(0, 60 - i.tMin))}`, "°F below it");
    m(`\\Delta_{cs}\\coloneq ${num(i.csMove)}\\mathrm{in}`, "Creep, shrinkage, elastic shortening");
    m("\\Delta_e\\coloneq\\alpha_t\\cdot\\frac{L_u}{2}\\cdot T_{hi}=", "Expansion from the unit's middle", "in");
    m("\\Delta_c\\coloneq\\alpha_t\\cdot\\frac{L_u}{2}\\cdot T_{lo}+\\Delta_{cs}=", "Contraction", "in");
    if (i.type.startsWith("integral")) {
      m(`\\gamma_{TU}\\coloneq ${num(i.gammaTU)}`, "AASHTO Table 3.4.1-1, deformations");
      m(ok("\\gamma_{TU}\\cdot\\max\\left(\\Delta_e,\\Delta_c\\right)", "2\\mathrm{in}"), "CDOT BDM 11.3.1");
      m(ok("L_u", "460\\mathrm{ft}"), "CDOT BDM Table 11-1");
      m(`\\phi_{bf}\\coloneq ${num(i.backfillPhi)}\\mathrm{deg}`, "Backfill");
      m("K_p\\coloneq\\tan\\left(45\\mathrm{deg}+\\frac{\\phi_{bf}}{2}\\right)^{2}=", "Passive (Rankine), AASHTO 3.11.5.4", "");
      void r;
    }
  }
}
