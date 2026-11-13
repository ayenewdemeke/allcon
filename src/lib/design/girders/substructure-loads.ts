import { DesignError } from "../walls/cip";
import { continuousBeam } from "./continuous";
import { girderShape, spanInputs, type GirderInputs } from "./prestressed";
import { profileProps } from "./sections";

// The loads a girder bridge delivers to its substructure, AASHTO LRFD 10th Edition: the wind on the
// superstructure (WS, 3.8.1.2) and on the live load (WL, 3.8.1.3), the vertical wind (3.8.2), the
// braking force (BR, 3.6.4), and, for girders made continuous (5.12.3.3), each span's share of a
// pier's reaction from the continuous beam the girder check uses. Feet, kips.

/** The bridge site's wind: what the superstructure's wind load needs beyond the girder design. */
export type SiteWind = {
  V: number; // mph, the design 3-second gust wind speed for Strength III (Figure 3.8.1.1.2-1); 0 if not given
  exposure: "B" | "C" | "D"; // 3.8.1.1.5
  Z: number; // ft, the top of the superstructure above the surrounding ground or water (3.8.1.2.1)
  barrierHeight: number; // ft, the barrier (or railing) above the deck, part of the depth the wind sees
};
export const SITE_WIND_DEFAULTS: SiteWind = { V: 0, exposure: "C", Z: 33, barrierHeight: 0 };

/** Kz for Strength III and Service IV, Eqs. 3.8.1.2.1-2 to -4 (Z at least 33 ft); 1.0 for the other combinations. */
export function windKz(Z: number, exposure: SiteWind["exposure"]) {
  const z = Math.max(33, Z);
  const [z0, c, k] = exposure === "B" ? [0.9834, 6.87, 345.6] : exposure === "C" ? [0.0984, 7.35, 478.4] : [0.0164, 7.65, 616.1];
  return (2.5 * Math.log(z / z0) + c) ** 2 / k;
}

/** PZ = 2.56×10⁻⁶ V² Kz G Cd (ksf, Eq. 3.8.1.2.1-1), girder superstructure Cd = 1.3 (Table 3.8.1.2.1-2), G = 1.0 (Table 3.8.1.2.1-1). */
export function windPressure(combination: "Strength III" | "Strength V" | "Service I", w: Pick<SiteWind, "V" | "exposure" | "Z">) {
  const V = combination === "Strength III" ? w.V : combination === "Strength V" ? 80 : 70; // Table 3.8.1.1.2-1
  const Kz = combination === "Strength III" ? windKz(w.Z, w.exposure) : 1.0;
  return { V, Kz, G: 1.0, Cd: 1.3, PZ: 2.56e-6 * V * V * Kz * 1.0 * 1.3 };
}

/** The superstructure's wind: depth seen in elevation, the line loads by combination, the heights they act at above the bearings. */
export function superstructureWind(design: GirderInputs, site: SiteWind) {
  const i = spanInputs(design, 0);
  const shape = girderShape(i);
  const h = profileProps(shape.profile).h / 12; // girder depth, ft
  const deckTop = h + i.haunch / 12 + i.deckT / 12; // ft above the bearings (the girders' bottom)
  const depth = deckTop + site.barrierHeight; // girders, haunch, deck and barrier, as seen in elevation (3.8.1.2.3a)
  const by = (c: "Strength III" | "Strength V" | "Service I") => {
    const p = windPressure(c, site);
    return { ...p, line: p.PZ * depth };
  };
  return {
    girderDepth: h,
    deckTop,
    depth,
    arm: depth / 2, // the line load at the superstructure's mid-depth (3.8.1.2.3a)
    armWL: deckTop + 6, // WL 6.0 ft above the roadway (3.8.1.3)
    WL: 0.1, // klf, transverse (3.8.1.3)
    vertical: 0.02, // ksf on the deck's width, Strength III only (3.8.2)
    deckWidth: (i.nGirders - 1) * i.S + 2 * i.overhang,
    strengthIII: site.V > 0 ? by("Strength III") : null,
    strengthV: by("Strength V"),
    serviceI: by("Service I"),
  };
}

/** The braking force per loaded lane (3.6.4): the greater of 25% of the design truck's or tandem's axles and 5% of the truck or tandem with the lane load on the bridge's length. */
export function brakingPerLane(bridgeLength: number) {
  const axles = Math.max(0.25 * 72, 0.25 * 50);
  const withLane = Math.max(0.05 * (72 + 0.64 * bridgeLength), 0.05 * (50 + 0.64 * bridgeLength));
  return { perLane: Math.max(axles, withLane), governs: axles >= withLane ? "25% of the design truck's axles" : "5% of the design truck with the lane load" };
}

