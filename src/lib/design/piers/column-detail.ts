import { bar } from "../stm/aashto";
import { development } from "../stm/anchorage";
import type { Pt } from "../stm/geometry";
import { classBLap, ftIn, hookLeg, roundDown } from "../rebar/bars";
import { countAt, runGroups, type PreGroup } from "../rebar/runs";
import { markGroups, schedule, type ConcreteItem } from "../rebar/schedule";
import { ftT, inT as inTex } from "../takeoff/tex";
import type { DetailView, Takeoff } from "../takeoff/types";
import { barPositions, outline } from "./column-section";
import type { ColumnInputs } from "./column";

// A pier column's bars as CDOT details them and its quantities: the longitudinal bars run up into
// the cap with standard hooks (AASHTO 5.10.2.1) and lap the footing's dowels (hooked into the
// footing) or the drilled shaft's bars at the base with Class B splices (5.10.8.4.3a); a spiral with
// 1.5 extra turns at each end and lapped 72 coated bar diameters (5.10.4.2), or closed ties with
// 135° hooks and cross-ties (5.10.4.3); concrete by the column's area and height; and the structure
// excavation and backfill around each column by CDOT M-206-2 (a frustum 1'-6" wider at the
// original ground than at the base). All bars epoxy coated (CDOT B-100-1). Inches for details.

