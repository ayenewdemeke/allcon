import { DT_DEFAULTS, type DtInputs } from "./double-tee";

// Where each of a bridge's inputs came from. A rating starts blank: every fact about the bridge comes
// from its SIA, its inspection sketch (read from the callouts, or by eye), the BRM's tables for its
// year, a bridge file, or the engineer (entered, or assumed with a reason). Nothing is rated until
// every input the rating needs has a source. The method's settings (CDOT's back-calculation, losses,
// tension limit, distribution choices) aren't facts about the bridge and keep CDOT's values.

export type DtSourceKind = "sia" | "sketch" | "brm" | "file" | "standard" | "entered" | "assumed" | "confirmed";
export type DtSource = { kind: DtSourceKind; note?: string };

export const SOURCE_LABEL: Record<DtSourceKind, string> = {
  sia: "SIA",
  sketch: "Sketch",
  brm: "BRM table",
  file: "Bridge file",
  standard: "Standard plans",
  entered: "Entered",
  assumed: "Assumed",
  confirmed: "Confirmed",
};

/** An input's label, for the list of what's still needed. */
export const INPUT_LABEL: Record<string, string> = {
  "bridge.yearBuilt": "Year built",
  span: "Span",
  structureLength: "Structure (girder) length",
  numSpans: "Number of spans",
  skew: "Skew",
  "units.count": "Number of units",
  "units.spacing": "Unit spacing",
  "units.flangeWidth": "Flange width",
  "units.stemSpacing": "Stem spacing",
  "units.layout": "Unit widths",
  "units.layoutStems": "Stem spacing in each unit",
  "units.depth": "Depth (precast)",
  "units.flangeThk": "Flange thickness",
  "units.stemTop": "Stem width, top",
  "units.stemBot": "Stem width, bottom",
  "deck.present": "Deck or topping (whether there is one)",
  "deck.thk": "Deck thickness",
  "deck.fc": "Deck f′c",
  "roadway.railToRail": "Width, out to out",
  "roadway.railFaceOffset": "Rail face in from the edge",
  "roadway.curbToCurb": "Curb to curb",
  "roadway.curbFaceOffset": "Curb face in from the edge",
  "loads.asphalt": "Asphalt",
  "loads.railKlf": "Rail weight",
  "loads.diaphragmKip": "Diaphragms",
  "loads.sidewalks": "Sidewalks (or none)",
  "loads.utilities": "Utilities (or none)",
  "materials.fc": "Girder f′c",
  "materials.strand": "Strand type",
  "materials.fpu": "Strand strength",
  "materials.aps": "Strand area",
  "prestress.strands": "Strands per unit",
};

/** The inputs this bridge's rating needs a source for. */
export function requiredKeys(i: DtInputs): string[] {
  return [
    "bridge.yearBuilt",
    "span",
    "structureLength",
    "numSpans",
    "skew",
    "units.count",
    ...(i.units.layout ? ["units.layout", "units.layoutStems"] : ["units.spacing", "units.flangeWidth", "units.stemSpacing"]),
    "units.depth",
    "units.flangeThk",
    "units.stemTop",
    "units.stemBot",
    "deck.present",
    ...(i.deck.present ? ["deck.thk", "deck.fc"] : []),
    "roadway.railToRail",
    "roadway.railFaceOffset",
    ...(i.loads.sidewalks.length ? ["roadway.curbToCurb", "roadway.curbFaceOffset"] : []),
    "loads.asphalt",
    "loads.railKlf",
    "loads.diaphragmKip",
    "loads.sidewalks",
    "loads.utilities",
    "materials.fc",
    "materials.strand",
    "materials.fpu",
    "materials.aps",
    ...(i.prestress.mode === "known" ? ["prestress.strands"] : []),
  ];
}

/** Those needed for the section drawing (the units and the width). */
export const GEOMETRY_KEYS = new Set(["units.count", "units.spacing", "units.flangeWidth", "units.stemSpacing", "units.layout", "units.layoutStems", "units.depth", "units.flangeThk", "units.stemTop", "units.stemBot", "deck.present", "deck.thk", "roadway.railToRail"]);

/** What the rating still needs, in the order of the form. */
export const missingInputs = (i: DtInputs) => requiredKeys(i).filter((k) => !i.sources[k]);

// --- reading and writing an input by its path -------------------------------------------------------

/** An input's value by its path ("units.depth"); "units.layoutStems" is the layout's stem spacings. */
export function getPath(i: DtInputs, path: string): unknown {
  if (path === "units.layoutStems") return i.units.layout?.map((u) => u.stemSpacing) ?? null;
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), i);
}

