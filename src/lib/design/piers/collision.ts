import { BARS, DesignError, type Check } from "../walls/cip";

// A round pier column for vehicle collision, AASHTO LRFD 3.6.5.1, in Extreme Event II: the
// equivalent static force (600 kip, at 5 ft above the ground, in any direction 0–15° from the
// roadway edge) on one column, its shear and moments (each of the bent's columns, on its drilled
// shaft, fixed at the shaft's point of fixity and to a cap that doesn't rotate but sways, so the
// other columns share the load; or entered from a frame analysis), and the column's resistance:
// shear by the simplified procedure for a circular section (5.7.3.3, C5.7.2.8) and axial load with
// bending by strain compatibility (5.6.2, 5.6.4). Kip, foot and inch.

export type CollisionInputs = {
  // Column
  D: number; // in, diameter
  cover: number; // in, clear to the ties
  bars: number; // longitudinal bars, equally spaced
  bar: number; // their size
  tieBar: number;
  tieLegs: number; // legs of tie in each spacing (2 for a single hoop)
  tieSpacing: number; // in
  fc: number; // ksi
  fy: number; // ksi
  // Geometry
  height: number; // ft, the column, top of the shaft to the cap's soffit
  capDepth: number; // ft, the column is taken to the cap's mid-depth
  shaftD: number; // in, the drilled shaft's diameter (its stiffness)
  shaftCover: number; // ft, ground above the top of the shaft
  fixity: number; // ft, below the top of the shaft to its point of fixity
  columns: number; // in the bent, alike (1: a single column, free to sway)
  // Loads
  CT: number; // kip (3.6.5.1)
  impact: number; // ft above the ground (3.6.5.1)
  PDC: number; // kip, the column's axial dead load (DC + DW)
  useFrame: boolean; // the forces from a frame analysis
  Vu: number; // kip
  Mu: number; // kip·ft
  // Resistance factors in Extreme Event II (1.0, 1.3.2.1)
  phiV: number;
  phiM: number;
};

/** The defaults: a 4 ft round column, 20 ft clear, under a 4 ft cap, on a shaft fixed 13.5 ft down. */
export const COLLISION_DEFAULTS: CollisionInputs = {
  D: 48,
  cover: 2,
  bars: 22,
  bar: 10,
  tieBar: 4,
  tieLegs: 2,
  tieSpacing: 4,
  fc: 4.5,
  fy: 60,
  height: 20,
  capDepth: 4,
  shaftD: 54,
  shaftCover: 2,
  fixity: 13.5,
  columns: 3,
  CT: 600,
  impact: 5,
  PDC: 600,
  useFrame: false,
  Vu: 396.2,
  Mu: 2500,
  phiV: 1.0,
  phiM: 1.0,
};

/** A round section's nominal axial and moment resistance with the neutral axis c from the
 * compression face (kip, kip·in), by strain compatibility with a rectangular stress block. */
export function roundSection(D: number, ring: number, n: number, As: number, fc: number, fy: number) {
  const R = D / 2;
  const beta1 = Math.min(0.85, Math.max(0.65, 0.85 - (fc - 4) * 0.05));
  const bars = Array.from({ length: n }, (_, k) => R - (ring / 2) * Math.cos((2 * Math.PI * k) / n));
  const at = (c: number) => {
    const a = Math.min(beta1 * c, D);
    const theta = Math.acos(Math.max(-1, Math.min(1, (R - a) / R)));
    const area = R ** 2 * (theta - Math.sin(theta) * Math.cos(theta));
    const ybar = area > 0 ? (2 * (R * Math.sin(theta)) ** 3) / (3 * area) : 0; // from the center
    let P = 0.85 * fc * area;
    let M = 0.85 * fc * area * ybar;
    let epsT = -Infinity;
    for (const d of bars) {
      const eps = (0.003 * (c - d)) / c;
      const fs = Math.max(-fy, Math.min(fy, 29000 * eps));
      const f = d < a ? fs - 0.85 * fc : fs; // bars in the stress block displace concrete
      P += As * f;
      M += As * f * (R - d);
      epsT = Math.max(epsT, -eps);
    }
    return { c, P, M, epsT };
  };
  /** The moment resistance at an axial load (compression positive), by bisection on c. */
  const momentAt = (P: number) => {
    let lo = 1e-3;
    let hi = 5 * D;
    for (let k = 0; k < 80; k++) {
      const mid = (lo + hi) / 2;
      if (at(mid).P < P) lo = mid;
      else hi = mid;
    }
    return at((lo + hi) / 2);
  };
  const P0 = 0.85 * fc * (Math.PI * R ** 2 - n * As) + fy * n * As; // AASHTO Eq. 5.6.4.4-3
  return { at, momentAt, P0, beta1 };
}

