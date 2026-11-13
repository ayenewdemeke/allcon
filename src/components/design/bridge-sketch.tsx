import { horizontalElements, offsetPoint, pointAt, profileAt, profileGeometry, stationText } from "@/lib/design/bridge/alignment";
import type { BridgeInputs, BridgeLayout } from "@/lib/design/bridge/bridge";

// The Bridge in plan (the alignment, the deck's edges, the girders span by span and the support lines)
// and in profile (the profile grade line with its vertical curves, the supports, the top of deck),
// redrawn as its inputs change.

const LINE = "#334155";
const MUTED = "#94a3b8";
const STEEL = "#2563eb";
const CONC = "#cbd5e1";

export function BridgePlan({ b, lay }: { b: BridgeInputs; lay: BridgeLayout }) {
  const W = 640;
  const H = 260;
  const cache = horizontalElements(b.alignment);
  const s0 = b.supports[0].station - 20;
  const s1 = b.supports[b.supports.length - 1].station + 20;
  const pts = Array.from({ length: 81 }, (_, k) => pointAt(b.alignment, s0 + ((s1 - s0) * k) / 80, cache));
  const edgeL = Array.from({ length: 41 }, (_, k) => offsetPoint(b.alignment, b.supports[0].station + ((b.supports[b.supports.length - 1].station - b.supports[0].station) * k) / 40, b.bridgeLineOffset - b.leftEdge, cache));
  const edgeR = Array.from({ length: 41 }, (_, k) => offsetPoint(b.alignment, b.supports[0].station + ((b.supports[b.supports.length - 1].station - b.supports[0].station) * k) / 40, b.bridgeLineOffset + b.rightEdge, cache));
  const all = [...pts, ...edgeL, ...edgeR];
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sc = Math.min((W - 40) / Math.max(1, maxX - minX), (H - 50) / Math.max(1, maxY - minY));
  const X = (x: number) => 20 + (x - minX) * sc + ((W - 40) - (maxX - minX) * sc) / 2;
  const Y = (y: number) => H - 25 - (y - minY) * sc - ((H - 50) - (maxY - minY) * sc) / 2;
  const path = (p: { x: number; y: number }[]) => p.map((q, k) => `${k ? "L" : "M"}${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bridge plan">
      <text x={W / 2} y={14} textAnchor="middle" fontSize="11" fontWeight="600" fill={LINE}>
        Plan: {lay.spans.length} span{lay.spans.length > 1 ? "s" : ""}, {lay.length.toFixed(2)} ft along the alignment, {b.nGirders} {lay.shapeName} at {b.spacing} ft
      </text>
      <path d={`${path(edgeL)} L${[...edgeR].reverse().map((q) => `${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join(" L")} Z`} fill="#f1f5f9" stroke={MUTED} strokeWidth="0.75" />
      <path d={path(pts)} fill="none" stroke="#dc2626" strokeWidth="1" strokeDasharray="8 3 2 3" />
      {lay.spans.flatMap((s) => s.girders.map((g) => {
        const a = lay.supports[s.index].ends[g.k];
        const c = lay.supports[s.index + 1].ends[g.k];
        return <line key={`${s.index}-${g.k}`} x1={X(a.x)} y1={Y(a.y)} x2={X(c.x)} y2={Y(c.y)} stroke={STEEL} strokeWidth="1" />;
      }))}
      {lay.supports.map((s, k) => {
        const a = s.ends[0];
        const c = s.ends[s.ends.length - 1];
        const ext = 6 / sc;
        const dx = (c.x - a.x) / Math.hypot(c.x - a.x, c.y - a.y);
        const dy = (c.y - a.y) / Math.hypot(c.x - a.x, c.y - a.y);
        return (
          <g key={k}>
            <line x1={X(a.x - dx * ext)} y1={Y(a.y - dy * ext)} x2={X(c.x + dx * ext)} y2={Y(c.y + dy * ext)} stroke={LINE} strokeWidth="2" />
            <text x={X(c.x + dx * ext * 2)} y={Y(c.y + dy * ext * 2)} fontSize="9" fill={LINE} textAnchor="middle">
              {s.name} {stationText(s.station)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function BridgeProfile({ b, lay }: { b: BridgeInputs; lay: BridgeLayout }) {
  const W = 640;
  const H = 220;
  const vcs = profileGeometry(b.profile);
  const s0 = b.supports[0].station - 30;
  const s1 = b.supports[b.supports.length - 1].station + 30;
  const prof = Array.from({ length: 121 }, (_, k) => {
    const s = s0 + ((s1 - s0) * k) / 120;
    return { s, e: profileAt(b.profile, s, vcs).elevation };
  });
  const seats = lay.supports.map((sp, k) => {
    const sp0 = lay.spans[Math.min(k, lay.spans.length - 1)].girders[0];
    return k < lay.spans.length ? sp0.start.seat : lay.spans[k - 1].girders[0].end.seat;
  });
  const es = [...prof.map((p) => p.e), ...seats];
  const eMin = Math.min(...es) - 4;
  const eMax = Math.max(...es) + 2;
  const X = (s: number) => 40 + ((s - s0) / (s1 - s0)) * (W - 60);
  const Y = (e: number) => 30 + ((eMax - e) / Math.max(1, eMax - eMin)) * (H - 60);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bridge profile">
      <text x={W / 2} y={14} textAnchor="middle" fontSize="11" fontWeight="600" fill={LINE}>
        Profile (vertical exaggerated): the profile grade line, the supports and the bearing seats (exterior girder, left)
      </text>
      <polyline points={prof.map((p) => `${X(p.s)},${Y(p.e)}`).join(" ")} fill="none" stroke="#dc2626" strokeWidth="1.25" />
      {vcs.map((v, k) => (
        <g key={k}>
          <line x1={X(v.pvi)} y1={Y(v.elev) - 18} x2={X(v.pvi)} y2={Y(v.elev) + 4} stroke={MUTED} strokeDasharray="2 2" />
          <text x={X(v.pvi)} y={Y(v.elev) - 22} textAnchor="middle" fontSize="9" fill={LINE}>
            PVI {stationText(v.pvi)}, L {v.L} ft
          </text>
        </g>
      ))}
      {lay.supports.map((s, k) => (
        <g key={k}>
          <rect x={X(s.station) - 4} y={Y(seats[k])} width={8} height={Math.max(4, H - 30 - Y(seats[k]))} fill={CONC} stroke={LINE} strokeWidth="0.75" />
          <text x={X(s.station)} y={H - 14} textAnchor="middle" fontSize="9" fill={LINE}>
            {s.name}
          </text>
          <text x={X(s.station)} y={H - 4} textAnchor="middle" fontSize="8" fill={MUTED}>
            seat {seats[k].toFixed(2)}
          </text>
        </g>
      ))}
    </svg>
  );
}
