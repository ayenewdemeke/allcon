import { BARS } from "../walls/cip";
import { ftIn, roundDown } from "../rebar/bars";
import { countAt, runGroups, type PreGroup, type RunOptions } from "../rebar/runs";
import { markGroups, schedule, type ConcreteItem } from "../rebar/schedule";
import { ftT, inT, plus18T } from "../takeoff/tex";
import type { DetailView, Takeoff } from "../takeoff/types";
import { num } from "../calc-style";
import type { AbutmentInputs } from "./abutment";
import type { FootingInputs } from "./footing";
import type { MicropileInputs } from "./micropile";
import type { PileInputs } from "./piles";
import type { ShaftInputs } from "./shaft";

// The foundation tools' bars and quantities, CDOT's way: the bars the design sizes, cut at stock
// lengths and lapped (Bridge Detail Manual 4.7), and the other quantities by pay item: piles by the
// foot of section (Section 502, a pile tip on every pile driven to rock, BDM 10.5.2.1), drilled shafts
// by the foot of diameter with their cage (Section 503), micropiles by the foot (503), structure
// excavation and backfill within M-206-1's limits (18 in beyond the concrete), concrete in Class D
// (Bridge).

const C = 3; // in, cast against earth
type Pt = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const fit = (n: number) => Math.round(n * 1000) / 1000;

function runner(fy: number, fc: number) {
  const pre: PreGroup[] = [];
  const run = (o: Omit<RunOptions, "lap"> & { cover: number; spacing: number; times?: number }) => {
    const r = runGroups({ ...o, lap: { fy, fc, clearCover: o.cover, clearSpacing: Math.max(0.5, o.spacing - BARS[o.size].dia), coating: "uncoated" } });
    pre.push(...r.groups.map((g) => ({ ...g, count: g.count * (o.times ?? 1) })));
  };
  return { pre, run };
}

/** A mat of bars both ways in a rectangle B × L (ft), bottom (and top if asked). */
function mat(run: ReturnType<typeof runner>["run"], B: number, L: number, barsB: { bar: number; spacing: number }, barsL: { bar: number; spacing: number }, where: string, cover = C, hooks = false) {
  const Bi = B * 12;
  const Li = L * 12;
  run({ size: barsB.bar, count: countAt(Li - 2 * cover, barsB.spacing), straight: Bi - 2 * cover, hooks: hooks ? [true, true] : undefined, use: `${where}, along B`, callout: `#${barsB.bar} @ ${ftIn(barsB.spacing)} (${where.toLowerCase()}, along B)`, cover, spacing: barsB.spacing });
  run({ size: barsL.bar, count: countAt(Bi - 2 * cover, barsL.spacing), straight: Li - 2 * cover, hooks: hooks ? [true, true] : undefined, use: `${where}, along L`, callout: `#${barsL.bar} @ ${ftIn(barsL.spacing)} (${where.toLowerCase()}, along L)`, cover, spacing: barsL.spacing });
}

/** Structure excavation and backfill within M-206-1's limits: 18 in beyond the concrete, from the ground to its base. */
function excavation(B: number, L: number, depth: number, concreteBelow: number): Takeoff["quantities"] {
  const ex = ((B + 3) * (L + 3) * depth) / 27;
  const exT = `${plus18T(ftT(fit(B)))}\\cdot ${plus18T(ftT(fit(L)))}\\cdot ${ftT(fit(depth))}`;
  return {
    excavation: { value: ex, basis: `(${fit(B)} + 3) ft × (${fit(L)} + 3) ft × ${fit(depth)} ft, M-206-1's 18 in beyond the concrete`, math: exT, ref: "CDOT M-206-1" },
    ...(ex - concreteBelow > 0 ? { backfill: { value: ex - concreteBelow, basis: "the excavation less the concrete in it", terms: [exT, `-${num(concreteBelow)}\\mathrm{yd}^{3}`], ref: "CDOT M-206-1" } } : {}),
  };
}

function section(title: string, B: number, t: number, labels: string): DetailView {
  return { title, polys: [{ pts: rect(0, 0, B * 12, t), style: "concrete" }], lines: [], dots: [], labels: [{ x: (B * 12) / 2, y: t + 6, text: labels, anchor: "middle" }] };
}

