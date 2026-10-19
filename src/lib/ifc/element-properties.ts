// What a model element is, read for a person rather than as the IFC file stores it: what it
// is and where, what it is made of, its quantities with units, and its property sets under
// readable names. conkit's own set (mark, source sheet, assumptions) comes first. Adapted
// from Live Jobsite's viewer.
//
// Works on the item data the fragments viewer returns: attributes as { value, type } pairs
// and relations as arrays of related items, which can link back to the element itself, so
// nothing here follows a link it has already seen.

/** The relations to ask the viewer for, with each element's data. */
export const ELEMENT_DATA_CONFIG = {
  attributesDefault: true,
  relations: {
    IsDefinedBy: { attributes: true, relations: true },
    HasAssociations: { attributes: true, relations: true },
    ContainedInStructure: { attributes: true, relations: false },
    Decomposes: { attributes: true, relations: true },
  },
};

export type Row = { label: string; value: string; mono?: boolean };
export type Group = { name: string; rows: Row[]; open: boolean };

export type ElementDetails = {
  /** The element's name, or its type when it has none. */
  title: string;
  /** What kind of element: "Wall". */
  category: string;
  /** Level, material, assembly: what someone looks for first. */
  summary: Row[];
  /** Measured quantities and the element's own dimensions, with units. */
  quantities: Row[];
  /** Every property set, by readable name. */
  groups: Group[];
  /** Identifiers, for finding the element elsewhere. */
  identity: Row[];
};

/** The units a model measures in, as symbols; null where the model does not say. */
export type ModelUnits = { length: string | null; area: string | null; volume: string | null; mass: string | null };

export const NO_UNITS: ModelUnits = { length: null, area: null, volume: null, mass: null };

type Item = Record<string, unknown>;

const isItem = (v: unknown): v is Item => typeof v === "object" && v !== null && !Array.isArray(v);
const items = (v: unknown): Item[] => (Array.isArray(v) ? v.filter(isItem) : []);

/** An attribute's value, and the IFC type it was stored as. */
function attr(item: Item, key: string): { value: unknown; type?: string } | null {
  const a = item[key];
  if (!isItem(a) || !("value" in a)) return null;
  return { value: a.value, type: typeof a.type === "string" ? a.type : undefined };
}

const text = (item: Item, key: string): string | null => {
  const v = attr(item, key)?.value;
  return v === null || v === undefined || v === "" ? null : String(v);
};

const category = (item: Item) => text(item, "_category") ?? "";

// Units

const PREFIX: Record<string, string> = { MILLI: "m", CENTI: "c", DECI: "d", KILO: "k" };
const CONVERTED: Record<string, string> = {
  FOOT: "ft",
  INCH: "in",
  YARD: "yd",
  "SQUARE FOOT": "ft²",
  "SQUARE INCH": "in²",
  "CUBIC FOOT": "ft³",
  "CUBIC INCH": "in³",
  POUND: "lb",
};

/** The model's units, from its unit assignment. A unit it doesn't name stays unknown: no unit beats a wrong one. */
export function readUnits(assignment: Item | undefined): ModelUnits {
  const units = { ...NO_UNITS };
  for (const u of items(assignment?.Units)) {
    const type = text(u, "UnitType");
    const name = text(u, "Name");
    if (!type || !name) continue;
    let symbol: string | null = null;
    if (category(u) === "IFCSIUNIT") {
      const p = PREFIX[text(u, "Prefix") ?? ""] ?? "";
      symbol = name === "METRE" ? `${p}m` : name === "SQUARE_METRE" ? `${p}m²` : name === "CUBIC_METRE" ? `${p}m³` : name === "GRAM" ? `${p}g` : null;
    } else {
      symbol = CONVERTED[name.toUpperCase()] ?? null;
    }
    const key = ({ LENGTHUNIT: "length", AREAUNIT: "area", VOLUMEUNIT: "volume", MASSUNIT: "mass" } as const)[type as "LENGTHUNIT"] as
      | keyof ModelUnits
      | undefined;
    if (key && symbol && !units[key]) units[key] = symbol;
  }
  return units;
}

// Values

type Measure = keyof ModelUnits;

