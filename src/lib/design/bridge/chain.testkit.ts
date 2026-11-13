import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem } from "@/lib/calcs/evaluate";
import { layout, type Line } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { designApproachSlab, type ApproachSlabInputs } from "../approach/approach-slab";
import { approachSlabCalcLines } from "../approach/approach-slab-calc";
import { designBearing, type BearingInputs } from "../bearings/elastomeric";
import { bearingCalcLines } from "../bearings/elastomeric-calc";
import type { SummaryGroup } from "../checks-summary";
import { designDeck, type DeckInputs } from "../decks/deck";
import { deckCalcLines } from "../decks/deck-calc";
import type { AbutmentInputs } from "../foundations/abutment";
import { foundationCalcLines } from "../foundations/calc";
import { abutmentInputs, shaftInputs } from "../foundations/kinds";
import { runFoundation } from "../foundations/run";
import type { ShaftInputs } from "../foundations/shaft";
import type { GirderInputs } from "../girders/prestressed";
import { girderCalcLines } from "../girders/prestressed-calc";
import { approachSlabInputs, bearingInputs, deckInputs, wingwallInputs } from "../kinds";
import { columnInputs, designColumn, type ColumnInputs } from "../piers/column";
import { columnCalcLines } from "../piers/column-calc";
import { columnLinkFrom } from "../piers/column-link";
import { roundFor, type PayLine } from "../rebar/pay-lines";
import { nodeLpSolver } from "../stm/lp-node";
import { capDetailOrNull, stmPackageLines, stmPayLines } from "../stm/package";
import { designStm, stmInputs } from "../stm/strut-tie";
import { MULTICOLUMN_DEFAULTS } from "../stm/templates";
import { takeoffFor, takeoffPayLines } from "../takeoff";
import { designWingwall } from "../walls/wingwall";
import { wingwallCalcLines } from "../walls/wingwall-calc";
import { runBridge, type BridgeInputs } from "./bridge";
import { bridgeCalcLines, soqRows, type CalcPart, type PayColumn, type SupportCalc } from "./calc";
import { bridgeIfc } from "./ifc";
import { abutmentFromBridge, approachSlabFromBridge, bearingFromBridge, capFromBridge, columnFromBridge, deckFromBridge, deckLengthFor, shaftFromColumn, wingwallFromBridge } from "./loadpath";
import { renderBridgeSvg } from "./render3d";

// A whole bridge through the Bridge, for the tests of real bridges: every component designed from its load
// path with the bridge's own details, the calc package built, the quantities by pay item.

export type ChainSpec = {
  title: string;
  b: BridgeInputs;
  girder: GirderInputs;
  pad: Partial<BearingInputs>;
  deck?: Partial<DeckInputs>;
  /** Each abutment's details (support index → its inputs over the Bridge's). */
  abutment: (support: number) => Partial<AbutmentInputs>;
  approach?: Partial<ApproachSlabInputs>;
  cap?: { topBars: { size: number; count: number }; bottomBars: { size: number; count: number }; stirrups: { size: number; legs: number; spacing: number }; diaphragmTop: { size: number; count: number } | null };
  column?: Partial<ColumnInputs>;
  shaft?: Partial<ShaftInputs>;
};

const pays = (kind: string, inputs: unknown, settings?: { length?: number }) => {
  const t = takeoffFor(kind, inputs, settings);
  return t ? takeoffPayLines(kind, t, {}, inputs, "cdot") : [];
};
const scaled = (lines: PayLine[], k: number) => lines.map((l) => ({ ...l, quantity: roundFor(l.unit, l.quantity * k) }));
export const verdict = (g: SummaryGroup[]) => {
  const c = g.flatMap((x) => x.checks).filter((x) => !x.advisory);
  return { n: c.length, fail: c.filter((x) => !x.ok).map((x) => `${x.name} (${x.capacity > 0 ? (x.demand / x.capacity).toFixed(2) : "—"})`) };
};

