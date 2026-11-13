import type { Pt } from "../stm/geometry";
import { agencyOf, isPayCode, type Agency, type QuantityRole } from "../rebar/cdot-items";
import type { Schedule } from "../rebar/schedule";

// A design's take-off: its bars detailed (a schedule), its other quantities by pay item role, the
// views that show them, and notes. Shared by the design tools; each builds its own.

/** A view of the detailing, in inches (y up): concrete outlines, bars as lines, bars end-on as dots, callouts. */
export type DetailView = {
  title: string;
  polys: { pts: Pt[]; style: "concrete" | "void" | "earth" | "dashed" }[];
  lines: { pts: Pt[]; mark: string; kind?: "main" | "secondary" | "stirrup" }[];
  dots: { x: number; y: number; d: number; mark: string }[];
  labels?: { x: number; y: number; text: string; anchor?: "start" | "middle" | "end" }[];
};

/** A quantity besides the concrete and bars; `math`, when given, is how the quantity sheet works it out (LaTeX in the pay unit's dimension), `ref` the note beside it. */
export type TakeoffQuantity = { value: number; basis: string; math?: string; terms?: string[]; ref?: string }; // `terms`: summands spread over lines as needed

export type Takeoff = {
  what: string; // "single-cell box culvert", for the line items' heading
  schedule: Schedule;
  quantities: Partial<Record<QuantityRole, TakeoffQuantity>>; // concrete and rebar come from the schedule
  views: DetailView[];
  notes: string[];
  length?: { label: string; value: number; unit: "ft" | "EA" }; // what the per-foot design is multiplied by
  fields?: { key: "ground" | "angle"; label: string; unit: string; value: number; step?: number; hint?: string }[]; // other site inputs it uses
};

/** The design kinds with a take-off in takeoff/tools.ts (the STM caps have their own, in stm/detail.ts). */
export const TAKEOFF_KINDS = ["box-culvert", "cip-cantilever-wall", "cantilever-wingwall", "deck-slab", "mse-wall", "pier-column", "sign-cantilever", "lrfd-girder-check", "elastomeric-bearing", "ptfe-bearing", "strip-seal-joint", "approach-slab", "spread-footing", "pile-foundation", "drilled-shaft", "micropile", "abutment"];

/** What a design keeps about its take-off: the length it covers, whose pay items (and which), and its line items' heading. */
export type TakeoffSettings = { length?: number; ground?: number; angle?: number; agency?: Agency; items?: Partial<Record<QuantityRole, string>>; headingId?: string | null };

export function takeoffSettings(v: unknown): TakeoffSettings | undefined {
  if (!v || typeof v !== "object") return undefined;
  const s = v as Record<string, unknown>;
  const items: Partial<Record<QuantityRole, string>> = {};
  if (s.items && typeof s.items === "object") for (const [k, c] of Object.entries(s.items as Record<string, unknown>)) if (isPayCode(c)) items[k as QuantityRole] = c;
  return {
    ...(typeof s.length === "number" && Number.isFinite(s.length) && s.length > 0 ? { length: Math.min(s.length, 100000) } : {}),
    ...(typeof s.ground === "number" && Number.isFinite(s.ground) && s.ground >= 0 ? { ground: Math.min(s.ground, 1000) } : {}),
    ...(typeof s.angle === "number" && Number.isFinite(s.angle) && s.angle >= 30 && s.angle <= 90 ? { angle: s.angle } : {}),
    agency: agencyOf(s.agency),
    items,
    headingId: typeof s.headingId === "string" ? s.headingId : null,
  };
}