const MEASURE_OF_TYPE: Record<string, Measure> = {
  IFCLENGTHMEASURE: "length",
  IFCPOSITIVELENGTHMEASURE: "length",
  IFCNONNEGATIVELENGTHMEASURE: "length",
  IFCAREAMEASURE: "area",
  IFCVOLUMEMEASURE: "volume",
  IFCMASSMEASURE: "mass",
};

function formatNumber(n: number, unit: string | null): string {
  // Millimetres read as whole numbers; everything else to two places, or three for small
  // values, so a 0.567 m³ beam doesn't read as 0.57.
  const digits = unit === "mm" ? 0 : Math.abs(n) < 1 && n !== 0 ? 3 : 2;
  const s = n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return unit ? `${s} ${unit}` : s;
}

function formatValue(value: unknown, measure: Measure | undefined, units: ModelUnits): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return formatNumber(value, measure ? units[measure] : null);
  if (value === "UNKNOWN" || value === "NOTDEFINED") return null;
  if (Array.isArray(value)) return value.map((v) => formatValue(v, measure, units)).filter(Boolean).join(", ") || null;
  return String(value);
}

// Names

/** "IsExternal" → "Is external". Names already written for people are left as they are. */
export function humanize(name: string): string {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) return name;
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return words.charAt(0) + words.slice(1).toLowerCase();
}

/** conkit's own property set, written by the model compiler. */
const CONKIT_SET = "Pset_Conkit";
const CONKIT_LABELS: Record<string, string> = {
  Mark: "Mark",
  ConkitId: "Id in model",
  SourceSheet: "From sheet",
  Notes: "Assumed",
  LOD: "LOD",
  Basis: "Geometry basis",
  TargetLOD: "Target LOD",
};

/** "Pset_WallCommon" → "Wall common"; "Qto_WallBaseQuantities" → "Wall base quantities". */
function setName(name: string): string {
  if (name === CONKIT_SET) return "From the drawings";
  return humanize(name.replace(/^(Pset|Qto)_/, ""));
}

const CATEGORY_NAMES: Record<string, string> = {
  IFCWALLSTANDARDCASE: "Wall",
  IFCWALLELEMENTEDCASE: "Wall",
  IFCCURTAINWALL: "Curtain wall",
  IFCSLABSTANDARDCASE: "Slab",
  IFCSLABELEMENTEDCASE: "Slab",
  IFCBEAMSTANDARDCASE: "Beam",
  IFCCOLUMNSTANDARDCASE: "Column",
  IFCMEMBERSTANDARDCASE: "Member",
  IFCPLATESTANDARDCASE: "Plate",
  IFCOPENINGELEMENT: "Opening",
  IFCSTAIRFLIGHT: "Stair flight",
  IFCRAMPFLIGHT: "Ramp flight",
  IFCBUILDINGELEMENTPROXY: "Generic element",
  IFCBUILDINGELEMENTPART: "Element part",
  IFCELEMENTASSEMBLY: "Assembly",
  IFCFURNISHINGELEMENT: "Furnishing element",
  IFCFURNITURE: "Furniture",
  IFCFLOWTERMINAL: "Fixture",
  IFCFLOWSEGMENT: "Pipe or duct",
  IFCFLOWFITTING: "Fitting",
  IFCDISTRIBUTIONELEMENT: "Distribution element",
  IFCREINFORCINGBAR: "Reinforcing bar",
  IFCREINFORCINGMESH: "Reinforcing mesh",
  IFCBUILDINGSTOREY: "Level",
  IFCBRIDGEPART: "Bridge part",
  IFCSPACE: "Room",
  IFCPROJECT: "Project",
  IFCSITE: "Site",
  IFCBUILDING: "Building",
  IFCBRIDGE: "Bridge",
  IFCBEARING: "Bearing",
  IFCRAILING: "Railing",
  IFCCOVERING: "Covering",
  IFCFOOTING: "Footing",
  IFCPILE: "Pile",
  IFCAIRTERMINAL: "Air terminal",
  IFCLIGHTFIXTURE: "Light fixture",
  IFCSANITARYTERMINAL: "Sanitary fixture",
  IFCWASTETERMINAL: "Waste terminal",
  IFCFIRESUPPRESSIONTERMINAL: "Fire suppression terminal",
  IFCUNITARYEQUIPMENT: "Unitary equipment",
  IFCELECTRICAPPLIANCE: "Electric appliance",
  IFCSWITCHINGDEVICE: "Switch",
  IFCPROTECTIVEDEVICE: "Protective device",
  IFCPIPESEGMENT: "Pipe",
  IFCPIPEFITTING: "Pipe fitting",
  IFCDUCTSEGMENT: "Duct",
  IFCDUCTFITTING: "Duct fitting",
  IFCCABLESEGMENT: "Cable",
  IFCCABLECARRIERSEGMENT: "Cable tray",
  IFCDISCRETEACCESSORY: "Accessory",
  IFCMECHANICALFASTENER: "Fastener",
  IFCSHADINGDEVICE: "Shading device",
  IFCTRANSPORTELEMENT: "Transport element",
  IFCDEEPFOUNDATION: "Deep foundation",
  IFCEARTHWORKSFILL: "Earthworks fill",
  IFCGEOGRAPHICELEMENT: "Geographic element",
  IFCCIVILELEMENT: "Civil element",
  IFCREINFORCINGELEMENT: "Reinforcing element",
};

