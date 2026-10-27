import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { uploadBuffer } from "@/lib/aps/oss";
import { db } from "@/lib/db";
import { DraftDocument, MODEL, newId } from "@/lib/drafting/document";
import { layoutSheet, sheetFacts, viewportScaleName } from "@/lib/drafting/layouts";
import { plotPdf } from "@/lib/drafting/plot";
import { drawingImage } from "@/lib/drafting/render";
import { runScript } from "@/lib/drafting/script";
import { DRAWING_FILE, newDrawingKey } from "@/lib/drafting/server";
import { emptyDrawing, newLayer, type DrawingData, type Entity } from "@/lib/drafting/types";
import { deleteFiles, getFile, putFile } from "@/lib/storage";
import { requireProject, ToolError, type ToolContext } from "./context";

// Drafting for AI apps: read a drawing (a summary, its objects and a picture), draft with
// AutoCAD command scripts or by adding objects directly, and publish its layouts to Sheets.
// Each change is a new revision of the drawing; the file before an app's request is kept, so
// the user can undo the whole request from Connections. People with the drawing open see the
// changes arrive, and see the app in the drawing while it works.

/** Edits from one app this close together make one request, undone together. */
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const link = (drawingId: string) => `/drafting/${drawingId}`;

async function findDrawing(ctx: ToolContext, drawingId: string) {
  const drawing = await db.drawing.findFirst({ where: { id: drawingId, orgId: ctx.orgId } });
  if (!drawing) throw new ToolError("Drawing not found. Use list_drawings to see the drawings and their ids.");
  return drawing;
}

async function readData(fileKey: string | null, units: string): Promise<DrawingData> {
  if (!fileKey) return emptyDrawing(units === "mm" ? "mm" : "architectural");
  let bytes = Buffer.from(await getFile(fileKey));
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return JSON.parse(bytes.toString("utf8")) as DrawingData;
}

const loadPicture = (drawingId: string) => async (key: string) =>
  key.startsWith(`drawings/${drawingId}/attachments/`) ? getFile(key).catch(() => null) : null;

/** The app's name, as people see it in the drawing ("Claude"). */
async function appName(ctx: ToolContext) {
  if (!ctx.clientId) return "AI app";
  const client = await db.oauthClient.findFirst({ where: { clientId: ctx.clientId }, select: { name: true } });
  return client?.name?.trim() || "AI app";
}

/** Saves a changed drawing as a new revision. `change` turns the latest saved version into
 * the new one; if someone saves meanwhile, it's run again on theirs. */
async function edit(ctx: ToolContext, drawingId: string, summary: string, change: (data: DrawingData) => DrawingData | Promise<DrawingData>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const drawing = await findDrawing(ctx, drawingId);
    const data = await change(await readData(drawing.fileKey, drawing.units));
    // Undo goes back to before the app's request: keep that file, not each step's.
    const since = new Date(Date.now() - REQUEST_WINDOW_MS);
    const previous = await db.mcpActivity.findFirst({
      where: { userId: ctx.userId, clientId: ctx.clientId, createdAt: { gte: since }, undo: { path: ["drawingId"], equals: drawing.id } },
      orderBy: { createdAt: "desc" },
    });
    const prev = drawingUndo.safeParse(previous?.undo);
    const sameRequest = prev.success && prev.data.revision === drawing.revision;
    const backupKey = sameRequest ? prev.data.backupKey : drawing.fileKey;
    const key = newDrawingKey(drawing.id);
    await putFile(key, gzipSync(JSON.stringify(data)), DRAWING_FILE);
    const { count } = await db.drawing.updateMany({
      where: { id: drawing.id, revision: drawing.revision },
      data: { fileKey: key, backupKey, revision: drawing.revision + 1, entityCount: data.entities.length },
    });
    if (!count) {
      await deleteFiles([key]);
      continue; // saved by someone meanwhile: do it again on their version
    }
    // The step before this one in the same request, and a backup from an earlier request, go.
    const stale = [sameRequest ? drawing.fileKey : null, drawing.backupKey && drawing.backupKey !== backupKey ? drawing.backupKey : null];
    await deleteFiles(stale.filter((k) => k && k !== backupKey && k !== key)).catch(() => {});
    await present(ctx, drawing.id, summary);
    return { drawing: { ...drawing, fileKey: key, revision: drawing.revision + 1 }, data, undo: { type: "drawing_edit" as const, drawingId: drawing.id, backupKey, revision: drawing.revision + 1 } };
  }
  throw new ToolError("The drawing is being changed by someone else right now. Try again in a moment.");
}

