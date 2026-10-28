import "server-only";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { axes, PLOT_COLORS, tickLabel } from "./axes";
import { uprightUnits, type Result } from "./evaluate";
import { SHAPES_SOURCE } from "./library/shapes";
import { regionHeight } from "./library/templates";
import { contentSize, DEFAULT_GRID, gridStep, PAGES, type CalcData, type Region, type TextRegion } from "./types";

// A worksheet as a PDF, laid out as it prints from the editor: the calc paper's header on each
// page and the regions where they're placed. Math is set by MathJax and drawn as vector outlines,
// so the PDF reads the same anywhere (and in Sheets).

const K = 0.75; // points per CSS pixel

// --- math, set by MathJax -------------------------------------------------------------------------

let tex: { convert: (latex: string) => string } | null = null;
function mathSvg(latex: string): string {
  if (!tex) {
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const doc = mathjax.document("", { InputJax: new TeX({ packages: AllPackages.filter((p) => p !== "bussproofs") }), OutputJax: new SVG({ fontCache: "none" }) });
    tex = { convert: (l) => adaptor.innerHTML(doc.convert(l, { display: false, em: 16, ex: 8, containerWidth: 1200 }) as never) };
  }
  return tex.convert(latex);
}

/** MathLive's LaTeX as MathJax reads it. */
const forMathJax = (latex: string) =>
  latex
    .replace(/\\coloneq(?![a-z])/g, "\\mathrel{:=}")
    .replace(/\\placeholder(\[[^\]]*\])?\{\}/g, "\\square")
    .replace(/\\differentialD/g, "d");

type Math = { svg: string; width: number; height: number; ascent: number };

/** Math at a font size (CSS px): its SVG and size, with the baseline `ascent` below its top. */
function setMath(latex: string, size: number, color = "#171717"): Math | null {
  try {
    let svg = mathSvg(`\\displaystyle ${forMathJax(latex)}`);
    if (svg.includes("data-mjx-error") || svg.includes("merror")) return null;
    const box = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/);
    if (!box) return null;
    const [, , top, w, h] = box.map(Number);
    svg = svg.replace(/currentColor/g, color).replace(/ style="[^"]*"/, "");
    return { svg, width: (w * size) / 1000, height: (h * size) / 1000, ascent: (-top * size) / 1000 };
  } catch {
    return null;
  }
}

// --- drawing ---------------------------------------------------------------------------------------

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };
const color = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
const GREEK: Record<string, string> = { α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", θ: "theta", λ: "lambda", μ: "mu", π: "pi", ρ: "rho", σ: "sigma", τ: "tau", φ: "phi", ψ: "psi", ω: "omega", Δ: "Delta", Σ: "Sigma", Ω: "Omega" };

/** A page of the PDF, drawn in CSS pixels from its top left (as on screen). */
class Sheet {
  constructor(
    readonly page: PDFPage,
    readonly fonts: Fonts,
    private height: number,
  ) {}

  /** Text the standard fonts can encode: symbols spelled out, anything else as "?". */
  private clean(s: string, font: PDFFont) {
    const chars = new Set(font.getCharacterSet());
    return [...s.replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/≠/g, "!=").replace(/√/g, "sqrt ").replace(/[αβγδεθλμπρστφψωΔΣΩ]/g, (c) => GREEK[c] ?? c)].map((c) => (chars.has(c.codePointAt(0)!) ? c : "?")).join("");
  }

  width(s: string, size: number, font = this.fonts.regular) {
    return font.widthOfTextAtSize(this.clean(s, font), size * K) / K;
  }

  /** Text with its top at y. */
  text(s: string, x: number, y: number, size: number, options: { font?: PDFFont; color?: string; align?: "left" | "right" | "center" } = {}) {
    const font = options.font ?? this.fonts.regular;
    const str = this.clean(s, font);
    const w = this.width(s, size, font);
    const left = options.align === "right" ? x - w : options.align === "center" ? x - w / 2 : x;
    this.page.drawText(str, { x: left * K, y: (this.height - y - size * 0.82) * K, size: size * K, font, color: color(options.color ?? "#171717") });
  }

  /** Lines of text wrapped to a width. */
  wrap(s: string, size: number, width: number, font = this.fonts.regular) {
    const lines: string[] = [];
    for (const para of s.split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (line && this.width(next, size, font) > width) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  math(m: Math, x: number, top: number) {
    this.page.drawSvg(m.svg, { x: x * K, y: (this.height - top) * K, width: m.width * K, height: m.height * K });
  }

  line(x0: number, y0: number, x1: number, y1: number, hex = "#a3a3a3", width = 0.75) {
    this.page.drawLine({ start: { x: x0 * K, y: (this.height - y0) * K }, end: { x: x1 * K, y: (this.height - y1) * K }, thickness: width * K, color: color(hex) });
  }

  rect(x: number, y: number, w: number, h: number, hex = "#a3a3a3", width = 0.75) {
    this.page.drawRectangle({ x: x * K, y: (this.height - y - h) * K, width: w * K, height: h * K, borderColor: color(hex), borderWidth: width * K });
  }

  polyline(points: [number, number][], hex: string, width = 1.6) {
    for (let i = 1; i < points.length; i++) this.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], hex, width);
  }

  dot(x: number, y: number, r: number, hex: string) {
    this.page.drawCircle({ x: x * K, y: (this.height - y) * K, size: r * K, color: color(hex) });
  }
}

