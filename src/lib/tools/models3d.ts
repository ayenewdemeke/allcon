import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { newModelFileKey, workerCreate, workerEdit, workerHelp, workerQuery, workerSummary, WorkerError, type WorkerSummary } from "@/lib/ifc/worker";
import { deleteFiles } from "@/lib/storage";
import { requireProject, ToolError, type ToolContext } from "./context";

// 3D models AI apps build from drawings: real IFC, created and edited with IfcOpenShell
// operations through the IFC engine. The file lives in storage, written once per save; the
// model keeps one backup, the file before the latest change, so that change can be undone.

/** Edits from one app this close together make one revision: one request in the AI app. */
const REQUEST_WINDOW_MS = 15 * 60 * 1000;

const links = (projectId: string, modelId: string) => ({
  link: `/projects/${projectId}/models/ifc/${modelId}`,
  ifcDownload: `/api/ifc-models/${modelId}/ifc?download=1`,
});

async function findModel(ctx: ToolContext, modelId: string) {
  const model = await db.ifcModel.findFirst({ where: { id: modelId, project: { orgId: ctx.orgId } } });
  if (!model) throw new ToolError("3D model not found. Use list_3d_models to see a project's models and their ids.");
  return model;
}

/** IFC engine failures become tool errors the AI app can read and act on. */
async function engine<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (err) {
    if (err instanceof WorkerError) throw new ToolError(err.message);
    throw err;
  }
}

const asJson = (summary: WorkerSummary) => summary as unknown as object;
const describe = (description: string | undefined) => (description === undefined ? {} : { description: description.slice(0, 2000) || null });

export async function createModel(
  ctx: ToolContext,
  input: {
    projectId: string;
    name: string;
    description?: string;
    sourceSheetIds?: string[];
    schema: "IFC4" | "IFC4X3";
    units: string;
    facility: string;
    lod?: string;
    north?: number;
    levels: { name: string; elevation: number }[];
  },
) {
  const project = await requireProject(ctx, input.projectId);
  const sheets = input.sourceSheetIds?.length
    ? await db.sheet.findMany({ where: { id: { in: input.sourceSheetIds }, drawingSet: { projectId: project.id } }, select: { id: true } })
    : [];
  const id = randomUUID();
  const fileKey = newModelFileKey(id);
  const made = await engine(() =>
    workerCreate(fileKey, {
      schema: input.schema,
      name: input.name,
      units: input.units,
      facility: input.facility,
      lod: input.lod,
      levels: input.levels,
      // Georeferenced at the project's pin, the model's +y turned from true north as the plans show.
      location: project.latitude !== null && project.longitude !== null ? { lat: project.latitude, lon: project.longitude, heading: -(input.north ?? 0) } : undefined,
    }),
  );
  await db.ifcModel.create({
    data: {
      id,
      projectId: project.id,
      name: input.name.trim().slice(0, 200),
      description: input.description?.slice(0, 2000) ?? null,
      fileKey,
      fileSize: made.size,
      summary: asJson(made.summary),
      elementCount: made.summary.elements,
      editClientId: ctx.clientId,
      editedAt: new Date(),
      sourceSheetIds: sheets.map((s) => s.id),
      clientId: ctx.clientId,
      createdById: ctx.userId,
    },
  });
  return { modelId: id, revision: 1, projectId: project.id, handles: made.handles, ...links(project.id, id), summary: made.summary };
}

export async function getModel(ctx: ToolContext, modelId: string) {
  const model = await findModel(ctx, modelId);
  return {
    modelId: model.id,
    name: model.name,
    description: model.description,
    revision: model.revision,
    projectId: model.projectId,
    ...links(model.projectId, model.id),
    summary: model.summary,
    undoable: model.backupRevision ? `Revision ${model.backupRevision} is kept, so the latest change can be undone from Connections.` : null,
    note: "Use ifc_query to list or inspect elements, and ifc_edit to change the model.",
  };
}

