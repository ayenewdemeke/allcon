import type { Line } from "@/lib/calcs/library/templates";
import { cell, COLOR_NOTE, INPUT_COLOR, isInput, num } from "../calc-style";
import type { Figure } from "../figures";
import { brrInputSheet, compareBrrDf } from "./brr";
import { CHECK_LABEL, isSidewalkTruckCase, rateDoubleTee, tensionIgnored, type DtInputs } from "./double-tee";
import { checkStandard, DT_STANDARD_FC, DT_STANDARD_NAME, DT_STANDARD_SLAB } from "./dt-standard";

const ftInText = (inches: number) => {
  const ft = Math.floor(inches / 12 + 1e-9);
  return `${ft}'-${+(inches - ft * 12).toFixed(3)}"`;
};

// The double-tee load rating as a Calcs worksheet, in the order of CDOT's supplemental calcs:
// materials, the prestressing steel, stress limits, dead loads, distribution, live load, the ratings
// and posting, then the items for review and the BrR input sheet. The moving-load moments and the
// section properties come from ALLCON's analysis as given values; every step from them is live math.

const kft = "\\mathrm{kip}\\cdot\\mathrm{ft}";
const ok = (demand: string, capacity: string) => `\\operatorname{if}\\left(${demand}\\le ${capacity},\\text{OK},\\text{NG}\\right)=`;
/** A vehicle's subscript in the worksheet. */
const VCODE: Record<string, string> = {
  "HS-20": "HS",
  "CO Type 3": "T3",
  "CO Type 3S2": "T3S2",
  "CO Type 3-2": "T32",
  SU4: "SU4",
  SU5: "SU5",
  "CO SU6": "SU6",
  "CO SU7": "SU7",
  NRL: "NRL",
  EV2: "EV2",
  EV3: "EV3",
  "CO Permit": "PMT",
  "CO Mod Tandem": "MT",
};

/** Notes are plain text: a small number written in powers of ten for the math (6.52·10⁻²) is written out (0.065). */
const plain = (s: string) => s.replace(/(-?\d+(?:\.\d+)?)\\cdot10\^\{(-?\d+)\}/g, (_, m: string, e: string) => cell(+m * 10 ** +e));

/** A check as it reads in a sentence. */
const checkName = (c: keyof typeof CHECK_LABEL) => (c === "flexure" ? "strength flexure" : c === "shear" ? "strength shear" : CHECK_LABEL[c].charAt(0).toLowerCase() + CHECK_LABEL[c].slice(1));