export const drawingUndo = z.object({ type: z.literal("drawing_edit"), drawingId: z.uuid(), backupKey: z.string().nullable(), revision: z.number().int() });

/** Shows the app in the drawing (for people who have it open), with what it just did. */
async function present(ctx: ToolContext, drawingId: string, activity: string) {
  const name = await appName(ctx);
  const clientId = ctx.clientId ?? "app";
  await db.drawingPresence
    .upsert({
      where: { drawingId_userId_clientId: { drawingId, userId: ctx.userId, clientId } },
      create: { drawingId, userId: ctx.userId, clientId, name, activity: activity.slice(0, 200) },
      update: { name, activity: activity.slice(0, 200), seenAt: new Date() },
    })
    .catch((e) => console.error("Could not record presence", e));
}

// --- reading ---------------------------------------------------------------------------------

export async function listDrawings(ctx: ToolContext) {
  const drawings = await db.drawing.findMany({ where: { orgId: ctx.orgId }, orderBy: { updatedAt: "desc" }, take: 200 });
  return drawings.map((d) => ({
    id: d.id,
    name: d.name,
    units: d.units === "mm" ? "mm (drawing units are millimetres)" : "architectural (drawing units are inches; shown as feet and inches)",
    objects: d.entityCount,
    updated: d.updatedAt.toISOString(),
    link: link(d.id),
  }));
}

export async function createDrawing(ctx: ToolContext, input: { name: string; units: "architectural" | "mm" }) {
  const drawing = await db.drawing.create({ data: { orgId: ctx.orgId, name: input.name.slice(0, 200), units: input.units, createdById: ctx.userId } });
  return { id: drawing.id, name: drawing.name, units: drawing.units, link: link(drawing.id) };
}

const round = (v: unknown): unknown => {
  if (typeof v === "number") return Math.round(v * 1e4) / 1e4;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
  return v;
};

/** An object as apps read it: its own properties only (ByLayer ones left out), rounded. */
function compact(e: Entity) {
  const { linetype, color, lineweight, ...rest } = e;
  void linetype;
  return round({ ...rest, ...(color !== null ? { color } : {}), ...(lineweight !== -1 ? { lineweight } : {}) }) as Record<string, unknown>;
}

export type ObjectFilter = { layer?: string; type?: string; region?: [number, number, number, number]; limit?: number };

