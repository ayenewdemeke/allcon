import Link from "next/link";
import { Box, FileText, FolderKanban } from "lucide-react";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { mapsConfig } from "@/lib/maps/config";

export default async function ProjectsPage() {
  const user = await requireUser();
  const projects = await db.project.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { modelVersions: true, ifcModels: true, drawingSets: true } } },
  });

  const maps = mapsConfig();

  return (
    <PageBody>
      <PageHeader
        title="Projects"
        description="Each project holds its drawings, models, reviews and estimate."
        actions={projects.length > 0 && <NewProjectDialog maps={maps} />}
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
                Create a project for your drawings, models and reviews. Only a name is needed.
              </p>
            </div>
            <NewProjectDialog label="Create your first project" maps={maps} />
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
                    {(p.location || p.description) && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{[p.location, p.description].filter(Boolean).join(" · ")}</p>
                    )}
                    <p className="flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
                      <FileText className="size-3.5" />
                      {p._count.drawingSets} drawing set{p._count.drawingSets === 1 ? "" : "s"}
                      <Box className="ml-2 size-3.5" />
                      {p._count.modelVersions + p._count.ifcModels} model{p._count.modelVersions + p._count.ifcModels === 1 ? "" : "s"}
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
