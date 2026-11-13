import { BARS, DesignError, type Check } from "../walls/cip";
import { CDOT_VEHICLES } from "../rating/vehicles";
import { axlesOf, continuousBeam, rotationsFromCurvature, type ContinuousBeam, type EndRotations, type LiveEnvelope } from "./continuous";
import { GIRDER_SHAPES, profileProps, shapeById, widthAt, type GirderShape, type Profile, type SectionProps } from "./sections";
import { analyzeHauling, analyzeLifting, type StabilitySection } from "./stability";

// LRFD Bridge Design Check: a simple-span precast, pretensioned girder with a composite cast-in-place
// deck, checked to the AASHTO LRFD Bridge Design Specifications (10th ed., 2024). Both the interior
// and the exterior girder are worked out; the controlling one leads the summary.
//
// Units: span lengths in ft, section dimensions in in, forces in kip, moments in kip·ft, stresses in
// ksi. Stresses are positive in compression. Positions x are measured from the bearing centerline.
//
// Scope: simple spans. Strands straight (optionally debonded for a length at each end) and harped
// (two-point drape). Time-dependent losses refined (5.9.3.4) or approximate (5.9.3.3), on the gross
// section; Service III takes γLL = 1.0 only with refined losses and elastic gains (Table 3.4.1-4).

// --- inputs ----------------------------------------------------------------------------------------

/** A row of straight strands; `debonded` of them are debonded for `debondLength` ft at each end. */
export type StrandRow = { y: number; count: number; debonded?: number; debondLength?: number }; // y: in from the bottom of the girder
/** Harped strands, draped at two harp points `harpPoint` × the girder's length from each end. */
export type HarpedStrands = { count: number; yEnd: number; yHarp: number; harpPoint: number }; // in, in, fraction
export type StirrupZone = { length: number; bar: number; legs: number; spacing: number; bundle?: { bars: number; wire: number } }; // ft from the bearing; the last zone runs to midspan

/** CDOT's end detail (B-618-CBT1): 2-#4 and a D20 wire bundled in each set, at 3 in for 6 spaces from the girder's end. */
export const CDOT_END_BUNDLE = { bars: 2, wire: 0.2 };

/** A zone's vertical steel in each set (in²): its legs times the bars bundled in each leg (one, unless bundled) and any wire. */
export const zoneAv = (z: Pick<StirrupZone, "bar" | "legs" | "bundle">) => z.legs * ((z.bundle?.bars ?? 1) * (BARS[z.bar]?.area ?? 0) + (z.bundle?.wire ?? 0));

/** How a zone is called out: "#4 @ 6"", or a bundle "2-#4 + D20 @ 3"". */
export const zoneCallout = (z: Pick<StirrupZone, "bar" | "spacing" | "bundle">) => (z.bundle ? `${z.bundle.bars}-#${z.bar}${z.bundle.wire ? ` + D${Math.round(z.bundle.wire * 100)}` : ""} @ ${z.spacing}"` : `#${z.bar} @ ${z.spacing}"`);
export type Exposure = "moderate" | "severe" | "none";

export type GirderInputs = {
  shape: string; // a library id, or "custom"
  custom: { profile: Profile; web: number; topWidth: number };
  // Layout
  L: number; // ft, bearing to bearing
  endDist: number; // ft, girder end to the bearing centerline
  nGirders: number;
  S: number; // ft, girder spacing
  overhang: number; // ft, exterior girder centerline to the deck edge
  barrierWidth: number; // ft, deck edge to the barrier's inside face
  skew: number; // degrees
  // Deck
  deckT: number; // in, as cast
  sacrificial: number; // in, wearing surface cast with the deck (left out of the section)
  haunch: number; // in, at the girder's centerline (a load; in the section only if chosen)
  haunchInSection: boolean;
  /** The haunch as given, or worked out by CDOT BDM 5.5.2.1 from the camber (then `haunch` is a first guess). */
  haunchMode?: "given" | "computed";
  deckPanels?: boolean; // partial-depth precast deck panels permitted (CDOT's minimum haunches)
  crossSlope?: number; // ft/ft, the deck's cross-slope over a level top flange (default 0.02)
  /** The roadway's crown: at an offset (ft) from the deck's centerline (+ toward the right), or a one-way slope down to the right. */
  crown?: { kind: "crown" | "one-way"; offset: number };
  /** A CDOT standard bridge rail (B-606): it sets the barrier's width, weight and height; "custom" keeps them as entered. */
  rail?: { type: import("../decks/rails").RailKey; testLevel: import("../decks/rails").TestLevel; steel: import("../decks/rails").RailSteel };
  profileOrdinate?: number; // in, the deck's profile above the bearing-to-bearing chord at midspan (+ crest)
  fcDeck: number; // ksi
  wcDeck: number; // kcf
  wcDeckLoad?: number; // kcf, the deck's weight with its reinforcement (default wcDeck, which sets Ec)
  // Girder concrete
  fci: number; // ksi at release
  fc: number; // ksi at 28 days
  wc: number; // kcf
  wcLoad?: number; // kcf, the girder's weight with its reinforcement (default wc, which sets Ec)
  K1: number; // 5.4.2.4
  // Strands (low-relaxation, Grade 270)
  strandDia: 0.5 | 0.6;
  fpu: number; // ksi
  fpjRatio: number; // fpj / fpu
  strands: StrandRow[];
  harped: HarpedStrands;
  losses: "refined" | "approximate"; // 5.9.3.4 or 5.9.3.3
  elasticGain: boolean; // count elastic gains from the deck and superimposed loads (refined losses)
  humidity: number; // %, average annual ambient relative humidity (CDOT criteria: 55 %, BDM 5.3.3)
  /** CDOT criteria: f'ci and f'c above 6.5 and 8.5 ksi approved by the Unit Leader with the State Bridge Engineer (BDM 5.3.1.2): the limits shown for information. */
  highStrengthApproved?: boolean;
  tRelease: number; // days, age at release
  tDeck: number; // days, age when the deck is cast
  tFinal: number; // days, the girder's final age (refined losses)
  bearingLength: number; // in, along the girder (for 5.7.3.5 at the bearing's inside edge)
  bottomBars: { count: number; bar: number }; // longitudinal bars at the bottom (5.7.3.5), developed
  llDeflection: boolean; // check live load deflection (2.5.2.6.2, optional)
  deflectionLimit: number; // L / this
  // Loads
  diaphragms: number; // intermediate diaphragms, equally spaced
  diaphragmWeight: number; // kip each, on an interior girder (an exterior girder, with diaphragms on one side, carries half)
  otherDC1: number; // klf on each girder (stay-in-place forms, ...)
  barrierWeight: number; // klf, one barrier
  barriersOnExterior: boolean; // each barrier on its exterior girder (else shared equally)
  otherDC2: number; // klf on each girder
  fws: number; // psf, future wearing surface (DW)
  // Shear reinforcement
  stirrups: StirrupZone[];
  stirrupsIntoDeck: boolean;
  fy: number; // ksi
  // Factors and options
  /** AASHTO LRFD alone, or with the CDOT Bridge Design Manual's amendments (cdotRules below). */
  criteria?: "aashto" | "cdot";
  /** After continuity: each joint judged by the code ("auto"), or always the envelope of simple-span and continuous behavior. */
  continuity?: "auto" | "envelope";
  eta: number; // ηD·ηR·ηI (1.3.2)
  exposure: Exposure;
  rigidMethod: boolean; // exterior girder not less than the rigid cross-section (4.6.2.2.2d)
  /** Live load distribution: AASHTO's tables (default), or the lever rule for every girder (for a girder system the tables don't cover, side-by-side boxes on a cast-in-place deck among them). */
  distribution?: "aashto" | "lever-rule";
  skewShearInterior: boolean; // skew correction for shear on interior girders too
  ag: number; // in, maximum aggregate size (5.7.3.4.2)
  // Continuity (5.12.3.3): spans 2.. of a bridge whose girders are made continuous over the piers.
  extraSpans: ExtraSpan[];
  tContinuity: number; // days, the girders' age when continuity is made (the diaphragms cast)
  pierBearingOffset: number; // ft, a pier's centerline to the bearings' centerline (the continuous beam spans pier to pier)
  restraintMoments: "all" | "positive" | "none"; // the creep and shrinkage restraint moments (5.12.3.3): all, only positive ones, or none
  pierBars: PierBars; // the deck's longitudinal bars over the piers
  connection: { count: number; bar: number; y: number }; // positive moment connection: bars into the diaphragm, y in from the girder's bottom
  // Anchorage zone (5.9.4.4): confinement bars around the bottom flange's strands at each end.
  confinement: { bar: number; spacing: number; length: number }; // bar size, in, ft from the girder's end
  // Handling (5.5.4.3): lifting from the form and hauling to the site, by PCI's method.
  handling: Handling;
  /** The site's wind and the barrier's height, for the loads delivered to the substructure (substructure-loads.ts). */
  site?: import("./substructure-loads").SiteWind;
  /** Started from uploaded plans: each value's source on the sheets and whether it's confirmed (from-plans.ts). */
  fromPlans?: import("./from-plans").FromPlans;
};

/** Lifting and hauling: where the girder is picked up and supported, the tolerances, the truck. Defaults are WSDOT's (PGSuper). */
export type Handling = {
  check: boolean;
  liftPoint: number; // ft, the girder's end to the lifting devices
  liftImpactUp: number; // fraction
  liftImpactDown: number;
  liftTolerance: number; // in, lifting device placement
  haulAge: number; // days, the girder's age when hauled (its losses to then; WSDOT's criteria take 10 days)
  bunkPoint: number; // ft, the girder's end to the truck's supports
  haulImpactUp: number;
  haulImpactDown: number;
  crown: number; // roadway crown slope, ft/ft (impact applies on the crown)
  superelevation: number; // maximum superelevation, ft/ft
  haulTolerance: number; // in, support placement
  sweep: number; // in per 10 ft of girder
  speed: number; // mph, in the turn
  radius: number; // ft, turning radius
  wind: number; // psf on the girder's side
  truck: HaulTruck;
};
/** A haul truck (WSDOT's HT60-72 by default). */
export type HaulTruck = { Ktheta: number; Hrc: number; Hbg: number; Wcc: number; maxSpan: number; maxOverhang: number; maxWeight: number }; // kip·in/rad, in, in, in, ft, ft, kip

export const HANDLING_DEFAULTS: Handling = {
  check: true,
  liftPoint: 3,
  liftImpactUp: 0,
  liftImpactDown: 0,
  liftTolerance: 0.25,
  haulAge: 10,
  bunkPoint: 5,
  haulImpactUp: 0.2,
  haulImpactDown: 0.2,
  crown: 0.02,
  superelevation: 0.06,
  haulTolerance: 1,
  sweep: 0.125,
  speed: 0,
  radius: 1000,
  wind: 0,
  truck: { Ktheta: 60000, Hrc: 24, Hbg: 72, Wcc: 72, maxSpan: 130, maxOverhang: 15, maxWeight: 262 },
};

/** WSDOT's haul trucks (PGSuper's library): roll stiffness, heights, tire spacing and limits. */
export const HAUL_TRUCKS: { name: string; truck: HaulTruck }[] = [
  { name: "HT40-72", truck: { Ktheta: 40000, Hrc: 24, Hbg: 72, Wcc: 72, maxSpan: 130, maxOverhang: 15, maxWeight: 262 } },
  { name: "HT50-72", truck: { Ktheta: 50000, Hrc: 24, Hbg: 72, Wcc: 72, maxSpan: 130, maxOverhang: 15, maxWeight: 262 } },
  { name: "HT60-72", truck: { Ktheta: 60000, Hrc: 24, Hbg: 72, Wcc: 72, maxSpan: 130, maxOverhang: 15, maxWeight: 262 } },
  { name: "HT60-96", truck: { Ktheta: 60000, Hrc: 24, Hbg: 72, Wcc: 96, maxSpan: 130, maxOverhang: 15, maxWeight: 262 } },
  { name: "HT70-96", truck: { Ktheta: 70000, Hrc: 24, Hbg: 72, Wcc: 96, maxSpan: 130, maxOverhang: 20, maxWeight: 262 } },
  { name: "HT80-96", truck: { Ktheta: 80000, Hrc: 24, Hbg: 72, Wcc: 96, maxSpan: 130, maxOverhang: 20, maxWeight: 262 } },
];

/** A span after the first: its length, and its own strands (null: the same as span 1). */
export type ExtraSpan = { L: number; strands: StrandRow[] | null; harped: HarpedStrands | null };
/** Longitudinal deck bars over the piers: top and bottom mats, with clear covers (top from the deck's top as cast). */
export type PierBars = { topBar: number; topSpacing: number; botBar: number; botSpacing: number; coverTop: number; coverBottom: number };

/** The defaults: an AASHTO-PCI BT-72, 120 ft span, six girders at 8 ft. */
export const GIRDER_DEFAULTS: GirderInputs = {
  shape: "bt-72",
  custom: { profile: GIRDER_SHAPES.find((s) => s.id === "bt-72")!.profile, web: 6, topWidth: 42 },
  L: 120,
  endDist: 0.75,
  nGirders: 6,
  S: 8,
  overhang: 3.5,
  barrierWidth: 1.5,
  skew: 0,
  deckT: 8.5,
  sacrificial: 0.5,
  haunch: 2,
  haunchInSection: false,
  fcDeck: 4,
  wcDeck: 0.15,
  fci: 6.5,
  fc: 8.5,
  wc: 0.15,
  K1: 1,
  strandDia: 0.6,
  fpu: 270,
  fpjRatio: 0.75,
  strands: [
    { y: 2, count: 12 },
    { y: 4, count: 12 },
    { y: 6, count: 4 },
  ],
  harped: { count: 4, yEnd: 64, yHarp: 6, harpPoint: 0.4 },
  losses: "refined",
  elasticGain: true,
  humidity: 70,
  tRelease: 1,
  tDeck: 90,
  tFinal: 2000,
  bearingLength: 12,
  bottomBars: { count: 0, bar: 5 },
  llDeflection: false,
  deflectionLimit: 800,
  diaphragms: 2,
  diaphragmWeight: 2.5,
  otherDC1: 0,
  barrierWeight: 0.4,
  barriersOnExterior: false,
  otherDC2: 0,
  fws: 25,
  stirrups: [
    { length: 1.75, bar: 5, legs: 2, spacing: 3.5 }, // splitting (5.9.4.4.1); 6 spaces
    { length: 10.5, bar: 5, legs: 2, spacing: 6 },
    { length: 30, bar: 4, legs: 2, spacing: 12 },
    { length: 0, bar: 4, legs: 2, spacing: 18 },
  ],
  stirrupsIntoDeck: true,
  fy: 60,
  criteria: "aashto",
  continuity: "auto",
  eta: 1,
  exposure: "moderate",
  rigidMethod: true,
  skewShearInterior: true, // 4.6.2.2.3c applied to every girder, as FHWA's design example does

  ag: 0.75,
  extraSpans: [],
  tContinuity: 90,
  pierBearingOffset: 1.25,
  restraintMoments: "all",
  pierBars: { topBar: 8, topSpacing: 5, botBar: 5, botSpacing: 6, coverTop: 2.5, coverBottom: 1 },
  connection: { count: 6, bar: 6, y: 3 },
  confinement: { bar: 3, spacing: 6, length: 12 }, // 1.5d of the deepest library girder (CBT 90) is 11.25 ft
  handling: HANDLING_DEFAULTS,
};

export const STRANDS: Record<0.5 | 0.6, { area: number; db: number }> = {
  0.5: { area: 0.153, db: 0.5 },
  0.6: { area: 0.217, db: 0.6 },
};

/**
 * The CDOT Bridge Design Manual's amendments to AASHTO LRFD for precast girders (criteria "cdot"):
 * - 5.3.1.2: f′ci ≤ 6.5 ksi and f′c ≤ 8.5 ksi without the Unit Leader's approval.
 * - 5.5.1.3: no tension in the precompressed tensile zone under dead load alone, after losses.
 * - 5.5.2.2: hold-down force ≤ 4.0 kip per harped strand.
 * - 5.7.2: restraint moments taken as zero (not computed); the positive moment connection resists 1.2 Mcr.
 * - 5.7.3: a continuity joint is fully effective only if the girders are at least 60 days old when it is
 *   cast; otherwise simple-span and continuous behavior are enveloped for all loads after continuity.
 * - Section 3.6: the Colorado Permit Vehicle and EV3 at Strength II (γLL = 1.35), with HL-93's
 *   distribution factors, lanes and impact.
 * - 5.5.1.5 and sheet B-618-CBT2: the top harped strand at most 6 in below the girder's top and 60–66 in
 *   high (by the bed; 60 used), no harped strands in girders under 100 ft, harp points at 0.35–0.45 L,
 *   and at most 2,800 kip of jacking force on the bed.
 * - 5.5.1.6: stirrups at most 18 in apart.
 * - 5.5.1.8: shipping and handling are the fabricator's design: lifting and hauling are shown, not checked.
 * - 5.5.1.9: girders up to 154 ft and 240 kip ship along the Front Range; longer or heavier, coordinate.
 * - 5.5.2.1: camber at deck placement at 60 days, ±30% on a CBT (at least ±1 in); dead load deflections
 *   without long-term multipliers; minimum haunches; no sag; the dead load haunch by Eq. 5.1.
 */
export const CDOT = {
  maxFci: 6.5,
  maxFc: 8.5,
  holdDownPerStrand: 4.0,
  continuityAge: 60,
  gammaStrengthII: 1.35,
  connectionMcr: 1.2,
  harpBelowTop: 6, // in
  maxHarpHeight: 60, // in
  harpMinLength: 100, // ft
  maxBedForce: 2800, // kip
  maxStirrupSpacing: 18, // in
  shipLength: 154, // ft
  shipWeight: 240, // kip
  camberAge: 60, // days
  camberTolerance: 0.3, // of the predicted camber (CBT)
  camberToleranceMin: 1, // in
  haunchSupport: { panels: 1.5, none: 0.5 }, // in, at the supports
  haunchBetween: { panels: 1, none: 0 }, // in, between the supports
};
/** Strength II vehicles (BDM 3.6): axle loads (kip, twice the rating workbook's wheel lines) and spacings. */
export const STRENGTH_II_VEHICLES: { name: string; axles: Axle[] }[] = ["CO Permit", "EV3"].map((name) => {
  const v = CDOT_VEHICLES.find((x) => x.name === name)!;
  return { name: name === "CO Permit" ? "Colorado Permit Vehicle" : name, axles: axlesOf(v.P.map((p) => 2 * p), v.S) };
});
const isCdot = (i: Pick<GirderInputs, "criteria">) => i.criteria === "cdot";

export const EP = 28500; // ksi, 5.4.4.2
export const ES = 29000; // ksi, 5.4.3.2

// --- helpers ---------------------------------------------------------------------------------------

const rad = (d: number) => (d * Math.PI) / 180;
const sqrt = Math.sqrt;

/** Ec, 5.4.2.4-1 (ksi; w in kcf, f'c in ksi). */
export const modulus = (K1: number, wc: number, fc: number) => 120000 * K1 * wc ** 2 * fc ** 0.33;
/** α1, 5.6.2.2. */
export const alpha1 = (fc: number) => (fc <= 10 ? 0.85 : Math.max(0.75, 0.85 - 0.02 * (fc - 10)));
/** β1, 5.6.2.2. */
export const beta1 = (fc: number) => Math.min(0.85, Math.max(0.65, 0.85 - 0.05 * (fc - 4)));

export function girderShape(i: GirderInputs): GirderShape {
  if (i.shape === "custom") {
    const p = i.custom.profile;
    if (p.length < 2) throw new DesignError("The custom section needs an outline.");
    return { id: "custom", name: "Custom section", family: "Custom", depth: p[p.length - 1][0] - p[0][0], topWidth: i.custom.topWidth, web: i.custom.web, profile: p };
  }
  const s = shapeById(i.shape);
  if (!s) throw new DesignError("Pick a girder section.");
  return s;
}