export function designCollision(i: CollisionInputs) {
  if (i.D <= 0 || i.bars < 4) throw new DesignError("The column needs a diameter and at least 4 bars.");
  const checks: Check[] = [];
  const add = (c: Omit<Check, "ok"> & { ok?: boolean }) => checks.push({ ...c, ok: c.ok ?? c.demand <= c.capacity });

  // --- the column and its forces -------------------------------------------------------------------
  const L = i.fixity + i.height + i.capDepth / 2; // ft, fixity to the cap's mid-depth
  const zs = i.fixity; // top of the shaft
  const a = i.fixity + i.shaftCover + i.impact; // impact above the point of fixity
  const b = L - a;
  if (b <= 0 || a <= zs) throw new DesignError("The impact must be on the column, between the top of the shaft and the cap.");
  const fixed = bent(L, zs, a, (i.shaftD / i.D) ** 4, i.CT, Math.max(1, Math.round(i.columns)));
  // Over the column itself (the shaft below is designed separately).
  const Mcol = Math.max(Math.abs(fixed.M(zs)), Math.abs(fixed.M(a)), Math.abs(fixed.M(L - i.capDepth / 2)));
  const Vu = i.useFrame ? i.Vu : Math.max(fixed.Vbottom, fixed.Vtop);
  const Mu = i.useFrame ? i.Mu : Mcol;

  // --- shear (5.7.3.3, simplified: β = 2, θ = 45°) ------------------------------------------------------
  const bar = BARS[i.bar];
  const tie = BARS[i.tieBar];
  const Dr = i.D - 2 * i.cover - 2 * tie.dia - bar.dia; // circle through the bars' centers
  const bv = i.D;
  const de = i.D / 2 + Dr / Math.PI; // AASHTO Eq. C5.7.2.8-2
  const dv = Math.max(0.9 * de, 0.72 * i.D); // 5.7.2.8
  const Av = i.tieLegs * tie.area;
  const Vc = 0.0316 * 2 * Math.sqrt(i.fc) * bv * dv; // AASHTO Eq. 5.7.3.3-3
  const Vs = (Av * i.fy * dv) / i.tieSpacing; // AASHTO Eq. 5.7.3.3-4, θ = 45°, α = 90°
  const Vn = Math.min(Vc + Vs, 0.25 * i.fc * bv * dv); // AASHTO Eqs. 5.7.3.3-1, -2
  const VR = i.phiV * Vn;
  const AvMin = (0.0316 * Math.sqrt(i.fc) * bv * i.tieSpacing) / i.fy; // AASHTO Eq. 5.7.2.5-1
  const vu = Vu / (i.phiV * bv * dv); // AASHTO Eq. 5.7.2.8-1
  const sMax = vu < 0.125 * i.fc ? Math.min(0.8 * dv, 24) : Math.min(0.4 * dv, 12); // 5.7.2.6
  add({ id: "shear", name: "Shear", demand: Vu, capacity: VR, unit: "kip", ref: "AASHTO 5.7.3.3" });
  add({ id: "shear-min", name: "Minimum transverse reinforcement", demand: AvMin, capacity: Av, unit: "in²", ref: "AASHTO 5.7.2.5" });
  add({ id: "shear-spacing", name: "Tie spacing", demand: i.tieSpacing, capacity: sMax, unit: "in", ref: "AASHTO 5.7.2.6" });

  // --- axial load and bending (5.6.2, 5.6.4) --------------------------------------------------------------
  const section = roundSection(i.D, Dr, i.bars, bar.area, i.fc, i.fy);
  const PRmax = 0.85 * i.phiM * section.P0; // spirals or ties: 0.85 (5.6.4.4), with φ for the event
  const cases = [0.9, 1.25].map((g) => {
    const Pu = g * i.PDC; // DC at its smallest and largest factor (T. 3.4.1-2)
    const s = section.momentAt(Pu);
    return { gamma: g, Pu, Mn: s.M / 12, MR: (i.phiM * s.M) / 12 };
  });
  for (const c of cases) add({ id: `pm-${c.gamma}`, name: `Axial load and bending, DC × ${c.gamma}`, demand: Mu, capacity: c.MR, unit: "kip·ft", ref: "AASHTO 5.6.4" });
  add({ id: "pm-axial", name: "Axial load within 0.85 φ P0", demand: 1.25 * i.PDC, capacity: PRmax, unit: "kip", ref: "AASHTO 5.6.4.4" });

  return { ok: checks.every((c) => c.ok), checks, L, a, b, fixed, Vu, Mu, shear: { Dr, bv, de, dv, Av, Vc, Vs, Vn, VR, AvMin, vu, sMax }, section: { P0: section.P0, PRmax, beta1: section.beta1 }, cases, curve: interaction(section, i.D) };
}

