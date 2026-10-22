import Link from "next/link";
import { Box } from "lucide-react";
import { CountToggle } from "@/components/models/count-toggle";
import { DeleteModelButton } from "@/components/models/delete-model-button";
import { ModelStatus } from "@/components/models/model-status";
import { ModelUploader } from "@/components/models/model-uploader";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/auth/session";

function formatSize(bytes: bigint | null) {
  if (bytes === null) return "—";
  const mb = Number(bytes) / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(Number(bytes) / 1024).toFixed(0)} KB`;
}

const day = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "medium" });

/** Every model in the project, uploaded or built from the drawings by an AI app, newest first. */
export default async function ModelsPage({ params }: PageProps<"/projects/[projectId]/models">) {
  const { project } = await requireProject((await params).projectId);
  const [uploads, built] = await Promise.all([
    db.modelVersion.findMany({
      where: { projectId: project.id },
      orderBy: { uploadedAt: "desc" },
      include: { uploadedBy: { select: { name: true, email: true } } },
    }),
    db.ifcModel.findMany({
      where: { projectId: project.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, elementCount: true, revision: true, updatedAt: true, countInQuantities: true },
    }),
  ]);
  const rows = [
    ...uploads.map((m) => ({ kind: "upload" as const, at: m.uploadedAt, m })),
    ...built.map((m) => ({ kind: "built" as const, at: m.updatedAt, m })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  // Only the newest processed upload counts (earlier ones are its past versions).
  const latestUpload = uploads.find((m) => m.status === "ready")?.id;

  return (
    <PageBody>
      <PageHeader
        title="Models"
        description="Revit and IFC models you upload, and 3D models your AI app builds from the drawings."
        actions={<ModelUploader projectId={project.id} />}
      />

      <Card className="py-0">
        {rows.length === 0 ? (
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Box className="size-6" />
            </div>
            <p className="font-medium">No models yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Upload a Revit (.rvt) or IFC (.ifc) file, or connect your AI app under Connections and ask it to &ldquo;build a 3D model from the drawings&rdquo;.
            </p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">Model</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Elements</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Status</TableHead>
                <TableHead title="Whether its quantities feed the SOV / BoQ">Quantities</TableHead>
                <TableHead className="w-10 pr-2">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) =>
                row.kind === "upload" ? (
                  <TableRow key={row.m.id}>
                    <TableCell className="pl-4 font-medium">
                      {row.m.status === "ready" ? (
                        <Link href={`/projects/${project.id}/models/${row.m.id}`} className="hover:text-primary hover:underline">
                          {row.m.fileName}
                        </Link>
                      ) : (
                        row.m.fileName
                      )}
                      {row.m.status === "failed" && row.m.errorMessage && <p className="text-xs font-normal text-destructive">{row.m.errorMessage}</p>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">Uploaded · {/\.rvt$/i.test(row.m.fileName) ? "Revit" : "IFC"}</TableCell>
                    <TableCell className="tabular-nums">{row.m.elementCount?.toLocaleString() ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatSize(row.m.fileSize)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {day(row.m.uploadedAt)} · {row.m.uploadedBy?.name || row.m.uploadedBy?.email || "Former member"}
                    </TableCell>
                    <TableCell>
                      <ModelStatus key={row.m.status} modelId={row.m.id} initialStatus={row.m.status} initialProgress={row.m.translationProgress} />
                    </TableCell>
                    <TableCell>
                      {row.m.id === latestUpload ? (
                        <CountToggle projectId={project.id} target={{ kind: "upload" }} counted={project.countUploads} />
                      ) : (
                        <span className="text-xs text-muted-foreground">{row.m.status === "ready" ? "Earlier version" : "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-2">
                      <DeleteModelButton kind="upload" id={row.m.id} name={row.m.fileName} />
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={row.m.id}>
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/projects/${project.id}/models/ifc/${row.m.id}`} className="hover:text-primary hover:underline">
                        {row.m.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">Built by AI from drawings</TableCell>
                    <TableCell className="tabular-nums">{row.m.elementCount.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground">Revision {row.m.revision}</TableCell>
                    <TableCell className="text-muted-foreground">{day(row.m.updatedAt)}</TableCell>
                    <TableCell>
                      <Badge variant="success">Ready</Badge>
                    </TableCell>
                    <TableCell>
                      <CountToggle projectId={project.id} target={{ kind: "built", id: row.m.id }} counted={row.m.countInQuantities} />
                    </TableCell>
                    <TableCell className="pr-2">
                      <DeleteModelButton kind="built" id={row.m.id} name={row.m.name} />
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}
