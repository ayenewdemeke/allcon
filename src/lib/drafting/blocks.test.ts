import { describe, expect, it } from "vitest";
import { blockParts } from "./blocks";
import { Editor } from "./editor";
import { bounds, graphicsOf, reflection, tessellate, transform } from "./geometry";
import { emptyDrawing, type Entity, type HatchEntity, type InsertEntity, type PolylineEntity } from "./types";

// Phase 4: blocks, attributes, the block editor, associative hatches, purge, and arc segments.

function editor() {
  const ed = new Editor(emptyDrawing("mm"), { osnap: false, polar: false, grid: false, dynamic: false });
  ed.setSize(1000, 800);
  ed.view = { cx: 0, cy: 0, scale: 1 };
  return ed;
}
const type = (ed: Editor, text: string) => {
  for (const ch of text) ed.key({ key: ch });
  ed.key({ key: "Enter" });
};
const enter = (ed: Editor) => ed.key({ key: "Enter" });
const ofType = <T extends Entity>(ed: Editor, t: T["type"]) => [...ed.doc.entities.values()].filter((e): e is T => e.type === t);
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

/** A 100 x 50 rectangle and a line, made into block NAME with its base at the origin. */
function makeBlock(ed: Editor, name = "DESK", mode: "convert" | "retain" | "delete" = "convert") {
  type(ed, "REC");
  type(ed, "0,0");
  type(ed, "100,50");
  type(ed, "L");
  type(ed, "0,0");
  type(ed, "100,50");
  enter(ed);
  ed.selectAll();
  type(ed, "B");
  type(ed, "0,0");
  expect(ed.dialog?.kind).toBe("block");
  ed.closeDialog({ name, description: "", mode });
}

