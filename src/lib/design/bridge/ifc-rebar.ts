import type { ApproachSlabInputs } from "../approach/approach-slab";
import { approachSlabTakeoff } from "../approach/approach-slab-detail";
import { deckTakeoff } from "../takeoff/tools";
import type { DeckInputs } from "../decks/deck";
import type { AbutmentInputs } from "../foundations/abutment";
import { abutmentTakeoff, footingTakeoff, pileTakeoff, shaftTakeoff } from "../foundations/detail";
import type { FootingInputs } from "../foundations/footing";
import type { PileInputs } from "../foundations/piles";
import type { ShaftInputs } from "../foundations/shaft";
import type { ColumnInputs } from "../piers/column";
import { columnTakeoff } from "../piers/column-detail";
import { ftIn } from "../rebar/bars";
import { groupWeight, type BarGroup, type Schedule } from "../rebar/schedule";
import { detailCap } from "../stm/detail";
import type { StmInputs } from "../stm/strut-tie";
import type { BridgeComponents, IfcElement, V3 } from "./ifc";

// The Bridge's reinforcing bars in its IFC model: each linked design's bar schedule (the same one its
// take-off and the Bridge's quantities use) on the concrete elements it details. Each bar group, a
// mark, becomes one IfcReinforcingBar (a set of `count` identical bars), aggregated into its host,
// with its size, bending shape and dimensions, length and weight (api/_bridge.py writes it).
//
// The bars' shapes are exact; where they sit is schematic. The design tools detail bars in sections,
// not in 3D, so each set is laid out inside its host's box: bars along the host's longest side and
// spread across the next, stirrups and hoops around the long side and spread along it, 2 in cover,
// top and bottom mats apart. Good enough to see and count; not a clash model.

export type IfcBarRole = "MAIN" | "SHEAR" | "LIGATURE" | "RING" | "ANCHORING";
export type IfcBarSet = {
  mark: string;
  size: number; // #
  diameter: number; // in, nominal
  area: number; // in², one bar
  count: number;
  length: number; // in, each bar
  weight: number; // lb, the set
  shape: string; // the bending shape: straight, hooked, bent, closed, dowel
  dims: number[]; // in, out to out, A, B, C… as the schedule lists them
  role: IfcBarRole;
  use: string;
  callout: string;
  /** The bar's centreline (ft) in its own plane: x along u, y along v. */
  path: [number, number][];
  /** Where the bars sit (schematic): the first bar's frame, the step to the next, how many are drawn. */
  at: { origin: V3; u: V3; v: V3; step: V3; drawn: number };
};
export type IfcRebar = { designId: string; designKind: string; bars: IfcBarSet[] };

/** A box an element's bars are laid out in: its center, axes (unit) and half sizes (ft). */
export type RebarBox = { c: V3; ax: [V3, V3, V3]; half: [number, number, number] };

/** ASTM A615 nominal diameters (in) and areas (in²) by bar size. */
const BAR: Record<number, [number, number]> = { 3: [0.375, 0.11], 4: [0.5, 0.2], 5: [0.625, 0.31], 6: [0.75, 0.44], 7: [0.875, 0.6], 8: [1.0, 0.79], 9: [1.128, 1.0], 10: [1.27, 1.27], 11: [1.41, 1.56], 14: [1.693, 2.25], 18: [2.257, 4.0] };
export const barDiameter = (size: number) => BAR[size]?.[0] ?? size / 8;
export const barArea = (size: number) => BAR[size]?.[1] ?? (Math.PI / 4) * (size / 8) ** 2;

/** How many bars of a set are drawn at most (the quantities always count them all). */
export const MAX_DRAWN = 400;
const COVER = 2 / 12; // ft

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => mul(a, 1 / Math.hypot(...a));
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const v3 = (a: V3): V3 => [r6(a[0]), r6(a[1]), r6(a[2])];

