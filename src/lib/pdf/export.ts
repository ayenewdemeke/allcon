import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFPage,
  PDFRef,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFObject,
} from "@cantoo/pdf-lib";
import { APP_NAME } from "@/lib/app-config";

/** A PDF dictionary literal, as pdf-lib's context.obj() accepts (its own type isn't exported). */
type Dict = { [name: string]: DictValue };
type DictValue = string | number | boolean | null | undefined | PDFObject | Dict | DictValue[];

// Builds a marked-up copy of a drawing set: the chosen pages with every markup as a real
// PDF annotation (PolyLine, Polygon, Circle, FreeText, Line, cloudy Square), so the result
// can be reviewed, moved and commented on in Acrobat or Bluebeam. Each annotation carries
// its own appearance stream, so it looks the same in every viewer.

type Point = [number, number];

export type ExportMarkup = {
  id: string;
  kind: "length" | "area" | "count" | "note" | "arrow" | "cloud";
  points: Point[]; // PDF points, displayed orientation, origin top-left (as stored)
  color: string; // #rrggbb
  name: string;
  text: string | null; // note body
  valueText: string | null; // e.g. "2,443.2 SF"
};

export type ExportSheet = { pageIndex: number; name: string; markups: ExportMarkup[] };

export type SummaryRow = { sheet: string; name: string; type: string; quantity: string; lineItem?: string; amount?: string };

export type ExportOptions = {
  title: string;
  author: string;
  summary: SummaryRow[] | null; // null = no summary page
  showPricing: boolean;
};

// --- geometry: displayed page coordinates -> PDF user space ------------------------------

type PageFrame = { rotation: number; x0: number; y0: number; x1: number; y1: number };

function frameOf(page: PDFPage): PageFrame {
  const box = page.getCropBox();
  const rotation = (((page.getRotation().angle % 360) + 360) % 360) as number;
  return { rotation, x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height };
}

/** Our points are measured on the page as displayed (rotation applied, y down). */
function toUser(f: PageFrame, [dx, dy]: Point): Point {
  switch (f.rotation) {
    case 90:
      return [f.x0 + dy, f.y0 + dx];
    case 180:
      return [f.x1 - dx, f.y0 + dy];
    case 270:
      return [f.x1 - dy, f.y1 - dx];
    default:
      return [f.x0 + dx, f.y1 - dy];
  }
}

// --- small helpers ----------------------------------------------------------------------

const n = (v: number) => (Math.round(v * 100) / 100).toString();

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.15, 0.39, 0.92];
}

function boundsOf(points: Point[], pad: number): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/** Text as a PDF string the standard Helvetica font can show (WinAnsi); others become "?". */
function safeText(font: PDFFont, text: string) {
  const clean = [...text].map((ch) => {
    try {
      font.encodeText(ch);
      return ch;
    } catch {
      return "?";
    }
  });
  return clean.join("");
}

type Ctx = {
  doc: PDFDocument;
  font: PDFFont;
  fontName: string; // resource name of the font inside appearance streams
  author: string;
};

/**
 * Registers an appearance stream (Form XObject) drawn in page user space. BBox equals the
 * annotation Rect and the matrix is identity, so content coordinates map 1:1.
 */
function appearance(ctx: Ctx, rect: [number, number, number, number], content: string, transparent = false) {
  const resources: Dict = { Font: { [ctx.fontName]: ctx.font.ref } };
  if (transparent) resources.ExtGState = { GSfill: { Type: "ExtGState", ca: 0.15 } };
  const stream = ctx.doc.context.stream(content, {
    Type: "XObject",
    Subtype: "Form",
    BBox: rect,
    Resources: resources,
  });
  return ctx.doc.context.register(stream);
}

/** A label box with text, drawn upright relative to the displayed page. */
function labelOps(ctx: Ctx, f: PageFrame, at: Point, text: string, rgbStroke: [number, number, number]) {
  const size = 8;
  const t = safeText(ctx.font, text);
  const w = ctx.font.widthOfTextAtSize(t, size) + 8;
  const h = size + 6;
  const a = (f.rotation * Math.PI) / 180; // rotate with the page so the label reads upright
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  const [x, y] = at;
  return [
    "q",
    `${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${n(x)} ${n(y)} cm`,
    "1 1 1 rg",
    `${rgbStroke.map(n).join(" ")} RG 0.75 w`,
    `${n(-w / 2)} ${n(-h / 2)} ${n(w)} ${n(h)} re B`,
    `BT /${ctx.fontName} ${size} Tf ${rgbStroke.map(n).join(" ")} rg ${n(-w / 2 + 4)} ${n(-size / 2 + 1.5)} Td ${ctx.font.encodeText(t).toString()} Tj ET`,
    "Q",
  ].join("\n");
}

