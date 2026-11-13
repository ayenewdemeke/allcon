import type { DeckInputs, DeckResult } from "@/lib/design/decks/deck";

// The deck's cross-section, redrawn as its inputs change: the slab (thickness exaggerated), the
// girders, the barriers, and the governing design sections, with the strip's dead load moment
// diagram below it.

const VW = 520;
const VH = 300;
const LINE = "#334155";
const SLAB = "#e2e8f0";
const BARRIER = "#94a3b8";
const POS = "#16a34a";
const NEG = "#dc2626";

export function DeckSketch({ inputs, result }: { inputs: DeckInputs; result: DeckResult }) {
  const { W, girders, bw } = result.geometry;
  const s = (VW - 60) / W;
  const X = (x: number) => 30 + x * s;
  const ts = 2.2; // px per inch of thickness (exaggerated)
  const top = 90;
  const slab = Array.from({ length: 101 }, (_, k) => (k / 100) * W);
  const bottom = slab.map((x) => `${X(x)},${top + result.thickness(x) * ts}`).join(" ");
  // Dead load moment diagram (DC + DW), below the section.
  const base = 230;
  const pts = slab.map((x) => ({ x, m: result.moments.DC(x) + result.moments.DW(x) }));
  const mMax = Math.max(...pts.map((p) => Math.abs(p.m)), 1e-9);
  const ms = 40 / mMax;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Deck cross-section">
      <text x={VW / 2} y={20} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Cross-section ({result.geometry.W.toFixed(1)} ft, slab thickness exaggerated)
      </text>
      <polygon points={`${X(0)},${top} ${X(W)},${top} ${bottom.split(" ").reverse().join(" ")}`} fill={SLAB} stroke={LINE} strokeWidth="1" />
      {result.rail
        ? [1, -1].map((side) => {
            const rl = result.rail!.rail;
            const k = 44 / rl.height; // px per inch of the rail's height
            const px = (x: number) => (side > 0 ? X(x / 12) : X(W - x / 12));
            return (
              <g key={side}>
                <polygon points={rl.outline.map(([x, y]) => `${px(x)},${top - y * k}`).join(" ")} fill={BARRIER} stroke={LINE} strokeWidth="0.8" />
                {rl.posts && <line x1={px(rl.posts.x)} y1={top - 13 * k} x2={px(rl.posts.x)} y2={top - rl.height * k} stroke={LINE} strokeWidth="1.5" />}
                {rl.posts?.tubes.map((t) => <rect key={t.y0} x={Math.min(px(t.x0), px(t.x1))} y={top - t.y1 * k} width={Math.abs(px(t.x1) - px(t.x0))} height={(t.y1 - t.y0) * k} fill="none" stroke={LINE} strokeWidth="0.8" />)}
              </g>
            );
          })
        : [0, W - bw].map((x) => <rect key={x} x={X(x)} y={top - 44} width={bw * s} height={44} fill={BARRIER} stroke={LINE} strokeWidth="0.8" />)}
      {result.rail && (
        <text x={X(0)} y={top - 50} fontSize="10" fill={LINE}>
          {result.rail.rail.name}
        </text>
      )}
      {girders.map((g) => (
        <g key={g}>
          <rect x={X(g) - (inputs.flange / 24) * s} y={top + inputs.t * ts} width={(inputs.flange / 12) * s} height={5} fill={LINE} />
          <rect x={X(g) - 3} y={top + inputs.t * ts + 5} width={6} height={30} fill={LINE} />
        </g>
      ))}
      <line x1={X(result.pos.x)} y1={top - 8} x2={X(result.pos.x)} y2={top + 40} stroke={POS} strokeWidth="1.5" />
      <text x={X(result.pos.x)} y={top - 12} textAnchor="middle" fontSize="10" fill={POS}>
        +M {result.pos.Mu.toFixed(2)}
      </text>
      <line x1={X(result.neg.x)} y1={top - 8} x2={X(result.neg.x)} y2={top + 40} stroke={NEG} strokeWidth="1.5" />
      <text x={X(result.neg.x)} y={top - 12} textAnchor="middle" fontSize="10" fill={NEG}>
        −M {Math.abs(result.neg.Mu).toFixed(2)}
      </text>
      <text x={30} y={base - 50} fontSize="11" fill={LINE}>
        Dead load moment, DC + DW (kip·ft/ft, sagging down)
      </text>
      <line x1={X(0)} y1={base} x2={X(W)} y2={base} stroke={LINE} strokeWidth="0.6" />
      <polyline points={pts.map((p) => `${X(p.x)},${base + p.m * ms}`).join(" ")} fill="none" stroke={LINE} strokeWidth="1.3" />
      <text x={30} y={VH - 10} fontSize="10" fill={LINE}>
        Strength I design moments (kip·ft/ft), at the governing sections
      </text>
    </svg>
  );
}
