import { DOF_NAMES, ModelError, type Direction, type Dof6, type Element, type Load, type Model } from "./model";

// Linear static analysis of a 3D frame by the direct stiffness method: beam elements with shear
// deformation (Timoshenko) and end releases, truss elements, elastic links, supports and springs.
// The stiffness matrix is kept as a skyline (the nodes renumbered by reverse Cuthill–McKee to keep
// it narrow) and factored once as L·D·Lᵀ; every load case is then a pair of substitutions.
//
// Sign conventions of the results:
// - displacements and reactions: global axes;
// - element end forces: local axes, the forces the nodes put on the element;
// - internal forces at a section (forcesAt): N tension +; Vz and Vy the shear the left part carries
//   (+ in local z, y); My sagging + (tension on the −z face, the bottom of a girder); Mz + for
//   tension on the −y face; T torque.

type Vec3 = [number, number, number];
type Mat = number[][];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const zeros = (n: number, m: number): Mat => Array.from({ length: n }, () => new Array<number>(m).fill(0));

/** A member's local axes as rows (x, y, z), from its end points and its angle (degrees). */
export function localAxes(p1: Vec3, p2: Vec3, angle = 0): { R: [Vec3, Vec3, Vec3]; L: number } {
  const d = sub(p2, p1);
  const L = norm(d);
  // Two nodes at one point (a link of no length): the global axes.
  const ex: Vec3 = L > 1e-9 ? scale(d, 1 / L) : [1, 0, 0];
  let ey: Vec3;
  const h = Math.hypot(ex[0], ex[1]);
  if (h < 1e-6) ey = [0, 1, 0]; // vertical
  else ey = scale(cross([0, 0, 1], ex), 1 / h);
  let ez = cross(ex, ey);
  if (angle) {
    const c = Math.cos((angle * Math.PI) / 180);
    const s = Math.sin((angle * Math.PI) / 180);
    const y: Vec3 = [c * ey[0] + s * ez[0], c * ey[1] + s * ez[1], c * ey[2] + s * ez[2]];
    ez = [-s * ey[0] + c * ez[0], -s * ey[1] + c * ez[1], -s * ey[2] + c * ez[2]];
    ey = y;
  }
  return { R: [ex, ey, ez], L };
}

type Props = { E: number; G: number; A: number; Asy: number; Asz: number; J: number; Iy: number; Iz: number };

/** A beam's 12×12 stiffness in local axes (Timoshenko; a truss keeps only its axial term). */
function beamStiffness(p: Props, L: number, truss: boolean): Mat {
  const k = zeros(12, 12);
  const ea = (p.E * p.A) / L;
  k[0][0] = k[6][6] = ea;
  k[0][6] = k[6][0] = -ea;
  if (truss) return k;
  const gj = (p.G * p.J) / L;
  k[3][3] = k[9][9] = gj;
  k[3][9] = k[9][3] = -gj;
  // Bending in the x–y plane (v, θz), about z.
  {
    const EI = p.E * p.Iz;
    const phi = p.Asy > 0 ? (12 * EI) / (p.G * p.Asy * L * L) : 0;
    const a = (12 * EI) / ((1 + phi) * L ** 3);
    const b = (6 * EI) / ((1 + phi) * L ** 2);
    const c = ((4 + phi) * EI) / ((1 + phi) * L);
    const d = ((2 - phi) * EI) / ((1 + phi) * L);
    const ix = [1, 5, 7, 11];
    const m = [
      [a, b, -a, b],
      [b, c, -b, d],
      [-a, -b, a, -b],
      [b, d, -b, c],
    ];
    for (let r = 0; r < 4; r++) for (let s = 0; s < 4; s++) k[ix[r]][ix[s]] = m[r][s];
  }
  // Bending in the x–z plane (w, θy), about y: θy = −dw/dx, so the coupling terms change sign.
  {
    const EI = p.E * p.Iy;
    const phi = p.Asz > 0 ? (12 * EI) / (p.G * p.Asz * L * L) : 0;
    const a = (12 * EI) / ((1 + phi) * L ** 3);
    const b = (6 * EI) / ((1 + phi) * L ** 2);
    const c = ((4 + phi) * EI) / ((1 + phi) * L);
    const d = ((2 - phi) * EI) / ((1 + phi) * L);
    const ix = [2, 4, 8, 10];
    const m = [
      [a, -b, -a, -b],
      [-b, c, b, d],
      [-a, b, a, b],
      [-b, d, b, c],
    ];
    for (let r = 0; r < 4; r++) for (let s = 0; s < 4; s++) k[ix[r]][ix[s]] = m[r][s];
  }
  return k;
}

