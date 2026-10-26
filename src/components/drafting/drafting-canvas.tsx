"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { entityColor } from "@/lib/drafting/aci";
import type { Editor } from "@/lib/drafting/editor";
import { bounds, graphicsOf, grips, tessellate, type TextRun } from "@/lib/drafting/geometry";
import { capRatio } from "@/lib/drafting/graphics";
import type { SnapKind } from "@/lib/drafting/snaps";
import type { Entity, Vec } from "@/lib/drafting/types";

// The drawing area. Three layers: the grid (2D canvas), the drawing (WebGL, so big drawings
// stay smooth), and on top the crosshair, snap markers, grips, selection highlight, rubber
// band and dynamic input (2D canvas, redrawn as the cursor moves).

export const CANVAS_THEMES = {
  light: { bg: "#ffffff", minor: "#eef1f5", major: "#dde2ea", axisX: "rgba(220,38,38,0.45)", axisY: "rgba(22,163,74,0.45)", fg: "#1f2937", select: "#1d6ff2", tip: "#ffffff", tipText: "#1f2937", tipBorder: "#c4cad3" },
  dark: { bg: "#212830", minor: "#29313b", major: "#343e4b", axisX: "rgba(248,113,113,0.5)", axisY: "rgba(74,222,128,0.5)", fg: "#e5e7eb", select: "#5aa0ff", tip: "#2b333d", tipText: "#e5e7eb", tipBorder: "#46505c" },
} as const;

const SNAP_COLOR = "#16a34a";
const GRIP = { cold: "#1d6ff2", hover: "#e3329c", hot: "#e11d48" };
const CROSSHAIR = 0.05; // of the screen, AutoCAD's default cursor size

const SNAP_LABELS: Record<SnapKind, string> = {
  endpoint: "Endpoint",
  midpoint: "Midpoint",
  center: "Center",
  quadrant: "Quadrant",
  intersection: "Intersection",
  perpendicular: "Perpendicular",
  nearest: "Nearest",
};

