import Link from "next/link";
import { Box, FolderKanban } from "lucide-react";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";

const STANDARD_LABELS: Record<string, string> = {
  CSI: "CSI MasterFormat",
  NRM2: "NRM2",
  SMM7: "SMM7",
  custom: "Custom",
};

export default async function ProjectsPage() {
  const user = await requireUser();
  const projects = await db.project.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { modelVersions: true } } },
  });

  return (
    <PageBody>
      <PageHeader
        title="Projects"
        description="Each project holds its models, drawings and schedule of values."
        actions={projects.length > 0 && <NewProjectDialog />}
      />

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <FolderKanban className="size-6" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No projects yet</p>
              <p className="text-sm text-muted-foreground">
                Create a project to upload models and start measuring.
              </p>
            </div>
            <NewProjectDialog label="Create your first project" />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="group">
              <Card className="h-full transition-shadow group-hover:shadow-md group-hover:ring-primary/30">
                <CardContent className="flex gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <FolderKanban className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-medium group-hover:text-primary">{p.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {STANDARD_LABELS[p.measurementStandard] ?? p.measurementStandard} · {p.currency}
                    </p>
                    <p className="flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
                      <Box className="size-3.5" />
                      {p._count.modelVersions} model{p._count.modelVersions === 1 ? "" : "s"}
                      <span className="ml-auto">
                        {p.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
                      </span>
                    </p>
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
