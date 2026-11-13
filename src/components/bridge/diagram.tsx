"use client";

import { fmt } from "@/components/design/design-kit";

// A member's diagram (moment, shear, deflection) along its length: a filled line over a baseline,
// its extremes labeled, and the support lines or stations marked.

export function Diagram({ title, unit, points, marks = [], flip = false, color = "#1b76bb" }: { title: string; unit: string; points: { x: number; v: number }[]; marks?: number[]; /** Draw positive values below the line (moments, as engineers draw them). */ flip?: boolean; color?: string }) {
  const W = 640, H = 150, padX = 12, padTop = 18, padBottom = 20;
  if (!points.length) return null;
  const x0 = points[0].x;
  const x1 = points[points.length - 1].x;
  const lo = Math.min(0, ...points.map((p) => p.v));
  const hi = Math.max(0, ...points.map((p) => p.v));
  const range = hi - lo || 1;
  const sx = (x: number) => padX + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * padX);
  const sy = (v: number) => {
    const t = (v - lo) / range; // 0 at the lowest value
    return flip ? padTop + t * (H - padTop - padBottom) : H - padBottom - t * (H - padTop - padBottom);
  };
  const line = points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const max = points.reduce((a, b) => (b.v > a.v ? b : a));
  const min = points.reduce((a, b) => (b.v < a.v ? b : a));
  const label = (p: { x: number; v: number }) => {
    const above = flip ? p.v < 0 : p.v > 0;
    return (
      <text x={Math.min(Math.max(sx(p.x), 40), W - 40)} y={sy(p.v) + (above ? -4 : 11)} textAnchor="middle" fontSize="10" fill="currentColor">
        {fmt(p.v, Math.abs(p.v) >= 100 ? 0 : Math.abs(p.v) >= 1 ? 2 : 3)} at {fmt(p.x - x0, 1)} ft
      </text>
    );
  };
  return (
    <figure className="text-foreground">
      <figcaption className="pb-0.5 text-xs font-semibold">
        {title} <span className="font-normal text-muted-foreground">({unit})</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {marks.map((m) => (
          <line key={m} x1={sx(m)} x2={sx(m)} y1={padTop - 6} y2={H - padBottom + 6} stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />
        ))}
        <polygon points={`${sx(x0)},${sy(0)} ${line} ${sx(x1)},${sy(0)}`} fill={color} fillOpacity="0.12" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" />
        <line x1={sx(x0)} x2={sx(x1)} y1={sy(0)} y2={sy(0)} stroke="currentColor" strokeOpacity="0.5" />
        {Math.abs(max.v) > 0.02 * range && label(max)}
        {Math.abs(min.v) > 0.02 * range && min !== max && label(min)}
        <text x={(sx(x0) + sx(x1)) / 2} y={H - 4} fontSize="9" textAnchor="middle" fill="currentColor" fillOpacity="0.6">length {fmt(x1 - x0, 1)} ft</text>
      </svg>
    </figure>
  );
}