/** The column's take-off: its bars detailed, its concrete, and its excavation and backfill. */
export function columnTakeoff(i: ColumnInputs, count?: number): Takeoff {
  const n = Math.max(1, Math.round(count ?? (i.loads === "stm" && i.link ? i.link.columns.length : 1)));
  const W = i.shape === "round" ? i.T : i.W;
  const capDepth = (i.loads === "stm" && i.link ? i.link.capDepth : i.capDepth) * 12;
  const H = i.height * 12;
  const sec = { shape: i.shape, T: i.T, W, cover: i.cover, bar: i.bar, bars: i.bars, barsT: i.barsT, barsL: i.barsL, barsEnd: i.barsEnd, tieBar: i.tieBar, transverse: i.transverse, fc: i.fc, fy: i.fy };
  const pos = barPositions(sec);
  const nb = pos.length;
  const { db } = bar(i.bar);
  const dt = bar(i.tieBar).db;
  const pre: PreGroup[] = [];
  const notes: string[] = [];
  const minGap = (() => {
    let g = Infinity;
    for (let p = 0; p < nb; p++) for (let q = p + 1; q < nb; q++) g = Math.min(g, Math.hypot(pos[p][0] - pos[q][0], pos[p][1] - pos[q][1]));
    return g;
  })();
  const lapOpts = { fy: i.fy, fc: i.fc, clearCover: i.cover + dt, clearSpacing: Math.max(0.5, minGap - db), horizontal: false, concreteBelow: 0, coating: "epoxy" as const };
  const lap = classBLap(i.bar, lapOpts);
  // Up into the cap to 6 in under its top, with a standard 90° hook turned into the cap.
  const intoCap = Math.max(0, capDepth - 6);
  const lapAtBase = lap ?? 0;
  pre.push(...runGroups({ size: i.bar, count: nb * n, straight: lapAtBase + H + intoCap, hooks: [false, true], use: "Column bars", callout: `#${i.bar} (Tot ${nb}) each column`, lap: lapOpts }).groups);
  if (i.base === "footing") {
    // Dowels: a hooked development into the footing (5.10.8.2.4), the lap above it.
    let ldh = 12 * db;
    try {
      ldh = development({ barSize: i.bar, fy: i.fy, fc: i.fc, clearCover: 3, clearSpacing: Math.max(0.5, minGap - db), horizontal: false, concreteBelow: 0, coating: "epoxy", kind: "hook" }).required;
    } catch {
      /* the default */
    }
    pre.push(...runGroups({ size: i.bar, count: nb * n, straight: ldh + lapAtBase, hooks: [true, false], use: "Footing dowels", callout: `#${i.bar} (Tot ${nb}) each column`, lap: lapOpts }).groups);
    notes.push(`The column bars lap the footing's dowels at the top of the footing (Class B, ${ftIn(roundDown(lapAtBase))}); the dowels are hooked into the footing, developed ${ftIn(Math.ceil(ldh))} (AASHTO 5.10.8.2.4).`);
  } else notes.push(`The column bars lap the drilled shaft's bars at the top of the shaft (Class B, ${ftIn(roundDown(lapAtBase))}); the shaft's bars are scheduled with the shaft.`);
  notes.push("The column bars run up into the cap with standard 90° hooks (AASHTO 5.10.2.1). All reinforcing steel is epoxy coated (CDOT B-100-1).");

  // Transverse reinforcement over the column's height (and into the cap to the lowest bars, 5.10.4.2/5.10.4.3).
  // Seismic Zone 1 with SD1 ≥ 0.10: the hinge regions (and the lap splices at the base) at the closer spacing,
  // extended into the cap and footing max(D/2, 15 in) (5.11.2, 5.11.4.1.3, 5.11.4.1.5, 5.11.4.3).
  const maxDim = Math.max(i.T, W);
  const zones: { length: number; spacing: number }[] = [];
  if (i.seismic.hinge) {
    const Lh = Math.max(maxDim, H / 6, 18);
    const ext = Math.max(maxDim / 2, 15);
    const bottom = Math.min(H, Math.max(Lh, lapAtBase));
    const top = Math.min(Lh, H - bottom);
    zones.push({ length: bottom + (i.base === "footing" ? ext : 0), spacing: i.seismic.spacing }, { length: Math.max(0, H - bottom - top), spacing: i.tieSpacing }, { length: top + ext, spacing: i.seismic.spacing });
    notes.push(`Hinge regions: ${ftIn(Math.ceil(bottom))} at the base (over the lap splices) and ${ftIn(Math.ceil(top))} under the cap at ${ftIn(i.seismic.spacing)}, extended ${ftIn(Math.ceil(ext))} into the cap${i.base === "footing" ? " and the footing" : ""} (AASHTO 5.11.4.1.3, 5.11.4.3); ${ftIn(i.tieSpacing)} between them.`);
  } else zones.push({ length: H + 6, spacing: i.tieSpacing });
  const spacingText = i.seismic.hinge ? `${ftIn(i.seismic.spacing)} in the hinge regions, ${ftIn(i.tieSpacing)} between` : ftIn(i.tieSpacing);
  if (i.transverse === "spiral") {
    const spirals = i.shape === "round" ? 1 : 2; // an oblong column: two interlocking spirals
    const Dc = (i.shape === "round" ? i.T : W) - 2 * i.cover - dt; // to the spiral bar's center
    const turns = zones.reduce((p, z) => p + z.length / z.spacing, 0) + 3; // 1.5 extra turns each end
    // A spiral is wound from coil: one continuous unit per column, its length the developed helix.
    const length = roundDown(turns * Math.PI * Dc);
    pre.push({ size: i.tieBar, count: spirals * n, shape: { kind: "straight", dims: [length] }, length, use: "Spiral", callout: `#${i.tieBar} spiral, ${spacingText} pitch, ${ftIn(Dc + dt)} outside${spirals > 1 ? ", two interlocking" : ""}` });
    notes.push(`Spiral${spirals > 1 ? "s" : ""}: one continuous unit${spirals > 1 ? " each" : ""}, ${turns.toFixed(1)} turns over the column with 1.5 extra turns at each end; any splices lapped 72 coated bar diameters (${ftIn(Math.ceil(72 * dt))}) or mechanical (AASHTO 5.10.4.2). Its length is the developed helix.`);
  } else {
    const sets = zones.reduce((p, z) => p + countAt(z.length, z.spacing), 0);
    const hook135 = hookLeg(i.tieBar, "transverse", 135).leg;
    const inT = i.T - 2 * i.cover - dt;
    const inW = W - 2 * i.cover - dt;
    if (i.shape === "round") {
      const lapHoop = Math.max(12, 1.3 * 48 * dt);
      pre.push({ size: i.tieBar, count: sets * n, shape: { kind: "straight", dims: [roundDown(Math.PI * inT + lapHoop)] }, length: roundDown(Math.PI * inT + lapHoop), use: "Hoops", callout: `#${i.tieBar} hoops @ ${spacingText}` });
    } else if (i.shape === "rectangular") {
      pre.push({ size: i.tieBar, count: sets * n, shape: { kind: "closed", dims: [roundDown(inT), roundDown(inW)], hook: roundDown(hook135) }, length: roundDown(2 * (inT + inW) + 2 * hook135), use: "Ties", callout: `#${i.tieBar} ties @ ${spacingText}` });
    } else {
      const per = 2 * (i.T - W) + Math.PI * inW + 2 * hook135;
      pre.push({ size: i.tieBar, count: sets * n, shape: { kind: "straight", dims: [roundDown(per)] }, length: roundDown(per), use: "Ties", callout: `#${i.tieBar} perimeter ties @ ${spacingText}` });
    }
    // Cross-ties: the legs beyond the perimeter tie's two each way, a 135° hook one end and 90° the other.
    const hook90 = hookLeg(i.tieBar, "transverse", 90).leg;
    const crossT = i.shape === "round" ? 0 : Math.max(0, Math.round(i.legsT) - 2); // legs running across the bridge
    const crossL = i.shape === "round" ? 0 : Math.max(0, Math.round(i.legsL) - 2);
    if (crossT) pre.push({ size: i.tieBar, count: crossT * sets * n, shape: { kind: "hooked", dims: [roundDown(hook135), roundDown(inT), roundDown(hook90)], hooks: 2 }, length: roundDown(hook135 + inT + hook90), use: "Cross-ties across", callout: `#${i.tieBar} cross-ties @ ${spacingText}` });
    if (crossL) pre.push({ size: i.tieBar, count: crossL * sets * n, shape: { kind: "hooked", dims: [roundDown(hook135), roundDown(inW), roundDown(hook90)], hooks: 2 }, length: roundDown(hook135 + inW + hook90), use: "Cross-ties along", callout: `#${i.tieBar} cross-ties @ ${spacingText}` });
  }

  // Concrete, each column from its base to the cap's soffit.
  const A = (i.shape === "round" ? (Math.PI * i.T ** 2) / 4 : i.shape === "rectangular" ? i.T * W : (i.T - W) * W + (Math.PI * W ** 2) / 4) / 144; // ft²
  const dims = i.shape === "round" ? `${ftIn(i.T)} diameter` : `${ftIn(i.T)} by ${ftIn(W)}${i.shape === "oblong" ? " oblong" : ""}`;
  // As math: the section's area and perimeter in inches.
  const AT = i.shape === "round" ? `\\frac{\\pi}{4}\\cdot\\left(${inTex(i.T)}\\right)^{2}` : i.shape === "rectangular" ? `${inTex(i.T)}\\cdot ${inTex(W)}` : `\\left(${inTex(i.T)}-${inTex(W)}\\right)\\cdot ${inTex(W)}+\\frac{\\pi}{4}\\cdot\\left(${inTex(W)}\\right)^{2}`;
  const PT = i.shape === "round" ? `\\pi\\cdot ${inTex(i.T)}` : i.shape === "rectangular" ? `2\\cdot\\left(${inTex(i.T)}+${inTex(W)}\\right)` : `2\\cdot\\left(${inTex(i.T)}-${inTex(W)}\\right)+\\pi\\cdot ${inTex(W)}`;
  const nT = n > 1 ? `${n}\\cdot ` : "";
  const concrete: ConcreteItem[] = [{ label: `Column${n > 1 ? "s" : ""}`, cy: (A * i.height * n) / 27, basis: `${n} × ${dims} (${A.toFixed(2)} ft²) by ${i.height} ft`, math: `${nT}\\left(${AT}\\right)\\cdot ${ftT(i.height)}`, ref: `Column${n > 1 ? "s" : ""}: ${n > 1 ? "number × " : ""}${dims} section × height from the base to the cap's soffit` }];

  // M-206-2: a frustum around each column from its base to the original ground, 1'-6" wider at the top.
  const d = i.ground;
  const perim = (i.shape === "round" ? Math.PI * i.T : i.shape === "rectangular" ? 2 * (i.T + W) : 2 * (i.T - W) + Math.PI * W) / 12; // ft
  const exc = n * d * (A + 0.75 * perim + 0.75 * Math.PI); // ∫ (A + P e + π e²) over e = 0 → 1.5 ft
  const quantities: Takeoff["quantities"] =
    d > 0
      ? {
          excavation: { value: exc / 27, basis: `M-206-2: around each of the ${n} column${n > 1 ? "s" : ""} from its base to the original ground, ${d} ft, 1'-6" wider at the top than the column, d·(A + 0.75·P + 0.75π)`, math: `${nT}${ftT(d)}\\cdot\\left(${AT}+0.75\\mathrm{ft}\\cdot\\left(${PT}\\right)+0.75\\cdot\\pi\\cdot\\mathrm{ft}^{2}\\right)`, ref: "M-206-2: depth × (A + 0.75 ft × P + 0.75π ft²), the column's area A and perimeter P, 1'-6\" wider at the top" },
          backfill: { value: Math.max(0, exc - n * A * d) / 27, basis: "the excavation less the columns, Structure Backfill (Class 2) (M-206-2)", math: `${nT}${ftT(d)}\\cdot\\left(0.75\\mathrm{ft}\\cdot\\left(${PT}\\right)+0.75\\cdot\\pi\\cdot\\mathrm{ft}^{2}\\right)`, ref: "M-206-2: the excavation less the column, Structure Backfill (Class 2)" },
        }
      : {};

  const groups = markGroups(pre);
  const markOf = (use: string) => groups.find((g) => g.use === use)?.mark ?? "";
  // Views: the section (bars and ties) and the elevation (bars into the cap, lapped at the base).
  const ol = outline({ shape: i.shape, T: i.T, W }, 64);
  const cx = i.T / 2;
  const cy = W / 2;
  const tieOutline = outline({ shape: i.shape, T: i.T - 2 * i.cover - dt, W: W - 2 * i.cover - dt }, 64);
  const sectionView: DetailView = {
    title: "Section",
    polys: [{ pts: ol.map(([x, y]) => [x + cx, y + cy] as Pt), style: "concrete" }],
    lines: [{ pts: [...tieOutline, tieOutline[0]].map(([x, y]) => [x + cx, y + cy] as Pt), mark: markOf(i.transverse === "spiral" ? "Spiral" : i.shape === "round" ? "Hoops" : "Ties"), kind: "stirrup" }],
    dots: pos.map(([x, y]) => ({ x: x + cx, y: y + cy, d: db, mark: markOf("Column bars") })),
  };
  const xBar = (k: number) => i.cover + dt + db / 2 + ((i.T - 2 * (i.cover + dt + db / 2)) * k) / 3;
  const lines: DetailView["lines"] = [];
  for (let k = 0; k < 4; k++) {
    const x = xBar(k);
    const top = H + intoCap;
    const leg = hookLeg(i.bar).leg;
    lines.push({ pts: [[x, -2], [x, top], [x + (k < 2 ? -leg : leg), top]], mark: markOf("Column bars"), kind: "main" });
    if (i.base === "footing") lines.push({ pts: [[x + db * 1.5, lapAtBase], [x + db * 1.5, -30], [x + db * 1.5 + (k < 2 ? -12 : 12), -30]], mark: markOf("Footing dowels"), kind: "main" });
  }
  for (let z = i.tieSpacing; z < H; z += Math.max(i.tieSpacing, H / 12)) lines.push({ pts: [[i.cover, z], [i.T - i.cover, z]], mark: markOf(i.transverse === "spiral" ? "Spiral" : i.shape === "round" ? "Hoops" : "Ties"), kind: "stirrup" });
  const elevation: DetailView = {
    title: "Elevation (across the bridge)",
    polys: [
      { pts: [[0, 0], [i.T, 0], [i.T, H], [0, H]], style: "concrete" },
      { pts: [[-24, H], [i.T + 24, H], [i.T + 24, H + capDepth], [-24, H + capDepth]], style: "dashed" },
      { pts: i.base === "footing" ? [[-36, -36], [i.T + 36, -36], [i.T + 36, 0], [-36, 0]] : [[(i.T - i.shaftD) / 2, -60], [(i.T + i.shaftD) / 2, -60], [(i.T + i.shaftD) / 2, 0], [(i.T - i.shaftD) / 2, 0]], style: "dashed" },
      ...(d > 0 ? [{ pts: [[-60, d * 12], [i.T + 60, d * 12]] as Pt[], style: "earth" as const }] : []),
    ],
    lines,
    dots: [],
    labels: [
      { x: i.T / 2, y: H + capDepth + 6, text: "Cap", anchor: "middle" },
      { x: i.T + 30, y: H / 2, text: `${i.height} ft`, anchor: "start" },
      { x: i.T / 2, y: i.base === "footing" ? -48 : -72, text: i.base === "footing" ? "Footing" : "Drilled shaft", anchor: "middle" },
    ],
  };
  return { what: `pier column${n > 1 ? "s" : ""}`, schedule: schedule(groups, concrete), quantities, views: [sectionView, elevation], notes, length: { label: "Columns", value: n, unit: "EA" } };
}
