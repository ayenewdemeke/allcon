import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import type { SymbolicAnswer, SymbolicRequest } from "./evaluate";

// Calls the SymPy worker (api/sym.py), a Python function in the same deployment, the way the IFC
// worker is called: only conkit's server may, with a key derived from the auth secret.

const workerUrl = () => process.env.SYM_WORKER_URL || (process.env.NODE_ENV === "production" ? `${env().APP_URL}/api/sym` : "http://127.0.0.1:5329/api/sym");
const workerKey = () => createHmac("sha256", env().BETTER_AUTH_SECRET).update("conkit-sym-worker").digest("hex");

/** Answers to symbolic requests (each an answer or an error to show). */
export async function workOutSymbolic(requests: SymbolicRequest[]): Promise<Record<string, SymbolicAnswer>> {
  if (!requests.length) return {};
  const failed = (error: string) => Object.fromEntries(requests.map((r) => [r.key, { error }]));
  try {
    const res = await fetch(workerUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-conkit-worker": workerKey() },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(55_000),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; results?: Record<string, SymbolicAnswer>; error?: string } | null;
    if (!body?.ok || !body.results) return failed(body?.error ? `Symbolic math failed: ${body.error}` : "Symbolic math isn't available right now");
    return body.results;
  } catch (err) {
    console.error("SymPy worker unreachable", err);
    return failed("Symbolic math isn't available right now. Try again in a moment.");
  }
}
