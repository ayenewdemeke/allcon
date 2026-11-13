import { DesignError } from "../walls/cip";
import { CDOT_VEHICLES, laneAt, tons, trainAt, trainMax, type Vehicle, type VehicleClass } from "./vehicles";

// Load Factor Rating of a simple-span bridge of adjacent precast, prestressed double-tee units, as
// AASHTOWare BrR rates one: the AASHTO Standard Specifications (17th ed., "SSHB") and the MBE's
// Section 6B, with CDOT's Bridge Rating Manual (BRM). Each vehicle is moved along the span and every
// girder is rated at every point of interest for strength (flexure, and shear when it isn't waived)
// and, for prestressed concrete, service (concrete stresses and strand stress), inventory and
// operating. Without plans the prestress is back-calculated so the design vehicle (HS-20) rates
// exactly 1.0 at inventory in flexure (BRM 1.7.2(A)); the girder is then modeled in BrR by that force
// at an assumed strand centroid.
//
// Units: ft for lengths along the span, in for section dimensions, kip, ksi, kip·ft.

// --- inputs ----------------------------------------------------------------------------------------

export type DtUnitLayout = { flangeWidth: number; stemSpacing: number };
export type DtInputs = {
  bridge: { id: string; facility: string; feature: string; owner: string; yearBuilt: number; nbiSuper: number; loadInducedDistress: boolean; nearInterstate: boolean; inspection: string; rater: string; checker: string };
  span: number; // ft, bearing to bearing
  structureLength: number; // ft
  numSpans: number; // identical simple spans
  skew: number; // degrees (no LFD moment reduction; entered in BrR)
  units: {
    count: number;
    spacing: number; // in, center to center of units
    flangeWidth: number; // in
    depth: number; // in, precast, overall
    flangeThk: number; // in
    stemSpacing: number; // in, center to center within a unit
    stemTop: number; // in
    stemBot: number; // in
    exteriorTrimmed: boolean; // exterior flanges trimmed flush with the outer stem
    layout: DtUnitLayout[] | null; // per unit, when they differ
    jointGap: number; // in, between units with a layout
  };
  deck: { present: boolean; thk: number; fc: number; pcf: number };
  roadway: { railToRail: number; railFaceOffset: number; curbToCurb: number; curbFaceOffset: number }; // ft, in, ft, in
  loads: {
    asphalt: number; // in
    asphaltPcf: number;
    concPcf: number; // girder concrete for dead load
    // ft, in; side 1 on the first unit, side 2 on the last. A curb carries no pedestrians and isn't mountable.
    sidewalks: { width: number; thk: number; curb?: boolean }[];
    pedWidth: number; // ft carrying pedestrian load (0: the sidewalks' width)
    sidewalkMountable: boolean;
    pedestrians: boolean; // pedestrian live load on the sidewalks (SSHB 3.14.1.1), with the trucks curb to curb
    railKlf: number; // each side
    railComponents: { name: string; plf: number; desc: string }[];
    utilities: { desc: string; klf: number; unit: number }[];
    diaphragmKip: number; // per girder, at midspan
  };
  materials: { fc: number; fci: number; strand: string; fpu: number; aps: number; gammaStar: number; jackingRatio: number; lowRelaxation: boolean; strandsPerRowPerStem: number; firstRow: number; rowSpacing: number };
  // harp: strands harped (from a standard), their centroid above the bottom at the ends and from `at` × span to midspan.
  prestress: { mode: "back-calculate" | "known"; strands: number; harp?: { end: number; mid: number; at: number } | null };
  options: {
    solveWithOverlay: boolean; // the asphalt in place while the force is solved
    lldfInterior: "table" | "sd"; // SSHB Table 3.23.1 (S/7.0, S/5.5) or the multi-beam S/D of 3.23.4.3
    roundStrands: boolean; // whole strands, the jacking force rounded down to the kip
    legalLldf: "single" | "multi";
    /**
     * ksi, final tension allowed in the girder; null: the code's 6√f′c (SSHB 9.15.2.2). CDOT's
     * back-calculated model raises it to 1.0 so strength governs (BRM 1.7.2), in the runs that set the
     * force and in the reported ratings (as CDOT's sample BrR model does).
     */
    tensionLimit: number | null;
    /**
     * With a back-calculated prestress: the final tension isn't rated at all. BRM 1.7.2 sets the
     * prestress by strength, so service tension on an assumed prestress isn't a rating.
     */
    ignoreTension: boolean;
    lossLumpSum: number; // ksi, SSHB 9.16.2.2
    poi: "tenth" | "tenth-and-max"; // tenth points (BrR's default), or also each vehicle's maximum moment
    solveAt: "points" | "midspan"; // back-calculate over the points of interest (as BrR rates), or at midspan by the hand method
    checkShear: boolean; // SSHB 9.20; waived by default per BRM 1.4(O)
    stirrups: { bar: number; legs: number; spacing: number; fy: number }; // for shear, per stem
    dfOverride: { intSingle: number; intMulti: number; extSingle: number; extMulti: number } | null;
  };
  review: { items: string[]; assumption: string };
  notes: Record<string, string>; // the source of a value, by input path
  brrResults: string; // BrR's rating table, pasted, for the comparison
  /** BrR's moment distribution factors (from its input or LLDF report), to check against ALLCON's within 5%. */
  brrDf: { intSingle: number | null; intMulti: number | null; extSingle: number | null; extMulti: number | null };
  /** The inspection sketch, its pages stored as pictures under the design. */
  sketch: DtSketch | null;
  /** The units' (and deck's) dimensions entered or confirmed for this bridge, not the starting values. */
  dimsChecked: boolean;
  /** Where each bridge input came from (sources.ts); one without a source is still needed. */
  sources: Record<string, { kind: "sia" | "sketch" | "brm" | "file" | "standard" | "entered" | "assumed" | "confirmed"; note?: string }>;
  /** Started blank: inputs without a source show empty, not ALLCON's placeholders. */
  blankStart: boolean;
};
/** text: a PDF sketch's text lines, for its callouts (none for a scan or a picture). */
export type DtSketch = { name: string; pages: { key: string; width: number; height: number }[]; text?: string[] };

