import { bar } from "../stm/aashto";
import { multiplePresence } from "../stm/cap-loads";
import { DesignError, type Check } from "../walls/cip";
import { columnSection, concreteE, ES, type ColumnShape } from "./column-section";
import { solveFrame, type FrameLoad, type FrameMember, type FrameNode } from "./frame2d";

// A pier column, AASHTO LRFD 10th Edition: its forces at the base and under the cap from a pier
// cap's load cases (the bent analyzed as a plane frame: the cap a beam on its columns, fixed at
// their bases or on drilled shafts to their point of fixity), with the loads along the bridge from
// the girder designs (braking BR 3.6.4, wind on the superstructure WS 3.8.1.2.3a and on the live
// load WL 3.8.1.3, wind on the column 3.8.1.2.3b, uniform temperature TU 3.12.2) shared by the
// bridge's fixed supports; slenderness by moment magnification (5.6.4.3, 4.5.3.2.2b); axial load
// with biaxial bending by strain compatibility (5.6.4.5); shear (5.7.3.3); the bar limits
// (5.6.4.2), ties (5.10.4.3) and spirals (5.6.4.6, 5.10.4.2); and, as an option, vehicle collision
// in Extreme Event II (3.6.5.1). Feet and kips for the structure, inches for the section.

/** A pier cap's load cases and geometry, copied from its strut-and-tie design (refreshed on demand). */
export type ColumnLink = {
  stmId: string;
  stmName: string;
  kind: "hammerhead" | "multicolumn" | "inverted-t";
  columns: number[]; // ft, column centerlines from the cap's left end
  columnWidth?: number; // ft, in the cap's plane, as the cap was modeled
  capLength: number; // ft
  capDepth: number; // ft, at the columns
  capWidth: number; // in
  fcCap: number; // ksi
  cases: { name: string; loads: { x: number; fx: number; fy: number }[] }[]; // factored, at the cap (fy down negative)
  wind: boolean; // the cases include wind across the bridge (Strength III, V)
  bridge: BridgeData | null;
  refreshed: string;
};

/** What the column's loads along the bridge need from the girder designs. */
export type BridgeData = {
  names: string;
  length: number; // ft, the girder line(s) whose longitudinal forces the bridge's fixed supports share
  maxSpan: number; // ft
  lanes: number; // design lanes (3.6.1.1.1)
  braking: number; // kip, the bridge's braking force, all lanes loaded, multiple presence applied (3.6.4)
  brakingBasis: string;
  depth: number; // ft, the superstructure's depth the wind sees
  lineIII: number | null; // klf, transverse wind on the superstructure, Strength III
  lineV: number; // klf, Strength V
  V: number; // mph, the site's wind speed (Strength III)
  Kz: number; // Strength III
  Z: number; // ft
};

export type ColumnCase = { name: string; P: number; MT: number; ML: number; HT: number; HL: number };

export type ColumnInputs = {
  shape: ColumnShape;
  T: number; // in, across the bridge (a round column's diameter)
  W: number; // in, along the bridge
  cover: number;
  bar: number;
  bars: number;
  barsT: number;
  barsL: number;
  barsEnd: number;
  transverse: "spiral" | "ties";
  tieBar: number;
  tieSpacing: number; // in (a spiral's pitch)
  legsT: number; // tie legs resisting shear across the bridge
  legsL: number; // along the bridge
  fc: number;
  fy: number;
  height: number; // ft, top of the footing or shaft to the cap's soffit
  capDepth: number; // ft, the cap the bars run into, where no strut-and-tie design is linked
  ground: number; // ft, the ground above the column's base
  base: "footing" | "shaft";
  shaftD: number; // in
  fixity: number; // ft, below the top of the shaft to its point of fixity
  K: { T: number; L: number }; // effective length factors (4.6.2.5), unbraced
  wc: number; // kcf
  loads: "stm" | "entered";
  link: ColumnLink | null;
  cases: ColumnCase[]; // entered: factored, at the column's top
  longitudinal: {
    bearings: "fixed" | "expansion";
    share: number; // the share (0–1) of the bridge's longitudinal forces this pier takes (fixed bearings)
    bearingForce: number; // kip, unfactored: the longitudinal force the expansion bearings pass to the pier
    dT: number; // °F, the uniform temperature change from the setting temperature (3.12.2)
    distance: number; // ft, the pier from the point of no movement
    gammaTU: number; // 0.50 for force effects (Table 3.4.1-1)
  };
  collision: { enabled: boolean; CT: number; impact: number; traffic: "T" | "L"; PDC: number }; // impact: kept from saved designs (both 2 and 5 ft are checked)
  /** Seismic Zone 1 with SD1 ≥ 0.10 (5.11.2): the potential plastic hinge regions' transverse reinforcement at this spacing. */
  seismic: { hinge: boolean; spacing: number };
};

export const COLUMN_DEFAULTS: ColumnInputs = {
  shape: "round",
  T: 48,
  W: 48,
  cover: 2,
  bar: 10,
  bars: 20,
  barsT: 6,
  barsL: 4,
  barsEnd: 3,
  transverse: "spiral",
  tieBar: 4,
  tieSpacing: 4,
  legsT: 2,
  legsL: 2,
  fc: 4.5,
  fy: 60,
  height: 20,
  capDepth: 6,
  ground: 2,
  base: "footing",
  shaftD: 54,
  fixity: 10,
  K: { T: 2.1, L: 2.1 },
  wc: 0.15,
  loads: "entered",
  link: null,
  cases: [{ name: "Strength I", P: 1800, MT: 1200, ML: 300, HT: 20, HL: 25 }],
  longitudinal: { bearings: "fixed", share: 1, bearingForce: 0, dT: 40, distance: 0, gammaTU: 0.5 },
  collision: { enabled: false, CT: 600, impact: 5, traffic: "T", PDC: 0 },
  seismic: { hinge: false, spacing: 4 },
};

