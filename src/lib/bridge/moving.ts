import type { Generated } from "./generate";
import type { Load } from "./model";
import type { Analysis, SectionForces } from "./solver";

// Moving load analysis of the bridge model for HL-93 (AASHTO LRFD 3.6.1), the way midas Civil does
// it with traffic line lanes: a unit axle is moved along each lane, its two wheels' loads spread
// to the girders beside them, and the model solved at every position, which gives the influence
// line of every result along every lane. Each result's worst loading is then found on its
// influence lines:
// - the design truck (8, 32, 32 kip; the rear axles 14 to 30 ft apart) or the tandem (two 25 kip
//   axles 4 ft apart), with the dynamic allowance, plus the lane load (0.64 klf) on the lengths
//   that add to the effect;
// - for negative moment between the points of contraflexure and for the reactions at interior
//   piers, also 90% of two trucks (rear axles at 14 ft, 50 ft apart or more) with 90% of the lane
//   load (3.6.1.3.1);
// - over the lanes loaded, with the multiple presence factor (3.6.1.1.2), for each arrangement of
//   the lanes across the roadway (against the left barrier, the right, and centered).
// Each maximum and minimum is kept with the other forces at that section under the same loading
// (the concurrent forces).

export const LANE_LOAD = 0.64; // klf
export const LANE_WIDTH = 12; // ft
export const WHEEL_GAUGE = 6; // ft
const REAR = [14, 18, 22, 26, 30];
const MPF = [1.2, 1.0, 0.85, 0.65];
export const multiplePresence = (lanes: number) => MPF[Math.min(lanes, 4) - 1];

export const COMPONENTS = ["N", "Vy", "Vz", "T", "My", "Mz"] as const;
type Axle = { x: number; P: number };

/** A loading found on one influence line: its value, and what made it (to work out the concurrent forces). */
export type Pattern = { value: number; axles: Axle[]; lane: 1 | -1 | 0; factor: number };

/** Influence ordinates on a grid of positions, with quick interpolation between them. */
export class Grid {
  readonly tributary: Float32Array;
  private readonly cell: Int32Array;
  private readonly bin: number;
  constructor(readonly x: number[]) {
    const n = x.length;
    this.tributary = new Float32Array(n);
    for (let j = 0; j < n; j++) this.tributary[j] = ((j < n - 1 ? x[j + 1] - x[j] : 0) + (j > 0 ? x[j] - x[j - 1] : 0)) / 2;
    this.bin = 0.5;
    const bins = Math.ceil((x[n - 1] - x[0]) / this.bin) + 1;
    this.cell = new Int32Array(bins);
    let j = 0;
    for (let b = 0; b < bins; b++) {
      const X = x[0] + b * this.bin;
      while (j < n - 2 && x[j + 1] <= X) j++;
      this.cell[b] = j;
    }
  }
  /** The ordinate at X (0 off the grid), from `eta` starting at `at`. */
  value(eta: Float32Array, at: number, X: number): number {
    const x = this.x;
    const n = x.length;
    if (X < x[0] - 1e-9 || X > x[n - 1] + 1e-9) return 0;
    let j = this.cell[Math.min(this.cell.length - 1, Math.max(0, Math.floor((X - x[0]) / this.bin)))];
    while (j < n - 2 && x[j + 1] < X) j++;
    const t = (X - x[j]) / (x[j + 1] - x[j]);
    return eta[at + j] * (1 - t) + eta[at + j + 1] * t;
  }
}

/**
 * The worst HL-93 loading of one lane on an influence line: sense +1 for the largest value, −1 for
 * the smallest. With `dual`, the two-truck loading of 3.6.1.3.1 is tried too.
 */
