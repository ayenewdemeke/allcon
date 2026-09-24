import "server-only";
import { APS_BASE, getInternalToken } from "./auth";
import type { RawObject, TreeNode } from "./normalize";

const MD = `${APS_BASE}/modelderivative/v2/designdata`;

/**
 * Model Derivative answers 202 while it builds the property database for a model.
 * Poll until it returns data, or give up after roughly two minutes.
 */
async function getWithRetry<T>(url: string, pick: (body: Record<string, never>) => T | undefined) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${await getInternalToken()}` },
      cache: "no-store",
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`${url.split("/").pop()} failed (${res.status}): ${await res.text()}`);
    }
    const value = pick(await res.json());
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Timed out waiting for Model Derivative to prepare the model data");
}

/** The GUID of the model's 3D view, which carries the element data. */
export async function getModelViewGuid(urn: string) {
  const views = await getWithRetry(`${MD}/${urn}/metadata`, (b) => {
    const list = (b as { data?: { metadata?: { guid: string; role: string }[] } }).data?.metadata;
    return list?.length ? list : undefined;
  });
  const view = views.find((v) => v.role === "3d") ?? views[0];
  if (!view) throw new Error("This model has no views to read elements from");
  return view.guid;
}

export async function getObjectTree(urn: string, guid: string) {
  return getWithRetry(
    `${MD}/${urn}/metadata/${guid}?forceget=true`,
    (b) => (b as { data?: { objects?: TreeNode[] } }).data?.objects,
  );
}

export async function getAllProperties(urn: string, guid: string) {
  return getWithRetry(
    `${MD}/${urn}/metadata/${guid}/properties?forceget=true`,
    (b) => (b as { data?: { collection?: RawObject[] } }).data?.collection,
  );
}
