"use client";

import type { CipInputs, CipResult } from "@/lib/design/walls/cip";
import type { MseInputs, MseResult } from "@/lib/design/walls/mse";

// The wall's section, to scale, redrawn as its inputs change: concrete, the backfill and its
// slope, the ground in front, the shear key, the earth pressure resultant, and the main dimensions.

const W = 520;
const HPX = 380;

const fmtFt = (ft: number) => {
  const inches = Math.round(ft * 12 * 4) / 4;
  const f = Math.floor(inches / 12);
  const i = +(inches - f * 12).toFixed(2);
  return f ? (i ? `${f}'-${i}"` : `${f}'-0"`) : `${i}"`;
};

export function CipSketch({ inputs, result }: { inputs: CipInputs; result: CipResult }) {
  const g = result.geometry;
  const { A, B, D, H, T1, Tt, Tb } = g;
  const dKey = inputs.shearKey ? inputs.keyDepth / 12 : 0;
  const Dw = inputs.keyWidth / 12;
  const Xkey = B - B / 3 - Dw / 2;
  const tanB = Math.tan((result.soil.beta * Math.PI) / 180);
  const span = Math.max(B, H);
  const xmin = -0.45 * span;
  const xmax = B + 0.55 * span;
  const rise = (xmax - (A + T1 + Tt)) * tanB;
  const ymin = -dKey - 0.25 * span * 0.3;
  const ymax = H + Math.min(rise, 0.6 * span) + 0.2 * span;
  const s = Math.min((W - 40) / (xmax - xmin), (HPX - 30) / (ymax - ymin));
  const X = (x: number) => 20 + (x - xmin) * s;
  const Y = (y: number) => HPX - 15 - (y - ymin) * s;
  const pts = (p: [number, number][]) => p.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" ");

  const backTop = A + T1 + Tt;
  const concrete: [number, number][] = [
    [0, 0],
    [0, D],
    [A, D],
    [A + T1, H],
    [backTop, H],
    [A + Tb, D],
    [B, D],
    [B, 0],
    ...(inputs.shearKey
      ? ([
          [Xkey + Dw, 0],
          [Xkey + Dw, -dKey],
          [Xkey, -dKey],
          [Xkey, 0],
        ] as [number, number][])
      : []),
  ];
  const slopeEnd = Math.min(xmax, backTop + (0.6 * span) / Math.max(tanB, 1e-9));
  const backfill: [number, number][] = [[backTop, H], [A + Tb, D], [B, D], [B, -dKey - 0.3], [xmax, -dKey - 0.3], [xmax, H + (slopeEnd - backTop) * tanB], [slopeEnd, H + (slopeEnd - backTop) * tanB]];
  const front = Math.max(inputs.Df, 0);
  const frontFace = (y: number) => A + T1 * ((y - D) / Math.max(g.hStem, 1e-9));
  const ground: [number, number][] = front > D ? [[xmin, -dKey - 0.3], [0, -dKey - 0.3], [0, D], [A, D], [frontFace(front), front], [xmin, front]] : [[xmin, -dKey - 0.3], [0, -dKey - 0.3], [0, front], [xmin, front]];

  // The earth pressure on the plane through the heel, and its resultant at h/3.
  const ph = g.h;
  const pw = Math.min(0.35 * span, Math.max(0.15 * span, result.soil.efwA * ph * 6));
  const pressure: [number, number][] = [
    [B, ph],
    [B + pw, 0],
    [B, 0],
  ];

  const dim = (x1: number, y1: number, x2: number, y2: number, label: string, side: "below" | "left" | "above" | "right") => {
    const [ax, ay, bx, by] = [X(x1), Y(y1), X(x2), Y(y2)];
    const horizontal = Math.abs(ay - by) < 1;
    const tx = (ax + bx) / 2 + (side === "left" ? -6 : side === "right" ? 6 : 0);
    const ty = (ay + by) / 2 + (side === "below" ? 13 : side === "above" ? -5 : 3);
    return (
      <g className="text-muted-foreground" key={`${label}${x1}${y1}`}>
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke="currentColor" strokeWidth="0.75" />
        {horizontal ? (
          <>
            <line x1={ax} y1={ay - 3} x2={ax} y2={ay + 3} stroke="currentColor" strokeWidth="0.75" />
            <line x1={bx} y1={by - 3} x2={bx} y2={by + 3} stroke="currentColor" strokeWidth="0.75" />
          </>
        ) : (
          <>
            <line x1={ax - 3} y1={ay} x2={ax + 3} y2={ay} stroke="currentColor" strokeWidth="0.75" />
            <line x1={bx - 3} y1={by} x2={bx + 3} y2={by} stroke="currentColor" strokeWidth="0.75" />
          </>
        )}
        <text x={tx} y={ty} fontSize="10" textAnchor={side === "left" ? "end" : side === "right" ? "start" : "middle"} fill="currentColor">
          {label}
        </text>
      </g>
    );
  };

  return (
    <svg viewBox={`0 0 ${W} ${HPX}`} className="h-auto w-full" role="img" aria-label="Wall section">
      <defs>
        <pattern id="soil" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#b08968" strokeWidth="1" opacity="0.45" />
        </pattern>
      </defs>
      <polygon points={pts(backfill)} fill="url(#soil)" stroke="none" />
      <polygon points={pts(ground)} fill="url(#soil)" stroke="none" />
      <polyline points={pts([[backTop, H], [slopeEnd, H + (slopeEnd - backTop) * tanB], [xmax, H + (slopeEnd - backTop) * tanB]])} fill="none" stroke="#8a6a4f" strokeWidth="1.2" />
      <polyline points={pts([[xmin, front], [front > D ? frontFace(front) : 0, front]])} fill="none" stroke="#8a6a4f" strokeWidth="1.2" />
      <polygon points={pts(concrete)} fill="#d4d4d8" stroke="#3f3f46" strokeWidth="1.2" />
      <polygon points={pts(pressure)} fill="#ef4444" fillOpacity="0.12" stroke="#ef4444" strokeWidth="0.8" />
      <line x1={X(B + pw * 0.9)} y1={Y(ph / 3)} x2={X(B + 0.05)} y2={Y(ph / 3)} stroke="#dc2626" strokeWidth="1.5" markerEnd="url(#arrow)" />
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626" />
        </marker>
      </defs>
      <text x={X(B + pw * 0.95)} y={Y(ph / 3) - 4} fontSize="10" fill="#dc2626" textAnchor="end">
        Pa = {result.loads.Pa.toFixed(2)} k/ft
      </text>
      {dim(0, -dKey - 0.12 * span * 0.5, B, -dKey - 0.12 * span * 0.5, `B = ${fmtFt(B)}`, "below")}
      {dim(0, H + 0.08 * span, A, H + 0.08 * span, `A = ${fmtFt(A)}`, "above")}
      {dim(A + T1, H + 0.15 * span, backTop, H + 0.15 * span, `${fmtFt(Tt)}`, "above")}
      {dim(xmin + 0.08 * span, front, xmin + 0.08 * span, H, `He = ${fmtFt(inputs.He)}`, "right")}
      {dim(-0.12 * span, 0, -0.12 * span, D, `D = ${fmtFt(D)}`, "left")}
      {dim(-0.25 * span, 0, -0.25 * span, H, `H = ${fmtFt(H)}`, "left")}
      {inputs.shearKey && dim(Xkey + Dw + 0.05 * span, -dKey, Xkey + Dw + 0.05 * span, 0, `key ${fmtFt(Dw)} wide × ${fmtFt(dKey)}`, "right")}
    </svg>
  );
}

