import { createHash, timingSafeEqual } from "node:crypto";

// The feedback export: a read-only listing for the daily feedback check, which runs in a cloud
// session that can reach the web but not the database. It answers only to the export token.

const MIN_TOKEN = 32;

/** Whether an Authorization header carries the export token. Without a long enough token set, nothing does. */
export function bearerMatches(header: string | null, token: string | undefined) {
  if (!token || token.length < MIN_TOKEN || !header?.startsWith("Bearer ")) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header.slice("Bearer ".length)), digest(token));
}
