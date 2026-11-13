import { DesignError } from "../walls/cip";
import { bar } from "../stm/aashto";
import { development, type Coating } from "../stm/anchorage";
import { hookDimensions } from "../stm/detailing";

// Bars for detailing and quantities, shared by every design tool: ASTM A615 unit weights, standard
// hook dimensions (AASHTO 5.10.2.1, Table 5.10.2.3-1), Class B lap splices (AASHTO 5.10.8.4.3a)
// and CDOT's detailing rules (Bridge Detail Manual Ch. 4): stock lengths of 40 ft for #5 and
// smaller and 60 ft for #6 and larger, no lap splices on bars larger than #11, lengths rounded
// down to the inch, splice lengths counted in the quantities. Inches and pounds.

/** Unit weight, lb/ft (ASTM A615/A615M, AASHTO M 31). */
export const UNIT_WEIGHT: Record<number, number> = { 3: 0.376, 4: 0.668, 5: 1.043, 6: 1.502, 7: 2.044, 8: 2.67, 9: 3.4, 10: 4.303, 11: 5.313, 14: 7.65, 18: 13.6 };

export const unitWeight = (size: number) => {
  const w = UNIT_WEIGHT[size];
  if (!w) throw new DesignError(`There's no #${size} bar.`);
  return w;
};

/** Stock length for splice layout (CDOT Bridge Detail Manual 4.7), in. */
export const stockLength = (size: number) => (size <= 5 ? 480 : 720);

/** CDOT 4.2: bar lengths rounded down to the nearest inch. */
export const roundDown = (inches: number) => Math.floor(inches + 1e-6);

/** Feet and inches, as on plans: 39'-10", 0'-9". */
export function ftIn(inches: number) {
  const t = Math.round(inches);
  const ft = Math.floor(t / 12);
  return `${ft}'-${t - ft * 12}"`;
}

/** A standard 90° hook's leg, out to out (the tail beyond the bend plus the bend and the bar), in. */
export function hookLeg(size: number, role: "longitudinal" | "transverse" = "longitudinal", angle: 90 | 135 = 90) {
  const h = hookDimensions(size, angle === 135 && role === "longitudinal" ? 90 : angle, "uncoated", role);
  return { leg: h.tail + h.inside / 2 + bar(size).db, tail: h.tail, inside: h.inside };
}

/** A Class B lap splice: 1.3 ℓd, at least 12 in (AASHTO 5.10.8.4.3a); none for bars over #11 (CDOT 4.7, mechanical splices). */
export function classBLap(size: number, o: { fy: number; fc: number; clearCover: number; clearSpacing: number; horizontal: boolean; concreteBelow: number; coating?: Coating }) {
  if (size > 11) return null;
  const ld = development({ barSize: size, fy: o.fy, fc: o.fc, clearCover: o.clearCover, clearSpacing: Math.max(0.1, o.clearSpacing), horizontal: o.horizontal, concreteBelow: o.concreteBelow, coating: o.coating ?? "uncoated", kind: "straight" }).required;
  return Math.max(12, 1.3 * ld);
}

/**
 * A run of bar longer than stock, cut into pieces lapped (or, above #11, mechanically spliced)
 * end to end: how many pieces, how long, and the splices. `run` is the bar's whole developed length.
 */
export function splitRun(size: number, run: number, lap: number | null) {
  const stock = stockLength(size);
  if (run <= stock) return { pieces: 1, piece: run, splices: 0, lap: 0, mechanical: false };
  const L = lap ?? 0;
  if (L >= stock / 2) throw new DesignError(`A #${size} lap of ${Math.round(L)} in is too long for its ${stock / 12} ft stock length.`);
  const pieces = Math.ceil((run - L) / (stock - L) - 1e-9);
  return { pieces, piece: (run + (pieces - 1) * L) / pieces, splices: pieces - 1, lap: L, mechanical: lap === null };
}