export function DraftingCanvas({ editor, dark, onReady }: { editor: Editor; dark: boolean; onReady?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const gridCanvas = useRef<HTMLCanvasElement>(null);
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  const textCanvas = useRef<HTMLCanvasElement>(null);
  const darkRef = useRef(dark);
  const redraw = useRef<(rebuild?: boolean) => void>(() => {});
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  });

  useEffect(() => {
    darkRef.current = dark;
    redraw.current(true);
  }, [dark]);

  useEffect(() => {
    const el = host.current!;
    const grid = gridCanvas.current!;
    const overlay = overlayCanvas.current!;
    const text = textCanvas.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = "absolute inset-0 size-full";
    el.insertBefore(renderer.domElement, text);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    const geometry = new THREE.BufferGeometry();
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true }));
    lines.frustumCulled = false;
    // Filled areas (solid hatches, arrowheads) under the lines.
    const fillGeometry = new THREE.BufferGeometry();
    const fills = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    fills.frustumCulled = false;
    scene.add(fills, lines);
    // Text is drawn on its own canvas, redrawn when the view or the drawing changes.
    let runs: { id: string; run: TextRun; color: string; box: { minX: number; minY: number; maxX: number; maxY: number } }[] = [];
    let textKey = "";
    // Positions are stored relative to an origin near the drawing, so survey-sized
    // coordinates keep their precision in the GPU's single precision.
    let origin: Vec = { x: 0, y: 0 };
    let builtVersion = -1;
    let builtDark: boolean | null = null;

    const colors = new Map<string, THREE.Color>();
    const colorOf = (css: string) => {
      let c = colors.get(css);
      if (!c) colors.set(css, (c = new THREE.Color(css)));
      return c;
    };

    const rebuild = () => {
      const doc = editor.doc;
      const isDark = darkRef.current;
      builtVersion = doc.version;
      builtDark = isDark;
      const first = doc.entities.values().next().value as Entity | undefined;
      if (first) {
        const b = bounds(first);
        origin = { x: b.minX, y: b.minY };
      }
      const pos: number[] = [];
      const col: number[] = [];
      const fpos: number[] = [];
      const fcol: number[] = [];
      runs = [];
      for (const e of doc.entities.values()) {
        if (!doc.isVisible(e)) continue;
        const css = entityColor(e, doc.layerOf(e), isDark);
        const c = colorOf(css);
        const g = graphicsOf(e);
        for (const line of g.lines) {
          for (let i = 0; i + 1 < line.length; i++) {
            pos.push(line[i].x - origin.x, line[i].y - origin.y, 0, line[i + 1].x - origin.x, line[i + 1].y - origin.y, 0);
            col.push(c.r, c.g, c.b, c.r, c.g, c.b);
          }
        }
        // Fills are convex (triangles, arrowheads, dots): a fan covers them.
        for (const f of g.fills) {
          for (let i = 1; i + 1 < f.length; i++) {
            for (const p of [f[0], f[i], f[i + 1]]) {
              fpos.push(p.x - origin.x, p.y - origin.y, -0.5);
              fcol.push(c.r, c.g, c.b);
            }
          }
        }
        if (g.texts.length) {
          const b = bounds(e);
          for (const run of g.texts) runs.push({ id: e.id, run, color: css, box: b });
        }
      }
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geometry.computeBoundingSphere();
      fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fpos, 3));
      fillGeometry.setAttribute("color", new THREE.Float32BufferAttribute(fcol, 3));
      fillGeometry.computeBoundingSphere();
      textKey = "";
    };

    let frame = 0;
    const draw = () => {
      frame = 0;
      const { w, h } = editor.size;
      if (editor.doc.version !== builtVersion || darkRef.current !== builtDark) rebuild();
      const { cx, cy, scale } = editor.view;
      camera.left = -w / 2 / scale;
      camera.right = w / 2 / scale;
      camera.top = h / 2 / scale;
      camera.bottom = -h / 2 / scale;
      camera.position.set(cx - origin.x, cy - origin.y, 10);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const key = `${cx},${cy},${scale},${w},${h},${builtVersion},${builtDark},${editor.textEdit?.editing}`;
      if (key !== textKey) {
        textKey = key;
        drawTexts(text, editor, runs);
      }
      drawGrid(grid, editor, darkRef.current);
      drawOverlay(overlay, editor, darkRef.current);
    };
    const schedule = (rebuildNow = false) => {
      if (rebuildNow) builtVersion = -1;
      if (!frame) frame = requestAnimationFrame(draw);
    };
    redraw.current = schedule;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      textKey = "";
      for (const c of [grid, overlay, text]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      editor.setSize(w, h);
      schedule();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    ready.current?.();

    // For browser tests in development: the editor, to aim at drawing coordinates.
    if (process.env.NODE_ENV === "development") (window as unknown as { __draftEditor?: Editor }).__draftEditor = editor;
    const offPointer = editor.onPointer(() => schedule());
    const offState = editor.subscribe(() => schedule());

    // Pointer input.
    const at = (e: MouseEvent): Vec => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    let lastMiddle = 0;
    const onMove = (e: PointerEvent) => editor.pointerMove(at(e));
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      if (e.button === 1) {
        e.preventDefault(); // no auto-scroll
        const now = performance.now();
        if (now - lastMiddle < 350) {
          editor.middleDoubleClick();
          lastMiddle = 0;
          return;
        }
        lastMiddle = now;
      }
      if (e.button === 2) return;
      editor.pointerDown(at(e), e.button);
    };
    const onUp = (e: PointerEvent) => {
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      // Right-click is Enter while a command runs, as many AutoCAD users set it up.
      if (e.button === 2) {
        if (editor.command || editor.hotGrip) editor.submit();
        return;
      }
      editor.pointerUp(at(e), e.button, e.shiftKey);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      editor.wheel(at(e), e.deltaY * (e.deltaMode === 1 ? 16 : 1));
    };
    const onLeave = () => editor.pointerLeave();
    const onDouble = (e: MouseEvent) => e.button === 0 && editor.doubleClick(at(e));
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("dblclick", onDouble);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", noMenu);
    el.addEventListener("auxclick", noMenu);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      offPointer();
      offState();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("dblclick", onDouble);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", noMenu);
      el.removeEventListener("auxclick", noMenu);
      geometry.dispose();
      fillGeometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      redraw.current = () => {};
    };
  }, [editor]);

  const theme = dark ? CANVAS_THEMES.dark : CANVAS_THEMES.light;
  return (
    <div ref={host} className="absolute inset-0 cursor-none touch-none overflow-hidden select-none" style={{ background: theme.bg }}>
      <canvas ref={gridCanvas} className="absolute inset-0 size-full" />
      <canvas ref={textCanvas} className="absolute inset-0 size-full" />
      <canvas ref={overlayCanvas} className="absolute inset-0 size-full" />
    </div>
  );
}

function context(canvas: HTMLCanvasElement, editor: Editor) {
  const ctx = canvas.getContext("2d")!;
  const dpr = canvas.width / Math.max(editor.size.w, 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, editor.size.w, editor.size.h);
  return ctx;
}

