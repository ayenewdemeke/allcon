import type { Line } from "@/lib/calcs/library/templates";
import { COLOR_NOTE, INPUT_COLOR, isInput } from "../calc-style";
import { BARS } from "../walls/cip";
import { designZone1, type Zone1Inputs } from "./zone1";

// Seismic Zone 1 requirements as a Calcs worksheet: inputs as definitions and every step as live
// math with its AASHTO reference.

const num = (v: number) => String(+v.toFixed(6));
const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;

export function zone1CalcLines(i: Zone1Inputs, title: string): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note") => lines.push({ text: t, ...(style ? { style } : {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const r = designZone1(i);

  text(title.toUpperCase(), "heading");
  text("Seismic requirements for a bridge in Seismic Zone 1, AASHTO LRFD: no seismic analysis is required (4.7.4.1), but the connection forces, support lengths and, where SD1 > 0.10, confinement of the columns' plastic hinge regions are.");
  text(COLOR_NOTE, "note");

  text("Seismic zone (AASHTO 3.10.6)", "subheading");
  m(`A_S\\coloneq ${num(i.As)}`, "Fpga PGA, from the geotechnical engineer");
  m(`S_{D1}\\coloneq ${num(i.SD1)}`, "F_v S1");
  m(ok("S_{D1}", "0.15"), "Seismic Zone 1, AASHTO T. 3.10.6-1");

  text("Horizontal design connection forces (AASHTO 3.10.9.2)", "subheading");
  m(`\\gamma_{EQ}\\coloneq ${num(i.gammaEQ)}`, "Live load in Extreme Event I, AASHTO T. 3.4.1-1");
  m(`k_c\\coloneq ${i.As < 0.05 ? "0.15" : "0.25"}`, i.As < 0.05 ? "As < 0.05: 0.15 × the reaction" : "As ≥ 0.05: 0.25 × the reaction");
  i.supports.forEach((s, k) => {
    m(`R_{${k + 1}}\\coloneq ${num(s.DL)}\\mathrm{kip}+\\gamma_{EQ}\\cdot ${num(s.LL)}\\mathrm{kip}=`, `${s.name}: permanent reaction, plus live load`, "kip");
  });
  const all = i.supports.map((_, k) => `R_{${k + 1}}`).join("+");
  m(`R_{tot}\\coloneq ${all}=`, "The whole superstructure", "kip");
  const fixed = i.supports.map((s, k) => (s.fixedLong ? k : -1)).filter((k) => k >= 0);
  const nLong = fixed.reduce((n, k) => n + i.supports[k].bearings, 0);
  if (nLong) {
    m(`n_L\\coloneq ${nLong}`, `Bearings restraining it longitudinally (${fixed.map((k) => i.supports[k].name).join(", ")})`);
    m("F_L\\coloneq\\frac{k_c\\cdot R_{tot}}{n_L}=", "Longitudinal force per restraining bearing", "kip");
  } else text("Nothing restrains the superstructure longitudinally: provide a restraint.", "note");
  i.supports.forEach((s, k) => {
    if (s.fixedTrans) m(`F_{T${k + 1}}\\coloneq\\frac{k_c\\cdot R_{${k + 1}}}{${s.bearings}}=`, `${s.name}: transverse force per bearing (${s.bearings} bearings)`, "kip");
  });
  text("Every connection whose failure could cause loss of support (girder to sole plate, anchor bolts and their anchorage) resists these forces (C3.10.9.2).", "note");

  const exp = i.supports.map((s, k) => ({ s, k })).filter(({ s }) => !s.fixedLong);
  if (exp.length) {
    text("Minimum support length (AASHTO 4.7.4.4)", "subheading");
    m(`p_N\\coloneq ${num(r.percent * 100)}`, "Percent of N, AASHTO T. 4.7.4.4-1");
    for (const { s, k } of exp) {
      m(`N_{${k + 1}}\\coloneq\\left(8+0.02\\cdot ${num(s.L)}+0.08\\cdot ${num(s.H)}\\right)\\cdot\\left(1+0.000125\\cdot ${num(s.skew)}^{2}\\right)\\cdot\\mathrm{in}=`, `${s.name}: L = ${num(s.L)} ft, H = ${num(s.H)} ft, skew ${num(s.skew)}°, AASHTO Eq. 4.7.4.4-1`, "in");
      m(ok(`\\frac{p_N}{100}\\cdot N_{${k + 1}}`, `${num(s.provided)}\\mathrm{in}`), `${s.name}: support length provided`);
    }
  }

  if (r.confine && i.columns.length) {
    text("Confinement of plastic hinge regions (AASHTO 5.11.2, 5.11.4.1.4, 5.11.4.1.5)", "subheading");
    text("SD1 > 0.10: spirals in the plastic hinge regions at the top and bottom of each column. The ratio may not be less than either 5.6.4.6's or 0.12 f'c/fy, so the larger governs.", "note");
    i.columns.forEach((c, k) => {
      const j = k + 1;
      const bar = BARS[c.bar];
      m(`D_{${j}}\\coloneq ${num(c.D)}\\mathrm{in}`, c.name);
      m(`D_{c${j}}\\coloneq D_{${j}}-2\\cdot ${num(c.cover)}\\mathrm{in}=`, "Core, to the outside of the spiral", "in");
      m(`A_{g${j}}\\coloneq\\frac{\\pi\\cdot D_{${j}}^{2}}{4}=`, undefined, "in^2");
      m(`A_{c${j}}\\coloneq\\frac{\\pi\\cdot D_{c${j}}^{2}}{4}=`, undefined, "in^2");
      m(`\\rho_{a${j}}\\coloneq0.45\\cdot\\left(\\frac{A_{g${j}}}{A_{c${j}}}-1\\right)\\cdot\\frac{${num(c.fc)}}{${num(c.fy)}}=`, "AASHTO Eq. 5.6.4.6-1");
      m(`\\rho_{b${j}}\\coloneq0.12\\cdot\\frac{${num(c.fc)}}{${num(c.fy)}}=`, "AASHTO Eq. 5.11.4.1.4-1");
      m(`s_{${j}}\\coloneq ${num(c.pitch)}\\mathrm{in}`, `#${c.bar} spiral pitch`);
      m(`d_{s${j}}\\coloneq D_{c${j}}-${num(bar.dia)}\\mathrm{in}=`, "Spiral centerline diameter", "in");
      m(`\\rho_{s${j}}\\coloneq\\frac{4\\cdot ${num(bar.area)}\\mathrm{in}^{2}}{d_{s${j}}\\cdot s_{${j}}}=`, "Provided");
      m(ok(`\\max\\left(\\rho_{a${j}},\\rho_{b${j}}\\right)`, `\\rho_{s${j}}`), "Spiral ratio");
      m(ok(`s_{${j}}`, `\\min\\left(\\frac{D_{${j}}}{4},4\\mathrm{in}\\right)`), "Pitch, AASHTO 5.11.4.1.5");
      m(`L_{h${j}}\\coloneq\\max\\left(D_{${j}},\\frac{${num(c.height)}\\mathrm{ft}}{6},18\\mathrm{in}\\right)=`, "Length confined at each end, AASHTO 5.11.4.1.5", "ft");
    });
    text("Splice spirals in the hinge regions by full welds or full mechanical connections, not laps (5.11.4.1.4).", "note");
  }
  return lines;
}