export const DT_DEFAULTS: DtInputs = {
  bridge: { id: "", facility: "", feature: "", owner: "", yearBuilt: 1970, nbiSuper: 6, loadInducedDistress: false, nearInterstate: false, inspection: "", rater: "", checker: "" },
  span: 30,
  structureLength: 30.5,
  numSpans: 1,
  skew: 0,
  units: { count: 6, spacing: 62, flangeWidth: 60, depth: 17, flangeThk: 5, stemSpacing: 36, stemTop: 8, stemBot: 6, exteriorTrimmed: false, layout: null, jointGap: 0 },
  deck: { present: false, thk: 6, fc: 4.5, pcf: 150 },
  roadway: { railToRail: 30, railFaceOffset: 3, curbToCurb: 0, curbFaceOffset: 0 },
  loads: { asphalt: 3, asphaltPcf: 146.667, concPcf: 155, sidewalks: [], pedWidth: 0, sidewalkMountable: true, pedestrians: true, railKlf: 0.02, railComponents: [], utilities: [], diaphragmKip: 0 },
  materials: { fc: 6, fci: 4, strand: '1/2" 250 ksi stress-relieved', fpu: 250, aps: 0.144, gammaStar: 0.4, jackingRatio: 0.7, lowRelaxation: false, strandsPerRowPerStem: 2, firstRow: 2, rowSpacing: 2 },
  prestress: { mode: "back-calculate", strands: 0 },
  options: {
    solveWithOverlay: true,
    lldfInterior: "table",
    roundStrands: true,
    legalLldf: "single",
    tensionLimit: 1,
    ignoreTension: false,
    lossLumpSum: 45,
    poi: "tenth",
    solveAt: "points",
    checkShear: false,
    stirrups: { bar: 3, legs: 1, spacing: 12, fy: 40 },
    dfOverride: null,
  },
  review: { items: [], assumption: "" },
  notes: {},
  brrResults: "",
  brrDf: { intSingle: null, intMulti: null, extSingle: null, extMulti: null },
  sketch: null,
  dimsChecked: false,
  sources: {},
  blankStart: true,
};

const BAR_AREA: Record<number, number> = { 3: 0.11, 4: 0.2, 5: 0.31, 6: 0.44 };
export const EP = 28500; // ksi, strand: BrR's value (SSHB 9.16.2.1.2 gives 28,000)
/** Modulus of rupture, ksi: 0.24√f′c, BrR's value (SSHB 9.15.2.3's 7.5√f′c psi is 1% less). */
export const ruptureModulus = (fc: number) => 0.24 * Math.sqrt(fc);
/** The final tension limit, ksi. */
export const finalTension = (i: Pick<DtInputs, "options" | "materials">) => i.options.tensionLimit ?? (6 * Math.sqrt(i.materials.fc * 1000)) / 1000;
/** Whether the final tension is left out of the rating: asked for, with a back-calculated prestress (BRM 1.7.2). */
export const tensionIgnored = (i: Pick<DtInputs, "options" | "prestress">) => !!i.options.ignoreTension && i.prestress.mode === "back-calculate";

// --- sections ----------------------------------------------------------------------------------------

function trap(h: number, b1: number, b2: number, y0: number) {
  const A = ((b1 + b2) / 2) * h;
  const yc = y0 + (h * (b1 + 2 * b2)) / (3 * (b1 + b2));
  const Io = (h ** 3 * (b1 * b1 + 4 * b1 * b2 + b2 * b2)) / (36 * (b1 + b2));
  return { A, yc, Io };
}
function torsionRect(b: number, t: number) {
  if (t > b) [b, t] = [t, b];
  return b * t ** 3 * (1 / 3 - 0.21 * (t / b) * (1 - t ** 4 / (12 * b ** 4)));
}
export type DtSection = ReturnType<typeof section>;
/** A double-tee unit: its flange (width bf) and two tapered stems. */
function section(u: DtInputs["units"], bf: number) {
  const hs = u.depth - u.flangeThk;
  const parts = [trap(u.flangeThk, bf, bf, hs), trap(hs, u.stemBot, u.stemTop, 0), trap(hs, u.stemBot, u.stemTop, 0)];
  const A = parts.reduce((s, p) => s + p.A, 0);
  const yb = parts.reduce((s, p) => s + p.A * p.yc, 0) / A;
  const I = parts.reduce((s, p) => s + p.Io + p.A * (p.yc - yb) ** 2, 0);
  const tAvg = (u.stemTop + u.stemBot) / 2;
  const J = torsionRect(bf, u.flangeThk) + 2 * torsionRect(hs, tAvg);
  return { bf, A, yb, yt: u.depth - yb, I, Sb: I / yb, St: I / (u.depth - yb), J, bw: 2 * tAvg };
}
/** Ec, SSHB 8.7.1, 145 pcf. */
export const Ec = (fc: number) => 33000 * 0.145 ** 1.5 * Math.sqrt(fc);

// --- flexural strength, SSHB 9.17 ----------------------------------------------------------------

export type Flexure = ReturnType<typeof flexure>;
/** Mn (kip·ft) for strands As at depth d; fsuCap limits the strand stress (development, 9.28). */
function flexure(As: number, sec: { bf: number; bw: number }, d: number, m: DtInputs["materials"], hf: number, fcFlange: number, fsuCap: number | null = null) {
  const fc = fcFlange;
  const fpu = m.fpu;
  const g = m.gammaStar;
  const b1 = Math.max(0.65, Math.min(0.85, 0.85 - 0.05 * (fc - 4)));
  const b = sec.bf;
  const bw = sec.bw;
  const rho = As / (b * d);
  let fsu = fpu * (1 - (g / b1) * ((rho * fpu) / fc)); // 9-17
  if (fsuCap !== null) fsu = Math.min(fsu, fsuCap);
  const a = (1.4 * d * rho * fsu) / fc;
  let Mn: number;
  let type: "rectangular" | "flanged";
  if (a <= hf) {
    type = "rectangular";
    Mn = As * fsu * d * (1 - (0.6 * rho * fsu) / fc); // 9-13
  } else {
    type = "flanged";
    const Asf = (0.85 * fc * (b - bw) * hf) / fsu;
    const Asr = As - Asf;
    Mn = Asr * fsu * d * (1 - (0.6 * Asr * fsu) / (bw * d * fc)) + 0.85 * fc * (b - bw) * hf * (d - 0.5 * hf); // 9-14
  }
  const index = (rho * fsu) / fc;
  const limit = 0.36 * b1;
  let overReinforced = false;
  if (type === "rectangular" && index > limit) {
    overReinforced = true;
    Mn = Math.min(Mn, (0.36 * b1 - 0.08 * b1 * b1) * fc * b * d * d); // 9.18.1
  }
  return { Mn: Mn / 12, fsu, rho, beta1: b1, a, type, index, limit, overReinforced };
}

/** The strand centroid above the bottom for an area As, rows filled from the bottom (the assumption for a girder without plans). */
export function strandCG(As: number, m: DtInputs["materials"]) {
  const n = As / m.aps;
  const rows = Math.max(1, n / 2 / m.strandsPerRowPerStem);
  return m.firstRow + (m.rowSpacing * (rows - 1)) / 2;
}

