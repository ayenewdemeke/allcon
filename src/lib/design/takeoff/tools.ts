import type { CbcInputs } from "../culverts/cbc";
import { DRAIN_H, footingW, m60120Wingwall, TOE_BELOW_FOOTING, TOE_WALL, toeLength, wingwallBackfill } from "../culverts/m601-20";
import { m6011Row } from "../culverts/m601-1";
import { withRail, type DeckInputs } from "../decks/deck";
import { girderShape, type GirderInputs } from "../girders/prestressed";
import { bridgeSection, deckLength } from "../girders/bridge-deck";
import type { SignInputs } from "../signs/cantilever";
import type { StripSealInputs } from "../joints/strip-seal";
import type { CipInputs } from "../walls/cip";
import type { MseInputs } from "../walls/mse";
import type { WingwallInputs } from "../walls/wingwall";
import { bar } from "../stm/aashto";
import type { Pt } from "../stm/geometry";
import { ftIn, hookLeg, roundDown, splitRun } from "../rebar/bars";
import { countAt, runGroups, type PreGroup, type RunOptions } from "../rebar/runs";
import { markGroups, schedule, type BarShape, type ConcreteItem, type ExtraSteel } from "../rebar/schedule";
import { num } from "../calc-style";
import { avgT, ftT, inT, perFtT, plus18T, sumT } from "./tex";
import type { DetailView, Takeoff } from "./types";

// Each design tool's take-off: its bars as CDOT details them, and its quantities. The bars a
// design sizes come from its inputs; what it doesn't size follows the CDOT standard named for each
// (M-601-1/-2 box culverts, M-601-20 wingwalls, BDM Example 11 and the B-601 worksheets for
// retaining walls, the B-601-5 deck worksheets, B-503-1 drilled shafts), each assumption noted.
// Inches for details, feet for lengths along a structure.

const fit = (n: number) => Math.round(n * 1000) / 1000;
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Collects groups and their drawn lines for a take-off. */
function collector(steel: { fy: number; fc: number }) {
  const pre: PreGroup[] = [];
  const run = (o: Omit<RunOptions, "lap"> & { cover?: number; spacing?: number; lap?: boolean }) => {
    const r = runGroups({ ...o, lap: o.lap === false ? undefined : { fy: steel.fy, fc: steel.fc, clearCover: o.cover ?? 2, clearSpacing: Math.max(0.5, (o.spacing ?? 6) - bar(o.size).db) } });
    pre.push(...r.groups);
    return r;
  };
  return { pre, run };
}

function finish(pre: PreGroup[], concrete: ConcreteItem[]) {
  const groups = markGroups(pre);
  const markOf = (use: string) => groups.find((g) => g.use === use)?.mark ?? "";
  return { sch: schedule(groups, concrete), markOf };
}

// ---------------------------------------------------------------------------------------------
// Box culvert (CDOT M-601-1, M-601-2)

