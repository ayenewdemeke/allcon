"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Cloud,
  Copy,
  Hand,
  Hash,
  Loader2,
  Maximize,
  PanelRightClose,
  PanelRightOpen,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Pentagon,
  Ruler,
  Spline,
  StickyNote,
  Trash2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { setMarkupLineItem } from "@/app/actions/mapping";
import { createMarkup, deleteMarkup, setSheetScale, updateMarkup, type SavedMarkup } from "@/app/actions/sheets";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { LinkButton } from "@/components/ui/link-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { calibrate, distance, type Point, type UnitSystem } from "@/lib/takeoff";
import { usePanelOpen } from "@/hooks/use-panel-open";
import { cn, modKey } from "@/lib/utils";
import { CalibrateDialog, NoteDialog } from "./dialogs";
import { ExportPdfDialog, ShareDialog } from "./export-share-dialogs";
import { MarkupLayer, type Draft } from "./markup-layer";
import { MarkupPanel } from "./markup-panel";
import { SheetController, type ControllerTool } from "./sheet-controller";
import type { View } from "./view";

export type SheetInfo = {
  id: string;
  drawingSetId: string;
  pageIndex: number;
  number: string | null;
  title: string | null;
  width: number;
  height: number;
  metersPerPoint: number | null;
  scaleLabel: string | null;
};
export type SiblingSheet = { id: string; pageIndex: number; number: string | null; title: string | null; markupCount: number };
export type SheetLineItem = { id: string; code: string | null; description: string; unit: string | null };

type Tool = "select" | "pan" | "calibrate" | "length" | "area" | "count" | "note" | "arrow" | "cloud";

const TOOLS: { id: Tool; label: string; key: string; icon: LucideIcon; group: "nav" | "measure" | "markup" }[] = [
  { id: "select", label: "Select and edit", key: "V", icon: MousePointer2, group: "nav" },
  { id: "pan", label: "Pan", key: "H", icon: Hand, group: "nav" },
  { id: "calibrate", label: "Calibrate scale", key: "K", icon: Ruler, group: "measure" },
  { id: "length", label: "Length", key: "L", icon: Spline, group: "measure" },
  { id: "area", label: "Area", key: "A", icon: Pentagon, group: "measure" },
  { id: "count", label: "Count", key: "C", icon: Hash, group: "measure" },
  { id: "note", label: "Note", key: "N", icon: StickyNote, group: "markup" },
  { id: "arrow", label: "Arrow", key: "R", icon: MoveUpRight, group: "markup" },
  { id: "cloud", label: "Revision cloud", key: "D", icon: Cloud, group: "markup" },
];

// Lengths, areas and calibration are drawn with Edit2D; the rest with our own click tool.
const CONTROLLER_TOOL: Record<Tool, ControllerTool> = {
  select: "select",
  pan: "pan",
  calibrate: "calibrate",
  length: "length",
  area: "area",
  count: "click",
  note: "click",
  arrow: "click",
  cloud: "click",
};
const EDIT2D_KINDS = new Set(["length", "area"]);

const DEFAULT_COLORS: Record<SavedMarkup["kind"], string> = {
  length: "#2563eb",
  area: "#16a34a",
  count: "#dc2626",
  arrow: "#dc2626",
  cloud: "#dc2626",
  note: "#ca8a04",
};

const HINTS: Record<Tool, string> = {
  select: "Click to select · drag to move, or drag points to reshape · right-click for Duplicate, Copy, Delete",
  pan: "Drag to pan · scroll to zoom",
  calibrate: "Click both ends of a dimension you know, then double-click · snaps to the drawing",
  length: "Click to add points · double-click to finish · snaps to the drawing",
  area: "Click the corners · click the first point or double-click to close · snaps to the drawing",
  count: "Click each item · Enter to finish",
  note: "Click where the note should go",
  arrow: "Click the start, then the point",
  cloud: "Click two opposite corners",
};

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

function orthoSnap(from: Point, to: Point): Point {
  const angle = Math.round(Math.atan2(to[1] - from[1], to[0] - from[0]) / (Math.PI / 4)) * (Math.PI / 4);
  const len = distance(from, to);
  return [from[0] + Math.cos(angle) * len, from[1] + Math.sin(angle) * len];
}

