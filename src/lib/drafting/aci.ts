import type { ColorValue, Entity, Layer } from "./types";

// The AutoCAD Color Index: 1-9 are the named colours, 10-249 run through 24 hues in five
// shades (even indexes full colour, odd ones softened), and 250-255 are greys. Colour 7 is
// "white", drawn black on a light background.

const NAMED = ["#000000", "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ffffff", "#808080", "#c0c0c0"];
const GREYS = ["#333333", "#505050", "#696969", "#828282", "#bebebe", "#ffffff"];
const SHADES = [1, 0.8, 0.6, 0.5, 0.3];

const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

function hsv(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${hex(f(5) * 255)}${hex(f(3) * 255)}${hex(f(1) * 255)}`;
}

export const ACI: string[] = Array.from({ length: 256 }, (_, i) => {
  if (i < 10) return NAMED[i];
  if (i >= 250) return GREYS[i - 250];
  const hue = (Math.floor(i / 10) - 1) * 15;
  const shade = SHADES[Math.floor((i % 10) / 2)];
  return hsv(hue, i % 2 ? 0.5 : 1, shade);
});

export const ACI_NAMES: Record<number, string> = { 1: "Red", 2: "Yellow", 3: "Green", 4: "Cyan", 5: "Blue", 6: "Magenta", 7: "White" };

/** A colour as the property palette names it. */
export function colorName(color: ColorValue) {
  if (color === null) return "ByLayer";
  if (color === 0) return "ByBlock";
  if (typeof color === "string") return color.toUpperCase();
  return ACI_NAMES[color] ?? `Color ${color}`;
}

/** The colour to draw with: ByLayer resolved, and colour 7 black or white for the background. */
export function displayColor(color: number | string, dark: boolean) {
  if (typeof color === "string") return color;
  if (color === 7 || color === 0) return dark ? "#ffffff" : "#000000"; // ByBlock outside a block draws as 7
  return ACI[color] ?? "#000000";
}

export function entityColor(entity: Entity, layer: Layer | undefined, dark: boolean) {
  return displayColor(entity.color ?? layer?.color ?? 7, dark);
}
