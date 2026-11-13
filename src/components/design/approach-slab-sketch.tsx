import type { ApproachSlabInputs, ApproachSlabResult } from "@/lib/design/approach/approach-slab";

// The approach slab along the roadway, redrawn as its inputs change, laid out as CDOT worksheet
// B-601-1EA's Section A (B-601-1 without the device): the abutment with the slab on the notch's
// seat, the anchorage bar straight at mid-depth with its leg down in the abutment, the slab (its
// thickness exaggerated) with the #6 main bars at the bottom and the #4 ⊏ top bars down both ends,
// the HMA overlay, the void it is designed to span (from the abutment's back face), the sleeper
// slab with the slab on its ledge and, with the device, the block under it. Drawn as a calc figure too.

const VW = 520;
const VH = 220;
const LINE = "#334155";
const SLAB = "#e2e8f0";
const CONC = "#cbd5e1";
const EARTH = "#f5efe0";
const VOID = "#fee2e2";
const BAR = "#dc2626";
const TOPBAR = "#d97706";
const DOWEL = "#2563eb";
const HMA = "#94a3b8";
const GAP = 2; // in, the device's opening drawn between the slab's end and the block

export function ApproachSlabSketch({ inputs: i, result: r }: { inputs: ApproachSlabInputs; result: ApproachSlabResult }) {
  const device = i.sleeper && i.joint === "device";
  const seat = i.seat / 12; // ft
  const Ls = seat + i.L; // ft, the slab from the back of the notch
  const B = i.sleeperB;
  const sx0 = i.sleeper ? (device ? Ls + GAP / 12 - i.sleeperSeat / 12 : Ls - i.sleeperSeat / 12) : Ls; // ft, the sleeper's back edge
  const xb0 = Ls + GAP / 12; // ft, the block's face
  const right = i.sleeper ? Math.max(Ls, sx0 + B, device ? xb0 + i.blockW / 12 : 0) : Ls;
  const x0 = 80; // px, the slab's end at the abutment
  const s = (VW - x0 - 24) / right; // px per ft
  const X = (ft: number) => x0 + ft * s;
  const top = 92;
  const ts = Math.max(10, Math.min(28, i.t * 1.6)); // px, exaggerated
  const v = ts / i.t; // px per inch, vertically
  const bot = top + ts;
  const hma = i.wearing * v;
  const span = r.span.S;
  const ground = 190;
  const wall = Math.min(56, Math.max(34, (i.dowelAbut / 12) * s + 14)); // px, the abutment drawn behind the joint
  // Bars: main at the bottom, the ⊏ top bar down both ends with short returns, the anchorage bar at mid-depth.
  const c = 3;
  const yMain = bot - Math.max(2.5, i.coverBot * v);
  const yTop = top + Math.max(2.5, i.coverTop * v);
  const ret = Math.min(14, (12 / 12) * s);
  const yMid = top + ts / 2;
  const sT = i.sleeperT * v;
  // The governing vehicle (moment): AASHTO 3.6.1.3.3, the 32 kip axle or the tandem on spans up to 15 ft, the truck (with the lane load) beyond.
  const gov = r.loads.gov.M;
  const truck = gov.startsWith("Design truck (");
  const set = /tandem/i.test(gov) ? [25, 25].map((P, k) => ({ P, x: 4 * k })) : truck ? [8, 32, 32].map((P, k) => ({ P, x: 14 * k })) : [{ P: 32, x: 0 }];
  const mid = (set[0].x + set[set.length - 1].x) / 2;
  const axles = set.map((a) => ({ P: a.P, x: span / 2 + a.x - mid })).filter((a) => a.x >= 0 && a.x <= span);
  const vehicle = `${/tandem/i.test(gov) ? "Design tandem" : truck ? "Design truck" : "Design truck axle"}${r.span.axlesOnly ? "" : " + 0.64 klf lane"}`;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Approach slab along the roadway">
      <text x={VW / 2} y={18} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Along the roadway: {i.L} ft slab + {i.seat} in seat, designed to span {span.toFixed(1)} ft ({Math.round(i.supportLoss * 100)}%)
      </text>
      {/* earth under the slab, from the abutment's back face to the sleeper */}
      <rect x={X(seat)} y={bot} width={X(i.sleeper ? sx0 : Ls) - X(seat)} height={ground - bot} fill={EARTH} />
      {/* the void the slab spans, from the abutment's back face */}
      <rect x={X(seat)} y={bot} width={span * s} height={14} fill={VOID} stroke={BAR} strokeWidth="0.75" strokeDasharray="3 2" />
      <text x={X(seat + span / 2)} y={bot + 26} textAnchor="middle" fontSize="10" fill={BAR}>
        support lost: S = {span.toFixed(1)} ft
      </text>
      {/* the abutment: its top flush with the slab's, the slab on the notch's seat */}
      <polygon points={`${x0 - wall},${top} ${x0},${top} ${x0},${bot} ${X(seat)},${bot} ${X(seat)},${ground} ${x0 - wall},${ground}`} fill={CONC} stroke={LINE} strokeWidth="1" />
      <text x={x0 - wall / 2} y={ground + 14} textAnchor="middle" fontSize="10" fill={LINE}>
        Abutment
      </text>
      {/* the sleeper slab and, with the device, the block up to the roadway's surface */}
      {i.sleeper && <rect x={X(sx0)} y={bot} width={B * s} height={sT} fill={CONC} stroke={LINE} strokeWidth="1" />}
      {device && <rect x={X(xb0)} y={top - hma} width={(i.blockW / 12) * s} height={bot - top + hma} fill={CONC} stroke={LINE} strokeWidth="1" />}
      {i.sleeper && (
        <text x={X(sx0 + B / 2)} y={bot + sT + 12} textAnchor="middle" fontSize="10" fill={LINE}>
          Sleeper {B} ft
        </text>
      )}
      {device && (
        <text x={X(xb0 + i.blockW / 24)} y={top - hma - 5} textAnchor="middle" fontSize="9" fill={LINE}>
          0–4 in device
        </text>
      )}
      {/* the slab */}
      <rect x={X(0)} y={top} width={Ls * s} height={ts} fill={SLAB} stroke={LINE} strokeWidth="1" />
      {hma > 0 && <rect x={x0 - wall} y={top - hma} width={X(Ls) - (x0 - wall)} height={hma} fill={HMA} opacity="0.45" stroke={LINE} strokeWidth="0.5" />}
      <line x1={X(0) + c} y1={yMain} x2={X(Ls) - c} y2={yMain} stroke={BAR} strokeWidth="1.5" />
      <polyline points={`${X(0) + c + ret},${yMain - 1.5} ${X(0) + c},${yMain - 1.5} ${X(0) + c},${yTop} ${X(Ls) - c},${yTop} ${X(Ls) - c},${yMain - 1.5} ${X(Ls) - c - ret},${yMain - 1.5}`} fill="none" stroke={TOPBAR} strokeWidth="1" />
      {/* the anchorage bar: straight through the joint at mid-depth, its leg down in the abutment */}
      <polyline points={`${x0 - (i.dowelAbut / 12) * s},${yMid + i.dowelHook * v} ${x0 - (i.dowelAbut / 12) * s},${yMid} ${x0 + (i.dowelSlab / 12) * s},${yMid}`} fill="none" stroke={DOWEL} strokeWidth="1.2" />
      {/* the governing vehicle's axles about midspan of the design span: each arrow a whole axle (both wheels) of one lane */}
      {axles.map((a, k) => (
        <g key={k}>
          <line x1={X(seat + a.x)} y1={top - 34} x2={X(seat + a.x)} y2={top - hma - 3} stroke={LINE} strokeWidth="1.5" markerEnd="url(#as-arrow)" />
          <text x={X(seat + a.x)} y={top - 38} textAnchor="middle" fontSize="9" fill={LINE}>
            {a.P} kip
          </text>
        </g>
      ))}
      <text x={X(seat + span / 2)} y={34} textAnchor="middle" fontSize="10" fill={LINE}>
        {vehicle}: whole axles (2 wheels each), one lane, spread over E = {(r.span.E / 12).toFixed(2)} ft
      </text>
      <defs>
        <marker id="as-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={LINE} />
        </marker>
      </defs>
      <text x={X(seat + i.L * 0.62)} y={bot + 44} textAnchor="middle" fontSize="10" fill={LINE}>
        {i.t} in slab, #{i.mainBars.bar} @ {i.mainBars.spacing} in bottom, #{i.topLong.bar} ⊏ top{hma > 0 ? `, ${i.wearing} in HMA` : ""}
      </text>
      <text x={VW - 8} y={VH - 6} textAnchor="end" fontSize="10" fill={LINE}>
        Strip E = {(r.span.E / 12).toFixed(2)} ft · Mu = {r.loads.Mu.toFixed(2)} kip·ft/ft
      </text>
    </svg>
  );
}
