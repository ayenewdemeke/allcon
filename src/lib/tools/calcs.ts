import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { uploadBuffer } from "@/lib/aps/oss";
import { evaluateSheet, type Result, type SheetItem, type UnitSystem } from "@/lib/calcs/evaluate";
import { loadShapes } from "@/lib/calcs/library/shapes";
import { calcPdf } from "@/lib/calcs/pdf";
import { findTemplate, layout, regionHeight, type Line } from "@/lib/calcs/library/templates";
import { CALC_FILE, newCalcKey } from "@/lib/calcs/server";
import { contentSize, emptyCalc, GRID, readingOrder, type CalcData, type Header, type Region } from "@/lib/calcs/types";
import { db } from "@/lib/db";
import { deleteFiles, getFile, putFile } from "@/lib/storage";
import { requireProject, ToolError, type ToolContext } from "./context";
import { appName } from "./drafting";

// Calcs for AI apps: read a worksheet (its regions in reading order, with what each works out
// to), write math, text, steel sections, tables, plots and solve blocks into it, and change or
// remove regions. Each change is a new revision; the file before an app's request is kept, so
// the user can undo the whole request from Connections. People with the worksheet open see the
// changes arrive, and see the app in it while it works.

/** Edits from one app this close together make one request, undone together. */
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const link = (calcId: string) => `/calcs/${calcId}`;
const snap = (v: number) => Math.ceil(v / GRID) * GRID;

async function findCalc(ctx: ToolContext, calcId: string) {
  const calc = await db.calc.findFirst({ where: { id: calcId, orgId: ctx.orgId }, include: { project: { select: { id: true, name: true } } } });
  if (!calc) throw new ToolError("Worksheet not found. Use list_calcs to see the worksheets and their ids.");
  return calc;
}

export async function readCalcData(fileKey: string | null): Promise<CalcData> {
  if (!fileKey) return emptyCalc("USCS");
  let bytes = Buffer.from(await getFile(fileKey));
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return JSON.parse(bytes.toString("utf8")) as CalcData;
}

/** Saves a changed worksheet as a new revision. `change` turns the latest saved version into the
 * new one; if someone saves meanwhile, it's run again on theirs. */
async function edit(ctx: ToolContext, calcId: string, summary: string, change: (data: CalcData) => CalcData | Promise<CalcData>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const calc = await findCalc(ctx, calcId);
    const data = await change(await readCalcData(calc.fileKey));
    // Undo goes back to before the app's request: keep that file, not each step's.
    const since = new Date(Date.now() - REQUEST_WINDOW_MS);
    const previous = await db.mcpActivity.findFirst({
      where: { userId: ctx.userId, clientId: ctx.clientId, createdAt: { gte: since }, undo: { path: ["calcId"], equals: calc.id } },
      orderBy: { createdAt: "desc" },
    });
    const prev = calcUndo.safeParse(previous?.undo);
    const sameRequest = prev.success && prev.data.revision === calc.revision;
    const backupKey = sameRequest ? prev.data.backupKey : calc.fileKey;
    const key = newCalcKey(calc.id);
    await putFile(key, gzipSync(JSON.stringify(data)), CALC_FILE);
    const { count } = await db.calc.updateMany({
      where: { id: calc.id, revision: calc.revision },
      data: { fileKey: key, backupKey, revision: calc.revision + 1, regionCount: data.regions.length },
    });
    if (!count) {
      await deleteFiles([key]);
      continue; // saved by someone meanwhile: do it again on their version
    }
    // The step before this one in the same request, and a backup from an earlier request, go.
    const stale = [sameRequest ? calc.fileKey : null, calc.backupKey && calc.backupKey !== backupKey ? calc.backupKey : null];
    await deleteFiles(stale.filter((k) => k && k !== backupKey && k !== key)).catch(() => {});
    await present(ctx, calc.id, summary);
    return { calc, data, undo: { type: "calc_edit" as const, calcId: calc.id, backupKey, revision: calc.revision + 1 } };
  }
  throw new ToolError("The worksheet is being changed by someone else right now. Try again in a moment.");
}

