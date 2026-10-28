"use client";

import "mathlive/fonts.css";
import "mathlive/static.css";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertCircle, ArrowLeft, Check, Cloud, Loader2, Minus, Plus, Redo2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { publishCalcToSheets, setCalcProject } from "@/app/actions/calcs";
import { LinkButton } from "@/components/ui/link-button";
import { CalcDocument } from "@/lib/calcs/document";
import { evaluateSheet, type SheetItem, type UnitSystem } from "@/lib/calcs/evaluate";
import { loadShapes } from "@/lib/calcs/library/shapes";
import { findTemplate, layout } from "@/lib/calcs/library/templates";
import { emptyCalc, PAGES, readingOrder, type CalcData } from "@/lib/calcs/types";
import { People, personColor } from "@/components/drafting/presence";
import { CalcRibbon } from "./ribbon";
import { Worksheet, type Other, type WorksheetHandle } from "./worksheet";

// Calcs: engineering calculation worksheets that work the way Mathcad does. This component
// loads the worksheet, works out its math (live, as it's typed), saves as you work, takes in
// what others save (people, or AI apps through the connector), and lays out the ribbon, the
// pages and the status bar. Printing gives just the pages.

type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";
type Person = { id: string; name: string; app: boolean; region: string | null; cursor: [number, number] | null; activity: string | null };

async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A worksheet's file, or for a new one, an empty worksheet or the template it starts from. */
async function loadCalc(calcId: string, system: UnitSystem, template?: string): Promise<CalcData & { fromTemplate?: boolean }> {
  const res = await fetch(`/api/calcs/${calcId}/file`, { cache: "no-store" });
  if (res.status === 204) {
    const t = findTemplate(template);
    const data = emptyCalc(t?.system ?? system);
    return t ? { ...data, header: { ...data.header, title: t.name }, regions: layout(t.lines, { x: 0, y: 0 }, data.paper), fromTemplate: true } : data;
  }
  if (!res.ok) throw new Error(`Could not open the worksheet (${res.status})`);
  const data = (await res.json()) as CalcData;
  if (data?.format !== "conkit-calc") throw new Error("This file isn't a worksheet");
  return data;
}

type CalcInfo = { id: string; name: string; revision: number; projectId: string | null };

export function CalcEditor({ calc, projects, system, template, backHref }: { calc: CalcInfo; projects: { id: string; name: string }[]; system: UnitSystem; template?: string; backHref: string }) {
  const [doc, setDoc] = useState<CalcDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadCalc(calc.id, system, template)
      .then(({ fromTemplate, ...data }) => {
        if (cancelled) return;
        if (fromTemplate || (!data.header.title && !data.regions.length)) data.header = { ...data.header, title: calc.name };
        const doc = new CalcDocument(data);
        if (fromTemplate) doc.markUnsaved();
        setDoc(doc);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not open the worksheet"));
    return () => {
      cancelled = true;
    };
  }, [calc.id, calc.name, system, template]);

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
  return <Workspace doc={doc} calc={calc} projects={projects} backHref={backHref} />;
}

