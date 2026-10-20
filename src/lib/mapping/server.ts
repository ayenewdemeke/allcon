import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { modelElements } from "@/lib/ifc/elements";
import { modelSpecSchema } from "@/lib/ifc/spec";
import { workerElements } from "@/lib/ifc/worker";
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

/** Where elements come from: an uploaded model version, or a model an AI app built. */
export type ElementSource = { kind: "upload" | "built"; id: string };

/** The models whose quantities count: the latest uploaded version and the AI-built models, each unless switched off. */
export type ModelScope = {
  sources: ElementSource[];
  upload: { id: string; fileName: string } | null;
  built: { id: string; name: string }[];
};

const sourceWhere = (s: ElementSource) => (s.kind === "upload" ? { modelVersionId: s.id } : { ifcModelId: s.id });

function scopeSql(scope: ModelScope) {
  const versions = scope.sources.filter((s) => s.kind === "upload").map((s) => s.id);
  const built = scope.sources.filter((s) => s.kind === "built").map((s) => s.id);
  return Prisma.sql`(e.model_version_id = ANY(${versions}::uuid[]) OR e.ifc_model_id = ANY(${built}::uuid[]))`;
}

/** A Prisma filter for the elements of the counted models. */
export function elementsIn(scope: ModelScope) {
  return { OR: scope.sources.map(sourceWhere) };
}

/** "Structural model, Revit upload.rvt" */
export const modelNames = (scope: ModelScope) => [...(scope.upload ? [scope.upload.fileName] : []), ...scope.built.map((m) => m.name)].join(", ");

/** The newest uploaded model version that finished processing. */
export function currentModelVersion(projectId: string) {
  return db.modelVersion.findFirst({
    where: { projectId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
  });
}

/**
 * Reads an AI-built model's elements for its current revision, if they're not already read,
 * and re-applies the project's rules to them. Elements keep their GlobalIds across
 * revisions, so mapping follows the model as it changes.
 */
export async function ensureModelElements(model: { id: string; projectId: string; revision: number; elementsRevision: number | null }) {
  if (model.elementsRevision === model.revision) return;
  // Claim the work so two page loads don't read the same revision at once.
  const { count } = await db.ifcModel.updateMany({
    where: { id: model.id, revision: model.revision, OR: [{ elementsRevision: null }, { elementsRevision: { not: model.revision } }] },
    data: { elementsRevision: model.revision },
  });
  if (!count) return;
  try {
    const full = await db.ifcModel.findUniqueOrThrow({ where: { id: model.id }, select: { kind: true, spec: true, ifcGz: true } });
    const rows =
      full.kind === "ifc" && full.ifcGz
        ? (await workerElements(full.ifcGz)).map((r) => ({ ...r, quantitySource: r.quantitySource }))
        : modelElements(model.id, modelSpecSchema.parse(full.spec)).map((r) => ({ ...r, quantitySource: "geometry" as const }));
    await db.$transaction([
      db.element.deleteMany({ where: { ifcModelId: model.id } }),
      db.element.createMany({
        data: rows.map((r) => ({
          ifcModelId: model.id,
          stableId: r.stableId,
          category: r.category,
          typeName: r.typeName,
          level: r.level,
          quantities: r.quantities,
          quantitySource: r.quantitySource,
          properties: r.properties,
        })),
        skipDuplicates: true,
      }),
    ]);
    await applyAllRules(model.projectId, { kind: "built", id: model.id });
  } catch (err) {
    await db.ifcModel.updateMany({ where: { id: model.id, elementsRevision: model.revision }, data: { elementsRevision: null } });
    throw err;
  }
}

/** The models that count toward quantities, with AI-built models' elements brought up to date. */
export async function countedModels(projectId: string): Promise<ModelScope> {
  const [project, upload, built] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: projectId }, select: { countUploads: true } }),
    currentModelVersion(projectId),
    db.ifcModel.findMany({
      where: { projectId, countInQuantities: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, projectId: true, name: true, revision: true, elementsRevision: true },
    }),
  ]);
  const ready: { id: string; name: string }[] = [];
  for (const m of built) {
    try {
      await ensureModelElements(m);
      ready.push({ id: m.id, name: m.name });
    } catch (err) {
      console.error(`Could not read the elements of model ${m.id}`, err); // left out until it can be read
    }
  }
  const countedUpload = project.countUploads && upload ? { id: upload.id, fileName: upload.fileName } : null;
  return {
    upload: countedUpload,
    built: ready,
    sources: [...(countedUpload ? [{ kind: "upload" as const, id: countedUpload.id }] : []), ...ready.map((m) => ({ kind: "built" as const, id: m.id }))],
  };
}

