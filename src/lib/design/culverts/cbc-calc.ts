import type { Line } from "@/lib/calcs/library/templates";
import { COLOR_NOTE, INPUT_COLOR, isInput } from "../calc-style";
import type { Figure } from "../figures";
import { BARS } from "../walls/cip";
import { CASES, combos, designCbc, type CaseId, type CbcInputs, type Face } from "./cbc";

// A box culvert design as a Calcs worksheet: the loads as live math, the frame analysis's
// unfactored moments at each governing section (the one step Calcs can't do), then the load
// combinations and every check worked out live (AASHTO LRFD 12.11).
// Moments per foot strip in kip·in, steel in in² per foot (b = 12 in).

const num = (v: number, d = 6) => String(+v.toFixed(d));
const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;
/** A load factor with its η: 1.30·η, 0.90/η, or a number. */
function factorTex(f: number, eta: number) {
  for (const base of [1.3, 1.35]) if (Math.abs(f - base * eta) < 1e-12 && eta !== 1) return `${base.toFixed(2)}\\cdot\\eta`;
  if (Math.abs(f - 0.9 / eta) < 1e-12 && eta !== 1) return "\\frac{0.90}{\\eta}";
  return num(f);
}
const CASE_TEX: Record<CaseId | "LL", string> = { DC: "DC", EV: "EV", EHmax: "EHx", EHmin: "EHn", LS: "LS", WA: "WA", LL: "LL" };

