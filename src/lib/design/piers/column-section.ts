import { bar } from "../stm/aashto";
import { DesignError } from "../walls/cip";

// A pier column's cross-section and its resistance to axial load with biaxial bending, AASHTO
// LRFD 10th Edition: strain compatibility with the rectangular stress block (5.6.2.1, 5.6.2.2),
// εcu = 0.003, bars elastic–perfectly plastic (Es = 29,000 ksi), φ from the net tensile strain
// (5.5.4.2), the axial resistance capped at 0.85 or 0.80 φP0 (5.6.4.4). Round, rectangular and
// oblong (a rectangle with half-round ends) sections; the concrete by fibers, the bars as points.
// x runs across the bridge (in the cap's plane, T), y along it (L). Inches and kips.

export type ColumnShape = "round" | "rectangular" | "oblong";

export type SectionInputs = {
  shape: ColumnShape;
  T: number; // in, across the bridge (a round column's diameter)
  W: number; // in, along the bridge (ignored for a round column)
  cover: number; // in, clear to the ties or spiral
  bar: number; // longitudinal bar size
  bars: number; // round: bars in the circle
  barsT: number; // rectangular: bars on each face across the bridge (corners included); oblong: on each straight face
  barsL: number; // rectangular: bars on each face along the bridge (corners included)
  barsEnd: number; // oblong: bars around each round end, between the straight faces
  tieBar: number;
  transverse: "spiral" | "ties";
  fc: number; // ksi
  fy: number; // ksi
};

export const ES = 29000;
const ECU = 0.003;

/** The section's outline (in, about its center) for drawing and its fibers. */
export function outline(s: Pick<SectionInputs, "shape" | "T" | "W">, n = 64): [number, number][] {
  if (s.shape === "round") return Array.from({ length: n }, (_, k) => [(s.T / 2) * Math.cos((2 * Math.PI * k) / n), (s.T / 2) * Math.sin((2 * Math.PI * k) / n)]);
  if (s.shape === "rectangular") return [[-s.T / 2, -s.W / 2], [s.T / 2, -s.W / 2], [s.T / 2, s.W / 2], [-s.T / 2, s.W / 2]];
  const r = s.W / 2;
  const a = s.T / 2 - r;
  const half = Math.max(8, Math.round(n / 2));
  const pts: [number, number][] = [];
  for (let k = 0; k <= half; k++) pts.push([a + r * Math.cos(-Math.PI / 2 + (Math.PI * k) / half), r * Math.sin(-Math.PI / 2 + (Math.PI * k) / half)]);
  for (let k = 0; k <= half; k++) pts.push([-a + r * Math.cos(Math.PI / 2 + (Math.PI * k) / half), r * Math.sin(Math.PI / 2 + (Math.PI * k) / half)]);
  return pts;
}

function inside(s: Pick<SectionInputs, "shape" | "T" | "W">, x: number, y: number) {
  if (s.shape === "round") return x * x + y * y <= (s.T / 2) ** 2;
  if (s.shape === "rectangular") return Math.abs(x) <= s.T / 2 && Math.abs(y) <= s.W / 2;
  const r = s.W / 2;
  const a = s.T / 2 - r;
  return Math.abs(y) <= r && (Math.abs(x) <= a || (Math.abs(x) - a) ** 2 + y * y <= r * r);
}

/** The longitudinal bars' centers (in). */
export function barPositions(s: SectionInputs): [number, number][] {
  const db = bar(s.bar).db;
  const dt = bar(s.tieBar).db;
  const co = s.cover + dt + db / 2; // face to the bars' centers
  if (s.shape === "round") {
    const R = s.T / 2 - co;
    return Array.from({ length: s.bars }, (_, k) => [R * Math.cos((2 * Math.PI * k) / s.bars + Math.PI / 2), R * Math.sin((2 * Math.PI * k) / s.bars + Math.PI / 2)]);
  }
  if (s.shape === "rectangular") {
    const X = s.T / 2 - co;
    const Y = s.W / 2 - co;
    const pts: [number, number][] = [];
    for (let k = 0; k < s.barsT; k++) {
      const x = -X + (2 * X * k) / (s.barsT - 1);
      pts.push([x, -Y], [x, Y]);
    }
    for (let k = 1; k < s.barsL - 1; k++) {
      const y = -Y + (2 * Y * k) / (s.barsL - 1);
      pts.push([-X, y], [X, y]);
    }
    return pts;
  }
  const r = s.W / 2 - co;
  const a = s.T / 2 - s.W / 2;
  const pts: [number, number][] = [];
  for (let k = 0; k < s.barsT; k++) {
    const x = s.barsT > 1 ? -a + (2 * a * k) / (s.barsT - 1) : 0;
    pts.push([x, -r], [x, r]);
  }
  for (let k = 1; k <= s.barsEnd; k++) {
    const t = -Math.PI / 2 + (Math.PI * k) / (s.barsEnd + 1);
    pts.push([a + r * Math.cos(t), r * Math.sin(t)], [-a - r * Math.cos(t), r * Math.sin(t)]);
  }
  return pts;
}

