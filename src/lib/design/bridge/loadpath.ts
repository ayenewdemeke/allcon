import { type AbutmentInputs } from "../foundations/abutment";
import { type FootingInputs } from "../foundations/footing";
import { type PileInputs } from "../foundations/piles";
import { type ShaftInputs } from "../foundations/shaft";
import { brakingPerLane } from "../girders/substructure-loads";
import { girderSide } from "../stm/cap-loads";
import type { StmInputs } from "../stm/strut-tie";
import { bearingsFromLink, buildTemplate, HAMMERHEAD_DEFAULTS, MULTICOLUMN_DEFAULTS, type StmTemplate } from "../stm/templates";
import type { ColumnInputs, ColumnLink } from "../piers/column";
import type { ApproachSlabInputs } from "../approach/approach-slab";
import type { WingwallInputs } from "../walls/wingwall";
import type { ColumnResult } from "../piers/column";
import { GIRDER_DEFAULTS, girderShape, type GirderInputs } from "../girders/prestressed";
import type { DeckInputs } from "../decks/deck";
import type { BearingInputs } from "../bearings/elastomeric";
import { spacingAt, spanGroups, type BridgeInputs, type BridgeRun, type PierShape } from "./bridge";

// The load path from a Bridge run down through its linked designs (docs/bridge-model.md): each
// function takes a component's inputs as saved and returns them with what the Bridge decides (its
// layout and loads), the component's own details (bars, strands, soils, sections) kept as they are.
//
// - Girders: the Bridge's layout on each group of spans (girderInputsFor).
// - Abutments: the bridge's data the abutment tool takes (CDOT BDM 11.3): the unit's length, grade,
//   skew, curvature, girders, the reactions per girder (LL without IM: the tool adds IM in the cap
//   and not the foundation), braking (AASHTO 3.6.4, all lanes with the multiple presence factor,
//   shared by the bridge's two abutments), the abutment's length along its skew.
// - Pier caps: their girder link (back and ahead spans) from the girder designs, as the strut-and-tie
//   tool's own link copies it.
// - Foundations: load cases at the column's base (footing, pile cap or shaft), from the column design.

/** AASHTO Table 3.6.1.1.2-1. */
export const multiplePresence = (lanes: number) => (lanes <= 1 ? 1.2 : lanes === 2 ? 1.0 : lanes === 3 ? 0.85 : 0.65);

/** Design lanes on the bridge's clear roadway (3.6.1.1.1): whole 12 ft lanes. */
export const designLanes = (b: BridgeInputs) => Math.max(1, Math.floor((b.leftEdge + b.rightEdge - 2 * b.barrierWidth) / 12));

/** The unit of the bridge an abutment belongs to: from it to the nearest support that isn't continuous or integral (an expansion joint), ft. */
export function unitLength(b: BridgeInputs, support: number) {
  const s = b.supports;
  const step = support === 0 ? 1 : -1;
  let j = support + step;
  while (j > 0 && j < s.length - 1 && s[j].type === "continuous-pier") j += step;
  return Math.abs(s[j].station - s[support].station);
}

export function abutmentFromBridge(b: BridgeInputs, run: BridgeRun, support: number, current: AbutmentInputs): AbutmentInputs {
  const s = b.supports[support];
  const lay = run.layout.supports[support];
  const r = run.reactions[support];
  const type: AbutmentInputs["type"] = s.type === "integral-abutment" ? (current.type === "integral-shafts" ? "integral-shafts" : "integral-piles") : s.type === "semi-integral-abutment" ? "semi-integral" : "seat";
  const lanes = designLanes(b);
  const L = unitLength(b, support);
  const braking = brakingPerLane(L).perLane * lanes * multiplePresence(lanes);
  const width = b.leftEdge + b.rightEdge;
  return {
    ...current,
    type,
    unitLength: Math.round(L * 1000) / 1000,
    grade: Math.round(Math.abs(lay.grade) * 100 * 1000) / 1000,
    skew: Math.abs(s.skew),
    curvature: Number.isFinite(lay.R) ? Math.round((5729.578 / lay.R) * 1000) / 1000 : 0,
    nGirders: b.nGirders,
    girderSpacing: spacingAt(b, s),
    RDC: Math.round(r.DC * 10) / 10,
    RDW: Math.round(r.DW * 10) / 10,
    RLL: Math.round(r.LL * 10) / 10,
    IM: 0.33,
    braking: Math.round((braking / 2) * 10) / 10,
    length: Math.round((width / Math.cos((s.skew * Math.PI) / 180)) * 100) / 100,
  };
}

