import "server-only";
import type { ModelSummary } from "@/components/models/ifc-viewer";
import type { WorkerSummary } from "@/lib/ifc/worker";

/** What the viewer's details panel shows, from the IFC engine's summary of the current file. */
export function modelSummary(model: { summary: unknown }): ModelSummary {
  const s = (model.summary ?? {}) as Partial<WorkerSummary>;
  return {
    elements: s.elements ?? 0,
    totalVolumeM3: 0,
    units: "",
    byType: Object.entries(s.byClass ?? {}).map(([type, count]) => ({ type, count, volumeM3: null })),
    byMaterial: [],
    rooms: [],
    totalRoomAreaM2: 0,
    extents: null,
    lod: s.lod,
    warnings: s.warnings ?? [],
  };
}
