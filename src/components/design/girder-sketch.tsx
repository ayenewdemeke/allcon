import type { GirderDesign, GirderInputs, GirderResult } from "@/lib/design/girders/prestressed";

// The girder's cross-section to scale: its outline, the haunch and the deck's effective width, and
// the strands, with the centroids marked. No hooks, so it also draws into calc packages.

const VW = 520;
const VH = 340;
const LINE = "#334155";
const GIRDER = "#cbd5e1";
const DECK = "#e2e8f0";
const HAUNCH = "#fde68a";
const STRAND = "#b91c1c";

export function GirderSketch({ inputs, result }: { inputs: GirderInputs; result: GirderResult }) {
  const { shape, comp, strands } = result;
  const H = shape.depth;
  const ts = inputs.deckT - inputs.sacrificial;
  const hh = inputs.haunch;
  const total = H + hh + inputs.deckT;
  const beff = comp.beff;
  // Scale: the deck's effective width or the depth, whichever fills the box.
  const s = Math.min((VW - 80) / beff, (VH - 90) / total);
  const cx = VW / 2;
  const yBase = VH - 40; // bottom of the girder
  const Y = (y: number) => yBase - y * s;
  const right = shape.profile.map(([y, h]) => `${cx + h * s},${Y(y)}`);
  const left = [...shape.profile].reverse().map(([y, h]) => `${cx - h * s},${Y(y)}`);
  const halfTop = shape.topWidth / 2;
  const strandDots: { x: number; y: number; debonded: boolean }[] = [];
  const pitch = 2; // in, the standard strand spacing
  for (const row of inputs.strands) {
    const n = row.count;
    // Debonded strands drawn hollow: the ones nearest the middle (the outermost stay bonded).
    const byCenter = Array.from({ length: n }, (_, k) => k).sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
    const debonded = new Set(byCenter.slice(0, (row.debondLength ?? 0) > 0 ? (row.debonded ?? 0) : 0));
    for (let k = 0; k < n; k++) strandDots.push({ x: cx + (k - (n - 1) / 2) * pitch * s, y: Y(row.y), debonded: debonded.has(k) });
  }
  // Harped strands at midspan: a bundle at their harp-point height, in the web.
  for (let k = 0; k < (inputs.harped?.count ?? 0); k++) strandDots.push({ x: cx + ((k % 2) - 0.5) * pitch * s, y: Y(inputs.harped.yHarp + Math.floor(k / 2) * pitch), debonded: false });
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Girder cross-section">
      <text x={VW / 2} y={18} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        {shape.name} — {result.exterior ? "exterior" : "interior"} girder
      </text>
      {/* deck: effective width, structural thickness and the sacrificial layer */}
      <rect x={cx - (beff / 2) * s} y={Y(H + hh + inputs.deckT)} width={beff * s} height={inputs.deckT * s} fill={DECK} stroke={LINE} strokeWidth="0.8" />
      {inputs.sacrificial > 0 && <line x1={cx - (beff / 2) * s} x2={cx + (beff / 2) * s} y1={Y(H + hh + ts)} y2={Y(H + hh + ts)} stroke={LINE} strokeWidth="0.5" strokeDasharray="3 2" />}
      {hh > 0 && <rect x={cx - halfTop * s} y={Y(H + hh)} width={shape.topWidth * s} height={hh * s} fill={HAUNCH} stroke={LINE} strokeWidth="0.6" />}
      <polygon points={[...right, ...left].join(" ")} fill={GIRDER} stroke={LINE} strokeWidth="1" />
      {strandDots.map((d, k) => (
        <circle key={k} cx={d.x} cy={d.y} r={Math.max(1.6, (inputs.strandDia / 2) * s)} fill={d.debonded ? "#ffffff" : STRAND} stroke={STRAND} strokeWidth="0.8" />
      ))}
      {/* centroids */}
      <line x1={cx + halfTop * s + 6} x2={cx + halfTop * s + 26} y1={Y(result.g.yb)} y2={Y(result.g.yb)} stroke={LINE} strokeWidth="1" />
      <text x={cx + halfTop * s + 30} y={Y(result.g.yb) + 3} fontSize="9" fill={LINE}>
        yb = {result.g.yb.toFixed(2)}&quot; (girder)
      </text>
      <line x1={cx + halfTop * s + 6} x2={cx + halfTop * s + 26} y1={Y(comp.yb)} y2={Y(comp.yb)} stroke={LINE} strokeWidth="1" strokeDasharray="3 2" />
      <text x={cx + halfTop * s + 30} y={Y(comp.yb) + 3} fontSize="9" fill={LINE}>
        ybc = {comp.yb.toFixed(2)}&quot; (composite)
      </text>
      <line x1={cx - halfTop * s - 26} x2={cx - halfTop * s - 6} y1={Y(strands.ybar)} y2={Y(strands.ybar)} stroke={STRAND} strokeWidth="1" />
      <text x={cx - halfTop * s - 30} y={Y(strands.ybar) + 3} textAnchor="end" fontSize="9" fill={STRAND}>
        {strands.N} × {inputs.strandDia}&quot; strands, cg {strands.ybar.toFixed(2)}&quot;
      </text>
      <text x={VW / 2} y={VH - 14} textAnchor="middle" fontSize="10" fill={LINE}>
        Effective deck width {(beff / 12).toFixed(2)} ft · deck {inputs.deckT}&quot; ({ts}&quot; structural) · haunch {hh}&quot; · depth {H}&quot;
      </text>
    </svg>
  );
}

