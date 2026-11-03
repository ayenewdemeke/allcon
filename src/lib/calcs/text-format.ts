import type { TextFont, TextRegion, TextStyle } from "./types";

// How a text region looks: its style's defaults (heading, note...) with the region's own font,
// size, bold, italic and underline on top, the same on screen and in the PDF. Sizes are CSS
// pixels; the ribbon shows them in points, as Mathcad does.

export type TextLook = { font: TextFont; size: number; bold: boolean; italic: boolean; underline: boolean; color: string };
export type TextFormat = Pick<TextRegion, "font" | "size" | "bold" | "italic" | "underline">;

const STYLE_LOOK: Record<TextStyle, Omit<TextLook, "font" | "underline">> = {
  normal: { size: 14, bold: false, italic: false, color: "#171717" },
  heading: { size: 20, bold: true, italic: false, color: "#171717" },
  subheading: { size: 16, bold: true, italic: false, color: "#171717" },
  note: { size: 12, bold: false, italic: true, color: "#525252" },
};

export const TEXT_FONTS: { id: TextFont; label: string; css?: string }[] = [
  { id: "sans", label: "Sans serif" }, // the app's font on screen, Helvetica in the PDF
  { id: "serif", label: "Serif", css: '"Times New Roman", Times, serif' },
  { id: "mono", label: "Monospace", css: '"Courier New", Courier, monospace' },
];

/** The sizes offered, in points. */
export const TEXT_SIZES_PT = [8, 9, 10, 10.5, 11, 12, 14, 15, 16, 18, 20, 24, 28, 32, 36];
export const ptToPx = (pt: number) => (pt * 4) / 3;
export const pxToPt = (px: number) => Math.round(px * 0.75 * 10) / 10;

export function textLook(r: Pick<TextRegion, "style" | "color"> & TextFormat): TextLook {
  const base = STYLE_LOOK[r.style] ?? STYLE_LOOK.normal;
  return {
    font: r.font ?? "sans",
    size: r.size ?? base.size,
    bold: r.bold ?? base.bold,
    italic: r.italic ?? base.italic,
    underline: r.underline ?? false,
    color: r.color ?? base.color,
  };
}

/** The next size up or down the list (Grow and Shrink font). */
export function stepSize(px: number, dir: 1 | -1) {
  const pt = pxToPt(px);
  const next = dir > 0 ? TEXT_SIZES_PT.find((s) => s > pt) : [...TEXT_SIZES_PT].reverse().find((s) => s < pt);
  return ptToPx(next ?? pt);
}

/** How far below a text region's top its first line's middle is (padding, then half a line). */
export const textMiddle = (size: number) => 2 + (size * 1.375) / 2;
