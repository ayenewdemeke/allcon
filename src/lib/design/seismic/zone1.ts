import { BARS, DesignError, type Check } from "../walls/cip";

// A bridge's seismic requirements in Seismic Zone 1, AASHTO LRFD, where no seismic analysis is
// required (4.7.4.1): the zone (Table 3.10.6-1), the horizontal design connection forces at each
// restrained support (3.10.9.2), the minimum support lengths where the superstructure can move
// (4.7.4.4), and, where SD1 > 0.10, confinement spirals in the columns' plastic hinge regions
// (5.11.2, 5.11.4.1.4, 5.11.4.1.5). Kip, foot, inch.

export type Support = {
  name: string;
  DL: number; // kip, tributary permanent vertical reaction (the support's total)
  LL: number; // kip, tributary live load assumed during the earthquake
  bearings: number; // bearings sharing the connection force
  fixedLong: boolean; // restrained longitudinally
  fixedTrans: boolean; // restrained transversely
  provided: number; // in, support length provided (expansion supports)
  L: number; // ft, deck length to the adjacent expansion joint or the deck's end
  H: number; // ft, average column height (see 4.7.4.4)
  skew: number; // deg
};

export type Column = {
  name: string;
  D: number; // in, diameter
  cover: number; // in, clear cover to the spiral
  fc: number; // ksi
  fy: number; // ksi
  bar: number; // spiral bar size
  pitch: number; // in
  height: number; // ft, bending height (clear height, plus depth to fixity for a shaft)
};

export type Zone1Inputs = {
  As: number; // acceleration coefficient, Fpga PGA
  SDS: number;
  SD1: number;
  gammaEQ: number; // live load factor in Extreme Event I (Table 3.4.1-1)
  supports: Support[];
  columns: Column[];
};

/** The defaults: a 2-span, 235 ft steel girder bridge on a multi-column pier. */
export const ZONE1_DEFAULTS: Zone1Inputs = {
  As: 0.165,
  SDS: 0.338,
  SD1: 0.127,
  gammaEQ: 0,
  supports: [
    { name: "Abutment 1", DL: 493.9015, LL: 0, bearings: 8, fixedLong: false, fixedTrans: true, provided: 36, L: 235, H: 18, skew: 5 },
    { name: "Pier 2", DL: 1758.5888, LL: 0, bearings: 8, fixedLong: true, fixedTrans: true, provided: 0, L: 235, H: 18, skew: 5 },
    { name: "Abutment 3", DL: 561.2518, LL: 0, bearings: 8, fixedLong: false, fixedTrans: true, provided: 36, L: 235, H: 18, skew: 5 },
  ],
  columns: [{ name: "Pier 2 column", D: 42, cover: 2, fc: 4.5, fy: 60, bar: 5, pitch: 3.5, height: 28 }],
};

/** Seismic zone, AASHTO Table 3.10.6-1. */
export const seismicZone = (SD1: number) => (SD1 <= 0.15 ? 1 : SD1 <= 0.3 ? 2 : SD1 <= 0.5 ? 3 : 4);

/** Minimum support length, AASHTO Eq. 4.7.4.4-1 (in). */
export const supportLength = (L: number, H: number, skew: number) => (8 + 0.02 * L + 0.08 * H) * (1 + 0.000125 * skew ** 2);

export function designZone1(i: Zone1Inputs) {
  if (!i.supports.length) throw new DesignError("Add the bridge's supports.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });
  const zone = seismicZone(i.SD1);
  add({ id: "zone", name: "Seismic Zone 1: SD1 ≤ 0.15 (no seismic analysis required)", demand: i.SD1, capacity: 0.15, unit: "", ref: "AASHTO T. 3.10.6-1" });

  // --- horizontal design connection forces (3.10.9.2) -------------------------------------------------
  const factor = i.As < 0.05 ? 0.15 : 0.25;
  const reaction = (s: Support) => s.DL + i.gammaEQ * s.LL;
  const total = i.supports.reduce((sum, s) => sum + reaction(s), 0);
  const longFixed = i.supports.filter((s) => s.fixedLong);
  const longBearings = longFixed.reduce((n, s) => n + s.bearings, 0);
  // Longitudinally, the supports that restrain the superstructure share all of it.
  const longTotal = factor * total;
  const connections = i.supports.map((s) => {
    const trans = s.fixedTrans ? factor * reaction(s) : 0;
    const long = s.fixedLong && longBearings ? (longTotal * s.bearings) / longBearings : 0;
    return { name: s.name, reaction: reaction(s), long, trans, longPerBearing: s.bearings ? long / s.bearings : 0, transPerBearing: s.bearings ? trans / s.bearings : 0 };
  });
  if (!longFixed.length) add({ id: "conn-long", name: "Something restrains the superstructure longitudinally", demand: 1, capacity: 0, unit: "", ok: false, ref: "AASHTO 3.10.9.2" });

  // --- minimum support lengths (4.7.4.4), where the superstructure can move longitudinally --------------
  const percent = zone === 1 ? (i.As < 0.05 ? 0.75 : 1.0) : 1.5; // Table 4.7.4.4-1
  const supports = i.supports.map((s) => {
    const N = supportLength(s.L, s.H, s.skew);
    return { name: s.name, N, required: percent * N, provided: s.provided, expansion: !s.fixedLong };
  });
  supports.forEach((s, k) => {
    if (s.expansion) add({ id: `supp-${k}`, name: `${s.name}: support length ≥ ${Math.round(percent * 100)}% N`, demand: s.required, capacity: s.provided, unit: "in", ref: "AASHTO 4.7.4.4" });
  });

  // --- confinement in the plastic hinge regions (5.11.2: Zone 1 with SD1 > 0.10) --------------------------
  const confine = i.SD1 > 0.1;
  const columns = i.columns.map((c) => {
    const bar = BARS[c.bar];
    const Dcore = c.D - 2 * c.cover; // to the outside of the spiral
    const Ag = (Math.PI * c.D ** 2) / 4;
    const Ac = (Math.PI * Dcore ** 2) / 4;
    const rho1 = 0.45 * (Ag / Ac - 1) * (c.fc / c.fy); // AASHTO Eq. 5.6.4.6-1
    const rho2 = (0.12 * c.fc) / c.fy; // AASHTO Eq. 5.11.4.1.4-1
    const rhoReq = Math.max(rho1, rho2); // "not less than either": the larger
    const ds = Dcore - bar.dia; // spiral centerline diameter
    const rho = (4 * bar.area) / (ds * c.pitch);
    const pitchMax = Math.min(c.D / 4, 4); // 5.11.4.1.5
    const length = Math.max(c.D / 12, c.height / 6, 1.5); // ft, at each end (5.11.4.1.5)
    return { name: c.name, Dcore, Ag, Ac, rho1, rho2, rhoReq, ds, rho, AspReq: (rhoReq * ds * c.pitch) / 4, Asp: bar.area, pitchMax, length };
  });
  if (confine)
    columns.forEach((c, k) => {
      add({ id: `conf-rho-${k}`, name: `${c.name}: spiral ratio ρs`, demand: c.rhoReq, capacity: c.rho, unit: "", ref: "AASHTO 5.11.4.1.4" });
      add({ id: `conf-pitch-${k}`, name: `${c.name}: pitch ≤ D/4 and 4 in`, demand: i.columns[k].pitch, capacity: c.pitchMax, unit: "in", ref: "AASHTO 5.11.4.1.5" });
    });

  return { ok: checks.every((c) => c.ok), checks, zone, factor, total, longTotal, connections, percent, supports, confine, columns };
}

export type Zone1Result = ReturnType<typeof designZone1>;