export const calcUndo = z.object({ type: z.literal("calc_edit"), calcId: z.uuid(), backupKey: z.string().nullable(), revision: z.number().int() });

/** Shows the app in the worksheet (for people who have it open), with what it just did. */
async function present(ctx: ToolContext, calcId: string, activity: string) {
  const name = await appName(ctx);
  const clientId = ctx.clientId ?? "app";
  await db.calcPresence
    .upsert({
      where: { calcId_userId_clientId: { calcId, userId: ctx.userId, clientId } },
      create: { calcId, userId: ctx.userId, clientId, name, activity: activity.slice(0, 200) },
      update: { name, activity: activity.slice(0, 200), seenAt: new Date() },
    })
    .catch((e) => console.error("Could not record presence", e));
}

// --- what a worksheet works out to --------------------------------------------------------------

/** Works out a worksheet: each region's result, in reading order. */
export async function workOut(data: CalcData) {
  await loadShapes();
  const regions = readingOrder(data.regions);
  const items = regions.flatMap((r): SheetItem[] => (r.kind === "text" ? [] : [r as SheetItem]));
  return { regions, results: evaluateSheet(items, data.settings) };
}

/** A region as apps read it: what it holds, where it is, and what it works out to. */
function describeRegion(r: Region, result: Result | undefined) {
  const { id, kind, x, y, ...rest } = r;
  const out: Record<string, unknown> = { id, kind, at: [x, y] };
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== "" && k !== "width" && !(k === "style" && v === "normal")) out[k === "displayUnit" ? "display_unit" : k === "compact" ? "names_only" : k] = v;
  if (!result) return out;
  if (result.kind === "error") out.error = result.incomplete ? `incomplete: ${result.message}` : result.message;
  else if (result.kind === "ok") {
    if (result.result) out.result = result.result;
    if (result.defines) out.defines = result.defines;
  } else if (result.kind === "section") out.properties = result.rows.map((p) => `${p.name}=${p.value}`).join("; ");
  else if (result.kind === "plot") {
    const failed = result.traces.find((t) => t.error);
    out.plotted = failed ? `error: ${failed.error}` : `${result.traces.length} trace(s), ${result.traces[0]?.xs.length ?? 0} points each; x in ${result.xUnit || "numbers"}, y in ${result.yUnit || "numbers"}`;
  } else if (result.kind === "solve") {
    const errors = [...result.guesses.map((g, i) => [`guess ${i + 1}`, g] as const), ...result.constraints.map((c, i) => [`constraint ${i + 1}`, c] as const)].filter(([, v]) => v.kind === "error");
    if (errors.length) out.errors = errors.map(([where, v]) => `${where}: ${v.kind === "error" ? v.message : ""}`);
    if (result.solver.kind === "ok") out.solved = result.solver.result ?? result.solver.defines;
    else if (result.solver.kind === "error") out.error = result.solver.message;
  }
  return out;
}

type RegionError = { id: string; latex?: string; kind?: string; error: string };

const errorsOf = (regions: Region[], results: Map<string, Result>) =>
  regions.flatMap((r): RegionError[] => {
    const res = results.get(r.id);
    if (res?.kind === "error" && !res.incomplete) return [{ id: r.id, ...(r.kind === "math" ? { latex: r.latex } : { kind: r.kind }), error: res.message }];
    if (res?.kind === "solve") {
      const bad = [...res.guesses, ...res.constraints, res.solver].find((x) => x.kind === "error" && !x.incomplete);
      if (bad?.kind === "error") return [{ id: r.id, kind: "solve", error: bad.message }];
    }
    return [];
  });

// --- reading ---------------------------------------------------------------------------------

export async function listCalcs(ctx: ToolContext) {
  const calcs = await db.calc.findMany({ where: { orgId: ctx.orgId }, orderBy: { updatedAt: "desc" }, take: 200, include: { project: { select: { id: true, name: true } } } });
  return calcs.map((c) => ({ id: c.id, name: c.name, project: c.project, regions: c.regionCount, updated: c.updatedAt.toISOString(), link: link(c.id) }));
}