export function laneEffect(grid: Grid, eta: Float32Array, at: number, sense: 1 | -1, IM: number, dual: boolean): Pattern {
  const x = grid.x;
  const n = x.length;
  // The lane load, on the lengths that add to the effect.
  let lane = 0;
  for (let j = 0; j < n; j++) {
    const v = eta[at + j];
    if (sense * v > 0) lane += v * grid.tributary[j];
  }
  lane *= LANE_LOAD;
  const better = (a: number, b: number) => sense * a > sense * b;
  // The truck, each axle on each grid point, facing either way, its rear axles at each spacing; the tandem likewise.
  let best = 0;
  let bestAxles: Axle[] = [];
  for (let j = 0; j < n; j++) {
    if (sense * eta[at + j] <= 0) continue; // an axle at a point that adds to the effect
    for (const dir of [1, -1])
      for (const r of REAR) {
        const off = [0, -14 * dir, -(14 + r) * dir];
        for (let a = 0; a < 3; a++) {
          const front = x[j] - off[a];
          const v = 8 * grid.value(eta, at, front) + 32 * grid.value(eta, at, front + off[1]) + 32 * grid.value(eta, at, front + off[2]);
          if (better(v, best)) {
            best = v;
            bestAxles = [{ x: front, P: 8 }, { x: front + off[1], P: 32 }, { x: front + off[2], P: 32 }];
          }
        }
      }
    for (const other of [x[j] + 4, x[j] - 4]) {
      const v = 25 * (eta[at + j] + grid.value(eta, at, other));
      if (better(v, best)) {
        best = v;
        bestAxles = [{ x: x[j], P: 25 }, { x: other, P: 25 }];
      }
    }
  }
  let out: Pattern = { value: (1 + IM) * best + lane, axles: bestAxles, lane: sense, factor: 1 };
  if (dual) {
    // Two trucks, rear axles at 14 ft, the lead's rear axle 50 ft or more ahead of the follower's
    // front axle: their middle axles 78 ft apart or more. One pass with the best so far behind.
    for (const dir of [1, -1]) {
      const f = new Float64Array(n);
      for (let j = 0; j < n; j++) f[j] = 8 * grid.value(eta, at, x[j] + 14 * dir) + 32 * eta[at + j] + 32 * grid.value(eta, at, x[j] - 14 * dir);
      let behind = -1;
      let k = 0;
      for (let j = 0; j < n; j++) {
        while (k < n && x[k] <= x[j] - 78) {
          if (behind < 0 || better(f[k], f[behind])) behind = k;
          k++;
        }
        if (behind < 0) continue;
        const v = 0.9 * ((1 + IM) * (f[j] + f[behind]) + lane);
        if (better(v, out.value)) {
          const truck = (m: number): Axle[] => [{ x: x[m] + 14 * dir, P: 8 }, { x: x[m], P: 32 }, { x: x[m] - 14 * dir, P: 32 }];
          out = { value: v, axles: [...truck(j), ...truck(behind)], lane: sense, factor: 0.9 };
        }
      }
    }
  }
  return out;
}

/** Which lanes to load, of one arrangement, for the largest (or smallest) total with the multiple presence factor. */
export function loadedLanes(values: number[], sense: 1 | -1): { total: number; lanes: number[]; m: number } {
  const order = values.map((v, i) => ({ v: sense * v, i })).filter((a) => a.v > 0).sort((a, b) => b.v - a.v);
  let best = { total: 0, lanes: [] as number[], m: 1 };
  let sum = 0;
  order.forEach((a, k) => {
    sum += a.v;
    const m = multiplePresence(k + 1);
    if (m * sum > sense * best.total) best = { total: sense * m * sum, lanes: order.slice(0, k + 1).map((o) => o.i), m };
  });
  return best;
}

/** The design lanes across a roadway, as arrangements of truck centerlines (Y): against the left barrier, the right, and centered. */
export function laneArrangements(left: number, right: number): { lines: number[]; arrangements: number[][] } {
  const width = right - left;
  const count = Math.max(1, Math.floor(width / LANE_WIDTH + 1e-9));
  const lane = Math.min(LANE_WIDTH, width); // a roadway under 12 ft is one lane its own width
  const edge = Math.min(2 + WHEEL_GAUGE / 2, lane / 2); // the truck 2 ft clear of the lane's edge
  const sets = [
    Array.from({ length: count }, (_, i) => left + lane * i + edge),
    Array.from({ length: count }, (_, i) => right - lane * i - edge),
    Array.from({ length: count }, (_, i) => (left + right) / 2 - (lane * count) / 2 + lane * i + lane / 2),
  ];
  const lines: number[] = [];
  const arrangements = sets.map((set) =>
    set.map((y) => {
      let k = lines.findIndex((v) => Math.abs(v - y) < 1e-6);
      if (k < 0) k = lines.push(y) - 1;
      return k;
    }),
  );
  return { lines, arrangements };
}

