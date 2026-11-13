"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { entityColor } from "@/lib/drafting/aci";
import { blockParts } from "@/lib/drafting/blocks";
import { MODEL, type DraftDocument } from "@/lib/drafting/document";
import type { Editor } from "@/lib/drafting/editor";
import { bounds, graphicsOf, grips, tessellate, type TextRun } from "@/lib/drafting/geometry";
import { applyFields } from "@/lib/drafting/graphics";
import { capRatio } from "@/lib/drafting/graphics";
import type { SnapKind } from "@/lib/drafting/snaps";
import { LW_BYBLOCK, LW_BYLAYER, LW_DEFAULT, type Entity, type ImageEntity, type Vec, type ViewportEntity } from "@/lib/drafting/types";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

// The drawing area. Three layers: the grid (2D canvas), the drawing (WebGL, so big drawings
// stay smooth, with attached pictures and PDF pages under the linework), and on top the
// crosshair, snap markers, grips, selection highlight, rubber band and dynamic input (2D
// canvas, redrawn as the cursor moves).

/** Pictures under the drawing, faded toward the background. A PDF page shows its linework
 * without the paper (white goes clear), inverted on a dark background so it stays visible, as
 * AutoCAD adjusts underlays for the background. */
const PICTURE_SHADER = {
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D map; uniform float opacity; uniform float invert; uniform float paper; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(map, vUv);
      float light = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.a *= 1.0 - paper * smoothstep(0.9, 0.99, light);
      c.rgb = mix(c.rgb, 1.0 - c.rgb, invert);
      gl_FragColor = vec4(c.rgb, c.a * opacity);
    }`,
};

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
  insertion: "Insertion",
  perpendicular: "Perpendicular",
  nearest: "Nearest",
};

export function DraftingCanvas({ editor, dark, onReady, pictureUrl }: { editor: Editor; dark: boolean; onReady?: () => void; pictureUrl: (key: string) => string }) {
  const host = useRef<HTMLDivElement>(null);
  const gridCanvas = useRef<HTMLCanvasElement>(null);
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  const textCanvas = useRef<HTMLCanvasElement>(null);
  const darkRef = useRef(dark);
  const redraw = useRef<(rebuild?: boolean) => void>(() => {});
  const ready = useRef(onReady);
  const pictureUrlRef = useRef(pictureUrl);
  useEffect(() => {
    ready.current = onReady;
    pictureUrlRef.current = pictureUrl;
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
    renderer.autoClear = false;
    renderer.domElement.className = "absolute inset-0 size-full";
    el.insertBefore(renderer.domElement, text);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    // Attached pictures share one square, and their textures by file.
    const square = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    const textures = new Map<string, THREE.Texture>();
    const loader = new THREE.TextureLoader().setCrossOrigin("anonymous");
    const texture = (key: string) => {
      let t = textures.get(key);
      if (!t) {
        t = loader.load(pictureUrlRef.current(key), () => schedule());
        t.colorSpace = THREE.NoColorSpace;
        t.anisotropy = 4;
        textures.set(key, t);
      }
      return t;
    };
    // Model space, and the paper of the layout on screen.
    const model = new Pass(square, texture);
    const paper = new Pass(square, texture);
    const resolution = new THREE.Vector2();
    let textKey = "";
    let builtVersion = -1;
    let builtKey = "";

    const rebuild = () => {
      const main = editor.drawing;
      const layout = editor.layoutId;
      // A layout's paper is white, as AutoCAD's: colour 7 draws black on it.
      const dark = darkRef.current && !layout;
      const lineweights = editor.settings.lineweights;
      builtVersion = editor.doc.version;
      builtKey = `${darkRef.current},${layout},${lineweights}`;
      model.build(editor.blockEdit ? editor.doc.entities.values() : main.entitiesIn(MODEL).values(), editor.doc, dark, lineweights);
      paper.build(layout ? main.entitiesIn(layout).values() : [], main, dark, lineweights);
      textKey = "";
    };

    /** The camera for a view (centre and pixels per unit) of a pass. */
    const look = (view: View, pass: Pass) => {
      const { w, h } = editor.size;
      camera.left = -w / 2 / view.scale;
      camera.right = w / 2 / view.scale;
      camera.top = h / 2 / view.scale;
      camera.bottom = -h / 2 / view.scale;
      camera.position.set(view.cx - pass.origin.x, view.cy - pass.origin.y, 10);
      camera.updateProjectionMatrix();
    };

    let frame = 0;
    const draw = () => {
      frame = 0;
      // Fields show the drawing's name and the layout on screen (plotting sets its own).
      applyFields({ fileName: editor.drawingName, layout: editor.layoutId ? (editor.doc.layouts.get(editor.layoutId)?.name ?? "") : "Model" });
      const { w, h } = editor.size;
      if (editor.doc.version !== builtVersion || `${darkRef.current},${editor.layoutId},${editor.settings.lineweights}` !== builtKey) rebuild();
      resolution.set(w, h);
      renderer.clear();
      const texts: TextLayer[] = [];
      const layout = editor.layoutId;
      if (!layout) {
        // Lineweights in model space: a constant width on screen, as AutoCAD shows them.
        model.setWidths((lw) => Math.max(1, (lw / 100) * (96 / 25.4)), resolution);
        look(editor.view, model);
        renderer.render(model.scene, camera);
        texts.push({ runs: model.runs, view: editor.view });
      } else {
        // A layout: each viewport shows the model, clipped to its frame; the paper on top.
        const pv = editor.paperView ?? editor.view;
        const pxPerMm = pv.scale / (editor.drawing.units === "mm" ? 1 : 25.4);
        const onPaper = (lw: number) => Math.max(1, (lw / 100) * pxPerMm);
        model.setWidths(onPaper, resolution);
        paper.setWidths(onPaper, resolution);
        renderer.setScissorTest(true);
        for (const vp of viewportsOn(editor, layout)) {
          const rect = screenRect(vp, pv, w, h);
          if (rect.w <= 0 || rect.h <= 0) continue;
          renderer.setScissor(rect.x, h - rect.y - rect.h, rect.w, rect.h);
          const view = viewThrough(vp, pv);
          look(view, model);
          renderer.render(model.scene, camera);
          texts.push({ runs: model.runs, view, clip: rect });
        }
        renderer.setScissorTest(false);
        look(pv, paper);
        renderer.render(paper.scene, camera);
        texts.push({ runs: paper.runs, view: pv });
      }
      const pv = editor.paperView;
      const key = `${editor.view.cx},${editor.view.cy},${editor.view.scale},${pv?.cx},${pv?.cy},${pv?.scale},${w},${h},${builtVersion},${builtKey},${editor.textEdit?.editing}`;
      if (key !== textKey) {
        textKey = key;
        drawTexts(text, editor, texts);
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
      model.dispose();
      paper.dispose();
      square.dispose();
      for (const t of textures.values()) t.dispose();
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

type View = { cx: number; cy: number; scale: number };
type TextRunAt = { id: string; run: TextRun; color: string; box: { minX: number; minY: number; maxX: number; maxY: number } };
type TextLayer = { runs: TextRunAt[]; view: View; clip?: { x: number; y: number; w: number; h: number } };

/** An object's lineweight, resolved (ByLayer, Default), in hundredths of a millimetre. */
function lineweightOf(e: Entity, doc: DraftDocument) {
  let lw = e.lineweight === LW_BYLAYER ? (doc.layerOf(e)?.lineweight ?? LW_DEFAULT) : e.lineweight;
  if (lw === LW_BYBLOCK || lw === LW_DEFAULT || lw < 0) lw = 25; // AutoCAD's LWDEFAULT
  return lw;
}

/** One space drawn in WebGL: its lines (thin, or grouped by lineweight when lineweights show),
 * fills, pictures, and the text runs the text canvas draws. Positions are relative to an
 * origin near the drawing, so survey-sized coordinates keep their precision in the GPU. */
class Pass {
  scene = new THREE.Scene();
  origin: Vec = { x: 0, y: 0 };
  runs: TextRunAt[] = [];
  private thin = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
  private fills = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  private wide = new Map<number, LineSegments2>();
  private pictures = new Map<string, { mesh: THREE.Mesh; material: THREE.ShaderMaterial }>();
  private colors = new Map<string, THREE.Color>();

  constructor(
    private square: THREE.BufferGeometry,
    private texture: (key: string) => THREE.Texture,
  ) {
    this.thin.frustumCulled = false;
    this.fills.frustumCulled = false;
    this.scene.add(this.fills, this.thin);
  }

  private colorOf(css: string) {
    let c = this.colors.get(css);
    if (!c) this.colors.set(css, (c = new THREE.Color(css)));
    return c;
  }

  build(entities: Iterable<Entity>, doc: DraftDocument, dark: boolean, lineweights: boolean) {
    const list = [...entities];
    const first = list[0];
    if (first) {
      const b = bounds(first);
      this.origin = { x: b.minX, y: b.minY };
    }
    const o = this.origin;
    const thin: number[] = [];
    const thinColors: number[] = [];
    const wide = new Map<number, { pos: number[]; col: number[] }>();
    const fpos: number[] = [];
    const fcol: number[] = [];
    const images: ImageEntity[] = [];
    this.runs = [];
    const add = (e: Entity) => {
      const css = entityColor(e, doc.layerOf(e), dark);
      const c = this.colorOf(css);
      const g = graphicsOf(e);
      const lw = lineweights ? lineweightOf(e, doc) : 0;
      let target = { pos: thin, col: thinColors };
      if (lw > 0) {
        if (!wide.has(lw)) wide.set(lw, { pos: [], col: [] });
        target = wide.get(lw)!;
      }
      for (const line of g.lines) {
        for (let i = 0; i + 1 < line.length; i++) {
          target.pos.push(line[i].x - o.x, line[i].y - o.y, 0, line[i + 1].x - o.x, line[i + 1].y - o.y, 0);
          target.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
      }
      // Fills are convex (triangles, arrowheads, dots): a fan covers them.
      for (const f of g.fills) {
        for (let i = 1; i + 1 < f.length; i++) {
          for (const p of [f[0], f[i], f[i + 1]]) {
            fpos.push(p.x - o.x, p.y - o.y, -0.5);
            fcol.push(c.r, c.g, c.b);
          }
        }
      }
      if (g.texts.length) {
        const b = bounds(e);
        for (const run of g.texts) this.runs.push({ id: e.id, run, color: css, box: b });
      }
    };
    for (const e of list) {
      if (!doc.isVisible(e)) continue;
      if (e.type === "image") images.push(e);
      // A block reference's objects each have their own layer and colour.
      if (e.type !== "insert") add(e);
      else for (const part of blockParts(e)) if (doc.isVisible(part)) add(part);
    }
    this.placePictures(images, dark);
    const set = (geometry: THREE.BufferGeometry, pos: number[], col: number[]) => {
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geometry.computeBoundingSphere();
    };
    set(this.thin.geometry, thin, thinColors);
    set(this.fills.geometry, fpos, fcol);
    // Wide lines, one object per lineweight.
    for (const [lw, line] of this.wide) {
      if (wide.has(lw)) continue;
      this.scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
      this.wide.delete(lw);
    }
    for (const [lw, { pos, col }] of wide) {
      let line = this.wide.get(lw);
      if (!line) {
        line = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ vertexColors: true, linewidth: 1, worldUnits: false }));
        line.frustumCulled = false;
        this.scene.add(line);
        this.wide.set(lw, line);
      } else {
        line.geometry.dispose();
        line.geometry = new LineSegmentsGeometry();
      }
      line.geometry.setPositions(pos);
      line.geometry.setColors(col);
    }
  }

  /** Lineweights in pixels, for the current view. */
  setWidths(px: (lw: number) => number, resolution: THREE.Vector2) {
    for (const [lw, line] of this.wide) {
      line.material.linewidth = px(lw);
      line.material.resolution.copy(resolution);
    }
  }

  private placePictures(images: ImageEntity[], dark: boolean) {
    const seen = new Set<string>();
    images.forEach((e, i) => {
      seen.add(e.id);
      let p = this.pictures.get(e.id);
      if (!p) {
        const material = new THREE.ShaderMaterial({ ...PICTURE_SHADER, uniforms: { map: { value: null }, opacity: { value: 1 }, invert: { value: 0 }, paper: { value: 0 } }, transparent: true, depthWrite: false });
        p = { mesh: new THREE.Mesh(this.square, material), material };
        p.mesh.frustumCulled = false;
        this.scene.add(p.mesh);
        this.pictures.set(e.id, p);
      }
      p.material.uniforms.map.value = this.texture(e.key);
      p.material.uniforms.opacity.value = 1 - Math.min(Math.max(e.fade, 0), 100) / 100;
      p.material.uniforms.invert.value = e.source === "pdf" && dark ? 1 : 0;
      p.material.uniforms.paper.value = e.source === "pdf" ? 1 : 0;
      p.mesh.position.set(e.at.x - this.origin.x, e.at.y - this.origin.y, -1 - i * 1e-3);
      p.mesh.rotation.z = e.rotation;
      p.mesh.scale.set(e.width, e.height, 1);
    });
    for (const [id, p] of this.pictures) {
      if (seen.has(id)) continue;
      this.scene.remove(p.mesh);
      p.material.dispose();
      this.pictures.delete(id);
    }
  }

  dispose() {
    this.thin.geometry.dispose();
    this.thin.material.dispose();
    this.fills.geometry.dispose();
    this.fills.material.dispose();
    for (const line of this.wide.values()) {
      line.geometry.dispose();
      line.material.dispose();
    }
    for (const p of this.pictures.values()) p.material.dispose();
  }
}

/** A layout's viewports that show (on a visible layer). */
function viewportsOn(editor: Editor, layout: string) {
  const main = editor.drawing;
  return [...main.entitiesIn(layout).values()].filter((e): e is ViewportEntity => e.type === "viewport" && main.isVisible(e));
}

/** A viewport's frame on screen, for a view of the paper. */
function screenRect(vp: ViewportEntity, pv: View, w: number, h: number) {
  const x = (vp.center.x - vp.width / 2 - pv.cx) * pv.scale + w / 2;
  const y = h / 2 - (vp.center.y + vp.height / 2 - pv.cy) * pv.scale;
  return { x, y, w: vp.width * pv.scale, h: vp.height * pv.scale };
}

/** The view of the model, over the whole screen, that shows through a viewport. */
function viewThrough(vp: ViewportEntity, pv: View): View {
  return { cx: vp.view.x + (pv.cx - vp.center.x) / vp.scale, cy: vp.view.y + (pv.cy - vp.center.y) / vp.scale, scale: pv.scale * vp.scale };
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
  const layout = editor.layoutId ? editor.drawing.layouts.get(editor.layoutId) : null;
  if (layout) {
    // A layout: the sheet of paper on a grey backdrop, as AutoCAD shows it.
    const pv = editor.paperView ?? editor.view;
    const at = (x: number, y: number) => ({ x: (x - pv.cx) * pv.scale + w / 2, y: h / 2 - (y - pv.cy) * pv.scale });
    ctx.fillStyle = dark ? "#3b4250" : "#c9ced6";
    ctx.fillRect(0, 0, w, h);
    const a = at(0, layout.paper.height);
    const sw = layout.paper.width * pv.scale;
    const sh = layout.paper.height * pv.scale;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(a.x + 5, a.y + 5, sw, sh);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(a.x, a.y, sw, sh);
    return;
  }
  if (editor.blockEdit) {
    // The block editor's background, a shade apart from the drawing's, as in AutoCAD.
    ctx.fillStyle = dark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.05)";
    ctx.fillRect(0, 0, w, h);
  }
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
function fillRun(ctx: CanvasRenderingContext2D, editor: Editor, run: TextRun, view: View = editor.view) {
  const px = (run.height * view.scale) / capRatio(run.font);
  if (px < 1.5) return; // too small to read: AutoCAD shows nothing much either
  const s = { x: (run.at.x - view.cx) * view.scale + editor.size.w / 2, y: editor.size.h / 2 - (run.at.y - view.cy) * view.scale };
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(-run.rotation);
  ctx.scale(run.widthFactor, 1);
  ctx.font = `${px}px "${run.font}", sans-serif`;
  ctx.textAlign = run.halign;
  ctx.textBaseline = "alphabetic";
  // Where the baseline sits relative to the insertion point, in screen pixels (down is +).
  const capPx = run.height * view.scale;
  const shift = run.valign === "baseline" ? 0 : run.valign === "bottom" ? -capPx * 0.3 : run.valign === "middle" ? capPx / 2 : capPx;
  ctx.fillText(run.text, 0, shift);
  ctx.restore();
}

function drawTexts(canvas: HTMLCanvasElement, editor: Editor, layers: TextLayer[]) {
  const ctx = context(canvas, editor);
  const { w, h } = editor.size;
  const editing = editor.textEdit?.editing;
  for (const { runs, view, clip } of layers) {
    // What the screen (or the viewport's frame) shows, in the layer's units.
    const r = clip ?? { x: 0, y: 0, w, h };
    const minX = view.cx + (r.x - w / 2) / view.scale;
    const maxX = view.cx + (r.x + r.w - w / 2) / view.scale;
    const maxY = view.cy - (r.y - h / 2) / view.scale;
    const minY = view.cy - (r.y + r.h - h / 2) / view.scale;
    ctx.save();
    if (clip) {
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.w, clip.h);
      ctx.clip();
    }
    for (const { id, run, color, box } of runs) {
      if (id === editing) continue;
      if (box.maxX < minX || box.minX > maxX || box.maxY < minY || box.minY > maxY) continue;
      ctx.fillStyle = color;
      fillRun(ctx, editor, run, view);
    }
    ctx.restore();
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
    case "insertion":
      // Two overlapping squares, as AutoCAD's insertion marker.
      ctx.rect(s.x - r, s.y - r, r * 1.2, r * 1.2);
      ctx.rect(s.x - r * 0.2, s.y - r * 0.2, r * 1.2, r * 1.2);
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

  // The block editor marks the block's base point (where references are placed by).
  const base = editor.blockEdit && editor.drawing.blocks.get(editor.blockEdit.name)?.base;
  if (base) {
    const s = editor.toScreen(base);
    ctx.strokeStyle = theme.select;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
    ctx.moveTo(s.x - 12, s.y);
    ctx.lineTo(s.x + 12, s.y);
    ctx.moveTo(s.x, s.y - 12);
    ctx.lineTo(s.x, s.y + 12);
    ctx.stroke();
    ctx.fillStyle = theme.select;
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("Base point", s.x + 10, s.y - 10);
  }

  // Others' cursors, where they're working in the same space: an arrow and their name.
  for (const o of editor.others) {
    if (!o.cursor || o.space !== editor.doc.space || editor.blockEdit) continue;
    const p = editor.toScreen({ x: o.cursor[0], y: o.cursor[1] });
    if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue;
    ctx.fillStyle = o.color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 4, p.y + 14);
    ctx.lineTo(p.x + 7, p.y + 8);
    ctx.lineTo(p.x + 13, p.y + 6);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    const label = o.name.split("@")[0];
    const tw = ctx.measureText(label).width + 8;
    ctx.beginPath();
    ctx.roundRect(p.x + 10, p.y + 12, tw, 16, 4);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, p.x + 14, p.y + 24);
  }

  // The viewport worked through has a bold frame, as in AutoCAD.
  const active = editor.viewportRect();
  if (active) {
    ctx.strokeStyle = theme.select;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(active.x, active.y, active.w, active.h);
  }

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