/** Simple-span moment (kip·ft) and shear (kip) at x from a uniform load w (klf). */
const uniform = (w: number, L: number, x: number) => ({ M: (w * x * (L - x)) / 2, V: w * (L / 2 - x) });
/** From a point load P at a. */
const point = (P: number, a: number, L: number, x: number) => ({ M: a <= x ? (P * a * (L - x)) / L : (P * x * (L - a)) / L, V: a <= x ? -(P * a) / L : (P * (L - a)) / L });

// --- live load (HL-93, 3.6.1.2) ---------------------------------------------------------------------

type Axle = { P: number; d: number }; // d: from the first axle
const truck = (rear: number): Axle[] => [
  { P: 8, d: 0 },
  { P: 32, d: 14 },
  { P: 32, d: 14 + rear },
];
const TANDEM: Axle[] = [
  { P: 25, d: 0 },
  { P: 25, d: 4 },
];
const LANE = 0.64; // klf

/** The most moment and shear an axle group gives at x, moved both ways along the span. */
function axleEnvelope(axles: Axle[], L: number, x: number) {
  let M = 0;
  let V = 0;
  for (const dir of [1, -1]) {
    // Positions where an axle sits on the section, or just past it (for shear).
    for (const lead of axles) {
      for (const eps of [0, 1e-6]) {
        const start = x + eps - dir * lead.d; // position of the first axle
        let m = 0;
        let v = 0;
        for (const a of axles) {
          const pos = start + dir * a.d;
          if (pos < 0 || pos > L) continue;
          const f = point(a.P, pos, L, x);
          m += f.M;
          v += f.V;
        }
        M = Math.max(M, m);
        V = Math.max(V, Math.abs(v));
      }
    }
  }
  return { M, V };
}

/** Per lane: the design truck or tandem (with IM), plus the lane load, at x. */
export function liveLoad(L: number, x: number, IM = 0.33) {
  const trucks = [14, 30].map((r) => axleEnvelope(truck(r), L, x));
  const tr = { M: Math.max(...trucks.map((t) => t.M)), V: Math.max(...trucks.map((t) => t.V)) };
  const td = axleEnvelope(TANDEM, L, x);
  const laneM = (LANE * x * (L - x)) / 2;
  const laneV = (LANE * Math.max(L - x, x) ** 2) / (2 * L); // the longer part loaded
  const M = Math.max(tr.M, td.M) * (1 + IM) + laneM;
  const V = Math.max(tr.V, td.V) * (1 + IM) + laneV;
  return { M, V, truckM: tr.M, tandemM: td.M, truckV: tr.V, tandemV: td.V, laneM, laneV };
}

// --- distribution factors (4.6.2.2), cross-section type (k) ---------------------------------------

export type DistFactors = {
  moment: number;
  shear: number;
  /** For the fatigue truck: the one-lane moment factor without the multiple presence factor (3.6.1.4.3b). */
  fatigue: number;
  // the working
  Kg: number;
  eg: number;
  n: number;
  lanes: number;
  momentOne: number;
  momentMulti: number;
  shearOne: number;
  shearMulti: number;
  lever?: number;
  rigid?: number;
  e?: { moment: number; shear: number };
  skewMoment: number;
  skewShear: number;
  governs: { moment: string; shear: string };
  outOfRange: string[];
};

/** Lever rule (4.6.2.2.2d): the exterior girder's share of one lane, 1.2 multiple presence. */
/**
 * The lever rule for an interior or exterior girder (4.6.2.2.2, C4.6.2.2.1): the deck as simple spans between
 * girders (cantilevered past the outer ones), design trucks' wheel lines 6 ft apart in 12 ft lanes side by side,
 * each wheel 2 ft or more from its lane's edge, the lanes anywhere across the roadway; the most a girder takes
 * per lane with the multiple presence factor (T. 3.6.1.1.2-1). One lane (with 1.2), more lanes, and the larger.
 */
export function leverRuleAll(nGirders: number, S: number, overhang: number, barrierWidth: number, exterior: boolean) {
  const z = Array.from({ length: nGirders }, (_, k) => (k - (nGirders - 1) / 2) * S);
  const target = exterior ? 0 : Math.floor((nGirders - 1) / 2);
  const share = (x: number) => {
    // The target girder's share of a unit load at x.
    if (x <= z[0]) return target === 0 ? 1 + (z[0] - x) / S : target === 1 ? -(z[0] - x) / S : 0;
    if (x >= z[nGirders - 1]) return target === nGirders - 1 ? 1 + (x - z[nGirders - 1]) / S : target === nGirders - 2 ? -(x - z[nGirders - 1]) / S : 0;
    const j = Math.min(nGirders - 2, Math.floor((x - z[0]) / S));
    if (target === j) return (z[j + 1] - x) / S;
    if (target === j + 1) return (x - z[j]) / S;
    return 0;
  };
  const left = z[0] - overhang + barrierWidth;
  const width = 2 * (overhang - barrierWidth) + (nGirders - 1) * S;
  const lanesMax = Math.max(1, Math.floor(width / 12));
  const mpf = (k: number) => (k <= 1 ? 1.2 : k === 2 ? 1 : k === 3 ? 0.85 : 0.65);
  let one = 0;
  let multi = 0;
  let lanesAt = 1;
  for (let k = 1; k <= lanesMax; k++) {
    let most = 0;
    const room = width - 12 * k;
    for (let a = 0; a <= room + 1e-9; a += 0.25)
      for (let d = 5; d <= 7 + 1e-9; d += 0.25) {
        let r = 0;
        for (let j = 0; j < k; j++) {
          const c = left + a + 12 * j + d;
          r += 0.5 * (share(c - 3) + share(c + 3));
        }
        most = Math.max(most, r);
      }
    const g = mpf(k) * most;
    if (k === 1) one = g;
    else if (g > multi) {
      multi = g;
      if (g > one) lanesAt = k;
    }
  }
  return { one, multi, best: Math.max(one, multi), lanes: multi > one ? lanesAt : 1 };
}

export function leverRule(S: number, de: number) {
  // Wheels 2 ft from the barrier face and 6 ft apart; the barrier face is de outside the exterior web.
  const w1 = 2 - de;
  const w2 = w1 + 6;
  const r = (x: number) => (x < S ? (0.5 * (S - x)) / S : 0);
  return 1.2 * (r(w1) + r(w2));
}

/** Rigid cross-section (4.6.2.2.2d-1): the most lanes' reaction on the exterior girder, with m. */
export function rigidSection(nGirders: number, S: number, de: number, lanes: number) {
  const xs = Array.from({ length: nGirders }, (_, k) => (k - (nGirders - 1) / 2) * S);
  const xExt = xs[xs.length - 1];
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const mpf = [1.2, 1, 0.85, 0.65];
  let best = 0;
  for (let nl = 1; nl <= Math.max(1, lanes); nl++) {
    let sumE = 0;
    for (let k = 0; k < nl; k++) sumE += xExt + de - 2 - 3 - 12 * k; // truck 2 ft off the lane edge, lanes from the barrier face
    const R = nl / nGirders + (xExt * sumE) / sumX2;
    best = Math.max(best, mpf[Math.min(nl, 4) - 1] * R);
  }
  return best;
}

/** Distribution factors for a girder (n: Ec girder / Ec deck; deckCg: the deck's centroid above the girder's bottom). */
export function distributionFactors(i: GirderInputs, g: SectionProps, ts: number, n: number, deckCg: number, exterior: boolean): DistFactors {
  const { S, L, nGirders } = i;
  const eg = deckCg - g.yb; // in
  const Kg = n * (g.I + g.A * eg ** 2); // in⁴, 4.6.2.2.1-1
  const roadway = (nGirders - 1) * S + 2 * i.overhang - 2 * i.barrierWidth;
  const lanes = Math.max(1, Math.floor(roadway / 12)); // 3.6.1.1.1
  if (i.distribution === "lever-rule") {
    const lv = leverRuleAll(nGirders, S, i.overhang, i.barrierWidth, exterior);
    return { moment: lv.best, shear: lv.best, fatigue: lv.one / 1.2, Kg, eg, n, lanes, momentOne: lv.one, momentMulti: lv.multi, shearOne: lv.one, shearMulti: lv.multi, lever: lv.best, skewMoment: 1, skewShear: 1, governs: { moment: `lever rule, ${lv.lanes} lane${lv.lanes > 1 ? "s" : ""}`, shear: `lever rule, ${lv.lanes} lane${lv.lanes > 1 ? "s" : ""}` }, outOfRange: [] };
  }
  const stiff = (Kg / (12 * L * ts ** 3)) ** 0.1;
  const momentOne = 0.06 + (S / 14) ** 0.4 * (S / L) ** 0.3 * stiff; // T. 4.6.2.2.2b-1
  const momentMulti = 0.075 + (S / 9.5) ** 0.6 * (S / L) ** 0.2 * stiff;
  const shearOne = 0.36 + S / 25; // T. 4.6.2.2.3a-1
  const shearMulti = 0.2 + S / 12 - (S / 35) ** 2;
  const out: string[] = [];
  if (S < 3.5 || S > 16) out.push(`Girder spacing ${S} ft is outside 3.5–16 ft`);
  if (ts < 4.5 || ts > 12) out.push(`Deck ${ts} in is outside 4.5–12 in`);
  if (L < 20 || L > 240) out.push(`Span ${L} ft is outside 20–240 ft`);
  if (nGirders < 4) out.push(`${nGirders} girders: AASHTO's equations need at least 4 (use the lever rule)`);
  if (Kg < 10000 || Kg > 7000000) out.push(`Kg ${Math.round(Kg)} in⁴ is outside 10,000–7,000,000 in⁴`);

  // Skew (4.6.2.2.2e, 4.6.2.2.3c), θ up to 60°.
  const th = Math.min(i.skew, 60);
  const c1 = th < 30 ? 0 : 0.25 * (Kg / (12 * L * ts ** 3)) ** 0.25 * (S / L) ** 0.5;
  const skewMoment = th < 30 ? 1 : 1 - c1 * Math.tan(rad(th)) ** 1.5;
  const skewShearRaw = th > 0 ? 1 + 0.2 * ((12 * L * ts ** 3) / Kg) ** 0.3 * Math.tan(rad(th)) : 1;
  const skewShear = exterior || i.skewShearInterior ? skewShearRaw : 1;

  if (!exterior) {
    const m = Math.max(momentOne, lanes > 1 ? momentMulti : 0);
    const v = Math.max(shearOne, lanes > 1 ? shearMulti : 0);
    return {
      moment: m * skewMoment,
      shear: v * skewShear,
      fatigue: (momentOne * skewMoment) / 1.2,
      Kg,
      eg,
      n,
      lanes,
      momentOne,
      momentMulti,
      shearOne,
      shearMulti,
      skewMoment,
      skewShear,
      governs: { moment: m === momentOne ? "one lane" : "two or more lanes", shear: v === shearOne ? "one lane" : "two or more lanes" },
      outOfRange: out,
    };
  }
  // Exterior girder: lever rule for one lane, e·g(interior) for more (T. 4.6.2.2.2d-1, 4.6.2.2.3b-1).
  const de = i.overhang - i.barrierWidth; // ft, exterior web to the barrier's inside face
  if (de < -1 || de > 5.5) out.push(`de ${de.toFixed(2)} ft is outside −1.0 to 5.5 ft`);
  const lever = leverRule(S, de);
  const eM = 0.77 + de / 9.1;
  const eV = 0.6 + de / 10;
  const multiM = lanes > 1 ? eM * momentMulti : 0;
  const multiV = lanes > 1 ? eV * shearMulti : 0;
  const rigid = i.rigidMethod ? rigidSection(nGirders, S, de, lanes) : 0;
  const mCandidates: [number, string][] = [
    [lever, "one lane, lever rule"],
    [multiM, "two or more lanes, e·g interior"],
    [rigid, "rigid cross-section (4.6.2.2.2d)"],
  ];
  const vCandidates: [number, string][] = [
    [lever, "one lane, lever rule"],
    [multiV, "two or more lanes, e·g interior"],
    [rigid, "rigid cross-section (4.6.2.2.2d)"],
  ];
  const [m, mWhy] = mCandidates.reduce((a, b) => (b[0] > a[0] ? b : a));
  const [v, vWhy] = vCandidates.reduce((a, b) => (b[0] > a[0] ? b : a));
  // Fatigue: one lane, its multiple presence factor taken out (the lever rule and rigid section include 1.2).
  const oneLane = Math.max(lever, i.rigidMethod ? rigidSection(nGirders, S, de, 1) : 0);
  return {
    moment: m * skewMoment,
    shear: v * skewShear,
    fatigue: (oneLane * skewMoment) / 1.2,
    Kg,
    eg,
    n,
    lanes,
    momentOne,
    momentMulti,
    shearOne,
    shearMulti,
    lever,
    rigid: i.rigidMethod ? rigid : undefined,
    e: { moment: eM, shear: eV },
    skewMoment,
    skewShear,
    governs: { moment: mWhy, shear: vWhy },
    outOfRange: out,
  };
}

// --- composite section --------------------------------------------------------------------------

export type Composite = {
  beff: number; // in, effective flange width (4.6.2.6.1)
  ts: number; // in, structural deck
  hh: number; // in, haunch in the section
  n: number; // Ec deck / Ec girder (transforms the deck)
  A: number;
  I: number;
  yb: number; // in, from the bottom of the girder
  Sbc: number; // bottom of the girder
  Stc: number; // top of the girder
  Std: number; // top of the deck (transformed: deck stress = n·M/Std)
  h: number; // in, total depth
  deckCg: number; // in, deck centroid above the bottom of the girder
};

function composite(i: GirderInputs, shape: GirderShape, g: SectionProps, beff: number, n: number): Composite {
  const ts = i.deckT - i.sacrificial;
  const hh = i.haunchInSection ? i.haunch : 0;
  const H = shape.depth;
  const parts = [
    { A: g.A, y: g.yb, I: g.I },
    ...(hh > 0 ? [{ A: shape.topWidth * hh * n, y: H + hh / 2, I: (shape.topWidth * n * hh ** 3) / 12 }] : []),
    { A: beff * ts * n, y: H + hh + ts / 2, I: (beff * n * ts ** 3) / 12 },
  ];
  const A = parts.reduce((s, p) => s + p.A, 0);
  const yb = parts.reduce((s, p) => s + p.A * p.y, 0) / A;
  const I = parts.reduce((s, p) => s + p.I + p.A * (p.y - yb) ** 2, 0);
  const h = H + hh + ts;
  return { beff, ts, hh, n, A, I, yb, Sbc: I / yb, Stc: I / (H - yb), Std: I / (h - yb), h, deckCg: H + hh + ts / 2 };
}

// --- flexural resistance (5.6.3), by strain compatibility with the stress block -----------------

type Flexure = { c: number; a: number; fps: number; fpsRaw: number; T: number; Mn: number; dp: number; dt: number; arm: number; et: number; phi: number; rect: boolean };

/** Strands acting at a section, for flexure: area, height, and the stress their development allows (null: fully developed). */
type FlexStrands = { A: number; y: number; cap: number | null }[];

function flexuralResistance(i: GirderInputs, shape: GirderShape, comp: Composite, groups: FlexStrands): Flexure {
  const H = shape.depth;
  const { ts, hh, beff, h } = comp;
  const active = groups.filter((s) => s.A > 0 && (s.cap === null || s.cap > 0));
  const Aps = active.reduce((a, s) => a + s.A, 0);
  if (Aps <= 0) return { c: 0, a: 0, fps: 0, fpsRaw: 0, T: 0, Mn: 0, dp: 0, dt: 0, arm: 0, et: 1, phi: 1, rect: true };
  const ybar = active.reduce((a, s) => a + s.A * s.y, 0) / Aps;
  const dp = h - ybar;
  const dt = h - Math.min(...active.map((s) => s.y));
  const k = 0.28; // low-relaxation, 5.6.3.1.1-2
  const b1 = beta1(i.fcDeck);
  const aD = alpha1(i.fcDeck);
  const aG = alpha1(i.fc);
  // Compression force (kip) and its depth from the top for a stress block of depth a.
  const block = (a: number) => {
    let C = 0;
    let Cy = 0;
    const add = (top: number, bot: number, width: (d: number) => number, stress: number) => {
      const t = Math.max(0, top);
      const b = Math.min(a, bot);
      if (b <= t) return;
      const steps = Math.max(4, Math.ceil((b - t) / 0.05));
      const dy = (b - t) / steps;
      for (let s = 0; s < steps; s++) {
        const d = t + (s + 0.5) * dy;
        const f = stress * width(d) * dy;
        C += f;
        Cy += f * d;
      }
    };
    add(0, ts, () => beff, aD * i.fcDeck);
    if (hh > 0) add(ts, ts + hh, () => shape.topWidth, aD * i.fcDeck);
    add(ts + hh, h, (d) => widthAt(shape.profile, H - (d - ts - hh)), aG * i.fc);
    return { C, depth: C > 0 ? Cy / C : 0 };
  };
  const tension = (c: number) => {
    const fps = i.fpu * (1 - (k * c) / dp);
    return active.reduce((t, s) => t + s.A * (s.cap === null ? fps : Math.min(fps, s.cap)), 0);
  };
  /** Each group's force and lever arm about the compression's centroid. */
  const moment = (c: number, depth: number) => {
    const fps = i.fpu * (1 - (k * c) / dp);
    return active.reduce((m, s) => m + s.A * (s.cap === null ? fps : Math.min(fps, s.cap)) * (h - s.y - depth), 0);
  };
  // Bisection on c: compression = tension.
  let lo = 1e-6;
  let hi = h;
  for (let it = 0; it < 80; it++) {
    const c = (lo + hi) / 2;
    if (block(b1 * c).C > tension(c)) hi = c;
    else lo = c;
  }
  const c = (lo + hi) / 2;
  const a = b1 * c;
  const T = tension(c);
  const { depth } = block(a);
  const Mn = moment(c, depth) / 12; // kip·ft
  const arm = T > 0 ? (Mn * 12) / T : dp - depth;
  const fps = T / Aps;
  const et = (0.003 * (dt - c)) / c;
  const ecl = 0.002;
  const phi = et >= 0.005 ? 1 : et <= ecl ? 0.75 : 0.75 + (0.25 * (et - ecl)) / (0.005 - ecl); // 5.5.4.2
  return { c, a, fps, fpsRaw: i.fpu * (1 - (k * c) / dp), T, Mn, dp, dt, arm, et, phi, rect: a <= ts };
}

// --- the design -------------------------------------------------------------------------------------

export type Station = {
  x: number; // ft from the bearing
  label: string;
  transfer: number; // fraction of prestress transferred
  // unfactored, per girder
  Mg: number;
  Mdeck: number; // deck, haunch, diaphragms, other DC1 (non-composite)
  Mdc2: number;
  Mdw: number;
  Mll: number; // with IM and the distribution factor
  Vdc: number;
  Vdw: number;
  Vll: number;
  // stresses (ksi, compression +)
  release: { top: number; bot: number; psTop: number; psBot: number }; // with self-weight; prestress alone
  service: { topPerm: number; topTotal: number; deckPerm: number; deckTotal: number; botIII: number; botDL: number; botPerm?: number; botTotal?: number; fss?: number };
  /** CDOT (BDM 3.6): Strength II from the permit vehicle or EV3, the larger (with the distribution factors). Mu and Vu above are the larger of Strength I and II. */
  strengthII?: { vehicle: string; Mll: number; Vll: number; Mu: number; Vu: number; MllNeg: number; MuNeg: number };
  strengthIIGoverns?: boolean;
  // strength
  Mu: number;
  phiMn: number;
  Mcr: number;
  Vu: number;
  phiVn?: number;
  shear?: ShearResult;
  longitudinal?: { demand: number; capacity: number; side: "bottom" | "top" }; // kip, 5.7.3.5-1
  pier?: boolean; // the girder's end over a pier (continuous)
  /** Continuous spans: the negative moment side (composite loads at their continuous values, kip·ft). */
  negative?: { Mdc2: number; Mdw: number; Mr: number; Mll: number; df: number; governs: string; Mu: number; inRegion: boolean };
  /** Fatigue I (5.5.3.1): the fatigue truck's moment with its distribution factor (no IM), and the compression it gives with half the permanent stresses, ksi. */
  fatigue: { Mfat: number; top: number; MfatNeg?: number; bot?: number };
  /** Principal tension in the web at Service III (5.9.2.3.3), where it applies: the largest over the web's elevations. */
  principal?: PrincipalTension;
};

