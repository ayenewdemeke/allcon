import type { Trace } from "./evaluate";

// A plot's axes, the same on screen and in print: round ticks covering the traces' points.

export const PLOT_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];

/** Round steps for an axis (1, 2 or 5 × 10ⁿ), about `count` of them. */
export function ticks(min: number, max: number, count = 6) {
  if (!(max > min)) {
    const d = Math.abs(min) || 1;
    [min, max] = [min - d / 2, max + d / 2];
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { lo, hi, values: out, step };
}

export const tickLabel = (v: number, step: number) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : v.toFixed(Math.min(decimals, 6));
};

/** The x and y axes for traces: x from 0 (or below), y over the values. */
export function axes(traces: Trace[]) {
  const points = traces.flatMap((t) => t.xs.map((x, i) => [x, t.ys[i]] as const)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  return {
    x: ticks(Math.min(...points.map((p) => p[0]), 0), Math.max(...points.map((p) => p[0]), points.length ? -Infinity : 1)),
    y: ticks(Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[1]))),
  };
}
