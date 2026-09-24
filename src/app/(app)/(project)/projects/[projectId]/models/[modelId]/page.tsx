import { notFound } from "next/navigation";
import { ElementSummary } from "@/components/element-summary";
import { ModelViewer } from "@/components/model-viewer";
import { db } from "@/lib/db";
import { isUuid, requireProject } from "@/lib/session";

/** Full-bleed workspace: the viewer takes the page, elements sit in a side panel. */
export default async function ModelPage({ params }: PageProps<"/projects/[projectId]/models/[modelId]">) {
  const { projectId, modelId } = await params;
  const { project } = await requireProject(projectId);
  const model = isUuid(modelId)
    ? await db.modelVersion.findFirst({ where: { id: modelId, projectId: project.id } })
    : null;
  if (!model || !model.urn) notFound();

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <div className="flex min-h-[500px] flex-1 flex-col p-3 lg:p-4">
        <ModelViewer urn={model.urn} />
      </div>
      <aside className="flex w-full flex-col gap-4 border-t bg-card p-4 lg:w-96 lg:border-t-0 lg:border-l">
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