export function footingTakeoff(i: FootingInputs): Takeoff {
  const { pre, run } = runner(i.fy, i.fc);
  mat(run, i.B, i.L, i.barsB, i.barsL, "Bottom", i.cover);
  const groups = markGroups(pre);
  const cy = (i.B * i.L * (i.t / 12)) / 27;
  const concrete: ConcreteItem[] = [{ label: "Footing", cy, basis: `${i.B} ft × ${i.L} ft × ${i.t} in`, math: `${ftT(i.B)}\\cdot ${ftT(i.L)}\\cdot ${inT(i.t)}`, ref: "Footing: B × L × thickness" }];
  return {
    what: "spread footing",
    schedule: schedule(groups, concrete),
    quantities: excavation(i.B, i.L, i.Df, cy),
    views: [section("Footing", i.B, i.t, `${i.B} ft × ${i.L} ft, ${i.t} in`)],
    notes: ["Bottom bars both ways, straight, 3 in cover (cast against earth). The column's dowels are detailed with the column.", "Excavation and backfill within CDOT M-206-1's limits, 18 in beyond the footing, from the ground to its base."],
  };
}

export function pileTakeoff(i: PileInputs): Takeoff {
  const { pre, run } = runner(i.fy, i.fc);
  const capB = (i.nB - 1) * i.sB + 2 * i.edge;
  const capL = (i.nL - 1) * i.sL + 2 * i.edge;
  mat(run, capB, capL, i.barsB, i.barsL, "Bottom", i.cover);
  const groups = markGroups(pre);
  const cy = (capB * capL * (i.capT / 12)) / 27;
  const n = i.nB * i.nL;
  const each = i.length + i.embed / 12;
  return {
    what: "pile cap",
    schedule: schedule(groups, [{ label: "Pile cap", cy, basis: `${fit(capB)} ft × ${fit(capL)} ft × ${i.capT} in`, math: `${ftT(fit(capB))}\\cdot ${ftT(fit(capL))}\\cdot ${inT(i.capT)}`, ref: "Cap: B × L × thickness" }]),
    quantities: {
      pile: { value: n * each, basis: `${n} piles × (${i.length} ft + the ${i.embed} in embedment)`, math: `${n}\\cdot\\left(${ftT(i.length)}+${inT(i.embed)}\\right)`, ref: "Section 502: by the foot, cut-off to tip" },
      "pile-tip": { value: n, basis: `one on each of the ${n} piles (driven to bedrock, BDM 10.5.2.1)`, math: `${n}`, ref: "Section 502" },
      ...excavation(capB, capL, i.Df, cy),
    },
    views: [section("Pile cap", capB, i.capT, `${n} × ${i.section}, cap ${fit(capB)} × ${fit(capL)} ft`)],
    notes: ["The cap's bottom mat at 3 in cover, the piles passing between its bars and embedded as given.", "Piles by the foot from the cap's bottom less nothing for cut-off: add the plans' estimated lengths when known."],
  };
}

export function shaftTakeoff(i: ShaftInputs): Takeoff {
  const { pre, run } = runner(i.fy, i.fc);
  const L = i.length * 12;
  run({ size: i.bar, count: i.bars, straight: L - 6, use: "Longitudinal", callout: `${i.bars} #${i.bar} (longitudinal)`, cover: i.cover, spacing: 6 });
  const Dsp = i.D - 2 * i.cover - BARS[i.tieBar].dia;
  const turns = Math.ceil(L / i.pitch) + 3;
  pre.push({ size: i.tieBar, count: 1, shape: { kind: "straight", dims: [roundDown(turns * Math.PI * Dsp)] }, length: roundDown(turns * Math.PI * Dsp), use: "Spiral", callout: `#${i.tieBar} spiral @ ${ftIn(i.pitch)} pitch (${turns} turns, ${fit(Dsp)} in)`, where: "spiral" });
  const groups = markGroups(pre);
  return {
    what: "drilled shaft",
    schedule: schedule(groups, []),
    quantities: {
      shaft: { value: i.length, basis: `${i.length} ft of ${i.D} in shaft`, ref: "Section 503: by the foot of diameter (concrete included)" },
      testing: { value: 1, basis: "crosshole sonic logging of the shaft (non-redundant shafts, BDM 10.6.3.2)", math: "1", ref: "Section 503" },
    },
    views: [section("Shaft", i.D / 12, 24, `${i.D} in, ${i.bars} #${i.bar}`)],
    notes: ["The shaft's concrete is paid in the drilled shaft item. The cage's bars run its length; laps to the column's bars are detailed with the column.", "CSL testing: drop it where the shafts are redundant and not in water or cased holes (BDM 10.6.3.2)."],
    length: { label: "Shafts", value: 1, unit: "EA" },
  };
}

