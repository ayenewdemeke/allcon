import { describe, expect, it } from "vitest";
import { DraftDocument } from "./document";
import { emptyDrawing, newLayer, type CircleEntity, type LineEntity } from "./types";

// Collaboration: a newer saved version (someone else's, or an AI app's) merges in, object by
// object, and what's changed here and not saved yet wins.

const line = (id: string, x: number): LineEntity => ({ id, layer: "0", color: null, lineweight: -1, linetype: "ByLayer", type: "line", a: { x, y: 0 }, b: { x, y: 10 } });
const circle = (id: string, r: number): CircleEntity => ({ id, layer: "0", color: null, lineweight: -1, linetype: "ByLayer", type: "circle", center: { x: 0, y: 0 }, radius: r });

/** Two copies of one saved drawing. */
function pair() {
  const base = new DraftDocument(emptyDrawing("mm"));
  base.add(line("shared", 0));
  base.add(line("doomed", 5));
  base.markSaved(base.editSeq);
  return { here: new DraftDocument(base.toData()), there: new DraftDocument(base.toData()) };
}

describe("merging others' changes", () => {
  it("takes their additions, changes and deletions, and keeps unsaved ones here", () => {
    const { here, there } = pair();
    there.add(line("theirs", 20));
    there.update(line("shared", 1));
    there.remove("doomed");
    there.setLayer(newLayer("A-WALL", 1));
    here.add(circle("mine", 5));
    here.applyRemote(there.toData());
    expect([...here.entities.keys()].sort()).toEqual(["mine", "shared", "theirs"]);
    expect((here.entities.get("shared") as LineEntity).a.x).toBe(1);
    expect(here.layers.has("A-WALL")).toBe(true);
    expect(here.unsaved).toBe(true); // the circle still needs saving
  });

  it("keeps the change made here when both changed the same object", () => {
    const { here, there } = pair();
    there.update(line("shared", 100));
    here.update(line("shared", 50));
    here.applyRemote(there.toData());
    expect((here.entities.get("shared") as LineEntity).a.x).toBe(50);
  });

  it("an object erased here stays erased; one they erased that was changed here stays", () => {
    const { here, there } = pair();
    here.remove("shared");
    there.remove("doomed");
    here.update(line("doomed", 6));
    here.applyRemote(there.toData());
    expect(here.entities.has("shared")).toBe(false);
    expect(here.entities.has("doomed")).toBe(true);
  });

  it("a save covers only the edits made before it started", () => {
    const doc = new DraftDocument(emptyDrawing("mm"));
    doc.add(line("a", 0));
    const seq = doc.editSeq;
    doc.add(line("b", 1)); // while saving
    doc.markSaved(seq);
    expect(doc.unsaved).toBe(true);
    doc.markSaved(doc.editSeq);
    expect(doc.unsaved).toBe(false);
    // Taking in someone else's version isn't an unsaved change.
    const other = new DraftDocument(doc.toData());
    other.add(line("c", 2));
    doc.applyRemote(other.toData());
    expect(doc.unsaved).toBe(false);
    expect(doc.entities.size).toBe(3);
  });
});
