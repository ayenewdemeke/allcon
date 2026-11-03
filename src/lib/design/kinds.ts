import { BEARING_DEFAULTS, type BearingInputs } from "./bearings/elastomeric";
import { CBC_DEFAULTS, type CbcInputs } from "./culverts/cbc";
import { DECK_DEFAULTS, type DeckInputs } from "./decks/deck";
import { CIP_DEFAULTS, DEFAULT_FACTORS, type CipInputs, type Combo } from "./walls/cip";
import { MSE_DEFAULTS, MSE_FACTORS, type MseInputs } from "./walls/mse";
import { WINGWALL_DEFAULTS, type WingwallInputs } from "./walls/wingwall";

// The Design section's categories and design types: highway structures to AASHTO LRFD, grouped
// by element. What can be designed, and what's coming next.

export type DesignKind = "cip-cantilever-wall" | "mse-wall" | "cantilever-wingwall" | "box-culvert" | "deck-slab" | "elastomeric-bearing" | "ptfe-bearing" | "strip-seal-joint";

export const CATEGORIES: { id: string; name: string; kinds: { id: DesignKind; name: string; short: string; description: string; available: boolean }[] }[] = [
  {
    id: "walls",
    name: "Walls",
    kinds: [
      { id: "cip-cantilever-wall", name: "CIP Cantilever Wall", short: "Stability, stem, heel, toe and shear key", description: "Cast-in-place cantilever retaining wall: stability, shear key, and stem, heel and toe design. AASHTO LRFD.", available: true },
      { id: "mse-wall", name: "MSE Wall", short: "External and internal stability, facing panel", description: "Mechanically stabilized earth wall: external and internal stability, and the precast facing panel. AASHTO LRFD.", available: true },
      { id: "cantilever-wingwall", name: "Cantilever Wingwall", short: "Off an abutment: earth pressure, bars, abutment forces", description: "Wingwall cantilevered off an abutment: at-rest earth pressure and surcharge on the retained face, the horizontal bars at the abutment face, and the forces handed to the abutment. AASHTO LRFD.", available: true },
    ],
  },
  {
    id: "culverts",
    name: "Culverts",
    kinds: [
      { id: "box-culvert", name: "Box Culvert", short: "One or more cells: frame analysis and member design", description: "Reinforced concrete box culvert, single or multiple cells: loads, 2D frame analysis with moving HL-93 live load, and the slabs and walls designed. AASHTO LRFD.", available: true },
    ],
  },
  {
    id: "bridge-components",
    name: "Bridge Components",
    kinds: [
      { id: "deck-slab", name: "Deck Slab", short: "Equivalent strips: bars and overhang", description: "Cast-in-place deck on parallel girders by the equivalent strip method: the strip analyzed as a continuous beam under dead loads and the design truck's axles, the top, bottom and longitudinal bars, and the overhang for vehicle collision. AASHTO LRFD 4.6.2.1, 9.7.3 and A13.4.", available: true },
      { id: "elastomeric-bearing", name: "Elastomeric Bearing", short: "Plain or steel-reinforced pads", description: "Elastomeric bearing pads, plain or steel-reinforced, by Method A or B: compression, shear strains, deflection, stability, shims and anchorage. AASHTO LRFD 14.7.5 and 14.7.6.", available: true },
      { id: "ptfe-bearing", name: "PTFE Sliding Bearing", short: "Sliding surface on an elastomeric pad", description: "PTFE sliding bearing: contact pressure, friction and the mating surface. AASHTO LRFD 14.7.2.", available: false },
      { id: "strip-seal-joint", name: "Strip Seal Expansion Joint", short: "Movement and seal size", description: "Strip seal deck joint: thermal movement and the seal's opening range. AASHTO LRFD 3.12.2 and 14.5.", available: false },
    ],
  },
];

export const kindInfo = (kind: string) => CATEGORIES.flatMap((c) => c.kinds).find((k) => k.id === kind);

/** A CIP wall's inputs as saved, filled in from the defaults (for fields added since, each load
 * group's factors too). */
export function cipInputs(saved: unknown): CipInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<CipInputs>;
  const factors = Object.fromEntries((Object.keys(DEFAULT_FACTORS) as Combo[]).map((c) => [c, { ...DEFAULT_FACTORS[c], ...(s.factors?.[c] ?? {}) }])) as CipInputs["factors"];
  return { ...CIP_DEFAULTS, ...s, factors };
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

/** A deck's inputs as saved, filled in from the defaults. */
export function deckInputs(saved: unknown): DeckInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<DeckInputs>;
  return { ...DECK_DEFAULTS, ...s };
}

/** A wingwall's inputs as saved, filled in from the defaults. */
export function wingwallInputs(saved: unknown): WingwallInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<WingwallInputs>;
  return { ...WINGWALL_DEFAULTS, ...s, bars: { ...WINGWALL_DEFAULTS.bars, ...(s.bars ?? {}) } };
}

/** An elastomeric bearing's inputs as saved, filled in from the defaults. */
export function bearingInputs(saved: unknown): BearingInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<BearingInputs>;
  return { ...BEARING_DEFAULTS, ...s };
}

/** A design's inputs as saved, filled in from its kind's defaults. */
export function designInputs(kind: string, saved: unknown) {
  return kind === "mse-wall" ? mseInputs(saved) : kind === "box-culvert" ? cbcInputs(saved) : kind === "elastomeric-bearing" ? bearingInputs(saved) : kind === "cantilever-wingwall" ? wingwallInputs(saved) : kind === "deck-slab" ? deckInputs(saved) : cipInputs(saved);
}
