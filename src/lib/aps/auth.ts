import "server-only";
import { env } from "@/lib/env";

export const APS_BASE = "https://developer.api.autodesk.com";
const TOKEN_URL = `${APS_BASE}/authentication/v2/token`;

// User sign-in with Autodesk lives in src/lib/auth.ts; this module holds the app's own tokens.

// Scopes for the app's own (2-legged) token: manage the model bucket and run translations.
const APP_SCOPES = ["bucket:create", "bucket:read", "data:read", "data:write", "data:create"];
const VIEWER_SCOPES = ["viewables:read"];

type TokenResponse = { access_token: string; expires_in: number };

function basicAuth() {
  const { APS_CLIENT_ID, APS_CLIENT_SECRET } = env();
  return "Basic " + Buffer.from(`${APS_CLIENT_ID}:${APS_CLIENT_SECRET}`).toString("base64");
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`APS token request failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

// --- 2-legged (app) tokens, cached per scope set until shortly before expiry ---

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function appToken(scopes: string[]) {
  const key = scopes.join(" ");
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit;
  const t = await requestToken({ grant_type: "client_credentials", scope: key });
  const entry = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  tokenCache.set(key, entry);
  return entry;
}

export async function getInternalToken() {
  return (await appToken(APP_SCOPES)).token;
}

/** Read-only token handed to the browser for the Viewer. */
export async function getViewerToken() {
  const t = await appToken(VIEWER_SCOPES);
  return { access_token: t.token, expires_in: Math.floor((t.expiresAt - Date.now()) / 1000) };
}
