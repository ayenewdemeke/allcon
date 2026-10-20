import "server-only";
import { db } from "@/lib/db";
import { unitDimension } from "@/lib/line-items/units";
import { countedModels, createRule, elementGroups, KEY_DIMENSION, measuredQuantities, modelNames, type GroupConditions } from "@/lib/mapping/server";
import { suggest, type QuantityKey } from "@/lib/mapping/suggest";
import { formatMeasure } from "@/lib/takeoff";
import { requireProject, ToolError, type ToolContext } from "./context";

// Mapping for AI apps: the element groups of the models that count (with conkit's own
// suggestions), the SOV / BoQ items, and turning a group into a rule that prices an item.

const MAX_GROUPS = 300;

/** The project's element groups and SOV / BoQ items, for mapping one to the other. */
export async function listElementGroups(ctx: ToolContext, projectId: string, onlyUnmapped: boolean) {
  const project = await requireProject(ctx, projectId);
  const scope = await countedModels(project.id);
  const [groups, items, rules] = await Promise.all([
    elementGroups(scope),
    db.lineItem.findMany({ where: { projectId: project.id, isHeading: false }, orderBy: { sortOrder: "asc" } }),
    db.mappingRule.findMany({ where: { projectId: project.id }, include: { lineItem: { select: { code: true, description: true } } } }),
  ]);
  if (!scope.sources.length) throw new ToolError("No model counts toward quantities yet: upload one, build one from the drawings, or switch one on in Models.");
  const names = new Map<string, string>([...(scope.upload ? [[scope.upload.id, scope.upload.fileName] as [string, string]] : []), ...scope.built.map((m) => [m.id, m.name] as [string, string])]);
  const forSuggestion = items.map((i) => ({ id: i.id, code: i.code, description: i.description, unit: i.unit }));
  const itemLabel = new Map(items.map((i) => [i.id, [i.code, i.description].filter(Boolean).join(" ")]));
  const key = (g: GroupConditions) => `${g.category ?? ""}\u0000${g.typeName ?? ""}`;
  const rulesBy = new Map<string, typeof rules>();
  for (const r of rules) rulesBy.set(key(r.conditions as GroupConditions), [...(rulesBy.get(key(r.conditions as GroupConditions)) ?? []), r]);

  const rows = groups
    .map((g) => {
      const mapped = rulesBy.get(key(g)) ?? [];
      const s = mapped.length ? null : suggest(g, forSuggestion);
      return {
        category: g.category,
        type_name: g.typeName,
        elements: g.count,
        quantities: Object.fromEntries(
          (["volume", "area", "length", "perimeter"] as const)
            .filter((k) => g.quantities[k])
            .map((k) => [k, formatMeasure(g.quantities[k]!, KEY_DIMENSION[k], project.unitSystem)]),
        ),
        models: g.sources.map((s) => names.get(s.id)).filter(Boolean),
        mapped_to: mapped.map((r) => ({ item: itemLabel.get(r.lineItemId) ?? r.lineItem.description, quantity: r.quantityKey })),
        suggestion: s ? { item_id: s.lineItemId, item: itemLabel.get(s.lineItemId), quantity: s.quantityKey, confidence: Math.round(s.score * 100) / 100 } : null,
      };
    })
    .filter((g) => !onlyUnmapped || !g.mapped_to.length);

  return {
    projectId: project.id,
    models: modelNames(scope),
    note: "Quantities are totals per group. Map a group with map_groups using its category and type_name exactly as given, an item_id, and the quantity that matches the item's unit.",
    groups: rows.slice(0, MAX_GROUPS),
    more: Math.max(0, rows.length - MAX_GROUPS),
    items: items.map((i) => ({ item_id: i.id, code: i.code, description: i.description, unit: i.unit })),
    link: `/projects/${project.id}/mapping`,
  };
}

/** Maps element groups to SOV / BoQ items as rules (which carry over as the models change). */
export async function mapGroups(
  ctx: ToolContext,
  projectId: string,
  mappings: { category: string | null; type_name: string | null; item_id: string; quantity: QuantityKey }[],
) {
  const project = await requireProject(ctx, projectId);
  const scope = await countedModels(project.id);
  const items = new Map((await db.lineItem.findMany({ where: { projectId: project.id, isHeading: false } })).map((i) => [i.id, i]));
  const created: string[] = [];
  const skipped: string[] = [];
  for (const m of mappings) {
    const item = items.get(m.item_id);
    const what = `${m.category ?? "?"} · ${m.type_name ?? "?"}`;
    if (!item) throw new ToolError(`Item ${m.item_id} isn't in this project's SOV / BoQ. Use list_element_groups to see the items and their ids.`);
    // The quantity has to be the kind of thing the item is measured in.
    const dim = unitDimension(item.unit);
    const fits = m.quantity === "count" ? dim === "count" || dim === "lump" : dim === KEY_DIMENSION[m.quantity];
    if (!fits) throw new ToolError(`${what}: "${item.description}" is measured in ${item.unit ?? "no unit"}, so it can't take the group's ${m.quantity}.`);
    const conditions = { category: m.category, typeName: m.type_name };
    const existing = await db.mappingRule.findFirst({ where: { projectId: project.id, lineItemId: item.id, conditions: { equals: conditions } } });
    if (existing) {
      skipped.push(`${what} → ${item.description} (already mapped)`);
      continue;
    }
    const rule = await createRule({ projectId: project.id, scope, conditions, lineItemId: item.id, quantityKey: m.quantity, isAuto: false, userId: ctx.userId });
    created.push(rule.id);
  }
  // What the mapped items now measure, so the app can check against the contract quantities.
  const measured = await measuredQuantities(project.id, scope);
  const touched = [...new Set(mappings.map((m) => m.item_id))].map((id) => {
    const item = items.get(id)!;
    const m = measured.get(id);
    return {
      item: [item.code, item.description].filter(Boolean).join(" "),
      unit: item.unit,
      contract: item.contractQuantity === null ? null : Number(item.contractQuantity),
      measured_from_model: m?.model === null || m?.model === undefined ? null : Math.round(m.model * 1000) / 1000,
      elements: m?.elements ?? 0,
      issues: m?.issues ?? [],
    };
  });
  return { projectId: project.id, created: created.length, ruleIds: created, skipped, items: touched, link: `/projects/${project.id}/mapping` };
}