/**
 * Fixed-end forces of a beam in one plane, by the force method on the cantilever (so shear
 * deformation is counted): the forces the fixed ends put on the beam, [R1, M1, R2, M2], for a
 * uniform load q and point loads P at a, all in +v, with θ = dv/dx.
 */
function fixedEndPlane(EI: number, GAs: number, L: number, q: number, points: { P: number; a: number }[]): [number, number, number, number] {
  const sh = GAs > 0 ? 1 / GAs : 0;
  let delta = (q * L ** 4) / (8 * EI) + (q * L * L * sh) / 2;
  let theta = (q * L ** 3) / (6 * EI);
  let total = q * L;
  let moment = (q * L * L) / 2;
  for (const { P, a } of points) {
    delta += (P * a * a * (3 * L - a)) / (6 * EI) + P * a * sh;
    theta += (P * a * a) / (2 * EI);
    total += P;
    moment += P * a;
  }
  // Tip flexibility: δ = R·(L³/3EI + L/GAs) + M·L²/2EI, θ = R·L²/2EI + M·L/EI.
  const f11 = L ** 3 / (3 * EI) + L * sh;
  const f12 = (L * L) / (2 * EI);
  const f22 = L / EI;
  const det = f11 * f22 - f12 * f12;
  const R2 = (-delta * f22 + theta * f12) / det;
  const M2 = (delta * f12 - theta * f11) / det;
  const R1 = -total - R2;
  const M1 = -M2 - R2 * L - moment;
  return [R1, M1, R2, M2];
}

type ElementLoad = { q: Vec3; points: { P: Vec3; a: number }[] }; // local components

/** A beam's fixed-end forces (12, local): what its ends would carry with every degree of freedom held. */
function fixedEnd(p: Props, L: number, load: ElementLoad, truss: boolean): number[] {
  const f = new Array<number>(12).fill(0);
  // Along the member.
  f[0] = (-load.q[0] * L) / 2;
  f[6] = (-load.q[0] * L) / 2;
  for (const pt of load.points) {
    f[0] -= (pt.P[0] * (L - pt.a)) / L;
    f[6] -= (pt.P[0] * pt.a) / L;
  }
  if (truss) {
    // A truss carries transverse load to its ends as a simple beam.
    for (const d of [1, 2]) {
      f[d] = (-load.q[d] * L) / 2;
      f[6 + d] = (-load.q[d] * L) / 2;
      for (const pt of load.points) {
        f[d] -= (pt.P[d] * (L - pt.a)) / L;
        f[6 + d] -= (pt.P[d] * pt.a) / L;
      }
    }
    return f;
  }
  const y = fixedEndPlane(p.E * p.Iz, p.G * p.Asy, L, load.q[1], load.points.map((pt) => ({ P: pt.P[1], a: pt.a })));
  f[1] = y[0];
  f[5] = y[1];
  f[7] = y[2];
  f[11] = y[3];
  const z = fixedEndPlane(p.E * p.Iy, p.G * p.Asz, L, load.q[2], load.points.map((pt) => ({ P: pt.P[2], a: pt.a })));
  f[2] = z[0];
  f[4] = -z[1];
  f[8] = z[2];
  f[10] = -z[3];
  return f;
}

