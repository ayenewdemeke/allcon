import { parseQuantity } from "@/lib/quantities";

export type RawObject = {
  objectid: number;
  externalId?: string;
  name?: string;
  properties?: Record<string, Record<string, unknown>>;
};

export type TreeNode = { objectid: number; name?: string; objects?: TreeNode[] };

export type NormalizedElement = {
  stableId: string;
  dbId: number;
  category: string | null;
  typeName: string | null;
  level: string | null;
  quantities: Record<string, number>;
  quantitySource: "qto_set" | "property" | "geometry" | "missing";
  properties: Record<string, string>;
};

/**
 * Maps every leaf object id to its category, taken from the top-level branch of the
 * view's object tree ("Walls", "Floors", ...). Revit's properties don't carry the
 * category, so the tree is the only place it appears.
 */
export function categoriesByObjectId(objects: TreeNode[]) {
  const result = new Map<number, string>();
  const root = objects[0];
  for (const branch of root?.objects ?? []) {
    const category = branch.name ?? null;
    const stack: TreeNode[] = [branch];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.objects?.length) stack.push(...node.objects);
      else if (category) result.set(node.objectid, category);
    }
  }
  return result;
}

// Property names that hold an element's level, most specific first.
const LEVEL_KEYS = [
  ["Constraints", "Base Constraint"],
  ["Constraints", "Reference Level"],
  ["Constraints", "Level"],
  ["Constraints", "Base Level"],
  ["Constraints", "Schedule Level"],
  ["Constraints", "Host"],
] as const;

// Quantity properties worth keeping, mapped to the canonical key a mapping rule names.
// Earlier entries win when several properties feed the same key.
const QUANTITY_KEYS = [
  ["Dimensions", "Volume", "volume"],
  ["Dimensions", "Area", "area"],
  ["Dimensions", "Length", "length"],
  ["Structural", "Cut Length", "length"],
  ["Dimensions", "Perimeter", "perimeter"],
  ["Dimensions", "Thickness", "thickness"],
  ["Construction", "Thickness", "thickness"],
  ["Dimensions", "Height", "height"],
  ["Constraints", "Unconnected Height", "height"],
  ["Dimensions", "Width", "width"],
] as const;

// IFC quantity sets are authoritative when a model carries them.
const IFC_QUANTITY_GROUPS = /^Qto_|BaseQuantities/;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

export function normalizeObject(raw: RawObject, category: string | null): NormalizedElement | null {
  if (!raw.externalId) return null;
  const props = raw.properties ?? {};

  const quantities: Record<string, number> = { count: 1 };
  let source: NormalizedElement["quantitySource"] = "missing";

  // 1. IFC quantity sets, when present.
  for (const [group, values] of Object.entries(props)) {
    if (!IFC_QUANTITY_GROUPS.test(group)) continue;
    for (const [key, value] of Object.entries(values)) {
      const parsed = parseQuantity(value);
      if (!parsed) continue;
      const name = key.replace(/^(Net|Gross)\s*/i, "").toLowerCase();
      if (quantities[name] === undefined) {
        quantities[name] = parsed.value;
        source = "qto_set";
      }
    }
  }

  // 2. Named properties (Revit parameters), unless a quantity set already supplied them.
  if (source !== "qto_set") {
    for (const [group, key, name] of QUANTITY_KEYS) {
      const parsed = parseQuantity(props[group]?.[key]);
      if (!parsed) continue;
      if (quantities[name] === undefined) {
        quantities[name] = parsed.value;
        source = "property";
      }
    }
  }

  const level = LEVEL_KEYS.reduce<string | null>(
    (found, [group, key]) => found ?? text(props[group]?.[key]),
    null,
  );

  // Kept for classification-based mapping: Revit's Assembly Code is UNIFORMAT.
  const identity = props["Identity Data"] ?? {};
  const properties: Record<string, string> = {};
  for (const key of ["Assembly Code", "Assembly Description", "Type Mark", "Mark", "Description"]) {
    const value = text(identity[key]);
    if (value) properties[key] = value;
  }
  const ifcGuid = text(props["IFC Parameters"]?.["IfcGUID"]);
  if (ifcGuid) properties["IfcGUID"] = ifcGuid;

  return {
    stableId: raw.externalId,
    dbId: raw.objectid,
    category,
    // Fall back to the instance name ("Basic Wall [141237]") minus its element id.
    typeName: text(identity["Type Name"]) ?? text(raw.name)?.replace(/\s*\[\d+\]$/, "") ?? null,
    level,
    quantities,
    quantitySource: source,
    properties,
  };
}

/** Turns a raw properties collection plus object tree into element rows. */
export function normalizeElements(collection: RawObject[], tree: TreeNode[]) {
  const categories = categoriesByObjectId(tree);
  const elements: NormalizedElement[] = [];
  for (const raw of collection) {
    // Objects missing from the tree's leaves are type/family nodes, not real elements.
    const category = categories.get(raw.objectid);
    if (!category) continue;
    const element = normalizeObject(raw, category);
    if (element) elements.push(element);
  }
  return elements;
}
