import { ABUTMENT_DEFAULTS, type AbutmentInputs } from "./abutment";
import { FOOTING_DEFAULTS, type FootingInputs } from "./footing";
import { MICROPILE_DEFAULTS, type MicropileInputs } from "./micropile";
import { PILE_DEFAULTS, type PileInputs } from "./piles";
import { SHAFT_DEFAULTS, type ShaftInputs } from "./shaft";

// The foundation tools and the abutment: their kinds, names and descriptions for the Design list, and
// their saved inputs filled in from the defaults (fields added since, and lists kept as saved).

export const FOUNDATION_KINDS = ["spread-footing", "pile-foundation", "drilled-shaft", "micropile", "abutment"] as const;
export type FoundationKind = (typeof FOUNDATION_KINDS)[number];

export const FOUNDATION_INFO: Record<FoundationKind, { name: string; short: string; description: string }> = {
  "spread-footing": {
    name: "Spread Footing",
    short: "Bearing, eccentricity, sliding, settlement, the footing's bars",
    description:
      "A spread footing under a column: eccentricity, bearing on the effective area by AASHTO's bearing equation (or a nominal resistance from the geotechnical report), sliding, settlement by Schmertmann's method, and the footing's flexure, one- and two-way shear, development and bearing at the column. AASHTO LRFD 10.6 and 5.12.8, FHWA NHI-06-089 Ch. 8 and GEC 6, CDOT BDM 10.4.",
  },
  "pile-foundation": {
    name: "Pile Foundation",
    short: "Driven H-piles under a cap: axial, lateral p–y, the cap",
    description:
      "A group of driven steel H-piles under a pile cap: the piles' loads on a rigid cap, geotechnical and structural axial resistance, uplift, the group's lateral response by p–y with AASHTO's p-multipliers, axial with flexure, and the cap's flexure, one-way shear and punching. AASHTO LRFD 10.7, 6.15 and 5.12.8, FHWA GEC 12 and GEC 9, CDOT BDM 10.5.",
  },
  "drilled-shaft": {
    name: "Drilled Shaft",
    short: "Side and tip resistance, lateral p–y, P–M and shear",
    description:
      "A drilled shaft for a bridge: side and tip resistance through clay, sand and rock layers (or the report's values), uplift, the lateral response by p–y, axial with flexure by strain compatibility, shear and the bars' limits. AASHTO LRFD 10.8 and 5.6, FHWA GEC 10 and GEC 9, CDOT BDM 10.6.",
  },
  micropile: {
    name: "Micropile",
    short: "Grout-to-ground bond, cased and uncased lengths, lateral",
    description:
      "A composite micropile: grout-to-ground bond by ground and grouting type, the cased and uncased lengths in compression and tension, the plunge length's transfer, the lateral response by p–y with the casing's axial and flexure, and the elastic shortening. AASHTO LRFD 10.9, FHWA NHI-05-039 and FHWA-SA-97-070.",
  },
  abutment: {
    name: "Abutment",
    short: "Integral on piles or shafts, semi-integral, seat type",
    description:
      "A bridge abutment: integral on one row of H-piles or on drilled shafts (the piles pushed through the bridge's movement by p–y, the cap over the piles, the end diaphragm under passive pressure), or semi-integral and seat type on a footing or piles (stability, the stem and backwall, the seat width). CDOT BDM 11.3, AASHTO LRFD 3.11, 4.7.4.4, 10 and 11.6.",
  },
};

const merge = <T extends object>(defaults: T, saved: unknown): T => {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const out = { ...defaults } as Record<string, unknown>;
  for (const [k, v] of Object.entries(defaults as Record<string, unknown>)) {
    const x = s[k];
    if (x === undefined || x === null) continue;
    if (Array.isArray(v)) out[k] = Array.isArray(x) ? x : v;
    else if (v && typeof v === "object") out[k] = { ...(v as object), ...(typeof x === "object" ? (x as object) : {}) };
    else if (typeof v === typeof x) out[k] = x;
  }
  return out as T;
};

export const footingInputs = (saved: unknown): FootingInputs => merge(FOOTING_DEFAULTS, saved);
export const pileFoundationInputs = (saved: unknown): PileInputs => merge(PILE_DEFAULTS, saved);
export const shaftInputs = (saved: unknown): ShaftInputs => merge(SHAFT_DEFAULTS, saved);
export const micropileInputs = (saved: unknown): MicropileInputs => merge(MICROPILE_DEFAULTS, saved);
export const abutmentInputs = (saved: unknown): AbutmentInputs => merge(ABUTMENT_DEFAULTS, saved);

export function foundationInputs(kind: string, saved: unknown) {
  switch (kind as FoundationKind) {
    case "spread-footing":
      return footingInputs(saved);
    case "pile-foundation":
      return pileFoundationInputs(saved);
    case "drilled-shaft":
      return shaftInputs(saved);
    case "micropile":
      return micropileInputs(saved);
    case "abutment":
      return abutmentInputs(saved);
  }
  return null;
}
