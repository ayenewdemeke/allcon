import "server-only";
import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { APP_NAME } from "@/lib/app-config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ToolError, type ToolContext } from "@/lib/tools/context";
import { addCloud, addNote, boxSchema, flagIssue, listMarkups, listSheets, readSheet, renameSheet } from "@/lib/tools/drawings";
import { searchManuals } from "@/lib/tools/library";
import { getProject, listProjects, takeoffSummary } from "@/lib/tools/projects";

// conkit as an MCP server: the user's own AI app (Claude, ChatGPT...) does the thinking and
// calls these tools; conkit does exact work on the project and keeps the results. Each call
// is recorded in the activity log, so people can see what was done on their behalf.

const INSTRUCTIONS = `${APP_NAME} is the user's construction project workspace: PDF drawing sets (sheets), building models, a schedule of values, and a library of design manuals.

Typical flow: list_projects, then get_project or list_sheets to find what the user means, then read_sheet to see a sheet (text lines with positions, and an image). Use search_manuals to find the manual sections that apply, and cite them.

If a sheet's number or title in ${APP_NAME} is wrong (compare with the title block), fix it with rename_sheet.

To mark something on a sheet, use the [x0,y0,x1,y1] boxes from read_sheet: flag_issue for a review finding (cloud plus a note with the explanation and citation), add_cloud or add_note for other markups. Markups are added, never deleted, and the user reviews them in ${APP_NAME}. Give the user the links returned so they can open the sheet.`;

const uuid = z.uuid();
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const additive = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

/** Tool output as JSON text, with app links made absolute so they open from the AI app. */
function json(value: unknown): CallToolResult {
  const base = env().APP_URL;
  const text = JSON.stringify(value, (key, v) => (key === "link" && typeof v === "string" && v.startsWith("/") ? base + v : v), 1);
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
      description: "A project's drawing sets, models, line item count and the library manuals available for review.",
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
      description: "Markups on a sheet: measurements with their quantities, notes, clouds, and the line items they price.",
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
      description: "Quantities and amounts by line item (contract, measured from the model and drawings, variance), as the project's report shows.",
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
      description: "A readable summary of a project's measured quantities against its schedule of values.",
      argsSchema: z.object({ project: z.string().describe("Project id or name") }),
    },
    ({ project }) =>
      user(`Summarize quantities and cost for this ${APP_NAME} project: ${project}. Find it with list_projects if needed, then use takeoff_summary. Give the totals, the lines with the largest variance between contract and measured quantities, lines with no measured quantity, and anything flagged. Use a compact table, and end with the link to the report.`),
  );

  return server;
}
