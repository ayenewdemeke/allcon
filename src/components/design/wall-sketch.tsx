import type { CbcInputs, CbcResult } from "@/lib/design/culverts/cbc";
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
  const Xkey = result.stability.key.Xkey;
  const tanB = Math.tan((result.soil.beta * Math.PI) / 180);
  const span = Math.max(B, H);
  const xmin = -0.45 * span;
  const xmax = B + 0.55 * span;
  const rise = (xmax - (A + T1 + Tt)) * tanB;
  const ymin = -dKey - 0.25 * span * 0.3;
  const ymax = H + Math.min(rise, 0.6 * span) + 0.2 * span;
  const s = Math.min((W - 40) / (xmax - xmin), (HPX - 30) / (ymax - ymin));
  const ox = 20 + (W - 40 - (xmax - xmin) * s) / 2; // centered across the frame
  const X = (x: number) => ox + (x - xmin) * s;
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
  const ox = 20 + (W - 40 - (xmax - xmin) * s) / 2; // centered across the frame
  const X = (x: number) => ox + (x - xmin) * s;
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

/** A box culvert's section, to scale: the cells with their haunches, the fill over it, and
 * (optionally) the factored moment envelope drawn on the members' tension side. */
export function CbcSketch({ inputs, result, moments }: { inputs: CbcInputs; result: CbcResult; moments: boolean }) {
  const { xs, B, yTop, n, members, nodes } = result.model;
  const tt = inputs.Tt / 12;
  const tb = inputs.Tb / 12;
  const ts = inputs.Ts / 12;
  const ti = inputs.Ti / 12;
  const th = inputs.haunch / 12;
  const wallT = (k: number) => (k === 0 || k === n ? ts : ti);
  const outer = { x0: -ts / 2, x1: B + ts / 2, y0: -tb / 2, y1: yTop + tt / 2 };
  const fillShown = Math.min(inputs.fill, 0.6 * (outer.y1 - outer.y0));
  const span = Math.max(outer.x1 - outer.x0, outer.y1 - outer.y0 + fillShown);
  const xmin = outer.x0 - 0.18 * span;
  const xmax = outer.x1 + 0.12 * span;
  const ymin = outer.y0 - 0.14 * span;
  const ymax = outer.y1 + fillShown + 0.1 * span;
  const s = Math.min((W - 40) / (xmax - xmin), (HPX - 30) / (ymax - ymin));
  const ox = 20 + (W - 40 - (xmax - xmin) * s) / 2; // centered across the frame
  const X = (x: number) => ox + (x - xmin) * s;
  const Y = (y: number) => HPX - 15 - (y - ymin) * s;
  const pts = (p: [number, number][]) => p.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" ");
  const cells = Array.from({ length: n }, (_, k) => {
    const a = xs[k] + wallT(k) / 2;
    const b = xs[k + 1] - wallT(k + 1) / 2;
    const c = tb / 2;
    const d = tb / 2 + inputs.rise;
    const h = Math.min(th, (b - a) / 2, (d - c) / 2);
    return [
      [a + h, c],
      [b - h, c],
      [b, c + h],
      [b, d - h],
      [b - h, d],
      [a + h, d],
      [a, d - h],
      [a, c + h],
    ] as [number, number][];
  });
  const box = `M ${pts([[outer.x0, outer.y0], [outer.x1, outer.y0], [outer.x1, outer.y1], [outer.x0, outer.y1]])} Z ${cells.map((c) => `M ${pts(c)} Z`).join(" ")}`;
  const maxM = Math.max(1e-9, ...result.diagram.flatMap((d) => d.flatMap((p) => [Math.abs(p.max), Math.abs(p.min)])));
  const k = (0.12 * span) / maxM;
  const curve = (mi: number, key: "max" | "min") => {
    const mem = members[mi];
    const a = nodes[mem.start];
    const b = nodes[mem.end];
    const cx = (b.x - a.x) / mem.L;
    const cy = (b.y - a.y) / mem.L;
    // Positive moment (inside tension) plotted to the member's −y side.
    return result.diagram[mi].map((p) => [a.x + cx * p.s + cy * p[key] * k, a.y + cy * p.s - cx * p[key] * k] as [number, number]);
  };
  const label = (mi: number) => {
    const d = result.diagram[mi];
    const big = d.reduce((w, p) => (Math.max(Math.abs(p.max), Math.abs(p.min)) > Math.max(Math.abs(w.max), Math.abs(w.min)) ? p : w), d[0]);
    const v = Math.abs(big.max) >= Math.abs(big.min) ? big.max : big.min;
    const mem = members[mi];
    const a = nodes[mem.start];
    const b = nodes[mem.end];
    const cx = (b.x - a.x) / mem.L;
    const cy = (b.y - a.y) / mem.L;
    // Nudged toward the member's middle, so labels at a shared joint don't overlap.
    const sl = big.s + Math.sign(mem.L / 2 - big.s) * Math.min(Math.abs(mem.L / 2 - big.s), 0.08 * mem.L);
    return { x: a.x + cx * sl + cy * v * k, y: a.y + cy * sl - cx * v * k, v: v * 12 };
  };
  const centerline = members.map((mem) => [nodes[mem.start], nodes[mem.end]]);

  return (
    <svg viewBox={`0 0 ${W} ${HPX}`} className="h-auto w-full" role="img" aria-label="Box culvert section">
      <defs>
        <pattern id="cbc-soil" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#b08968" strokeWidth="1" opacity="0.45" />
        </pattern>
      </defs>
      {fillShown > 0 && <rect x={X(xmin)} y={Y(outer.y1 + fillShown)} width={(xmax - xmin) * s} height={fillShown * s} fill="url(#cbc-soil)" />}
      {fillShown > 0 && <line x1={X(xmin)} y1={Y(outer.y1 + fillShown)} x2={X(xmax)} y2={Y(outer.y1 + fillShown)} stroke="#8a6a4f" strokeWidth="1.2" strokeDasharray={fillShown < inputs.fill ? "6 3" : undefined} />}
      <path d={box} fill="#d4d4d8" fillRule="evenodd" stroke="#3f3f46" strokeWidth="1.2" />
      {moments && (
        <g>
          {centerline.map(([a, b], mi) => (
            <line key={mi} x1={X(a.x)} y1={Y(a.y)} x2={X(b.x)} y2={Y(b.y)} stroke="#71717a" strokeWidth="0.6" strokeDasharray="3 2" />
          ))}
          {members.map((_, mi) => {
            const up = curve(mi, "max");
            const down = curve(mi, "min");
            const mem = members[mi];
            const a = nodes[mem.start];
            const b = nodes[mem.end];
            const d = result.diagram[mi];
            if (!d.length) return null;
            const on = (u: number) => [a.x + ((b.x - a.x) * u) / mem.L, a.y + ((b.y - a.y) * u) / mem.L] as [number, number];
            return <polygon key={mi} points={pts([on(d[0].s), ...up, on(d[d.length - 1].s), ...down.reverse()])} fill="#2563eb" fillOpacity="0.16" stroke="#2563eb" strokeWidth="0.9" />;
          })}
          {members.map((_, mi) => {
            if (!result.diagram[mi].length) return null;
            const l = label(mi);
            return (
              <text key={mi} x={X(l.x)} y={Y(l.y) - 3} fontSize="9" textAnchor="middle" fill="#1d4ed8">
                {Math.abs(l.v).toFixed(0)}
              </text>
            );
          })}
        </g>
      )}
      {/* Dimensions */}
      <g className="text-muted-foreground" fill="currentColor" fontSize="10">
        <line x1={X(xs[0] + ts / 2)} y1={Y(outer.y0 - 0.06 * span)} x2={X(xs[1] - wallT(1) / 2)} y2={Y(outer.y0 - 0.06 * span)} stroke="currentColor" strokeWidth="0.75" />
        <text x={(X(xs[0] + ts / 2) + X(xs[1] - wallT(1) / 2)) / 2} y={Y(outer.y0 - 0.06 * span) + 13} textAnchor="middle">
          {n > 1 ? `${n} cells × ` : ""}
          {fmtFt(inputs.span)} span
        </text>
        <line x1={X(outer.x0 - 0.08 * span)} y1={Y(tb / 2)} x2={X(outer.x0 - 0.08 * span)} y2={Y(tb / 2 + inputs.rise)} stroke="currentColor" strokeWidth="0.75" />
        <text x={X(outer.x0 - 0.08 * span) - 4} y={(Y(tb / 2) + Y(tb / 2 + inputs.rise)) / 2} textAnchor="end">
          {fmtFt(inputs.rise)}
        </text>
        {inputs.fill > 0 && (
          <text x={X(outer.x1 + 0.03 * span)} y={(Y(outer.y1) + Y(outer.y1 + fillShown)) / 2 + 3}>
            H = {fmtFt(inputs.fill)}
          </text>
        )}
      </g>
    </svg>
  );
}
