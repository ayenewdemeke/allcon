import { DesignError } from "../walls/cip";
import { material, positive } from "./aashto";

// Service checks for strut-and-tie regions, AASHTO LRFD 10th Edition: the diagonal-cracking
// estimate (Commentary C5.8.2.2, a screen, not a strength), crack distribution with the 0.6fy
// steel-stress cap (5.6.7) and skin reinforcement (Eq. 5.6.7-3).

/** Vcr = [0.2 − 0.1 a/d] √f'c bw d, bounded 0.0632 to 0.158 √f'c bw d (Eq. C5.8.2.2-1, ksi). */
export function diagonalCrackScreen(serviceShear: number, a: number, d: number, bw: number, fc: number) {
  material(fc);
  positive({ "Shear span": a, "Effective depth": d, "Web width": bw });
  if (!Number.isFinite(serviceShear)) throw new DesignError("Give the service shear.");
  const coefficient = Math.max(0.0632, Math.min(0.158, 0.2 - (0.1 * a) / d));
  const Vcr = coefficient * Math.sqrt(fc) * bw * d;
  return { ratio: a / d, coefficient, Vcr, V: Math.abs(serviceShear), ok: Math.abs(serviceShear) < Vcr };
}

/** s ≤ 700γe/(βs fss) − 2dc with fss ≤ 0.6fy (Eqs. 5.6.7-1 and -2). The stress is never clipped. */
export function flexuralCrackSpacing(fss: number, fy: number, dc: number, h: number, spacing: number, exposureClass: 1 | 2) {
  positive({ fss, fy, dc, h, spacing });
  if (h <= dc) throw new DesignError("The depth must exceed the cover to the bar's center.");
  const beta = 1 + dc / (0.7 * (h - dc));
  const gamma = exposureClass === 1 ? 1 : 0.75;
  const allowable = (700 * gamma) / (beta * fss) - 2 * dc;
  const stressOk = fss <= 0.6 * fy;
  return { beta, gamma, allowable, stressLimit: 0.6 * fy, stressOk, spacingOk: spacing <= allowable, ok: stressOk && spacing <= allowable };
}

/** Skin bars per face over de/2 when de > 3 ft: 0.012(de − 30) in²/ft, not over As/4, at de/6 and 12 in or less (Eq. 5.6.7-3). */
export function skinReinforcement(de: number, As: number, providedPerFace: number, spacing: number) {
  positive({ de, As, "Skin bar area": providedPerFace, "Skin bar spacing": spacing });
  const applies = de > 36;
  const zone = de / 2;
  const required = applies ? Math.min((0.012 * (de - 30) * zone) / 12, As / 4) : 0;
  const maxSpacing = Math.min(de / 6, 12);
  return { applies, zone, required, maxSpacing, ok: !applies || (providedPerFace >= required && spacing <= maxSpacing) };
}
