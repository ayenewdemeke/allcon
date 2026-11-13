import { girderShape, spanInputs, type GirderInputs } from "../girders/prestressed";
import { profileProps } from "../girders/sections";
import { brakingPerLane, continuousEndShear, continuousLaneReaction, SITE_WIND_DEFAULTS, superstructureWind } from "../girders/substructure-loads";
import { DesignError } from "../walls/cip";
import type { StmCase } from "./strut-tie";

// A pier cap's loads from the girders it carries, AASHTO LRFD 10th Edition: each girder's dead load
// reactions (DC, DW) from its girder design, and the HL-93 live load (3.6.1.2) placed lane by lane
// across the roadway to produce the extreme effects (3.6.1.1.1), with the multiple presence factor
// (3.6.1.1.2) and the dynamic load allowance on the truck or tandem (3.6.2.1). Along the bridge, a
// lane's reaction at the pier comes from the influence line of the spans on either side (simply
// supported); at an interior pier 90% of two trucks 50 ft apart with 90% of the lane load is also
// considered (3.6.1.3.1). Across the bridge, the deck shares each wheel between the girders by the
// lever rule (simple spans between girders, cantilevered overhangs). Feet and kips.

/** One span's girders at the pier, as copied from a girder design. */
export type GirderSide = {
  designId: string;
  name: string;
  span: number; // the design's span (0-based) that ends at this pier
  n: number;
  S: number; // ft
  overhang: number; // ft
  barrierWidth: number; // ft
  skew: number; // deg
  L: number; // ft, bearing to bearing
  continuous: boolean; // the design makes its girders continuous (reactions here are as simple spans)
  dc: { interior: number; exterior: number }; // kip, unfactored reaction at the pier
  dw: { interior: number; exterior: number };
  /** Which end of the span bears on this pier (its end for the back span, its start for the ahead span). */
  end?: "start" | "end";
  /** Continuous girders at an interior pier: one lane's reaction from the continuous beam (per lane, with IM on the trucks), split by span end. */
  liveContinuous?: { pier: number; truck: { back: number; ahead: number }; lane: { back: number; ahead: number }; kind: string } | null;
  /** The superstructure's wind, from the girder design's site inputs (klf; heights in ft above the bearings). */
  wind?: { depth: number; arm: number; armWL: number; deckWidth: number; lineIII: number | null; lineV: number; lineService: number; V: number; exposure: string; Z: number } | null;
  /** The braking force per loaded lane (3.6.4), kip, on the girder design's whole length. */
  brakingPerLane?: number;
};

export type GirderLink = {
  enabled: boolean;
  /** Wind across the bridge (Strength III and V, Service I), from the girder designs' site inputs. */
  wind?: { enabled: boolean };
  back: GirderSide | null;
  ahead: GirderSide | null;
  x0: number; // ft, the cap's x at the bridge's centerline
  reverse: boolean; // the cap's x runs from the bridge's right to its left
  loadNodes: string[]; // the nodes the bearing loads are resolved onto
  selfWeight: boolean; // add the cap's own weight
  soffit: number; // ft, only concrete above this counts as the cap (below is the column, carried by itself)
  wc: number; // kcf
};

export const IM = 0.33;
const LANE = 0.64; // klf
const TRUCK = [8, 32, 32]; // kip, 14 ft apart (the shortest rear spacing gives the largest reaction)
const TANDEM = [25, 25]; // kip, 4 ft apart
export const multiplePresence = (lanes: number) => (lanes <= 1 ? 1.2 : lanes === 2 ? 1 : lanes === 3 ? 0.85 : 0.65); // T. 3.6.1.1.2-1

/**
 * Each girder's unfactored dead load reactions where a span bears on the pier, as its girder design
 * loads it: simple spans for the girder, deck, haunch and diaphragms; for girders made continuous
 * (5.12.3.3) the barriers, other DC2 and the wearing surface by the continuous beam's end shear at an
 * interior pier, with the live load's reaction from the same beam. The design's site wind and
 * braking force come along for the substructure.
 */