/** Grid spacings that read well in each unit system. */
const GRID_STEPS = { architectural: [1, 2, 6, 12, 24, 60, 120, 240, 600, 1200, 2400, 6000, 12000, 24000, 60000, 120000], mm: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000] };

function drawGrid(canvas: HTMLCanvasElement, editor: Editor, dark: boolean) {
  const ctx = context(canvas, editor);
  const theme = dark ? CANVAS_THEMES.dark : CANVAS_THEMES.light;
  const { w, h } = editor.size;
  const scale = editor.view.scale;
  if (editor.settings.grid) {
    // Adaptive, as in AutoCAD: minor lines at least 12 px apart, a major line every fifth.
    const minor = GRID_STEPS[editor.doc.units].find((s) => s * scale >= 12) ?? GRID_STEPS[editor.doc.units].at(-1)!;
    const tl = editor.toWorld({ x: 0, y: 0 });
    const br = editor.toWorld({ x: w, y: h });
    const lines = (step: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
        const sx = Math.round(editor.toScreen({ x, y: 0 }).x) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
      }
      for (let y = Math.ceil(br.y / step) * step; y <= tl.y; y += step) {
        const sy = Math.round(editor.toScreen({ x: 0, y }).y) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
      }
      ctx.stroke();
    };
    if ((br.x - tl.x) / minor < 600) lines(minor, theme.minor);
    lines(minor * 5, theme.major);
  }
  // The X and Y axes through the origin.
  const o = editor.toScreen({ x: 0, y: 0 });
  ctx.lineWidth = 1;
  if (o.y >= 0 && o.y <= h) {
    ctx.strokeStyle = theme.axisX;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(o.y) + 0.5);
    ctx.lineTo(w, Math.round(o.y) + 0.5);
    ctx.stroke();
  }
  if (o.x >= 0 && o.x <= w) {
    ctx.strokeStyle = theme.axisY;
    ctx.beginPath();
    ctx.moveTo(Math.round(o.x) + 0.5, 0);
    ctx.lineTo(Math.round(o.x) + 0.5, h);
    ctx.stroke();
  }
}

/** Draws a run of text in screen space: AutoCAD's height is the capitals', so the font is sized up from it. */
function fillRun(ctx: CanvasRenderingContext2D, editor: Editor, run: TextRun) {
  const px = (run.height * editor.view.scale) / capRatio(run.font);
  if (px < 1.5) return; // too small to read: AutoCAD shows nothing much either
  const s = editor.toScreen(run.at);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(-run.rotation);
  ctx.scale(run.widthFactor, 1);
  ctx.font = `${px}px "${run.font}", sans-serif`;
  ctx.textAlign = run.halign;
  ctx.textBaseline = "alphabetic";
  // Where the baseline sits relative to the insertion point, in screen pixels (down is +).
  const capPx = run.height * editor.view.scale;
  const shift = run.valign === "baseline" ? 0 : run.valign === "bottom" ? -capPx * 0.3 : run.valign === "middle" ? capPx / 2 : capPx;
  ctx.fillText(run.text, 0, shift);
  ctx.restore();
}

function drawTexts(canvas: HTMLCanvasElement, editor: Editor, runs: { id: string; run: TextRun; color: string; box: { minX: number; minY: number; maxX: number; maxY: number } }[]) {
  const ctx = context(canvas, editor);
  const tl = editor.toWorld({ x: 0, y: 0 });
  const br = editor.toWorld({ x: editor.size.w, y: editor.size.h });
  const editing = editor.textEdit?.editing;
  for (const { id, run, color, box } of runs) {
    if (id === editing) continue;
    if (box.maxX < tl.x || box.minX > br.x || box.maxY < br.y || box.minY > tl.y) continue;
    ctx.fillStyle = color;
    fillRun(ctx, editor, run);
  }
}