export function culvertTakeoff(i: CbcInputs, barrelFt = 40, site: { ground?: number; angle?: number } = {}): Takeoff {
  const n = Math.max(1, Math.round(i.cells));
  const S = i.span * 12;
  const R = i.rise * 12;
  const W = n * S + 2 * i.Ts + (n - 1) * i.Ti;
  const H = R + i.Tt + i.Tb;
  // A new culvert is one barrel with a headwall at each end. An extension is its pieces, each a new
  // stretch of barrel with a joint to the existing barrel at one end and a new headwall at the other:
  // each piece's bars run on their own (the longitudinal bars stop at the joint).
  const ext = i.extension;
  const pieces = (ext?.pieces ?? []).filter((p) => p.length > 0);
  const isExt = pieces.length > 0;
  const lengthFt = isExt ? pieces.reduce((s, p) => s + p.length, 0) : barrelFt;
  const runs = isExt ? pieces.map((p) => ({ name: p.name, L: p.length * 12 })) : [{ name: "", L: barrelFt * 12 }];
  const ends = isExt ? pieces.length : 2; // new headwalls and toewalls
  const c = i.cover;
  const cTop = i.fill <= 2 ? 2.5 : c; // M-601-1: 2½" clear at the top of the top slab when the fill is 2 ft or less
  const cBot = 3; // the bottom slab's bottom mat, cast against earth (M-601-1)
  const { pre, run } = collector(i);
  const notes: string[] = [];
  const lines: DetailView["lines"] = [];
  const dots: DetailView["dots"] = [];
  const bars = i.bars;
  const along = (s: number) => runs.reduce((t, r) => t + countAt(r.L - 2 * c, s), 0); // transverse bars in every piece
  if (isExt) notes.push(`An extension: ${pieces.map((p) => `${p.name} ${fit(p.length)} ft`).join(" and ")}, ${fit(lengthFt)} ft of new barrel in all. Each piece's bars run on their own; each has a joint with the existing barrel (dowels) and a new headwall and toewall at its open end.`);
  if (i.reinf === "wwr") notes.push("Welded wire reinforcement isn't scheduled here: the bars below are the longitudinal distribution bars only.");
  else {
    // Transverse bars by face, at the design's spacing along the barrel (normal to its centerline, M-601-1 note 13).
    const tr = (face: keyof CbcInputs["bars"], use: string, count: number, straight: number, hooks: [boolean, boolean], cover: number, pts: Pt[]) => {
      const b = bars[face];
      run({ size: b.bar, count: count * along(b.spacing), straight, hooks, use, callout: `#${b.bar} @ ${ftIn(b.spacing)} (${use.toLowerCase()})`, cover, spacing: b.spacing });
      lines.push({ pts, mark: use, kind: "main" });
    };
    const dTO = bar(bars.topOut.bar).db / 2;
    const dTI = bar(bars.topIn.bar).db / 2;
    const dBO = bar(bars.botOut.bar).db / 2;
    const dBI = bar(bars.botIn.bar).db / 2;
    const dWO = bar(bars.wallOut.bar).db / 2;
    const dWI = bar(bars.wallIn.bar).db / 2;
    // M-601-1's corner bars, where the box is in its table: c1/c2 bent into the slabs, t1/b1 straight.
    const row = i.cornerBars ? m6011Row(n, i.span, i.rise, i.fill) : null;
    if (i.cornerBars && !row) notes.push(`Corner bars: a ${n === 1 ? "" : `${n}-cell `}${i.span} × ${i.rise} ft box under ${i.fill} ft of fill isn't in M-601-1's table, which gives their legs: the walls' outside bars are detailed as one hooked bar each.`);
    const hooked = !row;
    tr("topOut", row ? "Top slab, top mat (t1)" : "Top slab, top mat", 1, W - 2 * c, [hooked, hooked], cTop, row ? [[c, H - cTop - dTO], [W - c, H - cTop - dTO]] : [[c, H - cTop - dTO - 12], [c, H - cTop - dTO], [W - c, H - cTop - dTO], [W - c, H - cTop - dTO - 12]]);
    tr("topIn", row ? "Top slab, bottom mat (t2)" : "Top slab, bottom mat", 1, W - 2 * c, [false, false], c, [[c, H - i.Tt + c + dTI], [W - c, H - i.Tt + c + dTI]]);
    tr("botOut", row ? "Bottom slab, bottom mat (b1)" : "Bottom slab, bottom mat", 1, W - 2 * c, [hooked, hooked], cBot, row ? [[c, cBot + dBO], [W - c, cBot + dBO]] : [[c, cBot + dBO + 12], [c, cBot + dBO], [W - c, cBot + dBO], [W - c, cBot + dBO + 12]]);
    tr("botIn", row ? "Bottom slab, top mat (b2)" : "Bottom slab, top mat", 1, W - 2 * c, [false, false], c, [[c, i.Tb - c - dBI], [W - c, i.Tb - c - dBI]]);
    if (row) {
      // Section B-B: c1 down the outside face v1 from under the top slab's top, its leg h1 along the top mat;
      // c2 up v2 from the bottom slab's bottom, its leg h2 along the bottom mat; w1 (v1) and w2 (v3) inside.
      const bo = bars.wallOut;
      const bi = bars.wallIn;
      const corner = (use: string, label: string, v: number, h: number, ptsL: Pt[]) => {
        run({ size: bo.bar, count: 2 * along(bo.spacing), straight: v, hooks: [h, 0], use, callout: `#${bo.bar} @ ${ftIn(bo.spacing)} (${label})`, spacing: bo.spacing, lap: false });
        lines.push({ pts: ptsL, mark: use, kind: "main" }, { pts: ptsL.map(([x, y]) => [W - x, y] as Pt), mark: use, kind: "main" });
      };
      const xo = c + dWO;
      const yt = H - cTop - dTO;
      const yb = cBot + dBO;
      corner("Corner bars, top (c1)", "c1", row.v1, row.h1, [[xo + row.h1, yt], [xo, yt], [xo, yt - row.v1]]);
      corner("Corner bars, bottom (c2)", "c2", row.v2, row.h2, [[xo + row.h2, yb], [xo, yb], [xo, yb + row.v2]]);
      const inside = (use: string, label: string, len: number, y0: number, y1: number) => {
        run({ size: bi.bar, count: 2 * along(bi.spacing), straight: len, use, callout: `#${bi.bar} @ ${ftIn(bi.spacing)} (${label})`, spacing: bi.spacing, lap: false });
        const x = i.Ts - c - dWI;
        lines.push({ pts: [[x, y0], [x, y1]], mark: use, kind: "main" }, { pts: [[W - x, y0], [W - x, y1]], mark: use, kind: "main" });
      };
      inside("Exterior walls, inside face (w1)", "w1", row.v1, H - cTop, H - cTop - row.v1);
      inside("Exterior walls, inside face (w2)", "w2", row.v3, cBot, cBot + row.v3);
      notes.push(`Corner bars and the walls' inside bars by M-601-1 Section B-B, their dimensions from Sheet 2 for a ${i.span} × ${i.rise} ft box under ${row.fill[0] === 0 ? "less than 2" : `${row.fill[0]} to ${row.fill[1]}`} ft of fill: h1 ${ftIn(row.h1)}, v1 ${ftIn(row.v1)}, h2 ${ftIn(row.h2)}, v2 ${ftIn(row.v2)}, v3 ${ftIn(row.v3)}.`);
      const std = row.bars;
      const mine = { t1b1: bars.topOut.bar, t2: bars.topIn.bar, b2: bars.botIn.bar, w: bi.bar, c1: bo.bar };
      const differ = (Object.keys(mine) as (keyof typeof mine)[]).filter((k) => mine[k] !== std[k]);
      if (differ.length || i.Tt !== row.Tt || i.Tb !== row.Tb || i.Ts !== row.TW) notes.push(`The design differs from M-601-1's box (Tt ${row.Tt}, Tb ${row.Tb}, TW ${row.TW} in; t1/b1 #${std.t1b1}, t2 #${std.t2}, b2 #${std.b2}, w #${std.w}, c #${std.c1}): the bars are the design's, the legs the standard's.`);
      notes.push(`Check set: M-601-1 Sheet 2 gives ${row.cy} CY and ${row.lb} lb per foot of this barrel, ${fit(row.cy * lengthFt)} CY and ${Math.round(row.lb * lengthFt)} lb over ${lengthFt} ft (its splices not included, note 8).`);
    } else {
      tr("wallOut", "Exterior walls, outside face", 2, H - cTop - cBot, [true, true], c, [[c + dWO + 12, cBot], [c + dWO, cBot], [c + dWO, H - cTop], [c + dWO + 12, H - cTop]]);
      lines.push({ pts: [[W - c - dWO - 12, cBot], [W - c - dWO, cBot], [W - c - dWO, H - cTop], [W - c - dWO - 12, H - cTop]], mark: "Exterior walls, outside face", kind: "main" });
      tr("wallIn", "Exterior walls, inside face", 2, H - cTop - cBot, [false, false], c, [[i.Ts - c - dWI, cBot], [i.Ts - c - dWI, H - cTop]]);
      lines.push({ pts: [[W - i.Ts + c + dWI, cBot], [W - i.Ts + c + dWI, H - cTop]], mark: "Exterior walls, inside face", kind: "main" });
    }
    if (n > 1) {
      tr("intWall", "Interior walls, each face", 2 * (n - 1), H - cTop - cBot, [false, false], c, []);
      for (let k = 1; k < n; k++) {
        const x0 = i.Ts + k * S + (k - 1) * i.Ti;
        for (const x of [x0 + c, x0 + i.Ti - c]) lines.push({ pts: [[x, cBot], [x, H - cTop]], mark: "Interior walls, each face", kind: "main" });
      }
    }
    // Haunch bars at each inside corner: the inside face's bars, across the 45° haunch with 12 db each side.
    if (i.haunch > 0) {
      const b = bars.wallIn;
      run({ size: b.bar, count: 4 * n * along(b.spacing), straight: i.haunch * Math.SQRT2 + 24 * bar(b.bar).db, use: "Haunch bars", callout: `#${b.bar} @ ${ftIn(b.spacing)} (each haunch)`, spacing: b.spacing, lap: false });
    }
  }
  // Longitudinal distribution bars (d1): #4 @ 1'-0" in each mat of each slab and each face of each wall (M-601-1).
  const d1 = (count: number, use: string) => {
    for (const r of runs) run({ size: 4, count, straight: r.L - 2 * c, use, callout: `#4 @ 1'-0" (cont.) (${use.toLowerCase()})`, spacing: 12, where: r.name ? `${r.name} piece` : undefined });
  };
  const across = countAt(W - 2 * c, 12);
  const up = countAt(R, 12);
  d1(2 * across, "Top slab, longitudinal");
  d1(2 * across, "Bottom slab, longitudinal");
  d1(2 * 2 * up + 2 * 2 * (n - 1) * up, "Walls, longitudinal");
  for (let k = 0; k < across; k++) {
    const x = c + ((W - 2 * c) * k) / Math.max(1, across - 1);
    dots.push({ x, y: H - cTop - 1.5, d: 0.5, mark: "Top slab, longitudinal" }, { x, y: cBot + 1.5, d: 0.5, mark: "Bottom slab, longitudinal" });
  }
  // An extension: dowels drilled and epoxy grouted into the existing barrel at each joint, at the middle
  // of the slabs and walls, around the section (as the plans detail them; no CDOT standard).
  if (isExt && ext && ext.bar > 0 && ext.length > 0 && ext.spacing > 0) {
    const joints = pieces.length;
    const perJoint = 2 * countAt(W - 2 * c, ext.spacing) + (n + 1) * countAt(R, ext.spacing); // both slabs, every wall
    run({ size: ext.bar, count: joints * perJoint, straight: ext.length, use: "Dowels into the existing barrel", callout: `#${ext.bar} × ${ftIn(ext.length)} @ ${ftIn(ext.spacing)} max. (drilled and epoxy grouted)`, spacing: ext.spacing, lap: false });
    notes.push(`Dowels: ${perJoint} at each of the ${joints} joint${joints > 1 ? "s" : ""} with the existing barrel (across the top and bottom slabs and up each wall, at their middles), half their length drilled and epoxy grouted into it. The drilling and grout are included in the work.`);
  }
  // Concrete: the barrel's section (less the cells, plus their haunches) by its length.
  const area = W * H - n * S * R + n * 4 * (i.haunch * i.haunch) / 2; // in²
  const lengthTex = isExt ? `\\left(${runs.map((r) => `${num(r.L / 12)}\\mathrm{ft}`).join("+")}\\right)` : `${num(lengthFt)}\\mathrm{ft}`;
  const areaTex = `${num(W)}\\mathrm{in}\\cdot ${num(H)}\\mathrm{in}-${n > 1 ? `${n}\\cdot ` : ""}${num(S)}\\mathrm{in}\\cdot ${num(R)}\\mathrm{in}${i.haunch > 0 ? `+${4 * n}\\cdot\\frac{\\left(${num(i.haunch)}\\mathrm{in}\\right)^{2}}{2}` : ""}`;
  const concrete: ConcreteItem[] = [
    {
      label: "Barrel",
      cy: ((area / 144) * lengthFt) / 27,
      basis: `${fit(area / 144)} ft² of section by ${lengthFt} ft of barrel`,
      math: `\\left(${areaTex}\\right)\\cdot ${lengthTex}`,
      ref: `Barrel: (width × height less the cell${n > 1 ? "s" : ""}${i.haunch > 0 ? ", plus the haunches" : ""}) × ${isExt ? `the ${runs.map((r) => r.name).join(" and ")} pieces` : "its length"}`,
    },
  ];
  // Headwalls and toewalls, one of each at each end, from M-601-1 Sheet 2's table: rebar by clear span
  // and bent angle, and concrete, per linear foot of headwall (its length W / sin of the bent angle).
  const angle = site.angle ?? 90;
  const hw = headwallPerLf(i.span, angle);
  const Lh = W / 12 / Math.sin((angle * Math.PI) / 180);
  const extra: ExtraSteel[] = [];
  if (hw) {
    const endsText = isExt ? `${ends} new end${ends > 1 ? "s" : ""} (the extension's open ${ends > 1 ? "ends" : "end"})` : "two ends";
    const perEnd = `${ends}\\cdot ${num(Lh)}\\mathrm{ft}`;
    concrete.push({ label: "Headwalls and toewalls", cy: ends * Lh * HEADWALL_CY_PER_LF, basis: `${endsText}, ${fit(Lh)} ft of headwall each at ${HEADWALL_CY_PER_LF} CY/LF (M-601-1 Sheet 2)`, math: `${perEnd}\\cdot ${num(HEADWALL_CY_PER_LF)}\\frac{\\mathrm{yd}^{3}}{\\mathrm{ft}}`, ref: `Headwalls and toewalls: ends × length × CY/LF (M-601-1 Sheet 2)` });
    extra.push({ label: "Headwalls and toewalls", weight: ends * Lh * hw.lb, basis: `${endsText}, ${fit(Lh)} ft each at ${hw.lb} lb/LF for a ${i.span} ft span, bent angle ${angle}° (M-601-1 Sheet 2: all the headwall's and toewall's bars)`, math: `${perEnd}\\cdot ${num(hw.lb)}\\frac{\\mathrm{lb}}{\\mathrm{ft}}`, ref: `Headwalls and toewalls: ${ends} ends, ${i.span} ft span, ${angle}° (M-601-1 Sheet 2)` });
  } else notes.push(`Headwalls and toewalls: M-601-1 has no standard for a ${i.span} ft span at a ${angle}° bent angle (a special design): not included.`);
  // Wingwalls by M-601-20: concrete stepped by h along each wall (Sheet 1), reinforcing steel from Sheet 2's table, toe walls per foot.
  const walls = i.wingwalls ?? [];
  if (!walls.length) notes.push("Wingwalls: none entered. Add them under Wingwalls (M-601-20) to include their quantities.");
  for (const w of walls) {
    const r = m60120Wingwall(w);
    const label = `${w.name} wingwall`;
    const perFt = (u: "yd^3" | "lb", rate: number) => perFtT(rate, u);
    if (r.concrete > 0) {
      // Σ length × CY/LF over the stretches of each h; stretches of equal length share their length: L·(q1 + q2 + …).
      const groups: { L: number; qs: number[] }[] = [];
      for (const s of r.segments) {
        const last = groups[groups.length - 1];
        if (last && Math.abs(last.L - s.length) < 1e-6) last.qs.push(s.cyPerLf);
        else groups.push({ L: s.length, qs: [s.cyPerLf] });
      }
      // At most four rates a term, so each fits on a line.
      const terms = groups.flatMap((g) => {
        const out: string[] = [];
        for (let k = 0; k < g.qs.length; k += 4) {
          const qs = g.qs.slice(k, k + 4);
          out.push(`${num(g.L)}\\mathrm{ft}\\cdot ${qs.length > 1 ? `\\left(${qs.map((q) => num(q)).join("+")}\\right)\\frac{\\mathrm{yd}^{3}}{\\mathrm{ft}}` : perFt("yd^3", qs[0])}`);
        }
        return out;
      });
      concrete.push({ label: `${label} (M-601-20)`, cy: r.concrete, basis: `stem and footing, ${r.segments.map((s) => `${fit(s.length)} ft at h = ${s.h} ft (${s.cyPerLf} CY/LF)`).join(", ")} (M-601-20 Sheet 1)`, terms, ref: `${label}: stem and footing, length × CY/LF for each h (M-601-20 Sheet 1)` });
    }
    if (r.cell) extra.push({ label: `${label}, c-bars #${r.cell.cBars.bar} @ ${r.cell.cBars.spacing}"`, weight: r.rebar, basis: `${fit(w.L)} ft at ${r.cell.lbPerLf} lb/LF: m = ${r.mR}, k = ${r.kR}, ${r.colLabel} (M-601-20 Sheet 2: stem and footing)`, math: `${num(w.L)}\\mathrm{ft}\\cdot ${perFt("lb", r.cell.lbPerLf)}`, ref: `${label}: m = ${r.mR} ft, k = ${r.kR} ft, ${r.colLabel}, c-bars #${r.cell.cBars.bar} @ ${r.cell.cBars.spacing}" (M-601-20 Sheet 2)` });
    if (r.toe) {
      // Along the front and across the end: the wall's length plus the footing's width at the tip.
      const tlT = `\\left(${ftT(w.L)}+${ftT(r.toe.length - w.L)}\\right)`;
      concrete.push({ label: `${label} toe wall`, cy: r.toe.cy, basis: `${fit(r.toe.length)} ft (the wall's length and the footing's end) at ${TOE_WALL.cyPerLf} CY/LF (M-601-20 Sheet 1)`, math: `${tlT}\\cdot ${perFt("yd^3", TOE_WALL.cyPerLf)}`, ref: `${label} toe wall: front and end × CY/LF (M-601-20 Sheet 1)` });
      extra.push({ label: `${label} toe wall`, weight: r.toe.lb, basis: `${fit(r.toe.length)} ft at ${TOE_WALL.lbPerLf} lb/LF (M-601-20 Sheet 1)`, math: `${tlT}\\cdot ${perFt("lb", TOE_WALL.lbPerLf)}`, ref: `${label} toe wall: front and end × lb/LF (M-601-20 Sheet 1)` });
    }
    if (!r.inTable) notes.push(`${label}: ${r.issues.join(" ")}${r.cell ? "" : " Its reinforcing steel isn't included."}`);
    if (r.drain) notes.push(`${label}: m ≥ ${DRAIN_H} ft, so drainage behind the wall is required (M-601-20 note 6); its cost is included in the work.`);
  }
  // Structure excavation and backfill by M-206-1: the trench 1'-6" outside the walls and past each end,
  // from the original ground to the box's bottom (Case 1, ground less than 1 ft above the bottom: the
  // embankment built up and excavated isn't paid); backfill (Class 1) within those limits up to the
  // finished surface over the box, less the box.
  const ground = (site.ground ?? i.rise + (i.Tt + i.Tb) / 12 + i.fill) * 12; // in above the box's bottom
  // An extension's pieces: 1'-6" past the open end only (the existing barrel is at the other).
  const past = isExt ? 18 : 36;
  const plan = runs.reduce((s, r) => s + (W + 36) * (r.L + past), 0); // in²
  const planText = runs.map((r) => `${fit((W + 36) / 12)} ft by ${fit((r.L + past) / 12)} ft`).join(" and ");
  const Lb = lengthFt * 12;
  const caseOne = ground < 12;
  const quantities: Takeoff["quantities"] = {};
  // The plan as math: (W + 2·18 in) × (the barrel, or its pieces, + 18 in past each end that's open).
  // The plan's width and length in feet (1'-6" outside the walls and past each open end), to keep the lines short.
  const widthT = ftT((W + 36) / 12);
  const runsT = runs.map((r) => ftT(r.L / 12));
  const planLenT = ftT(runs.reduce((s, r) => s + r.L + past, 0) / 12);
  const barrelT = isExt ? sumT(runsT) : ftT(lengthFt);
  // Structure excavation: M-206-1's trench from the original ground to the box's bottom (Case 2); below
  // the box down to the elevation the plans give (M-206-1 note 1: patterns shown on the plans, e.g. to
  // bedrock), refilled with structure backfill; the box's toewalls where they reach deeper; and the
  // wingwalls' footings and toe walls, 1'-6" all round (M-206-1 Sheet 2, "Wingwall"). Feet and ft³.
  const ex = i.excavation;
  const groundFt = caseOne ? 0 : ground / 12;
  const bottomAt = (inv: number | null) => (inv === null ? null : inv - i.Tb / 12);
  const below = (end: "inlet" | "outlet") => {
    if (!ex) return 0;
    if (ex.to === null) return Math.max(0, ex.depth ?? 0); // a depth below the box, the same at both ends
    const bIn = bottomAt(ex.inletInvert);
    const bOut = bottomAt(ex.outletInvert);
    const b = end === "inlet" ? (bIn ?? bOut) : (bOut ?? bIn);
    return b === null ? 0 : Math.max(0, b - ex.to);
  };
  // A piece named for its end ("Inlet", "Outlet"); otherwise the first is at the inlet.
  const endOf = (name: string, k: number): "inlet" | "outlet" => (/\boutlet\b/i.test(name) ? "outlet" : /\binlet\b/i.test(name) ? "inlet" : k === 0 ? "inlet" : "outlet");
  const runDepth = runs.map((r, k) => (isExt ? below(endOf(r.name, k)) : (below("inlet") + below("outlet")) / 2));
  const wFt = (W + 36) / 12;
  const exc: { v: number; t: string }[] = [];
  const refill: { v: number; t: string }[] = [];
  if (groundFt > 0) exc.push({ v: wFt * (plan / (W + 36) / 12) * groundFt, t: `${widthT}\\cdot ${planLenT}\\cdot ${ftT(groundFt)}` });
  runs.forEach((r, k) => {
    const d = runDepth[k];
    if (d <= 0) return;
    const one = { v: wFt * ((r.L + past) / 12) * d, t: `${widthT}\\cdot ${ftT((r.L + past) / 12)}\\cdot ${ftT(d)}` };
    exc.push(one);
    refill.push(one);
  });
  // The box's toewalls (M-601-1 Section A-A): 8 in wide, 3'-0" below the floor's top, at each new end.
  const toeBelow = 3 - i.Tb / 12;
  const openEnds: ("inlet" | "outlet")[] = isExt ? runs.map((r, k) => endOf(r.name, k)) : ["inlet", "outlet"];
  for (const end of openEnds) {
    const extraD = toeBelow - below(end);
    if (extraD > 0.01) exc.push({ v: (44 / 12) * wFt * extraD, t: `${ftT(44 / 12)}\\cdot ${widthT}\\cdot ${ftT(extraD)}` });
  }
  const wingExc = !ex || ex.wingwalls;
  if (wingExc)
    for (const w of i.wingwalls ?? []) {
      const r = m60120Wingwall(w);
      if (!r.segments.length) continue;
      const area = r.segments.reduce((s, x) => s + x.length * (footingW(x.h) + 3), 0); // footing + 1'-6" each side
      // To the footing's bottom (placed with the box's floor); the over-excavation is the barrel's only.
      const d = groundFt + Math.max(0, 1 - i.Tb / 12);
      if (d > 0.01) exc.push({ v: area * d, t: `${num(area)}\\mathrm{ft}^{2}\\cdot ${ftT(d)}` });
      const tl = toeLength(w);
      if (w.toeWall) exc.push({ v: (44 / 12) * tl * TOE_BELOW_FOOTING, t: `${ftT(44 / 12)}\\cdot ${ftT(tl)}\\cdot ${ftT(TOE_BELOW_FOOTING)}` });
    }
  const excV = exc.reduce((s, x) => s + x.v, 0);
  const parts = [groundFt > 0 ? "the trench from the original ground to the box's bottom (Case 2)" : "", runDepth.some((d) => d > 0) ? (ex!.to !== null ? `below the box to elevation ${num(ex!.to)}` : `${num(ex!.depth ?? 0)} ft below the box`) : "", "the toewalls' trenches where deeper", wingExc && (i.wingwalls ?? []).length ? "the wingwalls' footings and toe walls" : ""].filter(Boolean);
  if (excV > 0) quantities.excavation = { value: excV / 27, basis: `M-206-1: 1'-6" outside the concrete; ${parts.join(", ")}`, terms: exc.map((x) => x.t), ref: `M-206-1, 1'-6" outside the concrete: ${parts.join("; ")}` };
  if (caseOne) notes.push("M-206-1 Case 1 (original ground less than 1 ft above the box's bottom): the embankment built up and excavated to the box's bottom is included in the work, not measured.");
  if (ex && ex.to !== null && runDepth.every((d) => d <= 0)) notes.push("Excavation below the box: the elevation given is at or above the box's bottom (the inverts less the bottom slab), so none is measured.");
  if (!wingExc && (i.wingwalls ?? []).length) notes.push("The wingwalls' excavation isn't measured here (as on plans that pay it under another item, such as channel excavation).");
  // Backfill around each wingwall (M-206-1 Sheet 2): its length × (the section behind it, averaged over
  // its stretches, + the 1'-6" strip in front beside the toe wall).
  for (const w of i.wingwalls ?? []) {
    const b = wingwallBackfill(w);
    if (!(b.total > 0)) continue;
    const frontD = w.toeWall ? TOE_BELOW_FOOTING + 1 : 1;
    refill.push({ v: b.back, t: `${ftT(w.L)}\\cdot ${num(b.back / w.L)}\\mathrm{ft}^{2}` }, { v: b.front, t: `${ftT(w.toeWall ? toeLength(w) : w.L)}\\cdot 1.5\\mathrm{ft}\\cdot ${ftT(frontD)}` });
  }
  // An extension: backfill where the existing wingwalls and footings come out (as the plans' removal limits give it).
  if (isExt && (ext?.removalBackfill ?? 0) > 0) refill.push({ v: ext!.removalBackfill! * 27, t: `${num(ext!.removalBackfill!)}\\mathrm{yd}^{3}` });
  const refillV = refill.reduce((s, x) => s + x.v, 0);
  // M-206-1 (Concrete Box Culvert, Cases 1 and 2): structure backfill 1'-6" outside the walls, from the
  // box's bottom to 1 ft over its top (embankment above that, by the roadway's items), less the box.
  const over = Math.min(12, i.fill * 12); // in, 1 ft over the top (the fill, where it's less)
  quantities.backfill = {
    value: (plan * (H + over) - W * Lb * H) / 46656 + refillV / 27,
    basis: `M-206-1: ${planText}, within 1'-6" of the walls and ${isExt ? "the open ends" : "ends"}, from the box's bottom to ${over === 12 ? "1 ft" : `${fit(over / 12)} ft`} over its top, less the box${refillV > 0 ? "; plus any excavation below the box, refilled, and the backfill around the wingwalls (M-206-1 Sheet 2)" : ""}`,
    terms: [`${widthT}\\cdot ${planLenT}\\cdot\\left(${inT(H)}+${inT(over)}\\right)`, `-${inT(W)}\\cdot ${inT(H)}\\cdot ${barrelT}`, ...refill.map((x) => x.t)],
    ref: `M-206-1: 1'-6" outside the walls, to 1 ft over the box, less the box${refillV > 0 ? "; plus below the box and around the wingwalls" : ""}`,
  };
  if ((i.wingwalls ?? []).length) notes.push("Backfill around the wingwalls (M-206-1 Sheet 2, Wingwall): behind each, from 1'-6\" past its footing's heel up to the finished surface, taken level with the wall's top; in front, the 1'-6\" strip beside the toe wall up to the footing's top.");
  if (isExt) quantities.removal = { value: 1, basis: `Partial removal of the existing barrel's headwall${pieces.length > 1 ? "s" : ""}, wingwalls and toewalls at ${pieces.length > 1 ? "each joint" : "the joint"}, to the limits on the plans` };
  const { sch: bars0, markOf } = finish(pre, concrete);
  const sch = extra.length ? schedule(bars0.groups, concrete, extra) : bars0;
  // An extension waterproofed as plans may require (25250, C04 notes 1 and 2): the top and 18 in down the
  // walls along the new barrel, and at each joint both concrete faces (with the existing headwall,
  // 1 ft over the top) and 18 in each side of it down the exterior walls.
  if (isExt && ext?.waterproofJoints) {
    const joints = pieces.length;
    const Hh = H + 12; // the existing headwall stays at the joint
    const face = (W * Hh - n * S * R) / 144; // ft²
    quantities.waterproofing = {
      value: (((W + 36) / 12) * lengthFt + joints * 2 * face + joints * 2 * 3 * (Hh / 12)) / 9,
      basis: `the top of the top slab and 18 in down each exterior wall along the ${fit(lengthFt)} ft of new barrel; at each of the ${joints} joint${joints > 1 ? "s" : ""}, both faces (${fit(face)} ft² each, with the existing headwall) and a 3 ft band down each exterior wall`,
      terms: [`${ftT((W + 36) / 12)}\\cdot ${barrelT}`, `${joints}\\cdot 2\\cdot\\left(${inT(W)}\\cdot ${inT(Hh)}-${n > 1 ? `${n}\\cdot ` : ""}${inT(S)}\\cdot ${inT(R)}\\right)`, `${joints}\\cdot 2\\cdot 3\\mathrm{ft}\\cdot ${inT(Hh)}`],
      ref: "the top and 18 in down the walls; both faces of each joint and 18 in each side of it",
    };
  } else if (i.fill <= 2) quantities.waterproofing = { value: (((W + 2 * 18) / 12) * lengthFt) / 9, basis: "The top of the top slab and 18 in down each exterior wall, as M-601-1 note 16 requires for fill of 2 ft or less", math: `${plus18T(inT(W))}\\cdot ${isExt ? sumT(runs.map((r) => ftT(r.L / 12))) : ftT(lengthFt)}`, ref: "the top of the top slab and 18 in down each exterior wall (M-601-1 note 16)" };
  const holes = Array.from({ length: n }, (_, k) => {
    const x0 = i.Ts + k * (S + i.Ti);
    const h = i.haunch;
    return [[x0 + h, i.Tb], [x0 + S - h, i.Tb], [x0 + S, i.Tb + h], [x0 + S, i.Tb + R - h], [x0 + S - h, i.Tb + R], [x0 + h, i.Tb + R], [x0, i.Tb + R - h], [x0, i.Tb + h]] as Pt[];
  });
  const view: DetailView = { title: "Section A-A (normal to the barrel)", polys: [{ pts: rect(0, 0, W, H), style: "concrete" }, ...holes.map((pts) => ({ pts, style: "void" as const }))], lines: lines.map((l) => ({ ...l, mark: markOf(l.mark) })), dots: dots.map((d) => ({ ...d, mark: markOf(d.mark) })), labels: [{ x: W / 2, y: -10, text: `${n} cell${n > 1 ? "s" : ""}, ${ftIn(S)} × ${ftIn(R)} clear, ${ftIn(W)} out to out`, anchor: "middle" }] };
  return {
    what: `${n === 1 ? "single" : n === 2 ? "double" : `${n}-cell`} concrete box culvert`,
    schedule: sch,
    quantities,
    views: [view],
    notes,
    // An extension's length is its pieces' (entered with the design).
    length: isExt ? undefined : { label: "Barrel length", value: lengthFt, unit: "ft" },
    fields: [
      { key: "ground", label: "Original ground above the box's bottom", unit: "ft", value: fit(ground / 12), step: 0.5, hint: "for structure excavation (M-206-1)" },
      { key: "angle", label: "Headwall bent angle", unit: "deg", value: angle, step: 1, hint: "90° for a square headwall" },
    ],
  };
}

