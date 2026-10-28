import Link from "next/link";
import { FileSearch } from "lucide-react";
import { NewReviewDialog } from "@/components/review/new-review-dialog";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { planReviewEnabled } from "@/lib/env";
import { requireProject } from "@/lib/auth/session";
import { LocalTime } from "@/components/local-time";

export default async function ReviewsPage({ params }: PageProps<"/projects/[projectId]/reviews">) {
  const { user, project } = await requireProject((await params).projectId);
  const [reviews, drawingSets, references] = await Promise.all([
    db.review.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      include: { drawingSet: { select: { fileName: true } }, issues: { select: { status: true } }, sheets: { select: { status: true } } },
    }),
    db.drawingSet.findMany({
      where: { projectId: project.id, status: "ready" },
      orderBy: { uploadedAt: "desc" },
      select: { id: true, fileName: true, pageCount: true },
    }),
    db.reference.findMany({ where: { orgId: user.orgId, status: "ready" }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
  ]);
  const titles = new Map(references.map((r) => [r.id, r.title]));
  const dialog = (label?: string) => (
    <NewReviewDialog projectId={project.id} drawingSets={drawingSets} references={references} label={label} />
  );

  return (
    <PageBody>
      <PageHeader
        title="Review"
        description="Check drawings against your manuals. Findings you keep are drawn on the sheets as clouds and notes."
        actions={reviews.length > 0 && dialog()}
      />
      {!planReviewEnabled() && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          The AI review pass needs an Anthropic API key (ANTHROPIC_API_KEY). You can set up reviews now; running them
          works once the key is added.
        </p>
      )}
      {reviews.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <FileSearch className="size-6" />
            </div>
            <p className="font-medium">No reviews yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Pick a drawing set and the manuals to check it against, then choose sheets to review. Each finding cites the
              manual section it relies on.
            </p>
            {dialog("Start a review")}
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {reviews.map((r) => {
            const reviewed = r.sheets.filter((s) => s.status === "done").length;
            const open = r.issues.filter((i) => i.status === "suggested").length;
            const kept = r.issues.filter((i) => i.status === "kept").length;
            return (
              <li key={r.id}>
                <Link href={`/projects/${project.id}/reviews/${r.id}`} className="block px-4 py-3 hover:bg-muted/50">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.drawingSet.fileName} · against {r.referenceIds.map((id) => titles.get(id) ?? "a removed manual").join(", ")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {reviewed} sheet{reviewed === 1 ? "" : "s"} reviewed · {open} to look at · {kept} kept ·{" "}
                    <LocalTime date={r.createdAt} format="date" />
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
