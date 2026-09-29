import { toLineItemUnit, unitDimension } from "@/lib/line-items/units";
import { formatMeasure, measureMarkup } from "@/lib/takeoff";
import type { ExportData } from "./export-data";

// Names, quantities and (when prices are shared) amounts of a sheet's markups, worked out the
// same way for the PDF summary page and the share page's side panel.

export const KIND_LABELS: Record<string, string> = { length: "Length", area: "Area", count: "Count", note: "Note", arrow: "Arrow", cloud: "Cloud" };

export type DescribedMarkup = {
  id: string;
  name: string;
  type: string;
  /** Formatted quantity; null for notes, arrows and clouds, "Not scaled" without a scale. */
  quantity: string | null;
  lineItem: string | null;
  amount: number | null;
};

/** Default names ("Area 2") are numbered per sheet, as the side panel shows them. */
export function describeSheet(sheet: ExportData["sheets"][number], data: ExportData): DescribedMarkup[] {
  const items = new Map(data.lineItems.map((i) => [i.id, i]));
  const counts = new Map<string, number>();
  return sheet.markups.map((m) => {
    let name = m.label;
    if (!name && m.kind === "note") name = m.text?.split("\n")[0] || "Note";
    if (!name) {
      const k = (counts.get(m.kind) ?? 0) + 1;
      counts.set(m.kind, k);
      name = `${KIND_LABELS[m.kind]} ${k}`;
    }

    const measured = measureMarkup(m, sheet.metersPerPoint);
    const measurable = m.kind === "length" || m.kind === "area" || m.kind === "count";
    const quantity = measured ? formatMeasure(measured.value, measured.kind, data.unitSystem) : measurable ? "Not scaled" : null;

    const item = data.includePrices && m.lineItemId ? items.get(m.lineItemId) : undefined;
    let amount: number | null = null;
    if (item && measured && item.rate !== null) {
      // Price in the line's unit: an area with depth prices an area line by its area.
      const useArea = measured.kind === "volume" && unitDimension(item.unit) === "area";
      const q = useArea && "area" in measured ? toLineItemUnit(measured.area, "area", item.unit) : toLineItemUnit(measured.value, measured.kind, item.unit);
      if (q !== null) amount = q * item.rate;
    }

    return {
      id: m.id,
      name,
      type: KIND_LABELS[m.kind],
      quantity,
      lineItem: item ? [item.code, item.description].filter(Boolean).join(" · ") : null,
      amount,
    };
  });
}
