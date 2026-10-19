import "server-only";
import type { ModelSummary } from "@/components/models/ifc-viewer";
import { modelSpecSchema } from "@/lib/ifc/spec";
import { summarizeModel } from "@/lib/ifc/summary";

/** What the viewer's details panel shows: from the spec for conkit's format, from the IFC engine's counts for detailed models. */
export function modelSummary(model: { kind: string; spec: unknown; summary: unknown }): ModelSummary {
  if (model.kind !== "ifc") return summarizeModel(modelSpecSchema.parse(model.spec));
  const s = (model.summary ?? {}) as { byClass?: Record<string, number>; elements?: number };
  return {
    elements: s.elements ?? 0,
    totalVolumeM3: 0,
    units: "",
    byType: Object.entries(s.byClass ?? {}).map(([type, count]) => ({ type, count, volumeM3: null })),
    byMaterial: [],
    rooms: [],
    totalRoomAreaM2: 0,
    extents: null,
    warnings: [],
  };
}