export type PrincipalTension = { ft: number; y: number; where: string; fpcx: number; tau: number; V: number; Vp: number; Q: number; bw: number };

export type ShearResult = { dv: number; bv: number; es: number; beta: number; theta: number; Vc: number; Vs: number; Vp: number; Vn: number; Vmax: number; phiV: number; Av: number; s: number; Avmin: number; smax: number; needsAv: boolean; vu: number; interface: { vui: number; Vui: number; Vni: number; phiVni: number; Avf: number; Avfmin: number; needsMin: boolean } };

export type GirderResult = ReturnType<typeof designGirderLine>;

/** A span of a continuous bridge, as its girder line sees it. */
type SpanContext = {
  index: number; // the span, from 0
  n: number; // spans in the bridge
  beam: ContinuousBeam;
  spans: number[]; // ft, bearing to bearing
  La: number; // ft, this span on the continuous beam (to the piers' centerlines)
  shift: number; // ft, the girder's left bearing on the beam's span
  contLeft: boolean; // continuous over a pier at its left end
  contRight: boolean;
  live: (x: number) => LiveEnvelope; // per lane, cached
  unit: (x: number) => { M: number; V: number }; // a uniform 1 klf on every span
  restraint: { left: number; right: number }; // kip·ft, the restraint moments at its ends (this girder line)
  simpleToo: boolean; // a joint at its end isn't fully effective: positive moments also as a simple span
  strengthII?: (x: number) => StrengthIIEnvelope; // CDOT: per lane, cached
};
type StrengthIIEnvelope = { Mpos: number; Mneg: number; V: number; name: string };

/** The Strength II vehicles' envelope per lane at x in span s of a beam (IM 33%): the largest of each effect, and the vehicle with the largest positive moment. */
function strengthIIAt(beam: ContinuousBeam, s: number, x: number): StrengthIIEnvelope {
  let out: StrengthIIEnvelope = { Mpos: 0, Mneg: 0, V: 0, name: STRENGTH_II_VEHICLES[0].name };
  for (const v of STRENGTH_II_VEHICLES) {
    const e = beam.vehicleEnvelope(s, x, v.axles, 0.33);
    out = { Mpos: Math.max(out.Mpos, e.Mpos), Mneg: Math.min(out.Mneg, e.Mneg), V: Math.max(out.V, e.V), name: e.Mpos > out.Mpos ? v.name : out.name };
  }
  return out;
}

