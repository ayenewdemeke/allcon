"use server";

import { gzipSync } from "node:zlib";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, isUuid, requireUser } from "@/lib/auth/session";
import { layout } from "@/lib/calcs/library/templates";
import { CALC_FILE, newCalcKey } from "@/lib/calcs/server";
import { emptyCalc } from "@/lib/calcs/types";
import { cipInputs, designInputs, kindInfo, mseInputs } from "@/lib/design/kinds";
import { cipCalcLines } from "@/lib/design/walls/cip-calc";
import { mseCalcLines } from "@/lib/design/walls/mse-calc";
import { db } from "@/lib/db";
import { putFile } from "@/lib/storage";

const name = z.string().trim().min(1, "Give the design a name").max(200);

async function ownDesign(designId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(designId)) throw new Error("Design not found");
  const design = await db.design.findFirst({ where: { id: designId, orgId: user.orgId } });
  if (!design) throw new Error("Design not found");
  return { user, design };
}

async function orgProject(orgId: string, projectId: unknown) {
  if (typeof projectId !== "string" || !isUuid(projectId)) return null;
  return db.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
}

/** A new design of a kind, with its default inputs, opened. */
export async function createDesign(kind: string, projectId: string | null) {
  const user = await requireUser();
  const info = kindInfo(kind);
  if (!info?.available) throw new Error("That design type isn't available yet");
  const project = await orgProject(user.orgId, projectId);
  const count = await db.design.count({ where: { orgId: user.orgId, kind } });
  const design = await db.design.create({
    data: { orgId: user.orgId, projectId: project?.id ?? null, kind, name: `${info.name} ${count + 1}`, inputs: designInputs(kind, {}) as unknown as Prisma.InputJsonValue, createdById: user.id },
  });
  revalidatePath("/design");
  redirect(`/design/${design.id}`);
}

/** The design's inputs as they're edited (saved as you go). */
export async function saveDesignInputs(designId: string, inputs: unknown) {
  const { design } = await ownDesign(designId);
  const parsed = z.record(z.string(), z.unknown()).safeParse(inputs);
  if (!parsed.success) throw new Error("Invalid inputs");
  const clean = kindInfo(design.kind) ? designInputs(design.kind, parsed.data) : parsed.data;
  await db.design.update({ where: { id: design.id }, data: { inputs: clean as unknown as Prisma.InputJsonValue } });
}

export async function renameDesign(designId: string, newName: string) {
  const { design } = await ownDesign(designId);
  const parsed = name.safeParse(newName);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  await db.design.update({ where: { id: design.id }, data: { name: parsed.data } });
  revalidatePath("/design", "layout");
}

export async function setDesignProject(designId: string, projectId: string | null) {
  const { user, design } = await ownDesign(designId);
  const project = projectId ? await orgProject(user.orgId, projectId) : null;
  if (projectId && !project) throw new Error("Project not found");
  await db.design.update({ where: { id: design.id }, data: { projectId: project?.id ?? null } });
  revalidatePath("/design");
}

export async function deleteDesign(designId: string) {
  const { design } = await ownDesign(designId);
  await db.design.delete({ where: { id: design.id } });
  revalidatePath("/design");
}

/** The design written out as a Calcs worksheet (the calc package), filed with the design. */
export async function createCalcFromDesign(designId: string): Promise<{ calcId: string }> {
  const { user, design } = await ownDesign(designId);
  const lines = design.kind === "cip-cantilever-wall" ? cipCalcLines(cipInputs(design.inputs), design.name) : design.kind === "mse-wall" ? mseCalcLines(mseInputs(design.inputs), design.name) : null;
  if (!lines) throw new Error("Calc packages for this design type are coming");
  const data = emptyCalc("USCS");
  data.header = { ...data.header, title: design.name, by: user.name ?? "" };
  data.regions = layout(lines, { x: 0, y: 0 }, data.paper);
  const calc = await db.calc.create({ data: { orgId: user.orgId, projectId: design.projectId, name: `${design.name} calc`, createdById: user.id } });
  const key = newCalcKey(calc.id);
  await putFile(key, gzipSync(JSON.stringify(data)), CALC_FILE);
  await db.calc.update({ where: { id: calc.id }, data: { fileKey: key, revision: 1, regionCount: data.regions.length } });
  revalidatePath("/calcs");
  return { calcId: calc.id };
}
