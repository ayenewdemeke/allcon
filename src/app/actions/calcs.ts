"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, isUuid, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deleteFiles } from "@/lib/storage";

const name = z.string().trim().min(1, "Give the worksheet a name").max(200);
const system = z.enum(["USCS", "SI"]).catch("USCS");

export type CalcFormState = { error?: string };

/** A new, empty worksheet, opened in the editor. */
export async function createCalc(_prev: CalcFormState, formData: FormData): Promise<CalcFormState> {
  const user = await requireUser();
  const parsed = name.safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const calc = await db.calc.create({ data: { orgId: user.orgId, name: parsed.data, createdById: user.id } });
  revalidatePath("/calcs");
  redirect(`/calcs/${calc.id}?system=${system.parse(formData.get("system"))}`);
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