/** An MSE wall's section, to scale: facing, reinforced zone with its layers, the active zone, the
 * backslope, the ground in front and the main dimensions. */
export function MseSketch({ inputs, result }: { inputs: MseInputs; result: MseResult }) {
  const { H, L } = inputs;
  const tanB = Math.tan((result.soil.beta * Math.PI) / 180);
  const tp = inputs.panelT / 12;
  const span = Math.max(L, H);
  const xmin = -0.35 * span;
  const xmax = L + 0.45 * span;
  const rise = Math.min((xmax - tp) * tanB, 0.5 * span);
  const ymin = -0.12 * span;
  const ymax = H + rise + 0.12 * span;
  const s = Math.min((W - 40) / (xmax - xmin), (HPX - 30) / (ymax - ymin));
  const X = (x: number) => 20 + (x - xmin) * s;
  const Y = (y: number) => HPX - 15 - (y - ymin) * s;
  const pts = (p: [number, number][]) => p.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" ");
  const top = (x: number) => H + Math.min((x - tp) * tanB, rise);
  const slopeEnd = tanB > 0 ? tp + rise / tanB : xmax;
  const surface: [number, number][] = [[tp, H], [Math.min(slopeEnd, xmax), top(Math.min(slopeEnd, xmax))], [xmax, top(xmax)]];
  const extensible = result.internal.kind.extensible;
  const active: [number, number][] = extensible ? [[tp, 0], [tp + H * Math.tan(((45 - inputs.phiR / 2) * Math.PI) / 180), H]] : (() => {
    const H1 = result.internal.H1 ?? H;
    const yb = Math.min(H, 0.5 * H1);
    return [[tp, 0], [tp + 0.6 * yb, yb], [tp + 0.3 * H1, H]];
  })();
  const emb = Math.min(inputs.embedment, H);
  const pad = 0.5;

  const dim = (x1: number, y1: number, x2: number, y2: number, label: string, side: "below" | "left" | "above" | "right") => {
    const [ax, ay, bx, by] = [X(x1), Y(y1), X(x2), Y(y2)];
    const horizontal = Math.abs(ay - by) < 1;
    const tx = (ax + bx) / 2 + (side === "left" ? -6 : side === "right" ? 6 : 0);
    const ty = (ay + by) / 2 + (side === "below" ? 13 : side === "above" ? -5 : 3);
    return (
      <g className="text-muted-foreground" key={`${label}${x1}${y1}`}>
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke="currentColor" strokeWidth="0.75" />
        {horizontal ? (
          <>
            <line x1={ax} y1={ay - 3} x2={ax} y2={ay + 3} stroke="currentColor" strokeWidth="0.75" />
            <line x1={bx} y1={by - 3} x2={bx} y2={by + 3} stroke="currentColor" strokeWidth="0.75" />
          </>
        ) : (
          <>
            <line x1={ax - 3} y1={ay} x2={ax + 3} y2={ay} stroke="currentColor" strokeWidth="0.75" />
            <line x1={bx - 3} y1={by} x2={bx + 3} y2={by} stroke="currentColor" strokeWidth="0.75" />
          </>
        )}
        <text x={tx} y={ty} fontSize="10" textAnchor={side === "left" ? "end" : side === "right" ? "start" : "middle"} fill="currentColor">
          {label}
        </text>
      </g>
    );
  };

  return (
    <svg viewBox={`0 0 ${W} ${HPX}`} className="h-auto w-full" role="img" aria-label="MSE wall section">
      <defs>
        <pattern id="mse-soil" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#b08968" strokeWidth="1" opacity="0.45" />
        </pattern>
        <pattern id="mse-fill" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="0.8" fill="#a1887f" opacity="0.5" />
        </pattern>
      </defs>
      {/* Retained fill and foundation */}
      <polygon points={pts([[L + tp, 0], [L + tp, top(L + tp)], ...surface.filter(([x]) => x > L + tp), [xmax, ymin + 0.02 * span], [xmin, ymin + 0.02 * span], [xmin, emb], [0, emb], [0, -pad], [L + tp, -pad]])} fill="url(#mse-soil)" />
      {/* Reinforced zone */}
      <polygon points={pts([[tp, 0], [tp, H], ...surface.filter(([x]) => x > tp && x < L + tp), [L + tp, top(L + tp)], [L + tp, 0]])} fill="url(#mse-fill)" stroke="#a1887f" strokeWidth="0.6" strokeDasharray="4 3" />
      <polyline points={pts(surface)} fill="none" stroke="#8a6a4f" strokeWidth="1.2" />
      <polyline points={pts([[xmin, emb], [0, emb]])} fill="none" stroke="#8a6a4f" strokeWidth="1.2" />
      {/* Layers */}
      {result.internal.layers.map((l) => (
        <line key={l.z} x1={X(tp)} y1={Y(H - l.z)} x2={X(tp + L)} y2={Y(H - l.z)} stroke={extensible ? "#16a34a" : "#475569"} strokeWidth="1.3" />
      ))}
      {/* Active zone */}
      <polyline points={pts(active)} fill="none" stroke="#dc2626" strokeWidth="1" strokeDasharray="5 3" />
      {/* Facing and leveling pad */}
      <rect x={X(0)} y={Y(H)} width={tp * s} height={H * s} fill="#d4d4d8" stroke="#3f3f46" strokeWidth="1" />
      {Array.from({ length: Math.max(0, Math.floor(H / 5)) }, (_, k) => (
        <line key={k} x1={X(0)} y1={Y((k + 1) * 5)} x2={X(tp)} y2={Y((k + 1) * 5)} stroke="#3f3f46" strokeWidth="0.6" />
      ))}
      <rect x={X(-0.25)} y={Y(0)} width={(tp + 0.5) * s} height={pad * s} fill="#d4d4d8" stroke="#3f3f46" strokeWidth="0.8" />
      {dim(tp, -0.07 * span, tp + L, -0.07 * span, `L = ${fmtFt(L)}`, "below")}
      {dim(-0.18 * span, 0, -0.18 * span, H, `H = ${fmtFt(H)}`, "left")}
      {emb > 0 && dim(-0.06 * span, 0, -0.06 * span, emb, `${fmtFt(inputs.embedment)}`, "left")}
      <text x={X(tp + L * 0.5)} y={Y(H * 0.5) + 3} fontSize="10" textAnchor="middle" className="fill-muted-foreground">
        {result.internal.layers.length} layers @ {fmtFt(inputs.Sv)}
      </text>
      <text x={X(active[active.length - 1][0]) + 4} y={Y(H) + 12} fontSize="9" fill="#dc2626">
        active zone
      </text>
    </svg>
  );
}
