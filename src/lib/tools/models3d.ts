import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { applyPatch, modelSpecSchema, type ModelPatch, type ModelSpec } from "@/lib/ifc/spec";
import { specErrors, summarizeModel } from "@/lib/ifc/summary";
import { requireProject, ToolError, type ToolContext } from "./context";

// 3D models an AI app builds from drawings. The app reads the sheets and writes the model in
// conkit's format; conkit checks it, keeps its revisions, and compiles it to IFC on request.

const KEEP_REVISIONS = 20;
const links = (projectId: string, modelId: string) => ({
  link: `/projects/${projectId}/models/ifc/${modelId}`,
  ifcDownload: `/api/ifc-models/${modelId}/ifc?download=1`,
});

function check(spec: ModelSpec) {
  const errors = specErrors(spec);
  if (errors.length) throw new ToolError(`The model has problems to fix first: ${errors.join("; ")}`);
}

async function requireModel(ctx: ToolContext, modelId: string) {
  const model = await db.ifcModel.findFirst({ where: { id: modelId, project: { orgId: ctx.orgId } } });
  if (!model) throw new ToolError("3D model not found. Use list_3d_models to see a project's models and their ids.");
  return { ...model, spec: modelSpecSchema.parse(model.spec) };
}

const asJson = (spec: ModelSpec) => spec as unknown as Prisma.InputJsonValue;

export async function create3dModel(
  ctx: ToolContext,
  input: { projectId: string; name: string; description?: string; sourceSheetIds?: string[]; spec: ModelSpec },
) {
  const project = await requireProject(ctx, input.projectId);
  check(input.spec);
  const sheets = input.sourceSheetIds?.length
    ? await db.sheet.findMany({ where: { id: { in: input.sourceSheetIds }, drawingSet: { projectId: project.id } }, select: { id: true } })
    : [];
  const model = await db.ifcModel.create({
    data: {
      projectId: project.id,
      name: input.name.trim().slice(0, 200),
      description: input.description?.slice(0, 2000) ?? null,
      spec: asJson(input.spec),
      elementCount: input.spec.elements.length,
      sourceSheetIds: sheets.map((s) => s.id),
      clientId: ctx.clientId,
      createdById: ctx.userId,
      revisions: { create: { revision: 1, spec: asJson(input.spec), note: "Created" } },
    },
  });
  return { modelId: model.id, revision: 1, projectId: project.id, ...links(project.id, model.id), summary: summarizeModel(input.spec) };
}

export async function update3dModel(ctx: ToolContext, input: { modelId: string; patch: ModelPatch; note?: string }) {
  const model = await requireModel(ctx, input.modelId);
  const spec = applyPatch(model.spec, input.patch);
  check(spec);
  const revision = model.revision + 1;
  await db.$transaction([
    db.ifcModel.update({ where: { id: model.id }, data: { spec: asJson(spec), elementCount: spec.elements.length, revision } }),
    db.ifcModelRevision.create({ data: { modelId: model.id, revision, spec: asJson(spec), note: input.note?.slice(0, 300) ?? null } }),
    db.ifcModelRevision.deleteMany({ where: { modelId: model.id, revision: { lte: revision - KEEP_REVISIONS } } }),
  ]);
  return {
    modelId: model.id,
    name: model.name,
    revision,
    previousRevision: model.revision,
    projectId: model.projectId,
    changed: { upserted: input.patch.upsert_elements.length, removed: input.patch.remove_element_ids.length },
    ...links(model.projectId, model.id),
    summary: summarizeModel(spec),
  };
}

export async function get3dModel(ctx: ToolContext, modelId: string, includeElements: boolean) {
  const model = await requireModel(ctx, modelId);
  const revisions = await db.ifcModelRevision.findMany({
    where: { modelId: model.id },
    orderBy: { revision: "desc" },
    select: { revision: true, note: true, createdAt: true },
  });
  return {
    modelId: model.id,
    name: model.name,
    description: model.description,
    revision: model.revision,
    projectId: model.projectId,
    ...links(model.projectId, model.id),
    summary: summarizeModel(model.spec),
    levels: model.spec.levels,
    materials: model.spec.materials,
    elements: includeElements ? model.spec.elements : undefined,
    revisions: revisions.map((r) => ({ revision: r.revision, note: r.note, at: r.createdAt.toISOString().slice(0, 16) })),
  };
}

export async function list3dModels(ctx: ToolContext, projectId: string) {
  const project = await requireProject(ctx, projectId);
  const models = await db.ifcModel.findMany({ where: { projectId: project.id }, orderBy: { updatedAt: "desc" } });
  return models.map((m) => ({
    modelId: m.id,
    name: m.name,
    elements: m.elementCount,
    revision: m.revision,
    updated: m.updatedAt.toISOString().slice(0, 16),
    ...links(project.id, m.id),
  }));
}

/** Puts a model back to an earlier revision (as a new revision, so it can be undone too). */
export async function restore3dModel(orgId: string, modelId: string, revision: number) {
  const model = await db.ifcModel.findFirst({ where: { id: modelId, project: { orgId } } });
  const old = model && (await db.ifcModelRevision.findUnique({ where: { modelId_revision: { modelId, revision } } }));
  if (!model || !old) throw new Error("That revision is no longer kept");
  const spec = modelSpecSchema.parse(old.spec);
  const next = model.revision + 1;
  await db.$transaction([
    db.ifcModel.update({ where: { id: model.id }, data: { spec: asJson(spec), elementCount: spec.elements.length, revision: next } }),
    db.ifcModelRevision.create({ data: { modelId: model.id, revision: next, spec: asJson(spec), note: `Restored revision ${revision}` } }),
  ]);
  return next;
}
