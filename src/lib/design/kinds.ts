import { BEARING_DEFAULTS, PTFE_DEFAULTS, type BearingInputs } from "./bearings/elastomeric";
import { CBC_DEFAULTS, type CbcInputs } from "./culverts/cbc";
import { cleanWingwalls } from "./culverts/m601-20";

/** A culvert's excavation beyond M-206-1's trench, as saved. */
function cleanExcavation(v: unknown): CbcInputs["excavation"] {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const el = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return { to: el(o.to), inletInvert: el(o.inletInvert), outletInvert: el(o.outletInvert), wingwalls: o.wingwalls !== false, depth: el(o.depth) };
}

/** A culvert extension's dowels as saved: none unless it has joints. */
function cleanExtension(v: unknown): CbcInputs["extension"] {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : d);
  const pieces = (Array.isArray(o.pieces) ? o.pieces : [])
    .slice(0, 4)
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p, k) => ({ name: typeof p.name === "string" ? p.name.slice(0, 20) : `Piece ${k + 1}`, length: n(p.length, 0) }));
  return { pieces, bar: Math.round(n(o.bar, 5)), length: n(o.length, 36), spacing: n(o.spacing, 12) || 12, removalBackfill: n(o.removalBackfill, 0), waterproofJoints: o.waterproofJoints === true };
}
import { APPROACH_SLAB_DEFAULTS, type ApproachSlabInputs } from "./approach/approach-slab";
import { FOUNDATION_INFO, FOUNDATION_KINDS, foundationInputs } from "./foundations/kinds";
import { BRIDGE_INFO, bridgeInputs } from "./bridge/kinds";
import { DECK_DEFAULTS, RAIL_DEFAULT, type DeckInputs } from "./decks/deck";
import { STRIP_SEAL_DEFAULTS, type StripSealInputs } from "./joints/strip-seal";
import { HAUNCH_DEFAULTS, type HaunchInputs } from "./girders/haunch";
import { GIRDER_DEFAULTS, type GirderInputs } from "./girders/prestressed";
import { SITE_WIND_DEFAULTS } from "./girders/substructure-loads";
import { applyRail, CROWN_DEFAULT, GIRDER_RAIL_DEFAULT } from "./girders/bridge-deck";
import { columnInputs } from "./piers/column";
import { COLLISION_DEFAULTS, type CollisionInputs } from "./piers/collision";
import { DT_DEFAULTS, type DtInputs } from "./rating/double-tee";
import { legacySources } from "./rating/sources";
import { ZONE1_DEFAULTS, type Zone1Inputs } from "./seismic/zone1";
import { SIGN_DEFAULTS, type SignInputs } from "./signs/cantilever";
import { stmInputs } from "./stm/strut-tie";
import { TAKEOFF_KINDS, takeoffSettings } from "./takeoff/types";
import { CIP_DEFAULTS, DEFAULT_FACTORS, type CipInputs, type Combo } from "./walls/cip";
import { MSE_DEFAULTS, MSE_FACTORS, type MseInputs } from "./walls/mse";
import { WINGWALL_DEFAULTS, type WingwallInputs } from "./walls/wingwall";

// The Design section's categories and design types: highway structures to AASHTO LRFD, grouped
// by element. What can be designed, and what's coming next.

export type DesignKind = "lrfd-girder-check" | "dt-load-rating" | "stm-d-region" | "cip-cantilever-wall" | "mse-wall" | "cantilever-wingwall" | "box-culvert" | "deck-slab" | "seismic-zone1" | "pier-column" | "pier-collision" | "camber-haunch" | "sign-cantilever" | "elastomeric-bearing" | "ptfe-bearing" | "strip-seal-joint" | "approach-slab" | "spread-footing" | "pile-foundation" | "drilled-shaft" | "micropile" | "abutment" | "bridge";

