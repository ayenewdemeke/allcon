import { convertFromSi, type Dimension } from "@/lib/quantities";

// Units as they appear in real bills and schedules of values, mapped to one canonical code.

export type UnitDimension = Dimension | "count" | "lump" | "weight";

const UNIT_ALIASES: { unit: string; dimension: UnitDimension; aliases: string[] }[] = [
  { unit: "CY", dimension: "volume", aliases: ["cy", "cu yd", "cu. yd.", "yd3", "yd^3", "cubic yard", "cubic yards"] },
  { unit: "CF", dimension: "volume", aliases: ["cf", "cu ft", "cu. ft.", "ft3", "ft^3", "cubic foot", "cubic feet"] },
  { unit: "m3", dimension: "volume", aliases: ["m3", "m³", "cu m", "cum", "m^3", "cubic meter", "cubic metre"] },
  { unit: "SF", dimension: "area", aliases: ["sf", "sq ft", "sq. ft.", "sqft", "ft2", "ft^2", "square foot", "square feet"] },
  { unit: "SY", dimension: "area", aliases: ["sy", "sq yd", "sq. yd.", "yd2", "yd^2", "square yard", "square yards"] },
  { unit: "m2", dimension: "area", aliases: ["m2", "m²", "sq m", "sqm", "m^2", "square meter", "square metre"] },
  { unit: "LF", dimension: "length", aliases: ["lf", "lin ft", "lin. ft.", "l.f.", "linear foot", "linear feet", "ft", "feet"] },
  { unit: "m", dimension: "length", aliases: ["m", "lm", "lin m", "linear meter", "linear metre", "meter", "metre"] },
  { unit: "EA", dimension: "count", aliases: ["ea", "each", "no", "no.", "nr", "pc", "pcs", "piece", "pieces", "unit", "units"] },
  { unit: "LS", dimension: "lump", aliases: ["ls", "l.s.", "lump sum", "lumpsum", "lot", "sum", "item", "allow", "allowance"] },
  { unit: "TON", dimension: "weight", aliases: ["ton", "tons", "tn", "short ton"] },
  { unit: "t", dimension: "weight", aliases: ["t", "tonne", "tonnes", "metric ton"] },
];

const LOOKUP = new Map(UNIT_ALIASES.flatMap((u) => u.aliases.map((a) => [a, u] as const)));

/** Canonical unit code and what it measures; unknown units are kept as written. */
export function normalizeUnit(raw: string | null | undefined) {
  const text = raw?.trim();
  if (!text) return { unit: null, dimension: null };
  const hit = LOOKUP.get(text.toLowerCase().replace(/\s+/g, " "));
  return hit ? { unit: hit.unit, dimension: hit.dimension } : { unit: text, dimension: null };
}

export const unitDimension = (unit: string | null | undefined) => normalizeUnit(unit).dimension;

/**
 * Converts a measured quantity (SI, or a count) into a line item's unit.
 * Returns null when the two can't be compared (e.g. an area against a CY item).
 */
export function toLineItemUnit(value: number, measured: Dimension | "count", unit: string | null) {
  const { unit: code, dimension } = normalizeUnit(unit);
  if (measured === "count") return dimension === "count" ? value : null;
  if (!code || dimension !== measured) return null;
  return convertFromSi(value, measured, code);
}