function SaveStatus({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  if (save === "conflict") return <span className="text-xs text-destructive">Couldn&apos;t save over others&apos; changes: reopen the worksheet</span>;
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

function Workspace({ doc, calc, projects, backHref }: { doc: CalcDocument; calc: CalcInfo; projects: { id: string; name: string }[]; backHref: string }) {
  const version = useSyncExternalStore(
    useCallback((l: () => void) => doc.subscribe(l), [doc]),
    () => doc.version,
    () => doc.version,
  );
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [zoom, setZoom] = useState(1);
  const [save, setSave] = useState<SaveState>("saved");
  const worksheet = useRef<WorksheetHandle | null>(null);
  // The steel shapes table, loaded alongside (sections work out once it's here).
  const [shapes, setShapes] = useState(false);
  useEffect(() => {
    let live = true;
    void loadShapes().then(() => live && setShapes(true));
    return () => {
      live = false;
    };
  }, []);

  // The math, worked out in reading order with what's being typed (live, as in Mathcad).
  const results = useMemo(() => {
    void version;
    void shapes;
    const items = readingOrder([...doc.regions.values()]).flatMap((r): SheetItem[] => {
      if (r.kind === "math") return [{ id: r.id, kind: "math", latex: drafts.get(r.id) ?? r.latex, displayUnit: r.displayUnit }];
      if (r.kind === "text") return [];
      return [r];
    });
    return evaluateSheet(items, doc.settings);
  }, [doc, version, drafts, shapes]);
  const errors = [...results.values()].filter((r) => r.kind === "error" && !r.incomplete).length;

  // --- saving, and others' changes ------------------------------------------------------------
  // Several people (and AI apps through the connector) can work on a worksheet at once. Each
  // saves what they changed; when someone else saves, their version is pulled in here, region by
  // region, keeping what's changed here and not saved yet.
  const revision = useRef(calc.revision);
  const saving = useRef(false);
  const pulling = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [people, setPeople] = useState<Person[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  /** Takes in the latest saved version, if it's newer than the one here. */
  const pull = useCallback(async () => {
    if (pulling.current) return false;
    pulling.current = true;
    try {
      const meta = (await (await fetch(`/api/calcs/${calc.id}/file?meta=1`, { cache: "no-store" })).json()) as { revision: number; url: string | null };
      if (meta.revision <= revision.current || !meta.url) return false;
      const data = (await (await fetch(meta.url, { cache: "no-store" })).json()) as CalcData;
      doc.applyRemote(data);
      revision.current = meta.revision;
      return true;
    } finally {
      pulling.current = false;
    }
  }, [doc, calc.id]);

  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current || !doc.unsaved) return;
    saving.current = true;
    setSave("saving");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const seq = doc.editSeq;
        const data = doc.toData();
        const body = await gzip(JSON.stringify(data));
        const link = await fetch(`/api/calcs/${calc.id}/save`, { method: "POST" });
        if (!link.ok) throw new Error();
        const { key, upload } = (await link.json()) as { key: string; upload: { url: string; headers: Record<string, string> } };
        const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body });
        if (!put.ok) throw new Error();
        const done = await fetch(`/api/calcs/${calc.id}/save?key=${encodeURIComponent(key)}&revision=${revision.current}&count=${data.regions.length}`, { method: "PATCH" });
        if (done.status === 409) {
          // Saved by someone else meanwhile: take theirs in, then save on top of it.
          await pull();
          continue;
        }
        if (!done.ok) throw new Error();
        revision.current = ((await done.json()) as { revision: number }).revision;
        doc.markSaved(seq);
        setSave(doc.unsaved ? "unsaved" : "saved");
        return;
      }
      setSave("conflict");
    } catch {
      setSave("error");
    } finally {
      saving.current = false;
      if (doc.unsaved) timer.current = setTimeout(() => void saveNow(), 1500);
    }
  }, [doc, calc.id, pull]);

  useEffect(
    () =>
      doc.subscribe(() => {
        if (!doc.unsaved) return; // others' changes taken in
        setSave((s) => (s === "conflict" ? s : "unsaved"));
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void saveNow(), 1500);
      }),
    [doc, saveNow],
  );
  // Checking in: what this person is editing (for others' presence), the latest revision, and
  // who else is here. Every 2 seconds while the tab is visible.
  useEffect(() => {
    const url = `/api/calcs/${calc.id}/state`;
    let clear: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.hidden) return;
      const me = worksheet.current?.presence() ?? { region: null, cursor: null };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(me) }).catch(() => null);
      if (!res?.ok) return;
      const state = (await res.json()) as { revision: number; people: Person[] };
      setPeople(state.people);
      if (state.revision > revision.current && !saving.current && (await pull().catch(() => false))) {
        const apps = state.people.filter((p) => p.app && p.activity);
        const names = state.people.filter((p) => !p.app).map((p) => p.name);
        setNotice(apps.length ? `Changes from ${apps.map((a) => `${a.name}: ${a.activity}`).join("; ")}` : `Changes from ${names.join(", ") || "another window"} are in`);
        clearTimeout(clear);
        clear = setTimeout(() => setNotice(null), 8000);
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 2000);
    const leave = () => void fetch(url, { method: "DELETE", keepalive: true }).catch(() => {});
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(interval);
      clearTimeout(clear);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [calc.id, pull]);
  const others = useMemo<Other[]>(() => people.map((p) => ({ ...p, color: personColor(p.id) })), [people]);

  // A worksheet started from a template saves straight away.
  useEffect(() => {
    if (doc.unsaved) timer.current = setTimeout(() => void saveNow(), 500);
  }, [doc, saveNow]);
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

  // --- the project it's filed under, and publishing to its Sheets ------------------------------
  const [projectId, setProjectId] = useState(calc.projectId);
  const [publishing, setPublishing] = useState(false);
  const chooseProject = (id: string | null) => {
    const before = projectId;
    setProjectId(id);
    setCalcProject(calc.id, id).catch(() => {
      setProjectId(before);
      toast.error("Could not file the worksheet under that project");
    });
  };
  const publish = async () => {
    setPublishing(true);
    try {
      // What's published is the saved worksheet: save (or wait for the save under way) first.
      for (let i = 0; i < 20 && doc.unsaved; i++) {
        await saveNow();
        if (doc.unsaved) await new Promise((r) => setTimeout(r, 300));
      }
      if (doc.unsaved) throw new Error("Not saved");
      const result = await publishCalcToSheets(calc.id);
      if ("error" in result) toast.error(result.error);
      else toast.success(`Published to Sheets: ${result.sheets} sheet${result.sheets === 1 ? "" : "s"}`, { action: { label: "Open", onClick: () => window.open(result.link, "_blank") } });
    } catch {
      toast.error("Could not publish the worksheet");
    } finally {
      setPublishing(false);
    }
  };

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
          .calc-page:last-child { break-after: auto; }
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
        project={{ projects, projectId, onProject: chooseProject, onPublish: () => void publish(), publishing }}
        status={
          <span className="flex items-center gap-2">
            <People people={people} noun="worksheet" />
            <SaveStatus save={save} onRetry={() => void saveNow()} />
          </span>
        }
      />
      <div className="calc-scroll min-h-0 flex-1 overflow-auto bg-neutral-200 dark:bg-neutral-800">
        <Worksheet doc={doc} version={version} results={results} zoom={zoom} drafts={drafts} setDrafts={setDrafts} handle={worksheet} others={others} />
      </div>
      <div className="no-print flex h-8 items-center gap-3 border-t bg-muted/40 px-3 text-xs text-muted-foreground">
        <span>{doc.regions.size} regions</span>
        {errors > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <AlertCircle className="size-3.5" />
            {errors} error{errors === 1 ? "" : "s"}
          </span>
        )}
        {notice && <span className="truncate text-primary">{notice}</span>}
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
