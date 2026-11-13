import { DesignError } from "../walls/cip";
import { bar, material, positive } from "./aashto";
import { hookDimensions } from "./detailing";

// Tension development of a tie's bars, AASHTO LRFD 10th Edition unified method with the
// September 2025 notation corrections: ℓdb (Eq. 5.10.8.2.1a-2), the factors that increase it
// (5.10.8.2.1b) and decrease it (5.10.8.2.1c), standard hooks (5.10.8.2.4) and heads (5.10.8.2.7).
// A tie develops its full yield (5.8.2.4.2): no excess-reinforcement credit, βt = 0, λ = 1.

export type Coating = "uncoated" | "epoxy" | "galvanized" | "dual";
export type AnchorKind = "straight" | "hook" | "headed";

export type DevelopmentInput = {
  barSize: number;
  fy: number;
  fc: number;
  clearCover: number; // in, to the bar being developed
  clearSpacing: number; // in, between the bars being developed
  horizontal: boolean;
  concreteBelow: number; // in of fresh concrete cast below the bar
  coating: Coating;
  kind?: AnchorKind;
  transverseArea?: number; // Atr, in², within spacing s across the splitting plane
  transverseSpacing?: number;
  barsOnSplittingPlane?: number;
  modularRatio?: number; // ns = Es/Ec
  hookAngle?: 90 | 180;
  insideBend?: number;
  discontinuousEnd?: boolean;
  sideCover?: number;
  topBottomCover?: number;
  headNetArea?: number;
  headClearCover?: number;
  headSpacing?: number;
  astmA970ClassHA?: boolean;
};

export function development(i: DevelopmentInput) {
  const kind = i.kind ?? "straight";
  material(i.fc, i.fy);
  const { db, area: Ab } = bar(i.barSize);
  positive({ "Clear cover": i.clearCover, "Clear spacing": i.clearSpacing });
  if (!Number.isFinite(i.concreteBelow) || i.concreteBelow < 0) throw new DesignError("Give the depth of concrete cast below the bars.");
  const Atr = i.transverseArea ?? 0;
  if (!Number.isFinite(Atr) || Atr < 0) throw new DesignError("The transverse bar area can't be negative.");
  const n = i.barsOnSplittingPlane ?? 1;
  if (!Number.isInteger(n) || n < 1) throw new DesignError("The bars on the splitting plane must be a whole number.");
  const cb = Math.min(i.clearCover + db / 2, (i.clearSpacing + db) / 2);
  let ktr = 0;
  let ns = 0;
  if (Atr > 0) {
    positive({ "Transverse spacing": i.transverseSpacing ?? NaN, "Modular ratio": i.modularRatio ?? NaN });
    ktr = Atr / (i.transverseSpacing! * n);
    ns = i.modularRatio!;
  }
  // ν for a CTT node (Table 5.8.2.5.3a-1), as both the hook and the head forces use.
  const nu = Math.max(0.45, Math.min(0.65, 0.85 - i.fc / 20));
  let radius = 0;
  let Fh = 0;
  let mandatoryTies = false;
  let hook: ReturnType<typeof hookDimensions> | null = null;
  if (kind === "hook") {
    if (i.barSize > 11) throw new DesignError("Standard hook development is for #11 bars and smaller (5.10.8.2.4).");
    hook = hookDimensions(i.barSize, i.hookAngle ?? 90, i.coating, "longitudinal", i.fy);
    const inside = i.insideBend ?? hook.inside;
    if (inside < hook.inside) throw new DesignError("The bend is tighter than the least inside diameter.");
    radius = (inside + db) / 2;
    Fh = db * radius * nu * i.fc; // Eq. 5.10.8.2.4a-2
    if (i.discontinuousEnd) {
      positive({ "Side cover": i.sideCover ?? NaN, "Top or bottom cover": i.topBottomCover ?? NaN });
      mandatoryTies = i.sideCover! < 2.5 && i.topBottomCover! < 2.5;
    }
    if (mandatoryTies) {
      if (Atr <= 0 || (i.transverseSpacing ?? Infinity) > 3 * db) throw new DesignError("A hook at a discontinuous end with both covers under 2.5 in needs ties at 3db or less along its length (5.10.8.2.4b).");
      ktr = 0;
      ns = 0;
    }
  }
  if (kind === "headed") {
    if (i.barSize > 11 || i.astmA970ClassHA !== true) throw new DesignError("Headed bars must be #11 or smaller with ASTM A970 Class HA heads (5.10.8.2.7).");
    positive({ "Head net area": i.headNetArea ?? NaN, "Head clear cover": i.headClearCover ?? NaN, "Head spacing": i.headSpacing ?? NaN });
    if (i.headNetArea! < 4 * Ab || i.headClearCover! < 2 * db || i.headSpacing! < 3 * db) throw new DesignError("The head's net area, cover or spacing is outside 5.10.8.2.7.");
    Fh = 0.5 * nu * i.fc * i.headNetArea!; // Eq. 5.10.8.2.7-1
  }
  const location = i.horizontal && i.concreteBelow > 12 ? 1.3 : 1;
  let coatingFactor = 1;
  if (i.coating === "epoxy" || i.coating === "dual") coatingFactor = kind !== "straight" || (i.clearCover >= 3 * db && i.clearSpacing >= 6 * db) ? 1.2 : 1.5;
  const castCoat = Math.min(1.7, location * coatingFactor);
  const confinement = Math.max(0.3, Math.min(1, (db * cb) / (cb + 1.67 * ns * ktr) ** 2)); // Eq. 5.10.8.2.1c-2, βt = 0
  const basic = 0.17 * db * (Math.max(0, i.fy - Fh / Ab) / (1.97 * i.fc ** 0.25)) ** 2; // Eq. 5.10.8.2.1a-2
  const modified = basic * castCoat * confinement;
  const required = kind === "straight" ? Math.max(12, modified) : Math.max(8 * db, 6, modified + (kind === "hook" ? radius + db / 2 : 0));
  return { kind, required, basic, modified, location, coatingFactor, castCoat, confinement, cb, ktr, Fh, radius, mandatoryTies, hook, db };
}

/** The length available from the critical section at the extended nodal zone against the length needed. */
export function anchorageCheck(required: number, available: number) {
  positive({ "Required length": required, "Available length": available });
  return { required, available, margin: available - required, ok: available >= required };
}
