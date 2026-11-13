import type { MctReport } from "./mct";

// A bridge that is an imported analysis model (a midas MCT file read in) instead of a wizard's
// definition: the model itself is a file in storage; the bridge's row keeps where it is and a summary.

export type ImportedInfo = { fileKey: string; source: string; nodes: number; elements: number; cases: number; report: MctReport };

export function importedOf(definition: unknown): ImportedInfo | null {
  const i = (definition as { imported?: Partial<ImportedInfo> } | null)?.imported;
  if (!i || typeof i.fileKey !== "string") return null;
  return { fileKey: i.fileKey, source: String(i.source ?? "model"), nodes: Number(i.nodes) || 0, elements: Number(i.elements) || 0, cases: Number(i.cases) || 0, report: (i.report as MctReport) ?? { units: { force: "KN", length: "M" }, read: {}, notRead: [], warnings: [] } };
}
