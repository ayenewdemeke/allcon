import type { Check } from "../walls/cip";
import { bar } from "./aashto";
import { barsFit } from "./nodal-zones";
import type { StmCase, StmInputs, StmResult } from "./strut-tie";
import { resolveBearings, type StmTemplate } from "./templates";

// Where a standard cap may be designed by the sectional method, and that design. AASHTO LRFD 10th
// Edition: STM should be considered where the distance between the centers of an applied load and
// the supporting reaction is less than twice the member's depth (5.8.2.1); D-Regions extend about
// one depth from loads and reactions, and conventional beam theory applies in the B-Regions
// between them (5.5.1.2.1). Each arm or span is classed by its loads' distance from the column
// face (the shear span, as FHWA-NHI-17-071 measures it): every load 2h or more away, a B-Region
// the sectional method suits; any nearer, a D-Region for the STM. In a B-Region the cap is
// checked as a beam, for every load case: flexure (5.6.3.2, φ by the net tensile strain, 5.5.4.2),
// minimum reinforcement (5.6.3.3), shear by the General Procedure (5.7.3.3, 5.7.3.4.2) at dv from
// the face and beyond (5.7.3.2), minimum transverse reinforcement and its spacing (5.7.2.5,
// 5.7.2.6), longitudinal reinforcement for shear (5.7.3.5), and skin reinforcement (5.6.7).
// Forces: a hammerhead's arms by statics from their tips; a bent as a continuous beam on its
// columns' centerlines (pinned, as the STM's single column nodes). Inches and kips.

export type CapRegion = { label: string; from: number; to: number; face: number[]; side: -1 | 0 | 1; loads: { x: number; a: number }[]; ratio: number | null; kind: "B" | "D" | "none" };
export type SectionForce = { x: number; Mu: number; Vu: number; case: number };
export type SectionResult = {
  region: string;
  x: number; // ft
  label: string;
  h: number;
  negative: boolean; // top in tension
  As: number;
  ds: number;
  c: number;
  a: number;
  phiF: number;
  Mn: number;
  Mr: number;
  Mu: number;
  Mcr: number;
  Vu: number;
  dv: number;
  epsS: number;
  beta: number;
  theta: number;
  Vc: number;
  Vs: number;
  Vn: number;
  Vr: number;
  case: number;
  shear: boolean; // shear is checked here (dv or more from the face)
};
export type SectionalResult = { regions: CapRegion[]; sections: SectionResult[]; checks: Check[]; notes: string[]; allB: boolean };

const PHI_V = 0.9; // 5.5.4.2, shear in normalweight concrete
const ES = 29000;
const AG = 0.75; // in, maximum aggregate (assumed) for sxe where the stirrups are below the minimum

/** The cap's regions (arms, overhangs, spans between columns) and how their loads sit (ft, h at the face). */
export function capRegions(t: StmTemplate): CapRegion[] {
  const cols = [...t.columns].sort((p, q) => p - q);
  const w = t.columnWidth;
  const loads = resolveBearings(t).map((b) => b.x);
  const h = t.depth; // the depth at the columns
  const regions: CapRegion[] = [];
  const named = t.kind === "hammerhead" ? ["Left arm", "Right arm"] : ["Left overhang", "Right overhang"];
  const region = (label: string, from: number, to: number, face: number[], side: -1 | 0 | 1) => {
    const inside = loads.filter((x) => x > from + 1e-9 && x < to - 1e-9);
    const ls = inside.map((x) => ({ x, a: Math.min(...face.map((f) => Math.abs(x - f))) }));
    const ratio = ls.length ? Math.min(...ls.map((l) => l.a / h)) : null;
    regions.push({ label, from, to, face, side, loads: ls, ratio, kind: ratio === null ? "none" : ratio >= 2 ? "B" : "D" });
  };
  if (cols[0] - w / 2 > 0) region(named[0], 0, cols[0] - w / 2, [cols[0] - w / 2], -1);
  for (let k = 0; k + 1 < cols.length; k++) region(`Span ${k + 1}`, cols[k] + w / 2, cols[k + 1] - w / 2, [cols[k] + w / 2, cols[k + 1] - w / 2], 0);
  if (cols[cols.length - 1] + w / 2 < t.length) region(named[1], cols[cols.length - 1] + w / 2, t.length, [cols[cols.length - 1] + w / 2], 1);
  return regions;
}

/** Solve a dense linear system (small). */
function solve(A: number[][], b: number[]) {
  const n = b.length;
  const M = A.map((r, k) => [...r, b[k]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, k) => (Math.abs(r[k]) < 1e-12 ? 0 : r[n] / r[k]));
}