/** A continuous bridge in elevation: its spans, abutments and piers, and the Strength I moment
 * envelope of a girder line (positive below the axis, negative above, as drawn on the tension side).
 * `selected` highlights a span. */
export function BridgeElevation({ design, side, selected }: { design: GirderDesign; side: "interior" | "exterior"; selected?: number }) {
  const W = 520;
  const Hgt = 190;
  const x0 = 30;
  const w = W - 60;
  const yAxis = 92;
  const spans = design.spans.map((s) => s.L);
  const total = spans.reduce((a, b) => a + b, 0);
  const starts = spans.map((_, k) => spans.slice(0, k).reduce((a, b) => a + b, 0));
  const X = (ft: number) => x0 + (ft / total) * w;
  const pts = design.spans.flatMap((s, k) => s[side].stations.map((st) => ({ X: starts[k] + st.x, pos: Math.max(0, st.Mu), neg: Math.min(0, st.negative?.Mu ?? 0) })));
  pts.sort((a, b) => a.X - b.X);
  const peak = Math.max(1, ...pts.map((p) => Math.max(p.pos, -p.neg)));
  const sc = 58 / peak;
  const line = (f: (p: (typeof pts)[number]) => number) => pts.map((p) => `${X(p.X)},${yAxis + f(p) * sc}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${Hgt}`} className="w-full" role="img" aria-label="Bridge elevation with the moment envelope">
      <text x={W / 2} y={16} textAnchor="middle" fontSize="11" fontWeight="600" fill={LINE}>
        {spans.length} spans made continuous — Strength I moments, {side} girder (kip·ft)
      </text>
      {selected !== undefined && <rect x={X(starts[selected])} y={26} width={X(starts[selected] + spans[selected]) - X(starts[selected])} height={Hgt - 52} fill="#eff6ff" />}
      <polyline points={line((p) => p.pos)} fill="none" stroke="#2563eb" strokeWidth="1.4" />
      <polyline points={line((p) => p.neg)} fill="none" stroke="#b91c1c" strokeWidth="1.4" />
      <line x1={X(0)} x2={X(total)} y1={yAxis} y2={yAxis} stroke={LINE} strokeWidth="1.6" />
      {[0, ...spans.map((_, k) => starts[k] + spans[k])].map((at, k) => (
        <g key={k}>
          <polygon points={`${X(at)},${yAxis} ${X(at) - 5},${yAxis + 9} ${X(at) + 5},${yAxis + 9}`} fill={LINE} />
          {k > 0 && k < spans.length && (
            <text x={X(at)} y={yAxis - 64} textAnchor="middle" fontSize="9" fill="#b91c1c">
              Pier {k}
            </text>
          )}
        </g>
      ))}
      {spans.map((L, k) => (
        <text key={k} x={X(starts[k] + L / 2)} y={Hgt - 22} textAnchor="middle" fontSize="9.5" fill={LINE}>
          Span {k + 1}: {L} ft
        </text>
      ))}
      <text x={W / 2} y={Hgt - 6} textAnchor="middle" fontSize="9" fill={LINE}>
        Blue: most positive Mu · red: most negative Mu (over the piers, the deck&apos;s bars in tension) · peak {Math.round(peak)} kip·ft
      </text>
    </svg>
  );
}

/** The girder in elevation, vertical scale exaggerated: the strand profile (harp points, debonded
 * lengths) along the girder's length, with the bearings. */
