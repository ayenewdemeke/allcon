"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deleteManifest } from "@/lib/aps/derivative";
import { deleteObject } from "@/lib/aps/oss";
import { placementInput } from "@/lib/maps/placement";
import { removeModel } from "@/lib/tools/models3d";

/** Deletes a 3D model and its files. */
export async function deleteIfcModel(modelId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(modelId)) throw new Error("Model not found");
  const model = await removeModel(user.orgId, modelId);
  if (!model) throw new Error("Model not found");
  revalidatePath(`/projects/${model.projectId}/models`);
}

/** Deletes an uploaded model (Revit or IFC): its elements and mappings, and its files and translation in Autodesk. */
export async function deleteUploadedModel(versionId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(versionId)) throw new Error("Model not found");
  const model = await db.modelVersion.findFirst({ where: { id: versionId, project: { orgId: user.orgId } } });
  if (!model) throw new Error("Model not found");
  await db.modelVersion.delete({ where: { id: model.id } }); // elements and their mappings go with it
  const cleanup = [
    model.objectKey && deleteObject(model.objectKey),
    model.propertiesObjectKey && deleteObject(model.propertiesObjectKey),
    model.urn && deleteManifest(model.urn),
  ].filter(Boolean);
  await Promise.allSettled(cleanup).then((results) =>
    results.forEach((r) => r.status === "rejected" && console.error("Could not delete an uploaded model's file", r.reason)),
  );
  revalidatePath(`/projects/${model.projectId}`, "layout");
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

/** Places a model on the map by hand, or (null) back to its own georeferencing or the project's pin. */
export async function saveModelPlacement(modelId: string, placement: { lat: number; lon: number; heading: number; elevation: number } | null) {
  const user = await getCurrentUser();
  if (!user || !isUuid(modelId)) throw new Error("Model not found");
  const { count } = await db.ifcModel.updateMany({
    where: { id: modelId, project: { orgId: user.orgId } },
    data: { placement: placement === null ? Prisma.DbNull : placementInput.parse(placement) },
  });
  if (!count) throw new Error("Model not found");
}
