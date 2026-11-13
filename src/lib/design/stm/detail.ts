import { DesignError } from "../walls/cip";
import { classBLap, ftIn, hookLeg, roundDown, splitRun } from "../rebar/bars";
import { markGroups, schedule, shapeLength, type BarGroup, type BarShape, type ConcreteItem, type Schedule } from "../rebar/schedule";
import { num } from "../calc-style";
import { ftT, inT } from "../takeoff/tex";
import { bar, BARS } from "./aashto";
import type { Pt } from "./geometry";
import { barsFit } from "./nodal-zones";
import type { StmInputs } from "./strut-tie";
import { INVERTED_T_DEFAULTS, type StmTemplate } from "./templates";

// The bars of a standard cap, detailed from its design: the top and bottom bars, stirrups and
// crack-control grid the check uses, laid out as FHWA-NHI-17-071 Design Example 2 details its
// cantilever bent (Figures 2-18 to 2-20) and by CDOT's detailing rules (Bridge Detail Manual
// Ch. 4): top bars in layers, hooked at the cap's ends (lapped with the column bars where the
// cap ends at a column's face); closed stirrups in sets by their legs, a series where the cap
// tapers; side-face bars from the grid; bars longer than stock lapped with Class B splices
// (AASHTO 5.10.8.4.3a); cover to the stirrups as given. The column's bars run up into the cap to
// the top mat with standard hooks, by the column's design, and aren't scheduled here. Inches.

export type DetailBar = { mark: string; pts: Pt[]; kind: "top" | "bottom" | "side" | "ledge" | "column"; laps?: number[] };
export type SectionView = {
  label: string;
  x: number; // in, along the cap
  b: number; // in, the stem's width
  h: number; // in, the cap's depth there
  ledge?: { projection: number; depth: number };
  hoops: { x0: number; x1: number; y0: number; y1: number; mark: string }[]; // in, from the section's left side and soffit
  dots: { x: number; y: number; d: number; mark: string }[];
  notes: { mark: string; text: string }[];
};
export type CapDetail = {
  length: number;
  depth: number;
  soffit: Pt[]; // in, the cap's underside from end to end
  columns: { x0: number; x1: number }[];
  bars: DetailBar[];
  stirrups: { mark: string; x: number; y0: number; y1: number }[]; // in, each stirrup set's position and height
  stirrupZones: { x0: number; x1: number; text: string }[];
  cuts: { label: string; x: number }[];
  sections: SectionView[];
  schedule: Schedule;
  notes: string[];
};

const SIDE_SIZES = [4, 5, 6, 7, 8, 9, 10, 11];

