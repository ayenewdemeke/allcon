import { capRatio, textWidth } from "./graphics";
import { LINEWEIGHTS, type ColorValue, type Entity, type TextStyle, type Units, type Vec } from "./types";

/** An object before it has an id. */
export type NewEntity = Entity extends infer E ? (E extends Entity ? Omit<E, "id"> : never) : never;

// PDFIMPORT: a PDF page's vector content turned into drawing objects, as AutoCAD's Import PDF
// does. Paths become lines, arcs, circles and polylines (Bezier curves that are circular arcs
// within a tolerance become arcs, the rest are flattened); solid fills become SOLID hatches; text
// becomes single-line text in a PDF_ text style; pictures are placed for the caller to store.
//
// Many CAD programs (MicroStation, AutoCAD with SHX fonts) draw their text as strokes and lay
// an invisible copy of it on top so the PDF can be searched. When that invisible text is there
// it's imported as text and the strokes under it are dropped (AutoCAD's PDFSHXTEXT does the
// same by recognizing the strokes), so notes come in as text you can edit.
//
// The converter reads pdf.js's operator list (operators by name), so it runs without a browser.

export type PdfOp = { fn: string; args: unknown[] | null };

export type PdfImportOptions = {
  geometry: boolean;
  fills: boolean;
  text: boolean;
  images: boolean;
  /** "pdf": a layer per PDF layer (object layers if it has none); "object": PDF_Geometry and so on; "current": the current layer. */
  layers: "pdf" | "object" | "current";
  join: boolean;
  lineweights: boolean;
  /** Import the invisible text CAD programs lay over stroked text, and drop the strokes. */
  recognizeText: boolean;
};

/** The Import PDF dialog's answers: the page, what to import and how, and where it goes. */
export type PdfImportSettings = PdfImportOptions & { page: number; onScreen: boolean; scale: number; rotation: number };

/** A page read and converted, its pictures stored: ready to place. */
export type PdfImportReady = { name: string; result: PdfImportResult; pictures: { placement: PdfImagePlacement; key: string; name: string }[]; settings: PdfImportSettings };

export const DEFAULT_PDF_IMPORT: PdfImportOptions ={ geometry: true, fills: true, text: true, images: true, layers: "pdf", join: true, lineweights: true, recognizeText: true };

export type PdfPageInput = {
  ops: PdfOp[];
  /** The page box in PDF points: [x0, y0, x1, y1]. */
  view: number[];
  /** Optional content group (PDF layer) names by id. */
  layerNames?: Record<string, string>;
  /** Font names by pdf.js font id, for text style names. */
  fontNames?: Record<string, string>;
};

/** A picture the caller stores: the operator that paints it, and where it goes (drawing units). */
export type PdfImagePlacement = { opIndex: number; at: Vec; width: number; height: number; rotation: number; layer: string };

export type PdfImportResult = {
  /** Objects without ids, in drawing units with the page's lower left corner at 0,0. */
  entities: NewEntity[];
  images: PdfImagePlacement[];
  layers: { name: string; color: number | string }[];
  textStyles: TextStyle[];
  /** The page's size in drawing units. */
  size: { width: number; height: number };
  counts: { geometry: number; fills: number; text: number; images: number; recognized: number };
};

// --- matrices, as PDF writes them: [a b c d e f], points as row vectors -------------------------

type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];
const mul = (m1: M, m2: M): M => [
  m1[0] * m2[0] + m1[1] * m2[2],
  m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2],
  m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
  m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
];
const apply = (m: M, x: number, y: number): Vec => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const linear = (m: M, x: number, y: number): Vec => ({ x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y });
const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const toM = (v: unknown): M => {
  const a = v as ArrayLike<number> & Record<string, number>;
  return [0, 1, 2, 3, 4, 5].map((i) => Number(a[i] ?? 0)) as M;
};

const len = (v: Vec) => Math.hypot(v.x, v.y);
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;

// --- graphics state -------------------------------------------------------------------------------

type TextState = { font: string; size: number; charSpacing: number; wordSpacing: number; hScale: number; leading: number; rise: number; mode: number };
/** A clipping region: loops, filled even-odd, with their bounding box. */
type Clip = { loops: Vec[][]; box: [number, number, number, number] };
type State = { ctm: M; lineWidth: number; dash: number[]; dashPhase: number; stroke: string; fill: string; text: TextState; clips: Clip[] };
const initialState = (): State => ({
  clips: [],
  ctm: IDENTITY,
  lineWidth: 1,
  dash: [],
  dashPhase: 0,
  stroke: "#000000",
  fill: "#000000",
  text: { font: "", size: 1, charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0, rise: 0, mode: 0 },
});
const copyState = (s: State): State => ({ ...s, dash: [...s.dash], text: { ...s.text }, clips: [...s.clips] });