export const CATEGORIES: { id: string; name: string; kinds: { id: DesignKind; name: string; short: string; description: string; available: boolean; /** Shown only with this agency's rules on (Design → Agency rules). */ agency?: "cdot" }[] }[] = [
  {
    id: "bridges",
    name: "Bridges",
    kinds: [{ id: "bridge", ...BRIDGE_INFO, available: true, agency: "cdot" }],
  },
  {
    id: "superstructures",
    name: "Superstructures",
    kinds: [
      { id: "lrfd-girder-check", name: "LRFD Bridge Design Check", short: "Precast prestressed girders: DFs, stresses, flexure, shear, camber", description: "A simple-span precast, pretensioned girder bridge with a composite deck (AASHTO I-beams, AASHTO-PCI bulb-tees, CDOT Colorado Bulb Tees or a custom section): live load distribution factors, HL-93 envelopes, prestress losses, stresses at release and service, flexure and shear at Strength I, interface shear, and camber, for the interior and exterior girders. AASHTO LRFD 4.6.2.2, 5.6, 5.7 and 5.9.", available: true },
      { id: "dt-load-rating", name: "Double-Tee Load Rating (LFR)", short: "Existing double-tee bridges, with or without plans: CDOT vehicles, posting", description: "Load Factor Rating of a simple-span bridge of adjacent precast, prestressed double tees, as AASHTOWare BrR rates one: CDOT's 13 vehicles moved along the span, every girder rated at the points of interest for flexure, service stresses and (optionally) shear, inventory and operating, and the posting check. Without plans the prestress is back-calculated so HS-20 rates 1.0 at inventory (CDOT BRM 1.7.2(A)). With the BrR input sheet and a comparison of BrR's results. AASHTO Standard Specifications (17th ed.), MBE 6B and the CDOT Bridge Rating Manual.", available: true, agency: "cdot" },
    ],
  },
  {
    id: "substructures",
    name: "Substructures",
    kinds: [
      { id: "stm-d-region", name: "Strut-and-Tie Model", short: "Pier caps and abutments: struts, ties, nodes", description: "Planar strut-and-tie design of disturbed regions in reinforced concrete pier caps and abutments: the truss layout entered or found by optimization, solved in equilibrium for each load case; the 25° strut-tie angle limit, tie bars, node face strength with nonhydrostatic nodes and confinement, the crack-control grid, anchorage of the ties at the extended nodal zone, and the diagonal-cracking screen. Normalweight, nonprestressed concrete. AASHTO LRFD 5.8.2, 5.10.8.2 and C5.8.2.2.", available: true },
      { id: "pier-column", name: "Pier Column", short: "Round, rectangular or oblong: P–M, slenderness, collision", description: "A pier column under its cap: the forces from the cap's strut-and-tie design (the bent as a plane frame) with braking, wind and temperature along the bridge from the girder designs, or entered; slenderness by moment magnification, axial load with biaxial bending by strain compatibility, shear, bar and tie limits, the optional vehicle collision, and the bars detailed with their quantities. AASHTO LRFD 3.6.4, 3.6.5.1, 3.8, 3.12, 4.5.3.2.2b, 5.6.4 and 5.7.3.3.", available: true },
      { id: "pier-collision", name: "Pier Column Collision", short: "600 kip vehicle collision on a round column", description: "A round pier column for vehicle collision in Extreme Event II: the equivalent static force, the column's shear and moments, shear by the simplified procedure and axial load with bending by strain compatibility. AASHTO LRFD 3.6.5.1, 5.7.3.3 and 5.6.4.", available: true },
      { id: "abutment", ...FOUNDATION_INFO.abutment, available: true, agency: "cdot" },
    ],
  },
  {
    id: "foundations",
    name: "Foundations",
    kinds: (["spread-footing", "pile-foundation", "drilled-shaft", "micropile"] as const).map((id) => ({ id, ...FOUNDATION_INFO[id], available: true, agency: "cdot" as const })),
  },
  {
    id: "walls",
    name: "Walls",
    kinds: [
      { id: "cip-cantilever-wall", name: "CIP Cantilever Wall", short: "Stability, stem, heel, toe and shear key", description: "Cast-in-place cantilever retaining wall: stability, shear key, and stem, heel and toe design. AASHTO LRFD.", available: true },
      { id: "mse-wall", name: "MSE Wall", short: "External and internal stability, facing panel", description: "Mechanically stabilized earth wall: external and internal stability, and the precast facing panel. AASHTO LRFD.", available: true },
      { id: "cantilever-wingwall", name: "Cantilever Wingwall", short: "Off an abutment: earth pressure, bars, abutment forces", description: "Wingwall cantilevered off an abutment: at-rest earth pressure and surcharge on the retained face, the horizontal bars at the abutment face, and the forces handed to the abutment. AASHTO LRFD.", available: true },
    ],
  },
  {
    id: "culverts",
    name: "Culverts",
    kinds: [
      { id: "box-culvert", name: "Box Culvert", short: "One or more cells: frame analysis and member design", description: "Reinforced concrete box culvert, single or multiple cells: loads, 2D frame analysis with moving HL-93 live load, and the slabs and walls designed. AASHTO LRFD.", available: true },
    ],
  },
  {
    id: "bridge-components",
    name: "Bridge Components",
    kinds: [
      { id: "deck-slab", name: "Deck Slab", short: "Equivalent strips: bars and overhang", description: "Cast-in-place deck on parallel girders by the equivalent strip method: the strip analyzed as a continuous beam under dead loads and the design truck's axles, the top, bottom and longitudinal bars, and the overhang for vehicle collision. AASHTO LRFD 4.6.2.1, 9.7.3 and A13.4.", available: true },
      { id: "approach-slab", name: "Approach Slab", short: "On the abutment notch and a sleeper slab: bars and quantities", description: "A cast-in-place bridge approach slab anchored to the abutment and resting on a sleeper slab, designed as CDOT does for the span over which the fill may settle away (50% of its length, BDM 11.3.7): the axles over the equivalent strip of a slab-type bridge, the main bars (flexure, minimum, crack control, fatigue), shear, distribution and temperature bars, the dowels into the abutment, the sleeper slab's bearing and bars, and a barrier on its edge; with its bars detailed and its CDOT quantities. AASHTO LRFD 3.6.1.3.3, 4.6.2.3, 5.5.3, 5.6, 5.10.6 and 9.7.3.2.", available: true, agency: "cdot" },
      { id: "camber-haunch", name: "Camber and Haunch", short: "Haunch at supports and midspan, camber tolerances", description: "A girder span's haunch (or adjacent box beams' deck thickness) at the supports and midspan, from the deck's profile over the girder (vertical curve, chorded girders on a horizontal curve, cross-slope) and the girder's camber and dead load deflection, with over- and under-camber tolerances.", available: true },
      { id: "elastomeric-bearing", name: "Elastomeric Bearing", short: "Plain or steel-reinforced pads", description: "Elastomeric bearing pads, plain or steel-reinforced, by Method A or B: compression, shear strains, deflection, stability, shims and anchorage. AASHTO LRFD 14.7.5 and 14.7.6.", available: true },
      { id: "ptfe-bearing", name: "PTFE Sliding Bearing", short: "Sliding surface on an elastomeric pad", description: "A steel-reinforced elastomeric pad with a PTFE sliding surface: contact stresses (average and edge), the pad's deformation to the first slip and the sliding beyond, with the pad's own checks. AASHTO LRFD 14.7.2 and 14.7.5.", available: true },
      { id: "strip-seal-joint", name: "Strip Seal Expansion Joint", short: "Movement and seal size", description: "A strip seal deck joint: the movement from temperature, creep and shrinkage normal to the skewed joint against the seal's range, and the gap to set at each installation temperature. AASHTO LRFD 3.12.2 and 14.5.3.", available: true },
    ],
  },
  {
    id: "seismic",
    name: "Seismic",
    kinds: [
      { id: "seismic-zone1", name: "Seismic Zone 1 Check", short: "Connection forces, support lengths, confinement", description: "A bridge in Seismic Zone 1, where no seismic analysis is required: the zone, horizontal connection forces at each support, minimum support lengths, and confinement spirals in the columns' plastic hinge regions. AASHTO LRFD 3.10.6, 3.10.9.2, 4.7.4.4 and 5.11.", available: true },
    ],
  },
  {
    id: "signs",
    name: "Sign Structures",
    kinds: [
      { id: "sign-cantilever", name: "Cantilever Sign Foundation", short: "Wind loads and the drilled shaft", description: "A cantilever sign structure's drilled shaft: dead and wind loads on the pole, arm and panel by AASHTO LTS, and the shaft's axial, bending, shear and torsion checks by AASHTO LRFD, for a p–y analysis's lateral response.", available: true },
    ],
  },
];