/** The calc paper's header, as on screen: project, calc no., sheet; subject, by, checked, date. */
function drawHeader(s: Sheet, data: CalcData, page: number, pages: number) {
  const p = PAGES[data.paper];
  const left = p.left;
  const width = p.width - p.left - p.right;
  const cols = [width - 112 - 112 - 96, 112, 112, 96];
  const xs = cols.reduce<number[]>((acc, w, i) => [...acc, acc[i] + w], [left]);
  const rowH = 29;
  const top = 32;
  const cell = (label: string, value: string, x0: number, x1: number, y: number) => {
    s.rect(x0, y, x1 - x0, rowH);
    s.text(label.toUpperCase(), x0 + 6, y + 3, 8, { color: "#737373" });
    s.text(value, x0 + 6, y + 14, 11);
  };
  const h = data.header;
  cell("Project", h.project, xs[0], xs[2], top);
  cell("Calc no.", h.number, xs[2], xs[3], top);
  cell("Sheet", `${page} of ${pages}`, xs[3], xs[4], top);
  cell("Subject", h.title, xs[0], xs[1], top + rowH);
  cell("By", h.by, xs[1], xs[2], top + rowH);
  cell("Checked", h.checked, xs[2], xs[3], top + rowH);
  cell("Date", h.date, xs[3], xs[4], top + rowH);
}

const TEXT_STYLE: Record<TextRegion["style"], { size: number; font: keyof Fonts; color: string }> = {
  normal: { size: 14, font: "regular", color: "#171717" },
  heading: { size: 20, font: "bold", color: "#171717" },
  subheading: { size: 16, font: "bold", color: "#171717" },
  note: { size: 12, font: "italic", color: "#525252" },
};

