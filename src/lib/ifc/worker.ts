import "server-only";
import { createHmac } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { env } from "@/lib/env";

// Calls the IfcOpenShell worker (api/ifc.py), a Python function in the same deployment. Only
// conkit's server may call it: requests carry a key derived from the auth secret, which the
// worker derives the same way. Models travel as gzipped IFC, so the worker keeps no state.

export class WorkerError extends Error {}

const workerUrl = () =>
  process.env.IFC_WORKER_URL || (process.env.NODE_ENV === "production" ? `${env().APP_URL}/api/ifc` : "http://127.0.0.1:5328/api/ifc");
const workerKey = () => createHmac("sha256", env().BETTER_AUTH_SECRET).update("conkit-ifc-worker").digest("hex");

export const gzipIfc = (text: string) => gzipSync(Buffer.from(text, "utf8"));
export const gunzipIfc = (data: Uint8Array) => gunzipSync(Buffer.from(data)).toString("utf8");

export type WorkerSummary = {
  schema: string;
  elements: number;
  byClass: Record<string, number>;
  spatial: { id: number; type: string; name: string | null; elevation: number | null }[];
  contexts: { id: number; identifier: string | null; type: string | null }[];
  openings: number;
};

type WorkerResponse = { ok: boolean; error?: string; ifc?: string; summary?: WorkerSummary; results?: unknown; handles?: unknown; result?: unknown };

async function call(action: string, params: unknown, ifcGz?: Uint8Array): Promise<WorkerResponse> {
  let res: Response;
  try {
    res = await fetch(workerUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-conkit-worker": workerKey() },
      body: JSON.stringify({ action, params, ifc: ifcGz ? Buffer.from(ifcGz).toString("base64") : undefined }),
      signal: AbortSignal.timeout(110_000),
    });
  } catch (err) {
    console.error("IFC worker unreachable", err);
    throw new WorkerError("The IFC engine isn't reachable right now. Try again in a moment.");
  }
  if (res.status === 413) throw new WorkerError("This model is too large for the IFC engine (over about 4 MB compressed).");
  const body = (await res.json().catch(() => ({ ok: false, error: `IFC engine error (${res.status})` }))) as WorkerResponse;
  if (!body.ok) throw new WorkerError(body.error ?? `IFC engine error (${res.status})`);
  return body;
}

const ifcOf = (body: WorkerResponse) => Buffer.from(body.ifc!, "base64");

export async function workerCreate(params: { schema: "IFC4" | "IFC4X3"; name: string; units: string; facility: string; levels: { name: string; elevation: number }[] }) {
  const body = await call("create", params);
  return { ifcGz: ifcOf(body), handles: body.handles, summary: body.summary! };
}

export async function workerEdit(ifcGz: Uint8Array, operations: unknown[]) {
  const body = await call("edit", { operations }, ifcGz);
  return { ifcGz: ifcOf(body), results: body.results, summary: body.summary! };
}

export async function workerQuery(ifcGz: Uint8Array, params: { select?: string; id?: number }) {
  return (await call("query", params, ifcGz)).result;
}

export async function workerSummary(ifcGz: Uint8Array) {
  return (await call("summary", {}, ifcGz)).summary!;
}

export async function workerHelp(usecase: string) {
  return (await call("help", { usecase })).result;
}
