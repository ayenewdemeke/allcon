import { COMMANDS, findCommand, suggestCommands, type Command, type CommandInfo, type Prompt } from "./commands";
import { TextEditCommand } from "./commands-annotate";
import { DraftDocument, newId } from "./document";
import { angleOf, crossesBox, dist, distanceTo, dot, grips, insideBox, moveGrip, polar, same, sub, type Box, type Grip } from "./geometry";
import { DEFAULT_SNAPS, findSnap, type Snap, type SnapKind } from "./snaps";
import { formatLength, parseAngle, parseLength, parsePointInput } from "./units";
import { attributeDefs } from "./blocks";
import { LW_BYLAYER, type ColorValue, type DrawingData, type Entity, type InsertEntity, type Vec } from "./types";

// The drafting editor without its screen: the view, the cursor with object snaps and polar
// tracking, selection and grips, the command line, and the keyboard, as AutoCAD behaves. The
// React shell draws it and feeds it pointer and key events; tests drive it directly.

export type Settings = {
  grid: boolean;
  snap: boolean; // grid snap (F9)
  ortho: boolean; // F8
  polar: boolean; // F10
  polarAngle: number; // degrees
  osnap: boolean; // F3
  snapKinds: SnapKind[];
  dynamic: boolean; // F12
};

export const DEFAULT_SETTINGS: Settings = { grid: true, snap: false, ortho: false, polar: true, polarAngle: 90, osnap: true, snapKinds: DEFAULT_SNAPS, dynamic: true };

export type Palette = "properties" | "layers" | "styles" | "blocks";

/** A file attached under the drawing, ready to place: its size at scale 1, in drawing units. */
export type Attachment = { key: string; name: string; source: "image" | "pdf"; width: number; height: number };

/** A dialog a command opens, as AutoCAD's: the shell shows it and passes back the answer. */
export type DialogRequest =
  | { kind: "block"; count: number; done: (r: { name: string; description: string; mode: "convert" | "retain" | "delete" } | null) => void }
  | { kind: "attributes"; block: string; rows: { tag: string; prompt: string; value: string }[]; done: (values: Record<string, string> | null) => void }
  | { kind: "save-block"; name: string; done: (choice: "save" | "discard" | null) => void }
  | { kind: "purge"; done: (r: null) => void };

/** Text being typed in place over the drawing (TEXT, MTEXT, MLEADER, TEXTEDIT). */
export type TextEditRequest = {
  at: Vec;
  height: number;
  rotation: number;
  /** Wrapping width (0: none). */
  width: number;
  value: string;
  style: string;
  multiline?: boolean;
  /** The object whose text is being edited: its text is hidden under the editor, as in AutoCAD. */
  editing?: string;
  done: (text: string | null) => void;
};
export type HistoryLine = { text: string; kind: "command" | "input" | "info" | "error" };
export type Window = { from: Vec; to: Vec; crossing: boolean };
export type HotGrip = { grip: Grip; ids: string[] };

const PICKBOX = 5; // pixels
const APERTURE = 12; // pixels
const DRAG = 5; // pixels a press can move and still be a click
const TRACK = 10; // pixels from a polar angle that still tracks it

export type Snapshot = {
  version: number;
  command: string | null;
  prompt: string;
  keywords: { key: string; label: string }[];
  buffer: string;
  history: HistoryLine[];
  suggestions: CommandInfo[];
  settings: Settings;
  selection: string[];
  canUndo: boolean;
  canRedo: boolean;
  currentLayer: string;
  current: { color: ColorValue; lineweight: number };
  textEdit: TextEditRequest | null;
  dialog: DialogRequest | null;
  /** The block open in the block editor. */
  blockEdit: string | null;
};

export class Editor {
  doc: DraftDocument;
  view = { cx: 0, cy: 0, scale: 1 }; // scale: pixels per drawing unit
  size = { w: 800, h: 600 };
  settings: Settings;
  selection = new Set<string>();
  /** Properties new objects get (ByLayer unless set). */
  current: { color: ColorValue; lineweight: number } = { color: null, lineweight: LW_BYLAYER };
  ui: {
    openPalette: (p: Palette) => void;
    /** Asks for a picture or a PDF, stores it, and says how big it is (null: cancelled). */
    attach: (source: "image" | "pdf") => Promise<Attachment | null>;
    /** Downloads the drawing as DXF. */
    exportDxf: () => void;
  } = { openPalette: () => {}, attach: async () => null, exportDxf: () => {} };