function drawRegion(s: Sheet, r: Region, result: Result | undefined, x: number, y: number, maxWidth: number) {
  const err = (message: string, at: number) => s.text(message, x + 4, at, 10, { color: "#dc2626" });
  switch (r.kind) {
    case "text": {
      const st = TEXT_STYLE[r.style];
      const font = s.fonts[st.font];
      const lines = s.wrap(r.text, st.size, Math.min(r.width || 320, maxWidth) - 8, font);
      lines.forEach((line, i) => s.text(line, x + 4, y + 2 + i * st.size * 1.375, st.size, { font, color: st.color }));
      return;
    }
    case "math": {
      const ok = result?.kind === "ok" ? result : null;
      const shown = (ok?.result ? `${uprightUnits(r.latex, ok.units ?? [])}${ok.result}` : uprightUnits(r.latex, ok?.units ?? [])) || "\\square";
      const m = setMath(shown, 16, result?.kind === "error" && !result.incomplete ? "#b91c1c" : undefined);
      if (m) s.math(m, x + 4, y + 2);
      else s.text(r.latex, x + 4, y + 2, 12, { color: "#b91c1c" });
      if (result?.kind === "error" && !result.incomplete) err(result.message, y + 4 + (m?.height ?? 16));
      return;
    }
    case "section": {
      const sec = result?.kind === "section" ? result : null;
      const cells = sec ? sec.rows.map((row) => setMath(`${row.name}=${row.value}`, 13)) : [];
      const colW = [0, 1, 2, 3].map((c) => Math.max(60, ...cells.filter((_, i) => i % 4 === c).map((m) => m?.width ?? 0)) + 20);
      const compact = r.compact && sec ? s.wrap(`Defines ${sec.rows.map((row) => row.name.replace(/[{}\\]/g, "").replace("lambda", "λ")).join(", ")}`, 11, 584) : [];
      const width = Math.min(maxWidth, r.compact ? 600 : Math.max(220, colW.reduce((a, b) => a + b, 0) + 16));
      const rows = Math.ceil(cells.length / 4);
      const height = 30 + (sec ? (r.compact ? compact.length * 15 : rows * 20) : 20) + 6;
      s.rect(x, y, width, height, "#d4d4d4");
      s.text(sec?.label ?? (r.shape || "Steel section"), x + 8, y + 6, 14, { font: s.fonts.bold });
      if (sec) s.text(`${sec.metric} · ${SHAPES_SOURCE}`, x + 16 + s.width(sec.label, 14, s.fonts.bold), y + 10, 10, { color: "#737373" });
      s.line(x + 8, y + 26, x + width - 8, y + 26, "#e5e5e5");
      if (!sec) {
        s.text(result?.kind === "error" ? result.message : "No shape chosen", x + 8, y + 32, 12, { color: result?.kind === "error" && !result.incomplete ? "#dc2626" : "#a3a3a3" });
        return;
      }
      if (r.compact) compact.forEach((line, i) => s.text(line, x + 8, y + 32 + i * 15, 11, { color: "#525252" }));
      else
        cells.forEach((m, i) => {
          if (!m) return;
          const cx = x + 8 + colW.slice(0, i % 4).reduce((a, b) => a + b, 0);
          const cy = y + 32 + Math.floor(i / 4) * 20;
          s.math(m, cx, cy + 12 - m.ascent);
        });
      return;
    }
    case "table": {
      const widths = r.columns.map((col, c) => Math.max(44, s.width(col.name, 13, s.fonts.italic), s.width(col.unit, 11), ...r.rows.map((row) => s.width(row[c] ?? "", 13))) + 14);
      let cx = x + 2;
      r.columns.forEach((col, c) => {
        const w = widths[c];
        s.rect(cx, y + 2, w, 22);
        s.text(col.name.replace(/_/g, ""), cx + w / 2, y + 6, 13, { font: s.fonts.italic, align: "center" });
        s.rect(cx, y + 24, w, 18);
        s.text(col.unit, cx + w / 2, y + 27, 11, { color: "#525252", align: "center" });
        r.rows.forEach((row, i) => {
          s.rect(cx, y + 42 + i * 21, w, 21);
          s.text(row[c] ?? "", cx + w - 5, y + 46 + i * 21, 13, { align: "right" });
        });
        cx += w;
      });
      if (result?.kind === "error") err(result.message, y + 46 + r.rows.length * 21);
      return;
    }
    case "plot": {
      const traces = result?.kind === "plot" ? result.traces : [];
      const { x: xt, y: yt } = axes(traces);
      const [W, H] = [r.width, r.height];
      const ox = x + 32;
      const oy = y + 22;
      const pad = { left: 52, right: 12, top: 10, bottom: 30 };
      const sx = (v: number) => ox + pad.left + ((v - xt.lo) / (xt.hi - xt.lo)) * (W - pad.left - pad.right);
      const sy = (v: number) => oy + H - pad.bottom - ((v - yt.lo) / (yt.hi - yt.lo)) * (H - pad.top - pad.bottom);
      // The y expressions above the plot (Mathcad shows them up the side), the x ones below.
      let lx = ox + pad.left;
      r.traces.forEach((t, i) => {
        const m = t.y ? setMath(t.y, 12, PLOT_COLORS[i % PLOT_COLORS.length]) : null;
        if (m) {
          s.math(m, lx, oy - 4 - m.height);
          lx += m.width + 10;
        }
      });
      if (result?.kind === "plot" && result.yUnit) s.text(`(${result.yUnit.replace(/inch/g, "in")})`, lx, oy - 16, 11, { color: "#737373" });
      for (const v of yt.values) {
        s.line(ox + pad.left, sy(v), ox + W - pad.right, sy(v), "#e5e7eb");
        s.text(tickLabel(v, yt.step), ox + pad.left - 4, sy(v) - 5, 10, { color: "#374151", align: "right" });
      }
      for (const v of xt.values) {
        s.line(sx(v), oy + pad.top, sx(v), oy + H - pad.bottom, "#e5e7eb");
        s.text(tickLabel(v, xt.step), sx(v), oy + H - pad.bottom + 4, 10, { color: "#374151", align: "center" });
      }
      if (xt.lo < 0 && xt.hi > 0) s.line(sx(0), oy + pad.top, sx(0), oy + H - pad.bottom, "#9ca3af");
      if (yt.lo < 0 && yt.hi > 0) s.line(ox + pad.left, sy(0), ox + W - pad.right, sy(0), "#9ca3af");
      s.rect(ox + pad.left, oy + pad.top, W - pad.left - pad.right, H - pad.top - pad.bottom, "#374151");
      traces.forEach((t, i) => {
        const hex = PLOT_COLORS[i % PLOT_COLORS.length];
        const pts = t.xs.map((v, k) => [v, t.ys[k]] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
        s.polyline(pts.map(([a, b]) => [sx(a), sy(b)]), hex);
        if (pts.length <= 30) for (const [a, b] of pts) s.dot(sx(a), sy(b), 2.2, hex);
      });
      const xs = [...new Set(r.traces.map((t) => t.x))];
      const xm = xs.length === 1 && xs[0] ? setMath(xs[0], 12) : null;
      const xLabel = `${xm ? "" : xs.length > 1 ? "x" : ""}${result?.kind === "plot" && result.xUnit ? ` (${result.xUnit.replace(/inch/g, "in")})` : ""}`;
      const below = oy + H + 4;
      const mid = ox + pad.left + (W - pad.left - pad.right) / 2;
      if (xm) s.math(xm, mid - (xm.width + s.width(xLabel, 11)) / 2, below);
      if (xLabel) s.text(xLabel, mid + (xm ? xm.width / 2 - s.width(xLabel, 11) / 2 : 0), below + 2, 11, { color: "#737373", align: xm ? "left" : "center" });
      const failed = traces.find((t) => t.error);
      if (failed?.error) err(failed.error, below + 18);
      return;
    }
    case "solve": {
      const res = result?.kind === "solve" ? result : null;
      const solved = res?.solver.kind === "ok" ? res.solver.result : undefined;
      const lines = (key: "guesses" | "constraints") => r[key].filter((l) => l.trim()).map((l) => setMath(l, 15));
      const groups: [string, (Math | null)[]][] = [
        ["GUESS VALUES", lines("guesses")],
        ["CONSTRAINTS", lines("constraints")],
        ["SOLVER", [r.solver.trim() ? setMath(`${r.solver}${solved ?? ""}`, 15) : null]],
      ];
      const width = Math.min(maxWidth, Math.max(224, ...groups.flatMap(([, ms]) => ms.map((m) => (m?.width ?? 0) + 24))));
      let cy = y;
      for (const [title, ms] of groups) {
        const h = 20 + Math.max(1, ms.length) * 27;
        s.rect(x, cy, width, h, "#a3a3a3");
        s.text(title, x + 8, cy + 5, 9, { font: s.fonts.bold, color: "#737373" });
        ms.forEach((m, i) => m && s.math(m, x + 8, cy + 20 + i * 27 + 4));
        cy += h;
      }
      if (res?.solver.kind === "error" && !res.solver.incomplete) err(res.solver.message, cy + 4);
      return;
    }
  }
}

/** The worksheet as a PDF, and what each page is (for Sheets). */
export async function calcPdf(data: CalcData, results: Map<string, Result>, options: { title: string }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(options.title);
  pdf.setCreator("conkit calcs");
  pdf.setProducer("conkit");
  const fonts: Fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), italic: await pdf.embedFont(StandardFonts.HelveticaOblique) };
  const p = PAGES[data.paper];
  const content = contentSize(data.paper);
  const bottom = Math.max(0, ...data.regions.map((r) => r.y + regionHeight(r) - 8));
  const pages = Math.max(1, Math.floor(bottom / content.height) + 1);
  const sheets = Array.from({ length: pages }, (_, i) => {
    const sheet = new Sheet(pdf.addPage([p.width * K, p.height * K]), fonts, p.height);
    drawHeader(sheet, data, i + 1, pages);
    const grid = data.grid ?? DEFAULT_GRID;
    if (grid.show) {
      // Mathcad's gridlines print when they're shown.
      const step = gridStep(data.paper, grid);
      for (let x = 0; x <= content.width + 0.01; x += step) sheet.line(p.left + x, p.top, p.left + x, p.top + content.height, "#dbe2ea", 0.5);
      for (let y = 0; y <= content.height + 0.01; y += step) sheet.line(p.left, p.top + y, p.left + content.width, p.top + y, "#dbe2ea", 0.5);
    }
    return sheet;
  });
  for (const r of data.regions) {
    const page = Math.min(pages - 1, Math.floor(r.y / content.height));
    drawRegion(sheets[page], r, results.get(r.id), p.left + r.x, p.top + r.y - page * content.height, content.width - r.x);
  }
  return { bytes: await pdf.save(), pages, width: p.width * K, height: p.height * K };
}
