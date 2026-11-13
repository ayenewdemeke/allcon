import { Command, type Prompt } from "./command-base";
import { ArcCommand, CircleCommand, EllipseCommand, LineCommand, PlineCommand, PolygonCommand, RayCommand, RectangCommand, SplineCommand, XlineCommand } from "./commands-draw";
import {
  ArrayCommand,
  ArrayPolarCommand,
  ArrayRectCommand,
  BreakCommand,
  ChamferCommand,
  CopyCommand,
  EraseCommand,
  ExplodeCommand,
  ExtendCommand,
  FilletCommand,
  JoinCommand,
  MatchpropCommand,
  MirrorCommand,
  MoveCommand,
  OffsetCommand,
  RotateCommand,
  ScaleCommand,
  StretchCommand,
  TrimCommand,
} from "./commands-modify";
import {
  DimAlignedCommand,
  DimAngularCommand,
  DimBaselineCommand,
  DimCommandSmart,
  DimContinueCommand,
  DimDiameterCommand,
  DimLinearCommand,
  DimRadialCommand,
  HatchCommand,
  MLeaderCommand,
  MTextCommand,
  TextCommand,
  TextEditCommand,
} from "./commands-annotate";
import { AttachCommand, AttdefCommand, AttEditCommand, BeditCommand, BlockCommand, BlockLineCommand, InsertCommand, InsertPaletteCommand } from "./commands-blocks";
import { PdfImportCommand } from "./commands-import";
import { LayerLineCommand } from "./commands-layer";
import { LayoutCommand, lockViewports, MspaceCommand, MviewCommand, TitleBlockCommand } from "./commands-layout";
import type { Editor } from "./editor";
import type { Vec } from "./types";

// Every command, by name and AutoCAD alias, with the view commands.

export type { Keyword, Prompt } from "./command-base";
export { Command } from "./command-base";

class ZoomCommand extends Command {
  name = "ZOOM";
  private corner: Vec | null = null;
  prompt(): Prompt {
    if (this.corner) return { text: "Specify opposite corner", base: this.corner };
    return { text: "Specify corner of window", keywords: [{ key: "A", label: "All" }, { key: "E", label: "Extents" }, { key: "W", label: "Window" }] };
  }
  point(p: Vec) {
    if (!this.corner) this.corner = p;
    else {
      this.ed.zoomWindow(this.corner, p);
      this.ed.finish();
    }
  }
  keyword(key: string) {
    if (key === "A" || key === "E") {
      this.ed.zoomExtents();
      this.ed.finish();
    }
  }
}

class PanCommand extends Command {
  name = "PAN";
  readonly pans = true;
  prompt(): Prompt {
    return { text: "Press Esc or Enter to exit" };
  }
}

/** Commands that act at once. */
class ImmediateCommand extends Command {
  constructor(
    ed: Editor,
    readonly name: string,
    private run: (ed: Editor) => void,
  ) {
    super(ed);
  }
  prompt(): Prompt {
    return { text: "" };
  }
  start() {
    this.run(this.ed);
    this.ed.finish();
  }
}

export type CommandInfo = { name: string; aliases: string[]; description: string; create: (ed: Editor) => Command };

const command = (name: string, aliases: string[], description: string, create: (ed: Editor) => Command): CommandInfo => ({ name, aliases, description, create });

