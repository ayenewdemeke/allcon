import type { Body } from "@/lib/calcs/library/templates";
import type { ImageRegion } from "@/lib/calcs/types";

// A table of text and numbers as a picture for a calc package (a Calcs table holds numbers only):
// a header row (one or two lines per column), ruled rows, columns left-aligned or right-aligned. A
// cell may hold several lines ("\n"): its row grows to fit.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type TableColumn = { title: string | [string, string]; x: number; anchor?: "end" | "middle" };

/** Words wrapped to lines of at most `width` characters, joined with "\n". */
export function wrap(text: string, width: number) {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if (line && (line + " " + w).length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.join("\n");
}

export function textTable(cols: TableColumn[], rows: string[][], width = 640, title?: string, rowColors?: (string | undefined)[]): Body<ImageRegion> {
  const lineH = 12;
  const head = cols.some((c) => Array.isArray(c.title)) ? 30 : 18;
  const top = title ? 18 : 0;
  const heights = rows.map((r) => Math.max(1, ...r.map((s) => s.split("\n").length)) * lineH + 4);
  const H = top + head + 10 + heights.reduce((s, h) => s + h, 0);
  // Each attribute once: a repeated one makes the SVG invalid, and the picture doesn't show.
  const t = (x: number, y: number, s: string, extra = "", size = 10) => `<text x="${x}" y="${y}" font-size="${size}"${extra}>${esc(s)}</text>`;
  const anchor = (c: TableColumn) => (c.anchor ? ` text-anchor="${c.anchor}"` : "");
  const parts = [`<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif" fill="#171717">`];
  if (title) parts.push(t(width / 2, 12, title, ' font-weight="bold" text-anchor="middle"', 11));
  for (const c of cols) {
    const lines = Array.isArray(c.title) ? c.title : [c.title];
    lines.forEach((l, k) => parts.push(t(c.x, top + 12 + k * 12, l, ` font-weight="bold"${anchor(c)}`)));
  }
  parts.push(`<line x1="0" y1="${top + head + 2}" x2="${width}" y2="${top + head + 2}" stroke="#171717" stroke-width="1"/>`);
  let y = top + head + 4;
  rows.forEach((r, k) => {
    r.forEach((s, j) => s.split("\n").forEach((l, n) => parts.push(t(cols[j].x, y + 12 + n * lineH, l, `${anchor(cols[j])}${rowColors?.[k] && j === cols.length - 2 ? ` fill="${rowColors[k]}"` : ""}`))));
    y += heights[k];
    parts.push(`<line x1="0" y1="${y + 1}" x2="${width}" y2="${y + 1}" stroke="#c8d0dc" stroke-width="0.5"/>`);
  });
  parts.push("</svg>");
  return { kind: "image", width, height: H, svg: parts.join("") };
}