function insideLoops(p: Vec, loops: Vec[][]) {
  let inside = false;
  for (const loop of loops)
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i];
      const b = loop[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  return inside;
}

/** Whether a path shows through the clipping: some of its points (corners and midpoints) inside every region. */
function visible(points: Vec[], clips: Clip[]) {
  if (!clips.length) return true;
  const probes: Vec[] = [...points];
  for (let i = 0; i + 1 < points.length; i++) probes.push({ x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 });
  const pad = 0.5; // points: things drawn right on a clipping edge stay
  return clips.every((c) =>
    probes.some((p) => p.x >= c.box[0] - pad && p.x <= c.box[2] + pad && p.y >= c.box[1] - pad && p.y <= c.box[3] + pad && (insideLoops(p, c.loops) || nearEdge(p, c.loops, pad))),
  );
}

function nearEdge(p: Vec, loops: Vec[][], tol: number) {
  for (const loop of loops)
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[j];
      const d = sub(loop[i], a);
      const l2 = d.x * d.x + d.y * d.y;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l2)) : 0;
      if (len(sub(p, { x: a.x + d.x * t, y: a.y + d.y * t })) <= tol) return true;
    }
  return false;
}

/** A run of path, in page points: points with bulges (DXF's, for arc segments). */
type Chain = { points: Vec[]; bulges: number[]; closed: boolean; layer: string; color: string; lineweight: number; dashed: boolean };

type Run = { text: string; font: string; origin: Vec; angle: number; em: number; advance: number; layer: string; color: string; hidden: boolean; glyphTop: number; glyphRight: number; glyphColor: Map<string, number>; glyphLayer: Map<string, number> };

const LAYER_GEOMETRY = "PDF_Geometry";
const LAYER_FILLS = "PDF_Solid Fills";
const LAYER_IMAGES = "PDF_Images";
const LAYER_TEXT = "PDF_Text";

const cleanName = (s: string) => s.replace(/[<>/\\":;?*|,=`]/g, "_").trim() || "PDF";

// --- curves ---------------------------------------------------------------------------------------

const bez = (p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
};

function circleThrough(a: Vec, b: Vec, c: Vec): { center: Vec; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const center = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
  return { center, r: len(sub(a, center)) };
}

/** A cubic Bezier as one arc segment's bulge, if it's circular within `tol`; null if not. */
export function bezierBulge(p0: Vec, p1: Vec, p2: Vec, p3: Vec, tol: number): number | null {
  const chord = sub(p3, p0);
  const c = len(chord);
  if (c < 1e-9) return null;
  const m = bez(p0, p1, p2, p3, 0.5);
  const circle = circleThrough(p0, m, p3);
  if (!circle) return null;
  for (const t of [0.125, 0.25, 0.375, 0.625, 0.75, 0.875]) if (Math.abs(len(sub(bez(p0, p1, p2, p3, t), circle.center)) - circle.r) > tol) return null;
  // The sagitta from the midpoint: positive bulges are counter-clockwise, to the right of the chord.
  const bulge = (-2 * cross(chord, sub(m, p0))) / (c * c);
  return Math.abs(bulge) > 1e-6 ? bulge : 0;
}

function flatten(p0: Vec, p1: Vec, p2: Vec, p3: Vec, tol: number): Vec[] {
  const size = len(sub(p1, p0)) + len(sub(p2, p1)) + len(sub(p3, p2));
  const n = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(size / Math.max(tol, 1e-6)))));
  const out: Vec[] = [];
  for (let i = 1; i <= n; i++) out.push(bez(p0, p1, p2, p3, i / n));
  return out;
}