function designGirderLine(i: GirderInputs, exterior: boolean, ctx: SpanContext | null = null) {
  const shape = girderShape(i);
  const g = profileProps(shape.profile);
  const H = shape.depth;
  const Eci = modulus(i.K1, i.wc, i.fci);
  const Ec = modulus(i.K1, i.wc, i.fc);
  const Ecd = modulus(1, i.wcDeck, i.fcDeck);
  const nDeck = Ecd / Ec;
  const ts = i.deckT - i.sacrificial;
  const beff = (exterior ? i.S / 2 + i.overhang : i.S) * 12; // 4.6.2.6.1, the tributary width
  const comp = composite(i, shape, g, beff, nDeck);
  const df = distributionFactors(i, g, ts, Ec / Ecd, comp.deckCg, exterior);
  // A span of a continuous bridge: stations over its whole length, loads after continuity on the
  // continuous beam. For negative moment, L is the average of the two spans at the pier (T. 4.6.2.2.1-2).
  const full = !!ctx && ctx.n > 1;
  const dfAtPier = (other: number) => distributionFactors({ ...i, L: (other + i.L) / 2 }, g, ts, Ec / Ecd, comp.deckCg, exterior);
  const dfNegL = ctx && ctx.contLeft ? dfAtPier(ctx.spans[ctx.index - 1]) : df;
  const dfNegR = ctx && ctx.contRight ? dfAtPier(ctx.spans[ctx.index + 1]) : df;
  const dfNegAt = (x: number) => (x < i.L / 2 ? dfNegL : dfNegR);
  const cdot = isCdot(i);
  let simple: ContinuousBeam | null = null;
  const simpleBeam = () => (simple ??= continuousBeam([i.L]));

  // --- strands ------------------------------------------------------------------------------------
  const strand = STRANDS[i.strandDia];
  const Lg = i.L + 2 * i.endDist;
  const groups = strandGroups(i, H, Lg);
  const N = groups.reduce((s, k) => s + k.n, 0);
  if (N <= 0) throw new DesignError("Add strands.");
  for (const k of groups)
    for (const xe of [0, Lg / 2]) {
      const y = k.yAt(xe);
      if (y > 0 && y < H) continue;
      const span = ctx && ctx.n > 1 ? `Span ${ctx.index + 1}: the` : "The";
      const where = k.kind === "harped" ? `harped strands' centroid ${xe === 0 ? "at the girder's ends" : "at the harp points"} (${y.toFixed(2)} in)` : `straight row at ${y.toFixed(2)} in`;
      throw new DesignError(`${span} ${where} is outside the ${shape.name}, which is ${H} in deep. Change it under Strands.`);
    }
  const Aps = groups.reduce((s, k) => s + k.A, 0);
  const lt = (60 * strand.db) / 12; // ft, transfer length 5.9.4.3.1
  /** The strands acting at a section xe ft from the girder's end, each with its fraction transferred. */
  const at = (xe: number) =>
    groups.map((k) => {
      const lpx = Math.min(xe, Lg - xe) - k.bondFrom; // from the nearer end (the girder is symmetric)
      return { k, y: k.yAt(xe), tf: lpx <= 0 ? 0 : Math.min(1, lpx / lt), lpx };
    });
  const mid = at(Lg / 2);
  const ybar = mid.reduce((s, m) => s + m.k.A * m.y, 0) / Aps;
  const e = g.yb - ybar; // in, at midspan
  /** Prestress at a section for a strand stress fp: force, its moment about the girder's centroid, and Vp. */
  const prestress = (xe: number, fp: number) => {
    let P = 0;
    let Pe = 0;
    let Vp = 0;
    for (const m of at(xe)) {
      const F = m.k.A * fp * m.tf;
      P += F;
      Pe += F * (g.yb - m.y);
      Vp += F * m.k.slope(xe);
    }
    return { P, Pe, Vp, e: P > 0 ? Pe / P : 0 };
  };

  // --- loads, per girder (klf / kip) ---------------------------------------------------------------
  const wg = (g.A / 144) * (i.wcLoad ?? i.wc);
  const trib = exterior ? i.S / 2 + i.overhang : i.S;
  const wDeck = ((i.deckT / 12) * trib + (i.haunch / 12) * (shape.topWidth / 12)) * (i.wcDeckLoad ?? i.wcDeck) + i.otherDC1;
  const wBarrier = i.barriersOnExterior ? (exterior ? i.barrierWeight : 0) : (2 * i.barrierWeight) / i.nGirders;
  const wDC2 = wBarrier + i.otherDC2;
  const roadway = (i.nGirders - 1) * i.S + 2 * i.overhang - 2 * i.barrierWidth;
  const wDW = ((i.fws / 1000) * roadway) / i.nGirders;
  const diaphragmAt = Array.from({ length: i.diaphragms }, (_, k) => ((k + 1) * i.L) / (i.diaphragms + 1));
  const Pdia = exterior ? i.diaphragmWeight / 2 : i.diaphragmWeight; // diaphragms on one side of an exterior girder
  const deckMoment = (x: number) => diaphragmAt.reduce((m, a) => m + point(Pdia, a, i.L, x).M, uniform(wDeck, i.L, x).M);

  // --- losses (5.9.3) ---------------------------------------------------------------------------------
  const fpj = i.fpjRatio * i.fpu;
  const MgRelease = ((wg * Lg ** 2) / 8) * 12; // kip·in at midspan, on the girder's length
  // Elastic shortening, 5.9.3.2.3a, solved directly: fpt = fpj − (Ep/Eci)·fcgp(fpt).
  const r = EP / Eci;
  const fpt = (fpj + (r * MgRelease * e) / g.I) / (1 + r * Aps * (1 / g.A + e ** 2 / g.I));
  const fcgp = Aps * fpt * (1 / g.A + e ** 2 / g.I) - (MgRelease * e) / g.I;
  const dES = fpj - fpt;
  const Msidl = (full ? (wDC2 + wDW) * ctx!.unit(i.L / 2).M : uniform(wDC2 + wDW, i.L, i.L / 2).M) * 12; // kip·in at midspan
  const lossDetail =
    i.losses === "refined"
      ? refinedLosses({ i, g, comp, Aps, e, fpt, fcgp, Eci, Ec, Ecd, Mdeck: deckMoment(i.L / 2) * 12, Msidl })
      : approximateLosses({ i, g, Aps, fpj });
  const dLT = lossDetail.total;
  const fpe = fpt - dLT;
  const fpDeck = fpt - lossDetail.toDeck; // before the deck is cast (for camber)
  const gains = i.losses === "refined" && i.elasticGain;
  const gammaLL3 = gains ? 1.0 : 0.8; // Service III, T. 3.4.1-4
  // Msidl (kip·in): the superimposed loads' midspan moment the losses use (on the continuous beam even where a joint's positive moments are enveloped: the smaller, conservative here).
  const losses = { method: i.losses, fpj, fpt, fpe, fpDeck, dES, dLT, fcgp, Eci, Ec, Ecd, Msidl, ...lossDetail };

  // --- development length (5.9.4.3.2), κ = 1.6 (deeper than 24 in) or 2.0 for debonded strands ----
  const fullFlex = flexuralResistance(i, shape, comp, mid.map((m) => ({ A: m.k.A, y: m.y, cap: null })));
  const fps0 = fullFlex.fps;
  const ldOf = (kappa: number) => (kappa * (fps0 - (2 / 3) * fpe) * strand.db) / 12; // ft
  /** The strand stress a group can develop at a section (null: fully developed). */
  const cap = (lpx: number, kappa: number) => {
    const ld = ldOf(kappa);
    if (lpx <= 0) return 0;
    if (lpx >= ld) return null;
    if (lpx <= lt) return (fpe * lpx) / lt;
    return fpe + ((lpx - lt) / (ld - lt)) * (fps0 - fpe);
  };
  const flexAt = (xe: number) => flexuralResistance(i, shape, comp, at(xe).map((m) => ({ A: m.k.A, y: m.y, cap: cap(m.lpx, m.k.kappa) })));
  const flexMid = fullFlex;
  const ld = ldOf(H > 24 ? 1.6 : 1.0);

  // Debonded region: φv = 0.85 from the end to the last debond termination (5.5.4.2, 8th ed. on).
  const lastDebond = Math.max(0, ...groups.filter((k) => k.kind === "debonded").map((k) => k.bondFrom));

  // --- stations ----------------------------------------------------------------------------------------
  // 5.7.3.2: the critical section is dv from the internal face of the support (the bearing's inside
  // edge), with dv at that section (5.7.2.8, as the stations work it out): found by iteration.
  const dvAt = (x: number) => {
    const xe = x + i.endDist;
    const f = flexAt(xe);
    const tens = at(xe).filter((m) => m.y < comp.h / 2 && m.tf > 0);
    const fT = (m: (typeof tens)[number]) => {
      const c = cap(m.lpx, m.k.kappa);
      return m.k.A * (c === null ? f.fpsRaw : Math.min(f.fpsRaw, c));
    };
    const Tt = tens.reduce((s, m) => s + fT(m), 0);
    const de = Tt > 0 ? tens.reduce((s, m) => s + fT(m) * (comp.h - m.y), 0) / Tt : f.dp;
    return Math.max(f.arm, 0.9 * de, 0.72 * comp.h);
  };
  const face = i.bearingLength / 24;
  let xCrit = face + Math.max(flexMid.arm, 0.9 * flexMid.dp, 0.72 * comp.h) / 12;
  for (let k = 0; k < 6; k++) {
    const next = face + dvAt(xCrit) / 12;
    if (Math.abs(next - xCrit) < 1e-4) break;
    xCrit = next;
  }
  const xs: { x: number; label: string; pier: boolean }[] = [];
  const xMax = full ? i.L : i.L / 2;
  const addX = (x: number, label: string, pier = false) => {
    if ((pier || x > 1e-6) && x <= xMax + 1e-9 && !xs.some((s) => Math.abs(s.x - x) < 0.01)) xs.push({ x, label, pier });
  };
  /** A station, and on a span of a continuous bridge its mirror from the right end too. */
  const addBoth = (x: number, label: string) => {
    addX(x, label);
    if (full) addX(i.L - x, `${label} (right end)`);
  };
  if (ctx?.contLeft) addX(0, "Pier (left end)", true);
  if (ctx?.contRight) addX(i.L, "Pier (right end)", true);
  for (let k = 1; k <= (full ? 9 : 5); k++) addX((k * i.L) / 10, `${(k / 10).toFixed(1)}L`);
  addBoth(xCrit, "Shear critical section");
  addBoth(lt - i.endDist, "Transfer length");
  const harp = groups.find((k) => k.kind === "harped");
  if (harp) addBoth(i.harped.harpPoint * Lg - i.endDist, "Harp point");
  for (const L of [...new Set(groups.filter((k) => k.kind === "debonded").map((k) => k.bondFrom))]) addBoth(L + lt - i.endDist, `Debonded strands transferred (${L} ft)`);
  xs.sort((a, b) => a.x - b.x);
  const neg = full ? negativeSection(i, shape, comp, Ec) : null;

  const fr = 0.24 * sqrt(i.fc); // 5.4.2.6
  // Principal tension in the web applies to pretensioned girders with f′c over 10 ksi (5.9.2.3.3).
  const principalApplies = i.fc > 10;
  const webLevels = principalApplies ? webElevations(shape, g, comp) : [];
  /** First moment about the composite centroid of the transformed section above a height y (in, from the girder's bottom). */
  const firstMomentAbove = (y: number) => {
    let Q = 0;
    const steps = 400;
    const h = (H - y) / steps;
    for (let k = 0; k < steps; k++) {
      const eta = y + (k + 0.5) * h;
      Q += widthAt(shape.profile, eta) * h * (eta - comp.yb);
    }
    if (comp.hh > 0) Q += shape.topWidth * comp.hh * comp.n * (H + comp.hh / 2 - comp.yb);
    Q += comp.beff * comp.ts * comp.n * (comp.deckCg - comp.yb);
    return Q;
  };
  const stations: Station[] = xs.map(({ x, label, pier }) => {
    const xe = x + i.endDist; // ft from the girder's end
    const fRel = prestress(xe, fpt);
    const transfer = Aps > 0 ? fRel.P / (Aps * fpt) : 0;
    // Release: the girder alone on its length.
    const MgR = uniform(wg, Lg, xe).M * 12; // kip·in
    const release = { top: fRel.P / g.A - fRel.Pe / g.St + MgR / g.St, bot: fRel.P / g.A + fRel.Pe / g.Sb - MgR / g.Sb, psTop: fRel.P / g.A - fRel.Pe / g.St, psBot: fRel.P / g.A + fRel.Pe / g.Sb };

    // Service: on the bearings.
    const Mg = uniform(wg, i.L, x).M;
    let Mdeck = uniform(wDeck, i.L, x).M;
    let Vdeck = uniform(wDeck, i.L, x).V;
    for (const a of diaphragmAt) {
      const f = point(Pdia, a, i.L, x);
      Mdeck += f.M;
      Vdeck += f.V;
    }
    // Loads after continuity: on the simple span, or on the continuous beam (with the restraint moments).
    let Mdc2 = uniform(wDC2, i.L, x).M;
    let Mdw = uniform(wDW, i.L, x).M;
    let Vdc2 = uniform(wDC2, i.L, x).V;
    let Vdw = uniform(wDW, i.L, x).V;
    let Mll = 0;
    let Vll = 0;
    let negative: Station["negative"];
    let Vr = 0;
    let MrPos = 0;
    let MrNeg = 0;
    // The fatigue truck (3.6.1.4.1), per lane without IM.
    let fatPos = 0;
    let fatNeg = 0;
    // CDOT: Strength II vehicles (per lane with IM, then the distribution factors).
    let ii: { Mpos: number; Mneg: number; V: number; name: string } | null = null;
    if (!full) {
      const ll = liveLoad(i.L, x);
      Mll = ll.M * df.moment;
      Vll = ll.V * df.shear;
      fatPos = axleEnvelope(truck(30), i.L, x).M;
      if (cdot) ii = strengthIIAt(simpleBeam(), 0, x);
    } else {
      const c = ctx!;
      const u = c.unit(x);
      const env = c.live(x);
      fatPos = env.fatPos;
      fatNeg = env.fatNeg;
      const McDC2 = wDC2 * u.M;
      const McDW = wDW * u.M;
      const X = x + c.shift; // on the beam's span
      const Mr = c.restraint.left * (1 - X / c.La) + c.restraint.right * (X / c.La);
      Vr = (c.restraint.right - c.restraint.left) / c.La;
      const dfN = dfNegAt(x);
      // The negative moment side: the composite section's loads, at their continuous values.
      negative = { Mdc2: McDC2, Mdw: McDW, Mr: Math.min(0, Mr), Mll: env.Mneg * dfN.moment, df: dfN.moment, governs: env.negGoverns, Mu: 0, inRegion: u.M < 0 };
      Mll = env.Mpos * df.moment;
      Vll = env.V * df.shear;
      Mdc2 = McDC2;
      Mdw = McDW;
      Vdc2 = wDC2 * u.V;
      Vdw = wDW * u.V;
      MrPos = Math.max(0, Mr);
      MrNeg = Math.min(0, Mr);
      if (cdot) ii = c.strengthII!(x);
      if (c.simpleToo) {
        // A joint that isn't fully effective: the positive moments also as a simple span (5.12.3.3).
        const ll = liveLoad(i.L, x);
        Mdc2 = Math.max(Mdc2, uniform(wDC2, i.L, x).M);
        Mdw = Math.max(Mdw, uniform(wDW, i.L, x).M);
        Mll = Math.max(Mll, ll.M * df.moment);
        Vll = Math.max(Vll, ll.V * df.shear);
        fatPos = Math.max(fatPos, axleEnvelope(truck(30), i.L, x).M);
        MrPos = 0;
        if (ii) {
          const s = strengthIIAt(simpleBeam(), 0, x);
          ii = { ...ii, Mpos: Math.max(ii.Mpos, s.Mpos), V: Math.max(ii.V, s.V), name: s.Mpos > ii.Mpos ? s.name : ii.name };
        }
      }
    }
    const Vdc = uniform(wg, i.L, x).V + Vdeck + Vdc2;

    const Mnc = (Mg + Mdeck) * 12;
    const Mc = (Mdc2 + Mdw + MrPos) * 12;
    const ML = Mll * 12;
    // Elastic gains from the deck and superimposed loads (refined losses, by choice).
    const eHere = fRel.e;
    const epcHere = comp.yb - (g.yb - eHere);
    const gain = gains ? (EP / Ec) * ((Mdeck * 12 * eHere) / g.I + (Mc * epcHere) / comp.I) : 0;
    const fSvc = prestress(xe, fpe + gain);
    const pre = { top: fSvc.P / g.A - fSvc.Pe / g.St, bot: fSvc.P / g.A + fSvc.Pe / g.Sb };
    // CDOT BDM 5.5.1.1: with elastic gains and γLL = 1.0, the live load's elastic gain too (what a transformed
    // section includes implicitly; PGSuper's LiveLoadElasticGain), for the Service III tension.
    const gainLL = gains && cdot ? (EP / Ec) * ((gammaLL3 * ML * epcHere) / comp.I) : 0;
    const fIII = gainLL > 0 ? prestress(xe, fpe + gain + gainLL) : fSvc;
    const botIIIps = fIII.P / g.A + fIII.Pe / g.Sb;
    const service = {
      topPerm: pre.top + Mnc / g.St + Mc / comp.Stc,
      topTotal: pre.top + Mnc / g.St + (Mc + ML) / comp.Stc,
      deckPerm: (nDeck * Mc) / comp.Std,
      deckTotal: (nDeck * (Mc + ML)) / comp.Std,
      botIII: botIIIps - Mnc / g.Sb - Mc / comp.Sbc - (gammaLL3 * ML) / comp.Sbc, // T. 3.4.1-4
      botDL: pre.bot - Mnc / g.Sb - Mc / comp.Sbc, // dead load alone, after losses (CDOT BDM 5.5.1.3)
    };

    // Strength I (T. 3.4.1-1): the maximum factors, or the minimum where a load relieves (DC 0.90,
    // DW 0.65); restraint moments (CR, SH) at 1.0 (T. 3.4.1-3).
    // Each dead load at the factor that gives the extreme (girder, deck, barriers and overlay separately, as PGSuper).
    const up = (M: number, hi: number, lo: number) => (M >= 0 ? hi : lo) * M; // for the most positive
    const down = (M: number, hi: number, lo: number) => (M < 0 ? hi : lo) * M; // for the most negative
    const MuDead = up(Mg, 1.25, 0.9) + up(Mdeck, 1.25, 0.9) + up(Mdc2, 1.25, 0.9) + up(Mdw, 1.5, 0.65) + MrPos;
    const VuDead = 1.25 * Math.abs(Vdc) + 1.5 * Math.abs(Vdw) + Math.abs(Vr);
    const MuI = i.eta * (MuDead + 1.75 * Mll);
    const VuI = i.eta * (VuDead + 1.75 * Vll);
    // Strength II (CDOT BDM 3.6): the permit vehicle or EV3, γLL = 1.35, the same distribution factors.
    let strengthII: Station["strengthII"];
    if (ii) {
      const MllII = ii.Mpos * df.moment;
      const VllII = ii.V * df.shear;
      strengthII = { vehicle: ii.name, Mll: MllII, Vll: VllII, Mu: i.eta * (MuDead + CDOT.gammaStrengthII * MllII), Vu: i.eta * (VuDead + CDOT.gammaStrengthII * VllII), MllNeg: 0, MuNeg: 0 };
    }
    const Mu = Math.max(MuI, strengthII?.Mu ?? -Infinity);
    const Vu = Math.max(VuI, strengthII?.Vu ?? -Infinity);
    const flex = flexAt(xe);
    const phiMn = flex.phi * flex.Mn;
    // Cracking moment, 5.6.3.3-1: γ1 = 1.6, γ2 = 1.1, γ3 = 1.0 (prestressing steel).
    const fcpe = prestress(xe, fpe).P / g.A + prestress(xe, fpe).Pe / g.Sb;
    const Mcr = Math.max(0, (1.6 * fr + 1.1 * fcpe) * comp.Sbc - Mnc * (comp.Sbc / g.Sb - 1)) / 12;

    // Fatigue I (T. 3.4.1-1, γ = 1.75; IM 15%, T. 3.6.2.1-1) with half the permanent stresses (T. 5.9.2.3.2a-1).
    const MfatP = fatPos * df.fatigue;
    const fatigue: Station["fatigue"] = { Mfat: MfatP, top: 0.5 * service.topPerm + (1.75 * 1.15 * MfatP * 12) / comp.Stc };
    const st: Station = { x, label, pier, transfer, Mg, Mdeck, Mdc2, Mdw, Mll, Vdc, Vdw, Vll, release, service, Mu, phiMn, Mcr, Vu, fatigue, strengthII, strengthIIGoverns: !!strengthII && (strengthII.Mu > MuI || strengthII.Vu > VuI) };
    if (negative) {
      // Negative moment: the deck's bars in tension, the girder's bottom in compression.
      const negDead = down(Mg, 1.25, 0.9) + down(Mdeck, 1.25, 0.9) + down(negative.Mdc2, 1.25, 0.9) + down(negative.Mdw, 1.5, 0.65) + negative.Mr;
      negative.Mu = Math.min(0, i.eta * (negDead + 1.75 * negative.Mll));
      if (strengthII && ii) {
        strengthII.MllNeg = ii.Mneg * dfNegAt(x).moment;
        strengthII.MuNeg = Math.min(0, i.eta * (negDead + CDOT.gammaStrengthII * strengthII.MllNeg));
        if (strengthII.MuNeg < negative.Mu) {
          negative.Mu = strengthII.MuNeg;
          negative.governs = `${ii.name}, Strength II (CDOT BDM 3.6)`;
        }
      }
      const Mcn = (negative.Mdc2 + negative.Mdw + negative.Mr) * 12;
      st.negative = negative;
      st.service.botPerm = pre.bot - Mnc / g.Sb - Mcn / comp.Sbc;
      st.service.botTotal = st.service.botPerm - (negative.Mll * 12) / comp.Sbc;
      // Service I tension in the deck's bars (crack control): the composite section's moment.
      const Ms = -Math.min(0, Mcn / 12 + negative.Mll);
      st.service.fss = neg!.steelStress(Ms);
      // Fatigue I in the bottom flange near the pier.
      const MfatN = fatNeg * dfNegAt(x).fatigue;
      st.fatigue.MfatNeg = MfatN;
      st.fatigue.bot = 0.5 * st.service.botPerm + (1.75 * 1.15 * -MfatN * 12) / comp.Sbc;
    }
    const shearHere = full ? Math.min(x, i.L - x) >= xCrit - 1e-9 : x >= xCrit - 1e-9;
    if (shearHere && negative?.inRegion && negative.Mu < 0) {
      // In the negative moment region: shear with the deck's bars on the flexural tension side.
      const Vp = prestress(xe, fpe).Vp;
      const phiV = xe <= lastDebond + 1e-9 || Lg - xe <= lastDebond + 1e-9 ? 0.85 : 0.9;
      const nf = neg!.flex;
      st.shear = shearAt(i, shape, comp, nf, -negative.Mu, Vu, x, Ec, { Apt: 0, Aptfpo: 0, Vp, phiV, de: nf.dp, As: neg!.As, Act: neg!.Act });
      st.phiVn = phiV * st.shear.Vn;
      const cot = 1 / Math.tan(rad(st.shear.theta));
      const Vs = Math.min(st.shear.Vs, Vu / phiV);
      const demand = (-negative.Mu * 12) / (st.shear.dv * nf.phi) + Math.max(0, Math.abs(Vu / phiV - Vp) - 0.5 * Vs) * cot;
      st.longitudinal = { demand, capacity: neg!.As * i.fy, side: "top" };
    } else if (shearHere) {
      const Vp = prestress(xe, fpe).Vp;
      const phiV = xe <= lastDebond + 1e-9 || Lg - xe <= lastDebond + 1e-9 ? 0.85 : 0.9;
      // Strands on the flexural tension side (below h/2), bonded, with fpo built over their transfer.
      const tens = at(xe).filter((m) => m.y < comp.h / 2 && m.tf > 0);
      const Apt = tens.reduce((s, m) => s + m.k.A, 0);
      const Aptfpo = tens.reduce((s, m) => s + m.k.A * 0.7 * i.fpu * m.tf, 0);
      // de: to the centroid of the tensile force, the tension side's strands as developed (5.7.2.8).
      const fT = (m: (typeof tens)[number]) => {
        const c = cap(m.lpx, m.k.kappa);
        return m.k.A * (c === null ? flex.fpsRaw : Math.min(flex.fpsRaw, c));
      };
      const Tt = tens.reduce((s, m) => s + fT(m), 0);
      const de = Tt > 0 ? tens.reduce((s, m) => s + fT(m) * (comp.h - m.y), 0) / Tt : flex.dp;
      st.shear = shearAt(i, shape, comp, flex, Mu, Vu, x, Ec, { Apt, Aptfpo, Vp, phiV, de });
      st.phiVn = phiV * st.shear.Vn;
      // Longitudinal reinforcement, 5.7.3.5-1: the tension side's strands (as developed here) and bars.
      const fpsHere = flex.fpsRaw;
      const As = i.bottomBars.count * (BARS[i.bottomBars.bar]?.area ?? 0);
      const capT = tens.reduce((s, m) => s + m.k.A * (cap(m.lpx, m.k.kappa) === null ? fpsHere : Math.min(fpsHere, cap(m.lpx, m.k.kappa)!)), 0) + As * i.fy;
      const cot = 1 / Math.tan(rad(st.shear.theta));
      const Vs = Math.min(st.shear.Vs, Vu / phiV);
      const demand = (Mu * 12) / (st.shear.dv * flex.phi) + Math.max(0, Math.abs(Vu / phiV - Vp) - 0.5 * Vs) * cot;
      st.longitudinal = { demand, capacity: capT, side: "bottom" };
    }
    if (principalApplies && st.shear) {
      // Principal tension in the web (5.9.2.3.3), the LRFD method as PGSuper: the axial stress at each web
      // elevation interpolated between the girder's top and bottom at Service III (the moments that give the
      // least compression there), and the total Service III shear on the composite section.
      const set = (Mc: number, ML: number) => ({
        top: pre.top + Mnc / g.St + (Mc + gammaLL3 * ML) / comp.Stc,
        bot: pre.bot - Mnc / g.Sb - (Mc + gammaLL3 * ML) / comp.Sbc,
      });
      const hi = set(Mc, ML);
      const lo = set((negative ? negative.Mdc2 + negative.Mdw + MrNeg : Mdc2 + Mdw) * 12, (negative?.Mll ?? 0) * 12);
      const V = Math.abs(Vdc) + Math.abs(Vdw) + gammaLL3 * Vll + Math.abs(Vr);
      const Vp = fSvc.Vp;
      let best: PrincipalTension | null = null;
      for (const lv of webLevels) {
        const d = H - lv.y; // from the girder's top
        const fpcx = Math.min(...[hi, lo].map((s) => s.top + ((s.bot - s.top) * d) / H));
        const Q = firstMomentAbove(lv.y);
        const tau = ((V - Vp) * Q) / (lv.bw * comp.I);
        const ft = -fpcx / 2 + Math.sqrt((fpcx / 2) ** 2 + tau ** 2);
        if (!best || ft > best.ft) best = { ft, y: lv.y, where: lv.where, fpcx, tau, V, Vp, Q, bw: lv.bw };
      }
      st.principal = best!;
    }
    return st;
  });

  // Longitudinal reinforcement at the inside edge of the bearing (5.7.3.5-2), at a simple end support
  // (an abutment), with the critical section's shear there.
  const simpleEnd: "left" | "right" | null = !full ? "left" : !ctx!.contLeft ? "left" : !ctx!.contRight ? "right" : null;
  const withShear = stations.filter((s) => s.shear);
  const crit = simpleEnd === "right" ? withShear[withShear.length - 1] : withShear[0];
  const edgeFromEnd = i.endDist + i.bearingLength / 24; // ft from the girder's end
  const xEdge = simpleEnd === "right" ? Lg - edgeFromEnd : edgeFromEnd;
  const edgeFlex = flexAt(xEdge);
  const As = i.bottomBars.count * (BARS[i.bottomBars.bar]?.area ?? 0);
  const edgeCap =
    at(xEdge)
      .filter((m) => m.y < comp.h / 2 && m.tf > 0)
      .reduce((s, m) => {
        const c = cap(m.lpx, m.k.kappa);
        return s + m.k.A * (c === null ? edgeFlex.fpsRaw : Math.min(edgeFlex.fpsRaw, c));
      }, 0) +
    As * i.fy;
  const critPhi = crit.phiVn! / crit.shear!.Vn;
  const critVp = prestress(crit.x + i.endDist, fpe).Vp;
  const edgeDemand = Math.max(0, crit.Vu / critPhi - 0.5 * Math.min(crit.shear!.Vs, crit.Vu / critPhi) - critVp) / Math.tan(rad(crit.shear!.theta));

  // --- camber and deflections (inches, + up) -------------------------------------------------------------
  const VS = g.A / g.perimeter;
  const ks = Math.max(1, 1.45 - 0.13 * VS); // 5.4.2.3.2-2
  const khc = 1.56 - 0.008 * i.humidity; // 5.4.2.3.3-2
  const kf = 5 / (1 + i.fci); // 5.4.2.3.2-4
  const t = Math.max(0, i.tDeck - i.tRelease);
  const ktd = t / ((12 * (100 - 4 * i.fci)) / (i.fci + 20) + t); // 5.4.2.3.2-5
  const psi = 1.9 * ks * khc * kf * ktd * i.tRelease ** -0.118; // 5.4.2.3.2-1
  const Lgi = Lg * 12;
  const Li = i.L * 12;
  // Prestress camber, group by group: straight (bonded over its length less the debonded ends) and
  // harped (two-point drape).
  let dPs = 0;
  for (const k of groups) {
    const P = k.A * fpt;
    const eMid = g.yb - k.yAt(Lg / 2);
    if (k.kind === "harped") {
      const eEnd = g.yb - k.yAt(0);
      const a = i.harped.harpPoint * Lgi;
      dPs += (P * (eMid * Lgi ** 2 / 8 - ((eMid - eEnd) * a ** 2) / 6)) / (Eci * g.I);
    } else {
      const b = k.bondFrom * 12;
      dPs += (P * eMid * (Lgi ** 2 / 8 - b ** 2 / 2)) / (Eci * g.I);
    }
  }
  const dGr = (5 * (wg / 12) * Lgi ** 4) / (384 * Eci * g.I);
  const cRelease = dPs - dGr;
  // At the deck: the release camber grown by creep, the prestress part reduced by the losses to then.
  // CDOT BDM 5.5.2.1 D: the camber at deck placement with the girder 60 days old.
  const camberAge = cdot ? CDOT.camberAge : i.tDeck;
  const tCam = Math.max(0, camberAge - i.tRelease);
  const psiCam = camberAge === i.tDeck ? psi : creep(i, VS, i.fci, tCam, i.tRelease);
  const fpCam =
    camberAge === i.tDeck
      ? fpDeck
      : fpt - (i.losses === "refined" ? refinedLosses({ i: { ...i, tDeck: camberAge }, g, comp, Aps, e, fpt, fcgp, Eci, Ec, Ecd, Mdeck: deckMoment(i.L / 2) * 12, Msidl }).toDeck : lossDetail.toDeck * Math.min(1, tCam / Math.max(1, t)));
  const cDeck = (dPs * (fpCam / fpt) - dGr) * (1 + psiCam);
  let dDeck = (5 * (wDeck / 12) * Li ** 4) / (384 * Ec * g.I);
  for (const a of diaphragmAt) {
    const ai = Math.min(a, i.L - a) * 12;
    dDeck += (Pdia * ai * (3 * Li ** 2 - 4 * ai ** 2)) / (48 * Ec * g.I);
  }
  // Superimposed loads: on the continuous beam, its end moments lessen the midspan deflection.
  // Continuity's change to the midspan moment per klf (linear along the girder, so it also gives the deflection).
  const endMoments = full ? ctx!.unit(i.L / 2).M - (i.L * i.L) / 8 : 0; // kip·ft per klf
  const dSidl = (5 * ((wDC2 + wDW) / 12) * Li ** 4) / (384 * Ec * comp.I) + ((wDC2 + wDW) * endMoments * 12 * Li ** 2) / (8 * Ec * comp.I);
  const camber = { VS, ks, khc, kf, ktd, psi, t, dPs, dGr, cRelease, age: camberAge, tCam, psiCam, fpCam, cDeck, dDeck: -dDeck, dSidl: -dSidl, dTotal: -(dDeck + dSidl), net: cDeck - dDeck - dSidl };
  const haunch = haunchDesign(i, shape, camber);

  // Live load deflection (2.5.2.6.2, 3.6.1.3.2): all lanes, multiple presence, shared by all girders.
  const llDefl = liveLoadDeflection(i, Ec * comp.I, df.lanes);

  // --- checks: each at its governing station ---
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity + 1e-9 });
  const atS = (s: Station) => `${s.label} (x = ${s.x.toFixed(2)} ft)`;
  const worst = <T>(list: T[], key: (t: T) => number): T => list.reduce((a, b) => (key(b) > key(a) ? b : a));
  const sqrtFci = sqrt(i.fci);
  const sqrtFc = sqrt(i.fc);

  // Stressing limits (T. 5.9.2.2-1)
  add({ id: "fpj", name: "Jacking stress", demand: fpj, capacity: 0.75 * i.fpu, unit: "ksi", ref: "T. 5.9.2.2-1" });
  add({ id: "fpe", name: "Effective stress after all losses", demand: fpe, capacity: 0.8 * 0.9 * i.fpu, unit: "ksi", ref: "T. 5.9.2.2-1 (0.80 fpy)" });

  // CDOT Bridge Design Manual: concrete strengths and the hold-down force.
  if (cdot) {
    const approved = !!i.highStrengthApproved;
    const why = approved ? "a higher strength approved by the Unit Leader with the State Bridge Engineer (shown for information)" : "a higher strength needs the Unit Leader's approval, with the State Bridge Engineer";
    add({ id: "cdot-fci", name: "Girder f′ci, CDOT's maximum without approval", demand: i.fci, capacity: CDOT.maxFci, unit: "ksi", ref: "CDOT BDM 5.3.1.2", note: why, ...(approved ? { advisory: true } : {}) });
    add({ id: "cdot-fc", name: "Girder f′c, CDOT's maximum without approval", demand: i.fc, capacity: CDOT.maxFc, unit: "ksi", ref: "CDOT BDM 5.3.1.2", note: why, ...(approved ? { advisory: true } : {}) });
    const h = i.harped;
    if (h && h.count > 0) {
      const slope = (h.yEnd - h.yHarp) / (h.harpPoint * Lg * 12);
      const perStrand = fpj * strand.area * Math.sin(Math.atan(slope));
      add({ id: "hold-down", name: "Hold-down force per harped strand", demand: perStrand, capacity: CDOT.holdDownPerStrand, unit: "kip", ref: "CDOT BDM 5.5.2.2", note: `at jacking, slope 1 : ${(1 / slope).toFixed(1)}; ${(perStrand * h.count).toFixed(1)} kip for ${h.count} strands at each harp point` });
    }
  }

  // Debonding, AASHTO LRFD 10th ed. 5.9.4.3.3: A (45% of a row), B (terminations at one section), C (60 db
  // between terminations), G (debonded length) and I (single-web flanged sections: the outermost strands, and
  // those within the web when bf/bw > 4 or more than 25% are debonded, stay bonded). The 25% cap on all
  // strands of earlier editions is gone; above 25% only rule I tightens.
  const rows = i.strands.filter((r) => (r.debonded ?? 0) > 0 && (r.debondLength ?? 0) > 0);
  if (rows.length) {
    const nDeb = rows.reduce((s, r) => s + Math.min(r.debonded!, r.count), 0);
    const rowWorst = worst(rows, (r) => r.debonded! / r.count);
    add({ id: "deb-row", name: "Debonded strands, of a row", demand: rowWorst.debonded! / rowWorst.count, capacity: 0.45, unit: "", ref: "5.9.4.3.3 A", note: `${rowWorst.debonded} of ${rowWorst.count} at y = ${rowWorst.y} in; ${nDeb} of ${N} strands in all` });
    const bySection = new Map<number, number>();
    for (const r of rows) bySection.set(r.debondLength!, (bySection.get(r.debondLength!) ?? 0) + r.debonded!);
    const [secL, secN] = [...bySection].reduce((a, b) => (b[1] > a[1] ? b : a));
    const secMax = nDeb <= 10 || strand.db >= 0.7 ? 4 : 6;
    add({ id: "deb-section", name: "Strands whose debonding ends at one section", demand: secN, capacity: secMax, unit: "strands", ref: "5.9.4.3.3 B", note: `at ${secL} ft from the end; ${nDeb <= 10 ? "ten or fewer debonded: 4" : strand.db >= 0.7 ? "0.7 in strand: 4" : "6"}` });
    // C: terminations (and the girder's end) at least 60 db apart.
    const ends = [0, ...[...new Set(rows.map((r) => r.debondLength!))].sort((a, b) => a - b)];
    const gap = Math.min(...ends.slice(1).map((e, k) => e - ends[k]));
    add({ id: "deb-length", name: "Debonding terminations at least 60 db apart", demand: (60 * strand.db) / 12, capacity: gap, unit: "ft", ref: "5.9.4.3.3 C", note: `ends at ${ends.slice(1).join(", ")} ft` });
    // G: the debonded length within 0.2 L and L/2 − ℓd.
    const longest = Math.max(...rows.map((r) => r.debondLength!));
    const ldDeb = ldOf(2.0);
    add({ id: "deb-max", name: "Debonded length, at most min(0.2 L, L/2 − ℓd)", demand: longest, capacity: Math.min(0.2 * i.L, i.L / 2 - ldDeb), unit: "ft", ref: "5.9.4.3.3 G", note: `ℓd = ${ldDeb.toFixed(2)} ft (κ = 2.0)` });
    // I: rows on a grid at 2 in, centered on the web (an estimate where the grid is not known).
    const bf = 2 * Math.max(...shape.profile.filter((p) => p[0] <= 0.25 * H).map((p) => p[1]));
    const webBond = bf / shape.web > 4 || nDeb > 0.25 * N;
    const inWeb = (count: number) => Math.min(count, count % 2 ? 1 + 2 * Math.floor(shape.web / 4) : 2 * (Math.floor((shape.web / 2 - 1) / 2) + 1));
    const free = (r: StrandRow) => Math.max(0, r.count - 2 - (webBond ? inWeb(r.count) : 0));
    const outer = worst(rows, (r) => r.debonded! - free(r));
    add({ id: "deb-outer", name: webBond ? "Bonded: the outermost strands and those within the web" : "Bonded: the outermost strands of each row", demand: outer.debonded!, capacity: free(outer), unit: "strands", ref: "5.9.4.3.3 I", note: `row at y = ${outer.y} in: ${outer.count} strands${webBond ? `, ${inWeb(outer.count)} within the ${shape.web} in web (${bf / shape.web > 4 ? `bf/bw = ${(bf / shape.web).toFixed(1)} > 4` : `${nDeb} of ${N} debonded, over 25%`})` : ""}` });
  }

  // Strand layout limits of the CDOT BDM (5.5.1.5) and its CBT standard sheet B-618-CBT2.
  if (cdot) {
    const h = i.harped;
    if (h && h.count > 0) {
      // Harped strands in pairs at 2 in: the top pair rises (pairs − 1) in above the bundle's centroid.
      const topEnd = h.yEnd + (Math.ceil(h.count / 2) - 1);
      add({ id: "harp-height", name: "Top harped strand at the girder's end", demand: topEnd, capacity: Math.min(H - CDOT.harpBelowTop, CDOT.maxHarpHeight), unit: "in", ref: "CDOT BDM 5.5.1.5; B-618-CBT2", note: `at most ${CDOT.harpBelowTop} in below the top (${H - CDOT.harpBelowTop} in), and ${CDOT.maxHarpHeight} in (60–66 in by the precasting bed)` });
      add({ id: "harp-span", name: "Harped strands in a girder under 100 ft", demand: Lg < CDOT.harpMinLength ? h.count : 0, capacity: 0, unit: "strands", ref: "CDOT BDM 5.5.1.5", note: `girder ${Lg.toFixed(1)} ft; straight debonded strands are preferred` });
      add({ id: "harp-point", name: "Harp point, 0.35 to 0.45 of the girder's length (guidance)", demand: Math.abs(h.harpPoint - 0.4), capacity: 0.05, unit: "", ref: "CDOT BDM 5.5.1.5", note: `at ${h.harpPoint.toFixed(3)} of the girder's length; the BDM says harping locations "should" be in this range, 0.4 a good default`, advisory: true });
    }
    const Pj = N * strand.area * fpj;
    add({ id: "bed-force", name: "Jacking force of all strands (precasting bed)", demand: Pj, capacity: CDOT.maxBedForce, unit: "kip", ref: "B-618-CBT2", note: `${N} strands at ${(strand.area * fpj).toFixed(1)} kip` });

    // Camber and haunch (BDM 5.5.2.1 B and G).
    add({ id: "no-sag", name: "No sag: under-cambered girder after the dead load", demand: haunch.tolerance - camber.dTotal, capacity: camber.cDeck, unit: "in", ref: "CDOT BDM 5.5.2.1 G", note: `camber ${camber.cDeck.toFixed(2)} in at ${camber.age} days, less ${haunch.tolerance.toFixed(2)} in under-camber and ${(-camber.dTotal).toFixed(2)} in dead load deflection` });
    if (haunch.D1 !== undefined) {
      add({ id: "haunch-support", name: "Haunch at the supports, flange edge", demand: haunch.minSupport, capacity: haunch.D1 - haunch.cross, unit: "in", ref: "CDOT BDM 5.5.2.1 B", note: `${haunch.D1.toFixed(2)} in at the centerline, less ${haunch.cross.toFixed(2)} in of cross-slope over half the flange` });
      add({ id: "haunch-mid", name: "Haunch at midspan, over-cambered girder, flange edge", demand: haunch.minBetween, capacity: haunch.D2over! - haunch.cross, unit: "in", ref: "CDOT BDM 5.5.2.1 B", note: `predicted ${haunch.D2!.toFixed(2)} in at the centerline, less ${haunch.tolerance.toFixed(2)} in over-camber` });
    }
  }

  // Release (5.9.2.3.1)
  const rc = worst(stations, (s) => Math.max(s.release.top, s.release.bot));
  add({ id: "rel-comp", name: "Release: compression", demand: Math.max(rc.release.top, rc.release.bot), capacity: 0.65 * i.fci, unit: "ksi", ref: "5.9.2.3.1a", note: atS(rc) });
  const rt = worst(stations, (s) => -Math.min(s.release.top, s.release.bot));
  const tRel = -Math.min(rt.release.top, rt.release.bot);
  const tNoBars = Math.min(0.0948 * sqrtFci, 0.2);
  const tBars = 0.24 * sqrtFci;
  const releaseTension = Math.max(0, tRel);
  const barsNeeded = releaseTension > tNoBars ? tensionForce(shape.profile, H, rt.release.top, rt.release.bot) / Math.min(0.5 * i.fy, 30) : 0;
  add({
    id: "rel-tens",
    name: barsNeeded > 0 ? "Release: tension (with bonded bars)" : "Release: tension",
    demand: releaseTension,
    capacity: barsNeeded > 0 ? tBars : tNoBars,
    unit: "ksi",
    ref: "T. 5.9.2.3.1b-1",
    note: `${atS(rt)}${barsNeeded > 0 ? `; needs ${barsNeeded.toFixed(2)} in² of bonded bars at fs = ${Math.min(0.5 * i.fy, 30)} ksi` : ""}`,
  });

  // Service (5.9.2.3.2)
  const sp = worst(stations, (s) => s.service.topPerm);
  add({ id: "svc-perm", name: "Service I: compression, permanent loads (girder)", demand: sp.service.topPerm, capacity: 0.45 * i.fc, unit: "ksi", ref: "T. 5.9.2.3.2a-1", note: atS(sp) });
  const stt = worst(stations, (s) => s.service.topTotal);
  add({ id: "svc-total", name: "Service I: compression, all loads (girder)", demand: stt.service.topTotal, capacity: 0.6 * i.fc, unit: "ksi", ref: "T. 5.9.2.3.2a-1, φw = 1.0", note: atS(stt) });
  const dp = worst(stations, (s) => s.service.deckPerm);
  add({ id: "deck-perm", name: "Service I: compression, permanent loads (deck)", demand: dp.service.deckPerm, capacity: 0.45 * i.fcDeck, unit: "ksi", ref: "T. 5.9.2.3.2a-1", note: atS(dp) });
  const dtl = worst(stations, (s) => s.service.deckTotal);
  add({ id: "deck-total", name: "Service I: compression, all loads (deck)", demand: dtl.service.deckTotal, capacity: 0.6 * i.fcDeck, unit: "ksi", ref: "T. 5.9.2.3.2a-1", note: atS(dtl) });
  const sb = worst(
    stations.filter((s) => !s.pier),
    (s) => -s.service.botIII,
  );
  const tensLimit = i.exposure === "moderate" ? Math.min(0.19 * sqrtFc, 0.6) : i.exposure === "severe" ? Math.min(0.0948 * sqrtFc, 0.3) : 0;
  add({
    id: "svc-tens",
    name: "Service III: tension, bottom of the girder",
    demand: Math.max(0, -sb.service.botIII),
    capacity: tensLimit,
    unit: "ksi",
    ref: "T. 5.9.2.3.2b-1",
    note: `${atS(sb)}; ${i.exposure === "moderate" ? "not worse than moderate corrosion" : i.exposure === "severe" ? "severe corrosive conditions" : "no tension allowed"}; γLL = ${gammaLL3.toFixed(1)}${gains ? " (refined losses with elastic gains)" : ""}`,
  });
  if (cdot) {
    const dl = worst(
      stations.filter((s) => !s.pier),
      (s) => -s.service.botDL,
    );
    add({ id: "cdot-dl-tension", name: "Dead load alone: tension, bottom of the girder", demand: Math.max(0, -dl.service.botDL), capacity: 0, unit: "ksi", ref: "CDOT BDM 5.5.1.3", note: `${atS(dl)}; after all losses; no tension allowed in the precompressed tensile zone` });
  }

  const byII = (s: Station, effect: "Mu" | "Vu") => (s.strengthII && s.strengthII[effect] >= s[effect] - 1e-9 ? `; Strength II, ${s.strengthII.vehicle} (CDOT BDM 3.6), governs` : cdot ? "; Strength I governs" : "");
  const strengthName = cdot ? "Strength I/II" : "Strength I";
  // Over a pier (continuous spans): the bottom of the girder in compression, the deck's bars in tension.
  const negSt = stations.filter((s) => s.negative && s.negative.Mu < 0);
  if (full && neg) {
    const withBot = stations.filter((s) => s.service.botPerm !== undefined);
    const bp = worst(withBot, (s) => s.service.botPerm!);
    add({ id: "svc-bot-perm", name: "Service I: compression, permanent loads (girder bottom)", demand: bp.service.botPerm!, capacity: 0.45 * i.fc, unit: "ksi", ref: "T. 5.9.2.3.2a-1", note: atS(bp) });
    const bt = worst(withBot, (s) => s.service.botTotal!);
    add({ id: "svc-bot-total", name: "Service I: compression, all loads (girder bottom)", demand: bt.service.botTotal!, capacity: 0.6 * i.fc, unit: "ksi", ref: "T. 5.9.2.3.2a-1, φw = 1.0", note: atS(bt) });
    if (negSt.length) {
      const nf = worst(negSt, (s) => -s.negative!.Mu);
      add({ id: "neg-flexure", name: `${strengthName}: negative moment (deck bars)`, demand: -nf.negative!.Mu, capacity: neg.phiMn, unit: "kip·ft", ref: "5.6.3.2, 5.12.3.3", note: `${atS(nf)}; LL: ${nf.negative!.governs}; the girder's f′c in compression` });
      add({ id: "neg-min-reinf", name: "Minimum reinforcement over the pier: φMn ≥ min(Mcr, 1.33 Mu)", demand: Math.min(neg.Mcr, -1.33 * nf.negative!.Mu), capacity: neg.phiMn, unit: "kip·ft", ref: "5.6.3.3", note: `γ1 = 1.6, γ3 = 0.67; Mcr = ${neg.Mcr.toFixed(0)} kip·ft` });
    }
    const withFss = stations.filter((s) => (s.service.fss ?? 0) > 0);
    if (withFss.length) {
      const cs = worst(withFss, (s) => s.service.fss!);
      const cc = neg.crackControl(cs.service.fss!);
      add({ id: "crack-control", name: "Crack control: top bar spacing over the pier", demand: i.pierBars.topSpacing, capacity: cc.smax, unit: "in", ref: "5.6.7", note: `${atS(cs)}; fss = ${cc.fss.toFixed(1)} ksi, βs = ${cc.betaS.toFixed(2)}, γe = ${cc.gammaE}` });
    }
  }

  // Strength I flexure (5.6.3), positive moment (not at a pier: the joint's connection carries that).
  const inSpan = stations.filter((s) => !s.pier);
  const fm = worst(inSpan, (s) => s.Mu / s.phiMn);
  add({ id: "flexure", name: `${strengthName}: flexure`, demand: fm.Mu, capacity: fm.phiMn, unit: "kip·ft", ref: "5.6.3.2", note: `${atS(fm)}${byII(fm, "Mu")}` });
  const mr = worst(inSpan, (s) => Math.min(s.Mcr, 1.33 * s.Mu) / s.phiMn);
  add({ id: "min-reinf", name: "Minimum reinforcement: φMn ≥ min(Mcr, 1.33 Mu)", demand: Math.min(mr.Mcr, 1.33 * mr.Mu), capacity: mr.phiMn, unit: "kip·ft", ref: "5.6.3.3", note: atS(mr) });

  // Strength I shear (5.7)
  const sh = stations.filter((s) => s.shear);
  const sv = worst(sh, (s) => s.Vu / s.phiVn!);
  add({ id: "shear", name: `${strengthName}: shear`, demand: sv.Vu, capacity: sv.phiVn!, unit: "kip", ref: "5.7.3.3", note: `${atS(sv)}${byII(sv, "Vu")}; β = ${sv.shear!.beta.toFixed(2)}, θ = ${sv.shear!.theta.toFixed(1)}°${sv.shear!.Vp > 0 ? `, Vp = ${sv.shear!.Vp.toFixed(1)} kip` : ""}${sv.phiVn! / sv.shear!.Vn < 0.875 ? ", φv = 0.85 (debonded region)" : ""}` });
  const needAv = sh.filter((s) => s.shear!.needsAv);
  const avm = needAv.length ? worst(needAv, (s) => s.shear!.Avmin / s.shear!.Av) : null;
  if (avm) add({ id: "av-min", name: "Minimum transverse reinforcement", demand: avm.shear!.Avmin, capacity: avm.shear!.Av, unit: "in²", ref: "5.7.2.5", note: `${atS(avm)}, s = ${avm.shear!.s} in` });
  // CDOT BDM 5.5.1.6: at most 18 in in prestressed girders.
  const sCap = (s: Station) => (cdot ? Math.min(s.shear!.smax, CDOT.maxStirrupSpacing) : s.shear!.smax);
  const smx = worst(sh, (s) => s.shear!.s / sCap(s));
  add({ id: "s-max", name: "Maximum stirrup spacing", demand: smx.shear!.s, capacity: sCap(smx), unit: "in", ref: cdot ? "5.7.2.6; CDOT BDM 5.5.1.6" : "5.7.2.6", note: atS(smx) });
  const lg = worst(sh, (s) => s.longitudinal!.demand / Math.max(s.longitudinal!.capacity, 1e-9));
  add({ id: "long", name: "Longitudinal reinforcement for shear", demand: lg.longitudinal!.demand, capacity: lg.longitudinal!.capacity, unit: "kip", ref: "5.7.3.5-1", note: `${atS(lg)}${lg.longitudinal!.side === "top" ? "; the deck's bars (negative moment)" : ""}` });
  if (simpleEnd) add({ id: "long-brg", name: "Longitudinal reinforcement at the bearing's inside edge", demand: edgeDemand, capacity: edgeCap, unit: "kip", ref: "5.7.3.5-2", note: `${(edgeFromEnd - i.endDist).toFixed(2)} ft from the ${full ? `${simpleEnd} ` : ""}bearing centerline` });
  const ifs = worst(sh, (s) => s.shear!.interface.Vui / s.shear!.interface.phiVni);
  add({ id: "interface", name: "Interface shear, girder to deck", demand: ifs.shear!.interface.Vui, capacity: ifs.shear!.interface.phiVni, unit: "kip/ft", ref: "5.7.4", note: atS(ifs) });
  const ifm = sh.filter((s) => s.shear!.interface.needsMin);
  if (ifm.length) {
    const w = worst(ifm, (s) => s.shear!.interface.Avfmin / Math.max(s.shear!.interface.Avf, 1e-9));
    add({ id: "interface-min", name: "Minimum interface reinforcement", demand: w.shear!.interface.Avfmin, capacity: w.shear!.interface.Avf, unit: "in²/ft", ref: "5.7.4.2", note: atS(w) });
  }
  // Fatigue I (5.5.3.1): compression from the fatigue truck with half the effective prestress and permanent loads.
  const fatTop = worst(stations, (s) => s.fatigue.top);
  const withBotFat = stations.filter((s) => s.fatigue.bot !== undefined);
  const fatBot = withBotFat.length ? worst(withBotFat, (s) => s.fatigue.bot!) : null;
  const fatBotWorse = !!fatBot && fatBot.fatigue.bot! > fatTop.fatigue.top;
  const svcTensOk = Math.max(0, -sb.service.botIII) <= tensLimit + 1e-9;
  add({
    id: "fatigue",
    name: `Fatigue I: compression${fatBotWorse ? " (girder bottom, near the pier)" : " (girder top)"}`,
    demand: fatBotWorse ? fatBot!.fatigue.bot! : fatTop.fatigue.top,
    capacity: 0.4 * i.fc,
    unit: "ksi",
    ref: "5.5.3.1, T. 5.9.2.3.2a-1",
    note: `${atS(fatBotWorse ? fatBot! : fatTop)}; fatigue truck (30 ft rear axles), IM 15%, γ = 1.75, one lane g = ${(fatBotWorse ? dfNegR.fatigue : df.fatigue).toFixed(3)}; ${svcTensOk ? "strand fatigue need not be checked (Service III tension within its limit)" : "Service III tension exceeds its limit: check strand fatigue (5.5.3.3)"}`,
  });
  // Principal tension in the web (5.9.2.3.3): f′c over 10 ksi only.
  const withPrincipal = stations.filter((s) => s.principal);
  if (withPrincipal.length) {
    const pt = worst(withPrincipal, (s) => s.principal!.ft);
    add({ id: "principal", name: "Principal tension in the web, Service III", demand: Math.max(0, pt.principal!.ft), capacity: 0.11 * sqrtFc, unit: "ksi", ref: "5.9.2.3.3", note: `${atS(pt)}, at the ${pt.principal!.where}; τ = ${pt.principal!.tau.toFixed(3)} ksi, fpcx = ${pt.principal!.fpcx.toFixed(3)} ksi` });
  }

  // Elastic shortening section by section (5.9.3.2.3a), for the girder's ends and handling: the strands
  // transferred there, the girder's weight on the casting bed (PGSuper computes it so; the design above uses midspan's).
  const fptAt = (xe: number, full = false) => {
    let Aeff = 0;
    let Ae = 0;
    for (const m of at(xe)) {
      const tf = full ? (Math.min(xe, Lg - xe) >= m.k.bondFrom ? 1 : 0) : m.tf;
      Aeff += m.k.A * tf;
      Ae += m.k.A * tf * (g.yb - m.y);
    }
    if (Aeff <= 0) return { fp: fpt, Ab: 0 };
    const ey = Ae / Aeff;
    const M = full ? 0 : uniform(wg, Lg, xe).M * 12;
    return { fp: (fpj + (r * M * ey) / g.I) / (1 + r * Aeff * (1 / g.A + ey ** 2 / g.I)), Ab: Aeff };
  };

  // Anchorage zone (5.9.4.4): splitting resistance within h/4 of the end, and confinement.
  const zonesFromEnd = i.stirrups.map((z, k) => ({ ...z, length: (k === 0 ? i.endDist + z.length : z.length) * 12 }));
  const splitZone = H / 4;
  const splitAs = splittingAs(zonesFromEnd, splitZone);
  const splitFs = 20; // ksi, at most 20 ksi (5.9.4.4.1)
  // The strands bonded at the end, just after transfer (as PGSuper; AASHTO's Pi is just before transfer).
  const endPs = fptAt(0, true);
  const Fpi = endPs.Ab * endPs.fp;
  const splitting = { zone: splitZone, As: splitAs, fs: splitFs, Pr: splitFs * splitAs, Fpi, demand: 0.04 * Fpi };
  add({ id: "splitting", name: "Splitting resistance at the girder's end", demand: splitting.demand, capacity: splitting.Pr, unit: "kip", ref: "5.9.4.4.1", note: `4% of Fpi = ${Fpi.toFixed(0)} kip; vertical bars within h/4 = ${splitZone.toFixed(1)} in: As = ${splitAs.toFixed(2)} in² at fs = ${splitFs} ksi` });
  const cf = i.confinement ?? GIRDER_DEFAULTS.confinement;
  add({ id: "conf-bar", name: "Confinement: bar size (at least #3)", demand: 3, capacity: cf.bar, unit: "#", ref: "5.9.4.4.2" });
  add({ id: "conf-spacing", name: "Confinement: bar spacing", demand: cf.spacing, capacity: 6, unit: "in", ref: "5.9.4.4.2" });
  add({ id: "conf-length", name: "Confinement: length from the girder's end (1.5d)", demand: (1.5 * H) / 12, capacity: cf.length, unit: "ft", ref: "5.9.4.4.2" });

  // Detailing: each stirrup zone (all but the last, which runs to midspan) holds a whole number of spaces,
  // so the bars land at the stated spacing; PGSuper rejects zones that don't. 0.05 in absorbs rounded feet.
  const zoneFit = i.stirrups.slice(0, -1).map((z, k) => {
    const L = z.length * 12;
    const n = L / z.spacing;
    const off = Math.abs(L - Math.round(n) * z.spacing);
    return { k, L, n, s: z.spacing, off: off > 0.05 ? off : 0 };
  });
  if (zoneFit.length) {
    const w = worst(zoneFit, (z) => z.off);
    const fix = (m: number) => `${+(m * w.s).toFixed(2)} in`;
    add({ id: "stirrup-zones", name: "Stirrup zones: a whole number of spaces", demand: w.off, capacity: 0, unit: "in", ref: "Detailing", note: w.off ? `zone ${w.k + 1}: ${+w.L.toFixed(2)} in at ${w.s} in is ${w.n.toFixed(2)} spaces; make it ${fix(Math.floor(w.n))} or ${fix(Math.ceil(w.n))}` : "every zone's length is a multiple of its spacing" });
  }

  // Handling (5.5.4.3): lifting from the form and hauling, by PCI's method (CB-02-16-E).
  const hd: Handling = { ...HANDLING_DEFAULTS, ...(i.handling ?? {}), truck: { ...HANDLING_DEFAULTS.truck, ...(i.handling?.truck ?? {}) } };
  let handling: ReturnType<typeof handlingChecks> | null = null;
  if (hd.check) {
    handling = handlingChecks({ i, hd, shape, g, Lg, groups, lt, prestress, fpt, fptAt: (xe: number) => fptAt(xe).fp, Eci, Ec, cRelease, dPs, dGr, VS, lossDetail, lossInputs: { g, comp, Aps, e, fpt, fcgp, Eci, Ec, Ecd, Mdeck: deckMoment(i.L / 2) * 12, Msidl } });
    for (const c of handling.checks) checks.push(c);
  }

  if (i.llDeflection) add({ id: "ll-defl", name: `Live load deflection (L/${i.deflectionLimit})`, demand: llDefl.delta, capacity: Li / i.deflectionLimit, unit: "in", ref: "2.5.2.6.2", note: `${llDefl.governs}${full ? "; as a simple span (conservative)" : ""}` });

  // --- continuity (5.12.3.3) ---------------------------------------------------------------------------
  // The restraint moments come from the creep and shrinkage after continuity, by the method of the
  // AASHTO commentary's references (PCA; Mattock): each span's free end rotations after continuity,
  // restrained by the continuous beam, the restraint relaxed by the girder's creep, (1 − e^−φ)/φ.
  let restraintLoads: RestraintLoads | null = null;
  let pierRight: PierResult | null = null;
  if (full) {
    const c = ctx!;
    const tc = Math.max(i.tContinuity, i.tDeck);
    const tf = Math.max(i.tFinal, tc + 1);
    const VSg = g.A / g.perimeter;
    const dPsiG = creep(i, VSg, i.fci, tf - i.tRelease, i.tRelease) - creep(i, VSg, i.fci, tc - i.tRelease, i.tRelease);
    const dPsiD = creep(i, VSg, i.fci, tf - i.tDeck, i.tDeck) - (tc > i.tDeck ? creep(i, VSg, i.fci, tc - i.tDeck, i.tDeck) : 0);
    const phi = creep(i, VSg, i.fci, tf - tc, tc);
    const relax = phi > 1e-9 ? (1 - Math.exp(-phi)) / phi : 1;
    const EIc = Ec * comp.I; // kip·in², the continuous composite beam
    const fpAvg = (fpDeck + fpe) / 2; // the prestress over the creep after continuity
    const creepCurvature = (x: number) => {
      const ps = prestress(x + i.endDist, fpAvg);
      return (EIc / (Eci * g.I)) * dPsiG * (uniform(wg, i.L, x).M - ps.Pe / 12) + (EIc / (Ec * g.I)) * dPsiD * deckMoment(x);
    };
    // On the beam's span: the girder's curvature between its bearings, none over the pier's diaphragm.
    const onGirder = (k: (x: number) => number) => (X: number) => (X >= c.shift && X <= c.shift + i.L ? k(X - c.shift) : 0);
    const creepRot = rotationsFromCurvature(c.La, onGirder(creepCurvature), 800);
    // Differential shrinkage of the deck after continuity (5.4.2.3.3; the deck loaded at a day old for its creep, as 5.9.3.4.3d).
    const tsd = i.deckT - i.sacrificial;
    const VSd = tsd / 2;
    const fciDeck = 0.8 * i.fcDeck;
    const eDeck = shrinkage(i, VSd, fciDeck, tf - i.tDeck) - (tc > i.tDeck ? shrinkage(i, VSd, fciDeck, tc - i.tDeck) : 0);
    const eGirder = shrinkage(i, VSg, i.fci, tf - i.tRelease) - shrinkage(i, VSg, i.fci, tc - i.tRelease);
    const psiDeck = creep(i, VSd, fciDeck, tf - i.tDeck, 1);
    const Fsh = ((eDeck - eGirder) * comp.beff * tsd * Ecd) / (1 + 0.7 * psiDeck); // kip
    const ed = comp.deckCg - comp.yb;
    const shRot = rotationsFromCurvature(c.La, onGirder(() => (Fsh * ed) / 12), 800);
    restraintLoads = { tc, tf, dPsiG, dPsiD, phi, relax, fpAvg, creep: creepRot, eDeck, eGirder, psiDeck, Fsh, ed, shrinkage: shRot };

    if (c.contRight) {
      // The joint at the right-hand pier: fully effective, and the positive moment connection.
      const u = c.unit(i.L);
      const Mdc2 = wDC2 * u.M;
      const Mdw = wDW * u.M;
      const Mr = c.restraint.right;
      const MllPos = c.live(i.L).Mpos * dfNegR.moment;
      const Mfe = Mdc2 + Mdw + Mr + 0.5 * MllPos;
      const fBottom = (-Mfe * 12) / comp.Sbc; // ksi, compression +
      const conn = positiveConnection(i, comp, Ecd);
      const MuPos = i.eta * (Mr + 1.75 * MllPos + (Mdc2 < 0 ? 0.9 : 1.25) * Mdc2 + (Mdw < 0 ? 0.65 : 1.5) * Mdw);
      const Ms = Mr + MllPos + Mdc2 + Mdw;
      const fs = conn.steelStress(Ms);
      const pierChecks: Check[] = [];
      const addP = (k: Omit<Check, "ok"> & { ok?: boolean }) => pierChecks.push({ ...k, ok: k.ok ?? k.demand <= k.capacity + 1e-9 });
      // CDOT BDM 5.7.2: the connection resists 1.2 Mcr, Mcr of the composite section in the diaphragm's (the deck's) concrete.
      const McrConn = (0.24 * sqrt(i.fcDeck) * comp.Sbc) / 12;
      if (cdot)
        addP({ id: "conn-strength", name: "Positive moment connection: strength (1.2 Mcr)", demand: Math.max(CDOT.connectionMcr * McrConn, MuPos), capacity: conn.phiMn, unit: "kip·ft", ref: "CDOT BDM 5.7.2", note: `${i.connection.count} #${i.connection.bar} bars at ${i.connection.y} in; Mcr = fr·Sbc = ${McrConn.toFixed(0)} kip·ft, fr = 0.24√f′c of the diaphragm (deck) concrete` });
      else addP({ id: "conn-strength", name: "Positive moment connection: strength", demand: Math.max(0, MuPos), capacity: conn.phiMn, unit: "kip·ft", ref: "5.12.3.3", note: `${i.connection.count} #${i.connection.bar} bars at ${i.connection.y} in; restraint ${Mr.toFixed(0)} kip·ft` });
      addP({ id: "conn-stress", name: "Positive moment connection: bar stress at service", demand: fs, capacity: CONNECTION_STRESS, unit: "ksi", ref: "5.12.3.3", note: `Service I moment ${Math.max(0, Ms).toFixed(0)} kip·ft` });
      pierRight = { Mdc2, Mdw, Mr, MllPos, Mfe, fBottom, effective: Mfe <= 1e-9, MuPos, Ms, fs, connection: conn, checks: pierChecks };
    }
  }

  return {
    span: ctx ? ctx.index : 0,
    L: i.L,
    La: ctx ? ctx.La : i.L, // on the continuous beam
    shift: ctx ? ctx.shift : 0,
    restraint: ctx ? ctx.restraint : null,
    restraintLoads,
    pierRight,
    negativeSection: neg,
    dfNeg: full ? { left: dfNegL, right: dfNegR } : null,
    endMoments,
    exterior,
    shape,
    g,
    comp,
    df,
    strands: { N, Aps, ybar, e, lt, ld, ldDebonded: ldOf(2.0), db: strand.db, area: strand.area, groups: groups.map(({ kind, n, A, bondFrom, kappa }) => ({ kind, n, A, bondFrom, kappa, yEnd: 0, yMid: 0 })).map((s, k) => ({ ...s, yEnd: groups[k].yAt(0), yMid: groups[k].yAt(Lg / 2) })), lastDebond },
    loads: { wg, wDeck, wDC2, wDW, wBarrier, roadway, trib, diaphragmAt, Pdia, Lg },
    losses,
    gammaLL3,
    flexMid,
    stations,
    longitudinalAtBearing: { x: xEdge - i.endDist, demand: edgeDemand, capacity: edgeCap },
    camber,
    haunch,
    llDeflection: llDefl,
    splitting,
    confinement: cf,
    handling,
    checks,
    ok: checks.every((c) => c.ok || c.advisory),
  };
}

