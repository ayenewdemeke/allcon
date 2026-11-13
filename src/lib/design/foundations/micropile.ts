import { agencyChecks, type Criteria } from "../agency-checks";
import { BARS, DesignError, type Check } from "../walls/cip";
import { analyzeLateral } from "./lateral";
import { toLayers, type SoilLayer } from "./piles";

// A micropile (a small drilled, grouted, steel-reinforced pile), AASHTO LRFD (10th Edition) Article
// 10.9, which follows FHWA's Micropile Design and Construction Reference Manual (FHWA-NHI-05-039,
// Sabatini et al. 2005) and its predecessor, FHWA's Micropile Design and Construction Guidelines
// Implementation Manual (FHWA-SA-97-070, 1997: Ch. 5, the cased and uncased lengths 5.E.2–5.E.3, the
// plunge length 5.E.6, strain compatibility 5.E.7, the elastic displacement 5.F.1, buckling 5.F.5), with
// the Caltrans Geotechnical Manual's micropile module (2021) for the composite pile's practice.
//
// - Grout-to-ground bond (10.9.3.5.2): Rs = π·db·αb·Lb, αb from the presumptive ranges of AASHTO
//   Table C10.9.3.5.2-1 (FHWA NHI-05-039 Table 5-3) by ground and grouting type A–E, or entered from a
//   load test; φ 0.55 presumptive, up to 0.70 with load tests (Table 10.5.5.2.5-1). The bond length
//   starts at the casing's tip (Caltrans: the casing carries none) unless the plunge length is used.
// - Tip resistance on competent rock (10.9.3.5.3, by 10.8.3.5.4c), optional; usually neglected.
// - Structural (10.9.3.10, Table 10.5.5.2.5-2): the cased length in compression
//   Rn = 0.85·(0.85·f'c·Ag + fy·(Ab + Ac)), φ 0.75, and tension fy·(Ab + Act), φ 0.80; the uncased
//   length 0.85·(0.85·f'c·Ag + fy·Ab) and fy·Ab; the steel's fy limited to the strain 0.003 can reach
//   (87 ksi, C10.9.3.10.2a); the plunge length's transfer Pt = φ·π·db·αb·Lp relieving the uncased
//   length (10.9.3.10.4).
// - Lateral: p–y (lateral.ts) on the cased section (casing and bar, grout cracked) with a fixed head in
//   the cap; the casing's bending with the axial load by a linear interaction (FHWA NHI-05-039 5.6.4,
//   AASHTO 6.9.2.2 Eq. -3); buckling with any unsupported length (10.9.3.10.6 → 10.7.3.13.4).
// Kip, foot and inch.

export type MicropileCase = { name: string; limit: "strength" | "service" | "extreme"; compression: number; tension: number; H: number };

export type BondGround = "soft-clay" | "stiff-clay" | "loose-sand" | "dense-sand" | "gravel" | "till" | "soft-shale" | "hard-shale" | "limestone" | "sandstone" | "granite";

/** AASHTO Table C10.9.3.5.2-1 (after FHWA NHI-05-039), typical nominal bond ranges (ksf) by grouting type A, B, C, D, E. */
export const BOND_TABLE: Record<BondGround, { name: string; ranges: ([number, number] | null)[] }> = {
  "soft-clay": { name: "Silt and clay (some sand), soft, medium plastic", ranges: [[0.7, 1.4], [0.7, 2.0], [0.7, 2.5], [0.7, 3.0], [0.7, 2.0]] },
  "stiff-clay": { name: "Silt and clay (some sand), stiff, dense to very dense", ranges: [[0.7, 2.5], [1.4, 4.0], [2.0, 4.0], [2.0, 4.0], [1.4, 4.0]] },
  "loose-sand": { name: "Sand (some silt), fine, loose to medium dense", ranges: [[1.4, 3.0], [1.4, 4.0], [2.0, 4.0], [2.0, 5.0], [1.4, 5.0]] },
  "dense-sand": { name: "Sand (some silt, gravel), fine to coarse, medium to very dense", ranges: [[2.0, 4.5], [2.5, 7.5], [3.0, 7.5], [3.0, 8.0], [2.5, 7.5]] },
  gravel: { name: "Gravel (some sand), medium to very dense", ranges: [[2.0, 5.5], [2.5, 7.5], [3.0, 7.5], [3.0, 8.0], [2.5, 7.5]] },
  till: { name: "Glacial till (silt, sand, gravel), medium to very dense, cemented", ranges: [[2.0, 4.0], [2.0, 6.5], [2.5, 6.5], [2.5, 7.0], [2.0, 6.5]] },
  "soft-shale": { name: "Soft shales, fresh to moderate fracturing", ranges: [[4.3, 11.5], null, null, null, null] },
  "hard-shale": { name: "Slates and hard shales, fresh to moderate fracturing", ranges: [[10.8, 28.8], null, null, null, null] },
  limestone: { name: "Limestone, fresh to moderate fracturing", ranges: [[21.6, 43.2], null, null, null, null] },
  sandstone: { name: "Sandstone, fresh to moderate fracturing", ranges: [[10.8, 36.0], null, null, null, null] },
  granite: { name: "Granite and basalt, fresh to moderate fracturing", ranges: [[28.8, 87.7], null, null, null, null] },
};