export async function getDrawing(ctx: ToolContext, drawingId: string, options: { layout?: string; includeImage: boolean; objects?: ObjectFilter }) {
  const drawing = await findDrawing(ctx, drawingId);
  const doc = new DraftDocument(await readData(drawing.fileKey, drawing.units));
  const layout = options.layout ? [...doc.layouts.values()].find((l) => l.name.toUpperCase() === options.layout!.trim().toUpperCase()) : null;
  if (options.layout && !layout) throw new ToolError(`There's no layout named "${options.layout}". get_drawing lists the layouts.`);
  const space = layout?.id ?? MODEL;
  const entities = [...doc.entitiesIn(space).values()];
  const byType: Record<string, number> = {};
  const byLayer: Record<string, number> = {};
  for (const e of entities) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    byLayer[e.layer] = (byLayer[e.layer] ?? 0) + 1;
  }
  const f = options.objects ?? {};
  const limit = Math.min(Math.max(f.limit ?? 200, 0), 1000);
  let list = f.region ? doc.query({ minX: f.region[0], minY: f.region[1], maxX: f.region[2], maxY: f.region[3] }, space) : entities;
  if (f.layer) list = list.filter((e) => e.layer.toUpperCase() === f.layer!.toUpperCase());
  if (f.type) list = list.filter((e) => e.type === f.type);
  const extents = doc.extents(true, space);
  const result = {
    id: drawing.id,
    name: drawing.name,
    units: doc.units === "mm" ? "mm: drawing units are millimetres" : "architectural: drawing units are inches (12 = 1 foot); lengths read as feet and inches",
    space: layout ? `layout "${layout.name}" (paper space, in ${doc.units === "mm" ? "mm" : "inches"}, 1:1)` : "model",
    annotationScale: doc.annoScale,
    currentLayer: doc.currentLayer,
    layers: [...doc.layers.values()].map((l) => round({ name: l.name, color: l.color, lineweight: l.lineweight, on: l.on, frozen: l.frozen, locked: l.locked, ...(l.plot === false ? { plot: false } : {}) })),
    textStyles: [...doc.textStyles.values()].map((t) => t.name),
    dimensionStyles: [...doc.dimStyles.values()].map((d) => round({ name: d.name, textHeight: d.textHeight, arrow: d.arrow, scale: d.scale })),
    blocks: [...doc.blocks.values()].map((b) => ({ name: b.name, base: round(b.base), objects: b.entities.length, attributes: b.entities.filter((e) => e.type === "attdef").map((e) => (e.type === "attdef" ? e.tag : "")) })),
    layouts: [...doc.layouts.values()].map((l) => ({
      name: l.name,
      paper: l.paper.name,
      viewports: [...doc.entitiesIn(l.id).values()].flatMap((e) =>
        e.type === "viewport" ? [round({ id: e.id, center: e.center, width: e.width, height: e.height, view: e.view, scale: viewportScaleName(e.scale, doc.units), locked: e.locked })] : [],
      ),
    })),
    extents: Number.isFinite(extents.minX) ? round(extents) : null,
    counts: { total: entities.length, byType, byLayer },
    objects: list.slice(0, limit).map(compact),
    objectsShown: Math.min(list.length, limit),
    objectsMatching: list.length,
    link: link(drawing.id),
  };
  const image = options.includeImage ? await drawingImage(doc, { layoutId: layout?.id, loadPicture: loadPicture(drawing.id) }) : null;
  return { result, image };
}

// --- drafting ----------------------------------------------------------------------------------

export async function runCommands(ctx: ToolContext, drawingId: string, script: string, options: { layout?: string; includeImage: boolean }) {
  let outcome: ReturnType<typeof runScript> | null = null;
  const lines = script.split("\n").filter((l) => l.trim() && !l.trim().startsWith(";")).length;
  const saved = await edit(ctx, drawingId, `ran a script (${lines} lines)`, (data) => {
    try {
      outcome = runScript(data, script, { layout: options.layout });
    } catch (err) {
      throw new ToolError(err instanceof Error ? err.message : "The script couldn't run.");
    }
    return outcome.data;
  });
  const r = outcome as unknown as ReturnType<typeof runScript>;
  const doc = new DraftDocument(saved.data);
  const image = options.includeImage ? await drawingImage(doc, { loadPicture: loadPicture(drawingId) }) : null;
  return {
    result: {
      added: r.added.length,
      addedIds: r.added.slice(0, 200).map((e) => e.id),
      changed: r.changed,
      erased: r.erased,
      errors: r.errors,
      transcript: r.transcript.length > 400 ? ["…", ...r.transcript.slice(-400)] : r.transcript,
      objects: saved.data.entities.length,
      link: link(drawingId),
    },
    undo: saved.undo,
    summary: `Drafted in ${saved.drawing.name}: ${r.added.length} added, ${r.changed} changed, ${r.erased} erased`,
    image,
  };
}

