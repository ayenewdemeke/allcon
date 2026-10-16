import "server-only";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

// When an AI app (Claude, ChatGPT...) connects, conkit's OAuth provider sends the user to the
// sign-in or consent page with the original request in a signed query string.

type SearchParams = Record<string, string | string[] | undefined>;

export function toSearchParams(params: SearchParams) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) out.append(key, v);
  }
  return out;
}

/** The signed connector request on this page, or null if there isn't a valid one. */
export async function verifiedConnectorQuery(params: SearchParams) {
  const query = toSearchParams(params);
  if (!query.has("sig") || !query.get("client_id")) return null;
  return (await verifyOAuthQueryParams(query.toString(), env().BETTER_AUTH_SECRET)) ? query : null;
}

/** Resumes the connector's authorization once the user is signed in. */
export function authorizeUrl(query: URLSearchParams) {
  const params = new URLSearchParams(query);
  for (const key of ["sig", "exp", "ba_iat", "ba_pl", "ba_param"]) params.delete(key);
  if (params.get("prompt")?.split(" ").includes("login")) params.delete("prompt"); // they just signed in
  return `/api/auth/oauth2/authorize?${params}`;
}

/** A readable name for the app that's connecting. */
export async function connectorName(clientId: string) {
  const client = await db.oauthClient.findUnique({ where: { clientId }, select: { name: true, uri: true, icon: true } });
  let host: string | null = null;
  try {
    host = new URL(client?.uri ?? clientId).hostname;
  } catch {}
  return { name: client?.name || host || "An app", icon: client?.icon ?? null, host };
}