export function columnInputs(saved: unknown): ColumnInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<ColumnInputs>;
  const d = COLUMN_DEFAULTS;
  const shape: ColumnShape = s.shape === "rectangular" || s.shape === "oblong" ? s.shape : "round";
  return {
    ...d,
    ...s,
    shape,
    K: { ...d.K, ...(s.K ?? {}) },
    longitudinal: { ...d.longitudinal, ...(s.longitudinal ?? {}) },
    collision: { ...d.collision, ...(s.collision ?? {}) },
    seismic: { ...d.seismic, ...(s.seismic ?? {}) },
    cases: Array.isArray(s.cases) ? s.cases.map((c) => ({ name: String(c?.name ?? "Case"), P: Number(c?.P) || 0, MT: Number(c?.MT) || 0, ML: Number(c?.ML) || 0, HT: Number(c?.HT) || 0, HL: Number(c?.HL) || 0 })) : d.cases,
    link: s.link && typeof s.link === "object" && Array.isArray(s.link.cases) && Array.isArray(s.link.columns) ? s.link : null,
    loads: s.loads === "stm" && s.link ? "stm" : "entered",
  };
}

/** The limit state of a case by its name, and its load factors for what the column adds. */
function factorsOf(name: string) {
  const n = name.toLowerCase();
  const limit = n.startsWith("service i") ? "Service I" : n.startsWith("strength iii") ? "Strength III" : n.startsWith("strength iv") ? "Strength IV" : n.startsWith("strength v") ? "Strength V" : n.startsWith("strength i") ? "Strength I" : "Strength I";
  const minDead = n.includes("dead loads at minimum");
  return {
    limit,
    dc: limit === "Service I" ? 1.0 : limit === "Strength IV" ? 1.5 : minDead ? 0.9 : 1.25, // the column's own weight (Table 3.4.1-2)
    ll: limit === "Service I" ? 1.0 : limit === "Strength I" ? (n.includes("dead loads only") ? 0 : 1.75) : limit === "Strength V" ? 1.35 : 0, // BR goes with the live load
    ws: (limit === "Strength III" || limit === "Strength V") && n.includes("wind") ? 1.0 : 0,
    wl: limit === "Strength V" && n.includes("wind") ? 1.0 : 0,
    wind: n.includes("toward larger x") ? 1 : n.includes("toward smaller x") ? -1 : 0,
  };
}

const PI2 = Math.PI * Math.PI;

/** A spiral's volumetric ratio against Eq. 5.6.4.6-1's: whether the column counts as spirally reinforced. */
export function spiralRatio(i: Pick<ColumnInputs, "shape" | "T" | "W" | "cover" | "tieBar" | "tieSpacing" | "fc" | "fy">, Ag: number) {
  const W = i.shape === "round" ? i.T : i.W;
  const Dc = (i.shape === "round" ? i.T : W) - 2 * i.cover; // core, to the spiral's outside
  const Ac = i.shape === "round" ? (Math.PI * Dc ** 2) / 4 : (i.T - W) * Dc + (Math.PI * Dc ** 2) / 4;
  const rhoS = (4 * bar(i.tieBar).area) / (Dc * i.tieSpacing);
  const need = 0.45 * (Ag / Ac - 1) * (i.fc / Math.min(i.fy, 100));
  return { Dc, Ac, rhoS, need, ok: rhoS >= need - 1e-12 };
}

