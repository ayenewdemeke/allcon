import { DesignError } from "../walls/cip";

// AASHTO LRFD 10th Edition (2024) strut-and-tie arithmetic for normalweight, nonprestressed
// reinforced concrete at the strength limit state, with the September 2025 errata: tie strength
// (5.8.2.4.1), nodal face strength with nonhydrostatic nodes (5.8.2.5) and the crack-control
// grid (5.8.2.6). Inches, kips and ksi. Passing one of these is not a design on its own.

export const PHI_TIE = 0.9; // 5.5.4.2, tension in strut-and-tie models
export const PHI_STM = 0.7; // 5.5.4.2, compression in strut-and-tie models

export function positive(values: Record<string, number>) {
  for (const [name, v] of Object.entries(values)) if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new DesignError(`${name} must be a positive number.`);
}

/** The material subset the provisions are implemented for (5.8.2.1 and the development articles). */
export function material(fc: number, fy = 60) {
  positive({ "f'c": fc, fy });
  if (fc > 10 || fy > 75) throw new DesignError("The strut-and-tie checks are implemented for f'c up to 10 ksi and fy up to 75 ksi.");
}

/** US reinforcing bars: nominal diameter (in) and area (in²). */
export const BARS: Record<number, { db: number; area: number }> = {
  3: { db: 0.375, area: 0.11 },
  4: { db: 0.5, area: 0.2 },
  5: { db: 0.625, area: 0.31 },
  6: { db: 0.75, area: 0.44 },
  7: { db: 0.875, area: 0.6 },
  8: { db: 1.0, area: 0.79 },
  9: { db: 1.128, area: 1.0 },
  10: { db: 1.27, area: 1.27 },
  11: { db: 1.41, area: 1.56 },
  14: { db: 1.693, area: 2.25 },
  18: { db: 2.257, area: 4.0 },
};

export function bar(size: number) {
  const b = BARS[size];
  if (!b) throw new DesignError(`#${size} isn't a US bar size.`);
  return b;
}

/** Tie strength, Eq. 5.8.2.4.1-1: φ fy Ast (no prestressing). */
export function rcTie(demand: number, area: number, fy: number) {
  positive({ "Tie area": area, fy });
  if (!Number.isFinite(demand) || demand < 0) throw new DesignError("A tie needs a nonnegative tension.");
  if (fy > 75) throw new DesignError("Ties are implemented for fy up to 75 ksi.");
  const nominal = fy * area;
  const capacity = PHI_TIE * nominal;
  return { phi: PHI_TIE, nominal, capacity, demand, requiredArea: demand / (PHI_TIE * fy), ok: demand <= capacity };
}

export type NodeType = "CCC" | "CCT" | "CTT";
export type FaceType = "bearing" | "back" | "interface";
export type Confinement = { A1: number; A2: number; basis: string };

/** The efficiency factor ν: 0.45 without a crack-control grid (5.8.2.5.3a), else Table 5.8.2.5.3a-1. */
export function efficiency(fc: number, nodeType: NodeType, face: FaceType, grid: boolean) {
  if (!grid) return 0.45;
  if (nodeType === "CCC" && face !== "interface") return 0.85;
  if (nodeType === "CCT" && face !== "interface") return 0.7;
  return Math.max(0.45, Math.min(0.65, 0.85 - fc / 20));
}

/** m = √(A2/A1) ≤ 2.0 (Eq. 5.8.2.5.3a-1 with Article 5.6.5), from the engineer's A1 and A2; 1 without them. */
export function confinementFactor(c?: Confinement | null) {
  if (!c) return 1;
  positive({ A1: c.A1, A2: c.A2 });
  if (c.A2 < c.A1) throw new DesignError("The notional area A2 can't be smaller than the bearing area A1.");
  if (!c.basis?.trim()) throw new DesignError("Say how A2 was found (Article 5.6.5) to credit confinement.");
  return Math.min(2, Math.sqrt(c.A2 / c.A1));
}

/** A node face's strength (5.8.2.5): φ m ν f'c Acn with nonhydrostatic nodes. */
export function nodeFace(demand: number, area: number, fc: number, nodeType: NodeType, face: FaceType, grid: boolean, confinement?: Confinement | null) {
  material(fc);
  positive({ "Face area": area });
  if (!Number.isFinite(demand) || demand < 0) throw new DesignError("A node face needs a nonnegative compression.");
  const nu = efficiency(fc, nodeType, face, grid);
  const m = confinementFactor(confinement);
  const fcu = m * nu * fc;
  const capacity = PHI_STM * fcu * area;
  return { nu, m, fcu, nominal: fcu * area, capacity, demand, requiredArea: demand / (PHI_STM * fcu), ok: demand <= capacity };
}

/** The crack-control grid, Eqs. 5.8.2.6-1 and -2: each way at least 0.003 bw s, spaced at most d/4 and 12 in. */
export function crackGrid(bw: number, d: number, Av: number, sv: number, Ah: number, sh: number) {
  positive({ "Web width": bw, "Effective depth": d, Av, sv, Ah, sh });
  const maxSpacing = Math.min(d / 4, 12);
  const rv = Av / (bw * sv);
  const rh = Ah / (bw * sh);
  return { rv, rh, minRatio: 0.003, maxSpacing, ok: rv >= 0.003 && rh >= 0.003 && Math.max(sv, sh) <= maxSpacing };
}
