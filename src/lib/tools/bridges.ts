import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { analyzeBridge } from "@/lib/bridge/bridge";
import { BRIDGE_DEFAULTS, bridgeDefinition, supportsFor, type BridgeDefinition } from "@/lib/bridge/definition";
import { importedOf } from "@/lib/bridge/imported";
import { ModelError } from "@/lib/bridge/model";
import { movingLoad } from "@/lib/bridge/moving";
import { db } from "@/lib/db";
import { requireProject, ToolError, type ToolContext } from "./context";

// Bridges for AI apps: list them, read one with its analysis results, start one from the wizard's
// inputs, and change one. The AI gives the inputs; allcon's solver does every calculation.

const round = (v: number, d = 1) => +v.toFixed(d);

export async function listBridges(ctx: ToolContext, projectId?: string) {
  if (projectId) await requireProject(ctx, projectId);
  const bridges = await db.bridge.findMany({ where: { orgId: ctx.orgId, ...(projectId ? { projectId } : {}) }, orderBy: { updatedAt: "desc" }, take: 100 });
  return bridges.map((b) => {
    const imp = importedOf(b.definition);
    if (imp) return { id: b.id, name: b.name, projectId: b.projectId, imported_from: imp.source, nodes: imp.nodes, elements: imp.elements, link: `/bridges/${b.id}`, updated: b.updatedAt.toISOString() };
    const d = bridgeDefinition(b.definition);
    return { id: b.id, name: b.name, projectId: b.projectId, spans_ft: d.spans, girders: d.nGirders, link: `/bridges/${b.id}`, updated: b.updatedAt.toISOString() };
  });
}

/** What a bridge's analysis gives, in short: per girder line and pier member the governing forces, and the bearing reactions. */
function summary(d: BridgeDefinition) {
  try {
    const a = analyzeBridge(d);
    const live = movingLoad(a.generated, a.stage(2));
    const strength = { kind: "combination" as const, name: "Strength I" };
    const members = a.generated.members.map((m) => {
      const st = a.member(m, strength, 1, live);
      const pick = (key: "My" | "Vz" | "N", sense: "max" | "min") => st.reduce((best, s) => (sense === "max" ? (s.max![key] > best.v ? { v: s.max![key], x: s.x } : best) : s.min![key] < best.v ? { v: s.min![key], x: s.x } : best), { v: sense === "max" ? -Infinity : Infinity, x: 0 });
      const at = (p: { v: number; x: number }) => ({ value: round(p.v), at_ft: round(p.x) });
      return { member: m.name, kind: m.kind, strength_I: { moment_max_kipft: at(pick("My", "max")), moment_min_kipft: at(pick("My", "min")), shear_max_kip: at(pick("Vz", "max")), shear_min_kip: at(pick("Vz", "min")), ...(m.kind === "column" ? { axial_min_kip: at(pick("N", "min")) } : {}) } };
    });
    const bearings = a.bearings({ kind: "combination", name: "Service I" }, live).map((b) => ({ support: b.support, girder: b.girder, permanent_kip: round(b.vertical), max_kip: round(b.max ?? b.vertical), min_kip: round(b.min ?? b.vertical) }));
    return {
      status: "Not verified: check independently",
      equilibrium_ok: a.ok,
      model: { nodes: a.generated.stage2.nodes.length, elements: a.generated.stage2.elements.length },
      load_cases: a.cases.map((c) => ({ name: c.name, type: c.type, acts_on: c.stage === 1 ? "girders alone" : "composite bridge" })),
      live_load: { vehicle: "HL-93", lanes: live.arrangements[0].length, dynamic_allowance: live.IM },
      sign_convention: "Moments sagging +; axial tension +; each max and min is its own loading (an envelope).",
      members,
      bearings_service_I: bearings,
    };
  } catch (e) {
    return { error: e instanceof ModelError ? e.message : "The bridge can't be analyzed as entered" };
  }
}

