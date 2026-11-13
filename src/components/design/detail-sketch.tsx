import { trimCallout, type Schedule } from "@/lib/design/rebar/schedule";
import type { DetailView } from "@/lib/design/takeoff/types";

// A take-off's views: concrete outlines, bars as single lines, bars end-on as filled circles, and
// each bar's callout by size and use, as CDOT's Bridge Detail Manual Ch. 4 draws reinforcing. No hooks,
// so a calc package can draw it as SVG.

const VW = 720;
const PAD = 26;
const LINE = "#334155";
const MUTED = "#64748b";
const CONCRETE = "#eef2f6";
const EARTH = "#f5efe2";
const BAR = "#b91c1c";
const SECONDARY = "#f59e0b";
const STIRRUP = "#1d4ed8";

export function DetailSketch({ view, schedule }: { view: DetailView; schedule: Schedule }) {
  const pts = [...view.polys.flatMap((p) => p.pts), ...view.lines.flatMap((l) => l.pts), ...view.dots.map((d) => [d.x, d.y] as [number, number]), ...(view.labels ?? []).map((l) => [l.x, l.y] as [number, number])];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const marks = [...new Set([...view.lines.map((l) => l.mark), ...view.dots.map((d) => d.mark)].filter(Boolean))];
  const legendW = marks.length ? 300 : 0;
  const scale = Math.min((VW - 2 * PAD - legendW) / Math.max(1, x1 - x0), 380 / Math.max(1, y1 - y0));
  const top = 30;
  const X = (x: number) => PAD + (x - x0) * scale;
  const Y = (y: number) => top + (y1 - y) * scale;
  const VH = Math.max(Math.round(top + (y1 - y0) * scale + 30), top + marks.length * 14 + 20);
  // Called out by size and use, as CDOT does (no bar marks).
  const callout = (m: string) => {
    const g = schedule.groups.find((x) => x.mark === m);
    return g ? `${g.use}: ${trimCallout(g.callout, g.use)}` : "";
  };
  const color = (k?: string) => (k === "secondary" ? SECONDARY : k === "stirrup" ? STIRRUP : BAR);
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label={view.title}>
      <text x={PAD} y={16} fontSize="12" fontWeight="600" fill={LINE}>
        {view.title}
      </text>
      {view.polys.map((p, k) => (
        <polygon key={k} points={p.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} fill={p.style === "concrete" ? CONCRETE : p.style === "earth" ? EARTH : p.style === "void" ? "white" : "none"} stroke={p.style === "earth" ? MUTED : LINE} strokeWidth="1" strokeDasharray={p.style === "dashed" || p.style === "earth" ? "5 3" : undefined} />
      ))}
      {view.lines.map((l, k) => (
        <polyline key={k} points={l.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} fill="none" stroke={color(l.kind)} strokeWidth={l.kind === "secondary" ? 0.9 : 1.6} />
      ))}
      {view.dots.map((d, k) => (
        <circle key={k} cx={X(d.x)} cy={Y(d.y)} r={Math.max(1.5, (d.d / 2) * scale)} fill={BAR} />
      ))}
      {(view.labels ?? []).map((l, k) => (
        <text key={k} x={X(l.x)} y={Y(l.y)} textAnchor={l.anchor ?? "start"} fontSize="9.5" fill={MUTED}>
          {l.text}
        </text>
      ))}
      {marks.map((m, k) => (
        <text key={m} x={VW - PAD - legendW + 10} y={top + 10 + k * 14} fontSize="9.5" fill={LINE}>
          {callout(m)}
        </text>
      ))}
    </svg>
  );
}
