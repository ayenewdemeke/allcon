import { payItem, toolPayItems, TOOL_PAY_ITEMS, type Agency, type QuantityRole } from "../rebar/cdot-items";
import { roundFor, type PayLine } from "../rebar/pay-lines";
import type { CbcInputs } from "../culverts/cbc";
import type { DeckInputs } from "../decks/deck";
import { railDef } from "../decks/rails";
import type { GirderInputs } from "../girders/prestressed";
import type { ColumnInputs } from "../piers/column";
import { columnTakeoff as pierColumnTakeoff } from "../piers/column-detail";
import type { SignInputs } from "../signs/cantilever";
import type { ApproachSlabInputs } from "../approach/approach-slab";
import { approachSlabTakeoff } from "../approach/approach-slab-detail";
import type { AbutmentInputs } from "../foundations/abutment";
import { abutmentTakeoff, footingTakeoff, micropileTakeoff, pileTakeoff, shaftTakeoff as drilledShaftTakeoff } from "../foundations/detail";
import type { FootingInputs } from "../foundations/footing";
import { HP_PAY_ITEM } from "../foundations/hpile";
import type { MicropileInputs } from "../foundations/micropile";
import type { PileInputs } from "../foundations/piles";
import type { ShaftInputs } from "../foundations/shaft";
import type { StripSealInputs } from "../joints/strip-seal";
import type { CipInputs } from "../walls/cip";
import type { MseInputs } from "../walls/mse";
import type { WingwallInputs } from "../walls/wingwall";
import { bearingTakeoff, cipWallTakeoff, culvertTakeoff, deckTakeoff, girderTakeoff, jointTakeoff, mseTakeoff, shaftTakeoff, wingwallTakeoff } from "./tools";
import type { Takeoff, TakeoffSettings } from "./types";

export * from "./types";

/** A design's take-off, from its inputs and its take-off settings; null for a kind without one. */
export function takeoffFor(kind: string, inputs: unknown, s?: TakeoffSettings): Takeoff | null {
  const L = s?.length;
  switch (kind) {
    case "box-culvert":
      return culvertTakeoff(inputs as CbcInputs, L ?? 40, { ground: s?.ground, angle: s?.angle });
    case "cip-cantilever-wall":
      return cipWallTakeoff(inputs as CipInputs, L ?? 50, { ground: s?.ground });
    case "cantilever-wingwall":
      return wingwallTakeoff(inputs as WingwallInputs);
    case "deck-slab":
      return deckTakeoff(inputs as DeckInputs, L ?? 100);
    case "mse-wall":
      return mseTakeoff(inputs as MseInputs, L ?? 100);
    case "pier-column":
      return pierColumnTakeoff(inputs as ColumnInputs, L);
    case "sign-cantilever":
      return shaftTakeoff(inputs as SignInputs);
    case "lrfd-girder-check":
      return girderTakeoff(inputs as GirderInputs, L);
    case "elastomeric-bearing":
    case "ptfe-bearing":
      return bearingTakeoff(Math.max(1, Math.round(L ?? 1)));
    case "approach-slab":
      return approachSlabTakeoff(inputs as ApproachSlabInputs, L ?? 2);
    case "spread-footing":
      return footingTakeoff(inputs as FootingInputs);
    case "pile-foundation":
      return pileTakeoff(inputs as PileInputs);
    case "drilled-shaft":
      return drilledShaftTakeoff(inputs as ShaftInputs);
    case "micropile":
      return micropileTakeoff(inputs as MicropileInputs, L ?? 1);
    case "abutment":
      return abutmentTakeoff(inputs as AbutmentInputs);
    case "strip-seal-joint":
      return jointTakeoff(inputs as StripSealInputs, L ?? 40);
    default:
      return null;
  }
}

