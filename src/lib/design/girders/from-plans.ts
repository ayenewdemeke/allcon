import { z } from "zod";
import { DesignError } from "../walls/cip";
import { changeShape, designGirder, GIRDER_DEFAULTS, type GirderInputs } from "./prestressed";
import { GIRDER_SHAPES } from "./sections";

// A girder design check started from uploaded plans: the values read off the sheets (each with its
// source), the defaults used where the plans are silent, and what the engineer has confirmed. The
// engine never sees anything but the inputs; this only records where they came from. Stored in the
// design's inputs as `fromPlans`.

export type PlanSource = { sheetId: string; sheet: string; box: [number, number, number, number] | null; lines: string | null };
export type PlanStatus = "read" | "unsure" | "default" | "confirmed" | "edited";
/** value: as read off the plans (or the default); applied: as it went into the inputs, to tell when it's edited. */
export type PlanValue = { input: string; value: unknown; applied?: unknown; status: PlanStatus; source: PlanSource | null; note: string | null };
export type FromPlans = { drawingSet: string | null; values: PlanValue[]; findings: string[] };
const pos = z.number().positive();
const nonneg = z.number().min(0);
const bar = z.number().int().min(3).max(11);
const row = z.object({ y: pos, count: z.number().int().positive(), debonded: z.number().int().min(0).optional(), debondLength: nonneg.optional() });
const zone = z.object({ length: nonneg, bar, legs: z.number().int().positive(), spacing: pos });

/** The inputs the plans can give: label, group, and their schema. "spans" and "stirrupsFromEnd" are converted. */
export const PLAN_INPUTS: Record<string, { label: string; group: string; schema: z.ZodType; hint: string }> = {
  spans: { label: "Spans (bearing to bearing)", group: "Layout", schema: z.array(pos).min(1).max(5), hint: "ft, one per span; more than one: girders made continuous" },
  shape: { label: "Girder section", group: "Girder", schema: z.enum(GIRDER_SHAPES.map((s) => s.id) as [string, ...string[]]), hint: `one of: ${GIRDER_SHAPES.map((s) => s.id).join(", ")}` },
  endDist: { label: "Girder end to bearing CL", group: "Layout", schema: nonneg, hint: "ft" },
  nGirders: { label: "Number of girders", group: "Layout", schema: z.number().int().min(2), hint: "" },
  S: { label: "Girder spacing", group: "Layout", schema: pos, hint: "ft" },
  overhang: { label: "Overhang (exterior girder CL to deck edge)", group: "Layout", schema: nonneg, hint: "ft" },
  barrierWidth: { label: "Deck edge to barrier's inside face", group: "Layout", schema: nonneg, hint: "ft" },
  skew: { label: "Skew", group: "Layout", schema: z.number().min(0).max(70), hint: "degrees" },
  deckT: { label: "Deck thickness, as cast", group: "Deck", schema: pos, hint: "in" },
  sacrificial: { label: "Sacrificial (integral wearing) thickness", group: "Deck", schema: nonneg, hint: "in" },
  haunch: { label: "Haunch at the girder", group: "Deck", schema: nonneg, hint: "in, at the girder's centerline" },
  fcDeck: { label: "Deck f′c", group: "Concrete", schema: pos, hint: "ksi" },
  fci: { label: "Girder f′ci at release", group: "Concrete", schema: pos, hint: "ksi" },
  fc: { label: "Girder f′c", group: "Concrete", schema: pos, hint: "ksi" },
  wc: { label: "Girder unit weight", group: "Concrete", schema: pos, hint: "kcf" },
  strandDia: { label: "Strand size", group: "Strands", schema: z.union([z.literal(0.5), z.literal(0.6)]), hint: "in, 0.5 or 0.6" },
  fpjRatio: { label: "Jacking stress fpj / fpu", group: "Strands", schema: z.number().min(0.5).max(0.8), hint: "" },
  strands: { label: "Straight strand rows", group: "Strands", schema: z.array(row).min(1), hint: "[{ y (in from the girder's bottom), count, debonded?, debondLength? (ft) }]" },
  harped: { label: "Harped strands", group: "Strands", schema: z.object({ count: z.number().int().min(0), yEnd: pos, yHarp: pos, harpPoint: z.number().gt(0).max(0.5) }), hint: "{ count, yEnd and yHarp (in, their centroid at the ends and harp points), harpPoint (× girder length) }" },
  stirrupsFromEnd: { label: "Stirrup zones", group: "Reinforcement", schema: z.array(zone).min(1), hint: "[{ length (ft, from the girder's end; 0 for the last, to midspan), bar, legs, spacing (in) }]" },
  confinement: { label: "Confinement bars", group: "Reinforcement", schema: z.object({ bar, spacing: pos, length: pos }), hint: "{ bar, spacing (in), length (ft from the end) }" },
  barrierWeight: { label: "Barrier weight, each", group: "Loads", schema: nonneg, hint: "klf" },
  fws: { label: "Future wearing surface", group: "Loads", schema: nonneg, hint: "psf" },
  diaphragms: { label: "Intermediate diaphragms per span", group: "Loads", schema: z.number().int().min(0), hint: "" },
  diaphragmWeight: { label: "Diaphragm weight on an interior girder", group: "Loads", schema: nonneg, hint: "kip each" },
  pierBars: { label: "Deck bars over the piers", group: "Continuity", schema: z.object({ topBar: bar, topSpacing: pos, botBar: bar, botSpacing: pos, coverTop: nonneg, coverBottom: nonneg }), hint: "{ topBar, topSpacing, botBar, botSpacing (in), coverTop, coverBottom (in) }" },
  connection: { label: "Positive moment connection", group: "Continuity", schema: z.object({ count: z.number().int().min(0), bar, y: nonneg }), hint: "{ count per girder, bar, y (in above the girder's bottom) }" },
};

