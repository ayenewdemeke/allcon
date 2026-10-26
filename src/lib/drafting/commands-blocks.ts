import { attributeDefs, nestedBlocks } from "./blocks";
import { Command, parseNumber, SelectingCommand, type Prompt } from "./command-base";
import { defaultTextHeight, JUSTIFY } from "./commands-annotate";
import { angleOf, dist } from "./geometry";
import { formatAngle, formatLength, parseAngle, parseLength } from "./units";
import type { Attachment, Editor } from "./editor";
import type { AttdefEntity, Entity, HAlign, ImageEntity, InsertEntity, VAlign, Vec } from "./types";

// Blocks and references, with AutoCAD's prompts: BLOCK, INSERT, ATTDEF, the block editor, and
// pictures and PDFs attached under the drawing.

/** Whether a reference to `name` can go into the block being edited (a block can't hold itself). */
function refusesItself(ed: Editor, name: string) {
  const editing = ed.blockEdit?.name;
  if (!editing || (name !== editing && !nestedBlocks(name).has(editing))) return false;
  ed.print(`Block "${name}" references itself; it can't be inserted into "${editing}".`, "error");
  return true;
}

/** BLOCK: objects and a base point become a block, as the Block Definition dialog does. */
export class BlockCommand extends SelectingCommand {
  name = "BLOCK";
  private base: Vec | null = null;
  prompt(): Prompt {
    if (this.selecting) return this.selectPrompt();
    if (!this.base) return { text: "Specify insertion base point" };
    return { text: "Name the block in the dialog" };
  }
  point(p: Vec) {
    if (this.selecting || this.base) return;
    this.base = p;
    const objects = this.targets();
    this.ed.openDialog({
      kind: "block",
      count: objects.length,
      done: (r) => {
        if (!r) return this.ed.finish();
        if (objects.some((e) => e.type === "insert" && (e.block === r.name || nestedBlocks(e.block).has(r.name)))) {
          this.ed.print(`Block "${r.name}" can't contain a reference to itself.`, "error");
          return this.ed.finish();
        }
        const redefined = this.ed.doc.blocks.has(r.name);
        this.ed.doc.setBlock({ name: r.name, base: p, entities: objects, ...(r.description ? { description: r.description } : {}) });
        if (r.mode !== "retain") for (const e of objects) this.ed.doc.remove(e.id);
        if (r.mode === "convert") {
          const attribs = Object.fromEntries(attributeDefs(this.ed.doc.blocks.get(r.name)).map((d) => [d.tag, d.value]));
          this.ed.doc.add(this.ed.make<InsertEntity>({ type: "insert", block: r.name, at: p, scale: { x: 1, y: 1 }, rotation: 0, attribs }));
        }
        this.ed.print(redefined ? `Block "${r.name}" redefined.` : `Block "${r.name}" created.`, "info");
        this.ed.finish();
      },
    });
  }
}

/** INSERT: opens the Blocks palette, where a block is picked to place (as AutoCAD 2021 on). */
export class InsertPaletteCommand extends Command {
  name = "INSERT";
  prompt(): Prompt {
    return { text: "" };
  }
  start() {
    this.ed.ui.openPalette("blocks");
    if (!this.ed.doc.blocks.size) this.ed.print("This drawing has no blocks yet. Make one with BLOCK.", "info");
    this.ed.finish();
  }
}