export function GirderElevation({ inputs, result }: { inputs: GirderInputs; result: GirderResult }) {
  const W = 520;
  const Hgt = 170;
  const x0 = 30;
  const w = W - 60;
  const H = result.shape.depth;
  const Lg = result.loads.Lg;
  const yTop = 34;
  const yBot = 120;
  const X = (ft: number) => x0 + (ft / Lg) * w;
  const Y = (inch: number) => yBot - (inch / H) * (yBot - yTop);
  const lines: { pts: string; dashed?: boolean; label?: string }[] = [];
  for (const k of result.strands.groups) {
    if (k.kind === "harped") {
      const hp = inputs.harped.harpPoint * Lg;
      lines.push({ pts: `${X(0)},${Y(k.yEnd)} ${X(hp)},${Y(k.yMid)} ${X(Lg - hp)},${Y(k.yMid)} ${X(Lg)},${Y(k.yEnd)}`, label: `${k.n} harped` });
    } else if (k.kind === "debonded") {
      lines.push({ pts: `${X(0)},${Y(k.yMid)} ${X(k.bondFrom)},${Y(k.yMid)}`, dashed: true });
      lines.push({ pts: `${X(Lg - k.bondFrom)},${Y(k.yMid)} ${X(Lg)},${Y(k.yMid)}`, dashed: true });
      lines.push({ pts: `${X(k.bondFrom)},${Y(k.yMid)} ${X(Lg - k.bondFrom)},${Y(k.yMid)}`, label: `${k.n} debonded ${k.bondFrom} ft` });
    } else lines.push({ pts: `${X(0)},${Y(k.yMid)} ${X(Lg)},${Y(k.yMid)}` });
  }
  const brg = [inputs.endDist, Lg - inputs.endDist];
  return (
    <svg viewBox={`0 0 ${W} ${Hgt}`} className="w-full" role="img" aria-label="Strand profile in elevation">
      <text x={W / 2} y={16} textAnchor="middle" fontSize="11" fontWeight="600" fill={LINE}>
        Strand profile (vertical scale exaggerated)
      </text>
      <rect x={X(0)} y={yTop} width={w} height={yBot - yTop} fill={GIRDER} stroke={LINE} strokeWidth="0.8" />
      {lines.map((l, k) => (
        <polyline key={k} points={l.pts} fill="none" stroke={STRAND} strokeWidth="1.4" strokeDasharray={l.dashed ? "3 3" : undefined} />
      ))}
      {brg.map((b, k) => (
        <polygon key={k} points={`${X(b)},${yBot} ${X(b) - 5},${yBot + 8} ${X(b) + 5},${yBot + 8}`} fill={LINE} />
      ))}
      <text x={W / 2} y={Hgt - 18} textAnchor="middle" fontSize="9.5" fill={LINE}>
        {result.strands.groups.map((k) => (k.kind === "harped" ? `${k.n} harped ${k.yEnd.toFixed(1)}→${k.yMid.toFixed(1)} in at ${inputs.harped.harpPoint}·Lg` : k.kind === "debonded" ? `${k.n} debonded ${k.bondFrom} ft (dashed)` : `${k.n} straight at ${k.yMid.toFixed(1)} in`)).join(" · ")}
      </text>
      <text x={W / 2} y={Hgt - 5} textAnchor="middle" fontSize="9.5" fill={LINE}>
        Girder {Lg.toFixed(2)} ft · span {result.L} ft between bearings
      </text>
    </svg>
  );
}

/** Handling (5.5.4.3): the girder hanging from its lifting devices, and on the haul truck, with the
 * support positions, and the tilted section on the truck's roll center at maximum superelevation. */
