import "server-only";
import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { APP_NAME } from "@/lib/app-config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ToolError, type ToolContext } from "@/lib/tools/context";
import { addCloud, addNote, boxSchema, flagIssue, listMarkups, listSheets, readSheet, renameSheet } from "@/lib/tools/drawings";
import { LOD_LEVELS } from "@/lib/ifc/lod";
import { buildModelPrompt, editModelPrompt } from "@/lib/mcp/model-prompts";
import { CALC_GUIDE, writeCalcPrompt } from "@/lib/mcp/calcs-prompt";
import { draftPrompt, SCRIPT_GUIDE } from "@/lib/mcp/drafting-prompt";
import { TEMPLATES } from "@/lib/calcs/library/templates";
import { createCalc, editCalc, getCalc, listCalcs, publishCalc, regionInput } from "@/lib/tools/calcs";
import { addObjects, createDrawing, editObjects, getDrawing, listDrawings, objectInput, publishLayouts, runCommands } from "@/lib/tools/drafting";
import { searchManuals } from "@/lib/tools/library";
import { createModel, editModel, getModel, ifcHelp, ifcQuery, listModels } from "@/lib/tools/models3d";
import { listElementGroups, mapGroups } from "@/lib/tools/mapping";
import { getProject, listProjects, takeoffSummary } from "@/lib/tools/projects";

// conkit as an MCP server: the user's own AI app (Claude, ChatGPT, Gemini...) does the thinking and
// calls these tools; conkit does exact work on the project and keeps the results. Each call
// is recorded in the activity log, so people can see what was done on their behalf.

const INSTRUCTIONS = `${APP_NAME} is the user's construction project workspace: PDF drawing sets (sheets), building models, a bill of quantities or schedule of values (its priced lines, also called line items), and a library of design manuals.

Typical flow: list_projects, then get_project or list_sheets to find what the user means, then read_sheet to see a sheet (text lines with positions, and an image). Use search_manuals to find the manual sections that apply, and cite them.

If a sheet's number or title in ${APP_NAME} is wrong (compare with the title block), fix it with rename_sheet.

To mark something on a sheet, use the [x0,y0,x1,y1] boxes from read_sheet: flag_issue for a review finding (cloud plus a note with the explanation and citation), add_cloud or add_note for other markups. Markups are added, never deleted, and the user reviews them in ${APP_NAME}. Give the user the links returned so they can open the sheet.

To build a 3D model (IFC) from drawings, read the sheets, start the model with create_3d_model, then build it with ifc_edit using ifcopenshell.api operations; ifc_help explains each operation and ifc_query reads the model. ${APP_NAME} checks the model, keeps one backup for undo, shows it in 3D and exports the IFC. The build_3d_model prompt has the full procedure, and edit_3d_model the one for changing a model.

To measure SOV / BoQ items from the models, use list_element_groups and map_groups (the map_to_boq prompt has the procedure).

To draft 2D drawings (plans, details, sheets), use the drafting tools: list_drawings / create_drawing, get_drawing to read one (with a picture), run_commands to draw with AutoCAD command scripts, add_objects and edit_objects for direct edits, and publish_layouts to put its layouts into a project's Sheets. The draft_drawing prompt has the procedure.

To write engineering calculations (like Mathcad: math with units, worked out live), use the Calcs tools: list_calcs / create_calc (optionally from a template), get_calc to read a worksheet and what it works out to, edit_calc to add math, text, steel sections, tables, plots and solve blocks or change them, and publish_calc to put it in a project's Sheets. The write_calc prompt has the procedure.

Models are built to a target level of development (LOD 100, 200, 300 or 350): check the drawings support it and ask the user before modelling what they don't. Keep a model's description current: ifc_edit takes a new description.`;

const uuid = z.uuid();
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const additive = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

/** Tool output as JSON text, with app links made absolute so they open from the AI app. */
function json(value: unknown): CallToolResult {
  const base = env().APP_URL;
  const isLink = (key: string) => key === "link" || key === "ifcDownload";
  const text = JSON.stringify(value, (key, v) => (isLink(key) && typeof v === "string" && v.startsWith("/") ? base + v : v), 1);
  return { content: [{ type: "text", text }] };
}