describe("blocks", () => {
  it("BLOCK turns the selection into a block and a reference in its place", () => {
    const ed = editor();
    makeBlock(ed);
    expect(ed.doc.blocks.get("DESK")?.entities).toHaveLength(2);
    const [ref] = ofType<InsertEntity>(ed, "insert");
    expect(ed.doc.entities.size).toBe(1);
    expect(bounds(ref)).toMatchObject({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
    ed.undo();
    expect(ed.doc.entities.size).toBe(2);
    expect(ed.doc.blocks.has("DESK")).toBe(false);
  });

  it("-INSERT places a reference scaled and rotated about the base point", () => {
    const ed = editor();
    makeBlock(ed, "DESK", "delete");
    type(ed, "-INSERT");
    type(ed, "desk");
    type(ed, "S");
    type(ed, "2");
    type(ed, "R");
    type(ed, "90");
    type(ed, "500,0");
    const [ref] = ofType<InsertEntity>(ed, "insert");
    const b = bounds(ref);
    close(b.minX, 400);
    close(b.maxX, 500);
    close(b.maxY, 200);
  });

  it("draws circles as ellipses under uneven scale", () => {
    const ed = editor();
    type(ed, "C");
    type(ed, "0,0");
    type(ed, "10");
    ed.selectAll();
    type(ed, "B");
    type(ed, "0,0");
    ed.closeDialog({ name: "DOT", description: "", mode: "convert" });
    const [ref] = ofType<InsertEntity>(ed, "insert");
    const [part] = blockParts({ ...ref, scale: { x: 2, y: 1 } });
    expect(part.type).toBe("ellipse");
    const b = bounds(part);
    close(b.maxX, 20);
    close(b.maxY, 10);
  });

  it("mirrors with its objects", () => {
    const ed = editor();
    makeBlock(ed);
    const [ref] = ofType<InsertEntity>(ed, "insert");
    const mirrored = transform(ref, reflection({ x: 0, y: 0 }, { x: 0, y: 1 })); // about the Y axis
    const b = bounds(mirrored);
    close(b.minX, -100);
    close(b.maxX, 0);
    close(b.maxY, 50);
  });

  it("objects on layer 0 and ByBlock take the reference's layer and colour", () => {
    const ed = editor();
    ed.doc.setLayer({ name: "Furniture", color: 3, lineweight: -3, linetype: "Continuous", on: true, frozen: false, locked: false });
    makeBlock(ed);
    const block = ed.doc.blocks.get("DESK")!;
    ed.doc.setBlock({ ...block, entities: block.entities.map((e, i) => (i === 0 ? { ...e, color: 0 } : e)) });
    const [ref] = ofType<InsertEntity>(ed, "insert");
    const parts = blockParts({ ...ref, layer: "Furniture", color: 1 });
    expect(parts.map((p) => [p.layer, p.color])).toEqual([
      ["Furniture", 1],
      ["Furniture", null],
    ]);
  });

  it("EXPLODE gives the objects back in place", () => {
    const ed = editor();
    makeBlock(ed);
    const [ref] = ofType<InsertEntity>(ed, "insert");
    ed.updateEntity({ ...ref, at: { x: 1000, y: 0 } });
    ed.selectAll();
    type(ed, "X");
    expect(ofType(ed, "insert")).toHaveLength(0);
    const [rect] = ofType<PolylineEntity>(ed, "polyline");
    close(bounds(rect).minX, 1000);
  });

  it("snaps to the objects inside a reference, and to its insertion point", () => {
    const ed = editor();
    ed.setSettings({ osnap: true, snapKinds: ["endpoint", "insertion"] });
    makeBlock(ed);
    type(ed, "L");
    ed.pointerMove(ed.toScreen({ x: 101, y: 51 }));
    expect(ed.snap).toMatchObject({ kind: "endpoint", point: { x: 100, y: 50 } });
    ed.pointerMove(ed.toScreen({ x: 1, y: -1 }));
    expect(ed.snap?.point).toEqual({ x: 0, y: 0 });
  });
});

describe("attributes", () => {
  it("ATTDEF in a block: each reference asks for its value and shows it", () => {
    const ed = editor();
    type(ed, "ATTDEF");
    type(ed, "room");
    type(ed, "Room name");
    type(ed, "OFFICE");
    type(ed, "10,10");
    type(ed, "5");
    enter(ed);
    expect(graphicsOf(ofType(ed, "attdef")[0]).texts[0].text).toBe("ROOM"); // the tag, until it's in a block
    makeBlock(ed, "TAG", "delete");
    type(ed, "-INSERT");
    type(ed, "TAG");
    type(ed, "0,0");
    expect(ed.getSnapshot().prompt).toBe("Room name <OFFICE>:");
    for (const ch of "LIVING ROOM") ed.key({ key: ch });
    enter(ed);
    const [ref] = ofType<InsertEntity>(ed, "insert");
    expect(ref.attribs).toEqual({ ROOM: "LIVING ROOM" });
    expect(graphicsOf(ref).texts.map((t) => t.text)).toEqual(["LIVING ROOM"]);
    // Double-click opens Edit Attributes.
    ed.doubleClick(ed.toScreen({ x: 50, y: 25 }));
    expect(ed.dialog?.kind).toBe("attributes");
    ed.closeDialog({ ROOM: "KITCHEN" });
    expect(ofType<InsertEntity>(ed, "insert")[0].attribs.ROOM).toBe("KITCHEN");
  });
});

describe("the block editor", () => {
  it("edits a block: every reference follows, as one undo step", () => {
    const ed = editor();
    makeBlock(ed);
    type(ed, "-INSERT");
    type(ed, "DESK");
    type(ed, "500,0");
    ed.editBlock("DESK");
    expect(ed.getSnapshot().blockEdit).toBe("DESK");
    expect(ed.doc.entities.size).toBe(2);
    type(ed, "C");
    type(ed, "50,100");
    type(ed, "10");
    ed.requestCloseBlockEditor();
    expect(ed.dialog?.kind).toBe("save-block");
    ed.closeDialog("save");
    expect(ed.getSnapshot().blockEdit).toBeNull();
    expect(ed.doc.blocks.get("DESK")?.entities).toHaveLength(3);
    for (const ref of ofType<InsertEntity>(ed, "insert")) close(bounds(ref).maxY, 110);
    ed.undo();
    for (const ref of ofType<InsertEntity>(ed, "insert")) close(bounds(ref).maxY, 50);
  });
});

describe("associative hatches", () => {
  it("follow their boundary when it changes, in the same undo step", () => {
    const ed = editor();
    type(ed, "REC");
    type(ed, "0,0");
    type(ed, "100,100");
    type(ed, "H");
    ed.pointerMove(ed.toScreen({ x: 50, y: 50 }));
    ed.pointerDown(ed.toScreen({ x: 50, y: 50 }), 0);
    ed.pointerUp(ed.toScreen({ x: 50, y: 50 }), 0);
    enter(ed);
    const rect = ofType<PolylineEntity>(ed, "polyline")[0];
    ed.updateEntity({ ...rect, points: rect.points.map((p) => ({ x: p.x * 2, y: p.y })) });
    const area = (h: HatchEntity) => bounds(h).maxX;
    expect(area(ofType<HatchEntity>(ed, "hatch")[0])).toBeCloseTo(200);
    ed.undo();
    expect(area(ofType<HatchEntity>(ed, "hatch")[0])).toBeCloseTo(100);
  });
});

describe("purge", () => {
  it("lists and removes blocks and layers nothing uses", () => {
    const ed = editor();
    makeBlock(ed, "OLD", "retain");
    ed.doc.setLayer({ name: "Unused", color: 1, lineweight: -3, linetype: "Continuous", on: true, frozen: false, locked: false });
    expect(ed.doc.unused()).toMatchObject({ blocks: ["OLD"], layers: ["Unused"] });
    ed.doc.purge({ blocks: ["OLD"], layers: ["Unused"] });
    expect(ed.doc.blocks.size).toBe(0);
    expect(ed.doc.layers.has("Unused")).toBe(false);
  });
});

describe("polyline arc segments", () => {
  it("are drawn as arcs (DXF bulges)", () => {
    const p: PolylineEntity = { id: "p", layer: "0", color: null, lineweight: -1, linetype: "ByLayer", type: "polyline", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }], bulges: [1, 0], closed: false };
    const b = bounds(p);
    close(b.minY, -1); // counter-clockwise from (0,0) to (2,0) passes below
    close(b.maxY, 0);
    expect(tessellate(p)[0].length).toBeGreaterThan(10);
  });
});