export function girderSide(design: GirderInputs, span: number, designId: string, name: string, end: "start" | "end" = "end"): GirderSide {
  const spans = 1 + design.extraSpans.length;
  if (!Number.isInteger(span) || span < 0 || span >= spans) throw new DesignError("That girder design has no such span.");
  const i = spanInputs(design, span);
  const shape = girderShape(i);
  const A = profileProps(shape.profile).A; // in²
  const wg = (A / 144) * i.wc; // klf
  const Lg = i.L + 2 * i.endDist;
  const roadway = (i.nGirders - 1) * i.S + 2 * i.overhang - 2 * i.barrierWidth;
  const pier = end === "end" ? span + 1 : span;
  const interiorPier = spans > 1 && pier > 0 && pier < spans;
  const share = interiorPier ? continuousEndShear(design, span, end) : i.L / 2; // per klf of load after continuity
  const at = (exterior: boolean) => {
    const trib = exterior ? i.S / 2 + i.overhang : i.S;
    const wDeck = ((i.deckT / 12) * trib + (i.haunch / 12) * (shape.topWidth / 12)) * i.wcDeck + i.otherDC1;
    const wBarrier = i.barriersOnExterior ? (exterior ? i.barrierWeight : 0) : (2 * i.barrierWeight) / i.nGirders;
    const Pdia = exterior ? i.diaphragmWeight / 2 : i.diaphragmWeight;
    const dc = (wg * Lg) / 2 + (wDeck * i.L) / 2 + (i.diaphragms * Pdia) / 2 + (wBarrier + i.otherDC2) * share;
    const dw = (((i.fws / 1000) * roadway) / i.nGirders) * share;
    return { dc, dw };
  };
  const int = at(false);
  const ext = at(true);
  const site = design.site ?? SITE_WIND_DEFAULTS;
  const w = superstructureWind(design, site);
  const bridgeLength = [design.L, ...design.extraSpans.map((s) => s.L)].reduce((s, L) => s + L, 0);
  return {
    designId,
    name,
    span,
    end,
    n: i.nGirders,
    S: i.S,
    overhang: i.overhang,
    barrierWidth: i.barrierWidth,
    skew: i.skew,
    L: i.L,
    continuous: spans > 1,
    dc: { interior: int.dc, exterior: ext.dc },
    dw: { interior: int.dw, exterior: ext.dw },
    liveContinuous: interiorPier ? { pier, ...continuousLaneReaction(design, pier) } : null,
    wind: site.barrierHeight > 0 || site.V > 0 ? { depth: w.depth, arm: w.arm, armWL: w.armWL, deckWidth: w.deckWidth, lineIII: w.strengthIII?.line ?? null, lineV: w.strengthV.line, lineService: w.serviceI.line, V: site.V, exposure: site.exposure, Z: site.Z } : null,
    brakingPerLane: brakingPerLane(bridgeLength).perLane,
  };
}

/**
 * One lane's reaction at the pier (per lane, before the multiple presence factor): the truck or
 * tandem part (with IM) and the lane load part, each split into what reaches the pier from the
 * back span and from the ahead span. Spans as simple spans: the influence line is 1 at the pier.
 */