/** M-601-1 Sheet 2: headwall and toewall concrete per linear foot of headwall (one of each). */
const HEADWALL_CY_PER_LF = 0.086;

/** M-601-1 Sheet 2: headwall and toewall rebar (lb per LF of headwall) by clear span and bent angle; null where it calls for a special design. */
export function headwallPerLf(span: number, angle: number): { lb: number } | null {
  const table: Record<number, [number | null, number | null, number | null]> = {
    6: [22.8, 22.2, 34.6],
    8: [23.0, 28.8, 44.0],
    10: [28.5, 35.1, 68.7],
    12: [35.3, 34.4, 71.7],
    14: [34.2, 41.5, null],
    16: [33.1, 54.0, null],
    18: [39.5, 63.3, null],
    20: [39.3, null, null],
  };
  const col = angle >= 75 ? 0 : angle >= 60 ? 1 : angle >= 45 ? 2 : -1;
  if (col < 0) return null;
  const spans = Object.keys(table).map(Number);
  const s = spans.find((x) => x >= span - 1e-9); // the table's span at or above the culvert's
  if (s === undefined) return null;
  const v = table[s][col as 0 | 1 | 2];
  return v === null || v === undefined ? null : { lb: v };
}

// ---------------------------------------------------------------------------------------------
// CIP cantilever retaining wall (CDOT BDM Example 11, worksheet B-601-3)