/** The box an element's concrete fills: its profile's extent in its placement's frame, swept its depth; a deck carries its own. */
export function elementBox(e: IfcElement & { box?: RebarBox }): RebarBox | null {
  if (e.box) return e.box;
  const z = unit(e.zdir);
  const x = unit(sub(e.xdir, mul(z, dot(e.xdir, z))));
  const y = cross(z, x);
  const p = e.profile;
  const [x0, x1, y0, y1] =
    p.kind === "rect" ? [-p.x / 2, p.x / 2, -p.y / 2, p.y / 2]
    : p.kind === "circle" ? [-p.r, p.r, -p.r, p.r]
    : p.kind === "ishape" ? [-p.width / 2, p.width / 2, -p.depth / 2, p.depth / 2]
    : p.kind === "poly" ? [Math.min(...p.pts.map((q) => q[0])), Math.max(...p.pts.map((q) => q[0])), Math.min(...p.pts.map((q) => q[1])), Math.max(...p.pts.map((q) => q[1]))]
    : [NaN, NaN, NaN, NaN];
  if (!Number.isFinite(x0)) return null;
  const c = add(add(e.origin, mul(x, (x0 + x1) / 2)), add(mul(y, (y0 + y1) / 2), mul(z, e.depth / 2)));
  return { c, ax: [x, y, z], half: [(x1 - x0) / 2, (y1 - y0) / 2, e.depth / 2] };
}

/** The bar's centreline (ft) in its plane, from its bending shape: the main leg along x, hooks and legs along y. */
export function barPath(g: BarGroup): [number, number][] {
  const s = g.shape;
  const d = s.dims.map((v) => v / 12);
  switch (s.kind) {
    case "straight":
      return [[0, 0], [d[0], 0]];
    case "hooked":
      return d.length >= 3 ? [[0, d[0]], [0, 0], [d[1], 0], [d[1], d[2]]] : [[0, d[0]], [0, 0], [d[1], 0]];
    case "dowel":
      return [[0, 0], [d[0], 0], [d[0], d[1]]];
    case "closed": {
      // Stops short of closing by two bar diameters, where its hooks lap (a swept disk can't meet itself).
      const gap = Math.min(d[1] / 2, (2 * (BAR[g.size]?.[0] ?? g.size / 8)) / 12);
      return [[0, 0], [d[0], 0], [d[0], d[1]], [0, d[1]], [0, gap]];
    }
    case "bent": {
      // Segments that follow the concrete, their angles not kept: drawn end to end along x.
      const pts: [number, number][] = [[0, 0]];
      for (const v of d) pts.push([pts[pts.length - 1][0] + v, 0]);
      return pts;
    }
  }
}

function roleOf(g: BarGroup): IfcBarRole {
  const t = `${g.use} ${g.where ?? ""}`.toLowerCase();
  if (/spiral/.test(t)) return "RING";
  if (/stirrup/.test(t)) return "SHEAR";
  if (g.shape.kind === "closed" || /hoop|tie/.test(t)) return "LIGATURE";
  if (/dowel|anchor/.test(t) || g.shape.kind === "dowel") return "ANCHORING";
  return "MAIN";
}

