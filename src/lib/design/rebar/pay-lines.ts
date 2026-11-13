import { payItem, type QuantityRole } from "./cdot-items";
import type { Schedule } from "./schedule";

// A design's quantities as pay item lines (CDOT item number, description, pay unit, quantity),
// for its project's line items.

export type PayLine = { code: string; description: string; unit: string; quantity: number; role: QuantityRole };

/** A quantity as CDOT's summaries of quantities carry it: concrete to the tenth of a cubic yard, bars to the nearest 10 lb, the rest whole. */
export function roundFor(unit: string, v: number) {
  const step = unit === "CY" ? 0.1 : unit === "LB" ? 10 : 1;
  return Number((Math.round(v / step) * step).toFixed(1));
}

/** The chosen pay item if it's one the tool allows, else the tool's default. */
function pick(chosen: string | undefined, allowed: string[] | undefined) {
  if (!allowed?.length) return null;
  return payItem(chosen && allowed.includes(chosen) ? chosen : allowed[0]);
}

/** A detailed design's concrete and reinforcing steel as pay lines. */
export function designPayLines(sch: Schedule, chosen: { concrete?: string; rebar?: string }, allowed: Partial<Record<QuantityRole, string[]>>): PayLine[] {
  const lines: PayLine[] = [];
  const concrete = pick(chosen.concrete, allowed.concrete);
  if (concrete && sch.concreteTotal > 0) lines.push({ ...concrete, quantity: roundFor(concrete.unit, sch.concreteTotal), role: "concrete" });
  const rebar = pick(chosen.rebar, allowed.rebar);
  if (rebar && sch.total > 0) lines.push({ ...rebar, quantity: roundFor(rebar.unit, sch.total), role: "rebar" });
  return lines;
}