export async function listModels(ctx: ToolContext, projectId: string) {
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

/**
 * Applies IfcOpenShell operations to a model as one change (all or nothing). Edits from the
 * same app within a short window build the same revision, keeping as backup the file from
 * before the first of them, so undo takes back the whole request.
 */
export async function editModel(ctx: ToolContext, input: { modelId: string; operations: unknown[]; note?: string; description?: string }) {
  const model = await findModel(ctx, input.modelId);
  if (!input.operations.length) {
    // Only the description changes: no new revision.
    if (input.description === undefined) throw new ToolError("Give operations, a description, or both");
    await db.ifcModel.update({ where: { id: model.id }, data: describe(input.description) });
    return { modelId: model.id, name: model.name, revision: model.revision, backupRevision: model.backupRevision, backupKey: model.backupKey, projectId: model.projectId, results: [], ...links(model.projectId, model.id), summary: model.summary };
  }

  const now = new Date();
  const sameRequest =
    !!ctx.clientId && model.editClientId === ctx.clientId && !!model.editedAt && now.getTime() - model.editedAt.getTime() < REQUEST_WINDOW_MS;
  const fileKey = newModelFileKey(model.id);
  const edited = await engine(() => workerEdit(model.fileKey, fileKey, input.operations));

  const next = sameRequest
    ? { revision: model.revision, backupKey: model.backupKey, backupRevision: model.backupRevision }
    : { revision: model.revision + 1, backupKey: model.fileKey, backupRevision: model.revision };
  // Only if nobody else saved meanwhile (the file is what this edit started from).
  const { count } = await db.ifcModel.updateMany({
    where: { id: model.id, fileKey: model.fileKey },
    data: {
      fileKey,
      fileSize: edited.size,
      summary: asJson(edited.summary),
      elementCount: edited.summary.elements,
      ...next,
      editClientId: ctx.clientId,
      editedAt: now,
      ...describe(input.description),
    },
  });
  if (!count) {
    await deleteFiles([fileKey]);
    throw new ToolError("The model changed while this edit ran. Read it again (get_3d_model) and resend the change.");
  }
  // Files no longer needed: the state between edits of one request, or the backup it replaces.
  await deleteFiles(sameRequest ? [model.fileKey] : [model.backupKey]).catch((err) => console.error("Could not delete old model files", err));

  return {
    modelId: model.id,
    name: model.name,
    revision: next.revision,
    backupRevision: next.backupRevision,
    backupKey: next.backupKey,
    projectId: model.projectId,
    results: edited.results,
    ...links(model.projectId, model.id),
    summary: edited.summary,
  };
}

/**
 * Undoes a model's latest change by putting its backup back (as a new revision). The undone
 * file becomes the backup, so an undo can itself be undone. With `expectedBackup`, only if
 * the backup is still the one that change made.
 */
export async function restoreModel(orgId: string, modelId: string, expectedBackup?: string) {
  const model = await db.ifcModel.findFirst({ where: { id: modelId, project: { orgId } } });
  if (!model?.backupKey || (expectedBackup && model.backupKey !== expectedBackup)) {
    throw new Error("That change can no longer be undone: the model has changed since.");
  }
  const summary = await workerSummary(model.backupKey);
  const revision = model.revision + 1;
  await db.ifcModel.update({
    where: { id: model.id },
    data: {
      fileKey: model.backupKey,
      backupKey: model.fileKey,
      backupRevision: model.revision,
      revision,
      summary: asJson(summary),
      elementCount: summary.elements,
      editClientId: null,
      editedAt: null,
    },
  });
  return revision;
}

/** Deletes a model and its files. */
export async function removeModel(orgId: string, modelId: string) {
  const model = await db.ifcModel.findFirst({ where: { id: modelId, project: { orgId } } });
  if (!model) return null;
  await db.ifcModel.delete({ where: { id: model.id } });
  await deleteFiles([model.fileKey, model.backupKey, model.viewKey]).catch((err) => console.error("Could not delete model files", err));
  return model;
}

export async function ifcQuery(ctx: ToolContext, input: { modelId: string; select?: string; id?: number }) {
  const model = await findModel(ctx, input.modelId);
  return { modelId: model.id, name: model.name, projectId: model.projectId, result: await engine(() => workerQuery(model.fileKey, { select: input.select, id: input.id })) };
}

export async function ifcHelp(usecase: string) {
  return engine(() => workerHelp(usecase));
}
