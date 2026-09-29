"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { findAccessibleDrawingSet, getCurrentUser, isUuid } from "@/lib/auth/session";
import { loadExportData } from "@/lib/sheets/export-data";
import { newShareToken } from "@/lib/sheets/share";

const sheetIdList = z.array(z.uuid()).min(1).max(5000).nullable();

async function requireSet(drawingSetId: string) {
  const access = await findAccessibleDrawingSet(drawingSetId);
  if (!access || access.drawingSet.status !== "ready") throw new Error("Drawing set not found");
  return access;
}

/** Sheets and markups for a marked-up PDF export (built in the browser). */
export async function getExportData(drawingSetId: string, sheetIds: string[] | null, includePrices: boolean) {
  await requireSet(drawingSetId);
  return loadExportData(drawingSetId, sheetIdList.parse(sheetIds), z.boolean().parse(includePrices));
}

const shareUrl = (token: string) => `${env().APP_URL}/share/${token}`;

export async function createShareLink(
  drawingSetId: string,
  input: { sheetIds: string[]; includePrices: boolean; expiresInDays: number | null },
) {
  const { user, drawingSet } = await requireSet(drawingSetId);
  const data = z
    .object({ sheetIds: z.array(z.uuid()).min(1).max(5000), includePrices: z.boolean(), expiresInDays: z.number().int().min(1).max(365).nullable() })
    .parse(input);
  // Only sheets that belong to this set can be shared through it.
  const sheets = await db.sheet.findMany({ where: { drawingSetId, id: { in: data.sheetIds } }, orderBy: { pageIndex: "asc" }, select: { id: true } });
  if (!sheets.length) throw new Error("Choose at least one sheet");

  const link = await db.shareLink.create({
    data: {
      token: newShareToken(),
      projectId: drawingSet.projectId,
      drawingSetId,
      sheetIds: sheets.map((s) => s.id),
      includePrices: data.includePrices,
      expiresAt: data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86_400_000) : null,
      createdById: user.id,
    },
  });
  return { id: link.id, url: shareUrl(link.token), expiresAt: link.expiresAt?.toISOString() ?? null };
}

export type ShareLinkSummary = {
  id: string;
  url: string;
  sheetCount: number;
  includePrices: boolean;
  expiresAt: string | null; // null = no expiry
  active: boolean;
  viewCount: number;
  createdAt: string;
};

export async function listShareLinks(drawingSetId: string): Promise<ShareLinkSummary[]> {
  await requireSet(drawingSetId);
  const links = await db.shareLink.findMany({ where: { drawingSetId }, orderBy: { createdAt: "desc" } });
  const now = new Date();
  return links.map((l) => ({
    id: l.id,
    url: shareUrl(l.token),
    sheetCount: l.sheetIds.length,
    includePrices: l.includePrices,
    expiresAt: l.expiresAt?.toISOString() ?? null,
    active: !l.revokedAt && (!l.expiresAt || l.expiresAt > now),
    viewCount: l.viewCount,
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function revokeShareLink(id: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(id)) throw new Error("Link not found");
  const { count } = await db.shareLink.updateMany({
    where: { id, project: { orgId: user.orgId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!count) throw new Error("Link not found");
}
