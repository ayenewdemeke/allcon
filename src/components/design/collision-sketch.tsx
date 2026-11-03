import type { CollisionInputs, CollisionResult } from "@/lib/design/piers/collision";

// The pier column and the collision force, to scale (left), and the column's axial load–moment
// interaction diagram with the collision's demands on it (right), redrawn as the inputs change.

const VW = 520;
const VH = 320;
const LINE = "#334155";
const CONCRETE = "#e2e8f0";
const FORCE = "#dc2626";
const CURVE = "#2563eb";

export function CollisionSketch({ inputs, result }: { inputs: CollisionInputs; result: CollisionResult }) {
  // Elevation: fixity at the bottom, cap at the top.
  const s = 250 / (result.L + inputs.capDepth / 2);
  const ox = 80;
  const Y = (z: number) => 290 - z * s; // z up from the fixity
  const w = Math.max((inputs.D / 12) * s, 8);
  const ground = Y(inputs.fixity);
  // Interaction diagram.
  const px = 260;
  const pw = 230;
  const ph = 240;
  const Pmax = Math.max(...result.curve.map((p) => p.P), result.section.P0);
  const Pmin = Math.min(...result.curve.map((p) => p.P), 0);
  const Mmax = Math.max(...result.curve.map((p) => p.M), result.Mu) * 1.1;
  const X2 = (M: number) => px + (M / Mmax) * pw;
  const Y2 = (P: number) => 40 + ((Pmax - P) / (Pmax - Pmin)) * ph;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Pier column and interaction diagram">
      <text x={ox} y={20} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Column
      </text>
      <rect x={ox - 50} y={Y(result.L + inputs.capDepth / 2)} width={100} height={inputs.capDepth * s} fill={CONCRETE} stroke={LINE} strokeWidth="1" />
      <rect x={ox - w / 2} y={Y(result.L - inputs.capDepth / 2)} width={w} height={(result.L - inputs.capDepth / 2) * s} fill={CONCRETE} stroke={LINE} strokeWidth="1" />
      <line x1={ox - 60} y1={ground} x2={ox + 60} y2={ground} stroke={LINE} strokeWidth="1.2" />
      <text x={ox + 62} y={ground + 4} fontSize="10" fill={LINE}>
        ground
      </text>
      <line x1={ox - 30} y1={Y(0)} x2={ox + 30} y2={Y(0)} stroke={LINE} strokeWidth="2" />
      <text x={ox + 34} y={Y(0) + 4} fontSize="10" fill={LINE}>
        fixity
      </text>
      <line x1={ox - w / 2 - 50} y1={Y(result.a)} x2={ox - w / 2 - 4} y2={Y(result.a)} stroke={FORCE} strokeWidth="2.5" />
      <polygon points={`${ox - w / 2 - 4},${Y(result.a)} ${ox - w / 2 - 12},${Y(result.a) - 5} ${ox - w / 2 - 12},${Y(result.a) + 5}`} fill={FORCE} />
      <text x={ox - w / 2 - 52} y={Y(result.a) - 8} fontSize="10" fill={FORCE}>
        CT {inputs.CT} kip
      </text>

      <text x={px + pw / 2} y={20} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Axial load–moment (nominal)
      </text>
      <line x1={px} y1={Y2(0)} x2={px + pw} y2={Y2(0)} stroke={LINE} strokeWidth="0.6" />
      <line x1={px} y1={40} x2={px} y2={40 + ph} stroke={LINE} strokeWidth="0.6" />
      <polyline points={result.curve.map((p) => `${X2(Math.max(p.M, 0))},${Y2(p.P)}`).join(" ")} fill="none" stroke={CURVE} strokeWidth="1.6" />
      {result.cases.map((c) => (
        <circle key={c.gamma} cx={X2(result.Mu)} cy={Y2(c.Pu)} r={4} fill={FORCE} />
      ))}
      <text x={X2(result.Mu) + 6} y={Y2(result.cases[1].Pu) - 6} fontSize="10" fill={FORCE}>
        Mu {result.Mu.toFixed(0)} kip·ft
      </text>
      <text x={px + pw} y={Y2(0) + 14} textAnchor="end" fontSize="10" fill={LINE}>
        M (kip·ft)
      </text>
      <text x={px + 4} y={48} fontSize="10" fill={LINE}>
        P (kip)
      </text>
    </svg>
  );
}
