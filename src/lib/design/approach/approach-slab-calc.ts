import type { Line } from "@/lib/calcs/library/templates";
import { checksSummary } from "../checks-summary";
import { COLOR_NOTE, INPUT_COLOR, isInput, num } from "../calc-style";
import type { Figure } from "../figures";
import { BARS, type Bars } from "../walls/cip";
import { designApproachSlab, sleeperBottom, type ApproachSlabInputs } from "./approach-slab";

// An approach slab as a Calcs worksheet: the design span and the equivalent strip, the dead load
// moments, the main bars, fatigue, shear, distribution and temperature bars, the dowels and the
// sleeper slab as live math with their AASHTO and CDOT references; the vehicles' largest moment and
// end reaction (moved across the span) and the dowels' development lengths as given values.

const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;

/** The checks, grouped as the editor groups them. */
export const APPROACH_GROUPS: { title: string; of: (id: string) => boolean }[] = [
  { title: "Slab and main bars", of: (id) => id === "depth" || id.startsWith("main") },
  { title: "Shear", of: (id) => id === "shear" },
  { title: "Distribution and temperature bars", of: (id) => id === "dist" || id.startsWith("temp") },
  { title: "Anchorage to the abutment", of: (id) => id.startsWith("dowel") },
  { title: "Sleeper slab", of: (id) => id.startsWith("sleeper") },
  { title: "Barrier on the edge", of: (id) => id === "barrier" },
];

