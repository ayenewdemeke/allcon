import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IfcViewer } from "@/components/models/ifc-viewer";
import { isUuid, requireProject } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ifcGuid } from "@/lib/ifc/compile";
import { modelSpecSchema } from "@/lib/ifc/spec";
import { summarizeModel } from "@/lib/ifc/summary";

export const metadata: Metadata = { title: "3D model" };

/** A model built from drawings, viewed in 3D straight from its IFC. */
export default async function IfcModelPage({ params }: PageProps<"/projects/[projectId]/models/ifc/[modelId]">) {
  const { projectId, modelId } = await params;
  const { project } = await requireProject(projectId);
  const model = isUuid(modelId) ? await db.ifcModel.findFirst({ where: { id: modelId, projectId: project.id } }) : null;
  if (!model) notFound();
  const spec = modelSpecSchema.parse(model.spec);
  const materials = new Map(spec.materials.map((m) => [m.id, m.grade ? `${m.name} (${m.grade})` : m.name]));

  return (
    <IfcViewer
      key={`${model.id}:${model.revision}`}
      projectId={project.id}
      model={{
        id: model.id,
        name: model.name,
        description: model.description,
        revision: model.revision,
        updated: model.updatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
      }}
      elements={spec.elements.map((e) => ({
        // Same GlobalId the compiler writes, so a clicked element maps back to its details.
        globalId: ifcGuid(`${model.id}:el:${e.id}`),
        id: e.id,
        type: e.type,
        name: e.name ?? null,
        mark: e.mark ?? null,
        sheet: e.sheet ?? null,
        notes: e.notes ?? null,
        material: (e.material && materials.get(e.material)) || null,
      }))}
      summary={summarizeModel(spec)}
    />
  );
}
