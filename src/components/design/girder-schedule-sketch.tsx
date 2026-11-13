import { zoneCallout, type GirderInputs } from "@/lib/design/girders/prestressed";
import type { GirderShape } from "@/lib/design/girders/sections";

// The girder for its schedule, drawn as a plan sheet shows it: the elevation of the whole girder,
// every strand row in it (each pair of harped strands from its height at the end to the harp point,
// the straight rows level, a red dot where a row's debonding ends), with the girder's length, the
// harp points from each end, the bearings and the span between them; and below it the section at
// midspan with the strand pattern (debonded strands in red) and its depth and flange widths.
// Vertical scale exaggerated in the elevation. No hooks, so it also draws into the calc package.

const VW = 700;
const LINE = "#334155";
const DIM = "#475569";
const GIRDER = "#d4d8de";
const STRAND = "#111827";
const DEBOND = "#dc2626";
const PITCH = 2; // in, the strand grid

const f3 = (v: number) => v.toFixed(3);

function Dim({ x1, x2, y, label, unit = "ft" }: { x1: number; x2: number; y: number; label: number; unit?: string }) {
  return (
    <g>
      <line x1={x1} x2={x2} y1={y} y2={y} stroke={DIM} strokeWidth="0.7" />
      <line x1={x1} x2={x1} y1={y - 4} y2={y + 4} stroke={DIM} strokeWidth="0.7" />
      <line x1={x2} x2={x2} y1={y - 4} y2={y + 4} stroke={DIM} strokeWidth="0.7" />
      <text x={(x1 + x2) / 2} y={y - 3} textAnchor="middle" fontSize="9" fill={DIM}>
        {f3(label)} {unit}
      </text>
    </g>
  );
}

function VDim({ x, y1, y2, label }: { x: number; y1: number; y2: number; label: string }) {
  return (
    <g>
      <line x1={x} x2={x} y1={y1} y2={y2} stroke={DIM} strokeWidth="0.7" />
      <line x1={x - 4} x2={x + 4} y1={y1} y2={y1} stroke={DIM} strokeWidth="0.7" />
      <line x1={x - 4} x2={x + 4} y1={y2} y2={y2} stroke={DIM} strokeWidth="0.7" />
      <text x={x - 4} y={(y1 + y2) / 2} textAnchor="middle" fontSize="9" fill={DIM} transform={`rotate(-90 ${x - 4} ${(y1 + y2) / 2})`}>
        {label}
      </text>
    </g>
  );
}

const STIRRUP = "#7aa7d8";
const STIRRUP_TEXT = "#2563eb";

/** The stirrup zones along half the girder (ft from its end): each zone's extent and its stirrups' positions, the first 2 in from the end. */
function stirrupZones(i: GirderInputs, half: number) {
  const out: { from: number; to: number; at: number[]; label: string; legs: number }[] = [];
  let edge = i.endDist; // zones are measured from the bearing
  i.stirrups.forEach((z, k) => {
    const last = k === i.stirrups.length - 1 || z.length <= 0;
    const from = k === 0 ? 2 / 12 : edge;
    const to = last ? half : Math.min(half, edge + z.length);
    if (to <= from) return;
    const s = z.spacing / 12;
    const at: number[] = [];
    for (let x = from; x <= to + 1e-6; x += s) at.push(x);
    out.push({ from, to, at, label: zoneCallout(z), legs: z.legs });
    edge = to;
  });
  return out;
}

/** The harped strands as pairs at the 2 in grid: each pair's height at the girder's end and at the harp points. */
function harpedPairs(i: GirderInputs) {
  const h = i.harped;
  if (!h || h.count <= 0) return [];
  const pairs = Math.ceil(h.count / 2);
  return Array.from({ length: pairs }, (_, r) => ({ yEnd: h.yEnd - (pairs - 1) + PITCH * r, yHarp: h.yHarp - (pairs - 1) + PITCH * r, n: r === pairs - 1 && h.count % 2 ? 1 : 2 }));
}

