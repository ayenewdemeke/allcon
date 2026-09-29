"use client";

import { formatMoney } from "@/lib/format";
import { describeSheet } from "@/lib/sheets/describe";
import type { ExportData } from "@/lib/sheets/export-data";
import type { ExportSheet, SummaryRow } from "./export";

/** Builds the marked-up PDF in the browser and saves it. */
export async function downloadMarkedUpPdf({
  pdfUrl,
  data,
  summary,
  author,
}: {
  pdfUrl: string;
  data: ExportData;
  summary: boolean;
  author: string;
}) {
  const [{ buildMarkedUpPdf }, res] = await Promise.all([import("./export"), fetch(pdfUrl)]);
  if (!res.ok) throw new Error("Could not read the drawing set");
  const source = await res.arrayBuffer();

  const rows: SummaryRow[] = [];
  const sheets: ExportSheet[] = data.sheets.map((sheet) => {
    const described = describeSheet(sheet, data);
    return {
      pageIndex: sheet.pageIndex,
      name: sheet.name,
      markups: sheet.markups.map((m, i) => {
        const d = described[i];
        if (d.quantity !== null) {
          rows.push({
            sheet: sheet.name,
            name: d.name,
            type: d.type,
            quantity: d.quantity,
            ...(d.lineItem ? { lineItem: d.lineItem } : {}),
            ...(d.amount !== null ? { amount: formatMoney(d.amount, data.currency) } : {}),
          });
        }
        const valueText = d.quantity === "Not scaled" ? null : d.quantity;
        return { id: m.id, kind: m.kind, points: m.points, color: m.color, name: d.name, text: m.text, valueText };
      }),
    };
  });

  const bytes = await buildMarkedUpPdf(source, sheets, {
    title: `${data.title} — marked up`,
    author,
    summary: summary ? rows : null,
    showPricing: data.includePrices,
  });

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.title.replace(/[^\w-]+/g, "-")}-marked-up.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
