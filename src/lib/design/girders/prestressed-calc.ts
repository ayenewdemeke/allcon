import { inputLabel } from "./from-plans";
import type { Line } from "@/lib/calcs/library/templates";
import { cell, COLOR_NOTE, INPUT_COLOR, isInput, num } from "../calc-style";
import type { Figure } from "../figures";
import { BARS } from "../walls/cip";
import { railDef } from "../decks/rails";
import { textTable } from "../svg-table";
import { checksSummary } from "../checks-summary";
import { girderSchedule, SCHEDULE_HEAD, scheduleCells } from "./schedule";
import { CONNECTION_STRESS, criteriaInputs, designGirder, EP, liveLoad, spanInputs, strandGroups, STRANDS, zoneCallout, type GirderInputs, type GirderResult } from "./prestressed";

// The LRFD Bridge Design Check as a Calcs worksheet, for the controlling girder: the section's
// properties and the analysis's live load envelopes as given values (from the outline and the
// moving loads), then every step worked out live with its AASHTO LRFD (10th ed.) article. A summary
// of every check, for both girders, closes it.

const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;
const kft = "\\mathrm{kip}\\cdot\\mathrm{ft}";

const verdict = (c: { ok: boolean; advisory?: boolean }) => (c.advisory ? (c.ok ? "Info" : "Info, over") : c.ok ? "OK" : "NG");

