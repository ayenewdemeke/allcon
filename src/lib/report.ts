import "server-only";
import { db } from "@/lib/db";
import { lineValue } from "@/lib/line-items/import";
import { countedModels, elementGroups, elementsIn, measuredQuantities } from "@/lib/mapping/server";

// Everything the validation report and the Excel export show, computed once.

export const VARIANCE_FLAG = 0.1; // flag lines where measured differs from contract by >10%

export type ReportLine = {
  id: string;
  parentId: string | null;
  isHeading: boolean;
  code: string | null;
  description: string;
  unit: string | null;
  billingType: "unit_price" | "lump_sum";
  contractQuantity: number | null;
  rate: number | null;
  contractValue: number;
  modelQuantity: number | null;
  drawingQuantity: number | null;
  measuredQuantity: number | null;
  measuredValue: number | null; // measured quantity x rate (unit-price lines)
  variance: number | null; // (measured - contract) / contract
  elements: number;
  markups: number;
  flags: string[];
};

export async function buildReport(projectId: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const models = await countedModels(projectId);
  const [items, measured, groups, sources] = await Promise.all([
    db.lineItem.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    measuredQuantities(projectId, models),
    elementGroups(models),
    models.sources.length
      ? db.element.groupBy({ by: ["quantitySource"], where: elementsIn(models), _count: { _all: true } })
      : Promise.resolve([]),
  ]);

  const lines: ReportLine[] = items.map((i) => {
    const base = {
      contractQuantity: i.contractQuantity === null ? null : Number(i.contractQuantity),
      rate: i.rate === null ? null : Number(i.rate),
      scheduledValue: i.scheduledValue === null ? null : Number(i.scheduledValue),
    };
    const m = measured.get(i.id);
    const measuredQuantity = m && (m.model !== null || m.drawings !== null) ? (m.model ?? 0) + (m.drawings ?? 0) : null;
    const flags = [...(m?.issues ?? [])];
    let variance: number | null = null;
    if (!i.isHeading && i.billingType === "unit_price") {
      if (measuredQuantity === null) flags.push("Not measured");
      else if (base.contractQuantity) {
        variance = (measuredQuantity - base.contractQuantity) / base.contractQuantity;
        if (Math.abs(variance) > VARIANCE_FLAG) flags.push(`${variance > 0 ? "Over" : "Under"} contract by ${Math.abs(Math.round(variance * 100))}%`);
      }
      if (m?.model != null && m?.drawings != null) flags.push("Measured in both model and drawings: check for double counting");
    }
    return {
      id: i.id,
      parentId: i.parentId,
      isHeading: i.isHeading,
      code: i.code,
      description: i.description,
      unit: i.unit,
      billingType: i.billingType,
      contractQuantity: base.contractQuantity,
      rate: base.rate,
      contractValue: i.isHeading ? 0 : lineValue({ billingType: i.billingType, ...base }),
      modelQuantity: m?.model ?? null,
      drawingQuantity: m?.drawings ?? null,
      measuredQuantity,
      measuredValue: i.billingType === "unit_price" && measuredQuantity !== null && base.rate !== null ? measuredQuantity * base.rate : null,
      variance,
      elements: m?.elements ?? 0,
      markups: m?.markups ?? 0,
      flags,
    };
  });

  const priced = lines.filter((l) => !l.isHeading);
  const unitPrice = priced.filter((l) => l.billingType === "unit_price");
  const contractValue = priced.reduce((s, l) => s + l.contractValue, 0);
  const unitPriceValue = unitPrice.reduce((s, l) => s + l.contractValue, 0);
  const coveredValue = unitPrice.filter((l) => l.measuredQuantity !== null).reduce((s, l) => s + l.contractValue, 0);
  const totalElements = groups.reduce((s, g) => s + g.count, 0);
  const mappedElements = groups.reduce((s, g) => s + g.mappedElements, 0);
  const sourceCount = (k: string) => sources.find((s) => s.quantitySource === k)?._count._all ?? 0;

  return {
    project,
    models,
    lines,
    totals: {
      contractValue,
      lumpSumValue: contractValue - unitPriceValue,
      unitPriceValue,
      measuredValue: unitPrice.reduce((s, l) => s + (l.measuredValue ?? 0), 0),
      // Share of unit-price contract value that has a measured quantity behind it
      coverage: unitPriceValue ? coveredValue / unitPriceValue : 0,
      measuredLines: unitPrice.filter((l) => l.measuredQuantity !== null).length,
      unitPriceLines: unitPrice.length,
      flagged: priced.filter((l) => l.flags.length).length,
    },
    model: {
      totalElements,
      mappedElements,
      sources: {
        qto_set: sourceCount("qto_set"),
        property: sourceCount("property"),
        geometry: sourceCount("geometry"),
        missing: sourceCount("missing"),
      },
      unmappedGroups: groups
        .filter((g) => g.mappedElements === 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    },
  };
}

export type Report = Awaited<ReturnType<typeof buildReport>>;