const andList =(xs: (string | false | 0)[]) => {
  const w = xs.filter((x): x is string => !!x);
  return w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}` : (w[0] ?? "");
};

/** Why the final tension is 1.0 ksi when the prestress is back-calculated. */
const TENSION_NOTE = "Final tension: 1.0 ksi. The code limit, 6√f′c (SSHB 9.15.2.2), is set aside so that strength flexure controls the back-calculated prestress (BRM 1.7.2)";

/** The package's opening note: the purpose, the method and how the inputs were found, for this bridge. */
function methodNote(i: DtInputs, r: ReturnType<typeof rateDoubleTee>, text: (t: string, style?: "heading" | "subheading" | "note") => void) {
  const back = r.solve.mode === "back-calculate";
  const kinds = new Set(Object.values(i.sources ?? {}).map((s) => s.kind));
  const records = [kinds.has("sia") && "the Structure Inventory and Appraisal (SIA) report", (kinds.has("sketch") || i.sketch) && "the bridge inspection sketch"].filter(Boolean) as string[];
  // The walkways (pedestrians; mountable or not) and the curbs (dead load only).
  const sw = i.loads.sidewalks.filter((s) => !s.curb);
  const curbs = i.loads.sidewalks.filter((s) => s.curb);
  const tension = i.options.tensionLimit;

  text("Approach and method", "subheading");
  text("Purpose:- The load rating of record for this bridge is the AASHTOWare BrR rating. These calculations support it. They:");
  text("• document where each BrR input comes from;");
  if (back) text("• back-calculate the prestress, which is not known;");
  else if (i.prestress.mode === "known" && i.prestress.harp) text("• take the prestress from the standard plans the bridge was built to;");
  text("• check the live load distribution factors; and");
  text("• rate each vehicle by hand, to confirm the BrR ratings and the posting recommendation.");
  text(
    `Method:- The bridge is rated by Load Factor Rating (LFR), following the AASHTO Standard Specifications for Highway Bridges, 17th Edition (SSHB); the AASHTO Manual for Bridge Evaluation (MBE), Section 6, Part B; and the CDOT Bridge Rating Manual (BRM). HS-20 is rated at the inventory and operating levels, and the Colorado legal and permit vehicles at the operating level.`,
  );
  text(
    `The rating factor is RF = (C − A₁D) / (A₂L(1 + I)), where A₁ = 1.3, and A₂ = 2.17 at inventory or 1.3 at operating. The impact factor is I = 50/(L + 125) ≤ 0.30 (SSHB 3.8.2.1), which gives I = ${num(r.impact)} for this span. Each vehicle is moved across the span in both directions, and every girder is rated at each point of interest (MBE 6B.4.1).`,
  );
  if (back)
    text(
      `No plans:- There are no design plans or shop drawings for this bridge. The geometry (${andList(["span", "number and spacing of units", "flange and stem dimensions", i.deck.present && "deck", "asphalt", curbs.length > 0 && "curbs", sw.length > 0 && "sidewalks", "railings", "diaphragms"])}) comes from ${records.length ? records.join(" and ") : "the field records"}. The material properties are those the BRM gives for a bridge built in ${i.bridge.yearBuilt}. Because the prestress is not known, it is back-calculated per BRM 1.7.2(A): it is set so that every girder's HS-20 inventory rating factor for strength flexure is at least 1.0${i.options.roundStrands ? ", then rounded up to whole strands" : ""}, under the dead loads used in the rating${i.options.solveWithOverlay ? "" : " (without the asphalt while solving)"}. This assumes the girders were designed for HS-20.${
        sw.length && i.loads.sidewalkMountable ? " The prestress is set with trucks between the curbs, the cases the original design would have used; trucks on the mountable sidewalk are then rated with that prestress, not used to set it." : ""
      } The service checks then use this prestress. ${checkStandard(i).summary.replace(/ \(standard: /g, " (the standard's: ")}`,
    );
  const harp = i.prestress.mode === "known" ? i.prestress.harp : null;
  const std = harp ? checkStandard(i) : null;
  if (harp && std?.row) {
    const row = std.row;
    text(
      `Standard plans:- There are no as-built plans for this bridge, but it was built in ${i.bridge.yearBuilt} and matches the ${DT_STANDARD_NAME}, Dwg. B-3, for a ${row.span} ft span ${ftInText(row.width * 12)} wide: ${row.units} units ${ftInText(row.unitWidth)} wide, stems ${ftInText(row.S)} apart, ${row.D} in deep with a ${DT_STANDARD_SLAB} in integral top slab. The geometry comes from ${records.length ? records.join(" and ") : "the field records"}, and the prestress from the standard: ${num(r.solve.nStrands, 0)} strands of 1/2 in, 270 ksi stress-relieved strand per unit, jacked to Fi = ${row.Fi} kip (${row.ri} f′s A*s) and ${row.Ff} kip after losses, harped at 0.4 span with the strand centroid ${row.EE} in above the bottom at the ends and ${row.EMS} in at midspan (Dwg. B-7); f′c ${DT_STANDARD_FC * 1000} psi and f′ci ${row.fci} psi.`,
    );
  }
  text(
    `Checks:- The girders are rated for flexural strength (SSHB 9.17) and for concrete stresses at service (SSHB 9.15.2.2, MBE 6B.5.3.3): ${tensionIgnored(i) ? "" : "tension at the bottom of the girder, and "}compression in the girder${i.deck.present ? " and the deck" : ""}. ${
      tensionIgnored(i)
        ? "The final tension in the girder is not rated. The prestress is back-calculated for strength (BRM 1.7.2), so a tension check on it would only test the assumed prestress, not the bridge: the final tension limit is ignored, and strength flexure governs the ratings."
        : tension === 1 && back
        ? "The final tension limit is 1.0 ksi. The code limit, 6√f′c (SSHB 9.15.2.2), is set aside so that strength flexure controls the back-calculated prestress (BRM 1.7.2)."
        : tension === null
          ? "The final tension limit is 6√f′c (SSHB 9.15.2.2)."
          : `The final tension limit is ${num(tension)} ksi.`
    } ${i.options.checkShear ? "Shear is rated (SSHB 9.20)." : "Shear is not rated (BRM 1.4(O))."}`,
  );
  text(
    `Loads:- The dead loads are ${andList(["the self-weight", i.deck.present && "the deck", "asphalt", curbs.length > 0 && "curbs", sw.length > 0 && "sidewalks", "railings", i.loads.diaphragmKip && "diaphragms"])}. The live load on each girder uses the distribution factors calculated in section 6 (SSHB 3.23). ${
      sw.length
        ? i.loads.sidewalkMountable
          ? `Because the sidewalk is mountable, two cases are rated and the lower rating governs: trucks between the curbs${i.loads.pedestrians ? ", with pedestrian load on the sidewalk (SSHB 3.14.1.1)" : ""}; and trucks on the sidewalk, without pedestrians.`
          : `Trucks stay between the curbs${i.loads.pedestrians ? ", with pedestrian load on the sidewalk (SSHB 3.14.1.1)" : ""}.`
        : curbs.length
          ? "There is no sidewalk. The curbs carry no pedestrians and can't be mounted, so trucks stay between the curb faces."
          : "There is no sidewalk."
    }`,
  );
  text(
    `Results:- The rating summary lists the governing rating factor for each vehicle, and posting follows BRM 1.15.1.${i.brrResults.trim() ? " The BrR ratings and distribution factors are then compared with these calculations; they are taken to agree when they are within 5% of each other." : ""}`,
  );
}

export function dtRatingCalcLines(i: DtInputs, title: string, figures?: { section?: Figure; summary?: Figure; comparison?: Figure }): Line[] {
  const lines: Line[] = [];
  const text = (t: string, style?: "heading" | "subheading" | "note", newPage?: boolean) => lines.push({ text: plain(t), ...(style ? { style } : {}), ...(newPage ? { newPage } : {}) });
  const m = (math: string, ref?: string, unit?: string) =>
    lines.push({
      math,
      ...(ref ? { ref: plain(ref) } : {}),
      ...(unit ? { unit } : {}),
      ...(math.length > 110 && ref ? { wide: true } : {}),
      ...(isInput(math) ? { color: INPUT_COLOR } : {}),
    });
  const given = (math: string, ref?: string) => lines.push({ math, ...(ref ? { ref: plain(ref) } : {}) });
  const r = rateDoubleTee(i);
  const s = r.solve;
  const mt = i.materials;
  const deck = i.deck.present ? i.deck : null;
  const back = s.mode === "back-calculate";
  const hs = r.ratings.find((x) => x.cls === "design")!;
  // The worked girder: the one governing HS-20 inventory in flexure, at its point.
  const hsFlex = hs.per.reduce((a, c) => (c.flexInv.inv < a.flexInv.inv ? c : a));
  const g = r.girders.find((x) => x.name === hsFlex.g)!;
  const x = hsFlex.flexInv.x;
  const L = i.span;
  const sw = i.loads.sidewalks.filter((s) => !s.curb); // walkways, not curbs

  text(title.toUpperCase(), "heading");
  text(
    `Load rating of ${i.bridge.id || "the bridge"}${i.bridge.facility ? `, ${i.bridge.facility}` : ""}${i.bridge.feature ? ` over ${i.bridge.feature}` : ""}. The superstructure is ${i.numSpans > 1 ? `${i.numSpans} simple spans` : "a simple span"} of ${num(L, 3)} ft, made of ${i.units.count} adjacent precast prestressed double-tee units${deck ? ` with a ${num(deck.thk)} in composite deck` : ""}${i.skew ? `, on a ${num(i.skew)}° skew` : ""}. Every girder is rated at ${r.pois.length - 2} points along the span.`,
  );
  methodNote(i, r, text);
  if (figures?.section) lines.push({ region: figures.section });
  text(COLOR_NOTE, "note");
  text(`The section properties, moving-load moments and distribution factors come from the structural analysis. Sections 1 to 8 show them for ${g.name}, the girder that governs the HS-20 inventory rating in flexure, at x = ${num(x, 2)} ft.`, "note");

  // 1. Materials
  // The calculations, the BrR input sheet and the appendix each start a page.
  text("1. Materials", "subheading", true);
  m(`f'_{c}\\coloneq ${num(mt.fc)}\\mathrm{ksi}`, "Girder concrete");
  m("E_c\\coloneq33000\\cdot0.145^{1.5}\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}=", "Girder modulus, with 145 pcf (SSHB 8.7.1)", "ksi");
  if (deck) {
    m(`f'_{cd}\\coloneq ${num(deck.fc)}\\mathrm{ksi}`, "Deck concrete");
    m("n_d\\coloneq\\sqrt{\\frac{f'_{cd}}{f'_{c}}}=", "Modular ratio of the deck to the girder");
  }
  m(`f'_{s}\\coloneq ${num(mt.fpu)}\\mathrm{ksi}`, mt.strand);
  m(`a_{ps}\\coloneq ${num(mt.aps)}\\mathrm{in}^{2}`, "Area of one strand");
  m(`R_j\\coloneq ${num(mt.jackingRatio)}`, "Jacking stress ratio");
  m("f_{pj}\\coloneq R_j\\cdot f'_{s}=", "Jacking stress", "ksi");
  m(`\\Delta_{fs}\\coloneq ${num(i.options.lossLumpSum)}\\mathrm{ksi}`, "Losses, lump sum (SSHB 9.16.2.2)");
  m("f_{se}\\coloneq f_{pj}-\\Delta_{fs}=", "Effective prestress", "ksi");
  m(`f_{ys}\\coloneq${mt.lowRelaxation ? "0.90" : "0.85"}\\cdot f'_{s}=`, mt.lowRelaxation ? "Strand yield stress, low relaxation" : "Strand yield stress, stress-relieved", "ksi");
  m("E_p\\coloneq28500\\mathrm{ksi}", "Strand modulus, AASHTO LRFD 5.4.4.2 (SSHB 9.16.2.1.2: 28,000 ksi)");

  // 2. Section and prestressing steel
  text(`2. ${g.name}: section and prestressing steel`, "subheading");
  given(`A_g\\coloneq ${num(g.sec.A, 9)}\\mathrm{in}^{2}`, "Area of the precast section");
  given(`y_b\\coloneq ${num(g.sec.yb, 9)}\\mathrm{in}`, "Centroid above the bottom");
  given(`I_g\\coloneq ${num(g.sec.I, 6)}\\mathrm{in}^{4}`, "Moment of inertia");
  m("S_b\\coloneq\\frac{I_g}{y_b}=", "Section modulus, bottom", "in^3");
  m(`S_t\\coloneq\\frac{I_g}{${num(i.units.depth)}\\mathrm{in}-y_b}=`, "Section modulus, top", "in^3");
  if (g.csec) {
    given(`y_{bc}\\coloneq ${num(g.csec.yb, 9)}\\mathrm{in}`, "Composite centroid above the bottom, with the deck transformed by n_d");
    given(`I_c\\coloneq ${num(g.csec.I, 6)}\\mathrm{in}^{4}`, "Composite moment of inertia");
    m("S_{bc}\\coloneq\\frac{I_c}{y_{bc}}=", "Composite section modulus, bottom", "in^3");
    m(`S_{tc}\\coloneq\\frac{I_c}{${num(i.units.depth)}\\mathrm{in}-y_{bc}}=`, "Composite section modulus, top of the girder", "in^3");
  }
  if (back)
    m(
      `N_s\\coloneq ${num(s.nStrands, 9)}`,
      `Strands per unit, back-calculated${i.options.roundStrands ? ` and rounded up to a whole strand (${num(s.nExact, 3)} exactly); the jacking force is rounded down to the nearest kip` : ", unrounded"}${s.crackGoverns ? ". The cracking moment governs (BRM 1.7.2)" : ""}`,
    );
  else m(`N_s\\coloneq ${num(s.nStrands, 9)}`, i.prestress.harp ? "Strands per unit, from the standard plans (Dwg. B-3)" : "Strands per unit");
  m("A_{ps}\\coloneq N_s\\cdot a_{ps}=", "Prestressing steel", "in^2");
  const hp = !back && i.prestress.harp ? i.prestress.harp : null;
  if (hp) {
    const rr = Math.min(x, L - x) / (hp.at * L);
    const cgx = rr >= 1 ? hp.mid : hp.end + (hp.mid - hp.end) * rr;
    m(`y_{ps}\\coloneq ${num(cgx, 9)}\\mathrm{in}`, `Strand centroid above the bottom at x = ${num(x, 2)} ft: harped from ${num(hp.end)} in at the ends to ${num(hp.mid)} in from 0.4 span (standard plans, Dwg. B-7)`);
  } else m(`y_{ps}\\coloneq ${num(s.cg, 9)}\\mathrm{in}`, `Strand centroid above the bottom (assumed): rows of ${mt.strandsPerRowPerStem * 2} strands, the first at ${num(mt.firstRow)} in, then every ${num(mt.rowSpacing)} in`);
  m(
    back && i.options.roundStrands ? "P_j\\coloneq\\operatorname{floor}\\left(\\frac{f_{pj}\\cdot A_{ps}}{\\mathrm{kip}}\\right)\\cdot\\mathrm{kip}=" : "P_j\\coloneq f_{pj}\\cdot A_{ps}=",
    "Jacking force (BRM 1.7.2)",
    "kip",
  );
  m("P_e\\coloneq f_{se}\\cdot A_{ps}=", "Effective force", "kip");
  m("e\\coloneq y_b-y_{ps}=", "Eccentricity", "in");

  // 3. Flexural strength
  text("3. Flexural strength (SSHB 9.17)", "subheading");
  const cap = s.cap;
  const hf = i.units.flangeThk + (deck ? deck.thk : 0);
  m(`d\\coloneq ${num(i.units.depth + (deck ? deck.thk : 0))}\\mathrm{in}-y_{ps}=`, "Depth to the strands", "in");
  m(`b\\coloneq ${num(g.sec.bf, 9)}\\mathrm{in}`, "Flange width");
  m(`h_f\\coloneq ${num(hf)}\\mathrm{in}`, deck ? "Flange and deck" : "Flange");
  m(`f'_{cf}\\coloneq ${num(deck ? deck.fc : mt.fc)}\\mathrm{ksi}`, deck ? "Concrete of the compression flange (deck)" : "Concrete of the compression flange");
  m("\\beta_1\\coloneq\\max\\left(0.65,\\min\\left(0.85,0.85-0.05\\cdot\\left(\\frac{f'_{cf}}{\\mathrm{ksi}}-4\\right)\\right)\\right)=", "SSHB 8.16.2.7");
  m(`\\gamma_{p}\\coloneq ${num(mt.gammaStar)}`, "SSHB 9.17.4");
  m("\\rho_{p}\\coloneq\\frac{A_{ps}}{b\\cdot d}=");
  m("f_{su}\\coloneq f'_{s}\\cdot\\left(1-\\frac{\\gamma_{p}}{\\beta_1}\\cdot\\frac{\\rho_{p}\\cdot f'_{s}}{f'_{cf}}\\right)=", "SSHB Eq. 9-17", "ksi");
  m("a_{c}\\coloneq\\frac{1.4\\cdot d\\cdot\\rho_{p}\\cdot f_{su}}{f'_{cf}}=", "Depth of the stress block", "in");
  m(ok("a_{c}", "h_f"), "Rectangular section behavior (SSHB 9.17.2)");
  const flexMid = r.midspan[0].per.find((p) => p.g === g.name)!;
  const Mnx = hsFlex.flexInv.C;
  const developed = Math.abs(Mnx - flexMid.C) < 1e-6 * Math.max(1, flexMid.C);
  if (cap.type === "rectangular" && !cap.overReinforced)
    m("M_n\\coloneq A_{ps}\\cdot f_{su}\\cdot d\\cdot\\left(1-0.6\\cdot\\frac{\\rho_{p}\\cdot f_{su}}{f'_{cf}}\\right)=", "SSHB Eq. 9-13; φ = 1.0 for prestressed concrete", "kip*ft");
  else given(`M_n\\coloneq ${num(flexMid.C, 9)}${kft}`, cap.overReinforced ? "Limited to the maximum steel (SSHB 9.18.1)" : "Flanged section, SSHB Eq. 9-14");
  if (!developed) given(`M_{nx}\\coloneq ${num(Mnx, 9)}${kft}`, `The strands are not fully developed at x = ${num(x, 2)} ft, so f*su is reduced (SSHB 9.28)`);
  else m("M_{nx}\\coloneq M_n=", `The strands are fully developed at x = ${num(x, 2)} ft`, "kip*ft");

  // 4. Stress limits
  text("4. Stress limits (MBE 6B.5.3.3)", "subheading");
  if (tensionIgnored(i)) text("Final tension in the girder: not rated. The prestress is back-calculated for strength (BRM 1.7.2), so the final tension limit is ignored.", "note");
  else if (i.options.tensionLimit === null) m("f_t\\coloneq\\frac{6}{1000}\\cdot\\sqrt{1000\\cdot\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}=", "Final tension, 6√f′c psi (SSHB 9.15.2.2)", "ksi");
  else m(`f_t\\coloneq ${num(i.options.tensionLimit)}\\mathrm{ksi}`, i.options.tensionLimit === 1 && back ? TENSION_NOTE : "Final tension, as entered (SSHB 9.15.2.2)");
  m("f_{c1}\\coloneq0.6\\cdot f'_{c}=", "Compression under all loads", "ksi");
  m("f_{c2}\\coloneq0.4\\cdot f'_{c}=", "Compression under live load plus half the prestress and dead load", "ksi");
  if (deck) m("f_{cd}\\coloneq0.4\\cdot f'_{cd}=", "Deck compression (SSHB 9.15.2.2)", "ksi");
  m("f_{s,inv}\\coloneq0.8\\cdot f_{ys}=", "Strand stress, inventory", "ksi");
  m("f_{s,opr}\\coloneq0.9\\cdot f_{ys}=", "Strand stress, operating", "ksi");

  // 5. Dead loads
  text(`5. Dead loads on ${g.name}`, "subheading");
  m(`L\\coloneq ${num(L, 9)}\\mathrm{ft}`, "Span, bearing to bearing");
  m(`x\\coloneq ${num(x, 9)}\\mathrm{ft}`, "Point rated, from the left bearing");
  const dl = g.dlNow;
  given(
    `w_{DC1}\\coloneq ${num(dl.dc1, 10)}\\frac{\\mathrm{kip}}{\\mathrm{ft}}`,
    deck
      ? `Self-weight of the unit (${num(dl.self)} klf at ${num(i.loads.concPcf)} pcf) plus the deck it carries (${num(dl.deck)} klf), carried by the precast section`
      : `Self-weight of the unit, at ${num(i.loads.concPcf)} pcf`,
  );
  given(
    `w_{DC2}\\coloneq ${num(dl.dc2, 10)}\\frac{\\mathrm{kip}}{\\mathrm{ft}}`,
    `Asphalt ${num(dl.asphalt)} klf, rail ${num(dl.rail)} klf, utilities ${num(dl.util)} klf${dl.sidewalk ? `, ${i.loads.sidewalks.every((s) => s.curb) ? "curbs" : i.loads.sidewalks.some((s) => s.curb) ? "sidewalks and curbs" : "sidewalks"} ${num(dl.sidewalk)} klf` : ""}${deck ? "; shared equally by all girders and carried by the composite section" : "; carried by the unit beneath them"}`,
  );
  m(`P_{dia}\\coloneq ${num(dl.diaph)}\\mathrm{kip}`, "Diaphragm load at midspan");
  m("M_{D1}\\coloneq\\frac{w_{DC1}\\cdot x\\cdot\\left(L-x\\right)}{2}+\\frac{P_{dia}\\cdot\\min\\left(x,L-x\\right)}{2}=", undefined, "kip*ft");
  m("M_{D2}\\coloneq\\frac{w_{DC2}\\cdot x\\cdot\\left(L-x\\right)}{2}=", undefined, "kip*ft");
  m("M_D\\coloneq M_{D1}+M_{D2}=", "Dead load moment", "kip*ft");
  if (g.pedKlf > 0) {
    given(`w_{ped}\\coloneq ${num(g.pedKlf, 10)}\\frac{\\mathrm{kip}}{\\mathrm{ft}}`, `Pedestrian load: ${num(r.ped.pedPsf)} psf on ${num(r.ped.pedWidth, 2)} ft of sidewalk, shared by ${i.units.count} units (SSHB 3.14.1.1)`);
    m("M_{ped}\\coloneq\\frac{w_{ped}\\cdot x\\cdot\\left(L-x\\right)}{2}=", undefined, "kip*ft");
  } else m(`M_{ped}\\coloneq0${kft}`, sw.length ? (i.loads.pedestrians ? "No pedestrian load in this case (trucks on the sidewalk)" : "No pedestrian load") : "No sidewalk");

  // 6. Distribution factors
  text("6. Live load distribution (SSHB 3.23)", "subheading");
  if (i.options.dfOverride) given(`DF_{m}\\coloneq ${num(g.dfMulti, 10)}`, "Two or more lanes, as entered");
  else if (!g.ext && i.options.lldfInterior === "table") {
    m(`S\\coloneq ${num(g.S, 10)}\\mathrm{ft}`, "Girder spacing");
    m("DF_{m}\\coloneq\\frac{S}{5.5\\mathrm{ft}}=", "Interior, two or more lanes (SSHB Table 3.23.1)");
    m("DF_{s}\\coloneq\\frac{S}{7.0\\mathrm{ft}}=", "Interior, one lane");
  } else {
    given(
      `DF_{m}\\coloneq ${num(g.dfMulti, 10)}`,
      g.ext ? `Exterior, by the lever rule, with the wheel 2 ft from the ${g.caseName.startsWith("trucks on") ? "rail" : r.ped.sidewalks.length ? "curb" : "rail"} face` : "Interior, multi-beam S/D (SSHB 3.23.4.3)",
    );
    given(`DF_{s}\\coloneq ${num(g.dfSingle, 10)}`, "One lane");
  }
  if (i.options.dfOverride) given(`DF_{s}\\coloneq ${num(g.dfSingle, 10)}`, "One lane, as entered");
  const dfRows = compareBrrDf(i, r);
  if (dfRows.length) {
    text("The factors above are compared with those from AASHTOWare BrR. Where the two agree within 5%, the BrR factors are used.", "note");
    for (const d of dfRows) {
      const k = {
        intSingle: "is",
        intMulti: "im",
        extSingle: "es",
        extMulti: "em",
      }[d.key];
      given(`DF_{B,${k}}\\coloneq ${num(d.brr, 6)}`, `${d.label}, from BrR (this calculation: ${num(d.ours)})`);
      m(ok(`\\left|\\frac{DF_{B,${k}}-${num(d.ours, 10)}}{${num(d.ours, 10)}}\\right|`, "0.05"), `${d.label}: BrR differs by ${(d.diff * 100).toFixed(2)}%`);
    }
  }
  m("I_m\\coloneq\\min\\left(\\frac{50}{\\frac{L}{\\mathrm{ft}}+125},0.30\\right)=", "Impact (SSHB 3.8.2.1)");

  // 7. HS-20 and the prestress
  text("7. HS-20 inventory and the prestress", "subheading");
  const llHS = hsFlex.flexInv.LL / (hsFlex.df * (1 + r.impact));
  given(`M_{w,HS}\\coloneq ${num(llHS, 9)}${kft}`, `HS-20 moment per wheel line at x, from the truck or the lane load, whichever is greater (SSHB 3.7)`);
  m("M_{L,HS}\\coloneq M_{w,HS}\\cdot DF_{m}\\cdot\\left(1+I_m\\right)=", undefined, "kip*ft");
  m("RF_{inv,HS}\\coloneq\\frac{M_{nx}-1.3\\cdot M_D-2.17\\cdot M_{ped}}{2.17\\cdot M_{L,HS}}=", "Inventory: A1 = 1.3, A2 = 2.17 (MBE Eq. 6B.4.1-1)");
  m("RF_{opr,HS}\\coloneq\\frac{M_{nx}-1.3\\cdot M_D-1.3\\cdot M_{ped}}{1.3\\cdot M_{L,HS}}=", "Operating: A2 = 1.3");
  if (back) {
    const sidewalkCase = isSidewalkTruckCase(g.name);
    if (i.options.solveWithOverlay && !sidewalkCase) m(ok("1", "RF_{inv,HS}"), "HS-20 inventory rating of at least 1.0 with whole strands (BRM 1.7.2(A))");
    text(
      `This is the fewest whole strands that gives every girder, with trucks between the curbs, an inventory rating of at least 1.0 in flexure at every point. With one strand fewer, ${s.gov} would rate below 1.0.${
        sidewalkCase ? ` The case worked here, ${g.name}, is not used to set the prestress: it is rated with it, so its rating may fall below 1.0.` : ""
      }`,
    );
    // BRM 1.7.2: the steel for the greater of the factored moment and the cracking moment, girder by girder.
    const cr = r.crack.find((c) => c.g === g.name)!;
    m("f_r\\coloneq0.24\\cdot\\sqrt{\\frac{f'_{c}}{\\mathrm{ksi}}}\\cdot\\mathrm{ksi}=", "Modulus of rupture, AASHTO LRFD 5.4.2.6 (SSHB 9.15.2.3: 7.5√f′c psi)", "ksi");
    m(`M_{cr}\\coloneq f_r\\cdot ${g.csec ? "S_{bc}" : "S_b"}=`, `Cracking moment of ${g.name}, ${g.csec ? "composite" : "precast"} section`, "kip*ft");
    given(`M_u\\coloneq ${num(cr.MuReq, 6)}${kft}`, `Factored moment of ${g.name} at midspan, 1.3·MD + 2.17·(ML(1 + I) + Mped), using the largest HS-20 moment`);
    m(
      ok("M_{cr}", "M_u"),
      s.crackGoverns ? "On at least one girder the cracking moment governs and sets the prestressing steel (BRM 1.7.2)" : "The factored moment exceeds the cracking moment on every girder, so it governs (BRM 1.7.2)",
    );
  }

  // 8. Service at the same point
  text(`8. HS-20 service limits for ${g.name} at x`, "subheading");
  const P_at = Math.min(1, (Math.min(x, L - x) + r.ext) / r.lt);
  if (P_at < 1) m(`P_x\\coloneq ${num(P_at, 10)}\\cdot P_e=`, "Prestress reduced within the transfer length of 50 strand diameters (SSHB 9.20.2.4)", "kip");
  else m("P_x\\coloneq P_e=", "Full prestress: x is beyond the transfer length", "kip");
  const Sb2 = g.csec ? "S_{bc}" : "S_b";
  const St2 = g.csec ? "S_{tc}" : "S_t";
  m(`f_{bD}\\coloneq-\\frac{P_x}{A_g}-\\frac{P_x\\cdot e}{S_b}+\\frac{M_{D1}}{S_b}+\\frac{M_{D2}+M_{ped}}{${Sb2}}=`, "Bottom stress from prestress and dead load (tension positive)", "ksi");
  m(`f_{bL}\\coloneq\\frac{M_{L,HS}}{${Sb2}}=`, "Bottom stress from live load", "ksi");
  if (!tensionIgnored(i)) m("RF_{t,HS}\\coloneq\\frac{f_t-f_{bD}}{f_{bL}}=", "Concrete tension, inventory");
  m(`f_{tD}\\coloneq\\frac{P_x}{A_g}-\\frac{P_x\\cdot e}{S_t}+\\frac{M_{D1}}{S_t}+\\frac{M_{D2}+M_{ped}}{${St2}}=`, "Top stress from prestress and dead load (compression positive)", "ksi");
  m(`f_{tL}\\coloneq\\frac{M_{L,HS}}{${St2}}=`, "Top stress from live load", "ksi");
  m("RF_{c1,HS}\\coloneq\\frac{f_{c1}-f_{tD}}{f_{tL}}=", "Concrete compression under all loads, inventory");
  m("RF_{c2,HS}\\coloneq\\frac{f_{c2}-0.5\\cdot f_{tD}}{f_{tL}}=", "Concrete compression under live load plus half the prestress and dead load, inventory");
  text(
    `Over all girders, points and checks, the lowest HS-20 inventory rating is ${num(hs.govInv.inv.inv, 3)}, for ${checkName(hs.govInv.inv.check)} on ${hs.govInv.g} at ${num(hs.govInv.inv.x, 2)} ft. The strand stress and the deck stress are checked the same way at every point.`,
  );

  // 9. Ratings
  text("9. Ratings: CDOT vehicles", "subheading");
  text(
    `Each vehicle is moved across the span in both directions. The legal and permit vehicles use the ${i.options.legalLldf}-lane distribution factor. The governing ratings are listed below; the full working for each vehicle's operating rating for flexure is in Appendix A.`,
  );
  const vehicleWorking = () => {
    for (const v of r.ratings) {
      if (v.cls === "design") continue;
      const c = VCODE[v.name] ?? v.name.replace(/[^A-Za-z0-9]/g, "");
      const p = v.per.reduce((a, b) => (b.flexOpr.opr! < a.flexOpr.opr! ? b : a));
      const fp = p.flexOpr;
      const gg = r.girders.find((q) => q.name === p.g)!;
      const Mw = fp.LL / (p.df * (1 + r.impact));
      const Mped = (gg.pedKlf * fp.x * (L - fp.x)) / 2;
      given(
        `M_{w,${c}}\\coloneq ${num(Mw, 9)}${kft}`,
        `${v.name} (${num(v.tons, 2)} T): moment per wheel line on ${p.g} at x = ${num(fp.x, 2)} ft. DF = ${num(p.df)}, MD = ${num(fp.Dl, 2)} kip·ft, Mn = ${num(fp.C, 2)} kip·ft${Mped ? `, Mped = ${num(Mped, 2)} kip·ft` : ""}`,
      );
      m(
        `RF_{opr,${c}}\\coloneq\\frac{${num(fp.C, 9)}${kft}-1.3\\cdot ${num(fp.Dl, 9)}${kft}-1.3\\cdot ${num(Mped, 9)}${kft}}{1.3\\cdot M_{w,${c}}\\cdot ${num(p.df, 10)}\\cdot\\left(1+I_m\\right)}=`,
        "Operating rating factor, flexure",
      );
      m(`W_{${c}}\\coloneq RF_{opr,${c}}\\cdot ${num(v.tons, 4)}=`, "Operating rating, tons");
    }
  };

  text("Governing ratings (all girders, points and checks)", "subheading");
  for (const v of r.ratings)
    text(
      `${v.name}: inventory RF ${num(v.govInv.inv.inv, 3)} (${num(v.invTons, 1)} T), ${checkName(v.govInv.inv.check)} on ${v.govInv.g} at ${num(v.govInv.inv.x, 2)} ft; operating RF ${num(v.govOpr.opr.opr, 3)} (${num(v.oprTons, 1)} T), ${checkName(v.govOpr.opr.check)} on ${v.govOpr.g} at ${num(v.govOpr.opr.x, 2)} ft.${v.posting !== "—" ? ` ${v.posting}.` : ""}`,
    );

  // 10. Posting
  text("10. Posting (BRM 1.15.1)", "subheading");
  const posted = r.ratings.filter((v) => v.posting === "Posting required");
  text(
    `Legal and specialized hauling vehicles are posted when their operating rating factor is below 0.95. Between 0.95 and 1.0 they are not posted (the 95% rule). Emergency vehicles are posted only when the bridge is within 1 mile of an Interstate; this bridge ${i.bridge.nearInterstate ? "is" : "is not"}.`,
  );
  text(posted.length ? `Posting is required for: ${posted.map((v) => `${v.name}, ${num(v.oprTons, 1)} T`).join("; ")}.` : "No posting is required.");
  if (figures?.summary) lines.push({ region: figures.summary });
  if (figures?.comparison) {
    // The heading and its note stay on the table's page.
    lines.push({ text: "Comparison with AASHTOWare BrR", style: "subheading", keepWithNext: true });
    lines.push({
      text: "The table compares the BrR ratings with these calculations for each vehicle, level and girder. Where BrR gives two sidewalk runs, or both an axle and a lane rating for HS-20, the lower is used. The distribution factors are compared the same way. The two are taken to agree when they are within 5% of each other.",
      keepWithNext: true,
    });
    lines.push({ region: figures.comparison });
  }

  // 11. Review
  const items = i.review.items.filter((t) => t.trim());
  if (items.length || i.review.assumption.trim()) {
    text("11. Items for review", "subheading");
    if (i.review.assumption.trim()) text(i.review.assumption.trim());
    for (const t of items) text(`• ${t.trim()}`);
  }

  // 12. BrR input sheet
  text(`${items.length || i.review.assumption.trim() ? "12" : "11"}. BrR input sheet`, "subheading", true);
  for (const grp of brrInputSheet(i, r)) {
    text(grp.title, "note");
    for (const [k, v, n] of grp.rows) text(`${k}: ${v}${n ? ` (${n})` : ""}`);
  }

  // Appendix A: the legal and permit vehicles worked by hand (BrR's ratings are the ones of record).
  text("Appendix A. Legal and permit vehicles: operating ratings for flexure", "subheading", true);
  text("For each vehicle, the operating rating for flexure is worked out at the girder and point where it governs. These results confirm the BrR ratings and the governing ratings in section 9.");
  vehicleWorking();
  return lines;
}