export function SheetWorkspace({
  projectId,
  sheet: initialSheet,
  siblings,
  initialMarkups,
  initialUnitSystem,
  lineItems,
  author,
  focus,
}: {
  projectId: string;
  sheet: SheetInfo;
  siblings: SiblingSheet[];
  initialMarkups: SavedMarkup[];
  initialUnitSystem: UnitSystem;
  lineItems: SheetLineItem[];
  author: string;
  /** A box to zoom to and outline (from a link, e.g. a design value's source on the plans). */
  focus?: [number, number, number, number] | null;
}) {
  const router = useRouter();
  const [panelOpen, togglePanel] = usePanelOpen("conkit.sheetPanel");
  const stage = useRef<HTMLDivElement>(null);
  const controller = useRef<SheetController | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ zoom: 0, tx: 0, ty: 0 });

  const [sheet, setSheet] = useState(initialSheet);
  const [markups, setMarkups] = useState(initialMarkups);
  const [unitSystem, setUnitSystem] = useState(initialUnitSystem);
  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState<number | null>(null);
  const [notePoint, setNotePoint] = useState<Point | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [contextId, setContextId] = useState<string | null>(null); // markup under the right-click
  const clipboard = useRef<SavedMarkup | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const lastPointer = useRef<Point | null>(null); // sheet point under the mouse, for paste
  // New measurements are assigned to this line item, as in Bluebeam/PlanSwift takeoff.
  const [activeLineItemId, setActiveLineItemId] = useState<string | null>(null);
  // Read through a ref: the Viewer controller holds on to the save callback it was created with.
  const activeLineItem = useRef<string | null>(null);
  useEffect(() => {
    activeLineItem.current = activeLineItemId;
  }, [activeLineItemId]);

  // Handlers the controller calls are read through a ref, so it always sees current state.
  const handlers = useRef<{
    click: (p: Point, shift: boolean) => void;
    move: (p: Point | null, shift: boolean) => void;
    doubleClick: () => void;
  }>({ click: () => {}, move: () => {}, doubleClick: () => {} });

  // --- saving -----------------------------------------------------------------

  const assignLineItem = useCallback(async (markupId: string, lineItemId: string | null, quiet = false) => {
    try {
      await setMarkupLineItem(markupId, lineItemId);
      setMarkups((list) => list.map((m) => (m.id === markupId ? { ...m, lineItemId } : m)));
      return true;
    } catch (err) {
      if (!quiet) toast.error(err instanceof Error ? err.message : "Could not save the assignment");
      return false;
    }
  }, []);

  const saveNew = useCallback(
    async (kind: SavedMarkup["kind"], points: Point[], extra: Partial<SavedMarkup> = {}) => {
      const color = DEFAULT_COLORS[kind];
      try {
        const saved = await createMarkup(sheet.id, { kind, points, color, text: extra.text ?? null });
        setMarkups((list) => [...list, saved]);
        const active = activeLineItem.current;
        if (active && (kind === "length" || kind === "area" || kind === "count")) {
          // A measurement that can't price the active line (e.g. a length on an SF line) stays unassigned.
          if (!(await assignLineItem(saved.id, active, true))) {
            toast.warning(`Saved, but a ${kind} can't price the selected line item's unit. Assign it from the panel.`);
          }
        }
        return saved;
      } catch {
        toast.error("Could not save that markup");
        return null;
      }
    },
    [sheet.id, assignLineItem],
  );

  const patchMarkup = useCallback(async (id: string, patch: Partial<SavedMarkup>) => {
    let previous: SavedMarkup | undefined;
    setMarkups((list) =>
      list.map((m) => {
        if (m.id !== id) return m;
        previous = m;
        return { ...m, ...patch };
      }),
    );
    if (patch.color && previous && EDIT2D_KINDS.has(previous.kind)) controller.current?.setColor(id, patch.color);
    try {
      await updateMarkup(id, patch);
    } catch {
      if (previous) setMarkups((list) => list.map((m) => (m.id === id ? previous! : m)));
      toast.error("Could not save that change");
    }
  }, []);

  const removeMarkup = useCallback(async (id: string, fromEdit2d = false) => {
    let removed: SavedMarkup | undefined;
    setMarkups((list) => {
      removed = list.find((m) => m.id === id);
      return list.filter((m) => m.id !== id);
    });
    setSelectedId((sel) => (sel === id ? null : sel));
    if (!fromEdit2d) controller.current?.removeShape(id);
    try {
      await deleteMarkup(id);
    } catch {
      if (removed) setMarkups((list) => [...list, removed!]);
      toast.error("Could not delete that markup");
    }
  }, []);

  /**
   * Copies a markup with all its properties (line item, depth, colour, name). It lands centred
   * on `at` (paste at the mouse) or slightly offset from the original (duplicate).
   */
  const duplicate = useCallback(
    async (source: SavedMarkup, at?: Point | null) => {
      const xs = source.points.map((p) => p[0]);
      const ys = source.points.map((p) => p[1]);
      const offset = 24 / (view.zoom || 1); // ~24 screen px
      const [dx, dy] = at
        ? [at[0] - (Math.min(...xs) + Math.max(...xs)) / 2, at[1] - (Math.min(...ys) + Math.max(...ys)) / 2]
        : [offset, offset];
      const points = source.points.map(([x, y]) => [x + dx, y + dy] as Point);
      try {
        const saved = await createMarkup(sheet.id, {
          kind: source.kind,
          points,
          color: source.color,
          text: source.text,
          label: source.label ? `${source.label} (copy)` : null,
          depth: source.depth,
        });
        setMarkups((list) => [...list, saved]);
        if (source.lineItemId) await assignLineItem(saved.id, source.lineItemId, true);
        if (EDIT2D_KINDS.has(saved.kind)) controller.current?.loadShapes([saved]);
        setSelectedId(saved.id);
        controller.current?.select(saved.id);
      } catch {
        toast.error("Could not duplicate that markup");
      }
    },
    [sheet.id, view.zoom, assignLineItem],
  );

  const moveMarkup = useCallback((id: string, points: Point[]) => {
    setMarkups((list) => list.map((m) => (m.id === id ? { ...m, points } : m)));
  }, []);

  const applyScale = useCallback(
    async (metersPerPoint: number | null, label: string | null) => {
      const previous = { metersPerPoint: sheet.metersPerPoint, scaleLabel: sheet.scaleLabel };
      setSheet((s) => ({ ...s, metersPerPoint, scaleLabel: metersPerPoint ? label : null }));
      try {
        await setSheetScale(sheet.id, metersPerPoint, label);
      } catch {
        setSheet((s) => ({ ...s, ...previous }));
        toast.error("Could not save the scale");
      }
    },
    [sheet.id, sheet.metersPerPoint, sheet.scaleLabel],
  );

  // --- the Viewer ---------------------------------------------------------------

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // Absolute URL: the Viewer resolves root-relative paths against the page's folder.
    const pdfUrl = `${window.location.origin}/api/drawings/${initialSheet.drawingSetId}/pdf`;
    const c = new SheetController(el, pdfUrl, initialSheet.pageIndex + 1, initialSheet.height, {
      onReady: () => {
        c.loadShapes(initialMarkups);
        if (focus) c.focusBox(focus);
        setReady(true);
      },
      onError: setLoadError,
      onView: setView,
      onShapeCreated: async (kind, points) => (await saveNew(kind, points))?.id ?? null,
      onShapeChanged: (id, points) => void patchMarkup(id, { points }),
      onShapeDeleted: (id) => void removeMarkup(id, true),
      onCalibrationLine: (length) => length > 0 && setCalibrating(length),
      onSelect: (id) => setSelectedId(id),
      onClick: (p, shift) => handlers.current.click(p, shift),
      onMove: (p, shift) => handlers.current.move(p, shift),
      onDoubleClick: () => handlers.current.doubleClick(),
    });
    controller.current = c;
    return () => {
      c.destroy();
      controller.current = null;
    };
    // The controller lives for the whole page; later state reaches it through refs and methods.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- overlay tools (count, note, arrow, cloud) ----------------------------------

  const finishDraft = useCallback(
    (d: Draft | null = draft) => {
      setDraft(null);
      setCursor(null);
      if (d?.kind === "count" && d.points.length) void saveNew("count", d.points);
    },
    [draft, saveNew],
  );

  const chooseTool = useCallback(
    (next: Tool) => {
      finishDraft();
      setTool(next);
      if (next !== "select") setSelectedId(null);
      controller.current?.select(null);
      controller.current?.setTool(CONTROLLER_TOOL[next]);
    },
    [finishDraft],
  );

  useEffect(() => {
    handlers.current.click = (raw, shift) => {
      if (tool === "note") return setNotePoint(raw);
      if (tool !== "count" && tool !== "arrow" && tool !== "cloud") return;
      const current = draft?.kind === tool ? draft.points : [];
      const point = shift && current.length ? orthoSnap(current[current.length - 1], raw) : raw;
      const points = [...current, point];
      if ((tool === "arrow" || tool === "cloud") && points.length === 2) {
        setDraft(null);
        setCursor(null);
        void saveNew(tool, points);
        return;
      }
      setDraft({ kind: tool, points });
    };
    handlers.current.move = (p, shift) => {
      if (!draft || !p) return setCursor(null);
      const last = draft.points[draft.points.length - 1];
      setCursor(shift && last ? orthoSnap(last, p) : p);
    };
    handlers.current.doubleClick = () => {
      if (draft?.kind === "count") finishDraft();
    };
  }, [tool, draft, saveNew, finishDraft]);

  // --- keyboard -----------------------------------------------------------------

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        const selected = markups.find((m) => m.id === selectedId);
        if (key === "c" && selected) {
          clipboard.current = selected;
          setHasClipboard(true);
          return;
        }
        if (key === "v" && clipboard.current) {
          e.preventDefault();
          return void duplicate(clipboard.current, lastPointer.current);
        }
        if (key === "d" && selected) {
          e.preventDefault(); // browsers bookmark the page on Ctrl/Cmd+D
          return void duplicate(selected);
        }
        return;
      }
      if (e.altKey) return;
      if (e.key === "Escape" && draft) return draft.kind === "count" ? finishDraft() : setDraft(null);
      if (e.key === "Enter" && draft) return finishDraft();
      if (e.key === "Backspace" && draft) {
        e.preventDefault();
        return setDraft(draft.points.length > 1 ? { ...draft, points: draft.points.slice(0, -1) } : null);
      }
      // Edit2D deletes its own selected shapes; we handle the overlay's.
      const selected = markups.find((m) => m.id === selectedId);
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !EDIT2D_KINDS.has(selected.kind)) {
        e.preventDefault();
        return void removeMarkup(selected.id);
      }
      if (e.key === "+" || e.key === "=") return controller.current?.zoom(1.25);
      if (e.key === "-") return controller.current?.zoom(0.8);
      if (e.key === "0") return controller.current?.fit();
      const match = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (match) chooseTool(match.id);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [draft, markups, selectedId, finishDraft, removeMarkup, chooseTool, duplicate]);

  // --- selection from the panel ------------------------------------------------------

  const selectFromPanel = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (tool !== "select") chooseTool("select");
      controller.current?.select(id);
      const m = markups.find((x) => x.id === id);
      if (m) controller.current?.reveal(m.points);
    },
    [tool, chooseTool, markups],
  );

  // --- sheet navigation ----------------------------------------------------------------

  const position = siblings.findIndex((s) => s.id === sheet.id);
  const prev = siblings[position - 1];
  const next = siblings[position + 1];
  const sheetHref = (id: string) => `/projects/${projectId}/sheets/${id}`;
  const sheetName = (s: { number: string | null; title: string | null; pageIndex: number }) =>
    [s.number ?? `Page ${s.pageIndex + 1}`, s.title].filter(Boolean).join(" · ");
  // For export/share scope; this sheet's count is live, the others are as loaded.
  const scopeSheets = siblings.map((s) => ({ id: s.id, markupCount: s.id === sheet.id ? markups.length : s.markupCount }));

  return (
    // On desktop the workspace is exactly the viewport below the header: the toolbar and
    // drawing stay put, and only the side panel scrolls.
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100svh-3.5rem)] lg:flex-none lg:flex-row lg:overflow-hidden">
      <div className="flex min-h-[520px] min-w-0 flex-1 flex-col lg:min-h-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 border-b bg-card px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            {prev ? (
              <LinkButton variant="ghost" size="icon-sm" href={sheetHref(prev.id)} aria-label="Previous sheet">
                <ChevronLeft />
              </LinkButton>
            ) : (
              <Button variant="ghost" size="icon-sm" disabled aria-label="Previous sheet">
                <ChevronLeft />
              </Button>
            )}
            <select
              value={sheet.id}
              onChange={(e) => router.push(sheetHref(e.target.value))}
              className="h-7 max-w-52 truncate rounded-md border border-input bg-card px-2 text-sm"
              aria-label="Sheet"
            >
              {siblings.map((s) => (
                <option key={s.id} value={s.id}>
                  {sheetName(s)}
                </option>
              ))}
            </select>
            {next ? (
              <LinkButton variant="ghost" size="icon-sm" href={sheetHref(next.id)} aria-label="Next sheet">
                <ChevronRight />
              </LinkButton>
            ) : (
              <Button variant="ghost" size="icon-sm" disabled aria-label="Next sheet">
                <ChevronRight />
              </Button>
            )}
          </div>

          {(["nav", "measure", "markup"] as const).map((group) => (
            <div key={group} className="ml-1 flex items-center gap-0.5 border-l pl-1.5">
              {TOOLS.filter((t) => t.group === group).map((t) => (
                <Tooltip key={t.id}>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!ready}
                        onClick={() => chooseTool(t.id)}
                        aria-pressed={tool === t.id}
                        className={cn(tool === t.id && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}
                      />
                    }
                  >
                    <t.icon />
                  </TooltipTrigger>
                  <TooltipContent>
                    {t.label} <span className="ml-1 opacity-60">{t.key}</span>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          ))}

          <div className="ml-auto flex items-center gap-0.5">
            <ExportPdfDialog
              drawingSetId={sheet.drawingSetId}
              currentSheetId={sheet.id}
              sheets={scopeSheets}
              hasLineItems={lineItems.length > 0}
              author={author}
            />
            <ShareDialog drawingSetId={sheet.drawingSetId} currentSheetId={sheet.id} sheets={scopeSheets} hasLineItems={lineItems.length > 0} />
            <div className="mx-1 h-5 border-l" />
            <Button variant="ghost" size="icon-sm" onClick={() => controller.current?.zoom(0.8)} aria-label="Zoom out">
              <ZoomOut />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => controller.current?.zoom(1.25)} aria-label="Zoom in">
              <ZoomIn />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => controller.current?.fit()} aria-label="Fit sheet">
              <Maximize />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={togglePanel} aria-label={panelOpen ? "Hide panel" : "Show panel"}>
              {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </Button>
          </div>
        </div>

        {/* Stage: the APS Viewer, with our overlay on top */}
        <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              className="relative flex-1 overflow-hidden bg-slate-200"
              onPointerMove={(e) => (lastPointer.current = controller.current?.sheetPointAt(e.clientX, e.clientY) ?? null)}
              onPointerLeave={() => (lastPointer.current = null)}
              onContextMenu={(e) => {
                // Which markup was right-clicked: an overlay shape, or a length/area under the cursor.
                const overlay = (e.target as Element).closest?.("[data-markup-id]")?.getAttribute("data-markup-id");
                const id = overlay ?? controller.current?.markupAt(e.clientX, e.clientY) ?? null;
                setContextId(id);
                if (id) {
                  setSelectedId(id);
                  controller.current?.select(id);
                }
              }}
            />
          }
        >
          <div ref={stage} className="absolute inset-0" />
          {ready && (
            <MarkupLayer
              markups={markups}
              selectedId={selectedId}
              draft={draft}
              cursor={cursor}
              view={view}
              metersPerPoint={sheet.metersPerPoint}
              unitSystem={unitSystem}
              selectable={tool === "select"}
              onSelect={(id) => {
                setSelectedId(id);
                controller.current?.select(id);
              }}
              onMove={moveMarkup}
              onMoveEnd={(id, points) => void patchMarkup(id, { points })}
            />
          )}
          {ready && focus && view.zoom > 0 && (
            <div
              className="pointer-events-none absolute z-10 rounded-sm border-2 border-amber-500 bg-amber-300/25"
              style={{ left: view.tx + (focus[0] - 3) * view.zoom, top: view.ty + (focus[1] - 3) * view.zoom, width: (focus[2] - focus[0] + 6) * view.zoom, height: (focus[3] - focus[1] + 6) * view.zoom }}
            />
          )}
          {!ready && !loadError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading sheet…
            </div>
          )}
          {loadError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-sm text-destructive">{loadError}</div>
          )}
          {ready && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md bg-card/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
              {HINTS[tool]}
            </div>
          )}
          {ready && !sheet.metersPerPoint && (tool === "length" || tool === "area") && (
            <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-md bg-warning px-3 py-1.5 text-xs font-medium text-warning-foreground shadow">
              This sheet has no scale yet. Calibrate it (K) or pick a scale in the panel to see lengths and areas.
            </div>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-48">
          {(() => {
            const target = markups.find((m) => m.id === contextId);
            return (
              <>
                {target && (
                  <>
                    <ContextMenuItem onClick={() => void duplicate(target)}>
                      <Copy /> Duplicate <ContextMenuShortcut>{modKey()}D</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        clipboard.current = target;
                        setHasClipboard(true);
                      }}
                    >
                      <Copy /> Copy <ContextMenuShortcut>{modKey()}C</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => setEditingId(target.id)}>
                      <Pencil /> Edit
                    </ContextMenuItem>
                  </>
                )}
                <ContextMenuItem
                  disabled={!hasClipboard}
                  onClick={() => clipboard.current && void duplicate(clipboard.current, lastPointer.current)}
                >
                  <ClipboardPaste /> Paste here <ContextMenuShortcut>{modKey()}V</ContextMenuShortcut>
                </ContextMenuItem>
                {target && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onClick={() => void removeMarkup(target.id)}>
                      <Trash2 /> Delete
                    </ContextMenuItem>
                  </>
                )}
              </>
            );
          })()}
        </ContextMenuContent>
        </ContextMenu>
      </div>

      {panelOpen && (
        <MarkupPanel
          projectId={projectId}
          sheet={sheet}
          onSheetChange={setSheet}
          markups={markups}
          selectedId={selectedId}
          onSelect={selectFromPanel}
          onPatch={patchMarkup}
          onDelete={(id) => void removeMarkup(id)}
          unitSystem={unitSystem}
          onUnitSystemChange={setUnitSystem}
          onScale={applyScale}
          onCalibrate={() => chooseTool("calibrate")}
          lineItems={lineItems}
          activeLineItemId={activeLineItemId}
          onActiveLineItemChange={setActiveLineItemId}
          onAssign={(id, lineItemId) => void assignLineItem(id, lineItemId)}
          onDuplicate={(id) => {
            const m = markups.find((x) => x.id === id);
            if (m) void duplicate(m);
          }}
          editingId={editingId}
          onEditingChange={setEditingId}
        />
      )}

      <CalibrateDialog
        open={calibrating !== null}
        unitSystem={unitSystem}
        onCancel={() => setCalibrating(null)}
        onSubmit={(meters) => {
          if (calibrating) void applyScale(calibrate(calibrating, meters), "Calibrated");
          setCalibrating(null);
          chooseTool("select");
          toast.success("Sheet calibrated");
        }}
      />
      <NoteDialog
        open={notePoint !== null}
        onCancel={() => setNotePoint(null)}
        onSubmit={(text) => {
          if (notePoint) void saveNew("note", [notePoint], { text });
          setNotePoint(null);
        }}
      />
    </div>
  );
}