/** Solves a small dense system (Gauss, partial pivoting). */
function solveDense(A: Mat, B: Mat): Mat {
  const n = A.length;
  const m = B[0]?.length ?? 0;
  const a = A.map((r, i) => [...r, ...B[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-300) throw new ModelError("A member is released at both ends in the same direction, so nothing holds it.");
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      if (f) for (let s = c; s < n + m; s++) a[r][s] -= f * a[c][s];
    }
  }
  return a.map((r, i) => r.slice(n).map((v) => v / a[i][i]));
}

/** A beam's stiffness with its released degrees of freedom condensed out, and the matrix that does the same to fixed-end forces. */
function condense(k: Mat, released: boolean[]): { k: Mat; fe: (f: number[]) => number[] } {
  const r = released.flatMap((v, i) => (v ? [i] : []));
  if (!r.length) return { k, fe: (f) => f };
  const c = released.flatMap((v, i) => (v ? [] : [i]));
  const krr = r.map((i) => r.map((j) => k[i][j]));
  const krc = r.map((i) => c.map((j) => k[i][j]));
  const X = solveDense(krr, krc); // krr⁻¹·krc
  const out = zeros(12, 12);
  c.forEach((i) =>
    c.forEach((j, b) => {
      let v = k[i][j];
      r.forEach((ri, t) => (v -= k[i][ri] * X[t][b]));
      out[i][j] = v;
    }),
  );
  const fe = (f: number[]) => {
    const y = solveDense(krr, r.map((i) => [f[i]])).map((row) => row[0]); // krr⁻¹·f_r
    const g = new Array<number>(12).fill(0);
    c.forEach((i) => {
      let v = f[i];
      r.forEach((ri, t) => (v -= k[i][ri] * y[t]));
      g[i] = v;
    });
    return g;
  };
  return { k: out, fe };
}

/** Tᵀ·k·T for a 12×12 matrix, T made of the 3×3 rotation R four times. */
function toGlobal(k: Mat, R: [Vec3, Vec3, Vec3]): Mat {
  const kt = zeros(12, 12); // k·T
  for (let i = 0; i < 12; i++)
    for (let b = 0; b < 4; b++)
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let m = 0; m < 3; m++) v += k[i][3 * b + m] * R[m][c];
        kt[i][3 * b + c] = v;
      }
  const out = zeros(12, 12);
  for (let b = 0; b < 4; b++)
    for (let c = 0; c < 3; c++)
      for (let j = 0; j < 12; j++) {
        let v = 0;
        for (let m = 0; m < 3; m++) v += R[m][c] * kt[3 * b + m][j];
        out[3 * b + c][j] = v;
      }
  return out;
}
const rotate = (R: [Vec3, Vec3, Vec3], v: number[], transpose: boolean) => {
  const out = new Array<number>(v.length).fill(0);
  for (let b = 0; b < v.length / 3; b++)
    for (let i = 0; i < 3; i++) {
      let s = 0;
      for (let m = 0; m < 3; m++) s += (transpose ? R[m][i] : R[i][m]) * v[3 * b + m];
      out[3 * b + i] = s;
    }
  return out;
};

/** An elastic link's stiffness in global axes: six springs at mid-length between rigid arms to the two nodes. */
function linkStiffness(k: Dof6<number>, R: [Vec3, Vec3, Vec3], L: number): Mat {
  // Relative movement at the spring, in local axes: Δ = A2·d2 − A1·d1, a node's movement carried
  // along its arm r (u + θ × r), r1 = (L/2, 0, 0), r2 = (−L/2, 0, 0).
  const B = zeros(6, 12);
  const arm = (col: number, r: number, sign: number) => {
    for (let i = 0; i < 6; i++) B[i][col + i] = sign;
    // θ × r with r = (r, 0, 0): (0, θz·r, −θy·r)
    B[1][col + 5] = sign * r;
    B[2][col + 4] = -sign * r;
  };
  arm(0, L / 2, -1);
  arm(6, -L / 2, 1);
  const local = zeros(12, 12);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) for (let s = 0; s < 6; s++) local[i][j] += B[s][i] * k[s] * B[s][j];
  return toGlobal(local, R);
}

