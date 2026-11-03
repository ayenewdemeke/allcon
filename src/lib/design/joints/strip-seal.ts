import { DesignError, type Check } from "../walls/cip";

// A strip seal expansion joint's movements and setting, AASHTO LRFD: the superstructure's movement
// from temperature (3.12.2, with γTU) and creep and shrinkage, normal to a skewed joint (14.5.3.2),
// against the seal's range; and the gap "A" (and overall width "W") to set at each installation
// temperature, midway between the openings that keep it within the seal's range when the bridge is
// coldest and hottest. Inches, feet and °F.

export type StripSealInputs = {
  L: number; // ft, expansion length to the joint
  skew: number; // deg, from a line normal to the bridge's centerline
  alpha: number; // per °F (5.4.2.2 concrete, 6.4.1 steel)
  creepShrink: number; // creep and shrinkage strain still to come (5.4.2.3)
  Tmax: number; // °F (3.12.2)
  Tmin: number; // °F
  gammaTU: number; // load factor on TU (Table 3.4.1-1)
  maxOpening: number; // in, the seal's largest opening (cold)
  minOpening: number; // in, its smallest (hot)
  installMin: number; // in, the least opening to place the gland
  rail: number; // in, each steel rail's width
  Ti: number; // °F, planned installation temperature
  tableFrom: number; // °F
  tableTo: number; // °F
  tableStep: number; // °F
};

/** The defaults: 170 ft of precast girders to a 0–4 in seal, skewed 20°. */
export const STRIP_SEAL_DEFAULTS: StripSealInputs = {
  L: 170,
  skew: 20,
  alpha: 6e-6,
  creepShrink: 0.0002,
  Tmax: 110,
  Tmin: -10,
  gammaTU: 1.2,
  maxOpening: 4,
  minOpening: 0.5,
  installMin: 1.5,
  rail: 1.25,
  Ti: 60,
  tableFrom: -30,
  tableTo: 120,
  tableStep: 10,
};

export function designStripSeal(i: StripSealInputs) {
  if (i.L <= 0 || i.maxOpening <= i.minOpening) throw new DesignError("The joint needs an expansion length, and the seal a range (its largest opening over its smallest).");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });
  const cos = Math.cos((i.skew * Math.PI) / 180);
  const move = (dT: number, strain: number) => i.L * 12 * (i.gammaTU * dT * i.alpha + strain) * cos; // in
  const total = move(i.Tmax - i.Tmin, i.creepShrink);
  const range = i.maxOpening - i.minOpening;
  add({ id: "range", name: "Total movement within the seal's range", demand: total, capacity: range, unit: "in", ref: "AASHTO 14.5.3.2" });

  /** Setting at an installation temperature: the joint opens as the bridge cools and shrinks, and
   * closes as it warms (shrinkage offsetting). */
  const at = (Ti: number) => {
    const cold = move(Ti - i.Tmin, i.creepShrink);
    const hot = move(i.Tmax - Ti, -i.creepShrink);
    const Amax = i.maxOpening - cold;
    const Amin = i.minOpening + hot;
    const A = (Amax + Amin) / 2;
    const status = Amin > Amax ? "too small" : Ti < i.Tmin || Ti > i.Tmax ? "outside" : A < i.installMin ? "wait" : "ok";
    return { Ti, cold, hot, Amax, Amin, A, W: A + 2 * i.rail, status };
  };
  const design = at(i.Ti);
  add({ id: "fits", name: `At ${i.Ti}°F: the openings fit (Amin ≤ Amax)`, demand: design.Amin, capacity: design.Amax, unit: "in", ref: "AASHTO 14.5.3.2" });
  add({ id: "install", name: `At ${i.Ti}°F: the gap is enough to place the gland`, demand: i.installMin, capacity: design.A, unit: "in", ref: "Manufacturer" });
  const table = [];
  for (let T = i.tableFrom; T <= i.tableTo + 1e-9 && table.length < 60; T += Math.max(i.tableStep, 1)) table.push(at(T));
  return { ok: checks.every((c) => c.ok), checks, cos, total, range, design, table };
}

export type StripSealResult = ReturnType<typeof designStripSeal>;
