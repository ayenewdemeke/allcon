"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, isUuid, requireProject } from "@/lib/auth/session";
import { normalizeUnit } from "@/lib/line-items/units";

const money = z.number().finite().nullable();

const itemInput = z.object({
  code: z.string().trim().max(60).nullable(),
  description: z.string().trim().min(1, "Description is required").max(500),
  unit: z.string().trim().max(20).nullable(),
  billingType: z.enum(["unit_price", "lump_sum"]),
  contractQuantity: money,
  rate: money,
  scheduledValue: money,
  isHeading: z.boolean(),
});

export type LineItemInput = z.infer<typeof itemInput>;

const refresh = (projectId: string) => revalidatePath(`/projects/${projectId}`, "layout");

/** Imports parsed rows. Headings become parents of the items that follow them. */
export async function importLineItems(projectId: string, input: { mode: "replace" | "append"; items: LineItemInput[] }) {
  const { project } = await requireProject(projectId);
  const { mode, items } = z
    .object({ mode: z.enum(["replace", "append"]), items: z.array(itemInput).min(1).max(5000) })
    .parse(input);

  const start =
    mode === "append"
      ? ((await db.lineItem.aggregate({ where: { projectId: project.id }, _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1
      : 0;

  let heading: string | null = null;
  const rows = items.map((item, i) => {
    const id = randomUUID();
    const parentId = item.isHeading ? null : heading;
    if (item.isHeading) heading = id;
    return {
      ...item,
      id,
      parentId,
      unit: normalizeUnit(item.unit).unit,
      projectId: project.id,
      sortOrder: start + i,
    };
  });

  await db.$transaction([
    ...(mode === "replace" ? [db.lineItem.deleteMany({ where: { projectId: project.id } })] : []),
    db.lineItem.createMany({ data: rows }),
  ]);
  refresh(project.id);
  return { imported: rows.filter((r) => !r.isHeading).length, headings: rows.filter((r) => r.isHeading).length };
}

async function requireLineItem(id: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(id)) throw new Error("Line item not found");
  const item = await db.lineItem.findFirst({ where: { id, project: { orgId: user.orgId } } });
  if (!item) throw new Error("Line item not found");
  return item;
}

export async function createLineItem(projectId: string, input: LineItemInput) {
  const { project } = await requireProject(projectId);
  const data = itemInput.parse(input);
  const last = await db.lineItem.aggregate({ where: { projectId: project.id }, _max: { sortOrder: true } });
  await db.lineItem.create({
    data: { ...data, unit: normalizeUnit(data.unit).unit, projectId: project.id, sortOrder: (last._max.sortOrder ?? -1) + 1 },
  });
  refresh(project.id);
}

export async function updateLineItem(id: string, input: LineItemInput) {
  const item = await requireLineItem(id);
  const data = itemInput.parse(input);
  await db.lineItem.update({ where: { id }, data: { ...data, unit: normalizeUnit(data.unit).unit } });
  refresh(item.projectId);
}

export async function deleteLineItem(id: string) {
  const item = await requireLineItem(id);
  await db.lineItem.delete({ where: { id } });
  refresh(item.projectId);
}
