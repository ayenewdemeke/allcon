"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { newId, type CalcDocument } from "@/lib/calcs/document";
import type { Result } from "@/lib/calcs/evaluate";
import { greekify } from "@/lib/calcs/parse";
import { contentSize, GRID, PAGES, type Header, type MathRegion, type PlotRegion, type Region, type SectionRegion, type SolveRegion, type TableRegion, type TextRegion } from "@/lib/calcs/types";
import { cn } from "@/lib/utils";
import { loadMathLive, type MathfieldElement } from "./mathlive";
import { MathRegionView, TextRegionView } from "./regions";
import { PlotRegionView, SolveRegionView, TableRegionView } from "./regions-more";
import { SectionRegionView } from "./section-region";

// The worksheet, as Mathcad's: pages with the calc paper's header, regions placed anywhere on
// them. Click empty space for the crosshair and type to start math there (" starts text);
// click a region to edit it; drag to move; drag on empty space to select several. Enter ends
// math and moves the crosshair below it, ready for the next line.

type MathLive = Awaited<ReturnType<typeof loadMathLive>>;
export type Cursor = { x: number; y: number };
const PAGE_GAP = 24;
const snap = (v: number) => Math.max(0, Math.round(v / GRID) * GRID);
/** Regions made of several pieces (tables, plots, solve blocks, sections): edited until a click
 * elsewhere. */
const composite = (r: Region | undefined) => r?.kind === "table" || r?.kind === "plot" || r?.kind === "solve" || r?.kind === "section";

export type WorksheetHandle = {
  /** Inserts math into the field being edited, or starts a region with it at the crosshair. */
  insertMath: (latex: string) => void;
  addText: (style: TextRegion["style"]) => void;
  addTable: () => void;
  addPlot: () => void;
  addSolve: () => void;
  addSection: () => void;
  /** Adds regions (placed from 0, 0) at the crosshair, or below everything, as one undo step. */
  insertRegions: (regions: Region[]) => void;
  /** Where this person is, for others: the region they're editing, or their crosshair. */
  presence: () => { region: string | null; cursor: [number, number] | null };
};

/** Someone else in the worksheet, in their colour. */
export type Other = { id: string; name: string; app: boolean; region: string | null; cursor: [number, number] | null; color: string };

