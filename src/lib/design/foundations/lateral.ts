import { DesignError } from "../walls/cip";

// A laterally loaded pile or drilled shaft by the p–y method (FHWA GEC 9, FHWA-HIF-18-031, Ch. 6;
// AASHTO 10.7.2.4 and 10.7.3.12): the beam equation EI·y'''' + Q·y'' + p(y) = 0 by finite differences
// (Reese and Van Impe), the soil as nonlinear springs (p–y curves) iterated by secant stiffness to
// convergence, the group's p-multiplier on every spring (AASHTO Table 10.7.2.4-1), the axial load Q
// for P–Δ. Head: free (shear H, moment M), fixed against rotation (shear H), or an imposed
// displacement with no rotation (an integral abutment's movement). Tip: free (no moment, no shear).
//
// Units inside: kip and inch. Depth z from the pile's head, positive down; y positive in the
// direction of the head's shear H. The p–y curves (GEC 9 Appendix A unless noted):
// - sand: API (2000) / O'Neill and Murchison (1983), GEC 9 6.5: pu = min((C1·z + C2·D)·γ'·z,
//   C3·D·γ'·z), p = A·pu·tanh(k·z·y / (A·pu)), A = max(0.9, 3 − 0.8·z/D) for static loading, C1–C3
//   from φ (the API chart's fits);
// - soft clay with free water: Matlock (1970), Eqs. A-1 to A-4, static;
// - stiff clay with no free water: Welch and Reese (1972), Eqs. A-1, A-2 (J = 0.5), A-3, A-19;
// - weak rock: Reese (1997), Eqs. A-33 to A-42;
// - linear: p = k·y with a constant subgrade modulus k (kip/in per in of pile), for checks and
//   closed-form comparisons.

export type PyModel =
  | { kind: "sand"; phi: number; gamma: number; k: number } // deg; effective unit weight pcf; initial modulus pci
  | { kind: "soft-clay"; su: number; gamma: number; e50: number; J?: number } // su psf; gamma pcf (effective)
  | { kind: "stiff-clay"; su: number; gamma: number; e50: number } // no free water
  | { kind: "weak-rock"; qu: number; Em: number; rqd: number; krm: number } // qu psi; Em psi; RQD %
  | { kind: "linear"; k: number } // kip/in per in (the modulus of subgrade reaction times nothing: p = k·y per inch of pile)
  | { kind: "none" }; // air, water or a void: no lateral support

export type Layer = { thickness: number; model: PyModel; name?: string }; // ft

/** C1, C2, C3 for API sand from φ (fits to API RP 2A's Figure 6.8.6-1). */
export function apiSandCoefficients(phi: number) {
  return { C1: 0.115 * 10 ** (0.0405 * phi), C2: 0.571 * 10 ** (0.022 * phi), C3: 0.646 * 10 ** (0.0555 * phi) };
}

type Spring = { p: (y: number) => number; k0: number }; // p in kip/in for y in in; k0 the initial stiffness (kip/in²)

/**
 * The p–y curve at depth z (in) below the top of the soil (the top of the first layer that supports),
 * zl below the top of its own layer (weak rock's depth into rock), for a pile of width D (in),
 * σ'v the effective overburden there (psi) and the average effective unit weight above it (pci).
 */
