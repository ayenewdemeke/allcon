import "server-only";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { gunzipSync, gzipSync } from "node:zlib";
import { getFile, newFileKey, putFile } from "@/lib/storage";
import type { DrawingData, Entity, Units } from "./types";

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

const PICTURE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/**
 * A drawing's file copied for another drawing (Save As, a template, a drawing from a template):
 * its attached pictures are copied too, so each drawing owns its files and deleting one never
 * takes another's pictures. Returns the new file's key.
 */
export async function copyDrawingFile(fromId: string, fileKey: string, toId: string): Promise<string> {
  let bytes = Buffer.from(await getFile(fileKey));
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  const data = JSON.parse(bytes.toString("utf8")) as DrawingData;
  const copied = new Map<string, string>();
  const prefix = `drawings/${fromId}/attachments/`;
  const visit = async (entities: Entity[]) => {
    for (const e of entities) {
      if (e.type !== "image" || !e.key.startsWith(prefix)) continue;
      let key = copied.get(e.key);
      if (!key) {
        const ext = e.key.split(".").pop()?.toLowerCase() ?? "png";
        key = attachmentKey(toId, ext);
        await putFile(key, await getFile(e.key), { contentType: PICTURE_TYPES[ext] ?? "application/octet-stream" });
        copied.set(e.key, key);
      }
      e.key = key;
    }
  };
  await visit(data.entities ?? []);
  for (const b of data.blocks ?? []) await visit(b.entities);
  for (const l of data.layouts ?? []) await visit(l.entities);
  const key = newDrawingKey(toId);
  await putFile(key, gzipSync(Buffer.from(JSON.stringify(data))), DRAWING_FILE);
  return key;
}

/** A drawing the current user may open, for API routes (null otherwise). */
export async function findAccessibleDrawing(drawingId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(drawingId)) return null;
  return db.drawing.findFirst({
    where: { id: drawingId, orgId: user.orgId },
    select: { id: true, fileKey: true, revision: true, backupKey: true },
  });
}