  /** Remembers (or forgets, with undefined) a value commands use, such as the hatch pattern. */
  remember(key: string, value: number | string | boolean | undefined) {
    if (value === undefined) delete this.memory[key];
    else this.memory[key] = value;
    this.emit();
  }

  /** Answers the current prompt as if typed (ribbon options such as Circle 2P). */
  answer(text: string) {
    this.buffer = text;
    this.submit();
  }

  /** Connects the editor to its screen's palettes. */
  setUi(ui: Partial<Editor["ui"]>) {
    this.ui = { ...this.ui, ...ui };
  }

  command: Command | null = null;
  lastCommand: string | null = null;
  /** Values commands remember between uses in a session (offset distance, fillet radius...). */
  memory: Record<string, number | string | boolean> = {};
  /** The windows the current selection was made with (STRETCH stretches what's inside them). */
  windows: Box[] = [];
  /** The last point given, for "@" (AutoCAD's last point). */
  lastPoint: Vec | null = null;
  textEdit: TextEditRequest | null = null;
  dialog: DialogRequest | null = null;
  /** The block editor: the block being edited, and the drawing it came from. */
  blockEdit: { name: string; main: DraftDocument; view: Editor["view"]; saved: number } | null = null;
  buffer = "";
  history: HistoryLine[] = [];
  private inputs: string[] = [];
  private recall = -1;

  // Pointer state, read by the renderer.
  cursorScreen: Vec | null = null;
  cursor: Vec = { x: 0, y: 0 }; // where the pointer is, in the drawing
  point: Vec = { x: 0, y: 0 }; // the point a click would give (snapped, tracked)
  snap: Snap | null = null;
  tracking: { from: Vec; angle: number } | null = null;
  hover: string | null = null;
  hoverGrip: Grip | null = null;
  window: Window | null = null;
  hotGrip: HotGrip | null = null;
  /** Dynamic input: a length typed and locked with Tab, waiting for its angle. */
  dynLength: number | null = null;

  private windowStart: Vec | null = null;
  private press: { screen: Vec; button: number; pan: boolean; onEmpty: boolean } | null = null;
  private stateListeners = new Set<() => void>();
  private pointerListeners = new Set<() => void>();
  private snapshot: Snapshot;
  private detach: (() => void) | null = null;

  constructor(data: DrawingData, settings: Partial<Settings> = {}) {
    this.doc = new DraftDocument(data);
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    if (data.view) this.view = { ...data.view };
    this.snapshot = this.build();
    this.attach(this.doc);
  }

  /** The drawing itself (in the block editor, `doc` is the block being edited). */
  get drawing() {
    return this.blockEdit?.main ?? this.doc;
  }

  private attach(doc: DraftDocument) {
    this.detach?.();
    this.doc = doc;
    doc.activate();
    this.detach = doc.subscribe(() => {
      // Objects that went away (undo, erase) leave the selection.
      for (const id of this.selection) if (!this.doc.entities.has(id)) this.selection.delete(id);
      this.emit();
    });
  }

  // --- subscriptions --------------------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;

  /** Pointer moves (for the overlay and the coordinates readout), without rebuilding UI state. */
  onPointer(listener: () => void) {
    this.pointerListeners.add(listener);
    return () => {
      this.pointerListeners.delete(listener);
    };
  }

  private build(): Snapshot {
    const prompt = this.currentPrompt();
    return {
      version: this.doc.version,
      command: this.hotGrip ? "STRETCH" : (this.command?.name ?? null),
      prompt: this.formatPrompt(prompt),
      keywords: prompt?.keywords ?? [],
      buffer: this.buffer,
      history: this.history.slice(-200),
      suggestions: this.command || this.hotGrip ? [] : suggestCommands(this.buffer).slice(0, 8),
      settings: this.settings,
      selection: [...this.selection],
      canUndo: this.doc.canUndo,
      canRedo: this.doc.canRedo,
      currentLayer: this.doc.currentLayer,
      current: this.current,
      textEdit: this.textEdit,
      dialog: this.dialog,
      blockEdit: this.blockEdit?.name ?? null,
    };
  }

  emit() {
    this.snapshot = this.build();
    for (const l of this.stateListeners) l();
    this.pointerChanged();
  }

