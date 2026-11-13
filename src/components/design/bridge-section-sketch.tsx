import { bridgeSection } from "@/lib/design/girders/bridge-deck";
import { girderShape, type GirderInputs } from "@/lib/design/girders/prestressed";

// The bridge's typical section to scale: the deck with its crown and cross-slopes, the haunches,
// every girder in its shape, the rails (a CDOT standard's own outline, or the entered barrier as a
// block), and the dimensions: out to out, rail to rail, the overhangs and the girder spacing. No
// hooks, so it also draws into the calc package.

const VW = 760;
const LINE = "#334155";
const DIM = "#475569";
const DECK = "#cbd5e1";
const GIRDER = "#e2e8f0";
const RAIL = "#94a3b8";
const CROWN = "#1d4ed8";

const f3 = (v: number) => `${v.toFixed(3)} ft`;

function Dim({ x1, x2, y, label }: { x1: number; x2: number; y: number; label: string }) {
  return (
    <g>
      <line x1={x1} x2={x2} y1={y} y2={y} stroke={DIM} strokeWidth="0.7" />
      <line x1={x1} x2={x1} y1={y - 4} y2={y + 4} stroke={DIM} strokeWidth="0.7" />
      <line x1={x2} x2={x2} y1={y - 4} y2={y + 4} stroke={DIM} strokeWidth="0.7" />
      <text x={(x1 + x2) / 2} y={y - 3} textAnchor="middle" fontSize="9" fill={DIM}>
        {label}
      </text>
    </g>
  );
}

