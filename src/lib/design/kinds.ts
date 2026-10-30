import { CIP_DEFAULTS, DEFAULT_FACTORS, type CipInputs } from "./walls/cip";

// The Design section's categories and design types: what can be designed (and what's coming).

export type DesignKind = "cip-cantilever-wall" | "mse-wall";

export const CATEGORIES: { id: string; name: string; kinds: { id: DesignKind; name: string; description: string; available: boolean }[] }[] = [
  {
    id: "walls",
    name: "Walls",
    kinds: [
      { id: "cip-cantilever-wall", name: "CIP Cantilever Wall", description: "Cast-in-place cantilever retaining wall: stability, shear key, and stem, heel and toe design. AASHTO LRFD.", available: true },
      { id: "mse-wall", name: "MSE Wall", description: "Mechanically stabilized earth wall: external and internal stability. AASHTO LRFD.", available: false },
    ],
  },
];

export const kindInfo = (kind: string) => CATEGORIES.flatMap((c) => c.kinds).find((k) => k.id === kind);

/** A CIP wall's inputs as saved, filled in from the defaults (for fields added since). */
export function cipInputs(saved: unknown): CipInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<CipInputs>;
  return { ...CIP_DEFAULTS, ...s, factors: { ...DEFAULT_FACTORS, ...(s.factors ?? {}) } };
}
