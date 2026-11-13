import { BARS, DesignError, flexure, type Bars, type Check } from "../walls/cip";
import { axialResistance, fixityEmbedment, flexuralResistance, HP_SECTIONS, interaction, PHI_PILE } from "./hpile";
import { analyzeLateral, type Layer } from "./lateral";

// A group of driven steel H-piles under a rectangular cap (a pier footing on piles), AASHTO LRFD
// (10th Edition) with CDOT BDM 10.5 and FHWA GEC 12 (FHWA-NHI-16-009) and GEC 9 (FHWA-HIF-18-031).
//
// - Pile loads on a rigid cap: P/n ± M·x/Σx² (the elastic method, GEC 12 9.8), each case.
// - Geotechnical axial: the nominal resistance per pile from the geotechnical report (a dynamic
//   method's driving criterion) with its resistance factor (AASHTO Table 10.5.5.2.3-1), reduced by
//   20 % for groups of three piles or fewer (CDOT BDM 10.5.2.2, AASHTO C10.5.5.2.3); uplift.
// - Lateral: p–y (lateral.ts) with a fixed head (the cap), the group's p-multipliers by row
//   (AASHTO Table 10.7.2.4-1): the group's deflection from a pile with the rows' average multiplier
//   under the average shear, then each row's pile pushed through that deflection for its shear and
//   moment (GEC 9 7.4); its deflection against a tolerable value at the Service limit.
// - Structural: axial only with φc 0.50 / 0.60 (6.5.4.2), axial with flexure by 6.9.2.2.1 with φc
//   0.70, φf 1.00 (6.15.2), the effective length the unsupported length plus the depth to the first
//   zero deflection (6.15.3.3, C6.15.2), λ = 0 when fully embedded (10.7.3.13.1).
// - Layout: spacing ≥ 30 in and 2.5 pile widths, 9 in from a pile's side to the cap's edge, 12 in
//   embedment (AASHTO 10.7.1.2) and the fixed-head embedment of BDM 10.5.3.
// - The cap: flexure at the column's face from the pile reactions beyond it (5.12.8.4), one-way shear
//   at dv (5.12.8.6.1: a pile counts in full with its center dp/2 or more outside the section, none
//   with it dp/2 or more inside, in between in proportion), two-way shear at the column and at a
//   corner pile (5.12.8.6.3).
// Kip, foot and inch.

export type PileCase = { name: string; limit: "strength" | "service" | "extreme"; P: number; MB: number; ML: number; HB: number; HL: number };

/** A soil layer for the lateral analysis, in the units a geotechnical report gives. */
export type SoilLayer = {
  name: string;
  thickness: number; // ft
  kind: "sand" | "soft-clay" | "stiff-clay" | "weak-rock" | "none";
  gamma: number; // pcf, effective
  phi: number; // deg (sand)
  k: number; // pci (sand)
  su: number; // psf (clay)
  e50: number; // (clay)
  qu: number; // psi (rock)
  Em: number; // psi (rock)
  rqd: number; // % (rock)
};

export const toLayers = (soil: SoilLayer[]): Layer[] =>
  soil.map((s) => ({
    thickness: s.thickness,
    name: s.name,
    model:
      s.kind === "sand"
        ? { kind: "sand", phi: s.phi, gamma: s.gamma, k: s.k }
        : s.kind === "soft-clay"
          ? { kind: "soft-clay", su: s.su, gamma: s.gamma, e50: s.e50 }
          : s.kind === "stiff-clay"
            ? { kind: "stiff-clay", su: s.su, gamma: s.gamma, e50: s.e50 }
            : s.kind === "weak-rock"
              ? { kind: "weak-rock", qu: s.qu, Em: s.Em, rqd: s.rqd, krm: 0.0005 }
              : { kind: "none" },
  }));

