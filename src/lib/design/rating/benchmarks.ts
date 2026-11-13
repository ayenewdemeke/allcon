import { DT_DEFAULTS, type DtInputs } from "./double-tee";

// BrR benchmarks for the double-tee rating: CDOT's sample LFR rating of TELLRD-PINE ST (a 45'-6" span
// of five 6 ft double tees with a 6" composite topping, no plans), rated in AASHTOWare BrR 7.2. Its
// model's values, read from the BrR export, and BrR's results from its Rating Results Summary Report
// (members GB, interior, and GE, exterior on the curb side). Values only; the package isn't kept here.
//
// BrR's model: prestress by force and eccentricity, P = 1797.08 kN (404 kip) at 190.5 mm (7.5 in)
// from the bottom, jacking ratio 0.75 (so A*s = 404 / (0.75·270) = 1.995 in²); girder concrete 155 pcf
// for dead load; final tension 1 ksi; a 3'-9 1/2" × 8" sidewalk; rail and curb 0.163 klf a side;
// 3" asphalt; no utilities (its dead loads don't carry the 5 psf its hand calcs work out) and no
// pedestrian load (the members' pedestrian force is left blank).

export const TELLRD: DtInputs = {
  ...DT_DEFAULTS,
  bridge: { ...DT_DEFAULTS.bridge, id: "TELLRD-PINE ST", yearBuilt: 1985, nbiSuper: 5 },
  span: 45.5,
  structureLength: 45.5 + 10 / 12, // 127 mm overhang each end
  numSpans: 1,
  skew: 0,
  // BrR's PS tee shape: 30 in deep, webs 48 in apart, 12 in flanges beyond them, 6.5 in flange, 7.5/4.5 in webs.
  units: { count: 5, spacing: 72, flangeWidth: 72, depth: 30, flangeThk: 6.5, stemSpacing: 48, stemTop: 7.5, stemBot: 4.5, exteriorTrimmed: false, layout: null, jointGap: 0 },
  deck: { present: true, thk: 6, fc: 4.5, pcf: 150 },
  roadway: { railToRail: 30.0833, railFaceOffset: 15, curbToCurb: 23.9167, curbFaceOffset: 15 },
  loads: {
    ...DT_DEFAULTS.loads,
    asphalt: 3,
    asphaltPcf: 146.667,
    concPcf: 155,
    sidewalks: [{ width: 3.7917, thk: 8 }],
    pedWidth: 0,
    pedestrians: false,
    sidewalkMountable: false,
    railKlf: 0.163,
    utilities: [], // BrR's dead loads (girder, deck, sidewalk, rail, asphalt: 407.2 kip·ft) carry no utilities
    diaphragmKip: 0,
  },
  materials: { ...DT_DEFAULTS.materials, fc: 6, fci: 6, strand: '1/2" 270 ksi LR', fpu: 270, aps: 0.153, jackingRatio: 0.75, lowRelaxation: true, strandsPerRowPerStem: 7, firstRow: 7.5, rowSpacing: 2 },
  prestress: { mode: "known", strands: 404 / (0.75 * 270) / 0.153 },
  options: { ...DT_DEFAULTS.options, tensionLimit: 1, legalLldf: "single" },
  brrDf: { intSingle: 0.86, intMulti: 1.095, extSingle: 0.958, extMulti: 0.958 },
};

/** BrR's report columns, in its order: name, type, level. */
export const TELLRD_BRR_COLUMNS: [string, string, string][] = [
  ["Colorado Legal Type 3", "Axle Load", "Legal Operating"],
  ["Colorado Legal Type 3-2", "Axle Load", "Legal Operating"],
  ["Colorado Legal Type 3S2", "Axle Load", "Legal Operating"],
  ["Colorado Permit Vehicle", "Axle Load", "Permit Operating"],
  ["EV2", "Axle Load", "Legal Operating"],
  ["EV3", "Axle Load", "Legal Operating"],
  ["HS 20-44", "Axle Load", "Inventory"],
  ["HS 20-44", "Axle Load", "Operating"],
  ["HS 20-44", "Lane", "Inventory"],
  ["HS 20-44", "Lane", "Operating"],
  ["Modified Tandem", "Axle Load", "Permit Operating"],
  ["NRL", "Axle Load", "Legal Operating"],
  ["SU4", "Axle Load", "Legal Operating"],
  ["SU5", "Axle Load", "Legal Operating"],
  ["SU6", "Axle Load", "Legal Operating"],
  ["SU7", "Axle Load", "Legal Operating"],
];
/** BrR's rating factors in those columns, members GB and GE. */
export const TELLRD_BRR_RF: Record<"GB" | "GE", number[]> = {
  GB: [1.939, 1.864, 1.94, 1.161, 1.962, 1.264, 0.812, 1.356, 1.182, 1.974, 1.261, 1.44, 1.937, 1.806, 1.623, 1.51],
  GE: [1.734, 1.666, 1.735, 1.038, 1.754, 1.13, 0.924, 1.543, 1.345, 2.246, 1.128, 1.287, 1.732, 1.614, 1.451, 1.35],
};
