import { classBLap, ftIn, hookLeg, roundDown, splitRun } from "./bars";
import { shapeLength, type BarGroup, type BarShape } from "./schedule";

// Runs of bars for a schedule, any design: a bar of a given straight length (or segments) with an
// optional standard hook at each end, cut at stock lengths and lapped with Class B splices (no laps
// above #11: mechanical splices), each piece a schedule group. CDOT Bridge Detail Manual 4.7 for
// the stock lengths and laps, AASHTO 5.10.2.1 for the hooks, 5.10.8.4.3a for the laps.

export type PreGroup = Omit<BarGroup, "mark">;

export type RunOptions = {
  size: number;
  count: number; // bars in the run
  straight: number | number[]; // in, the bar's straight length (or its segments, bent)
  hooks?: [boolean, boolean] | [number, number]; // a standard 90° hook (or a leg of this length, in) at each end
  use: string;
  callout: string;
  where?: string;
  lap?: { fy: number; fc: number; clearCover: number; clearSpacing: number; horizontal?: boolean; concreteBelow?: number; coating?: "uncoated" | "epoxy" };
};

/** The groups a run of bars gives: one, or end pieces and middle pieces when it's spliced. */
export function runGroups(o: RunOptions): { groups: PreGroup[]; pieces: number; lap: number } {
  const segs = Array.isArray(o.straight) ? o.straight : [o.straight];
  const legOf = (h: boolean | number | undefined) => (typeof h === "number" ? h : h ? hookLeg(o.size).leg : 0);
  const legs: [number, number] = [legOf(o.hooks?.[0]), legOf(o.hooks?.[1])];
  const straight = segs.reduce((s, x) => s + x, 0);
  const lap = o.lap ? classBLap(o.size, { ...o.lap, horizontal: o.lap.horizontal ?? true, concreteBelow: o.lap.concreteBelow ?? 0, coating: o.lap.coating ?? "uncoated" }) : null;
  const sp = splitRun(o.size, straight + legs[0] + legs[1], lap ?? (o.size > 11 ? null : 0));
  const hooks = (legs[0] > 0 ? 1 : 0) + (legs[1] > 0 ? 1 : 0);
  const splice = sp.splices ? `${sp.pieces} pieces per bar, ${sp.mechanical ? "mechanical splices" : `Class B laps of ${ftIn(roundDown(sp.lap))}`}, staggered` : undefined;
  const add = (shape: BarShape, count: number, where?: string): PreGroup => ({ size: o.size, count, shape, length: shapeLength(shape), use: o.use, callout: o.callout, where: where ?? o.where, splice });
  if (sp.pieces === 1) {
    const shape: BarShape =
      segs.length > 1
        ? { kind: "bent", dims: [legs[0], ...segs, legs[1]].filter((d) => d > 0).map(roundDown), hooks: hooks as 0 | 1 | 2 }
        : hooks === 0
          ? { kind: "straight", dims: [roundDown(straight)] }
          : { kind: "hooked", dims: (hooks === 1 ? [Math.max(legs[0], legs[1]), straight] : [legs[0], straight, legs[1]]).map(roundDown), hooks: hooks as 1 | 2 }; // the hook's leg (G) first
    return { groups: [add(shape, o.count)], pieces: 1, lap: 0 };
  }
  const piece = roundDown(sp.piece);
  const groups: PreGroup[] = [];
  for (const leg of legs) groups.push(add(leg > 0 ? { kind: "hooked", dims: [roundDown(leg), roundDown(piece - leg)], hooks: 1 } : { kind: "straight", dims: [piece] }, o.count, "end pieces"));
  if (sp.pieces > 2) groups.push(add({ kind: "straight", dims: [piece] }, o.count * (sp.pieces - 2), "middle pieces"));
  return { groups, pieces: sp.pieces, lap: sp.lap };
}

/** Bars at a spacing over a length: how many (both ends included). */
export const countAt = (length: number, spacing: number) => (length > 0 && spacing > 0 ? Math.floor(length / spacing + 1e-9) + 1 : 0);