export function cipWallTakeoff(i: CipInputs, lengthFt = 50, site: { ground?: number } = {}): Takeoff {
  const D = i.D;
  const B = i.B;
  const A = i.A;
  const H = (i.Df === 0 ? i.He + D / 12 : i.He + i.Df) * 12;
  const hs = H - D;
  const Tt = i.Tt;
  const T1 = i.frontBatter * (hs / 12);
  const T2 = i.backBatter * (hs / 12);
  const Tb = Tt + T1 + T2;
  const C = B - A - Tb;
  const Lw = lengthFt * 12;
  const { pre, run } = collector(i);
  const lines: DetailView["lines"] = [];
  const dots: DetailView["dots"] = [];
  const along = (s: number) => countAt(Lw - 2 * 2, s);
  const notes: string[] = [];
  // Stem: back face (retained) verticals, the design's bars, hooked into the footing's bottom mat toward the toe.
  const sb = i.stemBars;
  const xBack = A + Tb - i.coverStem - bar(sb.bar).db / 2;
  const legFoot = Math.min(hookLeg(sb.bar).leg, A + T1 + Tt / 2);
  run({ size: sb.bar, count: along(sb.spacing), straight: hs - i.coverStem + (D - i.coverToe - bar(i.toeBars.bar).db), hooks: [legFoot, 0], use: "Stem, back face vertical", callout: `#${sb.bar} @ ${ftIn(sb.spacing)} (back face)`, cover: i.coverStem, spacing: sb.spacing });
  lines.push({ pts: [[xBack - legFoot, i.coverToe + 1], [xBack, i.coverToe + 1], [A + Tt + T1 - i.coverStem, H - i.coverStem]], mark: "Stem, back face vertical", kind: "main" });
  // Front face verticals and horizontals each face: the stem's temperature bars (5.10.6).
  const st = i.stemTemp;
  run({ size: st.bar, count: along(st.spacing), straight: hs - i.coverStem + D - i.coverToe - 3, use: "Stem, front face vertical", callout: `#${st.bar} @ ${ftIn(st.spacing)} (front face)`, cover: i.coverStem, spacing: st.spacing });
  lines.push({ pts: [[A + i.coverStem, i.coverToe + 3], [A + T1 + i.coverStem, H - i.coverStem]], mark: "Stem, front face vertical", kind: "secondary" });
  const rows = countAt(hs - 2 * i.coverStem, st.spacing);
  run({ size: st.bar, count: 2 * rows, straight: Lw - 4, use: "Stem, horizontal", callout: `#${st.bar} @ ${ftIn(st.spacing)} each face (horiz.)`, cover: i.coverStem, spacing: st.spacing });
  for (let k = 0; k < rows; k++) {
    const y = D + i.coverStem + ((hs - 2 * i.coverStem) * k) / Math.max(1, rows - 1);
    const f = (y - D) / hs;
    dots.push({ x: A + T1 * (1 - f) + i.coverStem + 1, y, d: bar(st.bar).db, mark: "Stem, horizontal" }, { x: A + Tb - T2 * f - i.coverStem - 1, y, d: bar(st.bar).db, mark: "Stem, horizontal" });
  }
  // Footing: heel bars (top, transverse) and toe bars (bottom, transverse), each the full base less cover, hooked at the ends; temperature bars lengthwise.
  const hb = i.heelBars;
  run({ size: hb.bar, count: along(hb.spacing), straight: B - 2 * 3, hooks: [false, true], use: "Footing, top transverse", callout: `#${hb.bar} @ ${ftIn(hb.spacing)} (top of footing)`, cover: i.coverHeel, spacing: hb.spacing });
  lines.push({ pts: [[3, D - i.coverHeel], [B - 3, D - i.coverHeel], [B - 3, D - i.coverHeel - 10]], mark: "Footing, top transverse", kind: "main" });
  const tb = i.toeBars;
  run({ size: tb.bar, count: along(tb.spacing), straight: B - 2 * 3, hooks: [true, false], use: "Footing, bottom transverse", callout: `#${tb.bar} @ ${ftIn(tb.spacing)} (bottom of footing)`, cover: i.coverToe, spacing: tb.spacing });
  lines.push({ pts: [[3, i.coverToe + 10], [3, i.coverToe], [B - 3, i.coverToe]], mark: "Footing, bottom transverse", kind: "main" });
  const ht = i.heelTemp;
  const tt = i.toeTemp;
  const topCount = countAt(B - 6, ht.spacing);
  const botCount = countAt(B - 6, tt.spacing);
  run({ size: ht.bar, count: topCount, straight: Lw - 4, use: "Footing, top longitudinal", callout: `#${ht.bar} @ ${ftIn(ht.spacing)} (top, long.)`, cover: i.coverHeel, spacing: ht.spacing });
  run({ size: tt.bar, count: botCount, straight: Lw - 4, use: "Footing, bottom longitudinal", callout: `#${tt.bar} @ ${ftIn(tt.spacing)} (bottom, long.)`, cover: i.coverToe, spacing: tt.spacing });
  for (let k = 0; k < topCount; k++) dots.push({ x: 3 + ((B - 6) * k) / Math.max(1, topCount - 1), y: D - i.coverHeel - 1.5, d: bar(ht.bar).db, mark: "Footing, top longitudinal" });
  for (let k = 0; k < botCount; k++) dots.push({ x: 3 + ((B - 6) * k) / Math.max(1, botCount - 1), y: i.coverToe + 1.5, d: bar(tt.bar).db, mark: "Footing, bottom longitudinal" });
  // Shear key: its bars as dowels from the key into the footing.
  if (i.shearKey && i.keyDepth > 0) {
    const kb = i.keyBars;
    run({ size: kb.bar, count: along(kb.spacing), straight: i.keyDepth + D - i.coverKey - i.coverHeel, hooks: [false, true], use: "Shear key dowels", callout: `#${kb.bar} @ ${ftIn(kb.spacing)} (key)`, cover: i.coverKey, spacing: kb.spacing });
  }
  // Concrete: stem and footing (and key) by the wall's length.
  const stemArea = ((Tt + Tb) / 2) * hs;
  const footArea = B * D + (i.shearKey ? i.keyDepth * i.keyWidth : 0);
  const keyed = i.shearKey && i.keyDepth * i.keyWidth > 0;
  const stemAreaT = `${avgT(inT(Tt), inT(Tb))}\\cdot ${inT(hs)}`;
  const footAreaT = keyed ? `\\left(${inT(B)}\\cdot ${inT(D)}+${inT(i.keyDepth)}\\cdot ${inT(i.keyWidth)}\\right)` : `${inT(B)}\\cdot ${inT(D)}`;
  const stemT = `${stemAreaT}\\cdot ${ftT(lengthFt)}`;
  const footT = `${footAreaT}\\cdot ${ftT(lengthFt)}`;
  const concrete: ConcreteItem[] = [
    { label: "Stem", cy: ((stemArea / 144) * lengthFt) / 27, basis: `${fit(stemArea / 144)} ft² by ${lengthFt} ft`, math: stemT, ref: `Stem: ${Tt === Tb ? "thickness" : "average thickness (top and bottom)"} × height above the footing × length` },
    { label: "Footing", cy: ((footArea / 144) * lengthFt) / 27, basis: `${fit(footArea / 144)} ft²${i.shearKey ? " with the key" : ""} by ${lengthFt} ft`, math: footT, ref: `Footing: width × depth${keyed ? ", plus the shear key," : ""} × length` },
  ];
  notes.push("Expansion joints and weakened planes per worksheet B-601-3 (bars run continuous through weakened planes); the stem's horizontal bars are lapped where longer than stock.");
  if (C < 0) notes.push("The footing has no heel: check the base's dimensions.");
  // Structure excavation and backfill by M-206-1 (retaining wall in cut): 1'-6" beyond the footing's toe,
  // heel and ends, from the original ground to the footing's bottom; backfill within the same limits up
  // to the finished grade at the top of the wall, less the wall. Any further excavation isn't paid.
  const ground = (site.ground ?? H / 12) * 12;
  const plan = (B + 36) * (Lw + 36);
  const wallVol = (stemArea * Lw + footArea * Lw) as number;
  const quantities: Takeoff["quantities"] = {
    excavation: { value: (plan * ground) / 46656, basis: `M-206-1 (retaining wall in cut): ${fit((B + 36) / 12)} ft by ${fit((Lw + 36) / 12)} ft, ${fit(ground / 12)} ft from the original ground to the footing's bottom`, math: `${plus18T(inT(B))}\\cdot ${plus18T(ftT(lengthFt))}\\cdot ${ftT(ground / 12)}`, ref: "M-206-1 (retaining wall in cut): 1'-6\" beyond the toe, heel and ends, from the original ground to the footing's bottom" },
    backfill: { value: Math.max(0, plan * H - wallVol) / 46656, basis: `M-206-1: within 1'-6" of the footing and ends, from the footing's bottom to the top of the wall, less the wall (Class 1 or 2 as the plans show)`, ...(plan * H - wallVol > 0 ? { terms: [`${plus18T(inT(B))}\\cdot ${plus18T(ftT(lengthFt))}\\cdot ${inT(H)}`, `-${stemAreaT}\\cdot ${ftT(lengthFt)}`, `-${footAreaT}\\cdot ${ftT(lengthFt)}`], ref: "M-206-1: the same limits up to the top of the wall, less the wall" } : {}) },
  };
  const { sch, markOf } = finish(pre, concrete);
  const outline: Pt[] = [[0, 0], [B, 0], [B, D], [A + Tb, D], [A + Tb - T2, H], [A + T1, H], [A, D], [0, D]];
  const view: DetailView = {
    title: "Typical section",
    polys: [{ pts: outline, style: "concrete" }, ...(i.shearKey && i.keyDepth > 0 ? [{ pts: rect(B - (i.keyFromHeel ?? B / 3) - i.keyWidth / 2, -i.keyDepth, B - (i.keyFromHeel ?? B / 3) + i.keyWidth / 2, 0), style: "concrete" as const }] : [])],
    lines: lines.map((l) => ({ ...l, mark: markOf(l.mark) })),
    dots: dots.map((d) => ({ ...d, mark: markOf(d.mark) })),
    labels: [{ x: B / 2, y: -14, text: `${ftIn(H)} high, ${ftIn(B)} base`, anchor: "middle" }],
  };
  return {
    what: "CIP cantilever retaining wall",
    schedule: sch,
    quantities,
    views: [view],
    notes,
    length: { label: "Wall length", value: lengthFt, unit: "ft" },
    fields: [{ key: "ground", label: "Original ground above the footing's bottom", unit: "ft", value: fit(ground / 12), step: 0.5, hint: "for structure excavation (M-206-1)" }],
  };
}

