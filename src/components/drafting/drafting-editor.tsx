"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertCircle, ArrowLeft, Check, Cloud, Loader2, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LinkButton } from "@/components/ui/link-button";
import { DEFAULT_SETTINGS, Editor, type Settings } from "@/lib/drafting/editor";
import { emptyDrawing, type DrawingData, type Units } from "@/lib/drafting/types";
import { cn } from "@/lib/utils";
import { attachFile } from "./attach";
import { BlocksPalette } from "./blocks-palette";
import { CommandLine } from "./command-line";
import { DraftingDialog } from "./dialogs";
import { DraftingCanvas } from "./drafting-canvas";
import { LayerManager, PropertiesPalette, StylesPalette } from "./palettes";
import { Ribbon } from "./ribbon";
import { StatusBar } from "./status-bar";
import { TextEditor } from "./text-editor";
import { displayColor } from "@/lib/drafting/aci";

// Drafting: a 2D CAD editor that works the way AutoCAD does. This component loads the drawing,
// lays out the ribbon, drawing area, command line, palettes and status bar, routes the keyboard
// to the editor, and saves as you work.

type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";
type PaletteName = "properties" | "layers" | "styles" | "blocks";

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

type Project = { id: string; name: string };

export function DraftingEditor({ drawing, units, backHref, projects }: { drawing: { id: string; name: string; revision: number }; units: Units; backHref: string; projects: Project[] }) {
  const [opened, setOpened] = useState<{ editor: Editor; hadView: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDrawing(drawing.id, units)
      .then((data) => {
        if (cancelled) return;
        const settings = stored<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
        const editor = new Editor(data, settings);
        editor.drawingName = drawing.name;
        setOpened({ editor, hadView: !!data.view });
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not open the drawing"));
    return () => {
      cancelled = true;
    };
  }, [drawing.id, drawing.name, units]);

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
  return <Workspace editor={opened.editor} drawing={drawing} backHref={backHref} hadView={opened.hadView} projects={projects} />;
}

/** The save state, small at the end of the ribbon's tab row (Ctrl+S saves now). */
function SaveStatus({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  if (save === "conflict")
    return <span className="text-xs text-destructive">Saved elsewhere meanwhile: reopen the drawing</span>;
  if (save === "error")
    return (
      <button type="button" onClick={onRetry} className="flex items-center gap-1 text-xs text-destructive hover:underline" title="Retry saving">
        <AlertCircle className="size-3.5" /> Not saved
      </button>
    );
  const title = save === "saving" ? "Saving…" : save === "saved" ? "All changes saved" : "Unsaved changes";
  return (
    <span className="flex items-center text-muted-foreground" title={`${title} (Ctrl+S saves now)`} aria-label={title}>
      {save === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : save === "saved" ? <Check className="size-3.5" /> : <Cloud className="size-3.5" />}
    </span>
  );
}

function Workspace({ editor, drawing, backHref, hadView, projects }: { editor: Editor; drawing: { id: string; name: string; revision: number }; backHref: string; hadView: boolean; projects: Project[] }) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  // The theme is a per-person preference: light unless they chose dark. (The workspace only
  // renders in the browser, after the drawing loads, so storage is there to read.)
  const [dark, setDark] = useState(() => stored(THEME_KEY, { dark: false }).dark);
  const [palettes, setPalettes] = useState({ properties: false, layers: false, styles: false, blocks: false });
  const [pagePick, setPagePick] = useState<{ count: number; resolve: (page: number | null) => void } | null>(null);
  const [save, setSave] = useState<SaveState>("saved");
  const chooseTheme = (d: boolean) => {
    setDark(d);
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify({ dark: d }));
    } catch {}
  };

  const togglePalette = useCallback((p: PaletteName) => setPalettes((s) => ({ ...s, [p]: !s[p] })), []);

  // Drafting aids (snaps, polar angle, grid) are remembered between drawings.
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch {}
  }, [state.settings]);

  // --- saving -----------------------------------------------------------------------------
  const revision = useRef(drawing.revision);
  const savedVersion = useRef(editor.drawing.version);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current) return;
    const version = editor.drawing.version;
    if (version === savedVersion.current) return;
    saving.current = true;
    setSave("saving");
    try {
      const data = editor.drawing.toData({ ...editor.view });
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
      setSave(editor.drawing.version === version ? "saved" : "unsaved");
    } catch {
      setSave("error");
    } finally {
      saving.current = false;
      if (editor.drawing.version !== savedVersion.current) timer.current = setTimeout(() => void saveNow(), 1500);
    }
  }, [editor, drawing.id]);

  useEffect(
    () =>
      editor.drawing.subscribe(() => {
        setSave((s) => (s === "conflict" ? s : "unsaved"));
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void saveNow(), 1500);
      }),
    [editor, saveNow],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (editor.drawing.version !== savedVersion.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      clearTimeout(timer.current);
    };
  }, [editor]);

  // --- attaching and exporting -----------------------------------------------------------------
  const choosePage = useCallback((count: number) => new Promise<number | null>((resolve) => setPagePick({ count, resolve })), []);

  const exportDxf = useCallback(async () => {
    // The export is made from the saved drawing: save first.
    while (saving.current) await new Promise((r) => setTimeout(r, 200));
    await saveNow();
    editor.print("Exporting DXF…", "info");
    try {
      const res = await fetch(`/api/drafting/${drawing.id}/dxf`, { cache: "no-store" });
      const body = (await res.json()) as { url?: string; error?: string; skipped?: Record<string, number> };
      if (!res.ok || !body.url) throw new Error(body.error ?? "Could not export the drawing");
      const link = document.createElement("a");
      link.href = body.url;
      link.click();
      const pictures = body.skipped?.image;
      editor.print(`Exported ${drawing.name}.dxf${pictures ? ` (without its ${pictures} attached picture${pictures === 1 ? "" : "s"})` : ""}.`, "info");
    } catch (err) {
      editor.print(err instanceof Error ? err.message : "Could not export the drawing", "error");
    }
  }, [editor, drawing.id, drawing.name, saveNow]);

  useEffect(() => {
    editor.setUi({
      openPalette: (p) => setPalettes((s) => ({ ...s, [p]: true })),
      attach: async (source) => {
        try {
          const file = await attachFile(drawing.id, editor.doc.units, source, choosePage);
          if (file) editor.print(`Attached ${file.name}.`, "info");
          return file;
        } catch (err) {
          editor.print(err instanceof Error ? err.message : "Could not attach the file", "error");
          return null;
        }
      },
      exportDxf: () => void exportDxf(),
    });
  }, [editor, drawing.id, choosePage, exportDxf]);

  // --- the keyboard ---------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']") || editor.dialog) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "p") {
        e.preventDefault();
        editor.runCommand("PLOT");
        return;
      }
      if (editor.key({ key: e.key, ctrl, shift: e.shiftKey, alt: e.altKey })) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, saveNow]);

  const pictureUrl = useCallback((key: string) => `/api/drafting/${drawing.id}/attachments?key=${encodeURIComponent(key)}`, [drawing.id]);

  const onReady = useCallback(() => {
    if (hadView) return;
    if (editor.drawing.entities.size) editor.zoomExtents();
    else editor.home();
  }, [editor, hadView]);

  const showPalettes = palettes.properties || palettes.layers || palettes.styles || palettes.blocks;

  return (
    <div data-drafting-root className={cn("relative flex h-svh min-h-[32rem] flex-col bg-background text-foreground", dark && "dark")}>
      <Ribbon
        editor={editor}
        state={state}
        dark={dark}
        onTheme={chooseTheme}
        palettes={palettes}
        onPalette={togglePalette}
        quickAccess={
          <>
            <LinkButton href={backHref} variant="ghost" size="icon-xs" aria-label="Back to drawings" title="Back to drawings">
              <ArrowLeft />
            </LinkButton>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <button type="button" onClick={() => editor.undo()} disabled={!state.canUndo} className="rounded p-1 hover:bg-accent disabled:opacity-40" title="Undo (Ctrl+Z)" aria-label="Undo">
              <Undo2 className="size-3.5" />
            </button>
            <button type="button" onClick={() => editor.redo()} disabled={!state.canRedo} className="rounded p-1 hover:bg-accent disabled:opacity-40" title="Redo (Ctrl+Y)" aria-label="Redo">
              <Redo2 className="size-3.5" />
            </button>
          </>
        }
        status={<SaveStatus save={save} onRetry={() => void saveNow()} />}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <DraftingCanvas editor={editor} dark={dark} onReady={onReady} pictureUrl={pictureUrl} />
          {state.textEdit && (
            <TextEditor
              key={`${state.textEdit.at.x},${state.textEdit.at.y}`}
              editor={editor}
              request={state.textEdit}
              color={displayColor(editor.doc.layers.get(editor.doc.currentLayer)?.color ?? 7, dark)}
            />
          )}
          <CommandLine editor={editor} state={state} />
        </div>
        {showPalettes && (
          <aside className="flex w-80 shrink-0 flex-col border-l bg-background">
            {palettes.properties && <PropertiesPalette editor={editor} state={state} dark={dark} onClose={() => togglePalette("properties")} />}
            {palettes.layers && <LayerManager editor={editor} state={state} dark={dark} onClose={() => togglePalette("layers")} />}
            {palettes.styles && <StylesPalette editor={editor} state={state} onClose={() => togglePalette("styles")} />}
            {palettes.blocks && <BlocksPalette editor={editor} state={state} dark={dark} onClose={() => togglePalette("blocks")} />}
          </aside>
        )}
      </div>
      <StatusBar editor={editor} state={state} dark={dark} onTheme={chooseTheme} />
      {state.dialog && <DraftingDialog editor={editor} request={state.dialog} context={{ drawingId: drawing.id, drawingName: drawing.name, projects }} />}
      {pagePick && (
        <PagePicker
          count={pagePick.count}
          onDone={(page) => {
            pagePick.resolve(page);
            setPagePick(null);
          }}
        />
      )}
    </div>
  );
}

/** Which page of a PDF to attach (PDFATTACH's page list). */
function PagePicker({ count, onDone }: { count: number; onDone: (page: number | null) => void }) {
  const [page, setPage] = useState("1");
  const n = Math.round(Number(page));
  const valid = Number.isFinite(n) && n >= 1 && n <= count;
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent className="sm:max-w-xs" onKeyDown={(e) => e.stopPropagation()}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onDone(n);
          }}
        >
          <DialogHeader>
            <DialogTitle>Attach PDF Underlay</DialogTitle>
            <DialogDescription>This PDF has {count} pages. Which one goes under the drawing?</DialogDescription>
          </DialogHeader>
          <Input type="number" min={1} max={count} value={page} onChange={(e) => setPage(e.target.value)} autoFocus aria-label="Page" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              OK
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
