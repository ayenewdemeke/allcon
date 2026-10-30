// A 2D plane frame, by the direct stiffness method: nodes, prismatic elements (E = 1: only the
// relative stiffnesses matter for the forces), supports, nodal and linearly varying distributed
// loads. The stiffness is factored once (Cholesky), so each load case is two triangular solves.

export type FrameNode = { x: number; y: number };
export type FrameElement = { i: number; j: number; A: number; I: number };
export type FrameSupport = { node: number; ux?: boolean; uy?: boolean; rz?: boolean };
/** A load in a global direction, per unit length along the element, linear from s0 to s1 (distances from node i). */
export type DistLoad = { el: number; dir: "x" | "y"; s0: number; s1: number; q0: number; q1: number };
export type NodalLoad = { node: number; fx?: number; fy?: number; m?: number };
export type LoadCase = { dist?: DistLoad[]; nodal?: NodalLoad[] };

/** End forces of an element, as internal forces: N compression positive, V, and M positive when
 * the element's −y side (to the right going from i to j) is in tension. */
export type EndForces = { Ni: number; Vi: number; Mi: number; Nj: number; Vj: number; Mj: number };

// Gauss–Legendre, 3 points on [0, 1]: exact for the cubic shape functions times a linear load.
const GP = [0.5 - Math.sqrt(0.15), 0.5, 0.5 + Math.sqrt(0.15)];
const GW = [5 / 18, 8 / 18, 5 / 18];

export class Frame {
  readonly nodes: FrameNode[];
  readonly elements: FrameElement[];
  private readonly geo: { L: number; c: number; s: number }[];
  private readonly map: Int32Array; // global dof → free dof index, or −1
  private readonly n: number;
  private readonly chol: Float64Array; // lower triangle, row-major n×n, within the profile
  private readonly first: Int32Array; // each row's first column in the profile
  private readonly kl: Float64Array[];

  constructor(nodes: FrameNode[], elements: FrameElement[], supports: FrameSupport[]) {
    this.nodes = nodes;
    this.elements = elements;
    this.geo = elements.map((e) => {
      const dx = nodes[e.j].x - nodes[e.i].x;
      const dy = nodes[e.j].y - nodes[e.i].y;
      const L = Math.hypot(dx, dy);
      return { L, c: dx / L, s: dy / L };
    });
    const fixed = new Uint8Array(nodes.length * 3);
    for (const sp of supports) {
      if (sp.ux) fixed[sp.node * 3] = 1;
      if (sp.uy) fixed[sp.node * 3 + 1] = 1;
      if (sp.rz) fixed[sp.node * 3 + 2] = 1;
    }
    // Number the free dofs node by node in reverse Cuthill–McKee order: a narrow profile.
    const order = rcm(nodes.length, elements);
    this.map = new Int32Array(nodes.length * 3).fill(-1);
    let n = 0;
    for (const node of order) for (let d = 0; d < 3; d++) if (!fixed[node * 3 + d]) this.map[node * 3 + d] = n++;
    this.n = n;
    this.kl = elements.map((_, k) => this.localStiffness(k));
    const K = new Float64Array(n * n);
    const first = new Int32Array(n).map((_, r) => r);
    elements.forEach((e, k) => {
      const kg = this.globalStiffness(k);
      const dofs = this.dofs(e);
      for (let a = 0; a < 6; a++) {
        const ra = this.map[dofs[a]];
        if (ra < 0) continue;
        for (let b = 0; b < 6; b++) {
          const cb = this.map[dofs[b]];
          if (cb < 0) continue;
          K[ra * n + cb] += kg[a * 6 + b];
          if (cb < first[ra]) first[ra] = cb;
        }
      }
    });
    this.first = first;
    this.chol = cholesky(K, n, first);
  }

  private dofs(e: FrameElement) {
    return [e.i * 3, e.i * 3 + 1, e.i * 3 + 2, e.j * 3, e.j * 3 + 1, e.j * 3 + 2];
  }

  private localStiffness(k: number): Float64Array {
    const { A, I } = this.elements[k];
    const { L } = this.geo[k];
    const a = A / L;
    const b = (12 * I) / L ** 3;
    const c = (6 * I) / L ** 2;
    const d = (4 * I) / L;
    const f = (2 * I) / L;
    // prettier-ignore
    return Float64Array.from([
      a, 0, 0, -a, 0, 0,
      0, b, c, 0, -b, c,
      0, c, d, 0, -c, f,
      -a, 0, 0, a, 0, 0,
      0, -b, -c, 0, b, -c,
      0, c, f, 0, -c, d,
    ]);
  }

