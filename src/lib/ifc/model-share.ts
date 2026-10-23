import "server-only";
import { db } from "@/lib/db";
import { newShareToken } from "@/lib/sheets/share";

// Read-only links to a 3D model, like sheet share links: a 256-bit random token, an optional
// expiry, revocable. A link always shows the model's latest revision.

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const newModelShareToken = newShareToken;

/** The share link for a token, or null if it's malformed, unknown, expired or revoked. */
export async function findActiveModelShare(token: string) {
  if (!TOKEN.test(token)) return null;
  const share = await db.modelShareLink.findUnique({
    where: { token },
    include: { model: { include: { project: { select: { name: true, latitude: true, longitude: true } } } }, createdBy: { select: { name: true, email: true } } },
  });
  if (!share || share.revokedAt || (share.expiresAt && share.expiresAt <= new Date())) return null;
  return share;
}

export async function recordModelShareView(id: string) {
  await db.modelShareLink.update({ where: { id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });
}

export const sharedByName = (share: { createdBy: { name: string | null; email: string } | null }) =>
  share.createdBy?.name || share.createdBy?.email || "a teammate";