/** A standard pier cap's template from the Bridge's pier: its length, depth, width and columns (the cap's own bars and details kept). */
export function capTemplate(p: PierShape, xs: number[], current: StmTemplate | null): StmTemplate {
  const base = current && current.kind === p.kind ? current : p.kind === "hammerhead" ? HAMMERHEAD_DEFAULTS : MULTICOLUMN_DEFAULTS;
  return {
    ...base,
    kind: p.kind,
    length: p.capLength,
    depth: p.capDepth,
    tipDepth: p.kind === "hammerhead" ? Math.min(p.capDepth, base.tipDepth * (p.capDepth / base.depth)) : p.capDepth,
    capWidth: p.capWidth,
    columns: p.kind === "hammerhead" ? [p.capLength / 2] : xs,
    columnWidth: (p.columnShape === "round" ? p.columnSize : p.columnSize) / 12,
  };
}

/** A pier cap's girder link from the girder designs either side (span ending at the pier, span starting there). */
export function capFromBridge(b: BridgeInputs, run: BridgeRun, support: number, current: StmInputs, girderIds: (string | null)[], names: string[]): StmInputs {
  const shape = b.supports[support].pier;
  const lp = run.layout.piers[support];
  if (shape && lp) current = { ...current, template: capTemplate(shape, lp.columnsX, current.template ?? null) };
  // Girders made continuous over the pier by a cast-in-place diaphragm: the cap is built in two stages, the
  // diaphragm from the cap's top (the lowest seat) to the deck's top over the cap.
  if (b.supports[support].type === "continuous-pier" && lp) {
    const deckTop = Math.max(...[...(support > 0 ? run.layout.spans[support - 1].girders.map((g) => g.end.deck) : []), ...(support < run.layout.spans.length ? run.layout.spans[support].girders.map((g) => g.start.deck) : [])]);
    const h = Math.round((deckTop - lp.capTop) * 100) / 100;
    current = { ...current, stages: { enabled: current.stages?.enabled ?? true, diaphragmHeight: h, topBars: current.stages?.topBars ?? null } };
  }
  const groups = spanGroups(b);
  const sideOf = (span: number, end: "start" | "end") => {
    const gi = groups.findIndex((g) => g.includes(span));
    const id = girderIds[gi];
    if (!id) return null;
    const g = run.groups[gi];
    return girderSide(g.inputs as GirderInputs, g.spans.indexOf(span), id, names[gi] ?? "Girders", end);
  };
  const t = current.template;
  const link = current.girders ?? { enabled: true, back: null, ahead: null, x0: t ? t.length / 2 : 0, reverse: false, loadNodes: [], selfWeight: true, soffit: 0, wc: 0.15 };
  const next = { ...link, enabled: true, back: sideOf(support - 1, "end"), ahead: sideOf(support, "start") };
  // A cap built from a standard pier cap: its bearings rebuilt where the Bridge's girders sit, and the
  // model with them (the strut-and-tie tool's own "build from the girders").
  if (t && t.kind !== "abutment") {
    const xs = bearingsFromLink(next);
    const tpl = { ...t, bearings: xs.map((x, k) => ({ x, P: t.bearings[k]?.P ?? 0 })) };
    return buildTemplate(tpl, { ...current, girders: next });
  }
  return { ...current, girders: next };
}

