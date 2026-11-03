import type { Line } from "@/lib/calcs/library/templates";
import { COLOR_NOTE, INPUT_COLOR, isInput } from "../calc-style";
import type { Figure } from "../figures";
import { BARS, COMBOS, type Combo, type CipInputs } from "./cip";

// A CIP cantilever wall design as a Calcs worksheet: its inputs as definitions and every step as
// live math with its AASHTO reference, so the calc package reads (and works out) on its own, the
// way an engineer would write it by hand. Calcs checks the numbers independently of the design
// engine.

const num = (v: number) => String(+v.toFixed(6));
const combName = (c: Combo) => COMBOS.find((x) => x.id === c)!.name;
const SUB: Record<Combo, string> = { StrIa: "Ia", StrIb: "Ib", StrIV: "IV", ExtIIa: "IIa", ExtIIb: "IIb", SerI: "SI" };
const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;

export function cipCalcLines(i: CipInputs, title: string, figures?: { section?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note") => lines.push({ text: t, ...(style ? { style } : {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });

  const batter = i.frontBatter > 0 || i.backBatter > 0;
  const live = i.liveLoad;
  const pave = i.pavementThickness > 0;
  const slope = i.backslope > 0;
  const toeFill = i.Df * 12 > i.D;
  const rail = i.railWeight > 0;
  const ct = i.collision;
  // Extreme Event II (vehicle collision) only with a collision load.
  const ext = (...combos: Combo[]) => (ct ? combos : []);

  text(title.toUpperCase(), "heading");
  text("Cast-in-place cantilever retaining wall, per foot of wall. AASHTO LRFD Bridge Design Specifications (9th ed.). Moments are taken about the toe.");

  text(COLOR_NOTE, "note");

  // --- materials and soil -------------------------------------------------------------------
  text("Soil", "subheading");
  m(`\\gamma_s\\coloneq ${num(i.gammaS)}\\mathrm{kcf}`, "Backfill unit weight");
  m(`\\phi\\coloneq ${num(i.phi)}\\mathrm{deg}`, "Backfill friction angle");
  m(i.delta === null ? "\\delta\\coloneq\\frac{2}{3}\\cdot\\phi=" : `\\delta\\coloneq ${num(i.delta)}\\mathrm{deg}`, "Wall–backfill friction angle (T. 3.11.5.3-1)");
  m(slope ? `\\beta\\coloneq\\arctan\\left(\\frac{1}{${num(i.backslope)}}\\right)=` : "\\beta\\coloneq0\\mathrm{deg}", "Backslope angle", "deg");
  m("\\theta\\coloneq90\\mathrm{deg}", "Plane through the soil mass, vertical (for Ka)");
  m("\\Gamma_a\\coloneq\\left(1+\\sqrt{\\frac{\\sin\\left(\\phi+\\delta\\right)\\cdot\\sin\\left(\\phi-\\beta\\right)}{\\sin\\left(\\theta-\\delta\\right)\\cdot\\sin\\left(\\theta+\\beta\\right)}}\\right)^{2}=", "AASHTO Eq. 3.11.5.3-2");
  m("K_a\\coloneq\\frac{\\sin\\left(\\theta+\\phi\\right)^{2}}{\\Gamma_a\\cdot\\sin\\left(\\theta\\right)^{2}\\cdot\\sin\\left(\\theta-\\delta\\right)}=", "Coulomb, AASHTO Eq. 3.11.5.3-1");
  if (i.kpOverride !== null) m(`K_p\\coloneq ${num(i.kpOverride)}`, "Passive, AASHTO Fig. 3.11.5.4-1");
  else {
    m("\\Gamma_p\\coloneq\\left(1-\\sqrt{\\frac{\\sin\\left(\\phi+\\delta\\right)\\cdot\\sin\\left(\\phi+\\beta\\right)}{\\sin\\left(\\theta+\\delta\\right)\\cdot\\sin\\left(\\theta+\\beta\\right)}}\\right)^{2}=", "Coulomb passive");
    m("K_p\\coloneq\\frac{\\sin\\left(\\theta-\\phi\\right)^{2}}{\\Gamma_p\\cdot\\sin\\left(\\theta\\right)^{2}\\cdot\\sin\\left(\\theta+\\delta\\right)}=");
  }
  if (i.efwMin > 0) m(`EFW_a\\coloneq\\max\\left(\\gamma_s\\cdot K_a,${num(i.efwMin * 1000)}\\mathrm{pcf}\\right)=`, "Active equivalent fluid weight (with the minimum set)", "pcf");
  else m("EFW_a\\coloneq\\gamma_s\\cdot K_a=", "Active equivalent fluid weight", "pcf");
  m("EFW_p\\coloneq\\gamma_s\\cdot K_p=", "Passive equivalent fluid weight", "pcf");
  m(`q_n\\coloneq ${num(i.qn)}\\mathrm{ksf}`, "Nominal bearing resistance (geotechnical)");
  m(`\\phi_{sub}\\coloneq ${num(i.phiSub)}\\mathrm{deg}`, "Subgrade friction angle");
  m("\\mu_n\\coloneq\\tan\\left(\\phi_{sub}\\right)=", "Sliding coefficient, AASHTO C10.6.3.4");
  m("\\delta_{sub}\\coloneq\\frac{2}{3}\\cdot\\phi_{sub}=", "Subgrade shear friction angle", "deg");

  text("Concrete and reinforcement", "subheading");
  m(`f'_{c}\\coloneq ${num(i.fc)}\\mathrm{ksi}`);
  m(`\\gamma_c\\coloneq ${num(i.gammaC)}\\mathrm{kcf}`, "Reinforced concrete unit weight");
  m(`f_y\\coloneq ${num(i.fy)}\\mathrm{ksi}`);
  m(`E_s\\coloneq ${num(i.Es)}\\mathrm{ksi}`, "AASHTO 5.4.3.2");
  m("E_c\\coloneq120000\\cdot\\left(\\frac{\\gamma_c}{\\mathrm{kcf}}\\right)^{2}\\cdot\\left(\\frac{f'_{c}}{\\mathrm{ksi}}\\right)^{0.33}\\cdot\\mathrm{ksi}=", "AASHTO Eq. 5.4.2.4-1");
  m("n\\coloneq\\frac{E_s}{E_c}=", "Modular ratio");
  m("\\beta_1\\coloneq\\max\\left(0.65,\\min\\left(0.85,0.85-0.05\\cdot\\frac{f'_{c}-4\\mathrm{ksi}}{\\mathrm{ksi}}\\right)\\right)=", "AASHTO 5.6.2.2");
  m("f_r\\coloneq0.24\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}=", "Modulus of rupture, AASHTO 5.4.2.6");

  text("Resistance factors", "subheading");
  m(`\\phi_b\\coloneq ${num(i.phiB)}`, "Bearing, AASHTO T. 11.5.7-1");
  m(`\\phi_{\\tau}\\coloneq ${num(i.phiT)}`, "Sliding, concrete on soil");
  m(`\\phi_{\\tau ss}\\coloneq ${num(i.phiTss)}`, "Sliding, soil on soil");
  m(`\\phi_{ep}\\coloneq ${num(i.phiEp)}`, "Passive resistance");
  m(`\\phi_{EE}\\coloneq ${num(i.phiEE)}`, "Extreme event");
  m(`\\phi_f\\coloneq ${num(i.phiF)}`, "Flexure, AASHTO 5.5.4.2");
  m(`\\phi_v\\coloneq ${num(i.phiV)}`, "Shear, AASHTO 5.5.4.2");

  // --- geometry -----------------------------------------------------------------------------
  text("Geometry", "subheading");
  m(`H_e\\coloneq ${num(i.He)}\\mathrm{ft}`, "Exposed height");
  m(`D_f\\coloneq ${num(i.Df)}\\mathrm{ft}`, "Cover over the footing (to its bottom)");
  m(`D\\coloneq ${num(i.D)}\\mathrm{in}`, "Footing thickness");
  m(i.Df === 0 ? "H\\coloneq H_e+D=" : "H\\coloneq H_e+D_f=", "Design height", "ft");
  m("h_s\\coloneq H-D=", "Stem height", "ft");
  m(`T_t\\coloneq ${num(i.Tt)}\\mathrm{in}`, "Stem thickness at the top");
  if (batter) {
    m(`T_1\\coloneq ${num(i.frontBatter)}\\frac{\\mathrm{in}}{\\mathrm{ft}}\\cdot h_s=`, "Front batter width", "in");
    m(`T_2\\coloneq ${num(i.backBatter)}\\frac{\\mathrm{in}}{\\mathrm{ft}}\\cdot h_s=`, "Back batter width", "in");
  } else {
    m("T_1\\coloneq0\\mathrm{in}");
    m("T_2\\coloneq0\\mathrm{in}");
  }
  m("T_b\\coloneq T_t+T_1+T_2=", "Stem thickness at the bottom", "in");
  m(`B\\coloneq ${num(i.B)}\\mathrm{in}`, "Footing width");
  m(`A\\coloneq ${num(i.A)}\\mathrm{in}`, "Toe");
  m("C\\coloneq B-A-T_b=", "Heel", "in");
  m(`t\\coloneq ${num(i.pavementThickness)}\\mathrm{in}`, "Pavement");
  m("h\\coloneq H-t+\\left(T_2+C\\right)\\cdot\\tan\\left(\\beta\\right)=", "Retained height at the heel", "ft");

  if (figures?.section) lines.push({ region: figures.section });

  // --- loads --------------------------------------------------------------------------------
  text("Loads (unfactored)", "subheading");
  m("P_a\\coloneq\\frac{1}{2}\\cdot EFW_a\\cdot h^{2}=", "Active earth force over the full height, AASHTO 3.11.5", "kip/ft");
  m("\\omega\\coloneq\\delta=", "Inclination of the earth force, on the vertical plane through the heel", "deg");
  if (live) {
    m(`h_{eq}\\coloneq ${num(liveHeq(i))}\\mathrm{ft}`, "Live load surcharge, AASHTO T. 3.11.6.4-2");
    m(`d_{tr}\\coloneq ${num(i.trafficDistance)}\\mathrm{ft}`, "Wall back face to the edge of traffic");
    m("F_{sur}\\coloneq EFW_a\\cdot h_{eq}\\cdot h=", "Surcharge force, horizontal, AASHTO 3.11.6.4", "kip/ft");
    m("w_{LS}\\coloneq\\max\\left(T_2+C-d_{tr},0\\mathrm{ft}\\right)=", "Heel under traffic", "ft");
  }
  if (rail) {
    m(`w_{rail}\\coloneq ${num(i.railWeight)}\\frac{\\mathrm{kip}}{\\mathrm{ft}}`, "Barrier on the wall");
    m(`c_{rail}\\coloneq ${num(i.railCg)}\\mathrm{in}`, "Its center of gravity from the stem's front face");
  }
  if (ct) {
    text("Vehicle collision on the barrier (AASHTO 3.6.5, Table A13.2-1), spread at 45° down the wall" + (i.ctAtEnd ? ", one way only near the wall's end." : ", both ways."), "note");
    m(`F_t\\coloneq ${num(i.ctForce)}\\mathrm{kip}`, "Transverse collision force");
    m(`L_t\\coloneq ${num(i.ctLength)}\\mathrm{ft}`, "Length it's spread over");
    m(`h_{ct}\\coloneq ${num(i.ctHeight)}\\mathrm{ft}`, "Top of the wall to the point of impact");
    m("h_T\\coloneq h_{ct}+H=", "Impact to the bottom of the footing", "ft");
    m(i.ctAtEnd ? "CT\\coloneq\\frac{F_t}{\\frac{L_t}{2}+h_T}=" : "CT\\coloneq\\frac{F_t}{L_t+2\\cdot h_T}=", "At the bottom of the footing", "kip/ft");
  }
  const vert: [string, string, string, string][] = [];
  if (batter) vert.push(["DC_1", "\\frac{1}{2}\\cdot T_1\\cdot h_s\\cdot\\gamma_c", "A+\\frac{2}{3}\\cdot T_1", "Front batter of the stem"]);
  vert.push(["DC_2", "T_t\\cdot h_s\\cdot\\gamma_c", "A+T_1+\\frac{T_t}{2}", "Stem"]);
  if (batter) vert.push(["DC_3", "\\frac{1}{2}\\cdot T_2\\cdot h_s\\cdot\\gamma_c", "A+T_1+T_t+\\frac{T_2}{3}", "Back batter of the stem"]);
  vert.push(["DC_4", "B\\cdot D\\cdot\\gamma_c", "\\frac{B}{2}", "Footing"]);
  if (rail) vert.push(["DC_5", "w_{rail}", "A+T_1+c_{rail}", "Barrier"]);
  if (pave) vert.push(["DC_6", `t\\cdot${num(i.gammaPavement)}\\mathrm{kcf}\\cdot\\left(T_2+C\\right)`, "B-\\frac{T_2+C}{2}", "Pavement"]);
  vert.push(["EV_1", "C\\cdot\\left(h_s-t\\right)\\cdot\\gamma_s", "B-\\frac{C}{2}", "Fill on the heel"]);
  if (batter) vert.push(["EV_2", "\\frac{1}{2}\\cdot T_2\\cdot\\left(h_s-t\\right)\\cdot\\gamma_s", "A+T_1+T_t+\\frac{2}{3}\\cdot T_2", "Fill on the back batter"]);
  if (toeFill) vert.push(["EV_3", "A\\cdot\\left(D_f-D\\right)\\cdot\\gamma_s", "\\frac{A}{2}", "Fill on the toe"]);
  if (slope) vert.push(["EV_4", "\\frac{1}{2}\\cdot\\left(T_2+C\\right)^{2}\\cdot\\tan\\left(\\beta\\right)\\cdot\\gamma_s", "A+T_1+T_t+\\frac{2}{3}\\cdot\\left(T_2+C\\right)", "Fill in the backslope"]);
  for (const [name, force, arm, what] of vert) {
    m(`${name}\\coloneq ${force}=`, what, "kip/ft");
    m(`x_{${name.replace("_", "")}}\\coloneq ${arm}=`, `Arm of ${name.replace("_", "")}`, "ft");
  }
  const dcs = vert.filter(([n]) => n.startsWith("DC"));
  const evs = vert.filter(([n]) => n.startsWith("EV"));
  const sumF = (ls: typeof vert) => ls.map(([n]) => n).join("+");
  const sumM = (ls: typeof vert) => ls.map(([n]) => `${n}\\cdot x_{${n.replace("_", "")}}`).join("+");
  m(`V_{DC}\\coloneq ${sumF(dcs)}=`, "Dead load of the wall", "kip/ft");
  m(`M_{DC}\\coloneq ${sumM(dcs)}=`, undefined, "kip*ft/ft");
  m(`V_{EV}\\coloneq ${sumF(evs)}=`, "Vertical earth load", "kip/ft");
  m(`M_{EV}\\coloneq ${sumM(evs)}=`, undefined, "kip*ft/ft");
  m("EH_V\\coloneq P_a\\cdot\\sin\\left(\\omega\\right)=", "Vertical component of the earth force, at the heel", "kip/ft");
  m("EH_H\\coloneq P_a\\cdot\\cos\\left(\\omega\\right)=", "Horizontal component, at h/3", "kip/ft");
  if (live) {
    m("LS_V\\coloneq h_{eq}\\cdot w_{LS}\\cdot\\gamma_s=", "Surcharge over the heel, beyond the edge of traffic", "kip/ft");
    m("LS_H\\coloneq F_{sur}=", "Surcharge, horizontal, at h/2", "kip/ft");
  }

  // --- load groups --------------------------------------------------------------------------
  text("Load groups (AASHTO Table 3.4.1-1)", "subheading");
  const groups: Combo[] = ["StrIa", "StrIb", "StrIV", ...ext("ExtIIa", "ExtIIb"), "SerI"];
  for (const c of groups) {
    const f = i.factors[c];
    const s = SUB[c];
    const ls = live ? `+${num(f.lsv)}\\cdot LS_V` : "";
    const lsM = live ? `+${num(f.lsv)}\\cdot LS_V\\cdot\\left(B-\\frac{w_{LS}}{2}\\right)` : "";
    const lsH = live ? `+${num(f.lsh)}\\cdot LS_H` : "";
    const lsHM = live ? `+${num(f.lsh)}\\cdot LS_H\\cdot\\frac{h}{2}` : "";
    const ctH = ct && f.ct ? `+${num(f.ct)}\\cdot CT` : "";
    const ctHM = ct && f.ct ? `+${num(f.ct)}\\cdot CT\\cdot h_T` : "";
    m(`V_{${s}}\\coloneq ${num(f.dc)}\\cdot V_{DC}+${num(f.ev)}\\cdot V_{EV}${ls}+${num(f.eh)}\\cdot EH_V=`, combName(c), "kip/ft");
    m(`M_{V${s}}\\coloneq ${num(f.dc)}\\cdot M_{DC}+${num(f.ev)}\\cdot M_{EV}${lsM}+${num(f.eh)}\\cdot EH_V\\cdot B=`, undefined, "kip*ft/ft");
    m(`H_{${s}}\\coloneq ${num(f.eh)}\\cdot EH_H${lsH}${ctH}=`, undefined, "kip/ft");
    m(`M_{H${s}}\\coloneq ${num(f.eh)}\\cdot EH_H\\cdot\\frac{h}{3}${lsHM}${ctHM}=`, undefined, "kip*ft/ft");
    m(`X_{${s}}\\coloneq\\frac{M_{V${s}}-M_{H${s}}}{V_{${s}}}=`, "Resultant from the toe", "ft");
    m(`e_{${s}}\\coloneq\\left|\\frac{B}{2}-X_{${s}}\\right|=`, "Eccentricity of the resultant", "ft");
  }

  // --- stability ----------------------------------------------------------------------------
  text("Eccentricity (AASHTO 11.6.3.3)", "subheading");
  m("e_{max}\\coloneq\\frac{B}{3}=", "Footing on soil", "ft");
  for (const c of ["StrIa", "StrIb", ...ext("ExtIIa")] as Combo[]) m(ok(`e_{${SUB[c]}}`, "e_{max}"), combName(c));

  text("Bearing (AASHTO 11.6.3.2)", "subheading");
  m("q_R\\coloneq\\phi_b\\cdot q_n=", undefined, "ksf");
  if (ct) m("q_{REE}\\coloneq\\phi_{EE}\\cdot q_n=", "Extreme event", "ksf");
  for (const c of ["StrIb", "StrIV", ...ext("ExtIIb")] as Combo[]) {
    const s = SUB[c];
    m(`\\sigma_{${s}}\\coloneq\\frac{V_{${s}}}{\\max\\left(B-2\\cdot e_{${s}},0.001\\mathrm{ft}\\right)}=`, `${combName(c)}, uniform pressure over B − 2e`, "ksf");
    m(ok(`\\sigma_{${s}}`, c === "ExtIIb" ? "q_{REE}" : "q_R"));
  }

  text("Sliding (AASHTO 10.6.3.4)", "subheading");
  text("Passive pressure in front of the toe is neglected (AASHTO 11.6.3.5).", "note");
  m("R_{Ia}\\coloneq\\phi_{\\tau}\\cdot V_{Ia}\\cdot\\mu_n=", "Strength Ia, without a key", "kip/ft");
  if (ct) m("R_{IIa}\\coloneq\\phi_{EE}\\cdot V_{IIa}\\cdot\\mu_n=", "Extreme IIa, without a key", "kip/ft");
  if (i.shearKey) {
    m(`\\operatorname{if}\\left(R_{Ia}<H_{Ia}${ct ? "\\lor R_{IIa}<H_{IIa}" : ""},\\text{shear key required},\\text{no key needed}\\right)=`);
    text("Shear key: the passive resistance of the inert block in front of it, with the fill over the toe that may be removed neglected (AASHTO 11.6.3.5).", "note");
    m(`d_{key}\\coloneq ${num(i.keyDepth)}\\mathrm{in}`, "Key depth below the footing");
    m(`D_w\\coloneq ${num(i.keyWidth)}\\mathrm{in}`, "Key width");
    m(i.keyFromHeel !== null ? `K_{key}\\coloneq ${num(i.keyFromHeel)}\\mathrm{in}` : "K_{key}\\coloneq\\frac{B}{3}=", "Heel to the key's centerline", "ft");
    m("X_{key}\\coloneq B-K_{key}-\\frac{D_w}{2}=", "Toe to the front of the key", "ft");
    m("c_k\\coloneq d_{key}+X_{key}\\cdot\\tan\\left(\\delta_{sub}\\right)=", "Inert block depth", "ft");
    m(`d_{ig}\\coloneq ${num(i.toeFillIgnored)}\\mathrm{ft}`, "Fill over the toe neglected");
    m("y_1\\coloneq\\max\\left(D_f-d_{ig},0\\mathrm{ft}\\right)=", "Top of passive zone", "ft");
    m("y_2\\coloneq y_1+c_k=", undefined, "ft");
    m("R_{ep}\\coloneq EFW_p\\cdot\\frac{y_1+y_2}{2}\\cdot c_k=", "Passive resistance of the inert block", "kip/ft");
    text("The base pressure is uniform over B − 2e on the resultant's side, as for bearing: R1 in front of the key, R2 behind it.", "note");
    for (const c of ["StrIa", ...ext("ExtIIa")] as Combo[]) {
      const s = SUB[c];
      const ee = c === "ExtIIa";
      m(`\\sigma_{k${s}}\\coloneq\\frac{V_{${s}}}{\\max\\left(B-2\\cdot e_{${s}},0.001\\mathrm{ft}\\right)}=`, combName(c), "ksf");
      m(`x_{0${s}}\\coloneq\\max\\left(0\\mathrm{ft},2\\cdot X_{${s}}-B\\right)=`, "Where the pressure starts", "ft");
      m(`x_{1${s}}\\coloneq\\min\\left(B,2\\cdot X_{${s}}\\right)=`, "Where it ends", "ft");
      m(`R_{1${s}}\\coloneq\\sigma_{k${s}}\\cdot\\max\\left(0\\mathrm{ft},\\min\\left(X_{key},x_{1${s}}\\right)-x_{0${s}}\\right)=`, "In front of the key", "kip/ft");
      m(`R_{2${s}}\\coloneq\\sigma_{k${s}}\\cdot\\max\\left(0\\mathrm{ft},x_{1${s}}-\\max\\left(X_{key},x_{0${s}}\\right)\\right)=`, "Behind it", "kip/ft");
      m(`R_{\\tau ${s}}\\coloneq R_{1${s}}\\cdot${ee ? "\\phi_{EE}" : "\\phi_{\\tau ss}"}\\cdot\\mu_n\\cdot\\cos\\left(\\delta_{sub}\\right)+R_{2${s}}\\cdot${ee ? "\\phi_{EE}" : "\\phi_{\\tau}"}\\cdot\\mu_n=`, "Soil on soil in front of the key, concrete on soil behind", "kip/ft");
      m(`R_{R${s}}\\coloneq R_{\\tau ${s}}+\\phi_{ep}\\cdot R_{ep}=`, undefined, "kip/ft");
      m(ok(`H_{${s}}`, `R_{R${s}}`));
    }
  } else {
    m(ok("H_{Ia}", "R_{Ia}"), "Strength Ia");
    if (ct) m(ok("H_{IIa}", "R_{IIa}"), "Extreme IIa");
  }

  // --- members ------------------------------------------------------------------------------
  const stemDead = vert.filter(([n]) => ["DC_1", "DC_2", "DC_3", "DC_5"].includes(n)).map(([n]) => n).join("+");
  const member = (key: string, name: string, opts: { Mu: string; Ms: string; Vu: string; h: string; cover: number; bars: { bar: number; spacing: number }; exposure: number; shear: "general" | "simplified" | "none" }) => {
    const k = key;
    const bar = BARS[opts.bars.bar];
    m(`c_{${k}}\\coloneq ${num(opts.cover)}\\mathrm{in}`, `${name}: cover`);
    m(`d_{b${k}}\\coloneq ${num(bar.dia)}\\mathrm{in}`, `#${opts.bars.bar} bars`);
    m(`s_{${k}}\\coloneq ${num(opts.bars.spacing)}\\mathrm{in}`, "Spacing");
    m(`h_{${k}}\\coloneq ${opts.h}=`, "Section depth", "in");
    m(`d_{e${k}}\\coloneq h_{${k}}-c_{${k}}-\\frac{d_{b${k}}}{2}=`, "Effective depth", "in");
    m(`A_{s${k}}\\coloneq\\frac{${num(bar.area)}\\mathrm{in}^{2}}{s_{${k}}}=`, "Steel per foot of wall", "in^2/ft");
    m(`a_{${k}}\\coloneq\\frac{A_{s${k}}\\cdot f_y}{0.85\\cdot f'_{c}}=`, "Stress block depth", "in");
    m(`M_{u${k}}\\coloneq ${opts.Mu}=`, "Factored moment", "kip*ft/ft");
    m(`M_{r${k}}\\coloneq\\phi_f\\cdot A_{s${k}}\\cdot f_y\\cdot\\left(d_{e${k}}-\\frac{a_{${k}}}{2}\\right)=`, "AASHTO 5.6.3.2", "kip*ft/ft");
    m(ok(`M_{u${k}}`, `M_{r${k}}`), "Flexure");
    m(`M_{cr${k}}\\coloneq0.67\\cdot1.6\\cdot f_r\\cdot\\frac{h_{${k}}^{2}}{6}=`, "Cracking moment, AASHTO Eq. 5.6.3.3-1", "kip*ft/ft");
    m(ok(`\\min\\left(1.33\\cdot M_{u${k}},M_{cr${k}}\\right)`, `M_{r${k}}`), "Minimum reinforcement, AASHTO 5.6.3.3");
    m(`M_{s${k}}\\coloneq ${opts.Ms}=`, "Service I moment", "kip*ft/ft");
    m(`\\rho_{${k}}\\coloneq\\frac{A_{s${k}}}{d_{e${k}}}=`);
    m(`k_{${k}}\\coloneq\\sqrt{2\\cdot\\rho_{${k}}\\cdot n+\\left(\\rho_{${k}}\\cdot n\\right)^{2}}-\\rho_{${k}}\\cdot n=`);
    m(`f_{ss${k}}\\coloneq\\frac{M_{s${k}}}{A_{s${k}}\\cdot\\left(1-\\frac{k_{${k}}}{3}\\right)\\cdot d_{e${k}}}=`, "Service steel stress", "ksi");
    m(`d_{c${k}}\\coloneq c_{${k}}+\\frac{d_{b${k}}}{2}=`, undefined, "in");
    m(`\\beta_{s${k}}\\coloneq1+\\frac{d_{c${k}}}{0.7\\cdot\\left(h_{${k}}-d_{c${k}}\\right)}=`);
    m(`s_{max${k}}\\coloneq\\frac{700\\cdot${opts.exposure === 1 ? "1.00" : "0.75"}\\cdot\\frac{\\mathrm{kip}}{\\mathrm{in}}}{\\beta_{s${k}}\\cdot f_{ss${k}}}-2\\cdot d_{c${k}}=`, `Crack control, AASHTO Eq. 5.6.7-1 (Class ${opts.exposure})`, "in");
    m(ok(`s_{${k}}`, `s_{max${k}}`), "Bar spacing");
    if (opts.shear !== "none") {
      m(`V_{u${k}}\\coloneq ${opts.Vu}=`, "Factored shear", "kip/ft");
      m(`d_{v${k}}\\coloneq\\max\\left(d_{e${k}}-\\frac{a_{${k}}}{2},0.9\\cdot d_{e${k}},0.72\\cdot h_{${k}}\\right)=`, "AASHTO 5.7.2.8", "in");
      if (opts.shear === "general") {
        m(`N_{u${k}}\\coloneq-1.25\\cdot\\left(${stemDead}\\right)=`, "Axial compression from the stem's weight", "kip/ft");
        m(`\\varepsilon_{s${k}}\\coloneq\\min\\left(0.006,\\max\\left(0,\\frac{\\frac{\\max\\left(M_{u${k}},V_{u${k}}\\cdot d_{v${k}}\\right)}{d_{v${k}}}+0.5\\cdot N_{u${k}}+V_{u${k}}}{E_s\\cdot A_{s${k}}}\\right)\\right)=`, "AASHTO Eq. 5.7.3.4.2-4, at most 0.006");
        m(`\\beta_{v${k}}\\coloneq\\frac{4.8}{1+750\\cdot\\varepsilon_{s${k}}}\\cdot\\frac{51}{39+\\max\\left(12,\\frac{d_{v${k}}}{\\mathrm{in}}\\right)}=`, "AASHTO Eq. 5.7.3.4.2-2 (sxe = dv, ag = 3/4 in)");
      } else m(`\\beta_{v${k}}\\coloneq2`, "AASHTO 5.7.3.4.1");
      m(`V_{r${k}}\\coloneq\\phi_v\\cdot0.0316\\cdot\\beta_{v${k}}\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot d_{v${k}}=`, "AASHTO 5.7.3.3", "kip/ft");
      m(ok(`V_{u${k}}`, `V_{r${k}}`), "Shear");
    }
  };

  const designGroups = ["StrIb", "StrIV", ...ext("ExtIIb")] as Combo[];
  text("Stem (at its base)", "subheading");
  m("h_{ss}\\coloneq h_s-t=", undefined, "ft");
  m("EH_s\\coloneq\\cos\\left(\\delta\\right)\\cdot\\frac{1}{2}\\cdot EFW_a\\cdot h_{ss}^{2}=", "Earth pressure on the stem", "kip/ft");
  if (live) m("LS_s\\coloneq EFW_a\\cdot h_{eq}\\cdot h_{ss}=", "Surcharge on the stem", "kip/ft");
  if (ct) {
    m("h_{Ts}\\coloneq h_{ct}+h_s=", "Impact to the base of the stem", "ft");
    m(i.ctAtEnd ? "CT_s\\coloneq\\frac{F_t}{\\frac{L_t}{2}+h_{Ts}}=" : "CT_s\\coloneq\\frac{F_t}{L_t+2\\cdot h_{Ts}}=", "Collision at the base of the stem", "kip/ft");
  }
  const ctS = (c: Combo, moment: boolean) => (ct && i.factors[c].ct ? `+${num(i.factors[c].ct)}\\cdot CT_s${moment ? "\\cdot h_{Ts}" : ""}` : "");
  const stemV = designGroups.map((c) => `${num(i.factors[c].eh)}\\cdot EH_s${live ? `+${num(i.factors[c].lsh)}\\cdot LS_s` : ""}${ctS(c, false)}`);
  const stemM = (c: Combo) => `${num(i.factors[c].eh)}\\cdot EH_s\\cdot\\frac{h_{ss}}{3}${live ? `+${num(i.factors[c].lsh)}\\cdot LS_s\\cdot\\frac{h_{ss}}{2}` : ""}${ctS(c, true)}`;
  member("st", "Stem", {
    Mu: `\\max\\left(${designGroups.map(stemM).join(",")}\\right)`,
    Ms: stemM("SerI"),
    Vu: `\\max\\left(${stemV.join(",")}\\right)`,
    h: "T_b",
    cover: i.coverStem,
    bars: i.stemBars,
    exposure: i.exposureStem,
    shear: "general",
  });

  text("Heel (at the back face of the stem)", "subheading");
  text("Self weight and fill; the bearing pressure under the heel is conservatively neglected.", "note");
  m("DC_h\\coloneq\\gamma_c\\cdot C\\cdot D=", undefined, "kip/ft");
  m("EV_h\\coloneq\\gamma_s\\cdot h_s\\cdot C=", undefined, "kip/ft");
  const heelV = (c: Combo) => `${num(i.factors[c].dc)}\\cdot DC_h+${num(i.factors[c].ev)}\\cdot EV_h`;
  const heelM = (c: Combo) => `\\left(${heelV(c)}\\right)\\cdot\\frac{C}{2}`;
  member("he", "Heel", { Mu: `\\max\\left(${designGroups.map(heelM).join(",")}\\right)`, Ms: heelM("SerI"), Vu: `\\max\\left(${designGroups.map(heelV).join(",")}\\right)`, h: "D", cover: i.coverHeel, bars: i.heelBars, exposure: i.exposureFooting, shear: "simplified" });

  text("Toe (at the front face of the stem)", "subheading");
  text("Under the largest factored bearing pressure; the toe's weight and fill are conservatively neglected.", "note");
  m(`\\sigma_{max}\\coloneq\\max\\left(\\sigma_{Ib},\\sigma_{IV}${ct ? ",\\sigma_{IIb}" : ""}\\right)=`, undefined, "ksf");
  m("\\sigma_{SI}\\coloneq\\frac{V_{SI}}{\\max\\left(B-2\\cdot e_{SI},0.001\\mathrm{ft}\\right)}=", "Service I", "ksf");
  member("to", "Toe", { Mu: "\\frac{\\sigma_{max}\\cdot A^{2}}{2}", Ms: "\\frac{\\sigma_{SI}\\cdot A^{2}}{2}", Vu: "\\sigma_{max}\\cdot A", h: "D", cover: i.coverToe, bars: i.toeBars, exposure: i.exposureFooting, shear: "simplified" });

  if (i.shearKey) {
    text("Shear key", "subheading");
    m("M_{key}\\coloneq\\frac{0.5\\cdot K_p\\cdot\\gamma_s\\cdot y_1\\cdot c_k^{2}+\\frac{1}{3}\\cdot K_p\\cdot\\gamma_s\\cdot c_k^{3}}{R_{ep}}\\cdot R_{ep}=", "Passive pressure on the inert block", "kip*ft/ft");
    member("k", "Shear key", { Mu: "M_{key}", Ms: "M_{key}", Vu: "0", h: "D_w", cover: i.coverKey, bars: i.keyBars, exposure: 1, shear: "none" });
  }
  return lines;
}

/** h_eq as the design engine has it (kept in step with liveLoadHeq). */
function liveHeq(i: CipInputs) {
  const H = i.Df === 0 ? i.He + i.D / 12 : i.He + i.Df;
  const table = i.trafficDistance >= 1 ? [2, 2, 2] : [5, 3.5, 2];
  const hs = [5, 10, 20];
  if (H <= 5) return table[0];
  for (let k = 1; k < 3; k++) if (H <= hs[k]) return table[k - 1] + ((table[k] - table[k - 1]) * (H - hs[k - 1])) / (hs[k] - hs[k - 1]);
  return table[2];
}