// ---------------------------------------------------------------------------------------------
// Wingwall off an abutment (CDOT M-601-20, BDM Example 8)

export function wingwallTakeoff(i: WingwallInputs): Takeoff {
  const L = i.L * 12;
  const H = i.H * 12;
  const h = i.h * 12;
  const t = i.t;
  const c = i.cover;
  const { pre, run } = collector(i);
  const notes: string[] = [];
  const lines: DetailView["lines"] = [];
  // Horizontal bars, retained face: the design's, in rows up the wall, each as long as the wall is at its height, run into the abutment with a standard hook.
  const b = i.bars;
  const rows = countAt(H - 2 * c, b.spacing);
  const embed = Math.max(0, i.A * 12 - c);
  // A bar series (CDOT 4.3): the bars' straight part varies with the wall's sloping top; counted at the average.
  const series = (size: number, count: number, straights: number[], leg: number, use: string, callout: string) => {
    const [lo, hi] = [Math.min(...straights), Math.max(...straights)];
    const avg = straights.reduce((s, x) => s + x, 0) / straights.length;
    const varies = hi - lo >= 1;
    const shape: BarShape = leg > 0 ? { kind: "hooked", dims: [roundDown(leg), roundDown(hi)], hooks: 1 } : { kind: "straight", dims: [roundDown(hi)] };
    pre.push({ size, count, shape, length: roundDown(avg + leg), use, callout, where: varies ? "series" : undefined, series: varies ? { dim: leg > 0 ? 1 : 0, min: roundDown(lo), max: roundDown(hi) } : undefined });
  };
  const horiz: number[] = [];
  for (let k = 0; k < rows; k++) {
    const y = c + ((H - 2 * c) * k) / Math.max(1, rows - 1);
    const len = y <= h ? L : (L * (H - y)) / Math.max(1e-9, H - h);
    horiz.push(Math.max(12, len - c) + embed);
    lines.push({ pts: [[-embed, y], [Math.max(12, len - c), y]], mark: "Horizontal, retained face", kind: "main" });
  }
  series(b.bar, rows, horiz, hookLeg(b.bar).leg, "Horizontal, retained face", `#${b.bar} @ ${ftIn(b.spacing)} (retained face)`);
  // Front face horizontals and verticals each face: shrinkage and temperature bars (5.10.6), #4 @ 12" assumed.
  run({ size: 4, count: countAt(H - 2 * c, 12), straight: L - c + embed, use: "Horizontal, front face", callout: `#4 @ 1'-0" (front face)`, spacing: 12, cover: c });
  const nv = countAt(L - 2 * c, 12);
  const verts = Array.from({ length: nv }, (_, k) => Math.max(12, H - ((H - h) * (c + ((L - 2 * c) * k) / Math.max(1, nv - 1))) / L - 2 * c));
  series(4, 2 * nv, verts, 0, "Vertical, each face", `#4 @ 1'-0" each face (vert.)`);
  notes.push("The front face's horizontals and the vertical bars are shrinkage and temperature bars (AASHTO 5.10.6), #4 at 12 in assumed: set them to the design's where it sizes them. Tie to the abutment per M-601-20.");
  const area = ((H + h) / 2) * L; // in² of elevation
  const concrete: ConcreteItem[] = [{ label: "Wingwall", cy: (area * t) / 46656, basis: `${fit(area / 144)} ft² of elevation by ${ftIn(t)} thick`, math: `${avgT(inT(H), inT(h))}\\cdot ${inT(L)}\\cdot ${inT(t)}`, ref: `Wingwall: ${H === h ? "height" : "average height (at the abutment and the tip)"} × length × thickness` }];
  const { sch, markOf } = finish(pre, concrete);
  const view: DetailView = { title: "Elevation (retained face)", polys: [{ pts: [[0, 0], [L, 0], [L, h], [0, H]], style: "concrete" }, { pts: rect(-i.A * 12, 0, 0, H), style: "dashed" }], lines: lines.map((l) => ({ ...l, mark: markOf(l.mark) })), dots: [], labels: [{ x: -i.A * 6, y: H + 8, text: "Abutment", anchor: "middle" }] };
  return { what: "wingwall", schedule: sch, quantities: {}, views: [view], notes };
}