// --- the rating ------------------------------------------------------------------------------------

export type Girder = ReturnType<typeof buildGirders>["girders"][number];
export type RatingCheck = "flexure" | "shear" | "tension" | "compression" | "compression-ll" | "strand" | "deck-compression";
/** A girder case of trucks on a mountable sidewalk: rated, but not used to back-calculate the prestress. */
export const isSidewalkTruckCase = (name: string) => name.endsWith("(trucks on sidewalk)");

export const CHECK_LABEL: Record<RatingCheck, string> = {
  flexure: "Flexure (strength)",
  shear: "Shear (strength)",
  tension: "Concrete tension, bottom",
  compression: "Concrete compression, top (0.6 f′c)",
  "compression-ll": "Concrete compression, top, LL + ½(PS + DL) (0.4 f′c)",
  strand: "Prestressing steel stress",
  "deck-compression": "Deck concrete compression",
};

function buildGirders(i: DtInputs) {
  const u = i.units;
  const L = i.span;
  const nU = u.count;
  if (!(L > 0)) throw new DesignError("The span needs a length.");
  if (nU < 2) throw new DesignError("At least two units.");
  if (!(u.depth > u.flangeThk && u.flangeThk > 0)) throw new DesignError("The depth must be more than the flange thickness.");
  if (!(u.stemTop > 0 && u.stemBot > 0)) throw new DesignError("The stems need widths.");
  const deck = i.deck.present ? i.deck : null;
  const extOverhangOut = u.exteriorTrimmed ? u.stemTop / 2 : (u.flangeWidth - u.stemSpacing) / 2;
  const intOverhang = (u.flangeWidth - u.stemSpacing) / 2;
  const bfExt = intOverhang + u.stemSpacing + extOverhangOut;
  const geo: { bf: number; ss: number; edge: number; x: number }[] = [];
  if (u.layout) {
    if (u.layout.length !== nU) throw new DesignError(`The unit layout must list ${nU} units.`);
    let x = 0;
    u.layout.forEach((g, k) => {
      if (k > 0) x += u.layout![k - 1].flangeWidth / 2 + u.jointGap + g.flangeWidth / 2;
      geo.push({ bf: g.flangeWidth, ss: g.stemSpacing, edge: g.flangeWidth / 2, x });
    });
  } else {
    for (let k = 0; k < nU; k++) {
      const ext = k === 0 || k === nU - 1;
      geo.push({ bf: ext ? bfExt : u.flangeWidth, ss: u.stemSpacing, edge: u.stemSpacing / 2 + extOverhangOut, x: k * u.spacing });
    }
  }
  const spacingAt = (k: number) => geo[k + 1].x - geo[k].x; // in, between girder k and k+1
  const iTyp = nU >= 3 ? Math.floor((nU - 1) / 2) : 0;
  const S_in = u.layout ? (spacingAt(iTyp - 1 < 0 ? 0 : iTyp - 1) + spacingAt(iTyp)) / 2 : u.spacing;
  const S_ft = S_in / 12;
  const secInt = section(u, geo[iTyp].bf);
  const secExt = section(u, geo[0].bf);
  const impact = Math.min(0.3, 50 / (L + 125)); // SSHB 3.8.2.1

  // Composite section: the deck transformed to the girder's concrete.
  const nDeck = deck ? Ec(deck.fc) / Ec(i.materials.fc) : 1;
  const compositeSec = (sec: DtSection) => {
    if (!deck) return null;
    const bt = sec.bf * nDeck;
    const t = deck.thk;
    const Ad = bt * t;
    const yd = u.depth + t / 2;
    const A = sec.A + Ad;
    const yb = (sec.A * sec.yb + Ad * yd) / A;
    const I = sec.I + sec.A * (sec.yb - yb) ** 2 + (bt * t ** 3) / 12 + Ad * (yd - yb) ** 2;
    return { A, yb, I, Sb: I / yb, St: I / (u.depth - yb), Sd: I / (u.depth + t - yb), h: u.depth + t, n: nDeck };
  };

  // Live load distribution, wheel lines per unit (SSHB 3.23).
  const roadW = i.roadway.railToRail;
  const NL = Math.max(1, Math.floor((roadW - (2 * i.roadway.railFaceOffset) / 12) / 12));
  const sOverD = (nl: number, sec: DtSection) => {
    const K = Math.sqrt((1.2 * sec.I) / sec.J);
    const WL = roadW / L;
    const C = WL < 1 ? K * WL : K;
    const D = 5.75 - 0.5 * nl + 0.7 * nl * (1 - 0.2 * C) ** 2; // 3.23.4.3
    return { K, C, D, DF: S_ft / D };
  };
  /** Lever rule for an exterior girder: the wheel 2 ft from the rail or curb face, hinged at the next girder. */
  const lever = (multi: boolean, faceOffsetIn: number, k = 0) => {
    const g = geo[k];
    const S = spacingAt(k === 0 ? 0 : k - 1);
    const face = g.edge - faceOffsetIn;
    const wheels = multi ? [24, 96, 144, 216] : [24, 96];
    let R = 0;
    const used: number[] = [];
    for (const w of wheels) {
      const x = w - face;
      if (x < S) {
        R += (S - x) / S;
        used.push(x);
      }
    }
    return { DF: R, wheels: used, S, face };
  };
  const dfInt =
    i.options.lldfInterior === "sd"
      ? { method: "sd" as const, multi: sOverD(NL, secInt), single: sOverD(1, secInt) }
      : { method: "table" as const, multi: { D: 5.5, DF: S_ft / 5.5 }, single: { D: 7.0, DF: S_ft / 7.0 }, sd: { multi: sOverD(NL, secInt), single: sOverD(1, secInt) } };
  const dfInterior = (k: number) => {
    const S = (spacingAt(k - 1) + spacingAt(k)) / 2 / 12;
    if (i.options.lldfInterior === "sd") return { single: dfInt.single.DF, multi: dfInt.multi.DF, S };
    return { single: S / 7.0, multi: S / 5.5, S };
  };

  // Sidewalks: rated two ways, the worse governing: trucks curb to curb with pedestrians on the
  // sidewalks, and (mountable sidewalks) trucks on the sidewalk without pedestrians, exterior girders.
  const ld = i.loads;
  const sidewalks = ld.sidewalks;
  // The walkways: the sidewalks that aren't curbs (pedestrians, and trucks when mountable).
  const walks = sidewalks.filter((s) => !s.curb);
  const pedWidth = ld.pedWidth > 0 ? ld.pedWidth : walks.reduce((a, s) => a + s.width, 0);
  const pedPsf = L <= 25 ? 85 : L <= 100 ? 60 : Math.min(60, ((30 + 3000 / L) * (55 - 30)) / 50); // SSHB 3.14.1.1
  const mountable = walks.length > 0 && ld.sidewalkMountable;
  const pedKlf = walks.length && ld.pedestrians ? (pedPsf * pedWidth) / nU / 1000 : 0;
  const curbFace = sidewalks.length ? i.roadway.curbFaceOffset : i.roadway.railFaceOffset;
  const dfExt = { multi: lever(NL > 1, curbFace), single: lever(false, curbFace) };

  // Dead loads per girder (klf, kip). Without a deck, each load on the girder it sits on; with a
  // composite deck, the girder, deck and diaphragms on the girder (DC1) and the rest shared equally.
  const unitDL = (gi: number, withOverlay: boolean) => {
    const k = gi - 1;
    const ext = gi === 1 || gi === nU;
    const sec = section(u, geo[k].bf);
    const self = (sec.A / 144) * (ld.concPcf / 1000);
    const diaph = ld.diaphragmKip;
    if (!deck) {
      // Without a deck each load sits on its unit: a sidewalk or curb on the exterior unit of its side
      // (side 1 on the first unit, side 2 on the last), the asphalt between the curb (or rail) faces.
      const asphaltW = ext ? geo[k].bf - curbFace : geo[k].bf;
      const asphalt = withOverlay ? (((asphaltW / 12) * ld.asphalt) / 12) * (ld.asphaltPcf / 1000) : 0;
      const rail = ext ? ld.railKlf : 0;
      const util = ld.utilities.filter((x) => x.unit === gi).reduce((s, x) => s + x.klf, 0);
      const side = gi === 1 ? sidewalks[0] : gi === nU && nU > 1 ? sidewalks[1] : undefined;
      const sidewalk = side ? ((side.width * side.thk) / 12) * 0.15 : 0; // 150 pcf concrete
      return { self, deck: 0, dc1: self, asphalt, rail, util, sidewalk, dc2: asphalt + sidewalk + rail + util, diaph, composite: false };
    }
    const deckW = (geo[k].bf / 12) * (deck.thk / 12) * (deck.pcf / 1000);
    const ctc = i.roadway.curbToCurb || roadW - (2 * i.roadway.railFaceOffset) / 12;
    const asphaltTot = withOverlay ? ((ctc * ld.asphalt) / 12) * (ld.asphaltPcf / 1000) : 0;
    const swTot = sidewalks.reduce((a, s) => a + ((s.width * s.thk) / 12) * (deck.pcf / 1000), 0);
    const utilTot = ld.utilities.reduce((s, x) => s + x.klf, 0);
    const asphalt = asphaltTot / nU;
    const sidewalk = swTot / nU;
    const rail = (2 * ld.railKlf) / nU;
    const util = utilTot / nU;
    return { self, deck: deckW, dc1: self + deckW, asphalt, rail, util, sidewalk, dc2: asphalt + sidewalk + rail + util, diaph, composite: true };
  };

  const ov = i.options.dfOverride;
  const girders: {
    name: string;
    i: number;
    ext: boolean;
    sec: DtSection;
    csec: ReturnType<typeof compositeSec>;
    bf: number;
    S: number;
    dlSolve: ReturnType<typeof unitDL>;
    dlNow: ReturnType<typeof unitDL>;
    dfMulti: number;
    dfSingle: number;
    pedKlf: number;
    caseName: string;
  }[] = [];
  for (let gi = 1; gi <= nU; gi++) {
    const k = gi - 1;
    const ext = gi === 1 || gi === nU;
    const sec = section(u, geo[k].bf);
    const dfI = ext ? null : dfInterior(k);
    const extDF = ext ? { multi: lever(NL > 1, curbFace, k).DF, single: lever(false, curbFace, k).DF } : null;
    girders.push({
      name: `G${gi}`,
      i: gi,
      ext,
      sec,
      csec: compositeSec(sec),
      bf: geo[k].bf,
      S: ext ? spacingAt(k === 0 ? 0 : k - 1) / 12 : dfI!.S,
      dlSolve: unitDL(gi, i.options.solveWithOverlay),
      dlNow: unitDL(gi, true),
      dfMulti: ov ? (ext ? ov.extMulti : ov.intMulti) : ext ? extDF!.multi : dfI!.multi,
      dfSingle: ov ? (ext ? ov.extSingle : ov.intSingle) : ext ? extDF!.single : dfI!.single,
      pedKlf: sidewalks.length ? pedKlf : 0,
      caseName: sidewalks.length ? (pedKlf > 0 ? "curb to curb, with pedestrians" : "curb to curb") : "",
    });
  }
  if (mountable) {
    for (const gi of [1, nU]) {
      const k = gi - 1;
      const g0 = girders[k];
      girders.push({
        ...g0,
        name: `G${gi} (trucks on sidewalk)`,
        caseName: "trucks on the sidewalk, no pedestrians",
        dfMulti: ov ? ov.extMulti : lever(NL > 1, i.roadway.railFaceOffset, k).DF,
        dfSingle: ov ? ov.extSingle : lever(false, i.roadway.railFaceOffset, k).DF,
        pedKlf: 0,
      });
    }
  }
  return {
    girders,
    geo: { L, S_in, S_ft, bfExt, intOverhang, extOverhangOut, hs: u.depth - u.flangeThk, roadW, NL, units: geo, spacings: geo.slice(1).map((_, k) => spacingAt(k)), iTyp },
    secInt,
    secExt,
    csecInt: compositeSec(secInt),
    csecExt: compositeSec(secExt),
    nDeck,
    impact,
    df: { int: dfInt, ext: dfExt },
    ped: { sidewalks, pedWidth, pedPsf, pedKlf, mountable, curbFace },
  };
}