export function Worksheet({
  doc,
  version,
  results,
  zoom,
  drafts,
  setDrafts,
  handle,
  others = [],
}: {
  doc: CalcDocument;
  version: number;
  results: Map<string, Result>;
  zoom: number;
  drafts: Map<string, string>;
  setDrafts: (update: (d: Map<string, string>) => Map<string, string>) => void;
  handle: React.RefObject<WorksheetHandle | null>;
  others?: Other[];
}) {
  void version;
  const [ml, setMl] = useState<MathLive | null>(null);
  const [cursor, setCursorState] = useState<Cursor | null>({ x: 0, y: 0 });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [editing, setEditingState] = useState<string | null>(null);
  // The latest crosshair and region being edited, for keys typed before React has re-rendered
  // (fast typing straight after Enter).
  const cursorNow = useRef<Cursor | null>({ x: 0, y: 0 });
  const editingNow = useRef<string | null>(null);
  const setCursor = (c: Cursor | null) => {
    cursorNow.current = c;
    setCursorState(c);
  };
  const setEditing = (id: string | null) => {
    editingNow.current = id;
    setEditingState(id);
  };
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // Each region's size on the page, as drawn (for selecting with a window, and Enter's next line).
  const [sizes, setSizes] = useState(() => new Map<string, { w: number; h: number }>());
  const fieldRef = useRef<MathfieldElement | null>(null);
  /** Keys typed while a new region's field is still being made, typed into it once it's ready. */
  const pendingKeys = useRef("");
  /** Math from the ribbon for a new region, inserted once its field is ready. */
  const pendingInsert = useRef("");
  const typerRef = useRef<((keys: string) => void) | null>(null);
  const clipboard = useRef<Region[]>([]);
  const column = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void loadMathLive().then((m) => live && setMl(m));
    return () => {
      live = false;
    };
  }, []);

  const page = PAGES[doc.paper];
  const content = contentSize(doc.paper);
  const regions = [...doc.regions.values()];
  const bottom = Math.max(cursor ? cursor.y + 40 : 0, ...regions.map((r) => r.y + (sizes.get(r.id)?.h ?? 24)));
  const pageCount = Math.max(1, Math.floor(bottom / content.height) + 1);

  /** A screen point as worksheet coordinates (over a page's content area), or null. */
  const toSheet = useCallback(
    (clientX: number, clientY: number) => {
      const el = column.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const lx = (clientX - r.left) / zoom;
      const ly = (clientY - r.top) / zoom;
      const p = Math.floor(ly / (page.height + PAGE_GAP));
      const inPage = ly - p * (page.height + PAGE_GAP);
      if (p < 0 || inPage > page.height) return null;
      return { x: lx - page.left, y: p * content.height + (inPage - page.top), page: p, inContent: lx >= page.left && lx <= page.width - page.right && inPage >= page.top && inPage <= page.height - page.bottom };
    },
    [zoom, page, content.height],
  );

  // --- editing ----------------------------------------------------------------------------

  const startRegion = (region: Region) => {
    doc.put(region);
    setSelection(new Set([region.id]));
    setEditing(region.id);
    setCursor(null);
  };

  const commitMath = (r: MathRegion, latex: string, then?: "below") => {
    setDrafts((d) => {
      const next = new Map(d);
      next.delete(r.id);
      return next;
    });
    if (editingNow.current === r.id) setEditing(null);
    const current = doc.regions.get(r.id);
    if (!current) return;
    if (!latex.trim()) doc.remove(r.id);
    else if (current.kind === "math" && current.latex !== greekify(latex)) doc.put({ ...current, latex: greekify(latex) });
    if (then === "below") {
      const h = sizes.get(r.id)?.h ?? 24;
      setSelection(new Set());
      setCursor({ x: r.x, y: snap(r.y + h + GRID * 2) });
    }
  };

  /** Keys meant for the next region (typed fast, after an Enter): they start it, as typed. */
  const replay = (keys: string) => {
    const at = cursorNow.current;
    const text = keys.replace(/^\n+/, "");
    if (!text || !at) return;
    const [first, rest] = [text[0], text.slice(1)];
    if (first === '"') {
      pendingKeys.current = rest + pendingKeys.current;
      handle.current?.addText("normal");
    } else {
      pendingKeys.current = text + pendingKeys.current;
      startRegion({ id: newId(), kind: "math", x: at.x, y: at.y, latex: "" });
    }
  };

  const commitText = (r: TextRegion, text: string) => {
    if (editingNow.current === r.id) setEditing(null);
    const current = doc.regions.get(r.id);
    if (!current || current.kind !== "text") return;
    if (!text.trim()) doc.remove(r.id);
    else if (current.text !== text) doc.put({ ...current, text });
  };

  useImperativeHandle(handle, () => ({
    insertMath: (latex: string) => {
      // Into the math being typed: a region's, or a piece of a table, plot or solve block.
      const active = document.activeElement;
      const field = fieldRef.current ?? (active?.tagName === "MATH-FIELD" && active.closest("[data-region]") ? (active as MathfieldElement) : null);
      if (field) {
        field.executeCommand(["insert", latex]);
        field.focus();
        return;
      }
      const at = cursor ?? { x: 0, y: snap(bottom) };
      pendingInsert.current = latex;
      startRegion({ id: newId(), kind: "math", x: at.x, y: at.y, latex: "" });
    },
    addText: (style: TextRegion["style"]) => {
      const at = cursor ?? { x: 0, y: snap(bottom) };
      startRegion({ id: newId(), kind: "text", x: at.x, y: at.y, text: "", style, width: style === "normal" || style === "note" ? 480 : 600 });
    },
    addTable: () => {
      const at = cursor ?? { x: 0, y: snap(bottom) };
      startRegion({ id: newId(), kind: "table", x: at.x, y: at.y, columns: [{ name: "", unit: "" }, { name: "", unit: "" }], rows: [["", ""], ["", ""], ["", ""]] });
    },
    addPlot: () => {
      const at = cursor ?? { x: 0, y: snap(bottom) };
      startRegion({ id: newId(), kind: "plot", x: at.x, y: at.y, width: 360, height: 240, traces: [{ x: "", y: "" }] });
    },
    addSolve: () => {
      const at = cursor ?? { x: 0, y: snap(bottom) };
      startRegion({ id: newId(), kind: "solve", x: at.x, y: at.y, guesses: [""], constraints: [""], solver: "" });
    },
    addSection: () => {
      const at = cursor ?? { x: 0, y: snap(bottom) };
      startRegion({ id: newId(), kind: "section", x: at.x, y: at.y, shape: "" });
    },
    presence: () => {
      const c = cursorNow.current;
      return { region: editingNow.current, cursor: c ? [c.x, c.y] : null };
    },
    insertRegions: (items: Region[]) => {
      if (!items.length) return;
      // Math being typed ends as it would on a click elsewhere (committed); other regions end now.
      const field = fieldRef.current;
      if (field) {
        field.focus();
        field.blur();
      } else if (editingNow.current) endEditing();
      const at = cursor ?? { x: 0, y: regions.length ? snap(bottom + GRID * 3) : 0 };
      const placed = items.map((r) => ({ ...r, x: r.x + at.x, y: r.y + at.y }));
      doc.transact(() => placed.forEach((r) => doc.put(r)));
      setSelection(new Set(placed.map((r) => r.id)));
      const end = Math.max(...placed.map((r) => r.y));
      setCursor({ x: at.x, y: snap(end + GRID * 5) });
    },
  }));

  /** Ends editing a table, plot, solve block or section (one without a shape is removed). */
  function endEditing() {
    const r = doc.regions.get(editingNow.current ?? "");
    setEditing(null);
    if (r?.kind === "section" && !r.shape.trim()) doc.remove(r.id);
  }

  /** A change to a region, made to its latest version. */
  const change =
    <T extends Region>(id: string) =>
    (update: (r: T) => T) => {
      const current = doc.regions.get(id);
      if (current) doc.put(update(current as T));
    };

  // --- the keyboard (outside a region being edited) ----------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, math-field, [contenteditable='true']") || document.querySelector("[role=dialog]")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const cursor = cursorNow.current;
      // Keys for the math being edited that reached the page: before its field is ready they
      // wait; after, they go into it.
      const editingComposite = composite(doc.regions.get(editingNow.current ?? ""));
      if (editingNow.current && !editingComposite && !ctrl && !e.altKey && (e.key.length === 1 || e.key === "Enter")) {
        const key = e.key === "Enter" ? "\n" : e.key;
        if (!fieldRef.current) {
          e.preventDefault();
          pendingKeys.current += key;
          return;
        }
        if (typerRef.current) {
          e.preventDefault();
          fieldRef.current.focus();
          typerRef.current(key);
          return;
        }
      }
      if (ctrl && key === "z") {
        e.preventDefault();
        if (e.shiftKey) doc.redo();
        else doc.undo();
        return;
      }
      if (ctrl && key === "y") {
        e.preventDefault();
        doc.redo();
        return;
      }
      if (ctrl && (key === "c" || key === "x") && selection.size) {
        e.preventDefault();
        clipboard.current = [...selection].map((id) => doc.regions.get(id)!).filter(Boolean);
        if (key === "x") doc.transact(() => selection.forEach((id) => doc.remove(id)));
        if (key === "x") setSelection(new Set());
        return;
      }
      if (ctrl && key === "v" && clipboard.current.length) {
        e.preventDefault();
        const items = clipboard.current;
        const minX = Math.min(...items.map((r) => r.x));
        const minY = Math.min(...items.map((r) => r.y));
        const at = cursor ?? { x: minX + GRID * 2, y: minY + GRID * 2 };
        const pasted = items.map((r) => ({ ...r, id: newId(), x: snap(at.x + r.x - minX), y: snap(at.y + r.y - minY) }));
        doc.transact(() => pasted.forEach((r) => doc.put(r)));
        setSelection(new Set(pasted.map((r) => r.id)));
        setCursor(null);
        return;
      }
      if (ctrl && key === "t") {
        e.preventDefault();
        handle.current?.addText("normal");
        return;
      }
      if (editingComposite) {
        // Escape ends editing a table, plot or solve block; other keys are its own.
        if (e.key === "Escape") endEditing();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection.size) {
        e.preventDefault();
        doc.transact(() => selection.forEach((id) => doc.remove(id)));
        setSelection(new Set());
        return;
      }
      if (e.key === "Escape") {
        setSelection(new Set());
        return;
      }
      if (e.key.startsWith("Arrow")) {
        const d = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, -GRID], ArrowDown: [0, GRID] }[e.key]!;
        e.preventDefault();
        if (selection.size) {
          doc.transact(() => selection.forEach((id) => {
            const r = doc.regions.get(id);
            if (r) doc.put({ ...r, x: Math.max(0, r.x + d[0]), y: Math.max(0, r.y + d[1]) });
          }));
        } else if (cursor) setCursor({ x: Math.max(0, cursor.x + d[0]), y: Math.max(0, cursor.y + d[1]) });
        return;
      }
      // Typing at the crosshair starts a region there: text with ", math otherwise.
      if (!ctrl && !e.altKey && e.key.length === 1 && cursor) {
        e.preventDefault();
        if (e.key === '"') handle.current?.addText("normal");
        else {
          // The key is typed into the new field (so spelled-out names like phi still convert).
          pendingKeys.current = e.key;
          startRegion({ id: newId(), kind: "math", x: cursor.x, y: cursor.y, latex: "" });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- the pointer ----------------------------------------------------------------------------

  const onPageDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const at = toSheet(e.clientX, e.clientY);
    if (!at) return;
    if (composite(doc.regions.get(editingNow.current ?? ""))) endEditing();
    // Math whose field lost the focus to the ribbon: ends now.
    const field = fieldRef.current;
    if (field && !field.hasFocus()) {
      field.focus();
      field.blur();
    }
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      moved = true;
      const b = toSheet(ev.clientX, ev.clientY);
      if (b) setMarquee({ x0: at.x, y0: at.y, x1: b.x, y1: b.y });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (moved) {
        const b = toSheet(ev.clientX, ev.clientY);
        if (!b) return;
        const [x0, x1] = [Math.min(at.x, b.x), Math.max(at.x, b.x)];
        const [y0, y1] = [Math.min(at.y, b.y), Math.max(at.y, b.y)];
        const hit = regions.filter((r) => {
          const s = sizes.get(r.id) ?? { w: 40, h: 20 };
          return r.x < x1 && r.x + s.w > x0 && r.y < y1 && r.y + s.h > y0;
        });
        setSelection(new Set(hit.map((r) => r.id)));
        setCursor(null);
      } else if (at.inContent) {
        setSelection(new Set());
        setCursor({ x: snap(at.x), y: snap(at.y) });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onRegionDown = (e: React.PointerEvent, r: Region) => {
    e.stopPropagation(); // not a click on the page
    if (e.button !== 0 || editing === r.id) return;
    if (editing && composite(doc.regions.get(editing))) endEditing();
    const start = { x: e.clientX, y: e.clientY };
    const selected = selection.has(r.id) ? selection : new Set([r.id]);
    if (e.shiftKey) {
      const next = new Set(selection);
      if (!next.delete(r.id)) next.add(r.id);
      setSelection(next);
      return;
    }
    setSelection(selected);
    setCursor(null);
    let moved = false;
    let last = { dx: 0, dy: 0 };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      moved = true;
      last = { dx: Math.round((ev.clientX - start.x) / zoom / GRID) * GRID, dy: Math.round((ev.clientY - start.y) / zoom / GRID) * GRID };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (moved) {
        if (last.dx || last.dy)
          doc.transact(() => selected.forEach((id) => {
            const g = doc.regions.get(id);
            if (g) doc.put({ ...g, x: Math.max(0, g.x + last.dx), y: Math.max(0, g.y + last.dy) });
          }));
      } else setEditing(r.id); // a click: edit it
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const measure = (id: string) => (el: HTMLDivElement | null) => {
    if (!el) return;
    const s = { w: el.offsetWidth, h: el.offsetHeight };
    requestAnimationFrame(() =>
      setSizes((prev) => {
        const old = prev.get(id);
        return old && old.w === s.w && old.h === s.h ? prev : new Map(prev).set(id, s);
      }),
    );
  };

  // --- drawing ---------------------------------------------------------------------------------

  return (
    <div className="calc-pages flex justify-center py-6" style={{ minHeight: "100%" }}>
      <div ref={column} style={{ width: page.width * zoom, height: (pageCount * (page.height + PAGE_GAP) - PAGE_GAP) * zoom }}>
        <div style={{ width: page.width, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
          {Array.from({ length: pageCount }, (_, p) => (
            <div key={p} className="calc-page relative bg-white text-neutral-900 shadow-[0_1px_4px_rgba(0,0,0,0.25)]" style={{ width: page.width, height: page.height, marginBottom: p < pageCount - 1 ? PAGE_GAP : 0 }} onPointerDown={onPageDown}>
              <PageHeader header={doc.header} page={p + 1} pages={pageCount} left={page.left} right={page.right} />
              <div className="absolute" style={{ left: page.left, top: page.top, width: content.width, height: content.height }}>
                {/* the margins' edge, faint, as Mathcad shows it */}
                <div className="no-print pointer-events-none absolute inset-0 border border-dashed border-neutral-200" />
                {regions
                  .filter((r) => {
                    const y = selection.has(r.id) && drag ? r.y + drag.dy : r.y;
                    return Math.floor(y / content.height) === p || (p === pageCount - 1 && Math.floor(y / content.height) >= pageCount);
                  })
                  .map((r) => {
                    const moving = drag && selection.has(r.id);
                    const x = r.x + (moving ? drag.dx : 0);
                    const y = r.y + (moving ? drag.dy : 0) - p * content.height;
                    return (
                      <div
                        key={r.id}
                        ref={measure(r.id)}
                        data-region={r.id}
                        className={cn("absolute", editing !== r.id && "cursor-pointer", moving && "opacity-70")}
                        style={{ left: x, top: y }}
                        onPointerDown={(e) => onRegionDown(e, r)}
                      >
                        {r.kind === "math" ? (
                          <MathRegionView
                            ml={ml}
                            region={drafts.has(r.id) ? { ...r, latex: drafts.get(r.id)! } : r}
                            result={results.get(r.id)}
                            editing={editing === r.id}
                            selected={selection.has(r.id)}
                            fieldRef={fieldRef}
                            typerRef={typerRef}
                            takePending={() => {
                              const keys = pendingKeys.current;
                              pendingKeys.current = "";
                              return keys;
                            }}
                            takeInsert={() => {
                              const latex = pendingInsert.current;
                              pendingInsert.current = "";
                              return latex;
                            }}
                            returnPending={(keys) => queueMicrotask(() => replay(keys))}
                            onDraft={(latex) => setDrafts((d) => new Map(d).set(r.id, latex))}
                            onCommit={(latex) => commitMath(r, latex)}
                            onEnter={(latex) => commitMath(r, latex, "below")}
                            onUnit={(unit) => {
                              const current = doc.regions.get(r.id);
                              if (current?.kind === "math") doc.put({ ...current, displayUnit: unit || undefined });
                            }}
                          />
                        ) : r.kind === "text" ? (
                          <TextRegionView region={r} editing={editing === r.id} selected={selection.has(r.id)} maxWidth={content.width - r.x} onCommit={(text) => commitText(r, text)} />
                        ) : r.kind === "table" ? (
                          <TableRegionView ml={ml} region={r} result={results.get(r.id)} editing={editing === r.id} selected={selection.has(r.id)} onChange={change<TableRegion>(r.id)} />
                        ) : r.kind === "plot" ? (
                          <PlotRegionView ml={ml} region={r} result={results.get(r.id)} editing={editing === r.id} selected={selection.has(r.id)} onChange={change<PlotRegion>(r.id)} />
                        ) : r.kind === "section" ? (
                          <SectionRegionView ml={ml} region={r} result={results.get(r.id)} editing={editing === r.id} selected={selection.has(r.id)} onChange={change<SectionRegion>(r.id)} />
                        ) : (
                          <SolveRegionView ml={ml} region={r} result={results.get(r.id)} editing={editing === r.id} selected={selection.has(r.id)} onChange={change<SolveRegion>(r.id)} />
                        )}
                        {others
                          .filter((o) => o.region === r.id)
                          .slice(0, 1)
                          .map((o) => (
                            // Someone else is editing this region.
                            <div key={o.id} className="no-print pointer-events-none absolute -inset-1 rounded border-2" style={{ borderColor: o.color }}>
                              <span className="absolute -top-4 left-0 rounded-sm px-1 text-[10px] leading-4 whitespace-nowrap text-white" style={{ background: o.color }}>
                                {o.name}
                              </span>
                            </div>
                          ))}
                      </div>
                    );
                  })}
                {others
                  .filter((o) => !o.region && o.cursor && Math.floor(o.cursor[1] / content.height) === p)
                  .map((o) => (
                    // Others' crosshairs.
                    <div key={o.id} className="no-print pointer-events-none absolute" style={{ left: o.cursor![0] - 7, top: o.cursor![1] - p * content.height - 7, color: o.color }}>
                      <svg width="15" height="15" viewBox="0 0 15 15">
                        <path d="M7.5 0v15M0 7.5h15" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                      <span className="absolute top-3 left-3 rounded-sm px-1 text-[10px] leading-4 whitespace-nowrap text-white" style={{ background: o.color }}>
                        {o.name}
                      </span>
                    </div>
                  ))}
                {cursor && Math.floor(cursor.y / content.height) === p && !editing && (
                  <div className="no-print pointer-events-none absolute" style={{ left: cursor.x - 7, top: cursor.y - p * content.height - 7 }}>
                    <svg width="15" height="15" viewBox="0 0 15 15" className="text-primary">
                      <path d="M7.5 0v15M0 7.5h15" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </div>
                )}
                {marquee && Math.floor(Math.min(marquee.y0, marquee.y1) / content.height) === p && (
                  <div
                    className="no-print pointer-events-none absolute border border-primary bg-primary/10"
                    style={{
                      left: Math.min(marquee.x0, marquee.x1),
                      top: Math.min(marquee.y0, marquee.y1) - p * content.height,
                      width: Math.abs(marquee.x1 - marquee.x0),
                      height: Math.abs(marquee.y1 - marquee.y0),
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The calc paper's header, on every page: project, title, number, by, checked, date, page. */
function PageHeader({ header, page, pages, left, right }: { header: Header; page: number; pages: number; left: number; right: number }) {
  const cell = "border border-neutral-400 px-1.5 py-0.5 align-top";
  const label = "block text-[8px] uppercase tracking-wide text-neutral-500";
  return (
    <table className="absolute border-collapse text-[11px] leading-tight" style={{ left, right, top: 32, width: `calc(100% - ${left + right}px)` }}>
      <tbody>
        <tr>
          <td className={cell} colSpan={2}>
            <span className={label}>Project</span>
            {header.project || " "}
          </td>
          <td className={cn(cell, "w-28")}>
            <span className={label}>Calc no.</span>
            {header.number || " "}
          </td>
          <td className={cn(cell, "w-24")}>
            <span className={label}>Sheet</span>
            {page} of {pages}
          </td>
        </tr>
        <tr>
          <td className={cell}>
            <span className={label}>Subject</span>
            {header.title || " "}
          </td>
          <td className={cn(cell, "w-28")}>
            <span className={label}>By</span>
            {header.by || " "}
          </td>
          <td className={cell}>
            <span className={label}>Checked</span>
            {header.checked || " "}
          </td>
          <td className={cell}>
            <span className={label}>Date</span>
            {header.date || " "}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