export type Envelope = { value: number; concurrent: SectionForces };
export type LiveLoad = {
  IM: number;
  lanes: number[]; // each lane line's Y
  arrangements: number[][];
  positions: number[]; // along a lane from its start, ft
  /** LL+IM at an element's end (0: first node, 1: second) for a component: the largest and smallest, with the concurrent forces. Null where it isn't worked out. */
  at: (elementId: number, end: 0 | 1, component: keyof SectionForces) => { max: Envelope; min: Envelope } | null;
  /** A bearing's vertical reaction (compression +) under LL+IM. */
  bearing: (linkId: number) => { max: number; min: number };
  /** An influence line, for checks: the response at an element's end for a unit axle along a lane. */
  influence: (lane: number, elementId: number, end: 0 | 1, component: keyof SectionForces) => Float32Array;
};

const key = (c: keyof SectionForces) => COMPONENTS.indexOf(c);
const forces = (v: ArrayLike<number>, o: number): SectionForces => ({ N: v[o], Vy: v[o + 1], Vz: v[o + 2], T: v[o + 3], My: v[o + 4], Mz: v[o + 5] });

/**
 * The moving load analysis, in steps (so a page can keep responding): yields its progress (0 to 1)
 * and returns the live load results. `stage2` is the composite model's analysis.
 */