export const GROUT_TYPES = ["A", "B", "C", "D", "E"] as const;

/** Threadbar areas (in²) beyond #18 (ASTM A615 Grade 75 / 80 sizes used in micropiles). */
const BAR_AREA: Record<number, { area: number; dia: number }> = { ...BARS, 20: { area: 4.91, dia: 2.5 } };

export type MicropileInputs = {
  /** AASHTO LRFD, or with the CDOT Bridge Design Manual's rules too (none given: AASHTO). */
  criteria?: Criteria;
  // Section
  casingOD: number; // in
  casingT: number; // in, wall
  casingFy: number; // ksi
  threadReduction: number; // in², casing area lost at the threaded joints (tension)
  bar: number; // threadbar size
  barFy: number; // ksi
  fcGrout: number; // ksi
  holeD: number; // in, drill hole in the bond zone
  // Lengths
  cased: number; // ft, from the cap
  plunge: number; // ft, casing pushed into the bond zone (0: none)
  bond: number; // ft, below the casing
  unsupported: number; // ft, without lateral support below the cap
  embed: number; // in, into the cap
  // Ground
  bondGround: BondGround;
  grouting: (typeof GROUT_TYPES)[number];
  alphaB: number; // ksf, nominal bond used (0: the table's lower bound)
  phiBond: number; // 0.55 presumptive, ≤ 0.70 with load tests
  tipOnRock: boolean;
  quKsf: number; // rock under the tip
  soil: SoilLayer[]; // for the lateral analysis, from the cap down
  tolerable: number; // in, lateral
  tolerableAxial: number; // in, elastic shortening at the Service load
  spacing: number; // ft, center to center
  cases: MicropileCase[];
};

/** A 7 in × 0.5 in casing over a #20 bar, 20 ft cased, 35 ft bonded in claystone (a soft shale) by gravity grouting (Type A), αb 7 ksf mid-range. */
export const MICROPILE_DEFAULTS: MicropileInputs = {
  casingOD: 7,
  casingT: 0.5,
  casingFy: 80,
  threadReduction: 1.5,
  bar: 20,
  barFy: 75,
  fcGrout: 5,
  holeD: 8,
  cased: 20,
  plunge: 0,
  bond: 35,
  unsupported: 0,
  embed: 12,
  bondGround: "soft-shale",
  grouting: "A",
  alphaB: 7,
  phiBond: 0.55,
  tipOnRock: false,
  quKsf: 100,
  soil: [
    { name: "Sandy fill", thickness: 10, kind: "sand", gamma: 120, phi: 32, k: 90, su: 0, e50: 0.007, qu: 0, Em: 0, rqd: 0 },
    { name: "Silty sand", thickness: 10, kind: "sand", gamma: 60, phi: 34, k: 60, su: 0, e50: 0.007, qu: 0, Em: 0, rqd: 0 },
    { name: "Claystone", thickness: 30, kind: "weak-rock", gamma: 65, phi: 0, k: 0, su: 0, e50: 0, qu: 300, Em: 30000, rqd: 50 },
  ],
  tolerable: 0.5,
  tolerableAxial: 0.5,
  spacing: 3,
  cases: [
    { name: "Strength I", limit: "strength", compression: 230, tension: 0, H: 4 },
    { name: "Strength III", limit: "strength", compression: 150, tension: 60, H: 6 },
    { name: "Service I", limit: "service", compression: 160, tension: 0, H: 3 },
  ],
};

export function micropileBond(i: Pick<MicropileInputs, "bondGround" | "grouting" | "alphaB">) {
  const row = BOND_TABLE[i.bondGround];
  const range = row.ranges[GROUT_TYPES.indexOf(i.grouting)];
  return { range, alpha: i.alphaB > 0 ? i.alphaB : range ? range[0] : 0, row };
}

