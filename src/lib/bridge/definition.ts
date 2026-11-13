import { GIRDER_SHAPES, shapeById, type Profile } from "../design/girders/sections";

// A bridge's definition: what the engineer enters and the wizard fills in, a few dozen values. The
// analysis model (model.ts) is generated from it (generate.ts). First version: precast prestressed
// girders with a cast-in-place deck, straight, the supports at one skew, simple spans or spans made
// continuous for the loads after the deck. Feet, inches, kips, ksi, degrees as marked.

export type SupportLine = {
  /** Fixed bearings hold the girders along the bridge; expansion bearings let them slide. */
  bearing: "fixed" | "expansion";
};

export type BridgeDefinition = {
  // Layout (midas's wizard: Layout)
  spans: number[]; // ft, between support centerlines
  skew: number; // degrees, every support line, from a line square to the bridge
  supports: SupportLine[]; // spans + 1: the abutments at the ends, piers between
  continuity: "simple" | "continuous"; // for the loads after the deck (barriers, wearing surface, live load)
  // Section (midas's wizard: Section)
  /** A library shape, or "custom" with its outline (half-widths up the girder, in), web and top flange width. */
  girder: { shape: string; fc: number; wc: number; custom?: { profile: Profile; web: number; topWidth: number } }; // ksi; kcf
  nGirders: number;
  spacing: number; // ft
  overhang: number; // ft, exterior girder centerline to the deck's edge
  deck: { thickness: number; sacrificial: number; haunch: number; fc: number; wc: number }; // in, in, in, ksi, kcf
  divisions: number; // elements per span along each girder
  diaphragms: { perSpan: number; weight: number; thickness: number; atSupports: boolean }; // intermediate ones per span; kip per bay; ft
  // Substructure
  piers: { model: boolean; capWidth: number; capDepth: number; columns: number; columnDiameter: number; columnHeight: number; columnSpacing: number; fc: number; bearingHeight: number }; // ft; ksi; in
  // Loads
  loads: { barrierWeight: number; barrierWidth: number; wearingSurface: number }; // klf each side; ft; psf
};

export const BRIDGE_DEFAULTS: BridgeDefinition = {
  spans: [120],
  skew: 0,
  supports: [{ bearing: "fixed" }, { bearing: "expansion" }],
  continuity: "continuous",
  girder: { shape: "bt-72", fc: 8.5, wc: 0.15 },
  nGirders: 6,
  spacing: 8,
  overhang: 3.5,
  deck: { thickness: 8.5, sacrificial: 0.5, haunch: 2, fc: 4, wc: 0.15 },
  divisions: 10,
  diaphragms: { perSpan: 2, weight: 2.5, thickness: 0.75, atSupports: true },
  piers: { model: true, capWidth: 4, capDepth: 4, columns: 3, columnDiameter: 3.5, columnHeight: 20, columnSpacing: 16, fc: 4, bearingHeight: 3 },
  loads: { barrierWeight: 0.4, barrierWidth: 1.5, wearingSurface: 25 },
};

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : d);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** The support lines for a number of spans, keeping what's there: one fixed line (the first pier, or the first abutment), the rest expansion. */
export function supportsFor(spans: number, current: SupportLine[] = []): SupportLine[] {
  const out: SupportLine[] = Array.from({ length: spans + 1 }, (_, k) => ({ bearing: current[k]?.bearing === "fixed" ? "fixed" : "expansion" }));
  if (current.length !== spans + 1 || !out.some((s) => s.bearing === "fixed")) {
    out.forEach((s) => (s.bearing = "expansion"));
    out[spans > 1 ? 1 : 0].bearing = "fixed";
  }
  return out;
}

/** A definition as saved, filled in from the defaults and kept within what the generator takes. */
export function bridgeDefinition(saved: unknown): BridgeDefinition {
  const s = obj(saved);
  const d = BRIDGE_DEFAULTS;
  const spans = (Array.isArray(s.spans) ? s.spans : d.spans).map((v) => num(v, 100, 10, 500)).slice(0, 8);
  const girder = obj(s.girder);
  const deck = obj(s.deck);
  const dia = obj(s.diaphragms);
  const piers = obj(s.piers);
  const loads = obj(s.loads);
  const c = obj(girder.custom);
  const profile = Array.isArray(c.profile) ? (c.profile as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v))) : [];
  const custom = girder.shape === "custom" && profile.length >= 2 ? { profile, web: num(c.web, 6, 1, 60), topWidth: num(c.topWidth, 2 * profile[profile.length - 1][1], 1, 200) } : undefined;
  const shape = custom ? "custom" : typeof girder.shape === "string" && shapeById(girder.shape) ? girder.shape : d.girder.shape;
  return {
    spans: spans.length ? spans : d.spans,
    skew: num(s.skew, 0, -60, 60),
    supports: supportsFor(spans.length || 1, Array.isArray(s.supports) ? (s.supports as SupportLine[]) : []),
    continuity: s.continuity === "simple" ? "simple" : "continuous",
    girder: { shape, fc: num(girder.fc, d.girder.fc, 3, 18), wc: num(girder.wc, d.girder.wc, 0.09, 0.2), ...(custom ? { custom } : {}) },
    nGirders: Math.round(num(s.nGirders, d.nGirders, 2, 20)),
    spacing: num(s.spacing, d.spacing, 2, 20),
    overhang: num(s.overhang, d.overhang, 0, 10),
    deck: { thickness: num(deck.thickness, d.deck.thickness, 4, 24), sacrificial: num(deck.sacrificial, d.deck.sacrificial, 0, 4), haunch: num(deck.haunch, d.deck.haunch, 0, 12), fc: num(deck.fc, d.deck.fc, 2.5, 12), wc: num(deck.wc, d.deck.wc, 0.09, 0.2) },
    divisions: Math.round(num(s.divisions, d.divisions, 4, 40)),
    diaphragms: { perSpan: Math.round(num(dia.perSpan, d.diaphragms.perSpan, 0, 10)), weight: num(dia.weight, d.diaphragms.weight, 0, 100), thickness: num(dia.thickness, d.diaphragms.thickness, 0.25, 4), atSupports: dia.atSupports !== false },
    piers: {
      model: piers.model !== false,
      capWidth: num(piers.capWidth, d.piers.capWidth, 1, 15),
      capDepth: num(piers.capDepth, d.piers.capDepth, 1, 15),
      columns: Math.round(num(piers.columns, d.piers.columns, 1, 8)),
      columnDiameter: num(piers.columnDiameter, d.piers.columnDiameter, 1, 15),
      columnHeight: num(piers.columnHeight, d.piers.columnHeight, 3, 200),
      columnSpacing: num(piers.columnSpacing, d.piers.columnSpacing, 3, 60),
      fc: num(piers.fc, d.piers.fc, 2.5, 12),
      bearingHeight: num(piers.bearingHeight, d.piers.bearingHeight, 0, 24),
    },
    loads: { barrierWeight: num(loads.barrierWeight, d.loads.barrierWeight, 0, 5), barrierWidth: num(loads.barrierWidth, d.loads.barrierWidth, 0, 5), wearingSurface: num(loads.wearingSurface, d.loads.wearingSurface, 0, 200) },
  };
}

export const GIRDER_CHOICES = GIRDER_SHAPES.map((s) => ({ value: s.id, label: `${s.name}` }));