/** The pier column from the Bridge's pier: its section, its height from the cap's soffit to the foundation's top, its loads from the cap. */
export function columnFromBridge(b: BridgeInputs, run: BridgeRun, support: number, current: ColumnInputs, link: ColumnLink): ColumnInputs {
  const p = b.supports[support].pier;
  const lp = run.layout.piers[support];
  if (!p || !lp) return { ...current, loads: "stm", link };
  return {
    ...current,
    shape: p.columnShape,
    T: p.columnSize,
    W: p.columnShape === "round" ? p.columnSize : p.columnDepth,
    height: Math.round(lp.columnHeight * 100) / 100,
    ground: Math.min(current.ground, Math.max(0, lp.columnHeight - 1)),
    capDepth: p.capDepth,
    base: p.foundation === "drilled-shaft" ? "shaft" : "footing",
    shaftD: p.foundation === "drilled-shaft" ? Math.max(current.shaftD, p.columnSize) : current.shaftD,
    loads: "stm",
    link,
  };
}

/** The approach slab at an abutment: the deck's width and the roadway between the barriers, the abutment's skew. */
export function approachSlabFromBridge(b: BridgeInputs, support: number, current: ApproachSlabInputs): ApproachSlabInputs {
  const width = b.leftEdge + b.rightEdge;
  return { ...current, W: width, roadway: width - 2 * b.barrierWidth, skew: Math.abs(b.supports[support].skew) };
}

/** A wingwall off an abutment: its height at the abutment face (the abutment's depth), the abutment's width square to it, the skew and the backfill. */
export function wingwallFromBridge(b: BridgeInputs, support: number, abutment: AbutmentInputs, current: WingwallInputs): WingwallInputs {
  const integral = abutment.type.startsWith("integral");
  return {
    ...current,
    H: integral ? abutment.totalDepth : abutment.stemH + abutment.backwallH,
    A: integral ? abutment.capWidth : abutment.stemT,
    skew: Math.abs(b.supports[support].skew),
    phi: abutment.backfillPhi,
    gammaS: abutment.backfillGamma / 1000,
  };
}

/** Load cases at a column's base for its foundation: each factored case's largest column (P, the moments and shears both ways). */
export function baseCases(col: ColumnResult) {
  const base = col.rows.filter((r) => r.where === "base");
  const byCase = new Map<string, (typeof base)[number]>();
  for (const r of base) {
    const prev = byCase.get(r.case);
    if (!prev || r.P > prev.P) byCase.set(r.case, r);
  }
  return [...byCase.values()].map((r) => ({ name: r.case, limit: (/service/i.test(r.limit) ? "service" : /extreme/i.test(r.limit) ? "extreme" : "strength") as "strength" | "service" | "extreme", P: r.P, MT: r.MT, ML: r.ML, VT: r.VT, VL: r.VL }));
}

const round = (v: number) => Math.round(v * 10) / 10;

export function footingFromColumn(col: ColumnResult, current: FootingInputs): FootingInputs {
  // B across the bridge (the column's T), L along it.
  return { ...current, cases: baseCases(col).map((c) => ({ name: c.name, limit: c.limit, P: round(c.P), MB: round(Math.abs(c.MT)), ML: round(Math.abs(c.ML)), HB: round(Math.abs(c.VT)), HL: round(Math.abs(c.VL)) })) };
}

export function pilesFromColumn(col: ColumnResult, current: PileInputs): PileInputs {
  return { ...current, cases: baseCases(col).map((c) => ({ name: c.name, limit: c.limit, P: round(c.P), MB: round(Math.abs(c.MT)), ML: round(Math.abs(c.ML)), HB: round(Math.abs(c.VT)), HL: round(Math.abs(c.VL)) })) };
}

export function shaftFromColumn(col: ColumnResult, current: ShaftInputs): ShaftInputs {
  return { ...current, cases: baseCases(col).map((c) => ({ name: c.name, limit: c.limit, P: round(c.P), M: round(Math.hypot(c.MT, c.ML)), H: round(Math.hypot(c.VT, c.VL)), uplift: 0 })) };
}