/** A bent column on its shaft as a beam (EI of the shaft `ratio` times the column's): fixed at the
 * shaft's point of fixity (z = 0), its top fixed against rotation at the cap (z = L) and swaying
 * against the bent's other columns, alike; the load P at z = a. Its shears either side of the
 * load and its bending moment M(z), by the stiffness method (EI = 1 for the column). */
export function bent(L: number, zs: number, a: number, ratio: number, P: number, n: number) {
  // Nodes: 0 fixity, 1 top of the shaft, 2 load, 3 top. DOFs [v1, θ1, v2, θ2, v3] (θ3 = 0, node 0 fixed).
  const nodes = [0, zs, a, L];
  const EI = [ratio, 1, 1];
  const dof = [[-1, -1], [0, 1], [2, 3], [4, -1]];
  const solve = (spring: number, load: number[], fixV3?: number) => {
    const K = Array.from({ length: 5 }, () => new Array<number>(5).fill(0));
    const F = [...load];
    for (let e = 0; e < 3; e++) {
      const l = nodes[e + 1] - nodes[e];
      const k = EI[e] / l ** 3;
      const ke = [
        [12 * k, 6 * l * k, -12 * k, 6 * l * k],
        [6 * l * k, 4 * l * l * k, -6 * l * k, 2 * l * l * k],
        [-12 * k, -6 * l * k, 12 * k, -6 * l * k],
        [6 * l * k, 2 * l * l * k, -6 * l * k, 4 * l * l * k],
      ];
      const map = [...dof[e], ...dof[e + 1]];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (map[r] >= 0 && map[c] >= 0) K[map[r]][map[c]] += ke[r][c];
    }
    K[4][4] += spring;
    if (fixV3 !== undefined) {
      for (let c = 0; c < 5; c++) {
        F[c] -= K[c][4] * fixV3;
        K[4][c] = K[c][4] = 0;
      }
      K[4][4] = 1;
      F[4] = fixV3;
    }
    // Gaussian elimination.
    const A = K.map((row, r) => [...row, F[r]]);
    for (let p = 0; p < 5; p++) {
      const piv = A[p][p];
      for (let r = p + 1; r < 5; r++) {
        const f = A[r][p] / piv;
        for (let c = p; c < 6; c++) A[r][c] -= f * A[p][c];
      }
    }
    const x = new Array<number>(5).fill(0);
    for (let r = 4; r >= 0; r--) x[r] = (A[r][5] - A[r].slice(r + 1, 5).reduce((s2, v, j) => s2 + v * x[r + 1 + j], 0)) / A[r][r];
    return x;
  };
  // The other columns' sway stiffness: the force to drift one column's top by 1, rotation fixed.
  const u = solve(0, [0, 0, 0, 0, 0], 1);
  const ends = (x: number[]) =>
    [0, 1, 2].map((e) => {
      const l = nodes[e + 1] - nodes[e];
      const k = EI[e] / l ** 3;
      const d = [...dof[e], ...dof[e + 1]].map((j) => (j >= 0 ? x[j] : 0));
      // End forces [Vi, Mi, Vj, Mj] = ke · d.
      return [
        k * (12 * d[0] + 6 * l * d[1] - 12 * d[2] + 6 * l * d[3]),
        k * (6 * l * d[0] + 4 * l * l * d[1] - 6 * l * d[2] + 2 * l * l * d[3]),
        k * (-12 * d[0] - 6 * l * d[1] + 12 * d[2] - 6 * l * d[3]),
        k * (6 * l * d[0] + 2 * l * l * d[1] - 6 * l * d[2] + 4 * l * l * d[3]),
      ];
    });
  const kcol = Math.abs(ends(u)[2][2]);
  const x = solve((n - 1) * kcol, [0, 0, -P, 0, 0]);
  const f = ends(x);
  /** Bending moment at z: linear along each element (no load between nodes). */
  const M = (z: number) => {
    const e = z <= zs ? 0 : z <= a ? 1 : 2;
    const xi = (z - nodes[e]) / (nodes[e + 1] - nodes[e]);
    return -f[e][1] * (1 - xi) + f[e][3] * xi;
  };
  return { Vbottom: Math.abs(f[1][0]), Vtop: Math.abs(f[2][0]), Mbottom: Math.abs(f[0][1]), Mtop: Math.abs(f[2][3]), Mimpact: Math.abs(M(a)), M, kcol };
}

/** The interaction diagram's points (P, M in kip and kip·ft), for drawing. */
function interaction(section: ReturnType<typeof roundSection>, D: number) {
  const pts: { P: number; M: number }[] = [];
  for (let k = 1; k <= 60; k++) {
    const c = (k / 60) ** 1.5 * 2 * D;
    const s = section.at(c);
    pts.push({ P: s.P, M: s.M / 12 });
  }
  return pts;
}

export type CollisionResult = ReturnType<typeof designCollision>;