/** A path's subpaths (page points) from pdf.js's path data. */
function subpaths(data: ArrayLike<number>, ctm: M, tol: number): { points: Vec[]; bulges: number[]; closed: boolean }[] {
  const out: { points: Vec[]; bulges: number[]; closed: boolean }[] = [];
  let cur: { points: Vec[]; bulges: number[]; closed: boolean } | null = null;
  let last: Vec = { x: 0, y: 0 };
  let start: Vec = last;
  const lineTo = (p: Vec) => {
    if (!cur) {
      cur = { points: [last], bulges: [], closed: false };
      out.push(cur);
    }
    cur.bulges.push(0);
    cur.points.push(p);
    last = p;
  };
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === 0) {
      last = start = apply(ctm, data[i], data[i + 1]);
      i += 2;
      cur = null;
    } else if (op === 1) {
      lineTo(apply(ctm, data[i], data[i + 1]));
      i += 2;
    } else if (op === 2 || op === 3) {
      const p0 = last;
      let p1: Vec, p2: Vec, p3: Vec;
      if (op === 2) {
        p1 = apply(ctm, data[i], data[i + 1]);
        p2 = apply(ctm, data[i + 2], data[i + 3]);
        p3 = apply(ctm, data[i + 4], data[i + 5]);
        i += 6;
      } else {
        const q = apply(ctm, data[i], data[i + 1]);
        p3 = apply(ctm, data[i + 2], data[i + 3]);
        p1 = { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) };
        p2 = { x: p3.x + (2 / 3) * (q.x - p3.x), y: p3.y + (2 / 3) * (q.y - p3.y) };
        i += 4;
      }
      const bulge = bezierBulge(p0, p1, p2, p3, tol);
      if (bulge !== null) {
        lineTo(p3);
        cur!.bulges[cur!.bulges.length - 1] = bulge;
      } else for (const p of flatten(p0, p1, p2, p3, tol)) lineTo(p);
    } else if (op === 4) {
      if (cur) {
        const c: { points: Vec[]; bulges: number[]; closed: boolean } = cur;
        const end = c.points[c.points.length - 1];
        if (len(sub(end, start)) < 1e-6 && c.points.length > 2) {
          c.points.pop();
        } else c.bulges.push(0);
        c.closed = true;
        while (c.bulges.length < c.points.length) c.bulges.push(0);
      }
      cur = null;
      last = start;
    } else break; // unknown: stop reading this path
  }
  return out.filter((s) => s.points.length > 1).map((s) => ({ ...s, bulges: s.closed ? s.bulges : [...s.bulges, 0] }));
}

/** A chain's outline as points (arc segments flattened), for fills and dashes. */
function outline(points: Vec[], bulges: number[], closed: boolean): Vec[] {
  const out: Vec[] = [points[0]];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const bulge = bulges[i] ?? 0;
    if (Math.abs(bulge) > 1e-9) {
      const sweep = 4 * Math.atan(bulge);
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 16)));
      const chord = len(sub(b, a));
      const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dir = { x: (b.x - a.x) / chord, y: (b.y - a.y) / chord };
      const h = Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0)) * (Math.abs(sweep) > Math.PI ? -1 : 1);
      const left = { x: -dir.y, y: dir.x };
      const sign = bulge > 0 ? 1 : -1;
      const center = { x: mid.x + left.x * h * sign, y: mid.y + left.y * h * sign };
      const a0 = Math.atan2(a.y - center.y, a.x - center.x);
      for (let k = 1; k <= steps; k++) {
        const t = a0 + (sweep * k) / steps;
        out.push({ x: center.x + r * Math.cos(t), y: center.y + r * Math.sin(t) });
      }
    } else out.push(b);
  }
  if (closed) out.pop();
  return out;
}

/** Splits a polyline into its dashes (PDF dash arrays are on, off, on, off...). */
function dashes(pts: Vec[], pattern: number[], phase: number): [Vec, Vec][] {
  const pat = pattern.length % 2 ? [...pattern, ...pattern] : pattern;
  const total = pat.reduce((s, x) => s + x, 0);
  if (total <= 1e-9) return [];
  let idx = 0;
  let left = pat[0];
  let on = true;
  let skip = ((phase % total) + total) % total;
  while (skip > 0) {
    const step = Math.min(skip, left);
    skip -= step;
    left -= step;
    if (left <= 1e-12) {
      idx = (idx + 1) % pat.length;
      left = pat[idx];
      on = !on;
    }
  }
  const out: [Vec, Vec][] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const d = sub(pts[i + 1], a);
    const segLen = len(d);
    let pos = 0;
    while (pos < segLen - 1e-9) {
      const step = Math.min(left, segLen - pos);
      if (on && step > 1e-9) {
        const p = { x: a.x + (d.x * pos) / segLen, y: a.y + (d.y * pos) / segLen };
        const q = { x: a.x + (d.x * (pos + step)) / segLen, y: a.y + (d.y * (pos + step)) / segLen };
        const prev = out[out.length - 1];
        if (prev && len(sub(prev[1], p)) < 1e-9) prev[1] = q;
        else out.push([p, q]);
      }
      pos += step;
      left -= step;
      if (left <= 1e-9) {
        idx = (idx + 1) % pat.length;
        left = pat[idx];
        on = !on;
      }
    }
  }
  return out;
}

const nearestLineweight = (mm: number) => {
  const hundredths = mm * 100;
  return LINEWEIGHTS.reduce((best, w) => (Math.abs(w - hundredths) < Math.abs(best - hundredths) ? w : best), 0);
};

