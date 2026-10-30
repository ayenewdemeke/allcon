import { CIP_DEFAULTS, DEFAULT_FACTORS, type CipInputs } from "./walls/cip";
import { MSE_DEFAULTS, MSE_FACTORS, type MseInputs } from "./walls/mse";

// The Design section's categories and design types: what can be designed (and what's coming).

export type DesignKind = "cip-cantilever-wall" | "mse-wall";

export const CATEGORIES: { id: string; name: string; kinds: { id: DesignKind; name: string; description: string; available: boolean }[] }[] = [
  {
    id: "walls",
    name: "Walls",
    kinds: [
      { id: "cip-cantilever-wall", name: "CIP Cantilever Wall", description: "Cast-in-place cantilever retaining wall: stability, shear key, and stem, heel and toe design. AASHTO LRFD.", available: true },
      { id: "mse-wall", name: "MSE Wall", description: "Mechanically stabilized earth wall: external and internal stability, and the precast facing panel. AASHTO LRFD.", available: true },
    ],
  },
];

export const kindInfo = (kind: string) => CATEGORIES.flatMap((c) => c.kinds).find((k) => k.id === kind);

/** A CIP wall's inputs as saved, filled in from the defaults (for fields added since). */
export function cipInputs(saved: unknown): CipInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<CipInputs>;
  return { ...CIP_DEFAULTS, ...s, factors: { ...DEFAULT_FACTORS, ...(s.factors ?? {}) } };
}

/** An MSE wall's inputs as saved, filled in from the defaults. */
export function mseInputs(saved: unknown): MseInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<MseInputs>;
  return { ...MSE_DEFAULTS, ...s, factors: { ...MSE_FACTORS, ...(s.factors ?? {}) } };
}

/** A design's inputs as saved, filled in from its kind's defaults. */
export function designInputs(kind: string, saved: unknown) {
  return kind === "mse-wall" ? mseInputs(saved) : cipInputs(saved);
}