export function buildMcpServer(ctx: ToolContext) {
  const server = new McpServer({ name: APP_NAME, version: "0.1.0" }, { instructions: INSTRUCTIONS });

  /** Runs a tool, logs it, and turns failures into tool errors the AI app can act on. */
  async function run<T>(
    tool: string,
    summary: string,
    work: () => Promise<T>,
    after?: (result: T) => { projectId?: string | null; markupIds?: string[]; summary?: string; undo?: object },
  ): Promise<T | CallToolResult> {
    try {
      const result = await work();
      const extra = after?.(result) ?? {};
      await log(tool, extra.summary ?? summary, true, extra.projectId ?? null, extra.markupIds ?? [], extra.undo);
      return result;
    } catch (err) {
      const message = err instanceof ToolError ? err.message : err instanceof z.ZodError ? "Invalid input." : "Something went wrong in conkit.";
      if (!(err instanceof ToolError)) console.error(`MCP tool ${tool} failed`, err);
      await log(tool, `${summary} — failed: ${message}`, false, null, []);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  }
  const log = (tool: string, summary: string, ok: boolean, projectId: string | null, markupIds: string[], undo?: object) =>
    db.mcpActivity
      .create({
        data: { userId: ctx.userId, clientId: ctx.clientId, tool, summary: summary.slice(0, 500), ok, projectId, markupIds, undo },
      })
      .catch((e) => console.error("Could not log MCP activity", e));
  const isResult = (v: unknown): v is CallToolResult => typeof v === "object" && v !== null && "content" in v && "isError" in v;
  const out = (v: unknown) => (isResult(v) ? v : json(v));

  // --- reading -----------------------------------------------------------------

  server.registerTool(
    "list_projects",
    { title: "List projects", description: "The user's projects with what each contains.", annotations: readOnly },
    async () => out(await run("list_projects", "Listed projects", () => listProjects(ctx))),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "A project's drawing sets, models, number of BoQ / schedule of values lines (line items) and the library manuals available for review.",
      inputSchema: z.object({ project_id: uuid }),
      annotations: readOnly,
    },
    async ({ project_id }) =>
      out(await run("get_project", "Opened a project", () => getProject(ctx, project_id), (r) => ({ projectId: r.id, summary: `Opened project ${r.name}` }))),
  );

  server.registerTool(
    "list_sheets",
    {
      title: "List sheets",
      description: "The sheets (pages) of a project's drawing sets, with their scale and markup counts.",
      inputSchema: z.object({ project_id: uuid, drawing_set_id: uuid.optional() }),
      annotations: readOnly,
    },
    async ({ project_id, drawing_set_id }) =>
      out(await run("list_sheets", "Listed sheets", () => listSheets(ctx, project_id, drawing_set_id), () => ({ projectId: project_id }))),
  );

  server.registerTool(
    "read_sheet",
    {
      title: "Read sheet",
      description:
        "A sheet's text as numbered lines with their positions ([x0,y0,x1,y1] in points from the top-left) and, by default, an image of the sheet. Set include_image to false to save the conversation's capacity when only the text is needed.",
      inputSchema: z.object({ sheet_id: uuid, include_image: z.boolean().default(true) }),
      annotations: readOnly,
    },
    async ({ sheet_id, include_image }) => {
      const r = await run("read_sheet", "Read a sheet", () => readSheet(ctx, sheet_id, include_image), (v) => ({ projectId: v.sheet.projectId, summary: `Read sheet ${v.sheet.name}` }));
      if (isResult(r)) return r;
      const { image, ...rest } = r;
      const result = json(rest);
      if (image) result.content.push({ type: "image", data: image, mimeType: "image/jpeg" });
      return result;
    },
  );

  server.registerTool(
    "list_markups",
    {
      title: "List markups",
      description: "Markups on a sheet: measurements with their quantities, notes, clouds, and the BoQ / schedule of values lines (line items) they price.",
      inputSchema: z.object({ sheet_id: uuid }),
      annotations: readOnly,
    },
    async ({ sheet_id }) => out(await run("list_markups", "Listed markups", () => listMarkups(ctx, sheet_id), (v) => ({ projectId: v.projectId, summary: `Listed markups on ${v.sheet}` }))),
  );

  server.registerTool(
    "search_manuals",
    {
      title: "Search manuals",
      description:
        "Searches the design manuals in the user's library and returns the best-matching sections with text, page and a citation. Search with specific terms (e.g. 'clear cover deck reinforcement', 'vertical clearance over roadway').",
      inputSchema: z.object({ query: z.string().min(2).max(500), limit: z.number().int().min(1).max(15).default(6) }),
      annotations: readOnly,
    },
    async ({ query, limit }) => out(await run("search_manuals", `Searched manuals for "${query}"`, () => searchManuals(ctx, query, undefined, limit))),
  );

  server.registerTool(
    "takeoff_summary",
    {
      title: "Takeoff summary",
      description: "Quantities and amounts by bill of quantities / schedule of values line (contract, measured from the model and drawings, variance), as the project's report shows.",
      inputSchema: z.object({ project_id: uuid }),
      annotations: readOnly,
    },
    async ({ project_id }) =>
      out(await run("takeoff_summary", "Summarized quantities", () => takeoffSummary(ctx, project_id), (v) => ({ projectId: project_id, summary: `Summarized quantities for ${v.project}` }))),
  );

  // --- mapping models to the SOV / BoQ ---------------------------------------------

  server.registerTool(
    "list_element_groups",
    {
      title: "List element groups",
      description:
        "The element groups (category + type) of the project's counted models, with their quantities, what each is mapped to, and conkit's suggested SOV / BoQ item; plus the SOV / BoQ items with their ids. Use it before map_groups.",
      inputSchema: z.object({ project_id: uuid, only_unmapped: z.boolean().default(false) }),
      annotations: readOnly,
    },
    async ({ project_id, only_unmapped }) =>
      out(await run("list_element_groups", "Listed element groups", () => listElementGroups(ctx, project_id, only_unmapped), () => ({ projectId: project_id }))),
  );

  server.registerTool(
    "map_groups",
    {
      title: "Map element groups to SOV / BoQ items",
      description:
        "Maps element groups to SOV / BoQ items, so the items are measured from the models. Each mapping is a rule (category + type → item, by volume, area, length, perimeter or count) that applies to every counted model and carries over as models change. The quantity must match the item's unit. Returns what the items now measure against their contract quantities.",
      inputSchema: z.object({
        project_id: uuid,
        mappings: z
          .array(
            z.object({
              category: z.string().nullable().describe("Exactly as list_element_groups gives it"),
              type_name: z.string().nullable().describe("Exactly as list_element_groups gives it"),
              item_id: uuid,
              quantity: z.enum(["volume", "area", "length", "perimeter", "count"]),
            }),
          )
          .min(1)
          .max(200),
      }),
      annotations: additive,
    },
    async ({ project_id, mappings }) =>
      out(
        await run("map_groups", "Mapped element groups", () => mapGroups(ctx, project_id, mappings), (v) => ({
          projectId: project_id,
          summary: `Mapped ${v.created} element group${v.created === 1 ? "" : "s"} to SOV / BoQ items`,
          undo: v.ruleIds.length ? { type: "mapping_rules_create", ruleIds: v.ruleIds } : undefined,
        })),
      ),
  );

  // --- marking up (adds only) ----------------------------------------------------

  server.registerTool(
    "flag_issue",
    {
      title: "Flag an issue",
      description:
        "Records a review finding on a sheet: a revision cloud around the evidence and a note with the title, explanation and manual citation. Use the box of the relevant line(s) from read_sheet; leave box out if the issue is something missing.",
      inputSchema: z.object({
        sheet_id: uuid,
        title: z.string().min(3).max(120),
        detail: z.string().min(3).max(1000).describe("What the sheet shows and what the manual requires"),
        severity: z.enum(["major", "minor"]),
        citation: z.string().max(300).optional().describe("e.g. 'CDOT Bridge Design Manual §5.4.3 Clear Cover'"),
        box: boxSchema.optional(),
      }),
      annotations: additive,
    },
    async ({ sheet_id, box, ...rest }) =>
      out(
        await run("flag_issue", `Flagged "${rest.title}"`, () => flagIssue(ctx, { sheetId: sheet_id, box, ...rest }), (v) => ({
          projectId: v.projectId,
          markupIds: v.markupIds,
          summary: `Flagged "${rest.title}" on ${v.sheet}`,
        })),
      ),
  );

  server.registerTool(
    "add_cloud",
    {
      title: "Add a cloud",
      description: "Draws a revision cloud around an area of a sheet, with an optional label.",
      inputSchema: z.object({ sheet_id: uuid, box: boxSchema, label: z.string().max(200).optional() }),
      annotations: additive,
    },
    async ({ sheet_id, box, label }) =>
      out(
        await run("add_cloud", "Added a cloud", () => addCloud(ctx, { sheetId: sheet_id, box, label }), (v) => ({
          projectId: v.projectId,
          markupIds: [v.markupId],
          summary: `Added a cloud on ${v.sheet}`,
        })),
      ),
  );

  server.registerTool(
    "add_note",
    {
      title: "Add a note",
      description: "Places a text note on a sheet at a point (x, y in points from the top-left).",
      inputSchema: z.object({ sheet_id: uuid, x: z.number(), y: z.number(), text: z.string().min(1).max(2000) }),
      annotations: additive,
    },
    async ({ sheet_id, x, y, text }) =>
      out(
        await run("add_note", "Added a note", () => addNote(ctx, { sheetId: sheet_id, x, y, text }), (v) => ({
          projectId: v.projectId,
          markupIds: [v.markupId],
          summary: `Added a note on ${v.sheet}`,
        })),
      ),
  );

  server.registerTool(
    "rename_sheet",
    {
      title: "Rename a sheet",
      description:
        "Sets a sheet's number and/or title in conkit, e.g. when the detected number doesn't match the title block. Pass only what changes; an empty string clears it.",
      inputSchema: z.object({ sheet_id: uuid, number: z.string().max(40).optional(), title: z.string().max(200).optional() }),
      annotations: { ...additive, idempotentHint: true },
    },
    async ({ sheet_id, number, title }) =>
      out(
        await run("rename_sheet", "Renamed a sheet", () => renameSheet(ctx, { sheetId: sheet_id, number, title }), (v) => ({
          projectId: v.projectId,
          summary: `Renamed sheet ${v.before} to ${v.after}`,
          undo: { type: "rename_sheet", sheetId: v.sheetId, ...v.previous },
        })),
      ),
  );

  // --- 3D models (IFC, built with IfcOpenShell) ------------------------------------------

  server.registerTool(
    "create_3d_model",
    {
      title: "Create a 3D model",
      description:
        "Starts a 3D model (real IFC, built with IfcOpenShell) with its project, units, contexts, site, building or bridge, and storeys (one per floor people stand on). Returns the ids (handles) of these, including the Body context for geometry. Then build it with ifc_edit. When the project's site is pinned (get_project's site), the model is georeferenced there: its origin at the pin, turned by north.",
      inputSchema: z.object({
        project_id: uuid,
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional().describe("What it is, which sheets it comes from, the target LOD, what's included and the main assumptions"),
        source_sheet_ids: z.array(uuid).max(500).optional(),
        schema: z.enum(["IFC4", "IFC4X3"]).default("IFC4X3"),
        units: z.enum(["m", "mm", "ft", "in"]),
        facility: z.enum(["building", "bridge", "site"]).default("building"),
        lod: z.enum(LOD_LEVELS).optional().describe("Target level of development"),
        north: z
          .number()
          .min(-360)
          .max(360)
          .optional()
          .describe("Where true north is on the plans, in degrees clockwise from the model's +y axis (from the north arrow; 0 when +y is north)"),
        levels: z
          .array(z.object({ name: z.string().min(1).max(80), elevation: z.number() }))
          .max(200)
          .default([])
          .describe("One storey per floor people stand on (not ceilings)"),
      }),
      annotations: additive,
    },
    async ({ project_id, source_sheet_ids, ...rest }) =>
      out(
        await run("create_3d_model", `Created 3D model "${rest.name}"`, () => createModel(ctx, { projectId: project_id, sourceSheetIds: source_sheet_ids, ...rest }), (v) => ({
          projectId: v.projectId,
          undo: { type: "ifc_model_create", modelId: v.modelId },
        })),
      ),
  );

  server.registerTool(
    "get_3d_model",
    {
      title: "Get a 3D model",
      description: "A 3D model's summary: elements by IFC class, storeys and rooms, contexts, LOD, and warnings about how it's organized.",
      inputSchema: z.object({ model_id: uuid }),
      annotations: readOnly,
    },
    async ({ model_id }) => out(await run("get_3d_model", "Opened a 3D model", () => getModel(ctx, model_id), (v) => ({ projectId: v.projectId, summary: `Opened 3D model "${v.name}"` }))),
  );

  server.registerTool(
    "list_3d_models",
    { title: "List 3D models", description: "The 3D models built in a project.", inputSchema: z.object({ project_id: uuid }), annotations: readOnly },
    async ({ project_id }) => out(await run("list_3d_models", "Listed 3D models", () => listModels(ctx, project_id), () => ({ projectId: project_id }))),
  );

  server.registerTool(
    "ifc_edit",
    {
      title: "Edit a 3D model",
      description: `Applies a list of ifcopenshell.api operations to a 3D model, in order, as one change (all or nothing). Each operation is {"op": "module.function", "args": {...}, "as": "name"}; the model itself is passed for you. In args, "#123" is the entity with id 123 and "$name" is the result of an earlier operation in the same list named with "as". Lists of numbers under "matrix" become 4x4 matrices; "conkit.matrix" builds one from {"location":[x,y,z], "x_axis":[...], "z_axis":[...]} or {"location", "rotation_z": degrees}.
Typical element: root.create_entity {ifc_class, name, predefined_type} → spatial.assign_container {products:["$el"], relating_structure:"#storey"} → geometry.add_wall_representation / add_slab_representation / add_profile_representation {context:"#body", ...} → geometry.assign_representation → geometry.edit_object_placement {product, matrix}. Openings: create an IfcOpeningElement with geometry and placement, feature.add_feature {feature, element}, then feature.add_filling {opening, element} for the door or window. Use ifc_help for any operation's arguments.
Edits in one request build one revision of the model; the user can undo the whole request from Connections.`,
      inputSchema: z.object({
        model_id: uuid,
        operations: z
          .array(z.object({ op: z.string().min(3).max(80), args: z.record(z.string(), z.unknown()).default({}), as: z.string().max(60).optional() }))
          .max(500)
          .describe("Leave empty to change only the description"),
        note: z.string().max(300).optional(),
        description: z.string().max(2000).optional().describe("The model's updated description, when the change affects what it says"),
      }),
      annotations: { ...additive, destructiveHint: true },
    },
    async ({ model_id, operations, note, description }) =>
      out(
        await run("ifc_edit", "Edited a 3D model", () => editModel(ctx, { modelId: model_id, operations, note, description }), (v) => ({
          projectId: v.projectId,
          summary: operations.length
            ? `Edited 3D model "${v.name}" (${operations.length} operation${operations.length === 1 ? "" : "s"}), revision ${v.revision}`
            : `Updated the description of "${v.name}"`,
          undo: operations.length && v.backupKey ? { type: "ifc_model_restore", modelId: v.modelId, backupKey: v.backupKey } : undefined,
        })),
      ),
  );

  server.registerTool(
    "ifc_query",
    {
      title: "Query a 3D model",
      description:
        "Lists elements matching an IfcOpenShell selector (e.g. 'IfcWall', 'IfcSlab, IfcBeam', 'IfcWall, Name=W1') with their ids, or, given an id, returns that entity's attributes, property sets, container, type, material and placement.",
      inputSchema: z.object({ model_id: uuid, select: z.string().max(500).optional(), id: z.number().int().positive().optional() }),
      annotations: readOnly,
    },
    async ({ model_id, select, id }) =>
      out(await run("ifc_query", "Queried a 3D model", () => ifcQuery(ctx, { modelId: model_id, select, id }), (v) => ({ projectId: v.projectId }))),
  );

  server.registerTool(
    "ifc_help",
    {
      title: "IfcOpenShell operation help",
      description: "The signature and documentation of an ifcopenshell.api operation (e.g. 'geometry.add_wall_representation'), or the list of operations in a module (e.g. 'feature').",
      inputSchema: z.object({ usecase: z.string().min(2).max(80) }),
      annotations: readOnly,
    },
    async ({ usecase }) => out(await run("ifc_help", `Looked up ${usecase}`, () => ifcHelp(usecase))),
  );

  // --- drafting ------------------------------------------------------------------

  /** A result with a picture after its JSON (get_drawing, run_commands). */
  const withImage = (rest: unknown, image: string | null) => {
    const result = json(rest);
    if (image) result.content.push({ type: "image", data: image, mimeType: "image/jpeg" });
    return result;
  };

  server.registerTool(
    "list_drawings",
    { title: "List drawings", description: "The user's 2D drafting drawings (CAD drawings made in conkit's AutoCAD-like editor), with their units and size.", annotations: readOnly },
    async () => out(await run("list_drawings", "Listed drawings", () => listDrawings(ctx))),
  );

  server.registerTool(
    "create_drawing",
    {
      title: "Create drawing",
      description: "A new, empty 2D drawing. Units: architectural (inches, read as feet and inches) or mm.",
      inputSchema: z.object({ name: z.string().min(1).max(200), units: z.enum(["architectural", "mm"]) }),
      annotations: additive,
    },
    async (input) =>
      out(await run("create_drawing", `Created drawing ${input.name}`, () => createDrawing(ctx, input), (v) => ({ undo: { type: "drawing_create", drawingId: v.id } }))),
  );

  server.registerTool(
    "get_drawing",
    {
      title: "Read drawing",
      description:
        "A drawing's units, layers, styles, blocks, layouts and viewports, its extents and object counts, its objects (filtered by layer, type or region [x0,y0,x1,y1]; up to `limit`, default 200), and by default a picture: all of model space with its corner coordinates, or a layout as it plots.",
      inputSchema: z.object({
        drawing_id: uuid,
        layout: z.string().optional().describe("A layout's name, to read its paper instead of model space"),
        include_image: z.boolean().default(true),
        layer: z.string().optional(),
        type: z.string().optional().describe("line, polyline, circle, arc, text, mtext, dimension, leader, hatch, insert, viewport..."),
        region: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
        limit: z.number().int().min(0).max(1000).optional(),
      }),
      annotations: readOnly,
    },
    async ({ drawing_id, layout, include_image, layer, type, region, limit }) => {
      const r = await run("get_drawing", "Read a drawing", () => getDrawing(ctx, drawing_id, { layout, includeImage: include_image, objects: { layer, type, region, limit } }), (v) => ({ summary: `Read drawing ${v.result.name}` }));
      return isResult(r) ? r : withImage(r.result, r.image);
    },
  );

  server.registerTool(
    "run_commands",
    {
      title: "Draft with commands",
      description: `Runs an AutoCAD-style command script on a drawing and saves it: the same commands, prompts and checks as the editor's command line. Returns the transcript (read it for errors), what was added, changed and erased, and optionally a picture.\n\n${SCRIPT_GUIDE}`,
      inputSchema: z.object({
        drawing_id: uuid,
        script: z.string().min(1).max(200_000),
        layout: z.string().optional().describe("Run on this layout's paper instead of model space"),
        include_image: z.boolean().default(false),
      }),
      annotations: additive,
    },
    async ({ drawing_id, script, layout, include_image }) => {
      const r = await run("run_commands", "Drafted with commands", () => runCommands(ctx, drawing_id, script, { layout, includeImage: include_image }), (v) => ({ summary: v.summary, undo: v.undo }));
      return isResult(r) ? r : withImage(r.result, r.image);
    },
  );

  server.registerTool(
    "add_objects",
    {
      title: "Add objects",
      description:
        "Adds objects to a drawing directly, in drawing units (angles in radians): lines, polylines (bulges for arc segments), circles, arcs, ellipses, splines, text, mtext, dimensions, leaders, hatches (closed loops of points) and block references. Layers that don't exist are made. Quicker than run_commands for many plain objects.",
      inputSchema: z.object({ drawing_id: uuid, layout: z.string().optional(), objects: z.array(objectInput).min(1).max(5000) }),
      annotations: additive,
    },
    async ({ drawing_id, layout, objects }) => out(await run("add_objects", `Added ${objects.length} objects`, () => addObjects(ctx, drawing_id, objects, { layout }), (v) => ({ summary: v.summary, undo: v.undo }))),
  );

  server.registerTool(
    "edit_objects",
    {
      title: "Edit objects",
      description:
        "Changes objects by id (any of their properties: geometry, layer, color, text, a viewport's scale or view, a block reference's attribs...) and erases objects by id. Ids come from get_drawing or the results of the drafting tools.",
      inputSchema: z.object({
        drawing_id: uuid,
        layout: z.string().optional(),
        update: z.array(z.object({ id: z.string(), changes: z.record(z.string(), z.unknown()) })).max(5000).optional(),
        erase: z.array(z.string()).max(5000).optional(),
      }),
      annotations: { ...additive, destructiveHint: true },
    },
    async ({ drawing_id, layout, update, erase }) => out(await run("edit_objects", "Edited objects", () => editObjects(ctx, drawing_id, { layout, update, erase }), (v) => ({ summary: v.summary, undo: v.undo }))),
  );

  server.registerTool(
    "publish_layouts",
    {
      title: "Publish layouts to Sheets",
      description: "Plots a drawing's layouts (all, or those named) to a PDF and adds it to a project's Sheets as a drawing set: each layout a sheet, numbered and titled from its title block and scaled from its viewport.",
      inputSchema: z.object({ drawing_id: uuid, project_id: uuid, layouts: z.array(z.string()).optional() }),
      annotations: additive,
    },
    async ({ drawing_id, project_id, layouts }) =>
      out(
        await run("publish_layouts", "Published layouts", () => publishLayouts(ctx, drawing_id, project_id, layouts), (v) => ({
          projectId: v.projectId,
          summary: `Published ${v.sheets.length} sheet${v.sheets.length === 1 ? "" : "s"} to Sheets`,
        })),
      ),
  );

  // --- calcs ---------------------------------------------------------------------

  server.registerTool(
    "list_calcs",
    { title: "List calcs", description: "The user's calculation worksheets (Calcs, like Mathcad), with their project and size.", annotations: readOnly },
    async () => out(await run("list_calcs", "Listed calcs", () => listCalcs(ctx))),
  );

  server.registerTool(
    "create_calc",
    {
      title: "Create calc",
      description: `A new calculation worksheet, empty or from a template: ${TEMPLATES.map((t) => `${t.id} (${t.description})`).join("; ")}. Units: USCS (results in kip, ft, ksi) or SI (kN, m, MPa).`,
      inputSchema: z.object({
        name: z.string().min(1).max(200),
        units: z.enum(["USCS", "SI"]),
        template: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]).optional(),
        project_id: uuid.optional().describe("File it under this project"),
      }),
      annotations: additive,
    },
    async (input) => out(await run("create_calc", `Created calc ${input.name}`, () => createCalc(ctx, input), (v) => ({ projectId: v.project?.id, undo: { type: "calc_create", calcId: v.id } }))),
  );

  server.registerTool(
    "get_calc",
    {
      title: "Read calc",
      description:
        "A worksheet's header, settings and regions in reading order: each one's id, kind, place [x, y] (pixels on the page; the page's content size is given), what it holds (LaTeX math, text, a steel shape, a table, a plot, a solve block) and what it works out to (result as LaTeX, names defined, or error), and a list of the errors.",
      inputSchema: z.object({ calc_id: uuid }),
      annotations: readOnly,
    },
    async ({ calc_id }) => out(await run("get_calc", "Read a calc", () => getCalc(ctx, calc_id), (v) => ({ projectId: v.project?.id, summary: `Read calc ${v.name}` }))),
  );

  server.registerTool(
    "edit_calc",
    {
      title: "Edit calc",
      description: `Writes in a worksheet and saves it: adds regions (stacked in order below the last region, or below the region given as after, moving what's below down; or from a place [x, y]), changes regions by id (any of their fields, e.g. latex, text, shape, at), removes regions by id, and sets the header (project, title, number, by, checked, date), units and decimal places. Returns what the added and changed regions work out to, and every error in the worksheet.\n\n${CALC_GUIDE}`,
      inputSchema: z.object({
        calc_id: uuid,
        add: z.array(regionInput).max(300).optional(),
        after: z.string().max(40).optional().describe("Add below this region (its id)"),
        at: z.tuple([z.number().min(0), z.number().min(0)]).optional().describe("Add from this place [x, y], in pixels on the worksheet"),
        update: z.array(z.object({ id: z.string(), changes: z.record(z.string(), z.unknown()) })).max(300).optional(),
        remove: z.array(z.string()).max(300).optional(),
        header: z.object({ project: z.string().max(200), title: z.string().max(200), number: z.string().max(60), by: z.string().max(60), checked: z.string().max(60), date: z.string().max(40) }).partial().optional(),
        units: z.enum(["USCS", "SI"]).optional(),
        decimals: z.number().int().min(0).max(6).optional(),
      }),
      annotations: { ...additive, destructiveHint: true },
    },
    async ({ calc_id, ...input }) => out(await run("edit_calc", "Edited a calc", () => editCalc(ctx, calc_id, input), (v) => ({ summary: v.summary, undo: v.undo }))),
  );

  server.registerTool(
    "publish_calc",
    {
      title: "Publish calc to Sheets",
      description: "Prints a worksheet to a PDF (as it prints from the editor, with the calc header on each page) and adds it to a project's Sheets as a set, a sheet per page. Without project_id it goes to the project the worksheet is filed under.",
      inputSchema: z.object({ calc_id: uuid, project_id: uuid.optional() }),
      annotations: additive,
    },
    async ({ calc_id, project_id }) =>
      out(
        await run("publish_calc", "Published a calc", () => publishCalc(ctx, calc_id, project_id), (v) => ({
          projectId: v.projectId,
          summary: `Published a calc to Sheets (${v.sheets} sheet${v.sheets === 1 ? "" : "s"})`,
        })),
      ),
  );

  // --- skills (ready-made prompts) ------------------------------------------------

  const user = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

  server.registerPrompt(
    "review_sheet",
    {
      title: "Review a sheet against the manuals",
      description: "Checks one sheet against the design manuals in your library and flags real issues on it.",
      argsSchema: z.object({
        sheet: z.string().describe("Sheet id, or a description like 'B1 in the Jewell set'"),
        focus: z.string().optional().describe("Optional topic to focus on, e.g. concrete and reinforcement"),
      }),
    },
    ({ sheet, focus }) =>
      user(`Review this sheet in ${APP_NAME} against the design manuals in my library: ${sheet}.${focus ? ` Focus on: ${focus}.` : ""}

1. Find the sheet (list_projects / list_sheets if I didn't give an id) and read it with read_sheet.
2. Work out which requirements apply to what this sheet shows, and look them up with search_manuals (several specific searches).
3. Compare. Report only real issues: a statement that conflicts with a manual requirement, something the manual requires on this kind of sheet that is clearly missing, or a definite inconsistency within the sheet. Skip style points and anything you can't read with confidence.
4. For each issue, call flag_issue with the box of the relevant line(s), a short title, the detail (quote the sheet and the manual), severity, and the citation.
5. Finish with a short list of what you flagged and the link to the sheet. If there's nothing to flag, say so.`),
  );

  server.registerPrompt(
    "explain_sheet",
    {
      title: "Explain a sheet",
      description: "A plain-language walkthrough of what a sheet shows and the key values on it.",
      argsSchema: z.object({ sheet: z.string().describe("Sheet id, or a description like 'B1 in the Jewell set'") }),
    },
    ({ sheet }) =>
      user(`Explain this sheet from ${APP_NAME} in plain language: ${sheet}. Find it if needed, read it with read_sheet, and walk me through what it shows: its purpose, the main elements, key dimensions, materials and design values, and anything a contractor or reviewer should pay attention to. Don't add markups.`),
  );

  server.registerPrompt(
    "quantity_summary",
    {
      title: "Summarize quantities and cost",
      description: "A readable summary of a project's measured quantities against its bill of quantities or schedule of values.",
      argsSchema: z.object({ project: z.string().describe("Project id or name") }),
    },
    ({ project }) =>
      user(`Summarize quantities and cost for this ${APP_NAME} project: ${project}. Find it with list_projects if needed, then use takeoff_summary. Give the totals, the lines with the largest variance between contract and measured quantities, lines with no measured quantity, and anything flagged. Use a compact table, and end with the link to the report.`),
  );

  server.registerPrompt(
    "map_to_boq",
    {
      title: "Map models to the SOV / BoQ",
      description: "Links the project's model elements to its SOV / BoQ items so they're measured from the models, checking the results against the contract quantities.",
      argsSchema: z.object({ project: z.string().describe("Project id or name") }),
    },
    ({ project }) =>
      user(`Map the models in ${APP_NAME} project ${project} to its SOV / BoQ.

1. Find the project (list_projects), then call list_element_groups. It gives the element groups of the models that count, conkit's suggestion for each, and the SOV / BoQ items with their ids.
2. For each group, decide which item it belongs to and by which quantity: volume for concrete (m³, CY), area for walls, slabs, finishes and roofing (m², SF), length for beams, railings and skirting (m, LF; perimeter for rooms), count for doors, windows, fixtures and furniture (EA, nr). Use the suggestion when it fits; read the item descriptions and codes, not just the names. A group can price more than one item (e.g. a concrete wall: its volume for concrete, its area for formwork).
3. Leave groups unmapped when nothing in the SOV / BoQ fits, and don't force a match. If you're unsure about a mapping that matters (a large quantity or value), ask me first.
4. Map with map_groups, in batches. Check what each item now measures against its contract quantity, and look into large differences: a wrong group, a missing one, or the same thing in two models (switch a duplicate model off on the Models page).
5. Finish with a table of what you mapped (group → item, quantity), the items still unmeasured, notable differences from the contract, and the link to the mapping page.`),
  );

  server.registerPrompt(
    "build_3d_model",
    {
      title: "Build a 3D model from drawings",
      description: "Reads a drawing set and builds a 3D IFC model of it in conkit (structural, architectural or both) to the level of development (LOD) you choose, checking first that the drawings support it.",
      argsSchema: z.object({
        drawings: z.string().describe("Which drawings, e.g. 'the Jewell bridge set' or 'sheets A101-A105 in Riverside'"),
        discipline: z.string().optional().describe("structural, architectural, or both (default: what the drawings show)"),
        lod: z.string().optional().describe("Level of development: 100 (massing), 200 (generic), 300 (specific, default) or 350 (coordinated)"),
        focus: z.string().optional().describe("Optional: part to model, e.g. 'level 1 only' or 'the east approach'"),
      }),
    },
    (args) => user(buildModelPrompt(args)),
  );

  server.registerPrompt(
    "edit_3d_model",
    {
      title: "Change a 3D model",
      description: "Changes an existing 3D model with IfcOpenShell: add or fix elements, openings, assemblies, types or property sets, keeping it well organized.",
      argsSchema: z.object({
        model: z.string().describe("The model's id or name"),
        task: z.string().describe("What to change, e.g. 'add the stair openings in the level 2 slab' or 'group the roof layers under one roof'"),
        lod: z.string().optional().describe("Target level of development for what's added: 100, 200, 300 or 350 (default: the model's own)"),
      }),
    },
    (args) => user(editModelPrompt(args)),
  );

  server.registerPrompt(
    "draft_drawing",
    {
      title: "Draft a 2D drawing",
      description: "Drafts plans, details or sheets in conkit's AutoCAD-like editor: layers, geometry, text, dimensions, hatches, blocks and layouts, checked against a picture as it goes.",
      argsSchema: z.object({
        task: z.string().describe("What to draw, e.g. 'a 30 x 40 ft single-storey house plan with dimensions' or 'trace sheet A101 in Riverside'"),
        drawing: z.string().optional().describe("An existing drawing's name or id (default: a new one)"),
      }),
    },
    (args) => user(draftPrompt(args)),
  );

  server.registerPrompt(
    "write_calc",
    {
      title: "Write an engineering calc",
      description: "Writes a calculation in conkit's Calcs, like Mathcad: inputs, steel sections, code checks with references, worked out live with units, ready for a checker.",
      argsSchema: z.object({
        task: z.string().describe("What to calculate, e.g. 'check a W16x31 beam spanning 24 ft with 1.2 klf dead and 0.8 klf live load' or 'size a spread footing for 150 kip'"),
        calc: z.string().optional().describe("An existing worksheet's name or id (default: a new one)"),
      }),
    },
    (args) => user(writeCalcPrompt(args)),
  );

  return server;
}
