import "server-only";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { gunzipSync } from "node:zlib";
import { getFile, newFileKey } from "@/lib/storage";
import type { DrawingData, Units } from "./types";

/** How drawings are stored: gzipped JSON, a new file per save. */
export const DRAWING_FILE = { contentType: "application/json", gzipped: true } as const;
export const newDrawingKey = (drawingId: string) => newFileKey(`drawings/${drawingId}`, ".json.gz");

/** A picture attached under a drawing. */
export const attachmentKey = (drawingId: string, ext: string) => newFileKey(`drawings/${drawingId}/attachments`, `.${ext}`);
/** The drawing's DXF export (each export replaces the last). */
export const dxfExportKey = (drawingId: string) => `drawings/${drawingId}/export.dxf`;

/** Every file a drawing keeps besides its own: attached pictures and its DXF export. */
export async function drawingExtraFiles(drawingId: string, fileKey: string | null) {
  const keys = [dxfExportKey(drawingId)];
  if (!fileKey) return keys;
  try {
    let bytes = Buffer.from(await getFile(fileKey));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
    const data = JSON.parse(bytes.toString("utf8")) as DrawingData;
    const visit = (entities: DrawingData["entities"]) => {
      for (const e of entities) if (e.type === "image" && e.key.startsWith(`drawings/${drawingId}/attachments/`)) keys.push(e.key);
    };
    visit(data.entities ?? []);
    for (const b of data.blocks ?? []) visit(b.entities);
  } catch (err) {
    console.error("Could not read a drawing to find its attachments", err);
  }
  return keys;
}

export const drawingUnits = (units: string): Units => (units === "mm" ? "mm" : "architectural");

/** A drawing the current user may open, for API routes (null otherwise). */
export async function findAccessibleDrawing(drawingId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(drawingId)) return null;
  return db.drawing.findFirst({
    where: { id: drawingId, orgId: user.orgId },
    select: { id: true, fileKey: true, revision: true, backupKey: true },
  });
}