// --- joining ------------------------------------------------------------------------------------

function joinChains(chains: Chain[], tol: number): Chain[] {
  const key = (p: Vec) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const props = (c: Chain) => `${c.layer}|${c.color}|${c.lineweight}`;
  const open = chains.filter((c) => !c.closed && !c.dashed);
  const done = chains.filter((c) => c.closed || c.dashed);
  const ends = new Map<string, Set<Chain>>();
  const index = (c: Chain) => {
    for (const p of [c.points[0], c.points[c.points.length - 1]]) {
      const k = `${props(c)}@${key(p)}`;
      let set = ends.get(k);
      if (!set) ends.set(k, (set = new Set()));
      set.add(c);
    }
  };
  const unindex = (c: Chain) => {
    for (const p of [c.points[0], c.points[c.points.length - 1]]) ends.get(`${props(c)}@${key(p)}`)?.delete(c);
  };
  const reverse = (c: Chain) => {
    const n = c.points.length;
    c.points.reverse();
    const b = c.bulges.slice(0, n - 1).reverse().map((x) => -x);
    c.bulges = [...b, 0];
  };
  const alive = new Set(open);
  for (const c of open) index(c);
  for (const c of open) {
    if (!alive.has(c)) continue;
    unindex(c);
    for (const atEnd of [true, false]) {
      for (;;) {
        const p = atEnd ? c.points[c.points.length - 1] : c.points[0];
        const set = ends.get(`${props(c)}@${key(p)}`);
        const other = set && [...set].find((o) => o !== c && alive.has(o));
        if (!other) break;
        unindex(other);
        alive.delete(other);
        const otherStart = len(sub(other.points[0], p)) <= len(sub(other.points[other.points.length - 1], p));
        if (atEnd) {
          if (!otherStart) reverse(other);
          c.bulges = [...c.bulges.slice(0, c.points.length - 1), ...other.bulges];
          c.points = [...c.points, ...other.points.slice(1)];
        } else {
          if (otherStart) reverse(other);
          c.bulges = [...other.bulges.slice(0, other.points.length - 1), ...c.bulges];
          c.points = [...other.points, ...c.points.slice(1)];
        }
      }
    }
    // Closed on itself: a closed polyline.
    if (c.points.length > 3 && len(sub(c.points[0], c.points[c.points.length - 1])) < tol) {
      c.points.pop();
      c.bulges = c.bulges.slice(0, c.points.length);
      c.closed = true;
    }
    index(c);
  }
  return [...done, ...open.filter((c) => alive.has(c))];
}

// --- the converter --------------------------------------------------------------------------------