  private pointerChanged() {
    for (const l of this.pointerListeners) l();
  }

  // --- view ------------------------------------------------------------------------------

  setSize(w: number, h: number) {
    this.size = { w, h };
    this.pointerChanged();
  }

  toWorld(s: Vec): Vec {
    return { x: this.view.cx + (s.x - this.size.w / 2) / this.view.scale, y: this.view.cy - (s.y - this.size.h / 2) / this.view.scale };
  }

  toScreen(p: Vec): Vec {
    return { x: (p.x - this.view.cx) * this.view.scale + this.size.w / 2, y: this.size.h / 2 - (p.y - this.view.cy) * this.view.scale };
  }

  /** A distance in drawing units that looks `pixels` long. */
  px(pixels: number) {
    return pixels / this.view.scale;
  }

  zoomAt(screen: Vec, factor: number) {
    const before = this.toWorld(screen);
    this.view.scale = Math.min(Math.max(this.view.scale * factor, 1e-6), 1e6);
    const after = this.toWorld(screen);
    this.view.cx += before.x - after.x;
    this.view.cy += before.y - after.y;
    this.refreshPointer();
  }

  panBy(dx: number, dy: number) {
    this.view.cx -= dx / this.view.scale;
    this.view.cy += dy / this.view.scale;
    this.refreshPointer();
  }

  private fit(box: Box) {
    const w = Math.max(box.maxX - box.minX, 1e-6);
    const h = Math.max(box.maxY - box.minY, 1e-6);
    this.view.scale = Math.min(this.size.w / w, this.size.h / h) * 0.9;
    this.view.cx = (box.minX + box.maxX) / 2;
    this.view.cy = (box.minY + box.maxY) / 2;
    this.refreshPointer();
  }

  zoomExtents() {
    const box = this.doc.extents();
    if (!Number.isFinite(box.minX)) return this.home();
    if (box.maxX - box.minX < 1e-9 && box.maxY - box.minY < 1e-9) {
      this.view.cx = box.minX;
      this.view.cy = box.minY;
      return this.refreshPointer();
    }
    this.fit(box);
  }