/** -INSERT, or a block picked in the palette: place a reference, then fill in its attributes. */
export class InsertCommand extends Command {
  name = "-INSERT";
  private step: "name" | "point" | "scale" | "rotation" | "attributes" = "name";
  private scale = 1;
  private rotation = 0;
  private at: Vec | null = null;
  private asked: AttdefEntity[] = [];
  private values: Record<string, string> = {};
  constructor(
    ed: Editor,
    private block: string | null = null,
  ) {
    super(ed);
    if (block) this.name = "INSERT";
  }
  start() {
    this.ed.doc.begin("INSERT");
    if (this.block) this.use(this.block);
  }
  private use(name: string) {
    if (refusesItself(this.ed, name)) return this.ed.finish();
    this.block = name;
    this.ed.memory.insertBlock = name;
    this.step = "point";
  }
  prompt(): Prompt {
    switch (this.step) {
      case "name": {
        const last = this.ed.memory.insertBlock;
        return { text: "Enter block name", keywords: [{ key: "?", label: "?" }], enterLabel: typeof last === "string" && this.ed.doc.blocks.has(last) ? last : undefined };
      }
      case "point":
        return { text: "Specify insertion point", keywords: [{ key: "S", label: "Scale" }, { key: "R", label: "Rotate" }] };
      case "scale":
        return { text: "Specify scale factor for XYZ axes", enterLabel: String(this.scale) };
      case "rotation":
        return { text: "Specify rotation angle", enterLabel: formatAngle(this.rotation) };
      case "attributes": {
        const d = this.asked[Object.keys(this.values).length];
        if (!d) return { text: "" }; // all answered: being placed
        return { text: d.prompt || d.tag, enterLabel: d.value, spaces: true };
      }
    }
  }
  private make(at: Vec): InsertEntity {
    return this.ed.make<InsertEntity>({ type: "insert", block: this.block!, at, scale: { x: this.scale, y: this.scale }, rotation: this.rotation, attribs: this.values });
  }
  preview(cursor: Vec): Entity[] {
    return this.step === "point" && this.block ? [this.make(cursor)] : [];
  }
  point(p: Vec) {
    if (this.step !== "point") return;
    this.at = p;
    this.asked = attributeDefs(this.ed.doc.blocks.get(this.block!));
    this.step = "attributes";
    this.next();
  }
  /** The next attribute to ask for, or the reference is placed. */
  private next() {
    if (Object.keys(this.values).length < this.asked.length) return;
    this.ed.doc.add(this.make(this.at!));
    this.ed.finish();
  }
  keyword(key: string) {
    if (this.step === "name" && key === "?") this.ed.print(this.ed.doc.blocks.size ? `Blocks: ${[...this.ed.doc.blocks.keys()].join(", ")}` : "No blocks defined.", "info");
    else if (this.step === "point" && key === "S") this.step = "scale";
    else if (this.step === "point" && key === "R") this.step = "rotation";
  }
  value(text: string) {
    if (this.step === "name") {
      const name = [...this.ed.doc.blocks.keys()].find((n) => n.toUpperCase() === text.trim().toUpperCase());
      if (!name) return this.ed.print(`Block "${text}" not found.`, "error"), true;
      this.use(name);
      return true;
    }
    if (this.step === "scale") {
      const n = parseNumber(text);
      if (n === null || n === 0) return false;
      this.scale = n;
      this.step = "point";
      return true;
    }
    if (this.step === "rotation") {
      const a = parseAngle(text);
      if (a === null) return false;
      this.rotation = a;
      this.step = "point";
      return true;
    }
    if (this.step === "attributes") {
      this.values = { ...this.values, [this.asked[Object.keys(this.values).length].tag]: text };
      this.next();
      return true;
    }
    return false;
  }
  enter() {
    if (this.step === "name") {
      const last = this.ed.memory.insertBlock;
      if (typeof last === "string" && this.ed.doc.blocks.has(last)) this.use(last);
      else this.ed.finish();
    } else if (this.step === "scale" || this.step === "rotation") this.step = "point";
    else if (this.step === "attributes") {
      const d = this.asked[Object.keys(this.values).length];
      this.values = { ...this.values, [d.tag]: d.value };
      this.next();
    } else this.ed.finish();
  }
}

/** ATTDEF: an attribute definition, its tag shown where the value will go. */
export class AttdefCommand extends Command {
  name = "ATTDEF";
  private step: "tag" | "prompt" | "value" | "point" | "justify" | "height" | "rotation" = "tag";
  private invisible = false;
  private tag = "";
  private ask = "";
  private initial = "";
  private at: Vec | null = null;
  private height = 0;
  private justify: [HAlign, VAlign] = ["left", "baseline"];
  start() {
    this.ed.doc.begin("ATTDEF");
    this.height = defaultTextHeight(this.ed);
  }
  prompt(): Prompt {
    switch (this.step) {
      case "tag":
        return { text: `Current attribute modes: Invisible=${this.invisible ? "Y" : "N"}\nEnter attribute tag name`, keywords: [{ key: "I", label: "Invisible" }] };
      case "prompt":
        return { text: "Enter attribute prompt", enterLabel: this.tag, spaces: true };
      case "value":
        return { text: "Enter default attribute value", spaces: true };
      case "point":
        return { text: "Specify start point of text", keywords: [{ key: "J", label: "Justify" }] };
      case "justify":
        return { text: "Enter an option", keywords: Object.keys(JUSTIFY).map((k) => ({ key: k, label: { L: "Left", C: "Center", R: "Right", M: "Middle" }[k] ?? k })) };
      case "height":
        return { text: "Specify text height", base: this.at, enterLabel: formatLength(this.height, this.ed.doc.units) };
      case "rotation":
        return { text: "Specify rotation angle of text", base: this.at, enterLabel: "0" };
    }
  }
  keyword(key: string) {
    if (this.step === "tag" && key === "I") this.invisible = !this.invisible;
    else if (this.step === "point" && key === "J") this.step = "justify";
    else if (this.step === "justify" && JUSTIFY[key]) {
      this.justify = JUSTIFY[key];
      this.step = "point";
    }
  }
  value(text: string) {
    if (this.step === "tag") {
      if (/\s/.test(text.trim())) return this.ed.print("Tags can't contain spaces.", "error"), true;
      this.tag = text.trim().toUpperCase();
      this.step = "prompt";
      return true;
    }
    if (this.step === "prompt") {
      this.ask = text;
      this.step = "value";
      return true;
    }
    if (this.step === "value") {
      this.initial = text;
      this.step = "point";
      return true;
    }
    if (this.step === "height") {
      const h = parseLength(text, this.ed.doc.units);
      if (h === null || h <= 0) return false;
      this.height = h;
      this.step = "rotation";
      return true;
    }
    if (this.step === "rotation") {
      const a = parseAngle(text);
      if (a === null) return false;
      this.place(a);
      return true;
    }
    return false;
  }
  point(p: Vec) {
    if (this.step === "point") {
      this.at = p;
      this.step = "height";
    } else if (this.step === "height") {
      this.height = Math.max(dist(this.at!, p), 1e-9);
      this.step = "rotation";
    } else if (this.step === "rotation") this.place(angleOf(this.at!, p));
  }
  enter() {
    if (this.step === "tag") this.ed.finish();
    else if (this.step === "prompt") this.value(this.tag);
    else if (this.step === "value") this.value("");
    else if (this.step === "height") this.step = "rotation";
    else if (this.step === "rotation") this.place(0);
    else if (this.step === "justify") this.step = "point";
    else this.ed.finish();
  }
  private place(rotation: number) {
    this.ed.memory.textHeight = this.height;
    const [halign, valign] = this.justify;
    this.ed.doc.add(
      this.ed.make<AttdefEntity>({
        type: "attdef",
        at: this.at!,
        tag: this.tag,
        prompt: this.ask || this.tag,
        value: this.initial,
        height: this.height,
        rotation,
        style: this.ed.doc.currentTextStyle,
        halign,
        valign,
        invisible: this.invisible,
      }),
    );
    this.ed.finish();
  }
}

