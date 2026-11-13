// A round reinforced concrete section's nominal axial and moment resistance by strain
// compatibility with the rectangular stress block (AASHTO 5.6.2): bars equally spaced on a circle.
// Used for drilled shafts. Inches and kips.

/** The resistance with the neutral axis c from the compression face (kip, kip·in). */
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
