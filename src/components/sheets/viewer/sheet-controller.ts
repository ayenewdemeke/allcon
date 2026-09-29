"use client";

import { initViewerRuntime } from "@/lib/aps/viewer-runtime";
import type { Point } from "@/lib/takeoff";
import type { View } from "./view";

// The APS Viewer renders the PDF page and Edit2D draws/edits lengths and areas (with
// snapping to the drawing's linework). Everything else is drawn by our SVG overlay.
//
// Coordinates: the Viewer places a PDF page in inches with the origin bottom-left. We
// store PDF points (1/72 in) with the origin top-left, as pdf.js reports them.

/* Minimal typings for the parts of Edit2D we use (it ships without TypeScript types). */
type WorldPoint = { x: number; y: number };
type E2DStyle = { lineColor: string; lineWidth: number; fillColor: string; fillAlpha: number; lineAlpha: number };
type E2DShape = { id: number; style: E2DStyle; getVertexCount(): number; getPoint(i: number): WorldPoint };

const verticesOf = (shape: E2DShape) =>
  Array.from({ length: shape.getVertexCount() }, (_, i) => shape.getPoint(i));
type E2DLayer = {
  shapes: E2DShape[];
  addShape(s: E2DShape): void;
  removeShape(s: E2DShape): void;
  update(): void;
  hitTest(x: number, y: number): E2DShape | null;
};
type E2DSelection = {
  addEventListener(type: string, cb: () => void): void;
  getSelectedShapes(): E2DShape[];
  selectOnly(s: E2DShape): void;
  clear(): void;
};
type E2DTool = { getName(): string };
type E2DContext = {
  layer: E2DLayer;
  selection: E2DSelection;
  undoStack: { addEventListener(type: string, cb: () => void): void };
};
type Edit2DExtension = {
  registerDefaultTools(): void;
  defaultContext: E2DContext;
  defaultTools: { polygonTool: E2DTool; polylineTool: E2DTool; polygonEditTool: E2DTool; copyTool: E2DTool };
};
type Edit2DNamespace = {
  Polygon: new (points: WorldPoint[], style?: E2DStyle) => E2DShape;
  Polyline: new (points: WorldPoint[], style?: E2DStyle) => E2DShape;
  UndoStack: { AFTER_ACTION: string };
  Selection: { Events: { SELECTION_CHANGED: string } };
};
const edit2dNs = () => (Autodesk as unknown as { Edit2D: Edit2DNamespace }).Edit2D;

export type ShapeKind = "length" | "area";
export type ControllerTool = "select" | "pan" | "length" | "area" | "calibrate" | "click";

export type ControllerEvents = {
  onReady: () => void;
  onError: (message: string) => void;
  onView: (view: View) => void;
  /** A new Edit2D shape was finished; resolve with the saved markup id. */
  onShapeCreated: (kind: ShapeKind, points: Point[]) => Promise<string | null>;
  onShapeChanged: (markupId: string, points: Point[]) => void;
  onShapeDeleted: (markupId: string) => void;
  onCalibrationLine: (lengthInPoints: number) => void;
  onSelect: (markupId: string | null) => void;
  /** Clicks and moves for tools drawn by the overlay (count, note, arrow, cloud). */
  onClick: (point: Point, shift: boolean) => void;
  onMove: (point: Point | null, shift: boolean) => void;
  onDoubleClick: () => void;
};

const CLICK_TOOL = "estimator-click";

export class SheetController {
  private viewer: Autodesk.Viewing.Viewer3D | null = null;
  private edit2d: Edit2DExtension | null = null;
  private destroyed = false;
  private tool: ControllerTool = "select";
  private view: View = { zoom: 1, tx: 0, ty: 0 };

  // Edit2D shape id <-> markup id, and the last points we saved for each markup.
  private shapeToMarkup = new Map<number, string | "pending">();
  private savedPoints = new Map<string, string>();
  private kinds = new Map<number, ShapeKind>();
  private muted = false; // true while we change the layer ourselves

  constructor(
    private container: HTMLElement,
    private pdfUrl: string,
    private pageNumber: number,
    private sheetHeightPts: number,
    private events: ControllerEvents,
    /** Share pages: no sign-in (no APS token) and no editing, only pan and zoom. */
    private readOnly = false,
  ) {
    void this.start().catch((err) => !this.destroyed && events.onError(err?.message ?? "Could not load this sheet"));
  }

  // The plain Viewer3D has a tool controller at runtime; the typings only declare it on GuiViewer3D.
  private get tools() {
    return (this.viewer as unknown as { toolController: Autodesk.Viewing.ToolController }).toolController;
  }