const vec = z.object({ x: z.number(), y: z.number() });
const common = { layer: z.string().max(255).optional(), color: z.union([z.number().int().min(0).max(255), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).nullable().optional(), lineweight: z.number().int().optional() };
const text = { height: z.number().positive(), rotation: z.number().default(0), style: z.string().default("Standard") };
const ALIGN = { halign: z.enum(["left", "center", "right"]).default("left"), valign: z.enum(["baseline", "bottom", "middle", "top"]).default("baseline") };

/** Objects as apps add them: geometry in drawing units, angles in radians; the rest defaults. */
export const objectInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("line"), a: vec, b: vec, ...common }),
  z.object({ type: z.literal("polyline"), points: z.array(vec).min(2), bulges: z.array(z.number()).optional(), closed: z.boolean().default(false), ...common }),
  z.object({ type: z.literal("circle"), center: vec, radius: z.number().positive(), ...common }),
  z.object({ type: z.literal("arc"), center: vec, radius: z.number().positive(), start: z.number(), end: z.number(), ...common }),
  z.object({ type: z.literal("ellipse"), center: vec, major: vec, ratio: z.number().positive().max(1), start: z.number().default(0), end: z.number().default(Math.PI * 2), ...common }),
  z.object({ type: z.literal("spline"), fit: z.array(vec).min(2), closed: z.boolean().default(false), ...common }),
  z.object({ type: z.literal("text"), at: vec, text: z.string().min(1), ...text, ...ALIGN, ...common }),
  z.object({ type: z.literal("mtext"), at: vec, text: z.string().min(1), width: z.number().min(0).default(0), ...text, ...common }),
  z.object({
    type: z.literal("dimension"),
    kind: z.enum(["linear", "aligned", "angular", "radius", "diameter"]),
    p1: vec,
    p2: vec,
    loc: vec,
    center: vec.optional(),
    angle: z.number().default(0),
    text: z.string().default(""),
    style: z.string().optional(),
    ...common,
  }),
  z.object({ type: z.literal("leader"), points: z.array(vec).min(2), text: z.string().default(""), height: z.number().positive().optional(), style: z.string().default("Standard"), dimStyle: z.string().optional(), ...common }),
  z.object({ type: z.literal("hatch"), loops: z.array(z.array(vec).min(3)).min(1), pattern: z.string().default("ANSI31"), scale: z.number().positive().optional(), angle: z.number().default(0), ...common }),
  z.object({ type: z.literal("insert"), block: z.string(), at: vec, scale: vec.default({ x: 1, y: 1 }), rotation: z.number().default(0), attribs: z.record(z.string(), z.string()).default({}), ...common }),
]);
export type ObjectInput = z.infer<typeof objectInput>;

export async function addObjects(ctx: ToolContext, drawingId: string, input: ObjectInput[], options: { layout?: string }) {
  // Defaults filled in (rotation, justification...), whoever calls.
  const objects = input.map((o) => objectInput.parse(o));
  let ids: string[] = [];
  const saved = await edit(ctx, drawingId, `added ${objects.length} objects`, (data) => {
    const doc = new DraftDocument(data);
    const space = spaceOf(doc, options.layout);
    doc.setSpace(space);
    doc.begin("add");
    ids = [];
    for (const o of objects) {
      if (o.layer && !doc.layers.has(o.layer)) doc.setLayer(newLayer(o.layer));
      if (o.type === "insert" && !doc.blocks.has(o.block)) throw new ToolError(`There's no block named "${o.block}". get_drawing lists the blocks.`);
      const dim = doc.dimStyles.get(doc.currentDimStyle)!;
      const scale = space === MODEL ? doc.annoScale : 1;
      const defaults =
        o.type === "dimension"
          ? { center: o.center ?? o.p1, style: o.style ?? doc.currentDimStyle, ...(space !== MODEL ? { dimScale: 1 } : {}) }
          : o.type === "leader"
            ? { height: o.height ?? dim.textHeight * (space === MODEL ? dim.scale : 1), dimStyle: o.dimStyle ?? doc.currentDimStyle, ...(space !== MODEL ? { dimScale: 1 } : {}) }
            : o.type === "hatch"
              ? { scale: o.scale ?? scale }
              : o.type === "polyline"
                ? { bulges: o.points.map((_, i) => o.bulges?.[i] ?? 0) }
                : {};
      const e = { ...o, ...defaults, id: newId(), layer: o.layer ?? doc.currentLayer, color: o.color ?? null, lineweight: o.lineweight ?? -1, linetype: "ByLayer" } as Entity;
      doc.add(e);
      ids.push(e.id);
    }
    doc.commit();
    return doc.toData();
  });
  return { result: { added: ids.length, ids: ids.slice(0, 500), objects: saved.data.entities.length, link: link(drawingId) }, undo: saved.undo, summary: `Added ${ids.length} objects to ${saved.drawing.name}` };
}

