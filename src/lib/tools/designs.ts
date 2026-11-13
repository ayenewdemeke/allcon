import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { CROSS_CHECKS, girderFromPlans, PLAN_INPUTS, toConfirm, type PlanSource, type ReadValue } from "@/lib/design/girders/from-plans";
import { designGirder, type GirderInputs } from "@/lib/design/girders/prestressed";
import { designInputs, girderInputs, kindInfo } from "@/lib/design/kinds";
import { DesignError } from "@/lib/design/walls/cip";
import { readStoredSheet } from "@/lib/pdf/server-sheet";
import { sheetName } from "@/lib/sheets/export-data";
import { requireProject, requireSheet, ToolError, type ToolContext } from "./context";

// Design checks for AI apps: list them, read one, and start a girder check from plans. The AI reads
// the sheets (read_sheet); ALLCON's engine does every calculation.

export async function listDesigns(ctx: ToolContext, projectId?: string) {
  if (projectId) await requireProject(ctx, projectId);
  const designs = await db.design.findMany({ where: { orgId: ctx.orgId, ...(projectId ? { projectId } : {}) }, orderBy: { updatedAt: "desc" }, take: 100 });
  return designs.map((d) => ({ id: d.id, name: d.name, kind: d.kind, type: kindInfo(d.kind)?.name ?? d.kind, projectId: d.projectId, link: `/design/${d.id}`, updated: d.updatedAt.toISOString() }));
}

/** A design's inputs and, for a girder check, its results summary. */
export async function getDesign(ctx: ToolContext, designId: string) {
  const d = await db.design.findFirst({ where: { id: designId, orgId: ctx.orgId } });
  if (!d) throw new ToolError("Design not found. Use list_designs to see the designs and their ids.");
  const inputs = designInputs(d.kind, d.inputs) as Record<string, unknown>;
  let results: unknown = null;
  if (d.kind === "lrfd-girder-check") {
    const i = inputs as unknown as GirderInputs;
    try {
      const r = designGirder(i);
      const failing = [...r.spans.flatMap((s) => (["interior", "exterior"] as const).flatMap((side) => s[side].checks.filter((c) => !c.ok).map((c) => `Span ${s.index + 1}, ${side}: ${c.name} (${c.demand.toFixed(2)} / ${c.capacity.toFixed(2)} ${c.unit})`))), ...r.piers.flatMap((p) => (["interior", "exterior"] as const).flatMap((side) => p[side].checks.filter((c) => !c.ok).map((c) => `Pier ${p.index}, ${side}: ${c.name}`)))];
      results = { ok: r.ok, controlling: `${r.continuous ? `span ${r.controllingSpan + 1}, ` : ""}${r.controlling} girder`, failing };
    } catch (e) {
      results = { error: e instanceof DesignError ? e.message : "The inputs can't be worked out" };
    }
    const pending = toConfirm(i.fromPlans);
    if (i.fromPlans) results = { ...(results as object), fromPlans: pending.length ? `${pending.length} values from the plans still to confirm in ALLCON` : "all values from the plans confirmed" };
  }
  const { fromPlans, ...rest } = inputs;
  void fromPlans;
  return { id: d.id, name: d.name, kind: d.kind, type: kindInfo(d.kind)?.name ?? d.kind, projectId: d.projectId, link: `/design/${d.id}`, inputs: rest, results };
}

export type PlanValueInput = { input: string; value: unknown; sheet_id?: string; line_ids?: number[]; confidence: "read" | "unsure"; note?: string };

/**
 * A girder design check in a project from values read off its plans, each with the sheet lines it
 * came from. It opens in ALLCON for the engineer to confirm each value; until then its results are
 * marked unconfirmed and it can't make a calc package.
 */
export async function createGirderDesignFromPlans(ctx: ToolContext, args: { projectId: string; name: string; drawingSetId?: string; values: PlanValueInput[]; findings?: string[] }) {
  const project = await requireProject(ctx, args.projectId);
  // The sheets the values came from: each source's box is the union of its lines.
  const sheets = new Map<string, { name: string; lines: { id: number; box: number[]; text: string }[] }>();
  const sourceOf = async (v: PlanValueInput): Promise<PlanSource | null> => {
    if (!v.sheet_id) return null;
    let s = sheets.get(v.sheet_id);
    if (!s) {
      const sheet = await requireSheet(ctx, v.sheet_id);
      if (sheet.drawingSet.projectId !== project.id) throw new ToolError(`Sheet ${v.sheet_id} isn't in this project.`);
      if (!sheet.drawingSet.objectKey) throw new ToolError("A sheet's file isn't available.");
      const { lines } = await readStoredSheet(sheet.drawingSet.objectKey, sheet.pageIndex, { image: false });
      s = { name: sheetName(sheet), lines: lines.map((l) => ({ id: l.id, box: l.box, text: l.text })) };
      sheets.set(v.sheet_id, s);
    }
    const picked = (v.line_ids ?? []).map((id) => s!.lines.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => !!l);
    const box = picked.length ? ([Math.min(...picked.map((l) => l.box[0])), Math.min(...picked.map((l) => l.box[1])), Math.max(...picked.map((l) => l.box[2])), Math.max(...picked.map((l) => l.box[3]))] as [number, number, number, number]) : null;
    const text = picked.map((l) => l.text).join(" · ");
    return { sheetId: v.sheet_id, sheet: s.name, box, lines: text ? text.slice(0, 300) : null };
  };
  const read: ReadValue[] = [];
  for (const v of args.values) read.push({ input: v.input, value: v.value, confidence: v.confidence, source: await sourceOf(v), note: v.note ?? null });
  const set = args.drawingSetId ? await db.drawingSet.findFirst({ where: { id: args.drawingSetId, projectId: project.id }, select: { fileName: true } }) : null;
  const built = girderFromPlans(read, set?.fileName ?? null, args.findings ?? []);
  const inputs = girderInputs(built.inputs);
  const design = await db.design.create({
    data: { orgId: ctx.orgId, projectId: project.id, kind: "lrfd-girder-check", name: args.name.trim().slice(0, 200) || "LRFD Bridge Design Check from plans", inputs: inputs as unknown as Prisma.InputJsonValue, createdById: ctx.userId },
  });
  const pending = toConfirm(inputs.fromPlans);
  return {
    designId: design.id,
    link: `/design/${design.id}`,
    applied: built.inputs.fromPlans.values.filter((v) => v.status === "read" || v.status === "unsure").length,
    notApplied: built.rejected,
    error: built.error,
    toConfirm: pending.length,
    message: `Created "${design.name}". The engineer confirms each value in ALLCON before the results count${built.error ? `; it can't be worked out yet: ${built.error}` : ""}.`,
  };
}

/** The inputs a reader may set, for the prompt and the tool's description. */
export const planInputsGuide = () =>
  Object.entries(PLAN_INPUTS)
    .map(([k, v]) => `- ${k}: ${v.label}${v.hint ? ` (${v.hint})` : ""}`)
    .concat(Object.entries(CROSS_CHECKS).map(([k, v]) => `- ${k}: ${v}`))
    .join("\n");
