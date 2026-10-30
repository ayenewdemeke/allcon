import { CBC_DEFAULTS, type CbcInputs } from "./culverts/cbc";
import { CIP_DEFAULTS, DEFAULT_FACTORS, type CipInputs } from "./walls/cip";
import { MSE_DEFAULTS, MSE_FACTORS, type MseInputs } from "./walls/mse";

// The Design section's categories and design types: what can be designed (and what's coming).

export type DesignKind = "cip-cantilever-wall" | "mse-wall" | "box-culvert";

export const CATEGORIES: { id: string; name: string; kinds: { id: DesignKind; name: string; short: string; description: string; available: boolean }[] }[] = [
  {
    id: "walls",
    name: "Walls",
    kinds: [
      { id: "cip-cantilever-wall", name: "CIP Cantilever Wall", short: "Stability, stem, heel, toe and shear key", description: "Cast-in-place cantilever retaining wall: stability, shear key, and stem, heel and toe design. AASHTO LRFD.", available: true },
      { id: "mse-wall", name: "MSE Wall", short: "External and internal stability, facing panel", description: "Mechanically stabilized earth wall: external and internal stability, and the precast facing panel. AASHTO LRFD.", available: true },
    ],
  },
  {
    id: "culverts",
    name: "Culverts",
    kinds: [
      { id: "box-culvert", name: "Box Culvert", short: "One or more cells: frame analysis and member design", description: "Reinforced concrete box culvert, single or multiple cells: loads, 2D frame analysis with moving HL-93 live load, and the slabs and walls designed. AASHTO LRFD.", available: true },
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

/** A box culvert's inputs as saved, filled in from the defaults. Saved before bars were a choice:
 * precast with welded wire (as they were designed). */
export function cbcInputs(saved: unknown): CbcInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<CbcInputs>;
  const old = s.steel && !s.reinf ? ({ reinf: "wwr", construction: "precast" } as const) : {};
  return { ...CBC_DEFAULTS, ...old, ...s, steel: { ...CBC_DEFAULTS.steel, ...(s.steel ?? {}) }, bars: { ...CBC_DEFAULTS.bars, ...(s.bars ?? {}) } };
}

/** A design's inputs as saved, filled in from its kind's defaults. */
export function designInputs(kind: string, saved: unknown) {
  return kind === "mse-wall" ? mseInputs(saved) : kind === "box-culvert" ? cbcInputs(saved) : cipInputs(saved);
}
