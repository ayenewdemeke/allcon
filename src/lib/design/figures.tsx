import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { BearingSketch } from "@/components/design/bearing-sketch";
import { DeckSketch } from "@/components/design/deck-sketch";
import { CollisionSketch } from "@/components/design/collision-sketch";
import { DtSectionSketch } from "@/components/design/dt-section-sketch";
import { BrrComparisonTable, RatingSummaryTable } from "@/components/design/dt-summary-sketch";
import { GirderElevation, GirderSketch, HandlingSketch } from "@/components/design/girder-sketch";
import { HaunchSketch } from "@/components/design/haunch-sketch";
import { BridgeSectionSketch } from "@/components/design/bridge-section-sketch";
import { GirderScheduleSketch } from "@/components/design/girder-schedule-sketch";
import { girderSchedule } from "./girders/schedule";
import { SignSketch } from "@/components/design/sign-sketch";
import { StmSketch } from "@/components/design/stm-sketch";
import { CapDetailSketch } from "@/components/design/cap-detail-sketch";
import { DetailSketch } from "@/components/design/detail-sketch";
import type { Takeoff } from "./takeoff/types";
import { ApproachSlabSketch } from "@/components/design/approach-slab-sketch";
import { BridgePlan, BridgeProfile } from "@/components/design/bridge-sketch";
import type { BridgeInputs, BridgeLayout } from "./bridge/bridge";
import { FoundationSketch, LateralPlot } from "@/components/design/foundation-sketch";
import type { FoundationKind } from "./foundations/kinds";
import { runFoundation } from "./foundations/run";
import { designApproachSlab, type ApproachSlabInputs } from "./approach/approach-slab";
import { StripSealSketch } from "@/components/design/strip-seal-sketch";
import { CbcSketch, CipSketch, MseSketch } from "@/components/design/wall-sketch";
import { WingwallSketch } from "@/components/design/wingwall-sketch";
import type { Body } from "@/lib/calcs/library/templates";
import type { ImageRegion } from "@/lib/calcs/types";
import { designBearing, type BearingInputs } from "./bearings/elastomeric";
import { designCbc, type CbcInputs } from "./culverts/cbc";
import { designDeck, type DeckInputs } from "./decks/deck";
import { designStripSeal, type StripSealInputs } from "./joints/strip-seal";
import { designHaunch, type HaunchInputs } from "./girders/haunch";
import { designGirder, spanInputs, type GirderInputs } from "./girders/prestressed";
import { designColumn, type ColumnInputs } from "./piers/column";
import { ColumnSketch } from "@/components/design/column-sketch";
import { designCollision, type CollisionInputs } from "./piers/collision";
import { compareBrr, compareBrrDf } from "./rating/brr";
import { rateDoubleTee, type DtInputs } from "./rating/double-tee";
import { designSign, type SignInputs } from "./signs/cantilever";
import type { StmResult } from "./stm/strut-tie";
import type { CapDetail } from "./stm/detail";
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

export const deckFigures = (i: DeckInputs) => ({ section: figure(<DeckSketch inputs={i} result={designDeck(i)} />) });

export const columnFigures = (i: ColumnInputs) => ({ section: figure(<ColumnSketch inputs={i} result={designColumn(i)} />) });

export const collisionFigures = (i: CollisionInputs) => ({ section: figure(<CollisionSketch inputs={i} result={designCollision(i)} />) });

export const haunchFigures = (i: HaunchInputs) => ({ section: figure(<HaunchSketch inputs={i} result={designHaunch(i)} />) });

export function girderFigures(i: GirderInputs) {
  const d = designGirder(i);
  const si = spanInputs(i, d.controllingSpan); // the worked-out span (its own strands)
  // The schedule's elevation: the controlling span's girder as the schedule lists it.
  const sch = girderSchedule(i, d);
  const row = sch.rows.find((x) => x.span === d.controllingSpan + 1 && x.side === d.controlling) ?? sch.rows[0];
  const schedule = figure(<GirderScheduleSketch inputs={spanInputs(i, row.span - 1)} shape={d.spans[row.span - 1][row.side].shape} span={row.span} />);
  return { schedule, bridge: figure(<BridgeSectionSketch inputs={i} />), section: figure(<GirderSketch inputs={si} result={d[d.controlling]} />), elevation: figure(<GirderElevation inputs={si} result={d[d.controlling]} />), ...(d[d.controlling].handling ? { handling: figure(<HandlingSketch inputs={si} result={d[d.controlling]} />) } : {}) };
}

export const signFigures = (i: SignInputs) => ({ section: figure(<SignSketch inputs={i} result={designSign(i)} />) });

export function dtFigures(i: DtInputs) {
  const r = rateDoubleTee(i);
  const title = `Rating summary (LFR): ${i.bridge.id || "the bridge"}${i.bridge.facility ? `, ${i.bridge.facility}` : ""}`;
  let comparison: Figure | undefined;
  if (i.brrResults.trim()) {
    try {
      const cmp = compareBrr(r, i.brrResults);
      const df = compareBrrDf(i, r);
      const source = i.brrResults.split(/\r?\n/).find((l) => l.startsWith("# From BrR:"))?.replace(/^#\s*/, "") ?? "Pasted from BrR";
      if (cmp.done.length || df.length) comparison = figure(<BrrComparisonTable cmp={cmp} df={df} source={source} />);
    } catch {
      // BrR's table can't be read: the calc goes without the comparison.
    }
  }
  return { section: figure(<DtSectionSketch inputs={i} layout={r.geo} cg={r.solve.cg} />), summary: figure(<RatingSummaryTable r={r} title={title} />), ...(comparison ? { comparison } : {}) };
}

export const approachSlabFigures = (i: ApproachSlabInputs) => ({ section: figure(<ApproachSlabSketch inputs={i} result={designApproachSlab(i)} />) });

export function foundationFigures(kind: FoundationKind, i: object) {
  const r = runFoundation(kind, i);
  return { section: figure(<FoundationSketch kind={kind} inputs={i as Record<string, unknown>} />), ...(r.lateral ? { lateral: figure(<LateralPlot title={`Lateral analysis: ${r.lateral.title}`} r={r.lateral.r} />) } : {}) };
}

export const stripSealFigures = (i: StripSealInputs) => ({ section: figure(<StripSealSketch inputs={i} result={designStripSeal(i)} />) });

/** The strut-and-tie model, from its solved result (the solve is asynchronous, so it's done first). */
export const stmFigures = (r: StmResult) => ({ model: figure(<StmSketch result={r} />) });

/** A take-off's views, each a picture. */
export const takeoffFigures = (t: Takeoff) => t.views.map((v) => figure(<DetailSketch view={v} schedule={t.schedule} />));

/** A standard cap's reinforcement: elevation and sections. */
export const capDetailFigures = (d: CapDetail) => ({ details: figure(<CapDetailSketch detail={d} />) });

/** The Bridge's plan and profile, as the editor draws them. */
export const bridgeFigures = (b: BridgeInputs, lay: BridgeLayout) => ({ plan: figure(<BridgePlan b={b} lay={lay} />), profile: figure(<BridgeProfile b={b} lay={lay} />) });
