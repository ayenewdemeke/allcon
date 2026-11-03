import type { BearingInputs, BearingResult } from "@/lib/design/bearings/elastomeric";

// The bearing pad, to scale and redrawn as its inputs change: its plan (L along the bridge, W
// across) and its section along the bridge, layer by layer (elastomer and steel shims).

const VW = 520;
const VH = 260;
const ELASTOMER = "#f1d9a8";
const STEEL = "#64748b";
const LINE = "#334155";

const inch = (v: number) => `${Number(v.toFixed(3))}"`;

export function BearingSketch({ inputs, result }: { inputs: BearingInputs; result: BearingResult }) {
  const { L, W } = inputs;
  const steel = inputs.pad === "steel";
  // Plan, on the left.
  const ps = Math.min(190 / L, 170 / W);
  const px = 40 + (190 - L * ps) / 2;
  const py = 40 + (170 - W * ps) / 2;
  // Section along the bridge, on the right, its thickness to the same scale as its length.
  const ss = Math.min(180 / L, 150 / result.pad.height);
  const sx = 280 + (180 - L * ss) / 2;
  const sb = 40 + 150 / 2 + (result.pad.height * ss) / 2; // bottom of the pad
  const layers: { h: number; steel: boolean }[] = steel
    ? [{ h: inputs.hre, steel: false }, ...Array.from({ length: inputs.n }, () => [{ h: inputs.hs, steel: true }, { h: inputs.hri, steel: false }]).flat(), ...(inputs.covers === 1 ? [] : [{ h: inputs.hs, steel: true }, { h: inputs.hre, steel: false }])]
    : [{ h: inputs.hri, steel: false }];
  let y = sb;
  const rects = layers.map((layer, k) => {
    const h = layer.h * ss;
    y -= h;
    return <rect key={k} x={sx} y={y} width={L * ss} height={Math.max(h, 0.6)} fill={layer.steel ? STEEL : ELASTOMER} stroke={layer.steel ? "none" : LINE} strokeWidth="0.4" />;
  });
  const top = sb - result.pad.height * ss;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Bearing pad, plan and section">
      <text x={135} y={20} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Plan
      </text>
      <rect x={px} y={py} width={L * ps} height={W * ps} fill={ELASTOMER} stroke={LINE} strokeWidth="1" />
      <line x1={px} y1={py + W * ps + 14} x2={px + L * ps} y2={py + W * ps + 14} stroke={LINE} strokeWidth="0.8" />
      <text x={px + (L * ps) / 2} y={py + W * ps + 28} textAnchor="middle" fontSize="11" fill={LINE}>
        L = {inch(L)} (along the bridge)
      </text>
      <line x1={px - 14} y1={py} x2={px - 14} y2={py + W * ps} stroke={LINE} strokeWidth="0.8" />
      <text x={px - 20} y={py + (W * ps) / 2} textAnchor="middle" fontSize="11" fill={LINE} transform={`rotate(-90 ${px - 20} ${py + (W * ps) / 2})`}>
        W = {inch(W)}
      </text>

      <text x={370} y={20} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Section
      </text>
      {rects}
      <line x1={sx + L * ss + 12} y1={top} x2={sx + L * ss + 12} y2={sb} stroke={LINE} strokeWidth="0.8" />
      <text x={sx + L * ss + 18} y={(top + sb) / 2 + 4} fontSize="11" fill={LINE}>
        {inch(result.pad.height)}
      </text>
      <text x={sx + (L * ss) / 2} y={sb + 22} textAnchor="middle" fontSize="11" fill={LINE}>
        {steel ? `${inputs.n} layers of ${inch(inputs.hri)}, covers ${inch(inputs.hre)}, ${result.pad.shims} shims of ${inch(inputs.hs)}` : `Plain pad, ${inch(inputs.hri)}`}
      </text>
      <text x={sx + (L * ss) / 2} y={sb + 38} textAnchor="middle" fontSize="11" fill={LINE}>
        hrt = {inch(result.pad.hrt)} · S = {result.pad.S.toFixed(2)}
      </text>
    </svg>
  );
}