/** The pay item a shaft or girder quantity defaults to, from its size or shape (the code book's item, where there is one). */
function defaultFor(kind: string, role: QuantityRole, inputs: unknown): string | undefined {
  if (!inputs) return undefined;
  if (kind === "sign-cantilever" && role === "shaft") {
    const d = (inputs as SignInputs).shaftD;
    const code = `503-000${Math.round(d)}`;
    return payItem(code) ? code : undefined;
  }
  if ((kind === "pile-foundation" || kind === "abutment") && role === "pile") return HP_PAY_ITEM[(inputs as PileInputs).section];
  if ((kind === "drilled-shaft" || kind === "abutment") && role === "shaft") {
    const code = `503-000${Math.round(kind === "abutment" ? (inputs as AbutmentInputs).shaftD : (inputs as ShaftInputs).D)}`;
    return payItem(code) ? code : undefined;
  }
  if (kind === "micropile" && role === "micropile") {
    const d = Math.round((inputs as MicropileInputs).casingOD);
    const code = d >= 10 ? "503-01100" : `503-010${Math.min(8, Math.max(6, d))}0`;
    return payItem(code) ? code : undefined;
  }
  if ((kind === "deck-slab" || kind === "lrfd-girder-check") && role === "rail") {
    const r = railDef((inputs as DeckInputs | GirderInputs).rail?.type ?? "custom");
    return r?.payItem;
  }
  if (kind === "lrfd-girder-check" && role === "girder" && (inputs as GirderInputs).shape?.startsWith("box-")) {
    const depth = Number((inputs as GirderInputs).shape.slice(4).split("x")[0]);
    return depth < 32 ? "618-01992" : depth <= 48 ? "618-01994" : "618-01995";
  }
  if (kind === "lrfd-girder-check" && role === "girder") {
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9.]/g, "");
    const shape = norm((inputs as GirderInputs).shape);
    return (TOOL_PAY_ITEMS[kind].girder ?? []).find((c) => norm(payItem(c)!.description.match(/\(([^)]+)\)/)?.[1] ?? "") === shape);
  }
  return undefined;
}

/** A generic pay item's description with what the agency's item number would carry: a shaft's diameter, a girder's shape. */
function genericDescription(kind: string, role: QuantityRole, description: string, inputs: unknown) {
  if (!inputs) return description;
  if (kind === "sign-cantilever" && role === "shaft") return `${description} (${Math.round((inputs as SignInputs).shaftD)} in)`;
  if (kind === "lrfd-girder-check" && role === "girder") return `${description} (${(inputs as GirderInputs).shape})`;
  return description;
}

/**
 * A take-off's quantities as pay lines: each role with a quantity, under the chosen (or default) pay
 * item of the agency (generic MasterFormat items unless the design's take-off says CDOT).
 */
export function takeoffPayLines(kind: string, t: Takeoff, chosen: Partial<Record<QuantityRole, string>> = {}, inputs?: unknown, agency: Agency = "generic"): PayLine[] {
  const allowed = toolPayItems(kind, agency);
  const values: Partial<Record<QuantityRole, number>> = {};
  if (t.schedule.concreteTotal > 0) values.concrete = t.schedule.concreteTotal;
  if (t.schedule.total > 0) values.rebar = t.schedule.total;
  for (const [role, q] of Object.entries(t.quantities)) if (q && q.value > 0) values[role as QuantityRole] = q.value;
  const lines: PayLine[] = [];
  for (const [role, value] of Object.entries(values) as [QuantityRole, number][]) {
    const list = allowed[role];
    if (!list?.length) continue;
    const want = chosen[role] && list.includes(chosen[role]!) ? chosen[role] : ((agency === "cdot" ? defaultFor(kind, role, inputs) : undefined) ?? list[0]);
    const p = payItem(want!);
    if (p) lines.push({ ...p, ...(agency === "generic" ? { description: genericDescription(kind, role, p.description, inputs) } : {}), quantity: roundFor(p.unit, value), role });
  }
  return lines;
}
