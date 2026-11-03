import { DesignError, type Check } from "../walls/cip";

// Camber and haunch for a girder span: the haunch (or a deck's thickness, on adjacent box beams) at
// the supports and midspan, from the deck's profile over the girder (a vertical curve, chorded
// girders on a horizontal curve, the cross-slope across the flange), the girder's predicted camber
// at deck placement and dead load deflection, and tolerances on the camber: over-camber (or shims
// at the bearings instead) and under-camber, checking the girder keeps a positive camber. Inches,
// with stations and lengths in feet. Positive camber and deflection are upward.

export type HaunchInputs = {
  L: number; // ft, span (chord between bearings)
  D1: number; // in, haunch at the supports, at the girder's centerline
  flange: number; // in, top flange width
  slopedGirders: boolean; // girders sloped to match the cross-slope: no cross-slope effect
  crossSlope: number; // ft/ft
  // Vertical alignment (gradeIn = gradeOut for a tangent)
  vpiStation: number; // ft
  vpiElevation: number; // ft
  curveLength: number; // ft
  gradeIn: number; // %
  gradeOut: number; // %
  startStation: number; // ft, the span's first bearing
  // Horizontal alignment
  radius: number; // ft at the girder (0: tangent)
  slopeTowardCenter: boolean; // deck slopes down toward the curve's center (chording lowers the deck over the girder)
  // Girder (from its design)
  camber: number; // in, predicted camber at deck placement (prestress less self weight)
  deflection: number; // in, dead load deflection (negative, down), with superimposed dead load
  deflectionUnder: number; // in, the same recomputed with the under-camber haunch
  assumedAverage: number; // in, average haunch assumed for the dead load
  // Limits and tolerances (the owner's)
  minSupport: number; // in, at the flange edge at the supports
  minMidspan: number; // in, at midspan
  overPct: number; // over-camber, % of the camber
  overMin: number; // in, at least
  underPct: number; // under-camber, % of the camber
  underMin: number; // in, at least
  shims: boolean; // shims at the bearings take the over-camber
};

/** The defaults: a 100 ft bulb tee span on a crest vertical curve and a horizontal curve. */
export const HAUNCH_DEFAULTS: HaunchInputs = {
  L: 100,
  D1: 3,
  flange: 43,
  slopedGirders: false,
  crossSlope: 0.06,
  vpiStation: 500,
  vpiElevation: 5280,
  curveLength: 400,
  gradeIn: 8,
  gradeOut: -8,
  startStation: 450,
  radius: 1275,
  slopeTowardCenter: true,
  camber: 3.43,
  deflection: -1.505,
  deflectionUnder: -1.583,
  assumedAverage: 5.25,
  minSupport: 1.5,
  minMidspan: 1,
  overPct: 20,
  overMin: 1,
  underPct: 50,
  underMin: 1,
  shims: false,
};

/** Profile grade elevation (ft) at a station, on the vertical curve or its tangents. */
export function profile(i: Pick<HaunchInputs, "vpiStation" | "vpiElevation" | "curveLength" | "gradeIn" | "gradeOut">, station: number) {
  const g1 = i.gradeIn / 100;
  const g2 = i.gradeOut / 100;
  const pvc = i.vpiStation - i.curveLength / 2;
  const pvt = i.vpiStation + i.curveLength / 2;
  const elPvc = i.vpiElevation - g1 * (i.vpiStation - pvc);
  if (station <= pvc || i.curveLength <= 0) return station <= i.vpiStation ? i.vpiElevation - g1 * (i.vpiStation - station) : i.vpiElevation + g2 * (station - i.vpiStation);
  if (station >= pvt) return i.vpiElevation + g2 * (station - i.vpiStation);
  const x = station - pvc;
  return elPvc + g1 * x + ((g2 - g1) / (2 * i.curveLength)) * x ** 2;
}

export function designHaunch(i: HaunchInputs) {
  if (i.L <= 0) throw new DesignError("The span needs a length.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });

  // --- the deck's profile over the girder -----------------------------------------------------------
  const e1 = profile(i, i.startStation);
  const e2 = profile(i, i.startStation + i.L / 2);
  const e3 = profile(i, i.startStation + i.L);
  const vertical = (e2 - (e1 + e3) / 2) * 12; // the deck above the chord at midspan (crest: up)
  const middleOrdinate = i.radius > 0 ? i.radius * (1 - Math.cos(i.L / (2 * i.radius))) : 0; // ft
  const chord = (i.slopeTowardCenter ? -1 : 1) * middleOrdinate * i.crossSlope * 12;
  const deckEffect = vertical + chord; // in, the deck's rise over the girder's chord at midspan
  const crossEffect = i.slopedGirders ? 0 : (i.flange * i.crossSlope) / 2; // in, over half the flange

  // --- haunches -------------------------------------------------------------------------------------------
  const D1edge = i.D1 - crossEffect;
  add({ id: "support", name: "Haunch at the supports, at the flange edge", demand: i.minSupport, capacity: D1edge, unit: "in", ref: "Owner's minimum haunch" });
  const D2 = i.D1 - i.deflection - i.camber + deckEffect; // at midspan, the girder's centerline
  add({ id: "midspan", name: "Haunch at midspan, as predicted", demand: i.minMidspan, capacity: D2 - crossEffect, unit: "in", ref: "Owner's minimum haunch" });
  const average = (d1: number, d2: number) => d1 / 3 + (2 * d2) / 3; // a parabolic haunch, both ends d1
  const avg = average(i.D1, D2);
  add({ id: "average", name: "Average haunch assumed for the dead load covers the predicted one", demand: avg, capacity: i.assumedAverage * 1.02, unit: "in", ref: "Dead load assumption" });

  // --- camber tolerances ---------------------------------------------------------------------------------
  const over = Math.max((i.overPct / 100) * i.camber, i.overMin);
  const under = -Math.max((i.underPct / 100) * i.camber, i.underMin);
  const D2over = D2 - over - crossEffect; // at the flange edge
  if (!i.shims) add({ id: "over", name: "Over-cambered girder: haunch at midspan, flange edge", demand: i.minMidspan, capacity: D2over, unit: "in", ref: "Owner's camber tolerance" });
  const D2under = D2 - under; // at the girder's centerline
  const avgUnder = average(i.D1, D2under);
  const residual = i.camber + under + i.deflectionUnder;
  add({ id: "under", name: "Under-cambered girder keeps a positive camber", demand: 0, capacity: residual, unit: "in", ref: "Owner's camber tolerance" });

  return { ok: checks.every((c) => c.ok), checks, e1, e2, e3, vertical, middleOrdinate, chord, deckEffect, crossEffect, D1edge, D2, avg, over, under, D2over, D2under, avgUnder, residual, shim: i.shims ? over : 0 };
}

export type HaunchResult = ReturnType<typeof designHaunch>;