/** A design's spans as its continuous beam models them (pier centerline to centerline, bearings `off` either side). */
export function continuousSpans(design: GirderInputs) {
  const Ls = [design.L, ...design.extraSpans.map((s) => s.L)];
  const off = Math.max(0, design.pierBearingOffset ?? 0);
  const n = Ls.length;
  const shift = Ls.map((_, k) => (k > 0 ? off : 0));
  const La = Ls.map((L, k) => L + shift[k] + (k < n - 1 ? off : 0));
  return { Ls, La, off, shift, n };
}

/** A unit uniform load's shear at the bearing where span `span` meets pier `end` ("start" or "end" of the span), on the continuous beam: the span's share of the pier's reaction per klf. */
export function continuousEndShear(design: GirderInputs, span: number, end: "start" | "end") {
  const { Ls, La, shift } = continuousSpans(design);
  const beam = continuousBeam(La);
  const sup = beam.uniformAll(0, 0).supports;
  const X = (end === "start" ? 0 : Ls[span]) + shift[span];
  const L = La[span];
  const V = L / 2 - X + (sup[span + 1] - sup[span]) / L;
  return Math.abs(V);
}

const TRUCK = [8, 32, 32];
const TANDEM = [25, 25];
const LANE = 0.64;

/**
 * One lane's reaction at an interior pier of a continuous girder line (per lane, before the multiple
 * presence factor): the truck or tandem (with IM) and the lane load, each split into what reaches the
 * pier through the back span's end and the ahead span's end. 90% of two trucks with 90% of the lane
 * load is also tried (3.6.1.3.1).
 */
export function continuousLaneReaction(design: GirderInputs, pier: number, IM = 0.33) {
  const { La, off, n } = continuousSpans(design);
  if (!(pier > 0 && pier < n)) throw new DesignError("That isn't an interior pier of the girder design.");
  const beam = continuousBeam(La);
  const back = beam.influence(pier - 1, La[pier - 1] - off, "V");
  const ahead = beam.influence(pier, off, "V");
  const ilBack = (X: number) => -back(X, 1);
  const ilAhead = (X: number) => ahead(X, -1);
  const total = La.reduce((s, L) => s + L, 0);
  const step = 0.5;
  const grid: number[] = [];
  for (let p = -80; p <= total + 80; p += step) grid.push(p);
  const best = (axles: { P: number; d: number }[]) => {
    let top = { R: 0, back: 0, ahead: 0 };
    for (const p of grid)
      for (const dir of [1, -1]) {
        let b = 0;
        let a = 0;
        for (const ax of axles) {
          const X = p + dir * ax.d;
          if (X < 0 || X > total) continue;
          b += ax.P * ilBack(X);
          a += ax.P * ilAhead(X);
        }
        if (b + a > top.R + 1e-12) top = { R: b + a, back: b, ahead: a };
      }
    return top;
  };
  const trucks = [14, 16, 18, 20, 22, 24, 26, 28, 30].map((rear) => best(TRUCK.map((P, k) => ({ P, d: k === 0 ? 0 : k === 1 ? 14 : 14 + rear }))));
  const truck = trucks.reduce((p, q) => (q.R > p.R ? q : p));
  const tandem = best(TANDEM.map((P, k) => ({ P, d: 4 * k })));
  const one = truck.R >= tandem.R ? truck : tandem;
  // The lane load where the total influence line is positive, split by the two ends' lines there.
  let lb = 0;
  let la = 0;
  const dX = total / 2000;
  for (let q = 0; q < 2000; q++) {
    const X = (q + 0.5) * dX;
    const b = ilBack(X);
    const a = ilAhead(X);
    if (a + b > 0) {
      lb += LANE * b * dX;
      la += LANE * a * dX;
    }
  }
  // Two trucks (14 ft rear axles), their gap 50 ft or more, 90% with 90% of the lane load (3.6.1.3.1).
  let pair = { R: 0, back: 0, ahead: 0 };
  for (let gap = 50; gap <= Math.min(total, 250); gap += 5) {
    const r = best([...TRUCK.map((P, k) => ({ P, d: 14 * k })), ...TRUCK.map((P, k) => ({ P, d: 28 + gap + 14 * k }))]);
    if (r.R > pair.R) pair = r;
  }
  const single = { truck: { back: one.back * (1 + IM), ahead: one.ahead * (1 + IM) }, lane: { back: lb, ahead: la }, kind: one === tandem ? "design tandem" : "design truck" };
  const twoTotal = 0.9 * (pair.R * (1 + IM) + lb + la);
  if (twoTotal <= one.R * (1 + IM) + lb + la) return single;
  return { truck: { back: 0.9 * pair.back * (1 + IM), ahead: 0.9 * pair.ahead * (1 + IM) }, lane: { back: 0.9 * lb, ahead: 0.9 * la }, kind: "two design trucks at 90%" };
}
