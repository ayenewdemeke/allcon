import type { Units, Vec } from "./types";

// Lengths, angles and points as AutoCAD reads and writes them. Architectural drawings are in
// inches and read 10'-6 1/2"; a bare number is inches. Metric drawings are in millimetres.

const FRACTION_DENOMINATOR = 16; // architectural precision: 1/16"

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export function formatLength(value: number, units: Units) {
  if (!Number.isFinite(value)) return "";
  if (units === "mm") return trimNumber(value, 2);
  const negative = value < 0;
  let sixteenths = Math.round(Math.abs(value) * FRACTION_DENOMINATOR);
  const feet = Math.floor(sixteenths / (12 * FRACTION_DENOMINATOR));
  sixteenths -= feet * 12 * FRACTION_DENOMINATOR;
  const inches = Math.floor(sixteenths / FRACTION_DENOMINATOR);
  const rest = sixteenths - inches * FRACTION_DENOMINATOR;
  let fraction = "";
  if (rest) {
    const d = gcd(rest, FRACTION_DENOMINATOR);
    fraction = ` ${rest / d}/${FRACTION_DENOMINATOR / d}`;
  }
  return `${negative ? "-" : ""}${feet}'-${inches}${fraction}"`;
}

export function trimNumber(value: number, decimals: number) {
  return Number(value.toFixed(decimals)).toString();
}

/** Inches (with an optional fraction): "6", "6.5", "6 1/2", "6-1/2", "1/2". */
function parseInches(text: string): number | null {
  const t = text.trim().replace(/"$/, "").trim();
  if (!t) return 0;
  const m = t.match(/^(\d+(?:\.\d+)?)?(?:(?:\s+|-)?(\d+)\/(\d+))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const whole = m[1] ? Number(m[1]) : 0;
  const fraction = m[2] ? Number(m[2]) / Number(m[3]) : 0;
  return Number.isFinite(fraction) ? whole + fraction : null;
}

export function parseLength(text: string, units: Units): number | null {
  let t = text.trim();
  if (!t) return null;
  let sign = 1;
  if (t.startsWith("-")) {
    sign = -1;
    t = t.slice(1).trim();
  }
  if (units === "mm") {
    const n = Number(t);
    return t && Number.isFinite(n) ? sign * n : null;
  }
  const quote = t.indexOf("'");
  if (quote === -1) {
    const inches = parseInches(t);
    return inches === null ? null : sign * inches;
  }
  const feet = Number(t.slice(0, quote).trim());
  if (!t.slice(0, quote).trim() || !Number.isFinite(feet)) return null;
  const inches = parseInches(t.slice(quote + 1).replace(/^\s*-/, ""));
  return inches === null ? null : sign * (feet * 12 + inches);
}

const DEG = Math.PI / 180;

export function formatAngle(radians: number) {
  let degrees = (radians / DEG) % 360;
  if (degrees < 0) degrees += 360;
  return `${trimNumber(degrees, 2)}°`;
}

export function parseAngle(text: string): number | null {
  const t = text.trim().replace(/[d°]$/i, "");
  const n = Number(t);
  return t && Number.isFinite(n) ? n * DEG : null;
}

export type PointInput = { kind: "point"; point: Vec } | { kind: "distance"; distance: number };

/**
 * A typed point, as AutoCAD reads it: "x,y", "@dx,dy" (relative), "#x,y" (absolute),
 * "d<angle" (polar), or a bare distance along the cursor's direction. With dynamic input on,
 * points after the first are relative unless marked "#", as in AutoCAD.
 */
export function parsePointInput(text: string, units: Units, base: Vec | null, dynamic: boolean): PointInput | null {
  let t = text.trim();
  if (!t) return null;
  let relative = !!base && dynamic;
  if (t.startsWith("@")) {
    relative = true;
    t = t.slice(1);
  } else if (t.startsWith("#")) {
    relative = false;
    t = t.slice(1);
  }
  const origin = relative && base ? base : { x: 0, y: 0 };
  if (t.includes("<")) {
    const [d, a] = t.split("<");
    const distance = parseLength(d, units);
    const angle = parseAngle(a);
    if (distance === null || angle === null) return null;
    return { kind: "point", point: { x: origin.x + distance * Math.cos(angle), y: origin.y + distance * Math.sin(angle) } };
  }
  if (t.includes(",")) {
    const [xs, ys] = t.split(",");
    const x = parseLength(xs, units);
    const y = parseLength(ys, units);
    if (x === null || y === null) return null;
    return { kind: "point", point: { x: origin.x + x, y: origin.y + y } };
  }
  const distance = parseLength(t, units);
  return distance === null ? null : { kind: "distance", distance };
}
