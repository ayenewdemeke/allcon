import { railDef, railOnDeck, type RailKey, type RailSteel, type TestLevel } from "../decks/rails";
import type { GirderInputs } from "./prestressed";

// The bridge's cross-section as the girder design describes it: the deck out to out, the rails, the
// roadway between them with its crown and cross-slopes, the girders under it; and the deck's
// quantities by the bridge's length. A CDOT standard rail (B-606) sets the barrier the girders
// carry: its width, weight and height (for the wind). Feet, kips.

export const GIRDER_RAIL_DEFAULT: { type: RailKey; testLevel: TestLevel; steel: RailSteel } = { type: "custom", testLevel: "TL-5", steel: "A1035" };
export const CROWN_DEFAULT: NonNullable<GirderInputs["crown"]> = { kind: "crown", offset: 0 };

/** The inputs with a standard rail's width, weight and height in place of the entered barrier's. */
export function applyRail(i: GirderInputs): GirderInputs {
  const choice = { ...GIRDER_RAIL_DEFAULT, ...(i.rail ?? {}) };
  const def = railDef(choice.type);
  if (!def) return { ...i, rail: choice };
  const r = railOnDeck(def, { fc: 4.5, steel: choice.steel, testLevel: choice.testLevel, gammaC: i.wcDeck });
  return {
    ...i,
    rail: choice,
    barrierWidth: def.width / 12,
    barrierWeight: +r.weight.toFixed(4),
    ...(i.site ? { site: { ...i.site, barrierHeight: def.height / 12 } } : {}),
  };
}

/** The cross-section: widths, the girders' and the crown's positions (ft from the deck's left edge), and the deck surface's height there. */
export function bridgeSection(i: GirderInputs) {
  const W = (i.nGirders - 1) * i.S + 2 * i.overhang;
  const roadway = W - 2 * i.barrierWidth;
  const girders = Array.from({ length: i.nGirders }, (_, k) => i.overhang + k * i.S);
  const slope = i.crossSlope ?? 0.02;
  const crown = { ...CROWN_DEFAULT, ...(i.crown ?? {}) };
  const xc = crown.kind === "crown" ? Math.min(W, Math.max(0, W / 2 + crown.offset)) : 0;
  /** The deck surface relative to the crown (ft, negative below). */
  const surface = (x: number) => (crown.kind === "crown" ? -slope * Math.abs(x - xc) : -slope * x);
  const rail = railDef({ ...GIRDER_RAIL_DEFAULT, ...(i.rail ?? {}) }.type);
  return { W, roadway, girders, slope, crown, xc, surface, rail };
}

/** The bridge's length for its deck: girder end to girder end over every span. */
export const deckLength = (i: GirderInputs) => [i.L, ...i.extraSpans.map((s) => s.L)].reduce((s, L) => s + L, 0) + 2 * i.endDist;
