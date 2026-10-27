import { APP_NAME } from "@/lib/app-config";

// The draft_drawing skill: how an AI app drafts in conkit's 2D editor, which works like AutoCAD.
// Also the reference run_commands points to, so it stays in one place.

export const SCRIPT_GUIDE = `Scripts work like AutoCAD .scr files: each line is exactly what you'd type at the command line (a command or alias, an option keyword, a point, a number), and an EMPTY line is Enter. Lines starting with ; are comments.

Coordinates are absolute "x,y"; "@dx,dy" is relative to the last point and "@dist<angle" polar (degrees, counter-clockwise from east). In architectural drawings units are inches: 240, 20', 20'6", 20'-6 1/2" all work. In mm drawings, plain millimetres.

Text a command asks for (TEXT, MTEXT, MLEADER) is the lines after its last prompt, up to an empty line. In MTEXT, each line is a paragraph.

Select objects: ALL; L (the last object made); P (the previous selection); W then two corners (objects wholly inside); C then two corners (crossing); or a point on an object. An empty line ends the selection. At "Select object" prompts (TRIM, EXTEND, FILLET, OFFSET, DIMRADIUS...), give a point on the object.

Prompt sequences (AutoCAD's):
- LINE: start point, next points..., empty line. PLINE: same; C closes. RECTANG: corner, opposite corner.
- CIRCLE: center, radius (or D then diameter; 2P/3P). ARC: start, second, end (or C, center, start, end).
- ELLIPSE: axis endpoint, other endpoint, other axis distance. POLYGON: sides, center, I/C, radius.
- -LAYER: options until an empty line. M name (make and set current), S name, N names, C color layers, LW mm layers, ON/OFF/F/T/LO/U layers, P Plot|No plot layers. After C, LW and P, the next line is the layer list (empty = current).
- TEXT: [J then justification L/C/R/M/TL/TC/TR/ML/MC/MR/BL/BC/BR], start point, height, rotation, then the text lines, then an empty line.
- MTEXT: first corner, opposite corner, then the text lines, then an empty line.
- DIMLINEAR (DLI): first extension origin, second, dimension line location (H/V to force). DIMALIGNED (DAL) the same. DIMRADIUS/DIMDIAMETER: a point on the circle or arc, then the text location. DIMANGULAR: a point on each line, then the arc location. DIMCONTINUE (DCO)/DIMBASELINE (DBA): next second-extension origins, then an empty line.
- MLEADER: arrowhead point, landing point, then the text lines, then an empty line.
- HATCH: P then a pattern name (ANSI31, ANSI32, ANSI37, SOLID, NET, LINE, DASH, DOTS), SC then a scale, then internal points (inside closed boundaries), then an empty line.
- MOVE/COPY/ROTATE/SCALE/MIRROR/STRETCH/ERASE/ARRAY: select objects, empty line, then the command's points or values (COPY repeats until an empty line).
- OFFSET: distance, a point on the object, a point on the side; empty line ends. TRIM/EXTEND: points on the parts to trim or extend, empty line ends. FILLET: R radius, then a point on each of two lines.
- -BLOCK: name, base point, select objects, empty line (the objects become the block and leave the drawing). -INSERT: name, insertion point, X scale, Y scale, rotation (empty lines take the defaults), then attribute values. ATTDEF: tag, prompt, default value, start point, height, rotation.
- LAYOUT: N name (a new layout with a title block and a viewport onto the model). MVIEW: two corners (on a layout). Use run_commands with layout set to work on a layout's paper.

Each run returns the transcript: read it for "*Invalid*" or error lines, and fix and rerun the parts that failed.`;

export function draftPrompt(args: { task: string; drawing?: string }) {
  return `Draft this in ${APP_NAME}'s 2D drafting editor, which works like AutoCAD: ${args.task}${args.drawing ? `\n\nDrawing: ${args.drawing}` : ""}

1. Find or make the drawing: list_drawings, or create_drawing (architectural units for feet and inches, mm for metric). Read it with get_drawing: its units, layers, blocks, layouts and a picture.
2. Plan before drawing: the overall dimensions, the layers (AIA style: A-WALL, A-DOOR, A-GLAZ, A-FLOR, A-ANNO-TEXT, A-ANNO-DIMS, S-GRID...), and the drawing's coordinates (put the origin at a sensible corner or grid intersection).
3. Draw with run_commands, in batches of a few dozen lines: make the layers with -LAYER (colours and lineweights), then the geometry on its layers, then annotation (TEXT/MTEXT, dimensions, MLEADER, hatches). Use blocks (-BLOCK, -INSERT) for anything repeated, like doors, columns and fixtures. add_objects is quicker for many plain objects whose coordinates you've worked out; edit_objects changes or erases objects by id.
4. Size text and dimensions for the drawing's annotation scale (get_drawing gives it: 48 is 1/4" = 1'-0", 50 is 1:50): text 3/32" or 2.5 mm on paper, times the scale. Dimension styles already include the scale.
5. Check your work: get_drawing with the image after each stage, and read each transcript for errors. Fix anything that's off.
6. For sheets: LAYOUT N with a name like A-101 makes a layout with a title block and a viewport; set the viewport's scale and the title block's attributes (SHEET_NUMBER, SHEET_TITLE, PROJECT) with edit_objects, and check it with get_drawing (layout set). publish_layouts adds the layouts to a project's Sheets, numbered and to scale.
7. Finish with what you drew and the link. The user can see your changes live if they have the drawing open, and undo the whole request from Connections.

${SCRIPT_GUIDE}`;
}
