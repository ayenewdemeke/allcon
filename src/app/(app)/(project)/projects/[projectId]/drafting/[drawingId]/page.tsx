import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DraftingEditor } from "@/components/drafting/drafting-editor";
import { isUuid, requireProject } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { drawingUnits } from "@/lib/drafting/server";

export const metadata: Metadata = { title: "Drafting" };

/** A drawing open in the drafting editor. */
export default async function DrawingPage({ params }: PageProps<"/projects/[projectId]/drafting/[drawingId]">) {
  const { projectId, drawingId } = await params;
  const { project } = await requireProject(projectId);
  const drawing = isUuid(drawingId)
    ? await db.drawing.findFirst({ where: { id: drawingId, projectId: project.id }, select: { id: true, name: true, revision: true } })
    : null;
  if (!drawing) notFound();
  return <DraftingEditor key={drawing.id} drawing={drawing} units={drawingUnits(project.unitSystem)} backHref={`/projects/${project.id}/drafting`} />;
}