/** A bar group laid out (schematically) in a box: see the note at the top. `k` is its order on the host, for alternating mats. */
export function layBars(g: BarGroup, box: RebarBox, k = 0): IfcBarSet {
  const order = [0, 1, 2].sort((a, b) => box.half[b] - box.half[a]);
  const [a1, a2, a3] = order.map((i) => box.ax[i]);
  const [h1, h2, h3] = order.map((i) => Math.max(0, box.half[i] - COVER));
  const path = barPath(g);
  const drawn = Math.max(1, Math.min(g.count, MAX_DRAWN));
  const spread = (h: number) => (drawn > 1 ? (2 * h) / (drawn - 1) : 0);
  let origin: V3;
  let u: V3;
  let v: V3;
  let step: V3;
  if (g.shape.kind === "closed") {
    // Around the long side, spread along it.
    // Its longer leg along the section's longer side.
    const [w, ht] = [path[1][0], path[2][1]];
    [u, v] = w >= ht === h2 >= h3 ? [a2, a3] : [a3, a2];
    origin = add(box.c, add(mul(a1, drawn > 1 ? -h1 : 0), add(mul(u, -w / 2), mul(v, -ht / 2))));
    step = mul(a1, spread(h1));
  } else {
    // Along the long side, spread across the next; top and bottom mats apart, hooks turned into the concrete.
    const text = `${g.use} ${g.where ?? ""}`.toLowerCase();
    const top = /\btop\b/.test(text) ? true : /\bbot(tom)?\b/.test(text) ? false : k % 2 === 1;
    const lengthAlong = Math.max(...path.map((p) => p[0]));
    u = a1;
    v = top ? mul(a3, -1) : a3;
    origin = add(box.c, add(mul(a1, -Math.min(h1, lengthAlong / 2)), add(mul(a2, drawn > 1 ? -h2 : 0), mul(a3, top ? h3 : -h3))));
    step = mul(a2, spread(h2));
  }
  return {
    mark: g.mark,
    size: g.size,
    diameter: barDiameter(g.size),
    area: barArea(g.size),
    count: g.count,
    length: g.length,
    weight: Math.round(groupWeight(g) * 10) / 10,
    shape: g.shape.kind,
    dims: [...g.shape.dims],
    role: roleOf(g),
    use: g.use,
    callout: g.callout,
    path: path.map(([x, y]) => [r6(x), r6(y)] as [number, number]),
    at: { origin: v3(origin), u: v3(u), v: v3(v), step: v3(step), drawn },
  };
}

/** What a bar set says in the schedule: "#5 × 24, 9'-6" each, 238 lb (straight)". */
export const barLine = (b: IfcBarSet) => `#${b.size} × ${b.count}, ${ftIn(b.length)} each, ${b.weight} lb (${b.shape}${b.dims.length > 1 ? ` ${b.dims.map((d) => ftIn(d)).join(" + ")}` : ""})`;

/** Where a design's bars come from, for the elements it details. */
export type RebarSource = {
  designId: string;
  designKind: string;
  /** "element": every host gets the whole schedule (one per column, footing…); "support": the schedule is shared out over the design's hosts at each support (an abutment's footing, stem, cap…). */
  per: "element" | "support";
  schedule: (host: IfcElement & { box?: RebarBox }) => Schedule | null;
};

const CONCRETE = /oncrete/;
const HOST_WORDS = ["footing", "stem", "backwall", "diaphragm", "cap", "shaft", "column", "slab", "deck"];

/** Which of a support's hosts a bar group goes in: one its use names, else the biggest. */
function hostFor(g: BarGroup, hosts: (IfcElement & { box?: RebarBox })[]) {
  const text = `${g.use} ${g.where ?? ""} ${g.callout}`.toLowerCase();
  for (const w of HOST_WORDS) {
    if (!text.includes(w)) continue;
    const h = hosts.find((e) => e.name.toLowerCase().includes(w));
    if (h) return h;
  }
  const vol = (e: IfcElement & { box?: RebarBox }) => {
    const b = elementBox(e);
    return b ? b.half[0] * b.half[1] * b.half[2] : 0;
  };
  return hosts.reduce((p, q) => (vol(q) > vol(p) ? q : p));
}

/** The description with each design's bars on the concrete elements it details (the elements are changed in place and returned). */
export function attachRebar<T extends { elements: IfcElement[] }>(desc: T, sources: RebarSource[]): T {
  for (const src of sources) {
    const hosts = desc.elements.filter((e) => e.psets.ALLCON_Design?.DesignId === src.designId && CONCRETE.test(e.material));
    if (!hosts.length) continue;
    const put = (host: IfcElement, groups: BarGroup[]) => {
      const box = elementBox(host);
      if (!box || !groups.length) return;
      const bars = groups.map((g, k) => layBars(g, box, k));
      host.rebar = { designId: src.designId, designKind: src.designKind, bars: [...(host.rebar?.bars ?? []), ...bars] };
    };
    const live = (s: Schedule | null) => (s?.groups ?? []).filter((g) => g.count > 0 && g.length > 0 && !g.paid);
    if (src.per === "element") {
      for (const h of hosts) put(h, live(src.schedule(h)));
      continue;
    }
    const byPart = new Map<string, IfcElement[]>();
    for (const h of hosts) byPart.set(h.part, [...(byPart.get(h.part) ?? []), h]);
    for (const group of byPart.values()) {
      const groups = live(src.schedule(group[0]));
      const into = new Map<IfcElement, BarGroup[]>();
      for (const g of groups) {
        const h = hostFor(g, group);
        into.set(h, [...(into.get(h) ?? []), g]);
      }
      for (const [h, gs] of into) put(h, gs);
    }
  }
  return desc;
}

