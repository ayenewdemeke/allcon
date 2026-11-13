// Small dense linear algebra for the model screens: singular values by one-sided Jacobi
// (Hestenes) rotations, accurate for the rank-deficient compatibility matrices the stability
// screen meets, without forming AᵀA.

const transpose = (a: number[][]) => a[0].map((_, j) => a.map((row) => row[j]));

/** Singular values of a (descending), min(rows, cols) of them. */
export function singularValues(a: number[][]): number[] {
  if (!a.length || !a[0].length) return [];
  const u = a.length >= a[0].length ? a.map((r) => r.slice()) : transpose(a);
  const m = u.length;
  const n = u[0].length;
  for (let sweep = 0; sweep < 80; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < m; i++) {
          alpha += u[i][p] * u[i][p];
          beta += u[i][q] * u[i][q];
          gamma += u[i][p] * u[i][q];
        }
        if (Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta) || gamma === 0) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i++) {
          const up = u[i][p];
          const uq = u[i][q];
          u[i][p] = c * up - s * uq;
          u[i][q] = s * up + c * uq;
        }
      }
    if (!rotated) break;
  }
  const values: number[] = [];
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += u[i][j] * u[i][j];
    values.push(Math.sqrt(s));
  }
  return values.sort((x, y) => y - x);
}

/** Numerical rank with NumPy's default tolerance: max(rows, cols) · ε · σmax. */
export function rank(a: number[][]) {
  const s = singularValues(a);
  const threshold = Math.max(a.length, a[0]?.length ?? 0) * Number.EPSILON * (s[0] ?? 0);
  return { rank: s.filter((v) => v > threshold).length, singular: s, threshold };
}
