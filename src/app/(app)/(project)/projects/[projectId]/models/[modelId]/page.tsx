import { notFound } from "next/navigation";
import { ElementSummary } from "@/components/models/element-summary";
import { ModelViewer } from "@/components/models/model-viewer";
import { db } from "@/lib/db";
import { isUuid, requireProject } from "@/lib/auth/session";

/** Full-bleed workspace: the viewer takes the page, elements sit in a side panel. */
export default async function ModelPage({ params, searchParams }: PageProps<"/projects/[projectId]/models/[modelId]">) {
  const { projectId, modelId } = await params;
  const { focus } = await searchParams;
  const { project } = await requireProject(projectId);
  const model = isUuid(modelId)
    ? await db.modelVersion.findFirst({ where: { id: modelId, projectId: project.id } })
    : null;
  if (!model || !model.urn) notFound();

  // Mapping state of every element, for "Colour by mapping".
  const rows = await db.$queryRaw<{ db_id: number; mapped: boolean; missing: boolean }[]>`
    SELECT e.db_id, EXISTS (SELECT 1 FROM element_mapping m WHERE m.element_id = e.id) AS mapped,
      e.quantity_source = 'missing' AS missing
    FROM element e WHERE e.model_version_id = ${model.id}::uuid AND e.db_id IS NOT NULL`;
  const colors = {
    mapped: rows.filter((r) => r.mapped).map((r) => r.db_id),
    unmapped: rows.filter((r) => !r.mapped && !r.missing).map((r) => r.db_id),
    missing: rows.filter((r) => !r.mapped && r.missing).map((r) => r.db_id),
  };

  // ?focus={"category":..,"typeName":..} isolates one element group (from the mapping page).
  let isolate: number[] | undefined;
  let isolateLabel: string | undefined;
  if (typeof focus === "string") {
    try {
      const { category, typeName } = JSON.parse(focus) as { category: string | null; typeName: string | null };
      const ids = await db.element.findMany({
        where: { modelVersionId: model.id, category, typeName, dbId: { not: null } },
        select: { dbId: true },
      });
      isolate = ids.map((e) => e.dbId!);
      isolateLabel = `${typeName ?? category ?? "group"} (${isolate.length})`;
    } catch {
      // ignore a malformed focus parameter
    }
  }

  return (
    <div className="flex flex-1 flex-col lg:h-[calc(100svh-3.5rem)] lg:flex-none lg:flex-row lg:overflow-hidden">
      <div className="flex min-h-[500px] flex-1 flex-col p-3 lg:min-h-0 lg:p-4">
        <ModelViewer urn={model.urn} colors={rows.length ? colors : undefined} isolate={isolate} isolateLabel={isolateLabel} />
      </div>
      <aside className="flex w-full flex-col gap-4 border-t bg-card p-4 lg:w-96 lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <div className="space-y-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{model.fileName}</h1>
          <p className="text-xs text-muted-foreground">
            Uploaded {model.uploadedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
          </p>
        </div>
        <ElementSummary modelVersionId={model.id} />
      </aside>
    </div>
  );
}
