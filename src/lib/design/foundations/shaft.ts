import { agencyChecks, type Criteria } from "../agency-checks";
import { columnSection } from "../piers/column-section";
import { BARS, DesignError, type Check } from "../walls/cip";
import { analyzeLateral } from "./lateral";
import { toLayers, type SoilLayer } from "./piles";

// A drilled shaft (bridge foundation), AASHTO LRFD (10th Edition) with FHWA GEC 10 (FHWA-NHI-18-024),
// GEC 9 for the lateral analysis, and CDOT BDM 10.6.
//
// - Axial (10.8.3.5): side resistance by layer, clay by the α method (10.8.3.5.1b, the top 5 ft not
//   counted), sand by the β method of Chen and Kulhawy (10.8.3.5.2b, φ' and σ'p from N60), rock by
//   Kulhawy et al. (10.8.3.5.4b), or qs and qp entered from the geotechnical report (CDOT's claystone
//   method, BDM 10.6.2.1, φ 0.60); tip resistance in the layer at the tip (10.8.3.5.1c, 10.8.3.5.2c,
//   10.8.3.5.4c); resistance factors from Table 10.5.5.2.4-1. Uplift: the side resistance with the
//   uplift factors, plus the shaft's weight.
// - Lateral: p–y (lateral.ts) with a free head carrying the column's shear and moment, the shaft's
//   stiffness taken as a fraction of Ec·Ig (cracked, GEC 10 13.4); deflection at the Service limit.
// - Structural: P–M at the largest moment by strain compatibility (5.6.4.5, the pier column's round
//   section), shear (5.7.3.3 with the spiral or hoops, bv = D, dv = 0.9·de, de = D/2 + Dr/π, 5.7.2.8),
//   the longitudinal bars' limits (5.6.4.2), CDOT's least diameter (BDM 10.6.1.1).
// Kip, foot and inch.

export type ShaftCase = { name: string; limit: "strength" | "service" | "extreme"; P: number; M: number; H: number; uplift: number };

export type ShaftLayer = SoilLayer & {
  axial: "alpha" | "beta" | "rock" | "entered" | "none";
  N60: number;
  quKsf: number; // rock's uniaxial compressive strength, ksf
  qs: number; // ksf, entered
  qp: number; // ksf, entered
  phiQs: number; // entered methods' factors
  phiQp: number;
};

export type ShaftInputs = {
  /** AASHTO LRFD, or with the CDOT Bridge Design Manual's rules too (none given: AASHTO). */
  criteria?: Criteria;
  D: number; // in
  length: number; // ft, top of shaft to tip
  topDepth: number; // ft, ground to the top of the shaft
  cover: number; // in, clear to the spiral
  bar: number;
  bars: number;
  tieBar: number;
  transverse: "spiral" | "ties";
  pitch: number; // in
  fc: number;
  fy: number;
  gammaC: number;
  EIfactor: number; // effective stiffness / Ec·Ig
  tolerable: number; // in
  layers: ShaftLayer[]; // from the ground surface down
  cases: ShaftCase[];
};

const layer = (o: Partial<ShaftLayer> & Pick<ShaftLayer, "name" | "thickness" | "kind" | "axial">): ShaftLayer => ({ gamma: 120, phi: 32, k: 90, su: 1000, e50: 0.007, qu: 300, Em: 30000, rqd: 50, N60: 20, quKsf: 40, qs: 0, qp: 0, phiQs: 0.6, phiQp: 0.6, ...o });

