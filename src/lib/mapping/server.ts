import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { toLineItemUnit, unitDimension } from "@/lib/line-items/units";
import { measureMarkup, type Point } from "@/lib/takeoff";
import type { QuantityKey } from "./suggest";

// Element quantity keys a rule may use, and what each one measures.
export const KEY_DIMENSION: Record<string, "volume" | "area" | "length" | "count"> = {
  volume: "volume",
  area: "area",
  length: "length",
  perimeter: "length",
  height: "length",
  width: "length",
  thickness: "length",
  count: "count",
};

export type GroupConditions = { category: string | null; typeName: string | null };

/** The model version quantities come from: the newest one that finished processing. */
export function currentModelVersion(projectId: string) {
  return db.modelVersion.findFirst({
    where: { projectId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
  });
}

export type ElementGroup = GroupConditions & {
  count: number;
  missing: number; // elements without any usable quantity
  assemblyCode: string | null;
  assemblyDescription: string | null;
  quantities: { volume?: number; area?: number; length?: number };
  mappedElements: number;
};

/** Elements of a model version grouped by category + type, with totals (SI). */
export async function elementGroups(modelVersionId: string): Promise<ElementGroup[]> {
  const rows = await db.$queryRaw<
    {
      category: string | null;
      type_name: string | null;
      n: number;
      missing: number;
      assembly_code: string | null;
      assembly_description: string | null;
      volume: number | null;
      area: number | null;
      length: number | null;
      mapped: number;
    }[]
  >`
    SELECT e.category, e.type_name, count(*)::int AS n,
      count(*) FILTER (WHERE e.quantity_source = 'missing')::int AS missing,
      mode() WITHIN GROUP (ORDER BY e.properties->>'Assembly Code') AS assembly_code,
      mode() WITHIN GROUP (ORDER BY e.properties->>'Assembly Description') AS assembly_description,
      sum((e.quantities->>'volume')::float) AS volume,
      sum((e.quantities->>'area')::float) AS area,
      sum((e.quantities->>'length')::float) AS length,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM element_mapping m WHERE m.element_id = e.id))::int AS mapped
    FROM element e
    WHERE e.model_version_id = ${modelVersionId}::uuid
    GROUP BY e.category, e.type_name
    ORDER BY n DESC, e.category, e.type_name`;
  return rows.map((r) => ({
    category: r.category,
    typeName: r.type_name,
    count: r.n,
    missing: r.missing,
    assemblyCode: r.assembly_code,
    assemblyDescription: r.assembly_description,
    quantities: {
      ...(r.volume ? { volume: r.volume } : {}),
      ...(r.area ? { area: r.area } : {}),
      ...(r.length ? { length: r.length } : {}),
    },
    mappedElements: r.mapped,
  }));
}

/**
 * Creates element mappings for one rule on one model version. Elements that lack the
 * rule's quantity are left unmapped (they surface in the validation report).
 */
export async function applyRule(
  rule: { id: string; lineItemId: string; quantityKey: string; conditions: unknown },
  modelVersionId: string,
) {
  const { category, typeName } = rule.conditions as GroupConditions;
  if (!(rule.quantityKey in KEY_DIMENSION)) throw new Error(`Unknown quantity key: ${rule.quantityKey}`);
  await db.elementMapping.deleteMany({ where: { ruleId: rule.id, element: { modelVersionId } } });
  // The key is one of the fixed names in KEY_DIMENSION (checked above); all values are bound parameters.
  const quantity = rule.quantityKey === "count" ? "1" : `(e.quantities->>'${rule.quantityKey}')::numeric`;
  return db.$executeRawUnsafe(
    `INSERT INTO element_mapping (id, element_id, line_item_id, quantity, quantity_key, source, rule_id)
     SELECT gen_random_uuid(), e.id, $1::uuid, ${quantity}, $2, 'rule', $3::uuid
     FROM element e
     WHERE e.model_version_id = $4::uuid
       AND e.category IS NOT DISTINCT FROM $5
       AND e.type_name IS NOT DISTINCT FROM $6
       AND ($2 = 'count' OR e.quantities ? $2)
     ON CONFLICT (element_id, line_item_id) DO NOTHING`,
    rule.lineItemId,
    rule.quantityKey,
    rule.id,
    modelVersionId,
    category,
    typeName,
  );
}

/** Re-applies every rule of the project to a model version (e.g. a new revision). */
export async function applyAllRules(projectId: string, modelVersionId: string) {
  const rules = await db.mappingRule.findMany({ where: { projectId }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  await db.elementMapping.deleteMany({ where: { source: "rule", element: { modelVersionId } } });
  for (const rule of rules) await applyRule(rule, modelVersionId);
}

export async function createRule(input: {
  projectId: string;
  modelVersionId: string | null;
  conditions: GroupConditions;
  lineItemId: string;
  quantityKey: QuantityKey;
  isAuto: boolean;
  userId: string;
}) {
  const priority = await db.mappingRule.count({ where: { projectId: input.projectId } });
  const rule = await db.mappingRule.create({
    data: {
      id: randomUUID(),
      projectId: input.projectId,
      priority,
      conditions: input.conditions,
      lineItemId: input.lineItemId,
      quantityKey: input.quantityKey,
      isAuto: input.isAuto,
      createdById: input.userId,
    },
  });
  if (input.modelVersionId) await applyRule(rule, input.modelVersionId);
  return rule;
}

// --- measured quantities per line item ------------------------------------------------

export type Measured = {
  model: number | null; // in the line item's unit
  drawings: number | null;
  elements: number;
  markups: number;
  issues: string[];
};



/** What the model and the drawings say each line item's quantity is. */
export async function measuredQuantities(projectId: string, modelVersionId: string | null) {
  const items = await db.lineItem.findMany({ where: { projectId, isHeading: false }, select: { id: true, unit: true } });
  const unitOf = new Map(items.map((i) => [i.id, i.unit]));
  const result = new Map<string, Measured>();
  const entry = (id: string) => {
    let m = result.get(id);
    if (!m) result.set(id, (m = { model: null, drawings: null, elements: 0, markups: 0, issues: [] }));
    return m;
  };
  const add = (m: Measured, where: "model" | "drawings", value: number | null, what: string) => {
    if (value === null) {
      if (!m.issues.includes(what)) m.issues.push(what);
      return;
    }
    m[where] = (m[where] ?? 0) + value;
  };

  if (modelVersionId) {
    const sums = await db.$queryRaw<{ line_item_id: string; quantity_key: string; total: number; n: number }[]>`
      SELECT m.line_item_id, m.quantity_key, sum(m.quantity)::float AS total, count(*)::int AS n
      FROM element_mapping m JOIN element e ON e.id = m.element_id
      WHERE e.model_version_id = ${modelVersionId}::uuid
      GROUP BY m.line_item_id, m.quantity_key`;
    for (const s of sums) {
      if (!unitOf.has(s.line_item_id)) continue;
      const m = entry(s.line_item_id);
      m.elements += s.n;
      const dim = KEY_DIMENSION[s.quantity_key] ?? "count";
      add(m, "model", toLineItemUnit(s.total, dim, unitOf.get(s.line_item_id) ?? null), `Model ${s.quantity_key} doesn't fit this unit`);
    }
  }

  const markups = await db.markup.findMany({
    where: { lineItemId: { not: null }, sheet: { drawingSet: { projectId } } },
    select: { lineItemId: true, kind: true, points: true, depth: true, sheet: { select: { metersPerPoint: true } } },
  });
  for (const mk of markups) {
    const id = mk.lineItemId!;
    if (!unitOf.has(id)) continue;
    const m = entry(id);
    m.markups += 1;
    const measured = measureMarkup({ kind: mk.kind, points: mk.points as Point[], depth: mk.depth }, mk.sheet.metersPerPoint);
    if (!measured) {
      if (!m.issues.includes("Sheet not scaled")) m.issues.push("Sheet not scaled");
      continue;
    }
    // An area with a depth can price an area line or a volume line.
    const unitDim = unitDimension(unitOf.get(id));
    const [value, dim] =
      measured.kind === "volume" && unitDim === "area" ? [measured.area!, "area" as const] : [measured.value, measured.kind];
    add(m, "drawings", toLineItemUnit(value, dim, unitOf.get(id) ?? null), `A ${measured.kind} measurement doesn't fit this unit`);
  }
  return result;
}
