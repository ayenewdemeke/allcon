"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { removeModel } from "@/lib/tools/models3d";

/** Deletes a 3D model and its files. */
export async function deleteIfcModel(modelId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(modelId)) throw new Error("Model not found");
  const model = await removeModel(user.orgId, modelId);
  if (!model) throw new Error("Model not found");
  revalidatePath(`/projects/${model.projectId}/models`);
}

/** Whether a model's quantities count toward the SOV / BoQ: an AI-built model, or the project's uploads. */
export async function setModelCounted(projectId: string, target: { kind: "upload" | "built"; id?: string }, counted: boolean) {
  const user = await getCurrentUser();
  if (!user || !isUuid(projectId)) throw new Error("Project not found");
  if (target.kind === "upload") {
    const { count } = await db.project.updateMany({ where: { id: projectId, orgId: user.orgId }, data: { countUploads: counted } });
    if (!count) throw new Error("Project not found");
  } else {
    const { count } = await db.ifcModel.updateMany({
      where: { id: target.id && isUuid(target.id) ? target.id : "", projectId, project: { orgId: user.orgId } },
      data: { countInQuantities: counted },
    });
    if (!count) throw new Error("Model not found");
  }
  revalidatePath(`/projects/${projectId}`, "layout");
}
