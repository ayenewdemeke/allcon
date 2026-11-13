import type { DtInputs, DtLayout } from "@/lib/design/rating/double-tee";

// A double-tee bridge's typical section, as an inspection sketch draws one (looking along the span):
// the units with their flanges and stems, the deck, asphalt, sidewalks and rails, girder names, the
// assumed strand centroid, and the dimensions. Drawn to scale across; the depth is exaggerated when a
// wide, shallow bridge would otherwise be too thin to read. No hooks: it's also the calc package's
// picture.

const VW = 760;
const LINE = "#334155";
const CONC = "#e2e8f0";
const DECK = "#cbd5e1";
const ASPH = "#64748b";
const DIM = "#0f172a";
const STRAND = "#dc2626";

/** Inches as feet and inches, to the nearest 1/8": 6'-10 1/2", 4 1/2". */
export function ftIn(inches: number) {
  const eighths = Math.round(Math.abs(inches) * 8);
  const ft = Math.floor(eighths / 96);
  const rest = eighths - ft * 96;
  const whole = Math.floor(rest / 8);
  const frac = rest % 8;
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const f = frac ? ` ${frac / g(frac, 8)}/${8 / g(frac, 8)}` : "";
  const sign = inches < 0 ? "-" : "";
  return ft ? `${sign}${ft}'-${whole}${f}"` : `${sign}${whole}${f}"`;
}

function HDim({ x1, x2, y, label, ext = [] }: { x1: number; x2: number; y: number; label: string; ext?: [number, number][] }) {
  const mid = (x1 + x2) / 2;
  const narrow = Math.abs(x2 - x1) < label.length * 5.4 + 6;
  return (
    <g>
      {ext.map(([x, y0], k) => (
        <line key={k} x1={x} y1={y0} x2={x} y2={y + (y0 > y ? -3 : 3)} stroke={DIM} strokeWidth="0.4" />
      ))}
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={DIM} strokeWidth="0.6" />
      {[x1, x2].map((x) => (
        <line key={x} x1={x - 3} y1={y + 3} x2={x + 3} y2={y - 3} stroke={DIM} strokeWidth="0.9" />
      ))}
      <text x={narrow ? x2 + 4 : mid} y={y - 3} textAnchor={narrow ? "start" : "middle"} fontSize="9.5" fill={DIM}>
        {label}
      </text>
    </g>
  );
}

function VDim({ x, y1, y2, label, side = "left" }: { x: number; y1: number; y2: number; label: string; side?: "left" | "right" }) {
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2} stroke={DIM} strokeWidth="0.6" />
      {[y1, y2].map((y) => (
        <line key={y} x1={x - 3} y1={y + 3} x2={x + 3} y2={y - 3} stroke={DIM} strokeWidth="0.9" />
      ))}
      <text x={side === "left" ? x - 4 : x + 4} y={(y1 + y2) / 2 + 3} textAnchor={side === "left" ? "end" : "start"} fontSize="9.5" fill={DIM}>
        {label}
      </text>
    </g>
  );
}