/** Kinds that hold others (project, site, building, levels), listed in the model tree rather than grouped. */
export const SPATIAL_CATEGORIES = new Set(["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBRIDGE", "IFCBUILDINGSTOREY", "IFCBRIDGEPART", "IFCFACILITY", "IFCFACILITYPART"]);

/** "IFCWALL" → "Wall". */
export function categoryName(ifcClass: string): string {
  const upper = ifcClass.toUpperCase();
  if (CATEGORY_NAMES[upper]) return CATEGORY_NAMES[upper];
  const bare = upper.replace(/^IFC/, "");
  return bare.charAt(0) + bare.slice(1).toLowerCase();
}

/** Revit names an element "Family:Type:ElementId"; the id is already the tag. */
const withoutElementId = (name: string) => name.replace(/:\d+$/, "").replace(/:/g, ": ");

// Materials

/** Material names, whether given as one material, a list, layers or constituents. */
function materialNames(element: Item): string[] {
  const names: string[] = [];
  const seen = new Set<Item>();
  const walk = (m: Item, depth: number) => {
    if (seen.has(m) || depth > 4) return;
    seen.add(m);
    const cat = category(m);
    if (cat === "IFCMATERIAL" || cat === "IFCMATERIALCONSTITUENT" || cat === "IFCMATERIALLAYER" || cat === "IFCMATERIALPROFILE") {
      const nested = items(m.Material)[0] ?? (isItem(m.Material) && !("value" in m.Material) ? m.Material : null);
      const name = (nested && text(nested, "Name")) ?? text(m, "Name");
      if (name && !names.includes(name)) names.push(name);
      return;
    }
    for (const [key, v] of Object.entries(m)) {
      if (key === "AssociatedTo") continue; // back to the elements using it
      for (const child of items(v)) walk(child, depth + 1);
      if (isItem(v) && !("value" in v)) walk(v, depth + 1);
    }
    // A set with nothing readable inside still has a name of its own.
    if (!names.length && cat.startsWith("IFCMATERIAL")) {
      const own = text(m, "Name");
      if (own) names.push(own);
    }
  };
  for (const a of items(element.HasAssociations)) if (category(a).startsWith("IFCMATERIAL")) walk(a, 0);
  return names;
}

// The element

const QUANTITY_FIELDS: [string, Measure | undefined][] = [
  ["LengthValue", "length"],
  ["AreaValue", "area"],
  ["VolumeValue", "volume"],
  ["WeightValue", "mass"],
  ["CountValue", undefined],
  ["TimeValue", undefined],
];

/** The element's own attributes that are dimensions (doors' and windows' overall sizes). */
const DIMENSION_ATTRIBUTES = ["OverallWidth", "OverallHeight", "OverallDepth", "NominalDiameter", "NominalLength", "BarLength"];

/** Attributes already shown elsewhere, or only meaningful inside the file. */
const NOT_SHOWN = new Set(["_category", "_localId", "_guid", "Name", "ObjectType", "Tag", "Description", ...DIMENSION_ATTRIBUTES]);