  zoomWindow(a: Vec, b: Vec) {
    this.fit({ minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) });
  }

  /** An empty drawing's starting view: 40 ft or 12 m across, the origin near the lower left. */
  home() {
    const across = this.doc.units === "mm" ? 12000 : 480;
    this.view.scale = this.size.w / across;
    this.view.cx = across * 0.4;
    this.view.cy = (this.size.h / this.view.scale) * 0.4;
    this.refreshPointer();
  }

  // --- the cursor ------------------------------------------------------------------------

  private currentPrompt(): Prompt | null {
    if (this.hotGrip) return { text: "** STRETCH **\nSpecify stretch point", keywords: [{ key: "X", label: "eXit" }], base: this.hotGrip.grip.point };
    return this.command ? this.command.prompt() : null;
  }

  /** Whether a click now gives a point (rather than picking objects). */
  get wantsPoint() {
    if (this.hotGrip) return true;
    if (!this.command || this.command.pans) return false;
    const prompt = this.command.prompt();
    return !prompt.selecting && !prompt.picking;
  }

  get base(): Vec | null {
    return this.currentPrompt()?.base ?? null;
  }

  /** Works out the point a click would give, and what's under the cursor. */
  private resolve() {
    const raw = this.cursor;
    const base = this.base;
    let point = raw;
    let snap: Snap | null = null;
    let tracking: Editor["tracking"] = null;
    this.hover = null;
    this.hoverGrip = null;

    if (this.wantsPoint) {
      if (this.settings.osnap && this.settings.snapKinds.length) {
        const r = this.px(APERTURE);
        const editing = new Set(this.hotGrip?.ids ?? []);
        const near = this.doc
          .query({ minX: raw.x - r, minY: raw.y - r, maxX: raw.x + r, maxY: raw.y + r })
          .filter((e) => this.doc.isVisible(e) && !editing.has(e.id));
        snap = findSnap(near, raw, r, new Set(this.settings.snapKinds), base);
      }
      if (snap) point = snap.point;
      else if (base && this.settings.ortho) {
        point = Math.abs(raw.x - base.x) >= Math.abs(raw.y - base.y) ? { x: raw.x, y: base.y } : { x: base.x, y: raw.y };
      } else if (base && this.settings.polar && dist(base, raw) > this.px(TRACK)) {
        const step = (this.settings.polarAngle * Math.PI) / 180;
        const angle = Math.round(angleOf(base, raw) / step) * step;
        const dir = { x: Math.cos(angle), y: Math.sin(angle) };
        const along = dot(sub(raw, base), dir);
        const off = Math.abs(sub(raw, base).x * dir.y - sub(raw, base).y * dir.x);
        if (along > 0 && off <= this.px(TRACK)) {
          point = polar(base, angle, along);
          tracking = { from: base, angle };
        }
      }
      if (!snap && !tracking && this.settings.snap) {
        const unit = this.doc.units === "mm" ? 10 : 1;
        point = { x: Math.round(point.x / unit) * unit, y: Math.round(point.y / unit) * unit };
      }
    } else if (!this.command?.pans) {
      if (!this.command && this.selection.size) this.hoverGrip = this.gripAt(raw);
      if (!this.hoverGrip) this.hover = this.pick(raw)?.id ?? null;
    }
    this.point = point;
    this.snap = snap;
    this.tracking = tracking;
  }

  private refreshPointer() {
    if (this.cursorScreen) {
      this.cursor = this.toWorld(this.cursorScreen);
      this.resolve();
    }
    this.pointerChanged();
  }

  /** The editable object under a point (within the pickbox), nearest first. */
  pick(p: Vec): Entity | null {
    const r = this.px(PICKBOX);
    let best: Entity | null = null;
    let bestD = r;
    for (const e of this.doc.query({ minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r })) {
      if (!this.doc.isEditable(e)) continue;
      const d = distanceTo(e, p);
      if (d <= bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  private gripAt(p: Vec): Grip | null {
    const r = this.px(PICKBOX + 1);
    for (const id of this.selection) {
      const e = this.doc.entities.get(id);
      if (!e || !this.doc.isEditable(e)) continue;
      for (const g of grips(e)) if (Math.abs(g.point.x - p.x) <= r && Math.abs(g.point.y - p.y) <= r) return g;
    }
    return null;
  }

  // --- pointer input -----------------------------------------------------------------------

  pointerMove(screen: Vec) {
    this.cursorScreen = screen;
    const press = this.press;
    if (press?.pan) {
      this.panBy(screen.x - press.screen.x, screen.y - press.screen.y);
      press.screen = screen;
      return;
    }
    this.cursor = this.toWorld(screen);
    this.resolve();
    if (press && press.button === 0 && press.onEmpty && !this.windowStart && dist(press.screen, screen) > DRAG) {
      // Pressing on empty space and dragging opens a selection window.
      this.windowStart = this.toWorld(press.screen);
    }
    if (this.windowStart) this.window = this.windowFrom(this.windowStart, this.cursor);
    this.pointerChanged();
  }

  pointerLeave() {
    this.cursorScreen = null;
    this.hover = null;
    this.pointerChanged();
  }

  pointerDown(screen: Vec, button: number) {
    const pan = button === 1 || (button === 0 && !!this.command?.pans);
    this.press = { screen, button, pan, onEmpty: button === 0 && !pan && !this.wantsPoint && !this.pick(this.toWorld(screen)) && !this.gripAt(this.toWorld(screen)) };
  }

  pointerUp(screen: Vec, button: number, shift = false) {
    const press = this.press;
    this.press = null;
    if (!press || press.pan || button !== 0) return;
    const dragged = dist(press.screen, screen) > DRAG;
    this.cursor = this.toWorld(screen);
    this.resolve();

    if (this.wantsPoint) {
      if (!dragged) this.givePoint(this.point);
      return;
    }
    if (this.command?.prompt().picking) {
      if (!dragged) {
        this.command.pick?.(this.pick(this.cursor), this.cursor, shift);
        this.afterInput();
      }
      return;
    }
    if (this.windowStart) {
      if (dragged || dist(this.toScreen(this.windowStart), screen) > DRAG) this.finishWindow(this.cursor, shift);
      return;
    }
    if (!this.command) {
      const grip = this.gripAt(this.cursor);
      if (grip) return this.heatGrip(grip);
    }
    const hit = this.pick(this.cursor);
    if (hit) {
      if (shift) this.selection.delete(hit.id);
      else this.selection.add(hit.id);
      this.emit();
    } else if (!shift || this.command) {
      this.windowStart = this.cursor; // click-click window
      this.window = this.windowFrom(this.cursor, this.cursor);
      this.pointerChanged();
    }
  }

  /** Middle-button double-click: zoom extents. */
  middleDoubleClick() {
    this.zoomExtents();
  }

  wheel(screen: Vec, deltaY: number) {
    this.zoomAt(screen, Math.pow(1.0015, -deltaY));
  }

  private windowFrom(from: Vec, to: Vec): Window {
    return { from, to, crossing: to.x < from.x };
  }

  private finishWindow(to: Vec, shift: boolean) {
    const w = this.windowFrom(this.windowStart!, to);
    this.windowStart = null;
    this.window = null;
    const box = { minX: Math.min(w.from.x, w.to.x), minY: Math.min(w.from.y, w.to.y), maxX: Math.max(w.from.x, w.to.x), maxY: Math.max(w.from.y, w.to.y) };
    if (!this.selection.size) this.windows = [];
    this.windows.push(box);
    for (const e of this.doc.query(box)) {
      if (!this.doc.isEditable(e)) continue;
      if (w.crossing ? crossesBox(e, box) : insideBox(e, box)) {
        if (shift) this.selection.delete(e.id);
        else this.selection.add(e.id);
      }
    }
    this.emit();
  }

  // --- grips --------------------------------------------------------------------------

  private heatGrip(grip: Grip) {
    // Every selected object with a grip at the same spot moves with it.
    const ids = [...this.selection].filter((id) => {
      const e = this.doc.entities.get(id);
      return e && this.doc.isEditable(e) && grips(e).some((g) => same(g.point, grip.point));
    });
    this.hotGrip = { grip, ids };
    this.dynLength = null;
    this.emit();
  }

  private stretchTo(to: Vec): Entity[] {
    const hot = this.hotGrip!;
    return hot.ids.flatMap((id) => {
      const e = this.doc.entities.get(id);
      const g = e && grips(e).find((x) => same(x.point, hot.grip.point));
      return e && g ? [moveGrip(e, g, to)] : [];
    });
  }

  // --- the command line --------------------------------------------------------------

  private formatPrompt(prompt: Prompt | null) {
    if (!prompt) return "Type a command";
    if (!prompt.text) return "";
    const keywords = prompt.keywords?.length ? ` or [${prompt.keywords.map((k) => k.label).join("/")}]` : "";
    const enter = prompt.enterLabel ? ` <${prompt.enterLabel}>` : "";
    return `${prompt.text}${keywords}${enter}:`;
  }

  print(text: string, kind: HistoryLine["kind"] = "info") {
    this.history.push({ text, kind });
    if (this.history.length > 500) this.history.splice(0, this.history.length - 500);
    this.emit();
  }

  /** What a click or typed point does. */
  private givePoint(p: Vec) {
    this.dynLength = null;
    this.lastPoint = p;
    if (this.hotGrip) {
      const moved = this.stretchTo(p);
      this.doc.begin("GRIP_STRETCH");
      for (const e of moved) this.doc.update(e);
      this.doc.commit();
      this.hotGrip = null;
      this.emit();
      return;
    }
    this.command?.point?.(p);
    this.afterInput();
  }

  private afterInput() {
    this.resolve();
    this.emit();
  }

  runCommand(name: string) {
    const info = findCommand(name);
    if (!info) {
      this.print(`Unknown command "${name.toUpperCase()}". Press F1 for help.`, "error");
      return;
    }
    this.startCommand(info.create(this), !["U", "UNDO", "REDO"].includes(info.name));
  }

  /** Starts a command (made by runCommand, or directly, as double-click does for TEXTEDIT). */
  startCommand(command: Command, repeatable = true) {
    if (this.command) this.cancel(false);
    this.hotGrip = null;
    this.windowStart = null;
    this.window = null;
    this.buffer = "";
    this.print(`Command: ${command.name}`, "command");
    this.command = command;
    if (repeatable) this.lastCommand = command.name;
    command.start();
    this.afterInput();
  }

  // --- text typed in place ------------------------------------------------------------

  openTextEditor(req: TextEditRequest) {
    this.textEdit = req;
    this.emit();
  }

  /** Done typing: the text (or null, abandoned) goes back to the command that asked. */
  closeTextEditor(text: string | null) {
    const req = this.textEdit;
    this.textEdit = null;
    req?.done(text);
    this.afterInput();
  }

  // --- dialogs ---------------------------------------------------------------------------

  openDialog(req: DialogRequest) {
    this.dialog = req;
    this.emit();
  }

  /** The dialog's answer goes back to the command that asked (null: cancelled). */
  closeDialog<T>(result: T | null) {
    const req = this.dialog;
    this.dialog = null;
    (req?.done as ((r: T | null) => void) | undefined)?.(result);
    this.afterInput();
  }

  /** The Edit Attributes dialog for a reference (EATTEDIT). */
  editAttributes(e: InsertEntity) {
    const defs = attributeDefs(this.doc.blocks.get(e.block));
    if (!defs.length) return false;
    this.openDialog({
      kind: "attributes",
      block: e.block,
      rows: defs.map((d) => ({ tag: d.tag, prompt: d.prompt || d.tag, value: e.attribs[d.tag] ?? d.value })),
      done: (values) => {
        const current = this.doc.entities.get(e.id);
        if (values && current?.type === "insert") this.updateEntity({ ...current, attribs: { ...current.attribs, ...values } });
      },
    });
    return true;
  }

  // --- the block editor --------------------------------------------------------------------

  /** BEDIT: the block's objects open on their own, to be changed like any drawing. */
  editBlock(name: string) {
    const main = this.drawing;
    const block = main.blocks.get(name);
    if (!block || this.blockEdit) return false;
    if (this.command) this.cancel(false);
    const doc = new DraftDocument({ ...main.toData(), entities: block.entities });
    this.blockEdit = { name, main, view: { ...this.view }, saved: doc.version };
    this.selection.clear();
    this.attach(doc);
    this.zoomExtents();
    this.print(`Editing block "${name}". Close the block editor to go back to the drawing.`, "info");
    this.emit();
    return true;
  }

  /** Whether the block editor has changes to save. */
  get blockChanged() {
    return !!this.blockEdit && this.doc.version !== this.blockEdit.saved;
  }

  /** BSAVE: the block takes the objects in the block editor (its references redraw). */
  saveBlock() {
    const edit = this.blockEdit;
    if (!edit) return;
    const edited = this.doc;
    const main = edit.main;
    main.begin("BEDIT");
    // Layers and blocks made while editing come along.
    for (const layer of edited.layers.values()) if (!main.layers.has(layer.name)) main.setLayer(layer);
    for (const block of edited.blocks.values()) if (!main.blocks.has(block.name)) main.setBlock(block);
    main.setBlock({ ...main.blocks.get(edit.name)!, entities: [...edited.entities.values()] });
    main.commit();
    // The block editor shows the drawing's blocks as they now are.
    edited.blocks = new Map(main.blocks);
    edited.activate();
    edit.saved = edited.version;
    this.print(`Block "${edit.name}" saved.`, "info");
  }

  /** Leaves the block editor, saving the block's objects (or not). */
  closeBlockEditor(save: boolean) {
    const edit = this.blockEdit;
    if (!edit) return;
    if (this.command) this.cancel(false);
    if (save) this.saveBlock();
    this.blockEdit = null;
    this.selection.clear();
    this.attach(edit.main);
    this.view = edit.view;
    this.refreshPointer();
    this.emit();
  }

  /** BCLOSE: asks whether to keep the changes, as AutoCAD does. */
  requestCloseBlockEditor() {
    const edit = this.blockEdit;
    if (!edit) return;
    if (!this.blockChanged) return this.closeBlockEditor(false);
    this.openDialog({ kind: "save-block", name: edit.name, done: (choice) => choice && this.closeBlockEditor(choice === "save") });
  }

  /** Double-click: edit text in place, a block's attributes or the block itself, or open
   * Properties for anything else (as AutoCAD). */
  doubleClick(screen: Vec) {
    if (this.command || this.hotGrip || this.textEdit || this.dialog) return;
    const e = this.pick(this.toWorld(screen));
    if (!e) return;
    if (e.type === "text" || e.type === "mtext" || e.type === "dimension" || e.type === "leader") {
      this.selection.clear();
      this.startCommand(new TextEditCommand(this, e), false);
      return;
    }
    if (e.type === "insert") {
      if (!this.editAttributes(e)) this.editBlock(e.block);
      return;
    }
    this.selection = new Set([e.id]);
    this.ui.openPalette("properties");
    this.emit();
  }

  /** The running command is done: its changes become one undo step. */
  finish() {
    const command = this.command;
    this.command = null;
    this.doc.commit();
    if (command && "clearsSelection" in command) {
      this.selection.clear();
      this.windows = [];
    }
    this.dynLength = null;
    this.afterInput();
  }

  cancel(echo = true) {
    if (this.textEdit) return this.closeTextEditor(null);
    if (this.dialog) return this.closeDialog(null);
    if (this.hotGrip) {
      this.hotGrip = null;
    } else if (this.command) {
      if (echo) this.print("*Cancel*", "info");
      this.command.cancel();
      if (this.command) this.finish();
    } else if (this.windowStart) {
      this.windowStart = null;
      this.window = null;
    } else this.selection.clear();
    this.buffer = "";
    this.dynLength = null;
    this.afterInput();
  }

  /** Enter or Space. */
  submit() {
    const text = this.buffer.trim();
    this.buffer = "";
    this.recall = -1;
    if (text) {
      this.inputs.push(text);
      if (this.inputs.length > 100) this.inputs.shift();
    }
    if (!this.command && !this.hotGrip) {
      if (text) this.runCommand(text);
      else if (this.lastCommand) this.runCommand(this.lastCommand);
      else this.emit();
      return;
    }
    const prompt = this.currentPrompt()!;
    if (!text) {
      if (this.dynLength !== null && prompt.base) return this.givePoint(polar(prompt.base, angleOf(prompt.base, this.point), this.dynLength));
      if (this.hotGrip) return this.cancel(false);
      this.command!.enter();
      return this.afterInput();
    }
    this.history.push({ text: `${this.formatPrompt(prompt)} ${text}`, kind: "input" });
    const upper = text.toUpperCase();
    const keyword = prompt.keywords?.find((k) => k.key === upper || k.label.toUpperCase() === upper);
    if (keyword) {
      if (this.hotGrip) return this.cancel(false);
      this.command!.keyword?.(keyword.key);
      return this.afterInput();
    }
    if (prompt.selecting) {
      if (upper === "ALL") {
        this.selectAll();
        return;
      }
      return this.print("*Invalid selection*", "error");
    }
    if (this.dynLength !== null && prompt.base) {
      const angle = parseAngle(text);
      if (angle === null) return this.print("Requires a valid angle.", "error");
      return this.givePoint(polar(prompt.base, angle, this.dynLength));
    }
    if (text === "@" && (prompt.base ?? this.lastPoint)) return this.givePoint((prompt.base ?? this.lastPoint)!);
    if (this.command?.value?.(text)) return this.afterInput();
    const input = parsePointInput(text, this.doc.units, prompt.base ?? null, this.settings.dynamic);
    if (input?.kind === "point") return this.givePoint(input.point);
    if (input?.kind === "distance" && prompt.base) {
      // Direct distance entry: along the cursor's (tracked or snapped) direction.
      const angle = dist(prompt.base, this.point) > 1e-12 ? angleOf(prompt.base, this.point) : 0;
      return this.givePoint(polar(prompt.base, angle, input.distance));
    }
    this.print("Point or option keyword required.", "error");
  }

  // --- the keyboard -------------------------------------------------------------------

  /** A key pressed over the drawing; returns whether the editor used it. */
  key(e: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }): boolean {
    const k = e.key;
    if (e.ctrl) {
      const lower = k.toLowerCase();
      if (lower === "z") return e.shift ? (this.redo(), true) : (this.undo(), true);
      if (lower === "y") return this.redo(), true;
      if (lower === "a") return this.selectAll(), true;
      if (k === "1") return this.ui.openPalette("properties"), true;
      return false;
    }
    const toggles: Record<string, keyof Settings> = { F3: "osnap", F7: "grid", F8: "ortho", F9: "snap", F10: "polar", F12: "dynamic" };
    if (toggles[k]) return this.toggle(toggles[k] as "osnap"), true;
    switch (k) {
      case "Escape":
        this.cancel();
        return true;
      case "Enter":
        this.submit();
        return true;
      case " ":
        if (this.currentPrompt()?.spaces) {
          this.buffer += " ";
          this.emit();
        } else this.submit();
        return true;
      case "Backspace":
        this.buffer = this.buffer.slice(0, -1);
        this.emit();
        return true;
      case "Tab":
        return this.lockLength();
      case "Delete":
        if (!this.command && this.selection.size) this.runCommand("ERASE");
        return true;
      case "ArrowUp":
      case "ArrowDown": {
        if (!this.inputs.length) return true;
        this.recall = k === "ArrowUp" ? Math.min(this.recall + 1, this.inputs.length - 1) : Math.max(this.recall - 1, -1);
        this.buffer = this.recall < 0 ? "" : this.inputs[this.inputs.length - 1 - this.recall];
        this.emit();
        return true;
      }
    }
    if (k.length === 1 && !e.alt) {
      this.buffer += k;
      this.emit();
      return true;
    }
    return false;
  }

  /** Tab in dynamic input: the typed length is kept, and the angle comes next. */
  private lockLength() {
    if (!this.wantsPoint || !this.base) return false;
    const d = parseLength(this.buffer, this.doc.units);
    if (d === null) return true;
    this.dynLength = d;
    this.buffer = "";
    this.emit();
    return true;
  }

  toggle(setting: "grid" | "snap" | "ortho" | "polar" | "osnap" | "dynamic") {
    const on = !this.settings[setting];
    // Ortho and polar tracking exclude each other, as in AutoCAD.
    const exclusive = setting === "ortho" && on ? { polar: false } : setting === "polar" && on ? { ortho: false } : {};
    this.settings = { ...this.settings, [setting]: on, ...exclusive };
    const names = { grid: "Grid", snap: "Snap", ortho: "Ortho", polar: "Polar", osnap: "Osnap", dynamic: "Dynamic input" };
    this.print(`<${names[setting]} ${on ? "on" : "off"}>`, "info");
    this.afterInput();
  }

  setSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    this.afterInput();
  }

  // --- selection and edits ---------------------------------------------------------------

  selectAll() {
    for (const e of this.doc.entities.values()) if (this.doc.isEditable(e)) this.selection.add(e.id);
    this.emit();
  }

  clearSelection() {
    this.selection.clear();
    this.windows = [];
    this.emit();
  }

  selected(): Entity[] {
    return [...this.selection].map((id) => this.doc.entities.get(id)!).filter(Boolean);
  }

  undo() {
    if (this.command) this.cancel(false);
    const label = this.doc.undo();
    this.print(label ? `Undo: ${label}` : "Everything has been undone", "info");
  }

  redo() {
    const label = this.doc.redo();
    this.print(label ? `Redo: ${label}` : "Nothing to redo", "info");
  }

  /** Changes the selection's properties, or (with nothing selected) what new objects get. */
  setProperty(patch: Partial<Pick<Entity, "layer" | "color" | "lineweight">>) {
    const targets = this.selected().filter((e) => this.doc.isEditable(e));
    if (!targets.length) {
      if (patch.layer) this.doc.setCurrentLayer(patch.layer);
      this.current = { color: patch.color !== undefined ? patch.color : this.current.color, lineweight: patch.lineweight ?? this.current.lineweight };
      this.emit();
      return;
    }
    this.doc.begin("PROPERTIES");
    for (const e of targets) this.doc.update({ ...e, ...patch } as Entity);
    this.doc.commit();
  }

  updateEntity(e: Entity) {
    this.doc.begin("PROPERTIES");
    this.doc.update(e);
    this.doc.commit();
  }

  // --- for commands ----------------------------------------------------------------------

  newId = newId;

  defaults() {
    return { layer: this.doc.currentLayer, color: this.current.color, lineweight: this.current.lineweight, linetype: "ByLayer" };
  }

  make<T extends Entity>(geometry: Omit<T, "id" | "layer" | "color" | "lineweight" | "linetype">): T {
    return { id: newId(), ...this.defaults(), ...geometry } as T;
  }

  /** What the overlay draws as rubber band: the command's preview, or the stretched grip's objects. */
  preview(): Entity[] {
    if (this.hotGrip) return this.stretchTo(this.point);
    if (!this.command || !this.wantsPoint) return [];
    return this.command.preview?.(this.point) ?? [];
  }

  /** A typed length as the dynamic input shows it. */
  formatLength(d: number) {
    return formatLength(d, this.doc.units);
  }
}

export { COMMANDS };