export function pyCurve(m: PyModel, z: number, zl: number, D: number, gAvg: number, suAvg: number): Spring {
  const zz = Math.max(z, 1e-6);
  switch (m.kind) {
    case "sand": {
      const g = m.gamma / 1728 / 1000; // kip/in³
      const { C1, C2, C3 } = apiSandCoefficients(m.phi);
      const pu = Math.max(1e-9, Math.min((C1 * zz + C2 * D) * g * zz, C3 * D * g * zz)); // kip/in
      const A = Math.max(0.9, 3 - (0.8 * zz) / D);
      const k = (m.k / 1000) * zz; // kip/in² (k in pci → kip/in³ × z)
      return { p: (y) => A * pu * Math.tanh((k * Math.abs(y)) / (A * pu)) * Math.sign(y), k0: k };
    }
    case "soft-clay":
    case "stiff-clay": {
      const c = m.su / 144 / 1000; // ksi
      const J = m.kind === "soft-clay" ? (m.J ?? 0.5) : 0.5;
      const ca = Math.max(1e-9, (m.kind === "stiff-clay" ? suAvg : m.su) / 144 / 1000);
      const pu = Math.max(1e-9, Math.min((3 + (gAvg * zz) / ca + (J * zz) / D) * ca * D, 9 * c * D));
      const y50 = (m.kind === "soft-clay" ? 2.5 : 2.5) * m.e50 * D;
      const n = m.kind === "soft-clay" ? 1 / 3 : 1 / 4;
      const yMax = m.kind === "soft-clay" ? 8 * y50 : 16 * y50;
      const p = (y: number) => {
        const a = Math.abs(y);
        return Math.sign(y) * (a >= yMax ? pu : 0.5 * pu * (a / y50) ** n);
      };
      // The curve's tangent is infinite at y = 0: start from its secant at y50 / 100.
      return { p, k0: p(y50 / 100) / (y50 / 100) };
    }
    case "weak-rock": {
      const ar = 1 - (2 / 3) * (Math.min(100, Math.max(0, m.rqd)) / 100); // 0.33 at RQD 100 %, 1.0 at 0 %
      const zr = Math.max(zl, 0);
      const pu = zr <= 3 * D ? ar * m.qu * D * (1 + (1.4 * zr) / D) : 5.2 * ar * m.qu * D; // lb/in
      const kir = zr <= 3 * D ? 100 + (400 * zr) / (3 * D) : 500;
      const Kir = kir * m.Em; // lb/in²
      const yrm = m.krm * D;
      const yA = (pu / (2 * yrm ** 0.25 * Kir)) ** 1.333;
      const p = (y: number) => {
        const a = Math.abs(y);
        const v = a <= yA ? Kir * a : Math.min(pu, (pu / 2) * (a / yrm) ** 0.25);
        return (Math.sign(y) * v) / 1000;
      };
      return { p, k0: Kir / 1000 };
    }
    case "linear":
      return { p: (y) => m.k * y, k0: m.k };
    case "none":
      return { p: () => 0, k0: 0 };
  }
}

export type HeadCondition = { kind: "free"; H: number; M: number } | { kind: "fixed"; H: number } | { kind: "displaced"; y: number; pinned?: boolean };

export type LateralInputs = {
  length: number; // ft, head to tip
  D: number; // in, width facing the soil (an H-pile's flange width or depth, a shaft's diameter)
  EI: number; // kip·in²
  Q?: number; // kip, axial compression (P–Δ)
  head: HeadCondition; // H kip, M kip·ft, y in
  layers: Layer[]; // from the head down
  pm?: number; // p-multiplier
  segments?: number;
};

export type LateralResult = {
  z: number[]; // ft
  y: number[]; // in
  M: number[]; // kip·ft
  V: number[]; // kip
  p: number[]; // kip/ft
  y0: number; // in, at the head
  theta0: number; // rad, at the head
  H0: number; // kip, the head's shear (the reaction for an imposed displacement)
  M0: number; // kip·ft, at the head
  Mmax: number; // kip·ft, largest magnitude
  zMmax: number; // ft
  Vmax: number; // kip
  zZero: number | null; // ft, first point of zero deflection below the head (AASHTO C6.15.2 "fixity")
  iterations: number;
  converged: boolean;
};

/** Solve A·x = b, A banded with half-widths lo, hi (pivoting may widen hi by lo), dense storage. */
function solveBand(A: number[][], b: number[], lo: number, hi: number): number[] {
  const n = b.length;
  const up = hi + lo;
  for (let k = 0; k < n; k++) {
    let piv = k;
    for (let r = k + 1; r <= Math.min(n - 1, k + lo); r++) if (Math.abs(A[r][k]) > Math.abs(A[piv][k])) piv = r;
    if (Math.abs(A[piv][k]) < 1e-30) throw new DesignError("The lateral analysis is singular: check the pile's stiffness and the soil.");
    if (piv !== k) {
      [A[piv], A[k]] = [A[k], A[piv]];
      [b[piv], b[k]] = [b[k], b[piv]];
    }
    const last = Math.min(n - 1, k + up);
    for (let r = k + 1; r <= Math.min(n - 1, k + lo); r++) {
      const f = A[r][k] / A[k][k];
      if (f === 0) continue;
      for (let c = k; c <= last; c++) A[r][c] -= f * A[k][c];
      b[r] -= f * b[k];
    }
  }
  const x = new Array(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    let s = b[k];
    for (let c = k + 1; c <= Math.min(n - 1, k + up); c++) s -= A[k][c] * x[c];
    x[k] = s / A[k][k];
  }
  return x;
}

