import Link from "next/link";
import { Layers } from "lucide-react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { DeleteDrawingSetButton } from "@/components/sheets/delete-drawing-set-button";
import { DrawingUploader } from "@/components/sheets/drawing-uploader";
import { FixSheetNumbersButton } from "@/components/sheets/fix-sheet-numbers-dialog";
import { SheetThumbnail } from "@/components/sheets/sheet-thumbnail";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/auth/session";
import { LocalTime } from "@/components/local-time";

// "Fix sheet numbers" re-reads every page's title block on the server.
export const maxDuration = 120;

function formatSize(bytes: bigint) {
  const mb = Number(bytes) / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(Number(bytes) / 1024).toFixed(0)} KB`;
}

export default async function SheetsPage({ params }: PageProps<"/projects/[projectId]/sheets">) {
  const { project } = await requireProject((await params).projectId);
  const sets = await db.drawingSet.findMany({
    where: { projectId: project.id },
    orderBy: { uploadedAt: "desc" },
    include: {
      sheets: {
        orderBy: { pageIndex: "asc" },
        include: { _count: { select: { markups: true } } },
      },
    },
  });

  return (
    <PageBody>
      <PageHeader
        title="Sheets"
        description="PDF drawing sets. Each page is a sheet you can scale, measure and mark up."
        actions={<DrawingUploader projectId={project.id} />}
      />

      {sets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Layers className="size-6" />
            </div>
            <p className="font-medium">No drawings yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Upload PDF drawing sets of any size. Each page becomes a sheet, and only the page you open is
              downloaded.
            </p>
            <DrawingUploader projectId={project.id} label="Upload your first set" />
          </CardContent>
        </Card>
      ) : (
        sets.map((set) => (
          <section key={set.id} className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-semibold">{set.fileName}</h2>
              <p className="text-xs text-muted-foreground">
                {set.pageCount ? `${set.pageCount} sheets · ` : ""}
                {formatSize(set.fileSize)} · <LocalTime date={set.uploadedAt} format="date" />
              </p>
              {set.status !== "ready" && (
                <Badge variant={set.status === "failed" ? "destructive" : "info"}>
                  {set.status === "failed" ? "Upload failed" : "Uploading"}
                </Badge>
              )}
              <div className="ml-auto flex items-center">
                {set.status === "ready" && <FixSheetNumbersButton drawingSetId={set.id} fileName={set.fileName} />}
                <DeleteDrawingSetButton drawingSetId={set.id} fileName={set.fileName} sheetCount={set.sheets.length} />
              </div>
            </div>
            {set.status === "ready" && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {set.sheets.map((sheet) => (
                  <Link key={sheet.id} href={`/projects/${project.id}/sheets/${sheet.id}`} className="group">
                    <Card className="h-full gap-0 py-0 transition-shadow group-hover:shadow-md group-hover:ring-primary/40">
                      <div className="border-b">
                        <SheetThumbnail
                          drawingSetId={set.id}
                          pageIndex={sheet.pageIndex}
                          width={sheet.width}
                          height={sheet.height}
                        />
                      </div>
                      <div className="space-y-0.5 px-3 py-2">
                        <p className="truncate text-sm font-medium group-hover:text-primary">
                          {sheet.number ?? `Page ${sheet.pageIndex + 1}`}
                          {sheet.title && <span className="font-normal text-muted-foreground"> · {sheet.title}</span>}
                        </p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {sheet.metersPerPoint ? (
                            <span>{sheet.scaleLabel ?? "Calibrated"}</span>
                          ) : (
                            <span className="text-[hsl(32_95%_35%)]">Not scaled</span>
                          )}
                          {sheet._count.markups > 0 && <span>· {sheet._count.markups} markups</span>}
                        </p>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </PageBody>
  );
}