export type PileInputs = {
  section: string;
  Fy: number;
  nB: number; // piles along B
  nL: number;
  sB: number; // ft, spacing along B
  sL: number;
  edge: number; // ft, pile center to the cap's edge
  capT: number; // in
  embed: number; // in, pile into the cap
  weakAlong: "B" | "L"; // loads along this direction bend the piles about their weak axis
  length: number; // ft, below the cap
  unsupported: number; // ft, the length without soil below the cap (scour, a prebore, water)
  driving: "good" | "severe";
  Rn: number; // kip, nominal geotechnical axial resistance per pile
  phiDyn: number;
  Rup: number; // kip, nominal uplift resistance per pile
  phiUp: number;
  tolerable: number; // in, lateral deflection at the Service limit
  soil: SoilLayer[];
  // Cap and column
  Df: number; // ft, ground to the cap's base
  gammaSoil: number; // pcf, over the cap
  colShape: "rectangular" | "round";
  colB: number; // in
  colL: number;
  fc: number;
  fy: number;
  gammaC: number;
  cover: number; // in, to the bottom bars (the piles pass between them)
  barsB: Bars; // bottom, along B (lower layer)
  barsL: Bars;
  exposure: 1 | 2;
  cases: PileCase[];
};

/** Nine HP 12x53 piles at 4'-6" under a 13'-6" square cap, 5 ft thick, driven to rock. */
export const PILE_DEFAULTS: PileInputs = {
  section: "HP12x53",
  Fy: 50,
  nB: 3,
  nL: 3,
  sB: 4.5,
  sL: 4.5,
  edge: 2.25,
  capT: 60,
  embed: 24,
  weakAlong: "B",
  length: 35,
  unsupported: 0,
  driving: "good",
  Rn: 450,
  phiDyn: 0.65,
  Rup: 120,
  phiUp: 0.5,
  tolerable: 1,
  soil: [
    { name: "Sandy fill", thickness: 10, kind: "sand", gamma: 120, phi: 32, k: 90, su: 0, e50: 0.007, qu: 0, Em: 0, rqd: 0 },
    { name: "Silty sand", thickness: 15, kind: "sand", gamma: 60, phi: 34, k: 60, su: 0, e50: 0.007, qu: 0, Em: 0, rqd: 0 },
    { name: "Claystone", thickness: 30, kind: "weak-rock", gamma: 70, phi: 0, k: 0, su: 0, e50: 0, qu: 300, Em: 30000, rqd: 50 },
  ],
  Df: 6,
  gammaSoil: 125,
  colShape: "round",
  colB: 42,
  colL: 42,
  fc: 4.5,
  fy: 60,
  gammaC: 0.15,
  cover: 3,
  barsB: { bar: 8, spacing: 9 },
  barsL: { bar: 8, spacing: 9 },
  exposure: 1,
  cases: [
    { name: "Strength I", limit: "strength", P: 1600, MB: 600, ML: 250, HB: 40, HL: 15 },
    { name: "Strength III", limit: "strength", P: 1250, MB: 900, ML: 150, HB: 75, HL: 15 },
    { name: "Service I", limit: "service", P: 1150, MB: 420, ML: 170, HB: 28, HL: 10 },
  ],
};

/** AASHTO Table 10.7.2.4-1, interpolated on spacing / width (3 to 5), row 1, 2, 3+. */
export function pMultiplier(row: number, spacingRatio: number) {
  const r = Math.min(5, Math.max(3, spacingRatio));
  const f = (r - 3) / 2;
  const at3 = row <= 1 ? 0.8 : row === 2 ? 0.4 : 0.3;
  const at5 = row <= 1 ? 1.0 : row === 2 ? 0.85 : 0.7;
  return at3 + (at5 - at3) * f;
}