export function micropileTakeoff(i: MicropileInputs, count = 1): Takeoff {
  const N = Math.max(1, Math.round(count));
  return {
    what: "micropiles",
    schedule: schedule([], []),
    quantities: { micropile: { value: N * (i.cased + i.bond), basis: `${N} × (${i.cased} ft cased + ${i.bond} ft bonded)`, math: `${N > 1 ? `${N}\\cdot ` : ""}\\left(${ftT(i.cased)}+${ftT(i.bond)}\\right)`, ref: "Section 503: by the foot, casing, bar and grout included" } },
    views: [section("Micropile", i.casingOD / 12, 12, `${i.casingOD} in casing, #${i.bar} bar`)],
    notes: ["The casing, bar and grout are included in the micropile item. Verification and proof tests by the special provision (AASHTO 10.9.3.5.4).", "The CDOT items are by nominal diameter (6, 7, 8, 10 in): choose the casing's."],
    length: { label: "Micropiles", value: N, unit: "EA" },
  };
}

export function abutmentTakeoff(i: AbutmentInputs): Takeoff {
  const { pre, run } = runner(i.fy, i.fc);
  const integral = i.type.startsWith("integral");
  const Li = i.length * 12;
  let cy = 0;
  const concrete: ConcreteItem[] = [];
  const q: Takeoff["quantities"] = {};
  if (integral) {
    run({ size: i.capTop.bar, count: i.capTop.count, straight: Li - 4, use: "Cap, top", callout: `${i.capTop.count} #${i.capTop.bar} (cap, top)`, cover: 2, spacing: 6 });
    run({ size: i.capBot.bar, count: i.capBot.count, straight: Li - 4, use: "Cap, bottom", callout: `${i.capBot.count} #${i.capBot.bar} (cap, bottom)`, cover: 3, spacing: 6 });
    const w = i.capWidth * 12 - 6;
    const h = i.capDepth * 12 - 6;
    pre.push({ size: i.stirrup.bar, count: countAt(Li - 4, i.stirrup.spacing), shape: { kind: "closed", dims: [roundDown(w), roundDown(h)], hook: 6 }, length: roundDown(2 * (w + h) + 12), use: "Cap stirrups", callout: `#${i.stirrup.bar} stirrups @ ${ftIn(i.stirrup.spacing)}`, where: "cap" });
    const above = (i.totalDepth - i.capDepth) * 12;
    run({ size: i.diaphragmBars.bar, count: 2 * countAt(above - 4, i.diaphragmBars.spacing), straight: Li - 4, use: "Diaphragm, horizontal", callout: `#${i.diaphragmBars.bar} @ ${ftIn(i.diaphragmBars.spacing)} each face (diaphragm)`, cover: 2, spacing: i.diaphragmBars.spacing });
    cy = (i.length * i.capWidth * i.totalDepth) / 27;
    concrete.push({ label: "Cap and end diaphragm", cy, basis: `${i.length} ft × ${i.capWidth} ft × ${i.totalDepth} ft (the girders' ends not deducted)`, math: `${ftT(i.length)}\\cdot ${ftT(i.capWidth)}\\cdot ${ftT(i.totalDepth)}`, ref: "Integral abutment: length × width × depth" });
    if (i.type === "integral-piles") {
      q.pile = { value: i.nPiles * (i.pileLength + i.embed / 12), basis: `${i.nPiles} piles × (${i.pileLength} ft + the ${i.embed} in embedment)`, math: `${i.nPiles}\\cdot\\left(${ftT(i.pileLength)}+${inT(i.embed)}\\right)`, ref: "Section 502" };
      q["pile-tip"] = { value: i.nPiles, basis: `${i.nPiles} piles`, math: `${i.nPiles}`, ref: "Section 502" };
      if (i.prebore > 0) q.prebore = { value: i.nPiles * i.prebore, basis: `${i.nPiles} × ${i.prebore} ft (the pipe sleeve and pea gravel included, BDM 11.3.1 Note 11)`, math: `${i.nPiles}\\cdot ${ftT(i.prebore)}`, ref: "Section 502" };
    } else q.shaft = { value: i.nPiles * i.shaftLength, basis: `${i.nPiles} shafts × ${i.shaftLength} ft`, math: `${i.nPiles}\\cdot ${ftT(i.shaftLength)}`, ref: "Section 503" };
    Object.assign(q, excavation(i.capWidth, i.length, i.capDepth + i.capEmbed, cy));
  } else {
    const B = i.toe + i.stemT + i.heel;
    const Hst = i.stemH + i.backwallH;
    run({ size: i.stemBars.bar, count: countAt(Li - 4, i.stemBars.spacing), straight: i.stemH * 12 + i.footT * 12 - 6, hooks: [true, false], use: "Stem, back face", callout: `#${i.stemBars.bar} @ ${ftIn(i.stemBars.spacing)} (stem, back face)`, cover: 2, spacing: i.stemBars.spacing });
    run({ size: i.backwallBars.bar, count: 2 * countAt(Li - 4, i.backwallBars.spacing), straight: i.backwallH * 12 + 24, use: "Backwall, vertical", callout: `#${i.backwallBars.bar} @ ${ftIn(i.backwallBars.spacing)} each face (backwall)`, cover: 2, spacing: i.backwallBars.spacing });
    run({ size: i.toeBars.bar, count: countAt(Li - 6, i.toeBars.spacing), straight: B * 12 - 6, use: "Footing, bottom", callout: `#${i.toeBars.bar} @ ${ftIn(i.toeBars.spacing)} (footing, bottom)`, cover: 3, spacing: i.toeBars.spacing });
    run({ size: i.heelBars.bar, count: countAt(Li - 6, i.heelBars.spacing), straight: B * 12 - 6, use: "Footing, top", callout: `#${i.heelBars.bar} @ ${ftIn(i.heelBars.spacing)} (footing, top)`, cover: 2, spacing: i.heelBars.spacing });
    const vol = i.length * (i.stemT * i.stemH + i.backwallT * i.backwallH + B * i.footT);
    cy = vol / 27;
    concrete.push({ label: "Stem, backwall and footing", cy, basis: `${i.length} ft × (${i.stemT} × ${i.stemH} + ${i.backwallT} × ${i.backwallH} + ${fit(B)} × ${i.footT}) ft²`, math: `${ftT(i.length)}\\cdot\\left(${ftT(i.stemT)}\\cdot ${ftT(i.stemH)}+${ftT(i.backwallT)}\\cdot ${ftT(i.backwallH)}+${ftT(fit(B))}\\cdot ${ftT(i.footT)}\\right)`, ref: "Abutment: length × section" });
    if (i.foundation === "piles") {
      const n = 2 * Math.max(1, Math.floor(i.length / i.pileSpacing) + 1);
      q.pile = { value: n * (i.pileLength + 1), basis: `${n} piles in two rows × (${i.pileLength} + 1) ft`, math: `${n}\\cdot\\left(${ftT(i.pileLength)}+1\\mathrm{ft}\\right)`, ref: "Section 502" };
      q["pile-tip"] = { value: n, basis: `${n} piles`, math: `${n}`, ref: "Section 502" };
    }
    Object.assign(q, excavation(B, i.length, Math.max(i.footT, i.Df), (i.length * B * i.footT) / 27));
    void Hst;
  }
  const groups = markGroups(pre);
  return {
    what: `${i.type.replace("-", " ")} abutment`,
    schedule: schedule(groups, concrete),
    quantities: q,
    views: [section("Abutment", integral ? i.capWidth : i.toe + i.stemT + i.heel, integral ? i.totalDepth * 12 : i.footT * 12, `${i.length} ft long`)],
    notes: ["Concrete Class D (Bridge) or DF and epoxy-coated bars (BDM 11.3.1 Notes 1 and 6).", "Wingwalls are detailed in the Cantilever Wingwall tool; the approach slab's notch and the girders' anchorage (strands, #7 bars in PVC sleeves) are not included."],
  };
}