/** `cg`: the strand centroid (in), when the bridge is rated. */
export function DtSectionSketch({ inputs: i, layout, cg }: { inputs: DtInputs; layout: DtLayout; cg: number | null }) {
  const u = i.units;
  const geo = layout.units;
  const n = geo.length;
  const deck = i.deck.present ? i.deck.thk : 0;
  const asph = i.loads.asphalt;
  const hs = u.depth - u.flangeThk;
  // Each unit's flange either side of its centerline (in): exterior flanges may be trimmed.
  const half = geo.map((g, k) => {
    if (u.layout) return { l: g.bf / 2, r: g.bf / 2 };
    const inner = u.flangeWidth / 2;
    if (k === 0) return { l: g.edge, r: inner };
    if (k === n - 1) return { l: inner, r: g.edge };
    return { l: inner, r: inner };
  });
  const left = geo[0].x - half[0].l;
  const right = geo[n - 1].x + half[n - 1].r;
  const W = right - left; // in, edge to edge of the units
  const measured = i.roadway.railToRail * 12;
  const extra = Math.max(0, (measured - W) / 2); // the rail-to-rail width beyond the units, each side
  const x0 = left - extra;
  const x1 = right + extra;

  const M = 70; // px margin each side, for the vertical dimensions
  const s = (VW - 2 * M) / (x1 - x0); // px per inch across
  const sv = Math.max(s, 70 / (u.depth + deck)); // px per inch down (the depth exaggerated if needed)
  const exaggerated = sv > s * 1.05;
  const X = (x: number) => M + (x - x0) * s;

  const sw = i.loads.sidewalks;
  const swThk = sw.length ? Math.max(...sw.map((w) => w.thk)) : 0;
  const railPx = 30; // px: the rails are schematic, not to scale
  const topDeck = u.depth + deck; // in above the stems' bottom
  const top = 46; // px, the top dimension rows
  const surfaceY = top + 30 + railPx + Math.max(asph, swThk) * sv;
  const Y = (y: number) => surfaceY + (topDeck - y) * sv; // y in inches up from the stems' bottom
  const base = Y(0);
  const VH = Math.ceil(base + 112);

  const railFace = i.roadway.railFaceOffset; // in from the edge
  const curbFace = sw.length ? i.roadway.curbFaceOffset : railFace;
  const edgeL = x0;
  const edgeR = x1;
  const typ = Math.min(1, n - 1); // a typical unit for its dimensions
  const g0 = geo[typ];
  const ss = g0.ss;

  const unitPath = (k: number) => {
    const g = geo[k];
    const xl = g.x - half[k].l;
    const xr = g.x + half[k].r;
    const sL = g.x - g.ss / 2;
    const sR = g.x + g.ss / 2;
    const t2 = u.stemTop / 2;
    const b2 = u.stemBot / 2;
    const pts: [number, number][] = [
      [xl, u.depth],
      [xr, u.depth],
      [xr, hs],
      [sR + t2, hs],
      [sR + b2, 0],
      [sR - b2, 0],
      [sR - t2, hs],
      [sL + t2, hs],
      [sL + b2, 0],
      [sL - b2, 0],
      [sL - t2, hs],
      [xl, hs],
    ];
    // A trimmed flange ends at the stem's outer face.
    return pts.map(([x, y]) => `${X(Math.min(Math.max(x, g.x - half[k].l), g.x + half[k].r)).toFixed(1)},${Y(y).toFixed(1)}`).join(" ");
  };

  // Sidewalks run from the edge to the curb face.
  const sidewalkBlocks = sw.slice(0, 2).map((w, k) => {
    const xa = k === 0 ? edgeL : edgeR - curbFace;
    return { xa, xb: xa + curbFace, thk: w.thk };
  });
  const surface = topDeck; // in, top of the deck or flange
  const roadL = edgeL + curbFace;
  const roadR = edgeR - curbFace;
  const label = (v: number) => ftIn(v);
  const totalOut = measured || W;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" role="img" aria-label="Typical section">
      <text x={VW / 2} y={16} textAnchor="middle" fontSize="12" fontWeight="600" fill={LINE}>
        Typical section, looking along the span{exaggerated ? " (depth exaggerated)" : ""}
      </text>

      {/* Asphalt between the curbs or rails */}
      {asph > 0 && <rect x={X(roadL)} y={Y(surface + asph)} width={X(roadR) - X(roadL)} height={asph * sv} fill={ASPH} opacity="0.85" />}
      {/* Deck */}
      {deck > 0 && <rect x={X(left)} y={Y(surface)} width={X(right) - X(left)} height={deck * sv} fill={DECK} stroke={LINE} strokeWidth="0.8" />}
      {/* Sidewalks */}
      {sidewalkBlocks.map((b, k) => (
        <rect key={k} x={X(b.xa)} y={Y(surface + b.thk)} width={X(b.xb) - X(b.xa)} height={b.thk * sv} fill={DECK} stroke={LINE} strokeWidth="0.8" />
      ))}
      {/* Rails: posts at each edge, the face where the rating puts it */}
      {[0, 1].map((k) => {
        // The post between the edge and the rail face (at least a few px), the rails on its face.
        const base0 = surface + (sw.length ? (sidewalkBlocks[k]?.thk ?? 0) : 0);
        const wpx = Math.min(10, Math.max(4, railFace * s));
        const xPost = k === 0 ? X(edgeL) : X(edgeR) - wpx;
        const xFace = k === 0 ? xPost + wpx : xPost;
        return (
          <g key={k}>
            <rect x={xPost} y={Y(base0) - railPx} width={wpx} height={railPx} fill="#94a3b8" stroke={LINE} strokeWidth="0.6" />
            {[0.5, 0.88].map((f) => (
              <rect key={f} x={k === 0 ? xFace : xFace - 3} y={Y(base0) - railPx * f - 2} width={3} height={4} fill={LINE} />
            ))}
          </g>
        );
      })}
      {/* Units */}
      {geo.map((g, k) => (
        <g key={k}>
          <polygon points={unitPath(k)} fill={CONC} stroke={LINE} strokeWidth="0.9" />
          {/* Strand centroid, each stem */}
          {cg !== null && [g.x - g.ss / 2, g.x + g.ss / 2].map((x) => <circle key={x} cx={X(x)} cy={Y(cg)} r={1.8} fill={STRAND} />)}
          <text x={X(g.x)} y={base + 13} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={LINE}>
            G{k + 1}
          </text>
        </g>
      ))}

      {/* Dimensions across, above */}
      <HDim x1={X(edgeL)} x2={X(edgeR)} y={top} label={`${label(totalOut)} out to out`} ext={[[X(edgeL), Y(surface)], [X(edgeR), Y(surface)]]} />
      {sw.length > 0 && i.roadway.curbToCurb > 0 && <HDim x1={X(roadL)} x2={X(roadR)} y={top + 18} label={`${label(i.roadway.curbToCurb * 12)} curb to curb`} ext={[[X(roadL), Y(surface)], [X(roadR), Y(surface)]]} />}
      {sw.length === 0 && railFace > 0 && <HDim x1={X(roadL)} x2={X(roadR)} y={top + 18} label={`${label(measured - 2 * railFace)} between rail faces`} ext={[[X(roadL), Y(surface)], [X(roadR), Y(surface)]]} />}

      {/* Dimensions across, below: a typical unit and the spacing */}
      {n > 1 && <HDim x1={X(geo[typ].x)} x2={X(geo[typ + 1 < n ? typ + 1 : typ - 1].x)} y={base + 30} label={`${label(Math.abs(geo[typ + 1 < n ? typ + 1 : typ - 1].x - geo[typ].x))} (unit spacing)`} ext={[[X(geo[typ].x), base + 18], [X(geo[typ + 1 < n ? typ + 1 : typ - 1].x), base + 18]]} />}
      <HDim x1={X(g0.x - ss / 2)} x2={X(g0.x + ss / 2)} y={base + 48} label={`${label(ss)} stems`} />
      <HDim x1={X(g0.x - half[typ].l)} x2={X(g0.x + half[typ].r)} y={base + 66} label={`${label(half[typ].l + half[typ].r)} flange`} />
      <HDim x1={X(geo[0].x - ss / 2 - u.stemBot / 2)} x2={X(geo[0].x - ss / 2 + u.stemBot / 2)} y={base + 84} label={`${label(u.stemBot)} stem, bottom (${label(u.stemTop)} top)`} />

      {/* Dimensions down, at the left */}
      <VDim x={X(edgeL) - 8} y1={Y(0)} y2={Y(u.depth)} label={label(u.depth)} />
      <VDim x={X(edgeL) - 40} y1={Y(hs)} y2={Y(u.depth)} label={label(u.flangeThk)} />
      {deck > 0 && <VDim x={X(edgeR) + 8} y1={Y(u.depth)} y2={Y(u.depth + deck)} label={`${label(deck)} deck`} side="right" />}
      {/* Strand centroid */}
      {cg !== null && (
        <>
          <line x1={X(geo[n - 1].x + ss / 2)} y1={Y(cg)} x2={X(edgeR) + 10} y2={Y(cg)} stroke={STRAND} strokeWidth="0.5" strokeDasharray="3 2" />
          <text x={X(edgeR) + 12} y={Y(cg) + 3} fontSize="9" fill={STRAND}>
            strands {label(cg)}
          </text>
        </>
      )}

      {/* The callouts, as on a sketch */}
      <text x={VW / 2} y={VH - 8} textAnchor="middle" fontSize="10" fill={LINE}>
        ({n}) precast, prestressed double tees{u.layout ? "" : ` at ${label(u.spacing)} o.c.`}
        {deck > 0 ? `, ${label(deck)} CIP deck` : ""}
        {asph > 0 ? `, ${label(asph)} asphalt` : ""}
        {!u.layout && u.exteriorTrimmed ? "; exterior flanges trimmed" : ""}
      </text>
    </svg>
  );
}
