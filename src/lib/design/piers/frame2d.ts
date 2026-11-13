import { DesignError } from "../walls/cip";

// A plane frame by the direct stiffness method (first-order, linear elastic): nodes with three
// degrees of freedom (u, v, θ), straight members carrying axial load and bending, nodal loads.
// Used for a pier's bent: the cap a beam on its columns, the columns fixed at their bases.

export type FrameNode = { x: number; y: number; fixed?: boolean };
export type FrameMember = { a: number; b: number; EA: number; EI: number };
export type FrameLoad = { node: number; fx?: number; fy?: number; m?: number };

/** Member end forces in the member's own axes (x from a to b): [Na, Va, Ma, Nb, Vb, Mb], on the member. */
export type EndForces = [number, number, number, number, number, number];

function geometry(nodes: FrameNode[], m: FrameMember) {
  const dx = nodes[m.b].x - nodes[m.a].x;
  const dy = nodes[m.b].y - nodes[m.a].y;
  const L = Math.hypot(dx, dy);
  if (!(L > 0)) throw new DesignError("A frame member has no length.");
  return { L, c: dx / L, s: dy / L };
}

function localK(L: number, EA: number, EI: number) {
  const a = EA / L;
  const k1 = (12 * EI) / L ** 3;
  const k2 = (6 * EI) / L ** 2;
  const k3 = (4 * EI) / L;
  const k4 = (2 * EI) / L;
  return [
    [a, 0, 0, -a, 0, 0],
    [0, k1, k2, 0, -k1, k2],
    [0, k2, k3, 0, -k2, k4],
    [-a, 0, 0, a, 0, 0],
    [0, -k1, -k2, 0, k1, -k2],
    [0, k2, k4, 0, -k2, k3],
  ];
}

function rotation(c: number, s: number) {
  const T = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  for (const o of [0, 3]) {
    T[o][o] = c;
    T[o][o + 1] = s;
    T[o + 1][o] = -s;
    T[o + 1][o + 1] = c;
    T[o + 2][o + 2] = 1;
  }
  return T;
}

/** Solves the frame for each set of loads: the nodes' displacements and every member's end forces. */
export function solveFrame(nodes: FrameNode[], members: FrameMember[], loadSets: FrameLoad[][]) {
  const n = nodes.length * 3;
  const K = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const mats = members.map((m) => {
    const g = geometry(nodes, m);
    const kl = localK(g.L, m.EA, m.EI);
    const T = rotation(g.c, g.s);
    // kg = Tᵀ kl T
    const kt = kl.map((row) => T[0].map((_, j) => row.reduce((p, v, r) => p + v * T[r][j], 0)));
    const kg = T[0].map((_, i) => T[0].map((__, j) => T.reduce((p, row, r) => p + row[i] * kt[r][j], 0)));
    const dofs = [m.a * 3, m.a * 3 + 1, m.a * 3 + 2, m.b * 3, m.b * 3 + 1, m.b * 3 + 2];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) K[dofs[i]][dofs[j]] += kg[i][j];
    return { kl, T, dofs };
  });
  const free = Array.from({ length: n }, (_, d) => d).filter((d) => !nodes[Math.floor(d / 3)].fixed);
  const nf = free.length;
  return loadSets.map((loads) => {
    const F = new Array<number>(n).fill(0);
    for (const l of loads) {
      F[l.node * 3] += l.fx ?? 0;
      F[l.node * 3 + 1] += l.fy ?? 0;
      F[l.node * 3 + 2] += l.m ?? 0;
    }
    // Gaussian elimination with partial pivoting on the free DOFs.
    const A = free.map((r) => [...free.map((c) => K[r][c]), F[r]]);
    for (let p = 0; p < nf; p++) {
      let piv = p;
      for (let r = p + 1; r < nf; r++) if (Math.abs(A[r][p]) > Math.abs(A[piv][p])) piv = r;
      if (Math.abs(A[piv][p]) < 1e-12) throw new DesignError("The bent is unstable as modeled.");
      [A[p], A[piv]] = [A[piv], A[p]];
      for (let r = p + 1; r < nf; r++) {
        const f = A[r][p] / A[p][p];
        if (f) for (let c = p; c <= nf; c++) A[r][c] -= f * A[p][c];
      }
    }
    const x = new Array<number>(nf).fill(0);
    for (let r = nf - 1; r >= 0; r--) {
      let s = A[r][nf];
      for (let c = r + 1; c < nf; c++) s -= A[r][c] * x[c];
      x[r] = s / A[r][r];
    }
    const d = new Array<number>(n).fill(0);
    free.forEach((dof, k) => (d[dof] = x[k]));
    const ends = mats.map(({ kl, T, dofs }) => {
      const dl = T.map((row) => row.reduce((p, v, j) => p + v * d[dofs[j]], 0));
      return kl.map((row) => row.reduce((p, v, j) => p + v * dl[j], 0)) as EndForces;
    });
    return { d, ends };
  });
}
