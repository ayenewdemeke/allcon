"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MarkupLayer } from "@/components/sheets/viewer/markup-layer";
import { SheetController } from "@/components/sheets/viewer/sheet-controller";
import type { View } from "@/components/sheets/viewer/view";
import { downloadMarkedUpPdf } from "@/lib/pdf/export-client";
import { formatMoney } from "@/lib/format";
import { describeSheet } from "@/lib/sheets/describe";
import type { ExportData } from "@/lib/sheets/export-data";
import { formatMeasure, measureMarkup, type MeasureKind } from "@/lib/takeoff";
import { cn } from "@/lib/utils";
import { ShareHeader } from "./share-header";

const noop = () => {};

export function SharedSheetViewer({
  token,
  sheetId,
  sheetHeight,
  data,
  projectName,
  sharedBy,
  expiresAt,
}: {
  token: string;
  sheetId: string;
  sheetHeight: number;
  data: ExportData;
  projectName: string;
  sharedBy: string;
  expiresAt: string;
}) {
  const router = useRouter();
  const stage = useRef<HTMLDivElement>(null);
  const controller = useRef<SheetController | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ zoom: 0, tx: 0, ty: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const sheet = data.sheets.find((s) => s.id === sheetId)!;
  const described = useMemo(() => describeSheet(sheet, data), [sheet, data]);
  const pdfUrl = (origin: string) => `${origin}/api/share/${token}/pdf`;

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const c = new SheetController(
      el,
      pdfUrl(window.location.origin),
      sheet.pageIndex + 1,
      sheetHeight,
      {
        onReady: () => {
          c.loadShapes(sheet.markups);
          setReady(true);
        },
        onError: setLoadError,
        onView: setView,
        onShapeCreated: async () => null,
        onShapeChanged: noop,
        onShapeDeleted: noop,
        onCalibrationLine: noop,
        onSelect: noop,
        onClick: noop,
        onMove: noop,
        onDoubleClick: noop,
      },
      true,
    );
    controller.current = c;
    return () => {
      c.destroy();
      controller.current = null;
    };
    // One controller per sheet page (the page is keyed by sheet).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Totals by measure (lengths, areas, volumes, counts), and priced total when shared.
  const totals = useMemo(() => {
    const sums = new Map<MeasureKind, number>();
    for (const m of sheet.markups) {
      const measured = measureMarkup(m, sheet.metersPerPoint);
      if (measured) sums.set(measured.kind, (sums.get(measured.kind) ?? 0) + measured.value);
    }
    const order: MeasureKind[] = ["length", "area", "volume", "count"];
    return order.filter((k) => sums.has(k)).map((k) => ({ kind: k, text: formatMeasure(sums.get(k)!, k, data.unitSystem) }));
  }, [sheet, data.unitSystem]);
  const pricedTotal = described.reduce((s, d) => s + (d.amount ?? 0), 0);

  function select(id: string) {
    setSelectedId(id);
    controller.current?.select(id);
    const m = sheet.markups.find((x) => x.id === id);
    if (m) controller.current?.reveal(m.points);
  }

  async function download() {
    setDownloading(true);
    try {
      await downloadMarkedUpPdf({ pdfUrl: pdfUrl(window.location.origin), data, summary: true, author: sharedBy });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  const expires = new Date(expiresAt).toLocaleDateString("en-US", { dateStyle: "medium" });

  return (
    <div className="flex h-svh flex-col bg-background">
      <ShareHeader>
        <div className="hidden min-w-0 border-l pl-3 sm:block">
          <p className="truncate text-sm font-medium">
            {projectName} · {data.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            Shared by {sharedBy} · read-only · until {expires}
          </p>
        </div>
        <Button size="sm" className="ml-auto" onClick={download} disabled={downloading}>
          {downloading ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
        </Button>
      </ShareHeader>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-[60svh] min-w-0 flex-1 flex-col lg:min-h-0">
          <div className="flex items-center gap-1 border-b bg-card px-2 py-1.5">
            {data.sheets.length > 1 ? (
              <select
                value={sheet.id}
                onChange={(e) => router.push(`/share/${token}/${e.target.value}`)}
                className="h-7 max-w-64 truncate rounded-md border border-input bg-card px-2 text-sm"
                aria-label="Sheet"
              >
                {data.sheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="px-1 text-sm font-medium">{sheet.name}</span>
            )}
            {sheet.scaleLabel && <span className="ml-2 text-xs text-muted-foreground">Scale {sheet.scaleLabel}</span>}
            <div className="ml-auto flex items-center gap-0.5">
              <Button variant="ghost" size="icon-sm" onClick={() => controller.current?.zoom(0.8)} aria-label="Zoom out">
                <ZoomOut />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => controller.current?.zoom(1.25)} aria-label="Zoom in">
                <ZoomIn />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => controller.current?.fit()} aria-label="Fit sheet">
                <Maximize />
              </Button>
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden bg-slate-200">
            <div ref={stage} className="absolute inset-0" />
            {ready && (
              <MarkupLayer
                markups={sheet.markups}
                selectedId={selectedId}
                draft={null}
                cursor={null}
                view={view}
                metersPerPoint={sheet.metersPerPoint}
                unitSystem={data.unitSystem}
                selectable={false}
                onSelect={noop}
                onMove={noop}
                onMoveEnd={noop}
              />
            )}
            {!ready && !loadError && (
              <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading sheet…
              </div>
            )}
            {loadError && <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-sm text-destructive">{loadError}</div>}
          </div>
        </div>

        <aside className="shrink-0 border-t bg-card lg:w-80 lg:overflow-y-auto lg:border-t-0 lg:border-l">
          <section className="space-y-2 border-b p-4">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Totals on this sheet</h2>
            {totals.length ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {totals.map((t) => (
                  <div key={t.kind} className="contents">
                    <dt className="text-muted-foreground capitalize">{t.kind}</dt>
                    <dd className="text-right font-medium tabular-nums">{t.text}</dd>
                  </div>
                ))}
                {data.includePrices && pricedTotal > 0 && (
                  <>
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="text-right font-medium tabular-nums">{formatMoney(pricedTotal, data.currency)}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{sheet.metersPerPoint ? "No measurements." : "This sheet has no scale, so lengths and areas aren't measured."}</p>
            )}
          </section>
          <section className="p-4">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Markups ({described.length})</h2>
            {described.length ? (
              <ul className="-mx-2 space-y-0.5">
                {described.map((d, i) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => select(d.id)}
                      className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", selectedId === d.id && "bg-muted")}
                    >
                      <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: sheet.markups[i].color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{d.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{d.lineItem ?? d.type}</span>
                      </span>
                      <span className="text-right text-xs tabular-nums">
                        {d.quantity && <span className="block">{d.quantity}</span>}
                        {d.amount !== null && <span className="block text-muted-foreground">{formatMoney(d.amount, data.currency)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No markups on this sheet.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
