import "server-only";
import { APS_BASE, getInternalToken } from "./auth";

const MD = `${APS_BASE}/modelderivative/v2/designdata`;

/** Start an SVF2 translation. Each job on a complex model costs Flex tokens, so call once per version. */
export async function startTranslation(urn: string) {
  const res = await fetch(`${MD}/job`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getInternalToken()}`,
      "Content-Type": "application/json",
      "x-ads-force": "true",
    },
    body: JSON.stringify({
      input: { urn },
      output: { formats: [{ type: "svf2", views: ["2d", "3d"] }] },
    }),
  });
  if (!res.ok) throw new Error(`Translation request failed (${res.status}): ${await res.text()}`);
}

export type TranslationState = {
  status: "pending" | "inprogress" | "success" | "failed" | "timeout";
  progress: string;
  messages: string[];
};

export async function getManifest(urn: string): Promise<TranslationState | null> {
  const res = await fetch(`${MD}/${urn}/manifest`, {
    headers: { Authorization: `Bearer ${await getInternalToken()}` },
    cache: "no-store",
  });
  if (res.status === 404) return null; // job not registered yet
  if (!res.ok) throw new Error(`Manifest request failed (${res.status}): ${await res.text()}`);
  const m = await res.json();
  const messages: string[] = [];
  const collect = (node: { messages?: { type: string; message: string | string[] }[]; derivatives?: unknown[]; children?: unknown[] }) => {
    for (const msg of node.messages ?? []) {
      if (msg.type === "error") messages.push([msg.message].flat().join(" "));
    }
    for (const child of [...(node.derivatives ?? []), ...(node.children ?? [])]) collect(child as typeof node);
  };
  collect(m);
  return { status: m.status, progress: m.progress, messages };
}