/** EATTEDIT: a reference's attribute values in the Edit Attributes dialog. */
export class AttEditCommand extends Command {
  name = "EATTEDIT";
  start() {
    const [only] = this.ed.selected();
    if (this.ed.selection.size === 1 && only.type === "insert") this.edit(only);
  }
  prompt(): Prompt {
    return { text: "Select a block", picking: true };
  }
  pick(e: Entity | null) {
    if (!e) return;
    if (e.type !== "insert") return this.ed.print("That isn't a block.", "error");
    this.edit(e);
  }
  private edit(e: InsertEntity) {
    this.ed.selection.clear();
    if (!this.ed.editAttributes(e)) this.ed.print("That block has no editable attributes.", "error");
    this.ed.finish();
  }
}

/** BEDIT: a block in the block editor. */
export class BeditCommand extends Command {
  name = "BEDIT";
  start() {
    if (this.ed.blockEdit) {
      this.ed.print("The block editor is already open.", "error");
      return this.ed.finish();
    }
    const [only] = this.ed.selected();
    if (this.ed.selection.size === 1 && only.type === "insert") this.open(only.block);
  }
  prompt(): Prompt {
    const first = this.ed.doc.blocks.keys().next().value;
    return { text: "Enter block name to edit", enterLabel: first };
  }
  private open(name: string) {
    this.ed.finish();
    this.ed.editBlock(name);
  }
  value(text: string) {
    const name = [...this.ed.doc.blocks.keys()].find((n) => n.toUpperCase() === text.trim().toUpperCase());
    if (!name) return this.ed.print(`Block "${text}" not found.`, "error"), true;
    this.open(name);
    return true;
  }
  enter() {
    const first = this.ed.doc.blocks.keys().next().value;
    if (first) this.open(first);
    else this.ed.finish();
  }
}

/** IMAGEATTACH, PDFATTACH: a picture or a PDF page under the drawing, placed and sized. */
export class AttachCommand extends Command {
  name: string;
  private file: Attachment | null = null;
  private at: Vec | null = null;
  private waiting = true;
  constructor(
    ed: Editor,
    private source: "image" | "pdf",
  ) {
    super(ed);
    this.name = source === "pdf" ? "PDFATTACH" : "IMAGEATTACH";
  }
  start() {
    this.ed.doc.begin(this.name);
    void this.ed.ui.attach(this.source).then((file) => {
      if (this.ed.command !== this) return;
      this.waiting = false;
      if (!file) return this.ed.finish();
      this.file = file;
      this.ed.emit();
    });
  }
  prompt(): Prompt {
    if (this.waiting) return { text: this.source === "pdf" ? "Choose a PDF" : "Choose an image" };
    if (!this.at) return { text: "Specify insertion point" };
    return { text: "Specify scale factor", base: this.at, enterLabel: "1" };
  }
  private make(scale: number): ImageEntity {
    const f = this.file!;
    return this.ed.make<ImageEntity>({ type: "image", key: f.key, name: f.name, source: f.source, at: this.at!, width: f.width * scale, height: f.height * scale, rotation: 0, fade: f.source === "pdf" ? 25 : 0 });
  }
  preview(cursor: Vec): Entity[] {
    if (!this.file || !this.at) return [];
    return [this.make(Math.max(dist(this.at, cursor) / this.file.width, 1e-9))];
  }
  point(p: Vec) {
    if (!this.file) return;
    if (!this.at) this.at = p;
    else this.place(Math.max(dist(this.at, p) / this.file.width, 1e-9));
  }
  value(text: string) {
    const n = parseNumber(text);
    if (!this.at || n === null || n <= 0) return false;
    this.place(n);
    return true;
  }
  enter() {
    if (this.file && this.at) this.place(1);
    else this.ed.finish();
  }
  private place(scale: number) {
    this.ed.doc.add(this.make(scale));
    this.ed.finish();
  }
}