/** A 42 in shaft 38 ft long through sand into claystone, under a column. */
export const SHAFT_DEFAULTS: ShaftInputs = {
  D: 42,
  length: 38,
  topDepth: 2,
  cover: 3,
  bar: 9,
  bars: 16,
  tieBar: 5,
  transverse: "spiral",
  pitch: 6,
  fc: 4.5,
  fy: 60,
  gammaC: 0.15,
  EIfactor: 0.5,
  tolerable: 1,
  layers: [
    layer({ name: "Sandy fill", thickness: 8, kind: "sand", axial: "beta", gamma: 120, phi: 32, k: 90, N60: 15 }),
    layer({ name: "Silty sand", thickness: 10, kind: "sand", axial: "beta", gamma: 60, phi: 34, k: 60, N60: 25 }),
    layer({ name: "Claystone", thickness: 30, kind: "weak-rock", axial: "entered", gamma: 65, qu: 300, Em: 30000, rqd: 50, qs: 4, qp: 40, phiQs: 0.6, phiQp: 0.6 }),
  ],
  cases: [
    { name: "Strength I", limit: "strength", P: 800, M: 450, H: 35, uplift: 0 },
    { name: "Strength III", limit: "strength", P: 600, M: 700, H: 55, uplift: 0 },
    { name: "Service I", limit: "service", P: 560, M: 300, H: 22, uplift: 0 },
  ],
};

const PA = 2.12; // ksf

/** Side and tip resistance of a shaft through the layers (ksf, kip). */
export function shaftAxial(i: ShaftInputs) {
  const D = i.D / 12;
  const perim = Math.PI * D;
  const top = i.topDepth;
  const tip = top + i.length;
  let z = 0;
  let sv = 0; // ksf at the layer's top
  const rows: { name: string; method: string; from: number; to: number; qs: number; Rs: number; phi: number; phiUp: number }[] = [];
  let tipLayer: ShaftLayer | null = null;
  let svTip = 0;
  for (const l of i.layers) {
    const a = z;
    const b = z + l.thickness;
    const g = l.gamma / 1000;
    const from = Math.max(a, top);
    const to = Math.min(b, tip);
    if (tip > a && tip <= b + 1e-9) {
      tipLayer = l;
      svTip = sv + g * (tip - a);
    }
    if (to > from && l.axial !== "none") {
      // The α method leaves the top 5 ft of the shaft out.
      const from2 = l.axial === "alpha" ? Math.max(from, top + 5) : from;
      if (to > from2) {
        const svMid = sv + g * ((from2 + to) / 2 - a);
        let qs = 0;
        let phi = 0;
        let phiUp = 0;
        if (l.axial === "alpha") {
          const su = l.su / 1000;
          const r = su / PA;
          const alpha = r <= 1.5 ? 0.55 : 0.55 - 0.1 * (r - 1.5);
          qs = alpha * su;
          phi = 0.45;
          phiUp = 0.35;
        } else if (l.axial === "beta") {
          const N60 = Math.max(1, l.N60);
          const N160 = N60 * Math.min(2, Math.sqrt(PA / Math.max(svMid, 0.05))); // overburden correction, CN = (pa/σ'v)^½ ≤ 2
          const phiS = 27.5 + 9.2 * Math.log10(N160); // Eq. 10.8.3.5.2b-3
          const sp = 0.47 * N60 ** 0.6 * PA; // Eq. 10.8.3.5.2b-4, m = 0.6
          const s = Math.sin((phiS * Math.PI) / 180);
          const beta = (1 - s) * (sp / Math.max(svMid, 1e-3)) ** s * Math.tan((phiS * Math.PI) / 180);
          qs = beta * svMid;
          phi = 0.55;
          phiUp = 0.45;
        } else if (l.axial === "rock") {
          const qu = Math.min(l.quKsf, i.fc * 144);
          qs = PA * Math.sqrt(qu / PA); // Eq. 10.8.3.5.4b-1, C = 1
          phi = 0.55;
          phiUp = 0.4;
        } else {
          qs = l.qs;
          phi = l.phiQs;
          phiUp = l.phiQs;
        }
        rows.push({ name: l.name, method: l.axial, from: from2, to, qs, Rs: qs * perim * (to - from2), phi, phiUp });
      }
    }
    sv += g * l.thickness;
    z = b;
  }
  if (!tipLayer) throw new DesignError("The layers end above the shaft's tip: extend the soil profile.");
  const Ap = (Math.PI * D * D) / 4;
  let qp = 0;
  let phiP = 0;
  const tl = tipLayer as ShaftLayer;
  if (tl.axial === "alpha") {
    const Nc = Math.min(9, 6 * (1 + (0.2 * i.length) / D));
    qp = Math.min(80, Nc * (tl.su / 1000));
    phiP = 0.4;
  } else if (tl.axial === "beta") {
    qp = Math.min(60, 1.2 * Math.min(50, tl.N60));
    phiP = 0.5;
  } else if (tl.axial === "rock") {
    qp = 2.5 * tl.quKsf;
    phiP = 0.5;
  } else if (tl.axial === "entered") {
    qp = tl.qp;
    phiP = tl.phiQp;
  }
  const Rs = rows.reduce((t, r) => t + r.Rs, 0);
  const RRs = rows.reduce((t, r) => t + r.phi * r.Rs, 0);
  const RRup = rows.reduce((t, r) => t + r.phiUp * r.Rs, 0);
  const Rp = qp * Ap;
  return { rows, Rs, RRs, RRup, qp, Rp, phiP, RR: RRs + phiP * Rp, Ap, perim, tipLayer: tl, svTip };
}