export function GirderScheduleSketch({ inputs: i, shape, span }: { inputs: GirderInputs; shape: GirderShape; span: number }) {
  const Lg = i.L + 2 * i.endDist; // ft
  const H = shape.depth; // in
  const x0 = 24;
  const x1 = VW - 24;
  const half = Lg / 2; // the girder is symmetrical: its end to midspan
  const X = (x: number) => x0 + (Math.min(x, half) / half) * (x1 - x0);
  // Elevation: girder top at yTop, its depth drawn 150 px (exaggerated).
  const yTop = 64;
  const k = 150 / H;
  const Y = (y: number) => yTop + (H - y) * k;
  const harped = harpedPairs(i);
  const hp = i.harped && i.harped.count > 0 ? i.harped.harpPoint * Lg : null;
  const rows = [...i.strands].sort((p, q) => p.y - q.y);
  // Section at midspan, below.
  const sTop = Y(0) + 140; // under the elevation, its notes and the stirrup legend
  const sk = 280 / H; // px per in, true shape
  const cx = VW / 2;
  const SY = (y: number) => sTop + (H - y) * sk;
  const outline = [...shape.profile.map(([y, w]) => `${cx + w * sk},${SY(y)}`), ...[...shape.profile].reverse().map(([y, w]) => `${cx - w * sk},${SY(y)}`)].join(" ");
  const bottomWidth = 2 * shape.profile[0][1];
  const dots: { x: number; y: number; red: boolean }[] = [];
  for (const r of rows) {
    // Debonded strands: the ones nearest the middle of the row (the outermost stay bonded).
    const order = Array.from({ length: r.count }, (_, j) => j).sort((a, b) => Math.abs(a - (r.count - 1) / 2) - Math.abs(b - (r.count - 1) / 2));
    const deb = new Set(order.slice(0, (r.debondLength ?? 0) > 0 ? (r.debonded ?? 0) : 0));
    for (let j = 0; j < r.count; j++) dots.push({ x: cx + (j - (r.count - 1) / 2) * PITCH * sk, y: SY(r.y), red: deb.has(j) });
  }
  for (const p of harped) for (let j = 0; j < p.n; j++) dots.push({ x: cx + (j - (p.n - 1) / 2) * PITCH * sk, y: SY(p.yHarp), red: false });
  const VH = Math.ceil(SY(0) + 42);
  // The stirrup zones called out in order from the girder's end (ticks under the girder mark where each ends), three to a line.
  const zones = stirrupZones(i, half);
  const calls = zones.map((z, j) => `${j + 1}: ${z.label}${z.legs > 2 ? ` (${z.legs} legs)` : ""} ${j < zones.length - 1 ? `to ${f3(z.to)} ft` : "to ℄"}`);
  const legend = ["Stirrups from the girder's end:"].concat(Array.from({ length: Math.ceil(calls.length / 3) }, (_, k) => calls.slice(k * 3, k * 3 + 3).join("   ·   ")));
  const brg = [i.endDist];
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Girder elevation and section for the schedule">
      <text x={VW / 2} y={12} textAnchor="middle" fontSize="11" fontWeight="600" fill={LINE}>
        Span {span}: {shape.name}, {i.strands.reduce((s, r) => s + r.count, 0) + (i.harped?.count ?? 0)} strands (elevation, vertical scale exaggerated)
      </text>
      {/* top dimensions: the girder's length and the harp points from each end */}
      <Dim x1={X(0)} x2={X(half)} y={28} label={half} />
      {hp !== null && <Dim x1={X(0)} x2={X(hp)} y={48} label={hp} />}
      <rect x={X(0)} y={Y(H)} width={X(half) - X(0)} height={H * k} fill={GIRDER} stroke={LINE} strokeWidth="1" />
      <line x1={X(half)} x2={X(half)} y1={Y(H) - 12} y2={Y(0) + 52} stroke={LINE} strokeWidth="0.8" strokeDasharray="8 3 2 3" />
      <text x={X(half) - 4} y={Y(H) - 16} textAnchor="end" fontSize="9" fill={LINE}>
        ℄ Span (symmetrical)
      </text>
      {/* stirrups: each zone at its spacing from the bearing (the first from the girder's end), the last to midspan; into the deck where they project */}
      {zones.map((z, j) => (
        <g key={`z${j}`}>
          {z.at.map((x) => (
            <line key={x} x1={X(x)} x2={X(x)} y1={Y(1.5)} y2={i.stirrupsIntoDeck ? Y(H) - 7 : Y(H - 1.5)} stroke={STIRRUP} strokeWidth="0.6" />
          ))}
          {/* the zone's end, ticked under the girder; the zones are called out in the legend below */}
          {j < zones.length - 1 && <line x1={X(z.to)} x2={X(z.to)} y1={Y(0) + 2} y2={Y(0) + 7} stroke={STIRRUP_TEXT} strokeWidth="0.8" />}
        </g>
      ))}
      {/* straight rows, with a red dot where each row's debonding ends */}
      {rows.map((r, j) => (
        <g key={`s${j}`}>
          <line x1={X(0)} x2={X(half)} y1={Y(r.y)} y2={Y(r.y)} stroke={STRAND} strokeWidth="0.9" />
          {(r.debonded ?? 0) > 0 && (r.debondLength ?? 0) > 0 && r.debondLength! < half && <circle cx={X(r.debondLength!)} cy={Y(r.y)} r={3} fill={DEBOND} />}
        </g>
      ))}
      {/* harped pairs: end to harp point, level between the harp points */}
      {hp !== null &&
        harped.map((p, j) => <polyline key={`h${j}`} points={`${X(0)},${Y(p.yEnd)} ${X(hp)},${Y(p.yHarp)} ${X(half)},${Y(p.yHarp)}`} fill="none" stroke={STRAND} strokeWidth="0.9" />)}
      {/* bearings */}
      <polygon points={`${X(brg[0])},${Y(0)} ${X(brg[0]) - 5},${Y(0) + 8} ${X(brg[0]) + 5},${Y(0) + 8}`} fill={LINE} />
      {/* bottom dimensions: bearing to harp point, bearing to bearing */}
      {hp !== null && <Dim x1={X(brg[0])} x2={X(hp)} y={Y(0) + 24} label={hp - i.endDist} />}
      <Dim x1={X(brg[0])} x2={X(half)} y={Y(0) + 44} label={i.L / 2} />
      <text x={X(0)} y={Y(0) + 60} fontSize="9" fill={DIM}>
        Half the girder shown, symmetrical about midspan: {f3(Lg)} ft long, {f3(i.L)} ft bearing to bearing, the bearing {f3(i.endDist)} ft from the end{rows.some((r) => (r.debonded ?? 0) > 0) ? "; red dots: debonding ends" : ""}
      </text>
      {legend.map((t, j) => (
        <text key={j} x={X(0)} y={Y(0) + 74 + j * 12} fontSize="9" fill={STIRRUP_TEXT}>
          {t}
        </text>
      ))}
      {/* the section at midspan */}
      <Dim x1={cx - (shape.topWidth / 2) * sk} x2={cx + (shape.topWidth / 2) * sk} y={sTop - 12} label={shape.topWidth} unit="in" />
      <polygon points={outline} fill={GIRDER} stroke={LINE} strokeWidth="1" />
      <line x1={cx} x2={cx} y1={SY(H) - 4} y2={SY(0) + 4} stroke={LINE} strokeWidth="0.5" strokeDasharray="6 2 2 2" />
      {dots.map((d, j) => (
        <circle key={j} cx={d.x} cy={d.y} r={Math.max(1.8, 0.3 * sk)} fill={d.red ? DEBOND : STRAND} />
      ))}
      <VDim x={cx - (shape.topWidth / 2) * sk - 20} y1={SY(H)} y2={SY(0)} label={`${f3(H)} in`} />
      <Dim x1={cx - (bottomWidth / 2) * sk} x2={cx + (bottomWidth / 2) * sk} y={SY(0) + 22} label={bottomWidth} unit="in" />
    </svg>
  );
}
