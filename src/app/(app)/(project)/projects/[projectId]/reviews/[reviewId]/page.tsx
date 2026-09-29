import { notFound } from "next/navigation";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { PageBody } from "@/components/shell/page-header";
import { db } from "@/lib/db";
import { planReviewEnabled } from "@/lib/env";
import { isUuid, requireProject } from "@/lib/auth/session";
import { sheetName } from "@/lib/sheets/export-data";
import { toIssueView } from "@/lib/review/types";

export default async function ReviewPage({ params }: PageProps<"/projects/[projectId]/reviews/[reviewId]">) {
  const { projectId, reviewId } = await params;
  const { user, project } = await requireProject(projectId);
  const review = isUuid(reviewId)
    ? await db.review.findFirst({
        where: { id: reviewId, projectId: project.id },
        include: {
          drawingSet: { include: { sheets: { orderBy: { pageIndex: "asc" } } } },
          sheets: true,
          issues: { orderBy: { createdAt: "asc" }, include: { section: { select: { page: true } } } },
        },
      })
    : null;
  if (!review) notFound();
  const references = await db.reference.findMany({
    where: { id: { in: review.referenceIds }, orgId: user.orgId },
    select: { id: true, title: true },
  });
  const runs = new Map(review.sheets.map((s) => [s.sheetId, s]));

  return (
    <PageBody>
      <ReviewWorkspace
        projectId={project.id}
        review={{ id: review.id, name: review.name, drawingSetId: review.drawingSetId, setName: review.drawingSet.fileName }}
        references={references}
        enabled={planReviewEnabled()}
        sheets={review.drawingSet.sheets.map((s) => {
          const run = runs.get(s.id);
          return {
            id: s.id,
            pageIndex: s.pageIndex,
            name: sheetName(s),
            status: run?.status ?? null,
            error: run?.error ?? null,
            costUsd: run?.costUsd ?? 0,
          };
        })}
        initialIssues={review.issues.map(toIssueView)}
      />
    </PageBody>
  );
}