/** The inputs with one value set by its path, and its source. */
export function setPath(i: DtInputs, path: string, value: unknown, source: DtSource | null = { kind: "entered" }): DtInputs {
  const parts = path.split(".");
  const o = structuredClone(i) as unknown as Record<string, unknown>;
  let t = o;
  for (const p of parts.slice(0, -1)) t = t[p] as Record<string, unknown>;
  t[parts[parts.length - 1]] = value;
  const out = o as unknown as DtInputs;
  out.sources = { ...i.sources };
  if (source) out.sources[path] = source;
  else delete out.sources[path];
  return out;
}

// --- the BRM's materials by year built -----------------------------------------------------------------

/**
 * Materials for a bridge without plans by its year built: the strand of the era and the deck concrete,
 * as CDOT's ratings take them from the BRM's tables for unknown materials (to be confirmed against the
 * BRM); the precast girder concrete as CDOT's double-tee ratings assume it. Years the tables here don't
 * cover give nothing, and the input stays needed.
 */
export function brmMaterials(year: number): { path: string; value: unknown; source: DtSource }[] {
  const out: { path: string; value: unknown; source: DtSource }[] = [];
  const y = Math.round(year);
  if (!(y > 1900)) return out;
  const brm = (note: string): DtSource => ({ kind: "brm", note });
  if (y >= 1950 && y < 1980) {
    const s = brm(`Built ${y}: before 1980, 1/2" 250 ksi stress-relieved strand, 0.144 in² (BRM unknown-material table; confirm)`);
    out.push({ path: "materials.strand", value: '1/2" 250 ksi stress-relieved', source: s }, { path: "materials.fpu", value: 250, source: s }, { path: "materials.aps", value: 0.144, source: s }, { path: "materials.lowRelaxation", value: false, source: s });
  } else if (y >= 1980 && y < 1990) {
    const s = brm(`Built ${y}: 1980s, 1/2" 270 ksi stress-relieved strand, 0.153 in² (BRM unknown-material table; confirm)`);
    out.push({ path: "materials.strand", value: '1/2" 270 ksi stress-relieved', source: s }, { path: "materials.fpu", value: 270, source: s }, { path: "materials.aps", value: 0.153, source: s }, { path: "materials.lowRelaxation", value: false, source: s });
  }
  if (y >= 1960 && y <= 1976) out.push({ path: "deck.fc", value: 3, source: brm(`Built ${y}: 3.0 ksi for 1960–1976 construction (BRM unknown-concrete table; confirm)`) });
  else if (y >= 1982) out.push({ path: "deck.fc", value: 4.5, source: brm(`Built ${y}: 4.5 ksi for post-1981 construction (BRM unknown-concrete table; confirm)`) });
  if (y >= 1950) out.push({ path: "materials.fc", value: 6, source: { kind: "assumed", note: "Precast girder concrete 6 ksi, as CDOT's double-tee ratings assume (no BRM table for precast; confirm)" } });
  return out;
}

/** The inputs with the BRM's materials for the year built, where no other source has given them. */
export function applyBrm(i: DtInputs): DtInputs {
  let o = i;
  for (const m of brmMaterials(i.bridge.yearBuilt)) {
    const cur = o.sources[m.path];
    if (!cur || cur.kind === "brm" || (cur.kind === "assumed" && m.source.kind === "assumed")) o = setPath(o, m.path, m.value, m.source);
  }
  return o;
}

/** A bridge file's inputs: everything it gives, sourced to it (with its notes where it has them). */
export function withFileSources(i: DtInputs, file: string): DtInputs {
  const sources: Record<string, DtSource> = {};
  for (const k of requiredKeys(i)) sources[k] = { kind: "file", note: i.notes[k] ?? file };
  return { ...i, sources, blankStart: false };
}

// --- designs saved before sources were kept -----------------------------------------------------------

/**
 * Sources for a design saved before they were kept: values read from the SIA or the sketch keep that
 * source (their notes say so); values changed from the old starting ones are taken as entered; values
 * still at the old starting ones are needed until confirmed or changed.
 */
export function legacySources(i: DtInputs): Record<string, DtSource> {
  const out: Record<string, DtSource> = {};
  const all = [...new Set([...requiredKeys(i), "units.layout", "units.layoutStems", "units.spacing", "units.flangeWidth", "units.stemSpacing", "deck.thk", "deck.fc", "roadway.curbToCurb", "roadway.curbFaceOffset"])];
  const def = { ...DT_DEFAULTS, prestress: i.prestress } as DtInputs;
  for (const k of all) {
    const note = i.notes[k];
    if (note?.startsWith("SIA ")) out[k] = { kind: "sia", note: note.replace(/^SIA /, "") };
    else if (note?.startsWith("Sketch ")) out[k] = { kind: "sketch", note: note.replace(/^Sketch /, "") };
    else if (JSON.stringify(getPath(i, k)) !== JSON.stringify(getPath(def, k))) out[k] = { kind: "entered", note: "Before sources were kept" };
  }
  return out;
}
