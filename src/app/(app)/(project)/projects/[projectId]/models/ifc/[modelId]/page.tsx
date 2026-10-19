import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IfcViewer } from "@/components/models/ifc-viewer";
import { ModelActions } from "@/components/models/model-actions";
import { isUuid, requireProject } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { modelSummary } from "@/lib/ifc/model-summary";
import { viewCacheKey } from "@/lib/ifc/view-cache";

export const metadata: Metadata = { title: "3D model" };

/** A model built from drawings, viewed in 3D straight from its IFC. */
export default async function IfcModelPage({ params }: PageProps<"/projects/[projectId]/models/ifc/[modelId]">) {
  const { projectId, modelId } = await params;
  const { project } = await requireProject(projectId);
  const model = isUuid(modelId)
    ? await db.ifcModel.findFirst({
        where: { id: modelId, projectId: project.id },
        select: { id: true, name: true, description: true, kind: true, spec: true, summary: true, revision: true, updatedAt: true, viewCache: { select: { key: true } } },
      })
    : null;
  if (!model) notFound();
  const info = {
    id: model.id,
    name: model.name,
    description: model.description,
    revision: model.revision,
    updated: model.updatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
    detailed: model.kind === "ifc",
  };
  const api = `/api/ifc-models/${model.id}`;

  return (
    <IfcViewer
      key={`${model.id}:${model.revision}`}
      model={info}
      summary={modelSummary(model)}
      source={{
        ifc: `${api}/ifc`,
        view: model.viewCache?.key === viewCacheKey(model.revision) ? `${api}/view` : null,
        save: `${api}/view?revision=${model.revision}`,
      }}
      backHref={`/projects/${project.id}/models`}
      actions={<ModelActions projectId={project.id} model={{ id: model.id, name: model.name }} />}
    />
  );
}
