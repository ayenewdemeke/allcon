import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import type { Georef } from "@/lib/maps/placement";
import { newFileKey, signedReadUrl, signedWriteUrl, type StoredFile } from "@/lib/storage";

// Calls the IfcOpenShell worker (api/ifc.py), a Python function in the same deployment, which
// also converts drafting drawings to and from DXF. Only
// allcon's server may call it: requests carry a key derived from the auth secret, which the
// worker derives the same way. Models never pass through the request: the worker reads and
// writes them in file storage through signed links, so there's no size limit and no state.

export class WorkerError extends Error {}

const workerUrl = () =>
  process.env.IFC_WORKER_URL || (process.env.NODE_ENV === "production" ? `${env().APP_URL}/api/ifc` : "http://127.0.0.1:5328/api/ifc");
const workerKey = () => createHmac("sha256", env().BETTER_AUTH_SECRET).update("conkit-ifc-worker").digest("hex");

/** How 3D model files are stored: gzipped IFC. */
export const IFC_FILE = { contentType: "application/x-step", gzipped: true } as const;
export const newModelFileKey = (modelId: string) => newFileKey(`models/${modelId}`, ".ifc.gz");

export type WorkerSummary = {
  schema: string;
  elements: number;
  byClass: Record<string, number>;
  spatial: { id: number; type: string; name: string | null; longName?: string | null; elevation: number | null }[];
  contexts: { id: number; identifier: string | null; type: string | null }[];
  openings: number;
  lod?: { target: string | null; byLevel: Record<string, number>; unset: number };
  warnings?: string[];
  georef?: Georef | null;
};

/** An element as mapping reads it (see api/ifc.py element_rows). */
export type WorkerElement = {
  stableId: string;
  category: string;
  typeName: string;
  level: string | null;
  quantities: { volume?: number; area?: number; length?: number };
  quantitySource: "qto_set" | "geometry" | "missing";
  properties: Record<string, string>;
};

type WorkerResponse = {
  ok: boolean;
  error?: string;
  size?: number;
  summary?: WorkerSummary;
  results?: unknown;
  handles?: unknown;
  result?: unknown;
  elements?: WorkerElement[];
  /** DXF: objects left out, by type. */
  skipped?: Record<string, number>;
  units?: string;
  count?: number;
};

async function call(
  action: string,
  params: unknown,
  files: { read?: string; write?: string; writeAs?: StoredFile; readAs?: "ifc_url" | "drawing_url" | "dxf_url" } = {},
): Promise<WorkerResponse> {
  const payload = {
    action,
    params,
    [files.readAs ?? "ifc_url"]: files.read ? await signedReadUrl(files.read) : undefined,
    put: files.write ? await signedWriteUrl(files.write, files.writeAs ?? IFC_FILE) : undefined,
  };
  let res: Response;
  try {
    res = await fetch(workerUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-conkit-worker": workerKey() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(110_000),
    });
  } catch (err) {
    console.error("IFC worker unreachable", err);
    throw new WorkerError("The IFC engine isn't reachable right now. Try again in a moment.");
  }
  const body = (await res.json().catch(() => ({ ok: false, error: `IFC engine error (${res.status})` }))) as WorkerResponse;
  if (!body.ok) throw new WorkerError(body.error ?? `IFC engine error (${res.status})`);
  return body;
}

/** Creates a model file (project, units, contexts, site, facility, storeys) at `fileKey`. */
export async function workerCreate(
  fileKey: string,
  params: {
    schema: "IFC4" | "IFC4X3";
    name: string;
    units: string;
    facility: string;
    lod?: string;
    levels: { name: string; elevation: number }[];
    /** Georeferences the model: its origin here, its +y this many degrees clockwise from true north. */
    location?: { lat: number; lon: number; heading: number };
  },
) {
  const body = await call("create", params, { write: fileKey });
  return { handles: body.handles, summary: body.summary!, size: body.size ?? null };
}

/** A bridge element for the IFC engine: a section extruded from a to b, or a plan outline between two levels (feet). */
export type BridgeIfcElement = { kind: string; name: string; material?: string; properties?: Record<string, string | number | boolean> } & ({ a: number[]; b: number[]; outline?: [number, number][]; radius?: number } | { plan: [number, number][]; z0: number; z1: number });

/** Writes a bridge (the Bridge section's model as solids) as an IFC 4.3 model at `fileKey`. */
export async function workerBridge(fileKey: string, params: { name: string; elements: BridgeIfcElement[]; location?: { lat: number; lon: number; heading: number } }) {
  const body = await call("bridge", params, { write: fileKey });
  return { summary: body.summary!, size: body.size ?? null };
}

/** Applies operations to the file at `from`, writing the result to `to` (all or nothing). */
export async function workerEdit(from: string, to: string, operations: unknown[]) {
  const body = await call("edit", { operations }, { read: from, write: to });
  return { results: body.results, summary: body.summary!, size: body.size ?? null };
}

export async function workerQuery(fileKey: string, params: { select?: string; id?: number }) {
  return (await call("query", params, { read: fileKey })).result;
}

export async function workerSummary(fileKey: string) {
  return (await call("summary", {}, { read: fileKey })).summary!;
}

/** A model's elements with their quantities (in SI), for mapping to the SOV / BoQ. */
export async function workerElements(fileKey: string) {
  return (await call("elements", {}, { read: fileKey })).elements ?? [];
}

export async function workerHelp(usecase: string) {
  return (await call("help", { usecase })).result;
}

/** A drawing (its file at `drawingKey`) as DXF, written to `dxfKey`. */
/** `fileName`: what Filename fields show in the DXF. */
export async function workerDxfExport(drawingKey: string, dxfKey: string, fileName = "") {
  const body = await call("dxf_export", { fileName }, { read: drawingKey, readAs: "drawing_url", write: dxfKey, writeAs: { contentType: "application/dxf" } });
  return { size: body.size ?? null, skipped: body.skipped ?? {} };
}

/** A DXF file (at `dxfKey`) as a drawing, written to `drawingKey` (gzipped JSON). */
export async function workerDxfImport(dxfKey: string, drawingKey: string, units: "architectural" | "mm" | null) {
  const body = await call("dxf_import", { units }, { read: dxfKey, readAs: "dxf_url", write: drawingKey, writeAs: { contentType: "application/json", gzipped: true } });
  return { units: body.units === "mm" ? ("mm" as const) : ("architectural" as const), count: body.count ?? 0, skipped: body.skipped ?? {} };
}