// ---------------------------------------------------------------------------------------------
// Deck slab (CDOT worksheets B-601-5C/5S)

export function deckTakeoff(i: DeckInputs, lengthFt = 100): Takeoff {
  const Wd = ((i.nGirders - 1) * i.S + 2 * i.overhang) * 12;
  const Ld = lengthFt * 12;
  const c = 2; // clear to the deck's edges and ends (CDOT Bridge Detail Manual 4.8)
  const { pre, run } = collector(i);
  const dots: DetailView["dots"] = [];
  const lines: DetailView["lines"] = [];
  const tr = (b: DeckInputs["topBars"], use: string, cover: number, y: number) => {
    run({ size: b.bar, count: countAt(Ld - 2 * c, b.spacing), straight: Wd - 2 * c, use, callout: `#${b.bar} @ ${ftIn(b.spacing)} (${use.toLowerCase()})`, spacing: b.spacing, cover });
    lines.push({ pts: [[c, y], [Wd - c, y]], mark: use, kind: "main" });
  };
  tr(i.topBars, "Transverse, top", i.coverTop, i.t - i.coverTop - bar(i.topBars.bar).db / 2);
  tr(i.botBars, "Transverse, bottom", i.coverBot, i.coverBot + bar(i.botBars.bar).db / 2);
  const lg = (b: DeckInputs["topLong"], use: string, cover: number, y: number) => {
    const n = countAt(Wd - 2 * c, b.spacing);
    run({ size: b.bar, count: n, straight: Ld - 2 * c, use, callout: `#${b.bar} @ ${ftIn(b.spacing)} (${use.toLowerCase()})`, spacing: b.spacing, cover });
    for (let k = 0; k < n; k++) dots.push({ x: c + ((Wd - 2 * c) * k) / Math.max(1, n - 1), y, d: bar(b.bar).db, mark: use });
  };
  lg(i.topLong, "Longitudinal, top", i.coverTop, i.t - i.coverTop - bar(i.topBars.bar).db - bar(i.topLong.bar).db / 2);
  lg(i.botLong, "Longitudinal, bottom", i.coverBot, i.coverBot + bar(i.botBars.bar).db + bar(i.botLong.bar).db / 2);
  const ohArea = ((i.tEdge + i.tFlange) / 2) * i.overhang * 12;
  const area = (Wd - 2 * i.overhang * 12) * i.t + 2 * ohArea; // in²
  const deckAreaT = `${inT(Wd - 2 * i.overhang * 12)}\\cdot ${inT(i.t)}+2\\cdot ${avgT(inT(i.tEdge), inT(i.tFlange))}\\cdot ${ftT(i.overhang)}`;
  const concrete: ConcreteItem[] = [{ label: "Deck", cy: ((area / 144) * lengthFt) / 27, basis: `${fit(area / 144)} ft² of section (overhangs averaged) by ${lengthFt} ft; haunches over the girders not included`, math: `\\left(${deckAreaT}\\right)\\cdot ${ftT(lengthFt)}`, ref: "Deck: (between the overhangs × thickness + 2 overhangs × their average thickness × width) × length; haunches over the girders not included" }];
  const { rail } = withRail(i);
  const def = rail?.rail ?? null;
  const notes = [`Negative moment bars over piers and bars at the deck's ends are not included: add them from the girder design.${def ? "" : " The barrier's anchorage bars are not included either: pick a CDOT standard rail to detail them."}`, "All reinforcing steel is epoxy coated (CDOT worksheet B-100-1)."];
  // The bridge rail on each edge (CDOT B-606): its bars detailed as the worksheet shows them, paid with the rail by the foot.
  const railLines: DetailView["lines"] = [];
  const railDots: DetailView["dots"] = [];
  if (def && rail) {
    const paid = `${def.payItem} ${def.name.replace(/ \(#\d option\)/, "")}`;
    const intoDeck = i.coverTop + 1.5; // down past the deck's top mat ("bottom of stirrup parallel to top of deck steel")
    for (const b of def.bars) {
      const path = b.path.map(([x, y]) => [x, y <= 0 ? -intoDeck : y] as Pt);
      const segs = path.slice(1).map((p, k) => Math.hypot(p[0] - path[k][0], p[1] - path[k][1]));
      const len = roundDown(segs.reduce((s, x) => s + x, 0));
      const perRail = b.spacing ? countAt(Ld - 2 * c, b.spacing) : (b.count ?? 0);
      const extra = b.endZone && b.spacing ? 2 * Math.max(0, countAt(b.endZone.length, b.endZone.spacing) - countAt(b.endZone.length, b.spacing)) : 0;
      pre.push({ size: b.size, count: 2 * (perRail + extra), shape: { kind: "bent", dims: segs.map(roundDown), hooks: 0 }, length: len, use: b.use, callout: b.callout + (b.endZone ? `; @ ${ftIn(b.endZone.spacing)} over ${ftIn(b.endZone.length)} at each end` : ""), where: "both rails", paid });
      railLines.push({ pts: path, mark: b.use, kind: "stirrup" });
    }
    const L = def.longitudinal;
    // Spliced as the worksheet gives it: 2'-5" for #4, 1'-10" for #3.
    const sp = splitRun(L.size, Ld - 2 * c, L.size === 4 ? 29 : 22);
    const piece = roundDown(sp.piece);
    pre.push({ size: L.size, count: 2 * L.at.length * sp.pieces, shape: { kind: "straight", dims: [piece] }, length: piece, use: "Rail, longitudinal", callout: `#${L.size} Cont (Tot ${L.at.length}) each rail`, where: "both rails", ...(sp.splices ? { splice: `${sp.pieces} pieces per bar, lapped ${ftIn(sp.lap)}` } : {}), paid });
    for (const [x, y] of L.at) railDots.push({ x, y, d: bar(L.size).db, mark: "Rail, longitudinal" });
    notes.push(`${def.name} (CDOT ${def.sheet}) on both edges, ${2 * lengthFt} ft: paid by the foot under item ${def.payItem}, its Concrete Class DF, reinforcing steel${def.steel ? ", posts and tubes" : ""} and concrete sealer included; its bars are scheduled for information. The worksheet tabulates ${def.perFoot.concrete} CY, ${def.perFoot.rebar} lb of bars${def.steel ? ` and ${def.steel.lbPerFt} lb of steel` : ""} per foot (8 in deck); joints and end anchorages add to it. Rail bars are ${rail.fy === 100 ? "ASTM A1035CS" : "stainless steel (ASTM A955)"}, as the worksheet requires for the bridge's location.`);
  }
  // Started from a girder design: its quantities carry the deck's concrete, the rails and the waterproofing; this one the bars.
  const linked = i.fromGirder ?? null;
  if (linked) notes.unshift(`The deck's concrete, the rails and the waterproofing are in the quantities of the girder design "${linked.name}", which this deck was started from: here, only the bars.`);
  const { sch, markOf } = finish(pre, linked ? [] : concrete);
  const roadway = Wd / 12 - (2 * i.barrierWidth) / 12;
  const quantities: Takeoff["quantities"] = linked
    ? {}
    : {
        waterproofing: { value: (roadway * lengthFt) / 9, basis: `${fit(roadway)} ft between the barriers by ${lengthFt} ft`, math: `\\left(${inT(Wd)}-2\\cdot ${inT(i.barrierWidth)}\\right)\\cdot ${ftT(lengthFt)}`, ref: "the roadway between the barriers × the deck's length" },
        ...(def ? { rail: { value: 2 * lengthFt, basis: `${def.name} on both edges of the ${lengthFt} ft deck`, math: `2\\cdot ${ftT(lengthFt)}`, ref: `${def.name} on both edges` } } : {}),
      };
  const view: DetailView = { title: "Transverse section", polys: [{ pts: [[0, i.t - i.tEdge], [i.overhang * 12, i.t - i.tFlange], [Wd - i.overhang * 12, i.t - i.tFlange], [Wd, i.t - i.tEdge], [Wd, i.t], [0, i.t]], style: "concrete" }, { pts: rect(i.overhang * 12, 0, Wd - i.overhang * 12, i.t), style: "concrete" }], lines: lines.map((l) => ({ ...l, mark: markOf(l.mark) })), dots: dots.map((d) => ({ ...d, mark: markOf(d.mark) })) };
  const views = [view];
  if (def) {
    // The rail and the overhang together: the rail's bars into the deck among the deck's own (deck top at y = 0).
    const oh = i.overhang * 12;
    const span = Math.min(oh + 18, Wd / 2);
    const flangeEdge = Math.max(oh - i.flange / 2, 1);
    const bottomAt = (x: number) => -(x < flangeEdge ? i.tEdge + ((i.tFlange - i.tEdge) * x) / flangeEdge : i.tFlange);
    const slab: Pt[] = [[0, 0], [span, 0], [span, bottomAt(span)], [flangeEdge, bottomAt(flangeEdge)], [0, -i.tEdge]];
    const tb = bar(i.topBars.bar).db;
    const bb = bar(i.botBars.bar).db;
    const dl: DetailView["lines"] = [
      { pts: [[c, -i.coverTop - tb / 2], [span, -i.coverTop - tb / 2]], mark: markOf("Transverse, top"), kind: "main" },
      { pts: [[c, -i.tEdge + i.coverBot + bb / 2], [flangeEdge, bottomAt(flangeEdge) + i.coverBot + bb / 2], [span, bottomAt(span) + i.coverBot + bb / 2]], mark: markOf("Transverse, bottom"), kind: "main" },
    ];
    const longDots: DetailView["dots"] = [];
    for (let x = c; x <= span; x += i.topLong.spacing) longDots.push({ x, y: -i.coverTop - tb - bar(i.topLong.bar).db / 2, d: bar(i.topLong.bar).db, mark: markOf("Longitudinal, top") });
    for (let x = c; x <= span; x += i.botLong.spacing) longDots.push({ x, y: bottomAt(x) + i.coverBot + bb + bar(i.botLong.bar).db / 2, d: bar(i.botLong.bar).db, mark: markOf("Longitudinal, bottom") });
    const steel: DetailView["polys"] = def.posts
      ? [
          { pts: [[def.posts.x - 0.5, Math.max(...def.outline.map((p) => p[1]))], [def.posts.x + 0.5, Math.max(...def.outline.map((p) => p[1]))], [def.posts.x + 0.5, def.height], [def.posts.x - 0.5, def.height]], style: "dashed" },
          ...def.posts.tubes.map((t) => ({ pts: rect(t.x0, t.y0, t.x1, t.y1), style: "dashed" as const })),
        ]
      : [];
    views.push({
      title: `${def.name} and the overhang`,
      polys: [{ pts: slab, style: "concrete" }, { pts: def.outline, style: "concrete" }, ...steel],
      lines: [...railLines.map((l) => ({ ...l, mark: markOf(l.mark) })), ...dl],
      dots: [...railDots.map((d) => ({ ...d, mark: markOf(d.mark) })), ...longDots],
      labels: [
        { x: def.width / 2, y: def.height + 4, text: `${def.name} (${def.sheet})`, anchor: "middle" },
        { x: oh, y: bottomAt(oh) - 6, text: "Exterior girder ℄", anchor: "middle" },
        { x: 0, y: -i.tEdge - 6, text: "Deck edge", anchor: "start" },
      ],
    });
  }
  return { what: "bridge deck", schedule: sch, quantities, views, notes, length: { label: "Deck length", value: lengthFt, unit: "ft" } };
}

