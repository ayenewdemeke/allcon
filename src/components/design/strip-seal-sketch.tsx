import type { StripSealInputs, StripSealResult } from "@/lib/design/joints/strip-seal";

// The strip seal joint in section at the planned installation temperature: the two rails, the
// gland and the gap A, with its range when coldest and hottest, redrawn as the inputs change.

const VW = 520;
const VH = 220;
const LINE = "#334155";
const DECK = "#e2e8f0";
const STEEL = "#64748b";
const GLAND = "#1f2937";

export function StripSealSketch({ inputs, result }: { inputs: StripSealInputs; result: StripSealResult }) {
  const d = result.design;
  const A = Math.max(d.A, 0.1);
  const s = Math.min(40, 300 / (A + 2 * inputs.rail + 4));
  const cx = VW / 2;
  const top = 80;
  const left = cx - (A / 2) * s;
  const right = cx + (A / 2) * s;
  const r = inputs.rail * s;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Strip seal joint">
      <text x={cx} y={20} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Joint at {inputs.Ti}°F (normal to the joint)
      </text>
      <rect x={20} y={top} width={left - r - 20} height={70} fill={DECK} stroke={LINE} strokeWidth="1" />
      <rect x={right + r} y={top} width={VW - 20 - right - r} height={70} fill={DECK} stroke={LINE} strokeWidth="1" />
      <rect x={left - r} y={top} width={r} height={40} fill={STEEL} />
      <rect x={right} y={top} width={r} height={40} fill={STEEL} />
      <path d={`M ${left} ${top + 10} Q ${cx} ${top + 45} ${right} ${top + 10}`} fill="none" stroke={GLAND} strokeWidth="3" />
      <line x1={left} y1={top - 14} x2={right} y2={top - 14} stroke={LINE} strokeWidth="0.8" />
      <text x={cx} y={top - 20} textAnchor="middle" fontSize="11" fill={LINE}>
        A = {d.A.toFixed(2)}&quot;
      </text>
      <line x1={left - r} y1={top + 92} x2={right + r} y2={top + 92} stroke={LINE} strokeWidth="0.8" />
      <text x={cx} y={top + 106} textAnchor="middle" fontSize="11" fill={LINE}>
        W = {d.W.toFixed(2)}&quot;
      </text>
      <text x={cx} y={VH - 12} textAnchor="middle" fontSize="10" fill={LINE}>
        Opens {d.cold.toFixed(2)}&quot; to {(d.A + d.cold).toFixed(2)}&quot; when coldest · closes {d.hot.toFixed(2)}&quot; to {(d.A - d.hot).toFixed(2)}&quot; when hottest · seal {inputs.minOpening}–{inputs.maxOpening}&quot;
      </text>
    </svg>
  );
}
