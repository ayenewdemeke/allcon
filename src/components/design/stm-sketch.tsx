import type { StmResult } from "@/lib/design/stm/strut-tie";

// The strut-and-tie model over the concrete outline, as one load case or as the envelope.
//  - One case: each member's force in that case (ties solid blue, struts dashed red, unloaded grey),
//    the case's loads at the nodes and the support reactions, and its equilibrium check: a set of
//    forces in equilibrium.
//  - Envelope: each member's largest tension and compression over the cases, with the case each
//    comes from. Nonsimultaneous: the values come from different cases and are not one equilibrium
//    state, which the plot says.
// No hooks, so a calc package can draw it as SVG.

const VW = 680;
const PAD = 34;
const LINE = "#334155";
const MUTED = "#64748b";
const CONCRETE = "#eef2f6";
const TIE = "#1d4ed8";
const STRUT = "#dc2626";
const ZERO = "#94a3b8";
const LOAD = "#15803d";
const REACT = "#7c3aed";

export type SketchView = { case: number } | "envelope";

const sci = (v: number) => (v === 0 ? "0" : Math.abs(v) < 1e-3 ? v.toExponential(1) : v.toFixed(3));

export function StmSketch({ result, title, view = "envelope" }: { result: StmResult; title?: string; view?: SketchView }) {
  const ci = view === "envelope" ? null : Math.min(view.case, result.cases.length - 1);
  const envelopeLoads = ci === null ? (result.appliedLoads ?? []) : [];
  const caseLoads =
    ci === null
      ? []
      : result.cases[ci].loads
          .map((l) => ({ k: result.labels.indexOf(l.node.trim()), fy: l.fy, fx: l.fx }))
          .filter((l) => l.k >= 0 && (Math.abs(l.fy) > 1e-9 || Math.abs(l.fx) > 1e-9));
  const pts = [...result.outline, ...result.nodes, ...envelopeLoads.map((l) => [l.x, l.y] as [number, number])];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((VW - 2 * PAD) / Math.max(x1 - x0, 1), 480 / Math.max(y1 - y0, 1));
  const fromGirders = ci === null && !!result.capLoads;
  const top = 40; // the title's two lines
  const headroom = envelopeLoads.length || caseLoads.length ? (fromGirders ? 58 : 46) : 0;
  const foot = 44; // reactions below the supports, and the legend
  const VH = Math.round((y1 - y0) * scale + PAD + top + headroom + foot);
  const X = (x: number) => PAD + (x - x0) * scale;
  const Y = (y: number) => top + headroom + (y1 - y) * scale;
  const shown = result.members.filter((m) => m.active);
  const memberIndex = (m: (typeof result.members)[number]) => result.members.indexOf(m);
  const force = (m: (typeof result.members)[number]) => (ci === null ? 0 : result.forces[ci][memberIndex(m)]);
  const kind = (m: (typeof result.members)[number]) => (ci === null ? m.role : Math.abs(force(m)) <= 1e-6 ? "zero" : force(m) > 0 ? "tie" : "strut");
  const pc = ci === null ? null : result.perCase[ci];
  const heading =
    ci === null
      ? title ?? `Envelope over ${result.cases.length} load case${result.cases.length > 1 ? "s" : ""} (nonsimultaneous)`
      : `Case ${ci + 1} of ${result.cases.length}: ${result.cases[ci].name}`;
  const sub =
    ci === null
      ? "Largest force in each member (kip); values from different cases, not one equilibrium state."
      : pc!.equilibrium.ok
        ? `In equilibrium (residual ${sci(pc!.equilibrium.nodal)} kip)${pc!.smallestAngle !== null ? `; smallest strut-tie angle ${pc!.smallestAngle.toFixed(1)}°` : ""}.`
        : `Not in equilibrium: residual ${sci(pc!.equilibrium.nodal)} kip; ΣFy ${sci(pc!.equilibrium.Fy)} kip; ΣM ${sci(pc!.equilibrium.M)} kip·ft.`;
  const sortedLoads = [...envelopeLoads].sort((a, b) => a.x - b.x);
  const label = (m: (typeof result.members)[number]) => {
    if (ci !== null) {
      const f = force(m);
      return Math.abs(f) <= 1e-6 ? "0" : `${Math.round(f)}`;
    }
    // One number: the force of the member's role (the larger one if it carries both).
    const tie = m.role === "tie" ? m.tension > 0 : m.compression === 0;
    return `${Math.round(tie ? m.tension : -m.compression)}`;
  };
  const hover = (m: (typeof result.members)[number]) => {
    if (ci !== null) return `${m.key}: ${Math.round(force(m))} kip in case ${ci + 1}`;
    const t = m.tension > 0 ? `tension ${Math.round(m.tension)} kip (case ${m.tensionCase! + 1})` : "";
    const c = m.compression > 0 ? `compression ${Math.round(m.compression)} kip (case ${m.compressionCase! + 1})` : "";
    return `${m.key}: ${[t, c].filter(Boolean).join(", ")}`;
  };
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Strut-and-tie model">
      <text x={PAD} y={16} fontSize="12" fontWeight="600" fill={LINE}>
        {heading}
      </text>
      <text x={PAD} y={30} fontSize="9" fill={pc && !pc.equilibrium.ok ? STRUT : MUTED}>
        {sub}
      </text>
      <polygon points={result.outline.map((p) => `${X(p[0])},${Y(p[1])}`).join(" ")} fill={CONCRETE} stroke={LINE} strokeWidth="1" />
      {result.members
        .filter((m) => !m.active)
        .map((m) => (
          <line key={`z${m.key}`} x1={X(result.nodes[m.a][0])} y1={Y(result.nodes[m.a][1])} x2={X(result.nodes[m.b][0])} y2={Y(result.nodes[m.b][1])} stroke={CONCRETE} strokeWidth="0.6" />
        ))}
      {shown.map((m) => {
        const [a, b] = [result.nodes[m.a], result.nodes[m.b]];
        const k = kind(m);
        return <line key={m.key} x1={X(a[0])} y1={Y(a[1])} x2={X(b[0])} y2={Y(b[1])} stroke={k === "tie" ? TIE : k === "strut" ? STRUT : ZERO} strokeWidth={k === "tie" ? 2.4 : k === "strut" ? 1.6 : 0.8} strokeDasharray={k === "strut" ? "6 4" : k === "zero" ? "2 3" : undefined} />;
      })}
      {result.nodes.map((p, k) => (
        <circle key={`d${k}`} cx={X(p[0])} cy={Y(p[1])} r="3" fill={LINE} />
      ))}
      {shown.map((m) => {
        const [a, b] = [result.nodes[m.a], result.nodes[m.b]];
        const k = kind(m);
        return (
          <text key={`f${m.key}`} x={(X(a[0]) + X(b[0])) / 2 + 4} y={(Y(a[1]) + Y(b[1])) / 2 - 4} fontSize="10" fill={k === "tie" ? TIE : k === "strut" ? STRUT : ZERO} stroke="#ffffff" strokeWidth="3" paintOrder="stroke">
            <title>{hover(m)}</title>
            {label(m)}
          </text>
        );
      })}
      {result.nodes.map((p, k) => (
        <text key={`n${k}`} x={X(p[0]) - 6} y={Y(p[1]) - 6} textAnchor="end" fontSize="11" fontWeight="600" fill={LINE} stroke="#ffffff" strokeWidth="3" paintOrder="stroke">
          {result.labels[k]}
        </text>
      ))}
      {/* Supports: a triangle for a vertical restraint, a tick for a horizontal one. */}
      {result.supports.map(([n, axis], r) => {
        const [x, y] = [X(result.nodes[n][0]), Y(result.nodes[n][1])];
        const R = ci === null ? null : result.reactions[ci][r];
        return (
          <g key={`s${r}`}>
            {axis === 1 ? <polygon points={`${x},${y} ${x - 6},${y + 10} ${x + 6},${y + 10}`} fill="none" stroke={LINE} strokeWidth="1" /> : <line x1={x - 10} y1={y + 12} x2={x + 10} y2={y + 12} stroke={LINE} strokeWidth="1.5" />}
            {R !== null && Math.abs(R) > 1e-6 && (
              <text x={x + (axis === 1 ? 0 : 14)} y={y + (axis === 1 ? 22 : 16)} textAnchor="middle" fontSize="9" fontWeight="600" fill={REACT} stroke="#ffffff" strokeWidth="3" paintOrder="stroke">
                {axis === 1 ? `${R >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(R))}` : `${R >= 0 ? "→" : "←"} ${Math.abs(Math.round(R))}`}
              </text>
            )}
          </g>
        );
      })}
      {/* One case: its loads at the nodes, as the model carries them. */}
      {caseLoads.map((l, k) => {
        const [x, y] = [X(result.nodes[l.k][0]), Y(result.nodes[l.k][1])];
        const lift = k % 2 === 1 ? 12 : 0;
        return (
          <g key={`cl${k}`}>
            <line x1={x} y1={y - 30 - lift} x2={x} y2={y - 6} stroke={LOAD} strokeWidth="1.6" />
            <polygon points={`${x},${y - 1} ${x - 4},${y - 9} ${x + 4},${y - 9}`} fill={LOAD} />
            <text x={x} y={y - 34 - lift} textAnchor="middle" fontSize="10" fontWeight="600" fill={LOAD} stroke="#ffffff" strokeWidth="3" paintOrder="stroke">
              {Math.round(-l.fy)} k
            </text>
          </g>
        );
      })}
      {/* Envelope: the girders' reactions at their bearings, or each node's largest load. */}
      {sortedLoads.map((l, k) => {
        const x = X(l.x);
        const y = Y(l.y);
        const lift = k % 2 === 1 && k > 0 && Math.abs(X(sortedLoads[k - 1].x) - x) < 46 ? 12 : 0;
        return (
          <g key={`l${k}`}>
            <line x1={x} y1={y - 30 - lift} x2={x} y2={y - 6} stroke={LOAD} strokeWidth="1.6" />
            <polygon points={`${x},${y - 1} ${x - 4},${y - 9} ${x + 4},${y - 9}`} fill={LOAD} />
            <text x={x} y={y - 34 - lift} textAnchor="middle" fontSize="10" fontWeight="600" fill={LOAD} stroke="#ffffff" strokeWidth="3" paintOrder="stroke">
              {Math.round(l.P)} k
            </text>
            {fromGirders && (
              <text x={x} y={y - 46 - lift} textAnchor="middle" fontSize="9" fill={LINE} stroke="#ffffff" strokeWidth="3" paintOrder="stroke">
                {l.label}
              </text>
            )}
          </g>
        );
      })}
      <text x={PAD} y={VH - 8} fontSize="9" fill={LINE}>
        <tspan fill={TIE}>━ tie</tspan>
        <tspan dx="10" fill={STRUT}>
          ╌ strut
        </tspan>
        {ci !== null && (
          <tspan dx="10" fill={ZERO}>
            ┄ no force in this case
          </tspan>
        )}
        <tspan dx="10">kip</tspan>
        {ci !== null ? (
          <>
            <tspan dx="10" fill={LOAD}>
              ↓ this case&apos;s loads at the nodes
            </tspan>
            <tspan dx="10" fill={REACT}>
              ↑ reactions
            </tspan>
          </>
        ) : (
          envelopeLoads.length > 0 && (
            <tspan dx="10" fill={LOAD}>
              {fromGirders ? "↓ girder reactions, Strength I with the most live load (envelope)" : "↓ largest factored load at each node (envelope)"}
            </tspan>
          )
        )}
      </text>
    </svg>
  );
}
