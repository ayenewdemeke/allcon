import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { compileIfc } from "@/lib/ifc/compile";
import { applyPatch, modelSpecSchema, type ModelPatch, type ModelSpec } from "@/lib/ifc/spec";
import { specErrors, summarizeModel } from "@/lib/ifc/summary";
import { gzipIfc, workerCreate, workerEdit, workerHelp, workerQuery, workerSummary, WorkerError } from "@/lib/ifc/worker";
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

async function findModel(ctx: ToolContext, modelId: string) {
  const model = await db.ifcModel.findFirst({ where: { id: modelId, project: { orgId: ctx.orgId } } });
  if (!model) throw new ToolError("3D model not found. Use list_3d_models to see a project's models and their ids.");
  return model;
}

/** A model in conkit's format (not a detailed IFC model). */
async function requireModel(ctx: ToolContext, modelId: string) {
  const model = await findModel(ctx, modelId);
  if (model.kind !== "spec") throw new ToolError("This is a detailed (IFC) model: change it with ifc_edit, and read it with ifc_query.");
  return { ...model, spec: modelSpecSchema.parse(model.spec) };
}

/** A detailed model, kept as IFC and edited with IfcOpenShell. */
async function requireDetailed(ctx: ToolContext, modelId: string) {
  const model = await findModel(ctx, modelId);
  if (model.kind !== "ifc" || !model.ifcGz) throw new ToolError("This model is in conkit's format: change it with update_3d_model, or convert it first with convert_to_detailed.");
  return { ...model, ifcGz: model.ifcGz };
}

/** Worker failures become tool errors the AI app can read and act on. */
async function engine<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (err) {
    if (err instanceof WorkerError) throw new ToolError(err.message);
    throw err;
  }
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
  const found = await findModel(ctx, modelId);
  if (found.kind === "ifc") {
    return {
      modelId: found.id,
      name: found.name,
      kind: "detailed (IFC)",
      description: found.description,
      revision: found.revision,
      projectId: found.projectId,
      ...links(found.projectId, found.id),
      summary: found.summary,
      note: "Use ifc_query to list or inspect elements, and ifc_edit to change the model.",
    };
  }
  const model = { ...found, spec: modelSpecSchema.parse(found.spec) };
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
    kind: m.kind === "ifc" ? "detailed (IFC)" : "conkit format",
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
  const next = model.revision + 1;
  // A revision holds either the format (spec) or the IFC itself, matching the model's kind then.
  const data = old.ifcGz
    ? { kind: "ifc", ifcGz: old.ifcGz, spec: Prisma.DbNull }
    : (() => {
        const spec = modelSpecSchema.parse(old.spec);
        return { kind: "spec", spec: asJson(spec), ifcGz: null, elementCount: spec.elements.length };
      })();
  await db.$transaction([
    db.ifcModel.update({ where: { id: model.id }, data: { ...data, revision: next } }),
    db.ifcModelRevision.create({
      data: { modelId: model.id, revision: next, spec: old.spec ?? Prisma.DbNull, ifcGz: old.ifcGz, note: `Restored revision ${revision}` },
    }),
  ]);
  return next;
}

// --- detailed models (IFC, edited with IfcOpenShell) ---------------------------------------

const asSummary = (v: unknown) => v as Prisma.InputJsonValue;

export async function createDetailedModel(
  ctx: ToolContext,
  input: { projectId: string; name: string; description?: string; schema: "IFC4" | "IFC4X3"; units: string; facility: string; levels: { name: string; elevation: number }[] },
) {
  const project = await requireProject(ctx, input.projectId);
  const made = await engine(() => workerCreate({ schema: input.schema, name: input.name, units: input.units, facility: input.facility, levels: input.levels }));
  const model = await db.ifcModel.create({
    data: {
      projectId: project.id,
      name: input.name.trim().slice(0, 200),
      description: input.description?.slice(0, 2000) ?? null,
      kind: "ifc",
      ifcGz: made.ifcGz,
      summary: asSummary(made.summary),
      elementCount: made.summary.elements,
      clientId: ctx.clientId,
      createdById: ctx.userId,
      revisions: { create: { revision: 1, ifcGz: made.ifcGz, note: "Created" } },
    },
  });
  return { modelId: model.id, revision: 1, projectId: project.id, handles: made.handles, ...links(project.id, model.id), summary: made.summary };
}

/** Turns a model in conkit's format into a detailed one (one way; earlier revisions stay restorable). */
export async function convertToDetailed(ctx: ToolContext, modelId: string) {
  const model = await requireModel(ctx, modelId);
  const { text } = compileIfc(model.spec, { modelId: model.id, name: model.name });
  const ifcGz = gzipIfc(text);
  const revision = model.revision + 1;
  const summary = await engine(() => workerSummary(ifcGz));
  await db.$transaction([
    db.ifcModel.update({
      where: { id: model.id },
      data: { kind: "ifc", ifcGz, spec: Prisma.DbNull, summary: asSummary(summary), elementCount: summary.elements, revision },
    }),
    db.ifcModelRevision.create({ data: { modelId: model.id, revision, ifcGz, note: "Converted to a detailed (IFC) model" } }),
  ]);
  return { modelId: model.id, name: model.name, revision, previousRevision: model.revision, projectId: model.projectId, ...links(model.projectId, model.id), summary };
}

export async function ifcEdit(ctx: ToolContext, input: { modelId: string; operations: unknown[]; note?: string }) {
  const model = await requireDetailed(ctx, input.modelId);
  const edited = await engine(() => workerEdit(model.ifcGz, input.operations));
  const revision = model.revision + 1;
  await db.$transaction([
    db.ifcModel.update({
      where: { id: model.id },
      data: { ifcGz: edited.ifcGz, summary: asSummary(edited.summary), elementCount: edited.summary.elements, revision },
    }),
    db.ifcModelRevision.create({ data: { modelId: model.id, revision, ifcGz: edited.ifcGz, note: input.note?.slice(0, 300) ?? null } }),
    db.ifcModelRevision.deleteMany({ where: { modelId: model.id, revision: { lte: revision - KEEP_REVISIONS } } }),
  ]);
  return {
    modelId: model.id,
    name: model.name,
    revision,
    previousRevision: model.revision,
    projectId: model.projectId,
    results: edited.results,
    ...links(model.projectId, model.id),
    summary: edited.summary,
  };
}

export async function ifcQuery(ctx: ToolContext, input: { modelId: string; select?: string; id?: number }) {
  const model = await requireDetailed(ctx, input.modelId);
  return { modelId: model.id, name: model.name, projectId: model.projectId, result: await engine(() => workerQuery(model.ifcGz, { select: input.select, id: input.id })) };
}

export async function ifcHelp(usecase: string) {
  return engine(() => workerHelp(usecase));
}