export type Section = ReturnType<typeof columnSection>;

/** The section: gross properties, its fibers and bars, P0, and its resistance at an axial load in a direction. */
export function columnSection(s: SectionInputs) {
  if (!(s.T > 0) || (s.shape !== "round" && !(s.W > 0))) throw new DesignError("Give the column's dimensions.");
  if (s.shape === "oblong" && s.T <= s.W) throw new DesignError("An oblong column is longer across the bridge than along it: its ends are half-rounds of the width along the bridge.");
  if (s.shape === "round" && s.bars < 4) throw new DesignError("A round column needs at least 4 bars.");
  if (s.shape === "rectangular" && (s.barsT < 2 || s.barsL < 2)) throw new DesignError("Each face needs at least its two corner bars.");
  if (s.shape === "oblong" && (s.barsT < 1 || s.barsEnd < 0)) throw new DesignError("Give the bars on the straight faces and around the ends.");
  if (!(s.fc > 0 && s.fy > 0)) throw new DesignError("Give f'c and fy.");
  const geo = { shape: s.shape, T: s.T, W: s.shape === "round" ? s.T : s.W };
  const { area: Ab, db } = bar(s.bar);
  const bars = barPositions(s);
  // Concrete fibers: a grid of about 50 cells across the longer side (a round section's by rings and sectors).
  const fibers: { x: number; y: number; a: number }[] = [];
  if (s.shape === "round") {
    const R = s.T / 2;
    const rings = 24;
    const sectors = 72;
    for (let i = 0; i < rings; i++) {
      const r0 = (R * i) / rings;
      const r1 = (R * (i + 1)) / rings;
      const rm = (r0 + r1) / 2;
      const a = (Math.PI * (r1 * r1 - r0 * r0)) / sectors;
      for (let j = 0; j < sectors; j++) {
        const t = (2 * Math.PI * (j + 0.5)) / sectors;
        fibers.push({ x: rm * Math.cos(t), y: rm * Math.sin(t), a });
      }
    }
  } else {
    const h = Math.max(geo.T, geo.W) / 50;
    const nx = Math.ceil(geo.T / h);
    const ny = Math.ceil(geo.W / h);
    const hx = geo.T / nx;
    const hy = geo.W / ny;
    // Sub-sampled cells along a curved edge: the area inside, at its centroid.
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const x0 = -geo.T / 2 + i * hx;
        const y0 = -geo.W / 2 + j * hy;
        let n = 0;
        let sx = 0;
        let sy = 0;
        for (let p = 0; p < 4; p++)
          for (let q = 0; q < 4; q++) {
            const x = x0 + ((p + 0.5) * hx) / 4;
            const y = y0 + ((q + 0.5) * hy) / 4;
            if (inside(geo, x, y)) {
              n++;
              sx += x;
              sy += y;
            }
          }
        if (n) fibers.push({ x: sx / n, y: sy / n, a: (hx * hy * n) / 16 });
      }
  }
  const Ag = s.shape === "round" ? (Math.PI * s.T ** 2) / 4 : s.shape === "rectangular" ? s.T * s.W : (s.T - s.W) * s.W + (Math.PI * s.W ** 2) / 4;
  // Moments of inertia: in-plane bending (T) about the y-axis, out-of-plane (L) about the x-axis.
  const IgT = s.shape === "round" ? (Math.PI * s.T ** 4) / 64 : s.shape === "rectangular" ? (s.W * s.T ** 3) / 12 : fibers.reduce((p, f) => p + f.a * f.x * f.x, 0) * (Ag / fibers.reduce((p, f) => p + f.a, 0));
  const IgL = s.shape === "round" ? IgT : s.shape === "rectangular" ? (s.T * s.W ** 3) / 12 : fibers.reduce((p, f) => p + f.a * f.y * f.y, 0) * (Ag / fibers.reduce((p, f) => p + f.a, 0));
  const IsT = bars.reduce((p, [x]) => p + Ab * x * x, 0);
  const IsL = bars.reduce((p, [, y]) => p + Ab * y * y, 0);
  const Ast = bars.length * Ab;
  const beta1 = Math.min(0.85, Math.max(0.65, 0.85 - 0.05 * (s.fc - 4))); // 5.6.2.2
  const P0 = 0.85 * s.fc * (Ag - Ast) + s.fy * Ast; // Eq. 5.6.4.5-2 (kc = 0.85, f'c ≤ 10 ksi)
  const k = s.transverse === "spiral" ? 0.85 : 0.8; // Eqs. 5.6.4.4-2, -3
  const ecl = Math.min(0.002, s.fy / ES); // 5.6.2.1: compression-controlled strain limit (0.002 for fy 60)
  const etl = 0.005;
  const phiOf = (et: number) => Math.min(0.9, Math.max(0.75, 0.75 + (0.15 * (et - ecl)) / (etl - ecl))); // 5.5.4.2
  const corners = outline(geo, 96);

  /** Nominal resistance for the neutral axis c (in) from the extreme compression fiber, the compression side toward θ. */
  const at = (theta: number, c: number) => {
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const top = Math.max(...corners.map(([x, y]) => x * ux + y * uy));
    const a = beta1 * c;
    let P = 0;
    let MT = 0;
    let ML = 0;
    for (const f of fibers) {
      const depth = top - (f.x * ux + f.y * uy);
      if (depth <= a) {
        const F = 0.85 * s.fc * f.a;
        P += F;
        MT += F * f.x;
        ML += F * f.y;
      }
    }
    let et = -Infinity;
    for (const [x, y] of bars) {
      const depth = top - (x * ux + y * uy);
      const eps = (ECU * (c - depth)) / c; // compression positive
      const fs = Math.max(-s.fy, Math.min(s.fy, ES * eps));
      const F = Ab * (depth <= a ? fs - 0.85 * s.fc : fs); // bars in the stress block displace concrete
      P += F;
      MT += F * x;
      ML += F * y;
      et = Math.max(et, -eps);
    }
    const phi = phiOf(et);
    return { P, MT, ML, et, phi };
  };

  const dmax = Math.max(geo.T, geo.W);
  /** On the factored interaction surface at θ: the c for which φPn = Pu (bisection; φPn grows with c). */
  const onSurface = (theta: number, Pu: number, phiFixed?: number) => {
    let lo = 1e-3;
    let hi = 30 * dmax;
    const f = (c: number) => {
      const r = at(theta, c);
      return (phiFixed ?? r.phi) * r.P - Pu;
    };
    if (f(hi) < 0) return null; // beyond the section's axial strength
    if (f(lo) > 0) return null; // more tension than the bars hold
    for (let k2 = 0; k2 < 50; k2++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < 0) lo = mid;
      else hi = mid;
    }
    const r = at(theta, (lo + hi) / 2);
    return { ...r, c: (lo + hi) / 2, phiUsed: phiFixed ?? r.phi };
  };

  /**
   * The factored moment resistance (kip·in) at the factored axial load Pu, in the direction of the
   * demand (MuT, MuL): the neutral axis turned until the resisting moment points the demand's way
   * (biaxial flexure by equilibrium and strain compatibility, 5.6.4.5). φ by the net tensile strain, or fixed.
   */
  const resistance = (Pu: number, MuT: number, MuL: number, phiFixed?: number) => {
    const alpha = Math.hypot(MuT, MuL) > 1e-9 ? Math.atan2(MuL, MuT) : 0;
    const dir = (theta: number) => {
      const r = onSurface(theta, Pu, phiFixed);
      if (!r) return null;
      let g = Math.atan2(r.ML, r.MT) - alpha;
      while (g > Math.PI) g -= 2 * Math.PI;
      while (g < -Math.PI) g += 2 * Math.PI;
      return { r, g };
    };
    let a = alpha - (80 * Math.PI) / 180;
    let b = alpha + (80 * Math.PI) / 180;
    let ra = dir(a);
    const rb = dir(b);
    let best = dir(alpha);
    if (!best || !ra || !rb) return null;
    if (Math.abs(best.g) > 1e-6 && ra.g < 0 && rb.g > 0) {
      for (let k2 = 0; k2 < 30; k2++) {
        const m = (a + b) / 2;
        const rm = dir(m);
        if (!rm) break;
        best = rm;
        if (rm.g < 0) {
          a = m;
          ra = rm;
        } else b = m;
      }
    }
    const r = best.r;
    const Mn = Math.hypot(r.MT, r.ML);
    return { phi: r.phiUsed, c: r.c, et: r.et, Mn, phiMn: r.phiUsed * Mn, MnT: r.MT, MnL: r.ML };
  };

  /** Points (φPn, φMn) of the uniaxial factored interaction diagram, bending across (T) or along (L) the bridge, and the nominal ones. */
  const curve = (axis: "T" | "L") => {
    const theta = axis === "T" ? 0 : Math.PI / 2;
    const pts: { P: number; M: number; Pn: number; Mn: number }[] = [];
    for (let k2 = 0; k2 <= 60; k2++) {
      const c = ((k2 + 0.5) / 60) ** 2 * 2.5 * dmax;
      const r = at(theta, c);
      const M = axis === "T" ? r.MT : r.ML;
      pts.push({ P: r.phi * r.P, M: r.phi * M, Pn: r.P, Mn: M });
    }
    return pts;
  };

  return { inputs: s, geo, bars, fibers, Ab, db, Ag, IgT, IgL, IsT, IsL, Ast, beta1, P0, k, PrMax: (phi: number) => phi * k * P0, at, resistance, curve, outline: corners };
}

/** The modulus of elasticity of concrete, Eq. 5.4.2.4-1 (K1 = 1.0, wc = 0.145 kcf), ksi. */
export const concreteE = (fc: number, wc = 0.145) => 120000 * wc * wc * fc ** 0.33;
