import { bar } from "../stm/aashto";
import type { Pt } from "../stm/geometry";
import { ftIn, roundDown } from "../rebar/bars";
import { countAt, runGroups, type PreGroup, type RunOptions } from "../rebar/runs";
import { markGroups, schedule, type ConcreteItem } from "../rebar/schedule";
import { ftT, inT } from "../takeoff/tex";
import type { DetailView, Takeoff } from "../takeoff/types";
import type { ApproachSlabInputs } from "./approach-slab";

// An approach slab's bars as CDOT details them, and its quantities as the SOQ's approach slab
// column carries them (BDM Section 19: from the back of the approach notch; the anchorage bars into
// the abutment listed here, though CDOT's SOQ carries them with the superstructure). Clear to the
// slab's edges and ends 2 in (Bridge Detail Manual 4.8). All bars epoxy coated (BDM 5.4.5).
//
// The details are CDOT worksheet B-601-1EA's (Approach Slab Details, Asphalt with 0–4" Joint) and,
// without the device, B-601-1's:
// - the slab: L ("20'-0"") from the abutment's back face to the free end, plus its seat on the
//   notch (6"), so the slab is L + the seat long (Section A);
// - layers: the #6 main bars at the bottom, the #4 longitudinal at the top, the #5 transverse bars
//   inside both;
// - the #4 @ 1'-6" top bar is one ⊏ the slab's length, down both ends with 1'-0" returns along the
//   bottom (the contractor may use straight bars and ⊏ end pieces instead, ◆);
// - the #5 @ 1'-0" anchorage bars (2'-9" with a 10" leg) straight at the slab's mid-depth through
//   the joint, the leg turned down in the abutment;
// - B-601-1EA's sleeper: 4'-0" by 1'-0", a 1'-0" block under the device up to the roadway's surface
//   (1'-3" with 3" of HMA); two #5 bars at each 1'-0" (2'-8", 7", 2'-2", 1'-9", 8"), mirrored, lapping
//   to a hoop round the sleeper and a closed stirrup in the block; #5 (Tot 10) along it; #5 (Tot 2)
//   at the block's top;
// - B-601-1's sleeper: 3'-0" by 1'-0", 1'-0" past the slab's end, #4 closed hoops @ 1'-6", #5 (6 Tot).

const C = 2; // in, clear to the edges and ends
const fit = (n: number) => Math.round(n * 1000) / 1000;
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const GAP = 2; // in, the device's opening drawn between the slab's end and the block ("A", 0–4 in)

/** The slab's length along the roadway (in): L from the abutment's back face plus the seat on the notch. */
export const slabLength = (i: ApproachSlabInputs) => i.L * 12 + i.seat / Math.cos((i.skew * Math.PI) / 180);

/** B-601-1EA's sleeper bar, two at each place (in): top leg, the hoop's side, bottom leg, up into the block, across its top. */
export function sleeperBentBar(i: ApproachSlabInputs) {
  const sc = 3;
  return [i.sleeperB * 12 - 2 * sc - 10, i.sleeperT - sc - 2, i.sleeperSeat + i.blockW - 4, i.sleeperT + i.t + i.wearing - 2 * sc, i.blockW - 4].map(roundDown);
}