// --- the skyline matrix -------------------------------------------------------------------------

class Skyline {
  readonly first: Int32Array; // each column's first stored row
  readonly start: Int32Array; // where each column starts in `v`
  v: Float64Array;
  d: Float64Array;
  constructor(readonly n: number, first: Int32Array) {
    this.first = first;
    this.start = new Int32Array(n + 1);
    for (let j = 0; j < n; j++) this.start[j + 1] = this.start[j] + (j - first[j]);
    this.v = new Float64Array(this.start[n]);
    this.d = new Float64Array(n);
  }
  add(i: number, j: number, x: number) {
    if (i === j) this.d[i] += x;
    else if (i < j) this.v[this.start[j] + i - this.first[j]] += x;
  }
  /** L·D·Lᵀ in place. Returns the column whose pivot vanished, or −1. */
  factor(tolerance: Float64Array): number {
    const { n, first, start, v, d } = this;
    for (let j = 0; j < n; j++) {
      const mj = first[j];
      const cj = start[j] - mj;
      for (let i = mj + 1; i < j; i++) {
        const mi = first[i];
        const ci = start[i] - mi;
        let s = 0;
        for (let r = Math.max(mi, mj); r < i; r++) s += v[ci + r] * v[cj + r];
        v[cj + i] -= s;
      }
      let dj = d[j];
      for (let i = mj; i < j; i++) {
        const g = v[cj + i];
        const l = g / d[i];
        dj -= l * g;
        v[cj + i] = l;
      }
      if (!(dj > tolerance[j])) return j;
      d[j] = dj;
    }
    return -1;
  }
  solve(b: Float64Array) {
    const { n, first, start, v, d } = this;
    for (let j = 0; j < n; j++) {
      const cj = start[j] - first[j];
      let s = b[j];
      for (let i = first[j]; i < j; i++) s -= v[cj + i] * b[i];
      b[j] = s;
    }
    for (let j = 0; j < n; j++) b[j] /= d[j];
    for (let j = n - 1; j >= 0; j--) {
      const cj = start[j] - first[j];
      const x = b[j];
      if (x) for (let i = first[j]; i < j; i++) b[i] -= v[cj + i] * x;
    }
  }
}

/** Reverse Cuthill–McKee: an order of the nodes that keeps connected ones close. */
function rcm(n: number, pairs: [number, number][]): number[] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of pairs)
    if (a !== b) {
      adj[a].push(b);
      adj[b].push(a);
    }
  const deg = adj.map((a) => a.length);
  const seen = new Uint8Array(n);
  const order: number[] = [];
  const byDegree = [...Array(n).keys()].sort((a, b) => deg[a] - deg[b]);
  for (const s of byDegree) {
    if (seen[s]) continue;
    seen[s] = 1;
    const queue = [s];
    for (let q = 0; q < queue.length; q++) {
      const u = queue[q];
      order.push(u);
      const next = adj[u].filter((w) => !seen[w]).sort((a, b) => deg[a] - deg[b]);
      for (const w of next)
        if (!seen[w]) {
          seen[w] = 1;
          queue.push(w);
        }
    }
  }
  return order.reverse();
}

// --- analysis -----------------------------------------------------------------------------------

export type CaseResult = {
  name: string;
  /** Per node (in the model's order): the six displacements, global. */
  displacements: Dof6<number>[];
  /** Per support: the six reactions, global (0 where it isn't fixed). */
  reactions: { node: number; R: Dof6<number> }[];
  /** Per spring: the force the spring puts on the structure, global. */
  springForces: { node: number; R: Dof6<number> }[];
  /** Per element (in the model's order): the twelve end forces, local, on the element. */
  endForces: number[][];
  /** Per link: the force in each of its six springs, local (along x: tension +, compression −). */
  linkForces: number[][];
  /** Applied load and reactions summed (forces, global), and the largest unbalanced force left at a free node. */
  equilibrium: { applied: Vec3; reactions: Vec3; residual: number };
};