/** Inputs the plans don't usually give: filled with the tool's defaults and listed for the engineer. */
export const NOT_ON_PLANS: { input: string; label: string; group: string }[] = [
  { input: "humidity", label: "Relative humidity", group: "Time" },
  { input: "tRelease", label: "Age at release", group: "Time" },
  { input: "tDeck", label: "Age when the deck is cast", group: "Time" },
  { input: "tFinal", label: "Final age", group: "Time" },
  { input: "ag", label: "Maximum aggregate size", group: "Reinforcement" },
  { input: "bearingLength", label: "Bearing length along the girder", group: "Reinforcement" },
  { input: "handling", label: "Lifting and hauling (WSDOT's defaults)", group: "Handling" },
];

export const inputLabel = (input: string) => PLAN_INPUTS[input]?.label ?? NOT_ON_PLANS.find((n) => n.input === input)?.label ?? input;
export const inputGroup = (input: string) => PLAN_INPUTS[input]?.group ?? NOT_ON_PLANS.find((n) => n.input === input)?.group ?? "Other";

/** A value's current setting in the inputs, by its plan name. */
export function currentValue(i: GirderInputs, input: string): unknown {
  if (input === "spans") return [i.L, ...i.extraSpans.map((s) => s.L)];
  if (input === "stirrupsFromEnd") return i.stirrups.map((z, k) => ({ ...z, length: k === 0 ? +(z.length + i.endDist).toFixed(4) : z.length }));
  return (i as unknown as Record<string, unknown>)[input];
}

/** Sets a value read from the plans on the inputs. */
function apply(i: GirderInputs, input: string, value: unknown): GirderInputs {
  if (input === "spans") {
    const [L, ...rest] = value as number[];
    return { ...i, L, extraSpans: rest.map((x) => ({ L: x, strands: null, harped: null })) };
  }
  if (input === "stirrupsFromEnd") {
    // From the girder's end, as plans give them, to zones from the bearing, as the tool takes them.
    const zones = value as GirderInputs["stirrups"];
    let at = 0;
    const out: GirderInputs["stirrups"] = [];
    zones.forEach((z, k) => {
      const end = k === zones.length - 1 || z.length <= 0 ? Infinity : at + z.length;
      const from = Math.max(at, i.endDist);
      at = end;
      if (end <= i.endDist) return;
      out.push({ ...z, length: Number.isFinite(end) ? +(end - from).toFixed(4) : 0 });
    });
    if (out.length && out[out.length - 1].length !== 0) out.push({ ...out[out.length - 1], length: 0 });
    return { ...i, stirrups: out };
  }
  if (input === "shape") return changeShape(i, value as string); // the default strands fitted to the girder read
  if (input === "confinement" || input === "pierBars" || input === "connection" || input === "harped") return { ...i, [input]: { ...(i[input] as object), ...(value as object) } };
  return { ...i, [input]: value };
}

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type ReadValue = { input: string; value: unknown; confidence: "read" | "unsure"; source: PlanSource | null; note?: string | null };