/** Lifting and hauling (5.5.4.3) by PCI's method, with WSDOT's (PGSuper's) stress limits and factors of
 * safety; under CDOT criteria, AASHTO's tension limits, shown for information (BDM 5.5.1.8). */
function handlingChecks(p: {
  i: GirderInputs;
  hd: Handling;
  shape: GirderShape;
  g: SectionProps;
  Lg: number;
  groups: StrandGroup[];
  lt: number;
  prestress: (xe: number, fp: number) => { P: number; Pe: number; Vp: number; e: number };
  fpt: number;
  fptAt: (xe: number) => number;
  Eci: number;
  Ec: number;
  cRelease: number;
  dPs: number;
  dGr: number;
  VS: number;
  lossDetail: { toDeck: number };
  lossInputs: Omit<Parameters<typeof refinedLosses>[0], "i">;
}) {
  const { i, hd, shape, g, Lg, groups, lt, prestress, fpt } = p;
  const H = shape.depth;
  const prof = shape.profile;
  const section: StabilitySection = { A: g.A, Ix: g.I, Iy: g.Iy, yt: g.yt, yb: g.yb, H, wTop: 2 * prof[prof.length - 1][1], wBot: 2 * prof[0][1] };
  const w = ((g.A / 144) * (i.wcLoad ?? i.wc)) / 12; // kip/in
  const Wg = w * Lg * 12; // kip
  const sweep = hd.sweep / 120; // in/in
  /** Analysis points (ft from the end): tenth points, the supports, harp points and where strands are transferred. */
  const pointsFor = (support: number, loss: number) => {
    const xs: number[] = [];
    const push = (x: number) => {
      if (x >= 0 && x <= Lg && !xs.some((v) => Math.abs(v - x) < 1e-3)) xs.push(x);
    };
    for (let k = 0; k <= 10; k++) push((k * Lg) / 10);
    push(support);
    push(Lg - support);
    push(lt);
    push(Lg - lt);
    if (groups.some((k) => k.kind === "harped")) {
      push(i.harped.harpPoint * Lg);
      push(Lg - i.harped.harpPoint * Lg);
    }
    for (const k of groups.filter((k) => k.kind === "debonded")) {
      push(k.bondFrom + lt);
      push(Lg - k.bondFrom - lt);
    }
    return xs
      .sort((a, b) => a - b)
      .map((x) => {
        const ps = prestress(x, p.fptAt(x) - loss);
        return { X: x * 12, Fpe: ps.P, e: ps.P > 0 ? ps.Pe / ps.P : 0 };
      });
  };

  // Lifting: at release strength, the prestress after elastic shortening, the release camber.
  const lift = analyzeLifting({
    section,
    L: Lg * 12,
    w,
    Ec: p.Eci,
    fr: 0.24 * Math.sqrt(i.fci),
    left: hd.liftPoint * 12,
    right: hd.liftPoint * 12,
    sweep,
    placement: hd.liftTolerance,
    camber: Math.max(0, p.cRelease),
    impactUp: hd.liftImpactUp,
    impactDown: hd.liftImpactDown,
    windPressure: hd.wind / 144000,
    points: pointsFor(hd.liftPoint, 0),
  });

  // Hauling: the girder's age when hauled sets its losses and camber; f′c at hauling is the 28-day strength.
  const tH = Math.max(hd.haulAge, i.tRelease + 1);
  const lossToHaul =
    i.losses === "refined" ? refinedLosses({ ...p.lossInputs, i: { ...i, tDeck: tH } }).toDeck : p.lossDetail.toDeck * Math.min(1, (tH - i.tRelease) / Math.max(1, i.tDeck - i.tRelease));
  const fpHaul = fpt - lossToHaul;
  const psiH = creep(i, p.VS, i.fci, tH - i.tRelease, i.tRelease);
  const camberHaul = Math.max(0, (p.dPs * (fpHaul / fpt) - p.dGr) * (1 + psiH));
  const haul = analyzeHauling({
    section,
    L: Lg * 12,
    w,
    Ec: p.Ec,
    fr: 0.24 * Math.sqrt(i.fc),
    left: hd.bunkPoint * 12,
    right: hd.bunkPoint * 12,
    sweep,
    placement: hd.haulTolerance,
    camber: camberHaul,
    impactUp: hd.haulImpactUp,
    impactDown: hd.haulImpactDown,
    impactUsage: "crown",
    windPressure: hd.wind / 144000,
    Ktheta: hd.truck.Ktheta,
    crown: hd.crown,
    superelevation: hd.superelevation,
    Hrc: hd.truck.Hrc,
    Hbg: hd.truck.Hbg,
    Wcc: hd.truck.Wcc,
    velocity: (hd.speed * 5280 * 12) / 3600,
    radius: hd.radius * 12,
    points: pointsFor(hd.bunkPoint, lossToHaul),
  });

  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity + 1e-9 });
  const ref = "5.5.4.3; PCI CB-02-16";
  const ft = (x: number) => `x = ${(x / 12).toFixed(1)} ft from the end`;
  const ls = lift.summary;
  add({ id: "lift-fscr", name: "Lifting: factor of safety against cracking", demand: 1, capacity: ls.FScr, unit: "", ref, note: ls.stable ? ft(ls.at.FScr) : "unstable: the girder rolls over on its lifting devices" });
  add({ id: "lift-fsf", name: "Lifting: factor of safety against failure", demand: 1.5, capacity: ls.adjFSf, unit: "", ref, note: `lifting devices ${hd.liftPoint} ft from each end` });
  add({ id: "lift-comp", name: "Lifting: compression, plumb girder (0.65 f′ci)", demand: Math.max(0, -ls.minDirect), capacity: 0.65 * i.fci, unit: "ksi", ref: "5.9.2.3.1a, PCI", note: ft(ls.at.minDirect) });
  add({ id: "lift-comp-peak", name: "Lifting: compression, tilted (0.70 f′ci)", demand: Math.max(0, -ls.minStress), capacity: 0.7 * i.fci, unit: "ksi", ref: "PCI CB-02-16", note: ft(ls.at.minStress) });
  const t0 = Math.min(0.0948 * Math.sqrt(i.fci), 0.2);
  const tLift = Math.max(0, ls.maxStress);
  add({ id: "lift-tens", name: tLift > t0 ? "Lifting: tension (with bonded bars)" : "Lifting: tension", demand: tLift, capacity: tLift > t0 ? 0.24 * Math.sqrt(i.fci) : t0, unit: "ksi", ref: "T. 5.9.2.3.1b-1", note: ft(ls.at.maxStress) });

  const slopes = [haul.crown, haul.superelevation];
  const name = (s: (typeof slopes)[number]) => (s.slope === "crown" ? `normal crown ${(s.alpha * 100).toFixed(0)}%` : `superelevation ${(s.alpha * 100).toFixed(0)}%`);
  const worstOf = (key: (s: (typeof slopes)[number]) => number) => slopes.reduce((a, b) => (key(b) < key(a) ? b : a));
  const fscr = worstOf((s) => s.summary.FScr);
  add({ id: "haul-fscr", name: "Hauling: factor of safety against cracking", demand: 1, capacity: fscr.summary.FScr, unit: "", ref, note: `${name(fscr)}; ${fscr.summary.stable ? ft(fscr.summary.at.FScr) : "unstable on the truck"}` });
  const fsf = worstOf((s) => s.summary.FSf);
  add({ id: "haul-fsf", name: "Hauling: factor of safety against failure", demand: 1.5, capacity: fsf.summary.FSf, unit: "", ref, note: name(fsf) });
  const fsr = worstOf((s) => s.summary.FSr);
  add({ id: "haul-fsr", name: "Hauling: factor of safety against rollover", demand: 1.5, capacity: fsr.summary.FSr, unit: "", ref, note: `${name(fsr)}; roll stiffness ${hd.truck.Ktheta.toLocaleString()} kip·in/rad` });
  const cg = worstOf((s) => s.summary.minDirect);
  add({ id: "haul-comp", name: "Hauling: compression, plumb girder (0.65 f′c)", demand: Math.max(0, -cg.summary.minDirect), capacity: 0.65 * i.fc, unit: "ksi", ref: "PCI CB-02-16", note: `${name(cg)}; ${ft(cg.summary.at.minDirect)}` });
  const cp = worstOf((s) => s.summary.minStress);
  add({ id: "haul-comp-peak", name: "Hauling: compression, tilted (0.70 f′c)", demand: Math.max(0, -cp.summary.minStress), capacity: 0.7 * i.fc, unit: "ksi", ref: "PCI CB-02-16", note: `${name(cp)}; ${ft(cp.summary.at.minStress)}` });
  const tc0 = Math.min(0.0948 * Math.sqrt(i.fc), 0.2);
  const tCrown = Math.max(0, haul.crown.summary.maxStress);
  const tSuper = Math.max(0, haul.superelevation.summary.maxStress);
  const cdot = isCdot(i);
  if (cdot) {
    // AASHTO 10th T. 5.9.2.3.1b-1 at the strength when hauled (5.9.2.3.1a): 0.0948√f′c ≤ 0.2 ksi, or 0.24√f′c with bonded bars.
    for (const [id, label, f, at] of [["haul-tens-crown", "on the crown", tCrown, haul.crown.summary.at.maxStress], ["haul-tens-super", "at maximum superelevation", tSuper, haul.superelevation.summary.at.maxStress]] as const)
      add({ id, name: `Hauling: tension ${label}${f > tc0 ? " (with bonded bars)" : ""}`, demand: f, capacity: f > tc0 ? 0.24 * Math.sqrt(i.fc) : tc0, unit: "ksi", ref: "T. 5.9.2.3.1b-1", note: ft(at) });
  } else {
    add({ id: "haul-tens-crown", name: tCrown > tc0 ? "Hauling: tension on the crown (with bonded bars)" : "Hauling: tension on the crown", demand: tCrown, capacity: tCrown > tc0 ? 0.19 * Math.sqrt(i.fc) : tc0, unit: "ksi", ref: "T. 5.9.2.3.1b-1, WSDOT", note: ft(haul.crown.summary.at.maxStress) });
    add({ id: "haul-tens-super", name: "Hauling: tension at maximum superelevation", demand: tSuper, capacity: 0.24 * Math.sqrt(i.fc), unit: "ksi", ref: "WSDOT (0.24√f′c)", note: ft(haul.superelevation.summary.at.maxStress) });
    add({ id: "haul-span", name: "Hauling: span between the truck's supports", demand: Lg - 2 * hd.bunkPoint, capacity: hd.truck.maxSpan, unit: "ft", ref: "haul truck" });
    add({ id: "haul-overhang", name: "Hauling: overhang past the supports", demand: hd.bunkPoint, capacity: hd.truck.maxOverhang, unit: "ft", ref: "haul truck" });
    add({ id: "haul-weight", name: "Hauling: girder weight", demand: Wg, capacity: hd.truck.maxWeight, unit: "kip", ref: "haul truck" });
  }
  // CDOT BDM 5.5.1.8: shipping and handling are the fabricator's design, so lifting and hauling are shown
  // for information; 5.5.1.9: the girder's length and weight against what ships along the Front Range.
  if (cdot) {
    for (const c of checks) {
      c.advisory = true;
      c.note = `${c.note ? `${c.note}; ` : ""}fabricator's design (CDOT BDM 5.5.1.8)`;
    }
    add({ id: "ship-length", name: "Shipping: girder length", demand: Lg, capacity: CDOT.shipLength, unit: "ft", ref: "CDOT BDM 5.5.1.9", note: "longer: coordinate the route with local suppliers" });
    add({ id: "ship-weight", name: "Shipping: girder weight", demand: Wg, capacity: CDOT.shipWeight, unit: "kip", ref: "CDOT BDM 5.5.1.9", note: "heavier: coordinate the route with local suppliers" });
  }
  return { lifting: lift, hauling: haul, fpHaul, lossToHaul, camberLift: Math.max(0, p.cRelease), camberHaul, tHaul: tH, Wg, checks };
}

