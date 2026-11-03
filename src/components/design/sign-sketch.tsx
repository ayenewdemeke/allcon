import type { SignInputs, SignResult } from "@/lib/design/signs/cantilever";

// The cantilever sign structure in elevation, to scale: the shaft below the ground, the pole, the
// arm and the sign panel, with the wind on the panel, redrawn as the inputs change.

const VW = 520;
const VH = 320;
const LINE = "#334155";
const STEEL = "#94a3b8";
const SIGN = "#16a34a";
const CONCRETE = "#e2e8f0";
const WIND = "#2563eb";

export function SignSketch({ inputs, result }: { inputs: SignInputs; result: SignResult }) {
  const top = inputs.poleLength;
  const s = Math.min(270 / (top + inputs.shaftLength), 360 / (inputs.armLength + 6));
  const ox = 90;
  const ground = 30 + top * s;
  const Y = (z: number) => ground - z * s; // z up from the top of the shaft (at the ground)
  const X = (x: number) => ox + x * s;
  const zArm = result.wind.zArm;
  const signL = inputs.signOffset - inputs.signLength / 2;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Cantilever sign structure">
      <rect x={X(-inputs.shaftD / 24)} y={Y(0)} width={(inputs.shaftD / 12) * s} height={inputs.shaftLength * s} fill={CONCRETE} stroke={LINE} strokeWidth="1" />
      <line x1={X(-3)} y1={Y(0)} x2={X(inputs.armLength + 2)} y2={Y(0)} stroke={LINE} strokeWidth="1.2" />
      <polygon points={`${X(-inputs.poleBase / 24)},${Y(0)} ${X(inputs.poleBase / 24)},${Y(0)} ${X(inputs.poleTop / 24)},${Y(top)} ${X(-inputs.poleTop / 24)},${Y(top)}`} fill={STEEL} stroke={LINE} strokeWidth="0.8" />
      <polygon points={`${X(0)},${Y(zArm) - (inputs.armBase / 24) * s} ${X(inputs.armLength)},${Y(zArm) - (inputs.armEnd / 24) * s} ${X(inputs.armLength)},${Y(zArm) + (inputs.armEnd / 24) * s} ${X(0)},${Y(zArm) + (inputs.armBase / 24) * s}`} fill={STEEL} stroke={LINE} strokeWidth="0.8" />
      <rect x={X(signL)} y={Y(zArm) - (inputs.signHeight / 2) * s} width={inputs.signLength * s} height={inputs.signHeight * s} fill={SIGN} stroke={LINE} strokeWidth="1" />
      <text x={X(inputs.signOffset)} y={Y(zArm) + 4} textAnchor="middle" fontSize="11" fill="#ffffff">
        {inputs.signLength}&apos; × {inputs.signHeight}&apos;
      </text>
      <text x={X(inputs.signOffset)} y={Y(zArm) - (inputs.signHeight / 2) * s - 8} textAnchor="middle" fontSize="10" fill={WIND}>
        wind {result.wind.qSign.toFixed(1)} psf → {result.wind.Wsign.toFixed(2)} kip
      </text>
      <text x={X(0.6)} y={Y(top / 2)} fontSize="10" fill={LINE}>
        pole {inputs.poleLength}&apos;
      </text>
      <text x={X(0.9)} y={Y(-inputs.shaftLength / 2)} fontSize="10" fill={LINE}>
        shaft Ø{inputs.shaftD}&quot; × {inputs.shaftLength}&apos;
      </text>
      <text x={X(-3)} y={Y(0) - 4} fontSize="10" fill={LINE}>
        ground
      </text>
      <text x={VW - 10} y={VH - 14} textAnchor="end" fontSize="10" fill={LINE}>
        At the shaft top (Extreme I): M {result.extreme.M.toFixed(1)} kip·ft, T {result.extreme.T.toFixed(1)} kip·ft, V {result.extreme.V.toFixed(2)} kip
      </text>
    </svg>
  );
}
