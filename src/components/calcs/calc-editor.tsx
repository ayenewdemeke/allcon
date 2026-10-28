"use client";

import "mathlive/fonts.css";
import "mathlive/static.css";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertCircle, ArrowLeft, Check, Cloud, Loader2, Minus, Plus, Redo2, Undo2 } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { CalcDocument } from "@/lib/calcs/document";
import { evaluateSheet, type UnitSystem } from "@/lib/calcs/evaluate";
import { emptyCalc, PAGES, readingOrder, type CalcData, type MathRegion } from "@/lib/calcs/types";
import { CalcRibbon } from "./ribbon";
import { Worksheet, type WorksheetHandle } from "./worksheet";

// Calcs: engineering calculation worksheets that work the way Mathcad does. This component
// loads the worksheet, works out its math (live, as it's typed), saves as you work, and lays
// out the ribbon, the pages and the status bar. Printing gives just the pages.

type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";

async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function loadCalc(calcId: string, system: UnitSystem): Promise<CalcData> {
  const res = await fetch(`/api/calcs/${calcId}/file`, { cache: "no-store" });
  if (res.status === 204) return emptyCalc(system);
  if (!res.ok) throw new Error(`Could not open the worksheet (${res.status})`);
  const data = (await res.json()) as CalcData;
  if (data?.format !== "conkit-calc") throw new Error("This file isn't a worksheet");
  return data;
}

export function CalcEditor({ calc, system, backHref }: { calc: { id: string; name: string; revision: number }; system: UnitSystem; backHref: string }) {
  const [doc, setDoc] = useState<CalcDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadCalc(calc.id, system)
      .then((data) => {
        if (cancelled) return;
        if (!data.header.title && !data.regions.length) data.header = { ...data.header, title: calc.name };
        setDoc(new CalcDocument(data));
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not open the worksheet"));
    return () => {
      cancelled = true;
    };
  }, [calc.id, calc.name, system]);

  if (error)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <LinkButton href={backHref} variant="outline" size="sm">
          Back to worksheets
        </LinkButton>
      </div>
    );
  if (!doc)
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> Opening {calc.name}…
      </div>
    );
  return <Workspace doc={doc} calc={calc} backHref={backHref} />;
}

