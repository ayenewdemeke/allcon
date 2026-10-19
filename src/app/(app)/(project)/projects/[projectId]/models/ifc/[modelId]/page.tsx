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
  const updated = model.updatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const info = { id: model.id, name: model.name, description: model.description, revision: model.revision, updated };

  if (model.kind === "ifc") {
    // Detailed models: names and classes come from the IFC itself, counts from the IFC engine.
    const s = (model.summary ?? {}) as { byClass?: Record<string, number>; elements?: number };
    return (
      <IfcViewer
        key={`${model.id}:${model.revision}`}
        projectId={project.id}
        model={{ ...info, detailed: true }}
        elements={[]}
        summary={{
          elements: s.elements ?? 0,
          totalVolumeM3: 0,
          units: "",
          byType: Object.entries(s.byClass ?? {}).map(([type, count]) => ({ type, count, volumeM3: 0 })),
          byMaterial: [],
          rooms: [],
          totalRoomAreaM2: 0,
          extents: null,
          warnings: [],
        }}
      />
    );
  }

  const spec = modelSpecSchema.parse(model.spec);
  const materials = new Map(spec.materials.map((m) => [m.id, m.grade ? `${m.name} (${m.grade})` : m.name]));

  return (
    <IfcViewer
      key={`${model.id}:${model.revision}`}
      projectId={project.id}
      model={info}
      elements={[
        // Same GlobalIds the compiler writes, so a clicked object maps back to its details.
        ...spec.elements.map((e) => ({
          globalId: ifcGuid(`${model.id}:el:${e.id}`),
          id: e.id,
          type: e.type,
          name: e.name ?? null,
          mark: e.mark ?? null,
          sheet: e.sheet ?? null,
          notes: e.notes ?? null,
          material: (e.material && materials.get(e.material)) || null,
        })),
        ...spec.openings
          .filter((o) => o.kind !== "opening")
          .map((o) => ({
            globalId: ifcGuid(`${model.id}:fill:${o.id}`),
            id: o.id,
            type: o.kind,
            name: o.name ?? null,
            mark: o.mark ?? null,
            sheet: o.sheet ?? null,
            notes: [`${o.width} × ${o.height} in ${o.host}`, o.notes].filter(Boolean).join(". "),
            material: (o.material && materials.get(o.material)) || null,
          })),
        ...spec.spaces.map((sp) => ({
          globalId: ifcGuid(`${model.id}:sp:${sp.id}`),
          id: sp.id,
          type: "space",
          name: [sp.number, sp.name].filter(Boolean).join(" "),
          mark: null,
          sheet: sp.sheet ?? null,
          notes: sp.notes ?? null,
          material: null,
        })),
      ]}
      summary={summarizeModel(spec)}
    />
  );
}