export async function editObjects(ctx: ToolContext, drawingId: string, input: { update?: { id: string; changes: Record<string, unknown> }[]; erase?: string[]; layout?: string }) {
  let counts = { updated: 0, erased: 0, missing: [] as string[] };
  const saved = await edit(ctx, drawingId, "changed objects", (data) => {
    const doc = new DraftDocument(data);
    doc.setSpace(spaceOf(doc, input.layout));
    doc.begin("edit");
    counts = { updated: 0, erased: 0, missing: [] };
    for (const { id, changes } of input.update ?? []) {
      const e = doc.entities.get(id);
      if (!e) {
        counts.missing.push(id);
        continue;
      }
      const { id: _id, type: _type, ...rest } = changes;
      void _id;
      void _type;
      if (typeof rest.layer === "string" && !doc.layers.has(rest.layer)) doc.setLayer(newLayer(rest.layer));
      doc.update({ ...e, ...rest } as Entity);
      counts.updated++;
    }
    for (const id of input.erase ?? []) {
      if (!doc.entities.has(id)) counts.missing.push(id);
      else {
        doc.remove(id);
        counts.erased++;
      }
    }
    doc.commit();
    return doc.toData();
  });
  return { result: { ...counts, link: link(drawingId) }, undo: saved.undo, summary: `Changed ${counts.updated} and erased ${counts.erased} objects in ${saved.drawing.name}` };
}

function spaceOf(doc: DraftDocument, layoutName?: string) {
  if (!layoutName) return MODEL;
  const layout = [...doc.layouts.values()].find((l) => l.name.toUpperCase() === layoutName.trim().toUpperCase());
  if (!layout) throw new ToolError(`There's no layout named "${layoutName}". get_drawing lists the layouts.`);
  return layout.id;
}

// --- publishing ----------------------------------------------------------------------------------

/** Plots layouts to a PDF and adds it to a project's Sheets: numbered, titled and to scale. */
export async function publishLayouts(ctx: ToolContext, drawingId: string, projectId: string, layoutNames?: string[]) {
  const drawing = await findDrawing(ctx, drawingId);
  const project = await requireProject(ctx, projectId);
  const doc = new DraftDocument(await readData(drawing.fileKey, drawing.units));
  const layouts = [...doc.layouts.values()].filter((l) => !layoutNames?.length || layoutNames.some((n) => n.trim().toUpperCase() === l.name.toUpperCase()));
  if (!layouts.length) throw new ToolError(doc.layouts.size ? "None of those layouts exist. get_drawing lists the layouts." : "This drawing has no layouts yet. Make one with run_commands (LAYOUT, New) first.");
  const bytes = await plotPdf(doc, layouts.map((l) => layoutSheet(doc, l.id)), { title: drawing.name, loadPicture: loadPicture(drawing.id) });
  const pages = layouts.map((l) => sheetFacts(doc, l.id));
  const fileName = `${drawing.name.replace(/[^\w.-]+/g, "_") || "drawing"}.pdf`;
  const set = await db.drawingSet.create({ data: { projectId: project.id, fileName, fileSize: bytes.length, uploadedById: ctx.userId } });
  const objectKey = `${project.id}/drawings/${set.id}/${fileName}`;
  try {
    await uploadBuffer(objectKey, bytes);
    await db.$transaction([
      db.sheet.createMany({
        data: pages.map((p, pageIndex) => ({
          drawingSetId: set.id,
          pageIndex,
          width: p.width,
          height: p.height,
          number: p.number,
          title: p.title,
          metersPerPoint: p.metersPerPoint,
          scaleLabel: p.metersPerPoint ? p.scaleLabel : null,
        })),
      }),
      db.drawingSet.update({ where: { id: set.id }, data: { objectKey, status: "ready", pageCount: pages.length } }),
    ]);
  } catch (err) {
    await db.drawingSet.update({ where: { id: set.id }, data: { status: "failed" } });
    console.error("Publishing layouts failed", err);
    throw new ToolError("Couldn't store the published sheets. Try again.");
  }
  return {
    projectId: project.id,
    drawingSetId: set.id,
    sheets: pages.map((p) => ({ number: p.number, title: p.title, scale: p.scaleLabel })),
    link: `/projects/${project.id}/sheets`,
  };
}