/** Draws an object as it looks (lines, fills, text), for the rubber band. */
function drawEntity(ctx: CanvasRenderingContext2D, editor: Editor, e: Entity, color: string) {
  const g = graphicsOf(e);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const line of g.lines) {
    line.forEach((p, i) => {
      const s = editor.toScreen(p);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
  }
  ctx.stroke();
  for (const f of g.fills) {
    ctx.beginPath();
    f.forEach((p, i) => {
      const s = editor.toScreen(p);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.fill();
  }
  for (const run of g.texts) fillRun(ctx, editor, run);
}

function strokeEntity(ctx: CanvasRenderingContext2D, editor: Editor, e: Entity) {
  ctx.beginPath();
  for (const line of tessellate(e)) {
    line.forEach((p, i) => {
      const s = editor.toScreen(p);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
  }
  ctx.stroke();
}

function onScreen(editor: Editor, e: Entity) {
  const b = bounds(e);
  const tl = editor.toWorld({ x: 0, y: 0 });
  const br = editor.toWorld({ x: editor.size.w, y: editor.size.h });
  return !(b.maxX < tl.x || b.minX > br.x || b.maxY < br.y || b.minY > tl.y);
}

function drawSnapMarker(ctx: CanvasRenderingContext2D, kind: SnapKind, s: Vec) {
  const r = 6;
  ctx.strokeStyle = SNAP_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  switch (kind) {
    case "endpoint":
      ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r);
      break;
    case "midpoint":
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r, s.y + r * 0.8);
      ctx.lineTo(s.x - r, s.y + r * 0.8);
      ctx.closePath();
      break;
    case "center":
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      break;
    case "quadrant":
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r, s.y);
      ctx.lineTo(s.x, s.y + r);
      ctx.lineTo(s.x - r, s.y);
      ctx.closePath();
      break;
    case "intersection":
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x + r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r);
      break;
    case "perpendicular":
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x - r, s.y);
      ctx.lineTo(s.x, s.y);
      ctx.lineTo(s.x, s.y + r);
      break;
    case "nearest":
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.closePath();
      break;
  }
  ctx.stroke();
}

function tooltip(ctx: CanvasRenderingContext2D, dark: boolean, x: number, y: number, lines: { text: string; strong?: boolean }[]) {
  const theme = dark ? CANVAS_THEMES.dark : CANVAS_THEMES.light;
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  const width = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 12;
  const height = lines.length * 16 + 6;
  const bx = Math.min(x, ctx.canvas.width / (window.devicePixelRatio || 1) - width - 4);
  ctx.fillStyle = theme.tip;
  ctx.strokeStyle = theme.tipBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(Math.round(bx) + 0.5, Math.round(y) + 0.5, Math.round(width), height);
  ctx.fill();
  ctx.stroke();
  lines.forEach((l, i) => {
    ctx.fillStyle = l.strong ? theme.select : theme.tipText;
    ctx.fillText(l.text, bx + 6, y + 15 + i * 16);
  });
}