/** What changed between a component's inputs and the Bridge's: the top-level keys whose values differ. */
export function changedKeys(before: object, after: object) {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  return Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/**
 * The deck slab from the Bridge: the girders and their widest spacing, the overhang to the deck's edge,
 * the deck's thickness and concrete, the top flange's width, the rail, and the future wearing surface.
 * Tied to the girder design, which carries the deck's concrete and the rail in its quantities.
 */
export function deckFromBridge(b: BridgeInputs, run: BridgeRun, current: DeckInputs, girder: { id: string; name: string } | null): DeckInputs {
  const shape = girderShape({ ...GIRDER_DEFAULTS, shape: b.shape });
  const S = Math.max(...b.supports.map((s) => spacingAt(b, s)));
  const t = b.deckT;
  return {
    ...current,
    nGirders: b.nGirders,
    S,
    overhang: Math.round(run.layout.overhang * 1000) / 1000,
    t,
    tEdge: Math.max(current.tEdge, t),
    tFlange: Math.max(current.tFlange, t),
    flange: shape.topWidth,
    fc: b.fcDeck,
    barrierWidth: b.barrierWidth * 12,
    wearing: Math.round(((b.fws / 1000 / current.gammaWS) * 12) * 1000) / 1000,
    ...(b.rail ? { rail: b.rail } : {}),
    fromGirder: girder,
  };
}

/**
 * A support's bearing pads: each girder's service loads there and the movement it takes.
 * - Where the girders are cast into a diaphragm (an integral abutment, a continuous pier) the pads are leveling
 *   pads: they carry the girder, deck and diaphragms until the diaphragm is cast (DC1), then the diaphragm
 *   carries the bridge; no live load, and no movement (the girder moves with the abutment or pier).
 * - Elsewhere the pad carries DC + DW and the live load without IM (14.4.1), and moves with the distance to the
 *   unit's fixed point (the bridge's middle); a deck joint at a seat abutment or a simple pier.
 */
export function bearingFromBridge(b: BridgeInputs, run: BridgeRun, support: number, current: BearingInputs): BearingInputs {
  const r = run.reactions[support];
  const s = b.supports[support];
  const first = b.supports[0].station;
  const last = b.supports[b.supports.length - 1].station;
  const leveling = s.type === "integral-abutment" || s.type === "continuous-pier";
  // Each line of bearings carries its own span's end: at a pier with a line each side, the heavier side.
  const own = (key: "DC1" | "DC" | "DW" | "LL") => (r.sides.length > 1 && s.bearingOffset > 0 ? Math.max(...r.sides.map((x) => Math.max(x.interior[key], x.exterior[key]))) : r[key]);
  return {
    ...current,
    DL: Math.round((leveling ? own("DC1") : own("DC") + own("DW")) * 10) / 10,
    LL: leveling ? 0 : Math.round(own("LL") * 10) / 10,
    expansionLength: leveling ? 0 : Math.round(Math.abs(s.station - (first + last) / 2) * 100) / 100,
    ...(leveling ? { otherStatic: 0, cyclic: 0 } : {}),
    jointed: s.type === "seat-abutment" || s.type === "simple-pier",
  };
}

/**
 * The deck's length for its quantities, as CDOT measures it: back face to back face of the abutments along
 * the alignment (the deck runs over an integral abutment's diaphragm, or to a seat abutment's backwall).
 * From the bearing line: half an integral abutment's cap width behind it, else the stem behind it; along
 * the alignment, divided by the cosine of the skew.
 */
export function deckLengthFor(b: BridgeInputs, abutments: [AbutmentInputs | null, AbutmentInputs | null]) {
  const first = b.supports[0];
  const last = b.supports[b.supports.length - 1];
  const behind = (s: typeof first, a: AbutmentInputs | null) => {
    if (!a) return s.endDistance; // without the abutment: the girder's end
    const d = a.type.startsWith("integral") ? a.capWidth / 2 : Math.max(0, a.stemT - s.bearingOffset);
    return d / Math.cos((s.skew * Math.PI) / 180);
  };
  return Math.round((last.station - first.station + behind(first, abutments[0]) + behind(last, abutments[1])) * 100) / 100;
}