export function approachSlabTakeoff(i: ApproachSlabInputs, count = 2): Takeoff {
  const N = Math.max(1, Math.round(count));
  const times = N > 1 ? `${N}\\cdot ` : "";
  const each = (what: string) => (N > 1 ? `${N} ${what}, each ` : "");
  const cos = Math.cos((i.skew * Math.PI) / 180);
  const Ls = slabLength(i); // in, along the roadway
  const LsFt = Ls / 12;
  const seatR = i.seat / cos; // in, the seat along the roadway
  const Wn = i.W * 12; // in, normal to the roadway
  const Wsk = Wn / cos; // in, along the skewed ends
  const device = i.joint === "device";
  const pre: PreGroup[] = [];
  const run = (o: Omit<RunOptions, "lap"> & { cover: number; spacing: number }) => {
    const r = runGroups({ ...o, lap: { fy: i.fy, fc: i.fc, clearCover: o.cover, clearSpacing: Math.max(0.5, o.spacing - bar(o.size).db), coating: "epoxy" } });
    pre.push(...r.groups.map((g) => ({ ...g, count: g.count * N })));
    return r;
  };
  const call = (b: { bar: number; spacing: number }, what: string) => `#${b.bar} @ ${ftIn(b.spacing)} (${what})`;

  // --- the slab --------------------------------------------------------------------------------------
  const nMain = countAt(Wn - 2 * C, i.mainBars.spacing);
  run({ size: i.mainBars.bar, count: nMain, straight: Ls - 2 * C, use: "Main bars, bottom", callout: call(i.mainBars, "bottom, along the roadway"), cover: i.coverBot, spacing: i.mainBars.spacing });
  // The top longitudinal ⊏: along the top, down both ends (between the covers) and 1'-0" back along the bottom.
  const drop = i.t - i.coverTop - i.coverBot;
  const nTopL = countAt(Wn - 2 * C, i.topLong.spacing);
  run({ size: i.topLong.bar, count: nTopL, straight: [12, drop, Ls - 2 * C, drop, 12], use: "Longitudinal, top", callout: `#${i.topLong.bar} ⊏ @ ${ftIn(i.topLong.spacing)} (top, along the roadway, down both ends)`, cover: i.coverTop, spacing: i.topLong.spacing });
  const nDist = countAt(Ls - 2 * C, i.distBars.spacing);
  run({ size: i.distBars.bar, count: nDist, straight: Wsk - 2 * C, use: "Transverse, bottom", callout: call(i.distBars, "bottom, parallel to the ends"), cover: i.coverBot, spacing: i.distBars.spacing });
  const nTopT = countAt(Ls - 2 * C, i.topTrans.spacing);
  run({ size: i.topTrans.bar, count: nTopT, straight: Wsk - 2 * C, use: "Transverse, top", callout: call(i.topTrans, "top, parallel to the ends"), cover: i.coverTop, spacing: i.topTrans.spacing });

  // --- anchorage bars: straight through the joint at mid-depth, the leg turned down in the abutment ------------
  const nDowel = countAt(Wsk - 2 * C, i.dowels.spacing);
  const leg = i.dowelHook;
  const dowelStraight = i.dowelAbut + i.dowelSlab;
  pre.push({ size: i.dowels.bar, count: N * nDowel, shape: { kind: "hooked", dims: [roundDown(leg), roundDown(dowelStraight)], hooks: 1 }, length: roundDown(leg + dowelStraight), use: "Anchorage bars", callout: `#${i.dowels.bar} @ ${ftIn(i.dowels.spacing)} (project ${ftIn(i.dowelSlab)} into the approach slab, rotate as required to avoid a girder)`, where: "abutment to slab" });

  // --- the sleeper slab --------------------------------------------------------------------------------------------
  const B = i.sleeperB * 12;
  const sc = 3; // in, cast against earth (BDM 5.4.3)
  const sb = i.sleeperBars.bar;
  const nAcross = countAt(Wsk - 2 * C, i.sleeperBars.spacing);
  // The sleeper's back edge, the block's faces, and its bars' stations along the roadway.
  const sx0 = device ? Ls + GAP - i.sleeperSeat : Ls - i.sleeperSeat;
  const xb0 = Ls + GAP;
  const xL = xb0 + 2;
  const xR = xb0 + i.blockW - 2;
  const hx0 = sx0 + sc;
  const hx1 = sx0 + B - sc;
  const longX: { top: number[]; bottom: number[] } = { top: [], bottom: [] };
  if (i.sleeper) {
    if (device) {
      const dims = sleeperBentBar(i);
      pre.push({ size: sb, count: 2 * N * nAcross, shape: { kind: "bent", dims, hooks: 0 }, length: dims.reduce((s, d) => s + d, 0), use: "Sleeper bars", callout: `#${sb} @ ${ftIn(i.sleeperBars.spacing)} (sleeper, 2 each place, mirrored)`, where: "sleeper" });
      // Along it: at the hoop's corners and the stirrup's bottom corners, the gaps filled at the spacing; the top row skips the block's stirrup.
      const fill = (stops: number[]) => stops.flatMap((x, k) => (k === 0 ? [x] : (() => { const gap = x - stops[k - 1]; const n = Math.ceil(gap / i.sleeperLong.spacing - 1e-9); return Array.from({ length: n }, (_, j) => stops[k - 1] + ((j + 1) * gap) / n); })()));
      longX.bottom = fill([hx0, Math.max(hx0, Math.min(xL, hx1)), Math.max(hx0, Math.min(xR, hx1)), hx1].filter((x, k, a) => k === 0 || x > a[k - 1] + 1));
      longX.top = longX.bottom.filter((x) => Math.abs(x - xL) > 1 && Math.abs(x - xR) > 1);
    } else {
      const w = B - 2 * sc;
      const h = i.sleeperT - 2 * sc;
      const hook = roundDown(Math.max(6 * bar(sb).db, 3));
      pre.push({ size: sb, count: N * nAcross, shape: { kind: "closed", dims: [roundDown(w), roundDown(h)], hook }, length: roundDown(2 * (w + h) + 2 * hook), use: "Sleeper hoops", callout: `#${sb} @ ${ftIn(i.sleeperBars.spacing)} (sleeper, closed hoops)`, where: "sleeper" });
      const n = countAt(B - 2 * sc, i.sleeperLong.spacing);
      longX.bottom = Array.from({ length: n }, (_, k) => hx0 + (n > 1 ? (k * (B - 2 * sc)) / (n - 1) : (B - 2 * sc) / 2));
      longX.top = longX.bottom;
    }
    const nLong = longX.top.length + longX.bottom.length;
    run({ size: i.sleeperLong.bar, count: nLong, straight: Wsk - 2 * C, use: "Sleeper, along", callout: `#${i.sleeperLong.bar} (Tot ${nLong}) along the sleeper`, cover: sc, spacing: i.sleeperLong.spacing });
    if (device) run({ size: 5, count: 2, straight: Wsk - 2 * C, use: "Sleeper, in the block", callout: "#5 (Tot 2) at the block's top", cover: 2, spacing: 6 });
  }

  // --- concrete and other quantities ---------------------------------------------------------------------------------
  const slabCy = (LsFt * i.W * (i.t / 12)) / 27;
  const seatNote = `${i.L} ft + the ${i.seat} in seat`;
  const concrete: ConcreteItem[] = [
    { label: N > 1 ? "Approach slabs" : "Approach slab", cy: N * slabCy, basis: `${each("slabs")}${fit(LsFt)} ft along the roadway (${seatNote}, from the back of the notch) by ${i.W} ft by ${i.t} in`, math: `${times}${ftT(fit(LsFt))}\\cdot ${ftT(i.W)}\\cdot ${inT(i.t)}`, ref: "Approach slab: length from the back of the notch × width × thickness" },
  ];
  const blockH = i.t + i.wearing; // in, the block up to the roadway's surface
  if (i.sleeper) {
    const len = Wsk / 12;
    const area = i.sleeperB * (i.sleeperT / 12) + (device ? (i.blockW / 12) * (blockH / 12) : 0);
    const section = device ? `\\left(${ftT(i.sleeperB)}\\cdot ${inT(i.sleeperT)}+${inT(i.blockW)}\\cdot ${inT(blockH)}\\right)` : `${ftT(i.sleeperB)}\\cdot ${inT(i.sleeperT)}`;
    concrete.push({ label: N > 1 ? "Sleeper slabs" : "Sleeper slab", cy: (N * area * len) / 27, basis: `${each("sleepers")}${i.sleeperB} ft by ${i.sleeperT} in${device ? `, with a ${i.blockW} by ${blockH} in block under the device` : ""}, ${fit(len)} ft long (along the skewed end)`, math: `${times}${section}\\cdot\\frac{${ftT(i.W)}}{\\cos\\left(${i.skew}\\mathrm{deg}\\right)}`, ref: device ? "Sleeper slab: (base + block under the device) × its length along the slab's end" : "Sleeper slab: width × thickness × its length along the slab's end" });
  }
  const groups = markGroups(pre);
  const sch = schedule(groups, concrete);
  const markOf = (use: string) => groups.find((g) => g.use === use)?.mark ?? "";
  const quantities: Takeoff["quantities"] = {};
  if (i.wearing > 0) quantities.waterproofing = { value: (N * LsFt * i.W) / 9, basis: `${each("slabs")}the slab's top under the ${i.wearing} in overlay, ${fit(LsFt)} ft by ${i.W} ft`, math: `${times}${ftT(fit(LsFt))}\\cdot ${ftT(i.W)}`, ref: "the slab's top under the overlay: length × width" };
  // The poured joint (Item 408) at the abutment end; with no device, at the sleeper end too (B-601-1).
  const nSeal = device ? 1 : 2;
  quantities.sealant = { value: (N * nSeal * Wsk) / 12, basis: `the poured joint along ${nSeal === 1 ? "the slab's end at the abutment" : "both of the slab's ends"}`, math: `${N * nSeal > 1 ? `${N * nSeal}\\cdot ` : ""}\\frac{${ftT(i.W)}}{\\cos\\left(${i.skew}\\mathrm{deg}\\right)}`, ref: "the poured joint sealant along the skewed end(s), Item 408" };
  if (device) quantities.joint = { value: (N * Wsk) / 12, basis: `${each("joints")}across the slab's end, ${fit(Wsk / 12)} ft along the skew`, math: `${times}\\frac{${ftT(i.W)}}{\\cos\\left(${i.skew}\\mathrm{deg}\\right)}`, ref: "the joint along the slab's skewed end" };

  // --- views (inches, y up) -------------------------------------------------------------------------------------------
  // Longitudinal section along the roadway: the abutment with the notch at the left, the slab on its seat, the sleeper at the right.
  const t = i.t;
  const wall = Math.max(24, i.dowelAbut + 8); // the abutment drawn this far behind the joint
  const below = 36;
  const sT = i.sleeperT;
  const polys: DetailView["polys"] = [
    { pts: [[-wall, t], [0, t], [0, 0], [seatR, 0], [seatR, -below], [-wall, -below]], style: "concrete" }, // the abutment, the slab on the notch's seat
    { pts: rect(0, 0, Ls, t), style: "concrete" },
    { pts: [[seatR, 0], [i.sleeper ? sx0 : Ls, 0], [i.sleeper ? sx0 : Ls, -below], [seatR, -below]], style: "earth" },
  ];
  if (i.wearing > 0) polys.push({ pts: rect(-wall, t, Ls, t + i.wearing), style: "dashed" });
  if (i.sleeper) polys.push({ pts: rect(sx0, -sT, sx0 + B, 0), style: "concrete" });
  if (i.sleeper && device) polys.push({ pts: rect(xb0, 0, xb0 + i.blockW, blockH), style: "concrete" });
  const dbM = bar(i.mainBars.bar).db;
  const dbL = bar(i.topLong.bar).db;
  const yMain = i.coverBot + dbM / 2; // the main bars are the bottom layer
  const yLong = t - i.coverTop - dbL / 2; // the #4 longitudinal the top layer
  const yRet = i.coverBot + dbL / 2;
  const lines: DetailView["lines"] = [
    { pts: [[C, yMain], [Ls - C, yMain]], mark: markOf("Main bars, bottom"), kind: "main" },
    { pts: [[C + 12, yRet], [C, yRet], [C, yLong], [Ls - C, yLong], [Ls - C, yRet], [Ls - C - 12, yRet]], mark: markOf("Longitudinal, top"), kind: "secondary" },
    { pts: [[-i.dowelAbut, t / 2 - leg], [-i.dowelAbut, t / 2], [i.dowelSlab, t / 2]], mark: markOf("Anchorage bars"), kind: "stirrup" },
  ];
  const dots: DetailView["dots"] = [];
  const shown = (len: number, s: number) => Math.min(countAt(len, s), 80);
  const dbD = bar(i.distBars.bar).db;
  const dbT = bar(i.topTrans.bar).db;
  for (let k = 0; k < shown(Ls - 2 * C, i.distBars.spacing); k++) dots.push({ x: C + k * i.distBars.spacing, y: i.coverBot + dbM + dbD / 2, d: dbD, mark: markOf("Transverse, bottom") });
  for (let k = 0; k < shown(Ls - 2 * C, i.topTrans.spacing); k++) dots.push({ x: C + k * i.topTrans.spacing, y: t - i.coverTop - dbL - dbT / 2, d: dbT, mark: markOf("Transverse, top") });
  if (i.sleeper) {
    const dbs = bar(sb).db;
    const dbl = bar(i.sleeperLong.bar).db;
    const yb = -sT + sc; // the hoop's bottom
    const yt = device ? -2 : -sc; // its top
    if (device) {
      const [top, , , , ] = sleeperBentBar(i);
      const yBlk = blockH - 3;
      const mark = markOf("Sleeper bars");
      lines.push({ pts: [[hx0 + top, yt], [hx0, yt], [hx0, yb], [xR, yb], [xR, yBlk], [xL, yBlk]], mark, kind: "stirrup" });
      lines.push({ pts: [[hx1 - top, yt - 0.8], [hx1, yt - 0.8], [hx1, yb + 0.8], [xL, yb + 0.8], [xL, yBlk + 0.8], [xR, yBlk + 0.8]], mark, kind: "stirrup" });
      for (const x of [xL + dbs, xR - dbs]) dots.push({ x, y: yBlk - dbs, d: bar(5).db, mark: markOf("Sleeper, in the block") });
    } else lines.push({ pts: [[hx0, yb], [hx1, yb], [hx1, yt], [hx0, yt], [hx0, yb]], mark: markOf("Sleeper hoops"), kind: "stirrup" });
    const inset = (x: number) => Math.min(Math.max(x, hx0 + dbs + dbl / 2), hx1 - dbs - dbl / 2);
    for (const x of longX.bottom) dots.push({ x: inset(x === xL ? x + dbs + dbl / 2 : x === xR ? x - dbs - dbl / 2 : x), y: yb + dbs + dbl / 2, d: dbl, mark: markOf("Sleeper, along") });
    for (const x of longX.top) dots.push({ x: inset(x), y: yt - dbs - dbl / 2, d: dbl, mark: markOf("Sleeper, along") });
  }
  const full: DetailView = {
    title: "Section along the roadway",
    polys,
    lines,
    dots,
    labels: [
      { x: -wall / 2, y: t + i.wearing + 8, text: "Abutment", anchor: "middle" },
      { x: seatR + 4, y: -8, text: `${ftIn(roundDown(i.seat))} seat`, anchor: "start" },
      { x: 30, y: t + i.wearing + 8, text: `Approach slab (${ftIn(roundDown(Ls))} from the back of the notch)`, anchor: "start" },
      ...(i.sleeper ? [{ x: sx0 + B / 2, y: -sT - 8, text: `Sleeper slab, ${ftIn(B)}`, anchor: "middle" as const }, { x: Ls - 30, y: t + i.wearing + 8, text: "Approach slab", anchor: "middle" as const }] : [{ x: Ls - 20, y: t + i.wearing + 8, text: "End of slab", anchor: "middle" as const }]),
      ...(i.sleeper && device ? [{ x: xb0 + i.blockW / 2, y: blockH + 8, text: "0–4 in device", anchor: "middle" as const }] : []),
    ],
  };
  // The slab is too long and thin to read at one scale: CDOT's sheets show its two ends.
  const atAbutment = cropView(full, -wall - 2, Math.max(seatR + i.dowelSlab + 18, 72), "Section at the abutment");
  const atEnd = cropView(full, (i.sleeper ? sx0 : Ls) - 30, i.sleeper ? Math.max(sx0 + B, xb0 + i.blockW) + 2 : Ls + 2, i.sleeper ? "Section at the sleeper slab" : "Section at the slab's end");
  // Plan: the slab's outline (skewed ends) with a few bars of each mat.
  const off = Wn * Math.tan((i.skew * Math.PI) / 180); // the far edge's shift along the roadway
  const plan: DetailView = {
    title: "Plan",
    polys: [{ pts: [[0, 0], [Ls, 0], [Ls + off, Wn], [off, Wn]], style: "concrete" }, ...(i.sleeper ? [{ pts: [[sx0, 0], [sx0 + B, 0], [sx0 + B + off, Wn], [sx0 + off, Wn]] as Pt[], style: "dashed" as const }] : [])],
    lines: [
      ...Array.from({ length: Math.min(nMain, 12) }, (_, k) => {
        const y = C + ((Wn - 2 * C) * k) / Math.max(1, Math.min(nMain, 12) - 1);
        const x = y * Math.tan((i.skew * Math.PI) / 180);
        return { pts: [[x + C, y], [x + Ls - C, y]] as Pt[], mark: markOf("Main bars, bottom"), kind: "main" as const };
      }),
      ...Array.from({ length: Math.min(nDist, 12) }, (_, k) => {
        const x = C + ((Ls - 2 * C) * k) / Math.max(1, Math.min(nDist, 12) - 1);
        return { pts: [[x, C], [x + off, Wn - C]] as Pt[], mark: markOf("Transverse, bottom"), kind: "secondary" as const };
      }),
    ],
    dots: [],
    labels: [
      { x: -6, y: Wn / 2, text: "Abutment", anchor: "end" },
      { x: Ls + off / 2 + 6, y: Wn / 2, text: i.joint === "none" ? "End of slab" : "Joint at the end", anchor: "start" },
    ],
  };

  const notes = [
    `Details after CDOT worksheet ${device ? "B-601-1EA (Approach Slab Details, Asphalt with 0–4\" Joint)" : "B-601-1 (Approach Slab Details, Asphalt with Sleeper)"}: Concrete Class DF (its Note 1), 2 in top and 3 in bottom clear, the #${i.mainBars.bar} main bars the bottom layer and the #${i.topLong.bar} longitudinal bars the top layer, the transverse bars inside both.`,
    `The slab is ${ftIn(roundDown(Ls))} along the roadway: ${i.L} ft from the abutment's back face to its end plus its ${ftIn(roundDown(i.seat))} seat on the notch.`,
    `The #${i.topLong.bar} top bars are ⊏ bars the slab's length, down both ends with 1'-0" returns along the bottom; the worksheet lets the contractor use straight bars with ⊏ end pieces (1'-0" legs) instead.`,
    "All reinforcing steel is epoxy coated (CDOT BDM 5.4.5: approach slabs, every layer).",
    `${device ? "The 0–4 in expansion device (518) sits on the sleeper's block, with 20 Ga galvanized sheet metal under it (included in the work); its own anchor bars come with the device (the expansion device sheets) and aren't in this schedule." : "No expansion device (B-601-1: bridge movement ¾ in or less, asphalt approach)."} The ½ in expansion joint material (AASHTO M213) is included in the work; the poured joint sealant is Item 408.`,
    `Concrete is measured from the back of the approach notch (BDM Section 19). The ${N * nDowel} anchorage bars are listed here; CDOT's summary of quantities carries the anchorage bars into the abutment with the superstructure.`,
    `Transverse bars run parallel to the slab's ends${i.skew > 0 ? ` (skewed ${i.skew}°), spaced along the roadway` : ""}. Where the skew is 30° or more, BDM 2.2.1.1 asks for the slab's far end square to the roadway where practical: detail that end's fanned bars by hand.`,
    "Drains on the high side of the joint (BDM 2.13), the notch's own bars and the curb or rail transition's bars are not included.",
  ];
  return { what: "approach slab", schedule: sch, quantities, views: [atAbutment, atEnd, plan], notes, length: { label: "Approach slabs", value: N, unit: "EA" } };
}