export function laneReaction(L1: number, L2: number) {
  if (!(L1 > 0) && !(L2 > 0)) throw new DesignError("A girder span is needed for the live load.");
  const il = (x: number) => (x === 0 ? 1 : x < 0 ? (L1 > 0 && x >= -L1 ? 1 + x / L1 : 0) : L2 > 0 && x <= L2 ? 1 - x / L2 : 0);
  /** The largest reaction of an axle group moved along the bridge: the influence line is piecewise
   * linear, so the largest is with an axle on one of its corners (the pier or a span's far end). */
  const corners = [0, ...(L1 > 0 ? [-L1] : []), ...(L2 > 0 ? [L2] : [])];
  const best = (axles: { P: number; d: number }[]) => {
    let top = { R: 0, back: 0, ahead: 0 };
    for (const lead of axles)
      for (const at of corners)
        for (const dir of [1, -1]) {
          let back = 0;
          let ahead = 0;
          for (const a of axles) {
            const x = at + dir * (a.d - lead.d);
            const f = a.P * il(x);
            if (x < 0 || (x === 0 && !(L2 > 0))) back += f;
            else ahead += f;
          }
          if (back + ahead > top.R + 1e-12) top = { R: back + ahead, back, ahead };
        }
    return top;
  };
  const truck = TRUCK.map((P, k) => ({ P, d: k * 14 }));
  const tandem = TANDEM.map((P, k) => ({ P, d: k * 4 }));
  const byTruck = best(truck);
  const byTandem = best(tandem);
  const one = byTruck.R >= byTandem.R ? byTruck : byTandem;
  const lane = { back: L1 > 0 ? (LANE * L1) / 2 : 0, ahead: L2 > 0 ? (LANE * L2) / 2 : 0 };
  const single = { truck: { back: one.back * (1 + IM), ahead: one.ahead * (1 + IM) }, lane, kind: one === byTruck ? "design truck" : "design tandem" };
  if (!(L1 > 0 && L2 > 0)) return single;
  // Interior pier (3.6.1.3.1): 90% of two trucks, 50 ft from the first's rear axle to the second's front, and 90% of the lane load.
  const pair = [...truck, ...truck.map((a) => ({ P: a.P, d: a.d + 28 + 50 }))];
  const two = best(pair);
  const twoTotal = 0.9 * (two.R * (1 + IM) + lane.back + lane.ahead);
  if (twoTotal <= one.R * (1 + IM) + lane.back + lane.ahead) return single;
  return { truck: { back: 0.9 * two.back * (1 + IM), ahead: 0.9 * two.ahead * (1 + IM) }, lane: { back: 0.9 * lane.back, ahead: 0.9 * lane.ahead }, kind: "two design trucks at 90%" };
}

/** Girder positions across the bridge (ft from its centerline, square to the girders). */
const girderZ = (s: GirderSide) => Array.from({ length: s.n }, (_, g) => -((s.n - 1) * s.S) / 2 + g * s.S);

/** A load's share to each girder by the lever rule: simple spans between girders, cantilevered overhangs. */
export function leverShares(z: number[], at: number): number[] {
  const out = z.map(() => 0);
  if (z.length === 1) {
    out[0] = 1;
    return out;
  }
  const n = z.length;
  let g = 0;
  if (at <= z[0]) g = 0;
  else if (at >= z[n - 1]) g = n - 2;
  else while (g < n - 2 && at > z[g + 1]) g++;
  const t = (at - z[g]) / (z[g + 1] - z[g]); // below 0 or above 1 on an overhang
  out[g] = 1 - t;
  out[g + 1] = t;
  return out;
}

/** Split a load at x between the two load nodes bracketing it (statically equivalent), or onto the end node. */
function resolve(nodesX: { label: string; x: number }[], x: number, P: number, into: Map<string, number>) {
  const add = (k: string, v: number) => into.set(k, (into.get(k) ?? 0) + v);
  if (nodesX.length === 1 || x <= nodesX[0].x) return add(nodesX[0].label, P);
  const last = nodesX[nodesX.length - 1];
  if (x >= last.x) return add(last.label, P);
  let k = 0;
  while (x > nodesX[k + 1].x) k++;
  const t = (x - nodesX[k].x) / (nodesX[k + 1].x - nodesX[k].x);
  add(nodesX[k].label, P * (1 - t));
  add(nodesX[k + 1].label, P * t);
}

export type Arrangement = { lanes: number; from: number; shift: number; m: number };

