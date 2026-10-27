import { Command, type Prompt } from "./command-base";
import { LINEWEIGHTS, newLayer, type Layer } from "./types";

// -LAYER: layers at the command line, as AutoCAD scripts make and set them.

const COLOR_NAMES: Record<string, number> = { RED: 1, YELLOW: 2, GREEN: 3, CYAN: 4, BLUE: 5, MAGENTA: 6, WHITE: 7, BLACK: 7 };

type Step =
  | { kind: "option" }
  | { kind: "make" | "set" | "new" }
  | { kind: "names"; label: string; apply: (l: Layer) => Layer }
  | { kind: "color" }
  | { kind: "lineweight" }
  | { kind: "plot" };

export class LayerLineCommand extends Command {
  name = "-LAYER";
  private step: Step = { kind: "option" };
  start() {
    this.ed.doc.begin("-LAYER");
    this.ed.print(`Current layer: "${this.ed.doc.currentLayer}"`, "info");
  }
  prompt(): Prompt {
    switch (this.step.kind) {
      case "make":
        return { text: "Enter name for new layer (becomes the current layer)", enterLabel: this.ed.doc.currentLayer, spaces: true };
      case "set":
        return { text: "Enter layer name to make current", spaces: true };
      case "new":
        return { text: "Enter name list for new layer(s)", spaces: true };
      case "names":
        return { text: `Enter name list of layer(s) for ${this.step.label}`, enterLabel: this.ed.doc.currentLayer, spaces: true };
      case "color":
        return { text: "New color [Truecolor] (a number 1-255, a name, or #rrggbb)" };
      case "lineweight":
        return { text: "Enter lineweight (0.0mm - 2.11mm)" };
      case "plot":
        return { text: "Enter a plotting preference", keywords: [{ key: "P", label: "Plot" }, { key: "N", label: "No plot" }], enterLabel: "Plot" };
      default:
        return {
          text: "Enter an option",
          keywords: [
            { key: "?", label: "?" },
            { key: "M", label: "Make" },
            { key: "S", label: "Set" },
            { key: "N", label: "New" },
            { key: "ON", label: "ON" },
            { key: "OFF", label: "OFF" },
            { key: "C", label: "Color" },
            { key: "LW", label: "LWeight" },
            { key: "F", label: "Freeze" },
            { key: "T", label: "Thaw" },
            { key: "LO", label: "LOck" },
            { key: "U", label: "Unlock" },
            { key: "P", label: "Plot" },
          ],
        };
    }
  }
  keyword(key: string) {
    if (this.step.kind === "plot") {
      const plot = key === "P";
      this.step = { kind: "names", label: plot ? "plotting" : "not plotting", apply: (l) => ({ ...l, plot }) };
      return;
    }
    if (this.step.kind !== "option") return;
    const names = (label: string, apply: (l: Layer) => Layer) => (this.step = { kind: "names", label, apply });
    if (key === "?") return this.ed.print(`Layers: ${[...this.ed.doc.layers.keys()].join(", ")}`, "info");
    if (key === "M") this.step = { kind: "make" };
    else if (key === "S") this.step = { kind: "set" };
    else if (key === "N") this.step = { kind: "new" };
    else if (key === "C") this.step = { kind: "color" };
    else if (key === "LW") this.step = { kind: "lineweight" };
    else if (key === "P") this.step = { kind: "plot" };
    else if (key === "ON") names("turning on", (l) => ({ ...l, on: true }));
    else if (key === "OFF") names("turning off", (l) => ({ ...l, on: false }));
    else if (key === "F") names("freezing", (l) => (l.name === this.ed.doc.currentLayer ? l : { ...l, frozen: true }));
    else if (key === "T") names("thawing", (l) => ({ ...l, frozen: false }));
    else if (key === "LO") names("locking", (l) => ({ ...l, locked: true }));
    else if (key === "U") names("unlocking", (l) => ({ ...l, locked: false }));
  }
  /** Layer names in a list ("A-WALL,A-DOOR"), with * wildcards matching existing ones. */
  private matching(list: string) {
    const doc = this.ed.doc;
    return list
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .flatMap((n) => {
        if (!n.includes("*")) return doc.layers.has(n) ? [n] : [];
        const re = new RegExp(`^${n.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
        return [...doc.layers.keys()].filter((k) => re.test(k));
      });
  }
  value(text: string) {
    const doc = this.ed.doc;
    const step = this.step;
    const t = text.trim();
    if (step.kind === "make") {
      if (!doc.layers.has(t)) doc.setLayer(newLayer(t));
      doc.setCurrentLayer(t);
    } else if (step.kind === "set") {
      if (!doc.layers.has(t)) return this.ed.print(`Cannot find layer "${t}".`, "error"), true;
      doc.setCurrentLayer(t);
    } else if (step.kind === "new") {
      for (const n of t.split(",").map((x) => x.trim()).filter(Boolean)) if (!doc.layers.has(n)) doc.setLayer(newLayer(n));
    } else if (step.kind === "names") {
      const found = this.matching(t);
      if (!found.length) this.ed.print(`No matching layer(s) for "${t}".`, "error");
      for (const n of found) doc.setLayer(step.apply(doc.layers.get(n)!));
    } else if (step.kind === "color") {
      const upper = t.toUpperCase();
      const color = /^#[0-9a-f]{6}$/i.test(t) ? t.toLowerCase() : (COLOR_NAMES[upper] ?? Number(t));
      if (typeof color === "number" && !(Number.isInteger(color) && color >= 1 && color <= 255)) return false;
      this.step = { kind: "names", label: `color ${t}`, apply: (l) => ({ ...l, color }) };
      return true;
    } else if (step.kind === "lineweight") {
      const mm = Number(t.replace(/mm$/i, ""));
      if (!Number.isFinite(mm)) return false;
      const lw = LINEWEIGHTS.reduce((best, w) => (Math.abs(w / 100 - mm) < Math.abs(best / 100 - mm) ? w : best), LINEWEIGHTS[0]);
      this.step = { kind: "names", label: `lineweight ${(lw / 100).toFixed(2)}mm`, apply: (l) => ({ ...l, lineweight: lw }) };
      return true;
    } else return false;
    this.step = { kind: "option" };
    return true;
  }
  enter() {
    const step = this.step;
    if (step.kind === "option") return this.ed.finish();
    // Enter at a name list means the current layer, as in AutoCAD.
    if (step.kind === "names") {
      const current = this.ed.doc.layers.get(this.ed.doc.currentLayer)!;
      this.ed.doc.setLayer(step.apply(current));
    }
    if (step.kind === "plot") {
      this.step = { kind: "names", label: "plotting", apply: (l) => ({ ...l, plot: true }) };
      return;
    }
    this.step = { kind: "option" };
  }
}