export function designColumn(i: ColumnInputs) {
  // A spiral short of Eq. 5.6.4.6-1's ratio is a continuously wound tie: the column is designed as tied (Eq. 5.6.4.4-3).
  const W0 = i.shape === "round" ? i.T : i.W;
  const sp = i.transverse === "spiral" ? spiralRatio(i, i.shape === "round" ? (Math.PI * i.T ** 2) / 4 : i.shape === "rectangular" ? i.T * W0 : (i.T - W0) * W0 + (Math.PI * W0 ** 2) / 4) : null;
  const spiral = !!sp?.ok;
  const sec = columnSection({ shape: i.shape, T: i.T, W: i.W, cover: i.cover, bar: i.bar, bars: i.bars, barsT: i.barsT, barsL: i.barsL, barsEnd: i.barsEnd, tieBar: i.tieBar, transverse: spiral ? "spiral" : "ties", fc: i.fc, fy: i.fy });
  const W = W0;
  if (!(i.height > 0)) throw new DesignError("Give the column's height, the top of its footing or shaft to the cap's soffit.");
  if (i.ground < 0 || i.ground >= i.height) throw new DesignError("The ground must be above the column's base and below the cap.");
  const Ec = concreteE(i.fc);
  const AgFt = sec.Ag / 144;
  const checks: Check[] = [];
  const notes: string[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity + 1e-9 });

  const link = i.loads === "stm" ? i.link : null;
  const n = link ? link.columns.length : 1;
  const h = i.height;
  const capDepth = link?.capDepth ?? 0;
  const yb = h + capDepth; // the bearings, on top of the cap
  const exposed = h - i.ground;
  const zw = i.ground + exposed / 2; // the wind's resultant on the column

  // --- along the bridge: the forces at the bearings this pier takes (3.6.4, 3.8.1.2.3a, 3.8.1.3, 3.12.2) --------------
  const br = link?.bridge ?? null;
  const lg = i.longitudinal;
  const share = Math.max(0, Math.min(1, lg.share));
  const simplified = !!br && br.maxSpan <= 150 && br.Z <= 33; // the usual girder bridge: longitudinal 25% of transverse
  const coefLong = simplified ? 0.25 : 0.38; // else the girders' largest longitudinal skew coefficient (Table 3.8.1.2.3a-1), with the full transverse
  const EIcolL = 0.4 * Ec * sec.IgL; // kip·in², Eq. 5.6.4.3-2 with βd = 0: the cracked column's stiffness
  const hb = (yb + (i.base === "shaft" ? i.fixity : 0)) * 12; // in, cantilever to the bearings
  const kCol = (3 * EIcolL) / hb ** 3; // kip/in, each column
  const tuMove = 6e-6 * lg.dT * lg.distance * 12; // in, α = 6×10⁻⁶ /°F (5.4.2.2)
  const fixed = lg.bearings === "fixed";
  const long = {
    BR: fixed && br ? (br.braking * share) / n : 0, // per column
    WS3: fixed && br && br.lineIII !== null ? (coefLong * br.lineIII * br.length * share) / n : 0,
    WS5: fixed && br ? (coefLong * br.lineV * br.length * share) / n : 0,
    WL: fixed && br ? (0.04 * br.length * share) / n : 0,
    TU: fixed ? kCol * tuMove : lg.bearingForce / n,
    coefLong,
    simplified,
    kCol,
    tuMove,
  };
  // Wind on the column itself (3.8.1.2.3b): PZ = 2.56×10⁻⁶ V² Kz G CD, CD = 1.6 (Table 3.8.1.2.1-2), G = 1.0.
  const pz = { III: br && br.V > 0 ? 2.56e-6 * br.V ** 2 * br.Kz * 1.6 : 0, V: 2.56e-6 * 80 ** 2 * 1.6 };
  const faceT = (W / 12) * exposed; // ft², the face the wind across the bridge sees (the column's width along it)
  const faceL = (i.T / 12) * exposed;

  // --- the bent as a plane frame (the cap's plane) ---------------------------------------------------------------------
  type At = { P: number; V: number; M: number };
  type ColumnForces = { base: At; top: At; at?: (z: number) => At };
  const coll = i.collision;
  // The impact 2.0 to 5.0 ft above the ground, whichever is critical (3.6.5.1): both ends of the range, above the column's base.
  const impacts = [2, 5].map((e) => i.ground + e).filter((z) => z > 0 && z < h);
  let frame: null | ((loads: { name: string; loads: { x: number; fx: number; fy: number }[] }, extra: (col: number) => FrameLoad[]) => ColumnForces[]) = null;
  let nodeAt: ((col: number, z: number) => number) | null = null;
  if (link) {
    const nodes: FrameNode[] = [];
    const members: FrameMember[] = [];
    const Ecap = concreteE(link.fcCap) * 144; // ksf
    const Ecol = Ec * 144;
    const yCap = h + capDepth / 2;
    const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
    const xs = [...new Set([0, link.capLength, ...link.columns, ...link.cases.flatMap((c) => c.loads.map((l) => l.x))].map(r4))].sort((p, q) => p - q);
    const capNode = new Map<number, number>();
    for (const x of xs) {
      capNode.set(x, nodes.length);
      nodes.push({ x, y: yCap });
    }
    const Icap = ((link.capWidth / 12) * capDepth ** 3) / 12;
    for (let k = 0; k + 1 < xs.length; k++) members.push({ a: capNode.get(xs[k])!, b: capNode.get(xs[k + 1])!, EA: Ecap * (link.capWidth / 12) * capDepth, EI: Ecap * Icap });
    const colNodes: Map<number, number>[] = [];
    const EIcol = Ecol * (sec.IgT / 20736);
    const EAcol = Ecol * AgFt;
    link.columns.forEach((xc, c) => {
      const zs = [0, h];
      if (exposed > 0 && zw > 0 && zw < h) zs.push(zw);
      if (coll.enabled) zs.push(...impacts);
      const sorted = [...new Set(zs)].sort((p, q) => p - q);
      const map = new Map<number, number>();
      let prev = -1;
      if (i.base === "shaft") {
        const fix = nodes.length;
        nodes.push({ x: xc, y: -i.fixity, fixed: true });
        prev = fix;
      }
      for (const z of sorted) {
        const k = nodes.length;
        nodes.push({ x: xc, y: z, fixed: z === 0 && i.base === "footing" });
        map.set(z, k);
        if (prev >= 0) {
          const shaft = nodes[prev].y < 0;
          const Is = (Math.PI * (i.shaftD / 12) ** 4) / 64;
          members.push({ a: prev, b: k, EA: shaft ? Ecol * ((Math.PI * (i.shaftD / 12) ** 2) / 4) : EAcol, EI: shaft ? Ecol * Is : EIcol });
        }
        prev = k;
      }
      // The column into the cap: the joint taken as rigid.
      members.push({ a: prev, b: capNode.get(r4(xc))!, EA: EAcol * 10, EI: EIcol * 10 });
      colNodes[c] = map;
    });
    // Each column's members, bottom to top, with the elevations of their ends.
    const memberOf = (c: number, z: number, which: "below" | "above") => {
      const map = colNodes[c];
      const node = map.get(z)!;
      const k = members.findIndex((m) => (which === "below" ? m.b === node : m.a === node) && nodes[m.a].x === nodes[m.b].x);
      return { k, node };
    };
    nodeAt = (c, z) => colNodes[c].get(z)!;
    frame = (lc, extra) => {
      const loads: FrameLoad[] = lc.loads.map((l) => ({ node: capNode.get(r4(l.x))!, fx: l.fx, fy: l.fy }));
      for (let c = 0; c < n; c++) loads.push(...extra(c));
      const [sol] = solveFrame(nodes, members, [loads]);
      const at = (c: number, z: number): At => {
        // Internal forces just above z (the base) or just below it (the top), from the member's end forces.
        if (z === 0) {
          const { k } = memberOf(c, 0, "above");
          const e = sol.ends[k];
          return { P: e[0], V: e[1], M: -e[2] };
        }
        const { k } = memberOf(c, z, "below");
        const e = sol.ends[k];
        return { P: -e[3], V: -e[4], M: e[5] };
      };
      return Array.from({ length: n }, (_, c) => ({ base: at(c, 0), top: at(c, h), at: (z: number) => at(c, z) }));
    };
  }

  // --- each case: forces at the base and under the cap, each column ------------------------------------------------------
  type Row = { case: string; limit: string; column: number; where: "base" | "top" | "impact"; P: number; MT: number; ML: number; VT: number; VL: number; perm: number };
  const rows: Row[] = [];
  const selfWeight = (z: number, g: number) => g * i.wc * AgFt * (h - z);
  let deadOnly: ColumnForces[] | null = null; // Strength IV (1.5 DC + 1.5 DW), for the permanent loads
  if (link) {
    if (!link.cases.length) throw new DesignError("The strut-and-tie design has no load cases.");
    const siv = link.cases.find((c) => factorsOf(c.name).limit === "Strength IV");
    deadOnly = siv ? frame!(siv, () => []) : null;
    for (const lc of link.cases) {
      const f = factorsOf(lc.name);
      const p = f.limit === "Strength III" ? pz.III : f.limit === "Strength V" ? pz.V : 0;
      const windT = f.wind * p * faceT; // kip on each column, across the bridge
      const out = frame!(lc, (c) => (windT && exposed > 0 ? [{ node: nodeAt!(c, zw), fx: windT }] : []));
      const FL = f.ll * long.BR + f.ws * (f.limit === "Strength III" ? long.WS3 : long.WS5) + f.wl * long.WL + lg.gammaTU * long.TU;
      const windL = f.ws ? long.coefLong * p * faceL : 0;
      out.forEach((o, c) => {
        for (const where of ["base", "top"] as const) {
          const z = where === "base" ? 0 : h;
          const t = o[where];
          const perm = deadOnly ? Math.abs(deadOnly[c][where].M) * (f.dc / 1.5) : 0;
          // Round-off from the frame (a balanced cap's moment) shown as the zero it is.
          const snap = (v: number) => (Math.abs(v) < 1e-6 * (1 + Math.abs(t.P)) ? 0 : v);
          rows.push({ case: lc.name, limit: f.limit, column: c, where, P: t.P + selfWeight(z, f.dc), MT: snap(t.M), ML: FL * (yb - z) + (z < zw ? windL * (zw - z) : 0), VT: snap(t.V), VL: FL + (z < zw ? windL : 0), perm: snap(perm) });
        }
      });
    }
  } else {
    if (!i.cases.length) throw new DesignError("Add a load case.");
    for (const c of i.cases)
      for (const where of ["base", "top"] as const) {
        const z = where === "base" ? 0 : h;
        rows.push({ case: c.name, limit: factorsOf(c.name).limit, column: 0, where, P: c.P + selfWeight(z, 1.25), MT: c.MT + c.HT * (h - z), ML: c.ML + c.HL * (h - z), VT: c.HT, VL: c.HL, perm: 0 });
      }
    notes.push("The entered forces are factored and at the column's top; the column's own weight is added at 1.25 (Table 3.4.1-2).");
  }

  // --- slenderness (5.6.4.3) and moment magnification (4.5.3.2.2b) -------------------------------------------------------
  const lu = h * 12; // the column's clear height (a shaft's depth to fixity is in K)
  const r = {
    T: i.shape === "round" ? 0.25 * i.T : i.shape === "rectangular" ? 0.3 * i.T : Math.sqrt(sec.IgT / sec.Ag),
    L: i.shape === "round" ? 0.25 * i.T : i.shape === "rectangular" ? 0.3 * W : Math.sqrt(sec.IgL / sec.Ag),
  };
  const slender = (["T", "L"] as const).map((ax) => {
    const K = i.K[ax];
    const ratio = (K * lu) / r[ax];
    const Ig = ax === "T" ? sec.IgT : sec.IgL;
    const Is = ax === "T" ? sec.IsT : sec.IsL;
    return { ax, K, lu, r: r[ax], ratio, neglect: ratio < 22, Ig, Is, EI: (bd: number) => Math.max((Ec * Ig) / 5 + ES * Is, (Ec * Ig) / 2.5) / (1 + bd) };
  });
  for (const s of slender) add({ id: `slender-${s.ax}`, name: `Slenderness ${s.ax === "T" ? "across" : "along"} the bridge, Kℓu/r below 100 (the approximate method)`, demand: s.ratio, capacity: 100, unit: "", ref: "AASHTO 5.6.4.3" });

  // Each case's magnifiers: δs = 1 / (1 − ΣPu / (φK ΣPe)), φK = 0.75, the bent's columns together.
  const caseNames = [...new Set(rows.map((x) => x.case))];
  const delta = new Map<string, { T: number; L: number; bdT: number }>();
  for (const name of caseNames) {
    const base = rows.filter((x) => x.case === name && x.where === "base");
    const sumP = base.reduce((p, x) => p + Math.max(0, x.P), 0);
    const bdT = Math.min(1, Math.max(...base.map((x) => (Math.abs(x.MT) > 1e-6 ? x.perm / Math.abs(x.MT) : 0))));
    const d = (s: (typeof slender)[number], bd: number) => {
      if (s.neglect) return 1;
      const Pe = (PI2 * s.EI(bd)) / (s.K * s.lu) ** 2;
      const den = 1 - sumP / (0.75 * n * Pe);
      return den > 0 ? 1 / den : Infinity;
    };
    delta.set(name, { T: d(slender[0], bdT), L: d(slender[1], 0), bdT });
  }

  // --- axial load with biaxial bending (5.6.4.5, by strain compatibility) -------------------------------------------------
  const PrMax = sec.PrMax(0.75);
  type Res = Row & { dT: number; dL: number; MuT: number; MuL: number; Mu: number; phiMn: number; phi: number; ratio: number };
  const results: Res[] = rows.map((x) => {
    const d = delta.get(x.case)!;
    const MuT = Math.abs(x.MT) * d.T;
    const MuL = Math.abs(x.ML) * d.L;
    const Mu = Math.hypot(MuT, MuL);
    const res = Number.isFinite(d.T) && Number.isFinite(d.L) ? sec.resistance(x.P, MuT * 12, MuL * 12) : null;
    const phiMn = res ? res.phiMn / 12 : 0;
    const ratio = !res ? Infinity : phiMn > 1e-9 ? Mu / phiMn : x.P / PrMax;
    return { ...x, dT: d.T, dL: d.L, MuT, MuL, Mu, phiMn, phi: res?.phi ?? 0.75, ratio };
  });
  for (const limit of ["Strength I", "Strength III", "Strength IV", "Strength V"])
    for (const where of ["base", "top"] as const) {
      const set = results.filter((x) => x.limit === limit && x.where === where);
      if (!set.length) continue;
      const g = set.reduce((p, x) => (x.ratio > p.ratio ? x : p));
      add({ id: `pm-${limit}-${where}`, name: `${limit}, ${where === "base" ? "at the base" : "under the cap"}: axial load and biaxial bending${n > 1 ? `, column ${g.column + 1}` : ""} (Pu = ${g.P.toFixed(0)} kip)`, demand: g.Mu, capacity: g.phiMn, unit: "kip·ft", ref: "AASHTO 5.6.4.5", note: g.case });
    }
  const Pmax = Math.max(...results.map((x) => x.P));
  add({ id: "axial", name: `Axial load within the axial resistance φ k P0 (${spiral ? "spirally reinforced, k = 0.85" : "tied, k = 0.80"})`, demand: Pmax, capacity: PrMax, unit: "kip", ref: `AASHTO Eq. 5.6.4.4-${spiral ? 2 : 3}` });

  // --- shear (5.7.3.3, simplified: β = 2, θ = 45°) -------------------------------------------------------------------------
  const tie = bar(i.tieBar);
  const co = i.cover + tie.db + sec.db / 2;
  const shearDir = (ax: "T" | "L") => {
    const hdim = ax === "T" ? i.T : W; // the depth in the shear's direction
    let bv: number;
    let de: number;
    if (i.shape === "round") {
      const Dr = i.T - 2 * co;
      bv = i.T;
      de = i.T / 2 + Dr / Math.PI; // Eq. C5.7.2.8-2
    } else {
      bv = ax === "T" ? W : i.shape === "oblong" ? i.T - (1 - Math.PI / 4) * W : i.T;
      de = hdim - co;
    }
    const dv = Math.max(0.9 * de, 0.72 * hdim);
    const legs = i.shape === "round" || i.transverse === "spiral" ? 2 : ax === "T" ? i.legsT : i.legsL;
    const Av = legs * tie.area;
    const Vc = 0.0316 * 2 * Math.sqrt(i.fc) * bv * dv; // Eq. 5.7.3.3-3
    const Vs = (Av * i.fy * dv) / i.tieSpacing; // Eq. 5.7.3.3-4
    const Vn = Math.min(Vc + Vs, 0.25 * i.fc * bv * dv);
    const AvMin = (0.0316 * Math.sqrt(i.fc) * bv * i.tieSpacing) / i.fy; // Eq. 5.7.2.5-1
    return { ax, bv, de, dv, Av, Vc, Vs, Vn, AvMin, legs };
  };
  const shear = { T: shearDir("T"), L: shearDir("L") };
  for (const ax of ["T", "L"] as const) {
    const s = shear[ax];
    const Vu = Math.max(...results.map((x) => Math.abs(ax === "T" ? x.VT : x.VL)));
    const vu = Vu / (0.9 * s.bv * s.dv);
    const sMax = vu < 0.125 * i.fc ? Math.min(0.8 * s.dv, 24) : Math.min(0.4 * s.dv, 12); // 5.7.2.6
    add({ id: `shear-${ax}`, name: `Shear ${ax === "T" ? "across" : "along"} the bridge`, demand: Vu, capacity: 0.9 * s.Vn, unit: "kip", ref: "AASHTO 5.7.3.3" });
    add({ id: `shear-min-${ax}`, name: `Minimum transverse reinforcement (${ax === "T" ? "across" : "along"})`, demand: s.AvMin, capacity: s.Av, unit: "in²", ref: "AASHTO 5.7.2.5" });
    add({ id: `shear-s-${ax}`, name: `Transverse reinforcement spacing (${ax === "T" ? "across" : "along"})`, demand: i.tieSpacing, capacity: sMax, unit: "in", ref: "AASHTO 5.7.2.6" });
  }

  // --- reinforcement limits (5.6.4.2) and transverse reinforcement (5.10.4.2, 5.10.4.3, 5.6.4.6) ------------------------
  const rho = sec.Ast / sec.Ag;
  const permP = link && deadOnly ? Math.max(...deadOnly.map((c) => c.base.P)) / 1.5 + selfWeight(0, 1) : i.collision.PDC;
  const rhoMinBase = (0.135 * i.fc) / i.fy;
  const rhoMin = permP <= 0.4 * sec.Ag * i.fc ? Math.min(rhoMinBase, 0.015) : rhoMinBase;
  add({ id: "rho-max", name: "Longitudinal reinforcement, As/Ag", demand: rho, capacity: 0.08, unit: "", ref: "AASHTO Eq. 5.6.4.2-1" });
  add({ id: "rho-min", name: "Minimum longitudinal reinforcement, As/Ag", demand: rhoMin, capacity: rho, unit: "", ref: `AASHTO Eq. 5.6.4.2-${rhoMin < rhoMinBase ? 4 : 3}` });
  const minBars = i.shape === "round" ? 6 : 4;
  add({ id: "bars-min", name: `At least ${minBars} longitudinal bars`, demand: minBars, capacity: sec.bars.length, unit: "", ref: "AASHTO 5.6.4.2" });
  add({ id: "bar-size", name: "Longitudinal bars at least #5", demand: 5, capacity: i.bar, unit: "", ref: "AASHTO 5.6.4.2" });
  // Clear spacing of the longitudinal bars: 1.5 db, 1.5 in (5.10.3.1.1).
  let minGap = Infinity;
  for (let p = 0; p < sec.bars.length; p++) for (let q = p + 1; q < sec.bars.length; q++) minGap = Math.min(minGap, Math.hypot(sec.bars[p][0] - sec.bars[q][0], sec.bars[p][1] - sec.bars[q][1]) - sec.db);
  add({ id: "bar-gap", name: "Clear spacing of the longitudinal bars", demand: Math.max(1.5 * sec.db, 1.5), capacity: minGap, unit: "in", ref: "AASHTO 5.10.3.1.1" });
  let restrained: { face: string; gap: number }[] = [];
  if (i.transverse === "spiral" && sp) {
    // Short of Eq. 5.6.4.6-1's ratio, the spiral is a continuously wound tie: designed as tied, not a failure.
    add({ id: "spiral-rho", name: sp.ok ? "Spiral ratio ρs: designed as spirally reinforced" : "Spiral ratio ρs below Eq. 5.6.4.6-1's: designed as tied (k = 0.80)", demand: sp.need, capacity: sp.rhoS, unit: "", ref: "AASHTO Eq. 5.6.4.6-1, 5.6.4.4", ok: true, advisory: !sp.ok });
    if (!sp.ok) notes.push(`The spiral's volumetric ratio, ${(sp.rhoS * 100).toFixed(2)}%, is below the ${(sp.need * 100).toFixed(2)}% Eq. 5.6.4.6-1 requires, so it counts as a continuously wound tie: the axial resistance is 0.80 φ P0 (Eq. 5.6.4.4-3), not 0.85. A closer pitch or a larger spiral bar makes the column spirally reinforced.`);
    add({ id: "spiral-size", name: "Spiral bar at least 0.375 in", demand: 0.375, capacity: tie.db, unit: "in", ref: "AASHTO 5.10.4.2" });
    add({ id: "spiral-pitch", name: "Spiral pitch, center to center", demand: i.tieSpacing, capacity: Math.min(6 * sec.db, 6), unit: "in", ref: "AASHTO 5.10.4.2" });
    add({ id: "spiral-clear", name: "Spiral clear spacing at least 1 in", demand: 1, capacity: i.tieSpacing - tie.db, unit: "in", ref: "AASHTO 5.10.4.2" });
    if (i.shape === "rectangular") notes.push("A spiral in a rectangular column: the ties' rules aren't checked.");
  } else {
    const minTie = i.bar >= 11 ? 4 : 3;
    add({ id: "tie-size", name: `Tie bar at least #${minTie}`, demand: minTie, capacity: i.tieBar, unit: "", ref: "AASHTO 5.10.4.3" });
    add({ id: "tie-spacing", name: "Tie spacing, the least dimension or 12 in", demand: i.tieSpacing, capacity: Math.min(i.T, W, 12), unit: "in", ref: "AASHTO 5.10.4.3" });
    if (i.shape !== "round") {
      // Laterally restrained bars (a tie's corner or a cross-tie's hook) no more than 24 in apart along the perimeter tie.
      restrained = restrainedGaps(i, sec.bars);
      const worst = restrained.reduce((p, x) => (x.gap > p.gap ? x : p), { face: "", gap: 0 });
      add({ id: "tie-restrained", name: `Restrained bars along the tie, ${worst.face}`, demand: worst.gap, capacity: 24, unit: "in", ref: "AASHTO 5.10.4.3", note: "Add tie legs (cross-ties) in that direction" });
    }
  }

  // --- Seismic Zone 1 with SD1 ≥ 0.10: confinement of the potential plastic hinge regions (5.11.2, 5.11.4.1.3–5) ------------
  const sz = i.seismic;
  let hinge: null | { length: number; spacing: number; sMax: number; need: { label: string; demand: number; capacity: number; ref: string }[] } = null;
  if (sz.hinge) {
    const maxDim = Math.max(i.T, W);
    const length = Math.max(maxDim, (h * 12) / 6, 18); // in, from each end (5.11.4.1.3)
    const sMax = Math.min(Math.min(i.T, W) / 4, 4); // 5.11.4.1.5
    const fyh = Math.min(i.fy, 75);
    const need: { label: string; demand: number; capacity: number; ref: string }[] = [];
    if (i.transverse === "spiral" || i.shape === "round") {
      const dc = (i.shape === "round" ? i.T : W) - 2 * i.cover;
      const rhoS = (4 * tie.area) / (dc * sz.spacing);
      need.push({ label: "Volumetric ratio ρs in the hinge regions", demand: (0.12 * i.fc) / fyh, capacity: rhoS, ref: "AASHTO Eq. 5.11.4.1.4-1" });
    } else {
      const Ac = (i.T - 2 * i.cover) * (W - 2 * i.cover);
      for (const [legs, hc, dir] of [[i.legsT, W - 2 * i.cover, "across"], [i.legsL, i.T - 2 * i.cover, "along"]] as const) {
        const Ash = legs * tie.area;
        const req = Math.max(0.3 * sz.spacing * hc * (i.fc / fyh) * (sec.Ag / Ac - 1), 0.12 * sz.spacing * hc * (i.fc / fyh));
        need.push({ label: `Tie and cross-tie area Ash, legs ${dir} the bridge`, demand: req, capacity: Ash, ref: "AASHTO Eqs. 5.11.4.1.4-2, -3" });
      }
    }
    hinge = { length, spacing: sz.spacing, sMax, need };
    add({ id: "seis-spacing", name: "Hinge regions and lap splices: spacing, a quarter of the least dimension or 4 in", demand: sz.spacing, capacity: sMax, unit: "in", ref: "AASHTO 5.11.4.1.5, 5.11.2" });
    for (const [k, x] of need.entries()) add({ id: `seis-conf-${k}`, name: x.label, demand: x.demand, capacity: x.capacity, unit: x.label.startsWith("Volumetric") ? "" : "in²", ref: x.ref });
    notes.push(`Seismic Zone 1 with SD1 ≥ 0.10 (AASHTO 5.11.2): #${i.tieBar} ${i.transverse === "spiral" ? "spiral" : "ties"} at ${sz.spacing} in over ${Math.ceil(length)} in from the column's top and bottom (the larger of its largest dimension, a sixth of its clear height and 18 in, 5.11.4.1.3) and over the lap splices at its base; ${i.transverse === "spiral" ? "spiral splices there full-welded or mechanical" : "seismic hooks (135°, 6 db or 3 in) and cross-ties as 5.11.4.1.4 details them"}. The connection force of 3.10.9.2 is the Seismic Zone 1 tool's.`);
  }

  // --- vehicle collision, Extreme Event II (3.6.5.1) -------------------------------------------------------------------
  let collision: null | { heights: number[]; rows: (Res & { angle: number; impact: number })[]; Vt: number; Vl: number; exempt: boolean } = null;
  if (coll.enabled) {
    if (!impacts.length) throw new DesignError("The collision must strike the column: 2 to 5 ft above the ground is off the column.");
    // 3.6.5.1 item 2: a reinforced concrete component at least 3.0 ft thick with more than 30 ft² of section (the column's full height here) needs no design for the collision.
    const exempt = Math.min(i.T, W) >= 36 && sec.Ag > 30 * 144;
    const crows: (Res & { angle: number; impact: number })[] = [];
    let Vt = 0;
    let Vl = 0;
    for (const a of impacts)
      for (const angle of [0, 15]) {
        const along = coll.CT * Math.cos((angle * Math.PI) / 180);
        const across = coll.CT * Math.sin((angle * Math.PI) / 180);
        const FT = coll.traffic === "T" ? along : across;
        const FL = coll.traffic === "T" ? across : along;
        for (let hit = 0; hit < n; hit++) {
          // Across the bridge: the bent (or a single column as the cantilever it is); along it: each column a cantilever.
          const ct: ColumnForces[] =
            frame && FT
              ? frame({ name: "CT", loads: [] }, (c) => (c === hit ? [{ node: nodeAt!(c, a), fx: FT }] : []))
              : Array.from({ length: n }, (_, c) => ({ base: { P: 0, V: c === hit ? FT : 0, M: c === hit ? FT * a : 0 }, top: { P: 0, V: 0, M: 0 }, at: (z: number) => ({ P: 0, V: c === hit && z <= a ? FT : 0, M: c === hit ? FT * Math.max(0, a - z) : 0 }) }));
          for (const g of [1.25, 0.9]) {
            for (const where of ["base", "impact", "top"] as const) {
              const z = where === "base" ? 0 : where === "impact" ? a : h;
              // The permanent loads (Strength IV's, unfactored): no load along the column, so its moment is linear.
              const d0 = deadOnly ? { P: deadOnly[hit].base.P, M: deadOnly[hit].base.M + (deadOnly[hit].top.M - deadOnly[hit].base.M) * (z / h) } : null;
              const P = (d0 ? (d0.P / 1.5) * g : coll.PDC * g) + selfWeight(z, g);
              // At the impact: the forces just below it, where the shear is the largest (the column's base to the impact).
              const t = where === "impact" ? (ct[hit].at?.(a) ?? { P: 0, V: 0, M: 0 }) : ct[hit][where];
              const MT = (d0 ? Math.abs(d0.M / 1.5) * g : 0) + Math.abs(t.M); // the vehicle from either side
              const ML = FL * Math.max(0, a - z);
              const res = sec.resistance(P, MT * 12, ML * 12, 1.0);
              const phiMn = res ? res.phiMn / 12 : 0;
              const Mu = Math.hypot(MT, ML);
              crows.push({ case: `Extreme Event II, ${angle}° at ${a - i.ground} ft (DC × ${g})`, limit: "Extreme Event II", column: hit, where, P, MT, ML, VT: Math.abs(t.V), VL: z <= a ? FL : 0, perm: 0, dT: 1, dL: 1, MuT: MT, MuL: ML, Mu, phiMn, phi: 1, ratio: res ? (phiMn > 0 ? Mu / phiMn : 0) : Infinity, angle, impact: a - i.ground });
              if (where !== "top") {
                Vt = Math.max(Vt, Math.abs(t.V));
                Vl = Math.max(Vl, FL);
              }
            }
          }
        }
      }
    const g = crows.reduce((p, x) => (x.ratio > p.ratio ? x : p));
    const adv = exempt ? { advisory: true } : {};
    if (exempt) add({ id: "ct-exempt", name: "At least 3.0 ft thick with more than 30 ft² of section: no collision design required", demand: 30, capacity: sec.Ag / 144, unit: "ft²", ref: "AASHTO 3.6.5.1", ok: true });
    add({ id: "ct-pm", name: `Extreme Event II: axial load and biaxial bending under the ${coll.CT} kip collision${n > 1 ? `, column ${g.column + 1} struck` : ""} (Pu = ${g.P.toFixed(0)} kip)`, demand: g.Mu, capacity: g.phiMn, unit: "kip·ft", ref: "AASHTO 3.6.5.1, 5.6.4.5", note: g.case, ...adv });
    add({ id: "ct-shear-T", name: "Extreme Event II: shear across the bridge, below the impact", demand: Vt, capacity: shear.T.Vn, unit: "kip", ref: "AASHTO 3.6.5.1, 5.7.3.3", ...adv });
    add({ id: "ct-shear-L", name: "Extreme Event II: shear along the bridge, below the impact", demand: Vl, capacity: shear.L.Vn, unit: "kip", ref: "AASHTO 3.6.5.1, 5.7.3.3", ...adv });
    collision = { heights: impacts.map((z) => z - i.ground), rows: crows, Vt, Vl, exempt };
    notes.push(`Collision: ${coll.CT} kip at 2.0 and 5.0 ft above the ground (whichever is critical, AASHTO 3.6.5.1), 0° and 15° from the roadway below (${coll.traffic === "T" ? "across" : "along"} the bridge), with the permanent loads at 1.25 and 0.90 (Table 3.4.1-1); resistance factors 1.0 (1.3.2.1). The shear is the largest between the column's base and the impact.${exempt ? " The column is at least 3.0 ft thick with more than 30 ft² of section, so AASHTO 3.6.5.1 deems it adequate without designing for the collision: the checks are shown for information." : ""}`);
  }

  if (link && !link.wind) notes.push("The cap's load cases carry no wind: turn on wind across the bridge in the strut-and-tie design's girder loads for Strength III and V.");
  if (link && !br) notes.push("No girder design is linked to the cap: braking and wind along the bridge are left out.");
  if (fixed && br) notes.push(`Along the bridge: the pier's fixed bearings take ${(share * 100).toFixed(0)}% of the bridge's braking force (${br.brakingBasis}) and wind (${long.simplified ? "25% of the transverse, 3.8.1.2.3a, for the usual girder bridge" : `the girders' largest longitudinal skew coefficient, ${long.coefLong}, with the full transverse wind (Table 3.8.1.2.3a-1)`}), at the bearings; the overturning above them goes into the superstructure.`);
  if (!fixed) notes.push(`Expansion bearings: the pier takes only the ${lg.bearingForce} kip the bearings pass along the bridge (factored by γTU = ${lg.gammaTU}).`);

  return {
    ok: checks.every((c) => c.ok),
    checks,
    notes,
    spiral,
    spiralRatio: sp,
    restrained,
    hinge,
    section: sec,
    Ec,
    n,
    rows: results,
    delta: [...delta.entries()].map(([name, d]) => ({ name, ...d })),
    slender: slender.map(({ EI, ...s }) => ({ ...s, EI0: EI(0) })),
    long,
    pz,
    shear,
    rho,
    rhoMin,
    PrMax,
    collision,
    curves: { T: sec.curve("T"), L: sec.curve("L") },
  };
}