export const kindInfo = (kind: string) => CATEGORIES.flatMap((c) => c.kinds).find((k) => k.id === kind);

/** A CIP wall's inputs as saved, filled in from the defaults (for fields added since, each load
 * group's factors too). */
export function cipInputs(saved: unknown): CipInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<CipInputs>;
  const factors = Object.fromEntries((Object.keys(DEFAULT_FACTORS) as Combo[]).map((c) => [c, { ...DEFAULT_FACTORS[c], ...(s.factors?.[c] ?? {}) }])) as CipInputs["factors"];
  return { ...CIP_DEFAULTS, ...s, factors };
}

/** An MSE wall's inputs as saved, filled in from the defaults. */
export function mseInputs(saved: unknown): MseInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<MseInputs>;
  return { ...MSE_DEFAULTS, ...s, factors: { ...MSE_FACTORS, ...(s.factors ?? {}) } };
}

/** A box culvert's inputs as saved, filled in from the defaults. Saved before bars were a choice:
 * precast with welded wire (as they were designed). */
export function cbcInputs(saved: unknown): CbcInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<CbcInputs>;
  const old = s.steel && !s.reinf ? ({ reinf: "wwr", construction: "precast" } as const) : {};
  return { ...CBC_DEFAULTS, ...old, ...s, steel: { ...CBC_DEFAULTS.steel, ...(s.steel ?? {}) }, bars: { ...CBC_DEFAULTS.bars, ...(s.bars ?? {}) }, wingwalls: cleanWingwalls(s.wingwalls), cornerBars: s.cornerBars === true, extension: cleanExtension(s.extension), excavation: cleanExcavation(s.excavation) };
}

