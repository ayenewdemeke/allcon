import "server-only";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { newFileKey } from "@/lib/storage";

/** How worksheets are stored: gzipped JSON, a new file per save. */
export const CALC_FILE = { contentType: "application/json", gzipped: true } as const;
export const newCalcKey = (calcId: string) => newFileKey(`calcs/${calcId}`, ".json.gz");

/** A worksheet the current user may open, for API routes (null otherwise). */
export async function findAccessibleCalc(calcId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(calcId)) return null;
  return db.calc.findFirst({ where: { id: calcId, orgId: user.orgId }, select: { id: true, fileKey: true, revision: true } });
}