function annot(ctx: Ctx, page: PDFPage, dict: Dict) {
  const ref = ctx.doc.context.register(ctx.doc.context.obj(dict));
  page.node.addAnnot(ref);
  return ref;
}

/** Text values must be PDF strings (pdf-lib would otherwise turn plain strings into names). */
const str = (s: string) => PDFHexString.fromText(s);

// --- markup -> annotation -------------------------------------------------------------------

function addMarkup(ctx: Ctx, page: PDFPage, f: PageFrame, m: ExportMarkup) {
  const color = hexToRgb(m.color);
  const stroke = `${color.map(n).join(" ")} RG`;
  const fill = `${color.map(n).join(" ")} rg`;
  const pts = m.points.map((p) => toUser(f, p));
  const contents = [m.name, m.valueText, m.text].filter(Boolean).join("\n");
  const path = (close: boolean) =>
    pts.map((p, i) => `${n(p[0])} ${n(p[1])} ${i ? "l" : "m"}`).join("\n") + (close ? "\nh" : "");
  const base = (rect: [number, number, number, number], ap: PDFRef) => ({
    Type: "Annot",
    Rect: rect,
    C: color,
    Contents: str(contents),
    T: str(ctx.author),
    NM: str(m.id),
    M: str(new Date().toISOString()),
    F: 4, // print with the page
    BS: { W: 2 },
    AP: { N: ap },
  });

  if (m.kind === "length" && pts.length > 1) {
    const i = Math.floor((pts.length - 1) / 2);
    const mid: Point = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
    const rect = boundsOf([...pts, [mid[0] - 40, mid[1] - 40], [mid[0] + 40, mid[1] + 40]], 6);
    const ops = [`${stroke} 1.5 w 1 J 1 j`, path(false), "S", m.valueText ? labelOps(ctx, f, mid, m.valueText, color) : ""].join("\n");
    annot(ctx, page, { ...base(rect, appearance(ctx, rect, ops)), Subtype: "PolyLine", Vertices: pts.flat() });
    return;
  }

  if (m.kind === "area" && pts.length > 2) {
    const c: Point = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const rect = boundsOf([...pts, [c[0] - 40, c[1] - 40], [c[0] + 40, c[1] + 40]], 6);
    const ops = [
      `q /GSfill gs ${fill}`,
      path(true),
      "f Q",
      `${stroke} 1.5 w 1 j`,
      path(true),
      "S",
      m.valueText ? labelOps(ctx, f, c, m.valueText, color) : "",
    ].join("\n");
    annot(ctx, page, { ...base(rect, appearance(ctx, rect, ops, true)), Subtype: "Polygon", Vertices: pts.flat(), IC: color });
    return;
  }

  if (m.kind === "count") {
    pts.forEach((p, i) => {
      const r = 7;
      const rect: [number, number, number, number] = [p[0] - r - 1, p[1] - r - 1, p[0] + r + 1, p[1] + r + 1];
      const k = 0.5523 * r; // cubic Bezier circle
      const [x, y] = p;
      const circle = [
        `${n(x + r)} ${n(y)} m`,
        `${n(x + r)} ${n(y + k)} ${n(x + k)} ${n(y + r)} ${n(x)} ${n(y + r)} c`,
        `${n(x - k)} ${n(y + r)} ${n(x - r)} ${n(y + k)} ${n(x - r)} ${n(y)} c`,
        `${n(x - r)} ${n(y - k)} ${n(x - k)} ${n(y - r)} ${n(x)} ${n(y - r)} c`,
        `${n(x + k)} ${n(y - r)} ${n(x + r)} ${n(y - k)} ${n(x + r)} ${n(y)} c`,
      ].join("\n");
      const label = String(i + 1);
      const tw = ctx.font.widthOfTextAtSize(label, 7);
      const a = (f.rotation * Math.PI) / 180;
      const ops = [
        `${fill} 1 1 1 RG 1 w`,
        circle,
        "B",
        "q",
        `${n(Math.cos(a))} ${n(Math.sin(a))} ${n(-Math.sin(a))} ${n(Math.cos(a))} ${n(x)} ${n(y)} cm`,
        `BT /${ctx.fontName} 7 Tf 1 1 1 rg ${n(-tw / 2)} -2.4 Td ${ctx.font.encodeText(label).toString()} Tj ET`,
        "Q",
      ].join("\n");
      annot(ctx, page, {
        ...base(rect, appearance(ctx, rect, ops)),
        Subtype: "Circle",
        IC: color,
        Contents: str(`${m.name}: ${i + 1} of ${pts.length}`),
        NM: str(`${m.id}-${i + 1}`),
      });
    });
    return;
  }

  if (m.kind === "arrow" && pts.length >= 2) {
    const [a, b] = pts;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const head = (s: number): Point => [b[0] - 10 * Math.cos(ang + s), b[1] - 10 * Math.sin(ang + s)];
    const [h1, h2] = [head(0.45), head(-0.45)];
    const rect = boundsOf([a, b, h1, h2], 4);
    const ops = [`${stroke} ${fill} 1.5 w 1 J`, `${n(a[0])} ${n(a[1])} m ${n(b[0])} ${n(b[1])} l S`, `${n(h1[0])} ${n(h1[1])} m ${n(b[0])} ${n(b[1])} l ${n(h2[0])} ${n(h2[1])} l h B`].join("\n");
    annot(ctx, page, { ...base(rect, appearance(ctx, rect, ops)), Subtype: "Line", L: [a[0], a[1], b[0], b[1]], LE: [PDFName.of("None"), PDFName.of("ClosedArrow")] });
    return;
  }

  if (m.kind === "cloud" && pts.length >= 2) {
    const [x1, x2] = [Math.min(pts[0][0], pts[1][0]), Math.max(pts[0][0], pts[1][0])];
    const [y1, y2] = [Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][1], pts[1][1])];
    const corners: Point[] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    const bump = 10;
    const seg: string[] = [`${n(x1)} ${n(y1)} m`];
    // Scallops: semicircles bulging outward along each edge, approximated with short segments.
    for (let e = 0; e < 4; e++) {
      const [p, q] = [corners[e], corners[(e + 1) % 4]];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const count = Math.max(1, Math.round(len / (bump * 2)));
      const [ux, uy] = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
      const [ox, oy] = [uy, -ux]; // outward normal for this winding
      const r = len / count / 2;
      for (let k = 0; k < count; k++) {
        const cx = p[0] + ux * r * (2 * k + 1);
        const cy = p[1] + uy * r * (2 * k + 1);
        for (let s = 1; s <= 8; s++) {
          const t = Math.PI - (Math.PI * s) / 8;
          seg.push(`${n(cx + ux * r * Math.cos(t) + ox * r * Math.sin(t))} ${n(cy + uy * r * Math.cos(t) + oy * r * Math.sin(t))} l`);
        }
      }
    }
    const rect: [number, number, number, number] = [x1 - bump - 2, y1 - bump - 2, x2 + bump + 2, y2 + bump + 2];
    const ops = [`${stroke} 1.5 w 1 j`, ...seg, "h S"].join("\n");
    annot(ctx, page, { ...base(rect, appearance(ctx, rect, ops)), Subtype: "Square", BE: { S: "C", I: 1 } });
    return;
  }

  if (m.kind === "note" && pts.length >= 1) {
    const size = 9;
    const lines = (m.text || m.name).split("\n").slice(0, 8).map((l) => safeText(ctx.font, l));
    const w = Math.min(260, Math.max(...lines.map((l) => ctx.font.widthOfTextAtSize(l, size))) + 12);
    const h = lines.length * (size + 3) + 8;
    const a = (f.rotation * Math.PI) / 180;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    const origin = pts[0];
    // The note box hangs down-right of its anchor on the displayed page.
    const cornersLocal: Point[] = [[0, 0], [w, 0], [w, -h], [0, -h]];
    const cornersUser = cornersLocal.map(([lx, ly]) => [origin[0] + lx * cos - ly * sin, origin[1] + lx * sin + ly * cos] as Point);
    const rect = boundsOf(cornersUser, 2);
    const ops = [
      "q",
      `${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${n(origin[0])} ${n(origin[1])} cm`,
      "1 0.984 0.9 rg 0.9 0.79 0.42 RG 0.75 w",
      `0 ${n(-h)} ${n(w)} ${n(h)} re B`,
      `BT /${ctx.fontName} ${size} Tf 0.25 0.25 0.27 rg`,
      ...lines.map((l, i) => `1 0 0 1 6 ${n(-(i + 1) * (size + 3) + 1)} Tm ${ctx.font.encodeText(l).toString()} Tj`),
      "ET Q",
    ].join("\n");
    annot(ctx, page, {
      ...base(rect, appearance(ctx, rect, ops)),
      Subtype: "FreeText",
      DA: str(`/Helv ${size} Tf 0 g`),
      Contents: str(m.text || m.name),
    });
  }
}