export type HandlingResult = ReturnType<typeof handlingChecks>;

/** The web's elevations where principal tension is checked (as PGSuper): where the web meets the flanges' fillets (the
 * web's top and bottom, and the fillets' far ends, at their width), and the composite and girder centroids (at the web's width). */
function webElevations(shape: GirderShape, g: SectionProps, comp: Composite) {
  const p = shape.profile;
  const webIdx = p.map(([, hw], k) => (Math.abs(2 * hw - shape.web) < 1e-6 ? k : -1)).filter((k) => k >= 0);
  const levels: { y: number; where: string; bw: number }[] = [];
  if (webIdx.length) {
    const top = Math.max(...webIdx);
    const bot = Math.min(...webIdx);
    if (top + 1 < p.length - 1) levels.push({ y: p[top + 1][0], where: "top fillet", bw: 2 * p[top + 1][1] });
    levels.push({ y: p[top][0], where: "top of the web", bw: shape.web });
    levels.push({ y: p[bot][0], where: "bottom of the web", bw: shape.web });
    if (bot - 1 > 0) levels.push({ y: p[bot - 1][0], where: "bottom fillet", bw: 2 * p[bot - 1][1] });
  }
  if (comp.yb < shape.depth) levels.push({ y: comp.yb, where: "composite centroid", bw: shape.web });
  levels.push({ y: g.yb, where: "girder centroid", bw: shape.web });
  return levels;
}

