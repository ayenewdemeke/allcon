import type { Line } from "@/lib/calcs/library/templates";
import type { Figure } from "../figures";
import { quantityLines, scheduleTable } from "../rebar/schedule";
import { checksSummary } from "../checks-summary";
import { agencyOf, payItem, toolPayItems, type QuantityRole } from "../rebar/cdot-items";
import { designPayLines, roundFor, type PayLine } from "../rebar/pay-lines";
import { capEarthwork, detailCap, type CapDetail, type CapEarthwork } from "./detail";
import { sectionalDesign } from "./sectional";
import { sectionalCalcLines } from "./sectional-calc";
import type { StmInputs, StmResult } from "./strut-tie";
import { stmCalcLines } from "./strut-tie-calc";

// A strut-and-tie design's calc package: the STM calculations, then for a standard cap the
// sectional design of its B-Regions (when asked for) and its reinforcement details and bar
// schedule; and its quantity sheet on its own.

/** The cap's details, or null where the model isn't from a standard cap (or can't be detailed). */
export function capDetailOrNull(i: StmInputs): CapDetail | null {
  if (!i.template) return null;
  try {
    return detailCap(i);
  } catch {
    return null;
  }
}

export function stmPackageLines(i: StmInputs, r: StmResult, title: string, figures?: { model?: Figure; details?: Figure }): Line[] {
  const lines = stmCalcLines(i, r, title, figures);
  const sectional = i.template && i.sectional ? sectionalDesign(i, r) : null;
  if (sectional) lines.push(...sectionalCalcLines(i, sectional));
  // The summary of the checks, after the details appendix (pushed below).
  const summary = checksSummary([{ title: sectional ? "Strut-and-tie model" : undefined, checks: r.checks }, ...(sectional ? [{ title: "Sectional design of the B-Regions", checks: sectional.checks }] : [])]);
  const d = capDetailOrNull(i);
  if (d) {
    lines.push({ text: "Reinforcement details", style: "subheading", newPage: true, keepWithNext: true });
    lines.push({ text: "The bars of the design, detailed: elevation and sections, and the bar schedule. Bar lengths are out-to-out dimensions with standard hooks (AASHTO 5.10.2.1), rounded down to the inch; laps are Class B (AASHTO 5.10.8.4.3a)." });
    if (figures?.details) lines.push({ region: figures.details });
    lines.push({ text: "Bar schedule", style: "note", keepWithNext: true });
    lines.push(...scheduleTable(d.schedule));
    for (const n of d.notes) lines.push({ text: n, style: "note" });
  }
  lines.push(...summary);
  return lines;
}

/**
 * The cap's pay lines: its concrete and bars, and its structure excavation and backfill by
 * M-206-2 (two quantities under one pay item add up), with each earthwork line's basis.
 */
export function stmPayLines(i: StmInputs, d: CapDetail): { lines: PayLine[]; bases: Record<string, string>; earth: CapEarthwork } {
  const allowed = toolPayItems("stm-d-region", agencyOf(i.payItems?.agency));
  const chosen: Partial<NonNullable<StmInputs["payItems"]>> = i.payItems ?? {};
  const lines = designPayLines(d.schedule, chosen, allowed);
  const earth = capEarthwork(i.template!, chosen.ground);
  const bases: Record<string, string> = {};
  for (const [role, q] of Object.entries(earth.quantities) as [QuantityRole, { value: number; basis: string }][]) {
    if (!(q.value > 0)) continue;
    const list = allowed[role] ?? [];
    const pick = (chosen as Record<string, unknown>)[role];
    const p = payItem(typeof pick === "string" && list.includes(pick) ? pick : list[0]);
    if (!p) continue;
    const same = lines.find((l) => l.code === p.code);
    if (same) {
      same.quantity = roundFor(p.unit, same.quantity + q.value);
      bases[p.code] = `${bases[p.code]}; and ${q.basis}`;
    } else {
      lines.push({ ...p, quantity: roundFor(p.unit, q.value), role });
      bases[p.code] = q.basis;
    }
  }
  return { lines, bases, earth };
}

export const capWhat = (i: StmInputs) => (i.template!.kind === "hammerhead" ? "hammerhead pier cap" : i.template!.kind === "abutment" ? "abutment cap" : i.template!.kind === "inverted-t" ? "inverted-T bent cap" : "bent cap");

export function stmQuantityLines(i: StmInputs, title: string, figures?: { details?: Figure }): Line[] {
  const d = detailCap(i);
  const what = capWhat(i);
  const { lines: pay, bases } = stmPayLines(i, d);
  const lines = quantityLines(title, d.schedule, `Purpose:- The quantities of the ${what} as detailed, for the estimate, under ${agencyOf(i.payItems?.agency) === "cdot" ? "CDOT's pay items" : "generic (CSI MasterFormat) pay items"}.`, { location: `${title} (${what})`, lines: pay, bases });
  if (figures?.details) lines.splice(3, 0, { text: "The bars as detailed:", style: "note", keepWithNext: true }, { region: figures.details });
  for (const n of d.notes) lines.push({ text: n, style: "note" });
  return lines;
}
