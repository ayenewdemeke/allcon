import "server-only";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { newFileKey } from "@/lib/storage";
import type { Units } from "./types";

/** How drawings are stored: gzipped JSON, a new file per save. */
export const DRAWING_FILE = { contentType: "application/json", gzipped: true } as const;
export const newDrawingKey = (drawingId: string) => newFileKey(`drawings/${drawingId}`, ".json.gz");

export const drawingUnits = (units: string): Units => (units === "mm" ? "mm" : "architectural");

/** A drawing the current user may open, for API routes (null otherwise). */
export async function findAccessibleDrawing(drawingId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(drawingId)) return null;
  return db.drawing.findFirst({
    where: { id: drawingId, orgId: user.orgId },
    select: { id: true, fileKey: true, revision: true },
  });
}