export type ColumnResult = ReturnType<typeof designColumn>;

/**
 * Where the cross-ties go, and the largest distance along the perimeter tie between restrained bars
 * on each face (5.10.4.3): the tie's corners restrain the corner bars; each face's other legs (the
 * legs beyond the perimeter tie's two, as cross-ties) are spread evenly over its bars. Legs running
 * along the bridge restrain the faces across it, and the other way round. An oblong column's
 * round ends are restrained by the curved tie.
 */
export function restrainedIndices(bars: number, legs: number) {
  const k = Math.max(2, Math.min(bars, Math.round(legs)));
  return [...new Set(Array.from({ length: k }, (_, j) => Math.round((j * (bars - 1)) / (k - 1))))];
}

export function restrainedGaps(i: Pick<ColumnInputs, "shape" | "barsT" | "barsL" | "legsT" | "legsL">, bars: [number, number][]) {
  const out: { face: string; gap: number }[] = [];
  const face = (label: string, pts: [number, number][], legs: number) => {
    if (pts.length < 2) return;
    const idx = restrainedIndices(pts.length, legs);
    let gap = 0;
    for (let j = 1; j < idx.length; j++) gap = Math.max(gap, Math.hypot(pts[idx[j]][0] - pts[idx[j - 1]][0], pts[idx[j]][1] - pts[idx[j - 1]][1]));
    out.push({ face: label, gap });
  };
  const sortX = (p: [number, number][]) => [...p].sort((a, b) => a[0] - b[0]);
  const sortY = (p: [number, number][]) => [...p].sort((a, b) => a[1] - b[1]);
  const ys = bars.map((b) => b[1]);
  const xs = bars.map((b) => b[0]);
  const top = Math.max(...ys);
  const right = Math.max(...xs);
  // Faces across the bridge (a constant y): restrained by the legs running along it.
  face("faces across the bridge", sortX(bars.filter((b) => Math.abs(b[1] - top) < 1e-6)), i.legsL);
  if (i.shape === "rectangular") face("faces along the bridge", sortY(bars.filter((b) => Math.abs(b[0] - right) < 1e-6)), i.legsT);
  return out;
}

/** The bridge's braking force (3.6.4): every lane loaded, the multiple presence factor applied, the most of 1 to all lanes. */
export function bridgeBraking(perLane: number, lanes: number) {
  let best = { force: 0, lanes: 1 };
  for (let k = 1; k <= Math.max(1, lanes); k++) {
    const f = k * multiplePresence(k) * perLane;
    if (f > best.force) best = { force: f, lanes: k };
  }
  return best;
}
