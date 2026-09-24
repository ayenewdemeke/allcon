// Measurement maths for 2D takeoff, shared by the viewer and the server.
// Geometry is in PDF points (1/72 in on paper); a sheet's scale converts points to meters.

export type Point = [number, number];
export type UnitSystem = "imperial" | "metric";

const INCH = 0.0254;
const FOOT = 0.3048;
const METERS_PER_PAPER_POINT = INCH / 72;

// --- geometry ---------------------------------------------------------------

export const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function polylineLength(points: Point[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/** Shoelace formula; absolute, so clockwise and counter-clockwise give the same result. */
export function polygonArea(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export const polygonPerimeter = (points: Point[]) =>
  points.length < 2 ? 0 : polylineLength(points) + distance(points[points.length - 1], points[0]);

// --- drawing scales ---------------------------------------------------------

export type ScalePreset = { label: string; metersPerPoint: number };

/** Paper-to-real ratio, e.g. 96 for 1/8" = 1'-0", 100 for 1:100. */
const fromRatio = (ratio: number) => METERS_PER_PAPER_POINT * ratio;

export const SCALE_PRESETS: { group: string; presets: ScalePreset[] }[] = [
  {
    group: "Architectural",
    presets: [
      ["1/16\"", 1 / 16],
      ["3/32\"", 3 / 32],
      ["1/8\"", 1 / 8],
      ["3/16\"", 3 / 16],
      ["1/4\"", 1 / 4],
      ["3/8\"", 3 / 8],
      ["1/2\"", 1 / 2],
      ["3/4\"", 3 / 4],
      ["1\"", 1],
      ["1 1/2\"", 1.5],
      ["3\"", 3],
    ].map(([label, inches]) => ({
      label: `${label} = 1'-0"`,
      metersPerPoint: fromRatio(12 / (inches as number)),
    })),
  },
  {
    group: "Engineering",
    presets: [10, 20, 30, 40, 50, 60, 100, 200].map((feet) => ({
      label: `1" = ${feet}'`,
      metersPerPoint: fromRatio(feet * 12),
    })),
  },
  {
    group: "Metric",
    presets: [10, 20, 50, 100, 200, 500, 1000].map((n) => ({ label: `1:${n}`, metersPerPoint: fromRatio(n) })),
  },
];

/** Scale from a known distance: the user drew `pointsLength` over something `meters` long. */
export const calibrate = (pointsLength: number, meters: number) => meters / pointsLength;

// --- units ------------------------------------------------------------------

export type MeasureKind = "length" | "area" | "volume" | "count";

const UNIT_LABELS: Record<UnitSystem, Record<MeasureKind, string>> = {
  imperial: { length: "LF", area: "SF", volume: "CY", count: "EA" },
  metric: { length: "m", area: "m²", volume: "m³", count: "nr" },
};

export const unitLabel = (system: UnitSystem, kind: MeasureKind) => UNIT_LABELS[system][kind];

/** Converts an SI value (m, m², m³) into the display unit for the system. */
export function fromSi(value: number, kind: MeasureKind, system: UnitSystem) {
  if (system === "metric" || kind === "count") return value;
  if (kind === "length") return value / FOOT;
  if (kind === "area") return value / (FOOT * FOOT);
  return value / 0.764554857984; // cubic yards
}

export function formatMeasure(value: number, kind: MeasureKind, system: UnitSystem) {
  const shown = fromSi(value, kind, system);
  const digits = kind === "count" ? 0 : Math.abs(shown) < 100 ? 2 : 1;
  const text = shown.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${text} ${unitLabel(system, kind)}`;
}

/** Parses a distance typed by the user into meters: 24'-6", 24' 6", 24.5 ft, 7.47 m, 7470 mm. */
export function parseDistance(input: string, system: UnitSystem): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;

  const feetInches = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/);
  if (feetInches) return Number(feetInches[1]) * FOOT + Number(feetInches[2] ?? 0) * INCH;

  const withUnit = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m|in|")$/);
  if (withUnit) {
    const n = Number(withUnit[1]);
    return { mm: n / 1000, cm: n / 100, m: n, in: n * INCH, '"': n * INCH }[withUnit[2]]!;
  }

  const bare = s.match(/^\d+(?:\.\d+)?$/);
  if (bare) return Number(s) * (system === "imperial" ? FOOT : 1);
  return null;
}

// --- markup values ----------------------------------------------------------

export type MarkupLike = { kind: string; points: Point[]; depth?: number | null };

/** The measured quantity of a markup in SI units, or null when the sheet is not scaled. */
export function measureMarkup(m: MarkupLike, metersPerPoint: number | null) {
  if (m.kind === "count") return { kind: "count" as const, value: m.points.length };
  if (!metersPerPoint) return null;
  if (m.kind === "length") return { kind: "length" as const, value: polylineLength(m.points) * metersPerPoint };
  if (m.kind === "area") {
    const area = polygonArea(m.points) * metersPerPoint ** 2;
    const perimeter = polygonPerimeter(m.points) * metersPerPoint;
    return m.depth
      ? { kind: "volume" as const, value: area * m.depth, area, perimeter }
      : { kind: "area" as const, value: area, perimeter };
  }
  return null;
}
