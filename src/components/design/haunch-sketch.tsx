import type { HaunchInputs, HaunchResult } from "@/lib/design/girders/haunch";

// The span in elevation, vertical scale exaggerated: the deck's bottom over the girder (the profile
// relative to the bearings' chord) and the girder's top (camber less dead load deflection), the
// haunch between them, redrawn as the inputs change.

const VW = 520;
const VH = 260;
const LINE = "#334155";
const GIRDER = "#94a3b8";
const HAUNCH = "#fde68a";

export function HaunchSketch({ inputs, result }: { inputs: HaunchInputs; result: HaunchResult }) {
  const x0 = 40;
  const w = VW - 80;
  const n = 40;
  // Inches, up: the girder's top (parabolic camber + deflection) and the deck's bottom.
  const pts = Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n;
    const shape = 4 * t * (1 - t); // parabola, 1 at midspan
    const girder = (inputs.camber + inputs.deflection) * shape;
    const deck = inputs.D1 + result.deckEffect * shape;
    return { x: x0 + t * w, girder, deck };
  });
  const lo = Math.min(...pts.map((p) => p.girder)) - 8;
  const hi = Math.max(...pts.map((p) => p.deck)) + 2;
  const s = 120 / Math.max(hi - lo, 1);
  const Y = (v: number) => 190 - (v - lo) * s;
  const girderTop = pts.map((p) => `${p.x},${Y(p.girder)}`).join(" ");
  const deckBottom = pts.map((p) => `${p.x},${Y(p.deck)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Span elevation with the haunch">
      <text x={VW / 2} y={20} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Span elevation (vertical scale exaggerated)
      </text>
      <polygon points={`${girderTop} ${[...pts].reverse().map((p) => `${p.x},${Y(p.deck)}`).join(" ")}`} fill={HAUNCH} stroke="none" />
      <polygon points={`${girderTop} ${x0 + w},${Y(lo)} ${x0},${Y(lo)}`} fill={GIRDER} stroke={LINE} strokeWidth="0.8" />
      <polyline points={deckBottom} fill="none" stroke={LINE} strokeWidth="1.6" />
      <text x={x0} y={Y(pts[0].deck) - 8} fontSize="10" fill={LINE}>
        D1 = {inputs.D1}&quot;
      </text>
      <text x={x0 + w / 2} y={Y(pts[n / 2].deck) - 8} textAnchor="middle" fontSize="10" fill={LINE}>
        D2 = {result.D2.toFixed(2)}&quot; (under-camber {result.D2under.toFixed(2)}&quot;)
      </text>
      <text x={x0 + w / 2} y={Y(lo) + 26} textAnchor="middle" fontSize="10" fill={LINE}>
        L = {inputs.L} ft · deck profile effect {result.deckEffect.toFixed(2)}&quot; · camber less deflection {(inputs.camber + inputs.deflection).toFixed(2)}&quot;
      </text>
    </svg>
  );
}