/** A polygon clipped to the band x0 ≤ x ≤ x1 (Sutherland–Hodgman, the two vertical edges). */
function clipPoly(pts: Pt[], x0: number, x1: number): Pt[] {
  const edge = (input: Pt[], inside: (p: Pt) => boolean, xe: number) => {
    const out: Pt[] = [];
    for (let k = 0; k < input.length; k++) {
      const a = input[k];
      const b = input[(k + 1) % input.length];
      const cut = (): Pt => [xe, a[1] + ((b[1] - a[1]) * (xe - a[0])) / (b[0] - a[0])];
      if (inside(b)) {
        if (!inside(a)) out.push(cut());
        out.push(b);
      } else if (inside(a)) out.push(cut());
    }
    return out;
  };
  return edge(edge(pts, (p) => p[0] >= x0, x0), (p) => p[0] <= x1, x1);
}

/** A polyline clipped to the band: the pieces inside it. */
function clipLine(pts: Pt[], x0: number, x1: number): Pt[][] {
  const pieces: Pt[][] = [];
  let cur: Pt[] = [];
  const at = (a: Pt, b: Pt, x: number): Pt => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1)];
  for (let k = 0; k + 1 < pts.length; k++) {
    let a = pts[k];
    let b = pts[k + 1];
    const lo = Math.min(a[0], b[0]);
    const hi = Math.max(a[0], b[0]);
    if (hi < x0 || lo > x1) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
      continue;
    }
    if (a[0] < x0) a = at(a, b, x0);
    else if (a[0] > x1) a = at(a, b, x1);
    if (b[0] < x0) b = at(a, b, x0);
    else if (b[0] > x1) b = at(a, b, x1);
    if (!cur.length) cur.push(a);
    cur.push(b);
    if (pts[k + 1][0] < x0 || pts[k + 1][0] > x1) {
      pieces.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

/** A part of a view, between x0 and x1. */
function cropView(v: DetailView, x0: number, x1: number, title: string): DetailView {
  return {
    title,
    polys: v.polys.map((p) => ({ ...p, pts: clipPoly(p.pts, x0, x1) })).filter((p) => p.pts.length >= 3),
    lines: v.lines.flatMap((l) => clipLine(l.pts, x0, x1).map((pts) => ({ ...l, pts }))),
    dots: v.dots.filter((d) => d.x >= x0 && d.x <= x1),
    labels: (v.labels ?? []).filter((l) => l.x >= x0 && l.x <= x1),
  };
}
