// Model Derivative returns every property as a display string with the unit appended,
// e.g. "365.500 CF", "472.187 ft^2", "30.323 ft-and-fractional-in". We parse those into
// SI base units (m3 / m2 / m) and convert to the line item's unit at mapping time.

export type Dimension = "volume" | "area" | "length";

/** Factor converting one unit into the SI base unit for its dimension. */
const UNITS: Record<string, { dimension: Dimension; toSi: number }> = {
  // volume
  "m^3": { dimension: "volume", toSi: 1 },
  m3: { dimension: "volume", toSi: 1 },
  CF: { dimension: "volume", toSi: 0.028316846592 },
  "ft^3": { dimension: "volume", toSi: 0.028316846592 },
  CY: { dimension: "volume", toSi: 0.764554857984 },
  "yd^3": { dimension: "volume", toSi: 0.764554857984 },
  L: { dimension: "volume", toSi: 0.001 },
  // area
  "m^2": { dimension: "area", toSi: 1 },
  m2: { dimension: "area", toSi: 1 },
  SF: { dimension: "area", toSi: 0.09290304 },
  "ft^2": { dimension: "area", toSi: 0.09290304 },
  SY: { dimension: "area", toSi: 0.83612736 },
  "yd^2": { dimension: "area", toSi: 0.83612736 },
  "cm^2": { dimension: "area", toSi: 0.0001 },
  "mm^2": { dimension: "area", toSi: 0.000001 },
  // length
  m: { dimension: "length", toSi: 1 },
  cm: { dimension: "length", toSi: 0.01 },
  mm: { dimension: "length", toSi: 0.001 },
  ft: { dimension: "length", toSi: 0.3048 },
  "ft-and-fractional-in": { dimension: "length", toSi: 0.3048 },
  "ft-and-decimal-in": { dimension: "length", toSi: 0.3048 },
  in: { dimension: "length", toSi: 0.0254 },
  "fractional-in": { dimension: "length", toSi: 0.0254 },
  "decimal-in": { dimension: "length", toSi: 0.0254 },
};

export type ParsedQuantity = { value: number; dimension: Dimension };

/**
 * Parses a Model Derivative display value into an SI quantity.
 * Returns null for values that carry no usable unit (plain numbers, text, empty).
 */
export function parseQuantity(raw: unknown): ParsedQuantity | null {
  if (typeof raw === "number") return null; // no unit, so the dimension is unknown
  if (typeof raw !== "string") return null;

  const match = raw.trim().match(/^(-?[\d,]+(?:\.\d+)?)\s*(\S+)$/);
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ""));
  const unit = UNITS[match[2]];
  if (!Number.isFinite(value) || !unit) return null;

  return { value: value * unit.toSi, dimension: unit.dimension };
}

/** Converts an SI quantity into the unit a line item is priced in. */
const FROM_SI: Record<string, { dimension: Dimension; factor: number }> = {
  m3: { dimension: "volume", factor: 1 },
  CF: { dimension: "volume", factor: 1 / 0.028316846592 },
  CY: { dimension: "volume", factor: 1 / 0.764554857984 },
  m2: { dimension: "area", factor: 1 },
  SF: { dimension: "area", factor: 1 / 0.09290304 },
  SY: { dimension: "area", factor: 1 / 0.83612736 },
  m: { dimension: "length", factor: 1 },
  LF: { dimension: "length", factor: 1 / 0.3048 },
  ft: { dimension: "length", factor: 1 / 0.3048 },
};

export function convertFromSi(value: number, dimension: Dimension, unit: string) {
  const target = FROM_SI[unit];
  if (!target || target.dimension !== dimension) return null; // dimensionally incompatible
  return value * target.factor;
}
