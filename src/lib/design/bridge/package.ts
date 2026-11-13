import "server-only";
import type { Line } from "@/lib/calcs/library/templates";
import { db } from "@/lib/db";
import { designApproachSlab } from "../approach/approach-slab";
import { approachSlabCalcLines } from "../approach/approach-slab-calc";
import { designBearing } from "../bearings/elastomeric";
import { bearingCalcLines } from "../bearings/elastomeric-calc";
import type { SummaryGroup } from "../checks-summary";
import { designDeck } from "../decks/deck";
import { deckCalcLines } from "../decks/deck-calc";
import { approachSlabFigures, bearingFigures, bridgeFigures, capDetailFigures, columnFigures, deckFigures, foundationFigures, girderFigures, stmFigures, wingwallFigures, type Figure } from "../figures";
import { foundationCalcLines } from "../foundations/calc";
import { foundationInputs, type FoundationKind } from "../foundations/kinds";
import { runFoundation } from "../foundations/run";
import { designGirder, type GirderInputs } from "../girders/prestressed";
import { girderCalcLines } from "../girders/prestressed-calc";
import { approachSlabInputs, bearingInputs, deckInputs, girderInputs, wingwallInputs } from "../kinds";
import { columnInputs, designColumn } from "../piers/column";
import { columnCalcLines } from "../piers/column-calc";
import { roundFor, type PayLine } from "../rebar/pay-lines";
import { nodeLpSolver } from "../stm/lp-node";
import { capDetailOrNull, stmPackageLines, stmPayLines } from "../stm/package";
import { designStm, stmInputs } from "../stm/strut-tie";
import { takeoffFor, takeoffPayLines, type TakeoffSettings } from "../takeoff";
import { takeoffQuantityLines } from "../takeoff/calc";
import { designWingwall } from "../walls/wingwall";
import { wingwallCalcLines } from "../walls/wingwall-calc";
import type { AbutmentInputs } from "../foundations/abutment";
import { runBridge, spanGroups } from "./bridge";
import { bridgeCalcLines, type CalcPart, type PayColumn, type SupportCalc } from "./calc";
import { bridgeIfc, type BridgeComponents } from "./ifc";
import { bridgeInputs } from "./kinds";
import { deckLengthFor } from "./loadpath";
import { renderBridgeSvg } from "./render3d";

// The Bridge's calc package from the Bridge and every design linked to it (read from the database):
// each component's calc as its tool writes it, its checks for the summaries, its quantities for the
// summary of quantities, and the bridge in 3D for the front page.

const tryFig = <T,>(draw: () => T): T | undefined => {
  try {
    return draw();
  } catch (e) {
    console.error("Could not draw a figure for the Bridge's calc", e);
    return undefined;
  }
};
const scaled = (lines: PayLine[], k: number) => lines.map((l) => ({ ...l, quantity: roundFor(l.unit, l.quantity * k) }));
const aashto = <T extends { ref: string },>(c: T): T => ({ ...c, ref: /^\d|^T\./.test(c.ref) ? `AASHTO ${c.ref}` : c.ref });

