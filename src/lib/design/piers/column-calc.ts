import type { Line } from "@/lib/calcs/library/templates";
import { checksSummary } from "../checks-summary";
import { textTable } from "../svg-table";
import { COLOR_NOTE, INPUT_COLOR, isInput, num } from "../calc-style";
import type { Figure } from "../figures";
import { bar } from "../stm/aashto";
import { designColumn, type ColumnInputs } from "./column";

// A pier column as a Calcs worksheet: the section and its axial resistance, the loads along the
// bridge, slenderness and moment magnification, shear and the bar limits as live math; the
// resistance to axial load with biaxial bending from the strain compatibility analysis as given
// values, each checked live; every case's forces in a table at the end.

const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;

export function columnCalcLines(i: ColumnInputs, title: string, figures?: { section?: Figure; interaction?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note", extra?: { newPage?: boolean; keepWithNext?: boolean }) => lines.push({ text: t, ...(style ? { style } : {}), ...(extra ?? {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const given = (math: string, ref?: string) => lines.push({ math, ...(ref ? { ref } : {}) });
  const r = designColumn(i);
  const s = r.section;
  const W = i.shape === "round" ? i.T : i.W;
  const tie = bar(i.tieBar);
  const link = i.loads === "stm" ? i.link : null;
  const shapeText = i.shape === "round" ? `a ${num(i.T)} in round column` : i.shape === "rectangular" ? `a ${num(i.T)} by ${num(W)} in rectangular column` : `a ${num(i.T)} by ${num(W)} in oblong column (half-round ends)`;

  text(title.toUpperCase(), "heading");
  text(`Purpose:- The design of ${shapeText}, ${num(i.height)} ft from the top of its ${i.base === "footing" ? "footing" : "drilled shaft"} to the cap's soffit, ${s.bars.length} #${i.bar} bars with ${i.transverse === "spiral" ? `a #${i.tieBar} spiral at ${num(i.tieSpacing)} in pitch` : `#${i.tieBar} ties at ${num(i.tieSpacing)} in`}, to AASHTO LRFD.`);
  text(
    `Method:- ${link ? `The column's forces come from the cap's factored load cases, the bent analyzed as a plane frame (the cap a beam on its ${r.n > 1 ? `${r.n} columns` : "column"}, fixed at ${i.base === "footing" ? "the footing" : "the drilled shaft's point of fixity"}), with the loads along the bridge added at the bearings.` : "The column's forces are entered at its top, factored."} Slenderness is by moment magnification (AASHTO 5.6.4.3, 4.5.3.2.2b), and axial load with biaxial bending by strain compatibility with the rectangular stress block (AASHTO 5.6.2, 5.6.4.5).`,
  );
  text(COLOR_NOTE, "note");

  text("Section and axial resistance", "subheading", { newPage: true, keepWithNext: true });
  if (figures?.section) lines.push({ region: figures.section });
  m(`f'_{c}\\coloneq ${num(i.fc)}\\mathrm{ksi}`);
  m(`f_y\\coloneq ${num(i.fy)}\\mathrm{ksi}`);
  given(`A_g\\coloneq ${num(s.Ag)}\\mathrm{in}^{2}`, i.shape === "round" ? "π D² / 4" : i.shape === "rectangular" ? "T × W" : "(T − W) W + π W² / 4");
  m(`n_b\\coloneq ${s.bars.length}`, `#${i.bar} bars`);
  m(`A_b\\coloneq ${num(s.Ab)}\\mathrm{in}^{2}`);
  m("A_{st}\\coloneq n_b\\cdot A_b=", undefined, "in^2");
  m("\\rho_l\\coloneq\\frac{A_{st}}{A_g}=");
  m(ok("\\rho_l", "0.08"), "AASHTO Eq. 5.6.4.2-1");
  m(`\\rho_{min}\\coloneq ${num(r.rhoMin, 4)}`, r.rhoMin < (0.135 * i.fc) / i.fy ? "AASHTO Eq. 5.6.4.2-4 (permanent loads ≤ 0.4 Ag f'c)" : "0.135 f'c / fy, AASHTO Eq. 5.6.4.2-3");
  m(ok("\\rho_{min}", "\\rho_l"), "AASHTO 5.6.4.2");
  m("P_0\\coloneq0.85\\cdot f'_{c}\\cdot\\left(A_g-A_{st}\\right)+f_y\\cdot A_{st}=", "AASHTO Eq. 5.6.4.5-2", "kip");
  m(`P_{rmax}\\coloneq0.75\\cdot ${r.spiral ? "0.85" : "0.80"}\\cdot P_0=`, `AASHTO Eq. 5.6.4.4-${r.spiral ? 2 : 3}, φ = 0.75, ${r.spiral ? "spirally reinforced" : "tied"}`, "kip");
  const Pmax = Math.max(...r.rows.map((x) => x.P));
  m(`P_{umax}\\coloneq ${num(Pmax)}\\mathrm{kip}`, "The largest factored axial load");
  m(ok("P_{umax}", "P_{rmax}"), "AASHTO 5.6.4.4");

  if (link) {
    text("Loads", "subheading", { keepWithNext: true });
    text(`The cap's load cases:- ${link.cases.length} factored cases from the strut-and-tie design "${link.stmName}", every one in both directions the cap turns. Each column's axial load, shear and moment in the cap's plane are from the frame; the column's own weight is added with each case's dead load factor (AASHTO Table 3.4.1-2).`);
    if (link.bridge) {
      const b = link.bridge;
      text("Along the bridge:- the forces reach the pier at its bearings and are shared equally by its columns.");
      if (i.longitudinal.bearings === "fixed") {
        m(`BR\\coloneq ${num(b.braking)}\\mathrm{kip}`, `AASHTO 3.6.4: ${b.brakingBasis}`);
        m(`\\eta_{fix}\\coloneq ${num(i.longitudinal.share)}`, "The share of the bridge's longitudinal forces this pier takes");
        m(`n_c\\coloneq ${r.n}`, "Columns");
        m("BR_c\\coloneq\\frac{BR\\cdot\\eta_{fix}}{n_c}=", "Each column", "kip");
        m(`L_{br}\\coloneq ${num(b.length)}\\mathrm{ft}`, "The superstructure's length");
        m(`c_L\\coloneq ${r.long.coefLong}`, r.long.simplified ? "AASHTO 3.8.1.2.3a, the usual girder bridge" : "AASHTO Table 3.8.1.2.3a-1, girders, 60°");
        if (b.lineIII !== null) {
          m(`w_{III}\\coloneq ${num(b.lineIII)}\\frac{\\mathrm{kip}}{\\mathrm{ft}}`, "Transverse wind on the superstructure, Strength III, AASHTO 3.8.1.2");
          m("WS_{3}\\coloneq\\frac{c_L\\cdot w_{III}\\cdot L_{br}\\cdot\\eta_{fix}}{n_c}=", "Longitudinal, each column", "kip");
        }
        m(`w_{V}\\coloneq ${num(b.lineV)}\\frac{\\mathrm{kip}}{\\mathrm{ft}}`, "Strength V");
        m("WS_{5}\\coloneq\\frac{c_L\\cdot w_{V}\\cdot L_{br}\\cdot\\eta_{fix}}{n_c}=", "Longitudinal, each column", "kip");
        m("WL_c\\coloneq\\frac{0.04\\frac{\\mathrm{kip}}{\\mathrm{ft}}\\cdot L_{br}\\cdot\\eta_{fix}}{n_c}=", "AASHTO 3.8.1.3", "kip");
        m(`\\Delta_T\\coloneq ${num(i.longitudinal.dT)}`, "Uniform temperature change, °F, AASHTO 3.12.2");
        m(`x_T\\coloneq ${num(i.longitudinal.distance)}\\mathrm{ft}`, "The pier from the point of no movement");
        m("\\delta_T\\coloneq6\\cdot10^{-6}\\cdot\\Delta_T\\cdot x_T=", "α = 6×10⁻⁶ /°F, AASHTO 5.4.2.2", "in");
        given(`k_c\\coloneq ${num(r.long.kCol)}\\frac{\\mathrm{kip}}{\\mathrm{in}}`, "Each column: 3 EI / h³ to the bearings, EI = 0.4 Ec Ig (AASHTO Eq. 5.6.4.3-2)");
        m("TU_c\\coloneq k_c\\cdot\\delta_T=", "Each column", "kip");
      } else m(`TU_c\\coloneq ${num(i.longitudinal.bearingForce / r.n)}\\mathrm{kip}`, "Each column: the expansion bearings' force");
      m(`\\gamma_{TU}\\coloneq ${num(i.longitudinal.gammaTU)}`, "AASHTO Table 3.4.1-1, force effects");
      text("Each case adds its share along the bridge:- BR with the live load's factor (1.75 in Strength I, 1.35 in Strength V), WS with 1.0 in Strength III and V, WL with 1.0 in Strength V, and TU with γTU in every case.");
      if (r.pz.III > 0 || r.pz.V > 0) text(`Wind on the column:- PZ = 2.56×10⁻⁶ V² Kz G CD with CD = 1.6 (AASHTO Table 3.8.1.2.1-2): ${num(r.pz.III)} ksf in Strength III and ${num(r.pz.V)} ksf in Strength V, on its face above the ground, across the bridge with the cap's wind and ${r.long.coefLong} of it along the bridge.`);
    }
  }

  text("Slenderness (AASHTO 5.6.4.3, 4.5.3.2.2b)", "subheading", { keepWithNext: true });
  m(`L_u\\coloneq ${num(i.height)}\\mathrm{ft}`, "The column's clear height");
  m(`E_c\\coloneq ${num(r.Ec)}\\mathrm{ksi}`, "AASHTO Eq. 5.4.2.4-1");
  for (const sl of r.slender) {
    const ax = sl.ax === "T" ? "T" : "L";
    m(`K_{${ax}}\\coloneq ${num(sl.K)}`, `${sl.ax === "T" ? "Across" : "Along"} the bridge, unbraced, AASHTO 4.6.2.5`);
    m(`r_{${ax}}\\coloneq ${num(sl.r)}\\mathrm{in}`, i.shape === "round" ? "0.25 D, AASHTO 5.6.4.3" : i.shape === "rectangular" ? "0.30 times the dimension, AASHTO 5.6.4.3" : "√(Ig / Ag)");
    m(`\\lambda_{${ax}}\\coloneq\\frac{K_{${ax}}\\cdot L_u}{r_{${ax}}}=`, "Slenderness ratio");
    m(ok(`\\lambda_{${ax}}`, "100"), "The approximate method, AASHTO 5.6.4.3");
    if (sl.neglect) text(`${sl.ax === "T" ? "Across" : "Along"} the bridge:- Kℓu/r is below 22, so slenderness is neglected (AASHTO 5.6.4.3).`, "note");
    else {
      given(`I_{g${ax}}\\coloneq ${num(sl.Ig)}\\mathrm{in}^{4}`);
      given(`I_{s${ax}}\\coloneq ${num(sl.Is)}\\mathrm{in}^{4}`);
      m(`EI_{${ax}}\\coloneq\\max\\left(\\frac{E_c\\cdot I_{g${ax}}}{5}+29000\\mathrm{ksi}\\cdot I_{s${ax}},\\frac{E_c\\cdot I_{g${ax}}}{2.5}\\right)=`, "AASHTO Eqs. 5.6.4.3-1, -2, before 1 + βd", "kip*in^2");
      m(`P_{e${ax}}\\coloneq\\frac{\\pi^{2}\\cdot EI_{${ax}}}{\\left(K_{${ax}}\\cdot L_u\\right)^{2}}=`, "AASHTO Eq. 4.5.3.2.2b-5, βd = 0", "kip");
    }
  }
  text("Each case's magnifier:- δs = 1 / (1 − ΣPu / (0.75 ΣPe)) over the bent's columns (AASHTO Eq. 4.5.3.2.2b-4), applied to the whole moment, with EI divided by 1 + βd, βd the share of the moment from the permanent loads.", "note");

  text("Axial load and biaxial bending (AASHTO 5.6.4.5)", "subheading", { keepWithNext: true });
  text(`By strain compatibility:- εcu = 0.003, β1 = ${num(s.beta1)}, the bars elastic–plastic; at each case's factored axial load, the neutral axis turned until the resisting moment points the way the magnified moments do; φ from the net tensile strain (AASHTO 5.5.4.2).`);
  if (figures?.interaction) lines.push({ region: figures.interaction });
  const gov = r.checks.filter((c) => c.id.startsWith("pm-"));
  gov.forEach((c, k) => {
    const row = r.rows.find((x) => x.case === c.note && Math.abs(x.Mu - c.demand) < 1e-6)!;
    if (!row) return;
    const j = k + 1;
    text(`${c.name.split(":")[0]}:- ${row.case}${r.n > 1 ? `, column ${row.column + 1}` : ""}.`, undefined, { keepWithNext: true });
    given(`P_{u${j}}\\coloneq ${num(row.P)}\\mathrm{kip}`);
    given(`M_{T${j}}\\coloneq ${num(Math.abs(row.MT))}\\mathrm{kip}\\cdot\\mathrm{ft}`, "Across the bridge, first order");
    given(`M_{L${j}}\\coloneq ${num(Math.abs(row.ML))}\\mathrm{kip}\\cdot\\mathrm{ft}`, "Along the bridge, first order");
    given(`\\delta_{T${j}}\\coloneq ${num(row.dT)}`);
    given(`\\delta_{L${j}}\\coloneq ${num(row.dL)}`);
    m(`M_{u${j}}\\coloneq\\sqrt{\\left(\\delta_{T${j}}\\cdot M_{T${j}}\\right)^{2}+\\left(\\delta_{L${j}}\\cdot M_{L${j}}\\right)^{2}}=`, undefined, "kip*ft");
    given(`M_{r${j}}\\coloneq ${num(row.phiMn)}\\mathrm{kip}\\cdot\\mathrm{ft}`, `φMn at Pu${j} in the moment's direction, φ = ${num(row.phi)}`);
    m(ok(`M_{u${j}}`, `M_{r${j}}`), "AASHTO 5.6.4.5");
  });

  text("Shear (AASHTO 5.7.3.3, simplified: β = 2, θ = 45°)", "subheading", { keepWithNext: true });
  m(`s_t\\coloneq ${num(i.tieSpacing)}\\mathrm{in}`, `#${i.tieBar} ${i.transverse === "spiral" ? "spiral pitch" : "ties"}`);
  for (const ax of ["T", "L"] as const) {
    const sh = r.shear[ax];
    const Vu = r.checks.find((c) => c.id === `shear-${ax}`)!.demand;
    text(`${ax === "T" ? "Across" : "Along"} the bridge:-`, undefined, { keepWithNext: true });
    m(`b_{v${ax}}\\coloneq ${num(sh.bv)}\\mathrm{in}`);
    m(`d_{v${ax}}\\coloneq ${num(sh.dv)}\\mathrm{in}`, "max(0.9 de, 0.72 h), AASHTO 5.7.2.8");
    m(`A_{v${ax}}\\coloneq ${sh.legs}\\cdot ${num(tie.area)}\\mathrm{in}^{2}=`, `${sh.legs} legs`, "in^2");
    m(`V_{c${ax}}\\coloneq0.0316\\cdot2\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot b_{v${ax}}\\cdot d_{v${ax}}=`, "AASHTO Eq. 5.7.3.3-3", "kip");
    m(`V_{s${ax}}\\coloneq\\frac{A_{v${ax}}\\cdot f_y\\cdot d_{v${ax}}}{s_t}=`, "AASHTO Eq. 5.7.3.3-4", "kip");
    m(`V_{n${ax}}\\coloneq\\min\\left(V_{c${ax}}+V_{s${ax}},0.25\\cdot f'_{c}\\cdot b_{v${ax}}\\cdot d_{v${ax}}\\right)=`, "AASHTO Eqs. 5.7.3.3-1, -2", "kip");
    m(`V_{u${ax}}\\coloneq ${num(Vu)}\\mathrm{kip}`, "The largest factored shear");
    m(ok(`V_{u${ax}}`, `0.9\\cdot V_{n${ax}}`), "AASHTO 5.7.3.3");
    m(ok(`0.0316\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot\\frac{b_{v${ax}}\\cdot s_t}{f_y}`, `A_{v${ax}}`), "Minimum transverse reinforcement, AASHTO Eq. 5.7.2.5-1");
  }

  text("Transverse reinforcement", "subheading", { keepWithNext: true });
  if (r.spiralRatio) {
    const sp = r.spiralRatio;
    text("Spirally reinforced or tied:- a spiral counts as one only with the volumetric ratio of Eq. 5.6.4.6-1; otherwise it is a continuously wound tie and the column is designed as tied.", undefined, { keepWithNext: true });
    m(`D_c\\coloneq ${num(sp.Dc)}\\mathrm{in}`, "Core, to the spiral's outside");
    m(`A_c\\coloneq ${num(sp.Ac)}\\mathrm{in}^{2}`, "Core area");
    m(`A_{sp}\\coloneq ${num(tie.area)}\\mathrm{in}^{2}`, `#${i.tieBar}`);
    m("\\rho_s\\coloneq\\frac{4\\cdot A_{sp}}{D_c\\cdot s_t}=", "Spiral's volumetric ratio");
    m("\\rho_{sreq}\\coloneq0.45\\cdot\\left(\\frac{A_g}{A_c}-1\\right)\\cdot\\frac{f'_{c}}{f_y}=", "AASHTO Eq. 5.6.4.6-1");
    m("\\operatorname{if}\\left(\\rho_s\\ge\\rho_{sreq},\\text{spiral},\\text{tied}\\right)=", "AASHTO 5.6.4.4");
  }
  if (r.hinge) text(`Hinge regions (Seismic Zone 1, SD1 ≥ 0.10):- ${num(r.hinge.spacing)} in spacing over ${num(Math.ceil(r.hinge.length))} in from each end, the larger of the largest dimension, a sixth of the clear height and 18 in (AASHTO 5.11.4.1.3).`);
  for (const c of r.checks.filter((x) => /^(spiral-[spc]|tie|bar-|seis-)/.test(x.id))) text(`${c.name}:- ${num(c.demand)} against ${num(c.capacity)}${c.unit ? ` ${c.unit}` : ""}, ${c.ok ? "OK" : "NG"} (${c.ref}).`);

  if (r.collision) {
    const ct = r.checks.filter((c) => c.id.startsWith("ct-"));
    text("Vehicle collision, Extreme Event II (AASHTO 3.6.5.1)", "subheading", { keepWithNext: true });
    text(`Collision:- ${num(i.collision.CT)} kip at 2.0 and 5.0 ft above the ground, whichever is critical, from 0° to 15° with the roadway below, which runs ${i.collision.traffic === "T" ? "across" : "along"} the bridge; the permanent loads at 1.25 and 0.90; resistance factors 1.0 (AASHTO 1.3.2.1).`);
    for (const c of ct) text(`${c.name}:- ${num(c.demand)} ${c.unit} against ${num(c.capacity)} ${c.unit}, ${c.ok ? "OK" : "NG"} (${c.ref})${c.note ? `, ${c.note}` : ""}.`);
  }

  for (const n2 of r.notes) text(n2, "note");

  text("Appendix:- every case's forces", "subheading", { newPage: true, keepWithNext: true });
  text("Factored axial load, first-order moments across and along the bridge, the magnifiers, the magnified moment and the moment resistance at that axial load, at the base and under the cap of each column.", "note");
  const all = [...r.rows, ...(r.collision?.rows ?? [])];
  const cols = [
    { title: "Case", x: 4 },
    { title: "Col.", x: 300 },
    { title: "At", x: 326 },
    { title: "Pu", x: 392, anchor: "end" as const },
    { title: "MT", x: 440, anchor: "end" as const },
    { title: "ML", x: 488, anchor: "end" as const },
    { title: "δT/δL", x: 536, anchor: "end" as const },
    { title: "Mu", x: 584, anchor: "end" as const },
    { title: "φMn", x: 636, anchor: "end" as const },
  ];
  const fmt0 = (v: number) => (Number.isFinite(v) ? v.toFixed(0) : "∞");
  for (let k = 0; k < all.length; k += 40) {
    const chunk = all.slice(k, k + 40);
    lines.push({ region: textTable(cols, chunk.map((x) => [x.case.length > 52 ? `${x.case.slice(0, 50)}…` : x.case, String(x.column + 1), x.where, fmt0(x.P), fmt0(Math.abs(x.MT)), fmt0(Math.abs(x.ML)), `${x.dT.toFixed(2)}/${x.dL.toFixed(2)}`, fmt0(x.Mu), fmt0(x.phiMn)]), 644) });
  }
  lines.push(...checksSummary([{ checks: r.checks }]));
  return lines;
}
