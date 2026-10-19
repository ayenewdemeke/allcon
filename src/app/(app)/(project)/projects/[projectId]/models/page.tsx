import Link from "next/link";
import { Box } from "lucide-react";
import { ModelStatus } from "@/components/models/model-status";
import { ModelUploader } from "@/components/models/model-uploader";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/auth/session";

function formatSize(bytes: bigint | null) {
  if (bytes === null) return "—";
  const mb = Number(bytes) / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(Number(bytes) / 1024).toFixed(0)} KB`;
}

export default async function ModelsPage({ params }: PageProps<"/projects/[projectId]/models">) {
  const { project } = await requireProject((await params).projectId);
  const [models, built] = await Promise.all([
    db.modelVersion.findMany({
      where: { projectId: project.id },
      orderBy: { uploadedAt: "desc" },
      include: { uploadedBy: { select: { name: true, email: true } } },
    }),
    db.ifcModel.findMany({ where: { projectId: project.id }, orderBy: { updatedAt: "desc" } }),
  ]);

  return (
    <PageBody>
      <PageHeader
        title="Models"
        description="Revit and IFC models. Each upload is kept as its own version."
        actions={<ModelUploader projectId={project.id} />}
      />

      <Card className="py-0">
        {models.length === 0 ? (
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Box className="size-6" />
            </div>
            <p className="font-medium">No models yet</p>
            <p className="text-sm text-muted-foreground">Upload a Revit (.rvt) or IFC (.ifc) file to get started.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">File</TableHead>
                <TableHead>Elements</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead className="pr-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-4 font-medium">
                    {m.status === "ready" ? (
                      <Link
                        href={`/projects/${project.id}/models/${m.id}`}
                        className="hover:text-primary hover:underline"
                      >
                        {m.fileName}
                      </Link>
                    ) : (
                      m.fileName
                    )}
                    {m.status === "failed" && m.errorMessage && (
                      <p className="text-xs font-normal text-destructive">{m.errorMessage}</p>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{m.elementCount?.toLocaleString() ?? "—"}</TableCell>
                  <TableCell>{formatSize(m.fileSize)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.uploadedAt.toLocaleDateString("en-US", { dateStyle: "medium" })} ·{" "}
                    {m.uploadedBy?.name || m.uploadedBy?.email || "Former member"}
                  </TableCell>
                  <TableCell className="pr-4">
                    <ModelStatus
                      key={m.status}
                      modelId={m.id}
                      initialStatus={m.status}
                      initialProgress={m.translationProgress}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <section className="space-y-2">
        <div>
          <h2 className="font-semibold">Built from drawings</h2>
          <p className="text-sm text-muted-foreground">
            3D models (IFC) your AI app built from this project&apos;s drawings through the connector. Ask it, for example,
            to &ldquo;build a 3D model of the bridge from the drawings&rdquo;.
          </p>
        </div>
        {built.length ? (
          <ul className="divide-y rounded-lg border bg-card">
            {built.map((m) => (
              <li key={m.id}>
                <Link href={`/projects/${project.id}/models/ifc/${m.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                  <Box className="size-4 text-muted-foreground" />
                  <span className="flex-1 font-medium">{m.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.kind === "ifc" && "Detailed IFC · "}
                    {m.elementCount.toLocaleString()} elements · revision {m.revision} ·{" "}
                    {m.updatedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            None yet. Connect your AI app under Connections and use the &ldquo;Build a 3D model from drawings&rdquo; prompt.
          </p>
        )}
      </section>
    </PageBody>
  );
}