/** The cross-section's layout (the units across, the spacing, the roadway), without rating: for the drawing. */
export function dtLayout(i: DtInputs) {
  return buildGirders(i).geo;
}
export type DtLayout = ReturnType<typeof dtLayout>;

/** Moment and shear (kip·ft, kip) at x from a uniform w and a midspan point load P on a simple span. */
const dlAt = (w: number, P: number, L: number, x: number) => ({ M: (w * x * (L - x)) / 2 + (P * Math.min(x, L - x)) / 2, V: Math.abs(w * (L / 2 - x)) + (x < L / 2 ? P / 2 : x > L / 2 ? P / 2 : 0) });

/** Rates the bridge: the force or strands, then every vehicle, girder, point and check. */
export function rateDoubleTee(i: DtInputs) {
  const b = buildGirders(i);
  const { girders } = b;
  const u = i.units;
  const m = i.materials;
  const L = i.span;
  const deck = i.deck.present ? i.deck : null;
  if (!(m.aps > 0 && m.fpu > 0)) throw new DesignError("The strand needs an area and strength.");
  const vehicles = CDOT_VEHICLES;
  const I = b.impact;

  // Live load per wheel line at each point, for each vehicle (HS-20: truck or lane, whichever is more).
  const ext = Math.max(0, (i.structureLength - L) / 2); // ft the girder extends past each bearing
  const xsBase = Array.from({ length: 11 }, (_, k) => (k * L) / 10);
  const maxAt = Object.fromEntries(vehicles.map((v) => [v.name, trainMax(v, L)]));
  const lane = trainMax({ P: [], S: [] }, L); // placeholder for the shape
  void lane;
  const laneMid = laneAt(L, L / 2);
  const M_HS20 = Math.max(maxAt["HS-20"].M, laneMid.M); // the hand method's design moment (midspan lane)
  const pois = (() => {
    const xs = [...xsBase];
    if (i.options.poi === "tenth-and-max") for (const v of vehicles) xs.push(maxAt[v.name].at);
    return [...new Set(xs.map((x) => +x.toFixed(4)))].sort((a, c) => a - c);
  })();
  const llCache = new Map<string, { M: number; V: number }>();
  const llAt = (v: Vehicle, x: number) => {
    const key = `${v.name}@${x}`;
    let r = llCache.get(key);
    if (!r) {
      const t = trainAt(v, L, x);
      if (v.cls === "design") {
        const ln = laneAt(L, x);
        t.M = Math.max(t.M, ln.M);
        t.V = Math.max(t.V, ln.V);
      }
      llCache.set(key, (r = t));
    }
    return r;
  };

  // Prestress and capacity for a strand area.
  const fpj = m.jackingRatio * m.fpu;
  const fse = fpj - i.options.lossLumpSum;
  const db = m.strand.includes("0.6") || m.strand.includes("6/10") ? 0.6 : m.strand.includes("7/16") ? 0.4375 : m.strand.includes("3/8") ? 0.375 : 0.5;
  const lt = (50 * db) / 12; // ft, transfer, SSHB 9.20.2.4
  // The strands' centroid above the bottom at x: straight, or harped (known strands from a standard).
  const harp = i.prestress.mode === "known" && i.prestress.harp ? i.prestress.harp : null;
  const cgAt = (As: number, x: number | null) => {
    if (!harp) return strandCG(As, m);
    if (x === null) return harp.mid;
    const r = Math.min(x, L - x) / (harp.at * L);
    return r >= 1 ? harp.mid : harp.end + (harp.mid - harp.end) * r;
  };
  const capacity = (g: Girder, As: number, x: number | null = null) => {
    const cg = cgAt(As, x);
    const h = u.depth + (deck ? deck.thk : 0);
    const d = h - cg;
    const hf = u.flangeThk + (deck ? deck.thk : 0);
    const fcF = deck ? deck.fc : m.fc;
    let cap: number | null = null;
    if (x !== null) {
      // Development (SSHB 9.28): fse over the transfer length, rising to f*su over the development length.
      const xe = Math.min(x, L - x) + ext; // ft from the girder's end
      const full = flexure(As, g.sec, d, m, hf, fcF);
      const ld = ((full.fsu - (2 / 3) * fse) * db) / 12; // ft
      cap = xe <= lt ? (fse * xe) / lt : xe >= ld ? null : fse + ((xe - lt) / Math.max(1e-9, ld - lt)) * (full.fsu - fse);
    }
    return { ...flexure(As, g.sec, d, m, hf, fcF, cap), cg, d, h, hf, fcFlange: fcF };
  };
  const D = (g: Girder, solve: boolean, x: number) => {
    const dl = solve ? g.dlSolve : g.dlNow;
    return dlAt(dl.dc1 + dl.dc2, dl.diaph, L, x);
  };
  const pedM = (g: Girder, x: number) => (g.pedKlf * x * (L - x)) / 2;
  const hs20 = vehicles.find((v) => v.cls === "design")!;

  // --- back-calculation (BRM 1.7.2(A)): As so the lowest HS-20 inventory flexure RF over girders and points is 1.0 ---
  const rfFlexInv = (g: Girder, As: number, x: number, solve: boolean) => {
    const C = capacity(g, As, x).Mn;
    const LL = llAt(hs20, x).M * g.dfMulti * (1 + I);
    if (LL <= 1e-9) return Infinity;
    return (C - 1.3 * D(g, solve, x).M - 2.17 * pedM(g, x)) / (2.17 * LL);
  };
  // The hand method: the largest HS-20 moment anywhere with the dead load at midspan.
  const rfFlexInvMid = (g: Girder, As: number) => (capacity(g, As).Mn - 1.3 * D(g, true, L / 2).M - 2.17 * pedM(g, L / 2)) / (2.17 * M_HS20 * g.dfMulti * (1 + I));
  const rfSolve = (g: Girder, As: number) => (i.options.solveAt === "midspan" ? rfFlexInvMid(g, As) : Math.min(...pois.filter((x) => x > 0 && x < L).map((x) => rfFlexInv(g, As, x, true))));
  // The prestress is solved from the cases the original design would have used (trucks between the
  // curbs); trucks on a mountable sidewalk are then rated with it, not solved for (BRM 1.7.2(A)).
  const solveGirders = girders.filter((g) => !isSidewalkTruckCase(g.name));
  const minRF = (As: number) => Math.min(...solveGirders.map((g) => rfSolve(g, As)));
  let As: number;
  let AsExact = 0;
  let crackGoverns = false;
  const fr = ruptureModulus(m.fc);
  const crack = girders.map((g) => ({ g: g.name, Mcr: (fr * (g.csec ? g.csec.Sb : g.sec.Sb)) / 12, MuReq: 1.3 * D(g, true, L / 2).M + 2.17 * (M_HS20 * g.dfMulti * (1 + I) + pedM(g, L / 2)) }));
  let solveNote = "";
  if (i.prestress.mode === "known") {
    if (!(i.prestress.strands > 0)) throw new DesignError("Give the number of strands, or back-calculate them.");
    As = i.prestress.strands * m.aps;
    AsExact = As;
  } else {
    const maxCG = (u.depth - u.flangeThk) / 2; // the strand centroid stays in the stems' lower half
    let lo = 0.05;
    let hi: number | null = null;
    for (let a = 0.05; strandCG(a, m) <= maxCG; a += 0.01) {
      if (minRF(a) >= 1) {
        hi = a;
        break;
      }
      lo = a;
    }
    if (hi === null) throw new DesignError(`No prestress makes HS-20 rate 1.0 at inventory: with strands filling the stems up to a centroid of ${maxCG.toFixed(1)} in, the best rating factor is ${minRF(lo).toFixed(3)}. These units can't carry it over a ${+L.toFixed(2)} ft span: check their depth and widths, the span and the loads.`);
    let top: number = hi;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + top) / 2;
      if (minRF(mid) < 1) lo = mid;
      else top = mid;
    }
    As = top;
    // BRM 1.7.2: the steel for the greater of the factored moment and the cracking moment.
    const solveCrack = crack.filter((c) => !isSidewalkTruckCase(c.g));
    crackGoverns = solveCrack.some((c) => c.Mcr > c.MuReq);
    if (crackGoverns) {
      let lo2 = 0.05;
      let hi2 = As * 3;
      for (let k = 0; k < 200; k++) {
        const mid = (lo2 + hi2) / 2;
        const ok = girders.every((g, j) => isSidewalkTruckCase(g.name) || capacity(g, mid).Mn >= Math.max(crack[j].Mcr, crack[j].MuReq));
        if (ok) hi2 = mid;
        else lo2 = mid;
      }
      As = hi2;
    }
    AsExact = As;
    if (i.options.roundStrands) As = Math.ceil(AsExact / m.aps - 1e-9) * m.aps;
    solveNote = i.options.roundStrands ? "whole strands; the jacking force rounded down to the kip" : "the exact force";
  }
  const nStrands = As / m.aps;
  const Pj = i.prestress.mode === "back-calculate" && i.options.roundStrands ? Math.floor(fpj * As + 1e-9) : fpj * As; // 1e-9: 15 × 0.144 × 175 is 378, not 377.99…
  const cg = cgAt(As, null);
  const Pe = fse * As;

  // --- ratings at every point, every girder, every vehicle ---
  const fy = m.lowRelaxation ? 0.9 * m.fpu : 0.85 * m.fpu; // f*y
  const np = EP / Ec(m.fc);
  const transfer = (x: number) => Math.min(1, (Math.min(x, L - x) + ext) / lt);
  const ignoreT = tensionIgnored(i);
  type PointResult = { x: number; check: RatingCheck; inv: number; opr: number | null; C: number; Dl: number; LL: number };
  const rateGirder = (g: Girder, v: Vehicle) => {
    const design = v.cls === "design";
    const df = design ? g.dfMulti : i.options.legalLldf === "single" ? g.dfSingle : g.dfMulti;
    const out: PointResult[] = [];
    const sec = g.sec;
    const cs = g.csec;
    for (const x of pois) {
      if (x <= 1e-9 || x >= L - 1e-9) continue;
      const cgx = cgAt(As, x);
      const e = sec.yb - cgx;
      const ll = llAt(v, x);
      const LLm = ll.M * df * (1 + I);
      const dl = g.dlNow;
      const M1 = dlAt(dl.dc1, dl.diaph, L, x).M; // on the girder alone (with a deck), or all (without)
      const M2 = dlAt(dl.dc2, 0, L, x).M;
      const Dm = M1 + M2;
      const Mp = pedM(g, x);
      // Flexure, strength.
      const cap = capacity(g, As, x);
      out.push({ x, check: "flexure", inv: (cap.Mn - 1.3 * Dm - 2.17 * Mp) / (2.17 * LLm), opr: (cap.Mn - 1.3 * Dm - 1.3 * Mp) / (1.3 * LLm), C: cap.Mn, Dl: Dm, LL: LLm });
      // Service, prestressed concrete (MBE 6B.5.3.3); stresses ksi, tension + at the bottom, compression + at the top.
      const P = Pe * transfer(x);
      const Sb2 = cs ? cs.Sb : sec.Sb;
      const St2 = cs ? cs.St : sec.St;
      const k12 = 12;
      const fbD = -P / sec.A - (P * e) / sec.Sb + (M1 * k12) / sec.Sb + ((M2 + Mp) * k12) / Sb2;
      const fbL = (LLm * k12) / Sb2;
      const ftLim = finalTension(i);
      const tInv = (ftLim - fbD) / fbL;
      if (!ignoreT) out.push({ x, check: "tension", inv: tInv, opr: null, C: ftLim, Dl: fbD, LL: fbL }); // inventory only (MBE 6B.5.3.3)
      const ftD = P / sec.A - (P * e) / sec.St + (M1 * k12) / sec.St + ((M2 + Mp) * k12) / St2;
      const ftL = (LLm * k12) / St2;
      out.push({ x, check: "compression", inv: (0.6 * m.fc - ftD) / ftL, opr: null, C: 0.6 * m.fc, Dl: ftD, LL: ftL });
      out.push({ x, check: "compression-ll", inv: (0.4 * m.fc - 0.5 * ftD) / ftL, opr: null, C: 0.4 * m.fc, Dl: 0.5 * ftD, LL: ftL });
      if (cs && deck) {
        // The deck's own stress: n × the transformed section's.
        const fdD = (cs.n * (M2 + Mp) * k12) / cs.Sd;
        const fdL = (cs.n * LLm * k12) / cs.Sd;
        out.push({ x, check: "deck-compression", inv: (0.4 * deck.fc - fdD) / fdL, opr: null, C: 0.4 * deck.fc, Dl: fdD, LL: fdL }); // 0.4f′c, as BrR
      }
      // Strand stress: the effective stress plus n × the concrete stress at the strands (tension +).
      const ycg2 = cs ? cs.yb - cgx : sec.yb - cgx;
      const fcgsD = -P / sec.A - (P * e * e) / sec.I + (M1 * k12 * e) / sec.I + ((M2 + Mp) * k12 * ycg2) / (cs ? cs.I : sec.I);
      const fcgsL = (LLm * k12 * ycg2) / (cs ? cs.I : sec.I);
      const Fs = fse * transfer(x) + np * fcgsD;
      const FsL = np * fcgsL;
      out.push({ x, check: "strand", inv: (0.8 * fy - Fs) / FsL, opr: (0.9 * fy - Fs) / FsL, C: 0.8 * fy, Dl: Fs, LL: FsL });
      // Shear (SSHB 9.20), when it isn't waived: from h/2 to midspan.
      if (i.options.checkShear && Math.min(x, L - x) * 12 >= (cap.h / 2) && x <= L / 2 + 1e-9) {
        const sh = shearAt(g, x, ll.V * df * (1 + I), dlAt(dl.dc1 + dl.dc2, dl.diaph, L, x), P, cap.h, cap.d, LLm, cgx);
        out.push({ x, check: "shear", inv: (sh.phiVn - 1.3 * sh.Vd) / (2.17 * sh.VL), opr: (sh.phiVn - 1.3 * sh.Vd) / (1.3 * sh.VL), C: sh.phiVn, Dl: sh.Vd, LL: sh.VL });
      }
    }
    const inv = out.reduce((a, c) => (c.inv < a.inv ? c : a));
    const oprList = out.filter((c) => c.opr !== null) as (PointResult & { opr: number })[];
    const opr = oprList.reduce((a, c) => (c.opr < a.opr ? c : a));
    const flex = out.filter((c) => c.check === "flexure");
    const flexInv = flex.reduce((a, c) => (c.inv < a.inv ? c : a));
    const flexOpr = flex.reduce((a, c) => (c.opr! < a.opr! ? c : a));
    return { g: g.name, df, inv, opr, flexInv, flexOpr, points: out };
  };
  const shearAt = (g: Girder, x: number, VL: number, dl: { M: number; V: number }, P: number, h: number, d: number, MLL: number, cg: number) => {
    // Vci = 0.6√f'c b'd + Vd + Vi·Mcr/Mmax; Vcw = (3.5√f'c + 0.3 fpc) b'd + Vp; Vs = Av fy d/s (≤ 8√f'c b'd); φ = 0.90.
    const sq = Math.sqrt(m.fc * 1000) / 1000;
    const dd = Math.max(d, 0.8 * h);
    const bw = g.sec.bw;
    const sec = g.sec;
    const cs = g.csec;
    const Sb2 = cs ? cs.Sb : sec.Sb;
    const fpe = P / sec.A + (P * (sec.yb - cg)) / sec.Sb; // at the bottom
    const fd = (dl.M * 12) / sec.Sb;
    const Mcr = (Sb2 * (6 * sq + fpe - fd)) / 12; // kip·ft
    const Vi = VL;
    const Mmax = Math.max(MLL, 1e-6);
    const Vci = Math.max(0.6 * sq * bw * dd + dl.V + (Vi * Mcr) / Mmax, 1.7 * sq * bw * dd);
    const fpc = cs ? P / sec.A - (P * (sec.yb - cg) * (sec.yb - cs.yb)) / sec.I + ((dl.M * 12) * (cs.yb - sec.yb)) / sec.I : P / sec.A;
    const Vcw = (3.5 * sq + 0.3 * fpc) * bw * dd;
    const Vc = Math.min(Vci, Vcw);
    const st = i.options.stirrups;
    const Av = 2 * st.legs * (BAR_AREA[st.bar] ?? 0.11); // two stems
    const Vs = Math.min((Av * st.fy * dd) / st.spacing, 8 * sq * bw * dd);
    void x;
    return { Vci, Vcw, Vc, Vs, phiVn: 0.9 * (Vc + Vs), Vd: dl.V, VL, Mcr, dd };
  };

  const ratings = vehicles.map((v) => {
    const per = girders.map((g) => rateGirder(g, v));
    const govInv = per.reduce((a, c) => (c.inv.inv < a.inv.inv ? c : a));
    const govOpr = per.reduce((a, c) => (c.opr.opr < a.opr.opr ? c : a));
    const t = tons(v);
    return { name: v.name, cls: v.cls, tons: t, per, govInv, govOpr, invTons: govInv.inv.inv * t, oprTons: govOpr.opr.opr * t, posting: posting(govOpr.opr.opr, v.cls, i.bridge.nearInterstate) };
  });

  // --- the hand method at midspan (absolute maximum live load moment with the midspan dead load), as a check ---
  const midspan = vehicles.map((v) => {
    const design = v.cls === "design";
    const Mw = design ? M_HS20 : maxAt[v.name].M;
    const per = girders.map((g) => {
      const df = design ? g.dfMulti : i.options.legalLldf === "single" ? g.dfSingle : g.dfMulti;
      const C = capacity(g, As).Mn;
      const Dm = D(g, false, L / 2).M;
      const Mp = pedM(g, L / 2);
      const LL = Mw * df * (1 + I);
      return { g: g.name, C, D: Dm, LL, ped: Mp, df, inv: (C - 1.3 * Dm - 2.17 * Mp) / (2.17 * LL), opr: (C - 1.3 * Dm - 1.3 * Mp) / (1.3 * LL) };
    });
    const gov = per.reduce((a, c) => (c.opr < a.opr ? c : a));
    const govInv = per.reduce((a, c) => (c.inv < a.inv ? c : a));
    return { name: v.name, cls: v.cls, tons: tons(v), Mw, at: maxAt[v.name].at, per, gov, govInv };
  });

  const govSolve = girders
    .filter((g) => !isSidewalkTruckCase(g.name))
    .map((g) => ({ g, rf: rfSolve(g, As) }))
    .reduce((a, c) => (c.rf < a.rf ? c : a));
  const capMid = capacity(govSolve.g, As);
  return {
    ...b,
    vehicles,
    pois,
    lt,
    ext,
    M_HS20,
    laneMid,
    maxAt,
    fr,
    crack,
    solve: { mode: i.prestress.mode, As, AsExact, nStrands, nExact: AsExact / m.aps, Pj, Pe, fpj, fse, cg, d: capMid.d, gov: govSolve.g.name, govRF: govSolve.rf, crackGoverns, note: solveNote, cap: capMid },
    fy,
    np,
    ratings,
    midspan,
  };
}

