import { notFound } from "next/navigation";
import { SheetWorkspace } from "@/components/sheets/viewer/sheet-workspace";
import { db } from "@/lib/db";
import { isUuid, requireProject } from "@/lib/auth/session";

/** Full-bleed takeoff workspace for one sheet. */
export default async function SheetPage({ params, searchParams }: PageProps<"/projects/[projectId]/sheets/[sheetId]">) {
  const { projectId, sheetId } = await params;
  // ?focus=x0,y0,x1,y1 (sheet points from the top-left): zoom to and outline that box.
  const f = (await searchParams).focus;
  const nums = typeof f === "string" ? f.split(",").map(Number) : [];
  const focus = nums.length === 4 && nums.every(Number.isFinite) ? (nums as [number, number, number, number]) : null;
  const { user, project } = await requireProject(projectId);
  const sheet = isUuid(sheetId)
    ? await db.sheet.findFirst({
        where: { id: sheetId, drawingSet: { projectId: project.id, status: "ready" } },
        include: { markups: { orderBy: { createdAt: "asc" } } },
      })
    : null;
  if (!sheet) notFound();

  const lineItems = (
    await db.lineItem.findMany({
      where: { projectId: project.id, isHeading: false },
      orderBy: { sortOrder: "asc" },
      select: { id: true, code: true, description: true, unit: true },
    })
  ).map((i) => ({ ...i }));

  const siblings = await db.sheet.findMany({
    where: { drawingSetId: sheet.drawingSetId },
    orderBy: { pageIndex: "asc" },
    select: { id: true, pageIndex: true, number: true, title: true, _count: { select: { markups: true } } },
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
      siblings={siblings.map(({ _count, ...s }) => ({ ...s, markupCount: _count.markups }))}
      initialMarkups={sheet.markups.map((m) => ({
        id: m.id,
        kind: m.kind,
        points: m.points as [number, number][],
        label: m.label,
        text: m.text,
        color: m.color,
        depth: m.depth,
        lineItemId: m.lineItemId,
      }))}
      lineItems={lineItems}
      initialUnitSystem={project.unitSystem}
      author={user.name || user.email}
      focus={focus}
    />
  );
}