/** The designs a Bridge links, with their inputs, for its bars (what BridgeComponents doesn't already carry). */
export type RebarDesigns = {
  deck?: { id: string; inputs: DeckInputs } | null;
  caps?: Record<number, { id: string; inputs: StmInputs } | undefined>;
  columns?: Record<number, { id: string; inputs: ColumnInputs } | undefined>;
};

const once = <T,>(f: () => T): (() => T | null) => {
  let done = false;
  let v: T | null = null;
  return () => {
    if (!done) {
      done = true;
      try {
        v = f();
      } catch (e) {
        console.error("A design's bar schedule couldn't be worked out for the IFC model", e);
        v = null;
      }
    }
    return v;
  };
};

/** Each linked design's bar schedule, for attachRebar: one take-off per element it details (a deck span its own length). */
export function rebarSources(c: BridgeComponents, d: RebarDesigns): RebarSource[] {
  const out: RebarSource[] = [];
  const seen = new Set<string>();
  const push = (s: RebarSource) => {
    if (seen.has(s.designId)) return;
    seen.add(s.designId);
    out.push(s);
  };
  for (const a of Object.values(c.abutments ?? {})) if (a?.id && a.inputs) { const s = once(() => abutmentTakeoff(a.inputs as AbutmentInputs).schedule); push({ designId: a.id, designKind: "abutment", per: "support", schedule: s }); }
  for (const a of Object.values(c.approachSlabs ?? {})) if (a?.id && a.inputs) { const s = once(() => approachSlabTakeoff(a.inputs as ApproachSlabInputs, 1).schedule); push({ designId: a.id, designKind: "approach-slab", per: "element", schedule: s }); }
  for (const f of Object.values(c.foundations ?? {})) {
    if (!f?.id || !f.inputs) continue;
    const i = f.inputs;
    const s = once(() => (f.kind === "spread-footing" ? footingTakeoff(i as FootingInputs) : f.kind === "pile-foundation" ? pileTakeoff(i as PileInputs) : shaftTakeoff(i as ShaftInputs)).schedule);
    push({ designId: f.id, designKind: f.kind, per: "element", schedule: s });
  }
  for (const k of Object.values(d.caps ?? {})) if (k) { const s = once(() => (k.inputs.template ? detailCap(k.inputs).schedule : null)); push({ designId: k.id, designKind: "stm-d-region", per: "element", schedule: s }); }
  for (const k of Object.values(d.columns ?? {})) if (k) { const s = once(() => columnTakeoff(k.inputs, 1).schedule); push({ designId: k.id, designKind: "pier-column", per: "element", schedule: s }); }
  if (d.deck) {
    const deck = d.deck;
    // Each span's deck its own length (the box's long side).
    push({ designId: deck.id, designKind: "deck-slab", per: "element", schedule: (h) => { const b = elementBox(h); return b ? deckTakeoff(deck.inputs, 2 * Math.max(...b.half)).schedule : null; } });
  }
  return out;
}

/** Per host: its bars' count, total length (ft) and weight (lb). */
export function rebarTotals(r: IfcRebar | undefined) {
  const bars = r?.bars ?? [];
  return { count: bars.reduce((s, b) => s + b.count, 0), length: bars.reduce((s, b) => s + (b.count * b.length) / 12, 0), weight: bars.reduce((s, b) => s + b.weight, 0) };
}

