import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";

// Share links give read-only access to chosen sheets without an account. The token is
// 256 bits of randomness (43 url-safe characters), so it can't be guessed or enumerated.

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const newShareToken = () => randomBytes(32).toString("base64url");

/** The share link for a token, or null if it's malformed, unknown, expired or revoked. */
export async function findActiveShare(token: string) {
  if (!TOKEN.test(token)) return null;
  const share = await db.shareLink.findUnique({
    where: { token },
    include: { drawingSet: true, project: { select: { name: true } }, createdBy: { select: { name: true, email: true } } },
  });
  if (!share || share.revokedAt || (share.expiresAt && share.expiresAt <= new Date()) || share.drawingSet.status !== "ready") return null;
  return share;
}

export async function recordShareView(id: string) {
  await db.shareLink.update({ where: { id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });
}

export const sharedByName = (share: { createdBy: { name: string | null; email: string } | null }) =>
  share.createdBy?.name || share.createdBy?.email || "a teammate";
