"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertCircle, ArrowLeft, Check, Cloud, Loader2, Redo2, Undo2 } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { DEFAULT_SETTINGS, Editor, type Settings } from "@/lib/drafting/editor";
import { emptyDrawing, type DrawingData, type Units } from "@/lib/drafting/types";
import { cn } from "@/lib/utils";
import { CommandLine } from "./command-line";
import { DraftingCanvas } from "./drafting-canvas";
import { LayerManager, PropertiesPalette } from "./palettes";
import { Ribbon } from "./ribbon";
import { StatusBar } from "./status-bar";

// Drafting: a 2D CAD editor that works the way AutoCAD does. This component loads the drawing,
// lays out the ribbon, drawing area, command line, palettes and status bar, routes the keyboard
// to the editor, and saves as you work.

type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";

const THEME_KEY = "conkit:drafting-theme";
const SETTINGS_KEY = "conkit:drafting-settings";

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function loadDrawing(drawingId: string, units: Units): Promise<DrawingData> {
  const res = await fetch(`/api/drafting/${drawingId}/file`, { cache: "no-store" });
  if (res.status === 204) return emptyDrawing(units);
  if (!res.ok) throw new Error(`Could not open the drawing (${res.status})`);
  const data = (await res.json()) as DrawingData;
  if (data?.format !== "conkit-drawing") throw new Error("This file isn't a drawing");
  return data;
}

export function DraftingEditor({ drawing, units, backHref }: { drawing: { id: string; name: string; revision: number }; units: Units; backHref: string }) {
  const [opened, setOpened] = useState<{ editor: Editor; hadView: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDrawing(drawing.id, units)
      .then((data) => {
        if (cancelled) return;
        const settings = stored<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
        setOpened({ editor: new Editor(data, settings), hadView: !!data.view });
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not open the drawing"));
    return () => {
      cancelled = true;
    };
  }, [drawing.id, units]);

  if (error)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <LinkButton href={backHref} variant="outline" size="sm">
          Back to drawings
        </LinkButton>
      </div>
    );
  if (!opened)
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> Opening {drawing.name}…
      </div>
    );
  return <Workspace editor={opened.editor} drawing={drawing} backHref={backHref} hadView={opened.hadView} />;
}

function Workspace({ editor, drawing, backHref, hadView }: { editor: Editor; drawing: { id: string; name: string; revision: number }; backHref: string; hadView: boolean }) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  // The theme is a per-person preference: light unless they chose dark. (The workspace only
  // renders in the browser, after the drawing loads, so storage is there to read.)
  const [dark, setDark] = useState(() => stored(THEME_KEY, { dark: false }).dark);
  const [palettes, setPalettes] = useState({ properties: false, layers: false });
  const [save, setSave] = useState<SaveState>("saved");
  const chooseTheme = (d: boolean) => {
    setDark(d);
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify({ dark: d }));
    } catch {}
  };

  const togglePalette = useCallback((p: "properties" | "layers") => setPalettes((s) => ({ ...s, [p]: !s[p] })), []);
  useEffect(() => {
    editor.setUi({ openPalette: (p) => setPalettes((s) => ({ ...s, [p]: true })) });
  }, [editor]);

  // Drafting aids (snaps, polar angle, grid) are remembered between drawings.
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch {}
  }, [state.settings]);

  // --- saving -----------------------------------------------------------------------------
  const revision = useRef(drawing.revision);
  const savedVersion = useRef(editor.doc.version);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current) return;
    const version = editor.doc.version;
    if (version === savedVersion.current) return;
    saving.current = true;
    setSave("saving");
    try {
      const data = editor.doc.toData({ ...editor.view });
      const body = await gzip(JSON.stringify(data));
      const link = await fetch(`/api/drafting/${drawing.id}/save`, { method: "POST" });
      if (!link.ok) throw new Error();
      const { key, upload } = (await link.json()) as { key: string; upload: { url: string; headers: Record<string, string> } };
      const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body });
      if (!put.ok) throw new Error();
      const done = await fetch(`/api/drafting/${drawing.id}/save?key=${encodeURIComponent(key)}&revision=${revision.current}&count=${data.entities.length}`, { method: "PATCH" });
      if (done.status === 409) {
        setSave("conflict");
        return;
      }
      if (!done.ok) throw new Error();
      revision.current = ((await done.json()) as { revision: number }).revision;
      savedVersion.current = version;
      setSave(editor.doc.version === version ? "saved" : "unsaved");
    } catch {
      setSave("error");
    } finally {
      saving.current = false;
      if (editor.doc.version !== savedVersion.current) timer.current = setTimeout(() => void saveNow(), 1500);
    }
  }, [editor, drawing.id]);

  useEffect(
    () =>
      editor.doc.subscribe(() => {
        setSave((s) => (s === "conflict" ? s : "unsaved"));
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void saveNow(), 1500);
      }),
    [editor, saveNow],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (editor.doc.version !== savedVersion.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      clearTimeout(timer.current);
    };
  }, [editor]);

  // --- the keyboard ---------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (editor.key({ key: e.key, ctrl, shift: e.shiftKey, alt: e.altKey })) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, saveNow]);

  const onReady = useCallback(() => {
    if (hadView) return;
    if (editor.doc.entities.size) editor.zoomExtents();
    else editor.home();
  }, [editor, hadView]);

  const showPalettes = palettes.properties || palettes.layers;

  return (
    <div data-drafting-root className={cn("relative flex h-svh min-h-[32rem] flex-col bg-background text-foreground", dark && "dark")}>
      <div className="flex h-9 items-center gap-2 border-b px-2">
        <LinkButton href={backHref} variant="ghost" size="icon-sm" aria-label="Back to drawings">
          <ArrowLeft />
        </LinkButton>
        <span className="truncate text-sm font-semibold">{drawing.name}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Drawings save as you work (Ctrl+S saves now)">
          {save === "saving" ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Saving…
            </>
          ) : save === "saved" ? (
            <>
              <Check className="size-3.5" /> Saved
            </>
          ) : save === "unsaved" ? (
            <>
              <Cloud className="size-3.5" /> Unsaved changes
            </>
          ) : save === "conflict" ? (
            <span className="text-destructive">Saved elsewhere meanwhile: reopen the drawing to continue</span>
          ) : (
            <button type="button" onClick={() => void saveNow()} className="text-destructive underline">
              Couldn&apos;t save. Retry
            </button>
          )}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" onClick={() => editor.undo()} disabled={!state.canUndo} className="rounded p-1 hover:bg-accent disabled:opacity-40" title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2 className="size-4" />
          </button>
          <button type="button" onClick={() => editor.redo()} disabled={!state.canRedo} className="rounded p-1 hover:bg-accent disabled:opacity-40" title="Redo (Ctrl+Y)" aria-label="Redo">
            <Redo2 className="size-4" />
          </button>
        </div>
      </div>
      <Ribbon editor={editor} state={state} dark={dark} onTheme={chooseTheme} palettes={palettes} onPalette={togglePalette} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <DraftingCanvas editor={editor} dark={dark} onReady={onReady} />
          <CommandLine editor={editor} state={state} />
        </div>
        {showPalettes && (
          <aside className="flex w-80 shrink-0 flex-col border-l bg-background">
            {palettes.properties && <PropertiesPalette editor={editor} state={state} dark={dark} onClose={() => togglePalette("properties")} />}
            {palettes.layers && <LayerManager editor={editor} state={state} dark={dark} onClose={() => togglePalette("layers")} />}
          </aside>
        )}
      </div>
      <StatusBar editor={editor} state={state} dark={dark} onTheme={chooseTheme} />
    </div>
  );
}
