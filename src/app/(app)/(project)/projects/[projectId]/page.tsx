import Link from "next/link";
import { ArrowRight, Box, Boxes, CircleCheck, type LucideIcon } from "lucide-react";
import { ModelStatus } from "@/components/model-status";
import { ModelUploader } from "@/components/model-uploader";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/session";

function Stat({ label, value, hint, icon: Icon }: { label: string; value: string; hint?: string; icon: LucideIcon }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <Icon className="size-4" />
        </div>
      </CardContent>
    </Card>
  );
}

export default async function ProjectOverviewPage({ params }: PageProps<"/projects/[projectId]">) {
  const { project } = await requireProject((await params).projectId);

  const [models, modelCount, latestReady] = await Promise.all([
    db.modelVersion.findMany({
      where: { projectId: project.id },
      orderBy: { uploadedAt: "desc" },
      take: 5,
    }),
    db.modelVersion.count({ where: { projectId: project.id } }),
    db.modelVersion.findFirst({
      where: { projectId: project.id, status: "ready" },
      orderBy: { uploadedAt: "desc" },
    }),
  ]);

  const [elementCount, withQuantity] = latestReady
    ? await Promise.all([
        db.element.count({ where: { modelVersionId: latestReady.id } }),
        db.element.count({ where: { modelVersionId: latestReady.id, quantitySource: { not: "missing" } } }),
      ])
    : [0, 0];
  const coverage = elementCount ? Math.round((withQuantity / elementCount) * 100) : null;

  return (
    <PageBody>
      <PageHeader
        title={project.name}
        description={`${project.measurementStandard} · ${project.currency} · ${project.retentionPct.toString()}% retainage`}
        actions={<ModelUploader projectId={project.id} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Models" value={modelCount.toLocaleString()} icon={Box} />
        <Stat
          label="Elements"
          value={elementCount.toLocaleString()}
          hint={latestReady ? `Latest model: ${latestReady.fileName}` : "Upload a model to read its elements"}
          icon={Boxes}
        />
        <Stat
          label="Elements with quantities"
          value={coverage === null ? "—" : `${coverage}%`}
          hint={coverage === null ? undefined : `${withQuantity.toLocaleString()} of ${elementCount.toLocaleString()}`}
          icon={CircleCheck}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent models</CardTitle>
          {modelCount > 0 && (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/projects/${project.id}/models`} />}>
              View all
              <ArrowRight />
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {models.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No models yet. Upload a Revit (.rvt) or IFC (.ifc) file to get started.
            </p>
          ) : (
            <ul className="divide-y">
              {models.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    {m.status === "ready" ? (
                      <Link
                        href={`/projects/${project.id}/models/${m.id}`}
                        className="truncate font-medium hover:text-primary hover:underline"
                      >
                        {m.fileName}
                      </Link>
                    ) : (
                      <p className="truncate font-medium">{m.fileName}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {m.uploadedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
                      {m.elementCount !== null && ` · ${m.elementCount.toLocaleString()} elements`}
                    </p>
                  </div>
                  <ModelStatus
                    key={m.status}
                    modelId={m.id}
                    initialStatus={m.status}
                    initialProgress={m.translationProgress}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageBody>
  );
}