export async function getCalc(ctx: ToolContext, calcId: string) {
  const calc = await findCalc(ctx, calcId);
  const data = await readCalcData(calc.fileKey);
  const { regions, results } = await workOut(data);
  return {
    id: calc.id,
    name: calc.name,
    project: calc.project,
    units: data.settings.system === "SI" ? "SI (results in kN, m, MPa)" : "US customary (results in kip, ft, ksi)",
    decimals: data.settings.decimals,
    paper: data.paper,
    page: contentSize(data.paper),
    header: data.header,
    regions: regions.map((r) => describeRegion(r, results.get(r.id))),
    errors: errorsOf(regions, results),
    link: link(calc.id),
  };
}

// --- writing ---------------------------------------------------------------------------------

const style = z.enum(["normal", "heading", "subheading", "note"]);
const latex = z.string().max(4000);

export const regionInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("math"),
    latex: latex.describe("The math, as LaTeX: name\\coloneq expression to define (end with = to show the value), or expression= to show a result"),
    display_unit: z.string().max(40).optional().describe("Show the result in this unit, e.g. in, kip*ft, MPa"),
    ref: z.string().max(200).optional().describe("A code reference or note shown beside it, e.g. 'AISC 360-22 Eq. F2-1'"),
  }),
  z.object({ kind: z.literal("text"), text: z.string().max(4000), style: style.optional() }),
  z.object({
    kind: z.literal("section"),
    shape: z.string().max(40).describe("An AISC shape, e.g. W18X50, HSS6X6X1/4, C10X15.3, L4X4X1/2"),
    suffix: z.string().max(10).optional().describe("Added to each name's subscript to tell sections apart: b gives A_b, I_{x,b}"),
    names_only: z.boolean().optional().describe("List the names it defines instead of the property table"),
  }),
  z.object({
    kind: z.literal("table"),
    columns: z.array(z.object({ name: z.string().max(40), unit: z.string().max(40).default("") })).min(1).max(20).describe("Each column becomes a vector with this name, in this unit"),
    rows: z.array(z.array(z.string().max(60))).max(500),
  }),
  z.object({
    kind: z.literal("plot"),
    traces: z.array(z.object({ x: latex, y: latex })).min(1).max(6).describe("y against x, as LaTeX: e.g. x: 'x', y: 'M\\left(x\\right)'"),
    x_unit: z.string().max(40).optional(),
    y_unit: z.string().max(40).optional(),
  }),
  z.object({
    kind: z.literal("solve"),
    guesses: z.array(latex).min(1).max(20).describe("Guess values, e.g. x\\coloneq1"),
    constraints: z.array(latex).min(1).max(20).describe("Equations or inequalities, e.g. x+y=3"),
    solver: latex.describe("e.g. \\begin{pmatrix}a\\\\b\\end{pmatrix}\\coloneq\\operatorname{find}\\left(x,y\\right)= or s\\coloneq\\operatorname{find}\\left(x\\right)="),
  }),
]);
export type RegionInput = z.infer<typeof regionInput>;

/** What's added, as layout lines. */
function lineOf(r: RegionInput): Line {
  switch (r.kind) {
    case "math":
      return { math: r.latex, ref: r.ref, unit: r.display_unit, wide: !!r.ref && r.latex.length > 90 };
    case "text":
      return { text: r.text, style: r.style };
    case "section":
      return { shape: r.shape, suffix: r.suffix, compact: r.names_only };
    case "table": {
      const width = r.columns.length;
      return { region: { kind: "table", columns: r.columns.map((c) => ({ name: c.name.replace(/\s/g, ""), unit: c.unit })), rows: r.rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? "")) } };
    }
    case "plot":
      return { region: { kind: "plot", width: 360, height: 240, traces: r.traces, ...(r.x_unit ? { xUnit: r.x_unit } : {}), ...(r.y_unit ? { yUnit: r.y_unit } : {}) } };
    case "solve":
      return { region: { kind: "solve", guesses: r.guesses, constraints: r.constraints, solver: r.solver } };
  }
}