/** A haunch design's inputs as saved, filled in from the defaults. */
export function haunchInputs(saved: unknown): HaunchInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<HaunchInputs>;
  return { ...HAUNCH_DEFAULTS, ...s };
}

/** A cantilever sign's inputs as saved, filled in from the defaults. */
export function signInputs(saved: unknown): SignInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<SignInputs>;
  return { ...SIGN_DEFAULTS, ...s };
}

/** Seismic Zone 1 inputs as saved, filled in from the defaults. */
export function zone1Inputs(saved: unknown): Zone1Inputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<Zone1Inputs>;
  return { ...ZONE1_DEFAULTS, ...s };
}

/** A deck's inputs as saved, filled in from the defaults. */
export function deckInputs(saved: unknown): DeckInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<DeckInputs>;
  return { ...DECK_DEFAULTS, ...s, rail: { ...RAIL_DEFAULT, ...(s.rail ?? {}) } };
}

/** A wingwall's inputs as saved, filled in from the defaults. */
export function wingwallInputs(saved: unknown): WingwallInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<WingwallInputs>;
  return { ...WINGWALL_DEFAULTS, ...s, bars: { ...WINGWALL_DEFAULTS.bars, ...(s.bars ?? {}) } };
}

/** An elastomeric bearing's inputs as saved, filled in from the defaults. */
export function bearingInputs(saved: unknown): BearingInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<BearingInputs>;
  return { ...BEARING_DEFAULTS, ...s };
}

/** A PTFE sliding bearing's inputs as saved, filled in from its defaults. */
export function ptfeInputs(saved: unknown): BearingInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<BearingInputs>;
  return { ...PTFE_DEFAULTS, ...s, sliding: true };
}

/** An approach slab's inputs as saved, filled in from the defaults. */
export function approachSlabInputs(saved: unknown): ApproachSlabInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<ApproachSlabInputs>;
  // Saved before B-601-1EA: a strip seal is its 0–4" device; anything else B-601-1's poured joint.
  const was = (s as { joint?: string }).joint;
  const joint = was === "none" || was === "silicone" ? "none" : "device";
  return { ...APPROACH_SLAB_DEFAULTS, ...s, joint, sleeper: s.sleeper !== false, barrier: s.barrier === true };
}

/** A strip seal joint's inputs as saved, filled in from the defaults. */
export function stripSealInputs(saved: unknown): StripSealInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<StripSealInputs>;
  return { ...STRIP_SEAL_DEFAULTS, ...s };
}

