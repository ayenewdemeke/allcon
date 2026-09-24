import { unitDimension, type UnitDimension } from "@/lib/line-items/units";

// Suggests which line item an element group (category + type) belongs to. Scores combine:
//  - text similarity between the group's names and the line item description,
//  - whether the line item's CSI division fits the group's classification,
//  - whether the group has a quantity in the line item's unit at all.
// Suggestions are never applied silently; the user accepts them.

export type GroupForSuggestion = {
  category: string | null;
  typeName: string | null;
  assemblyCode: string | null; // UNIFORMAT, from Revit's Assembly Code
  assemblyDescription: string | null;
  quantities: Partial<Record<"volume" | "area" | "length", number>>; // totals, SI
};

export type LineItemForSuggestion = { id: string; code: string | null; description: string; unit: string | null };

export type Suggestion = { lineItemId: string; score: number; quantityKey: QuantityKey };
export type QuantityKey = "volume" | "area" | "length" | "count";

// --- vocabulary ----------------------------------------------------------------

const ABBREVIATIONS: Record<string, string[]> = {
  mtl: ["metal"], met: ["metal"], stl: ["steel"], conc: ["concrete"], cip: ["cast", "place"],
  gyp: ["gypsum"], gwb: ["gypsum", "board"], gb: ["gypsum", "board"], drywall: ["gypsum", "board"],
  hm: ["hollow", "metal"], act: ["acoustical", "ceiling"], acoustic: ["acoustical"],
  ext: ["exterior"], int: ["interior"], fdn: ["foundation"], ftg: ["footing"], alum: ["aluminum"],
  cmu: ["concrete", "masonry", "unit"], sog: ["slab", "grade"], wc: ["toilet"], lav: ["lavatory"],
  glazed: ["glazed", "glass"], mullion: ["curtain", "wall", "framing"], deck: ["deck", "slab"],
};

const STOP = new Set(["and", "or", "on", "in", "of", "with", "w", "the", "a", "an", "x", "to", "for", "at", "by", "both", "sides", "side", "system", "type", "max", "clear", "o", "c"]);

function singular(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function tokens(...texts: (string | null | undefined)[]) {
  const out = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    // Steel shapes: W12X26 is a wide-flange beam or column, 16K4 a steel joist.
    // (whether it's a beam or a column comes from the category; see elementNouns)
    if (/\bW\d+\s*X\s*\d+/i.test(text)) ["steel", "wide", "flange"].forEach((t) => out.add(t));
    if (/\b\d+K\d+\b/i.test(text)) ["steel", "joist"].forEach((t) => out.add(t));
    for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (!raw || STOP.has(raw)) continue;
      const word = singular(raw);
      for (const t of ABBREVIATIONS[word] ?? [word]) out.add(t);
    }
  }
  return out;
}

// --- classification ----------------------------------------------------------------

// UNIFORMAT II element (prefix) -> likely CSI MasterFormat divisions. Longest prefix wins.
const UNIFORMAT_TO_CSI: [string, string[]][] = [
  ["A1010", ["03", "31"]], ["A10", ["03", "31"]], ["A20", ["03", "31"]],
  ["B1010", ["03", "05"]], ["B1020", ["05", "07"]], ["B10", ["03", "05", "06"]],
  ["B2010", ["04", "05", "07", "09"]], ["B2020", ["08"]], ["B2030", ["08"]], ["B30", ["07"]],
  ["C1010", ["09", "05"]], ["C1020", ["08"]], ["C1030", ["10", "06", "12"]], ["C20", ["05", "03"]], ["C30", ["09"]],
  ["D10", ["14"]], ["D20", ["22"]], ["D30", ["23"]], ["D40", ["21"]], ["D50", ["26"]],
  ["E10", ["11"]], ["E20", ["12"]],
  ["G10", ["31"]], ["G20", ["32"]], ["G30", ["33"]], ["G40", ["26", "33"]],
];

// Revit category -> likely divisions, for elements without an Assembly Code.
const CATEGORY_TO_CSI: Record<string, string[]> = {
  Walls: ["03", "04", "09"], Floors: ["03"], Roofs: ["07"], Ceilings: ["09"],
  "Structural Framing": ["05"], "Structural Columns": ["05", "03"], "Structural Foundations": ["03", "31"],
  Doors: ["08"], Windows: ["08"], "Curtain Panels": ["08"], "Curtain Wall Mullions": ["08"],
  Stairs: ["05", "03"], Railings: ["05"], Casework: ["06", "12"], Furniture: ["12"],
  "Plumbing Fixtures": ["22"], "Specialty Equipment": ["10", "11"],
  Topography: ["31", "32"], Site: ["32"], Parking: ["32"], Planting: ["32"],
};

export function divisionsFor(group: Pick<GroupForSuggestion, "category" | "assemblyCode">) {
  const code = group.assemblyCode?.toUpperCase() ?? "";
  const byCode = UNIFORMAT_TO_CSI.filter(([prefix]) => code.startsWith(prefix)).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
  return new Set(byCode ?? CATEGORY_TO_CSI[group.category ?? ""] ?? []);
}