// ---------------------------------------------------------------------------------------------
// MSE wall (CDOT B-504 worksheets): facing, reinforced soil and leveling pad

export function mseTakeoff(i: MseInputs, lengthFt = 100): Takeoff {
  const facing = i.H * lengthFt;
  const mrs = (i.L * i.H * lengthFt) / 27;
  const padW = i.panelT / 12 + 1; // 6 in each side of the panel
  const padH = 0.5;
  const concrete: ConcreteItem[] = [{ label: "Leveling pad", cy: (padW * padH * lengthFt) / 27, basis: `${fit(padW)} ft wide by 6 in deep, ${lengthFt} ft long`, math: `\\left(${inT(i.panelT)}+2\\cdot 6\\mathrm{in}\\right)\\cdot 6\\mathrm{in}\\cdot ${ftT(lengthFt)}`, ref: "Leveling pad: the panel plus 6 in each side × 6 in deep × length" }];
  const sch = schedule([], concrete);
  const quantities: Takeoff["quantities"] = {
    facing: { value: facing, basis: `${i.H} ft from the leveling pad to the top by ${lengthFt} ft`, math: `${ftT(i.H)}\\cdot ${ftT(lengthFt)}`, ref: "height from the leveling pad to the top × length" },
    "soil-reinforcement": { value: mrs, basis: `the reinforced zone, ${i.L} ft deep by ${i.H} ft high by ${lengthFt} ft`, math: `${ftT(i.L)}\\cdot ${ftT(i.H)}\\cdot ${ftT(lengthFt)}`, ref: "the reinforced zone: reinforcement length × height × length" },
  };
  const H = i.H * 12;
  const view: DetailView = { title: "Typical section", polys: [{ pts: rect(0, 0, i.panelT, H), style: "concrete" }, { pts: rect(-6, -6, i.panelT + 6, 0), style: "concrete" }, { pts: rect(i.panelT, 0, i.panelT + i.L * 12, H), style: "earth" }], lines: Array.from({ length: Math.max(1, Math.floor((i.H - i.topLayer) / i.Sv) + 1) }, (_, k) => ({ pts: [[i.panelT, H - (i.topLayer + k * i.Sv) * 12], [i.panelT + i.L * 12, H - (i.topLayer + k * i.Sv) * 12]] as Pt[], mark: "", kind: "secondary" as const })), dots: [], labels: [{ x: i.panelT + i.L * 6, y: H + 8, text: `Reinforced zone, L = ${i.L} ft`, anchor: "middle" }] };
  return { what: "MSE retaining wall", schedule: sch, quantities, views: [view], notes: ["The facing panels' own bars are part of the facing (504) and aren't scheduled. Structure excavation and backfill outside the reinforced zone follow the B-504 worksheets for the site."], length: { label: "Wall length", value: lengthFt, unit: "ft" } };
}