/** Vertical reactions of a beam on pinned supports (ft, kip), by the stiffness method (EI uniform). */
function reactions(L: number, supports: number[], loads: { x: number; P: number }[]) {
  const xs = [...new Set([0, L, ...supports, ...loads.map((l) => l.x)].map((x) => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b);
  const n = xs.length;
  const K = Array.from({ length: 2 * n }, () => new Array(2 * n).fill(0));
  const F = new Array(2 * n).fill(0);
  for (let e = 0; e + 1 < n; e++) {
    const l = xs[e + 1] - xs[e];
    const k = [
      [12 / l ** 3, 6 / l ** 2, -12 / l ** 3, 6 / l ** 2],
      [6 / l ** 2, 4 / l, -6 / l ** 2, 2 / l],
      [-12 / l ** 3, -6 / l ** 2, 12 / l ** 3, -6 / l ** 2],
      [6 / l ** 2, 2 / l, -6 / l ** 2, 4 / l],
    ];
    const d = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3];
    for (let p = 0; p < 4; p++) for (let q = 0; q < 4; q++) K[d[p]][d[q]] += k[p][q];
  }
  const at = (x: number) => xs.findIndex((v) => Math.abs(v - x) < 1e-5);
  for (const l of loads) F[2 * at(l.x)] -= l.P;
  const fixed = supports.map((s) => 2 * at(s));
  const free = Array.from({ length: 2 * n }, (_, k) => k).filter((k) => !fixed.includes(k));
  const u = new Array(2 * n).fill(0);
  const sol = solve(free.map((r) => free.map((c) => K[r][c])), free.map((r) => F[r]));
  free.forEach((k, j) => (u[k] = sol[j]));
  return supports.map((_, j) => {
    const r = fixed[j];
    return K[r].reduce((s, kv, c) => s + kv * u[c], 0) - F[r];
  });
}

/** Moment (kip·ft, sagging positive) and shear (kip) at x for a case's loads, P down (ft). */
function forcesAt(t: StmTemplate, loads: { x: number; P: number }[], x: number, R: number[] | null) {
  const cols = [...t.columns].sort((p, q) => p - q);
  if (cols.length === 1) {
    // A hammerhead (or one column): each arm from its tip.
    const left = x <= cols[0];
    const out = loads.filter((l) => (left ? l.x < x : l.x > x));
    const M = -out.reduce((s, l) => s + l.P * Math.abs(x - l.x), 0);
    const V = out.reduce((s, l) => s + l.P, 0);
    return { M, V };
  }
  const forces = [...loads.map((l) => ({ x: l.x, F: -l.P })), ...cols.map((c, k) => ({ x: c, F: R![k] }))].filter((f) => f.x < x);
  return { M: forces.reduce((s, f) => s + f.F * (x - f.x), 0), V: forces.reduce((s, f) => s + f.F, 0) };
}

const beta1 = (fc: number) => Math.max(0.65, Math.min(0.85, 0.85 - 0.05 * (fc - 4)));

export function sectionalDesign(i: StmInputs, r: StmResult): SectionalResult {
  const t = i.template!;
  const regions = capRegions(t);
  const notes: string[] = [];
  const cols = [...t.columns].sort((p, q) => p - q);
  const H = t.depth * 12;
  const tip = (t.kind === "hammerhead" ? t.tipDepth : t.depth) * 12;
  const faceL = (cols[0] - t.columnWidth / 2) * 12;
  const faceR = (cols[cols.length - 1] + t.columnWidth / 2) * 12;
  const L = t.length * 12;
  const rise = H - tip;
  const soffit = (x: number) => (x < faceL && faceL > 0 ? (rise * (faceL - x)) / faceL : x > faceR && L > faceR ? (rise * (x - faceR)) / (L - faceR) : 0);
  const b = t.capWidth;
  const fc = i.fc;
  const fy = i.fy;
  const sq = Math.sqrt(fc);
  const topA = t.topBars.count * bar(t.topBars.size).area;
  const botA = t.bottomBars.count * bar(t.bottomBars.size).area;
  const botC = barsFit(b, t.sideCover, t.stirrups.size, t.bottomBars.count, t.bottomBars.size).centroid;
  const Av = Math.max(2, Math.round(t.stirrups.legs)) * bar(t.stirrups.size).area;
  const s = t.stirrups.spacing;
  const minAv = (0.0316 * sq * b * s) / fy; // 5.7.2.5
  const hasMin = Av >= minAv - 1e-9;
  if (!hasMin) notes.push(`The stirrups (${Av.toFixed(2)} in² at ${s} in) are below the minimum ${minAv.toFixed(2)} in² (5.7.2.5): β uses Eq. 5.7.3.4.2-2 with a maximum aggregate of ${AG} in (assumed).`);
  // Every case, both directions (a hammerhead's STM model takes one direction; the sectional check takes all).
  const all: StmCase[] = r.capLoads ? r.capLoads.cases : i.cases;
  const xOf = (node: string) => i.nodes.find((n) => n.label === node.trim())?.x ?? NaN;
  const caseLoads = all.map((c) => c.loads.map((l) => ({ x: xOf(l.node), P: -l.fy })).filter((l) => Number.isFinite(l.x) && Math.abs(l.P) > 1e-9));
  const R = cols.length > 1 ? caseLoads.map((ls) => reactions(t.length, cols, ls)) : null;

  const sections: SectionResult[] = [];
  const at = (region: CapRegion, xft: number, label: string, shearHere: boolean) => {
    const x = xft * 12;
    const h = H - soffit(x);
    let worst: SectionResult | null = null;
    caseLoads.forEach((ls, k) => {
      const { M, V } = forcesAt(t, ls, xft, R ? R[k] : null);
      const negative = M < 0;
      const As = negative ? topA : botA;
      const ds = negative ? h - t.topCover : h - botC;
      const b1 = beta1(fc);
      const c = (As * fy) / (0.85 * fc * b1 * b);
      const a = b1 * c;
      const Mn = (As * fy * (ds - a / 2)) / 12; // kip·ft
      const et = (0.003 * (ds - c)) / c;
      const phiF = Math.max(0.75, Math.min(0.9, 0.75 + (0.15 * (et - 0.002)) / (0.005 - 0.002)));
      const Mu = Math.abs(M) * 1;
      const Vu = Math.abs(V);
      const Mcr = (0.67 * 1.6 * 0.24 * sq * (b * h * h) / 6) / 12; // 5.6.3.3, γ1 1.6, γ3 0.67, fr 0.24√f'c
      const dv = Math.max(ds - a / 2, 0.9 * ds, 0.72 * h);
      const MuIn = Math.max(Mu * 12, Vu * dv);
      let epsS = (MuIn / dv + Vu) / (ES * As);
      epsS = Math.max(0, Math.min(0.006, epsS));
      const sxe = Math.max(12, Math.min(80, (dv * 1.38) / (AG + 0.63)));
      const beta = hasMin ? 4.8 / (1 + 750 * epsS) : (4.8 / (1 + 750 * epsS)) * (51 / (39 + sxe));
      const theta = 29 + 3500 * epsS;
      const cot = 1 / Math.tan((theta * Math.PI) / 180);
      const Vc = 0.0316 * beta * sq * b * dv;
      const Vs = (Av * fy * dv * cot) / s;
      const Vn = Math.min(Vc + Vs, 0.25 * fc * b * dv);
      const res: SectionResult = { region: region.label, x: xft, label, h, negative, As, ds, c, a, phiF, Mn, Mr: phiF * Mn, Mu, Mcr, Vu, dv, epsS, beta, theta, Vc, Vs, Vn, Vr: PHI_V * Vn, case: k, shear: shearHere };
      const ratio = (q: SectionResult) => Math.max(q.Mu / q.Mr, q.shear ? q.Vu / q.Vr : 0);
      if (!worst || ratio(res) > ratio(worst)) worst = res;
    });
    if (worst) sections.push(worst);
  };

  for (const g of regions) {
    if (g.kind !== "B") continue;
    // At each face (moment), dv from it (shear, 5.7.3.2), and inboard of each load (the moment there, and the taper).
    for (const f of g.face) {
      const into = f === g.from ? 1 : -1;
      at(g, f, "at the column's face", false);
      const dvFt = (0.9 * (H - t.topCover)) / 12;
      at(g, f + into * dvFt, "dv from the face", true);
    }
    for (const l of g.loads) {
      const toward = g.face.length === 1 ? Math.sign(g.face[0] - l.x) : Math.sign((g.from + g.to) / 2 - l.x);
      at(g, l.x + toward * 0.01, `at the load at ${l.x.toFixed(2)} ft`, Math.min(...g.face.map((f) => Math.abs(l.x - f))) * 12 >= 0.9 * (H - t.topCover));
    }
  }

  const checks: Check[] = [];
  for (const g of regions.filter((x) => x.kind === "B")) {
    const mine = sections.filter((q) => q.region === g.label);
    if (!mine.length) continue;
    const id = g.label.toLowerCase().replace(/\s+/g, "-");
    const flex = mine.reduce((p, q) => (q.Mu / q.Mr > p.Mu / p.Mr ? q : p));
    checks.push({ id: `sec-${id}-flexure`, name: `${g.label}: flexure ${flex.label} (case ${flex.case + 1})`, demand: flex.Mu, capacity: flex.Mr, unit: "kip·ft", ok: flex.Mu <= flex.Mr + 1e-9, ref: "AASHTO 5.6.3.2, 5.5.4.2" });
    const mins = mine.reduce((p, q) => (Math.min(q.Mcr, 1.33 * q.Mu) / q.Mr > Math.min(p.Mcr, 1.33 * p.Mu) / p.Mr ? q : p));
    checks.push({ id: `sec-${id}-min`, name: `${g.label}: minimum reinforcement ${mins.label}`, demand: Math.min(mins.Mcr, 1.33 * mins.Mu), capacity: mins.Mr, unit: "kip·ft", ok: Math.min(mins.Mcr, 1.33 * mins.Mu) <= mins.Mr + 1e-9, ref: "AASHTO 5.6.3.3" });
    const sh = mine.filter((q) => q.shear);
    if (sh.length) {
      const v = sh.reduce((p, q) => (q.Vu / q.Vr > p.Vu / p.Vr ? q : p));
      checks.push({ id: `sec-${id}-shear`, name: `${g.label}: shear ${v.label} (case ${v.case + 1})`, demand: v.Vu, capacity: v.Vr, unit: "kip", ok: v.Vu <= v.Vr + 1e-9, ref: "AASHTO 5.7.3.3, 5.7.3.4.2" });
      const vu = v.Vu / (PHI_V * b * v.dv);
      const smax = vu < 0.125 * fc ? Math.min(0.8 * v.dv, 24) : Math.min(0.4 * v.dv, 12);
      checks.push({ id: `sec-${id}-spacing`, name: `${g.label}: stirrup spacing`, demand: s, capacity: smax, unit: "in", ok: s <= smax + 1e-9, ref: "AASHTO 5.7.2.6" });
      checks.push({ id: `sec-${id}-avmin`, name: `${g.label}: minimum transverse reinforcement`, demand: minAv, capacity: Av, unit: "in²", ok: hasMin, ref: "AASHTO 5.7.2.5" });
      const lon = sh.reduce((p, q) => {
        const need = (z: SectionResult) => (z.Mu * 12) / (z.dv * z.phiF) + Math.max(0, z.Vu / PHI_V - 0.5 * Math.min(z.Vs, z.Vu / PHI_V)) / Math.tan((z.theta * Math.PI) / 180);
        return need(q) / (q.As * fy) > need(p) / (p.As * fy) ? q : p;
      });
      const need = (lon.Mu * 12) / (lon.dv * lon.phiF) + Math.max(0, lon.Vu / PHI_V - 0.5 * Math.min(lon.Vs, lon.Vu / PHI_V)) / Math.tan((lon.theta * Math.PI) / 180);
      checks.push({ id: `sec-${id}-longitudinal`, name: `${g.label}: longitudinal reinforcement for shear ${lon.label}`, demand: need, capacity: lon.As * fy, unit: "kip", ok: need <= lon.As * fy + 1e-9, ref: "AASHTO 5.7.3.5" });
    }
    // Skin reinforcement on each side face where dℓ exceeds 3.0 ft (5.6.7).
    const deep = mine.reduce((p, q) => (q.ds > p.ds ? q : p));
    if (deep.ds > 36) {
      const reqPerFt = 0.012 * (deep.ds - 30);
      const reqFace = Math.min((reqPerFt * deep.ds) / 2 / 12, deep.As / 4);
      const prov = i.grid.provided && i.grid.sh > 0 ? ((i.grid.Ah / 2) * (deep.ds / 2)) / i.grid.sh : 0;
      checks.push({ id: `sec-${id}-skin`, name: `${g.label}: skin reinforcement each face over dℓ/2`, demand: reqFace, capacity: prov, unit: "in²", ok: prov >= reqFace - 1e-9, ref: "AASHTO Eq. 5.6.7-3" });
      if (i.grid.provided) checks.push({ id: `sec-${id}-skin-spacing`, name: `${g.label}: skin reinforcement spacing`, demand: i.grid.sh, capacity: Math.min(deep.ds / 6, 12), unit: "in", ok: i.grid.sh <= Math.min(deep.ds / 6, 12) + 1e-9, ref: "AASHTO 5.6.7" });
    }
  }
  const withLoads = regions.filter((g) => g.kind !== "none");
  const allB = withLoads.length > 0 && withLoads.every((g) => g.kind === "B");
  if (!r.capLoads) notes.push("The loads are the bearing loads as entered: the cap's own weight is in them only if it was entered.");
  notes.push("Crack control by the distribution of reinforcement (Eq. 5.6.7-1) needs the Service I moments: not checked here.");
  return { regions, sections, checks, notes, allB };
}