/** "03 30 00" -> "03"; UNIFORMAT-coded bills ("B2010") are matched by prefix instead. */
const csiDivision = (code: string | null) => code?.trim().match(/^(\d{2})/)?.[1] ?? null;

// --- quantities --------------------------------------------------------------------

/** Which element quantity feeds a line item priced in `unit`, or null if none can. */
export function quantityKeyFor(unit: string | null, available: GroupForSuggestion["quantities"]): QuantityKey | null {
  const dim: UnitDimension | null = unitDimension(unit);
  if (dim === "count" || dim === "lump") return "count";
  if (dim === "volume" || dim === "area" || dim === "length") return (available[dim] ?? 0) > 0 ? dim : null;
  return null; // weight and unknown units need a manual choice
}

// --- scoring -------------------------------------------------------------------------

// Words that name a kind of building element. When a group and a line both name one but
// share none (a footing vs. a "foundation walls" line, a joist vs. a "beams" line), the line
// is for something else, however similar the rest of the wording is.
const ELEMENT_NOUNS = new Set([
  "wall", "partition", "footing", "pile", "slab", "deck", "beam", "joist", "column", "girder", "truss", "brace",
  "door", "window", "ceiling", "roof", "stair", "railing", "curb", "gutter", "paving", "fixture", "furniture",
  "casework", "cabinet", "canopy", "panel",
]);

// The element a Revit category usually holds, used only when the type name and
// classification don't say. ("Walls" is left out: curtain walls and more live there.)
const CATEGORY_NOUN: Record<string, string> = {
  "Structural Framing": "beam", "Structural Columns": "column", "Structural Foundations": "footing",
  Floors: "slab", Roofs: "roof", Ceilings: "ceiling", Doors: "door", Windows: "window",
  Stairs: "stair", Railings: "railing", "Plumbing Fixtures": "fixture", Furniture: "furniture", Casework: "casework",
};

function elementNouns(group: GroupForSuggestion) {
  const own = [...tokens(group.typeName, group.assemblyDescription)].filter(
    // Outside the Walls category "wall" describes mounting (a wall-hung urinal), not the element.
    (t) => ELEMENT_NOUNS.has(t) && (t !== "wall" || group.category === "Walls"),
  );
  if (own.length) return new Set(own);
  const fromCategory = CATEGORY_NOUN[group.category ?? ""];
  return new Set(fromCategory ? [fromCategory] : []);
}

function elementConflict(group: GroupForSuggestion, itemTokens: Set<string>) {
  const groupNouns = elementNouns(group);
  const itemNouns = [...itemTokens].filter((t) => ELEMENT_NOUNS.has(t));
  return groupNouns.size > 0 && itemNouns.length > 0 && !itemNouns.some((n) => groupNouns.has(n));
}

export function scoreMatch(group: GroupForSuggestion, item: LineItemForSuggestion) {
  const groupTokens = tokens(group.category, group.typeName, group.assemblyDescription);
  for (const noun of elementNouns(group)) groupTokens.add(noun);
  const itemTokens = tokens(item.description);
  if (!itemTokens.size) return 0;
  let shared = 0;
  for (const t of itemTokens) if (groupTokens.has(t)) shared++;
  const recall = shared / itemTokens.size; // how much of the line's wording the group explains
  const dice = (2 * shared) / (itemTokens.size + groupTokens.size);
  const text = 0.6 * recall + 0.4 * dice;

  const code = item.code?.trim().toUpperCase() ?? "";
  const assembly = group.assemblyCode?.toUpperCase() ?? "";
  const division =
    /^[A-G]\d/.test(code) && assembly // a UNIFORMAT-coded bill
      ? assembly.startsWith(code.slice(0, 3)) ? 1 : 0
      : divisionsFor(group).has(csiDivision(item.code) ?? "") ? 1 : 0;

  const unitOk = quantityKeyFor(item.unit, group.quantities) !== null;
  const conflict = elementConflict(group, itemTokens);
  return (0.55 * text + 0.45 * division) * (unitOk ? 1 : 0.3) * (conflict ? 0.5 : 1);
}

export const SUGGESTION_THRESHOLD = 0.35;
export const HIGH_CONFIDENCE = 0.6;

/** The best line item for a group, if any scores high enough. */
export function suggest(group: GroupForSuggestion, items: LineItemForSuggestion[]): Suggestion | null {
  let best: Suggestion | null = null;
  for (const item of items) {
    const quantityKey = quantityKeyFor(item.unit, group.quantities);
    if (!quantityKey) continue;
    const score = scoreMatch(group, item);
    if (score >= SUGGESTION_THRESHOLD && (!best || score > best.score)) best = { lineItemId: item.id, score, quantityKey };
  }
  return best;
}
