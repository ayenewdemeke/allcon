"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, isUuid, requireProject } from "@/lib/auth/session";
import { unitDimension } from "@/lib/line-items/units";
import { createRule, currentModelVersion } from "@/lib/mapping/server";

const groupMapping = z.object({
  category: z.string().nullable(),
  typeName: z.string().nullable(),
  lineItemId: z.uuid(),
  quantityKey: z.enum(["volume", "area", "length", "count"]),
});

const refresh = (projectId: string) => revalidatePath(`/projects/${projectId}`, "layout");

async function requireLineItemIn(projectId: string, lineItemId: string) {
  const item = await db.lineItem.findFirst({ where: { id: lineItemId, projectId, isHeading: false } });
  if (!item) throw new Error("Line item not found");
  return item;
}

/** Maps every element of a group (category + type) to a line item, as a reusable rule. */
export async function mapGroups(projectId: string, input: { mappings: unknown[]; fromSuggestions?: boolean }) {
  const { project, user } = await requireProject(projectId);
  const mappings = z.array(groupMapping).min(1).max(500).parse(input.mappings);
  const version = await currentModelVersion(project.id);
  for (const m of mappings) {
    await requireLineItemIn(project.id, m.lineItemId);
    const existing = await db.mappingRule.findFirst({
      where: { projectId: project.id, lineItemId: m.lineItemId, conditions: { equals: { category: m.category, typeName: m.typeName } } },
    });
    if (existing) continue; // already mapped this way
    await createRule({
      projectId: project.id,
      modelVersionId: version?.id ?? null,
      conditions: { category: m.category, typeName: m.typeName },
      lineItemId: m.lineItemId,
      quantityKey: m.quantityKey,
      isAuto: Boolean(input.fromSuggestions),
      userId: user.id,
    });
  }
  refresh(project.id);
}

export async function removeRule(ruleId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(ruleId)) throw new Error("Rule not found");
  const rule = await db.mappingRule.findFirst({ where: { id: ruleId, project: { orgId: user.orgId } } });
  if (!rule) throw new Error("Rule not found");
  await db.$transaction([
    db.elementMapping.deleteMany({ where: { ruleId } }),
    db.mappingRule.delete({ where: { id: ruleId } }),
  ]);
  refresh(rule.projectId);
}

// Which markup kinds can price a line item in a given unit.
const FITS: Record<string, string[]> = {
  length: ["length"],
  area: ["area", "volume"], // an area needs a depth to price a volume line
  count: ["count", "lump"],
};

/** Assigns a 2D measurement to a line item (or clears it). */
export async function setMarkupLineItem(markupId: string, lineItemId: string | null) {
  const user = await getCurrentUser();
  if (!user || !isUuid(markupId)) throw new Error("Markup not found");
  const markup = await db.markup.findFirst({
    where: { id: markupId, sheet: { drawingSet: { project: { orgId: user.orgId } } } },
    include: { sheet: { include: { drawingSet: true } } },
  });
  if (!markup) throw new Error("Markup not found");

  if (lineItemId) {
    const item = await requireLineItemIn(markup.sheet.drawingSet.projectId, lineItemId);
    const dim = unitDimension(item.unit);
    if (!dim || !FITS[markup.kind]?.includes(dim)) {
      throw new Error(`A ${markup.kind} measurement can't price a line measured in ${item.unit ?? "no unit"}`);
    }
    if (dim === "volume" && !markup.depth) throw new Error("Add a depth to this area to price a volume line");
  }
  await db.markup.update({ where: { id: markupId }, data: { lineItemId } });
  refresh(markup.sheet.drawingSet.projectId);
}