// --- summary page ---------------------------------------------------------------------------

function addSummary(doc: PDFDocument, font: PDFFont, bold: PDFFont, title: string, rows: SummaryRow[], showPricing: boolean) {
  const [W, H] = [792, 612]; // US Letter, landscape
  const margin = 40;
  const cols = showPricing
    ? [{ k: "sheet", w: 90 }, { k: "name", w: 150 }, { k: "type", w: 60 }, { k: "quantity", w: 100 }, { k: "lineItem", w: 200 }, { k: "amount", w: 110 }]
    : [{ k: "sheet", w: 120 }, { k: "name", w: 260 }, { k: "type", w: 90 }, { k: "quantity", w: 140 }];
  const heads: Record<string, string> = { sheet: "Sheet", name: "Markup", type: "Type", quantity: "Quantity", lineItem: "Line item", amount: "Amount" };
  const fit = (f: PDFFont, s: string, size: number, w: number) => {
    let t = safeText(f, s);
    while (t && f.widthOfTextAtSize(t, size) > w - 6) t = t.slice(0, -2) + "…";
    return safeText(f, t);
  };

  let page = doc.addPage([W, H]);
  let y = H - margin;
  const header = () => {
    page.drawText(fit(bold, title, 14, W - 2 * margin), { x: margin, y, size: 14, font: bold });
    y -= 16;
    page.drawText(`Measurements · ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}`, { x: margin, y, size: 9, font, color: rgb(0.4, 0.45, 0.5) });
    y -= 22;
    let x = margin;
    for (const c of cols) {
      page.drawText(heads[c.k], { x, y, size: 9, font: bold });
      x += c.w;
    }
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 0.75, color: rgb(0.8, 0.83, 0.87) });
    y -= 14;
  };
  header();
  for (const r of rows) {
    if (y < margin + 10) {
      page = doc.addPage([W, H]);
      y = H - margin;
      header();
    }
    let x = margin;
    for (const c of cols) {
      const v = (r as Record<string, string | undefined>)[c.k] ?? "";
      page.drawText(fit(font, v, 9, c.w), { x, y, size: 9, font });
      x += c.w;
    }
    y -= 15;
  }
  if (!rows.length) page.drawText("No measurements on the exported sheets.", { x: margin, y, size: 10, font });
}

// --- entry point -------------------------------------------------------------------------------

export async function buildMarkedUpPdf(source: ArrayBuffer | Uint8Array, sheets: ExportSheet[], options: ExportOptions) {
  const src = await PDFDocument.load(source, { ignoreEncryption: true });
  const doc = await PDFDocument.create();
  doc.setTitle(options.title);
  doc.setAuthor(options.author);
  doc.setProducer(APP_NAME);
  doc.setCreator(APP_NAME);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, font, fontName: "Helv", author: options.author };

  const pages = await doc.copyPages(src, sheets.map((s) => s.pageIndex));
  pages.forEach((page, i) => {
    doc.addPage(page);
    const frame = frameOf(page);
    for (const m of sheets[i].markups) addMarkup(ctx, page, frame, m);
  });

  if (options.summary) addSummary(doc, font, bold, options.title, options.summary, options.showPricing);
  return doc.save();
}