// ---------------------------------------------------------------------------------------------
// Drilled shaft (sign foundation, B-503-1); pier columns are in piers/column-detail.ts

function roundCage(o: { D: number; height: number; cover: number; bars: number; size: number; tieBar: number; tieSpacing: number; topEmbed: number; botLap: boolean; fy: number; fc: number; count: number; what: string }) {
  const { pre, run } = collector(o);
  const db = bar(o.size).db;
  const dt = bar(o.tieBar).db;
  run({ size: o.size, count: o.bars * o.count, straight: o.height + o.topEmbed, hooks: [false, o.topEmbed > 0], use: "Longitudinal bars", callout: `#${o.size} (Tot ${o.bars}) ${o.what}`, cover: o.cover, spacing: (Math.PI * (o.D - 2 * o.cover)) / o.bars, lap: o.botLap });
  const hoopD = o.D - 2 * o.cover - dt;
  const lapHoop = Math.max(12, 1.3 * 48 * dt); // a lapped hoop's splice (Class B, conservatively 48 db for ℓd)
  run({ size: o.tieBar, count: countAt(o.height - 2 * o.cover, o.tieSpacing) * o.count, straight: Math.PI * hoopD + lapHoop, use: "Hoops", callout: `#${o.tieBar} hoops @ ${ftIn(o.tieSpacing)}`, lap: false });
  const R = o.D / 2;
  const view: DetailView = {
    title: "Section",
    polys: [{ pts: Array.from({ length: 48 }, (_, k) => [R + R * Math.cos((2 * Math.PI * k) / 48), R + R * Math.sin((2 * Math.PI * k) / 48)] as Pt), style: "concrete" }],
    lines: [{ pts: Array.from({ length: 49 }, (_, k) => [R + (hoopD / 2) * Math.cos((2 * Math.PI * k) / 48), R + (hoopD / 2) * Math.sin((2 * Math.PI * k) / 48)] as Pt), mark: "Hoops", kind: "stirrup" }],
    dots: Array.from({ length: o.bars }, (_, k) => ({ x: R + (R - o.cover - dt - db / 2) * Math.cos((2 * Math.PI * k) / o.bars), y: R + (R - o.cover - dt - db / 2) * Math.sin((2 * Math.PI * k) / o.bars), d: db, mark: "Longitudinal bars" })),
  };
  return { pre, view };
}

export function shaftTakeoff(i: SignInputs): Takeoff {
  const height = i.shaftLength * 12 - 3;
  const { pre, view } = roundCage({ D: i.shaftD, height, cover: i.cover, bars: i.bars, size: i.bar, tieBar: i.tieBar, tieSpacing: i.tieSpacing, topEmbed: 0, botLap: true, fy: i.fy, fc: i.fc, count: 1, what: "drilled shaft" });
  const groups = markGroups(pre);
  const markOf = (use: string) => groups.find((g) => g.use === use)?.mark ?? "";
  const quantities: Takeoff["quantities"] = { shaft: { value: i.shaftLength, basis: `${ftIn(i.shaftD)} diameter, ${i.shaftLength} ft` } };
  return { what: "sign structure drilled shaft", schedule: schedule(groups, []), quantities, views: [{ ...view, lines: view.lines.map((l) => ({ ...l, mark: markOf(l.mark) })), dots: view.dots.map((d) => ({ ...d, mark: markOf(d.mark) })) }], notes: ["Per worksheet B-503-1 the shaft's concrete is paid in the drilled shaft item (LF); its bars are scheduled here."] };
}

// ---------------------------------------------------------------------------------------------
// Quantity-only tools: prestressed girders, bearings, joints

export function girderTakeoff(i: GirderInputs, deckFt?: number): Takeoff {
  const spans = [i.L, ...(i.extraSpans ?? []).map((s) => s.L)];
  const each = spans.map((L) => L + 2 * i.endDist);
  const lf = i.nGirders * each.reduce((s, x) => s + x, 0);
  // The deck over the bridge's length: its slab out to out, the haunches over the girders, the rails, the roadway's waterproofing.
  const b = bridgeSection(i);
  const Ld = deckFt ?? deckLength(i);
  const flange = girderShape(i).topWidth / 12;
  const slabA = b.W * (i.deckT / 12);
  const haunchA = i.nGirders * flange * (i.haunch / 12);
  const concrete: ConcreteItem[] = [
    { label: "Deck slab", cy: (slabA * Ld) / 27, basis: `${fit(b.W)} ft out to out by ${fit(i.deckT)} in as cast, ${fit(Ld)} ft long`, math: `${ftT(b.W)}\\cdot ${inT(i.deckT)}\\cdot ${ftT(Ld)}`, ref: "Deck slab: out-to-out width × thickness as cast × length" },
    ...(haunchA > 0 ? [{ label: "Haunches", cy: (haunchA * Ld) / 27, basis: `${i.nGirders} × ${fit(flange * 12)} in flange by ${fit(i.haunch)} in, ${fit(Ld)} ft`, math: `${i.nGirders}\\cdot ${inT(flange * 12)}\\cdot ${inT(i.haunch)}\\cdot ${ftT(Ld)}`, ref: "Haunches: girders × top flange width × haunch × length" }] : []),
  ];
  const quantities: Takeoff["quantities"] = {
    girder: { value: lf, basis: `${i.nGirders} girders per span, ${each.map((x) => `${fit(x)} ft`).join(" + ")} end to end`, math: `${i.nGirders}\\cdot ${sumT(each.map(ftT))}`, ref: "girders per span × each span's girder length end to end" },
    waterproofing: { value: (b.roadway * Ld) / 9, basis: `${fit(b.roadway)} ft between the rails by ${fit(Ld)} ft`, math: `${ftT(b.roadway)}\\cdot ${ftT(Ld)}`, ref: "the roadway between the rails × length" },
    ...(b.rail ? { rail: { value: 2 * Ld, basis: `${b.rail.name.replace(/ \(#\d option\)/, "")} on both edges, ${fit(Ld)} ft each`, math: `2\\cdot ${ftT(Ld)}`, ref: `${b.rail.name.replace(/ \(#\d option\)/, "")} on both edges` } } : {}),
  };
  const notes = [
    "Prestressed girders are paid by the linear foot, strands and bars included (618).",
    `The deck is ${fit(Ld)} ft long, girder end to girder end over ${spans.length > 1 ? "the spans" : "the span"} (adjustable). Its area is the out-to-out width by the length along the girders, which a skew doesn't change. Approach slabs, end diaphragms and the deck's bars are not included here: the bars are the Deck Slab design's.`,
    ...(b.rail ? [`${b.rail.name} (${b.rail.sheet}) is paid by the foot under item ${b.rail.payItem}, its concrete and bars included.`] : []),
  ];
  return { what: `${i.shape.toUpperCase()} girders and deck`, schedule: schedule([], concrete), quantities, views: [], notes, length: { label: "Deck length", value: +Ld.toFixed(2), unit: "ft" } };
}

export function bearingTakeoff(count = 1): Takeoff {
  return { what: "bearings", schedule: schedule([], []), quantities: { bearing: { value: count, basis: `${count} bearing${count > 1 ? "s" : ""}` } }, views: [], notes: [], length: { label: "Number of bearings", value: count, unit: "EA" } };
}

export function jointTakeoff(i: StripSealInputs, widthFt = 40): Takeoff {
  const lf = widthFt / Math.cos((i.skew * Math.PI) / 180);
  return { what: "strip seal expansion joint", schedule: schedule([], []), quantities: { joint: { value: lf, basis: `${widthFt} ft of deck, skewed ${i.skew}°`, ...(i.skew > 0 ? { math: `\\frac{${ftT(widthFt)}}{\\cos\\left(${num(i.skew)}\\mathrm{deg}\\right)}`, ref: "the deck's square width ÷ cos(skew)" } : {}) } }, views: [], notes: [], length: { label: "Deck width (square)", value: widthFt, unit: "ft" } };
}