export function* movingLoadSteps(g: Generated, stage2: Analysis, opts: { IM?: number; step?: number } = {}): Generator<number, LiveLoad, void> {
  const IM = opts.IM ?? 0.33;
  const model = stage2.model;
  const { girderY, roadway, tan, girderElement } = g.layout;
  const total = g.stations[g.stations.length - 1];
  const nS = g.stations.length;
  const { lines, arrangements } = laneArrangements(roadway[0], roadway[1]);

  // Positions along a lane: the stations (where the influence lines turn) and points between.
  const step = opts.step ?? Math.max(2, Math.min(4, total / 60));
  const set = new Set<number>(g.stations.map((v) => +v.toFixed(4)));
  for (let k = 0; k <= Math.ceil(total / step); k++) set.add(+Math.min(total, k * step).toFixed(4));
  const positions = [...set].sort((a, b) => a - b).filter((v, k, a) => k === 0 || v - a[k - 1] > 0.25 || g.stations.some((s) => Math.abs(s - v) < 1e-3));
  const grid = new Grid(positions);
  const P = positions.length;

  // What is followed: every girder element and the piers' members (both ends, six forces), and every bearing.
  const index = new Map(model.elements.map((e, i) => [e.id, i]));
  const followed = model.elements.filter((e) => e.sec <= 3 || e.sec === 30 || e.sec === 31);
  const isGirder = followed.map((e) => e.sec <= 3);
  const want = { elements: followed.map((e) => index.get(e.id)!), links: model.links.map((_, i) => i) };
  const E = followed.length;
  const R = 12 * E + 3 * model.links.length;

  /** A wheel's load on the girders beside it (the lever rule; beyond the outside girder, carried on with its couple). */
  const wheel = (X: number, y: number, load: number): Load[] => {
    let k = 0;
    while (k < girderY.length - 2 && girderY[k + 1] <= y) k++;
    const t = (y - girderY[k]) / (girderY[k + 1] - girderY[k]);
    const out: Load[] = [];
    for (const [gk, share] of [[k, 1 - t], [k + 1, t]] as const) {
      if (Math.abs(share) < 1e-9) continue;
      const s = X - girderY[gk] * tan; // along this girder from its first support
      if (s < -1e-9 || s > total + 1e-9) continue;
      let st = 0;
      while (st < nS - 2 && g.stations[st + 1] <= s) st++;
      out.push({ case: "", kind: "point", element: girderElement(gk, st), dir: "GZ", P: -load * share, a: Math.min(Math.max(s - g.stations[st], 0), g.stations[st + 1] - g.stations[st]) });
    }
    return out;
  };

  // The influence lines: eta[lane][response × P + position].
  const eta = lines.map(() => new Float32Array(R * P));
  for (let l = 0; l < lines.length; l++) {
    for (let j = 0; j < P; j++) {
      const X = positions[j] + lines[l] * tan;
      const r = stage2.respond([...wheel(X, lines[l] - WHEEL_GAUGE / 2, 0.5), ...wheel(X, lines[l] + WHEEL_GAUGE / 2, 0.5)], want);
      for (let q = 0; q < R; q++) eta[l][q * P + j] = r[q];
    }
    yield (0.6 * (l + 1)) / lines.length;
  }

  // Where the two-truck loading applies to a girder's negative moment: where a uniform load on
  // every span bends it hogging (the barriers' case is one), and at interior piers' bearings.
  const uniformCase = model.loadCases.findIndex((c) => c.name === "Barriers" || c.name === "Wearing surface");
  const hogging = (k: number, end: 0 | 1) => uniformCase >= 0 && stage2.forcesAt(uniformCase, want.elements[k], end).My < 0;
  const pierLinks = new Set(g.bearings.filter((b) => b.support > 1 && b.support < g.supportStations.length).map((b) => b.link));
  const multiSpan = g.supportStations.length > 2;

  /** The worst loading of a response over the lanes, of the arrangement that gives the most. */
  const worst = (q: number, sense: 1 | -1, dual: boolean) => {
    const patterns = lines.map((_, l) => laneEffect(grid, eta[l], q * P, sense, IM, dual));
    let best = { total: 0, lanes: [] as number[], m: 1 };
    for (const arr of arrangements) {
      const pick = loadedLanes(arr.map((l) => patterns[l].value), sense);
      if (sense * pick.total > sense * best.total) best = { total: pick.total, lanes: pick.lanes.map((i) => arr[i]), m: pick.m };
    }
    return { value: best.total, lanes: best.lanes.map((l) => ({ l, pattern: patterns[l] })), m: best.m, q };
  };
  /** Another response under a loading found for response `w.q`. */
  const concurrent = (w: ReturnType<typeof worst>, q: number) => {
    let sum = 0;
    for (const { l, pattern } of w.lanes) {
      let v = 0;
      for (const a of pattern.axles) v += a.P * grid.value(eta[l], q * P, a.x);
      v *= 1 + IM;
      if (pattern.lane) {
        let lane = 0;
        const primary = w.q * P;
        for (let j = 0; j < P; j++) if (pattern.lane * eta[l][primary + j] > 0) lane += eta[l][q * P + j] * grid.tributary[j];
        v += LANE_LOAD * lane;
      }
      sum += w.m * pattern.factor * v;
    }
    return sum;
  };

  // Envelopes: per element end, per component, max and min, each with its six concurrent forces.
  const env = new Float32Array(E * 2 * 6 * 2 * 6).fill(NaN);
  const girderComponents = [2, 3, 4]; // Vz, T, My
  for (let k = 0; k < E; k++) {
    for (const end of [0, 1] as const) {
      const base = 12 * k + 6 * end;
      for (const c of isGirder[k] ? girderComponents : [0, 1, 2, 3, 4, 5])
        for (const [si, sense] of [[0, 1], [1, -1]] as const) {
          const dual = multiSpan && ((isGirder[k] && c === 4 && sense === -1 && hogging(k, end)) || (!isGirder[k] && c === 0 && sense === -1));
          const w = worst(base + c, sense, dual);
          const o = ((k * 2 + end) * 6 + c) * 12 + si * 6;
          for (let cc = 0; cc < 6; cc++) env[o + cc] = cc === c ? w.value : concurrent(w, base + cc);
        }
    }
    if (k % 8 === 7) yield 0.6 + (0.38 * (k + 1)) / E;
  }
  const followedIndex = new Map(followed.map((e, k) => [e.id, k]));
  const bearings = new Map<number, { max: number; min: number }>();
  model.links.forEach((link, i) => {
    const q = 12 * E + 3 * i; // the link's axial force: compression −
    const dual = multiSpan && pierLinks.has(link.id);
    bearings.set(link.id, { max: -worst(q, -1, dual).value, min: -worst(q, 1, false).value });
  });
  yield 1;

  return {
    IM,
    lanes: lines,
    arrangements,
    positions,
    at: (id, end, component) => {
      const k = followedIndex.get(id);
      if (k === undefined) return null;
      const o = ((k * 2 + end) * 6 + key(component)) * 12;
      if (Number.isNaN(env[o])) return null;
      return { max: { value: env[o + key(component)], concurrent: forces(env, o) }, min: { value: env[o + 6 + key(component)], concurrent: forces(env, o + 6) } };
    },
    bearing: (id) => bearings.get(id) ?? { max: 0, min: 0 },
    influence: (lane, id, end, component) => {
      const q = 12 * followedIndex.get(id)! + 6 * end + key(component);
      return eta[lane].subarray(q * P, (q + 1) * P);
    },
  };
}

/** The moving load analysis, straight through. */
export function movingLoad(g: Generated, stage2: Analysis, opts?: { IM?: number; step?: number }): LiveLoad {
  const it = movingLoadSteps(g, stage2, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