export function approachSlabCalcLines(i: ApproachSlabInputs, title: string, figures?: { section?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note", extra?: { newPage?: boolean; keepWithNext?: boolean }) => lines.push({ text: t, ...(style ? { style } : {}), ...(extra ?? {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const given = (math: string, ref?: string) => lines.push({ math, ...(ref ? { ref } : {}) });
  const r = designApproachSlab(i);
  const kft = "\\frac{\\mathrm{kip}\\cdot\\mathrm{ft}}{\\mathrm{ft}}";
  const barArea = (b: Bars) => `\\frac{${num(BARS[b.bar].area)}\\mathrm{in}^{2}}{${num(b.spacing)}\\mathrm{in}}`;

  text(title.toUpperCase(), "heading");
  text(`Purpose:- The design of a ${num(i.t)} in cast-in-place approach slab, ${num(i.L)} ft long from the back of the abutment's notch and ${num(i.W)} ft wide${i.skew > 0 ? `, skewed ${num(i.skew)}°` : ""}, anchored to the abutment${i.sleeper ? " and resting on a sleeper slab at its far end" : ""}, to AASHTO LRFD (10th Edition) and the CDOT Bridge Design Manual.`);
  text(
    `Method:- The slab spans along the roadway as a one-way slab. The fill beneath it is taken to settle away from it over ${num(i.supportLoss * 100)}% of its length, which it then spans as a simple span (CDOT BDM 11.3.7, the PCI method). The vehicle's ${r.span.axlesOnly ? "axles alone (the span is 15 ft or less)" : "full HL-93 load (the span is over 15 ft)"} act on it (AASHTO 3.6.1.3.3), over the equivalent strip of a slab-type bridge (AASHTO 4.6.2.3). Its bars are epoxy coated (CDOT BDM 5.4.5). The layout, bars and sleeper slab follow CDOT worksheet B-601-1EA.`,
  );
  text(COLOR_NOTE, "note");

  text("Slab and span", "subheading", { newPage: true, keepWithNext: true });
  if (figures?.section) lines.push({ region: figures.section });
  m(`L_s\\coloneq ${num(i.L)}\\mathrm{ft}`, "Slab length, from the back of the notch");
  m(`W_s\\coloneq ${num(i.W)}\\mathrm{ft}`, "Slab width");
  m(`W_r\\coloneq ${num(i.roadway)}\\mathrm{ft}`, "Clear roadway width");
  m(`\\theta\\coloneq ${num(i.skew)}\\mathrm{deg}`, "Skew");
  m(`t_s\\coloneq ${num(i.t)}\\mathrm{in}`, "Slab thickness");
  m(ok("7\\mathrm{in}", "t_s"), "Least depth, AASHTO 9.7.1.1");
  if (i.criteria === "cdot") m(ok("20\\mathrm{ft}", "L_s"), "For information: the worksheet's least length, CDOT B-601-1EA");
  m(`k_s\\coloneq ${num(i.supportLoss)}`, "The design span as a fraction of the length, CDOT BDM 11.3.7");
  m("S_d\\coloneq k_s\\cdot L_s=", "Design span", "ft");
  m(`f'_{c}\\coloneq ${num(i.fc)}\\mathrm{ksi}`);
  m(`f_y\\coloneq ${num(i.fy)}\\mathrm{ksi}`);
  m(`\\gamma_c\\coloneq ${num(i.gammaC)}\\mathrm{kcf}`);
  m("E_c\\coloneq120000\\cdot\\left(\\frac{\\gamma_c}{\\mathrm{kcf}}\\right)^{2}\\cdot\\left(\\frac{f'_{c}}{\\mathrm{ksi}}\\right)^{0.33}\\cdot\\mathrm{ksi}=", "AASHTO Eq. 5.4.2.4-1", "ksi");
  m("n\\coloneq\\frac{29000\\mathrm{ksi}}{E_c}=", "Modular ratio");
  m("f_r\\coloneq0.24\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}=", "AASHTO 5.4.2.6");

  text("Equivalent strip (AASHTO 4.6.2.3)", "subheading", { keepWithNext: true });
  m(`N_L\\coloneq ${r.span.NL}`, "Design lanes, the clear roadway's whole 12 ft lanes, AASHTO 3.6.1.1.1");
  m("L_1\\coloneq\\min\\left(S_d,60\\mathrm{ft}\\right)=", undefined, "ft");
  m("E_1\\coloneq10\\mathrm{in}+5\\cdot\\sqrt{\\frac{L_1}{\\mathrm{ft}}\\cdot\\frac{\\min\\left(W_s,30\\mathrm{ft}\\right)}{\\mathrm{ft}}}\\cdot\\mathrm{in}=", "One lane loaded, AASHTO Eq. 4.6.2.3-1", "in");
  if (r.span.NL > 1) {
    m("E_m\\coloneq\\min\\left(84\\mathrm{in}+1.44\\cdot\\sqrt{\\frac{L_1}{\\mathrm{ft}}\\cdot\\frac{\\min\\left(W_s,60\\mathrm{ft}\\right)}{\\mathrm{ft}}}\\cdot\\mathrm{in},\\frac{W_s}{N_L}\\right)=", "More than one lane, AASHTO Eq. 4.6.2.3-2", "in");
    m("E_s\\coloneq\\min\\left(E_1,E_m\\right)=", "The strip, the lesser", "ft");
  } else m("E_s\\coloneq E_1=", "One design lane", "ft");
  m("r_{sk}\\coloneq\\min\\left(1.05-0.25\\cdot\\tan\\left(\\theta\\right),1\\right)=", "Skew, AASHTO Eq. 4.6.2.3-3");

  text("Moments and shear, per foot of width", "subheading", { keepWithNext: true });
  m("w_{DC}\\coloneq\\gamma_c\\cdot t_s=", "The slab", "ksf");
  m("M_{DC}\\coloneq\\frac{w_{DC}\\cdot S_d^{2}}{8}=", undefined, "kip*ft/ft");
  m("V_{DC}\\coloneq\\frac{w_{DC}\\cdot S_d}{2}=", undefined, "kip/ft");
  if (i.wearing > 0) {
    m(`w_{DW}\\coloneq ${num(i.gammaWS)}\\mathrm{kcf}\\cdot ${num(i.wearing)}\\mathrm{in}=`, "The overlay", "ksf");
    m("M_{DW}\\coloneq\\frac{w_{DW}\\cdot S_d^{2}}{8}=", undefined, "kip*ft/ft");
    m("V_{DW}\\coloneq\\frac{w_{DW}\\cdot S_d}{2}=", undefined, "kip/ft");
  }
  text(
    `Live load:- ${r.loads.runs.map((x) => `the ${x.name.charAt(0).toLowerCase()}${x.name.slice(1)} gives at most ${num(x.M)} kip·ft and an end reaction of ${num(x.R)} kip`).join("; ")}, each moved across the simple span. ${r.span.axlesOnly ? "No lane load applies (AASHTO 3.6.1.3.3)." : "The 0.64 klf lane load is added (AASHTO 3.6.1.2.4)."}`,
  );
  given(`M_{veh}\\coloneq ${num(Math.max(...r.loads.runs.map((x) => x.M)))}\\mathrm{kip}\\cdot\\mathrm{ft}`, `Per lane: ${r.loads.gov.M}`);
  given(`R_{veh}\\coloneq ${num(Math.max(...r.loads.runs.map((x) => x.R)))}\\mathrm{kip}`, `Per lane: ${r.loads.gov.V}`);
  const lane = r.span.axlesOnly ? "" : "+\\frac{0.64\\frac{\\mathrm{kip}}{\\mathrm{ft}}\\cdot S_d^{2}}{8}";
  const laneV = r.span.axlesOnly ? "" : "+\\frac{0.64\\frac{\\mathrm{kip}}{\\mathrm{ft}}\\cdot S_d}{2}";
  m(`M_{LL}\\coloneq\\frac{1.33\\cdot M_{veh}${lane}}{E_s}\\cdot r_{sk}=`, "With IM 33%, AASHTO 3.6.2.1", "kip*ft/ft");
  m(`V_{LL}\\coloneq\\frac{1.33\\cdot R_{veh}${laneV}}{E_s}=`, undefined, "kip/ft");
  const dw = i.wearing > 0;
  m(`M_u\\coloneq1.25\\cdot M_{DC}${dw ? "+1.5\\cdot M_{DW}" : ""}+1.75\\cdot M_{LL}=`, "Strength I, AASHTO Table 3.4.1-1", "kip*ft/ft");
  m(`M_s\\coloneq M_{DC}${dw ? "+M_{DW}" : ""}+M_{LL}=`, "Service I", "kip*ft/ft");
  m(`V_u\\coloneq1.25\\cdot V_{DC}${dw ? "+1.5\\cdot V_{DW}" : ""}+1.75\\cdot V_{LL}=`, "Strength I", "kip/ft");

  const mb = BARS[i.mainBars.bar];
  text("Main bars, bottom along the roadway", "subheading", { keepWithNext: true });
  m(`c_b\\coloneq ${num(i.coverBot)}\\mathrm{in}`, "Bottom cover, cast on earth, CDOT BDM 5.4.3");
  m(`d_b\\coloneq ${num(mb.dia)}\\mathrm{in}`, `#${i.mainBars.bar} bars`);
  m(`s_m\\coloneq ${num(i.mainBars.spacing)}\\mathrm{in}`, "Spacing");
  m("d_e\\coloneq t_s-c_b-\\frac{d_b}{2}=", "Effective depth", "in");
  m(`A_s\\coloneq\\frac{${num(mb.area)}\\mathrm{in}^{2}}{s_m}=`, "Per foot", "in^2/ft");
  m("a\\coloneq\\frac{A_s\\cdot f_y}{0.85\\cdot f'_{c}}=", "Stress block", "in");
  m("M_r\\coloneq0.9\\cdot A_s\\cdot f_y\\cdot\\left(d_e-\\frac{a}{2}\\right)=", "AASHTO 5.6.3.2", "kip*ft/ft");
  m(ok("M_u", "M_r"), "Flexure");
  if (i.criteria !== "cdot") {
    // The worksheet's bars are CDOT's: compared only under its criteria.
  } else if (r.worksheet) {
    text(`Worksheet:- CDOT B-601-1EA puts #${r.worksheet.bar} bars at ${r.worksheet.spacing} in in the bottom of a ${num(i.L)} ft slab (#6 at 20 ft, #9 over 20 ft and under 31 ft).`, "note");
    m(`A_{ws}\\coloneq\\frac{${num(BARS[r.worksheet.bar].area)}\\mathrm{in}^{2}}{${num(r.worksheet.spacing)}\\mathrm{in}}=`, "The worksheet's bars", "in^2/ft");
    m(ok("A_{ws}", "A_s"), "For information: at least the worksheet's, CDOT B-601-1EA");
  } else {
    text("Worksheet:- CDOT B-601-1EA covers slabs under 31 ft; this one is a special design.", "note");
    m(ok("L_s", "31\\mathrm{ft}"), "For information: within the worksheet's range");
  }
  m("M_{cr}\\coloneq0.67\\cdot1.6\\cdot f_r\\cdot\\frac{t_s^{2}}{6}=", "AASHTO Eq. 5.6.3.3-1", "kip*ft/ft");
  m(ok("\\min\\left(1.33\\cdot M_u,M_{cr}\\right)", "M_r"), "Minimum reinforcement, AASHTO 5.6.3.3");
  m("\\rho\\coloneq\\frac{A_s}{d_e}=");
  m("k\\coloneq\\sqrt{2\\cdot\\rho\\cdot n+\\left(\\rho\\cdot n\\right)^{2}}-\\rho\\cdot n=");
  m("j\\coloneq1-\\frac{k}{3}=");
  m("f_{ss}\\coloneq\\frac{M_s}{A_s\\cdot j\\cdot d_e}=", "Service steel stress", "ksi");
  m(ok("f_{ss}", "0.6\\cdot f_y"), "AASHTO 5.6.7");
  m("d_c\\coloneq c_b+\\frac{d_b}{2}=", undefined, "in");
  m("\\beta_s\\coloneq1+\\frac{d_c}{0.7\\cdot\\left(t_s-d_c\\right)}=");
  m(`s_{max}\\coloneq\\frac{700\\cdot${i.exposure === 1 ? "1.00" : "0.75"}\\cdot\\frac{\\mathrm{kip}}{\\mathrm{in}}}{\\beta_s\\cdot f_{ss}}-2\\cdot d_c=`, `Crack control, AASHTO Eq. 5.6.7-1 (Class ${i.exposure})`, "in");
  m(ok("s_m", "s_{max}"), "Bar spacing");
  m(ok("s_m", "\\min\\left(1.5\\cdot t_s,18\\mathrm{in}\\right)"), "Spacing of primary bars, AASHTO 5.10.3.2");

  text("Fatigue of the main bars (AASHTO 5.5.3.2), for information", "subheading", { keepWithNext: true });
  text("Fatigue I:- one fatigue truck (AASHTO 3.6.1.4.1), its rear axles 30 ft apart, with IM 15%, over the one-lane strip with its multiple presence factor of 1.2 taken back out (AASHTO C4.6.2.3, 3.6.1.4.3b).");
  given(`M_{fv}\\coloneq ${num(r.fatigue.M)}\\mathrm{kip}\\cdot\\mathrm{ft}`, "The fatigue truck moved across the span");
  m("M_f\\coloneq\\frac{1.15\\cdot M_{fv}}{1.2\\cdot E_1}\\cdot r_{sk}=", undefined, "kip*ft/ft");
  m("f_{rng}\\coloneq\\frac{1.75\\cdot M_f}{A_s\\cdot j\\cdot d_e}=", "Stress range, γ = 1.75", "ksi");
  m(`f_{min}\\coloneq\\frac{M_{DC}${dw ? "+M_{DW}" : ""}}{A_s\\cdot j\\cdot d_e}=`, "Under the permanent loads", "ksi");
  m("F_{TH}\\coloneq26\\mathrm{ksi}-22\\cdot\\frac{f_{min}}{f_y}\\cdot\\mathrm{ksi}=", "AASHTO Eq. 5.5.3.2-1", "ksi");
  m(ok("f_{rng}", "F_{TH}"), "For information: CDOT's predesigned worksheet does not check fatigue");

  text("Shear (AASHTO 5.12.2.1, 5.7.3.3)", "subheading", { keepWithNext: true });
  text("Shear:- slabs designed for moment by AASHTO 4.6.2.3 may be taken as satisfactory for shear (AASHTO 5.12.2.1). The concrete's resistance with β = 2 is shown as well.");
  m("d_v\\coloneq\\max\\left(0.9\\cdot d_e,0.72\\cdot t_s\\right)=", "AASHTO 5.7.2.8", "in");
  m("V_c\\coloneq0.0316\\cdot2\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot12\\mathrm{in}\\cdot\\frac{d_v}{\\mathrm{ft}}=", "AASHTO Eq. 5.7.3.3-3, per foot", "kip/ft");
  m(ok("V_u", "0.9\\cdot V_c"), "For information (AASHTO 5.12.2.1)");

  text("Distribution and temperature bars", "subheading", { keepWithNext: true });
  m("p\\coloneq\\min\\left(\\frac{100}{\\sqrt{\\frac{S_d}{\\mathrm{ft}}}},50\\right)=", "Percent of the main bars, primary bars parallel to traffic, AASHTO 9.7.3.2");
  m(`A_{sd}\\coloneq ${barArea(i.distBars)}=`, `Bottom transverse, #${i.distBars.bar} at ${num(i.distBars.spacing)} in`, "in^2/ft");
  m(ok("\\frac{p}{100}\\cdot A_s", "A_{sd}"), "Distribution reinforcement");
  m("A_{st}\\coloneq\\max\\left(\\frac{1.3\\cdot W_s\\cdot t_s}{2\\cdot\\left(W_s+t_s\\right)\\cdot f_y}\\cdot\\frac{\\mathrm{kip}}{\\mathrm{in}\\cdot\\mathrm{ft}},0.11\\frac{\\mathrm{in}^{2}}{\\mathrm{ft}}\\right)=", "Shrinkage and temperature, each face, AASHTO Eq. 5.10.6-1", "in^2/ft");
  for (const [sym, name, b] of [["tl", "Top longitudinal", i.topLong], ["tt", "Top transverse", i.topTrans]] as const) {
    m(`A_{${sym}}\\coloneq ${barArea(b)}=`, `${name}, #${b.bar} at ${num(b.spacing)} in`, "in^2/ft");
    m(`\\operatorname{if}\\left(A_{st}\\le A_{${sym}},\\operatorname{if}\\left(A_{${sym}}\\le0.6\\frac{\\mathrm{in}^{2}}{\\mathrm{ft}},\\text{OK},\\text{NG}\\right),\\text{NG}\\right)=`, "Between the minimum and 0.60 in²/ft");
    m(ok(`${num(b.spacing)}\\mathrm{in}`, "\\min\\left(3\\cdot t_s,18\\mathrm{in}\\right)"), "Spacing, AASHTO 5.10.6");
  }

  text("Anchorage to the abutment (CDOT BDM 2.13)", "subheading", { keepWithNext: true });
  text(`Dowels:- #${i.dowels.bar} at ${num(i.dowels.spacing)} in run straight through the joint at the slab's mid-depth, their leg turned down in the abutment (CDOT B-601-1EA Detail 1). Their development lengths, epoxy coated, are worked out by AASHTO 5.10.8.2.1 (straight, in the slab) and 5.10.8.2.4 (hooked, in the abutment).`);
  given(`l_{d}\\coloneq ${num(r.dowels.ld)}\\mathrm{in}`, "Straight, AASHTO 5.10.8.2.1");
  m(`l_{s}\\coloneq ${num(i.dowelSlab)}\\mathrm{in}`, "Embedment into the slab");
  m(ok("l_{d}", "l_{s}"), "Developed in the slab");
  given(`l_{dh}\\coloneq ${num(r.dowels.ldh)}\\mathrm{in}`, "Hooked, AASHTO 5.10.8.2.4");
  m(`l_{a}\\coloneq ${num(i.dowelAbut)}\\mathrm{in}`, "Embedment into the abutment");
  m(ok("l_{dh}", "l_{a}"), "Developed in the abutment");

  if (r.sleeper) {
    const sb = BARS[i.sleeperBars.bar];
    text("Sleeper slab", "subheading", { keepWithNext: true });
    text(`Sleeper:- ${i.joint === "device" ? "as CDOT worksheet B-601-1EA lays it out, 4'-0\" by 1'-0\" with a block under the expansion device and the slab on a ledge" : "as CDOT worksheet B-601-1 lays it out, 3'-0\" by 1'-0\" with the slab on it and 1'-0\" past the slab's end"}. The slab's end reaction (the span next to the sleeper) is spread uniformly over the sleeper's width; its own weight${i.joint === "device" ? " and the block's" : ""} bear${i.joint === "device" ? "" : "s"} directly. Its bars across its width take the soil's pressure on the part beyond the slab's ledge as a cantilever.`);
    m(`B_{sl}\\coloneq ${num(i.sleeperB)}\\mathrm{ft}`, "Width along the roadway");
    m(`t_{sl}\\coloneq ${num(i.sleeperT)}\\mathrm{in}`, "Thickness");
    m(`b_{seat}\\coloneq ${num(i.sleeperSeat)}\\mathrm{in}`, "The slab's ledge on it");
    m(`P_u\\coloneq1.25\\cdot V_{DC}${dw ? "+1.5\\cdot V_{DW}" : ""}+1.75\\cdot V_{LL}=`, "Strength I end reaction", "kip/ft");
    if (i.joint === "device") {
      m(`b_{blk}\\coloneq ${num(i.blockW)}\\mathrm{in}`, "The block under the device");
      m(`h_{blk}\\coloneq t_s+${num(i.wearing)}\\mathrm{in}=`, "Its height, up to the roadway's surface", "in");
      m("q_u\\coloneq\\frac{P_u}{B_{sl}}+1.25\\cdot\\gamma_c\\cdot\\left(t_{sl}+\\frac{h_{blk}\\cdot b_{blk}}{B_{sl}}\\right)=", "Factored bearing pressure", "ksf");
    } else m("q_u\\coloneq\\frac{P_u}{B_{sl}}+1.25\\cdot\\gamma_c\\cdot t_{sl}=", "Factored bearing pressure", "ksf");
    m(`q_R\\coloneq ${num(i.qR)}\\mathrm{ksf}`, "Factored bearing resistance, geotechnical report, AASHTO 10.6.3.1");
    m(ok("q_u", "q_R"), "Bearing");
    m("c_{sl}\\coloneq B_{sl}-b_{seat}=", "Beyond the slab's ledge", "ft");
    m("M_{usl}\\coloneq\\frac{P_u}{B_{sl}}\\cdot\\frac{c_{sl}^{2}}{2}=", undefined, "kip*ft/ft");
    m(`d_{sl}\\coloneq t_{sl}-3\\mathrm{in}-\\frac{${num(sb.dia)}\\mathrm{in}}{2}=`, `#${i.sleeperBars.bar} at ${num(i.sleeperBars.spacing)} in, 3 in cover`, "in");
    m(`A_{sl}\\coloneq ${barArea(sleeperBottom(i))}=`, i.joint === "device" ? "Two bars at each place, CDOT B-601-1EA" : undefined, "in^2/ft");
    m("M_{rsl}\\coloneq0.9\\cdot A_{sl}\\cdot f_y\\cdot\\left(d_{sl}-\\frac{A_{sl}\\cdot f_y}{2\\cdot0.85\\cdot f'_{c}}\\right)=", "AASHTO 5.6.3.2", "kip*ft/ft");
    m(ok("M_{usl}", "M_{rsl}"), "Flexure");
    m("M_{crsl}\\coloneq0.67\\cdot1.6\\cdot f_r\\cdot\\frac{t_{sl}^{2}}{6}=", "AASHTO Eq. 5.6.3.3-1", "kip*ft/ft");
    m(ok("\\min\\left(1.33\\cdot M_{usl},M_{crsl}\\right)", "M_{rsl}"), "Minimum reinforcement, AASHTO 5.6.3.3");
    m(`A_{sll}\\coloneq ${barArea(i.sleeperLong)}=`, `Along it, #${i.sleeperLong.bar} at ${num(i.sleeperLong.spacing)} in each face`, "in^2/ft");
    m("A_{stsl}\\coloneq\\max\\left(\\frac{1.3\\cdot B_{sl}\\cdot t_{sl}}{2\\cdot\\left(B_{sl}+t_{sl}\\right)\\cdot f_y}\\cdot\\frac{\\mathrm{kip}}{\\mathrm{in}\\cdot\\mathrm{ft}},0.11\\frac{\\mathrm{in}^{2}}{\\mathrm{ft}}\\right)=", "AASHTO Eq. 5.10.6-1", "in^2/ft");
    m("\\operatorname{if}\\left(A_{stsl}\\le A_{sll},\\operatorname{if}\\left(A_{sll}\\le0.6\\frac{\\mathrm{in}^{2}}{\\mathrm{ft}},\\text{OK},\\text{NG}\\right),\\text{NG}\\right)=", "Shrinkage and temperature");
  }

  if (r.barrier) {
    const tb = BARS[i.topTrans.bar];
    text("Barrier on the slab's edge (AASHTO A13.4.1, CDOT BDM 11.3.7)", "subheading", { keepWithNext: true });
    text("Barrier:- as with a deck overhang, the barrier is the fuse: the slab's top transverse bars at its face carry the barrier's moment with the axial tension (Extreme Event II, Case 1).");
    m(`M_c\\coloneq ${num(i.Mc)}${kft}`, "The barrier's flexural resistance at its base");
    m(`T_b\\coloneq ${num(i.T)}\\frac{\\mathrm{kip}}{\\mathrm{ft}}`, "Axial tension, AASHTO Eq. A13.4.2-1");
    m(`c_t\\coloneq ${num(i.coverTop)}\\mathrm{in}`, "Top cover");
    m("A_{s1}\\coloneq A_{tt}-\\frac{0.5\\cdot T_b}{f_y}=", "Top bars less half the tension", "in^2/ft");
    m(`d_1\\coloneq t_s-c_t-\\frac{${num(tb.dia)}\\mathrm{in}}{2}=`, undefined, "in");
    m("M_{r1}\\coloneq1.0\\cdot A_{s1}\\cdot f_y\\cdot\\left(d_1-\\frac{A_{s1}\\cdot f_y}{2\\cdot0.85\\cdot f'_{c}}\\right)=", "φ = 1.0", "kip*ft/ft");
    m(ok("M_c", "M_{r1}"), "Case 1");
  }

  lines.push(...checksSummary(APPROACH_GROUPS.map((g) => ({ title: g.title, checks: r.checks.filter((c) => g.of(c.id)) }))));
  return lines;
}