export function HandlingSketch({ inputs, result }: { inputs: GirderInputs; result: GirderResult }) {
  const h = result.handling;
  if (!h) return null;
  const W = 520;
  const Hgt = 230;
  const Lg = result.loads.Lg;
  const x0 = 30;
  const w = 300;
  const X = (ft: number) => x0 + (ft / Lg) * w;
  const depth = 12;
  const lift = inputs.handling.liftPoint;
  const bunk = inputs.handling.bunkPoint;
  // The section on the truck (right), to one scale: the road, the roll center, the truck's bed under the
  // girder, the girder tilted about the roll center by the superelevation and its equilibrium tilt.
  const sup = h.hauling.superelevation;
  const theta = Math.max(0, ...sup.cases.flatMap((k) => k.winds.map((wd) => (Number.isFinite(wd.thetaEq) ? wd.thetaEq : 0))));
  const sec = result.shape;
  const tr = inputs.handling.truck;
  const sS = 165 / (sec.depth + tr.Hbg);
  const cx = 430;
  const road = 205;
  const alpha = Math.atan(inputs.handling.superelevation);
  // Rotate a point (x right, y up, in, about the roll center) by an angle, to the drawing.
  const P = (x: number, y: number, ang: number) => {
    const xx = x * sS;
    const yy = -(y - tr.Hrc) * sS; // the roll center Hrc above the road
    const rc = road - tr.Hrc * sS;
    return `${cx + xx * Math.cos(ang) - yy * Math.sin(ang)},${rc + xx * Math.sin(ang) + yy * Math.cos(ang)}`;
  };
  const prof = sec.profile;
  const outline = [...prof.map(([y, hw]) => [hw, tr.Hbg + y]), ...[...prof].reverse().map(([y, hw]) => [-hw, tr.Hbg + y])];
  const girderPts = outline.map(([x, y]) => P(x, y, alpha + theta)).join(" ");
  const bed = [[-14, tr.Hrc], [14, tr.Hrc], [14, tr.Hbg], [-14, tr.Hbg]].map(([x, y]) => P(x, y, alpha + theta)).join(" "); // the bolster
  const tires = [-tr.Wcc / 2, tr.Wcc / 2].map((x) => P(x, 10, alpha).split(",").map(Number));
  const roadL = P(-70, 0, alpha);
  const roadR = P(70, 0, alpha);
  const rc = road - tr.Hrc * sS;  return (
    <svg viewBox={`0 0 ${W} ${Hgt}`} className="w-full" role="img" aria-label="Lifting and hauling">
      <text x={x0} y={16} fontSize="11" fontWeight="600" fill={LINE}>Lifting from the form</text>
      <rect x={X(0)} y={50} width={w} height={depth} fill={GIRDER} stroke={LINE} />
      {[lift, Lg - lift].map((x, k) => (
        <g key={k}>
          <line x1={X(x)} x2={X(x)} y1={24} y2={50} stroke={LINE} strokeWidth="1" />
          <circle cx={X(x)} cy={50} r={2.5} fill={LINE} />
        </g>
      ))}
      <text x={X(lift)} y={76} fontSize="9" fill={LINE}>{lift} ft</text>
      <text x={x0 + w} y={76} textAnchor="end" fontSize="9" fill={LINE}>
        FScr {fs(h.lifting.summary.FScr)} · FSf {fs(h.lifting.summary.adjFSf)}
      </text>
      <text x={x0} y={110} fontSize="11" fontWeight="600" fill={LINE}>Hauling</text>
      <rect x={X(0)} y={140} width={w} height={depth} fill={GIRDER} stroke={LINE} />
      {[bunk, Lg - bunk].map((x, k) => (
        <polygon key={k} points={`${X(x)},${152} ${X(x) - 6},${164} ${X(x) + 6},${164}`} fill={LINE} />
      ))}
      <line x1={x0} x2={x0 + w} y1={170} y2={170} stroke={LINE} strokeWidth="0.6" strokeDasharray="4 3" />
      <text x={X(bunk)} y={182} fontSize="9" fill={LINE}>{bunk} ft</text>
      <text x={x0 + w} y={182} textAnchor="end" fontSize="9" fill={LINE}>
        FScr {fs(Math.min(h.hauling.crown.summary.FScr, sup.summary.FScr))} · FSr {fs(Math.min(h.hauling.crown.summary.FSr, sup.summary.FSr))}
      </text>
      {/* the section on the truck, tilted */}
      <text x={W - 8} y={16} textAnchor="end" fontSize="11" fontWeight="600" fill={LINE}>On the truck, {(inputs.handling.superelevation * 100).toFixed(0)}%</text>
      <line x1={roadL.split(",")[0]} y1={roadL.split(",")[1]} x2={roadR.split(",")[0]} y2={roadR.split(",")[1]} stroke={LINE} strokeWidth="1.2" />
      {tires.map(([x, y], k) => (
        <circle key={k} cx={x} cy={y} r={10 * sS} fill="#475569" />
      ))}
      <polygon points={bed} fill="#e5e7eb" stroke={LINE} strokeWidth="0.6" />
      <polygon points={girderPts} fill={GIRDER} stroke={LINE} strokeWidth="1" />
      <circle cx={cx} cy={rc} r={2.5} fill={STRAND} />
      <text x={cx + 8} y={rc + 3} fontSize="9" fill={STRAND}>roll center</text>
      <text x={cx} y={road + 20} textAnchor="middle" fontSize="9" fill={LINE}>
        tilt {(theta * 1000).toFixed(1)} mrad · FSr {fs(sup.summary.FSr)}
      </text>
    </svg>
  );
}

const fs = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "∞");