export function designMicropile(i: MicropileInputs) {
  if (!(i.casingOD > 2 * i.casingT && i.casingT > 0)) throw new DesignError("Give the casing's outside diameter and wall.");
  if (!(i.holeD > 0 && i.bond > 0)) throw new DesignError("Give the drill hole's diameter and the bond length.");
  if (!i.cases.length) throw new DesignError("Enter at least one load case.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });
  const b = BAR_AREA[i.bar];
  if (!b) throw new DesignError("Choose a bar size.");
  const Ab = b.area;
  const IDc = i.casingOD - 2 * i.casingT;
  const Ac = (Math.PI / 4) * (i.casingOD ** 2 - IDc ** 2);
  const Act = Math.max(0, Ac - i.threadReduction);
  const AgCased = (Math.PI / 4) * IDc ** 2 - Ab; // grout inside the casing
  const AgUncased = (Math.PI / 4) * i.holeD ** 2 - Ab;
  const fyC = Math.min(i.casingFy, 87); // strain compatibility at 0.003 (C10.9.3.10.2a)
  const fyB = Math.min(i.barFy, 87);
  const RnCC = 0.85 * (0.85 * i.fcGrout * AgCased + fyB * Ab + fyC * Ac);
  const RnCU = 0.85 * (0.85 * i.fcGrout * AgUncased + fyB * Ab);
  const RnTC = Math.min(i.casingFy, i.barFy) * (Ab + Act);
  const RnTU = i.barFy * Ab;
  const bond = micropileBond(i);
  if (bond.alpha <= 0) throw new DesignError("That grouting type has no presumptive bond for this ground: enter αb from a load test.");
  const db = i.holeD / 12;
  const Rs = Math.PI * db * bond.alpha * i.bond;
  const Pt = i.plunge > 0 ? i.phiBond * Math.PI * db * bond.alpha * i.plunge : 0;
  const Rp = i.tipOnRock ? 2.5 * i.quKsf * (Math.PI / 4) * db * db : 0;
  const phiTip = 0.5;
  const pick = <T,>(arr: T[], f: (t: T) => number) => arr.reduce((a, b2) => (f(b2) > f(a) ? b2 : a), arr[0]);
  const factored = i.cases.filter((c) => c.limit !== "service");
  const service = i.cases.filter((c) => c.limit === "service");

  add({ id: "spacing", name: "Center-to-center spacing at least 30 in or 3 hole diameters", demand: Math.max(30, 3 * i.holeD) / 12, capacity: i.spacing, unit: "ft", ref: "AASHTO 10.9.1.2" });
  add({ id: "embed", name: "Embedment into the cap", demand: 12, capacity: i.embed, unit: "in", ref: "AASHTO 10.9.1.2" });
  if (factored.length) {
    const c = pick(factored, (x) => x.compression);
    const phiB = c.limit === "extreme" ? 1 : i.phiBond;
    add({ id: "bond-comp", name: `Grout-to-ground bond in compression (${c.name})`, demand: c.compression, capacity: phiB * Rs + (c.limit === "extreme" ? 1 : phiTip) * Rp + Pt, unit: "kip", ref: "AASHTO 10.9.3.5.2, 10.9.3.5.3" });
    add({ id: "cased-comp", name: `Cased length in compression (${c.name})`, demand: c.compression, capacity: 0.75 * RnCC, unit: "kip", ref: "AASHTO 10.9.3.10.2a" });
    add({ id: "uncased-comp", name: `Uncased length in compression, less the plunge length's transfer (${c.name})`, demand: Math.max(0, c.compression - Pt), capacity: 0.75 * RnCU, unit: "kip", ref: "AASHTO 10.9.3.10.2b, 10.9.3.10.4" });
    const t = pick(factored, (x) => x.tension);
    if (t.tension > 0) {
      const phiU = t.limit === "extreme" ? 0.8 : i.phiBond;
      add({ id: "bond-ten", name: `Grout-to-ground bond in tension (${t.name})`, demand: t.tension, capacity: phiU * Rs + Pt, unit: "kip", ref: t.limit === "extreme" ? "AASHTO 10.9.3.7, CDOT BDM 10.3.3" : "AASHTO 10.9.3.7" });
      add({ id: "cased-ten", name: `Cased length in tension, at the casing's threads (${t.name})`, demand: t.tension, capacity: 0.8 * RnTC, unit: "kip", ref: "AASHTO 10.9.3.10.3a" });
      add({ id: "uncased-ten", name: `Uncased length in tension: the bar (${t.name})`, demand: Math.max(0, t.tension - Pt), capacity: 0.8 * RnTU, unit: "kip", ref: "AASHTO 10.9.3.10.3b" });
    }
  }

  // --- lateral ---------------------------------------------------------------------------------------------------
  const Es = 29000;
  const Igrout = (Math.PI * IDc ** 4) / 64;
  const Icasing = (Math.PI * (i.casingOD ** 4 - IDc ** 4)) / 64;
  const Ibar = (Math.PI * b.dia ** 4) / 64;
  const Eg = 57 * Math.sqrt(i.fcGrout * 1000); // ksi, grout as concrete (ACI 318 form)
  const EI = Es * (Icasing + Ibar) + 0.4 * Eg * Igrout; // the grout cracked
  const layers = [...(i.unsupported > 0 ? [{ thickness: i.unsupported, model: { kind: "none" as const } }] : []), ...toLayers(i.soil)];
  const length = i.cased + i.bond;
  const lat = (c: MicropileCase) => (c.H > 0 ? analyzeLateral({ length, D: i.casingOD, EI, Q: c.compression, head: { kind: "fixed", H: c.H }, layers }) : null);
  const Zc = (i.casingOD ** 3 - IDc ** 3) / 6;
  const Mp = i.casingFy * Zc; // kip·in, the casing (D/t well within compact limits for micropiles)
  const comb = factored.map((c) => {
    const r = lat(c);
    if (!r) return null;
    // Buckling: unsupported length plus depth to fixity, K = 1.2 (sway, fixed in the cap), the casing only (conservative).
    const KL = i.unsupported > 0 ? 1.2 * (i.unsupported + (r.zZero ?? 0)) * 12 : 0;
    const rg = Math.sqrt((Icasing + Ibar) / (Ac + Ab));
    const Pe = KL > 0 ? (Math.PI ** 2 * Es * (Ac + Ab)) / (KL / rg) ** 2 : Infinity;
    const Po = 0.75 * RnCC;
    const Pr = KL > 0 ? Math.min(Po, 0.75 * 0.877 * Pe) : Po;
    const value = c.compression / Pr + (r.Mmax * 12) / (1.0 * Mp);
    return { c, r, value, Pr, KL };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  if (comb.length) {
    const g = pick(comb, (x) => x.value);
    add({ id: "interaction", name: `Casing: axial with flexure (${g.c.name})`, demand: g.value, capacity: 1, unit: "", ref: "AASHTO 10.9.3.10.1, 6.9.2.2 Eq. -3; FHWA NHI-05-039 5.6.4" });
  }
  // Elastic shortening at the Service load (FHWA-SA-97-070 5.F.1): Δ = P·L/(A·E), over the cased length
  // and half the bond length (the bond's resultant), each with its composite stiffness.
  const EAc = Es * (Ac + Ab) + Eg * AgCased;
  const EAu = Es * Ab + Eg * AgUncased;
  const elastic = service.length
    ? (() => {
        const g = pick(service, (x) => x.compression);
        return { c: g, d: (g.compression * i.cased * 12) / EAc + (g.compression * (i.bond / 2) * 12) / EAu };
      })()
    : null;
  if (elastic) add({ id: "elastic", name: `Elastic shortening at the Service load (${elastic.c.name})`, demand: elastic.d, capacity: i.tolerableAxial, unit: "in", ref: "FHWA-SA-97-070 5.F.1, FHWA-NHI-05-039 5.10", advisory: true });
  const sv = service.map((c) => ({ c, r: lat(c) })).filter((x) => x.r);
  if (sv.length) {
    const g = pick(sv, (x) => Math.abs(x.r!.y0));
    add({ id: "deflection", name: `Lateral deflection at the cap (${g.c.name})`, demand: Math.abs(g.r!.y0), capacity: i.tolerable, unit: "in", ref: "AASHTO 10.9.3.9, 10.7.2.4" });
  }
  return { checks: agencyChecks(checks, i.criteria), elastic, Ab, Ac, Act, AgCased, AgUncased, RnCC, RnCU, RnTC, RnTU, bond, Rs, Pt, Rp, EI, Mp, comb, length };
}

export type MicropileResult = ReturnType<typeof designMicropile>;