export function designPiles(i: PileInputs) {
  const s = HP_SECTIONS[i.section];
  if (!s) throw new DesignError("Choose an H-pile section.");
  if (!(i.nB >= 1 && i.nL >= 1 && i.length > 0)) throw new DesignError("The group needs at least one pile and a length.");
  if (!i.cases.length) throw new DesignError("Enter at least one load case.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? (c.lowerIsBetter ? c.demand >= c.capacity : c.demand <= c.capacity) });
  const n = i.nB * i.nL;
  const capB = (i.nB - 1) * i.sB + 2 * i.edge;
  const capL = (i.nL - 1) * i.sL + 2 * i.edge;
  const piles: { x: number; y: number; row: { B: number; L: number } }[] = [];
  for (let a = 0; a < i.nB; a++) for (let b = 0; b < i.nL; b++) piles.push({ x: -((i.nB - 1) * i.sB) / 2 + a * i.sB, y: -((i.nL - 1) * i.sL) / 2 + b * i.sL, row: { B: a, L: b } });
  const Sx2 = piles.reduce((t, p) => t + p.x ** 2, 0);
  const Sy2 = piles.reduce((t, p) => t + p.y ** 2, 0);
  const tCap = i.capT / 12;
  const colArea = i.colShape === "round" ? (Math.PI * (i.colB / 12) ** 2) / 4 : (i.colB / 12) * (i.colL / 12);
  const Wcap = capB * capL * tCap * i.gammaC;
  const Wsoil = Math.max(0, capB * capL - colArea) * Math.max(0, i.Df - tCap) * (i.gammaSoil / 1000);
  const width = Math.max(s.bf, s.d); // in, facing the soil
  const pileD = Math.max(s.bf, s.d);

  // --- layout -------------------------------------------------------------------------------------------------
  const minSpacing = Math.max(30, 2.5 * pileD) / 12;
  if (i.nB > 1) add({ id: "spacing-B", name: "Pile spacing along B", demand: minSpacing, capacity: i.sB, unit: "ft", ref: "AASHTO 10.7.1.2" });
  if (i.nL > 1) add({ id: "spacing-L", name: "Pile spacing along L", demand: minSpacing, capacity: i.sL, unit: "ft", ref: "AASHTO 10.7.1.2" });
  add({ id: "edge", name: "Pile side to the cap's edge", demand: 9, capacity: i.edge * 12 - pileD / 2, unit: "in", ref: "AASHTO 10.7.1.2" });
  const fix = fixityEmbedment(s, i.Fy, i.fc);
  add({ id: "embed", name: "Embedment for a fixed head", demand: Math.max(12, Math.round(fix)), capacity: i.embed, unit: "in", ref: "CDOT BDM 10.5.3, AASHTO 10.7.1.2" });
  add({ id: "embed-cap", name: "Concrete over the pile heads (at least 12 in)", demand: 12, capacity: i.capT - i.embed, unit: "in", ref: "AASHTO 10.7.1.2, 5.12.8.6.3" });

  // --- pile loads, each case ------------------------------------------------------------------------------------
  const smallGroup = n <= 3;
  const phiGeo = i.phiDyn * (smallGroup ? 0.8 : 1);
  const rows = (dir: "B" | "L") => (dir === "B" ? i.nB : i.nL);
  const spacingRatio = (dir: "B" | "L") => ((dir === "B" ? i.sB : i.sL) * 12) / width;
  const pmOf = (dir: "B" | "L") => Array.from({ length: rows(dir) }, (_, r) => (rows(dir) === 1 ? (spacingRatio(dir) <= 5 ? pMultiplier(1, spacingRatio(dir)) : 1) : pMultiplier(r + 1, spacingRatio(dir))));
  const layers = toLayers(i.soil);
  const allLayers: Layer[] = [...(i.unsupported > 0 ? [{ thickness: i.unsupported, model: { kind: "none" as const } }] : []), ...layers];
  const EIof = (dir: "B" | "L") => 29000 * (i.weakAlong === dir ? s.Iy : s.Ix);
  const lateral = (dir: "B" | "L", H: number, Q: number) => {
    if (Math.abs(H) < 1e-9) return null;
    const pms = pmOf(dir);
    const avg = pms.reduce((t, v) => t + v, 0) / pms.length;
    const per = Math.abs(H) / n;
    const base = { length: i.length, D: width, EI: EIof(dir), Q, layers: allLayers };
    const group = analyzeLateral({ ...base, pm: avg, head: { kind: "fixed", H: per } });
    const byRow = pms.map((pm) => analyzeLateral({ ...base, pm, head: { kind: "displaced", y: group.y0 } }));
    const lead = byRow.reduce((a, b) => (b.Mmax > a.Mmax ? b : a));
    return { dir, pms, avg, per, group, byRow, lead };
  };
  const cases = i.cases.map((lc) => {
    const fMax = lc.limit === "strength" ? { dc: 1.25, ev: 1.35 } : { dc: 1, ev: 1 };
    const fMin = lc.limit === "strength" ? { dc: 0.9, ev: 1.0 } : { dc: 1, ev: 1 };
    const MBb = lc.MB + lc.HB * tCap;
    const MLb = lc.ML + lc.HL * tCap;
    const pileLoad = (V: number) => piles.map((p) => V / n + (Sx2 > 0 ? (MBb * p.x) / Sx2 : 0) + (Sy2 > 0 ? (MLb * p.y) / Sy2 : 0));
    const Vmax = lc.P + fMax.dc * Wcap + fMax.ev * Wsoil;
    const Vmin = lc.P + fMin.dc * Wcap + fMin.ev * Wsoil;
    const loadsMax = pileLoad(Vmax);
    const loadsMin = pileLoad(Vmin);
    const Pmax = Math.max(...loadsMax);
    const Pmin = Math.min(...loadsMin);
    const latB = lateral("B", lc.HB, Pmax);
    const latL = lateral("L", lc.HL, Pmax);
    return { lc, MBb, MLb, Vmax, Vmin, loadsMax, Pmax, Pmin, latB, latL };
  });

  const factored = cases.filter((c) => c.lc.limit !== "service");
  const service = cases.filter((c) => c.lc.limit === "service");
  const pick = <T,>(arr: T[], f: (t: T) => number) => arr.reduce((a, b) => (f(b) > f(a) ? b : a), arr[0]);

  if (factored.length) {
    const g = pick(factored, (c) => c.Pmax);
    add({ id: "geo-axial", name: `Geotechnical axial resistance, the most loaded pile (${g.lc.name})`, demand: g.Pmax, capacity: phiGeo * i.Rn, unit: "kip", ref: smallGroup ? "AASHTO 10.5.5.2.3, CDOT BDM 10.5.2.2" : "AASHTO 10.5.5.2.3" });
    const u = factored.reduce((a, b) => (b.Pmin < a.Pmin ? b : a));
    if (u.Pmin < 0) add({ id: "uplift", name: `Uplift, the least loaded pile (${u.lc.name})`, demand: -u.Pmin, capacity: (u.lc.limit === "extreme" ? Math.min(0.8, 1) : i.phiUp) * i.Rup, unit: "kip", ref: u.lc.limit === "extreme" ? "CDOT BDM 10.3.3" : "AASHTO 10.7.3.10" });
    // Structural, axial only (the pile's tip region, damaged by driving).
    const ax = axialResistance(s, i.Fy, 0);
    const phiAx = i.driving === "good" ? PHI_PILE.axialGood : PHI_PILE.axialSevere;
    add({ id: "struct-axial", name: `Structural axial, the most loaded pile (${g.lc.name})`, demand: g.Pmax, capacity: phiAx * ax.Pn, unit: "kip", ref: "AASHTO 6.15.3.1, 6.5.4.2" });
  }
  // Axial with flexure for each factored case with lateral load.
  const flexX = flexuralResistance(s, i.Fy, "x");
  const flexY = flexuralResistance(s, i.Fy, "y");
  const combined = factored.map((c) => {
    const MuBdir = c.latB?.lead.Mmax ?? 0; // kip·ft from loads along B
    const MuLdir = c.latL?.lead.Mmax ?? 0;
    // Which axis each direction bends.
    const Mweak = i.weakAlong === "B" ? MuBdir : MuLdir;
    const Mstrong = i.weakAlong === "B" ? MuLdir : MuBdir;
    const zFix = Math.max(c.latB?.group.zZero ?? 0, c.latL?.group.zZero ?? 0);
    const KL = i.unsupported > 0 ? (i.unsupported + zFix) * 12 : 0;
    const ax = axialResistance(s, i.Fy, KL);
    const Pr = PHI_PILE.combinedAxial * ax.Pn;
    const Mrx = PHI_PILE.flexure * flexX.Mn;
    const Mry = PHI_PILE.flexure * flexY.Mn;
    const inter = interaction(c.Pmax, Pr, Mstrong * 12, Mrx, Mweak * 12, Mry, flexX.compact && flexY.compact);
    return { c, Mweak, Mstrong, KL, Pr, Mrx, Mry, inter, zFix };
  });
  if (combined.length) {
    const g = pick(combined, (x) => x.inter.value);
    add({ id: "interaction", name: `Axial with flexure, the lead row's pile (${g.c.lc.name})`, demand: g.inter.value, capacity: 1, unit: "", ref: `AASHTO 6.15.3.2, Eq. ${g.inter.eq}` });
  }
  if (service.length) {
    const sv = pick(service, (c) => Math.max(c.latB?.group.y0 ?? 0, c.latL?.group.y0 ?? 0));
    const y = Math.max(sv.latB?.group.y0 ?? 0, sv.latL?.group.y0 ?? 0);
    add({ id: "deflection", name: `Lateral deflection of the group (${sv.lc.name})`, demand: y, capacity: i.tolerable, unit: "in", ref: "AASHTO 10.7.2.4" });
  }

  // --- the cap ---------------------------------------------------------------------------------------------------
  const cB = i.colShape === "round" ? Math.sqrt(colArea) : i.colB / 12;
  const cL = i.colShape === "round" ? Math.sqrt(colArea) : i.colL / 12;
  const dbB = BARS[i.barsB.bar].dia;
  const dbL = BARS[i.barsL.bar].dia;
  const bottom = i.cover; // in, the bottom mat between the piles
  const dB = i.capT - bottom - dbB / 2;
  const dL = i.capT - bottom - dbB - dbL / 2;
  const dvOf = (d: number) => Math.max(0.9 * d, 0.72 * i.capT);
  const ec = 120000 * i.gammaC ** 2 * i.fc ** 0.33;
  const beta1 = Math.min(0.85, Math.max(0.65, 0.85 - (i.fc - 4) * 0.05));
  const common = { fc: i.fc, fy: i.fy, Es: 29000, phiF: 0.9, exposure: i.exposure, n: 29000 / ec, beta1 };
  // A pile's share across a section at distance a from the column's center along an axis (5.12.8.6.1).
  const share = (pos: number, section: number) => {
    const half = pileD / 24;
    const out = pos - section; // ft, positive outside
    return out >= half ? 1 : out <= -half ? 0 : (out + half) / (2 * half);
  };
  const capCases = factored.map((c) => {
    // Pile reactions from the column alone (the cap and the soil on it bear on the piles directly).
    const R = piles.map((p) => c.lc.P / n + (Sx2 > 0 ? (c.MBb * p.x) / Sx2 : 0) + (Sy2 > 0 ? (c.MLb * p.y) / Sy2 : 0));
    const moment = (axis: "x" | "y", side: 1 | -1, face: number) =>
      piles.reduce((t, p, k) => {
        const pos = side * (axis === "x" ? p.x : p.y);
        return t + (pos > face ? R[k] * (pos - face) : 0);
      }, 0);
    const MuB = Math.max(moment("x", 1, cB / 2), moment("x", -1, cB / 2));
    const MuL = Math.max(moment("y", 1, cL / 2), moment("y", -1, cL / 2));
    const shear = (axis: "x" | "y", side: 1 | -1, at: number) => piles.reduce((t, p, k) => t + R[k] * share(side * (axis === "x" ? p.x : p.y), at), 0);
    const VuB = Math.max(shear("x", 1, cB / 2 + dvOf(dB) / 12), shear("x", -1, cB / 2 + dvOf(dB) / 12));
    const VuL = Math.max(shear("y", 1, cL / 2 + dvOf(dL) / 12), shear("y", -1, cL / 2 + dvOf(dL) / 12));
    const dv = dvOf((dB + dL) / 2);
    const hx = cB / 2 + dv / 24;
    const hy = cL / 2 + dv / 24;
    const Vpunch = piles.reduce((t, p, k) => t + R[k] * Math.max(share(Math.abs(p.x), hx), share(Math.abs(p.y), hy)), 0);
    const Rmax = Math.max(...R);
    return { c, R, MuB, MuL, VuB, VuL, Vpunch, Rmax };
  });
  let flexB: ReturnType<typeof flexure> | null = null;
  let flexL: ReturnType<typeof flexure> | null = null;
  if (capCases.length) {
    const gB = pick(capCases, (x) => x.MuB);
    const gL = pick(capCases, (x) => x.MuL);
    const servR = service.map((c) => piles.map((p) => c.lc.P / n + (Sx2 > 0 ? (c.MBb * p.x) / Sx2 : 0) + (Sy2 > 0 ? (c.MLb * p.y) / Sy2 : 0)));
    const servM = (axis: "x" | "y", face: number) => Math.max(0, ...servR.map((R) => Math.max(...([1, -1] as const).map((side) => piles.reduce((t, p, k) => {
      const pos = side * (axis === "x" ? p.x : p.y);
      return t + (pos > face ? R[k] * (pos - face) : 0);
    }, 0)))));
    flexB = flexure({ ...common, Mu: gB.MuB / capL, Ms: servM("x", cB / 2) / capL, h: i.capT, cover: bottom, bars: i.barsB });
    flexL = flexure({ ...common, Mu: gL.MuL / capB, Ms: servM("y", cL / 2) / capB, h: i.capT, cover: bottom + dbB, bars: i.barsL });
    add({ id: "cap-flex-B", name: `Cap, bars along B: flexure at the column's face (${gB.c.lc.name})`, demand: gB.MuB / capL, capacity: flexB.MR, unit: "kip·ft/ft", ref: "AASHTO 5.12.8.4, 5.6.3.2" });
    add({ id: "cap-flex-L", name: `Cap, bars along L: flexure at the column's face (${gL.c.lc.name})`, demand: gL.MuL / capB, capacity: flexL.MR, unit: "kip·ft/ft", ref: "AASHTO 5.12.8.4, 5.6.3.2" });
    add({ id: "cap-min-B", name: "Cap, bars along B: minimum reinforcement", demand: flexB.minRequired, capacity: flexB.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
    add({ id: "cap-min-L", name: "Cap, bars along L: minimum reinforcement", demand: flexL.minRequired, capacity: flexL.MR, unit: "kip·ft/ft", ref: "AASHTO 5.6.3.3" });
    if (service.length) {
      add({ id: "cap-crack-B", name: "Cap, bars along B: crack control (spacing)", demand: i.barsB.spacing, capacity: flexB.sMax, unit: "in", ref: "AASHTO 5.6.7" });
      add({ id: "cap-crack-L", name: "Cap, bars along L: crack control (spacing)", demand: i.barsL.spacing, capacity: flexL.sMax, unit: "in", ref: "AASHTO 5.6.7" });
    }
    const vc = (b: number, dv: number) => 0.9 * 0.0316 * 2 * Math.sqrt(i.fc) * b * dv;
    const sB = pick(capCases, (x) => x.VuB);
    const sL = pick(capCases, (x) => x.VuL);
    add({ id: "cap-shear-B", name: `Cap: one-way shear at dv from the face, along B (${sB.c.lc.name})`, demand: sB.VuB, capacity: vc(capL * 12, dvOf(dB)), unit: "kip", ref: "AASHTO 5.12.8.6.1, 5.7.3.3" });
    add({ id: "cap-shear-L", name: `Cap: one-way shear at dv from the face, along L (${sL.c.lc.name})`, demand: sL.VuL, capacity: vc(capB * 12, dvOf(dL)), unit: "kip", ref: "AASHTO 5.12.8.6.1, 5.7.3.3" });
    const dv = dvOf((dB + dL) / 2);
    const bo = i.colShape === "round" ? Math.PI * (i.colB + dv) : 2 * (i.colB + dv) + 2 * (i.colL + dv);
    const betaC = i.colShape === "round" ? 1 : Math.max(i.colB, i.colL) / Math.min(i.colB, i.colL);
    const Vn = Math.min(0.063 + 0.126 / betaC, 0.126) * Math.sqrt(i.fc) * bo * dv;
    const sp = pick(capCases, (x) => x.Vpunch);
    add({ id: "cap-punch-col", name: `Cap: two-way shear at the column (${sp.c.lc.name})`, demand: sp.Vpunch, capacity: 0.9 * Vn, unit: "kip", ref: "AASHTO 5.12.8.6.3" });
    // A corner pile punching up through the concrete over its head: its perimeter at dv/2, cut by the two edges.
    const dvp = Math.max(0.9 * (i.capT - i.embed - 3), 6);
    const corner = (i.edge * 12 + pileD / 2 + dvp / 2) * 2;
    const Vnc = 0.126 * Math.sqrt(i.fc) * Math.min(corner, 4 * (pileD + dvp)) * dvp;
    const rp = pick(capCases, (x) => x.Rmax);
    add({ id: "cap-punch-pile", name: `Cap: two-way shear at a corner pile (${rp.c.lc.name})`, demand: rp.Rmax, capacity: 0.9 * Vnc, unit: "kip", ref: "AASHTO 5.12.8.6.3" });
  }
  return { checks, section: s, piles, capB, capL, n, Wcap, Wsoil, cases, combined, capCases, flexB, flexL, dB, dL, phiGeo, smallGroup, fix, width, flexX, flexY };
}

export type PileResult = ReturnType<typeof designPiles>;