export type DtRating = ReturnType<typeof rateDoubleTee>;

/** CDOT's posting rule (BRM 1.15.1). */
export function posting(rf: number, cls: VehicleClass, nearInterstate: boolean) {
  if (cls === "design" || cls === "permit") return "—";
  if (cls === "ev" && !nearInterstate) return rf >= 0.95 ? "No posting" : "N/A (more than 1 mi from an Interstate)";
  if (rf >= 1.0) return "No posting";
  if (rf >= 0.95) return "Exempt (95% rule)";
  return "Posting required";
}

/**
 * The rating scripts' notes credit methods to people by name ("Someone's rule", "Someone's sheet");
 * the tool names no one, so those credits are reworded on import.
 */
const NAME = "[A-Z][a-z]+";
const NAME_CREDITS: [RegExp, string][] = [
  [new RegExp(`${NAME}/${NAME} BrR models`, "g"), "CDOT's sample BrR models"],
  [new RegExp(`${NAME}'s era table`, "g"), "the BRM era table"],
  [new RegExp(`${NAME}'s sheet`, "g"), "the reference sheet"],
  [new RegExp(`${NAME}'s (TELLRD-PINE ST|B-17-DL) model`, "g"), "the $1 sample model"],
  [new RegExp(`${NAME}'s approach, more conservative`, "g"), "the more conservative approach"],
  [new RegExp(`\\(${NAME} / BrR\\)`, "g"), "(BrR)"],
  [new RegExp(`${NAME}'s rule`, "g"), "the two-model rule"],
  [new RegExp(`${NAME}'s (No[- ]Plans|No[- ]Deck|model|checklist|setup)`, "g"), "the reference $1"],
  [new RegExp(` \\(${NAME}\\)(?=[.,;]|$)`, "g"), ""],
  // Background material isn't cited either: only the design codes are.
  [/CDOT's sample BrR models?/g, "CDOT's double-tee ratings"],
  [/ ?\((?:also )?used in the [\w.-]+ BrR model\)/g, ""],
  [/ ?\(the (?:[\w.-]+ ST )?(?:TELLRD-PINE ST )?sample model\)/g, ""],
  [/ \(the reference sheet\)/g, ""],
  [/\(the reference sheet used ([^)]*)\)/g, "(earlier ratings used $1)"],
];
export function neutralNote(t: string) {
  return NAME_CREDITS.reduce((s, [re, to]) => s.replace(re, to), t);
}