export function cbcCalcLines(i: CbcInputs, title: string, figures?: { section?: Figure; moments?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note") => lines.push({ text: t, ...(style ? { style } : {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  /** A value from the analysis (not entered): not in the inputs' color. */
  const given = (math: string, ref?: string) => lines.push({ math, ...(ref ? { ref } : {}) });

  const r = designCbc(i);
  const n = r.model.n;
  const ll = r.live;
  const C = combos(i.eta);

  text(title.toUpperCase(), "heading");
  text(
    `Reinforced concrete box culvert, ${n === 1 ? "single cell" : `${n} cells`}, per foot of barrel. AASHTO LRFD Bridge Design Specifications (9th ed.) Section 12.11, ${i.construction === "precast" ? "precast" : "cast in place"}, reinforced with ${i.reinf === "bars" ? "bars" : "welded wire"}. Moments are positive with tension on the inside face of a cell; thrust is positive in compression.`,
  );

  text(COLOR_NOTE, "note");

  // --- materials and geometry ------------------------------------------------------------------
  text("Materials", "subheading");
  m(`\\gamma_c\\coloneq ${num(i.gammaC)}\\mathrm{kcf}`, "Reinforced concrete");
  m(`\\gamma_s\\coloneq ${num(i.gammaS)}\\mathrm{kcf}`, "Fill");
  m(`\\gamma_w\\coloneq ${num(i.gammaW)}\\mathrm{kcf}`, "Water");
  m(`f'_{c}\\coloneq ${num(i.fc)}\\mathrm{ksi}`);
  m(`f_y\\coloneq ${num(i.fy)}\\mathrm{ksi}`, i.reinf === "bars" ? "Reinforcing bars" : "Welded wire reinforcement");
  m(`E_s\\coloneq ${num(i.Es)}\\mathrm{ksi}`);
  m("\\beta_1\\coloneq\\max\\left(0.65,\\min\\left(0.85,0.85-0.05\\cdot\\frac{f'_{c}-4\\mathrm{ksi}}{\\mathrm{ksi}}\\right)\\right)=", "AASHTO 5.6.2.2");
  m(`c_{c}\\coloneq ${num(i.cover)}\\mathrm{in}`, "Clear cover");
  if (i.reinf === "wwr") {
    m(`d_w\\coloneq ${num(i.dw)}\\mathrm{in}`, "Welded wire diameter");
    m(`s_w\\coloneq ${num(i.spacing)}\\mathrm{in}`, "Welded wire spacing");
  }
  given("b\\coloneq12\\mathrm{in}", "Design strip");
  given("w\\coloneq1\\mathrm{ft}", "Strip width, for klf");

  text("Geometry", "subheading");
  m(`S\\coloneq ${num(i.span)}\\mathrm{ft}`, n > 1 ? "Clear span of each cell" : "Clear span");
  m(`R\\coloneq ${num(i.rise)}\\mathrm{ft}`, "Clear rise");
  m(`T_t\\coloneq ${num(i.Tt)}\\mathrm{in}`, "Top slab");
  m(`T_b\\coloneq ${num(i.Tb)}\\mathrm{in}`, "Bottom slab");
  m(`T_s\\coloneq ${num(i.Ts)}\\mathrm{in}`, "Exterior walls");
  if (n > 1) m(`T_i\\coloneq ${num(i.Ti)}\\mathrm{in}`, "Interior walls");
  m(`T_h\\coloneq ${num(i.haunch)}\\mathrm{in}`, "Haunches, 45°");
  m(`H\\coloneq ${num(i.fill)}\\mathrm{ft}`, "Fill over the top slab");
  m(`n_c\\coloneq ${n}`, "Cells");
  m(n > 1 ? "B_c\\coloneq n_c\\cdot S+2\\cdot T_s+\\left(n_c-1\\right)\\cdot T_i=" : "B_c\\coloneq S+2\\cdot T_s=", "Outside width", "ft");
  m(n > 1 ? "B\\coloneq B_c-T_s=" : "B\\coloneq S+T_s=", "Between the exterior walls' centerlines (the frame)", "ft");

  if (figures?.section) lines.push({ region: figures.section });

  // --- loads -----------------------------------------------------------------------------------
  text("Dead load (DC)", "subheading");
  text("The top slab carries its own weight; the walls' and haunches' weights reach the bottom slab, which the soil holds up with a uniform pressure. The bottom slab's own weight goes straight to the soil.", "note");
  m("DC_{top}\\coloneq\\gamma_c\\cdot T_t\\cdot w=", "On the top slab", "klf");
  m("DC_{h}\\coloneq\\frac{1}{2}\\cdot T_h^{2}\\cdot\\gamma_c\\cdot w=", "One haunch", "kip");
  m(n > 1 ? "DC_{w}\\coloneq\\left(2\\cdot T_s+\\left(n_c-1\\right)\\cdot T_i\\right)\\cdot\\left(R+\\frac{T_t+T_b}{2}\\right)\\cdot\\gamma_c\\cdot w=" : "DC_{w}\\coloneq2\\cdot T_s\\cdot\\left(R+\\frac{T_t+T_b}{2}\\right)\\cdot\\gamma_c\\cdot w=", "The walls", "kip");
  m("DC_{bot}\\coloneq\\frac{DC_{top}\\cdot B+4\\cdot n_c\\cdot DC_{h}+DC_{w}}{B}=", "Soil reaction under the bottom slab", "klf");

  text("Earth (EV, EH)", "subheading");
  m(`F_e\\coloneq\\min\\left(1+0.20\\cdot\\frac{H}{B_c},${i.compactedSides ? "1.15" : "1.40"}\\right)=`, `Embankment, AASHTO Eq. 12.11.2.2.1-2 (${i.compactedSides ? "compacted" : "uncompacted"} fill at the sides)`);
  m("EV\\coloneq F_e\\cdot\\gamma_s\\cdot H\\cdot w=", "AASHTO Eq. 12.11.2.2.1-1", "klf");
  m(`\\gamma_{EHx}\\coloneq ${num(i.efwMax * 1000)}\\mathrm{pcf}`, "At-rest equivalent fluid, max (AASHTO 3.11.5.5)");
  m(`\\gamma_{EHn}\\coloneq ${num(i.efwMin * 1000)}\\mathrm{pcf}`, "Min (submerged, half), AASHTO 3.11.7");
  m("H_2\\coloneq H+T_t+R+T_b=", "To the bottom of the box", "ft");
  m("EH_{xt}\\coloneq\\gamma_{EHx}\\cdot H\\cdot w=", "Top", "klf");
  m("EH_{xb}\\coloneq\\gamma_{EHx}\\cdot H_2\\cdot w=", "Bottom", "klf");
  m("EH_{nt}\\coloneq\\gamma_{EHn}\\cdot H\\cdot w=", undefined, "klf");
  m("EH_{nb}\\coloneq\\gamma_{EHn}\\cdot H_2\\cdot w=", undefined, "klf");

  text("Live load surcharge (LS)", "subheading");
  m(`k_a\\coloneq ${num(i.ka)}`, "Lateral earth pressure coefficient, AASHTO 3.11.6.4");
  given(`h_{eq1}\\coloneq ${num(r.loads.heq1, 4)}\\mathrm{ft}`, "At H, AASHTO T. 3.11.6.4-1 (interpolated)");
  given(`h_{eq2}\\coloneq ${num(r.loads.heq2, 4)}\\mathrm{ft}`, "At H2");
  m("LS_t\\coloneq k_a\\cdot\\gamma_s\\cdot h_{eq1}\\cdot w=", "Top, AASHTO Eq. 3.11.6.4-1", "klf");
  m("LS_b\\coloneq k_a\\cdot\\gamma_s\\cdot h_{eq2}\\cdot w=", "Bottom", "klf");
  if (i.water) {
    text("Water (WA)", "subheading");
    m("WA_b\\coloneq\\gamma_w\\cdot R\\cdot w=", "Inside, at the bottom; the culvert full", "klf");
  }

  if (i.liveLoad) {
    text("Vehicular live load (LL + IM)", "subheading");
    m(`D_E\\coloneq H`);
    m("I_M\\coloneq\\max\\left(0,33\\cdot\\left(1-0.125\\cdot\\frac{D_E}{\\mathrm{ft}}\\right)\\right)\\cdot\\frac{1}{100}=", "AASHTO Eq. 3.6.2.2-1");
    m(`m_p\\coloneq ${num(i.mpf)}`, "One lane, AASHTO 3.6.1.1.2");
    m(`F_{LL}\\coloneq ${num(i.lldf)}`, "AASHTO 3.6.1.2.6");
    if (ll.shallow) {
      text("Under less than 2 ft of fill: the axle spread by the strip method, traffic parallel to the span (AASHTO 4.6.2.10).", "note");
      m("W\\coloneq\\left(96+1.44\\cdot\\frac{S}{\\mathrm{ft}}\\right)\\cdot\\mathrm{in}=", "AASHTO Eq. 4.6.2.10.2-1", "ft");
      m("L_1\\coloneq10\\mathrm{in}+F_{LL}\\cdot H=", "AASHTO Eq. 4.6.2.10.2-2", "ft");
    } else {
      text("The wheels' footprints spread through the fill (AASHTO 3.6.1.2.6); where an axle group's footprints overlap they share one area.", "note");
      m("W\\coloneq6\\mathrm{ft}+20\\mathrm{in}+F_{LL}\\cdot H=", "Across the span", "ft");
      m("L_1\\coloneq10\\mathrm{in}+F_{LL}\\cdot H=", "Along the span, one axle", "ft");
    }
    m(r.live.Lp > 14 ? "w_{tr}\\coloneq\\frac{72\\mathrm{kip}\\cdot m_p\\cdot\\left(1+I_M\\right)}{W\\cdot\\left(28\\mathrm{ft}+L_1\\right)}=" : "w_{tr}\\coloneq\\frac{32\\mathrm{kip}\\cdot m_p\\cdot\\left(1+I_M\\right)}{W\\cdot L_1}=", r.live.Lp > 14 ? "HL-93 truck, its axles' footprints overlapping" : "HL-93 truck, the 32 kip axle", "ksf");
    m(`w_{td}\\coloneq\\frac{50\\mathrm{kip}\\cdot m_p\\cdot\\left(1+I_M\\right)}{W\\cdot ${r.live.Lp > 4 ? "\\left(4\\mathrm{ft}+L_1\\right)" : "2\\cdot L_1"}}=`, "HL-93 tandem", "ksf");
    if (ll.lane) m(`w_{ln}\\coloneq\\frac{0.64\\mathrm{klf}\\cdot m_p}{10\\mathrm{ft}${ll.shallow ? "" : "+F_{LL}\\cdot H"}}=`, "Lane load (spans of 15 ft or more), no IM", "ksf");
    text("The truck (both ways) and the tandem are moved across the top slab; the soil's reaction under the bottom slab balances them (uniform or linear). The extreme moments at each section are kept.", "note");
  }

  text("Analysis", "subheading");
  text(
    `A 2D plane frame on the members' centerlines, ${r.model.elements.length} elements, the haunches deepening the members near each corner; pinned at one bottom corner and on a roller at the other, every load balanced by the soil's reaction. Its unfactored moments, shears and thrusts at the governing sections are given below.`,
    "note",
  );
  text("Load combinations, AASHTO Tables 3.4.1-1 and 3.4.1-2 (EH at its minimum: half, 3.11.7):", "note");
  text(C.map((c) => `${c.name}: ${(["DC", "EV", "LL", "EHmax", "EHmin", "LS", "WA"] as const).filter((k) => c.f[k]).map((k) => `${num(c.f[k], 4)} ${k}`).join(" + ")}`).join("\n"), "note");
  if (figures?.moments) {
    text("Factored moment envelope (the strength combinations), kip·in, drawn on each member's tension side:", "note");
    lines.push({ region: figures.moments });
  }
  m(`\\eta\\coloneq ${num(i.eta)}`, "Load modifier on EV and EH, AASHTO 1.3.2, 12.5.4");
  const box = i.construction === "precast" ? "precast box" : "cast-in-place box";
  m(`\\phi_f\\coloneq ${num(i.phiF)}`, `Flexure, AASHTO Table 12.5.5-1 (${box})`);
  m(`\\phi_v\\coloneq ${num(i.phiV)}`, `Shear, AASHTO Table 12.5.5-1 (${box})`);

  // --- design ----------------------------------------------------------------------------------
  const sectionValues = (key: string, idx: number, effect: "M" | "N", llPick: "pos" | "neg" | "none" | "vmax" | "vmin") => {
    const unit = effect === "M" ? "\\mathrm{kip}\\cdot\\mathrm{in}" : "\\mathrm{kip}";
    for (const c of CASES) {
      const v = r.unfactored[c.id][idx][effect] * (effect === "M" ? 12 : 1);
      given(`${effect}_{${CASE_TEX[c.id]}${key}}\\coloneq ${num(v, 8)}${unit}`, c.name);
    }
    const env = r.env[idx];
    const lv = llPick === "pos" ? env.pos[effect] : llPick === "neg" ? env.neg[effect] : 0;
    given(`${effect}_{LL${key}}\\coloneq ${num(lv * (effect === "M" ? 12 : 1), 8)}${unit}`, llPick === "none" ? "No live load in this group" : `LL + IM, the ${llPick === "pos" ? "largest positive" : "largest negative"} moment's position`);
  };
  const combination = (target: string, key: string, comboId: string, effect: "M" | "N") => {
    const c = C.find((x) => x.id === comboId)!;
    const terms = (["DC", "EV", "LL", "EHmax", "EHmin", "LS", "WA"] as const).filter((k) => c.f[k]).map((k) => `${factorTex(c.f[k], i.eta)}\\cdot ${effect}_{${CASE_TEX[k]}${key}}`);
    m(`${target}\\coloneq ${terms.join("+")}=`, c.name, effect === "M" ? "kip*in" : "kip");
  };

  const keyOf = (g: { kind: string; key: string }) => `${g.kind[0]}${g.key[0]}`; // ti, to, bi, bo, wi, wo, ie
  const faceKey = (face: Face) => {
    const g = r.governs.find((x) => x.face === face);
    return g ? keyOf(g) : null;
  };
  const bars = i.reinf === "bars";

  r.governs.forEach((g, gi) => {
    const k = keyOf(g);
    const f = g.flex;
    const db = bars ? `d_{b${k}}` : "d_w";
    const sp = bars ? `s_{${k}}` : "s_w";
    text(`${g.label}`, "subheading");
    text(`Flexure governs at ${f.station.name}, ${C.find((c) => c.id === f.combo)!.name}.`, "note");
    sectionValues(k, f.index, "M", f.u.ll);
    combination(`M_{u${k}}`, k, f.combo, "M");
    m(`h_{${k}}\\coloneq ${num(g.h)}\\mathrm{in}`, "Member thickness");
    if (g.steel.bars) {
      const bar = BARS[g.steel.bars.bar];
      m(`${db}\\coloneq ${num(bar.dia)}\\mathrm{in}`, `#${g.steel.bars.bar} bars`);
      m(`${sp}\\coloneq ${num(g.steel.bars.spacing)}\\mathrm{in}`, "Bar spacing");
      m(ok(sp, `\\min\\left(1.5\\cdot h_{${k}},18\\mathrm{in}\\right)`), "Maximum spacing, AASHTO 5.10.3.2");
      m(`d_{${k}}\\coloneq h_{${k}}-c_{c}-\\frac{${db}}{2}=`, "Effective depth", "in");
      m(`A_{s${k}}\\coloneq\\frac{${num(bar.area)}\\mathrm{in}^{2}\\cdot b}{${sp}}=`, "Provided, per foot", "in^2");
    } else {
      m(`d_{${k}}\\coloneq h_{${k}}-c_{c}-\\frac{${db}}{2}=`, "Effective depth", "in");
      m(`A_{s${k}}\\coloneq ${num(g.As, 8)}\\mathrm{in}^{2}`, "Provided, per foot");
    }
    m(`a_{${k}}\\coloneq\\frac{A_{s${k}}\\cdot f_y}{0.85\\cdot f'_{c}\\cdot b}=`, undefined, "in");
    m(`M_{r${k}}\\coloneq\\phi_f\\cdot A_{s${k}}\\cdot f_y\\cdot\\left(d_{${k}}-\\frac{a_{${k}}}{2}\\right)=`, "AASHTO 5.6.3.2", "kip*in");
    m(ok(`\\left|M_{u${k}}\\right|`, `M_{r${k}}`), "Flexure");
    m(`A_{q${k}}\\coloneq\\frac{\\phi_f\\cdot f_y\\cdot d_{${k}}-\\sqrt{\\left(\\phi_f\\cdot f_y\\cdot d_{${k}}\\right)^{2}-4\\cdot\\frac{\\phi_f\\cdot f_y^{2}}{1.7\\cdot f'_{c}\\cdot b}\\cdot\\left|M_{u${k}}\\right|}}{2\\cdot\\frac{\\phi_f\\cdot f_y^{2}}{1.7\\cdot f'_{c}\\cdot b}}=`, "Steel needed for flexure", "in^2");
    m(ok(`0.002\\cdot b\\cdot h_{${k}}`, `A_{s${k}}`), "Minimum, AASHTO 12.11.4.3.2");
    m(`c_{n${k}}\\coloneq\\frac{A_{s${k}}\\cdot f_y}{0.85\\cdot f'_{c}\\cdot\\beta_1\\cdot b}=`, undefined, "in");
    m(ok(`\\frac{c_{n${k}}}{d_{${k}}}`, num(r.cdMax)), "Tension controlled, AASHTO 5.6.2.1");

    if (g.crack) {
      const cr = g.crack;
      const ks = cr.index === f.index && (cr.s!.ll === f.u.ll || cr.s!.ll === "none") ? k : `${k}s`;
      text(`Crack control governs at ${cr.station.name}, ${C.find((c) => c.id === cr.serCombo)!.name}.`, "note");
      if (ks !== k) sectionValues(ks, cr.index, "M", cr.s!.ll);
      sectionValues(ks, cr.index, "N", cr.s!.ll);
      combination(`M_{s${k}}`, ks, cr.serCombo!, "M");
      combination(`N_{s${k}}`, ks, cr.serCombo!, "N");
      m(`d_{c${k}}\\coloneq c_{c}+\\frac{${db}}{2}=`, undefined, "in");
      m(`\\beta_{s${k}}\\coloneq1+\\frac{d_{c${k}}}{0.7\\cdot\\left(h_{${k}}-d_{c${k}}\\right)}=`, "AASHTO 5.6.7");
      m(`f_{ss${k}}\\coloneq\\min\\left(\\frac{700\\cdot${num(i.gammaE)}\\cdot\\frac{\\mathrm{kip}}{\\mathrm{in}}}{\\beta_{s${k}}\\cdot\\left(${sp}+2\\cdot d_{c${k}}\\right)},0.6\\cdot f_y\\right)=`, `Allowable stress, AASHTO Eq. 5.6.7-1 (γe = ${num(i.gammaE)})`, "ksi");
      if (cr.crack!.thrust) {
        m(`e_{${k}}\\coloneq\\frac{\\left|M_{s${k}}\\right|}{N_{s${k}}}+d_{${k}}-\\frac{h_{${k}}}{2}=`, "AASHTO C12.11.3", "in");
        m(`j_{${k}}\\coloneq\\min\\left(0.9,0.74+0.1\\cdot\\frac{e_{${k}}}{d_{${k}}}\\right)=`);
        m(`i_{${k}}\\coloneq\\frac{1}{1-\\frac{j_{${k}}\\cdot d_{${k}}}{e_{${k}}}}=`);
        m(`f_{s${k}}\\coloneq\\frac{\\left|M_{s${k}}\\right|+N_{s${k}}\\cdot\\left(d_{${k}}-\\frac{h_{${k}}}{2}\\right)}{A_{s${k}}\\cdot j_{${k}}\\cdot i_{${k}}\\cdot d_{${k}}}=`, "AASHTO Eq. C12.11.3-1", "ksi");
      } else m(`f_{s${k}}\\coloneq\\frac{\\left|M_{s${k}}\\right|}{A_{s${k}}\\cdot0.9\\cdot d_{${k}}}=`, cr.Ns > 1e-9 ? "e/d under 1.15: the thrust's benefit left out" : "No thrust", "ksi");
      m(ok(`f_{s${k}}`, `f_{ss${k}}`), "Crack control");
      m(`A_{c${k}}\\coloneq A_{s${k}}\\cdot\\frac{f_{s${k}}}{f_{ss${k}}}=`, "Steel needed for crack control, about (at this spacing)", "in^2");
    }

    // Shear and thrust, after the member's last face.
    const last = r.governs.findLastIndex((x) => x.kind === g.kind) === gi;
    if (!last) return;
    const mine = r.shears.filter((s) => s.station.kind === g.kind);
    if (mine.length) {
      const s = mine.reduce((w, x) => (x.Vu / x.Vr > w.Vu / w.Vr ? x : w), mine[0]);
      const kv = `${g.kind[0]}v`;
      text(`${g.label.split(",")[0]}: shear, at ${s.station.name}, ${C.find((c) => c.id === s.combo)!.name}`, "subheading");
      given(`V_{u${kv}}\\coloneq ${num(s.Vu, 8)}\\mathrm{kip}`, "Frame analysis, at dv past the haunch tip");
      given(`M_{u${kv}}\\coloneq ${num(s.Mu * 12, 8)}\\mathrm{kip}\\cdot\\mathrm{in}`, "The largest moment there (conservative)");
      m(`h_{${kv}}\\coloneq ${num(s.h)}\\mathrm{in}`);
      const fk = faceKey(s.face);
      const which = s.rule === "slab" ? "The lesser face" : "Tension face";
      if (fk) {
        m(`d_{${kv}}\\coloneq d_{${fk}}=`, which, "in");
        m(`A_{s${kv}}\\coloneq A_{s${fk}}=`, undefined, "in^2");
      } else {
        given(`d_{${kv}}\\coloneq ${num(s.d, 8)}\\mathrm{in}`, which);
        given(`A_{s${kv}}\\coloneq ${num(s.As, 8)}\\mathrm{in}^{2}`);
      }
      if (s.rule === "slab") {
        m(`r_{${kv}}\\coloneq\\min\\left(1,\\frac{V_{u${kv}}\\cdot d_{${kv}}}{M_{u${kv}}}\\right)=`);
        m(`V_{c${kv}}\\coloneq\\phi_v\\cdot\\left(0.0676\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}+4.6\\cdot\\frac{A_{s${kv}}}{b\\cdot d_{${kv}}}\\cdot r_{${kv}}\\cdot\\mathrm{ksi}\\right)\\cdot b\\cdot d_{${kv}}=`, "AASHTO Eq. 5.12.7.3-1", "kip");
        m(`V_{r${kv}}\\coloneq\\min\\left(\\max\\left(V_{c${kv}},\\phi_v\\cdot0.0948\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot b\\cdot d_{${kv}}\\right),\\phi_v\\cdot0.126\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot b\\cdot d_{${kv}}\\right)=`, "Monolithic with the walls: 0.0948√f'c min., 0.126√f'c max.", "kip");
      } else {
        m(`a_{${kv}}\\coloneq\\frac{A_{s${kv}}\\cdot f_y}{0.85\\cdot f'_{c}\\cdot b}=`, undefined, "in");
        m(`d_{v${kv}}\\coloneq\\max\\left(0.72\\cdot h_{${kv}},0.9\\cdot d_{${kv}},d_{${kv}}-\\frac{a_{${kv}}}{2}\\right)=`, "AASHTO 5.7.2.8", "in");
        m(`\\varepsilon_{s${kv}}\\coloneq\\frac{\\frac{\\max\\left(M_{u${kv}},V_{u${kv}}\\cdot d_{v${kv}}\\right)}{d_{v${kv}}}+V_{u${kv}}}{E_s\\cdot A_{s${kv}}}=`, "AASHTO Eq. 5.7.3.4.2-4 (no benefit from thrust)");
        m(`s_{xe${kv}}\\coloneq\\max\\left(12\\mathrm{in},\\min\\left(80\\mathrm{in},d_{v${kv}}\\cdot\\frac{1.38}{${num(i.agg)}+0.63}\\right)\\right)=`, undefined, "in");
        m(`\\beta_{${kv}}\\coloneq\\max\\left(\\frac{4.8}{1+750\\cdot\\varepsilon_{s${kv}}}\\cdot\\frac{51}{39+\\frac{s_{xe${kv}}}{\\mathrm{in}}},${s.h <= 16 ? 2 : 0}\\right)=`, "General procedure (5.7.3.4.2), or 2.0 (simplified, h ≤ 16 in, 5.7.3.4.1): the greater");
        m(`V_{r${kv}}\\coloneq\\min\\left(\\phi_v\\cdot0.0316\\cdot\\beta_{${kv}}\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot b\\cdot d_{v${kv}},\\phi_v\\cdot0.25\\cdot f'_{c}\\cdot b\\cdot d_{v${kv}}\\right)=`, "AASHTO 5.7.3.3", "kip");
      }
      m(ok(`V_{u${kv}}`, `V_{r${kv}}`), "Shear");
    }
    const t = r.thrusts.find((x) => x.kind === g.kind);
    if (t) {
      const kt = `${g.kind[0]}p`;
      text(`${g.label.split(",")[0]}: thrust`, "subheading");
      given(`P_{u${kt}}\\coloneq ${num(t.Pu, 8)}\\mathrm{kip}`, `Frame analysis, ${t.station.name}, ${C.find((c) => c.id === t.combo)!.name}`);
      m(ok(`P_{u${kt}}`, `${num(i.phiC)}\\cdot0.10\\cdot f'_{c}\\cdot b\\cdot${num(t.h)}\\mathrm{in}`), "Axial load below 0.10 φ f'c Ag: designed for flexure (AASHTO 5.6.4.5)");
    }
  });
  return lines;
}
