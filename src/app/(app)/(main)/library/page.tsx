import Link from "next/link";
import { BookOpen } from "lucide-react";
import { ReferenceUploader } from "@/components/library/reference-uploader";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { LocalTime } from "@/components/local-time";

export default async function LibraryPage() {
  const user = await requireUser();
  const references = await db.reference.findMany({
    where: { orgId: user.orgId },
    orderBy: { uploadedAt: "desc" },
    include: { _count: { select: { sections: true } } },
  });

  return (
    <PageBody>
      <PageHeader
        title="Library"
        description="Manuals and standards shared by all your projects. Plan reviews check drawings against them and cite their sections."
        actions={references.length > 0 && <ReferenceUploader />}
      />
      {references.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <BookOpen className="size-6" />
            </div>
            <p className="font-medium">No manuals yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add a design manual or standard as a PDF, such as a DOT bridge design manual. It&apos;s split into its
              numbered sections so review findings can cite them.
            </p>
            <ReferenceUploader label="Add your first manual" />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {references.map((r) => (
            <Link key={r.id} href={`/library/${r.id}`} className="group">
              <Card className="h-full transition-shadow group-hover:shadow-md group-hover:ring-primary/40">
                <CardContent className="flex gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                    <BookOpen className="size-5" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium group-hover:text-primary">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.pageCount ? `${r.pageCount} pages · ${r._count.sections} sections · ` : ""}
                      added <LocalTime date={r.uploadedAt} format="date" />
                    </p>
                    {r.status !== "ready" && (
                      <Badge variant={r.status === "failed" ? "destructive" : "info"}>
                        {r.status === "failed" ? "Upload failed" : "Processing"}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageBody>
  );
}
