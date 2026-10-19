import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IfcViewer } from "@/components/models/ifc-viewer";
import { isUuid, requireProject } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { modelSpecSchema } from "@/lib/ifc/spec";
import { summarizeModel } from "@/lib/ifc/summary";
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
    cached: model.viewCache?.key === viewCacheKey(model.revision),
  };

  if (model.kind === "ifc") {
    // Detailed models: element details come from the IFC itself, counts from the IFC engine.
    const s = (model.summary ?? {}) as { byClass?: Record<string, number>; elements?: number };
    return (
      <IfcViewer
        key={`${model.id}:${model.revision}`}
        projectId={project.id}
        model={{ ...info, detailed: true }}
        summary={{
          elements: s.elements ?? 0,
          totalVolumeM3: 0,
          units: "",
          byType: Object.entries(s.byClass ?? {}).map(([type, count]) => ({ type, count, volumeM3: null })),
          byMaterial: [],
          rooms: [],
          totalRoomAreaM2: 0,
          extents: null,
          warnings: [],
        }}
      />
    );
  }

  return <IfcViewer key={`${model.id}:${model.revision}`} projectId={project.id} model={info} summary={summarizeModel(modelSpecSchema.parse(model.spec))} />;
}