export async function bridgePackageLines(design: { id: string; name: string; inputs: unknown }, orgId: string): Promise<Line[]> {
  const b = bridgeInputs(design.inputs);
  const load = async (id: string | null | undefined, kind: string) => (id ? db.design.findFirst({ where: { id, orgId, kind }, select: { id: true, name: true, inputs: true } }) : null);
  const missing: string[] = [];
  const pay: PayColumn[] = [];
  const tabulations: { label: string; lines: Line[] }[] = [];
  const quantities = (kind: string, inputs: unknown, title: string, settings?: TakeoffSettings) => {
    const t = takeoffFor(kind, inputs, settings ?? (inputs as { takeoff?: TakeoffSettings }).takeoff);
    if (!t) return [];
    tabulations.push({ label: title, lines: takeoffQuantityLines(kind, t, title, (inputs as { takeoff?: TakeoffSettings }).takeoff?.items ?? {}, inputs) });
    const own = (inputs as { takeoff?: TakeoffSettings }).takeoff;
    return takeoffPayLines(kind, t, own?.items ?? {}, inputs, own?.agency);
  };

  // The deck's length, back face to back face of the abutments, for the deck's quantities.
  const abutAt = async (k: number) => {
    const d = await load(b.components.find((c) => c.support === k)?.abutmentId, "abutment");
    return d ? (foundationInputs("abutment", d.inputs) as AbutmentInputs) : null;
  };
  const deckFt = deckLengthFor(b, [await abutAt(0), await abutAt(b.supports.length - 1)]);

  // --- superstructure -----------------------------------------------------------------------------------------------
  const groups = spanGroups(b);
  const girderDesigns = await Promise.all(groups.map((_, gi) => load(b.girderDesignIds[gi], "lrfd-girder-check")));
  const bases = girderDesigns.map((d) => (d ? girderInputs(d.inputs) : null));
  const run = runBridge(b, bases);
  const superParts: CalcPart[] = [];
  const superPay: PayLine[] = [];
  const deck = await load(b.deckDesignId, "deck-slab");
  if (deck) {
    const i = deckInputs(deck.inputs);
    superParts.push({ label: "Deck, overhang and rail", name: deck.name, lines: deckCalcLines(i, deck.name, tryFig(() => deckFigures(i))), checks: [{ checks: designDeck(i).checks.map(aashto) }] });
    superPay.push(...quantities("deck-slab", i, `${deck.name} (deck bars)`, { ...(i as { takeoff?: TakeoffSettings }).takeoff, length: deckFt }));
  } else missing.push("the deck, overhang and rail");
  groups.forEach((g, gi) => {
    const d = girderDesigns[gi];
    const label = `Girders, span${g.length > 1 ? "s" : ""} ${g.map((j) => j + 1).join("–")}`;
    if (!d) {
      missing.push(label.toLowerCase());
      return;
    }
    const i: GirderInputs = girderInputs(d.inputs);
    const r = designGirder(i);
    const checks: SummaryGroup[] = [
      ...r.spans.flatMap((s) => [s.interior, s.exterior].map((x) => ({ title: `${r.spans.length > 1 ? `span ${s.index + 1}, ` : ""}${x.exterior ? "exterior" : "interior"} girder`, checks: x.checks.map(aashto) }))),
      ...r.piers.flatMap((p) => (["interior", "exterior"] as const).map((side) => ({ title: `pier ${p.index}, ${side} girders`, checks: p[side].checks.map(aashto) }))),
    ];
    superParts.push({ label, name: d.name, lines: girderCalcLines(i, d.name, tryFig(() => girderFigures(i))), checks });
    // Its deck over its spans: the whole deck when one design carries every span.
    superPay.push(...quantities("lrfd-girder-check", i, d.name, { ...(i as { takeoff?: TakeoffSettings }).takeoff, ...(groups.length === 1 ? { length: deckFt } : {}) }));
  });
  pay.push({ label: "Superstructure", lines: superPay });

  // --- substructure, support by support ----------------------------------------------------------------------------------
  const supports: SupportCalc[] = [];
  const approachPay: PayLine[] = [];
  const comps: BridgeComponents = { abutments: {}, approachSlabs: {}, foundations: {}, deckId: deck?.id ?? null, ids: { girders: b.girderDesignIds, caps: {}, columns: {} } };
  for (let k = 0; k < b.supports.length; k++) {
    const s = b.supports[k];
    const c = b.components.find((x) => x.support === k) ?? { support: k };
    const parts: CalcPart[] = [];
    const sPay: PayLine[] = [];
    const bd = await load(c.bearingId, "elastomeric-bearing");
    if (bd) {
      const i = bearingInputs(bd.inputs);
      parts.push({ label: "Bearings", name: bd.name, lines: bearingCalcLines(i, bd.name, tryFig(() => bearingFigures(i))), checks: [{ checks: designBearing(i).checks.map(aashto) }] });
      sPay.push(...quantities("elastomeric-bearing", i, `${bd.name}`, { length: b.nGirders * (k === 0 || k === b.supports.length - 1 ? 1 : 2) }));
    } else missing.push(`${s.name} bearings`);
    if (s.type.endsWith("abutment")) {
      const ad = await load(c.abutmentId, "abutment");
      if (ad) {
        const i = foundationInputs("abutment", ad.inputs)!;
        const r = runFoundation("abutment", i);
        parts.push({ label: "Abutment", name: ad.name, lines: foundationCalcLines("abutment", i, ad.name, tryFig(() => foundationFigures("abutment", i))), checks: r.groups.map((g) => ({ title: g.title, checks: r.checks.filter((x) => g.of(x.id)) })) });
        sPay.push(...quantities("abutment", i, ad.name));
        comps.abutments![k] = { id: ad.id, inputs: i as never };
      } else missing.push(`${s.name}`);
      const wd = await load(c.wingwallId, "cantilever-wingwall");
      if (wd) {
        const i = wingwallInputs(wd.inputs);
        parts.push({ label: "Wingwalls", name: wd.name, lines: wingwallCalcLines(i, wd.name, tryFig(() => wingwallFigures(i))), checks: [{ checks: designWingwall(i).checks.map(aashto) }] });
        sPay.push(...scaled(quantities("cantilever-wingwall", i, `${wd.name} (each of 2)`), 2));
      } else missing.push(`${s.name} wingwalls`);
      const sd = await load(c.approachSlabId, "approach-slab");
      if (sd) {
        const i = approachSlabInputs(sd.inputs);
        const r = designApproachSlab(i);
        parts.push({ label: "Approach slab", name: sd.name, lines: approachSlabCalcLines(i, sd.name, tryFig(() => approachSlabFigures(i))), checks: [{ checks: r.checks.map(aashto) }] });
        approachPay.push(...quantities("approach-slab", i, sd.name, { ...(i as { takeoff?: TakeoffSettings }).takeoff, length: 1 }));
        comps.approachSlabs![k] = { id: sd.id, inputs: i };
      } else missing.push(`${s.name} approach slab`);
    } else {
      const cd = await load(c.capId, "stm-d-region");
      const nCols = s.pier ? (s.pier.kind === "hammerhead" ? 1 : s.pier.columns) : 1;
      if (cd) {
        const i = stmInputs(cd.inputs);
        const r = await designStm(i, nodeLpSolver);
        const det = capDetailOrNull(i);
        const figs: { model?: Figure; details?: Figure } = { ...(tryFig(() => stmFigures(r)) ?? {}), ...(det ? (tryFig(() => capDetailFigures(det)) ?? {}) : {}) };
        parts.push({ label: "Pier cap (strut-and-tie)", name: cd.name, lines: stmPackageLines(i, r, cd.name, figs), checks: [{ checks: r.checks.map(aashto) }] });
        if (det) sPay.push(...stmPayLines(i, det).lines);
        comps.ids!.caps![k] = cd.id;
      } else missing.push(`${s.name} cap`);
      const col = await load(c.columnId, "pier-column");
      if (col) {
        const i = columnInputs(col.inputs);
        parts.push({ label: `Column${nCols > 1 ? "s" : ""}`, name: col.name, lines: columnCalcLines(i, col.name, tryFig(() => columnFigures(i))), checks: [{ checks: designColumn(i).checks.map(aashto) }] });
        sPay.push(...quantities("pier-column", i, col.name, { length: nCols }));
        comps.ids!.columns![k] = col.id;
      } else missing.push(`${s.name} column`);
      const kind = (s.pier?.foundation ?? c.foundationKind) as FoundationKind | undefined;
      const fd = kind ? await load(c.foundationId, kind) : null;
      if (fd && kind) {
        const i = foundationInputs(kind, fd.inputs)!;
        const r = runFoundation(kind, i);
        parts.push({ label: `Foundation${nCols > 1 ? `, each of ${nCols}` : ""}`, name: fd.name, lines: foundationCalcLines(kind, i, fd.name, tryFig(() => foundationFigures(kind, i))), checks: r.groups.map((g) => ({ title: g.title, checks: r.checks.filter((x) => g.of(x.id)) })) });
        sPay.push(...scaled(quantities(kind, i, `${fd.name}${nCols > 1 ? ` (each of ${nCols})` : ""}`), nCols));
        comps.foundations![k] = { id: fd.id, kind: kind as "spread-footing" | "pile-foundation" | "drilled-shaft", inputs: i as never };
      } else missing.push(`${s.name} foundation`);
    }
    supports.push({ name: s.name, type: s.type, parts });
    pay.push({ label: s.name, lines: sPay });
  }
  if (approachPay.length) pay.push({ label: "Approach slabs", lines: approachPay });

  // The bridge in 3D, and its plan and profile.
  const render = tryFig((): Figure => {
    const svg = renderBridgeSvg(bridgeIfc(b, run, comps, design.name), { width: 720, height: 400 });
    return { kind: "image", width: 720, height: 400, svg };
  });
  const sketches = tryFig(() => bridgeFigures(b, run.layout));
  return bridgeCalcLines({ title: design.name, b, run, figures: { render, plan: sketches?.plan, profile: sketches?.profile }, superstructure: superParts, supports, pay, tabulations, missing });
}