export function convertPdfPage(input: PdfPageInput, options: PdfImportOptions, units: Units, currentLayer: string): PdfImportResult {
  const [x0, y0, x1, y1] = input.view;
  const k = (units === "mm" ? 25.4 : 1) / 72; // points to drawing units
  const P = (p: Vec): Vec => ({ x: (p.x - x0) * k, y: (p.y - y0) * k });
  const tol = 0.05; // points: about 0.02 mm, for arcs and joins

  const hasPdfLayers = options.layers === "pdf" && Object.keys(input.layerNames ?? {}).length > 0;
  const layers = new Map<string, number | string>();
  const layerFor = (kind: string, oc: string | null) => {
    if (options.layers === "current") return currentLayer;
    let name = kind;
    if (hasPdfLayers && oc && input.layerNames?.[oc]) name = `PDF_${cleanName(input.layerNames[oc])}`;
    if (!layers.has(name)) layers.set(name, 7);
    return name;
  };

  const chains: Chain[] = [];
  const fills: { loops: Vec[][]; layer: string; color: string }[] = [];
  const runs: Run[] = [];
  const images: PdfImagePlacement[] = [];

  let state = initialState();
  const stack: State[] = [];
  const ocStack: (string | null)[] = [];
  const oc = () => {
    for (let i = ocStack.length - 1; i >= 0; i--) if (ocStack[i]) return ocStack[i];
    return null;
  };
  let tm: M = IDENTITY;
  let tlm: M = IDENTITY;
  let pendingClip = false;

  const showGlyphs = (glyphs: unknown[]) => {
    const t = state.text;
    let text = "";
    let advance = 0; // text space, before the text matrix
    const m0 = tm;
    for (const g of glyphs) {
      if (typeof g === "number") {
        advance += (-g / 1000) * t.size * t.hScale;
        continue;
      }
      const glyph = g as { unicode?: string; width?: number; isSpace?: boolean } | null;
      if (!glyph) continue;
      const w = ((glyph.width ?? 0) / 1000) * t.size + t.charSpacing + (glyph.isSpace ? t.wordSpacing : 0);
      text += glyph.unicode ?? "";
      advance += w * t.hScale;
    }
    tm = mul([1, 0, 0, 1, advance, 0], tm);
    if (!options.text || !text.trim()) return;
    const hidden = t.mode === 3 || t.mode === 7;
    if (hidden && !options.recognizeText) return;
    const full = mul(m0, state.ctm);
    const origin = apply(full, 0, t.rise);
    const along = linear(full, advance || 1, 0);
    const em = len(linear(full, 0, t.size));
    if (em < 1e-6) return;
    runs.push({
      text: text.replace(/\s+$/, ""),
      font: t.font,
      origin,
      angle: Math.atan2(along.y, along.x),
      em,
      advance: advance ? len(along) : 0,
      layer: layerFor(LAYER_TEXT, oc()),
      color: state.fill,
      hidden,
      glyphTop: 0,
      glyphRight: 0,
      glyphColor: new Map(),
      glyphLayer: new Map(),
    });
  };

  input.ops.forEach(({ fn, args }, opIndex) => {
    const a = args ?? [];
    switch (fn) {
      case "save":
        stack.push(copyState(state));
        break;
      case "restore":
        state = stack.pop() ?? state;
        break;
      case "transform":
        state.ctm = mul(toM(a), state.ctm);
        break;
      case "setLineWidth":
        state.lineWidth = Number(a[0]);
        break;
      case "setDash":
        state.dash = Array.from((a[0] as number[]) ?? []).map(Number);
        state.dashPhase = Number(a[1] ?? 0);
        break;
      case "setStrokeRGBColor":
        if (typeof a[0] === "string") state.stroke = a[0];
        break;
      case "setFillRGBColor":
        if (typeof a[0] === "string") state.fill = a[0];
        break;
      case "setGState":
        for (const [key, value] of (a[0] as [string, unknown][]) ?? []) {
          if (key === "LW") state.lineWidth = Number(value);
          else if (key === "D" && Array.isArray(value)) {
            state.dash = Array.from(value[0] as number[]).map(Number);
            state.dashPhase = Number(value[1] ?? 0);
          } else if (key === "Font" && Array.isArray(value)) {
            state.text.font = String(value[0]);
            state.text.size = Number(value[1]);
          }
        }
        break;
      case "beginMarkedContentProps": {
        const props = a[1] as { type?: string; id?: string } | null;
        ocStack.push(a[0] === "OC" && props?.id ? props.id : null);
        break;
      }
      case "beginMarkedContent":
        ocStack.push(null);
        break;
      case "endMarkedContent":
        ocStack.pop();
        break;
      case "clip":
      case "eoClip":
        pendingClip = true;
        break;
      case "constructPath": {
        const paint = String(a[0]);
        const raw = (a[1] as ArrayLike<number>[] | null)?.[0];
        if (!raw) break;
        if (pendingClip) {
          // The path just after a clip operator is the clipping path (pdf.js puts it there).
          pendingClip = false;
          const loops = subpaths(raw, state.ctm, tol)
            .map((s) => outline(s.points, s.bulges, true))
            .filter((l) => l.length > 2);
          if (loops.length) {
            const all = loops.flat();
            const box: Clip["box"] = [Math.min(...all.map((p) => p.x)), Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.x)), Math.max(...all.map((p) => p.y))];
            state.clips = [...state.clips, { loops, box }];
          }
        }
        if (paint === "endPath" || (!options.geometry && !options.fills)) break;
        const closeFirst = paint === "closeStroke" || paint === "closeFillStroke" || paint === "closeEOFillStroke";
        const paths = subpaths(raw, state.ctm, tol).filter((s) => visible(outline(s.points, s.bulges, s.closed), state.clips));
        const fill = paint !== "stroke" && paint !== "closeStroke";
        const stroke = paint === "stroke" || paint === "closeStroke" || paint.includes("Stroke");
        if (fill && options.fills) {
          const loops = paths.map((s) => outline(s.points, s.bulges, true)).filter((l) => l.length > 2);
          if (loops.length) fills.push({ loops, layer: layerFor(LAYER_FILLS, oc()), color: state.fill });
        }
        if (stroke && options.geometry) {
          const width = state.lineWidth * scaleOf(state.ctm);
          const lineweight = options.lineweights ? nearestLineweight((width * 25.4) / 72) : -1;
          const layer = layerFor(LAYER_GEOMETRY, oc());
          for (const s of paths) {
            if (closeFirst && !s.closed) {
              s.closed = true;
              while (s.bulges.length < s.points.length) s.bulges.push(0);
            }
            if (state.dash.length && state.dash.some((d) => d > 0)) {
              const scale = scaleOf(state.ctm);
              const pts = outline(s.points, s.bulges, false);
              if (s.closed) pts.push(s.points[0]);
              for (const [p, q] of dashes(pts, state.dash.map((d) => d * scale), state.dashPhase * scale))
                chains.push({ points: [p, q], bulges: [0, 0], closed: false, layer, color: state.stroke, lineweight, dashed: true });
            } else chains.push({ ...s, layer, color: state.stroke, lineweight, dashed: false });
          }
        }
        break;
      }
      case "beginText":
        tm = tlm = IDENTITY;
        break;
      case "setFont":
        state.text.font = String(a[0]);
        state.text.size = Number(a[1]);
        break;
      case "setTextMatrix":
        tm = tlm = toM(a[0] && typeof a[0] === "object" ? a[0] : a);
        break;
      case "moveText":
        tm = tlm = mul([1, 0, 0, 1, Number(a[0]), Number(a[1])], tlm);
        break;
      case "setLeadingMoveText":
        state.text.leading = -Number(a[1]);
        tm = tlm = mul([1, 0, 0, 1, Number(a[0]), Number(a[1])], tlm);
        break;
      case "nextLine":
        tm = tlm = mul([1, 0, 0, 1, 0, -state.text.leading], tlm);
        break;
      case "setLeading":
        state.text.leading = Number(a[0]);
        break;
      case "setCharSpacing":
        state.text.charSpacing = Number(a[0]);
        break;
      case "setWordSpacing":
        state.text.wordSpacing = Number(a[0]);
        break;
      case "setHScale":
        state.text.hScale = Number(a[0]) / 100;
        break;
      case "setTextRise":
        state.text.rise = Number(a[0]);
        break;
      case "setTextRenderingMode":
        state.text.mode = Number(a[0]);
        break;
      case "showText":
      case "showSpacedText":
        showGlyphs((a[0] as unknown[]) ?? []);
        break;
      case "nextLineShowText":
        tm = tlm = mul([1, 0, 0, 1, 0, -state.text.leading], tlm);
        showGlyphs((a[0] as unknown[]) ?? []);
        break;
      case "paintImageXObject":
      case "paintInlineImageXObject":
      case "paintImageMaskXObject": {
        if (!options.images) break;
        const origin = apply(state.ctm, 0, 0);
        const wv = linear(state.ctm, 1, 0);
        const hv = linear(state.ctm, 0, 1);
        if (len(wv) < 1e-6 || len(hv) < 1e-6) break;
        images.push({ opIndex, at: P(origin), width: len(wv) * k, height: len(hv) * k, rotation: Math.atan2(wv.y, wv.x), layer: layerFor(LAYER_IMAGES, oc()) });
        break;
      }
    }
  });

  // Strokes under invisible text are its letters: drop them, and learn the letters' size.
  let recognized = 0;
  const hiddenRuns = runs.filter((r) => r.hidden);
  if (hiddenRuns.length) {
    const CELL = 24;
    const grid = new Map<string, Run[]>();
    for (const r of hiddenRuns) {
      const c = Math.cos(r.angle);
      const s = Math.sin(r.angle);
      const corners = [
        [-0.2 * r.em, -0.4 * r.em],
        [r.advance + 0.2 * r.em, -0.4 * r.em],
        [r.advance + 0.2 * r.em, 1.2 * r.em],
        [-0.2 * r.em, 1.2 * r.em],
      ].map(([u, v]) => ({ x: r.origin.x + u * c - v * s, y: r.origin.y + u * s + v * c }));
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      for (let gx = Math.floor(Math.min(...xs) / CELL); gx <= Math.floor(Math.max(...xs) / CELL); gx++)
        for (let gy = Math.floor(Math.min(...ys) / CELL); gy <= Math.floor(Math.max(...ys) / CELL); gy++) {
          const key = `${gx},${gy}`;
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push(r);
        }
    }
    const keep: Chain[] = [];
    for (const chain of chains) {
      const p = chain.points[0];
      const candidates = grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`) ?? [];
      let owner: Run | null = null;
      let top = 0;
      let right = 0;
      for (const r of candidates) {
        const c = Math.cos(r.angle);
        const s = Math.sin(r.angle);
        let inside = true;
        let vMin = Infinity;
        let vMax = -Infinity;
        let uMin = Infinity;
        let uMax = -Infinity;
        for (const q of chain.points) {
          const d = sub(q, r.origin);
          const u = d.x * c + d.y * s;
          const v = -d.x * s + d.y * c;
          if (u < -0.2 * r.em || u > r.advance + 0.2 * r.em || v < -0.4 * r.em || v > 1.2 * r.em) {
            inside = false;
            break;
          }
          vMin = Math.min(vMin, v);
          vMax = Math.max(vMax, v);
          uMin = Math.min(uMin, u);
          uMax = Math.max(uMax, u);
        }
        // A letter's stroke is no bigger than a letter: an underline or a box around the text stays.
        if (inside && uMax - uMin <= 1.3 * r.em && vMax - vMin <= 1.4 * r.em) {
          owner = r;
          top = vMax;
          right = uMax;
          break;
        }
      }
      if (!owner) {
        keep.push(chain);
        continue;
      }
      recognized++;
      owner.glyphTop = Math.max(owner.glyphTop, top);
      owner.glyphRight = Math.max(owner.glyphRight, right);
      owner.glyphColor.set(chain.color, (owner.glyphColor.get(chain.color) ?? 0) + 1);
      owner.glyphLayer.set(chain.layer, (owner.glyphLayer.get(chain.layer) ?? 0) + 1);
    }
    chains.length = 0;
    chains.push(...keep);
  }
  // Invisible text with no strokes under it is only for searching (a scan's OCR layer, say): skip it.
  const textRuns = runs.filter((r) => !r.hidden || r.glyphColor.size > 0);

  const entities: NewEntity[] = [];
  const base = (layer: string, color: string) => ({ layer, color: colorValue(color), lineweight: -1, linetype: "ByLayer" });

  // Geometry.
  const joined = options.join ? joinChains(chains, tol) : chains;
  for (const c of joined) {
    const props = { ...base(c.layer, c.color), lineweight: c.lineweight };
    const pts = c.points.map(P);
    const bulges = c.bulges.slice(0, pts.length);
    const circle = c.closed ? asCircle(pts, bulges) : null;
    if (circle) entities.push({ ...props, type: "circle", center: circle.center, radius: circle.r });
    else if (!c.closed && pts.length === 2 && Math.abs(bulges[0]) < 1e-9) entities.push({ ...props, type: "line", a: pts[0], b: pts[1] });
    else if (!c.closed && pts.length === 2) {
      const arc = bulgeToArc(pts[0], pts[1], bulges[0]);
      entities.push({ ...props, type: "arc", ...arc });
    } else entities.push({ ...props, type: "polyline", points: pts, bulges: c.closed ? bulges : [...bulges.slice(0, pts.length - 1), 0], closed: c.closed });
  }
  const geometryCount = entities.length;

  // Solid fills.
  for (const f of fills) entities.push({ ...base(f.layer, f.color), type: "hatch", loops: f.loops.map((l) => l.map(P)), pattern: "SOLID", scale: 1, angle: 0 });

  // Text: a style per PDF font, sized from the letters when they were strokes.
  const styleOf = new Map<string, string>();
  const textStyles: TextStyle[] = [];
  const fonts = new Set(textRuns.map((r) => r.font));
  for (const font of fonts) {
    const of = textRuns.filter((r) => r.font === font);
    const caps = of.filter((r) => r.glyphTop > 0 && /[A-Z0-9]/.test(r.text)).map((r) => r.glyphTop / r.em);
    const cap = caps.length ? median(caps) : capRatio("Arial");
    const ratios = of
      .map((r) => {
        const visible = r.glyphRight > 0 ? r.glyphRight : r.advance;
        const natural = textWidth(r.text, r.em * cap, "Arial");
        return natural > 1e-9 ? visible / natural : NaN;
      })
      .filter((x) => Number.isFinite(x) && x > 0.2 && x < 5);
    const widthFactor = ratios.length ? Math.round(median(ratios) * 100) / 100 : 1;
    const name = `PDF_${cleanName(input.fontNames?.[font] ?? font)}`;
    let unique = name;
    for (let i = 2; textStyles.some((t) => t.name === unique); i++) unique = `${name}_${i}`;
    textStyles.push({ name: unique, font: "Arial", widthFactor });
    styleOf.set(font, unique);
    for (const r of of) r.em *= cap; // from here on: the capitals' height
  }
  const merged = mergeRuns(textRuns);
  for (const r of merged) {
    const color = r.glyphColor.size ? top(r.glyphColor) : r.color;
    const layer = r.glyphLayer.size ? top(r.glyphLayer) : r.layer;
    entities.push({ ...base(layer, color), type: "text", at: P(r.origin), text: r.text, height: r.em * k, rotation: r.angle, style: styleOf.get(r.font)!, halign: "left", valign: "baseline" });
  }

  for (const img of images) if (!layers.has(img.layer) && options.layers !== "current") layers.set(img.layer, 7);
  const used = new Set([...entities.map((e) => e.layer), ...images.map((i) => i.layer)]);
  return {
    entities,
    images,
    layers: [...layers].filter(([name]) => used.has(name)).map(([name, color]) => ({ name, color })),
    textStyles: textStyles.filter((t) => merged.some((r) => styleOf.get(r.font) === t.name)),
    size: { width: (x1 - x0) * k, height: (y1 - y0) * k },
    counts: { geometry: geometryCount, fills: fills.length, text: merged.length, images: images.length, recognized },
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const top = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1])[0][0];

/** Black and white are AutoCAD's colour 7 (black on paper, white on a dark screen); others stay true colours. */
function colorValue(hex: string): ColorValue {
  const h = hex.toLowerCase();
  return h === "#000000" ? 7 : h;
}

function bulgeToArc(a: Vec, b: Vec, bulge: number) {
  const sweep = 4 * Math.atan(bulge);
  const chord = len(sub(b, a));
  const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dir = { x: (b.x - a.x) / chord, y: (b.y - a.y) / chord };
  const h = Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0)) * (Math.abs(sweep) > Math.PI ? -1 : 1) * (bulge > 0 ? 1 : -1);
  const center = { x: mid.x - dir.y * h, y: mid.y + dir.x * h };
  const sa = Math.atan2(a.y - center.y, a.x - center.x);
  const ea = Math.atan2(b.y - center.y, b.x - center.x);
  // Arcs run counter-clockwise: a clockwise segment is the same arc from b to a.
  return bulge > 0 ? { center, radius: r, start: sa, end: ea } : { center, radius: r, start: ea, end: sa };
}

/** A closed chain of arcs about one centre making a whole turn: a circle. */
function asCircle(pts: Vec[], bulges: number[]): { center: Vec; r: number } | null {
  if (pts.length < 2 || bulges.length < pts.length || bulges.some((b) => Math.abs(b) < 1e-6)) return null;
  const sweep = bulges.reduce((s, b) => s + 4 * Math.atan(b), 0);
  if (Math.abs(Math.abs(sweep) - 2 * Math.PI) > 0.01) return null;
  const arcs = pts.map((p, i) => bulgeToArc(p, pts[(i + 1) % pts.length], bulges[i]));
  const c = arcs[0];
  const tol = Math.max(c.radius * 1e-3, 1e-4);
  if (!arcs.every((x) => len(sub(x.center, c.center)) < tol && Math.abs(x.radius - c.radius) < tol)) return null;
  return { center: c.center, r: c.radius };
}

/** Runs that continue one another along a line (a word at a time, as some programs write) as one text. */
function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text.trim()) continue;
    const prev = out[out.length - 1];
    if (prev && prev.font === r.font && Math.abs(prev.em - r.em) < 0.02 * r.em && Math.abs(prev.angle - r.angle) < 0.01 && prev.layer === r.layer) {
      const c = Math.cos(prev.angle);
      const s = Math.sin(prev.angle);
      const d = sub(r.origin, prev.origin);
      const u = d.x * c + d.y * s;
      const v = -d.x * s + d.y * c;
      const end = prev.glyphRight > 0 ? prev.glyphRight : prev.advance;
      const gap = u - end;
      if (Math.abs(v) < 0.15 * r.em && gap > -0.3 * r.em && gap < 1.2 * r.em) {
        prev.text = `${prev.text}${gap > 0.25 * r.em && !prev.text.endsWith(" ") ? " " : ""}${r.text.replace(/^\s+/, "")}`;
        prev.advance = u + r.advance;
        prev.glyphRight = r.glyphRight > 0 ? u + r.glyphRight : 0;
        for (const [key, n] of r.glyphColor) prev.glyphColor.set(key, (prev.glyphColor.get(key) ?? 0) + n);
        for (const [key, n] of r.glyphLayer) prev.glyphLayer.set(key, (prev.glyphLayer.get(key) ?? 0) + n);
        continue;
      }
    }
    out.push({ ...r, text: r.text.replace(/^\s+/, ""), origin: leadingShift(r) });
  }
  return out;
}

/** Where a run's first visible character starts (leading spaces dropped). */
function leadingShift(r: Run): Vec {
  const spaces = r.text.length - r.text.replace(/^\s+/, "").length;
  if (!spaces || !r.text.trim()) return r.origin;
  const shift = (r.advance * spaces) / r.text.length;
  return { x: r.origin.x + Math.cos(r.angle) * shift, y: r.origin.y + Math.sin(r.angle) * shift };
}
