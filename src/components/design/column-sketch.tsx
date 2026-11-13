import type { ColumnInputs, ColumnResult } from "@/lib/design/piers/column";

// The pier column's section to scale, its bars and ties (left), and its factored interaction
// diagrams across and along the bridge with each case's magnified demand (right).

const VW = 560;
const VH = 300;
const LINE = "#334155";
const CONCRETE = "#e2e8f0";
const BAR = "#1e3a8a";
const CURVE_T = "#2563eb";
const CURVE_L = "#64748b";
const OK = "#16a34a";
const NG = "#dc2626";

export function ColumnSectionSketch({ inputs, result }: { inputs: ColumnInputs; result: ColumnResult }) {
  const s = result.section;
  const W = inputs.shape === "round" ? inputs.T : inputs.W;
  const scale = Math.min(200 / inputs.T, 200 / W);
  const cx = 130;
  const cy = 150;
  const P = (x: number, y: number) => `${cx + x * scale},${cy - y * scale}`;
  const tieOff = inputs.cover;
  const inner = s.outline.map(([x, y]) => {
    const r = Math.hypot(x, y) || 1;
    // The tie line drawn a cover inside the outline (exact for the straight faces, close on the curves).
    return [x - (Math.sign(x) * tieOff * Math.abs(x)) / r, y - (Math.sign(y) * tieOff * Math.abs(y)) / r];
  });
  return (
    <g>
      <text x={cx} y={20} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Section
      </text>
      <polygon points={s.outline.map(([x, y]) => P(x, y)).join(" ")} fill={CONCRETE} stroke={LINE} strokeWidth="1" />
      <polygon points={inner.map(([x, y]) => P(x, y)).join(" ")} fill="none" stroke={LINE} strokeWidth="0.8" strokeDasharray={inputs.transverse === "spiral" ? "4 2" : undefined} />
      {s.bars.map(([x, y], k) => (
        <circle key={k} cx={cx + x * scale} cy={cy - y * scale} r={Math.max(1.5, (s.db / 2) * scale)} fill={BAR} />
      ))}
      <text x={cx} y={cy + (W / 2) * scale + 18} textAnchor="middle" fontSize="10" fill={LINE}>
        {inputs.shape === "round" ? `${inputs.T} in dia.` : `${inputs.T} in across × ${W} in along`}, {s.bars.length} #{inputs.bar}
      </text>
      <text x={cx} y={cy + (W / 2) * scale + 32} textAnchor="middle" fontSize="10" fill={LINE}>
        {inputs.transverse === "spiral" ? `#${inputs.tieBar} spiral @ ${inputs.tieSpacing} in` : `#${inputs.tieBar} ties @ ${inputs.tieSpacing} in`}, ρ = {(result.rho * 100).toFixed(2)}%
      </text>
      <text x={cx + (inputs.T / 2) * scale + 6} y={cy + 4} fontSize="9" fill={LINE}>
        T
      </text>
    </g>
  );
}

export function InteractionSketch({ result, ox = 0 }: { result: ColumnResult; ox?: number }) {
  const px = ox + 40;
  const pw = 230;
  const ph = 220;
  const top = 40;
  const all = [...result.curves.T, ...result.curves.L];
  const pts = [...result.rows, ...(result.collision?.rows ?? [])].filter((r) => Number.isFinite(r.Mu));
  const Pmax = Math.max(...all.map((p) => p.P), ...pts.map((p) => p.P), result.PrMax);
  const Pmin = Math.min(...all.map((p) => p.P), 0);
  const Mmax = Math.max(...all.map((p) => p.M / 12), ...pts.map((p) => p.Mu)) * 1.08 || 1; // kip·ft
  const X = (M: number) => px + (M / Mmax) * pw;
  const Y = (P: number) => top + ((Pmax - P) / (Pmax - Pmin || 1)) * ph;
  const curve = (c: { P: number; M: number }[]) =>
    c
      .filter((p) => p.P <= result.PrMax + 1e-6)
      .map((p) => `${X(Math.max(0, p.M))},${Y(p.P)}`)
      .join(" ");
  return (
    <g>
      <text x={px + pw / 2} y={20} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Factored interaction (φPn–φMn)
      </text>
      <line x1={px} y1={Y(0)} x2={px + pw} y2={Y(0)} stroke={LINE} strokeWidth="0.6" />
      <line x1={px} y1={top} x2={px} y2={top + ph} stroke={LINE} strokeWidth="0.6" />
      <line x1={px} y1={Y(result.PrMax)} x2={px + pw} y2={Y(result.PrMax)} stroke={LINE} strokeWidth="0.6" strokeDasharray="3 3" />
      <polyline points={curve(result.curves.T.map((p) => ({ P: p.P, M: p.M / 12 })))} fill="none" stroke={CURVE_T} strokeWidth="1.6" />
      <polyline points={curve(result.curves.L.map((p) => ({ P: p.P, M: p.M / 12 })))} fill="none" stroke={CURVE_L} strokeWidth="1.2" strokeDasharray="5 3" />
      {pts.map((r, k) => (
        <circle key={k} cx={X(r.Mu)} cy={Y(r.P)} r={2.6} fill={r.ratio <= 1 ? OK : NG} opacity={0.8} />
      ))}
      <text x={px + pw} y={Y(0) + 14} textAnchor="end" fontSize="10" fill={LINE}>
        M (kip·ft)
      </text>
      <text x={px + 4} y={top + 8} fontSize="10" fill={LINE}>
        P (kip)
      </text>
      <text x={px + pw} y={top + 8} textAnchor="end" fontSize="9" fill={CURVE_T}>
        across
      </text>
      <text x={px + pw} y={top + 20} textAnchor="end" fontSize="9" fill={CURVE_L}>
        along
      </text>
      <text x={px + pw} y={Y(result.PrMax) - 3} textAnchor="end" fontSize="9" fill={LINE}>
        φ k P0
      </text>
    </g>
  );
}

export function ColumnSketch({ inputs, result }: { inputs: ColumnInputs; result: ColumnResult }) {
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Pier column section and interaction diagram">
      <ColumnSectionSketch inputs={inputs} result={result} />
      <InteractionSketch result={result} ox={260} />
    </svg>
  );
}