export type ElementGroup = GroupConditions & {
  count: number;
  missing: number; // elements without any usable quantity
  assemblyCode: string | null;
  assemblyDescription: string | null;
  quantities: { volume?: number; area?: number; length?: number; perimeter?: number };
  mappedElements: number;
  /** The models the group's elements come from. */
  sources: ElementSource[];
};

/** Elements of the counted models grouped by category + type, with totals (SI). */
export async function elementGroups(scope: ModelScope): Promise<ElementGroup[]> {
  if (!scope.sources.length) return [];
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
      perimeter: number | null;
      mapped: number;
      versions: string[] | null;
      built: string[] | null;
    }[]
  >`
    SELECT e.category, e.type_name, count(*)::int AS n,
      count(*) FILTER (WHERE e.quantity_source = 'missing')::int AS missing,
      mode() WITHIN GROUP (ORDER BY e.properties->>'Assembly Code') AS assembly_code,
      mode() WITHIN GROUP (ORDER BY e.properties->>'Assembly Description') AS assembly_description,
      sum((e.quantities->>'volume')::float) AS volume,
      sum((e.quantities->>'area')::float) AS area,
      sum((e.quantities->>'length')::float) AS length,
      sum((e.quantities->>'perimeter')::float) AS perimeter,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM element_mapping m WHERE m.element_id = e.id))::int AS mapped,
      array_agg(DISTINCT e.model_version_id::text) FILTER (WHERE e.model_version_id IS NOT NULL) AS versions,
      array_agg(DISTINCT e.ifc_model_id::text) FILTER (WHERE e.ifc_model_id IS NOT NULL) AS built
    FROM element e
    WHERE ${scopeSql(scope)}
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
      ...(r.perimeter ? { perimeter: r.perimeter } : {}),
    },
    mappedElements: r.mapped,
    sources: [...(r.versions ?? []).map((id) => ({ kind: "upload" as const, id })), ...(r.built ?? []).map((id) => ({ kind: "built" as const, id }))],
  }));
}

/**
 * Creates element mappings for one rule on one model. Elements that lack the rule's
 * quantity are left unmapped (they surface in the validation report).
 */
export async function applyRule(rule: { id: string; lineItemId: string; quantityKey: string; conditions: unknown }, source: ElementSource) {
  const { category, typeName } = rule.conditions as GroupConditions;
  if (!(rule.quantityKey in KEY_DIMENSION)) throw new Error(`Unknown quantity key: ${rule.quantityKey}`);
  await db.elementMapping.deleteMany({ where: { ruleId: rule.id, element: sourceWhere(source) } });
  const column = source.kind === "upload" ? "model_version_id" : "ifc_model_id";
  // The key is one of the fixed names in KEY_DIMENSION (checked above); all values are bound parameters.
  const quantity = rule.quantityKey === "count" ? "1" : `(e.quantities->>'${rule.quantityKey}')::numeric`;
  return db.$executeRawUnsafe(
    `INSERT INTO element_mapping (id, element_id, line_item_id, quantity, quantity_key, source, rule_id)
     SELECT gen_random_uuid(), e.id, $1::uuid, ${quantity}, $2, 'rule', $3::uuid
     FROM element e
     WHERE e.${column} = $4::uuid
       AND e.category IS NOT DISTINCT FROM $5
       AND e.type_name IS NOT DISTINCT FROM $6
       AND ($2 = 'count' OR e.quantities ? $2)
     ON CONFLICT (element_id, line_item_id) DO NOTHING`,
    rule.lineItemId,
    rule.quantityKey,
    rule.id,
    source.id,
    category,
    typeName,
  );
}

/** Re-applies every rule of the project to a model (e.g. a new version or revision). */
export async function applyAllRules(projectId: string, source: ElementSource) {
  const rules = await db.mappingRule.findMany({ where: { projectId }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  await db.elementMapping.deleteMany({ where: { source: "rule", element: sourceWhere(source) } });
  for (const rule of rules) await applyRule(rule, source);
}

export async function createRule(input: {
  projectId: string;
  scope: ModelScope;
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
  // A rule applies to matching groups in every counted model.
  for (const source of input.scope.sources) await applyRule(rule, source);
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
export async function measuredQuantities(projectId: string, scope: ModelScope) {
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

  if (scope.sources.length) {
    const sums = await db.$queryRaw<{ line_item_id: string; quantity_key: string; total: number; n: number }[]>`
      SELECT m.line_item_id, m.quantity_key, sum(m.quantity)::float AS total, count(*)::int AS n
      FROM element_mapping m JOIN element e ON e.id = m.element_id
      WHERE ${scopeSql(scope)}
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