export async function getBridge(ctx: ToolContext, bridgeId: string) {
  const b = await db.bridge.findFirst({ where: { id: bridgeId, orgId: ctx.orgId } });
  if (!b) throw new ToolError("Bridge not found. Use list_bridges to see the bridges and their ids.");
  const imp = importedOf(b.definition);
  if (imp) return { id: b.id, name: b.name, projectId: b.projectId, link: `/bridges/${b.id}`, imported: { from: imp.source, nodes: imp.nodes, elements: imp.elements, load_cases: imp.cases, not_read: imp.report.notRead, warnings: imp.report.warnings }, note: "An imported analysis model: its results are in allcon (the link); they aren't available through this tool yet." };
  const { designs, ...definition } = bridgeDefinition(b.definition);
  return { id: b.id, name: b.name, projectId: b.projectId, link: `/bridges/${b.id}`, definition, designs: designs.map((l) => ({ part: l.target, kind: l.kind, link: `/design/${l.id}` })), results: summary({ ...definition, designs }) };
}

/** A definition with a patch laid over it, group by group (spans replace the list; support lines follow the spans). */
function merged(base: BridgeDefinition, patch: Record<string, unknown>): BridgeDefinition {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "designs") continue;
    const cur = (base as unknown as Record<string, unknown>)[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur) ? { ...(cur as object), ...(v as object) } : v;
  }
  const spans = Array.isArray(out.spans) ? out.spans.length : base.spans.length;
  if (!Array.isArray(patch.supports)) out.supports = supportsFor(spans, spans === base.spans.length ? base.supports : []);
  return { ...bridgeDefinition(out), designs: base.designs };
}

export async function createBridge(ctx: ToolContext, args: { name: string; projectId?: string; definition?: Record<string, unknown> }) {
  if (args.projectId) await requireProject(ctx, args.projectId);
  const definition = merged(BRIDGE_DEFAULTS, args.definition ?? {});
  const b = await db.bridge.create({ data: { orgId: ctx.orgId, projectId: args.projectId ?? null, name: args.name.trim().slice(0, 200) || "Bridge", definition: definition as unknown as Prisma.InputJsonValue, createdById: ctx.userId } });
  return getBridge(ctx, b.id);
}

export async function editBridge(ctx: ToolContext, args: { bridgeId: string; name?: string; definition?: Record<string, unknown> }) {
  const b = await db.bridge.findFirst({ where: { id: args.bridgeId, orgId: ctx.orgId } });
  if (!b) throw new ToolError("Bridge not found. Use list_bridges to see the bridges and their ids.");
  if (importedOf(b.definition)) throw new ToolError("This bridge is an imported model: it has no wizard inputs to change.");
  const definition = merged(bridgeDefinition(b.definition), args.definition ?? {});
  await db.bridge.update({ where: { id: b.id }, data: { ...(args.name?.trim() ? { name: args.name.trim().slice(0, 200) } : {}), definition: definition as unknown as Prisma.InputJsonValue } });
  return getBridge(ctx, b.id);
}

/** The definition's fields, for the tools' descriptions. */
export const BRIDGE_DEFINITION_GUIDE =
  "definition fields (all optional; omitted ones keep their value): spans [ft, between support centerlines]; skew (degrees); continuity 'continuous' | 'simple'; supports [{bearing: 'fixed' | 'expansion'}] one per support line (spans + 1); " +
  "girder {shape: library id such as 'aashto-iv', 'bt-72', 'cbt-54', fc ksi, wc kcf}; nGirders; spacing ft; overhang ft; deck {thickness in, sacrificial in, haunch in, fc ksi, wc kcf}; divisions (elements per span); " +
  "diaphragms {perSpan, weight kip per bay, thickness ft, atSupports}; piers {model, capWidth ft, capDepth ft, columns, columnDiameter ft, columnHeight ft, columnSpacing ft, fc ksi, bearingHeight in}; loads {barrierWeight klf each side, barrierWidth ft, wearingSurface psf}.";