export type Analysis = {
  model: Model;
  cases: CaseResult[];
  /** Degrees of freedom nothing is attached to (held automatically), as "node Dof". */
  held: string[];
  /** Internal forces of an element at t (0 to 1) along it, in a load case. */
  forcesAt: (caseIndex: number, elementIndex: number, t: number) => SectionForces;
  /** An element's length. */
  lengthOf: (elementIndex: number) => number;
  /** A set of loads solved for a few results (influence values): per element (by index) its internal forces at both ends, per link its three forces, per node (by index) its vertical displacement. */
  respond: (loads: Load[], want: { elements: number[]; links: number[]; nodes?: number[] }) => Float32Array;
};

export type SectionForces = { N: number; Vy: number; Vz: number; T: number; My: number; Mz: number };

const localLoad = (R: [Vec3, Vec3, Vec3], dir: Direction, value: number): Vec3 => {
  if (dir === "LX") return [value, 0, 0];
  if (dir === "LY") return [0, value, 0];
  if (dir === "LZ") return [0, 0, value];
  const g = dir === "GX" ? 0 : dir === "GY" ? 1 : 2;
  return [R[0][g] * value, R[1][g] * value, R[2][g] * value];
};

export function analyze(model: Model): Analysis {
  const { nodes, elements } = model;
  if (!nodes.length || !elements.length) throw new ModelError("The model has no members.");
  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const at = (id: number, what: string) => {
    const i = nodeIndex.get(id);
    if (i === undefined) throw new ModelError(`${what} refers to node ${id}, which isn't in the model.`);
    return i;
  };
  const mat = new Map(model.materials.map((m) => [m.id, m]));
  const sec = new Map(model.sections.map((s) => [s.id, s]));
  const pos = (i: number): Vec3 => [nodes[i].x, nodes[i].y, nodes[i].z];

  // Elements: local axes, stiffness (releases condensed), global stiffness.
  const el = elements.map((e) => {
    const a = at(e.n1, `Element ${e.id}`);
    const b = at(e.n2, `Element ${e.id}`);
    const m = mat.get(e.mat);
    const s = sec.get(e.sec);
    if (!m || !s) throw new ModelError(`Element ${e.id} has no ${m ? "section" : "material"}.`);
    const { R, L } = localAxes(pos(a), pos(b), e.angle);
    if (L < 1e-9) throw new ModelError(`Element ${e.id} has no length: its two nodes are at the same point.`);
    const p: Props = { E: m.E, G: m.G, A: s.A, Asy: s.Asy, Asz: s.Asz, J: s.J, Iy: s.Iy, Iz: s.Iz };
    const truss = e.type === "truss";
    const full = beamStiffness(p, L, truss);
    const released = e.releases ? [...e.releases.i, ...e.releases.j] : [];
    const cond = condense(full, released.length ? released : new Array<boolean>(12).fill(false));
    return { a, b, R, L, p, truss, k: cond.k, fe: cond.fe, kg: toGlobal(cond.k, R), density: m.density };
  });
  const links = model.links.map((l) => {
    const a = at(l.n1, `Link ${l.id}`);
    const b = at(l.n2, `Link ${l.id}`);
    const { R, L } = localAxes(pos(a), pos(b), l.angle);
    return { a, b, R, L, k: l.k, kg: linkStiffness(l.k, R, L) };
  });

  // Degrees of freedom: nodes in RCM order, six each, the fixed ones left out.
  const order = rcm(nodes.length, [...el.map((e) => [e.a, e.b] as [number, number]), ...links.map((l) => [l.a, l.b] as [number, number])]);
  const fixed = new Uint8Array(nodes.length * 6);
  for (const s of model.supports) {
    const i = at(s.node, "A support");
    s.fixed.forEach((f, d) => f && (fixed[6 * i + d] = 1));
  }
  const eq = new Int32Array(nodes.length * 6).fill(-1);
  let n = 0;
  for (const i of order) for (let d = 0; d < 6; d++) if (!fixed[6 * i + d]) eq[6 * i + d] = n++;
  const dofs = (a: number, b: number) => [0, 1, 2, 3, 4, 5].map((d) => 6 * a + d).concat([0, 1, 2, 3, 4, 5].map((d) => 6 * b + d));

  const first = new Int32Array(n);
  for (let j = 0; j < n; j++) first[j] = j;
  const reach = (list: number[]) => {
    let lo = n;
    for (const g of list) if (eq[g] >= 0 && eq[g] < lo) lo = eq[g];
    for (const g of list) if (eq[g] >= 0 && lo < first[eq[g]]) first[eq[g]] = lo;
  };
  for (const e of el) reach(dofs(e.a, e.b));
  for (const l of links) reach(dofs(l.a, l.b));
  const K = new Skyline(n, first);
  const assemble = (list: number[], kg: Mat) => {
    for (let i = 0; i < 12; i++) {
      const r = eq[list[i]];
      if (r < 0) continue;
      for (let j = 0; j < 12; j++) {
        const c = eq[list[j]];
        if (c >= r) K.add(r, c, kg[i][j]);
      }
    }
  };
  for (const e of el) assemble(dofs(e.a, e.b), e.kg);
  for (const l of links) assemble(dofs(l.a, l.b), l.kg);
  const springs = model.springs.map((s) => ({ i: at(s.node, "A spring"), k: s.k }));
  for (const s of springs) s.k.forEach((k, d) => eq[6 * s.i + d] >= 0 && K.add(eq[6 * s.i + d], eq[6 * s.i + d], k));

  // A degree of freedom with no stiffness at all (a truss node's rotation, say) is held; a pivot
  // that vanishes during the factoring is a mechanism.
  const label = new Array<string>(n);
  for (let i = 0; i < nodes.length; i++) for (let d = 0; d < 6; d++) if (eq[6 * i + d] >= 0) label[eq[6 * i + d]] = `${nodes[i].id} ${DOF_NAMES[d]}`;
  let big = 0;
  for (let j = 0; j < n; j++) big = Math.max(big, K.d[j]);
  const held: string[] = [];
  const tolerance = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    if (K.d[j] <= big * 1e-14) {
      K.d[j] = 1;
      held.push(label[j]);
    }
    tolerance[j] = K.d[j] * 1e-9;
  }
  const bad = K.factor(tolerance);
  if (bad >= 0) {
    const [node, dof] = label[bad].split(" ");
    throw new ModelError(`The model is unstable: nothing restrains node ${node} in ${dof} (a missing support, or members released so they can move freely).`);
  }

  // A set of loads solved: the displacements, and each loaded element's fixed-end forces.
  const elIndex = new Map(elements.map((e, i) => [e.id, i]));
  const solveLoads = (own: Load[]) => {
    const nodal = new Float64Array(nodes.length * 6); // applied at the nodes
    const onElement: (ElementLoad | undefined)[] = new Array(el.length);
    const applied: Vec3 = [0, 0, 0];
    for (const l of own) {
      if (l.kind === "nodal") {
        const i = at(l.node, "A load");
        l.F.forEach((f, d) => (nodal[6 * i + d] += f));
        for (let d = 0; d < 3; d++) applied[d] += l.F[d];
        continue;
      }
      const k = elIndex.get(l.element);
      if (k === undefined) throw new ModelError(`A load is on element ${l.element}, which isn't in the model.`);
      const e = el[k];
      const cur = (onElement[k] ??= { q: [0, 0, 0], points: [] });
      const value = l.kind === "uniform" ? l.w : l.P;
      const loc = localLoad(e.R, l.dir, value);
      const glob = rotate(e.R, loc, true);
      if (l.kind === "uniform") {
        for (let d = 0; d < 3; d++) cur.q[d] += loc[d];
        for (let d = 0; d < 3; d++) applied[d] += glob[d] * e.L;
      } else {
        if (l.a < -1e-9 || l.a > e.L + 1e-9) throw new ModelError(`A point load on element ${l.element} is beyond its length.`);
        cur.points.push({ P: loc, a: Math.min(Math.max(l.a, 0), e.L) });
        for (let d = 0; d < 3; d++) applied[d] += glob[d];
      }
    }
    // Fixed-end forces (local, releases condensed), and the load vector.
    const fe: (number[] | null)[] = el.map((e, k) => (onElement[k] ? e.fe(fixedEnd(e.p, e.L, onElement[k]!, e.truss)) : null));
    const F = new Float64Array(n);
    for (let g = 0; g < nodal.length; g++) if (eq[g] >= 0) F[eq[g]] += nodal[g];
    el.forEach((e, k) => {
      if (!fe[k]) return;
      const g = rotate(e.R, fe[k]!, true);
      const list = dofs(e.a, e.b);
      for (let i = 0; i < 12; i++) if (eq[list[i]] >= 0) F[eq[list[i]]] -= g[i];
    });
    K.solve(F);
    const u = new Float64Array(nodes.length * 6);
    for (let g = 0; g < u.length; g++) if (eq[g] >= 0) u[g] = F[eq[g]];
    return { u, fe, nodal, onElement, applied };
  };
  /** An element's twelve end forces (local, on the element) for a solution. */
  const endForceOf = (k: number, u: Float64Array, fe: (number[] | null)[]) => {
    const e = el[k];
    const list = dofs(e.a, e.b);
    const ul = rotate(e.R, list.map((g) => u[g]), false);
    const f = new Array<number>(12).fill(0);
    for (let i = 0; i < 12; i++) {
      let s = fe[k]?.[i] ?? 0;
      for (let j = 0; j < 12; j++) s += e.k[i][j] * ul[j];
      f[i] = s;
    }
    return f;
  };
  /** A link's six spring forces (local) for a solution. */
  const linkForceOf = (i: number, u: Float64Array) => {
    const l = links[i];
    const ul = rotate(l.R, dofs(l.a, l.b).map((g) => u[g]), false);
    const r = l.L / 2;
    // Δ = (u2 + θ2 × r2) − (u1 + θ1 × r1), in local axes.
    const delta = [ul[6] - ul[0], ul[7] - r * ul[11] - (ul[1] + r * ul[5]), ul[8] + r * ul[10] - (ul[2] - r * ul[4]), ul[9] - ul[3], ul[10] - ul[4], ul[11] - ul[5]];
    return delta.map((v, s) => v * l.k[s]);
  };

  const cases = model.loadCases.map((lc) => {
    const { u, fe, nodal, onElement, applied } = solveLoads(model.loads.filter((l) => l.case === lc.name));
    // Element end forces, and what the members put on each node.
    const internal = new Float64Array(nodes.length * 6);
    const endForces = el.map((e, k) => {
      const f = endForceOf(k, u, fe);
      const g = rotate(e.R, f, true);
      const list = dofs(e.a, e.b);
      for (let i = 0; i < 12; i++) internal[list[i]] += g[i];
      return f;
    });
    const linkForces = links.map((l, i) => {
      const list = dofs(l.a, l.b);
      const ug = list.map((g) => u[g]);
      for (let a = 0; a < 12; a++) {
        let s = 0;
        for (let j = 0; j < 12; j++) s += l.kg[a][j] * ug[j];
        internal[list[a]] += s;
      }
      return linkForceOf(i, u);
    });
    const springForces = springs.map((s) => {
      const R = s.k.map((k, d) => -k * u[6 * s.i + d]) as Dof6<number>;
      return { node: nodes[s.i].id, R };
    });
    for (const s of springs) s.k.forEach((k, d) => (internal[6 * s.i + d] += k * u[6 * s.i + d]));
    const reactions = model.supports.map((s) => {
      const i = nodeIndex.get(s.node)!;
      const R = [0, 1, 2, 3, 4, 5].map((d) => (s.fixed[d] ? internal[6 * i + d] - nodal[6 * i + d] : 0)) as Dof6<number>;
      return { node: s.node, R };
    });
    const sum: Vec3 = [0, 0, 0];
    for (const r of reactions) for (let d = 0; d < 3; d++) sum[d] += r.R[d];
    for (const r of springForces) for (let d = 0; d < 3; d++) sum[d] += r.R[d];
    let residual = 0;
    for (let g = 0; g < internal.length; g++) if (eq[g] >= 0) residual = Math.max(residual, Math.abs(internal[g] - nodal[g]));
    const displacements = nodes.map((_, i) => [0, 1, 2, 3, 4, 5].map((d) => u[6 * i + d]) as Dof6<number>);
    return { result: { name: lc.name, displacements, reactions, springForces, endForces, linkForces, equilibrium: { applied, reactions: sum, residual } } as CaseResult, onElement };
  });

  // Influence values: a set of loads solved for a few results only (no load case kept). For each
  // element asked for, its internal forces at both ends (N, Vy, Vz, T, My, Mz at the first node,
  // then at the second, in forcesAt's signs); then each link's three forces (local x, y, z); then
  // each node's vertical displacement.
  const respond = (own: Load[], want: { elements: number[]; links: number[]; nodes?: number[] }): Float32Array => {
    const { u, fe } = solveLoads(own);
    const out = new Float32Array(12 * want.elements.length + 3 * want.links.length + (want.nodes?.length ?? 0));
    let o = 0;
    for (const k of want.elements) {
      const f = endForceOf(k, u, fe);
      out[o++] = -f[0];
      out[o++] = f[1];
      out[o++] = f[2];
      out[o++] = -f[3];
      out[o++] = f[4];
      out[o++] = -f[5];
      out[o++] = f[6];
      out[o++] = -f[7];
      out[o++] = -f[8];
      out[o++] = f[9];
      out[o++] = -f[10];
      out[o++] = f[11];
    }
    for (const i of want.links) {
      const f = linkForceOf(i, u);
      out[o++] = f[0];
      out[o++] = f[1];
      out[o++] = f[2];
    }
    for (const i of want.nodes ?? []) out[o++] = u[6 * i + 2];
    return out;
  };

  const forcesAt = (c: number, k: number, t: number): SectionForces => {
    const e = el[k];
    const f = cases[c].result.endForces[k];
    const load = cases[c].onElement[k];
    const x = Math.min(Math.max(t, 0), 1) * e.L;
    // The loads on the part to the left of the section: their resultant, and their moment about the section.
    let px = 0, py = 0, pz = 0, my = 0, mz = 0;
    if (load) {
      px += load.q[0] * x;
      py += load.q[1] * x;
      pz += load.q[2] * x;
      my += (load.q[2] * x * x) / 2;
      mz += (load.q[1] * x * x) / 2;
      for (const p of load.points)
        if (p.a < x - 1e-12) {
          px += p.P[0];
          py += p.P[1];
          pz += p.P[2];
          my += p.P[2] * (x - p.a);
          mz += p.P[1] * (x - p.a);
        }
    }
    return {
      N: -(f[0] + px),
      Vy: f[1] + py,
      Vz: f[2] + pz,
      T: -f[3],
      My: f[4] + x * f[2] + my,
      Mz: -f[5] + x * f[1] + mz,
    };
  };
  return { model, cases: cases.map((c) => c.result), held, forcesAt, lengthOf: (k) => el[k].L, respond };
}

/** The element as a unit for tests and tools: its index in the model by id. */
export const elementIndex = (model: Model, id: number) => model.elements.findIndex((e: Element) => e.id === id);
