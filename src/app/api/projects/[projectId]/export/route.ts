import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { APP_NAME } from "@/lib/app-config";
import { findAccessibleProject } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { toLineItemUnit } from "@/lib/line-items/units";
import { KEY_DIMENSION } from "@/lib/mapping/server";
import { buildReport } from "@/lib/report";
import { measureMarkup, type Point } from "@/lib/takeoff";


const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
const SECTION_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

function header(ws: ExcelJS.Worksheet, titles: string[], widths: number[]) {
  ws.columns = widths.map((width) => ({ width }));
  const row = ws.addRow(titles);
  row.font = { bold: true };
  row.eachCell((c) => (c.fill = HEADER_FILL));
  ws.views = [{ state: "frozen", ySplit: row.number }];
}

/** Priced quantities workbook: summary by line item plus the element and drawing detail behind it. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/export">) {
  const access = await findAccessibleProject((await ctx.params).projectId);
  if (!access) return new Response("Not found", { status: 404 });
  const report = await buildReport(access.project.id);
  const { project, version, lines, totals } = report;
  const money = `"${project.currency === "USD" ? "$" : project.currency + " "}"#,##0.00`;

  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME;
  wb.created = new Date();

  // 1. Priced quantities
  const ws = wb.addWorksheet("Priced quantities");
  ws.addRow([project.name]).font = { bold: true, size: 14 };
  ws.addRow([`Priced quantities · ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}${version ? ` · model: ${version.fileName}` : ""}`]);
  ws.addRow([]);
  header(
    ws,
    ["Code", "Description", "Unit", "Contract qty", "Model qty", "Drawing qty", "Measured qty", "Variance", "Rate", "Contract value", "Measured value", "Checks"],
    [12, 44, 7, 13, 13, 13, 13, 10, 12, 16, 16, 48],
  );
  for (const l of lines) {
    if (l.isHeading) {
      const r = ws.addRow([l.code, l.description]);
      r.font = { bold: true };
      r.eachCell({ includeEmpty: true }, (c) => (c.fill = SECTION_FILL));
      continue;
    }
    const r = ws.addRow([
      l.code,
      l.description,
      l.unit,
      l.billingType === "lump_sum" ? "LS" : l.contractQuantity,
      l.modelQuantity,
      l.drawingQuantity,
      l.measuredQuantity,
      l.variance,
      l.rate,
      l.contractValue,
      l.measuredValue,
      l.billingType === "lump_sum" ? "Lump sum" : l.flags.join("; ") || "OK",
    ]);
    for (const i of [4, 5, 6, 7]) r.getCell(i).numFmt = "#,##0.00";
    r.getCell(8).numFmt = "0%";
    for (const i of [9, 10, 11]) r.getCell(i).numFmt = money;
  }
  const t = ws.addRow(["", "Total", "", "", "", "", "", "", "", totals.contractValue, totals.measuredValue, `${Math.round(totals.coverage * 100)}% of unit-price value measured`]);
  t.font = { bold: true };
  t.getCell(10).numFmt = money;
  t.getCell(11).numFmt = money;

  // 2. Model elements behind each line
  const units = new Map(lines.map((l) => [l.id, l]));
  const es = wb.addWorksheet("Model elements");
  header(es, ["Line item", "Category", "Type", "Level", "Element ID (stable)", "Quantity from", "Quantity", "Unit"], [14, 22, 40, 14, 44, 12, 12, 7]);
  if (version) {
    const mappings = await db.elementMapping.findMany({
      where: { element: { modelVersionId: version.id } },
      include: { element: true },
      orderBy: [{ lineItemId: "asc" }],
    });
    for (const m of mappings) {
      const li = units.get(m.lineItemId);
      const q = toLineItemUnit(Number(m.quantity), KEY_DIMENSION[m.quantityKey] ?? "count", li?.unit ?? null);
      const r = es.addRow([li?.code ?? li?.description, m.element.category, m.element.typeName, m.element.level, m.element.stableId, m.quantityKey, q, li?.unit]);
      r.getCell(7).numFmt = "#,##0.000";
    }
  }

  // 3. Drawing measurements behind each line
  const ds = wb.addWorksheet("Drawing measurements");
  header(ds, ["Line item", "Drawing set", "Sheet", "Measurement", "Kind", "Quantity", "Unit"], [14, 30, 18, 28, 10, 12, 7]);
  const markups = await db.markup.findMany({
    where: { lineItemId: { not: null }, sheet: { drawingSet: { projectId: project.id } } },
    include: { sheet: { include: { drawingSet: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const mk of markups) {
    const li = units.get(mk.lineItemId!);
    const measured = measureMarkup({ kind: mk.kind, points: mk.points as Point[], depth: mk.depth }, mk.sheet.metersPerPoint);
    let q: number | null = null;
    if (measured) {
      const useArea = measured.kind === "volume" && li?.unit && ["SF", "SY", "m2"].includes(li.unit);
      q = toLineItemUnit(useArea ? measured.area! : measured.value, useArea ? "area" : measured.kind, li?.unit ?? null);
    }
    const r = ds.addRow([
      li?.code ?? li?.description,
      mk.sheet.drawingSet.fileName,
      mk.sheet.number ?? `Page ${mk.sheet.pageIndex + 1}`,
      mk.label ?? mk.kind,
      mk.kind,
      q,
      li?.unit,
    ]);
    r.getCell(6).numFmt = "#,##0.00";
  }

  const buffer = await wb.xlsx.writeBuffer();
  const safeName = project.name.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").slice(0, 60);
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}-priced-quantities.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