  /** local = T · global */
  private transform(k: number, v: ArrayLike<number>) {
    const { c, s } = this.geo[k];
    return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2], c * v[3] + s * v[4], -s * v[3] + c * v[4], v[5]];
  }

  /** global = Tᵀ · local */
  private untransform(k: number, v: ArrayLike<number>) {
    const { c, s } = this.geo[k];
    return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2], c * v[3] - s * v[4], s * v[3] + c * v[4], v[5]];
  }

  private globalStiffness(k: number) {
    const kl = this.localStiffness(k);
    const out = new Float64Array(36);
    // Tᵀ kl T, column by column.
    for (let col = 0; col < 6; col++) {
      const unit = [0, 0, 0, 0, 0, 0];
      unit[col] = 1;
      const tl = this.transform(k, unit);
      const kt = [0, 0, 0, 0, 0, 0].map((_, r) => {
        let sum = 0;
        for (let m = 0; m < 6; m++) sum += kl[r * 6 + m] * tl[m];
        return sum;
      });
      const g = this.untransform(k, kt);
      for (let r = 0; r < 6; r++) out[r * 6 + col] = g[r];
    }
    return out;
  }

  /** Equivalent nodal loads (local) of a distributed load on an element. */
  private equivalent(load: DistLoad) {
    const k = load.el;
    const { L, c, s } = this.geo[k];
    const gx = load.dir === "x" ? 1 : 0;
    const gy = load.dir === "y" ? 1 : 0;
    const ax = gx * c + gy * s; // component along local x
    const ay = -gx * s + gy * c; // along local y
    const f = [0, 0, 0, 0, 0, 0];
    const s0 = Math.max(0, Math.min(L, load.s0));
    const s1 = Math.max(0, Math.min(L, load.s1));
    const len = s1 - s0;
    if (len <= 1e-12) return f;
    for (let g = 0; g < 3; g++) {
      const t = GP[g];
      const sPos = s0 + t * len;
      // The load's value at sPos, linear between its own ends (which may extend past the element).
      const span = load.s1 - load.s0;
      const q = span === 0 ? load.q0 : load.q0 + ((load.q1 - load.q0) * (sPos - load.s0)) / span;
      const w = GW[g] * len * q;
      const xi = sPos / L;
      f[0] += w * ax * (1 - xi);
      f[3] += w * ax * xi;
      f[1] += w * ay * (1 - 3 * xi ** 2 + 2 * xi ** 3);
      f[2] += w * ay * L * (xi - 2 * xi ** 2 + xi ** 3);
      f[4] += w * ay * (3 * xi ** 2 - 2 * xi ** 3);
      f[5] += w * ay * L * (-(xi ** 2) + xi ** 3);
    }
    return f;
  }

  /** Solves a load case: the internal end forces of each element (or of those asked for; the rest are null). */
  solve(lc: LoadCase): EndForces[];
  solve(lc: LoadCase, only: number[]): (EndForces | null)[];
  solve(lc: LoadCase, only?: number[]): (EndForces | null)[] {
    const F = new Float64Array(this.nodes.length * 3);
    const feq = this.elements.map(() => [0, 0, 0, 0, 0, 0]);
    for (const d of lc.dist ?? []) {
      const fl = this.equivalent(d);
      for (let m = 0; m < 6; m++) feq[d.el][m] += fl[m];
    }
    feq.forEach((fl, k) => {
      const g = this.untransform(k, fl);
      this.dofs(this.elements[k]).forEach((dof, m) => (F[dof] += g[m]));
    });
    for (const p of lc.nodal ?? []) {
      F[p.node * 3] += p.fx ?? 0;
      F[p.node * 3 + 1] += p.fy ?? 0;
      F[p.node * 3 + 2] += p.m ?? 0;
    }
    const b = new Float64Array(this.n);
    for (let d = 0; d < F.length; d++) if (this.map[d] >= 0) b[this.map[d]] = F[d];
    const x = cholSolve(this.chol, this.n, this.first, b);
    const u = new Float64Array(this.nodes.length * 3);
    for (let d = 0; d < u.length; d++) u[d] = this.map[d] >= 0 ? x[this.map[d]] : 0;
    const want = only ? new Set(only) : null;
    return this.elements.map((e, k) => {
      if (want && !want.has(k)) return null;
      const ul = this.transform(
        k,
        this.dofs(e).map((d) => u[d]),
      );
      const kl = this.kl[k];
      const f = [0, 1, 2, 3, 4, 5].map((r) => {
        let sum = -feq[k][r];
        for (let m = 0; m < 6; m++) sum += kl[r * 6 + m] * ul[m];
        return sum;
      });
      return { Ni: f[0], Vi: f[1], Mi: -f[2], Nj: -f[3], Vj: -f[4], Mj: f[5] };
    });
  }
}

/** Reverse Cuthill–McKee: a node order that keeps connected nodes close (a narrow profile). */
function rcm(count: number, elements: FrameElement[]) {
  const adj: number[][] = Array.from({ length: count }, () => []);
  for (const e of elements) {
    adj[e.i].push(e.j);
    adj[e.j].push(e.i);
  }
  const seen = new Uint8Array(count);
  const order: number[] = [];
  const byDegree = [...adj.keys()].sort((a, b) => adj[a].length - adj[b].length);
  for (const start of byDegree) {
    if (seen[start]) continue;
    seen[start] = 1;
    const queue = [start];
    for (let h = 0; h < queue.length; h++) {
      const v = queue[h];
      order.push(v);
      for (const w of [...adj[v]].sort((a, b) => adj[a].length - adj[b].length))
        if (!seen[w]) {
          seen[w] = 1;
          queue.push(w);
        }
    }
  }
  return order.reverse();
}

function cholesky(K: Float64Array, n: number, first: Int32Array) {
  // The profile of L is the profile of K (fill stays inside it).
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const fi = first[i];
    for (let j = fi; j <= i; j++) {
      let s = K[i * n + j];
      const from = Math.max(fi, first[j]);
      for (let k = from; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (j === i) {
        if (!(s > 0)) throw new Error("The frame is unstable");
        L[i * n + i] = Math.sqrt(s);
      } else L[i * n + j] = s / L[j * n + j];
    }
  }
  return L;
}

function cholSolve(L: Float64Array, n: number, first: Int32Array, b: Float64Array) {
  const y = Float64Array.from(b);
  for (let i = 0; i < n; i++) {
    let s = y[i];
    for (let k = first[i]; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  // Backward, by columns of Lᵀ (rows of L), within the profile.
  for (let i = n - 1; i >= 0; i--) {
    y[i] /= L[i * n + i];
    const xi = y[i];
    for (let k = first[i]; k < i; k++) y[k] -= L[i * n + k] * xi;
  }
  return y;
}
