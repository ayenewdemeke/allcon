import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DraftingEditor } from "@/components/drafting/drafting-editor";
import { isUuid, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { drawingUnits } from "@/lib/drafting/server";

/** The browser tab shows the drawing's name, as AutoCAD's title bar does. */
export async function generateMetadata({ params }: PageProps<"/drafting/[drawingId]">): Promise<Metadata> {
  const { drawingId } = await params;
  const user = await requireUser();
  const drawing = isUuid(drawingId) ? await db.drawing.findFirst({ where: { id: drawingId, orgId: user.orgId }, select: { name: true } }) : null;
  return { title: drawing?.name ?? "Drafting" };
}

/** A drawing open in the drafting editor, full screen (no app header or sidebar). */
export default async function DrawingPage({ params }: PageProps<"/drafting/[drawingId]">) {
  const { drawingId } = await params;
  const user = await requireUser();
  const drawing = isUuid(drawingId)
    ? await db.drawing.findFirst({ where: { id: drawingId, orgId: user.orgId }, select: { id: true, name: true, revision: true, units: true } })
    : null;
  if (!drawing) notFound();
  // The projects its layouts can be published to, as sheets.
  const projects = await db.project.findMany({ where: { orgId: user.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <DraftingEditor
      key={drawing.id}
      drawing={{ id: drawing.id, name: drawing.name, revision: drawing.revision }}
      units={drawingUnits(drawing.units)}
      backHref="/drafting"
      projects={projects}
    />
  );
}