/** A girder design check's inputs as saved, filled in from the defaults (its lists kept as saved). */
export function girderInputs(saved: unknown): GirderInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<GirderInputs>;
  // Saved before Phase 2 (no loss method): kept as designed, with approximate losses and straight strands only.
  const phase1 = Object.keys(s).length > 0 && s.losses === undefined ? { losses: "approximate" as const, elasticGain: false, harped: { ...GIRDER_DEFAULTS.harped, count: 0 } } : {};
  // A standard rail sets the barrier: its width, weight and height (applyRail).
  return applyRail({
    ...GIRDER_DEFAULTS,
    ...phase1,
    ...s,
    harped: { ...GIRDER_DEFAULTS.harped, ...(phase1.harped ?? {}), ...(s.harped ?? {}) },
    bottomBars: { ...GIRDER_DEFAULTS.bottomBars, ...(s.bottomBars ?? {}) },
    pierBars: { ...GIRDER_DEFAULTS.pierBars, ...(s.pierBars ?? {}) },
    connection: { ...GIRDER_DEFAULTS.connection, ...(s.connection ?? {}) },
    extraSpans: Array.isArray(s.extraSpans) ? s.extraSpans.slice(0, 4).map((x) => ({ L: Number(x?.L) || GIRDER_DEFAULTS.L, strands: Array.isArray(x?.strands) && x.strands.length ? x.strands : null, harped: x?.harped ? { ...GIRDER_DEFAULTS.harped, ...x.harped } : null })) : [],
    restraintMoments: s.restraintMoments === "positive" || s.restraintMoments === "none" ? s.restraintMoments : "all",
    criteria: s.criteria === "cdot" ? "cdot" : "aashto",
    continuity: s.continuity === "envelope" ? "envelope" : "auto",
    wcLoad: Number(s.wcLoad) > 0 ? Number(s.wcLoad) : undefined,
    wcDeckLoad: Number(s.wcDeckLoad) > 0 ? Number(s.wcDeckLoad) : undefined,
    haunchMode: s.haunchMode === "computed" ? "computed" : "given",
    deckPanels: s.deckPanels === true,
    crossSlope: Number.isFinite(Number(s.crossSlope)) && s.crossSlope !== null && s.crossSlope !== undefined ? Number(s.crossSlope) : 0.02,
    profileOrdinate: Number(s.profileOrdinate) || 0,
    confinement: { ...GIRDER_DEFAULTS.confinement, ...(s.confinement ?? {}) },
    handling: { ...GIRDER_DEFAULTS.handling, ...(s.handling ?? {}), truck: { ...GIRDER_DEFAULTS.handling.truck, ...(s.handling?.truck ?? {}) } },
    custom: { ...GIRDER_DEFAULTS.custom, ...(s.custom ?? {}) },
    site: { ...SITE_WIND_DEFAULTS, ...(s.site ?? {}) },
    strands: Array.isArray(s.strands) && s.strands.length ? s.strands : GIRDER_DEFAULTS.strands,
    stirrups: Array.isArray(s.stirrups) && s.stirrups.length ? s.stirrups : GIRDER_DEFAULTS.stirrups,
    crown: { ...CROWN_DEFAULT, ...(s.crown ?? {}) },
    rail: { ...GIRDER_RAIL_DEFAULT, ...(s.rail ?? {}) },
  });
}

/** A pier collision design's inputs as saved, filled in from the defaults. */
export function collisionInputs(saved: unknown): CollisionInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<CollisionInputs>;
  return { ...COLLISION_DEFAULTS, ...s };
}