  // --- coordinates -------------------------------------------------------------

  private toWorld = ([x, y]: Point): WorldPoint => ({ x: x / 72, y: (this.sheetHeightPts - y) / 72 });
  private fromWorld = (p: WorldPoint): Point => [p.x * 72, this.sheetHeightPts - p.y * 72];
  private fromCanvas = (cx: number, cy: number): Point => [
    (cx - this.view.tx) / this.view.zoom,
    (cy - this.view.ty) / this.view.zoom,
  ];

  /** Derives the overlay transform (screen px per PDF point + offset) from the camera. */
  private updateView = () => {
    const v = this.viewer;
    if (!v) return;
    const THREE_ = (window as unknown as { THREE: { Vector3: new (x: number, y: number, z: number) => unknown } }).THREE;
    const o = v.worldToClient(new THREE_.Vector3(0, 0, 0) as THREE.Vector3);
    const u = v.worldToClient(new THREE_.Vector3(1, 1, 0) as THREE.Vector3);
    const zoom = (u.x - o.x) / 72; // px per point
    const yPerInch = u.y - o.y; // negative: world y points up
    this.view = { zoom, tx: o.x, ty: o.y + (yPerInch * this.sheetHeightPts) / 72 };
    this.events.onView(this.view);
  };

  // --- setup -----------------------------------------------------------------------

  private async start() {
    await initViewerRuntime(this.readOnly ? "local" : "aps");
    if (this.destroyed) return;
    const viewer = new Autodesk.Viewing.Viewer3D(this.container, {});
    this.viewer = viewer;
    viewer.start();
    viewer.setTheme?.("light-theme");
    await viewer.loadExtension("Autodesk.PDF");

    await new Promise<void>((resolve, reject) => {
      // Our PDF URL has no ".pdf" the Viewer could detect the loader from, so name it.
      const fileLoader = (Autodesk.Viewing as unknown as {
        FileLoaderManager: { getFileLoaderForExtension(ext: string): unknown };
      }).FileLoaderManager.getFileLoaderForExtension("pdf");
      viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => resolve(), { once: true });
      viewer.loadModel(
        this.pdfUrl,
        { page: this.pageNumber, fileLoader } as object,
        () => {},
        (code: number, message: string) => reject(new Error(`Could not load the sheet (${code}): ${message}`)),
      );
    });
    if (this.destroyed) return;

    viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.updateView);
    new ResizeObserver(this.updateView).observe(this.container);
    this.updateView();

    const edit2d = (await viewer.loadExtension("Autodesk.Edit2D", { enableArcs: false })) as unknown as Edit2DExtension;
    edit2d.registerDefaultTools();
    this.edit2d = edit2d;
    const ns = edit2dNs();
    edit2d.defaultContext.undoStack.addEventListener(ns.UndoStack.AFTER_ACTION, () => this.sync());
    edit2d.defaultContext.selection.addEventListener(ns.Selection.Events.SELECTION_CHANGED, () => {
      const shape = edit2d.defaultContext.selection.getSelectedShapes()[0];
      const id = shape ? this.shapeToMarkup.get(shape.id) : null;
      this.events.onSelect(id && id !== "pending" ? id : null);
    });

    this.tools.registerTool(this.clickTool() as unknown as Autodesk.Viewing.ToolInterface);
    this.setTool(this.tool);
    // Handy when debugging in the browser console; never exposed in production.
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __sheetController: this, __edit2d: edit2d });
    this.events.onReady();
  }

  /** A viewer tool that forwards clicks to the overlay tools (count, note, arrow, cloud). */
  private clickTool() {
    type CanvasEvent = MouseEvent & { canvasX: number; canvasY: number };
    return {
      getNames: () => [CLICK_TOOL],
      getName: () => CLICK_TOOL,
      getPriority: () => 50,
      isActive: () => this.tool === "click",
      activate: () => {},
      deactivate: () => this.events.onMove(null, false),
      register: () => {},
      deregister: () => {},
      handleSingleClick: (e: CanvasEvent, button: number) => {
        if (button !== 0) return false;
        this.events.onClick(this.fromCanvas(e.canvasX, e.canvasY), e.shiftKey);
        return true;
      },
      handleDoubleClick: () => {
        this.events.onDoubleClick();
        return true;
      },
      handleMouseMove: (e: CanvasEvent) => {
        this.events.onMove(this.fromCanvas(e.canvasX, e.canvasY), e.shiftKey);
        return false; // keep hover/pan behaviour
      },
    };
  }

  // --- keeping Edit2D and the database in step ---------------------------------------

  private pointsKey = (pts: Point[]) => JSON.stringify(pts.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]));

  private sync() {
    if (this.muted || !this.edit2d) return;
    const layer = this.edit2d.defaultContext.layer;
    const present = new Set<number>();
    const ns = edit2dNs();

    for (const shape of layer.shapes) {
      present.add(shape.id);
      const points = verticesOf(shape).map(this.fromWorld);
      const known = this.shapeToMarkup.get(shape.id);

      if (known === undefined) {
        if (this.tool === "calibrate") {
          // The calibration line is only a measuring stick; it is never saved.
          let length = 0;
          for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
          this.mute(() => layer.removeShape(shape));
          this.events.onCalibrationLine(length);
          continue;
        }
        const kind: ShapeKind = shape instanceof ns.Polygon ? "area" : "length";
        this.kinds.set(shape.id, kind);
        this.shapeToMarkup.set(shape.id, "pending");
        void this.events.onShapeCreated(kind, points).then((markupId) => {
          if (!markupId) {
            this.shapeToMarkup.delete(shape.id);
            this.mute(() => layer.removeShape(shape));
            return;
          }
          this.shapeToMarkup.set(shape.id, markupId);
          this.savedPoints.set(markupId, this.pointsKey(points));
        });
      } else if (known !== "pending") {
        const key = this.pointsKey(points);
        if (key !== this.savedPoints.get(known)) {
          this.savedPoints.set(known, key);
          this.events.onShapeChanged(known, points);
        }
      }
    }

    for (const [shapeId, markupId] of this.shapeToMarkup) {
      if (present.has(shapeId)) continue;
      this.shapeToMarkup.delete(shapeId);
      if (markupId !== "pending") {
        this.savedPoints.delete(markupId);
        this.events.onShapeDeleted(markupId);
      }
    }
  }

  private mute(fn: () => void) {
    this.muted = true;
    try {
      fn();
    } finally {
      this.muted = false;
    }
  }

  private style(kind: ShapeKind, color: string): E2DStyle {
    return {
      lineColor: color,
      lineWidth: 2,
      lineAlpha: 1,
      fillColor: color,
      fillAlpha: kind === "area" ? 0.15 : 0,
    };
  }

  private shapeFor(markupId: string) {
    for (const [shapeId, id] of this.shapeToMarkup) {
      if (id === markupId) return this.edit2d?.defaultContext.layer.shapes.find((s) => s.id === shapeId);
    }
    return undefined;
  }

  // --- public API ---------------------------------------------------------------------

  /** Puts saved lengths and areas on the Edit2D layer. */
  loadShapes(markups: { id: string; kind: string; points: Point[]; color: string }[]) {
    if (!this.edit2d) return;
    const layer = this.edit2d.defaultContext.layer;
    const ns = edit2dNs();
    this.mute(() => {
      for (const m of markups) {
        if (m.kind !== "length" && m.kind !== "area") continue;
        const Shape = m.kind === "area" ? ns.Polygon : ns.Polyline;
        const shape = new Shape(m.points.map(this.toWorld));
        Object.assign(shape.style, this.style(m.kind, m.color));
        layer.addShape(shape);
        this.shapeToMarkup.set(shape.id, m.id);
        this.kinds.set(shape.id, m.kind);
        this.savedPoints.set(m.id, this.pointsKey(m.points));
      }
      layer.update();
    });
  }

  setColor(markupId: string, color: string) {
    const shape = this.shapeFor(markupId);
    if (!shape || !this.edit2d) return;
    Object.assign(shape.style, this.style(this.kinds.get(shape.id) ?? "length", color));
    this.edit2d.defaultContext.layer.update();
  }

  /** Removes a shape the app deleted (e.g. from the side panel), without echoing a delete. */
  removeShape(markupId: string) {
    const shape = this.shapeFor(markupId);
    if (!shape || !this.edit2d) return;
    this.mute(() => this.edit2d!.defaultContext.layer.removeShape(shape));
    this.shapeToMarkup.delete(shape.id);
    this.savedPoints.delete(markupId);
  }

  select(markupId: string | null) {
    const selection = this.edit2d?.defaultContext.selection;
    if (!selection) return;
    const shape = markupId ? this.shapeFor(markupId) : undefined;
    if (shape) selection.selectOnly(shape);
    else selection.clear();
  }

  setTool(tool: ControllerTool) {
    this.tool = this.readOnly ? "pan" : tool;
    const viewer = this.viewer;
    const edit2d = this.edit2d;
    if (!viewer || !edit2d) return;
    const names: Record<string, string> = {
      select: edit2d.defaultTools.polygonEditTool.getName(),
      length: edit2d.defaultTools.polylineTool.getName(),
      calibrate: edit2d.defaultTools.polylineTool.getName(),
      area: edit2d.defaultTools.polygonTool.getName(),
      click: CLICK_TOOL,
    };
    for (const name of new Set(Object.values(names))) this.tools.deactivateTool(name);
    const next = names[this.tool];
    if (next) this.tools.activateTool(next);
    // Copy/paste is ours (it keeps line items, depths and names, and works for every
    // markup type), so Edit2D's own copy tool stays off.
    this.tools.deactivateTool(edit2d.defaultTools.copyTool.getName());
  }

  /** The sheet point under a screen position. */
  sheetPointAt(clientX: number, clientY: number): Point {
    const rect = this.container.getBoundingClientRect();
    return this.fromCanvas(clientX - rect.left, clientY - rect.top);
  }

  /** The markup whose length/area shape is under a screen position, if any. */
  markupAt(clientX: number, clientY: number): string | null {
    const layer = this.edit2d?.defaultContext.layer;
    if (!layer) return null;
    const w = this.toWorld(this.sheetPointAt(clientX, clientY));
    const shape = layer.hitTest(w.x, w.y);
    const id = shape ? this.shapeToMarkup.get(shape.id) : undefined;
    return id && id !== "pending" ? id : null;
  }

  /** Zooms about the centre of the view by fitting the camera to a smaller/larger box. */
  zoom(factor: number) {
    const viewer = this.viewer;
    if (!viewer) return;
    const { width, height } = this.container.getBoundingClientRect();
    const inchesPerPx = 1 / (this.view.zoom * 72);
    const [cx, cy] = this.fromCanvas(width / 2, height / 2);
    const centre = this.toWorld([cx, cy]);
    const halfW = (width / 2) * inchesPerPx / factor;
    const halfH = (height / 2) * inchesPerPx / factor;
    const T = (window as unknown as { THREE: typeof THREE }).THREE;
    const box = new T.Box3(new T.Vector3(centre.x - halfW, centre.y - halfH, 0), new T.Vector3(centre.x + halfW, centre.y + halfH, 0));
    viewer.navigation.fitBounds(true, box);
  }

  /**
   * Brings sheet points into view: pans (keeping the zoom) when they're off-screen, and
   * zooms out only if they don't fit.
   */
  reveal(points: Point[]) {
    const viewer = this.viewer;
    if (!viewer || !points.length) return;
    const { width, height } = this.container.getBoundingClientRect();
    const xs = points.map(([x]) => this.view.tx + x * this.view.zoom);
    const ys = points.map(([, y]) => this.view.ty + y * this.view.zoom);
    const margin = 40;
    const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (left >= margin && right <= width - margin && top >= margin && bottom <= height - margin) return;

    const T = (window as unknown as { THREE: typeof THREE }).THREE;
    const nav = viewer.navigation;
    if (right - left <= width - 2 * margin && bottom - top <= height - 2 * margin) {
      // Fits at the current zoom: pan so its centre lands in the middle of the view.
      // (Animated fitBounds doesn't move this 2D camera; setView does.)
      const dx = ((left + right) / 2 - width / 2) / (this.view.zoom * 72); // screen px -> inches
      const dy = -((top + bottom) / 2 - height / 2) / (this.view.zoom * 72); // screen y runs down
      const d = new T.Vector3(dx, dy, 0);
      nav.setView(nav.getPosition().clone().add(d), nav.getTarget().clone().add(d));
      return;
    }
    // Bigger than the view: zoom out to fit it, with some room around it.
    const sheetXs = points.map(([x]) => x);
    const sheetYs = points.map(([, y]) => y);
    const pad = 0.2 * Math.max(Math.max(...sheetXs) - Math.min(...sheetXs), Math.max(...sheetYs) - Math.min(...sheetYs));
    const a = this.toWorld([Math.min(...sheetXs) - pad, Math.max(...sheetYs) + pad]);
    const b = this.toWorld([Math.max(...sheetXs) + pad, Math.min(...sheetYs) - pad]);
    nav.fitBounds(true, new T.Box3(new T.Vector3(a.x, a.y, 0), new T.Vector3(b.x, b.y, 0)));
  }

  fit() {
    this.viewer?.fitToView?.();
  }

  destroy() {
    this.destroyed = true;
    this.viewer?.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.updateView);
    this.viewer?.finish();
    this.viewer = null;
    this.edit2d = null;
  }
}
