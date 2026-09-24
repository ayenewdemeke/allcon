import { notFound } from "next/navigation";
import { SheetWorkspace } from "@/components/sheets/viewer/sheet-workspace";
import { db } from "@/lib/db";
import { isUuid, requireProject } from "@/lib/session";

/** Full-bleed takeoff workspace for one sheet. */
export default async function SheetPage({ params }: PageProps<"/projects/[projectId]/sheets/[sheetId]">) {
  const { projectId, sheetId } = await params;
  const { project } = await requireProject(projectId);
  const sheet = isUuid(sheetId)
    ? await db.sheet.findFirst({
        where: { id: sheetId, drawingSet: { projectId: project.id, status: "ready" } },
        include: { markups: { orderBy: { createdAt: "asc" } } },
      })
    : null;
  if (!sheet) notFound();

  const siblings = await db.sheet.findMany({
    where: { drawingSetId: sheet.drawingSetId },
    orderBy: { pageIndex: "asc" },
    select: { id: true, pageIndex: true, number: true, title: true },
  });

  return (
    // key: a fresh workspace per sheet, so view and tool state never leak between sheets
    <SheetWorkspace
      key={sheet.id}
      projectId={project.id}
      sheet={{
        id: sheet.id,
        drawingSetId: sheet.drawingSetId,
        pageIndex: sheet.pageIndex,
        number: sheet.number,
        title: sheet.title,
        width: sheet.width,
        height: sheet.height,
        metersPerPoint: sheet.metersPerPoint,
        scaleLabel: sheet.scaleLabel,
      }}
      siblings={siblings}
      initialMarkups={sheet.markups.map((m) => ({
        id: m.id,
        kind: m.kind,
        points: m.points as [number, number][],
        label: m.label,
        text: m.text,
        color: m.color,
        depth: m.depth,
      }))}
      initialUnitSystem={project.unitSystem}
    />
  );
}