/** Splitting resistance (5.9.4.4.1): the vertical bars within h/4 of the girder's end, from the stirrup zones measured from the girder's end (lengths and spacings in inches), as PGSuper sums them: legs × area × length in the zone / spacing. */
export function splittingAs(zones: { length: number; bar: number; legs: number; spacing: number; bundle?: StirrupZone["bundle"] }[], zoneLength: number) {
  let As = 0;
  let at = 0;
  for (let k = 0; k < zones.length && at < zoneLength - 1e-9; k++) {
    const z = zones[k];
    const last = k === zones.length - 1;
    const end = last ? Infinity : at + z.length;
    const inZone = Math.max(0, Math.min(end, zoneLength) - at);
    if (z.spacing > 0) As += (zoneAv(z) * inZone) / z.spacing;
    at = end;
  }
  return As;
}

// --- continuity: the section over a pier and the positive moment connection -------------------------

/** The bar stress limit in the positive moment connection at service (5.12.3.3), ksi. */
export const CONNECTION_STRESS = 36;

export type RestraintLoads = {
  tc: number; // days, the girders' age at continuity
  tf: number;
  dPsiG: number; // creep after continuity of the loads at release (prestress, girder)
  dPsiD: number; // of the deck's weight
  phi: number; // ψ(tf, tc): the girder's creep after continuity, relaxing the restraint
  relax: number; // (1 − e^−φ)/φ
  fpAvg: number; // ksi, the strand stress over that time
  creep: EndRotations; // EI·θ, kip·ft²
  eDeck: number; // the deck's shrinkage after continuity
  eGirder: number; // the girder's
  psiDeck: number;
  Fsh: number; // kip, the differential shrinkage force
  ed: number; // in, its eccentricity on the composite section
  shrinkage: EndRotations;
};

export type PierResult = {
  Mdc2: number;
  Mdw: number;
  Mr: number; // restraint moment (+ sagging)
  MllPos: number; // LL+IM positive moment at the pier, with the distribution factor
  Mfe: number; // for "fully effective": DC2 + DW + restraint + 50% LL
  fBottom: number; // ksi at the bottom of the diaphragm (compression +)
  effective: boolean;
  MuPos: number;
  Ms: number;
  fs: number;
  connection: ReturnType<typeof positiveConnection>;
  checks: Check[];
};

/** The composite section over a pier: the deck's bars in tension, the girder's bottom in compression (its f′c, C5.12.3.3). */
function negativeSection(i: GirderInputs, shape: GirderShape, comp: Composite, Ec: number) {
  const b = i.pierBars;
  const H = shape.depth;
  const top = BARS[b.topBar];
  const bot = BARS[b.botBar];
  if (!top || !bot || !(b.topSpacing > 0) || !(b.botSpacing > 0)) throw new DesignError("The deck's bars over the piers need a size and a spacing.");
  const mats = [
    { As: (top.area * comp.beff) / b.topSpacing, y: comp.h + i.sacrificial - b.coverTop - top.dia / 2 },
    { As: (bot.area * comp.beff) / b.botSpacing, y: H + comp.hh + b.coverBottom + bot.dia / 2 },
  ];
  if (mats.some((m) => m.y <= H + comp.hh || m.y >= comp.h + i.sacrificial)) throw new DesignError("The deck's bars over the piers don't fit in the deck with those covers.");
  const As = mats[0].As + mats[1].As;
  const b1 = beta1(i.fc);
  const a1 = alpha1(i.fc);
  const width = (y: number) => (y <= H ? widthAt(shape.profile, y) : y <= H + comp.hh ? shape.topWidth : comp.beff * comp.n);
  /** Compression (kip) and its centroid (in from the bottom) for a block of depth a. */
  const block = (a: number) => {
    let C = 0;
    let Cy = 0;
    const steps = Math.max(8, Math.ceil(a / 0.05));
    const dy = a / steps;
    for (let s = 0; s < steps; s++) {
      const y = (s + 0.5) * dy;
      const f = a1 * i.fc * width(y) * dy;
      C += f;
      Cy += f * y;
    }
    return { C, y: C > 0 ? Cy / C : 0 };
  };
  const forces = (c: number) => mats.map((m) => m.As * Math.max(-i.fy, Math.min(i.fy, (ES * 0.003 * (m.y - c)) / c)));
  let lo = 1e-6;
  let hi = comp.h;
  for (let it = 0; it < 80; it++) {
    const c = (lo + hi) / 2;
    if (block(b1 * c).C > forces(c).reduce((s, f) => s + f, 0)) hi = c;
    else lo = c;
  }
  const c = (lo + hi) / 2;
  const blk = block(b1 * c);
  const F = forces(c);
  const T = F.filter((f) => f > 0).reduce((s, f) => s + f, 0);
  const Mn = F.reduce((s, f, k) => s + f * (mats[k].y - blk.y), 0) / 12; // kip·ft
  const dt = mats[0].y;
  const et = (0.003 * (dt - c)) / c;
  const phi = et >= 0.005 ? 0.9 : et <= 0.002 ? 0.75 : 0.75 + (0.15 * (et - 0.002)) / 0.003; // 5.5.4.2, nonprestressed
  const de = T > 0 ? F.reduce((s, f, k) => s + Math.max(0, f) * mats[k].y, 0) / T : dt;
  const flex: Flexure = { c, a: b1 * c, fps: 0, fpsRaw: 0, T, Mn, dp: de, dt, arm: T > 0 ? (Mn * 12) / T : de - blk.y, et, phi, rect: true };
  // Concrete on the flexural tension side (the top half) for 5.7.3.4.2 when εs < 0.
  let Act = 0;
  for (let k = 0; k < 200; k++) {
    const y = comp.h / 2 + ((k + 0.5) / 200) * (comp.h / 2);
    Act += width(y) * (comp.h / 2 / 200);
  }
  // Cracking moment with the deck's top in tension, 5.6.3.3-1: γ1 = 1.6, γ3 = 0.67 (A615 Grade 60 bars).
  const frDeck = 0.24 * sqrt(i.fcDeck);
  const Mcr = (0.67 * 1.6 * frDeck * (comp.Std / comp.n)) / 12;
  // Service: the cracked section, the bars transformed (n = Es/Ec), the girder's bottom in compression.
  const nS = ES / Ec;
  let clo = 1e-6;
  let chi = Math.min(...mats.map((m) => m.y));
  const firstMoment = (x: number) => {
    let s = 0;
    const steps = 400;
    for (let k = 0; k < steps; k++) {
      const y = ((k + 0.5) / steps) * x;
      s += width(y) * (x - y) * (x / steps);
    }
    return s;
  };
  for (let it = 0; it < 60; it++) {
    const x = (clo + chi) / 2;
    if (firstMoment(x) > mats.reduce((s, m) => s + nS * m.As * (m.y - x), 0)) chi = x;
    else clo = x;
  }
  const ccr = (clo + chi) / 2;
  let Icr = mats.reduce((s, m) => s + nS * m.As * (m.y - ccr) ** 2, 0);
  for (let k = 0; k < 400; k++) {
    const y = ((k + 0.5) / 400) * ccr;
    Icr += width(y) * (ccr - y) ** 2 * (ccr / 400);
  }
  const steelStress = (Ms: number) => (Ms > 0 ? (nS * Ms * 12 * (mats[0].y - ccr)) / Icr : 0);
  // Crack control, 5.6.7-1 (Class 1 exposure, or Class 2 where severe).
  const dc = b.coverTop + top.dia / 2;
  const hTotal = comp.h + i.sacrificial;
  const betaS = 1 + dc / (0.7 * (hTotal - dc));
  const gammaE = i.exposure === "severe" ? 0.75 : 1.0;
  const crackControl = (fss: number) => {
    const f = Math.min(fss, 0.6 * i.fy);
    return { fss, betaS, gammaE, dc, smax: f > 0 ? (700 * gammaE) / (betaS * f) - 2 * dc : Infinity };
  };
  return { mats, As, flex, Mn, phi, phiMn: phi * Mn, c, Act, Mcr, frDeck, nS, ccr, Icr, steelStress, crackControl };
}

/** The positive moment connection at a pier: bars from the girders' bottoms into the diaphragm, the deck in compression. */
function positiveConnection(i: GirderInputs, comp: Composite, Ecd: number) {
  const bar = BARS[i.connection.bar];
  const As = i.connection.count > 0 && bar ? i.connection.count * bar.area : 0;
  const d = comp.h - i.connection.y;
  const a = (As * i.fy) / (alpha1(i.fcDeck) * i.fcDeck * comp.beff);
  const Mn = (As * i.fy * (d - a / 2)) / 12;
  const n = ES / Ecd;
  const c = As > 0 ? (-n * As + sqrt((n * As) ** 2 + 2 * comp.beff * n * As * d)) / comp.beff : 0;
  const Icr = (comp.beff * c ** 3) / 3 + n * As * (d - c) ** 2;
  const steelStress = (Ms: number) => (Ms <= 0 ? 0 : As > 0 ? (n * Ms * 12 * (d - c)) / Icr : Infinity);
  return { As, d, a, Mn, phiMn: 0.9 * Mn, n, c, Icr, steelStress };
}

// --- strands ----------------------------------------------------------------------------------------

type StrandGroup = {
  kind: "straight" | "debonded" | "harped";
  n: number;
  A: number; // in²
  bondFrom: number; // ft from each end where bond begins
  kappa: number; // development length factor, 5.9.4.3.2
  yAt: (xe: number) => number; // in, height at xe ft from the girder's end (symmetric)
  slope: (xe: number) => number; // rise toward the end, in/in (harped strands' vertical component)
};

export function strandGroups(i: GirderInputs, H: number, Lg: number): StrandGroup[] {
  const a = STRANDS[i.strandDia].area;
  const kb = H > 24 ? 1.6 : 1.0;
  const out: StrandGroup[] = [];
  for (const r of i.strands) {
    if (r.count <= 0) continue;
    const deb = r.debondLength && r.debondLength > 0 ? Math.min(r.debonded ?? 0, r.count) : 0;
    if (r.count - deb > 0) out.push({ kind: "straight", n: r.count - deb, A: (r.count - deb) * a, bondFrom: 0, kappa: kb, yAt: () => r.y, slope: () => 0 });
    if (deb > 0) out.push({ kind: "debonded", n: deb, A: deb * a, bondFrom: r.debondLength!, kappa: 2.0, yAt: () => r.y, slope: () => 0 });
  }
  const h = i.harped;
  if (h && h.count > 0) {
    const hp = h.harpPoint * Lg; // ft from each end
    if (hp <= 0 || hp > Lg / 2) throw new DesignError("The harp points must lie between the girder's end and midspan.");
    const drop = h.yEnd - h.yHarp; // in
    out.push({
      kind: "harped",
      n: h.count,
      A: h.count * a,
      bondFrom: 0,
      kappa: kb,
      yAt: (xe) => {
        const x = Math.min(xe, Lg - xe);
        return x >= hp ? h.yHarp : h.yEnd - (drop * x) / hp;
      },
      slope: (xe) => (Math.min(xe, Lg - xe) < hp ? drop / (hp * 12) : 0),
    });
  }
  return out;
}

// --- time-dependent losses (5.9.3) ------------------------------------------------------------------

/** Creep coefficient ψ(t, ti), 5.4.2.3.2-1 (t: days under load; ti: age when loaded). */
/**
 * The haunch by CDOT BDM 5.5.2.1, at a girder's centerline (in): the camber at deck placement with a
 * tolerance of ±30% (a CBT), at least ±1 in (D); the dead load deflection without long-term multipliers (E);
 * the deck's profile above the bearing-to-bearing chord at midspan (F, + where the profile is above the
 * chord); the cross-slope over half a level top flange; the minimum haunches (B). "computed": the least
 * haunch at the supports (to ¼ in) that keeps the minimums with an over-cambered girder, and for the dead
 * load the weighted haunch of Eq. 5.1 with an under-cambered one (G: designed for the larger haunch).
 */
export function haunchDesign(i: GirderInputs, shape: GirderShape, c: { cDeck: number; dTotal: number }) {
  const panels = !!i.deckPanels;
  const minSupport = panels ? CDOT.haunchSupport.panels : CDOT.haunchSupport.none;
  const minBetween = panels ? CDOT.haunchBetween.panels : CDOT.haunchBetween.none;
  const tolerance = Math.max(CDOT.camberTolerance * Math.max(0, c.cDeck), CDOT.camberToleranceMin);
  const cross = ((i.crossSlope ?? 0.02) * shape.topWidth) / 2;
  const profile = i.profileOrdinate ?? 0;
  const net = c.cDeck + c.dTotal; // the camber left under all the dead load (dTotal is negative)
  const base = { mode: i.haunchMode ?? "given", panels, minSupport, minBetween, tolerance, cross, profile, net };
  if (i.haunchMode !== "computed") return { ...base, D1: undefined, D2: undefined, D2over: undefined, D2under: undefined, design: i.haunch };
  const need = Math.max(minSupport + cross, minBetween + cross + tolerance + net - profile);
  const D1 = Math.ceil(need * 4 - 1e-9) / 4;
  const D2 = D1 - net + profile; // predicted, at midspan
  const D2over = D2 - tolerance;
  const D2under = D2 + tolerance;
  const design = (D1 + 10 * D2under + D1) / 12; // Eq. 5.1
  return { ...base, D1, D2, D2over, D2under, design };
}

export function creep(i: { humidity: number }, VS: number, fci: number, t: number, ti: number) {
  const ks = Math.max(1, 1.45 - 0.13 * VS);
  const khc = 1.56 - 0.008 * i.humidity;
  const kf = 5 / (1 + fci);
  const ktd = t / ((12 * (100 - 4 * fci)) / (fci + 20) + t);
  return 1.9 * ks * khc * kf * ktd * ti ** -0.118;
}

/** Shrinkage strain over t days, 5.4.2.3.3-1. */
export function shrinkage(i: { humidity: number }, VS: number, fci: number, t: number) {
  const ks = Math.max(1, 1.45 - 0.13 * VS);
  const khs = 2.0 - 0.014 * i.humidity;
  const kf = 5 / (1 + fci);
  const ktd = t / ((12 * (100 - 4 * fci)) / (fci + 20) + t);
  return ks * khs * kf * ktd * 0.48e-3;
}

function approximateLosses({ i, g, Aps, fpj }: { i: GirderInputs; g: SectionProps; Aps: number; fpj: number }) {
  const gh = 1.7 - 0.01 * i.humidity; // 5.9.3.3-2
  const gst = 5 / (1 + i.fci); // 5.9.3.3-3
  const dR = 2.4; // low-relaxation
  const total = 10 * ((fpj * Aps) / g.A) * gh * gst + 12 * gh * gst + dR; // 5.9.3.3-1
  // Split for the camber at the deck: in proportion to time (an estimate; approximate losses have no stages).
  return { kind: "approximate" as const, gh, gst, dR, total, toDeck: total * 0.5 };
}

/** Refined estimates, 5.9.3.4: transfer to deck placement, then deck placement to final. */
/** Refined time-dependent losses, AASHTO 5.9.3.4 (exported for the benchmarks). */
export function refinedLosses(p: { i: GirderInputs; g: SectionProps; comp: Composite; Aps: number; e: number; fpt: number; fcgp: number; Eci: number; Ec: number; Ecd: number; Mdeck: number; Msidl: number }) {
  const { i, g, comp, Aps, e, fpt, fcgp, Eci, Ec, Ecd, Mdeck, Msidl } = p;
  const VS = g.A / g.perimeter;
  const ti = i.tRelease;
  const td = i.tDeck;
  const tf = Math.max(i.tFinal, td + 1);
  const psiTfTi = creep(i, VS, i.fci, tf - ti, ti);
  const psiTdTi = creep(i, VS, i.fci, td - ti, ti);
  const psiTfTd = creep(i, VS, i.fci, tf - td, td);
  const fpy = 0.9 * i.fpu;
  // Transfer to deck placement
  const ebid = shrinkage(i, VS, i.fci, td - ti);
  const Kid = 1 / (1 + (EP / Eci) * (Aps / g.A) * (1 + (g.A * e ** 2) / g.I) * (1 + 0.7 * psiTfTi)); // 5.9.3.4.2a-2
  const dSR = ebid * EP * Kid; // 5.9.3.4.2a-1
  const dCR = (EP / Eci) * fcgp * psiTdTi * Kid; // 5.9.3.4.2b-1
  const dR1 = Math.max(0, (fpt / 30) * (fpt / fpy - 0.55)); // 5.9.3.4.2c-1, KL = 30
  const toDeck = dSR + dCR + dR1;
  // Deck placement to final: on the composite section (deck transformed to the girder's concrete).
  const nd = Ecd / Ec;
  const ts = i.deckT - i.sacrificial;
  const Ad = comp.beff * ts; // in², the deck's actual area
  const yp = g.yb - e; // strands' centroid, from the girder's bottom
  const epc = comp.yb - yp; // strand eccentricity on the composite section
  const ed = comp.deckCg - comp.yb; // deck eccentricity
  const ebif = shrinkage(i, VS, i.fci, tf - ti);
  const ebdf = Math.max(0, ebif - ebid);
  const Kdf = 1 / (1 + (EP / Eci) * (Aps / comp.A) * (1 + (comp.A * epc ** 2) / comp.I) * (1 + 0.7 * psiTfTi)); // 5.9.3.4.3a-2
  const dSD = ebdf * EP * Kdf; // 5.9.3.4.3a-1
  // Change in the strands' concrete stress from the losses to the deck, the deck and the superimposed loads.
  const dfcd = -(toDeck * Aps) * (1 / g.A + e ** 2 / g.I) - (Mdeck * e) / g.I - (Msidl * epc) / comp.I;
  const dCD = (EP / Eci) * fcgp * (psiTfTi - psiTdTi) * Kdf + (EP / Ec) * dfcd * psiTfTd * Kdf; // 5.9.3.4.3b-1 (negative: a gain)
  const dR2 = dR1; // 5.9.3.4.3c-1
  // Deck shrinkage (the deck loaded at a day old for its own creep): a gain, so negative here.
  const fciDeck = 0.8 * i.fcDeck;
  const VSd = ts / 2; // both faces of the deck dry
  const eddf = shrinkage(i, VSd, fciDeck, tf - td);
  const psiD = creep(i, VSd, fciDeck, tf - td, 1);
  void nd;
  const dfcdf = ((eddf * Ad * Ecd) / (1 + 0.7 * psiD)) * (1 / comp.A - (epc * ed) / comp.I); // 5.9.3.4.3d-2
  const dSS = (EP / Ec) * dfcdf * Kdf * (1 + 0.7 * psiTfTd); // 5.9.3.4.3d-1 (a gain when negative)
  const afterDeck = dSD + dCD + dR2 + dSS;
  return { kind: "refined" as const, VS, psiTfTi, psiTdTi, psiTfTd, ebid, ebif, ebdf, Kid, Kdf, dSR, dCR, dR1, dSD, dCD, dR2, dSS, dfcd, dfcdf, eddf, psiD, epc, ed, toDeck, afterDeck, total: toDeck + afterDeck };
}