/** A region's fields from an app's changes (its names for them). */
function changesOf(changes: Record<string, unknown>) {
  const names: Record<string, string> = { display_unit: "displayUnit", names_only: "compact", x_unit: "xUnit", y_unit: "yUnit" };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) {
    if (k === "id" || k === "kind") continue;
    if (k === "at" && Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number")) {
      out.x = Math.max(0, snap(v[0] as number));
      out.y = Math.max(0, snap(v[1] as number));
    } else out[names[k] ?? k] = v;
  }
  return out;
}

const bottomOf = (regions: Region[]) => Math.max(0, ...regions.map((r) => r.y + regionHeight(r)));

export type CalcEdit = {
  add?: RegionInput[];
  after?: string;
  at?: [number, number];
  update?: { id: string; changes: Record<string, unknown> }[];
  remove?: string[];
  header?: Partial<Header>;
  units?: UnitSystem;
  decimals?: number;
};

export async function editCalc(ctx: ToolContext, calcId: string, input: CalcEdit) {
  if (input.after && input.at) throw new ToolError("Give either after (a region id) or at (a place), not both.");
  const parts: string[] = [];
  if (input.add?.length) parts.push(`added ${input.add.length} region${input.add.length === 1 ? "" : "s"}`);
  if (input.update?.length) parts.push(`changed ${input.update.length}`);
  if (input.remove?.length) parts.push(`removed ${input.remove.length}`);
  if (input.header || input.units || input.decimals !== undefined) parts.push("changed its settings");
  const activity = parts.join(", ") || "saved";
  let added: Region[] = [];
  const { data, undo, calc } = await edit(ctx, calcId, activity, (current) => {
    let regions = [...current.regions];
    const byId = new Map(regions.map((r) => [r.id, r]));
    for (const id of input.remove ?? []) if (!byId.has(id)) throw new ToolError(`There's no region ${id}. get_calc lists the regions and their ids.`);
    for (const u of input.update ?? []) if (!byId.has(u.id)) throw new ToolError(`There's no region ${u.id}. get_calc lists the regions and their ids.`);
    regions = regions.filter((r) => !input.remove?.includes(r.id)).map((r) => {
      const u = input.update?.find((x) => x.id === r.id);
      return u ? ({ ...r, ...changesOf(u.changes), id: r.id, kind: r.kind } as Region) : r;
    });
    if (input.add?.length) {
      const lines = input.add.map(lineOf);
      const anchor = input.after ? regions.find((r) => r.id === input.after) : undefined;
      if (input.after && !anchor) throw new ToolError(`There's no region ${input.after} to add after.`);
      const start = input.at ? { x: snap(input.at[0]), y: snap(input.at[1]) } : anchor ? { x: anchor.x, y: snap(anchor.y + regionHeight(anchor) + GRID) } : { x: 0, y: regions.length ? snap(bottomOf(regions) + GRID * 3) : 0 };
      added = layout(lines, start, current.paper);
      if (anchor) {
        // What was below the anchor moves down to make room.
        const room = snap(bottomOf(added) - start.y + GRID * 2);
        regions = regions.map((r) => (r.y > anchor.y && r.id !== anchor.id ? { ...r, y: r.y + room } : r));
      }
      regions.push(...added);
    }
    const header = input.header ? { ...current.header, ...Object.fromEntries(Object.entries(input.header).filter(([, v]) => typeof v === "string")) } : current.header;
    const settings = { ...current.settings, ...(input.units ? { system: input.units } : {}), ...(input.decimals !== undefined ? { decimals: Math.max(0, Math.min(6, Math.round(input.decimals))) } : {}) };
    return { ...current, header, settings, regions };
  });
  const summary = `${activity} in ${calc.name}`;
  const { regions, results } = await workOut(data);
  const touched = new Set([...added.map((r) => r.id), ...(input.update ?? []).map((u) => u.id)]);
  return {
    result: {
      calc_id: calc.id,
      changed: regions.filter((r) => touched.has(r.id)).map((r) => describeRegion(r, results.get(r.id))),
      errors: errorsOf(regions, results),
      regions: regions.length,
      link: link(calc.id),
    },
    summary: summary.charAt(0).toUpperCase() + summary.slice(1),
    undo,
  };
}