/* eslint-disable @typescript-eslint/no-explicit-any -- an untyped JSON file from the rating scripts */
/** A bridge input file of the rating scripts (snake_case JSON) as this tool's inputs; its "_" notes become the sources. */
export function dtInputsFromBridgeFile(b: Record<string, any>): DtInputs {
  const notes: Record<string, string> = {};
  (function walk(o: Record<string, any>, p: string) {
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith("_") && typeof v === "string") notes[`${p}${k.slice(1)}`] = neutralNote(v);
      else if (k === "_sources" && v && typeof v === "object") for (const [a, s] of Object.entries(v)) notes[`source.${a}`] = neutralNote(String(s));
      else if (v && typeof v === "object" && !Array.isArray(v)) walk(v, `${p}${k}.`);
    }
  })(b, "");
  const u = b.units ?? {};
  const ld = b.loads ?? {};
  const m = b.materials ?? {};
  const o = b.options ?? {};
  const rw = b.roadway ?? {};
  const d = DT_DEFAULTS;
  return {
    bridge: { id: b.id ?? "", facility: b.facility ?? "", feature: b.feature ?? "", owner: b.owner ?? "", yearBuilt: b.year_built ?? d.bridge.yearBuilt, nbiSuper: b.nbi_super ?? 6, loadInducedDistress: !!b.load_induced_distress, nearInterstate: !!b.within_1mi_of_interstate, inspection: b._sources?.sia ?? "", rater: b.rater ?? "", checker: b.checker ?? "" },
    span: b.span_ft,
    structureLength: b.structure_length_ft ?? b.span_ft,
    numSpans: b.num_spans ?? 1,
    skew: b.skew_deg ?? 0,
    units: {
      count: u.count,
      spacing: u.spacing_in,
      flangeWidth: u.flange_width_in,
      depth: u.depth_in,
      flangeThk: u.flange_thk_in,
      stemSpacing: u.stem_spacing_in,
      stemTop: u.stem_top_in,
      stemBot: u.stem_bot_in,
      exteriorTrimmed: !!u.exterior_trimmed_flush,
      layout: Array.isArray(u.layout) ? u.layout.map((x: Record<string, number>) => ({ flangeWidth: x.flange_width_in, stemSpacing: x.stem_spacing_in })) : null,
      jointGap: u.joint_gap_in ?? 0,
    },
    deck: b.deck ? { present: true, thk: b.deck.thk_in, fc: b.deck.fc_ksi, pcf: b.deck.pcf ?? 150 } : { ...d.deck, present: false },
    roadway: { railToRail: rw.rail_to_rail_ft, railFaceOffset: rw.rail_face_offset_in, curbToCurb: rw.curb_to_curb_ft ?? 0, curbFaceOffset: rw.curb_face_offset_in ?? 0 },
    loads: {
      asphalt: ld.asphalt_in ?? 0,
      asphaltPcf: ld.asphalt_pcf ?? 146.667,
      concPcf: ld.conc_pcf_dl ?? 155,
      sidewalks: (ld.sidewalks ?? []).map((s: Record<string, number>) => ({ width: s.width_ft, thk: s.thk_in })),
      pedWidth: ld.ped_width_ft ?? 0,
      sidewalkMountable: o.sidewalk_mountable !== false,
      pedestrians: o.pedestrians !== false,
      railKlf: ld.rail_klf_each_side ?? 0,
      railComponents: (ld.rail_components ?? []).map((c: Record<string, any>) => ({ name: c.name, plf: c.plf, desc: c.desc ?? "" })),
      utilities: (ld.utilities ?? []).map((x: Record<string, any>) => ({ desc: x.desc, klf: x.klf, unit: x.unit })),
      diaphragmKip: ld.diaphragm_kip_per_girder ?? 0,
    },
    materials: { fc: m.fc_ksi, fci: m.fci_ksi, strand: m.strand, fpu: m.fpu_ksi, aps: m.aps_in2, gammaStar: m.gamma_star ?? 0.4, jackingRatio: m.jacking_ratio ?? 0.7, lowRelaxation: /low/i.test(m.strand ?? ""), strandsPerRowPerStem: m.strands_per_row_per_stem ?? 2, firstRow: m.first_row_in ?? 2, rowSpacing: m.row_spacing_in ?? 2 },
    prestress: { mode: "back-calculate", strands: 0 },
    options: {
      ...d.options,
      solveWithOverlay: o.solve_with_overlay !== false,
      lldfInterior: o.lldf_interior === "multibeam_S_over_D" ? "sd" : "table",
      roundStrands: o.round_strands !== false,
      legalLldf: o.legal_lldf === "multi" ? "multi" : "single",
    },
    review: { items: (b.review_items ?? []).map((x: string) => neutralNote(String(x))), assumption: neutralNote(b.assumption_flag ?? "") },
    notes,
    brrResults: "",
    brrDf: { intSingle: b.brr?.lldf?.int_single ?? null, intMulti: b.brr?.lldf?.int_multi ?? null, extSingle: b.brr?.lldf?.ext_single ?? null, extMulti: b.brr?.lldf?.ext_multi ?? null },
    sketch: null,
    dimsChecked: true, // the bridge file gives them
    sources: {}, // set by the caller (fileSources), which knows the inputs it makes
    blankStart: false,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