export const COMMANDS: CommandInfo[] = [
  // Draw
  command("LINE", ["L"], "Creates straight line segments", (ed) => new LineCommand(ed)),
  command("PLINE", ["PL"], "Creates a polyline", (ed) => new PlineCommand(ed)),
  command("CIRCLE", ["C"], "Creates a circle", (ed) => new CircleCommand(ed)),
  command("ARC", ["A"], "Creates an arc", (ed) => new ArcCommand(ed)),
  command("RECTANG", ["REC", "RECTANGLE"], "Creates a rectangular polyline", (ed) => new RectangCommand(ed)),
  command("POLYGON", ["POL"], "Creates an equilateral closed polyline", (ed) => new PolygonCommand(ed)),
  command("ELLIPSE", ["EL"], "Creates an ellipse or an elliptical arc", (ed) => new EllipseCommand(ed)),
  command("SPLINE", ["SPL"], "Creates a smooth curve through points", (ed) => new SplineCommand(ed)),
  command("XLINE", ["XL"], "Creates a line of infinite length", (ed) => new XlineCommand(ed)),
  command("RAY", [], "Creates a line that starts at a point and continues to infinity", (ed) => new RayCommand(ed)),
  // Modify
  command("ERASE", ["E"], "Removes objects from the drawing", (ed) => new EraseCommand(ed)),
  command("MOVE", ["M"], "Moves objects a specified distance in a specified direction", (ed) => new MoveCommand(ed)),
  command("COPY", ["CO", "CP"], "Copies objects a specified distance in a specified direction", (ed) => new CopyCommand(ed)),
  command("ROTATE", ["RO"], "Rotates objects around a base point", (ed) => new RotateCommand(ed)),
  command("SCALE", ["SC"], "Enlarges or reduces selected objects, keeping the same proportions", (ed) => new ScaleCommand(ed)),
  command("MIRROR", ["MI"], "Creates a mirrored copy of selected objects", (ed) => new MirrorCommand(ed)),
  command("OFFSET", ["O"], "Creates concentric circles, parallel lines, and parallel curves", (ed) => new OffsetCommand(ed)),
  command("TRIM", ["TR"], "Trims objects to meet the edges of other objects", (ed) => new TrimCommand(ed)),
  command("EXTEND", ["EX"], "Extends objects to meet the edges of other objects", (ed) => new ExtendCommand(ed)),
  command("FILLET", ["F"], "Rounds and fillets the edges of objects", (ed) => new FilletCommand(ed)),
  command("CHAMFER", ["CHA"], "Bevels the edges of objects", (ed) => new ChamferCommand(ed)),
  command("ARRAY", ["AR"], "Creates copies of objects in a pattern", (ed) => new ArrayCommand(ed)),
  command("ARRAYRECT", [], "Distributes copies of objects into rows and columns", (ed) => new ArrayRectCommand(ed)),
  command("ARRAYPOLAR", [], "Evenly distributes copies of objects around a center point", (ed) => new ArrayPolarCommand(ed)),
  command("STRETCH", ["S"], "Stretches objects crossed by a selection window", (ed) => new StretchCommand(ed)),
  command("BREAK", ["BR"], "Breaks the selected object between two points", (ed) => new BreakCommand(ed)),
  command("JOIN", ["J"], "Joins objects end to end into a single object", (ed) => new JoinCommand(ed)),
  command("EXPLODE", ["X"], "Breaks a polyline into its segments", (ed) => new ExplodeCommand(ed)),
  command("MATCHPROP", ["MA"], "Applies the properties of a selected object to other objects", (ed) => new MatchpropCommand(ed)),
  // Annotate
  command("TEXT", ["DT", "DTEXT"], "Creates single-line text", (ed) => new TextCommand(ed)),
  command("MTEXT", ["T", "MT"], "Creates a multiline text object", (ed) => new MTextCommand(ed)),
  command("TEXTEDIT", ["ED", "DDEDIT"], "Edits text, a dimension's text, or a leader's text", (ed) => new TextEditCommand(ed)),
  command("DIM", [], "Creates dimensions for the objects you pick", (ed) => new DimCommandSmart(ed)),
  command("DIMLINEAR", ["DLI"], "Creates a horizontal or vertical linear dimension", (ed) => new DimLinearCommand(ed)),
  command("DIMALIGNED", ["DAL"], "Creates an aligned linear dimension", (ed) => new DimAlignedCommand(ed)),
  command("DIMANGULAR", ["DAN"], "Creates an angular dimension", (ed) => new DimAngularCommand(ed)),
  command("DIMRADIUS", ["DRA"], "Creates a radius dimension for a circle or an arc", (ed) => new DimRadialCommand(ed)),
  command("DIMDIAMETER", ["DDI"], "Creates a diameter dimension for a circle or an arc", (ed) => new DimDiameterCommand(ed)),
  command("DIMCONTINUE", ["DCO"], "Creates a dimension that starts from an extension line of a previous dimension", (ed) => new DimContinueCommand(ed)),
  command("DIMBASELINE", ["DBA"], "Creates a dimension from the baseline of the previous dimension", (ed) => new DimBaselineCommand(ed)),
  command("MLEADER", ["MLD", "LEADER", "LE"], "Creates a multileader", (ed) => new MLeaderCommand(ed)),
  command("HATCH", ["H", "BH"], "Fills an enclosed area or selected objects with a hatch pattern or fill", (ed) => new HatchCommand(ed)),
  command("STYLE", ["ST"], "Creates, modifies, or specifies text styles", (ed) => new ImmediateCommand(ed, "STYLE", (e) => e.ui.openPalette("styles"))),
  command("DIMSTYLE", ["D", "DST"], "Creates and modifies dimension styles", (ed) => new ImmediateCommand(ed, "DIMSTYLE", (e) => e.ui.openPalette("styles"))),
  // Blocks and references
  command("BLOCK", ["B", "BMAKE"], "Creates a block definition from selected objects", (ed) => new BlockCommand(ed)),
  command("-BLOCK", ["-B"], "Creates a block definition at the command line", (ed) => new BlockLineCommand(ed)),
  command("INSERT", ["I", "CLASSICINSERT"], "Inserts a block from the Blocks palette", (ed) => new InsertPaletteCommand(ed)),
  command("-INSERT", ["-I"], "Inserts a block by name at the command line", (ed) => new InsertCommand(ed)),
  command("ATTDEF", ["ATT"], "Creates an attribute definition for storing data in a block", (ed) => new AttdefCommand(ed)),
  command("EATTEDIT", ["ATTEDIT", "ATE"], "Edits the attribute values of a block reference", (ed) => new AttEditCommand(ed)),
  command("BEDIT", ["BE"], "Opens a block definition in the block editor", (ed) => new BeditCommand(ed)),
  command("BSAVE", [], "Saves the block in the block editor", (ed) => new ImmediateCommand(ed, "BSAVE", (e) => (e.blockEdit ? e.saveBlock() : e.print("The block editor isn't open.", "error")))),
  command("BCLOSE", [], "Closes the block editor", (ed) => new ImmediateCommand(ed, "BCLOSE", (e) => (e.blockEdit ? e.requestCloseBlockEditor() : e.print("The block editor isn't open.", "error")))),
  command("PURGE", ["PU"], "Removes unused blocks, layers and styles from the drawing", (ed) => new ImmediateCommand(ed, "PURGE", (e) => e.openDialog({ kind: "purge", done: () => {} }))),
  command("IMAGEATTACH", ["IAT", "ATTACH"], "Attaches a picture under the drawing", (ed) => new AttachCommand(ed, "image")),
  command("PDFATTACH", [], "Attaches a page of a PDF under the drawing", (ed) => new AttachCommand(ed, "pdf")),
  command("PDFIMPORT", [], "Imports a PDF page's lines, text, fills and pictures as objects you can edit", (ed) => new PdfImportCommand(ed)),
  command("DXFOUT", ["EXPORT"], "Downloads the drawing as a DXF file for AutoCAD and other CAD programs", (ed) => new ImmediateCommand(ed, "DXFOUT", (e) => e.ui.exportDxf())),
  command("SAVEAS", [], "Saves a copy of the drawing under a new name, as a drawing, a drawing template or DXF", (ed) =>
    new ImmediateCommand(ed, "SAVEAS", (e) => e.openDialog({ kind: "save-as", name: e.drawingName, done: (r) => r && e.ui.saveAs(r) })),
  ),
  // Layouts and plotting
  command("LAYOUT", ["LO"], "Creates, renames, deletes and switches layouts", (ed) => new LayoutCommand(ed)),
  command("MVIEW", ["MV"], "Creates a layout viewport onto the model", (ed) => new MviewCommand(ed)),
  command("MSPACE", ["MS"], "Works on the model through a layout viewport", (ed) => new MspaceCommand(ed)),
  command("PSPACE", ["PS"], "Returns from a viewport to the layout's paper", (ed) => new ImmediateCommand(ed, "PSPACE", (e) => (e.viewport ? e.exitViewport() : e.print("Already on the paper.", "info")))),
  command("VPLOCK", [], "Locks the scale and view of viewports", (ed) => new ImmediateCommand(ed, "VPLOCK", (e) => lockViewports(e, true))),
  command("VPUNLOCK", [], "Unlocks the scale and view of viewports", (ed) => new ImmediateCommand(ed, "VPUNLOCK", (e) => lockViewports(e, false))),
  command("TITLEBLOCK", ["TB"], "Puts a title block on the layout's paper: a strip along the bottom or down the side", (ed) => new TitleBlockCommand(ed)),
  command("PAGESETUP", [], "Sets a layout's paper size and how it plots", (ed) =>
    new ImmediateCommand(ed, "PAGESETUP", (e) => (e.layoutId ? e.openDialog({ kind: "page-setup", layout: e.layoutId, done: () => {} }) : e.openDialog({ kind: "plot", done: () => {} }))),
  ),
  command("PLOT", ["PRINT"], "Plots the layout or the model to a PDF", (ed) => new ImmediateCommand(ed, "PLOT", (e) => e.openDialog({ kind: "plot", done: () => {} }))),
  command("PUBLISH", [], "Publishes layouts to a multi-sheet PDF or to a project's Sheets", (ed) => new ImmediateCommand(ed, "PUBLISH", (e) => e.openDialog({ kind: "publish", done: () => {} }))),
  command("LWDISPLAY", ["LWT"], "Shows or hides lineweights", (ed) => new ImmediateCommand(ed, "LWDISPLAY", (e) => e.toggle("lineweights"))),
  // View and tools
  command("ZOOM", ["Z"], "Increases or decreases the magnification of the view", (ed) => new ZoomCommand(ed)),
  command("PAN", ["P"], "Moves the view", (ed) => new PanCommand(ed)),
  command("LAYER", ["LA"], "Manages layers and layer properties", (ed) => new ImmediateCommand(ed, "LAYER", (e) => e.ui.openPalette("layers"))),
  command("-LAYER", ["-LA"], "Makes, sets and changes layers at the command line", (ed) => new LayerLineCommand(ed)),
  command("PROPERTIES", ["PR", "CH", "MO"], "Controls properties of existing objects", (ed) => new ImmediateCommand(ed, "PROPERTIES", (e) => e.ui.openPalette("properties"))),
  command("U", [], "Reverses the most recent operation", (ed) => new ImmediateCommand(ed, "U", (e) => e.undo())),
  command("UNDO", [], "Reverses the effect of commands", (ed) => new ImmediateCommand(ed, "UNDO", (e) => e.undo())),
  command("REDO", [], "Reverses the effects of the previous UNDO", (ed) => new ImmediateCommand(ed, "REDO", (e) => e.redo())),
];

export function findCommand(text: string): CommandInfo | undefined {
  // A leading hyphen asks for the command-line version (-INSERT); otherwise it's ignored.
  const raw = text.trim().toUpperCase().replace(/^[_.']+/, "");
  const t = raw.replace(/^-+/, "");
  return COMMANDS.find((c) => c.name === raw || c.aliases.includes(raw)) ?? COMMANDS.find((c) => c.name === t || c.aliases.includes(t));
}

/** AutoComplete for the command line: names and aliases starting with what's typed. */
export function suggestCommands(text: string): CommandInfo[] {
  const t = text.trim().toUpperCase();
  if (!t) return [];
  return COMMANDS.filter((c) => c.name.startsWith(t) || c.aliases.some((a) => a.startsWith(t))).sort(
    (a, b) => Number(!(a.aliases.includes(t) || a.name === t)) - Number(!(b.aliases.includes(t) || b.name === t)),
  );
}
