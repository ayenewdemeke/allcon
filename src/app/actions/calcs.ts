"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, isUuid, requireUser } from "@/lib/auth/session";
import { findTemplate } from "@/lib/calcs/library/templates";
import { db } from "@/lib/db";
import { deleteFiles } from "@/lib/storage";
import { ToolError } from "@/lib/tools/context";
import { publishCalc } from "@/lib/tools/calcs";

const name = z.string().trim().min(1, "Give the worksheet a name").max(200);
const system = z.enum(["USCS", "SI"]).catch("USCS");

export type CalcFormState = { error?: string };

/** A project of the user's organization, or null. */
async function orgProject(orgId: string, projectId: unknown) {
  if (typeof projectId !== "string" || !isUuid(projectId)) return null;
  return db.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
}

/** A new worksheet (empty, or from a template), opened in the editor. */
export async function createCalc(_prev: CalcFormState, formData: FormData): Promise<CalcFormState> {
  const user = await requireUser();
  const parsed = name.safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const project = await orgProject(user.orgId, formData.get("project"));
  const calc = await db.calc.create({ data: { orgId: user.orgId, projectId: project?.id ?? null, name: parsed.data, createdById: user.id } });
  revalidatePath("/calcs");
  const template = findTemplate(String(formData.get("template") ?? ""));
  redirect(`/calcs/${calc.id}?system=${system.parse(formData.get("system"))}${template ? `&template=${template.id}` : ""}`);
}

async function ownCalc(calcId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(calcId)) throw new Error("Worksheet not found");
  const calc = await db.calc.findFirst({ where: { id: calcId, orgId: user.orgId }, select: { id: true, fileKey: true } });
  if (!calc) throw new Error("Worksheet not found");
  return calc;
}

export async function renameCalc(calcId: string, newName: string) {
  const calc = await ownCalc(calcId);
  const parsed = name.safeParse(newName);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  await db.calc.update({ where: { id: calc.id }, data: { name: parsed.data } });
  revalidatePath("/calcs", "layout");
}

export async function deleteCalc(calcId: string) {
  const calc = await ownCalc(calcId);
  await db.calc.delete({ where: { id: calc.id } });
  await deleteFiles([calc.fileKey]).catch((err) => console.error("Could not delete a worksheet's file", err));
  revalidatePath("/calcs");
}

/** Files a worksheet under a project (or under none). */
export async function setCalcProject(calcId: string, projectId: string | null) {
  const user = await requireUser();
  const calc = await ownCalc(calcId);
  const project = projectId ? await orgProject(user.orgId, projectId) : null;
  if (projectId && !project) throw new Error("Project not found");
  await db.calc.update({ where: { id: calc.id }, data: { projectId: project?.id ?? null } });
  revalidatePath("/calcs");
}

/** Prints the saved worksheet to a PDF and adds it to its project's Sheets. */
export async function publishCalcToSheets(calcId: string): Promise<{ link: string; sheets: number } | { error: string }> {
  const user = await requireUser();
  const calc = await ownCalc(calcId);
  try {
    const result = await publishCalc({ userId: user.id, orgId: user.orgId, clientId: null }, calc.id);
    revalidatePath(`/projects/${result.projectId}/sheets`);
    return { link: result.link, sheets: result.sheets };
  } catch (err) {
    if (err instanceof ToolError) return { error: err.message };
    throw err;
  }
}

/** A worksheet for an imported file (Mathcad Prime, SMath Studio): the browser reads the file and
 * saves its regions into it. */
export async function createImportedCalc(fileName: string, projectId: string | null): Promise<{ id: string }> {
  const user = await requireUser();
  const parsed = name.safeParse(fileName.replace(/\.(mcdx|sm)$/i, "") || "Imported worksheet");
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  const project = projectId ? await orgProject(user.orgId, projectId) : null;
  const calc = await db.calc.create({ data: { orgId: user.orgId, projectId: project?.id ?? null, name: parsed.data, createdById: user.id } });
  revalidatePath("/calcs");
  return { id: calc.id };
}

/** The worksheets to switch between, from inside the editor (most recently changed first). */
export async function listCalcsForSwitcher() {
  const user = await requireUser();
  const calcs = await db.calc.findMany({
    where: { orgId: user.orgId },
    orderBy: { updatedAt: "desc" },
    take: 300,
    select: { id: true, name: true, updatedAt: true, project: { select: { name: true } } },
  });
  return calcs.map((c) => ({ id: c.id, name: c.name, project: c.project?.name ?? null, updated: c.updatedAt.toISOString() }));
}

/** A new, blank worksheet from inside the editor (filed with the one open, if any). */
export async function createBlankCalc(projectId: string | null): Promise<{ id: string }> {
  const user = await requireUser();
  const project = projectId ? await orgProject(user.orgId, projectId) : null;
  const calc = await db.calc.create({ data: { orgId: user.orgId, projectId: project?.id ?? null, name: "Untitled worksheet", createdById: user.id } });
  revalidatePath("/calcs");
  return { id: calc.id };
}
