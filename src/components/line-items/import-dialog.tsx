"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { importLineItems } from "@/app/actions/line-items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber } from "@/lib/format";
import {
  buildItems,
  detectHeaderRow,
  FIELDS,
  guessColumns,
  lineValue,
  type ColumnMap,
  type Field,
} from "@/lib/line-items/import";
import { cn } from "@/lib/utils";
import { BOQ } from "@/lib/line-items/terms";

type Sheet = { name: string; rows: (string | number | null)[][] };

const selectClass = "h-8 w-full rounded-lg border border-input bg-card px-2 text-sm";
const PREVIEW_ROWS = 40;

export function ImportDialog({
  projectId,
  currency,
  hasItems,
  label = "Import",
  variant = "outline",
}: {
  projectId: string;
  currency: string;
  hasItems: boolean;
  label?: string;
  variant?: "outline" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [columns, setColumns] = useState<ColumnMap>({});
  const [mode, setMode] = useState<"replace" | "append">(hasItems ? "append" : "replace");
  const [busy, setBusy] = useState<"reading" | "importing" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => sheets?.[sheetIndex]?.rows ?? [], [sheets, sheetIndex]);
  const header = rows[headerRow] ?? [];
  const items = useMemo(() => (sheets ? buildItems(rows, headerRow, columns) : []), [sheets, rows, headerRow, columns]);
  const lines = items.filter((i) => !i.isHeading);
  const warnings = lines.filter((i) => i.warning).length;
  const total = lines.reduce((sum, i) => sum + lineValue(i), 0);
  const columnCount = Math.max(0, ...rows.slice(headerRow, headerRow + 30).map((r) => r.length));

  function reset() {
    setFileName(null);
    setSheets(null);
    setSheetIndex(0);
    if (fileInput.current) fileInput.current.value = "";
  }

  function selectSheet(list: Sheet[], index: number) {
    const r = list[index]?.rows ?? [];
    const h = detectHeaderRow(r);
    setSheetIndex(index);
    setHeaderRow(h);
    setColumns(guessColumns(r[h] ?? []));
  }

  async function readFile(file: File) {
    setBusy("reading");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/line-items/parse`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not read the file");
      if (!data.sheets.length) throw new Error("That file has no data");
      setFileName(file.name);
      setSheets(data.sheets);
      // Pick the sheet whose header looks most like a schedule.
      const best = (data.sheets as Sheet[])
        .map((s, i) => ({ i, cols: Object.keys(guessColumns(s.rows[detectHeaderRow(s.rows)] ?? [])).length }))
        .sort((a, b) => b.cols - a.cols)[0];
      selectSheet(data.sheets, best?.i ?? 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the file");
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    setBusy("importing");
    try {
      const result = await importLineItems(projectId, {
        mode,
        items: items.map(({ code, description, unit, billingType, contractQuantity, rate, scheduledValue, isHeading }) => ({
          code,
          description,
          unit,
          billingType,
          contractQuantity,
          rate,
          scheduledValue,
          isHeading,
        })),
      });
      toast.success(`Imported ${result.imported} ${BOQ.items}${result.headings ? ` in ${result.headings} sections` : ""}`);
      setOpen(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  const colLabel = (i: number) => {
    const title = header[i];
    return `${String.fromCharCode(65 + (i % 26))}${title ? ` · ${String(title).slice(0, 24)}` : ""}`;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger render={<Button variant={variant} />}>
        <Upload />
        {label}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Import schedule of values</DialogTitle>
          <DialogDescription>
            Upload an Excel (.xlsx) or CSV file. Match its columns, check the preview, then import.
          </DialogDescription>
        </DialogHeader>

        {!sheets ? (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
            className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors hover:border-primary hover:bg-accent/40"
          >
            {busy === "reading" ? <Loader2 className="size-8 animate-spin text-muted-foreground" /> : <FileSpreadsheet className="size-8 text-muted-foreground" />}
            <span className="font-medium">{busy === "reading" ? "Reading…" : "Choose a spreadsheet"}</span>
            <span className="text-sm text-muted-foreground">
              Any layout works: code, description, unit, quantity, rate and amount columns are matched in the next step.
            </span>
          </button>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>File</Label>
                <p className="truncate text-sm">{fileName}</p>
              </div>
              {sheets.length > 1 && (
                <div className="grid gap-1.5">
                  <Label htmlFor="imp-sheet">Worksheet</Label>
                  <select id="imp-sheet" className={selectClass} value={sheetIndex} onChange={(e) => selectSheet(sheets, Number(e.target.value))}>
                    {sheets.map((s, i) => (
                      <option key={i} value={i}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="imp-header">Header row</Label>
                <select
                  id="imp-header"
                  className={selectClass}
                  value={headerRow}
                  onChange={(e) => {
                    const h = Number(e.target.value);
                    setHeaderRow(h);
                    setColumns(guessColumns(rows[h] ?? []));
                  }}
                >
                  {rows.slice(0, 20).map((r, i) => (
                    <option key={i} value={i}>
                      Row {i + 1}: {r.filter((c) => c != null && c !== "").slice(0, 4).join(" | ").slice(0, 60) || "(empty)"}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {FIELDS.map(({ field, label, required }) => (
                <div key={field} className="grid gap-1.5">
                  <Label htmlFor={`col-${field}`} className="text-xs">
                    {label}
                    {required && <span className="text-destructive">*</span>}
                  </Label>
                  <select
                    id={`col-${field}`}
                    className={selectClass}
                    value={columns[field] ?? ""}
                    onChange={(e) =>
                      setColumns((c) => {
                        const next = { ...c };
                        if (e.target.value === "") delete next[field as Field];
                        else next[field as Field] = Number(e.target.value);
                        return next;
                      })
                    }
                  >
                    <option value="">Not in file</option>
                    {Array.from({ length: columnCount }, (_, i) => (
                      <option key={i} value={i}>
                        {colLabel(i)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{lines.length} {BOQ.items}</Badge>
              {items.length - lines.length > 0 && <Badge variant="secondary">{items.length - lines.length} section headings</Badge>}
              {warnings > 0 && <Badge variant="warning">{warnings} to check</Badge>}
              <span className="ml-auto font-medium">Total {formatMoney(total, currency)}</span>
            </div>

            <div className="max-h-80 overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 bg-muted">
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.slice(0, PREVIEW_ROWS).map((i) => (
                    <TableRow key={i.row} className={cn(i.isHeading && "bg-muted/60 font-semibold", i.warning && "bg-warning/10")}>
                      <TableCell className="text-muted-foreground tabular-nums">{i.row}</TableCell>
                      <TableCell>{i.code}</TableCell>
                      <TableCell className="max-w-72">
                        <span className="line-clamp-1">{i.description}</span>
                        {i.warning && (
                          <span className="flex items-center gap-1 text-xs font-normal text-[hsl(32_95%_35%)]">
                            <AlertTriangle className="size-3" /> {i.warning}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{i.isHeading ? "" : i.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.isHeading ? "" : formatNumber(i.contractQuantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.isHeading || i.rate == null ? "" : formatNumber(i.rate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.isHeading ? "" : formatMoney(lineValue(i), currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {items.length > PREVIEW_ROWS && (
                <p className="p-2 text-center text-xs text-muted-foreground">…and {items.length - PREVIEW_ROWS} more rows</p>
              )}
            </div>

            {hasItems && (
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={mode === "append"} onChange={() => setMode("append")} /> Add to existing {BOQ.items}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace all {BOQ.items}
                  <span className="text-xs text-muted-foreground">(removes their mappings)</span>
                </label>
              </div>
            )}
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
          }}
        />

        <DialogFooter>
          {sheets && (
            <Button variant="ghost" onClick={reset} className="mr-auto">
              Choose another file
            </Button>
          )}
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={runImport} disabled={!sheets || !lines.length || columns.description === undefined || busy !== null}>
            {busy === "importing" && <Loader2 className="animate-spin" />}
            Import {lines.length ? `${lines.length} items` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