export async function buildChain(spec: ChainSpec) {
  const b = spec.b;
  const run = runBridge(b, [spec.girder]);
  const g = run.groups[0].inputs;
  const superParts: CalcPart[] = [];
  const deck = { ...deckFromBridge(b, run, deckInputs({}), { id: "g", name: "Girders" }), ...(spec.deck ?? {}) };
  superParts.push({ label: "Deck, overhang and rail", name: `${spec.title} deck`, lines: deckCalcLines(deck, `${spec.title} deck`), checks: [{ checks: designDeck(deck).checks }] });
  const gr = run.groups[0].result;
  superParts.push({
    label: `Girders, spans 1–${b.supports.length - 1}`,
    name: `${spec.title} girders`,
    lines: girderCalcLines(g, `${spec.title} girders`),
    checks: [...gr.spans.flatMap((s) => [s.interior, s.exterior].map((x) => ({ title: `span ${s.index + 1} ${x.exterior ? "exterior" : "interior"}`, checks: x.checks }))), ...gr.piers.flatMap((p) => (["interior", "exterior"] as const).map((side) => ({ title: `pier ${p.index} ${side}`, checks: p[side].checks })))],
  });
  const last = b.supports.length - 1;
  const abut = (k: number): AbutmentInputs => ({ ...abutmentInputs({}), ...spec.abutment(k) }) as AbutmentInputs;
  const deckFt = deckLengthFor(b, [abut(0), abut(last)]);
  const pay: PayColumn[] = [{ label: "Superstructure", lines: [...pays("lrfd-girder-check", g, { length: deckFt }), ...pays("deck-slab", { ...deck, fromGirder: { id: "g", name: "Girders" } }, { length: deckFt })] }];
  const approachPay: PayLine[] = [];
  const supports: SupportCalc[] = [];
  for (let k = 0; k < b.supports.length; k++) {
    const s = b.supports[k];
    const parts: CalcPart[] = [];
    const sPay: PayLine[] = [];
    const br = { ...bearingFromBridge(b, run, k, bearingInputs({})), ...spec.pad };
    parts.push({ label: "Bearings", name: `${s.name} bearings`, lines: bearingCalcLines(br, `${s.name} bearings`), checks: [{ checks: designBearing(br).checks }] });
    sPay.push(...pays("elastomeric-bearing", br, { length: b.nGirders * (k === 0 || k === last ? 1 : 2) }));
    if (s.type.endsWith("abutment")) {
      const a = { ...abutmentFromBridge(b, run, k, abutmentInputs({})), ...spec.abutment(k) } as AbutmentInputs;
      const ar = runFoundation("abutment", a);
      parts.push({ label: "Abutment", name: s.name, lines: foundationCalcLines("abutment", a, s.name), checks: ar.groups.map((x) => ({ title: x.title, checks: ar.checks.filter((c) => x.of(c.id)) })) });
      sPay.push(...pays("abutment", a));
      const w = wingwallFromBridge(b, k, a, wingwallInputs({}));
      parts.push({ label: "Wingwalls", name: `${s.name} wingwall`, lines: wingwallCalcLines(w, `${s.name} wingwall`), checks: [{ checks: designWingwall(w).checks }] });
      sPay.push(...scaled(pays("cantilever-wingwall", w), 2));
      const ap: ApproachSlabInputs = { ...approachSlabFromBridge(b, k, approachSlabInputs({})), ...(spec.approach ?? {}) };
      parts.push({ label: "Approach slab", name: `${s.name} approach slab`, lines: approachSlabCalcLines(ap, `${s.name} approach slab`), checks: [{ checks: designApproachSlab(ap).checks }] });
      approachPay.push(...pays("approach-slab", ap, { length: 1 }));
    } else {
      const c = spec.cap;
      const cap = capFromBridge(b, run, k, stmInputs(c ? { template: { ...MULTICOLUMN_DEFAULTS, topBars: c.topBars, bottomBars: c.bottomBars, stirrups: c.stirrups }, stages: { enabled: true, diaphragmHeight: 0, topBars: c.diaphragmTop } } : {}), ["g"], ["Girders"]);
      const r = await designStm(cap, nodeLpSolver);
      parts.push({ label: "Pier cap", name: `${s.name} cap`, lines: stmPackageLines(cap, r, `${s.name} cap`), checks: [{ checks: r.checks }] });
      const det = capDetailOrNull(cap);
      if (det) sPay.push(...stmPayLines({ ...cap, payItems: { concrete: "601-03040", rebar: "602-00020", ...cap.payItems, agency: "cdot" } }, det).lines);
      const nCols = s.pier ? (s.pier.kind === "hammerhead" ? 1 : s.pier.columns) : 1;
      const col = { ...columnFromBridge(b, run, k, columnInputs({}), columnLinkFrom("cap", `${s.name} cap`, cap, new Map([["g", g]]))), ...(spec.column ?? {}) };
      const cr = designColumn(col);
      parts.push({ label: "Columns", name: `${s.name} columns`, lines: columnCalcLines(col, `${s.name} columns`), checks: [{ checks: cr.checks }] });
      sPay.push(...pays("pier-column", col, { length: nCols }));
      const sh = { ...shaftFromColumn(cr, shaftInputs({})), ...(spec.shaft ?? {}) } as ShaftInputs;
      const sr = runFoundation("drilled-shaft", sh);
      parts.push({ label: `Drilled shafts, each of ${nCols}`, name: `${s.name} shafts`, lines: foundationCalcLines("drilled-shaft", sh, `${s.name} shafts`), checks: sr.groups.map((x) => ({ title: x.title, checks: sr.checks.filter((cc) => x.of(cc.id)) })) });
      sPay.push(...scaled(pays("drilled-shaft", sh), nCols));
    }
    supports.push({ name: s.name, type: s.type, parts });
    pay.push({ label: s.name, lines: sPay });
  }
  pay.push({ label: "Approach slabs", lines: approachPay });
  const m = bridgeIfc(b, run);
  const svg = renderBridgeSvg(m, { width: 720, height: 400 });
  const lines: Line[] = bridgeCalcLines({ title: spec.title, b, run, figures: { render: { kind: "image", width: 720, height: 400, svg } }, superstructure: superParts, supports, pay, tabulations: [], missing: [] });
  const verdicts = Object.fromEntries([...superParts, ...supports.flatMap((s) => s.parts.map((x) => ({ ...x, label: `${s.name}, ${x.label}` })))].map((p) => [p.label, verdict(p.checks)]));
  return { run, lines, pay, rows: soqRows(pay), verdicts, deckFt, m };
}

/** The package worked out as one worksheet: its errors and size. */
export function workOut(lines: Line[]) {
  const regions = readingOrder(layout(lines, { x: 0, y: 0 }));
  const items = regions.flatMap((x): SheetItem[] => (x.kind === "text" || x.kind === "image" ? [] : [x as SheetItem]));
  const res = evaluateSheet(items, DEFAULT_SETTINGS, new Map());
  return { regions: regions.length, errors: regions.flatMap((x) => (res.get(x.id)?.kind === "error" ? [x.kind === "math" ? x.latex.slice(0, 50) : x.kind] : [])) };
}