export function BridgeSectionSketch({ inputs }: { inputs: GirderInputs }) {
  const b = bridgeSection(inputs);
  const shape = girderShape(inputs);
  const H = shape.depth / 12; // ft
  const railH = b.rail ? b.rail.height / 12 : (inputs.site?.barrierHeight || 2.67);
  const t = inputs.deckT / 12;
  const hh = inputs.haunch / 12;
  const s = (VW - 60) / b.W; // px per ft, both ways (to scale)
  const fall = Math.max(Math.abs(b.surface(0)), Math.abs(b.surface(b.W)));
  const top = 78 + railH * s; // the crown's height on the page
  const X = (x: number) => 30 + x * s;
  const Y = (y: number) => top - y * s; // y in ft, up, from the crown
  const VH = Math.ceil(Y(-fall - t - hh - H) + 46);
  const n = 48;
  const surf = Array.from({ length: n + 1 }, (_, k) => (k / n) * b.W).concat(b.crown.kind === "crown" ? [b.xc] : []).sort((p, q) => p - q);
  const deck = [...surf.map((x) => `${X(x)},${Y(b.surface(x))}`), ...[...surf].reverse().map((x) => `${X(x)},${Y(b.surface(x) - t)}`)].join(" ");
  const half = shape.topWidth / 24; // ft
  const girders = b.girders.map((xg, k) => {
    // The girder's top flange level under the deck's bottom at its centerline, less the haunch there.
    const yTop = b.surface(xg) - t - hh;
    const pts = [...shape.profile.map(([y, w]) => [xg + w / 12, yTop - H + y / 12]), ...[...shape.profile].reverse().map(([y, w]) => [xg - w / 12, yTop - H + y / 12])];
    const haunch = [
      [xg - half, yTop],
      [xg + half, yTop],
      [xg + half, b.surface(xg + half) - t],
      [xg - half, b.surface(xg - half) - t],
    ];
    return { k, xg, yTop, pts, haunch };
  });
  const rails = [1, -1].map((side) => {
    const edge = side > 0 ? 0 : b.W;
    const y0 = b.surface(edge);
    if (b.rail) {
      const pts = b.rail.outline.map(([x, y]) => [edge + (side * x) / 12, y0 + y / 12]);
      return { side, pts, posts: b.rail.posts ? { x: edge + (side * b.rail.posts.x) / 12, y0: y0 + 13 / 12, y1: y0 + b.rail.height / 12, tubes: b.rail.posts.tubes.map((tb) => ({ x0: edge + (side * tb.x0) / 12, x1: edge + (side * tb.x1) / 12, y0: y0 + tb.y0 / 12, y1: y0 + tb.y1 / 12 })) } : null };
    }
    const w = inputs.barrierWidth;
    const pts = [[edge, y0], [edge + side * w, y0], [edge + side * w, y0 + railH], [edge, y0 + railH]];
    return { side, pts, posts: null };
  });
  const yd1 = 16;
  const yd2 = 32;
  const yd3 = 48;
  const ySp = Y(b.surface(b.girders[0])) - 22 - railH * s * 0.15;
  const label = (k: number) => String.fromCharCode(65 + k);
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Bridge typical section">
      <Dim x1={X(0)} x2={X(b.W)} y={yd1} label={f3(b.W)} />
      <Dim x1={X(inputs.barrierWidth)} x2={X(b.W - inputs.barrierWidth)} y={yd2} label={`${f3(b.roadway)} between rails`} />
      <Dim x1={X(0)} x2={X(inputs.barrierWidth)} y={yd3} label={f3(inputs.barrierWidth)} />
      <Dim x1={X(b.W - inputs.barrierWidth)} x2={X(b.W)} y={yd3} label={f3(inputs.barrierWidth)} />
      <polygon points={deck} fill={DECK} stroke={LINE} strokeWidth="0.8" />
      {girders.map((g) => (
        <g key={g.k}>
          {hh > 0 && <polygon points={g.haunch.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} fill={DECK} stroke={LINE} strokeWidth="0.5" />}
          <polygon points={g.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} fill={GIRDER} stroke={LINE} strokeWidth="0.8" />
          <text x={X(g.xg)} y={Y(g.yTop - H) + 12} textAnchor="middle" fontSize="9" fill={LINE}>
            {label(g.k)}
          </text>
        </g>
      ))}
      {rails.map((r) => (
        <g key={r.side}>
          <polygon points={r.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} fill={RAIL} stroke={LINE} strokeWidth="0.8" />
          {r.posts && <line x1={X(r.posts.x)} x2={X(r.posts.x)} y1={Y(r.posts.y0)} y2={Y(r.posts.y1)} stroke={LINE} strokeWidth="1.4" />}
          {r.posts?.tubes.map((tb) => <rect key={tb.y0} x={Math.min(X(tb.x0), X(tb.x1))} y={Y(tb.y1)} width={Math.abs(X(tb.x1) - X(tb.x0))} height={(tb.y1 - tb.y0) * s} fill="none" stroke={LINE} strokeWidth="0.8" />)}
        </g>
      ))}
      <Dim x1={X(0)} x2={X(b.girders[0])} y={ySp} label={f3(inputs.overhang)} />
      <Dim x1={X(b.girders[0])} x2={X(b.girders[b.girders.length - 1])} y={ySp} label={`${inputs.nGirders - 1} spaces @ ${f3(inputs.S)} = ${f3((inputs.nGirders - 1) * inputs.S)}`} />
      <Dim x1={X(b.girders[b.girders.length - 1])} x2={X(b.W)} y={ySp} label={f3(inputs.overhang)} />
      {/* the crown and the cross-slopes */}
      {b.crown.kind === "crown" ? (
        <g>
          <circle cx={X(b.xc)} cy={Y(0)} r={3} fill={CROWN} />
          <line x1={X(b.xc)} x2={X(b.xc)} y1={Y(0) - 10} y2={Y(-t - hh - H / 2)} stroke={CROWN} strokeWidth="0.8" strokeDasharray="5 3" />
          <text x={X(b.xc / 2)} y={Y(b.surface(b.xc / 2)) - 4} textAnchor="middle" fontSize="9" fill={CROWN}>
            {b.slope.toFixed(3)} ft/ft
          </text>
          <text x={X((b.xc + b.W) / 2)} y={Y(b.surface((b.xc + b.W) / 2)) - 4} textAnchor="middle" fontSize="9" fill={CROWN}>
            {b.slope.toFixed(3)} ft/ft
          </text>
        </g>
      ) : (
        <text x={X(b.W / 2)} y={Y(b.surface(b.W / 2)) - 4} textAnchor="middle" fontSize="9" fill={CROWN}>
          {b.slope.toFixed(3)} ft/ft
        </text>
      )}
      <text x={VW / 2} y={VH - 8} textAnchor="middle" fontSize="10" fill={LINE}>
        {inputs.nGirders} {shape.name}
        {b.rail ? `, ${b.rail.name.replace(/ \(#\d option\)/, "")} (${b.rail.sheet})` : ""}; deck {inputs.deckT} in, haunch {inputs.haunch} in
      </text>
    </svg>
  );
}