/**
 * The Strength I load cases on the cap's load nodes from the girders and the live load placed
 * across the roadway: for each load node the arrangement that loads it most, the arrangements
 * that turn the cap most each way about its supports, and the most total; each with the dead
 * loads at their maximum factors, and the two turning cases again with dead loads at their minimum.
 */
export function capLoadCases(
  link: GirderLink,
  nodes: { label: string; x: number; y: number }[],
  outline: [number, number][],
  b: number,
  supportX: number,
  faces: { x: number; side: -1 | 1; label: string }[] = [], // column faces whose arms' service shear is wanted (C5.8.2.2)
  spans: { a: number; b: number; faceA: number; faceB: number; label: string }[] = [], // a bent's spans between column centerlines, with their faces
) {
  const sides = [link.back, link.ahead].filter((s): s is GirderSide => !!s);
  if (!sides.length) throw new DesignError("Pick a girder design for at least one span.");
  const loadNodes = link.loadNodes.map((l) => nodes.find((n) => n.label === l.trim())).filter((n): n is NonNullable<typeof n> => !!n).sort((a, c) => a.x - c.x);
  if (!loadNodes.length) throw new DesignError("Choose the nodes the girders' loads go to.");
  const warnings: string[] = [];
  for (const s of sides) if (s.continuous) warnings.push(`${s.name}: its girders are made continuous, but the reactions here are taken as for simple spans.`);
  // Along the bridge: the continuous beam's reaction where the girders are continuous over this pier
  // (each side's end, from its own design), else the two spans as simple spans.
  const cont = [link.back, link.ahead].find((s) => s?.liveContinuous)?.liveContinuous ?? null;
  const sameLine = !!cont && !!link.back && !!link.ahead && link.back.designId === link.ahead.designId && link.back.liveContinuous?.pier === link.ahead.liveContinuous?.pier;
  const lane = cont
    ? { truck: { back: link.back ? cont.truck.back : 0, ahead: link.ahead ? cont.truck.ahead : 0 }, lane: { back: link.back ? cont.lane.back : 0, ahead: link.ahead ? cont.lane.ahead : 0 }, kind: `${cont.kind}, continuous girders` }
    : laneReaction(link.back?.L ?? 0, link.ahead?.L ?? 0);
  if (cont && !sameLine) warnings.push("The girders are continuous over this pier: link both spans either side of it from the same girder design, or the other span's share of the reaction is left out.");
  const sign = link.reverse ? -1 : 1;
  const capX = (s: GirderSide, z: number) => link.x0 + (sign * z) / Math.cos((s.skew * Math.PI) / 180);
  // The roadway both spans share, curb to curb, across the bridge.
  const half = (s: GirderSide) => ((s.n - 1) * s.S) / 2 + s.overhang - s.barrierWidth;
  const left = Math.max(...sides.map((s) => -half(s)));
  const right = Math.min(...sides.map((s) => half(s)));
  const width = right - left;
  if (width < 12) throw new DesignError("The roadway is narrower than one 12 ft lane.");
  const lanesMax = Math.floor(width / 12); // 3.6.1.1.1
  const arrangements: Arrangement[] = [];
  for (let k = 1; k <= lanesMax; k++) {
    const room = width - 12 * k;
    const steps = Math.max(1, Math.ceil(room));
    for (let s = 0; s <= steps; s++) for (const shift of [-1, 0, 1]) arrangements.push({ lanes: k, from: left + (room * s) / steps, shift, m: multiplePresence(k) });
  }

  // Unfactored loads at the cap: dead (DC, DW per bearing), live per arrangement (per bearing), self-weight per strip.
  type Bearing = { x: number; dc: number; dw: number; label: string };
  const bearings: Bearing[] = [];
  for (const s of sides) girderZ(s).forEach((z, g) => {
    const ext = g === 0 || g === s.n - 1;
    const prefix = sides.length > 1 ? (s === link.back ? "Back " : "Ahead ") : "";
    bearings.push({ x: capX(s, z), dc: ext ? s.dc.exterior : s.dc.interior, dw: ext ? s.dw.exterior : s.dw.interior, label: `${prefix}G${g + 1}` });
  });
  // Every girder must bear on the cap's concrete: one off its end means the bridge isn't placed on this cap yet.
  const [lo, hi] = [Math.min(...outline.map((p) => p[0])), Math.max(...outline.map((p) => p[0]))];
  const off = bearings.filter((br) => br.x < lo - 0.01 || br.x > hi + 0.01);
  if (off.length) {
    const xs = bearings.map((br) => br.x);
    const f = (v: number) => (Math.round(v * 100) / 100).toString();
    throw new DesignError(`The girders land at x = ${f(Math.min(...xs))} to ${f(Math.max(...xs))} ft, but the cap runs from ${f(lo)} to ${f(hi)} ft: ${off.map((br) => br.label).join(", ")} ${off.length > 1 ? "are" : "is"} off the cap. Set "Cap x at the bridge's centerline" (Loads from girder designs) to where the bridge's centerline crosses the cap, then, for a standard cap, rebuild it with "Positions from the girder link".`);
  }
  const liveAt = (a: Arrangement) => {
    const out: { x: number; P: number }[] = [];
    sides.forEach((s) => {
      const which = s === link.back ? "back" : "ahead";
      const T = lane.truck[which];
      const W = lane.lane[which];
      const z = girderZ(s);
      const per = z.map(() => 0);
      for (let j = 0; j < a.lanes; j++) {
        const c = a.from + 12 * j + 6 + a.shift; // the truck's centerline, its wheels 2 ft or more from the lane's edges
        for (const w of [c - 3, c + 3]) leverShares(z, w).forEach((f, g) => (per[g] += (f * T) / 2));
        for (let q = 0; q < 20; q++) leverShares(z, c - 5 + 0.25 + q * 0.5).forEach((f, g) => (per[g] += (f * W) / 20)); // 10 ft wide
      }
      z.forEach((zz, g) => out.push({ x: capX(s, zz), P: a.m * per[g] }));
    });
    return out;
  };
  // The cap's own weight by vertical strips of its outline.
  const strips: { x: number; P: number }[] = [];
  if (link.selfWeight) {
    const xs = outline.map((p) => p[0]);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const n = 200;
    for (let k = 0; k < n; k++) {
      const x = x0 + ((k + 0.5) * (x1 - x0)) / n;
      // Height of the outline at x: the sum of its crossing intervals.
      const ys: number[] = [];
      outline.forEach((p, j) => {
        const q = outline[(j + 1) % outline.length];
        if ((p[0] <= x && q[0] > x) || (q[0] <= x && p[0] > x)) ys.push(p[1] + ((x - p[0]) * (q[1] - p[1])) / (q[0] - p[0]));
      });
      ys.sort((u, v) => u - v);
      let h = 0;
      for (let j = 0; j + 1 < ys.length; j += 2) h += Math.max(0, ys[j + 1] - Math.max(ys[j], link.soffit));
      strips.push({ x, P: h * ((x1 - x0) / n) * (b / 12) * link.wc });
    }
  }
  const selfWeight = strips.reduce((s, p) => s + p.P, 0);

  const nodeLoads = (a: Arrangement | null, dcF: number, dwF: number, llF: number) => {
    const m = new Map<string, number>();
    for (const br of bearings) resolve(loadNodes, br.x, dcF * br.dc + dwF * br.dw, m);
    if (a) for (const l of liveAt(a)) resolve(loadNodes, l.x, llF * l.P, m);
    for (const s of strips) resolve(loadNodes, s.x, dcF * s.P, m);
    return m;
  };
  const moment = (m: Map<string, number>) => [...m].reduce((s, [k, P]) => s + P * (loadNodes.find((n) => n.label === k)!.x - supportX), 0);
  const total = (m: Map<string, number>) => [...m.values()].reduce((s, P) => s + P, 0);
  const evaluated = arrangements.map((a) => ({ a, m: nodeLoads(a, 1.25, 1.5, 1.75) }));
  const pick = new Map<number, string>();
  const choose = (k: number, why: string) => pick.has(k) || pick.set(k, why);
  const argmax = (f: (m: Map<string, number>) => number) => evaluated.reduce((best, e, k) => (f(e.m) > f(evaluated[best].m) ? k : best), 0);
  for (const n of loadNodes) choose(argmax((m) => m.get(n.label) ?? 0), `most load at ${n.label}`);
  const turnRight = argmax(moment);
  const turnLeft = argmax((m) => -moment(m));
  choose(turnRight, "most turning toward larger x");
  choose(turnLeft, "most turning toward smaller x");
  choose(argmax(total), "most total load");

  const describe = (a: Arrangement) => `${a.lanes} lane${a.lanes > 1 ? "s" : ""} from ${(a.from - left).toFixed(1)} ft off the left curb${a.shift ? `, trucks ${a.shift > 0 ? "right" : "left"} 1 ft` : ""}`;
  const toCase = (name: string, m: Map<string, number>, mx?: Map<string, number>): StmCase => ({ name, loads: loadNodes.filter((n) => m.has(n.label) || mx?.has(n.label)).map((n) => ({ node: n.label, fx: mx?.get(n.label) ?? 0, fy: -(m.get(n.label) ?? 0) })) });
  const cases: StmCase[] = [];
  const caseInfo: { name: string; arrangement: Arrangement; reason: string; dead: "max" | "min" }[] = [];
  // At most 20 cases in all: Strength I's picks, two with dead loads at minimum, Strength IV, and four with wind.
  for (const [k, why] of [...pick].slice(0, link.wind?.enabled ? 12 : 16)) {
    const name = `Strength I (${describe(evaluated[k].a)})`;
    cases.push(toCase(name, evaluated[k].m));
    caseInfo.push({ name, arrangement: evaluated[k].a, reason: why, dead: "max" });
  }
  for (const k of [...new Set([turnRight, turnLeft])]) {
    const name = `Strength I, dead loads at minimum (${describe(evaluated[k].a)})`;
    cases.push(toCase(name, nodeLoads(evaluated[k].a, 0.9, 0.65, 1.75)));
    caseInfo.push({ name, arrangement: evaluated[k].a, reason: "turning case with the dead loads relieving", dead: "min" });
  }
  // Strength IV (Table 3.4.1-1): the dead loads alone at 1.50, which can govern where they are heavy.
  {
    const name = "Strength IV (dead loads only)";
    cases.push(toCase(name, nodeLoads(null, 1.5, 1.5, 0)));
    caseInfo.push({ name, arrangement: { lanes: 0, from: left, shift: 0, m: 1 }, reason: "dead loads at 1.50", dead: "max" });
  }
  // Wind across the bridge, in the cap's plane, from each girder design's site inputs (3.8.1.2, 3.8.2):
  // on the superstructure over half of each span, a line load at its mid-depth, horizontal at the
  // bearings with its overturning about them carried as a couple across the girders; on the live
  // load (WL, 0.10 klf 6 ft above the roadway, Strength V and Service I); and, with no traffic
  // (Strength III), the upward 0.020 ksf on the deck's width at its windward quarter point. Strength
  // III at the site's speed and Kz, Strength V at 80 mph and Service I at 70 mph with Kz = 1.0. Both ways.
  const windOn = !!link.wind?.enabled;
  if (windOn)
    for (const s of sides) if (!s.wind || s.wind.lineIII === null) throw new DesignError(`${s.name}: give the site's wind speed and the barrier's height under "Loads to the substructure" in the girder design, then refresh from the girder designs.`);
  const windGirders = (d: 1 | -1, combo: "III" | "V" | "Service") => {
    const out: { x: number; down: number; across: number }[] = [];
    for (const s of sides) {
      const w = s.wind!;
      const trib = s.L / 2;
      const xs = girderZ(s).map((z) => capX(s, z));
      const xbar = xs.reduce((p, x) => p + x, 0) / xs.length;
      const I = xs.reduce((p, x) => p + (x - xbar) ** 2, 0);
      const H = (combo === "III" ? w.lineIII! : combo === "V" ? w.lineV : w.lineService) * trib;
      const WL = combo === "III" ? 0 : 0.1 * trib;
      const M = d * (H * w.arm + WL * w.armWL); // kip·ft about the bearings, + turning toward larger x
      const deck = w.deckWidth / Math.cos((s.skew * Math.PI) / 180);
      const up = combo === "III" ? 0.02 * deck * trib : 0;
      const e = -d * (deck / 4); // the windward quarter point from the girders' centroid
      xs.forEach((x) => out.push({ x, down: (I > 0 ? (M * (x - xbar)) / I : 0) - (up / xs.length + (I > 0 ? (up * e * (x - xbar)) / I : 0)), across: (d * (H + WL)) / xs.length }));
    }
    return out;
  };
  const windAt = (d: 1 | -1, combo: "III" | "V") => {
    const fy = new Map<string, number>(); // down
    const fx = new Map<string, number>();
    for (const g of windGirders(d, combo)) {
      resolve(loadNodes, g.x, g.down, fy);
      resolve(loadNodes, g.x, g.across, fx);
    }
    return { fy, fx };
  };
  const windInfo = windOn ? { line3: sides[0].wind!.lineIII!, line5: sides[0].wind!.lineV, line1: sides[0].wind!.lineService, V: sides[0].wind!.V } : null;
  if (windInfo) {
    for (const d of [1, -1] as const) {
      const dir = d > 0 ? "toward larger x" : "toward smaller x";
      {
        const name = `Strength III (wind ${dir})`;
        const m = nodeLoads(null, 1.25, 1.5, 0);
        const w = windAt(d, "III");
        w.fy.forEach((v, k) => m.set(k, (m.get(k) ?? 0) + v));
        cases.push(toCase(name, m, w.fx));
        caseInfo.push({ name, arrangement: { lanes: 0, from: left, shift: 0, m: 1 }, reason: "dead loads with the site's wind", dead: "max" });
      }
      {
        const k = d > 0 ? turnRight : turnLeft;
        const name = `Strength V (${describe(evaluated[k].a)}, wind ${dir})`;
        const m = nodeLoads(evaluated[k].a, 1.25, 1.5, 1.35);
        const w = windAt(d, "V");
        w.fy.forEach((v, j) => m.set(j, (m.get(j) ?? 0) + v));
        cases.push(toCase(name, m, w.fx));
        caseInfo.push({ name, arrangement: evaluated[k].a, reason: "live load turning the cap the wind's way, with 80 mph wind", dead: "max" });
      }
    }
  }
  // Service I (1.0 DC + 1.0 DW + 1.0 LL+IM) shear on each arm at a column face, for the
  // diagonal-cracking screen (C5.8.2.2): the arrangement putting the most load on the arm, with
  // its shear span from the face to the arm's load resultant.
  // With wind on, Service I also carries the 70 mph wind and WL, each way (Table 3.4.1-1).
  const serviceWind: ({ x: number; P: number }[] | null)[] = windOn ? ([1, -1] as const).map((d) => windGirders(d, "Service").map((g) => ({ x: g.x, P: g.down }))) : [null];
  const serviceLoads = (a: Arrangement | null) => serviceWind.map((w) => [...bearings.map((br) => ({ x: br.x, P: br.dc + br.dw })), ...strips, ...(a ? liveAt(a) : []), ...(w ?? [])]);
  const serviceShear = faces.map((f) => {
    const onArm = (x: number) => f.side * (x - f.x) > 1e-9;
    let best = { V: 0, a: 0, lanes: 0 };
    for (const a of [null, ...arrangements])
      for (const all of serviceLoads(a)) {
      const loads = all.filter((l) => onArm(l.x));
      const V = loads.reduce((s, l) => s + l.P, 0);
      if (V > best.V) best = { V, a: Math.abs(loads.reduce((s, l) => s + l.P * l.x, 0) / V - f.x), lanes: a?.lanes ?? 0 };
    }
    return { ...f, ...best };
  });
  // A bent's span between two columns: Service I shear at each column face, from the span's loads as a
  // simple span between the column centerlines (less the loads between a centerline and its face), with
  // the shear span to the resultant of the load that face carries.
  for (const sp of spans) {
    const L = sp.b - sp.a;
    const best = [
      { label: `${sp.label}, left face`, x: sp.faceA, side: 1 as const, V: 0, a: 0, lanes: 0 },
      { label: `${sp.label}, right face`, x: sp.faceB, side: -1 as const, V: 0, a: 0, lanes: 0 },
    ];
    for (const a of [null, ...arrangements])
      for (const all of serviceLoads(a)) {
      const loads = all.filter((l) => l.x > sp.a && l.x < sp.b);
      const shareA = loads.map((l) => ({ ...l, s: l.P * (1 - (l.x - sp.a) / L) }));
      const shareB = loads.map((l) => ({ ...l, s: (l.P * (l.x - sp.a)) / L }));
      const VA = shareA.reduce((t, l) => t + l.s, 0) - loads.filter((l) => l.x < sp.faceA).reduce((t, l) => t + l.P, 0);
      const VB = shareB.reduce((t, l) => t + l.s, 0) - loads.filter((l) => l.x > sp.faceB).reduce((t, l) => t + l.P, 0);
      const span = (sh: typeof shareA, face: number, inside: (x: number) => boolean) => {
        const on = sh.filter((l) => inside(l.x));
        const S = on.reduce((t, l) => t + l.s, 0);
        return S > 0 ? on.reduce((t, l) => t + l.s * Math.abs(l.x - face), 0) / S : 0;
      };
      if (VA > best[0].V) best[0] = { ...best[0], V: VA, a: span(shareA, sp.faceA, (x) => x >= sp.faceA), lanes: a?.lanes ?? 0 };
      if (VB > best[1].V) best[1] = { ...best[1], V: VB, a: span(shareB, sp.faceB, (x) => x <= sp.faceB), lanes: a?.lanes ?? 0 };
    }
    serviceShear.push(...best);
  }
  // Each bearing's loads as the girders deliver them: DC, DW, the most live load over the
  // arrangements (with the multiple presence factor), and their Strength I total.
  const llMax = bearings.map(() => 0);
  for (const a of arrangements) liveAt(a).forEach((l, k) => (llMax[k] = Math.max(llMax[k], l.P)));
  const bearingLoads = bearings.map((br, k) => ({ x: br.x, label: br.label, dc: br.dc, dw: br.dw, ll: llMax[k], strength: 1.25 * br.dc + 1.5 * br.dw + 1.75 * llMax[k] }));
  for (const br of bearings) if (br.x < loadNodes[0].x - 1e-6 || br.x > loadNodes[loadNodes.length - 1].x + 1e-6) warnings.push(`A bearing at x = ${br.x.toFixed(2)} ft is beyond the outermost load node; its load is placed on that node, which moves it. Add a node there.`);
  // Braking (3.6.4), along the bridge: every lane loaded one way with the multiple presence factor, the most over the lane counts.
  const brPerLane = Math.max(0, ...sides.map((s) => s.brakingPerLane ?? 0));
  const braking = brPerLane > 0 ? Math.max(...Array.from({ length: lanesMax }, (_, k) => (k + 1) * multiplePresence(k + 1) * brPerLane)) : null;
  return { cases, caseInfo, lane, lanesMax, roadway: width, bearings, bearingLoads, selfWeight, arrangements: arrangements.length, serviceShear, wind: windInfo, braking, warnings: [...new Set(warnings)] };
}

export type CapLoads = ReturnType<typeof capLoadCases>;