export function designShaft(i: ShaftInputs) {
  if (!(i.D > 0 && i.length > 0)) throw new DesignError("The shaft needs a diameter and a length.");
  if (!i.cases.length) throw new DesignError("Enter at least one load case.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });
  add({ id: "diameter", name: "Diameter at least 24 in (bridges)", demand: 24, capacity: i.D, unit: "in", ref: "CDOT BDM 10.6.1.1", ok: i.D >= 24 });
  add({ id: "ld", name: "Length to diameter, typically under 25", demand: (i.length * 12) / i.D, capacity: 25, unit: "", ref: "CDOT BDM 10.6.1.1", advisory: true });

  const ax = shaftAxial(i);
  const D = i.D / 12;
  const Wshaft = ((Math.PI * D * D) / 4) * i.length * i.gammaC;
  const factored = i.cases.filter((c) => c.limit !== "service");
  const service = i.cases.filter((c) => c.limit === "service");
  const pick = <T,>(arr: T[], f: (t: T) => number) => arr.reduce((a, b) => (f(b) > f(a) ? b : a), arr[0]);
  if (factored.length) {
    const g = pick(factored, (c) => c.P);
    const f = g.limit === "strength" ? 1.25 : 1;
    const Pu = g.P + f * Wshaft;
    const RR = g.limit === "extreme" ? ax.Rs + ax.Rp : ax.RR;
    add({ id: "axial", name: `Axial compression: side and tip (${g.name})`, demand: Pu, capacity: RR, unit: "kip", ref: "AASHTO 10.8.3.5" });
    const u = pick(factored, (c) => c.uplift);
    if (u.uplift > 0) {
      const RRup = (u.limit === "extreme" ? Math.min(0.8, 1) * ax.Rs : ax.RRup) + 0.9 * Wshaft;
      add({ id: "uplift", name: `Uplift: side resistance and the shaft's weight (${u.name})`, demand: u.uplift, capacity: RRup, unit: "kip", ref: u.limit === "extreme" ? "AASHTO 10.8.3.7, CDOT BDM 10.3.3" : "AASHTO 10.8.3.7" });
    }
  }

  // --- lateral and structural ------------------------------------------------------------------------------------
  const Ec = 120000 * i.gammaC ** 2 * i.fc ** 0.33;
  const Ig = (Math.PI * i.D ** 4) / 64;
  const EI = i.EIfactor * Ec * Ig;
  // The layers from the shaft's top: cut off what's above it.
  const below: typeof i.layers = [];
  {
    let z = 0;
    for (const l of i.layers) {
      const a = z;
      const b = z + l.thickness;
      const from = Math.max(a, i.topDepth);
      if (b > from) below.push({ ...l, thickness: b - from });
      z = b;
    }
  }
  const lat = (c: ShaftCase) => analyzeLateral({ length: i.length, D: i.D, EI, Q: c.P, head: { kind: "free", H: c.H, M: c.M }, layers: toLayers(below) });
  const sec = columnSection({ shape: "round", T: i.D, W: i.D, cover: i.cover, bar: i.bar, bars: i.bars, barsT: 0, barsL: 0, barsEnd: 0, tieBar: i.tieBar, transverse: i.transverse, fc: i.fc, fy: i.fy });
  const db = BARS[i.bar].dia;
  const Dr = i.D - 2 * (i.cover + BARS[i.tieBar].dia) - db;
  const de = i.D / 2 + Dr / Math.PI;
  const dv = 0.9 * de;
  const Av = 2 * BARS[i.tieBar].area;
  const structural = factored.map((c) => {
    const r = lat(c);
    const Pu = c.P + (c.limit === "strength" ? 1.25 : 1) * Wshaft * Math.min(1, r.zMmax / i.length);
    const res = sec.resistance(Pu, r.Mmax * 12, 0);
    const Vc = 0.0316 * 2 * Math.sqrt(i.fc) * i.D * dv;
    const Vs = (Av * i.fy * dv) / i.pitch; // θ = 45°
    const Vn = Math.min(Vc + Vs, 0.25 * i.fc * i.D * dv);
    return { c, r, Pu, phiMn: res ? res.phiMn / 12 : 0, Vu: r.Vmax, phiVn: 0.9 * Vn, Vc, Vs };
  });
  if (structural.length) {
    const g = pick(structural, (s) => s.r.Mmax / Math.max(s.phiMn, 1e-9));
    add({ id: "pm", name: `Axial with flexure at the largest moment, ${g.r.zMmax.toFixed(1)} ft down (${g.c.name})`, demand: g.r.Mmax, capacity: g.phiMn, unit: "kip·ft", ref: "AASHTO 5.6.4.5, 10.8.3.9" });
    const v = pick(structural, (s) => s.Vu / s.phiVn);
    add({ id: "shear", name: `Shear (${v.c.name})`, demand: v.Vu, capacity: v.phiVn, unit: "kip", ref: "AASHTO 5.7.3.3, 5.7.2.8" });
    const Pmax = pick(structural, (s) => s.Pu);
    add({ id: "axial-struct", name: `Axial resistance of the section (${Pmax.c.name})`, demand: Pmax.Pu, capacity: sec.PrMax(i.transverse === "spiral" ? 0.75 : 0.75), unit: "kip", ref: "AASHTO 5.6.4.4" });
  }
  const serv = service.map((c) => ({ c, r: lat(c) }));
  if (serv.length) {
    const s = pick(serv, (x) => Math.abs(x.r.y0));
    add({ id: "deflection", name: `Deflection at the top (${s.c.name})`, demand: Math.abs(s.r.y0), capacity: i.tolerable, unit: "in", ref: "AASHTO 10.8.2.4, 10.7.2.4" });
  }
  const Ast = i.bars * BARS[i.bar].area;
  const rho = Ast / ((Math.PI * i.D ** 2) / 4);
  const Pmin = factored.length ? Math.max(...factored.map((c) => c.P)) : 0;
  add({ id: "bars-min", name: "Longitudinal bars: As·fy / (Ag·f'c) ≥ 0.135", demand: 0.135, capacity: (Ast * i.fy) / (((Math.PI * i.D ** 2) / 4) * i.fc), unit: "", ref: "AASHTO 5.6.4.2" });
  add({ id: "bars-max", name: "Longitudinal bars at most 8 % of the section", demand: rho, capacity: 0.08, unit: "", ref: "AASHTO 5.6.4.2" });
  const clear = (Math.PI * Dr) / i.bars - db;
  add({ id: "clear", name: "Clear spacing of the longitudinal bars, at least 5 in for the concrete to flow (GEC 10)", demand: 5, capacity: clear, unit: "in", ref: "AASHTO 10.8.3.9.3, FHWA GEC 10", advisory: true });
  return { checks: agencyChecks(checks, i.criteria), ax, Wshaft, EI, Ec, sec, structural, serv, de, dv, Dr, Pmin };
}

export type ShaftResult = ReturnType<typeof designShaft>;