/** A double-tee rating's inputs as saved, filled in from the defaults. */
export function dtRatingInputs(saved: unknown): DtInputs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<DtInputs>;
  const d = DT_DEFAULTS;
  const o = s.options ?? ({} as Partial<DtInputs["options"]>);
  const out: DtInputs = {
    ...d,
    ...s,
    bridge: { ...d.bridge, ...(s.bridge ?? {}) },
    units: { ...d.units, ...(s.units ?? {}), layout: Array.isArray(s.units?.layout) && s.units.layout.length ? s.units.layout : null },
    deck: { ...d.deck, ...(s.deck ?? {}) },
    roadway: { ...d.roadway, ...(s.roadway ?? {}) },
    loads: {
      ...d.loads,
      ...(s.loads ?? {}),
      sidewalks: Array.isArray(s.loads?.sidewalks)
        ? s.loads.sidewalks.map((x: { width: number; thk: number; curb?: boolean }) => ({ width: Number(x.width) || 0, thk: Number(x.thk) || 0, ...(x.curb === true ? { curb: true } : {}) }))
        : [],
      railComponents: Array.isArray(s.loads?.railComponents) ? s.loads.railComponents : [],
      utilities: Array.isArray(s.loads?.utilities) ? s.loads.utilities : [],
    },
    materials: { ...d.materials, ...(s.materials ?? {}) },
    prestress: (() => {
      const p = { ...d.prestress, ...(s.prestress ?? {}) };
      const h = p.harp;
      const ok = h && typeof h === "object" && [h.end, h.mid, h.at].every((v) => typeof v === "number" && Number.isFinite(v)) && h.at > 0 && h.at <= 0.5;
      return { mode: p.mode === "known" ? "known" : "back-calculate", strands: Number(p.strands) || 0, harp: ok ? { end: h.end, mid: h.mid, at: h.at } : null } as DtInputs["prestress"];
    })(),
    options: {
      ...d.options,
      ...o,
      stirrups: { ...d.options.stirrups, ...(o.stirrups ?? {}) },
      dfOverride: o.dfOverride ? { ...o.dfOverride } : null,
      tensionLimit: typeof o.tensionLimit === "number" ? o.tensionLimit : o.tensionLimit === null ? null : d.options.tensionLimit,
      ignoreTension: o.ignoreTension === true,
    },
    brrDf: Object.fromEntries((["intSingle", "intMulti", "extSingle", "extMulti"] as const).map((k) => [k, typeof s.brrDf?.[k] === "number" && s.brrDf[k]! > 0 ? s.brrDf[k] : null])) as DtInputs["brrDf"],
    review: { ...d.review, ...(s.review ?? {}), items: Array.isArray(s.review?.items) ? s.review.items : [] },
    notes: s.notes && typeof s.notes === "object" ? s.notes : {},
    brrResults: typeof s.brrResults === "string" ? s.brrResults : "",
    sketch:
      s.sketch && typeof s.sketch === "object" && Array.isArray(s.sketch.pages)
        ? {
            name: String(s.sketch.name ?? "Sketch"),
            pages: s.sketch.pages
              .filter((p) => p && typeof p.key === "string" && /^designs\/[\w-]+\/attachments\/[\w-]+\.(png|jpg|webp)$/.test(p.key))
              .slice(0, 6)
              .map((p) => ({ key: p.key, width: Number(p.width) || 0, height: Number(p.height) || 0 })),
            ...(Array.isArray(s.sketch.text) ? { text: s.sketch.text.filter((l): l is string => typeof l === "string").slice(0, 600).map((l) => l.slice(0, 400)) } : {}),
          }
        : null,
    dimsChecked: s.dimsChecked === true,
    sources: {},
    blankStart: true,
  };
  // Sources: kept as saved; a new design starts blank; one saved before sources were kept gets them worked out.
  const KINDS = new Set(["sia", "sketch", "brm", "file", "standard", "entered", "assumed", "confirmed"]);
  if (s.sources && typeof s.sources === "object") {
    out.sources = Object.fromEntries(
      Object.entries(s.sources)
        .filter(([, v]) => v && typeof v === "object" && KINDS.has((v as { kind: string }).kind))
        .map(([k, v]) => [k, { kind: (v as DtInputs["sources"][string]).kind, ...(typeof v.note === "string" ? { note: v.note.slice(0, 500) } : {}) }]),
    );
    out.blankStart = s.blankStart !== false;
  } else if (Object.keys(s).length > 0) {
    out.sources = legacySources(out);
    out.blankStart = false;
  }
  return out;
}

/** A design's inputs as saved, filled in from its kind's defaults, with its take-off settings kept. */
export function designInputs(kind: string, saved: unknown) {
  const parsed = parseInputs(kind, saved);
  const t = TAKEOFF_KINDS.includes(kind) ? takeoffSettings((saved as Record<string, unknown> | null)?.takeoff) : undefined;
  return (t ? { ...parsed, takeoff: t } : parsed) as typeof parsed;
}

function parseInputs(kind: string, saved: unknown) {
  if (kind === "bridge") return bridgeInputs(saved);
  if ((FOUNDATION_KINDS as readonly string[]).includes(kind)) return foundationInputs(kind, saved)!;
  if (kind === "lrfd-girder-check") return girderInputs(saved);
  if (kind === "dt-load-rating") return dtRatingInputs(saved);
  if (kind === "pier-collision") return collisionInputs(saved);
  if (kind === "stm-d-region") return stmInputs(saved);
  if (kind === "pier-column") return columnInputs(saved);
  return kind === "mse-wall" ? mseInputs(saved) : kind === "box-culvert" ? cbcInputs(saved) : kind === "elastomeric-bearing" ? bearingInputs(saved) : kind === "cantilever-wingwall" ? wingwallInputs(saved) : kind === "deck-slab" ? deckInputs(saved) : kind === "seismic-zone1" ? zone1Inputs(saved) : kind === "camber-haunch" ? haunchInputs(saved) : kind === "sign-cantilever" ? signInputs(saved) : kind === "ptfe-bearing" ? ptfeInputs(saved) : kind === "strip-seal-joint" ? stripSealInputs(saved) : kind === "approach-slab" ? approachSlabInputs(saved) : cipInputs(saved);
}
