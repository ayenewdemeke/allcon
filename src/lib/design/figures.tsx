import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { BearingSketch } from "@/components/design/bearing-sketch";
import { CbcSketch, CipSketch, MseSketch } from "@/components/design/wall-sketch";
import { WingwallSketch } from "@/components/design/wingwall-sketch";
import type { Body } from "@/lib/calcs/library/templates";
import type { ImageRegion } from "@/lib/calcs/types";
import { designBearing, type BearingInputs } from "./bearings/elastomeric";
import { designCbc, type CbcInputs } from "./culverts/cbc";
import { designCipWall, type CipInputs } from "./walls/cip";
import { designMseWall, type MseInputs } from "./walls/mse";
import { designWingwall, type WingwallInputs } from "./walls/wingwall";

// The editors' sketches as pictures for a calc package: each drawn as standalone SVG markup, its
// attributes in their SVG spelling and the app's theme colors made explicit (a calc sheet is
// always white paper).

export type Figure = Body<ImageRegion>;

const MUTED = "#5c6f8a"; // --muted-foreground, light theme
const THEME: Record<string, { color?: string; fill?: string }> = { "text-muted-foreground": { color: MUTED }, "fill-muted-foreground": { fill: MUTED } };
// SVG attributes React spells in camelCase that SVG does too (the rest are hyphenated).
const CAMEL = new Set(["viewBox", "preserveAspectRatio", "patternUnits", "patternContentUnits", "patternTransform", "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "gradientUnits", "gradientTransform", "clipPathUnits", "textLength", "lengthAdjust"]);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A React SVG drawing (no hooks) as markup, currentColor resolved to the color it inherits. */
export function svgMarkup(node: ReactNode, color = "#171717"): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return esc(String(node));
  if (Array.isArray(node)) return node.map((n) => svgMarkup(n, color)).join("");
  if (!isValidElement(node)) return "";
  const props = node.props as Record<string, unknown>;
  if (node.type === Fragment) return svgMarkup(props.children as ReactNode, color);
  if (typeof node.type === "function") return svgMarkup((node.type as (p: unknown) => ReactNode)(props), color);
  if (typeof node.type !== "string") return "";
  const attrs: Record<string, string> = {};
  let own = color;
  for (const cls of String(props.className ?? "").split(/\s+/)) {
    if (THEME[cls]?.color) own = THEME[cls].color!;
    if (THEME[cls]?.fill) attrs.fill = THEME[cls].fill!;
  }
  for (const [k, v] of Object.entries(props)) {
    if (k === "children" || k === "className" || v == null || v === false || typeof v === "object" || typeof v === "function") continue;
    attrs[CAMEL.has(k) || k.includes("-") ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)] = v === "currentColor" ? own : String(v);
  }
  if (node.type === "svg") attrs.xmlns = "http://www.w3.org/2000/svg";
  const open = `<${node.type}${Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("")}`;
  const inner = svgMarkup(props.children as ReactNode, own);
  return inner ? `${open}>${inner}</${node.type}>` : `${open}/>`;
}

/** A sketch as a picture, at the size it's drawn (its viewBox). */
function figure(el: ReactElement): Figure {
  const svg = svgMarkup(el);
  const box = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const [width, height] = box ? [Number(box[1]), Number(box[2])] : [520, 380];
  return { kind: "image", width, height, svg: svg.replace("<svg ", `<svg width="${width}" height="${height}" font-family="Helvetica, Arial, sans-serif" `) };
}

export const cipFigures = (i: CipInputs) => ({ section: figure(<CipSketch inputs={i} result={designCipWall(i)} />) });

export const mseFigures = (i: MseInputs) => ({ section: figure(<MseSketch inputs={i} result={designMseWall(i)} />) });

export function cbcFigures(i: CbcInputs) {
  const r = designCbc(i);
  return { section: figure(<CbcSketch inputs={i} result={r} moments={false} />), moments: figure(<CbcSketch inputs={i} result={r} moments />) };
}

export const bearingFigures = (i: BearingInputs) => ({ section: figure(<BearingSketch inputs={i} result={designBearing(i)} />) });

export const wingwallFigures = (i: WingwallInputs) => ({ section: figure(<WingwallSketch inputs={i} result={designWingwall(i)} />) });