/** The cap's area above its soffit (y ≥ 0), from the model's outline (ft): the outline clipped at the columns' tops. */
function capArea(outline: Pt[]) {
  const out: Pt[] = [];
  for (let k = 0; k < outline.length; k++) {
    const p = outline[k];
    const q = outline[(k + 1) % outline.length];
    const pin = p[1] >= -1e-9;
    const qin = q[1] >= -1e-9;
    if (pin) out.push(p);
    if (pin !== qin) {
      const s = (0 - p[1]) / (q[1] - p[1]);
      out.push([p[0] + s * (q[0] - p[0]), 0]);
    }
  }
  let a = 0;
  for (let k = 0; k < out.length; k++) {
    const p = out[k];
    const q = out[(k + 1) % out.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

export function detailCap(i: StmInputs): CapDetail {
  const t: StmTemplate | null | undefined = i.template;
  if (!t) throw new DesignError("Detailing works from a standard cap: build the model with Start from a standard cap.");
  const L = t.length * 12;
  const H = t.depth * 12;
  const b = t.capWidth;
  const hammer = t.kind === "hammerhead";
  const cols = [...t.columns].sort((p, q) => p - q).map((x) => x * 12);
  const wc = t.columnWidth * 12;
  const faceL = cols[0] - wc / 2;
  const faceR = cols[cols.length - 1] + wc / 2;
  const tip = (hammer ? t.tipDepth : t.depth) * 12;
  const rise = H - tip;
  const soffit = (x: number) => (x < faceL && faceL > 0 ? (rise * (faceL - x)) / faceL : x > faceR && L > faceR ? (rise * (x - faceR)) / (L - faceR) : 0);
  const c = t.sideCover; // clear cover to the stirrups (sides, top, ends)
  if (!(c > 0)) throw new DesignError("Give the clear cover to the stirrups.");
  const st = t.stirrups;
  const ds = bar(st.size).db;
  const steel = { fy: i.fy, fc: i.fc };
  const pre: Omit<BarGroup, "mark">[] = [];
  const bars: (Omit<DetailBar, "mark"> & { use: string })[] = [];
  const notes: string[] = [];
  const add = (g: Omit<BarGroup, "mark" | "length">) => pre.push({ ...g, length: shapeLength(g.shape) });

  /** A run of bars hooked or not at each end, cut at stock lengths and lapped: its groups. */
  const runGroups = (size: number, count: number, segs: number[], legs: [number, number], use: string, callout: string, lap: number | null, where?: string) => {
    const straight = segs.reduce((s, x) => s + x, 0);
    const run = straight + legs[0] + legs[1];
    const sp = splitRun(size, run, lap);
    const bent = segs.length > 1;
    const hooks = (legs[0] > 0 ? 1 : 0) + (legs[1] > 0 ? 1 : 0);
    const splice = sp.splices ? `${sp.pieces} pieces per bar, ${sp.mechanical ? "mechanical splices (no laps above #11, CDOT 4.7)" : `Class B laps of ${ftIn(roundDown(sp.lap))} (AASHTO 5.10.8.4.3a)`}, staggered` : undefined;
    if (sp.pieces === 1) {
      const shape: BarShape = bent ? { kind: "bent", dims: [legs[0], ...segs, legs[1]].filter((d) => d > 0), hooks: hooks as 0 | 1 | 2 } : hooks === 0 ? { kind: "straight", dims: [roundDown(straight)] } : { kind: "hooked", dims: [legs[0], straight, legs[1]].filter((d) => d > 0).map(roundDown), hooks: hooks as 1 | 2 };
      if (shape.kind === "bent") shape.dims = shape.dims.map(roundDown);
      add({ size, count, shape, use, callout, where, splice });
      return sp;
    }
    // Spliced: the end pieces carry the hooks; the pieces between are straight.
    const piece = roundDown(sp.piece);
    for (const [k, leg] of legs.entries()) {
      const body = roundDown(piece - leg);
      add({ size, count, shape: leg > 0 ? { kind: "hooked", dims: [roundDown(leg), body], hooks: 1 } : { kind: "straight", dims: [piece] }, use, callout, where: legs[0] === legs[1] ? "end pieces" : `${k === 0 ? "left" : "right"} end piece`, splice });
    }
    if (sp.pieces > 2) add({ size, count: count * (sp.pieces - 2), shape: { kind: "straight", dims: [piece] }, use, callout, where: "middle pieces", splice });
    return sp;
  };

  // Top bars: in layers across the width (5.10.3.1), from end cover to end cover, hooked down at the
  // cap's ends; where a column's face is at the cap's end (a C-bent), the hook laps the column bars.
  const top = t.topBars;
  const dbt = bar(top.size).db;
  const fitT = barsFit(b, c, st.size, top.count, top.size);
  const topLap = classBLap(top.size, { ...steel, clearCover: c + ds, clearSpacing: fitT.clearSpacing, horizontal: true, concreteBelow: H - c });
  const hookT = t.barEnds === "hook" ? hookLeg(top.size).leg : 0;
  const atColumnFace = (x: number) => Math.abs(x - faceL) < 1 || Math.abs(x - faceR) < 1;
  const legsT: [number, number] = [0, L].map((x) => (atColumnFace(x) && hammer ? Math.max(hookT, topLap ?? hookT) : hookT)) as [number, number];
  if (hammer && (atColumnFace(0) || atColumnFace(L))) notes.push(`Where the cap ends at the column's face, the top bars turn down into the column and lap its bars with a Class B splice of ${ftIn(roundDown(topLap ?? hookT))} (AASHTO 5.10.8.4.3a).`);
  const topRun = L - 2 * c;
  const spT = runGroups(top.size, top.count, [topRun], legsT, "Top bars", `#${top.size} Cont (Tot ${top.count})`, topLap);
  const layerGap = Math.max(1, dbt);
  for (let k = 0; k < fitT.layers; k++) {
    const y = H - c - ds - dbt / 2 - k * (dbt + layerGap);
    bars.push({ kind: "top", use: "Top bars", pts: [[c, y - legsT[0]], [c, y], [L - c, y], [L - c, y - legsT[1]]].filter((_, j) => (j === 0 ? legsT[0] > 0 : j === 3 ? legsT[1] > 0 : true)) as Pt[], laps: lapsAt(spT, c, L - c) });
  }

  // Bottom bars: along the soffit (following a taper), hooked up at the ends as the top bars.
  const bot = t.bottomBars;
  const dbb = bar(bot.size).db;
  const fitB = barsFit(b, c, st.size, bot.count, bot.size);
  const yb = c + ds + dbb / 2;
  const xsB = [c, ...(rise > 0 && faceL > c ? [faceL] : []), ...(rise > 0 && faceR < L - c ? [faceR] : []), L - c];
  const ptsB: Pt[] = xsB.map((x) => [x, soffit(x) + yb]);
  const segsB = ptsB.slice(1).map((p, k) => Math.hypot(p[0] - ptsB[k][0], p[1] - ptsB[k][1]));
  const hookB = t.barEnds === "hook" ? Math.min(hookLeg(bot.size).leg, tip - 2 * c - ds) : 0;
  const botLap = classBLap(bot.size, { ...steel, clearCover: c + ds, clearSpacing: fitB.clearSpacing, horizontal: true, concreteBelow: 0 });
  const spB = runGroups(bot.size, bot.count, segsB, [hookB, hookB], "Bottom bars", `#${bot.size} Cont (Tot ${bot.count})`, botLap);
  bars.push({ kind: "bottom", use: "Bottom bars", pts: [...(hookB > 0 ? [[ptsB[0][0], ptsB[0][1] + hookB] as Pt] : []), ...ptsB, ...(hookB > 0 ? [[ptsB[ptsB.length - 1][0], ptsB[ptsB.length - 1][1] + hookB] as Pt] : [])], laps: lapsAt(spB, c, L - c) });

  // Stirrups: closed, in sets giving the design's legs (an outer stirrup and nested ones inside it,
  // the legs evenly across), at the design's spacing or the crack-control grid's if closer
  // (5.8.2.6), first and last a stirrup's spacing from the ends. Heights follow the soffit: a bar
  // series where it tapers (CDOT 4.3).
  const legs = Math.max(2, Math.round(st.legs));
  const s = Math.min(st.spacing, i.grid.provided && i.grid.sv > 0 ? i.grid.sv : Infinity);
  const x0 = c + Math.min(3, s / 2);
  const x1 = L - x0;
  const n = Math.max(2, Math.floor((x1 - x0) / s + 1e-9) + 1);
  const pitch = (x1 - x0) / (n - 1);
  const W = b - 2 * c; // out to out
  const hoopSpans = Array.from({ length: Math.floor(legs / 2) }, (_, k) => [(k * W) / (legs - 1), W - (k * W) / (legs - 1)] as [number, number]);
  const crossties = legs % 2;
  const hook135 = Math.max(6 * ds, 3) + ds; // a 135° hook's extension, out to out (5.10.2.1)
  const stirrups: { x: number; y0: number; y1: number; h: number }[] = [];
  for (let k = 0; k < n; k++) {
    const x = x0 + k * pitch;
    const y0 = soffit(x) + c;
    const y1 = H - c;
    stirrups.push({ x, y0, y1, h: roundDown(y1 - y0) });
  }
  // One group per stretch of constant depth; a tapered arm's stirrups are a series (one mark, H varying), counted at their average length.
  const zones = [
    { name: "left arm", in: (x: number) => rise > 0 && x < faceL },
    { name: "", in: (x: number) => !(rise > 0 && (x < faceL || x > faceR)) },
    { name: "right arm", in: (x: number) => rise > 0 && x > faceR },
  ];
  let anySeries = false;
  for (const z of zones) {
    const here = stirrups.filter((v) => z.in(v.x));
    if (!here.length) continue;
    const hs = here.map((v) => v.h);
    const [hMin, hMax] = [Math.min(...hs), Math.max(...hs)];
    const isSeries = hMax - hMin >= 1;
    anySeries ||= isSeries;
    const series = isSeries ? { dim: 1, min: hMin, max: hMax } : undefined;
    const avg = hs.reduce((p, q) => p + q, 0) / hs.length;
    const where = isSeries ? "tapered arm series" : undefined;
    hoopSpans.forEach(([a, zz], k) => {
      const shape: BarShape = { kind: "closed", dims: [roundDown(zz - a), hMax], hook: roundDown(hook135) };
      pre.push({ size: st.size, count: here.length, shape, length: roundDown(2 * (shape.dims[0] + avg) + 2 * shape.hook), use: k === 0 ? "Stirrups (outer)" : "Stirrups (inner)", callout: `#${st.size} Stirrups @ ${ftIn(Math.round(pitch))} max (${legs} legs)`, where, series });
    });
    if (crossties) {
      const shape: BarShape = { kind: "hooked", dims: [roundDown(hook135), hMax, roundDown(hook135)], hooks: 2 };
      pre.push({ size: st.size, count: here.length, shape, length: roundDown(avg + 2 * shape.dims[0]), use: "Crossties", callout: `#${st.size} Crossties @ ${ftIn(Math.round(pitch))}`, where, series: series ? { ...series } : undefined });
    }
  }
  if (anySeries) notes.push("The stirrups in the tapered arms follow the soffit: each arm's is a bar series, H varying (CDOT Bridge Detail Manual 4.3), counted at its average length.");

  // Side-face bars: the crack-control grid's horizontal bars, Ah within sh, half on each face
  // (5.8.2.6), in rows between the top and bottom bars; rows below the tapered ends stop where
  // the soffit rises to them.
  if (i.grid.provided && i.grid.Ah > 0 && i.grid.sh > 0) {
    const per = i.grid.Ah / 2;
    const size = SIDE_SIZES.find((z) => BARS[z].area >= per - 1e-9) ?? 11;
    if (BARS[size].area < per - 1e-9) notes.push(`The grid's horizontal bars need ${per.toFixed(2)} in² per face within ${i.grid.sh} in: more than one #11; place them in pairs.`);
    const dbs = bar(size).db;
    const yLo = yb + dbb / 2 + dbs / 2;
    const yHi = H - c - ds - dbt / 2 - (fitT.layers - 1) * (dbt + layerGap) - dbt / 2 - dbs / 2;
    const rows = Math.max(0, Math.ceil((yHi - yLo) / i.grid.sh - 1e-9) - 1);
    const lapS = classBLap(size, { ...steel, clearCover: c + ds, clearSpacing: i.grid.sh - dbs, horizontal: true, concreteBelow: 0 });
    for (let k = 1; k <= rows; k++) {
      const y = yLo + ((yHi - yLo) * k) / (rows + 1);
      // Where the soffit (plus cover and stirrup) reaches this row.
      const need = y - (c + ds + dbs / 2);
      const xa = rise > 0 && need < rise ? Math.max(c, faceL - (need * faceL) / rise) : c;
      const xz = rise > 0 && need < rise ? Math.min(L - c, faceR + (need * (L - faceR)) / rise) : L - c;
      const sp = runGroups(size, 2, [xz - xa], [0, 0], "Side-face bars", `#${size} @ ${ftIn(i.grid.sh)} each face`, lapS);
      bars.push({ kind: "side", use: "Side-face bars", pts: [[xa, y], [xz, y]], laps: lapsAt(sp, xa, xz) });
    }
  }

  // An inverted-T's ledges (5.8.4.3): their primary bars across the bottom, hooked up into the ledges, and their closed ties.
  let ledge: { projection: number; depth: number } | undefined;
  if (t.kind === "inverted-t") {
    const lg = t.ledge ?? INVERTED_T_DEFAULTS.ledge!;
    ledge = { projection: lg.projection, depth: lg.depth };
    const across = b + 2 * lg.projection - 2 * c;
    const legP = Math.min(hookLeg(lg.primary.size).leg, lg.depth - 2 * c);
    const nP = Math.floor((L - 2 * c) / lg.primary.spacing) + 1;
    add({ size: lg.primary.size, count: nP, shape: { kind: "hooked", dims: [roundDown(legP), roundDown(across), roundDown(legP)], hooks: 2 }, use: "Ledge bars", callout: `#${lg.primary.size} @ ${ftIn(lg.primary.spacing)}` });
    const nT = Math.floor((L - 2 * c) / lg.ties.spacing) + 1;
    add({ size: lg.ties.size, count: 2 * nT, shape: { kind: "closed", dims: [roundDown(lg.projection - 2 * c + bar(lg.ties.size).db), roundDown(lg.depth - 2 * c)], hook: roundDown(Math.max(6 * bar(lg.ties.size).db, 3)) }, use: "Ledge ties", callout: `#${lg.ties.size} @ ${ftIn(lg.ties.spacing)} each ledge` });
    if (lg.hangers.spacing < s) notes.push(`The hanger stirrups (#${lg.hangers.size} at ${ftIn(lg.hangers.spacing)}, 5.8.4.3.5) are closer than the stirrups: place them at the hangers' spacing where the girders bear on the ledges.`);
  }

  // The column's bars into the cap (drawn, scheduled with the column).
  const colBars: DetailBar[] = [];
  if (hammer) {
    const inset = Math.max(1, t.columnBarInset);
    for (const cx of cols)
      for (const f of [-1, 1]) {
        const x = cx + f * (wc / 2 - inset);
        const yTop = H - c - ds - dbt - layerGap; // under the top mat
        const leg = hookLeg(top.size).leg;
        colBars.push({ mark: "", kind: "column", pts: [[x, -Math.min(36, wc / 2)], [x, yTop], [x - f * leg, yTop]] });
      }
    notes.push("The column's bars run up into the cap to the top mat with standard 90° hooks turned into the cap (AASHTO 5.10.2.1): by the column's design, not scheduled here.");
  }
  if (spT.splices || spB.splices) notes.push("Laps are staggered so no more than half the bars are spliced at one place (CDOT Bridge Detail Manual 4.7); their places here are schematic.");

  // Concrete: the cap above its soffit, from the model's outline, by its width; an inverted-T's ledges added.
  const area = capArea(i.outline); // ft²
  const capName = hammer ? "Pier cap" : t.kind === "abutment" ? "Abutment cap" : "Bent cap";
  const concrete: ConcreteItem[] = [{ label: capName, cy: (area * (b / 12)) / 27, basis: `${area.toFixed(2)} ft² of elevation above the columns' tops by ${ftIn(b)} wide`, math: `${num(area)}\\mathrm{ft}^{2}\\cdot ${inT(b)}`, ref: `${capName}: its elevation's area above the columns' tops (the model's outline) × width` }];
  if (ledge) concrete.push({ label: "Ledges", cy: (2 * (ledge.projection / 12) * (ledge.depth / 12) * t.length) / 27, basis: `two ledges ${ftIn(ledge.projection)} by ${ftIn(ledge.depth)}, ${t.length} ft long`, math: `2\\cdot ${inT(ledge.projection)}\\cdot ${inT(ledge.depth)}\\cdot ${ftT(t.length)}`, ref: "Ledges: two × projection × depth × length" });

  const groups = markGroups(pre);
  const markOf = (use: string) => groups.find((g) => g.use === use)?.mark ?? "";
  const named: DetailBar[] = [...bars.map(({ use, ...d }) => ({ ...d, mark: markOf(use) })), ...colBars];
  const sch = schedule(groups, concrete);

  // Sections: one through an arm or span, one over a column.
  const span = hammer ? (faceL >= L - faceR ? faceL / 2 : (faceR + L) / 2) : cols.length > 1 ? (cols[0] + cols[1]) / 2 : (faceR + L) / 2;
  const cuts = [{ label: "A", x: span }, { label: "B", x: cols[0] }];
  const outer = markOf("Stirrups (outer)");
  const inner = markOf("Stirrups (inner)");
  // The stirrups' mark where a section cuts: a tapered arm's series, or the constant-depth stirrups.
  const stirrupMark = (x: number, k: number) => {
    const tapered = rise > 0 && (x < faceL || x > faceR);
    return groups.find((q) => q.use === (k === 0 ? "Stirrups (outer)" : "Stirrups (inner)") && !!q.series === tapered)?.mark ?? (k === 0 ? outer : inner);
  };
  const sections: SectionView[] = cuts.map(({ label, x }) => {
    const sof = soffit(x);
    const h = H - sof;
    const hoops = hoopSpans.map(([a, z], k) => ({ x0: c + a, x1: c + z, y0: c, y1: h - c, mark: stirrupMark(x, k) }));
    const dots: SectionView["dots"] = [];
    const across = (count: number, db: number) => Array.from({ length: count }, (_, k) => (count === 1 ? b / 2 : c + ds + db / 2 + ((W - 2 * ds - db) * k) / (count - 1)));
    for (let k = 0; k < fitT.layers; k++) {
      const inLayer = k < fitT.layers - 1 ? fitT.perLayer : top.count - fitT.perLayer * (fitT.layers - 1);
      for (const px of across(inLayer, dbt)) dots.push({ x: px, y: h - c - ds - dbt / 2 - k * (dbt + layerGap), d: dbt, mark: markOf("Top bars") });
    }
    for (let k = 0; k < fitB.layers; k++) {
      const inLayer = k < fitB.layers - 1 ? fitB.perLayer : bot.count - fitB.perLayer * (fitB.layers - 1);
      for (const px of across(inLayer, dbb)) dots.push({ x: px, y: yb + k * (dbb + Math.max(1, dbb)), d: dbb, mark: markOf("Bottom bars") });
    }
    for (const sb of named.filter((d) => d.kind === "side"))
      if (x >= sb.pts[0][0] && x <= sb.pts[1][0]) {
        const g = groups.find((q) => q.mark === sb.mark)!;
        const dbs = bar(g.size).db;
        for (const px of [c + ds + dbs / 2, b - c - ds - dbs / 2]) dots.push({ x: px, y: sb.pts[0][1] - sof, d: dbs, mark: sb.mark });
      }
    const marks = [...new Set([...hoops.map((h2) => h2.mark), ...dots.map((d) => d.mark)])].filter(Boolean);
    return { label, x, b, h, ledge, hoops, dots, notes: marks.map((m) => ({ mark: m, text: groups.find((g) => g.mark === m)!.callout })) };
  });

  const zoneText = `${n} sets of #${st.size} stirrups (${legs} legs) at ${ftIn(Math.round(pitch))}`;
  return {
    length: L,
    depth: H,
    soffit: [[0, soffit(0)], ...(faceL > 0 ? [[faceL, 0] as Pt] : []), ...(faceR < L ? [[faceR, 0] as Pt] : []), [L, soffit(L)]],
    columns: cols.map((x) => ({ x0: x - wc / 2, x1: x + wc / 2 })),
    bars: named,
    stirrups: stirrups.map((v) => ({ mark: outer, x: v.x, y0: v.y0, y1: v.y1 })),
    stirrupZones: [{ x0, x1, text: zoneText }],
    cuts,
    sections,
    schedule: sch,
    notes,
  };
}

/**
 * Structure excavation and backfill for a cap by CDOT M-206-2 (excavation and backfill for bridges),
 * as CDOT's own quantity sets apply it (CY):
 *  - an abutment cap: excavation 1'-6" beyond the cap's faces and ends, from the original ground to the
 *    cap's bottom; Structure Backfill (Class 1) with Mechanical Reinforcement of Soil in the 4 ft (min.)
 *    zone behind it over its height and length; the rest of the excavation refilled with Class 2;
 *  - a pier: a frustum around each column from the ground down to the top of its foundation, the
 *    column's radius at the bottom and 1'-6" more at the top (CDOT's "frustum" tabulation), refilled
 *    with Structure Backfill (Class 2), less the column.
 * `ground` is the original ground above the cap's bottom (abutment) or the column's foundation (pier), ft.
 */
export type CapEarthwork = { quantities: Partial<Record<"excavation" | "backfill" | "soil-reinforcement" | "refill", { value: number; basis: string }>>; ground: number; label: string };

export function capEarthwork(t: StmTemplate, ground?: number): CapEarthwork {
  const L = t.length;
  const b = t.capWidth / 12;
  const f = (v: number) => v.toFixed(2);
  if (t.kind === "abutment") {
    const d = ground ?? t.depth;
    // In plan: 1'-6" beyond the front face and the ends, and the 4 ft (min.) backfill zone behind.
    const exc = (b + 5.5) * (L + 3) * d;
    const zone = 4 * L * t.depth;
    const below = Math.min(d, t.depth);
    const cap = b * L * below;
    return {
      quantities: {
        excavation: { value: exc / 27, basis: `M-206-2: ${f(b + 5.5)} ft (1'-6" in front of the cap, its ${f(b)} ft and the 4 ft backfill zone behind) by ${f(L + 3)} ft (1'-6" beyond each end), ${f(d)} ft from the original ground to the cap's bottom` },
        backfill: { value: zone / 27, basis: `M-206-2: Class 1 in the 4 ft (min.) zone behind the abutment, its ${t.depth} ft height by ${L} ft` },
        "soil-reinforcement": { value: zone / 27, basis: "the same zone behind the abutment, its Class 1 backfill mechanically reinforced (M-206-2)" },
        refill: { value: Math.max(0, exc - cap - 4 * L * below) / 27, basis: "the rest of the excavation, less the cap and the Class 1 zone, refilled with Class 2 (M-206-2)" },
      },
      ground: d,
      label: "Original ground above the cap's bottom",
    };
  }
  // A pier's excavation and backfill are around its columns (M-206-2): the Pier Column tool's quantities.
  return { quantities: {}, ground: ground ?? 0, label: "" };
}

/** Where a run's laps fall (schematic, evenly along it), in. */
function lapsAt(sp: { pieces: number; piece: number; lap: number }, a: number, z: number) {
  if (sp.pieces < 2) return undefined;
  return Array.from({ length: sp.pieces - 1 }, (_, k) => a + ((z - a) * (k + 1)) / sp.pieces);
}
