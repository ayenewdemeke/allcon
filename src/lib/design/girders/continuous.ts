import { DesignError } from "../walls/cip";

// A continuous beam on knife-edge supports with a uniform EI, for the girders of a bridge made
// continuous (LRFD 5.12.3.3). Supports are numbered 0..n (0 and n the abutments), spans 0..n−1; span k
// runs from support k to support k+1. Lengths in ft, forces in kip, moments in kip·ft (sagging +).
//
// Support moments come from the three-moment equation (Clapeyron). For each interior support k,
//   L(k−1)·M(k−1) + 2·(L(k−1) + L(k))·M(k) + L(k)·M(k+1) = −6·(EIθR(k−1) + EIθL(k)),
// where EIθL and EIθR are the end rotations of span k as a simple beam (positive for sagging), times
// EI. For a point load P at a from the span's left end (b = L − a): EIθL = P·a·b·(L + b)/(6L) and
// EIθR = P·a·b·(L + a)/(6L); for a uniform load w, w·L³/24 at each end.

export type EndRotations = { left: number; right: number }; // EI·θ, kip·ft²

/** HL-93 axles (kip, ft from the first axle). */
type Axle = { P: number; d: number };
const truck = (rear: number): Axle[] => [
  { P: 8, d: 0 },
  { P: 32, d: 14 },
  { P: 32, d: 14 + rear },
];
const TANDEM: Axle[] = [
  { P: 25, d: 0 },
  { P: 25, d: 4 },
];
const LANE = 0.64; // klf
const REAR = [14, 16, 18, 20, 22, 24, 26, 28, 30]; // ft, the truck's variable axle spacing (3.6.1.2.2)

export type LiveEnvelope = {
  /** Per lane, with IM on the truck and tandem: the most positive and most negative moment, the largest shear. */
  Mpos: number;
  Mneg: number;
  V: number;
  /** What governs the negative moment. */
  negGoverns: "truck or tandem with the lane" | "90% of two trucks with the lane (3.6.1.3.1)" | "none";
  /** The fatigue truck (3.6.1.4.1: one design truck, its rear axles 30 ft apart), per lane, without IM. */
  fatPos: number;
  fatNeg: number;
};

export type ContinuousBeam = ReturnType<typeof continuousBeam>;

