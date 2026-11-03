import type { WingwallInputs, WingwallResult } from "@/lib/design/walls/wingwall";

// The wingwall's elevation, to scale, redrawn as its inputs change: the wall off the abutment, the
// part of its retained face the earth pressure acts on (to a line from H at the abutment to h at
// the tip; below it, neglected), and where the thrust acts.

const VW = 520;
const VH = 300;
const LINE = "#334155";
const LOADED = "#fde68a";
const CONCRETE = "#e2e8f0";
const ABUTMENT = "#94a3b8";
const THRUST = "#dc2626";

const ft = (v: number) => `${Number(v.toFixed(2))}'`;

export function WingwallSketch({ inputs, result }: { inputs: WingwallInputs; result: WingwallResult }) {
  const { H, h, L } = inputs;
  const abut = Math.max(1.5, inputs.A);
  const s = Math.min((VW - 110) / (L + abut), (VH - 90) / H);
  const ox = 40 + abut * s; // the abutment face, at x = 0
  const oy = 40; // the top of the wall
  const X = (x: number) => ox + x * s;
  const Y = (z: number) => oy + z * s; // z down from the top
  const { x, y } = result.service;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Wingwall elevation">
      <text x={VW / 2} y={20} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Elevation (retained face)
      </text>
      <rect x={X(-abut)} y={Y(0)} width={abut * s} height={H * s + 20} fill={ABUTMENT} />
      <text x={X(-abut / 2)} y={Y(H) + 34} textAnchor="middle" fontSize="11" fill={LINE}>
        Abutment
      </text>
      <rect x={X(0)} y={Y(0)} width={L * s} height={H * s} fill={CONCRETE} stroke={LINE} strokeWidth="1" />
      <polygon points={`${X(0)},${Y(0)} ${X(L)},${Y(0)} ${X(L)},${Y(h)} ${X(0)},${Y(H)}`} fill={LOADED} stroke={LINE} strokeWidth="0.8" />
      <line x1={X(0)} y1={Y(H)} x2={X(L)} y2={Y(h)} stroke={LINE} strokeWidth="1" strokeDasharray="5 3" />
      <text x={X(L * 0.62)} y={Y(H + (h - H) * 0.62) + 16} textAnchor="middle" fontSize="10" fill={LINE}>
        pressure below this line neglected
      </text>
      <circle cx={X(x)} cy={Y(y)} r={5} fill={THRUST} />
      <text x={X(x) + 9} y={Y(y) + 4} fontSize="11" fill={THRUST}>
        P = {result.service.P.toFixed(1)} kip (service)
      </text>
      <line x1={X(0)} y1={Y(H) + 14} x2={X(L)} y2={Y(H) + 14} stroke={LINE} strokeWidth="0.8" />
      <text x={X(L / 2)} y={Y(H) + 28} textAnchor="middle" fontSize="11" fill={LINE}>
        L = {ft(L)}
      </text>
      <line x1={X(L) + 12} y1={Y(0)} x2={X(L) + 12} y2={Y(h)} stroke={LINE} strokeWidth="0.8" />
      <text x={X(L) + 16} y={Y(h / 2) + 4} fontSize="11" fill={LINE}>
        h = {ft(h)}
      </text>
      <text x={X(0) + 6} y={Y(H / 2)} fontSize="11" fill={LINE}>
        H = {ft(H)}
      </text>
      <text x={X(0) + 6} y={Y(0) + 14} fontSize="10" fill={LINE}>
        Section A
      </text>
    </svg>
  );
}