export function girderCalcLines(entered: GirderInputs, title: string, figures?: { section?: Figure; elevation?: Figure; handling?: Figure; bridge?: Figure; schedule?: Figure }): Line[] {
  const input = criteriaInputs(entered);
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note") => lines.push({ text: t, ...(style ? { style } : {}) });
  const m = (math: string, ref?: string, unit?: string) => lines.push({ math, ...(ref ? { ref } : {}), ...(unit ? { unit } : {}), ...(math.length > 110 && ref ? { wide: true } : {}), ...(isInput(math) ? { color: INPUT_COLOR } : {}) });
  const given = (math: string, ref?: string) => lines.push({ math, ...(ref ? { ref } : {}) });

  const design = designGirder(input);
  // A continuous bridge: the controlling span is worked out, with its strands and length.
  const cont = design.continuous;
  const spanNo = design.controllingSpan;
  const g: GirderResult = design.spans[spanNo][design.controlling];
  // A computed haunch (CDOT BDM 5.5.2.1) is the one the design settled on for this girder.
  const i = { ...spanInputs(input, spanNo), haunch: g.haunch.design };
  const ext = g.exterior;
  const strand = STRANDS[i.strandDia];
  const relStation = g.stations.find((s) => !s.pier) ?? g.stations[0]; // the transfer point (or the first station)
  const midStation = g.stations.find((s) => Math.abs(s.x - i.L / 2) < 1e-6) ?? g.stations[g.stations.length - 1];
  const shearStation = g.stations.filter((s) => s.shear).reduce((a, b) => (b.Vu / b.phiVn! > a.Vu / a.phiVn! ? b : a));
  const sh = shearStation.shear!;
  const cdot = i.criteria === "cdot";

  text(title.toUpperCase(), "heading");
  text(
    cont
      ? `LRFD Bridge Design Check: a ${design.spans.length}-span bridge of precast, pretensioned ${g.shape.name} girders with a composite cast-in-place deck, made continuous over the piers for the loads after the diaphragms are cast (AASHTO 5.12.3.3), to the AASHTO LRFD Bridge Design Specifications, 10th edition (2024). This worksheet works out span ${spanNo + 1}'s ${ext ? "exterior" : "interior"} girder, which controls, and the continuity over the piers; the summary at the end lists every check for every span, pier and girder. Stresses are positive in compression.`
      : `LRFD Bridge Design Check: a simple-span precast, pretensioned ${g.shape.name} girder with a composite cast-in-place deck, to the AASHTO LRFD Bridge Design Specifications, 10th edition (2024). This worksheet works out the ${ext ? "exterior" : "interior"} girder, which controls; the summary at the end lists every check for both girders. Stresses are positive in compression.`,
  );
  if (cdot)
    text(
      "Design criteria: AASHTO LRFD with the CDOT Bridge Design Manual's amendments: the Colorado Permit Vehicle and EV3 at Strength II with HL-93's distribution factors and impact (BDM 3.6); f′ci ≤ 6.5 ksi and f′c ≤ 8.5 ksi without approval (5.3.1.2); Service III γLL = 1.0 with refined losses and elastic gains, the live load's elastic gain included (5.5.1.1); no tension under dead load alone after losses (5.5.1.3); hold-down ≤ 4.0 kip per strand (5.5.2.2); restraint moments taken as zero and the positive moment connection designed for 1.2 Mcr (5.7.2); a joint fully effective only when the girders are at least 60 days old (5.7.3); stirrups at most 18 in apart (5.5.1.6); the top harped strand at most 6 in below the top and 60 in high, no harped strands under 100 ft, harp points at 0.35–0.45 L and at most 2,800 kip on the bed (5.5.1.5, sheet B-618-CBT2); girders up to 154 ft and 240 kip to ship (5.5.1.9); camber at 60 days with a ±30% tolerance (at least 1 in), no sag, and the minimum haunches (5.5.2.1). Lifting and hauling are the fabricator's design (5.5.1.8): worked out below for information only.",
      "note",
    );
  text(COLOR_NOTE, "note");
  if (input.fromPlans) {
    text(`Inputs from the plans${input.fromPlans.drawingSet ? ` (${input.fromPlans.drawingSet})` : ""}, each confirmed by the engineer:`, "subheading");
    for (const v of input.fromPlans.values)
      text(`${inputLabel(v.input)}: ${v.source ? `sheet ${v.source.sheet}` : "the tool's default (not on the plans)"}${v.status === "edited" ? ", changed by the engineer" : ""}.`, "note");
  }

  // --- bridge and girder -------------------------------------------------------------------------
  text("Bridge and girder", "subheading");
  if (cont) text(`Spans ${design.spans.map((s) => `${num(s.L)} ft`).join(", ")}; this is span ${spanNo + 1}.`, "note");
  m(`L\\coloneq ${num(i.L)}\\mathrm{ft}`, cont ? `Span ${spanNo + 1}, bearing to bearing` : "Span, bearing to bearing");
  m(`e_{nd}\\coloneq ${num(i.endDist)}\\mathrm{ft}`, "Girder end to the bearing's centerline");
  m("L_g\\coloneq L+2\\cdot e_{nd}=", "Girder length", "ft");
  m(`N_b\\coloneq ${num(i.nGirders)}`, "Girders");
  m(`S\\coloneq ${num(i.S)}\\mathrm{ft}`, "Girder spacing");
  m(`O_h\\coloneq ${num(i.overhang)}\\mathrm{ft}`, "Overhang, exterior girder to the deck edge");
  m(`b_{br}\\coloneq ${num(i.barrierWidth)}\\mathrm{ft}`, "Deck edge to the barrier's inside face");
  m(`\\theta_s\\coloneq ${num(i.skew)}\\mathrm{deg}`, "Skew");
  if (figures?.bridge) {
    const rail = railDef(input.rail?.type ?? "custom");
    text(`Typical section:- ${rail ? `${rail.name.replace(/ \(#\d option\)/, "")} (CDOT ${rail.sheet}), ${num(input.barrierWeight * 1000)} plf each, on both edges; ` : ""}the roadway ${input.crown?.kind === "one-way" ? "sloping one way" : "crowned"} at ${num(input.crossSlope ?? 0.02)} ft/ft.`);
    lines.push({ region: figures.bridge });
  }
  text(`${g.shape.name}${g.shape.published ? ` (${g.shape.published.source})` : ""}. Properties from its outline:`, "note");
  given(`H\\coloneq ${num(g.shape.depth)}\\mathrm{in}`, "Depth");
  given(`A_g\\coloneq ${num(g.g.A, 3)}\\mathrm{in}^{2}`, "Area");
  given(`I_g\\coloneq ${num(g.g.I, 1)}\\mathrm{in}^{4}`, "Moment of inertia");
  given(`y_b\\coloneq ${num(g.g.yb, 4)}\\mathrm{in}`, "Centroid above the bottom");
  given(`P_g\\coloneq ${num(g.g.perimeter, 3)}\\mathrm{in}`, "Perimeter");
  given(`b_{tf}\\coloneq ${num(g.shape.topWidth)}\\mathrm{in}`, "Top flange width");
  given(`b_v\\coloneq ${num(g.shape.web)}\\mathrm{in}`, "Web width");
  m("S_b\\coloneq\\frac{I_g}{y_b}=", undefined, "in^3");
  m("S_t\\coloneq\\frac{I_g}{H-y_b}=", undefined, "in^3");
  if (figures?.section) lines.push({ region: figures.section });

  // --- materials -----------------------------------------------------------------------------------
  text("Materials", "subheading");
  m(`f'_{ci}\\coloneq ${num(i.fci)}\\mathrm{ksi}`, "Girder at release");
  m(`f'_{c}\\coloneq ${num(i.fc)}\\mathrm{ksi}`, "Girder");
  m(`w_c\\coloneq ${num(i.wc)}\\mathrm{kcf}`, i.wcLoad ? "Girder unit weight, for Ec" : "Girder unit weight");
  if (i.wcLoad) m(`w_{cw}\\coloneq ${num(i.wcLoad)}\\mathrm{kcf}`, "Girder unit weight with its reinforcement, for its weight");
  m(`K_1\\coloneq ${num(i.K1)}`, "AASHTO 5.4.2.4");
  m("E_{ci}\\coloneq120000\\cdot K_1\\cdot\\left(\\frac{w_c}{\\mathrm{kcf}}\\right)^{2}\\cdot\\left(\\frac{f'_{ci}}{\\mathrm{ksi}}\\right)^{0.33}\\cdot\\mathrm{ksi}=", "AASHTO Eq. 5.4.2.4-1", "ksi");
  m("E_c\\coloneq120000\\cdot K_1\\cdot\\left(\\frac{w_c}{\\mathrm{kcf}}\\right)^{2}\\cdot\\left(\\frac{f'_{c}}{\\mathrm{ksi}}\\right)^{0.33}\\cdot\\mathrm{ksi}=", "AASHTO Eq. 5.4.2.4-1", "ksi");
  m(`f'_{cd}\\coloneq ${num(i.fcDeck)}\\mathrm{ksi}`, "Deck");
  m(`w_{cd}\\coloneq ${num(i.wcDeck)}\\mathrm{kcf}`, i.wcDeckLoad ? "Deck unit weight, for Ec" : "Deck unit weight");
  if (i.wcDeckLoad) m(`w_{cdw}\\coloneq ${num(i.wcDeckLoad)}\\mathrm{kcf}`, "Deck unit weight with its reinforcement, for its weight");
  m("E_{cd}\\coloneq120000\\cdot\\left(\\frac{w_{cd}}{\\mathrm{kcf}}\\right)^{2}\\cdot\\left(\\frac{f'_{cd}}{\\mathrm{ksi}}\\right)^{0.33}\\cdot\\mathrm{ksi}=", "AASHTO Eq. 5.4.2.4-1", "ksi");
  m(`f_{pu}\\coloneq ${num(i.fpu)}\\mathrm{ksi}`, `${i.strandDia} in, Grade 270 low-relaxation strand`);
  m(`E_p\\coloneq ${num(EP)}\\mathrm{ksi}`, "AASHTO 5.4.4.2");
  m(`f_y\\coloneq ${num(i.fy)}\\mathrm{ksi}`, "Stirrups");

  // --- composite section -----------------------------------------------------------------------
  text("Composite section", "subheading");
  m(`t_d\\coloneq ${num(i.deckT)}\\mathrm{in}`, "Deck as cast");
  m(`t_{sac}\\coloneq ${num(i.sacrificial)}\\mathrm{in}`, "Sacrificial (integral wearing) layer");
  m("t_s\\coloneq t_d-t_{sac}=", "Structural deck", "in");
  m(`h_h\\coloneq ${num(i.haunch)}\\mathrm{in}`, i.haunchInSection ? "Haunch, counted in the section" : "Haunch, a load only (left out of the section)");
  m(ext ? "b_e\\coloneq\\frac{S}{2}+O_h=" : "b_e\\coloneq S=", "Effective flange width, the tributary width, AASHTO 4.6.2.6.1", "ft");
  m("n\\coloneq\\frac{E_{cd}}{E_c}=", "Deck to girder");
  m("A_d\\coloneq n\\cdot b_e\\cdot t_s=", "Transformed deck", "in^2");
  const hh = i.haunchInSection ? "h_h" : "0\\mathrm{in}";
  m(`y_d\\coloneq H+${hh}+\\frac{t_s}{2}=`, "Deck centroid above the girder's bottom", "in");
  if (i.haunchInSection) {
    m("A_h\\coloneq n\\cdot b_{tf}\\cdot h_h=", "Transformed haunch", "in^2");
    m("y_h\\coloneq H+\\frac{h_h}{2}=", undefined, "in");
    m("A_c\\coloneq A_g+A_h+A_d=", undefined, "in^2");
    m("y_{bc}\\coloneq\\frac{A_g\\cdot y_b+A_h\\cdot y_h+A_d\\cdot y_d}{A_c}=", undefined, "in");
    m("I_{c1}\\coloneq I_g+A_g\\cdot\\left(y_{bc}-y_b\\right)^{2}=", "The girder, about the composite section's axis", "in^4");
    m("I_{c2}\\coloneq\\frac{n\\cdot b_{tf}\\cdot h_h^{3}}{12}+A_h\\cdot\\left(y_h-y_{bc}\\right)^{2}=", "The haunch", "in^4");
    m("I_{c3}\\coloneq\\frac{n\\cdot b_e\\cdot t_s^{3}}{12}+A_d\\cdot\\left(y_d-y_{bc}\\right)^{2}=", "The deck", "in^4");
    m("I_c\\coloneq I_{c1}+I_{c2}+I_{c3}=", undefined, "in^4");
  } else {
    m("A_c\\coloneq A_g+A_d=", undefined, "in^2");
    m("y_{bc}\\coloneq\\frac{A_g\\cdot y_b+A_d\\cdot y_d}{A_c}=", undefined, "in");
    m("I_{c1}\\coloneq I_g+A_g\\cdot\\left(y_{bc}-y_b\\right)^{2}=", "The girder, about the composite section's axis", "in^4");
    m("I_{c3}\\coloneq\\frac{n\\cdot b_e\\cdot t_s^{3}}{12}+A_d\\cdot\\left(y_d-y_{bc}\\right)^{2}=", "The deck", "in^4");
    m("I_c\\coloneq I_{c1}+I_{c3}=", undefined, "in^4");
  }
  m(`h_c\\coloneq H+${hh}+t_s=`, "Composite depth", "in");
  m("S_{bc}\\coloneq\\frac{I_c}{y_{bc}}=", "Bottom of the girder", "in^3");
  m("S_{tc}\\coloneq\\frac{I_c}{H-y_{bc}}=", "Top of the girder", "in^3");
  m("S_{td}\\coloneq\\frac{I_c}{h_c-y_{bc}}=", "Top of the deck (transformed)", "in^3");

  // --- distribution factors ------------------------------------------------------------------------
  text("Live load distribution factors (AASHTO 4.6.2.2), cross-section type (k)", "subheading");
  m("n_k\\coloneq\\frac{E_c}{E_{cd}}=", "Girder to deck");
  m("e_g\\coloneq y_d-y_b=", "Girder to deck centroids", "in");
  m("K_g\\coloneq n_k\\cdot\\left(I_g+A_g\\cdot e_g^{2}\\right)=", "AASHTO Eq. 4.6.2.2.1-1", "in^4");
  m(`N_L\\coloneq ${g.df.lanes}`, `Design lanes in the ${num(g.loads.roadway, 3)} ft roadway, AASHTO 3.6.1.1.1`);
  m("k_g\\coloneq\\left(\\frac{K_g}{12\\cdot\\frac{L}{\\mathrm{ft}}\\cdot\\left(\\frac{t_s}{\\mathrm{in}}\\right)^{3}\\cdot\\mathrm{in}^{4}}\\right)^{0.1}=");
  m("g_{M1}\\coloneq0.06+\\left(\\frac{S}{14\\mathrm{ft}}\\right)^{0.4}\\cdot\\left(\\frac{S}{L}\\right)^{0.3}\\cdot k_g=", "Moment, one lane, AASHTO T. 4.6.2.2.2b-1");
  m("g_{M2}\\coloneq0.075+\\left(\\frac{S}{9.5\\mathrm{ft}}\\right)^{0.6}\\cdot\\left(\\frac{S}{L}\\right)^{0.2}\\cdot k_g=", "Two or more lanes");
  m("g_{V1}\\coloneq0.36+\\frac{S}{25\\mathrm{ft}}=", "Shear, one lane, AASHTO T. 4.6.2.2.3a-1");
  m("g_{V2}\\coloneq0.2+\\frac{S}{12\\mathrm{ft}}-\\left(\\frac{S}{35\\mathrm{ft}}\\right)^{2}=", "Two or more lanes");
  const multi = g.df.lanes > 1;
  const th = Math.min(i.skew, 60);
  if (th >= 30) {
    m("c_1\\coloneq0.25\\cdot\\left(\\frac{K_g}{12\\cdot\\frac{L}{\\mathrm{ft}}\\cdot\\left(\\frac{t_s}{\\mathrm{in}}\\right)^{3}\\cdot\\mathrm{in}^{4}}\\right)^{0.25}\\cdot\\left(\\frac{S}{L}\\right)^{0.5}=", "AASHTO T. 4.6.2.2.2e-1");
    m(`r_M\\coloneq1-c_1\\cdot\\tan\\left(${i.skew > 60 ? "60\\mathrm{deg}" : "\\theta_s"}\\right)^{1.5}=`, "Skew reduction for moment");
  } else m("r_M\\coloneq1", "Skew under 30°: no reduction for moment, AASHTO T. 4.6.2.2.2e-1");
  if (th > 0 && g.df.skewShear !== 1)
    m(`r_V\\coloneq1+0.2\\cdot\\left(\\frac{12\\cdot\\frac{L}{\\mathrm{ft}}\\cdot\\left(\\frac{t_s}{\\mathrm{in}}\\right)^{3}\\cdot\\mathrm{in}^{4}}{K_g}\\right)^{0.3}\\cdot\\tan\\left(${i.skew > 60 ? "60\\mathrm{deg}" : "\\theta_s"}\\right)=`, "Skew correction for shear, AASHTO T. 4.6.2.2.3c-1");
  else m("r_V\\coloneq1", th > 0 ? "Skew correction for shear applied at the exterior girder only" : "No skew");
  if (!ext) {
    m(multi ? "g_M\\coloneq\\max\\left(g_{M1},g_{M2}\\right)\\cdot r_M=" : "g_M\\coloneq g_{M1}\\cdot r_M=", "Interior girder, moment, lanes per girder");
    m(multi ? "g_V\\coloneq\\max\\left(g_{V1},g_{V2}\\right)\\cdot r_V=" : "g_V\\coloneq g_{V1}\\cdot r_V=", "Interior girder, shear");
  } else {
    m("d_e\\coloneq O_h-b_{br}=", "Exterior web to the barrier's inside face", "ft");
    m("x_1\\coloneq2\\mathrm{ft}-d_e=", "Lever rule: the first wheel from the exterior girder (2 ft off the barrier)", "ft");
    m("g_{LR}\\coloneq1.2\\cdot\\left(\\frac{0.5\\cdot\\max\\left(S-x_1,0\\mathrm{ft}\\right)}{S}+\\frac{0.5\\cdot\\max\\left(S-x_1-6\\mathrm{ft},0\\mathrm{ft}\\right)}{S}\\right)=", "One lane, m = 1.2, AASHTO 4.6.2.2.2d and 3.6.1.1.2");
    m("e_M\\coloneq0.77+\\frac{d_e}{9.1\\mathrm{ft}}=", "AASHTO T. 4.6.2.2.2d-1");
    m("e_V\\coloneq0.6+\\frac{d_e}{10\\mathrm{ft}}=", "AASHTO T. 4.6.2.2.3b-1");
    if (i.rigidMethod) given(`g_R\\coloneq ${num(g.df.rigid ?? 0, 6)}`, "Rigid cross-section, the most lanes' reaction with m, AASHTO Eq. 4.6.2.2.2d-1");
    const rig = i.rigidMethod ? ",g_R" : "";
    m(multi ? `g_M\\coloneq\\max\\left(g_{LR},e_M\\cdot g_{M2}${rig}\\right)\\cdot r_M=` : `g_M\\coloneq\\max\\left(g_{LR}${rig}\\right)\\cdot r_M=`, "Exterior girder, moment");
    m(multi ? `g_V\\coloneq\\max\\left(g_{LR},e_V\\cdot g_{V2}${rig}\\right)\\cdot r_V=` : `g_V\\coloneq\\max\\left(g_{LR}${rig}\\right)\\cdot r_V=`, "Exterior girder, shear");
  }
  if (g.df.outOfRange.length) text(`Outside the range of applicability: ${g.df.outOfRange.join("; ")}.`, "note");

  // --- loads ----------------------------------------------------------------------------------------
  text("Dead loads, per girder", "subheading");
  m(i.wcLoad ? "w_g\\coloneq A_g\\cdot w_{cw}=" : "w_g\\coloneq A_g\\cdot w_c=", "Girder (DC)", "klf");
  m(`b_{tr}\\coloneq ${ext ? "\\frac{S}{2}+O_h" : "S"}=`, "Tributary deck width", "ft");
  m(`w_{dk}\\coloneq\\left(t_d\\cdot b_{tr}+h_h\\cdot b_{tf}\\right)\\cdot ${i.wcDeckLoad ? "w_{cdw}" : "w_{cd}"}${i.otherDC1 ? `+${num(i.otherDC1)}\\mathrm{klf}` : ""}=`, "Deck and haunch on the girder alone (DC)", "klf");
  if (ext) m(`P_{dia}\\coloneq0.5\\cdot${num(i.diaphragmWeight)}\\mathrm{kip}=`, `${i.diaphragms} intermediate diaphragms, equally spaced; diaphragms on one side of the exterior girder: half`, "kip");
  else m(`P_{dia}\\coloneq ${num(i.diaphragmWeight)}\\mathrm{kip}`, `${i.diaphragms} intermediate diaphragms, equally spaced`);
  m(`w_{DC2}\\coloneq ${i.barriersOnExterior ? (ext ? num(i.barrierWeight) : "0") : `\\frac{2\\cdot${num(i.barrierWeight)}}{N_b}`}\\mathrm{klf}${i.otherDC2 ? `+${num(i.otherDC2)}\\mathrm{klf}` : ""}=`, i.barriersOnExterior ? "Barrier on its exterior girder (DC, composite)" : "Barriers shared by all girders, AASHTO 4.6.2.2.1 (DC, composite)", "klf");
  m(`w_{DW}\\coloneq\\frac{${num(i.fws)}\\mathrm{psf}\\cdot\\left(\\left(N_b-1\\right)\\cdot S+2\\cdot O_h-2\\cdot b_{br}\\right)}{N_b}=`, "Future wearing surface (DW), shared", "klf");

  text("Moments at midspan", "subheading");
  m("M_g\\coloneq\\frac{w_g\\cdot L^{2}}{8}=", "Girder", "kip*ft");
  const dia = g.loads.diaphragmAt.reduce((s, a) => s + (g.loads.Pdia * Math.min(a, i.L - a)) / 2, 0);
  given(`M_{dia}\\coloneq ${num(dia, 6)}${kft}`, "Diaphragms, Σ P·a/2");
  m("M_{dk}\\coloneq\\frac{w_{dk}\\cdot L^{2}}{8}+M_{dia}=", "Deck, haunch and diaphragms", "kip*ft");
  // On a continuous bridge the superimposed loads act on the continuous beam: midspan's moment is the
  // simple span's plus the average of the end moments (per klf, μs); if a joint isn't fully effective,
  // the simple span's governs (5.12.3.3).
  const contMid = cont && Math.abs(midStation.Mdc2 - g.loads.wDC2 * ((i.L * i.L) / 8 + g.endMoments)) < 1e-6 * Math.max(1, Math.abs(midStation.Mdc2));
  if (contMid) {
    given(`\\mu_s\\coloneq ${num(g.endMoments, 6)}\\mathrm{ft}^{2}`, "Continuity's change to the midspan moment for 1 klf on every span (three-moment equation; the beam spans to the piers' centerlines)");
    m("M_{DC2}\\coloneq w_{DC2}\\cdot\\left(\\frac{L^{2}}{8}+\\mu_s\\right)=", "On the continuous beam", "kip*ft");
    m("M_{DW}\\coloneq w_{DW}\\cdot\\left(\\frac{L^{2}}{8}+\\mu_s\\right)=", "On the continuous beam", "kip*ft");
  } else {
    m("M_{DC2}\\coloneq\\frac{w_{DC2}\\cdot L^{2}}{8}=", cont ? "A joint not fully effective: as a simple span (5.12.3.3)" : undefined, "kip*ft");
    m("M_{DW}\\coloneq\\frac{w_{DW}\\cdot L^{2}}{8}=", undefined, "kip*ft");
  }
  m("I_M\\coloneq0.33", "Dynamic load allowance, not on the lane load, AASHTO T. 3.6.2.1-1");
  if (cont) {
    given(`M_{L1}\\coloneq ${num(midStation.Mll / g.df.moment, 6)}${kft}`, "HL-93 per lane with IM, by influence lines on the continuous beam (truck or tandem with the lane load; AASHTO 3.6.1.3.1)");
    m("M_{LL}\\coloneq g_M\\cdot M_{L1}=", "LL + IM on this girder", "kip*ft");
    const r = g.restraint!;
    const Xm = (g.shift + i.L / 2) / g.La; // midspan on the beam's span
    const Mr = Math.max(0, r.left * (1 - Xm) + r.right * Xm);
    given(`M_{CR}\\coloneq ${num(contMid ? Mr : 0, 6)}${kft}`, "Positive restraint moment at midspan (creep and shrinkage, below), γ = 1.0; negative ones aren't counted here");
  } else {
    const lv = liveAt(g);
    given(`M_{tr}\\coloneq ${num(lv.truckM, 6)}${kft}`, "HL-93 design truck, per lane (rear axle 14–30 ft), AASHTO 3.6.1.2.2");
    given(`M_{td}\\coloneq ${num(lv.tandemM, 6)}${kft}`, "Design tandem, AASHTO 3.6.1.2.3");
    m("M_{ln}\\coloneq\\frac{0.64\\mathrm{klf}\\cdot L^{2}}{8}=", "Design lane load, AASHTO 3.6.1.2.4", "kip*ft");
    m("M_{LL}\\coloneq g_M\\cdot\\left(\\left(1+I_M\\right)\\cdot\\max\\left(M_{tr},M_{td}\\right)+M_{ln}\\right)=", "LL + IM on this girder", "kip*ft");
  }
  m(`\\eta\\coloneq ${num(i.eta)}`, "AASHTO 1.3.2");
  if (cont) m("M_u\\coloneq\\eta\\cdot\\left(1.25\\cdot\\left(M_g+M_{dk}+M_{DC2}\\right)+1.5\\cdot M_{DW}+1.75\\cdot M_{LL}+M_{CR}\\right)=", "Strength I, AASHTO T. 3.4.1-1, -3", "kip*ft");
  else m("M_u\\coloneq\\eta\\cdot\\left(1.25\\cdot\\left(M_g+M_{dk}+M_{DC2}\\right)+1.5\\cdot M_{DW}+1.75\\cdot M_{LL}\\right)=", "Strength I, AASHTO T. 3.4.1-1", "kip*ft");
  if (cdot && midStation.strengthII) {
    const s2 = midStation.strengthII;
    given(`M_{P1}\\coloneq ${num(s2.Mll / g.df.moment, 6)}${kft}`, `${s2.vehicle} per lane with IM 33%, by influence lines${cont ? " (the larger of continuous and, where a joint isn't fully effective, simple span)" : ""}; CDOT BDM 3.6`);
    m("M_{LLII}\\coloneq g_M\\cdot M_{P1}=", "Strength II vehicle on this girder, HL-93's distribution factor", "kip*ft");
    m(`M_{uII}\\coloneq\\eta\\cdot\\left(1.25\\cdot\\left(M_g+M_{dk}+M_{DC2}\\right)+1.5\\cdot M_{DW}+1.35\\cdot M_{LLII}${cont ? "+M_{CR}" : ""}\\right)=`, "Strength II, AASHTO T. 3.4.1-1, γLL = 1.35", "kip*ft");
    m("M_u\\coloneq\\max\\left(M_u,M_{uII}\\right)=", "The larger of Strength I and II", "kip*ft");
  }

  // --- prestress -------------------------------------------------------------------------------------
  const Lg = i.L + 2 * i.endDist;
  const groups = strandGroups(i, g.shape.depth, Lg);
  const lt = g.strands.lt;
  /** Force-weighted prestress at a section (for a stress fp): P, its eccentricity, and Vp. */
  const pAt = (xe: number, fp: number) => {
    let P = 0;
    let Pe = 0;
    let Vp = 0;
    for (const k of groups) {
      const lpx = Math.min(xe, Lg - xe) - k.bondFrom;
      const tf = lpx <= 0 ? 0 : Math.min(1, lpx / lt);
      const F = k.A * fp * tf;
      P += F;
      Pe += F * (g.g.yb - k.yAt(xe));
      Vp += F * k.slope(xe);
    }
    return { P, e: P > 0 ? Pe / P : 0, Vp };
  };
  text("Prestressing strands (AASHTO 5.9)", "subheading");
  const describe = groups.map((k) => (k.kind === "harped" ? `${k.n} harped (${num(i.harped.yEnd)} in at the ends to ${num(i.harped.yHarp)} in at harp points ${num(i.harped.harpPoint)}·Lg from each end)` : k.kind === "debonded" ? `${k.n} at ${num(k.yAt(0))} in debonded ${num(k.bondFrom)} ft at each end` : `${k.n} at ${num(k.yAt(0))} in`));
  text(`${g.strands.N} strands, ${i.strandDia} in, Grade 270 low-relaxation: ${describe.join("; ")}.`, "note");
  m(`N_s\\coloneq ${g.strands.N}`, "Strands");
  m(`a_{ps}\\coloneq ${num(strand.area)}\\mathrm{in}^{2}`, `${i.strandDia} in strand`);
  m("A_{ps}\\coloneq N_s\\cdot a_{ps}=", undefined, "in^2");
  if (figures?.elevation) lines.push({ region: figures.elevation });
  given(`y_{ps}\\coloneq ${num(g.strands.ybar, 6)}\\mathrm{in}`, "Strand centroid at midspan");
  m("e_p\\coloneq y_b-y_{ps}=", "Eccentricity at midspan", "in");
  m(`f_{pj}\\coloneq ${num(i.fpjRatio)}\\cdot f_{pu}=`, "Jacking stress", "ksi");
  m(ok("f_{pj}", "0.75\\cdot f_{pu}"), "AASHTO T. 5.9.2.2-1");
  m(`l_t\\coloneq60\\cdot${num(strand.db)}\\mathrm{in}=`, "Transfer length, 60 db, AASHTO 5.9.4.3.1", "ft");
  given(`l_d\\coloneq ${num(g.strands.ld, 6)}\\mathrm{ft}`, "Development length, κ = 1.6, AASHTO Eq. 5.9.4.3.2-1");
  if (groups.some((k) => k.kind === "debonded")) given(`l_{dd}\\coloneq ${num(g.strands.ldDebonded, 6)}\\mathrm{ft}`, "Debonded strands, κ = 2.0, from where their bond begins");

  text("Elastic shortening (AASHTO 5.9.3.2.3a)", "subheading");
  m("M_{gr}\\coloneq\\frac{w_g\\cdot L_g^{2}}{8}=", "Self-weight at release, on the girder's length", "kip*ft");
  text("ΔfpES = (Ep/Eci)·fcgp with fcgp from the force after transfer, solved directly:", "note");
  m("f_{pt}\\coloneq\\frac{f_{pj}+\\frac{E_p}{E_{ci}}\\cdot\\frac{M_{gr}\\cdot e_p}{I_g}}{1+\\frac{E_p}{E_{ci}}\\cdot A_{ps}\\cdot\\left(\\frac{1}{A_g}+\\frac{e_p^{2}}{I_g}\\right)}=", "Stress after transfer", "ksi");
  m("\\Delta_{pES}\\coloneq f_{pj}-f_{pt}=", "AASHTO Eq. 5.9.3.2.3a-1", "ksi");
  m("f_{cgp}\\coloneq A_{ps}\\cdot f_{pt}\\cdot\\left(\\frac{1}{A_g}+\\frac{e_p^{2}}{I_g}\\right)-\\frac{M_{gr}\\cdot e_p}{I_g}=", "At the strands' centroid, at transfer", "ksi");
  m(`H_r\\coloneq ${num(i.humidity)}`, "Relative humidity, %");

  const L = g.losses;
  if (L.kind === "refined") {
    text("Time-dependent losses, refined estimates (AASHTO 5.9.3.4)", "subheading");
    m(`t_i\\coloneq ${num(i.tRelease)}`, "Age at release, days");
    m(`t_d\\coloneq ${num(i.tDeck)}`, "Age at deck placement, days");
    m(`t_f\\coloneq ${num(Math.max(i.tFinal, i.tDeck + 1))}`, "Final age, days");
    m("V_S\\coloneq\\frac{A_g}{P_g}=", "Volume to surface ratio", "in");
    m("k_s\\coloneq\\max\\left(1,1.45-0.13\\cdot\\frac{V_S}{\\mathrm{in}}\\right)=", "AASHTO Eq. 5.4.2.3.2-2");
    m("k_{hc}\\coloneq1.56-0.008\\cdot H_r=", "AASHTO Eq. 5.4.2.3.3-2");
    m("k_{hs}\\coloneq2.00-0.014\\cdot H_r=", "AASHTO Eq. 5.4.2.3.3-2");
    m("k_f\\coloneq\\frac{5}{1+\\frac{f'_{ci}}{\\mathrm{ksi}}}=", "AASHTO Eq. 5.4.2.3.2-4");
    m("k_{td}\\left(t\\right)\\coloneq\\frac{t}{\\frac{12\\cdot\\left(100-4\\cdot\\frac{f'_{ci}}{\\mathrm{ksi}}\\right)}{\\frac{f'_{ci}}{\\mathrm{ksi}}+20}+t}", "AASHTO Eq. 5.4.2.3.2-5");
    m("\\psi_b\\left(t,t_l\\right)\\coloneq1.9\\cdot k_s\\cdot k_{hc}\\cdot k_f\\cdot k_{td}\\left(t\\right)\\cdot t_l^{-0.118}", "Girder creep, AASHTO Eq. 5.4.2.3.2-1 (t days under load, loaded at age tl)");
    m("\\varepsilon_{sh}\\left(t\\right)\\coloneq k_s\\cdot k_{hs}\\cdot k_f\\cdot k_{td}\\left(t\\right)\\cdot0.48\\cdot10^{-3}", "Girder shrinkage, AASHTO Eq. 5.4.2.3.3-1");
    m("\\psi_{fi}\\coloneq\\psi_b\\left(t_f-t_i,t_i\\right)=", "ψb(tf, ti)");
    m("\\psi_{di}\\coloneq\\psi_b\\left(t_d-t_i,t_i\\right)=", "ψb(td, ti)");
    m("\\psi_{fd}\\coloneq\\psi_b\\left(t_f-t_d,t_d\\right)=", "ψb(tf, td)");
    text("Transfer to deck placement", "note");
    m("\\varepsilon_{bid}\\coloneq\\varepsilon_{sh}\\left(t_d-t_i\\right)=", "Girder shrinkage to the deck");
    m("K_{id}\\coloneq\\frac{1}{1+\\frac{E_p}{E_{ci}}\\cdot\\frac{A_{ps}}{A_g}\\cdot\\left(1+\\frac{A_g\\cdot e_p^{2}}{I_g}\\right)\\cdot\\left(1+0.7\\cdot\\psi_{fi}\\right)}=", "AASHTO Eq. 5.9.3.4.2a-2");
    m("\\Delta_{pSR}\\coloneq\\varepsilon_{bid}\\cdot E_p\\cdot K_{id}=", "Shrinkage, AASHTO Eq. 5.9.3.4.2a-1", "ksi");
    m("\\Delta_{pCR}\\coloneq\\frac{E_p}{E_{ci}}\\cdot f_{cgp}\\cdot\\psi_{di}\\cdot K_{id}=", "Creep, AASHTO Eq. 5.9.3.4.2b-1", "ksi");
    m("\\Delta_{pR1}\\coloneq\\max\\left(0\\mathrm{ksi},\\frac{f_{pt}}{30}\\cdot\\left(\\frac{f_{pt}}{0.9\\cdot f_{pu}}-0.55\\right)\\right)=", "Relaxation, KL = 30, AASHTO Eq. 5.9.3.4.2c-1", "ksi");
    m("\\Delta_{pid}\\coloneq\\Delta_{pSR}+\\Delta_{pCR}+\\Delta_{pR1}=", "To deck placement", "ksi");
    text("Deck placement to final, on the composite section", "note");
    m("e_{pc}\\coloneq y_{bc}-y_{ps}=", "Strands below the composite centroid", "in");
    m("e_{d}\\coloneq y_d-y_{bc}=", "Deck above the composite centroid", "in");
    m("\\varepsilon_{bdf}\\coloneq\\varepsilon_{sh}\\left(t_f-t_i\\right)-\\varepsilon_{bid}=", "Girder shrinkage after the deck");
    m("K_{df}\\coloneq\\frac{1}{1+\\frac{E_p}{E_{ci}}\\cdot\\frac{A_{ps}}{A_c}\\cdot\\left(1+\\frac{A_c\\cdot e_{pc}^{2}}{I_c}\\right)\\cdot\\left(1+0.7\\cdot\\psi_{fi}\\right)}=", "AASHTO Eq. 5.9.3.4.3a-2");
    m("\\Delta_{pSD}\\coloneq\\varepsilon_{bdf}\\cdot E_p\\cdot K_{df}=", "Shrinkage, AASHTO Eq. 5.9.3.4.3a-1", "ksi");
    if (cont && !contMid) {
      // Positive moments enveloped with the simple span: the losses take the continuous beam's (smaller) moment.
      given(`M_{sL}\\coloneq ${num(g.losses.Msidl / 12, 6)}${kft}`, "Superimposed loads at midspan on the continuous beam, for the losses (the smaller: conservative)");
      m("\\Delta_{fcd}\\coloneq-\\Delta_{pid}\\cdot A_{ps}\\cdot\\left(\\frac{1}{A_g}+\\frac{e_p^{2}}{I_g}\\right)-\\frac{M_{dk}\\cdot e_p}{I_g}-\\frac{M_{sL}\\cdot e_{pc}}{I_c}=", "Change in the strands' concrete stress: losses to the deck, the deck, superimposed loads", "ksi");
    } else m("\\Delta_{fcd}\\coloneq-\\Delta_{pid}\\cdot A_{ps}\\cdot\\left(\\frac{1}{A_g}+\\frac{e_p^{2}}{I_g}\\right)-\\frac{M_{dk}\\cdot e_p}{I_g}-\\frac{\\left(M_{DC2}+M_{DW}\\right)\\cdot e_{pc}}{I_c}=", "Change in the strands' concrete stress: losses to the deck, the deck, superimposed loads", "ksi");
    m("\\Delta_{pCD}\\coloneq\\frac{E_p}{E_{ci}}\\cdot f_{cgp}\\cdot\\left(\\psi_{fi}-\\psi_{di}\\right)\\cdot K_{df}+\\frac{E_p}{E_c}\\cdot\\Delta_{fcd}\\cdot\\psi_{fd}\\cdot K_{df}=", "Creep, AASHTO Eq. 5.9.3.4.3b-1", "ksi");
    m("\\Delta_{pR2}\\coloneq\\Delta_{pR1}", "Relaxation, AASHTO Eq. 5.9.3.4.3c-1");
    given(`\\varepsilon_{ddf}\\coloneq ${num(L.eddf, 10)}`, `Deck shrinkage after casting (5.4.2.3.3, V/S = ${num((i.deckT - i.sacrificial) / 2)} in, f'ci = 0.8 f'c)`);
    given(`\\psi_d\\coloneq ${num(L.psiD, 6)}`, "Deck creep, ψd(tf, td) (5.4.2.3.2)");
    m("A_{dk}\\coloneq b_e\\cdot t_s=", "The deck's area", "in^2");
    m("\\Delta_{fcdf}\\coloneq\\frac{\\varepsilon_{ddf}\\cdot A_{dk}\\cdot E_{cd}}{1+0.7\\cdot\\psi_d}\\cdot\\left(\\frac{1}{A_c}-\\frac{e_{pc}\\cdot e_d}{I_c}\\right)=", "AASHTO Eq. 5.9.3.4.3d-2", "ksi");
    m("\\Delta_{pSS}\\coloneq\\frac{E_p}{E_c}\\cdot\\Delta_{fcdf}\\cdot K_{df}\\cdot\\left(1+0.7\\cdot\\psi_{fd}\\right)=", "Deck shrinkage (negative: a gain), AASHTO Eq. 5.9.3.4.3d-1", "ksi");
    m("\\Delta_{pLT}\\coloneq\\Delta_{pid}+\\Delta_{pSD}+\\Delta_{pCD}+\\Delta_{pR2}+\\Delta_{pSS}=", "Long-term losses, AASHTO Eq. 5.9.3.4.1-1", "ksi");
  } else {
    text("Time-dependent losses, approximate estimate (AASHTO 5.9.3.3)", "subheading");
    m("\\gamma_h\\coloneq1.7-0.01\\cdot H_r=", "AASHTO Eq. 5.9.3.3-2");
    m("\\gamma_{st}\\coloneq\\frac{5}{1+\\frac{f'_{ci}}{\\mathrm{ksi}}}=", "AASHTO Eq. 5.9.3.3-3");
    m("\\Delta_{pLT}\\coloneq10\\cdot\\frac{f_{pj}\\cdot A_{ps}}{A_g}\\cdot\\gamma_h\\cdot\\gamma_{st}+12\\mathrm{ksi}\\cdot\\gamma_h\\cdot\\gamma_{st}+2.4\\mathrm{ksi}=", "AASHTO Eq. 5.9.3.3-1", "ksi");
  }
  m("f_{pe}\\coloneq f_{pt}-\\Delta_{pLT}=", "Effective stress after all losses", "ksi");
  m(ok("f_{pe}", "0.80\\cdot0.9\\cdot f_{pu}"), "0.80 fpy, AASHTO T. 5.9.2.2-1");
  const gains = i.losses === "refined" && i.elasticGain;
  if (gains) {
    if (L.kind !== "refined") throw new Error("unreachable");
    m(`\\Delta_{pEG}\\coloneq\\frac{E_p}{E_c}\\cdot\\left(\\frac{M_{dk}\\cdot e_p}{I_g}+\\frac{\\left(M_{DC2}+M_{DW}${cont ? "+M_{CR}" : ""}\\right)\\cdot e_{pc}}{I_c}\\right)=`, "Elastic gain at midspan from the deck and superimposed loads (C5.9.3.4)", "ksi");
  } else m("\\Delta_{pEG}\\coloneq0\\mathrm{ksi}", "No elastic gain counted");

  // --- release ---------------------------------------------------------------------------------------
  const relX = relStation.x + i.endDist; // ft from the girder's end
  const pRel = pAt(relX, g.losses.fpt);
  text(`Stresses at release (AASHTO 5.9.2.3.1), at the girder's end region and midspan`, "subheading");
  m(`x_t\\coloneq ${num(relX, 6)}\\mathrm{ft}`, `${relStation.label}, from the girder's end`);
  given(`P_{it}\\coloneq ${num(pRel.P, 6)}\\mathrm{kip}`, "Prestress there: the strands transferred (bonded length / lt)");
  given(`e_t\\coloneq ${num(pRel.e, 6)}\\mathrm{in}`, "Its eccentricity");
  m("M_{gt}\\coloneq\\frac{w_g\\cdot x_t\\cdot\\left(L_g-x_t\\right)}{2}=", "Self-weight there", "kip*ft");
  m("f_{ti}\\coloneq\\frac{P_{it}}{A_g}-\\frac{P_{it}\\cdot e_t}{S_t}+\\frac{M_{gt}}{S_t}=", "Top", "ksi");
  m("f_{bi}\\coloneq\\frac{P_{it}}{A_g}+\\frac{P_{it}\\cdot e_t}{S_b}-\\frac{M_{gt}}{S_b}=", "Bottom", "ksi");
  m("P_i\\coloneq A_{ps}\\cdot f_{pt}=", "At midspan, all strands", "kip");
  m("f_{tm}\\coloneq\\frac{P_i}{A_g}-\\frac{P_i\\cdot e_p}{S_t}+\\frac{M_{gr}}{S_t}=", "Top", "ksi");
  m("f_{bm}\\coloneq\\frac{P_i}{A_g}+\\frac{P_i\\cdot e_p}{S_b}-\\frac{M_{gr}}{S_b}=", "Bottom", "ksi");
  m(ok("\\max\\left(f_{bi},f_{bm},f_{ti},f_{tm}\\right)", "0.65\\cdot f'_{ci}"), "Compression, AASHTO 5.9.2.3.1a");
  const relTens = g.checks.find((c) => c.id === "rel-tens")!;
  if (relTens.name.includes("bonded")) {
    m(ok("-\\min\\left(f_{ti},f_{tm}\\right)", "0.24\\cdot\\sqrt{\\frac{f'_{ci}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}"), "Tension with bonded bars, AASHTO T. 5.9.2.3.1b-1");
    text(relTens.note ?? "", "note");
  } else m(ok("-\\min\\left(f_{ti},f_{tm}\\right)", "\\min\\left(0.0948\\cdot\\sqrt{\\frac{f'_{ci}}{\\mathrm{ksi}}},0.2\\right)\\cdot\\mathrm{ksi}"), "Tension without bonded bars, AASHTO T. 5.9.2.3.1b-1");
  text(`Every section was checked; the governing ones: ${["rel-comp", "rel-tens"].map((id) => g.checks.find((c) => c.id === id)!.note).join("; ")}.`, "note");

  // --- service ----------------------------------------------------------------------------------------
  text("Stresses at service, midspan (AASHTO 5.9.2.3.2)", "subheading");
  m("P_e\\coloneq A_{ps}\\cdot\\left(f_{pe}+\\Delta_{pEG}\\right)=", undefined, "kip");
  m("M_{nc}\\coloneq M_g+M_{dk}=", "On the girder alone", "kip*ft");
  m(cont ? "M_{cp}\\coloneq M_{DC2}+M_{DW}+M_{CR}=" : "M_{cp}\\coloneq M_{DC2}+M_{DW}=", "On the composite section", "kip*ft");
  m("f_{tp}\\coloneq\\frac{P_e}{A_g}-\\frac{P_e\\cdot e_p}{S_t}+\\frac{M_{nc}}{S_t}+\\frac{M_{cp}}{S_{tc}}=", "Top of the girder, permanent loads", "ksi");
  m(ok("f_{tp}", "0.45\\cdot f'_{c}"), "Service I, AASHTO T. 5.9.2.3.2a-1");
  m("f_{tt}\\coloneq f_{tp}+\\frac{M_{LL}}{S_{tc}}=", "All loads", "ksi");
  m(ok("f_{tt}", "0.60\\cdot f'_{c}"), "Service I, φw = 1.0, AASHTO T. 5.9.2.3.2a-1");
  m("f_{dp}\\coloneq\\frac{n\\cdot M_{cp}}{S_{td}}=", "Top of the deck, permanent loads", "ksi");
  m(ok("f_{dp}", "0.45\\cdot f'_{cd}"), "Service I");
  m("f_{dt}\\coloneq\\frac{n\\cdot\\left(M_{cp}+M_{LL}\\right)}{S_{td}}=", "All loads", "ksi");
  m(ok("f_{dt}", "0.60\\cdot f'_{cd}"), "Service I");
  m(`\\gamma_{L3}\\coloneq ${num(g.gammaLL3)}`, gains ? "Service III with refined losses and elastic gains (T. 3.4.1-4)" : "Service III (T. 3.4.1-4)");
  if (cdot && gains) {
    m("\\Delta_{pLL}\\coloneq\\frac{E_p}{E_c}\\cdot\\frac{\\gamma_{L3}\\cdot M_{LL}\\cdot e_{pc}}{I_c}=", "The live load's elastic gain, CDOT BDM 5.5.1.1", "ksi");
    m("P_3\\coloneq A_{ps}\\cdot\\left(f_{pe}+\\Delta_{pEG}+\\Delta_{pLL}\\right)=", undefined, "kip");
    m("f_{b3}\\coloneq\\frac{P_3}{A_g}+\\frac{P_3\\cdot e_p}{S_b}-\\frac{M_{nc}}{S_b}-\\frac{M_{cp}+\\gamma_{L3}\\cdot M_{LL}}{S_{bc}}=", "Bottom, Service III", "ksi");
  } else m("f_{b3}\\coloneq\\frac{P_e}{A_g}+\\frac{P_e\\cdot e_p}{S_b}-\\frac{M_{nc}}{S_b}-\\frac{M_{cp}+\\gamma_{L3}\\cdot M_{LL}}{S_{bc}}=", "Bottom, Service III", "ksi");
  const tl = i.exposure === "moderate" ? "\\min\\left(0.19\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}},0.6\\right)\\cdot\\mathrm{ksi}" : i.exposure === "severe" ? "\\min\\left(0.0948\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}},0.3\\right)\\cdot\\mathrm{ksi}" : "0\\mathrm{ksi}";
  m(ok("-f_{b3}", tl), `Tension, AASHTO T. 5.9.2.3.2b-1 (${i.exposure === "moderate" ? "not worse than moderate corrosion" : i.exposure === "severe" ? "severe corrosive conditions" : "no tension"})`);
  if (cdot) {
    m("f_{bdl}\\coloneq\\frac{P_e}{A_g}+\\frac{P_e\\cdot e_p}{S_b}-\\frac{M_{nc}}{S_b}-\\frac{M_{cp}}{S_{bc}}=", "Bottom, dead load alone, after all losses", "ksi");
    m(ok("-f_{bdl}", "0\\mathrm{ksi}"), "No tension in the precompressed tensile zone, CDOT BDM 5.5.1.3");
  }

  // --- flexure ------------------------------------------------------------------------------------------
  text("Flexure at midspan, Strength I (AASHTO 5.6.3)", "subheading");
  m("d_p\\coloneq h_c-y_{ps}=", undefined, "in");
  m("k\\coloneq0.28", "Low-relaxation strand, AASHTO T. C5.6.3.1.1-1");
  m("\\beta_1\\coloneq\\max\\left(0.65,\\min\\left(0.85,0.85-0.05\\cdot\\left(\\frac{f'_{cd}}{\\mathrm{ksi}}-4\\right)\\right)\\right)=", "Deck concrete, AASHTO 5.6.2.2");
  m(`\\alpha_1\\coloneq ${num(i.fcDeck <= 10 ? 0.85 : Math.max(0.75, 0.85 - 0.02 * (i.fcDeck - 10)))}`, "AASHTO 5.6.2.2");
  m("b_{ef}\\coloneq b_e", "Compression flange: the deck's effective width");
  if (g.flexMid.rect) {
    m("c\\coloneq\\frac{A_{ps}\\cdot f_{pu}}{\\alpha_1\\cdot f'_{cd}\\cdot\\beta_1\\cdot b_{ef}+k\\cdot A_{ps}\\cdot\\frac{f_{pu}}{d_p}}=", "Rectangular section, AASHTO Eq. 5.6.3.1.1-4", "in");
    m("a\\coloneq\\beta_1\\cdot c=", "Within the deck", "in");
    m("f_{ps}\\coloneq f_{pu}\\cdot\\left(1-k\\cdot\\frac{c}{d_p}\\right)=", "AASHTO Eq. 5.6.3.1.1-1", "ksi");
    m("M_n\\coloneq A_{ps}\\cdot f_{ps}\\cdot\\left(d_p-\\frac{a}{2}\\right)=", "AASHTO Eq. 5.6.3.2.2-1", "kip*ft");
  } else {
    text("The stress block reaches below the deck into the girder: c, fps and the compression's lever arm by strain compatibility over the deck, haunch and girder outline, each with its own concrete (AASHTO 5.6.2.2, 5.6.3.1.1).", "note");
    given(`c\\coloneq ${num(g.flexMid.c, 6)}\\mathrm{in}`, "Neutral axis");
    given(`f_{ps}\\coloneq ${num(g.flexMid.fps, 6)}\\mathrm{ksi}`, "AASHTO Eq. 5.6.3.1.1-1");
    given(`j_d\\coloneq ${num(g.flexMid.arm, 6)}\\mathrm{in}`, "Lever arm");
    m("M_n\\coloneq A_{ps}\\cdot f_{ps}\\cdot j_d=", undefined, "kip*ft");
  }
  given(`d_t\\coloneq ${num(g.flexMid.dt, 6)}\\mathrm{in}`, "To the lowest strands");
  m("\\varepsilon_t\\coloneq0.003\\cdot\\frac{d_t-c}{c}=", "Net tensile strain");
  m("\\phi_f\\coloneq\\min\\left(1,\\max\\left(0.75,0.75+0.25\\cdot\\frac{\\varepsilon_t-0.002}{0.005-0.002}\\right)\\right)=", "AASHTO 5.5.4.2");
  m(ok("M_u", "\\phi_f\\cdot M_n"), "AASHTO 5.6.3.2");
  m("f_r\\coloneq0.24\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}=", "AASHTO 5.4.2.6", "ksi");
  m("f_{cpe}\\coloneq\\frac{A_{ps}\\cdot f_{pe}}{A_g}+\\frac{A_{ps}\\cdot f_{pe}\\cdot e_p}{S_b}=", undefined, "ksi");
  m("M_{cr}\\coloneq\\left(1.6\\cdot f_r+1.1\\cdot f_{cpe}\\right)\\cdot S_{bc}-M_{nc}\\cdot\\left(\\frac{S_{bc}}{S_b}-1\\right)=", "AASHTO Eq. 5.6.3.3-1, γ3 = 1.0", "kip*ft");
  m(ok("\\min\\left(M_{cr},1.33\\cdot M_u\\right)", "\\phi_f\\cdot M_n"), "Minimum reinforcement, AASHTO 5.6.3.3");
  text("Near the ends the strands' stress is limited by their development (AASHTO 5.9.4.3.2); every section was checked, the governing: " + g.checks.find((c) => c.id === "flexure")!.note + ".", "note");

  // --- shear ---------------------------------------------------------------------------------------------
  const z = stirrupZone(i, shearStation.x);
  const xs = shearStation.x + i.endDist;
  const xn = Math.min(xs, Lg - xs); // from the nearer end
  const negShear = shearStation.longitudinal?.side === "top"; // in a negative moment region: the deck's bars in tension
  const tens = negShear ? [] : groups.filter((k) => k.yAt(xs) < g.comp.h / 2 && xn - k.bondFrom > 0);
  const Apt = tens.reduce((s, k) => s + k.A, 0);
  const fpoAvg = Apt > 0 ? tens.reduce((s, k) => s + k.A * 0.7 * i.fpu * Math.min(1, (xn - k.bondFrom) / lt), 0) / Apt : 0;
  text(`Shear, Strength I, at ${shearStation.label} (x = ${num(shearStation.x, 3)} ft), the governing section (AASHTO 5.7)`, "subheading");
  given(`V_{DC}\\coloneq ${num(Math.abs(shearStation.Vdc), 6)}\\mathrm{kip}`, "Dead loads there");
  given(`V_{DW}\\coloneq ${num(Math.abs(shearStation.Vdw), 6)}\\mathrm{kip}`);
  given(`V_{LL}\\coloneq ${num(shearStation.Vll, 6)}\\mathrm{kip}`, "LL + IM, with gV");
  if (cont) {
    const r = g.restraint!;
    given(`V_{CR}\\coloneq ${num(Math.abs((r.right - r.left) / g.La), 6)}\\mathrm{kip}`, "From the restraint moments at the supports, (Mr,right − Mr,left)/span");
    m("V_u\\coloneq\\eta\\cdot\\left(1.25\\cdot V_{DC}+1.5\\cdot V_{DW}+1.75\\cdot V_{LL}+V_{CR}\\right)=", "Strength I", "kip");
  } else m("V_u\\coloneq\\eta\\cdot\\left(1.25\\cdot V_{DC}+1.5\\cdot V_{DW}+1.75\\cdot V_{LL}\\right)=", "Strength I", "kip");
  if (cdot && shearStation.strengthII) {
    given(`V_{LLII}\\coloneq ${num(shearStation.strengthII.Vll, 6)}\\mathrm{kip}`, `${shearStation.strengthII.vehicle} with IM and gV, CDOT BDM 3.6`);
    m(`V_{uII}\\coloneq\\eta\\cdot\\left(1.25\\cdot V_{DC}+1.5\\cdot V_{DW}+1.35\\cdot V_{LLII}${cont ? "+V_{CR}" : ""}\\right)=`, "Strength II", "kip");
    m("V_u\\coloneq\\max\\left(V_u,V_{uII}\\right)=", "The larger of Strength I and II", "kip");
  }
  if (negShear) text("A negative moment region over the pier: the deck's bars are the flexural tension side's reinforcement (AASHTO 5.7.3.4.2, 5.7.3.5).", "note");
  given(`M_{us}\\coloneq ${num(negShear ? -shearStation.negative!.Mu : shearStation.Mu, 6)}${kft}`, negShear ? "Strength I negative moment there (its magnitude)" : "Strength I moment there");
  given(`V_p\\coloneq ${num(sh.Vp, 6)}\\mathrm{kip}`, sh.Vp > 0 ? "Harped strands' vertical component, at fpe" : "No harped strands here");
  given(`\\phi_v\\coloneq ${num(sh.phiV)}`, sh.phiV < 0.875 ? "Within the debonded region (AASHTO 5.5.4.2, 8th ed. on)" : "AASHTO 5.5.4.2");
  given(`d_v\\coloneq ${num(sh.dv, 6)}\\mathrm{in}`, "max(de − a/2, 0.9 de, 0.72 h), AASHTO 5.7.2.8");
  given(`A_{pt}\\coloneq ${num(Apt, 6)}\\mathrm{in}^{2}`, negShear ? "No strands on the flexural tension side (the top)" : "Bonded strands on the flexural tension side");
  given(`f_{po}\\coloneq ${num(fpoAvg, 6)}\\mathrm{ksi}`, "0.7 fpu, reduced within the transfer length");
  m("M_{ue}\\coloneq\\max\\left(M_{us},\\left|V_u-V_p\\right|\\cdot d_v\\right)=", "Not less than |Vu − Vp|·dv", "kip*ft");
  if (negShear) {
    given(`A_{sd}\\coloneq ${num(g.negativeSection!.As, 6)}\\mathrm{in}^{2}`, "The deck's bars over the pier, in the effective width");
    if (sh.es > -0.0004 + 1e-12 && sh.es >= 0) m("\\varepsilon_s\\coloneq\\min\\left(0.006,\\frac{\\frac{M_{ue}}{d_v}+\\left|V_u-V_p\\right|}{29000\\mathrm{ksi}\\cdot A_{sd}}\\right)=", "AASHTO Eq. 5.7.3.4.2-4 with the deck's bars");
    else given(`\\varepsilon_s\\coloneq ${num(sh.es, 9)}`, "AASHTO Eq. 5.7.3.4.2-4 (limited)");
  } else if (sh.es < 0 && sh.es > -0.0004 + 1e-12) {
    text("εs from the steel alone is negative, so the concrete on the tension side joins it (AASHTO 5.7.3.4.2):", "note");
    given(`\\varepsilon_s\\coloneq ${num(sh.es, 9)}`, "AASHTO Eq. 5.7.3.4.2-4 with Ec·Act");
  } else if (sh.es <= -0.0004 + 1e-12) given("\\varepsilon_s\\coloneq-0.0004", "The lower limit, AASHTO 5.7.3.4.2");
  else if (i.bottomBars.count > 0) given(`\\varepsilon_s\\coloneq ${num(sh.es, 9)}`, "AASHTO Eq. 5.7.3.4.2-4 with the bottom bars");
  else m("\\varepsilon_s\\coloneq\\min\\left(0.006,\\frac{\\frac{M_{ue}}{d_v}+\\left|V_u-V_p\\right|-A_{pt}\\cdot f_{po}}{E_p\\cdot A_{pt}}\\right)=", "AASHTO Eq. 5.7.3.4.2-4");
  if (z.bundle) m(`A_v\\coloneq ${z.legs}\\cdot\\left(${z.bundle.bars}\\cdot${num(BARS[z.bar].area)}\\mathrm{in}^{2}${z.bundle.wire ? `+${num(z.bundle.wire)}\\mathrm{in}^{2}` : ""}\\right)=`, `${zoneCallout(z)} bundled (CDOT B-618-CBT1), ${z.legs} legs`, "in^2");
  else m(`A_v\\coloneq ${z.legs}\\cdot${num(BARS[z.bar].area)}\\mathrm{in}^{2}=`, `#${z.bar} stirrups, ${z.legs} legs`, "in^2");
  m(`s\\coloneq ${num(z.spacing)}\\mathrm{in}`, "Spacing");
  m("A_{vmin}\\coloneq0.0316\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot\\frac{b_v\\cdot s}{f_y}=", "AASHTO Eq. 5.7.2.5-1", "in^2");
  if (sh.Av >= sh.Avmin) m("\\beta\\coloneq\\frac{4.8}{1+750\\cdot\\varepsilon_s}=", "AASHTO Eq. 5.7.3.4.2-1");
  else {
    m(`s_{xe}\\coloneq\\min\\left(80\\mathrm{in},\\max\\left(12\\mathrm{in},d_v\\cdot\\frac{1.38}{${num(i.ag)}+0.63}\\right)\\right)=`, "AASHTO Eq. 5.7.3.4.2-7", "in");
    m("\\beta\\coloneq\\frac{4.8}{1+750\\cdot\\varepsilon_s}\\cdot\\frac{51}{39+\\frac{s_{xe}}{\\mathrm{in}}}=", "Less than the minimum stirrups, AASHTO Eq. 5.7.3.4.2-2");
  }
  m("\\theta_v\\coloneq\\left(29+3500\\cdot\\varepsilon_s\\right)\\cdot\\mathrm{deg}=", "AASHTO Eq. 5.7.3.4.2-3", "deg");
  m("V_c\\coloneq0.0316\\cdot\\beta\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot b_v\\cdot d_v=", "AASHTO Eq. 5.7.3.3-3", "kip");
  m("V_s\\coloneq\\frac{A_v\\cdot f_y\\cdot d_v}{s\\cdot\\tan\\left(\\theta_v\\right)}=", "AASHTO Eq. 5.7.3.3-4", "kip");
  m("V_n\\coloneq\\min\\left(V_c+V_s+V_p,0.25\\cdot f'_{c}\\cdot b_v\\cdot d_v+V_p\\right)=", "AASHTO Eq. 5.7.3.3-1, -2", "kip");
  m(ok("V_u", "\\phi_v\\cdot V_n"), "AASHTO 5.7.3.3");
  if (sh.needsAv) m(ok("A_{vmin}", "A_v"), "Minimum transverse reinforcement, AASHTO 5.7.2.5");
  m("v_u\\coloneq\\frac{\\left|V_u-\\phi_v\\cdot V_p\\right|}{\\phi_v\\cdot b_v\\cdot d_v}=", "AASHTO Eq. 5.7.2.7-1", "ksi");
  m(sh.vu < 0.125 * i.fc ? "s_{max}\\coloneq\\min\\left(0.8\\cdot d_v,24\\mathrm{in}\\right)=" : "s_{max}\\coloneq\\min\\left(0.4\\cdot d_v,12\\mathrm{in}\\right)=", `vu ${sh.vu < 0.125 * i.fc ? "<" : "≥"} 0.125 f'c, AASHTO 5.7.2.6`, "in");
  m(ok("s", "s_{max}"), "Maximum spacing");
  const lgS = shearStation.longitudinal!;
  if (negShear) {
    m("T_{cap}\\coloneq A_{sd}\\cdot f_y=", "The deck's bars", "kip");
    given(`\\phi_{fn}\\coloneq ${num(g.negativeSection!.phi)}`, "Flexure over the pier, AASHTO 5.5.4.2");
    m("T_{rv}\\coloneq\\max\\left(0\\mathrm{kip},\\left|\\frac{V_u}{\\phi_v}-V_p\\right|-0.5\\cdot\\min\\left(V_s,\\frac{V_u}{\\phi_v}\\right)\\right)\\cdot\\frac{1}{\\tan\\left(\\theta_v\\right)}=", "The shear's part", "kip");
    m("T_{req}\\coloneq\\frac{M_{us}}{d_v\\cdot\\phi_{fn}}+T_{rv}=", "AASHTO Eq. 5.7.3.5-1", "kip");
  } else {
    given(`T_{cap}\\coloneq ${num(lgS.capacity, 6)}\\mathrm{kip}`, `Tension side's strands as developed here${i.bottomBars.count ? " and the bottom bars" : ""}`);
    m("T_{rv}\\coloneq\\max\\left(0\\mathrm{kip},\\left|\\frac{V_u}{\\phi_v}-V_p\\right|-0.5\\cdot\\min\\left(V_s,\\frac{V_u}{\\phi_v}\\right)\\right)\\cdot\\frac{1}{\\tan\\left(\\theta_v\\right)}=", "The shear's part", "kip");
    m("T_{req}\\coloneq\\frac{M_{us}}{d_v\\cdot\\phi_f}+T_{rv}=", "AASHTO Eq. 5.7.3.5-1", "kip");
  }
  m(ok("T_{req}", "T_{cap}"), "Longitudinal reinforcement for shear");
  const lb = g.longitudinalAtBearing;
  if (g.checks.some((c) => c.id === "long-brg")) text(`At the ${cont ? "abutment " : ""}bearing's inside edge (${num(lb.x, 3)} ft from its centerline, AASHTO Eq. 5.7.3.5-2): demand ${num(lb.demand, 1)} kip, capacity ${num(lb.capacity, 1)} kip — ${lb.demand <= lb.capacity ? "OK" : "NG"}.`, "note");

  text("Interface shear, girder to deck (AASHTO 5.7.4)", "subheading");
  text("Cast-in-place deck on a girder top intentionally roughened to 0.25 in amplitude: c = 0.28 ksi, μ = 1.0, K1 = 0.3, K2 = 1.8 ksi (5.7.4.4); no permanent clamping force is counted (Pc = 0).", "note");
  m("v_{ui}\\coloneq\\frac{V_u}{b_{tf}\\cdot d_v}=", "AASHTO Eq. 5.7.4.5-1", "ksi");
  m("V_{ui}\\coloneq v_{ui}\\cdot b_{tf}=", "Per unit length", "kip/ft");
  m("A_{cv}\\coloneq b_{tf}", "Per unit length");
  m(`A_{vf}\\coloneq ${i.stirrupsIntoDeck ? "\\frac{A_v}{s}" : "0\\frac{\\mathrm{in}^{2}}{\\mathrm{ft}}"}=`, i.stirrupsIntoDeck ? "Stirrups extending into the deck" : "No stirrups into the deck", "in^2/ft");
  m("V_{ni1}\\coloneq0.28\\mathrm{ksi}\\cdot A_{cv}+1.0\\cdot A_{vf}\\cdot f_y=", "AASHTO Eq. 5.7.4.3-3", "kip/ft");
  m("V_{ni2}\\coloneq0.3\\cdot\\min\\left(f'_{c},f'_{cd}\\right)\\cdot A_{cv}=", "AASHTO Eq. 5.7.4.3-4", "kip/ft");
  m("V_{ni3}\\coloneq1.8\\mathrm{ksi}\\cdot A_{cv}=", "AASHTO Eq. 5.7.4.3-5", "kip/ft");
  m("V_{ni}\\coloneq\\min\\left(V_{ni1},V_{ni2},V_{ni3}\\right)=", "AASHTO 5.7.4.3", "kip/ft");
  m(ok("V_{ui}", "0.9\\cdot V_{ni}"), "AASHTO 5.7.4.3");
  if (sh.interface.needsMin) m(ok("\\frac{0.05\\mathrm{ksi}\\cdot A_{cv}}{f_y}", "A_{vf}"), "vui ≥ 0.210 ksi: minimum interface reinforcement, AASHTO 5.7.4.2");

  // --- debonding --------------------------------------------------------------------------------------------
  const deb = g.checks.filter((c) => c.id.startsWith("deb-"));
  if (deb.length) {
    text("Debonding limits (AASHTO 5.9.4.3.3)", "subheading");
    for (const c of deb) text(`${c.ok ? "OK" : "NG"} — ${c.name}: ${fmt(c.demand)} / ${fmt(c.capacity)} ${c.unit}${c.note ? ` (${c.note})` : ""}`);
  }

  // --- camber -------------------------------------------------------------------------------------------
  text("Camber and deflection (in, upward positive)", "subheading");
  if (L.kind !== "refined") {
    m("V_S\\coloneq\\frac{A_g}{P_g}=", "Volume to surface ratio", "in");
    m("k_s\\coloneq\\max\\left(1,1.45-0.13\\cdot\\frac{V_S}{\\mathrm{in}}\\right)=", "AASHTO Eq. 5.4.2.3.2-2");
    m("k_{hc}\\coloneq1.56-0.008\\cdot H_r=", "AASHTO Eq. 5.4.2.3.3-2");
    m("k_f\\coloneq\\frac{5}{1+\\frac{f'_{ci}}{\\mathrm{ksi}}}=", "AASHTO Eq. 5.4.2.3.2-4");
    m(`t_i\\coloneq ${num(i.tRelease)}`, "Age at release, days");
    m(`t_d\\coloneq ${num(i.tDeck)}`, "Age at deck placement, days");
    m("k_{td}\\left(t\\right)\\coloneq\\frac{t}{\\frac{12\\cdot\\left(100-4\\cdot\\frac{f'_{ci}}{\\mathrm{ksi}}\\right)}{\\frac{f'_{ci}}{\\mathrm{ksi}}+20}+t}", "AASHTO Eq. 5.4.2.3.2-5");
    m("\\psi_b\\left(t,t_l\\right)\\coloneq1.9\\cdot k_s\\cdot k_{hc}\\cdot k_f\\cdot k_{td}\\left(t\\right)\\cdot t_l^{-0.118}", "AASHTO Eq. 5.4.2.3.2-1");
    m("\\psi_{di}\\coloneq\\psi_b\\left(t_d-t_i,t_i\\right)=", "Creep coefficient to the deck");
  }
  given(`\\Delta_{ps}\\coloneq ${num(g.camber.dPs, 6)}\\mathrm{in}`, groups.some((k) => k.kind !== "straight") ? "Prestress camber at release: straight strands P·e·(Lg²/8 − b²/2), harped P·[ec·Lg²/8 − (ec − ee)·a²/6], over Eci·Ig" : "Prestress camber at release, P·e·Lg²/(8·Eci·Ig)");
  m("\\Delta_{gr}\\coloneq\\frac{5\\cdot w_g\\cdot L_g^{4}}{384\\cdot E_{ci}\\cdot I_g}=", "Self-weight deflection at release", "in");
  m("C_r\\coloneq\\Delta_{ps}-\\Delta_{gr}=", "Camber at release", "in");
  if (g.camber.age !== i.tDeck) {
    // CDOT BDM 5.5.2.1 D: the camber at deck placement with the girder 60 days old.
    m(`t_c\\coloneq ${num(g.camber.age)}`, "Girder age at deck placement for camber, days (CDOT BDM 5.5.2.1 D)");
    m("\\psi_{ci}\\coloneq\\psi_b\\left(t_c-t_i,t_i\\right)=", "Creep coefficient to then");
    given(`f_{pd}\\coloneq ${num(g.camber.fpCam, 6)}\\mathrm{ksi}`, L.kind === "refined" ? "Strand stress at that age, fpt less the losses to then (AASHTO 5.9.3.4.2)" : "Strand stress at that age (the loss to the deck in proportion to time, an estimate)");
    m("C_d\\coloneq\\left(\\Delta_{ps}\\cdot\\frac{f_{pd}}{f_{pt}}-\\Delta_{gr}\\right)\\cdot\\left(1+\\psi_{ci}\\right)=", "At deck placement: grown by creep, the prestress part reduced by the losses to then", "in");
  } else {
    given(`f_{pd}\\coloneq ${num(g.losses.fpDeck, 6)}\\mathrm{ksi}`, L.kind === "refined" ? "Strand stress at deck placement, fpt − Δpid" : "Strand stress at deck placement (half the long-term loss, an estimate)");
    m("C_d\\coloneq\\left(\\Delta_{ps}\\cdot\\frac{f_{pd}}{f_{pt}}-\\Delta_{gr}\\right)\\cdot\\left(1+\\psi_{di}\\right)=", "At deck placement: grown by creep, the prestress part reduced by the losses to then", "in");
  }
  given(`\\Delta_{dk}\\coloneq ${num(-g.camber.dDeck, 6)}\\mathrm{in}`, "Deck, haunch and diaphragms on the girder (Ec, span L)");
  if (cont) given(`\\mu_c\\coloneq ${num(g.endMoments, 6)}\\mathrm{ft}^{2}`, "Continuity's change to the midspan moment per klf");
  if (cont) m("\\Delta_{sd}\\coloneq\\frac{5\\cdot\\left(w_{DC2}+w_{DW}\\right)\\cdot L^{4}}{384\\cdot E_c\\cdot I_c}+\\frac{\\left(w_{DC2}+w_{DW}\\right)\\cdot\\mu_c\\cdot L^{2}}{8\\cdot E_c\\cdot I_c}=", "Superimposed dead load on the continuous composite beam (its end moments lessen it)", "in");
  else m("\\Delta_{sd}\\coloneq\\frac{5\\cdot\\left(w_{DC2}+w_{DW}\\right)\\cdot L^{4}}{384\\cdot E_c\\cdot I_c}=", "Superimposed dead load on the composite section", "in");
  m("C_n\\coloneq C_d-\\Delta_{dk}-\\Delta_{sd}=", "Net camber after the deck and superimposed loads", "in");
  if (cdot) {
    // CDOT BDM 5.5.2.1: camber tolerance, sag and the haunch.
    const h = g.haunch;
    text("Camber tolerance, sag and haunch (CDOT BDM 5.5.2.1)", "subheading");
    text("Dead load deflections without long-term multipliers (E). Camber may be up to 30% over or under the prediction on a CBT, and at least 1 in either way (D); a smaller tolerance for cambers under 1 in needs the Unit Leader's approval.", "note");
    m("\\delta_c\\coloneq\\max\\left(0.3\\cdot C_d,1\\mathrm{in}\\right)=", "Camber tolerance, over or under (D)", "in");
    m(ok("\\delta_c+\\Delta_{dk}+\\Delta_{sd}", "C_d"), "No sag: an under-cambered girder keeps its camber under the dead load (G)");
    if (h.D1 !== undefined) {
      m(`\\Delta_x\\coloneq ${num(i.crossSlope ?? 0.02)}\\cdot\\frac{${num(g.shape.topWidth)}\\mathrm{in}}{2}=`, "Cross-slope over half the level top flange (B)", "in");
      m(`\\Delta_{pf}\\coloneq ${num(h.profile)}\\mathrm{in}`, "Profile grade above the bearing-to-bearing chord at midspan (F)");
      m(`h_s\\coloneq ${num(h.minSupport)}\\mathrm{in}`, h.panels ? "Minimum haunch at the supports, deck panels permitted (B)" : "Minimum haunch at the supports, no deck panels (B)");
      m(`h_m\\coloneq ${num(h.minBetween)}\\mathrm{in}`, "Minimum haunch between the supports (B)");
      given(`D_1\\coloneq ${num(h.D1)}\\mathrm{in}`, "Haunch at the supports: the least, to ¼ in, keeping both minimums with an over-cambered girder");
      m("D_2\\coloneq D_1-C_n+\\Delta_{pf}=", "Predicted haunch at midspan, at the girder's centerline", "in");
      m(ok("h_s", "D_1-\\Delta_x"), "At the supports, flange edge");
      m(ok("h_m", "D_2-\\delta_c-\\Delta_x"), "At midspan with an over-cambered girder, flange edge");
      m("h_{51}\\coloneq\\frac{D_1+10\\cdot\\left(D_2+\\delta_c\\right)+D_1}{12}=", "Dead load haunch by Eq. 5.1 with an under-cambered girder (G): the haunch hh used for the loads above", "in");
    }
  }
  if (i.llDeflection) {
    const d = g.llDeflection;
    text(`Live load deflection (AASHTO 2.5.2.6.2, 3.6.1.3.2): ${d.governs}, ${g.df.lanes} lanes with multiple presence shared by ${i.nGirders} girders (${num(d.share, 4)} lanes per girder), on the composite section.`, "note");
    given(`\\Delta_{LL}\\coloneq ${num(d.delta, 6)}\\mathrm{in}`, "With IM on the truck");
    m(ok("\\Delta_{LL}", `\\frac{L}{${num(i.deflectionLimit)}}`), `Limit L/${i.deflectionLimit}`);
  }

  // --- continuity over the piers (5.12.3.3) ---------------------------------------------------------------
  if (cont) continuitySection({ design, side: design.controlling, i: input, m, given, text, lines });

  // --- fatigue, principal tension, anchorage zone, handling (Phase 4) ----------------------------------
  phase4Section({ g, i, m, given, text, midStation, handlingFigure: figures?.handling, lines });

  // --- envelope and summary -----------------------------------------------------------------------------
  text("Along the span", "subheading");
  if (cont) {
    text(`At each section of span ${spanNo + 1}, from its left bearing: x, Strength I moment Mu and resistance φMn (R_M, not at a pier), the most negative Strength I moment Mun (deck bars in tension), Strength I shear Vu, and the Service III stress at the bottom of the girder:`, "note");
    lines.push({
      region: {
        kind: "table",
        columns: [
          { name: "x_{sta}", unit: "ft" },
          { name: "M_{usta}", unit: "kip*ft" },
          { name: "R_{Msta}", unit: "kip*ft" },
          { name: "M_{unsta}", unit: "kip*ft" },
          { name: "V_{usta}", unit: "kip" },
          { name: "f_{b3sta}", unit: "ksi" },
        ],
        rows: g.stations.map((s) => [cell(s.x, 3), cell(s.Mu, 1), cell(s.pier ? 0 : s.phiMn, 1), cell(s.negative?.Mu ?? 0, 1), cell(s.Vu, 2), cell(s.service.botIII, 4)]),
      },
    });
  } else {
    text("At each section from the bearing to midspan (symmetric): x, Strength I moment Mu and resistance φMn (R_M), Strength I shear Vu, and the Service III stress at the bottom of the girder:", "note");
    lines.push({
      region: {
        kind: "table",
        columns: [
          { name: "x_{sta}", unit: "ft" },
          { name: "M_{usta}", unit: "kip*ft" },
          { name: "R_{Msta}", unit: "kip*ft" },
          { name: "V_{usta}", unit: "kip" },
          { name: "f_{b3sta}", unit: "ksi" },
        ],
        rows: g.stations.map((s) => [cell(s.x, 3), cell(s.Mu, 1), cell(s.phiMn, 1), cell(s.Vu, 2), cell(s.service.botIII, 4)]),
      },
    });
  }

  // --- the girder schedule (CDOT B-618-CBT1) -----------------------------------------------------------------
  {
    const s = girderSchedule(input, design);
    lines.push({ text: "Girder schedule", style: "subheading", newPage: true, keepWithNext: true });
    text(
      `The girders as CDOT's worksheet B-618-CBT1 schedules them, from this design${s.final ? "" : ": preliminary, since the design has failing checks (see the summary), not for plans"}. As* is the prestressing steel provided; Ee and Ec are the strands' centroid above the girder's bottom at its end and at midspan; Fj the jacking force and Ff the force after all losses; Δ the deflection at midspan from the deck, diaphragms, overlay and rails; the predicted camber, for the girder alone, at ${s.rows[0]?.age ?? 0} days. Acceptable camber is 30% over or under the predicted, or ±1 in, whichever is greater.`,
    );
    const xs = [4, 104, 134, 210, 248, 296, 334, 372, 420, 466, 500, 532, 568, 626, 680];
    lines.push({ region: textTable(SCHEDULE_HEAD.map((h, k) => ({ title: h, x: xs[k], ...(k > 2 ? { anchor: "end" as const } : {}) })), s.rows.map(scheduleCells), 686, "GIRDER SCHEDULE") });
    if (s.debond.length) {
      const dx = [40, 150, 260, 350, 480];
      lines.push({ region: textTable([["Span", ""], ["Row above", "bottom (in)"], ["Strands", "in row"], ["Debonded", ""], ["Debonded length", "from each end (ft)"]].map((h, k) => ({ title: h as [string, string], x: dx[k], anchor: "end" as const })), s.debond.map((d) => [String(d.span), String(d.y), String(d.strands), String(d.debonded), String(d.length)]), 520, "DEBONDING") });
    }
    if (figures?.schedule) lines.push({ region: figures.schedule });
  }

  // The summary of the checks: a table for each girder of each span, and each pier.
  const sideName = (r: GirderResult) => (r.exterior ? "exterior" : "interior");
  const summaryGroups = [
    ...design.spans.flatMap((s) =>
      [s.interior, s.exterior].map((r) => {
        const name = `${cont ? `Span ${s.index + 1}, ` : ""}${sideName(r)} girder`;
        const controls = design.controlling === sideName(r) && (!cont || s.index === spanNo);
        return { title: `${name[0].toUpperCase()}${name.slice(1)}${controls ? " (controls)" : ""}`, checks: r.checks.map((c) => ({ ...c, ref: /^\d|^T\./.test(c.ref) ? `AASHTO ${c.ref}` : c.ref })) };
      }),
    ),
    ...design.piers.flatMap((p) => (["interior", "exterior"] as const).map((side) => ({ title: `Pier ${p.index}, ${side} girders`, checks: p[side].checks.map((c) => ({ ...c, ref: /^\d|^T\./.test(c.ref) ? `AASHTO ${c.ref}` : c.ref })) }))),
  ];
  lines.push(...checksSummary(summaryGroups));
  if (design.spans.some((s) => [s.interior, s.exterior].some((r) => r.checks.some((c) => c.advisory)))) text("Info:- lifting and hauling are the fabricator's design (CDOT BDM 5.5.1.8), shown for information.", "note");
  return lines;
}

/** The continuity over the piers, at the governing pier: the bridge's moment envelope, the section
 * over the pier (deck bars in tension), the restraint moments, the joint and the positive moment
 * connection (AASHTO 5.12.3.3). */
function continuitySection(p: {
  design: ReturnType<typeof designGirder>;
  side: "interior" | "exterior";
  i: GirderInputs;
  m: (math: string, ref?: string, unit?: string) => void;
  given: (math: string, ref?: string) => void;
  text: (t: string, style?: "heading" | "subheading" | "note") => void;
  lines: Line[];
}) {
  const { design, side, i, m, given, text, lines } = p;
  const kft = "\\mathrm{kip}\\cdot\\mathrm{ft}";
  text("The bridge made continuous (AASHTO 5.12.3.3)", "subheading");
  text(
    "The girders carry their own weight, the deck, the haunch and the intermediate diaphragms as simple spans; the barriers, the overlay, the live load and the creep and shrinkage after continuity act on the continuous beam (a line-girder analysis, uniform EI, spanning from the abutments' bearings to the piers' centerlines). Live load by influence lines: the design truck or tandem with the lane load, and for negative moment between the points of contraflexure, 90% of two design trucks (14 ft axles, ≥ 50 ft apart) with 90% of the lane load (AASHTO 3.6.1.3.1); negative moment distribution factors with L the average of the two spans at the pier (T. 4.6.2.2.1-2).",
    "note",
  );
  // The envelope along the whole bridge.
  const starts = design.spans.map((_, k) => design.spans.slice(0, k).reduce((a, s) => a + s.L, 0));
  text(`Strength I moments along the bridge, ${side} girders: X from the first abutment, the most positive Mu and the most negative Mun:`, "note");
  lines.push({
    region: {
      kind: "table",
      columns: [
        { name: "X_{br}", unit: "ft" },
        { name: "M_{ubr}", unit: "kip*ft" },
        { name: "M_{unbr}", unit: "kip*ft" },
      ],
      rows: design.spans.flatMap((s, k) => s[side].stations.filter((st) => !st.label.includes("(right end)") || st.pier).map((st) => [cell(starts[k] + st.x, 3), cell(st.Mu, 1), cell(st.negative?.Mu ?? 0, 1)])),
    },
  });

  // The governing pier: the largest negative moment.
  const pierAt = design.piers.map((pr) => {
    const st = design.spans[pr.index - 1][side].stations.find((s) => s.pier && s.x > 1e-6)!;
    return { pr, st, line: design.spans[pr.index - 1][side] };
  });
  const gov = pierAt.reduce((a, b) => (b.st.negative!.Mu < a.st.negative!.Mu ? b : a));
  const cdot = i.criteria === "cdot";
  const neg = gov.line.negativeSection!;
  const ng = gov.st.negative!;
  const b = i.pierBars;
  text(`Over pier ${gov.pr.index}, the governing pier: negative moment, Strength I (AASHTO 5.6.3, 5.12.3.3)`, "subheading");
  given(`M_{DC2n}\\coloneq ${num(-ng.Mdc2, 6)}${kft}`, "Barriers and other DC on the continuous beam (magnitude)");
  given(`M_{DWn}\\coloneq ${num(-ng.Mdw, 6)}${kft}`, "Overlay (magnitude)");
  given(`M_{LLn}\\coloneq ${num(-ng.Mll, 6)}${kft}`, `LL + IM with the negative moment distribution factor ${num(ng.df, 4)}; ${ng.governs}`);
  given(`M_{CRn}\\coloneq ${num(-ng.Mr, 6)}${kft}`, "Negative restraint moment (magnitude, below), γ = 1.0");
  m("M_{un}\\coloneq\\eta\\cdot\\left(1.25\\cdot M_{DC2n}+1.5\\cdot M_{DWn}+1.75\\cdot M_{LLn}+M_{CRn}\\right)=", "Strength I, AASHTO T. 3.4.1-1, -3", "kip*ft");
  m(`A_{s1}\\coloneq ${num(BARS[b.topBar].area)}\\mathrm{in}^{2}\\cdot\\frac{b_e}{${num(b.topSpacing)}\\mathrm{in}}=`, `Top mat, #${b.topBar} at ${b.topSpacing} in`, "in^2");
  m(`A_{s2}\\coloneq ${num(BARS[b.botBar].area)}\\mathrm{in}^{2}\\cdot\\frac{b_e}{${num(b.botSpacing)}\\mathrm{in}}=`, `Bottom mat, #${b.botBar} at ${b.botSpacing} in`, "in^2");
  given(`y_{s1}\\coloneq ${num(neg.mats[0].y, 6)}\\mathrm{in}`, `Above the girder's bottom: ${b.coverTop} in cover from the deck's top as cast`);
  given(`y_{s2}\\coloneq ${num(neg.mats[1].y, 6)}\\mathrm{in}`, `${b.coverBottom} in cover from the deck's bottom`);
  text("The compression in the girder's bottom flange, with the girder's f′c (C5.12.3.3), by strain compatibility over its outline (AASHTO 5.6.2.2):", "note");
  given(`c_n\\coloneq ${num(neg.c, 6)}\\mathrm{in}`, "Neutral axis above the girder's bottom");
  given(`y_{Cn}\\coloneq ${num(neg.flex.dp - neg.flex.arm, 6)}\\mathrm{in}`, "The compression's centroid above the bottom (bars yielding)");
  m("M_{nn}\\coloneq\\left(A_{s1}+A_{s2}\\right)\\cdot f_y\\cdot\\frac{A_{s1}\\cdot y_{s1}+A_{s2}\\cdot y_{s2}}{A_{s1}+A_{s2}}-\\left(A_{s1}+A_{s2}\\right)\\cdot f_y\\cdot y_{Cn}=", "Both mats yielding", "kip*ft");
  m("\\varepsilon_{tn}\\coloneq0.003\\cdot\\frac{y_{s1}-c_n}{c_n}=", "Net tensile strain at the top mat");
  m("\\phi_n\\coloneq\\min\\left(0.9,\\max\\left(0.75,0.75+0.15\\cdot\\frac{\\varepsilon_{tn}-0.002}{0.005-0.002}\\right)\\right)=", "AASHTO 5.5.4.2, nonprestressed");
  m(ok("M_{un}", "\\phi_n\\cdot M_{nn}"), "AASHTO 5.6.3.2");
  m("f_{rd}\\coloneq0.24\\cdot\\sqrt{\\frac{f'_{cd}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}=", "Deck, AASHTO 5.4.2.6", "ksi");
  m("M_{crn}\\coloneq0.67\\cdot1.6\\cdot f_{rd}\\cdot\\frac{S_{td}}{n}=", "Cracking moment with the deck's top in tension, AASHTO Eq. 5.6.3.3-1, γ3 = 0.67 (A615 Grade 60)", "kip*ft");
  m(ok("\\min\\left(M_{crn},1.33\\cdot M_{un}\\right)", "\\phi_n\\cdot M_{nn}"), "Minimum reinforcement, AASHTO 5.6.3.3");
  const cc = design.spans.flatMap((s) => s[side].checks).filter((c) => c.id === "crack-control");
  const ccw = cc.length ? cc.reduce((a, c) => (c.demand / c.capacity > a.demand / a.capacity ? c : a)) : null;
  if (ccw) {
    const fss = Number(/fss = ([\d.]+)/.exec(ccw.note ?? "")?.[1] ?? 0);
    text("Crack control in the deck over the pier (AASHTO 5.6.7), Service I: the bar stress from the cracked section, the bars transformed (n = Es/Ec), the girder's bottom in compression.", "note");
    given(`f_{ss}\\coloneq ${num(Math.min(fss, 0.6 * i.fy), 4)}\\mathrm{ksi}`, `Top mat, not more than 0.6 fy; ${ccw.note?.split(";")[0]}`);
    m(`d_{cn}\\coloneq ${num(b.coverTop)}\\mathrm{in}+\\frac{${num(BARS[b.topBar].dia)}\\mathrm{in}}{2}=`, "To the top bars' center", "in");
    m("\\beta_s\\coloneq1+\\frac{d_{cn}}{0.7\\cdot\\left(h_c+t_{sac}-d_{cn}\\right)}=", "AASHTO 5.6.7");
    m(`s_{mx}\\coloneq\\frac{700\\cdot${i.exposure === "severe" ? "0.75" : "1.00"}\\frac{\\mathrm{kip}}{\\mathrm{in}}}{\\beta_s\\cdot f_{ss}}-2\\cdot d_{cn}=`, `AASHTO Eq. 5.6.7-1, γe = ${i.exposure === "severe" ? "0.75 (Class 2)" : "1.00 (Class 1)"}`, "in");
    m(ok(`${num(b.topSpacing)}\\mathrm{in}`, "s_{mx}"), "Top bar spacing");
  }

  if (cdot) {
    const pj = gov.pr[side];
    const effective = design.restraint![side].effective[gov.pr.index];
    text("Restraint moments (CDOT BDM 5.7.2)", "subheading");
    text("Positive restraint moments from girder creep and shrinkage and deck shrinkage are taken as zero, and restraint moments aren't computed.", "note");
    m("M_r\\coloneq0\\mathrm{kip}\\cdot\\mathrm{ft}");
    text(`Pier ${gov.pr.index}: the joint and the positive moment connection (CDOT BDM 5.7.2, 5.7.3)`, "subheading");
    text(
      i.continuity === "envelope"
        ? "Simple-span and continuous behavior are enveloped for all loads after continuity (chosen), so simple-span behavior governs the positive moments."
        : effective
          ? `The girders are ${num(i.tContinuity)} days old when continuity is made, at least 60: the joint is fully effective and the spans are continuous for the loads after continuity (BDM 5.7.3). The plans must state this minimum age.`
          : `The girders are ${num(i.tContinuity)} days old when continuity is made, less than 60: the joint is non-effective, so simple-span and continuous behavior are enveloped for all loads after continuity (BDM 5.7.3).`,
      "note",
    );
    m(`A_{sc}\\coloneq ${i.connection.count}\\cdot${num(BARS[i.connection.bar].area)}\\mathrm{in}^{2}=`, `${i.connection.count} #${i.connection.bar} bars from the girder's bottom into the diaphragm`, "in^2");
    m(`d_{sc}\\coloneq h_c-${num(i.connection.y)}\\mathrm{in}=`, undefined, "in");
    m("a_{sc}\\coloneq\\frac{A_{sc}\\cdot f_y}{\\alpha_1\\cdot f'_{cd}\\cdot b_e}=", "The deck in compression", "in");
    m("M_{nsc}\\coloneq A_{sc}\\cdot f_y\\cdot\\left(d_{sc}-\\frac{a_{sc}}{2}\\right)=", undefined, "kip*ft");
    m("M_{crd}\\coloneq0.24\\cdot\\sqrt{\\frac{f'_{cd}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}\\cdot S_{bc}=", "Cracking moment of the composite section, the diaphragm's (deck's) concrete, AASHTO 5.4.2.6", "kip*ft");
    given(`M_{LLp}\\coloneq ${num(pj.MllPos, 6)}${kft}`, "The most positive LL + IM moment at the pier");
    m(`M_{usc}\\coloneq\\max\\left(1.2\\cdot M_{crd},\\eta\\cdot\\left(1.75\\cdot M_{LLp}+${pj.Mdc2 < 0 ? "0.9" : "1.25"}\\cdot${num(pj.Mdc2, 4)}\\mathrm{kip}\\cdot\\mathrm{ft}+${pj.Mdw < 0 ? "0.65" : "1.5"}\\cdot${num(pj.Mdw, 4)}\\mathrm{kip}\\cdot\\mathrm{ft}\\right)\\right)=`, "1.2 Mcr (CDOT BDM 5.7.2), or Strength I if larger", "kip*ft");
    m(ok("M_{usc}", "0.9\\cdot M_{nsc}"), "Positive moment connection, strength");
    return;
  }
  // Restraint moments.
  const R = design.restraint![side];
  const rl = design.spans[0][side].restraintLoads!;
  text("Restraint moments from creep and shrinkage after continuity (AASHTO 5.12.3.3)", "subheading");
  text(
    `By the method of the AASHTO commentary's references (PCA, Mattock): each span's free end rotations after continuity, from the creep of the girder under its prestress and dead loads and from the deck's shrinkage relative to the girder, are restrained by the continuous beam (three-moment equation); the restraint is relaxed as the girder creeps, by (1 − e^−φ)/φ. Continuity at a girder age of ${num(rl.tc)} days; restraint moments counted: ${i.restraintMoments === "all" ? "all" : i.restraintMoments === "positive" ? "positive ones only" : "none"}.`,
    "note",
  );
  given(`\\phi_c\\coloneq ${num(rl.phi, 6)}`, "ψb(tf, tc): the girder's creep after continuity (5.4.2.3.2)");
  m("\\rho_r\\coloneq\\frac{1-e^{-\\phi_c}}{\\phi_c}=", "Relaxation of the restraint");
  given(`\\varepsilon_{dc}\\coloneq ${num(rl.eDeck, 10)}`, "The deck's shrinkage after continuity (5.4.2.3.3)");
  given(`\\varepsilon_{gc}\\coloneq ${num(rl.eGirder, 10)}`, "The girder's");
  given(`\\psi_{dc}\\coloneq ${num(rl.psiDeck, 6)}`, "The deck's creep (loaded at a day old)");
  m("F_{sh}\\coloneq\\frac{\\left(\\varepsilon_{dc}-\\varepsilon_{gc}\\right)\\cdot b_e\\cdot t_s\\cdot E_{cd}}{1+0.7\\cdot\\psi_{dc}}=", "Differential shrinkage force (cf. AASHTO Eq. 5.9.3.4.3d-2)", "kip");
  given(`e_{dc}\\coloneq ${num(rl.ed, 6)}\\mathrm{in}`, "The deck's centroid above the composite centroid");
  given(`M_{rc}\\coloneq ${num(R.creep[gov.pr.index] / rl.relax, 6)}${kft}`, `Pier ${gov.pr.index}: from the creep rotations, fully restrained (three-moment equation)`);
  given(`M_{rs}\\coloneq ${num(R.shrinkage[gov.pr.index] / rl.relax, 6)}${kft}`, "From the differential shrinkage's curvature F_sh·e_dc/(Ec·Ic), fully restrained");
  if (i.restraintMoments === "none") m("M_r\\coloneq0\\mathrm{kip}\\cdot\\mathrm{ft}", "Not counted");
  else if (i.restraintMoments === "positive") m("M_r\\coloneq\\max\\left(0\\mathrm{kip}\\cdot\\mathrm{ft},\\left(M_{rc}+M_{rs}\\right)\\cdot\\rho_r\\right)=", "Positive ones only", "kip*ft");
  else m("M_r\\coloneq\\left(M_{rc}+M_{rs}\\right)\\cdot\\rho_r=", "At the pier, + sagging", "kip*ft");

  // The joint and the positive moment connection.
  const pj = gov.pr[side];
  text(`Pier ${gov.pr.index}: the joint and the positive moment connection (AASHTO 5.12.3.3)`, "subheading");
  given(`M_{DC2p}\\coloneq ${num(pj.Mdc2, 6)}${kft}`, "Barriers and other DC at the pier (signed)");
  given(`M_{DWp}\\coloneq ${num(pj.Mdw, 6)}${kft}`, "Overlay");
  given(`M_{LLp}\\coloneq ${num(pj.MllPos, 6)}${kft}`, "The most positive LL + IM moment at the pier");
  m("M_{fe}\\coloneq M_{DC2p}+M_{DWp}+M_r+0.5\\cdot M_{LLp}=", "Superimposed permanent loads, restraint and 50% of the live load", "kip*ft");
  m("f_{bd}\\coloneq-\\frac{M_{fe}}{S_{bc}}=", "At the bottom of the diaphragm (compression +)", "ksi");
  text(pj.effective ? "In compression: the joint is fully effective (AASHTO 5.12.3.3)." : "In tension: the joint isn't fully effective, so the adjacent spans' positive moments are also taken as simple spans (AASHTO 5.12.3.3).", "note");
  m(`A_{sc}\\coloneq ${i.connection.count}\\cdot${num(BARS[i.connection.bar].area)}\\mathrm{in}^{2}=`, `${i.connection.count} #${i.connection.bar} bars from the girder's bottom into the diaphragm`, "in^2");
  m(`d_{sc}\\coloneq h_c-${num(i.connection.y)}\\mathrm{in}=`, undefined, "in");
  m("a_{sc}\\coloneq\\frac{A_{sc}\\cdot f_y}{\\alpha_1\\cdot f'_{cd}\\cdot b_e}=", "The deck in compression", "in");
  m("M_{nsc}\\coloneq A_{sc}\\cdot f_y\\cdot\\left(d_{sc}-\\frac{a_{sc}}{2}\\right)=", undefined, "kip*ft");
  m(`M_{usc}\\coloneq\\max\\left(0\\mathrm{kip}\\cdot\\mathrm{ft},\\eta\\cdot\\left(M_r+1.75\\cdot M_{LLp}+${pj.Mdc2 < 0 ? "0.9" : "1.25"}\\cdot M_{DC2p}+${pj.Mdw < 0 ? "0.65" : "1.5"}\\cdot M_{DWp}\\right)\\right)=`, "Strength I positive moment at the pier, the dead loads at their minimum factors where they relieve", "kip*ft");
  m(ok("M_{usc}", "0.9\\cdot M_{nsc}"), "Positive moment connection, strength");
  given(`f_{sc}\\coloneq ${num(Number.isFinite(pj.fs) ? pj.fs : 999, 6)}\\mathrm{ksi}`, `Bar stress at Service I (${num(Math.max(0, pj.Ms), 1)} kip·ft), cracked section with the deck in compression`);
  m(ok("f_{sc}", `${CONNECTION_STRESS}\\mathrm{ksi}`), "Positive moment connection, bar stress at service (AASHTO 5.12.3.3)");
}

/** Fatigue I at midspan, principal tension where it applies, the anchorage zone, and lifting and hauling
 * (the case without impact or wind worked out; the minimum over all cases from the engine). */
function phase4Section(p: {
  g: GirderResult;
  i: GirderInputs;
  m: (math: string, ref?: string, unit?: string) => void;
  given: (math: string, ref?: string) => void;
  text: (t: string, style?: "heading" | "subheading" | "note") => void;
  midStation: GirderResult["stations"][number];
  handlingFigure?: Figure;
  lines: Line[];
}) {
  const { g, i, m, given, text, midStation } = p;
  const kft = "\\mathrm{kip}\\cdot\\mathrm{ft}";
  const fat = g.checks.find((c) => c.id === "fatigue")!;

  text("Fatigue I (AASHTO 5.5.3.1, T. 5.9.2.3.2a-1)", "subheading");
  text("The fatigue truck: one design truck with its rear axles at 30 ft, IM 15%, γ = 1.75 (AASHTO 3.6.1.4.1, T. 3.4.1-1), with the one-lane distribution factor without the multiple presence factor (3.6.1.4.3b). Its compression with half the effective prestress and permanent loads, on the uncracked section, at midspan:", "note");
  given(`M_{ft}\\coloneq ${num(midStation.fatigue.Mfat / g.df.fatigue, 6)}${kft}`, "Fatigue truck per lane at midspan, by its influence line");
  given(`g_{ft}\\coloneq ${num(g.df.fatigue, 6)}`, g.exterior ? "One lane (lever rule or rigid section) ÷ 1.2" : "g_M1 × skew ÷ 1.2");
  m("f_{fat}\\coloneq0.5\\cdot f_{tp}+\\frac{1.75\\cdot1.15\\cdot g_{ft}\\cdot M_{ft}}{S_{tc}}=", "Top of the girder", "ksi");
  m(ok("f_{fat}", "0.40\\cdot f'_{c}"), "AASHTO T. 5.9.2.3.2a-1");
  text(`Governing along the span: ${fat.ok ? "OK" : "NG"} — ${fat.name}, ${fmt(fat.demand)} / ${fmt(fat.capacity)} ksi; ${fat.note}.`, "note");

  const pr = g.stations.filter((s) => s.principal);
  if (pr.length) {
    const s = pr.reduce((a, b) => (b.principal!.ft > a.principal!.ft ? b : a));
    const q = s.principal!;
    text(`Principal tension in the web (AASHTO 5.9.2.3.3), Service III, at its largest: ${s.label} (x = ${num(s.x, 2)} ft), the ${q.where}`, "subheading");
    text("f′c above 10 ksi, so the check applies. The LRFD method: the total Service III shear on the composite section; the axial stress at the elevation interpolated between the girder's top and bottom, from the moments that give the least compression there.", "note");
    given(`V_{3}\\coloneq ${num(q.V, 6)}\\mathrm{kip}`, "Service III shear");
    given(`V_{p3}\\coloneq ${num(q.Vp, 6)}\\mathrm{kip}`, "Harped strands' vertical component");
    given(`Q_{w}\\coloneq ${num(q.Q, 4)}\\mathrm{in}^{3}`, `First moment above y = ${num(q.y, 3)} in, about the composite centroid`);
    given(`b_{w3}\\coloneq ${num(q.bw, 4)}\\mathrm{in}`, "Width there");
    given(`f_{pcx}\\coloneq ${num(q.fpcx, 6)}\\mathrm{ksi}`, "Axial stress there (compression +)");
    m("\\tau_w\\coloneq\\frac{\\left(V_{3}-V_{p3}\\right)\\cdot Q_{w}}{b_{w3}\\cdot I_c}=", "AASHTO Eq. 5.9.2.3.3-1", "ksi");
    m("f_{min}\\coloneq-\\frac{f_{pcx}}{2}+\\sqrt{\\left(\\frac{f_{pcx}}{2}\\right)^{2}+\\tau_w^{2}}=", "Principal tension (tension +), Mohr's circle", "ksi");
    m(ok("f_{min}", "0.110\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}"), "AASHTO 5.9.2.3.3");
  }

  // Anchorage zone.
  const sp = g.splitting;
  const cf = g.confinement;
  text("Anchorage zone (AASHTO 5.9.4.4)", "subheading");
  given(`F_{pi}\\coloneq ${num(sp.Fpi, 4)}\\mathrm{kip}`, "The strands bonded at the end, just after transfer");
  m("h_{sp}\\coloneq\\frac{H}{4}=", "The splitting zone from the end", "in");
  given(`A_{sp}\\coloneq ${num(sp.As, 6)}\\mathrm{in}^{2}`, "Vertical bars within it: legs × area × length in the zone ÷ spacing, from the stirrup zones");
  m("P_{rs}\\coloneq20\\mathrm{ksi}\\cdot A_{sp}=", "fs not more than 20 ksi, AASHTO 5.9.4.4.1", "kip");
  m(ok("0.04\\cdot F_{pi}", "P_{rs}"), "Splitting resistance, AASHTO 5.9.4.4.1");
  m(`l_{cf}\\coloneq ${num(cf.length)}\\mathrm{ft}`, `Confinement: #${cf.bar} at ${num(cf.spacing)} in`);
  m(ok("1.5\\cdot H", "l_{cf}"), "Over 1.5d from the end, AASHTO 5.9.4.4.2");
  m(ok(`${num(cf.spacing)}\\mathrm{in}`, "6\\mathrm{in}"), "Spacing; bars not smaller than #3");

  // Handling.
  const h = g.handling;
  if (!h) return;
  const hd = i.handling;
  const L0 = h.lifting;
  /** The governing corner without impact or wind: its plumb stress (tension +) and moment. */
  const govCorner = (secs: { X: number; Mg: number; corners: { corner: string; byCase: { fDirect: number; byWind: { fscr: number }[] }[] }[] }[]) => {
    let best = { fscr: Infinity, fd: 0, Mg: 0, X: 0, top: true };
    for (const s of secs)
      for (const c of s.corners) {
        const v = c.byCase[0].byWind[0].fscr;
        if (v < best.fscr) best = { fscr: v, fd: c.byCase[0].fDirect, Mg: s.Mg, X: s.X, top: c.corner.startsWith("top") };
      }
    return best;
  };
  const fab = i.criteria === "cdot";
  text(fab ? "Lifting from the form (AASHTO 5.5.4.3; PCI CB-02-16-E), for information" : "Lifting from the form (AASHTO 5.5.4.3; PCI CB-02-16-E)", "subheading");
  if (fab) text("Shipping and handling are the fabricator's design (CDOT BDM 5.5.1.8): lifting and hauling are worked out here for information and don't decide the design.", "note");
  if (p.handlingFigure) p.lines.push({ region: p.handlingFigure });
  text("The girder hangs from vertical lifting devices and rolls about the axis through them; its weight's lateral deflection, the sweep and the devices' placement tolerance tilt it. Stresses here: tension +. Worked without impact or wind; the minimum factors of safety over every case follow.", "note");
  given(`I_y\\coloneq ${num(g.g.Iy, 1)}\\mathrm{in}^{4}`, "About the vertical axis");
  m(`a_L\\coloneq ${num(hd.liftPoint)}\\mathrm{ft}`, "Lifting devices from each end");
  m(`s_w\\coloneq ${num(hd.sweep)}\\mathrm{in}`, "Sweep tolerance per 10 ft");
  m(`e_{lt}\\coloneq ${num(hd.liftTolerance)}\\mathrm{in}`, "Placement tolerance");
  m("W_L\\coloneq w_g\\cdot L_g=", "Weight", "kip");
  m("l_L\\coloneq L_g-2\\cdot a_L=", "Between the devices", "ft");
  m("F_L\\coloneq\\left(\\frac{l_L}{L_g}\\right)^{2}-\\frac{1}{3}=", "Sweep's offset factor");
  m("e_{iL}\\coloneq F_L\\cdot s_w\\cdot\\frac{L_g}{10\\mathrm{ft}}+e_{lt}=", "Initial lateral eccentricity", "in");
  m("S_{zL}\\coloneq\\frac{l_L^{5}}{10}-a_L^{2}\\cdot l_L^{3}+3\\cdot a_L^{4}\\cdot l_L+\\frac{6\\cdot a_L^{5}}{5}=", "The overhangs' and span's terms");
  m("z_{oL}\\coloneq\\frac{W_L}{12\\cdot E_{ci}\\cdot I_y\\cdot L_g^{2}}\\cdot S_{zL}=", "The weight applied sideways (PCI)", "in");
  m("y_{rL}\\coloneq H-y_b-F_L\\cdot\\max\\left(0\\mathrm{in},C_r\\right)=", "Center of gravity below the roll axis, less the camber's offset", "in");
  m("\\theta_{eL}\\coloneq\\frac{e_{iL}}{y_{rL}-z_{oL}}=", "Equilibrium tilt, rad");
  const gl = govCorner(L0.sections);
  if (Number.isFinite(gl.fscr) && gl.fscr > 0) {
    text(`Cracking: the governing flange tip is the ${gl.top ? "top" : "bottom"} flange's, at ${num(gl.X / 12, 2)} ft from the end.`, "note");
    given(`f_{dL}\\coloneq ${num(gl.fd, 6)}\\mathrm{ksi}`, "Its stress, girder plumb (prestress and weight)");
    given(`M_{gL}\\coloneq ${num(gl.Mg / 12, 6)}${kft}`, "The weight's moment there");
    m("f_{rL}\\coloneq0.24\\cdot\\sqrt{\\frac{f'_{ci}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}=", "Modulus of rupture at release (AASHTO 5.4.2.6)", "ksi");
    m(`M_{lL}\\coloneq\\left(f_{rL}-f_{dL}\\right)\\cdot\\frac{I_y}{${num(gl.top ? g.shape.topWidth / 2 : g.shape.profile[0][1], 4)}\\mathrm{in}}=`, "Lateral moment that cracks the tip", "kip*ft");
    m("\\theta_{cL}\\coloneq\\frac{M_{lL}}{M_{gL}}=", "Tilt at cracking, rad");
    m("FS_{cL}\\coloneq\\frac{y_{rL}\\cdot\\theta_{cL}}{z_{oL}\\cdot\\theta_{cL}+e_{iL}}=", "Factor of safety against cracking");
  } else text(Number.isFinite(gl.fscr) ? "Cracking: a flange tip is already past the modulus of rupture with the girder plumb, so FScr = 0." : "Cracking: no flange tip cracks within the tilt angles considered.", "note");
  m("\\theta_{mL}\\coloneq\\min\\left(0.4,\\sqrt{\\frac{e_{iL}}{2.5\\cdot z_{oL}}}\\right)=", "Tilt at failure, rad (not more than 0.4, the small-angle limit)");
  m("FS_{fL}\\coloneq\\frac{y_{rL}\\cdot\\theta_{mL}}{z_{oL}\\cdot\\theta_{mL}\\cdot\\left(1+2.5\\cdot\\theta_{mL}\\right)+e_{iL}}=", "Factor of safety against failure");
  for (const c of g.checks.filter((k) => k.id.startsWith("lift-"))) text(`${verdict(c)} —${c.name}: ${fmt(c.demand)} / ${fmt(c.capacity)}${c.unit ? ` ${c.unit}` : ""}${c.note ? ` (${c.note})` : ""}`, "note");

  const H0 = h.hauling;
  const S0 = H0.superelevation;
  text(fab ? "Hauling (AASHTO 5.5.4.3; PCI CB-02-16-E), for information; tension limits of AASHTO T. 5.9.2.3.1b-1" : "Hauling (AASHTO 5.5.4.3; PCI CB-02-16-E, WSDOT's method)", "subheading");
  text(`The girder on the truck's supports rolls about the truck's roll center, resisted by its roll stiffness. Worked at the maximum superelevation without impact or wind (WSDOT applies impact on the normal crown only); the minimum factors of safety over every case follow. Prestress after ${num(h.tHaul)} days' losses (${num(h.lossToHaul, 3)} ksi), at f′c.`, "note");
  m(`a_H\\coloneq ${num(hd.bunkPoint)}\\mathrm{ft}`, "Supports from each end");
  m(`e_{ht}\\coloneq ${num(hd.haulTolerance)}\\mathrm{in}`, "Placement tolerance");
  m(`K_\\theta\\coloneq ${num(hd.truck.Ktheta)}\\mathrm{kip}\\cdot\\mathrm{in}`, "Truck's roll stiffness, per radian");
  m(`H_{rc}\\coloneq ${num(hd.truck.Hrc)}\\mathrm{in}`, "Roll center above the road");
  m(`H_{bg}\\coloneq ${num(hd.truck.Hbg)}\\mathrm{in}`, "Girder bottom above the road");
  m(`W_{cc}\\coloneq ${num(hd.truck.Wcc)}\\mathrm{in}`, "Dual tires, center to center");
  m(`\\alpha_s\\coloneq ${num(hd.superelevation)}`, "Superelevation, rad");
  given(`C_h\\coloneq ${num(h.camberHaul, 6)}\\mathrm{in}`, "Camber at hauling");
  m("l_H\\coloneq L_g-2\\cdot a_H=", undefined, "ft");
  m("F_H\\coloneq\\left(\\frac{l_H}{L_g}\\right)^{2}-\\frac{1}{3}=");
  m("e_{iH}\\coloneq F_H\\cdot s_w\\cdot\\frac{L_g}{10\\mathrm{ft}}+e_{ht}=", undefined, "in");
  m("S_{zH}\\coloneq\\frac{l_H^{5}}{10}-a_H^{2}\\cdot l_H^{3}+3\\cdot a_H^{4}\\cdot l_H+\\frac{6\\cdot a_H^{5}}{5}=", "The overhangs' and span's terms");
  m("z_{oH}\\coloneq\\frac{W_L}{12\\cdot E_c\\cdot I_y\\cdot L_g^{2}}\\cdot S_{zH}=", undefined, "in");
  m("y_{rH}\\coloneq H_{bg}-H_{rc}+y_b+F_H\\cdot C_h=", "Center of gravity above the roll center, raised by the camber", "in");
  m("\\theta_{eH}\\coloneq\\frac{K_\\theta\\cdot\\alpha_s+W_L\\cdot e_{iH}}{K_\\theta-W_L\\cdot\\left(y_{rH}+z_{oH}\\right)}=", "Equilibrium tilt, rad");
  const gh = govCorner(S0.sections);
  if (Number.isFinite(gh.fscr) && gh.fscr > 0) {
    text(`Cracking: the governing flange tip is the ${gh.top ? "top" : "bottom"} flange's, at ${num(gh.X / 12, 2)} ft from the end.`, "note");
    given(`f_{dH}\\coloneq ${num(gh.fd, 6)}\\mathrm{ksi}`, "Its stress, girder plumb");
    given(`M_{gH}\\coloneq ${num(gh.Mg / 12, 6)}${kft}`, "The weight's moment there");
    m("f_{rH}\\coloneq0.24\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}=", undefined, "ksi");
    m(`M_{lH}\\coloneq\\left(f_{rH}-f_{dH}\\right)\\cdot\\frac{I_y}{${num(gh.top ? g.shape.topWidth / 2 : g.shape.profile[0][1], 4)}\\mathrm{in}}=`, undefined, "kip*ft");
    m("\\theta_{cH}\\coloneq\\frac{M_{lH}}{M_{gH}}=", "Tilt at cracking, rad");
    m("FS_{cH}\\coloneq\\frac{K_\\theta\\cdot\\left(\\theta_{cH}-\\alpha_s\\right)}{W_L\\cdot\\left(\\left(y_{rH}+z_{oH}\\right)\\cdot\\theta_{cH}+e_{iH}\\right)}=", "Factor of safety against cracking");
  } else text(Number.isFinite(gh.fscr) ? "Cracking: a flange tip is already past the modulus of rupture with the girder plumb, so FScr = 0." : "Cracking: no flange tip cracks within the tilt angles considered.", "note");
  m("\\theta_{rH}\\coloneq\\frac{W_L\\cdot\\left(\\frac{W_{cc}}{2}-H_{rc}\\cdot\\alpha_s\\right)}{K_\\theta}+\\alpha_s=", "Tilt when the truck's tires lift (rollover), rad");
  m("FS_{rH}\\coloneq\\frac{K_\\theta\\cdot\\left(\\theta_{rH}-\\alpha_s\\right)}{W_L\\cdot\\left(z_{oH}\\cdot\\theta_{rH}\\cdot\\left(1+2.5\\cdot\\theta_{rH}\\right)+y_{rH}\\cdot\\theta_{rH}+e_{iH}\\right)}=", "Factor of safety against rollover");
  m("\\theta_{mH}\\coloneq\\min\\left(0.4,\\alpha_s+\\sqrt{\\alpha_s^{2}+\\frac{e_{iH}+\\left(z_{oH}+y_{rH}\\right)\\cdot\\alpha_s}{2.5\\cdot z_{oH}}}\\right)=", "Tilt at failure, rad (not more than 0.4)");
  m("FS_{fH}\\coloneq\\frac{K_\\theta\\cdot\\left(\\theta_{mH}-\\alpha_s\\right)}{W_L\\cdot\\left(z_{oH}\\cdot\\theta_{mH}\\cdot\\left(1+2.5\\cdot\\theta_{mH}\\right)+y_{rH}\\cdot\\theta_{mH}+e_{iH}\\right)}=", "Factor of safety against failure");
  for (const c of g.checks.filter((k) => k.id.startsWith("haul-") || k.id.startsWith("ship-"))) text(`${verdict(c)} —${c.name}: ${fmt(c.demand)} / ${fmt(c.capacity)}${c.unit ? ` ${c.unit}` : ""}${c.note ? ` (${c.note})` : ""}`, "note");
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Number(v.toFixed(3)).toString());

function stirrupZone(i: GirderInputs, x: number) {
  const fromEnd = Math.min(x, i.L - x);
  let acc = 0;
  for (let k = 0; k < i.stirrups.length; k++) {
    const z = i.stirrups[k];
    if (k === i.stirrups.length - 1 || fromEnd <= acc + z.length) return z;
    acc += z.length;
  }
  return i.stirrups[i.stirrups.length - 1];
}

/** The per-lane truck and tandem moments at midspan (the engine keeps them with the DF applied). */
function liveAt(g: GirderResult) {
  const mid = g.stations[g.stations.length - 1];
  return liveLoad(mid.x * 2, mid.x);
}