export function continuousBeam(spans: number[]) {
  const n = spans.length;
  if (n < 1 || spans.some((L) => !(L > 0))) throw new DesignError("Every span needs a length.");
  const starts: number[] = [];
  let acc = 0;
  for (const L of spans) {
    starts.push(acc);
    acc += L;
  }
  const total = acc;

  // G = A⁻¹ for the interior supports 1..n−1 (a small dense matrix).
  const m = n - 1;
  const A = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let r = 0; r < m; r++) {
    const k = r + 1; // support
    A[r][r] = 2 * (spans[k - 1] + spans[k]);
    if (r > 0) A[r][r - 1] = spans[k - 1];
    if (r < m - 1) A[r][r + 1] = spans[k];
  }
  const G = invert(A);

  /** Support moments 0..n (kip·ft) from each span's simple-beam end rotations (EIθ). */
  function supportMoments(rot: EndRotations[]): number[] {
    const out = new Array<number>(n + 1).fill(0);
    if (m === 0) return out;
    const rhs = Array.from({ length: m }, (_, r) => -6 * (rot[r].right + rot[r + 1].left));
    for (let r = 0; r < m; r++) {
      let s = 0;
      for (let c = 0; c < m; c++) s += G[r][c] * rhs[c];
      out[r + 1] = s;
    }
    return out;
  }

  /** Which span a global position X lies in, and where in it. */
  function locate(X: number): { j: number; a: number } | null {
    if (X < -1e-9 || X > total + 1e-9) return null;
    for (let j = n - 1; j >= 0; j--) if (X >= starts[j] - 1e-9) return { j, a: Math.min(spans[j], Math.max(0, X - starts[j])) };
    return { j: 0, a: 0 };
  }

  // Influence lines of each interior support's moment, on a fine grid in every span (cubic and smooth
  // within a span, so linear interpolation on 400 cells is close to exact).
  const N = 400;
  const supportIL: number[][][] = []; // [support][span][k]
  for (let k = 0; k <= n; k++) supportIL.push(spans.map(() => new Array<number>(N + 1).fill(0)));
  if (m > 0) {
    for (let j = 0; j < n; j++) {
      const L = spans[j];
      for (let q = 0; q <= N; q++) {
        const a = (q / N) * L;
        const b = L - a;
        const tL = (a * b * (L + b)) / (6 * L);
        const tR = (a * b * (L + a)) / (6 * L);
        // Only span j is loaded: support j sees its left rotation, support j+1 its right.
        for (let r = 0; r < m; r++) {
          const gl = j >= 1 && j <= m ? G[r][j - 1] : 0; // support j is row j−1
          const gr = j + 1 <= m ? G[r][j] : 0; // support j+1 is row j
          supportIL[r + 1][j][q] = -6 * (gl * tL + gr * tR);
        }
      }
    }
  }
  const supportAt = (k: number, X: number) => {
    if (k === 0 || k === n) return 0;
    const p = locate(X);
    if (!p) return 0;
    const t = (p.a / spans[p.j]) * N;
    const q = Math.min(N - 1, Math.floor(t));
    const f = t - q;
    const g = supportIL[k][p.j];
    return g[q] * (1 - f) + g[q + 1] * f;
  };

  /** Influence value at X of the moment (or shear) at x in span s, for a unit load. */
  function influence(s: number, x: number, kind: "M" | "V") {
    const L = spans[s];
    const X0 = starts[s];
    return (X: number, side: -1 | 1 = 1) => {
      const p = locate(X);
      if (!p) return 0;
      let simple = 0;
      if (p.j === s) {
        const a = p.a;
        if (kind === "M") simple = a <= x ? (a * (L - x)) / L : (x * (L - a)) / L;
        else {
          // A load exactly on the section: on the side given.
          const left = a < x || (Math.abs(a - x) < 1e-9 && side < 0);
          simple = left ? -a / L : (L - a) / L;
        }
      }
      void X0;
      const ml = supportAt(s, X);
      const mr = supportAt(s + 1, X);
      return kind === "M" ? simple + ml * (1 - x / L) + mr * (x / L) : simple + (mr - ml) / L;
    };
  }

  /** Moment, shear and support moments at x in span s from a uniform w (klf) on every span. */
  function uniformAll(s: number, x: number, w = 1) {
    const Ms = supportMoments(spans.map((L) => ({ left: (w * L ** 3) / 24, right: (w * L ** 3) / 24 })));
    const L = spans[s];
    const M = (w * x * (L - x)) / 2 + Ms[s] * (1 - x / L) + Ms[s + 1] * (x / L);
    const V = w * (L / 2 - x) + (Ms[s + 1] - Ms[s]) / L;
    return { M, V, supports: Ms };
  }

  /** The HL-93 envelope per lane at x in span s (IM on the truck and tandem). */
  function liveEnvelope(s: number, x: number, IM = 0.33): LiveEnvelope {
    const X = starts[s] + x;
    const ilM = influence(s, x, "M");
    const ilV = influence(s, x, "V");
    // Candidate positions of the first axle: a 1 ft grid, plus every axle exactly on the section.
    const grid: number[] = [];
    const step = Math.max(0.5, Math.min(1, total / 1200));
    for (let p = -80; p <= total + 80; p += step) grid.push(p);
    const response = (axles: Axle[], il: (X: number, side?: -1 | 1) => number, p: number, dir: 1 | -1, side: -1 | 1 = 1) => {
      let r = 0;
      for (const ax of axles) {
        const at = p + dir * ax.d;
        if (at < 0 || at > total) continue;
        r += ax.P * il(at, side);
      }
      return r;
    };
    let Mmax = 0;
    let Mmin = 0;
    let Vmax = 0;
    const groups = [...REAR.map(truck), TANDEM];
    const truckMin = { v: 0 };
    let tandemMin = 0;
    for (const axles of groups) {
      const isTruck = axles.length === 3;
      for (const dir of [1, -1] as const) {
        const positions = [...grid, ...axles.map((ax) => X - dir * ax.d)];
        for (const p of positions) {
          const mm = response(axles, ilM, p, dir);
          if (mm > Mmax) Mmax = mm;
          if (mm < Mmin) Mmin = mm;
          if (isTruck) truckMin.v = Math.min(truckMin.v, mm);
          else tandemMin = Math.min(tandemMin, mm);
          for (const side of [-1, 1] as const) {
            const v = Math.abs(response(axles, ilV, p, dir, side));
            if (v > Vmax) Vmax = v;
          }
        }
      }
    }
    // Lane load on the parts of each influence line that add to the effect.
    const lane = (il: (X: number, side?: -1 | 1) => number) => {
      let pos = 0;
      let neg = 0;
      for (let j = 0; j < n; j++) {
        const L = spans[j];
        // Split the loaded span at the section (the influence line's kink or jump).
        const cuts = j === s ? [0, x, L] : [0, L];
        for (let c = 0; c + 1 < cuts.length; c++) {
          const a0 = cuts[c];
          const a1 = cuts[c + 1];
          if (a1 - a0 < 1e-9) continue;
          const K = 200;
          const h = (a1 - a0) / K;
          for (let q = 0; q < K; q++) {
            // Midpoint rule on each cell, inside the piece (so the shear's jump falls between cells).
            const v = il(starts[j] + a0 + (q + 0.5) * h);
            if (v > 0) pos += v * h;
            else neg += v * h;
          }
        }
      }
      return { pos: LANE * pos, neg: LANE * neg };
    };
    // The fatigue truck: one design truck with its rear axles at 30 ft, no lane load (3.6.1.4.1).
    let fatPos = 0;
    let fatNeg = 0;
    const fat = truck(30);
    for (const dir of [1, -1] as const) {
      for (const p of [...grid, ...fat.map((ax) => X - dir * ax.d)]) {
        const mm = response(fat, ilM, p, dir);
        if (mm > fatPos) fatPos = mm;
        if (mm < fatNeg) fatNeg = mm;
      }
    }
    const lM = lane(ilM);
    const lV = lane(ilV);
    const Mpos = Mmax * (1 + IM) + lM.pos;
    const MnegStd = Mmin * (1 + IM) + lM.neg;
    const V = Vmax * (1 + IM) + Math.max(lV.pos, -lV.neg);

    // 3.6.1.3.1: for negative moment between the points of contraflexure under a uniform load on all
    // spans, 90% of two design trucks (14 ft between the 32 kip axles, at least 50 ft from the lead
    // axle of one to the rear axle of the other) and 90% of the lane load.
    let Mneg = MnegStd;
    let negGoverns: LiveEnvelope["negGoverns"] = MnegStd < 0 ? "truck or tandem with the lane" : "none";
    if (n > 1 && uniformAll(s, x).M < 0) {
      const one = truck(14);
      const len = 28;
      let best = 0;
      for (const dir of [1, -1] as const) {
        // r(p): one truck with its first axle at p; trucks occupy [p, p+28] (dir +1) or [p−28, p].
        const P0 = -80;
        const cells = Math.ceil((total + 160) / step);
        const r = new Array<number>(cells + 1);
        for (let q = 0; q <= cells; q++) r[q] = response(one, ilM, P0 + q * step, dir);
        // The two trucks' footprints must be 50 ft apart: their first axles at least 78 ft apart.
        const gap = Math.ceil((len + 50) / step);
        let runMin = Infinity;
        for (let q = gap; q <= cells; q++) {
          runMin = Math.min(runMin, r[q - gap]);
          best = Math.min(best, runMin + r[q]);
        }
      }
      const dbl = 0.9 * (best * (1 + IM) + lM.neg);
      if (dbl < Mneg) {
        Mneg = dbl;
        negGoverns = "90% of two trucks with the lane (3.6.1.3.1)";
      }
    }
    return { Mpos, Mneg: Math.min(0, Mneg), V, negGoverns, fatPos, fatNeg };
  }

  /** A single vehicle's envelope per lane at x in span s (IM on its axles, no lane load): moved both ways, every axle also on the section. */
  function vehicleEnvelope(s: number, x: number, axles: Axle[], IM = 0.33) {
    const X = starts[s] + x;
    const ilM = influence(s, x, "M");
    const ilV = influence(s, x, "V");
    const len = Math.max(...axles.map((a) => a.d));
    const step = Math.max(0.5, Math.min(1, total / 1200));
    let Mpos = 0;
    let Mneg = 0;
    let V = 0;
    for (const dir of [1, -1] as const) {
      const positions: number[] = [];
      for (let p = -len - 1; p <= total + len + 1; p += step) positions.push(p);
      for (const ax of axles) positions.push(X - dir * ax.d);
      for (const p of positions) {
        let m = 0;
        let vl = 0;
        let vr = 0;
        for (const ax of axles) {
          const at = p + dir * ax.d;
          if (at < 0 || at > total) continue;
          m += ax.P * ilM(at);
          vl += ax.P * ilV(at, -1);
          vr += ax.P * ilV(at, 1);
        }
        Mpos = Math.max(Mpos, m);
        Mneg = Math.min(Mneg, m);
        V = Math.max(V, Math.abs(vl), Math.abs(vr));
      }
    }
    return { Mpos: Mpos * (1 + IM), Mneg: Mneg * (1 + IM), V: V * (1 + IM) };
  }

  return { spans, starts, total, n, supportMoments, influence, uniformAll, liveEnvelope, vehicleEnvelope };
}

/** A vehicle's axles (kip, ft from its first axle) from axle loads and spacings. */
export function axlesOf(P: number[], S: number[]): Axle[] {
  let d = 0;
  return P.map((p, k) => {
    if (k > 0) d += S[k - 1];
    return { P: p, d };
  });
}
export type { Axle };

/** Simple-beam end rotations (EIθ, kip·ft²) from a curvature diagram EIκ(x) (kip·ft, sagging +). */
export function rotationsFromCurvature(L: number, EIkappa: (x: number) => number, steps = 400): EndRotations {
  let left = 0;
  let right = 0;
  const h = L / steps;
  for (let k = 0; k < steps; k++) {
    const x = (k + 0.5) * h;
    const c = EIkappa(x) * h;
    left += (c * (L - x)) / L;
    right += (c * x) / L;
  }
  return { left, right };
}

function invert(A: number[][]): number[][] {
  const m = A.length;
  const M = A.map((row, r) => [...row, ...Array.from({ length: m }, (_, c) => (c === r ? 1 : 0))]);
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let k = 0; k < 2 * m; k++) M[c][k] /= d;
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let k = 0; k < 2 * m; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row) => row.slice(m));
}