function drawOverlay(canvas: HTMLCanvasElement, editor: Editor, dark: boolean) {
  const ctx = context(canvas, editor);
  const theme = dark ? CANVAS_THEMES.dark : CANVAS_THEMES.light;
  const doc = editor.doc;
  const { w, h } = editor.size;

  // Selected objects: highlighted, with their grips.
  const selected = editor.selected().filter((e) => onScreen(editor, e));
  ctx.strokeStyle = theme.select;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.85;
  for (const e of selected) strokeEntity(ctx, editor, e);
  ctx.globalAlpha = 1;

  // What the cursor is over (rollover highlight).
  const hover = editor.hover ? doc.entities.get(editor.hover) : null;
  if (hover && !editor.selection.has(hover.id)) {
    ctx.strokeStyle = entityColor(hover, doc.layerOf(hover), dark);
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.55;
    strokeEntity(ctx, editor, hover);
    ctx.globalAlpha = 1;
  }

  if (!editor.command && selected.length <= 400) {
    for (const e of selected) {
      if (!doc.isEditable(e)) continue;
      for (const g of grips(e)) {
        const s = editor.toScreen(g.point);
        const hot = editor.hotGrip && Math.abs(editor.hotGrip.grip.point.x - g.point.x) < 1e-9 && Math.abs(editor.hotGrip.grip.point.y - g.point.y) < 1e-9;
        const hovered = editor.hoverGrip && editor.hoverGrip.point.x === g.point.x && editor.hoverGrip.point.y === g.point.y;
        ctx.fillStyle = hot ? GRIP.hot : hovered ? GRIP.hover : GRIP.cold;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.fillRect(Math.round(s.x) - 4, Math.round(s.y) - 4, 9, 9);
        ctx.strokeRect(Math.round(s.x) - 4.5, Math.round(s.y) - 4.5, 10, 10);
      }
    }
  }

  // The rubber band: what the command would make.
  const preview = editor.preview();
  if (preview.length) {
    ctx.lineWidth = 1;
    for (const e of preview) drawEntity(ctx, editor, e, entityColor(e, doc.layerOf(e), dark));
  }

  // Polar tracking: a dotted line along the tracked angle.
  const cursor = editor.cursorScreen;
  if (editor.tracking && cursor) {
    const a = editor.toScreen(editor.tracking.from);
    const b = editor.toScreen(editor.point);
    const far = Math.hypot(w, h);
    const dx = Math.cos(-editor.tracking.angle);
    const dy = Math.sin(-editor.tracking.angle);
    ctx.strokeStyle = SNAP_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + dx * far, a.y + dy * far);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(b.x - 4, b.y - 4);
    ctx.lineTo(b.x + 4, b.y + 4);
    ctx.moveTo(b.x + 4, b.y - 4);
    ctx.lineTo(b.x - 4, b.y + 4);
    ctx.stroke();
  }

  // The selection window: blue left to right (window), green right to left (crossing).
  if (editor.window) {
    const a = editor.toScreen(editor.window.from);
    const b = editor.toScreen(editor.window.to);
    const crossing = editor.window.crossing;
    ctx.fillStyle = crossing ? "rgba(34,197,94,0.15)" : "rgba(37,99,235,0.15)";
    ctx.strokeStyle = crossing ? "#16a34a" : "#2563eb";
    ctx.lineWidth = 1;
    ctx.setLineDash(crossing ? [5, 3] : []);
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.setLineDash([]);
  }

  drawUcsIcon(ctx, h, theme.fg);

  if (!cursor) return;

  // The snap marker, where a click would go.
  if (editor.snap) {
    const s = editor.toScreen(editor.snap.point);
    drawSnapMarker(ctx, editor.snap.kind, s);
    tooltip(ctx, dark, s.x + 12, s.y + 10, [{ text: SNAP_LABELS[editor.snap.kind] }]);
  }

  // The crosshair, with a pickbox when picking objects.
  const picking = !editor.wantsPoint && !editor.command?.pans;
  const half = (Math.max(w, h) * CROSSHAIR) / 2 + 8;
  ctx.strokeStyle = theme.fg;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const cx = Math.round(cursor.x) + 0.5;
  const cy = Math.round(cursor.y) + 0.5;
  ctx.moveTo(cx - half, cy);
  ctx.lineTo(cx + half, cy);
  ctx.moveTo(cx, cy - half);
  ctx.lineTo(cx, cy + half);
  ctx.stroke();
  if (picking) ctx.strokeRect(cx - 5, cy - 5, 10, 10);

  // Dynamic input: the prompt and what's typed, at the cursor; length and angle on the rubber band.
  if (editor.settings.dynamic) {
    const snap = editor.getSnapshot();
    const base = editor.base;
    if (base && editor.wantsPoint) {
      const p = editor.point;
      const length = Math.hypot(p.x - base.x, p.y - base.y);
      if (length > 0) {
        const angle = (Math.atan2(p.y - base.y, p.x - base.x) * 180) / Math.PI;
        const m = editor.toScreen({ x: (base.x + p.x) / 2, y: (base.y + p.y) / 2 });
        const lengthText = editor.dynLength !== null ? editor.formatLength(editor.dynLength) : editor.formatLength(length);
        tooltip(ctx, dark, m.x + 8, m.y + 8, [{ text: `${lengthText}   ${(((angle % 360) + 360) % 360).toFixed(0)}°`, strong: editor.dynLength !== null }]);
      }
    }
    const prompt = snap.prompt.split("\n").at(-1)!.replace(/:$/, "");
    const typed = snap.buffer || (editor.dynLength !== null ? "angle…" : "");
    const showPrompt = !!editor.command || !!editor.hotGrip || !!snap.buffer;
    if (showPrompt) {
      const lines = [{ text: editor.command || editor.hotGrip ? prompt : "" }].filter((l) => l.text);
      tooltip(ctx, dark, cursor.x + 18, cursor.y + 22, [...lines, { text: typed ? `${typed}▏` : "▏", strong: true }]);
    }
  }
}

function drawUcsIcon(ctx: CanvasRenderingContext2D, h: number, color: string) {
  const ox = 22;
  const oy = h - 22;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox + 34, oy);
  ctx.moveTo(ox, oy);
  ctx.lineTo(ox, oy - 34);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ox + 38, oy);
  ctx.lineTo(ox + 31, oy - 3);
  ctx.lineTo(ox + 31, oy + 3);
  ctx.closePath();
  ctx.moveTo(ox, oy - 38);
  ctx.lineTo(ox - 3, oy - 31);
  ctx.lineTo(ox + 3, oy - 31);
  ctx.closePath();
  ctx.fill();
  ctx.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("X", ox + 40, oy + 4);
  ctx.fillText("Y", ox - 3, oy - 42);
  ctx.globalAlpha = 1;
}
