import { MODEL } from "./document";
import { Editor } from "./editor";
import type { DrawingData, Entity } from "./types";

// Scripts, as AutoCAD runs .scr files: each line is what would be typed at the command line
// (a command, an option, a point, a distance), and an empty line is Enter. Text a command asks
// for (TEXT, MTEXT, MLEADER) is the lines that follow, up to an empty line. The block dialog
// takes the block's name from the next line. This is how AI apps draft through the connector:
// the same commands, prompts and checks a person gets, with the transcript to read back.

export const MAX_SCRIPT_LINES = 5000;

export type ScriptResult = {
  data: DrawingData;
  /** The command line's history while the script ran, as AutoCAD shows it. */
  transcript: string[];
  errors: string[];
  added: Entity[];
  changed: number;
  erased: number;
};

/** Runs a script on a drawing (in model space, or on a layout by name) and returns the result. */
export function runScript(data: DrawingData, script: string, options: { layout?: string } = {}): ScriptResult {
  // Scripts type absolute coordinates (dynamic input off), with no snaps or tracking moving them.
  const ed = new Editor(data, { dynamic: false, osnap: false, polar: false, ortho: false, grid: false, snap: false });
  ed.setSize(1600, 1200);
  ed.zoomExtents();
  if (options.layout) {
    const layout = [...ed.doc.layouts.values()].find((l) => l.name.toUpperCase() === options.layout!.trim().toUpperCase());
    if (!layout) throw new Error(`There's no layout named "${options.layout}".`);
    ed.setLayout(layout.id);
  }
  const before = snapshot(ed);
  const start = ed.history.length;
  // A final newline ends the last line; it isn't an extra Enter.
  const lines = script.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  if (lines.length > MAX_SCRIPT_LINES) throw new Error(`Scripts can have up to ${MAX_SCRIPT_LINES} lines; split this one.`);

  let text: string[] | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (text) {
      // Typing text: up to an empty line.
      if (line === "") {
        ed.closeTextEditor(text.join("\n"));
        text = null;
      } else text.push(line.replace(/\\P/g, "\n"));
      continue;
    }
    if (line.trimStart().startsWith(";")) continue; // a comment
    if (ed.dialog) {
      answerDialog(ed, line.trim());
      continue;
    }
    ed.answer(line.trim());
    if (ed.textEdit) text = [];
  }
  if (text) ed.closeTextEditor(text.join("\n"));
  if (ed.dialog) ed.closeDialog(null);
  // A command left waiting at the end is ended, as Esc would.
  if (ed.command) ed.cancel();
  if (ed.viewport) ed.exitViewport();

  const after = snapshot(ed);
  const added: Entity[] = [];
  let changed = 0;
  let erased = 0;
  for (const [key, e] of after) {
    const was = before.get(key);
    if (!was) added.push(e.entity);
    else if (was.json !== e.json) changed++;
  }
  for (const key of before.keys()) if (!after.has(key)) erased++;
  const transcript = ed.history.slice(start).map((h) => h.text);
  const errors = ed.history.slice(start).filter((h) => h.kind === "error").map((h) => h.text);
  return { data: ed.drawing.toData(), transcript, errors, added, changed, erased };
}

/** Dialogs answered from the script, as AutoCAD's command-line versions take them. */
function answerDialog(ed: Editor, line: string) {
  const dialog = ed.dialog!;
  if (dialog.kind === "block") {
    // BLOCK: the name, then optionally ",retain" or ",delete" (converted to a block otherwise).
    const [name, mode] = line.split(",").map((s) => s.trim());
    if (!name) return ed.closeDialog(null);
    const m = mode?.toLowerCase();
    ed.closeDialog({ name, description: "", mode: m === "retain" || m === "delete" ? m : "convert" });
  } else if (dialog.kind === "save-block") ed.closeDialog(/^n|^d/i.test(line) ? "discard" : "save");
  else ed.closeDialog(null);
}

function snapshot(ed: Editor) {
  const main = ed.drawing;
  const out = new Map<string, { entity: Entity; json: string }>();
  for (const space of [MODEL, ...main.layouts.keys()]) {
    for (const e of main.entitiesIn(space).values()) out.set(`${space}:${e.id}`, { entity: e, json: JSON.stringify(e) });
  }
  return out;
}