function propertyRows(set: Item, units: ModelUnits, labels?: Record<string, string>): Row[] {
  const rows: Row[] = [];
  for (const p of items(set.HasProperties)) {
    const name = text(p, "Name");
    const nominal = attr(p, "NominalValue");
    if (!name || !nominal) continue;
    const value = formatValue(nominal.value, nominal.type ? MEASURE_OF_TYPE[nominal.type] : undefined, units);
    if (value !== null) rows.push({ label: labels?.[name] ?? humanize(name), value });
  }
  for (const q of items(set.Quantities)) {
    const name = text(q, "Name");
    if (!name) continue;
    for (const [field, measure] of QUANTITY_FIELDS) {
      const value = formatValue(attr(q, field)?.value, measure, units);
      if (value !== null) {
        rows.push({ label: humanize(name), value });
        break;
      }
    }
  }
  return rows;
}

export function readElement(element: Item, units: ModelUnits): ElementDetails {
  const ifcClass = category(element);
  const name = text(element, "Name");
  const objectType = text(element, "ObjectType");
  const parent = items(element.Decomposes)[0];

  const summary: Row[] = [];
  if (objectType && name && withoutElementId(name) !== withoutElementId(objectType)) summary.push({ label: "Type", value: withoutElementId(objectType) });
  const level = items(element.ContainedInStructure)[0] ?? (parent ? items(parent.ContainedInStructure)[0] : undefined);
  if (level) summary.push({ label: "Level", value: text(level, "Name") ?? text(level, "LongName") ?? "—" });
  const materials = materialNames(element);
  if (materials.length) summary.push({ label: materials.length > 1 ? "Materials" : "Material", value: materials.join("\n") });
  if (parent) {
    const parentName = text(parent, "LongName") ?? text(parent, "ObjectType") ?? text(parent, "Name");
    summary.push({ label: "Part of", value: `${categoryName(category(parent))}${parentName ? `: ${withoutElementId(parentName)}` : ""}` });
  }
  const description = text(element, "Description");
  if (description) summary.push({ label: "Description", value: description });

  // The element's own dimensions first, then its measured quantities.
  const quantities: Row[] = [];
  for (const key of DIMENSION_ATTRIBUTES) {
    const a = attr(element, key);
    const value = a && formatValue(a.value, a.type ? MEASURE_OF_TYPE[a.type] : "length", units);
    if (value) quantities.push({ label: humanize(key), value });
  }
  const groups: Group[] = [];
  for (const set of items(element.IsDefinedBy)) {
    const setLabel = text(set, "Name") ?? "Properties";
    const conkit = setLabel === CONKIT_SET;
    const rows = propertyRows(set, units, conkit ? CONKIT_LABELS : undefined);
    if (!rows.length) continue;
    if (category(set) === "IFCELEMENTQUANTITY") quantities.push(...rows);
    else groups.push({ name: setName(setLabel), rows, open: conkit || /Common$/.test(setLabel) });
  }
  // conkit's set, then the standard "…Common" set: they carry what most people look for.
  const rank = (g: Group) => (g.name === setName(CONKIT_SET) ? 2 : g.open ? 1 : 0);
  groups.sort((a, b) => rank(b) - rank(a));

  const identity: Row[] = [{ label: "IFC class", value: ifcClass }];
  const guid = text(element, "_guid");
  if (guid) identity.push({ label: "GlobalId", value: guid, mono: true });
  const tag = text(element, "Tag");
  if (tag) identity.push({ label: "Tag", value: tag, mono: true });
  for (const [key, v] of Object.entries(element)) {
    if (NOT_SHOWN.has(key) || !isItem(v) || !("value" in v)) continue;
    const value = formatValue(v.value, typeof v.type === "string" ? MEASURE_OF_TYPE[v.type] : undefined, units);
    if (value !== null) identity.push({ label: humanize(key), value });
  }

  return {
    title: withoutElementId(name ?? objectType ?? categoryName(ifcClass)),
    category: categoryName(ifcClass),
    summary,
    quantities,
    groups,
    identity,
  };
}
