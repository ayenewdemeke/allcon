import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { findAccessibleProject } from "@/lib/auth/session";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;

type Cell = string | number | null;

/** ExcelJS returns rich objects for formulas, rich text, links and dates; flatten to text/number. */
function cellValue(value: ExcelJS.CellValue): Cell {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return String(value.text);
    if ("error" in value) return null;
  }
  return String(value);
}

/**
 * Reads an uploaded .xlsx or .csv into plain rows so the browser can map columns and
 * preview. Nothing is saved here; the import itself is a separate step.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/projects/[projectId]/line-items/parse">) {
  if (!(await findAccessibleProject((await ctx.params).projectId))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Files up to 10 MB are supported" }, { status: 413 });

  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".csv")) {
      const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: false });
      return Response.json({ sheets: [{ name: file.name, rows: parsed.data.slice(0, MAX_ROWS) }] });
    }
    if (name.endsWith(".xlsx")) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheets = workbook.worksheets
        .filter((ws) => ws.state === "visible")
        .map((ws) => {
          const rows: Cell[][] = [];
          ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
            if (rowNumber > MAX_ROWS) return;
            const values = (row.values as ExcelJS.CellValue[]).slice(1); // ExcelJS rows are 1-based
            rows[rowNumber - 1] = values.map(cellValue);
          });
          return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) };
        })
        .filter((s) => s.rows.length > 0);
      return Response.json({ sheets });
    }
    return Response.json({ error: "Upload an Excel (.xlsx) or CSV file" }, { status: 400 });
  } catch (err) {
    console.error("Could not read spreadsheet", err);
    return Response.json({ error: "That file couldn't be read. Is it a valid .xlsx or .csv?" }, { status: 400 });
  }
}
