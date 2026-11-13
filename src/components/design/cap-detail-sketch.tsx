import type { CapDetail, SectionView } from "@/lib/design/stm/detail";
import { ftIn } from "@/lib/design/rebar/bars";

// A standard cap's reinforcement as detailed: the elevation (bars as single lines, stirrups at
// their positions, laps offset, section cuts) and sections A-A and B-B (stirrups as lines, bars
// end-on as filled circles), each bar called out by size and use, as CDOT's Bridge Detail Manual
// Ch. 4 draws reinforcing. No hooks, so a calc package can draw it as SVG.

const VW = 760;
const PAD = 30;
const LINE = "#334155";
const MUTED = "#64748b";
const CONCRETE = "#eef2f6";
const BAR = "#b91c1c";
const STIRRUP = "#1d4ed8";
const COLUMN_BAR = "#94a3b8";
const SIDE_BAR = "#f59e0b";

function Section({ s, x, y, scale }: { s: SectionView; x: number; y: number; scale: number }) {
  const ledge = s.ledge;
  const wide = s.b + (ledge ? 2 * ledge.projection : 0);
  const X = (u: number) => x + (u + (ledge ? ledge.projection : 0)) * scale;
  const Y = (v: number) => y + (s.h - v) * scale;
  const outline = ledge
    ? [[-ledge.projection, 0], [s.b + ledge.projection, 0], [s.b + ledge.projection, ledge.depth], [s.b, ledge.depth], [s.b, s.h], [0, s.h], [0, ledge.depth], [-ledge.projection, ledge.depth]]
    : [[0, 0], [s.b, 0], [s.b, s.h], [0, s.h]];
  const callouts = s.notes;
  return (
    <g>
      <text x={X(s.b / 2)} y={y - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill={LINE}>
        Section {s.label}-{s.label}
      </text>
      <polygon points={outline.map(([u, v]) => `${X(u)},${Y(v)}`).join(" ")} fill={CONCRETE} stroke={LINE} strokeWidth="1" />
      {s.hoops.map((h, k) => (
        <rect key={k} x={X(h.x0)} y={Y(h.y1)} width={(h.x1 - h.x0) * scale} height={(h.y1 - h.y0) * scale} rx={2} fill="none" stroke={STIRRUP} strokeWidth="1.2" />
      ))}
      {s.dots.map((d, k) => (
        <circle key={k} cx={X(d.x)} cy={Y(d.y)} r={Math.max(1.6, (d.d / 2) * scale)} fill={BAR} />
      ))}
      <text x={X(s.b / 2)} y={Y(0) + 14} textAnchor="middle" fontSize="9" fill={MUTED}>
        {ftIn(wide)} wide, {ftIn(s.h)} deep
      </text>
      {callouts.map((c, k) => (
        <text key={c.mark} x={X(wide - (ledge ? ledge.projection : 0)) + 10} y={Y(s.h) + 10 + k * 13} fontSize="9" fill={LINE}>
          {c.text}
        </text>
      ))}
    </g>
  );
}

export function CapDetailSketch({ detail, title }: { detail: CapDetail; title?: string }) {
  const d = detail;
  const below = Math.min(36, Math.max(...d.columns.map((c) => c.x1 - c.x0)) / 2);
  const scale = (VW - 2 * PAD) / d.length;
  const top = 82; // the title, and room for the top bars' callout and the cut labels above the cap
  const elevH = (d.depth + below) * scale;
  const X = (x: number) => PAD + x * scale;
  const Y = (y: number) => top + (d.depth - y) * scale;
  // Sections side by side below the elevation, at one scale that fits both.
  const secs = d.sections;
  const maxB = Math.max(...secs.map((s) => s.b + (s.ledge ? 2 * s.ledge.projection : 0)));
  const maxH = Math.max(...secs.map((s) => s.h));
  const slot = (VW - 2 * PAD) / secs.length;
  const sScale = Math.min((slot - 190) / maxB, 170 / maxH);
  const secTop = top + elevH + 96;
  const VH = Math.round(secTop + maxH * sScale + 40);
  const capPoly = [...d.soffit.map(([x, y]) => [x, y]), [d.length, d.depth], [0, d.depth]];
  const markAt = (mark: string) => d.schedule.groups.find((g) => g.mark === mark);
  const byKind = (kind: string) => d.bars.filter((b) => b.kind === kind);
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Reinforcement details">
      <text x={PAD} y={16} fontSize="12" fontWeight="600" fill={LINE}>
        {title ?? "Reinforcement: elevation and sections"}
      </text>
      <text x={PAD} y={31} fontSize="9.5" fill={MUTED}>
        Bars as single lines; stirrups at their positions; bars end-on as filled circles; each called out by size and use.
      </text>
      {/* Columns (stubs) and the cap */}
      {d.columns.map((c, k) => (
        <rect key={k} x={X(c.x0)} y={Y(0)} width={(c.x1 - c.x0) * scale} height={below * scale} fill={CONCRETE} stroke={LINE} strokeWidth="1" strokeDasharray="4 3" />
      ))}
      <polygon points={capPoly.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} fill={CONCRETE} stroke={LINE} strokeWidth="1.2" />
      {/* Stirrups */}
      {d.stirrups.map((s, k) => (
        <line key={k} x1={X(s.x)} x2={X(s.x)} y1={Y(s.y0)} y2={Y(s.y1)} stroke={STIRRUP} strokeWidth="0.7" opacity="0.8" />
      ))}
      {/* Column bars, then the cap's bars, laps drawn offset */}
      {byKind("column").map((b, k) => (
        <polyline key={`c${k}`} points={b.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} fill="none" stroke={COLUMN_BAR} strokeWidth="1.2" strokeDasharray="5 3" />
      ))}
      {d.bars
        .filter((b) => b.kind !== "column")
        .map((b, k) => (
          <g key={`b${k}`}>
            <polyline points={b.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} fill="none" stroke={b.kind === "side" ? SIDE_BAR : BAR} strokeWidth={b.kind === "side" ? 0.7 : 1.8} />
            {(b.laps ?? []).map((x, j) => (
              <line key={j} x1={X(x) - 14} x2={X(x) + 14} y1={Y(b.pts[0][1]) + (b.kind === "top" ? 3 : -3)} y2={Y(b.pts[0][1]) + (b.kind === "top" ? 3 : -3)} stroke={BAR} strokeWidth="1.6" />
            ))}
          </g>
        ))}
      {/* Callouts: the top and side-face bars above the cap, the bottom bars below its left end. */}
      {(
        [
          ["top", 0.66, 50],
          ["side", 0.4, 66],
        ] as const
      ).map(([kind, at, ly]) => {
        const b = byKind(kind).find((s) => s.pts[0][0] <= at * d.length && s.pts[s.pts.length - 1][0] >= at * d.length) ?? byKind(kind)[0];
        if (!b) return null;
        const px = at * d.length;
        const py = kind === "top" ? Math.max(...b.pts.map((p) => p[1])) : b.pts[0][1];
        return (
          <g key={kind}>
            <line x1={X(px)} y1={ly + 3} x2={X(px)} y2={Y(py)} stroke={MUTED} strokeWidth="0.6" />
            <circle cx={X(px)} cy={Y(py)} r={1.8} fill={MUTED} />
            <text x={X(px) + 4} y={ly} fontSize="9.5" fill={LINE}>
              {markAt(b.mark)?.callout}
            </text>
          </g>
        );
      })}
      {byKind("bottom")[0] &&
        (() => {
          const b = byKind("bottom")[0];
          const px = 0.08 * d.length;
          const seg = b.pts.findIndex((p, k) => k > 0 && p[0] >= px);
          const [p0, p1] = [b.pts[Math.max(0, seg - 1)], b.pts[Math.max(1, seg)]];
          const py = p0[1] + ((px - p0[0]) * (p1[1] - p0[1])) / Math.max(1e-9, p1[0] - p0[0]);
          const ly = top + elevH + 30;
          return (
            <g>
              <line x1={X(px)} y1={ly - 10} x2={X(px)} y2={Y(py)} stroke={MUTED} strokeWidth="0.6" />
              <circle cx={X(px)} cy={Y(py)} r={1.8} fill={MUTED} />
              <text x={X(px) + 4} y={ly} fontSize="9.5" fill={LINE}>
                {markAt(b.mark)?.callout}
              </text>
            </g>
          );
        })()}
      {/* Section cuts, labeled below the elevation */}
      {d.cuts.map((c) => (
        <g key={c.label}>
          <line x1={X(c.x)} x2={X(c.x)} y1={Y(d.depth) - 8} y2={top + elevH + 8} stroke={LINE} strokeWidth="0.8" strokeDasharray="8 3 2 3" />
          <circle cx={X(c.x)} cy={top + elevH + 16} r={7} fill="white" stroke={LINE} strokeWidth="0.8" />
          <text x={X(c.x)} y={top + elevH + 19.5} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={LINE}>
            {c.label}
          </text>
        </g>
      ))}
      {d.stirrupZones.map((z, k) => (
        <text key={k} x={X(d.length)} y={top + elevH + 46} textAnchor="end" fontSize="9.5" fill={STIRRUP}>
          Stirrups: {z.text}
        </text>
      ))}
      <text x={PAD} y={top + elevH + 64} fontSize="11" fontWeight="600" fill={LINE}>
        Elevation, {ftIn(d.length)} long
      </text>
      {secs.map((s, k) => (
        <Section key={s.label} s={s} x={PAD + k * slot} y={secTop} scale={sScale} />
      ))}
    </svg>
  );
}
