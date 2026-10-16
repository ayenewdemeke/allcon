"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function deleteIfcModel(modelId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(modelId)) throw new Error("Model not found");
  const model = await db.ifcModel.findFirst({ where: { id: modelId, project: { orgId: user.orgId } } });
  if (!model) throw new Error("Model not found");
  await db.ifcModel.delete({ where: { id: model.id } });
  revalidatePath(`/projects/${model.projectId}/models`);
}