/** Live load deflection at midspan: the truck alone, or 25% of it with the lane load (3.6.1.3.2), with IM on the truck, all lanes loaded with multiple presence, shared equally by the girders. */
function liveLoadDeflection(i: GirderInputs, EIc: number, lanes: number) {
  const L = i.L * 12;
  const mid = L / 2;
  const at = (P: number, a: number) => {
    const b = Math.min(a, L - a);
    return a < 0 || a > L ? 0 : (P * b * (3 * L ** 2 - 4 * b ** 2)) / (48 * EIc);
  };
  let truck = 0;
  for (let first = -60 * 12; first <= L; first += 3) {
    for (const dir of [1, -1]) {
      const axles = [
        { P: 8, d: 0 },
        { P: 32, d: 14 * 12 },
        { P: 32, d: 28 * 12 },
      ];
      truck = Math.max(truck, axles.reduce((s, ax) => s + at(ax.P, first + dir * ax.d), 0));
    }
  }
  void mid;
  const lane = (5 * (0.64 / 12) * L ** 4) / (384 * EIc);
  const mpf = [1.2, 1, 0.85, 0.65][Math.min(lanes, 4) - 1];
  const share = (lanes * mpf) / i.nGirders;
  const a = truck * 1.33 * share;
  const b = (0.25 * truck * 1.33 + lane) * share;
  return { delta: Math.max(a, b), truck: a, truckLane: b, share, governs: a >= b ? "design truck alone" : "25% of the truck with the lane load" };
}

/** The tension force in a girder's tensile zone, from a linear stress (for bonded bars at release). */
function tensionForce(p: Profile, H: number, fTop: number, fBot: number) {
  let F = 0;
  const steps = 400;
  for (let k = 0; k < steps; k++) {
    const y = ((k + 0.5) / steps) * H;
    const f = fBot + ((fTop - fBot) * y) / H;
    if (f < 0) F += -f * widthAt(p, y) * (H / steps);
  }
  return F;
}

function stirrupsAt(i: GirderInputs, x: number) {
  const fromEnd = Math.min(x, i.L - x);
  let acc = 0;
  for (let k = 0; k < i.stirrups.length; k++) {
    const z = i.stirrups[k];
    const last = k === i.stirrups.length - 1;
    if (last || fromEnd <= acc + z.length) return z;
    acc += z.length;
  }
  return i.stirrups[i.stirrups.length - 1];
}

/** Shear by the general procedure (5.7.3.4.2), with the harped strands' Vp and the section's φv. */
function shearAt(i: GirderInputs, shape: GirderShape, comp: Composite, flex: Flexure, Mu: number, Vu: number, x: number, Ec: number, ps: { Apt: number; Aptfpo: number; Vp: number; phiV: number; de: number; As?: number; Act?: number }): ShearResult {
  const bv = shape.web;
  // 5.7.2.8: the flexural lever arm (Mn over the tension force, all strands), not less than 0.9 de
  // (de to the tension side's strands) or 0.72 h.
  const dv = Math.max(flex.arm, 0.9 * ps.de, 0.72 * comp.h);
  const z = stirrupsAt(i, x);
  if (!z || z.spacing <= 0) throw new DesignError("Every stirrup zone needs a spacing.");
  const Av = zoneAv(z);
  const s = z.spacing;
  const { Vp, phiV } = ps;
  const VuNet = Math.abs(Vu - Vp);
  const MuIn = Math.max(Mu * 12, VuNet * dv); // 5.7.3.4.2: |Mu| ≥ |Vu − Vp| dv
  const As = ps.As ?? i.bottomBars.count * (BARS[i.bottomBars.bar]?.area ?? 0);
  const num = MuIn / dv + VuNet - ps.Aptfpo;
  const den = ES * As + EP * ps.Apt;
  let es = den > 0 ? num / den : 0.006;
  if (es < 0) {
    // Concrete on the flexural tension side (girder below h/2).
    let Act = ps.Act ?? 0;
    if (ps.Act === undefined) {
      const steps = 200;
      const top = Math.min(comp.h / 2, shape.depth);
      for (let k = 0; k < steps; k++) Act += widthAt(shape.profile, ((k + 0.5) / steps) * top) * (top / steps);
    }
    es = num / (den + Ec * Act);
  }
  es = Math.min(0.006, Math.max(-0.0004, es));
  const sqrtFc = sqrt(i.fc);
  const Avmin = (0.0316 * sqrtFc * bv * s) / i.fy; // 5.7.2.5-1
  const sxe = Math.min(80, Math.max(12, (dv * 1.38) / (i.ag + 0.63)));
  const beta = Av >= Avmin ? 4.8 / (1 + 750 * es) : ((4.8 / (1 + 750 * es)) * 51) / (39 + sxe); // 5.7.3.4.2-1, -2
  const theta = 29 + 3500 * es; // 5.7.3.4.2-3
  const Vc = 0.0316 * beta * sqrtFc * bv * dv; // 5.7.3.3-3
  const Vs = (Av * i.fy * dv) / Math.tan(rad(theta)) / s; // 5.7.3.3-4, α = 90°
  const Vmax = 0.25 * i.fc * bv * dv + Vp; // 5.7.3.3-2
  const Vn = Math.min(Vc + Vs + Vp, Vmax); // 5.7.3.3-1
  const needsAv = Vu > 0.5 * phiV * (Vc + Vp); // 5.7.2.3
  const vu = Math.abs(Vu - phiV * Vp) / (phiV * bv * dv); // 5.7.2.7-1
  const smax = vu < 0.125 * i.fc ? Math.min(0.8 * dv, 24) : Math.min(0.4 * dv, 12); // 5.7.2.6
  // Interface shear (5.7.4): cast-in-place deck on an intentionally roughened girder top.
  const bvi = shape.topWidth;
  const vui = Vu / (bvi * dv); // 5.7.4.5-1, ksi
  const Vui = vui * bvi * 12; // kip/ft
  const Acv = bvi * 12; // in² per ft
  const Avf = i.stirrupsIntoDeck ? (Av * 12) / s : 0; // in² per ft
  const fcMin = Math.min(i.fc, i.fcDeck);
  const Vni = Math.min(0.28 * Acv + 1.0 * Avf * i.fy, 0.3 * fcMin * Acv, 1.8 * Acv); // 5.7.4.3-1..-3, Pc = 0
  const needsMin = vui >= 0.21;
  const Avfmin = (0.05 * Acv) / i.fy; // 5.7.4.2-1
  return { dv, bv, es, beta, theta, Vc, Vs, Vp, Vn, Vmax, phiV, Av, s, Avmin, smax, needsAv, vu, interface: { vui, Vui, Vni, phiVni: 0.9 * Vni, Avf, Avfmin, needsMin } };
}

/** Checks of an input against a fixed limit (jacking at 0.75 fpu, CDOT's f′ci and f′c caps, the confinement
 * and debonding rules, whole stirrup spaces). They sit at 1.00 whenever the input is at its limit, so they
 * decide which span or girder governs only when they fail. */
const PRESCRIPTIVE = new Set(["fpj", "cdot-fci", "cdot-fc", "conf-bar", "conf-spacing", "conf-length", "stirrup-zones", "deb-row", "deb-section", "deb-length", "deb-max", "deb-outer", "harp-height", "harp-span", "harp-point", "bed-force", "ship-length", "ship-weight", "haunch-support", "haunch-mid"]);
/** Lifting, hauling and shipping happen before the deck: the same for every girder, so they don't choose one. */
const HANDLING = /^(lift|haul|ship)-/;
/** The highest demand-to-capacity ratio that decides what governs (a failed check always counts; an
 * advisory one never does). */
export function governingRatio(checks: Check[], choosingGirder: boolean) {
  const ratio = (c: Check) => (c.capacity > 0 ? c.demand / c.capacity : c.demand > 0 ? Infinity : 0);
  const counts = (c: Check) => !c.advisory && (!c.ok || (!PRESCRIPTIVE.has(c.id) && !(choosingGirder && HANDLING.test(c.id))));
  return Math.max(0, ...checks.filter(counts).map(ratio));
}

/** The design check: both girders, the controlling one first in the summary. */
/** The inputs as the criteria take them: under CDOT's, the relative humidity for creep and shrinkage is 55 % (BDM 5.3.3). */
export function criteriaInputs(i: GirderInputs): GirderInputs {
  return i.criteria === "cdot" && i.humidity !== 55 ? { ...i, humidity: 55 } : i;
}

export function designGirder(entered: GirderInputs) {
  const i = criteriaInputs(entered);
  if (i.L <= 0) throw new DesignError("The span needs a length.");
  if (i.S <= 0 || i.nGirders < 2) throw new DesignError("The bridge needs at least two girders and a spacing.");
  if (i.deckT - i.sacrificial <= 0) throw new DesignError("The deck needs a structural thickness.");
  if (!i.stirrups.length) throw new DesignError("Add a stirrup zone.");
  const extra = i.extraSpans ?? [];
  if (extra.length > 4) throw new DesignError("Up to five spans.");
  const ratioOf = (checks: Check[]) => governingRatio(checks, false);
  const sideOf = (ext: number, int: number): Side => (ext >= int - 1e-9 ? "exterior" : "interior");
  // CDOT BDM 5.5.2.1: a haunch worked out from the camber and dead load deflection, which depend on the
  // haunch's own weight: repeated until it settles (to 0.005 in).
  const solve = (si: GirderInputs, ext: boolean, ctx?: SpanContext) => {
    let r = designGirderLine(si, ext, ctx);
    if (si.haunchMode !== "computed") return r;
    let h = si.haunch;
    for (let k = 0; k < 10 && Math.abs(r.haunch.design - h) >= 0.005; k++) {
      h = r.haunch.design;
      r = designGirderLine({ ...si, haunch: h }, ext, ctx);
    }
    return r;
  };
  if (!extra.length) {
    const interior = solve(i, false);
    const exterior = solve(i, true);
    const controlling = sideOf(governingRatio(exterior.checks, true), governingRatio(interior.checks, true));
    const ok = interior.ok && exterior.ok;
    const spans: SpanDesign[] = [{ index: 0, L: i.L, interior, exterior, controlling, ok }];
    return { interior, exterior, controlling, ok, spans, piers: [] as PierDesign[], continuous: false, controllingSpan: 0, restraint: null };
  }

  // A continuous bridge (5.12.3.3): girders simple for their own weight and the deck, continuous for
  // the loads after the diaphragms are cast, with the restraint moments from creep and shrinkage.
  const Ls = [i.L, ...extra.map((s) => s.L)];
  if (Ls.some((L) => !(L > 0))) throw new DesignError("Every span needs a length.");
  const n = Ls.length;
  // The continuous beam spans from an abutment's bearing, or a pier's centerline, to the next: over a
  // pier the girders' bearings are pierBearingOffset either side of the single support (as PGSuper models it).
  const off = Math.max(0, i.pierBearingOffset ?? 0);
  const shift = Ls.map((_, k) => (k > 0 ? off : 0)); // a station's x on the girder → on the beam's span
  const La = Ls.map((L, k) => L + shift[k] + (k < n - 1 ? off : 0));
  const beam = continuousBeam(La);
  const caches = Ls.map(() => new Map<number, LiveEnvelope>());
  const live = (k: number) => (x: number) => {
    const key = Math.round(x * 1e6);
    let e = caches[k].get(key);
    if (!e) caches[k].set(key, (e = beam.liveEnvelope(k, x + shift[k])));
    return e;
  };
  const unitSupports = beam.uniformAll(0, 0).supports;
  const unit = (k: number) => (x: number) => {
    const L = La[k];
    const X = x + shift[k];
    return { M: (X * (L - X)) / 2 + unitSupports[k] * (1 - X / L) + unitSupports[k + 1] * (X / L), V: L / 2 - X + (unitSupports[k + 1] - unitSupports[k]) / L };
  };
  const cdot = isCdot(i);
  const cachesII = Ls.map(() => new Map<number, StrengthIIEnvelope>());
  const liveII = (k: number) => (x: number) => {
    const key = Math.round(x * 1e6);
    let e = cachesII[k].get(key);
    if (!e) cachesII[k].set(key, (e = strengthIIAt(beam, k, x + shift[k])));
    return e;
  };
  const ctxFor = (k: number, restraint: { left: number; right: number }, simpleToo: boolean): SpanContext => ({ index: k, n, beam, spans: Ls, La: La[k], shift: shift[k], contLeft: k > 0, contRight: k < n - 1, live: live(k), unit: unit(k), restraint, simpleToo, strengthII: cdot ? liveII(k) : undefined });

  const line = (ext: boolean) => {
    const zero = { left: 0, right: 0 };
    const first = Ls.map((_, k) => solve(spanInputs(i, k), ext, ctxFor(k, zero, false)));
    // Restraint moments at the supports (kip·ft, + sagging): creep and shrinkage, relaxed by creep.
    const relax = first[0].restraintLoads!.relax;
    const none = new Array<number>(n + 1).fill(0);
    // CDOT BDM 5.7.2: restraint moments are taken as zero and not computed.
    const on = !cdot && i.restraintMoments !== "none";
    const creepM = on ? beam.supportMoments(first.map((l) => l.restraintLoads!.creep)).map((v) => v * relax) : none;
    const shrinkM = on ? beam.supportMoments(first.map((l) => l.restraintLoads!.shrinkage)).map((v) => v * relax) : none;
    const Mr = creepM.map((v, k) => (i.restraintMoments === "positive" ? Math.max(0, v + shrinkM[k]) : v + shrinkM[k]));
    // Is each joint fully effective? AASHTO 5.12.3.3: the diaphragm's bottom in compression under the
    // superimposed permanent loads, the restraint moments and 50% of the live load. CDOT BDM 5.7.3: the
    // girders at least 60 days old when continuity is made. "envelope": never (simple and continuous enveloped).
    const effective = Mr.map((m, k) => {
      if (k === 0 || k === n) return true;
      if (i.continuity === "envelope") return false;
      if (cdot) return i.tContinuity >= CDOT.continuityAge;
      const p = first[k - 1].pierRight!;
      return p.Mdc2 + p.Mdw + m + 0.5 * p.MllPos <= 1e-9;
    });
    const lines = Ls.map((_, k) => solve(spanInputs(i, k), ext, ctxFor(k, { left: Mr[k], right: Mr[k + 1] }, !effective[k] || !effective[k + 1])));
    return { lines, Mr, creepM, shrinkM, effective };
  };
  const I = line(false);
  const E = line(true);
  const spans: SpanDesign[] = Ls.map((L, k) => {
    const interior = I.lines[k];
    const exterior = E.lines[k];
    return { index: k, L, interior, exterior, controlling: sideOf(governingRatio(exterior.checks, true), governingRatio(interior.checks, true)), ok: interior.ok && exterior.ok };
  });
  const piers: PierDesign[] = Ls.slice(1).map((_, p) => {
    const interior = I.lines[p].pierRight!;
    const exterior = E.lines[p].pierRight!;
    return { index: p + 1, interior, exterior, ok: interior.checks.every((c) => c.ok) && exterior.checks.every((c) => c.ok) };
  });
  const sideRatio = (side: Side) => Math.max(...spans.map((s) => governingRatio(s[side].checks, true)), ...piers.map((p) => governingRatio(p[side].checks, true)));
  const controlling = sideOf(sideRatio("exterior"), sideRatio("interior"));
  // The span with the highest ratio on the controlling girder; a tie goes to the longest span.
  const spanRatios = spans.map((s) => ratioOf(s[controlling].checks));
  const top = Math.max(...spanRatios);
  const controllingSpan = spans.reduce((best, s, k) => (spanRatios[k] >= top - 1e-9 && s.L > spans[best].L ? k : best), spanRatios.findIndex((r) => r >= top - 1e-9));
  return {
    interior: spans[controllingSpan].interior,
    exterior: spans[controllingSpan].exterior,
    controlling,
    ok: spans.every((s) => s.ok) && piers.every((p) => p.ok),
    spans,
    piers,
    continuous: true,
    controllingSpan,
    restraint: { interior: { Mr: I.Mr, creep: I.creepM, shrinkage: I.shrinkM, effective: I.effective }, exterior: { Mr: E.Mr, creep: E.creepM, shrinkage: E.shrinkM, effective: E.effective } },
  };
}

type Side = "interior" | "exterior";
export type SpanDesign = { index: number; L: number; interior: GirderResult; exterior: GirderResult; controlling: Side; ok: boolean };
export type PierDesign = { index: number; interior: PierResult; exterior: PierResult; ok: boolean };

/** A different girder section, with the strands moved to suit it: harped strands keep their distance
 * below the top at the ends (8 in if they were outside the old girder), and straight rows that would be
 * above the new girder's top flange come down to 2 in below its top. */
export function changeShape(i: GirderInputs, shapeId: string): GirderInputs {
  const depthOf = (x: GirderInputs) => {
    try {
      return girderShape(x).depth;
    } catch {
      return null;
    }
  };
  const next = { ...i, shape: shapeId };
  const oldH = depthOf(i);
  const newH = depthOf(next);
  if (!oldH || !newH) return next;
  const harp = (h: HarpedStrands): HarpedStrands => {
    const fromTop = oldH - h.yEnd;
    const yEnd = newH - (fromTop >= 2 ? fromTop : 8);
    return { ...h, yEnd: Math.max(h.yHarp, yEnd), yHarp: Math.min(h.yHarp, newH - 2) };
  };
  const rows = (r: StrandRow[]) => r.map((s) => (s.y >= newH - 1 ? { ...s, y: newH - 2 } : s));
  return {
    ...next,
    harped: harp(i.harped),
    strands: rows(i.strands),
    extraSpans: i.extraSpans.map((s) => ({ ...s, harped: s.harped ? harp(s.harped) : null, strands: s.strands ? rows(s.strands) : null })),
  };
}

/** Span k's inputs: its length, and its own strands or span 1's. */
export function spanInputs(i: GirderInputs, k: number): GirderInputs {
  if (k === 0) return i;
  const s = i.extraSpans[k - 1];
  return { ...i, L: s.L, strands: s.strands ?? i.strands, harped: s.harped ?? i.harped };
}

export type GirderDesign = ReturnType<typeof designGirder>;
