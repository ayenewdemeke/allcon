import { SharedSheetViewer } from "@/components/share/shared-sheet-viewer";
import { ShareUnavailable } from "@/components/share/share-header";
import { db } from "@/lib/db";
import { loadExportData } from "@/lib/sheets/export-data";
import { findActiveShare, sharedByName } from "@/lib/sheets/share";

/** Read-only view of one shared sheet with its markups. */
export default async function SharedSheetPage({ params }: PageProps<"/share/[token]/[sheetId]">) {
  const { token, sheetId } = await params;
  const share = await findActiveShare(token);
  // Only sheets chosen for this link, never others in the set.
  if (!share || !share.sheetIds.includes(sheetId)) return <ShareUnavailable />;

  const sheet = await db.sheet.findFirst({
    where: { id: sheetId, drawingSetId: share.drawingSetId },
    select: { id: true, height: true },
  });
  if (!sheet) return <ShareUnavailable />;

  // Everything the link covers: the side panel shows this sheet, the download all of them.
  const data = await loadExportData(share.drawingSetId, share.sheetIds, share.includePrices);

  return (
    <SharedSheetViewer
      key={sheet.id}
      token={token}
      sheetId={sheet.id}
      sheetHeight={sheet.height}
      data={data}
      projectName={share.project.name}
      sharedBy={sharedByName(share)}
      expiresAt={share.expiresAt.toISOString()}
    />
  );
}