/** Read only to cross-check: the girder's length (ft) from a girder schedule, against span + 2 × end distance. */
export const CROSS_CHECKS = { girderLength: "Girder length from the schedule (ft): checked against span 1 + 2 × the end distance, not applied" };

/** Builds a girder design's inputs from values read off plans. Values that don't fit an input are
 * reported (not applied); inputs the plans didn't give keep the defaults and are listed. */
export function girderFromPlans(read: ReadValue[], drawingSet: string | null, findings: string[]) {
  let inputs: GirderInputs = { ...GIRDER_DEFAULTS };
  const values: PlanValue[] = [];
  const rejected: string[] = [];
  // The girder first (strands read later override the fitted defaults), then endDist (the stirrup zones are converted with it).
  const rank = (x: string) => (x === "shape" ? 0 : x === "endDist" ? 1 : 2);
  const ordered = [...read].sort((a, b) => rank(a.input) - rank(b.input));
  const checks: string[] = [];
  let girderLength: number | null = null;
  for (const r of ordered) {
    if (r.input === "girderLength") {
      if (typeof r.value === "number" && r.value > 0) girderLength = r.value;
      continue;
    }
    const spec = PLAN_INPUTS[r.input];
    if (!spec) {
      rejected.push(`${r.input}: not an input the plans can set`);
      continue;
    }
    const parsed = spec.schema.safeParse(r.value);
    if (!parsed.success) {
      rejected.push(`${spec.label}: ${JSON.stringify(r.value)} isn't valid (${spec.hint || parsed.error.issues[0]?.message})`);
      continue;
    }
    inputs = apply(inputs, r.input, parsed.data);
    values.push({ input: r.input, value: parsed.data, status: r.confidence, source: r.source, note: r.note ?? null });
  }
  const given = new Set(values.map((v) => v.input));
  // A plan input not given: the default stays, marked so.
  for (const key of Object.keys(PLAN_INPUTS)) {
    if (given.has(key)) continue;
    if ((key === "pierBars" || key === "connection") && inputs.extraSpans.length === 0) continue;
    if (key === "harped" && given.has("strands")) {
      inputs = { ...inputs, harped: { ...inputs.harped, count: 0 } }; // no harped strands read: none
      values.push({ input: key, value: inputs.harped, status: "unsure", source: null, note: "None read from the plans; taken as no harped strands" });
      continue;
    }
    values.push({ input: key, value: currentValue(inputs, key), status: "default", source: null, note: "Not found on the plans: the tool's default" });
  }
  for (const n of NOT_ON_PLANS) values.push({ input: n.input, value: currentValue(inputs, n.input), status: "default", source: null, note: "Not usually on plans: the tool's default" });
  if (girderLength !== null) {
    const span1 = inputs.L + 2 * inputs.endDist;
    if (Math.abs(span1 - girderLength) > 0.1)
      checks.push(`The girder schedule's length, ${girderLength} ft, isn't span 1 (${inputs.L} ft) plus twice the end distance (${inputs.endDist} ft) = ${+span1.toFixed(3)} ft: the spans may be read to the pier's or abutment's centerline rather than bearing to bearing. Check the spans, the end distance and, for continuous spans, the pier's centerline to the bearings.`);
  }
  for (const v of values) v.applied = currentValue(inputs, v.input);
  const fromPlans: FromPlans = { drawingSet, values, findings: [...findings, ...checks, ...rejected.map((x) => `Not applied — ${x}`)] };
  let error: string | null = null;
  try {
    designGirder(inputs);
  } catch (e) {
    error = e instanceof DesignError ? e.message : "The inputs can't be worked out";
  }
  return { inputs: { ...inputs, fromPlans }, rejected, error };
}

/** The values still to confirm (read, unsure or default); none means the design is confirmed. */
export const toConfirm = (f: FromPlans | undefined) => (f ? f.values.filter((v) => v.status !== "confirmed" && v.status !== "edited") : []);

/** Marks values the engineer has changed in the editor as edited (which confirms them). */
export function trackEdits(i: GirderInputs): GirderInputs {
  const f = i.fromPlans;
  if (!f) return i;
  let changed = false;
  const values = f.values.map((v) => {
    if (v.status === "edited") return v;
    if (sameValue(currentValue(i, v.input), v.applied ?? v.value)) return v;
    changed = true;
    return { ...v, status: "edited" as const };
  });
  return changed ? { ...i, fromPlans: { ...f, values } } : i;
}