export function analyzeLateral(o: LateralInputs): LateralResult {
  if (!(o.length > 0 && o.D > 0 && o.EI > 0)) throw new DesignError("The pile needs a length, a width and a stiffness.");
  const n = Math.max(40, Math.min(400, o.segments ?? Math.round(o.length * 4)));
  const L = o.length * 12;
  const h = L / n;
  const EI = o.EI;
  const Q = o.Q ?? 0;
  const pm = o.pm ?? 1;
  // The spring at each node, from the layer it is in.
  const tops: number[] = [];
  let acc = 0;
  for (const l of o.layers) {
    tops.push(acc);
    acc += l.thickness * 12;
  }
  const soilTop = (() => {
    const k = o.layers.findIndex((l) => l.model.kind !== "none");
    return k < 0 ? Infinity : tops[k];
  })();
  const springs: Spring[] = [];
  for (let i = 0; i <= n; i++) {
    const z = i * h;
    let li = o.layers.length - 1;
    for (let k = 0; k < o.layers.length; k++) if (z >= tops[k] - 1e-9 && z < tops[k] + o.layers[k].thickness * 12 - 1e-9) li = k;
    if (z >= acc) li = o.layers.length - 1;
    const layer = o.layers[li];
    if (!layer || layer.model.kind === "none" || z < soilTop) {
      springs.push({ p: () => 0, k0: 0 });
      continue;
    }
    // Average effective unit weight and strength above (for the clays' pu).
    let wsum = 0;
    let ssum = 0;
    let dz = 0;
    for (let k = 0; k < o.layers.length; k++) {
      const a = Math.max(tops[k], soilTop);
      const b = Math.min(tops[k] + o.layers[k].thickness * 12, z);
      if (b <= a) continue;
      const m = o.layers[k].model;
      const g = "gamma" in m ? m.gamma / 1728 / 1000 : 0;
      const su = "su" in m ? m.su : 0;
      wsum += g * (b - a);
      ssum += su * (b - a);
      dz += b - a;
    }
    const gAvg = dz > 0 ? wsum / dz : "gamma" in layer.model ? layer.model.gamma / 1728 / 1000 : 0;
    const suAvg = dz > 0 && ssum > 0 ? ssum / dz : "su" in layer.model ? layer.model.su : 0;
    const s = pyCurve(layer.model, z - soilTop, z - tops[li], o.D, gAvg, suAvg);
    // End nodes carry half a segment's spring in effect: the FD equation uses p at the node.
    springs.push({ p: (y) => pm * s.p(y), k0: pm * s.k0 });
  }

  // Unknowns y_{-2} .. y_{n+2} at index i + 2.
  const N = n + 5;
  const idx = (i: number) => i + 2;
  const solve = (k: number[]) => {
    const A = Array.from({ length: N }, () => new Array(N).fill(0));
    const b = new Array(N).fill(0);
    const h2 = h * h;
    const h3 = h2 * h;
    const h4 = h2 * h2;
    // Head boundary conditions (rows 0, 1).
    const head = o.head;
    if (head.kind === "free" || (head.kind === "displaced" && head.pinned)) {
      // Moment: EI·y'' = M (kip·in), sign: a positive M deflects the head in +y, as H does.
      A[0][idx(-1)] = EI / h2;
      A[0][idx(0)] = (-2 * EI) / h2;
      A[0][idx(1)] = EI / h2;
      b[0] = head.kind === "free" ? head.M * 12 : 0;
    } else {
      // No rotation: y' = 0.
      A[0][idx(-1)] = -1 / (2 * h);
      A[0][idx(1)] = 1 / (2 * h);
    }
    if (head.kind === "displaced") {
      A[1][idx(0)] = 1;
      b[1] = head.y;
    } else {
      // Shear: EI·y''' + Q·y' = H (the soil below pushes back): with z down and H in +y at the head.
      A[1][idx(-2)] = -EI / (2 * h3);
      A[1][idx(-1)] = EI / h3 - Q / (2 * h);
      A[1][idx(1)] = -EI / h3 + Q / (2 * h);
      A[1][idx(2)] = EI / (2 * h3);
      b[1] = head.H;
    }
    // Node equations, rows 2 .. n + 2.
    for (let i = 0; i <= n; i++) {
      const r = i + 2;
      A[r][idx(i - 2)] += EI / h4;
      A[r][idx(i - 1)] += (-4 * EI) / h4 + Q / h2;
      A[r][idx(i)] += (6 * EI) / h4 - (2 * Q) / h2 + k[i];
      A[r][idx(i + 1)] += (-4 * EI) / h4 + Q / h2;
      A[r][idx(i + 2)] += EI / h4;
    }
    // Tip: no moment, no shear (rows n + 3, n + 4).
    A[n + 3][idx(n - 1)] = 1;
    A[n + 3][idx(n)] = -2;
    A[n + 3][idx(n + 1)] = 1;
    A[n + 4][idx(n - 2)] = -EI / (2 * h3);
    A[n + 4][idx(n - 1)] = EI / h3 - Q / (2 * h);
    A[n + 4][idx(n + 1)] = -EI / h3 + Q / (2 * h);
    A[n + 4][idx(n + 2)] = EI / (2 * h3);
    return solveBand(A, b, 4, 4);
  };

  let k = springs.map((s) => s.k0);
  let y: number[] = [];
  let converged = false;
  let it = 0;
  for (; it < 200; it++) {
    const x = solve(k);
    const yNew = Array.from({ length: n + 1 }, (_, i) => x[idx(i)]);
    const kNew = yNew.map((yi, i) => (Math.abs(yi) < 1e-9 ? springs[i].k0 : springs[i].p(yi) / yi));
    const change = y.length ? Math.max(...yNew.map((v, i) => Math.abs(v - y[i]))) : Infinity;
    const scale = Math.max(1e-6, ...yNew.map(Math.abs));
    // Damped secant update: half the change in stiffness each pass keeps soft layers from oscillating.
    k = kNew.map((kn, i) => (it < 3 ? kn : 0.5 * kn + 0.5 * k[i]));
    y = yNew;
    if (change / scale < 1e-6) {
      converged = true;
      break;
    }
    if (!Number.isFinite(scale) || scale > 1e4) break;
  }
  // Final pass at the converged stiffness, for moments and shears with the ghost nodes.
  const x = solve(k);
  const yy = (i: number) => x[idx(i)];
  const z: number[] = [];
  const Y: number[] = [];
  const M: number[] = [];
  const V: number[] = [];
  const P: number[] = [];
  for (let i = 0; i <= n; i++) {
    z.push((i * h) / 12);
    Y.push(yy(i));
    M.push((-EI * (yy(i - 1) - 2 * yy(i) + yy(i + 1))) / (h * h) / 12);
    V.push((-EI * (yy(i + 2) - 2 * yy(i + 1) + 2 * yy(i - 1) - yy(i - 2))) / (2 * h * h * h) - (Q * (yy(i + 1) - yy(i - 1))) / (2 * h));
    P.push(springs[i].p(yy(i)) * 12);
  }
  let iMax = 0;
  for (let i = 1; i <= n; i++) if (Math.abs(M[i]) > Math.abs(M[iMax])) iMax = i;
  let zZero: number | null = null;
  for (let i = 1; i <= n; i++)
    if (Y[i - 1] !== 0 && Math.sign(Y[i]) !== Math.sign(Y[i - 1])) {
      zZero = z[i - 1] + ((z[i] - z[i - 1]) * Math.abs(Y[i - 1])) / (Math.abs(Y[i - 1]) + Math.abs(Y[i]));
      break;
    }
  return {
    z,
    y: Y,
    M,
    V,
    p: P,
    y0: Y[0],
    theta0: (yy(1) - yy(-1)) / (2 * h),
    H0: o.head.kind === "displaced" ? -V[0] : o.head.H,
    M0: M[0],
    Mmax: Math.abs(M[iMax]),
    zMmax: z[iMax],
    Vmax: Math.max(...V.map(Math.abs)),
    zZero,
    iterations: it + 1,
    converged,
  };
}