function SaveStatus({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  if (save === "conflict") return <span className="text-xs text-destructive">Saved elsewhere meanwhile: reopen the worksheet</span>;
  if (save === "error")
    return (
      <button type="button" onClick={onRetry} className="flex items-center gap-1 text-xs text-destructive hover:underline" title="Retry saving">
        <AlertCircle className="size-3.5" /> Not saved
      </button>
    );
  const title = save === "saving" ? "Saving…" : save === "saved" ? "All changes saved" : "Unsaved changes";
  return (
    <span className="flex items-center text-muted-foreground" title={title} aria-label={title}>
      {save === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : save === "saved" ? <Check className="size-3.5" /> : <Cloud className="size-3.5" />}
    </span>
  );
}

function Workspace({ doc, calc, backHref }: { doc: CalcDocument; calc: { id: string; name: string; revision: number }; backHref: string }) {
  const version = useSyncExternalStore(
    useCallback((l: () => void) => doc.subscribe(l), [doc]),
    () => doc.version,
    () => doc.version,
  );
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [zoom, setZoom] = useState(1);
  const [save, setSave] = useState<SaveState>("saved");
  const worksheet = useRef<WorksheetHandle | null>(null);

  // The math, worked out in reading order with what's being typed (live, as in Mathcad).
  const results = useMemo(() => {
    void version;
    const math = readingOrder([...doc.regions.values()]).filter((r): r is MathRegion => r.kind === "math");
    return evaluateSheet(math.map((r) => ({ id: r.id, latex: drafts.get(r.id) ?? r.latex, displayUnit: r.displayUnit })), doc.settings);
  }, [doc, version, drafts]);
  const errors = [...results.values()].filter((r) => r.kind === "error" && !r.incomplete).length;

  // --- saving ---------------------------------------------------------------------------------
  const revision = useRef(calc.revision);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current || !doc.unsaved) return;
    saving.current = true;
    setSave("saving");
    try {
      const seq = doc.editSeq;
      const data = doc.toData();
      const body = await gzip(JSON.stringify(data));
      const link = await fetch(`/api/calcs/${calc.id}/save`, { method: "POST" });
      if (!link.ok) throw new Error();
      const { key, upload } = (await link.json()) as { key: string; upload: { url: string; headers: Record<string, string> } };
      const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body });
      if (!put.ok) throw new Error();
      const done = await fetch(`/api/calcs/${calc.id}/save?key=${encodeURIComponent(key)}&revision=${revision.current}&count=${data.regions.length}`, { method: "PATCH" });
      if (done.status === 409) return setSave("conflict");
      if (!done.ok) throw new Error();
      revision.current = ((await done.json()) as { revision: number }).revision;
      doc.markSaved(seq);
      setSave(doc.unsaved ? "unsaved" : "saved");
    } catch {
      setSave("error");
    } finally {
      saving.current = false;
      if (doc.unsaved) timer.current = setTimeout(() => void saveNow(), 1500);
    }
  }, [doc, calc.id]);

  useEffect(
    () =>
      doc.subscribe(() => {
        setSave((s) => (s === "conflict" ? s : "unsaved"));
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void saveNow(), 1500);
      }),
    [doc, saveNow],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (doc.unsaved) e.preventDefault();
    };
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("keydown", keys);
      clearTimeout(timer.current);
    };
  }, [doc, saveNow]);

  const page = PAGES[doc.paper];
  return (
    <div className="calc-root flex h-svh flex-col bg-background text-foreground">
      {/* Printing gives the pages alone, at the paper's size. */}
      <style>{`
        .calc-field math-field { font-size: 16px; border: none; background: transparent; outline: none; padding: 0; min-width: 2rem; --caret-color: #2563eb; --selection-background-color: #dbeafe; }
        .calc-field math-field::part(menu-toggle), .calc-field math-field::part(virtual-keyboard-toggle) { display: none; }
        .calc-field math-field::part(content) { padding: 0; }
        @media print {
          @page { size: ${doc.paper === "a4" ? "A4" : "letter"}; margin: 0; }
          html, body { background: white !important; }
          .no-print { display: none !important; }
          .calc-root { height: auto !important; display: block !important; }
          .calc-scroll { overflow: visible !important; background: white !important; }
          .calc-pages { padding: 0 !important; display: block !important; }
          .calc-pages > div { width: ${page.width}px !important; height: auto !important; }
          .calc-pages > div > div { transform: none !important; }
          .calc-page { box-shadow: none !important; margin: 0 !important; break-after: page; }
        }
      `}</style>
      <CalcRibbon
        doc={doc}
        worksheet={worksheet}
        quickAccess={
          <>
            <LinkButton href={backHref} variant="ghost" size="icon-xs" aria-label="Back to worksheets" title="Back to worksheets">
              <ArrowLeft />
            </LinkButton>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <button type="button" onClick={() => doc.undo()} disabled={!doc.canUndo} className="rounded p-1 hover:bg-accent disabled:opacity-40" title="Undo (Ctrl+Z)" aria-label="Undo">
              <Undo2 className="size-3.5" />
            </button>
            <button type="button" onClick={() => doc.redo()} disabled={!doc.canRedo} className="rounded p-1 hover:bg-accent disabled:opacity-40" title="Redo (Ctrl+Y)" aria-label="Redo">
              <Redo2 className="size-3.5" />
            </button>
          </>
        }
        status={<SaveStatus save={save} onRetry={() => void saveNow()} />}
      />
      <div className="calc-scroll min-h-0 flex-1 overflow-auto bg-neutral-200 dark:bg-neutral-800">
        <Worksheet doc={doc} version={version} results={results} zoom={zoom} drafts={drafts} setDrafts={setDrafts} handle={worksheet} />
      </div>
      <div className="no-print flex h-8 items-center gap-3 border-t bg-muted/40 px-3 text-xs text-muted-foreground">
        <span>{doc.regions.size} regions</span>
        {errors > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <AlertCircle className="size-3.5" />
            {errors} error{errors === 1 ? "" : "s"}
          </span>
        )}
        <span className="ml-auto">{doc.settings.system === "SI" ? "SI units" : "US customary units"}</span>
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} className="rounded p-0.5 hover:bg-accent" aria-label="Zoom out">
            <Minus className="size-3.5" />
          </button>
          <button type="button" onClick={() => setZoom(1)} className="w-10 text-center tabular-nums hover:text-foreground" title="Zoom to 100%">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))} className="rounded p-0.5 hover:bg-accent" aria-label="Zoom in">
            <Plus className="size-3.5" />
          </button>
        </span>
      </div>
    </div>
  );
}
