import type { Line } from "@/lib/calcs/library/templates";
import { checksSummary } from "../checks-summary";
import { COLOR_NOTE, INPUT_COLOR, isInput, num } from "../calc-style";
import type { Figure } from "../figures";
import { BARS, type Bars } from "../walls/cip";
import { designDeck, type DeckInputs } from "./deck";

// A deck design as a Calcs worksheet: the strip analysis's moments as given values (from the
// continuous beam and the trucks placed across the deck), then every design step as live math with
// its AASHTO reference, worked out by Calcs.

const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;

export function deckCalcLines(i: DeckInputs, title: string, figures?: { section?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note") => lines.push({ text: t, ...(style ? { style } : {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const given = (math: string, ref?: string) => lines.push({ math, ...(ref ? { ref } : {}) });
  const r = designDeck(i);
  const kft = "\\frac{\\mathrm{kip}\\cdot\\mathrm{ft}}{\\mathrm{ft}}";

  text(title.toUpperCase(), "heading");
  text("Cast-in-place concrete deck on parallel girders, AASHTO LRFD, by the approximate (equivalent strip) method of 4.6.2.1. Per foot of deck.");
  text(COLOR_NOTE, "note");

  text("Deck", "subheading");
  m(`N_g\\coloneq ${num(i.nGirders)}`, "Girders");
  m(`S\\coloneq ${num(i.S)}\\mathrm{ft}`, "Girder spacing");
  m(`t\\coloneq ${num(i.t)}\\mathrm{in}`, "Slab thickness");
  m(`b_f\\coloneq ${num(i.flange)}\\mathrm{in}`, "Girder top flange");
  given(`W_d\\coloneq ${num(r.geometry.W)}\\mathrm{ft}`, "Deck width");
  if (figures?.section) lines.push({ region: figures.section });
  m(`f'_{c}\\coloneq ${num(i.fc)}\\mathrm{ksi}`);
  m(`f_y\\coloneq ${num(i.fy)}\\mathrm{ksi}`);
  m(`\\gamma_c\\coloneq ${num(i.gammaC)}\\mathrm{kcf}`);
  m("E_c\\coloneq120000\\cdot\\left(\\frac{\\gamma_c}{\\mathrm{kcf}}\\right)^{2}\\cdot\\left(\\frac{f'_{c}}{\\mathrm{ksi}}\\right)^{0.33}\\cdot\\mathrm{ksi}=", "AASHTO Eq. 5.4.2.4-1", "ksi");
  m("n\\coloneq\\frac{29000\\mathrm{ksi}}{E_c}=", "Modular ratio");
  m("f_r\\coloneq0.24\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}=", "AASHTO 5.4.2.6");

  text("Strip analysis (AASHTO 4.6.2.1)", "subheading");
  text(
    `The transverse strip is a continuous beam on rigid supports at the ${i.nGirders} girders, with the overhangs (4.6.2.1.6). Dead loads: the slab (tapering in the overhangs), the barriers, the wearing surface between them${i.utilities ? " and utilities" : ""}. Live load: the 32 kip truck axle (wheels 6 ft apart, 2 ft from the barrier face, trucks 4 ft apart), placed for the largest effect with up to ${r.geometry.lanes} trucks and their multiple presence factors (T. 3.6.1.1.2-1), times 1.33 for dynamic load allowance (3.6.2.1), over the strip width. The largest positive moment in any span, and the largest negative at the design sections ${num(i.dSection)} in from the ${i.nGirders >= 3 ? "interior" : ""} girders' centerlines, govern.`,
    "note",
  );
  m("E_{pos}\\coloneq26\\mathrm{in}+6.6\\cdot\\frac{\\mathrm{in}}{\\mathrm{ft}}\\cdot S=", "Strip width, positive moment, AASHTO T. 4.6.2.1.3-1", "ft");
  m("E_{neg}\\coloneq48\\mathrm{in}+3.0\\cdot\\frac{\\mathrm{in}}{\\mathrm{ft}}\\cdot S=", "Negative moment", "ft");
  given(`M_{DCp}\\coloneq ${num(r.pos.MDC, 8)}${kft}`, `Dead load, at ${num(r.pos.x, 2)} ft (positive)`);
  given(`M_{DWp}\\coloneq ${num(r.pos.MDW, 8)}${kft}`);
  given(`M_{LLp}\\coloneq ${num(r.pos.MLL, 8)}${kft}`, "LL + IM, per foot");
  given(`M_{DCn}\\coloneq ${num(r.neg.MDC, 8)}${kft}`, `Dead load, at ${num(r.neg.x, 2)} ft (negative)`);
  given(`M_{DWn}\\coloneq ${num(r.neg.MDW, 8)}${kft}`);
  given(`M_{LLn}\\coloneq ${num(r.neg.MLL, 8)}${kft}`, "LL + IM, per foot");
  const gp = (v: number, max: number, min: number, sign: 1 | -1) => (sign * v > 0 ? max : min);
  const muPos = `${gp(r.pos.MDC, 1.25, 0.9, 1)}\\cdot M_{DCp}+${gp(r.pos.MDW, 1.5, 0.65, 1)}\\cdot M_{DWp}+1.75\\cdot M_{LLp}`;
  const muNeg = `${gp(r.neg.MDC, 1.25, 0.9, -1)}\\cdot M_{DCn}+${gp(r.neg.MDW, 1.5, 0.65, -1)}\\cdot M_{DWn}+1.75\\cdot M_{LLn}`;
  m(`M_{up}\\coloneq ${muPos}=`, "Strength I, γp to add to the effect (T. 3.4.1-2)", "kip*ft/ft");
  m("M_{sp}\\coloneq M_{DCp}+M_{DWp}+M_{LLp}=", "Service I", "kip*ft/ft");
  m(`M_{un}\\coloneq-\\left(${muNeg}\\right)=`, "Strength I, as a positive number", "kip*ft/ft");
  m("M_{sn}\\coloneq-\\left(M_{DCn}+M_{DWn}+M_{LLn}\\right)=", "Service I", "kip*ft/ft");

  const member = (key: string, name: string, Mu: string, Ms: string, cover: number, bars: Bars) => {
    const bar = BARS[bars.bar];
    text(name, "subheading");
    m(`c_{${key}}\\coloneq ${num(cover)}\\mathrm{in}`, "Cover");
    m(`d_{b${key}}\\coloneq ${num(bar.dia)}\\mathrm{in}`, `#${bars.bar} bars`);
    m(`s_{${key}}\\coloneq ${num(bars.spacing)}\\mathrm{in}`, "Spacing");
    m(`d_{e${key}}\\coloneq t-c_{${key}}-\\frac{d_{b${key}}}{2}=`, "Effective depth", "in");
    m(`A_{s${key}}\\coloneq\\frac{${num(bar.area)}\\mathrm{in}^{2}}{s_{${key}}}=`, "Per foot", "in^2/ft");
    m(`a_{${key}}\\coloneq\\frac{A_{s${key}}\\cdot f_y}{0.85\\cdot f'_{c}}=`, "Stress block (β1 c)", "in");
    m(`M_{r${key}}\\coloneq0.9\\cdot A_{s${key}}\\cdot f_y\\cdot\\left(d_{e${key}}-\\frac{a_{${key}}}{2}\\right)=`, "AASHTO 5.6.3.2", "kip*ft/ft");
    m(ok(Mu, `M_{r${key}}`), "Flexure");
    m(`M_{cr}\\coloneq0.67\\cdot1.6\\cdot f_r\\cdot\\frac{t^{2}}{6}=`, "AASHTO Eq. 5.6.3.3-1", "kip*ft/ft");
    m(ok(`\\min\\left(1.33\\cdot ${Mu},M_{cr}\\right)`, `M_{r${key}}`), "Minimum reinforcement, AASHTO 5.6.3.3");
    m(`\\rho_{${key}}\\coloneq\\frac{A_{s${key}}}{d_{e${key}}}=`);
    m(`k_{${key}}\\coloneq\\sqrt{2\\cdot\\rho_{${key}}\\cdot n+\\left(\\rho_{${key}}\\cdot n\\right)^{2}}-\\rho_{${key}}\\cdot n=`);
    m(`f_{ss${key}}\\coloneq\\frac{${Ms}}{A_{s${key}}\\cdot\\left(1-\\frac{k_{${key}}}{3}\\right)\\cdot d_{e${key}}}=`, "Service steel stress", "ksi");
    m(ok(`f_{ss${key}}`, "0.6\\cdot f_y"), "AASHTO 5.6.7");
    m(`d_{c${key}}\\coloneq c_{${key}}+\\frac{d_{b${key}}}{2}=`, undefined, "in");
    m(`\\beta_{s${key}}\\coloneq1+\\frac{d_{c${key}}}{0.7\\cdot\\left(t-d_{c${key}}\\right)}=`);
    m(`s_{max${key}}\\coloneq\\frac{700\\cdot${i.exposure === 1 ? "1.00" : "0.75"}\\cdot\\frac{\\mathrm{kip}}{\\mathrm{in}}}{\\beta_{s${key}}\\cdot f_{ss${key}}}-2\\cdot d_{c${key}}=`, `Crack control, AASHTO Eq. 5.6.7-1 (Class ${i.exposure})`, "in");
    m(ok(`s_{${key}}`, `s_{max${key}}`), "Bar spacing");
  };
  member("b", "Bottom transverse bars (positive moment)", "M_{up}", "M_{sp}", i.coverBot, i.botBars);
  member("t", "Top transverse bars (negative moment)", "M_{un}", "M_{sn}", i.coverTop, i.topBars);

  text("Longitudinal bars", "subheading");
  const area = (b: Bars) => `\\frac{${num(BARS[b.bar].area)}\\mathrm{in}^{2}}{${num(b.spacing)}\\mathrm{in}}`;
  m(`A_{tl}\\coloneq ${area(i.topLong)}=`, `Top, #${i.topLong.bar} at ${num(i.topLong.spacing)} in`, "in^2/ft");
  m("A_{tr}\\coloneq\\max\\left(\\frac{1.3\\cdot W_d\\cdot t}{2\\cdot\\left(W_d+t\\right)\\cdot f_y}\\cdot\\frac{\\mathrm{kip}}{\\mathrm{in}\\cdot\\mathrm{ft}},0.11\\frac{\\mathrm{in}^{2}}{\\mathrm{ft}}\\right)=", "Shrinkage and temperature, AASHTO Eq. 5.10.6-1", "in^2/ft");
  m(`\\operatorname{if}\\left(A_{tr}\\le A_{tl},\\operatorname{if}\\left(A_{tl}\\le0.6\\frac{\\mathrm{in}^{2}}{\\mathrm{ft}},\\text{OK},\\text{NG}\\right),\\text{NG}\\right)=`, "Between the minimum and 0.60 in²/ft");
  m("S_e\\coloneq S-b_f=", "Effective span (9.7.2.3)", "ft");
  m("p\\coloneq\\min\\left(\\frac{220}{\\sqrt{\\frac{S_e}{\\mathrm{ft}}}},67\\right)=", "Percent of the bottom transverse bars, AASHTO 9.7.3.2");
  m(`A_{bl}\\coloneq ${area(i.botLong)}=`, `Bottom, #${i.botLong.bar} at ${num(i.botLong.spacing)} in`, "in^2/ft");
  m(ok("\\frac{p}{100}\\cdot A_{sb}", "A_{bl}"), "Distribution reinforcement");

  const a = r.applied;
  const p = r.rail?.resistance ?? null;
  if (r.rail) {
    const rl = r.rail;
    text(`Bridge rail: ${rl.rail.name}`, "subheading");
    text(
      `Rail:- CDOT ${rl.rail.name}, worksheet ${rl.rail.sheet}, ${num(rl.rail.height)} in high and ${num(rl.rail.width)} in wide at its base${rl.rail.steel ? `, with ${rl.rail.steel.label}` : ""}; Concrete Class DF (f'c = 4.5 ksi) and ${rl.fy === 100 ? "ASTM A1035CS (Grade 100)" : "stainless (ASTM A955)"} bars. Its section, weight and c.g. are the deck's barrier. It is paid by the foot under item ${rl.rail.payItem}, its concrete, bars${rl.rail.steel ? " and steel" : ""} included.`,
    );
    given(`w_{rail}\\coloneq ${num(rl.weight * 1000)}\\mathrm{plf}`, `${num(rl.area)} in² of concrete${rl.rail.steel ? ` and ${num(rl.rail.steel.lbPerFt)} plf of steel` : ""}`);
    m(`F_t\\coloneq ${num(rl.forces.Ft)}\\mathrm{kip}`, `${rl.choice.testLevel}, AASHTO Table A13.2-1`);
    m(`L_t\\coloneq ${num(rl.forces.Lt)}\\mathrm{ft}`, "Its length of distribution");
    if (p) {
      text("Yield line analysis of the parapet (AASHTO A13.3.1), Mb = 0 (no separate beam at the top), Mc averaged over the wall's height as its bars and thickness vary:", "note");
      m(`H_w\\coloneq ${num(rl.rail.height)}\\mathrm{in}`, "Height of the wall");
      given(`M_w\\coloneq ${num(p.Mw)}\\mathrm{kip}\\cdot\\mathrm{ft}`, "About the vertical axis, the longitudinal bars, each face averaged");
      given(`M_{cw}\\coloneq ${num(p.interior.Mc)}${kft}`, "About the longitudinal axis, averaged over the height");
      m("L_c\\coloneq\\frac{L_t}{2}+\\sqrt{\\left(\\frac{L_t}{2}\\right)^{2}+\\frac{8\\cdot H_w\\cdot M_w}{M_{cw}}}=", "AASHTO Eq. A13.3.1-2", "ft");
      m("R_w\\coloneq\\frac{2}{2\\cdot L_c-L_t}\\cdot\\left(8\\cdot M_w+\\frac{M_{cw}\\cdot L_c^{2}}{H_w}\\right)=", "AASHTO Eq. A13.3.1-1, within a segment", "kip");
      m("\\operatorname{if}\\left(R_w\\ge F_t,\\text{OK},\\text{NG}\\right)=", "For information: the standard is crash tested or designed by Staff Bridge");
    }
  }

  text("Overhang (AASHTO A13.4.1)", "subheading");
  const { case1, case3 } = r.overhang;
  if (p) {
    m("M_c\\coloneq M_{cw}=", "The parapet's Mc as its yield lines take it, averaged over its height (AASHTO A13.4.2, CA13.3.1)", "kip*ft/ft");
    m("T\\coloneq\\frac{R_w}{L_c+2\\cdot H_w}=", "Axial tension, AASHTO Eq. A13.4.2-1", "kip/ft");
  } else {
    m(`M_c\\coloneq ${num(a.Mc)}${kft}`, "The barrier's flexural resistance at its base");
    m(`T\\coloneq ${num(a.T)}\\frac{\\mathrm{kip}}{\\mathrm{ft}}`, "Axial tension, Rw / (Lc + 2H), AASHTO Eq. A13.4.2-1");
  }
  given(`h_1\\coloneq ${num(case1.h, 8)}\\mathrm{in}`, "Overhang depth at the barrier face");
  given(`M_{DC1}\\coloneq ${num(case1.MDC, 8)}${kft}`, "Barrier and slab, about the barrier face");
  given(`M_{DW1}\\coloneq ${num(case1.MDW, 8)}${kft}`);
  m("M_{u1}\\coloneq M_{DC1}+M_{DW1}+M_c=", "Case 1, Extreme Event II", "kip*ft/ft");
  m("A_{s1}\\coloneq A_{st}-\\frac{0.5\\cdot T}{f_y}=", "Top bars less half the tension", "in^2/ft");
  m("d_1\\coloneq h_1-c_t-\\frac{d_{bt}}{2}=", undefined, "in");
  m("M_{r1}\\coloneq1.0\\cdot A_{s1}\\cdot f_y\\cdot\\left(d_1-\\frac{A_{s1}\\cdot f_y}{2\\cdot0.85\\cdot f'_{c}}\\right)=", "φ = 1.0", "kip*ft/ft");
  m(ok("M_{u1}", "M_{r1}"), "Case 1: transverse collision");
  if (r.endCase1) text(`At the rail's ends and joints:- its end zones' closer bars give Mc = ${num(r.endCase1.Mc)} kip·ft/ft and T = ${num(r.endCase1.T)} kip/ft (Eqs. A13.3.1-3, -4), Mu = ${num(r.endCase1.Mu)} against Mr = ${num(r.endCase1.MR)} kip·ft/ft (${r.endCase1.Mu <= r.endCase1.MR ? "OK" : "more top bars or the end diaphragm there"}).`, "note");
  m(`F_v\\coloneq ${num(a.Fv)}\\mathrm{kip}`, "Vertical design force, T. A13.2-1");
  m(`L_v\\coloneq ${num(a.Lv)}\\mathrm{ft}`);
  m(`l_a\\coloneq ${num(a.la)}\\mathrm{ft}`, "Its lever arm, the rail's top to its traffic face");
  m("M_{u2}\\coloneq M_{DC1}+\\frac{F_v\\cdot l_a}{L_v}=", "Case 2, Extreme Event II", "kip*ft/ft");
  m("M_{r2}\\coloneq1.0\\cdot A_{st}\\cdot f_y\\cdot\\left(d_1-\\frac{A_{st}\\cdot f_y}{2\\cdot0.85\\cdot f'_{c}}\\right)=", undefined, "kip*ft/ft");
  m(ok("M_{u2}", "M_{r2}"), "Case 2: vertical collision");
  given(`h_3\\coloneq ${num(case3.h, 8)}\\mathrm{in}`, "Overhang depth at the design section by the girder");
  given(`M_{DC3}\\coloneq ${num(case3.MDC, 8)}${kft}`);
  given(`M_{DW3}\\coloneq ${num(case3.MDW, 8)}${kft}`);
  given(`M_{LL3}\\coloneq ${num(case3.MLL, 8)}${kft}`, case3.lineLoad ? "1.0 klf line load 1 ft from the barrier face, AASHTO 3.6.1.3.4" : "Wheel 1 ft from the barrier face over its strip, 45 + 10X (T. 4.6.2.1.3-1)");
  m(`M_{u3}\\coloneq1.25\\cdot M_{DC3}+1.5\\cdot M_{DW3}+1.75\\cdot${num(case3.m)}\\cdot1.33\\cdot M_{LL3}=`, "Case 3, Strength I", "kip*ft/ft");
  m("d_3\\coloneq h_3-c_t-\\frac{d_{bt}}{2}=", undefined, "in");
  m("M_{r3}\\coloneq0.9\\cdot A_{st}\\cdot f_y\\cdot\\left(d_3-\\frac{A_{st}\\cdot f_y}{2\\cdot0.85\\cdot f'_{c}}\\right)=", undefined, "kip*ft/ft");
  m(ok("M_{u3}", "M_{r3}"), "Case 3: dead and live load");
  lines.push(...checksSummary([{ checks: r.checks }]));
  return lines;
}
