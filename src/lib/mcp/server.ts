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
import { modelPatchSchema, modelSpecSchema } from "@/lib/ifc/spec";
import { buildModelPrompt, detailedModelPrompt } from "@/lib/mcp/model-prompts";
import { searchManuals } from "@/lib/tools/library";
import {
  convertToDetailed,
  create3dModel,
  createDetailedModel,
  get3dModel,
  ifcEdit,
  ifcHelp,
  ifcQuery,
  list3dModels,
  update3dModel,
} from "@/lib/tools/models3d";
import { getProject, listProjects, takeoffSummary } from "@/lib/tools/projects";

// conkit as an MCP server: the user's own AI app (Claude, ChatGPT, Gemini...) does the thinking and
// calls these tools; conkit does exact work on the project and keeps the results. Each call
// is recorded in the activity log, so people can see what was done on their behalf.

const INSTRUCTIONS = `${APP_NAME} is the user's construction project workspace: PDF drawing sets (sheets), building models, a bill of quantities or schedule of values (its priced lines, also called line items), and a library of design manuals.

Typical flow: list_projects, then get_project or list_sheets to find what the user means, then read_sheet to see a sheet (text lines with positions, and an image). Use search_manuals to find the manual sections that apply, and cite them.

If a sheet's number or title in ${APP_NAME} is wrong (compare with the title block), fix it with rename_sheet.

To mark something on a sheet, use the [x0,y0,x1,y1] boxes from read_sheet: flag_issue for a review finding (cloud plus a note with the explanation and citation), add_cloud or add_note for other markups. Markups are added, never deleted, and the user reviews them in ${APP_NAME}. Give the user the links returned so they can open the sheet.

To build a 3D model (IFC) from drawings, read the sheets, then describe the structure with create_3d_model (elements are cross-section profiles swept along paths) and refine it with update_3d_model. ${APP_NAME} checks the model, keeps its revisions, shows it in 3D and exports IFC. The build_3d_model prompt has the full procedure.

For detail beyond that format (openings in any element, booleans and clippings, layered walls, types, property sets, alignments), use a detailed model: create_detailed_model (or convert_to_detailed), then ifc_edit with ifcopenshell.api operations; ifc_help explains each operation and ifc_query reads the model. The detailed_ifc_model prompt has the procedure.

Models are built to a target level of development (LOD 100, 200, 300 or 350): check the drawings support it and ask the user before modelling what they don't. Keep a model's description current: update_3d_model and ifc_edit take a new description.`;

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

  // --- 3D models (IFC) from drawings ------------------------------------------------

  server.registerTool(
    "create_3d_model",
    {
      title: "Create a 3D model",
      description: `Creates a 3D model (compiled to IFC4X3) in a project from a structured description you build from the drawings. Each element is a cross-section profile swept along a path of points:
- Vertical members (columns, piers, piles, footings, slabs, decks): path goes up or down in z; the profile lies in plan (x east, y north). A slab is a polygon profile swept through its thickness.
- Horizontal or sloping members (beams, girders, walls, barriers): the profile is across the member (x) and up (y); anchor "bottom" puts a wall on its base line, "top" hangs a girder from the deck line.
- Curved members: several path points along the curve.
- Doors and windows go in openings: each names its host wall, its offset along the wall, sill height, width and height; conkit cuts the opening and places the door or window.
- Rooms go in spaces: name, number, floor outline, floor elevation and height.
- Sloped roofs: a thin rect profile swept along the eave line and rotated by the pitch.
Use the drawings' units and real elevations, a meaningful id per element, its mark and source sheet, and note assumptions in notes. Returns a summary (counts, volumes, extents, warnings) to check against the drawings, and links to view and download the IFC.`,
      inputSchema: z.object({
        project_id: uuid,
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional().describe("What was modelled, from which sheets, the level of detail and key assumptions"),
        source_sheet_ids: z.array(uuid).max(500).optional(),
        model: modelSpecSchema,
      }),
      annotations: additive,
    },
    async ({ project_id, name, description, source_sheet_ids, model }) =>
      out(
        await run(
          "create_3d_model",
          `Created 3D model "${name}"`,
          () => create3dModel(ctx, { projectId: project_id, name, description, sourceSheetIds: source_sheet_ids, spec: model }),
          (v) => ({
            projectId: v.projectId,
            summary: `Created 3D model "${name}" (${v.summary.elements} elements)`,
            undo: { type: "ifc_model_create", modelId: v.modelId },
          }),
        ),
      ),
  );

  server.registerTool(
    "update_3d_model",
    {
      title: "Update a 3D model",
      description:
        "Changes a 3D model without resending it: add or replace elements by id, remove elements, or replace levels or materials. Each update is a new revision the user can undo. Returns the updated summary.",
      inputSchema: z.object({
        model_id: uuid,
        changes: modelPatchSchema,
        note: z.string().max(300).optional().describe("What changed and why"),
        description: z.string().max(2000).optional().describe("The model's updated description, when the change affects what it says"),
      }),
      annotations: { ...additive, destructiveHint: true },
    },
    async ({ model_id, changes, note, description }) =>
      out(
        await run("update_3d_model", "Updated a 3D model", () => update3dModel(ctx, { modelId: model_id, patch: changes, note, description }), (v) => ({
          projectId: v.projectId,
          summary: `Updated 3D model "${v.name}" to revision ${v.revision} (+${v.changed.upserted} / -${v.changed.removed} elements)`,
          undo: { type: "ifc_model_restore", modelId: v.modelId, revision: v.previousRevision },
        })),
      ),
  );

  server.registerTool(
    "get_3d_model",
    {
      title: "Get a 3D model",
      description: "A 3D model's summary (counts, volumes by type and material, extents, warnings), levels, materials and revisions; set include_elements to get the elements too.",
      inputSchema: z.object({ model_id: uuid, include_elements: z.boolean().default(false) }),
      annotations: readOnly,
    },
    async ({ model_id, include_elements }) =>
      out(await run("get_3d_model", "Opened a 3D model", () => get3dModel(ctx, model_id, include_elements), (v) => ({ projectId: v.projectId, summary: `Opened 3D model "${v.name}"` }))),
  );

  server.registerTool(
    "list_3d_models",
    { title: "List 3D models", description: "The 3D models built in a project.", inputSchema: z.object({ project_id: uuid }), annotations: readOnly },
    async ({ project_id }) => out(await run("list_3d_models", "Listed 3D models", () => list3dModels(ctx, project_id), () => ({ projectId: project_id }))),
  );

  // --- detailed models (IFC, edited with IfcOpenShell) -------------------------------

  server.registerTool(
    "create_detailed_model",
    {
      title: "Create a detailed IFC model",
      description:
        "Starts an empty detailed model (real IFC, edited with IfcOpenShell) with project, units, contexts, site, building or bridge, and storeys. Returns the ids (handles) of these, including the Body context for geometry. Then build it with ifc_edit.",
      inputSchema: z.object({
        project_id: uuid,
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        schema: z.enum(["IFC4", "IFC4X3"]).default("IFC4X3"),
        units: z.enum(["m", "mm", "ft", "in"]),
        facility: z.enum(["building", "bridge", "site"]).default("building"),
        lod: z.enum(LOD_LEVELS).optional().describe("Target level of development"),
        levels: z
          .array(z.object({ name: z.string().min(1).max(80), elevation: z.number() }))
          .max(200)
          .default([])
          .describe("One storey per floor people stand on (not ceilings)"),
      }),
      annotations: additive,
    },
    async ({ project_id, ...rest }) =>
      out(
        await run("create_detailed_model", `Created detailed model "${rest.name}"`, () => createDetailedModel(ctx, { projectId: project_id, ...rest }), (v) => ({
          projectId: v.projectId,
          undo: { type: "ifc_model_create", modelId: v.modelId },
        })),
      ),
  );

  server.registerTool(
    "convert_to_detailed",
    {
      title: "Convert to a detailed model",
      description: "Turns a model in conkit's format into a detailed IFC model, so it can be refined with ifc_edit. One way: afterwards update_3d_model no longer applies (earlier revisions can still be restored).",
      inputSchema: z.object({ model_id: uuid }),
      annotations: { ...additive, destructiveHint: true },
    },
    async ({ model_id }) =>
      out(
        await run("convert_to_detailed", "Converted a model to detailed IFC", () => convertToDetailed(ctx, model_id), (v) => ({
          projectId: v.projectId,
          summary: `Converted "${v.name}" to a detailed IFC model`,
          undo: { type: "ifc_model_restore", modelId: v.modelId, revision: v.previousRevision },
        })),
      ),
  );

  server.registerTool(
    "ifc_edit",
    {
      title: "Edit a detailed IFC model",
      description: `Applies a list of ifcopenshell.api operations to a detailed model, in order, as one revision (all or nothing). Each operation is {"op": "module.function", "args": {...}, "as": "name"}; the model itself is passed for you. In args, "#123" is the entity with id 123 and "$name" is the result of an earlier operation in the same list named with "as". Lists of numbers under "matrix" become 4x4 matrices; "conkit.matrix" builds one from {"location":[x,y,z], "x_axis":[...], "z_axis":[...]} or {"location", "rotation_z": degrees}.
Typical element: root.create_entity {ifc_class, name, predefined_type} → spatial.assign_container {products:["$el"], relating_structure:"#storey"} → geometry.add_wall_representation / add_slab_representation / add_profile_representation {context:"#body", ...} → geometry.assign_representation → geometry.edit_object_placement {product, matrix}. Openings: create an IfcOpeningElement with geometry and placement, feature.add_feature {feature, element}, then feature.add_filling {opening, element} for the door or window. Use ifc_help for any operation's arguments.`,
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
        await run("ifc_edit", "Edited a detailed model", () => ifcEdit(ctx, { modelId: model_id, operations, note, description }), (v) => ({
          projectId: v.projectId,
          summary: operations.length
            ? `Edited detailed model "${v.name}" (${operations.length} operation${operations.length === 1 ? "" : "s"}) to revision ${v.revision}`
            : `Updated the description of "${v.name}"`,
          undo: operations.length ? { type: "ifc_model_restore", modelId: v.modelId, revision: v.previousRevision } : undefined,
        })),
      ),
  );

  server.registerTool(
    "ifc_query",
    {
      title: "Query a detailed IFC model",
      description:
        "Lists elements matching an IfcOpenShell selector (e.g. 'IfcWall', 'IfcSlab, IfcBeam', 'IfcWall, Name=W1') with their ids, or, given an id, returns that entity's attributes, property sets, container, type, material and placement.",
      inputSchema: z.object({ model_id: uuid, select: z.string().max(500).optional(), id: z.number().int().positive().optional() }),
      annotations: readOnly,
    },
    async ({ model_id, select, id }) =>
      out(await run("ifc_query", "Queried a detailed model", () => ifcQuery(ctx, { modelId: model_id, select, id }), (v) => ({ projectId: v.projectId }))),
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
    "detailed_ifc_model",
    {
      title: "Build or refine a detailed IFC model",
      description: "Models in real IFC with IfcOpenShell, for detail beyond the standard format (openings anywhere, assemblies, layered elements, types, property sets), to a target LOD and well organized.",
      argsSchema: z.object({
        task: z.string().describe("What to model or change, e.g. 'add the stair openings in the level 2 slab' or 'model the pier caps with their chamfers'"),
        model: z.string().optional().describe("Existing model id or name, if refining one"),
        lod: z.string().optional().describe("Level of development: 100, 200, 300 (default) or 350"),
      }),
    },
    (args) => user(detailedModelPrompt(args)),
  );

  return server;
}