export async function createCalc(ctx: ToolContext, input: { name: string; units: UnitSystem; template?: string; project_id?: string }) {
  const template = input.template ? findTemplate(input.template) : undefined;
  if (input.template && !template) throw new ToolError(`There's no template ${input.template}.`);
  const project = input.project_id ? await requireProject(ctx, input.project_id) : null;
  const data = emptyCalc(template?.system ?? input.units);
  data.header = { ...data.header, title: input.name.slice(0, 200) };
  if (template) data.regions = layout(template.lines, { x: 0, y: 0 }, data.paper);
  const calc = await db.calc.create({ data: { orgId: ctx.orgId, projectId: project?.id ?? null, name: input.name.slice(0, 200), createdById: ctx.userId } });
  if (template) {
    const key = newCalcKey(calc.id);
    await putFile(key, gzipSync(JSON.stringify(data)), CALC_FILE);
    await db.calc.update({ where: { id: calc.id }, data: { fileKey: key, revision: 1, regionCount: data.regions.length } });
  }
  return { id: calc.id, name: calc.name, project: project ? { id: project.id, name: project.name } : null, template: template?.id ?? null, regions: data.regions.length, link: link(calc.id) };
}

/** Prints a worksheet to a PDF and adds it to a project's Sheets as a set, a sheet per page.
 * The worksheet is filed under the project if it isn't filed anywhere yet. */
export async function publishCalc(ctx: ToolContext, calcId: string, projectId?: string) {
  const calc = await findCalc(ctx, calcId);
  const target = projectId ?? calc.projectId;
  if (!target) throw new ToolError("Which project? This worksheet isn't filed under one: give project_id (list_projects lists them).");
  const project = await requireProject(ctx, target);
  const data = await readCalcData(calc.fileKey);
  if (!data.regions.length) throw new ToolError("This worksheet is empty: there's nothing to publish.");
  const { results } = await workOut(data);
  const title = data.header.title || calc.name;
  const pdf = await calcPdf(data, results, { title });
  const fileName = `${calc.name.replace(/[^\w.-]+/g, "_") || "calc"}.pdf`;
  const set = await db.drawingSet.create({ data: { projectId: project.id, fileName, fileSize: pdf.bytes.length, uploadedById: ctx.userId } });
  const objectKey = `${project.id}/drawings/${set.id}/${fileName}`;
  const number = (page: number) => (data.header.number ? `${data.header.number}-${page}` : `CALC-${page}`);
  try {
    await uploadBuffer(objectKey, pdf.bytes);
    await db.$transaction([
      db.sheet.createMany({
        data: Array.from({ length: pdf.pages }, (_, pageIndex) => ({
          drawingSetId: set.id,
          pageIndex,
          width: pdf.width,
          height: pdf.height,
          number: number(pageIndex + 1),
          title: pdf.pages > 1 ? `${title} (${pageIndex + 1} of ${pdf.pages})` : title,
        })),
      }),
      db.drawingSet.update({ where: { id: set.id }, data: { objectKey, status: "ready", pageCount: pdf.pages } }),
      ...(calc.projectId ? [] : [db.calc.update({ where: { id: calc.id }, data: { projectId: project.id } })]),
    ]);
  } catch (err) {
    await db.drawingSet.update({ where: { id: set.id }, data: { status: "failed" } });
    console.error("Publishing a worksheet failed", err);
    throw new ToolError("Couldn't store the published sheets. Try again.");
  }
  return { projectId: project.id, drawingSetId: set.id, sheets: pdf.pages, link: `/projects/${project.id}/sheets` };
}
