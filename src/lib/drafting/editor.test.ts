import { describe, expect, it } from "vitest";
import { Editor } from "./editor";
import { emptyDrawing, type CircleEntity, type LineEntity, type PolylineEntity } from "./types";

// The editor as an AutoCAD user drives it: typed commands, typed and clicked points, Enter and Esc.

function editor(units: "mm" | "architectural" = "mm") {
  const ed = new Editor(emptyDrawing(units), { osnap: false, polar: false, grid: false });
  ed.setSize(1000, 800);
  ed.view = { cx: 0, cy: 0, scale: 1 };
  return ed;
}

const type = (ed: Editor, text: string) => {
  for (const ch of text) ed.key({ key: ch });
  ed.key({ key: "Enter" });
};

const click = (ed: Editor, x: number, y: number) => {
  const s = ed.toScreen({ x, y });
  ed.pointerMove(s);
  ed.pointerDown(s, 0);
  ed.pointerUp(s, 0);
};

const entities = (ed: Editor) => [...ed.doc.entities.values()];

describe("LINE", () => {
  it("draws segments from typed points, relative after the first", () => {
    const ed = editor();
    type(ed, "L");
    type(ed, "0,0");
    type(ed, "100,0"); // relative with dynamic input on
    type(ed, "@0,50");
    ed.key({ key: "Enter" });
    const lines = entities(ed) as LineEntity[];
    expect(lines).toHaveLength(2);
    expect(lines[1].b).toEqual({ x: 100, y: 50 });
    expect(ed.command).toBeNull();
  });

  it("closes, undoes a segment, and is one undo step", () => {
    const ed = editor();
    type(ed, "LINE");
    click(ed, 0, 0);
    click(ed, 100, 0);
    click(ed, 100, 100);
    click(ed, 50, 150);
    type(ed, "U");
    type(ed, "C");
    expect(entities(ed)).toHaveLength(3);
    ed.key({ key: "z", ctrl: true });
    expect(entities(ed)).toHaveLength(0);
    ed.key({ key: "y", ctrl: true });
    expect(entities(ed)).toHaveLength(3);
  });

  it("takes a direct distance along the cursor", () => {
    const ed = editor("architectural");
    type(ed, "L");
    click(ed, 0, 0);
    ed.pointerMove(ed.toScreen({ x: 0, y: 40 }));
    type(ed, `10'`);
    const { b } = entities(ed)[0] as LineEntity;
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(120);
  });

  it("tracks polar angles", () => {
    const ed = editor();
    ed.setSettings({ polar: true });
    type(ed, "L");
    click(ed, 0, 0);
    click(ed, 100, 3); // 3 px off horizontal: tracked onto 0°
    expect((entities(ed)[0] as LineEntity).b.y).toBeCloseTo(0);
  });

  it("repeats with Enter, and Esc cancels", () => {
    const ed = editor();
    type(ed, "L");
    ed.key({ key: "Escape" });
    expect(ed.command).toBeNull();
    ed.key({ key: "Enter" });
    expect(ed.command?.name).toBe("LINE");
  });
});

describe("drawing commands", () => {
  it("CIRCLE takes a typed radius or diameter", () => {
    const ed = editor();
    type(ed, "C");
    type(ed, "10,10");
    type(ed, "25");
    type(ed, "C");
    type(ed, "0,0");
    type(ed, "D");
    type(ed, "30");
    const circles = entities(ed) as CircleEntity[];
    expect(circles.map((c) => c.radius)).toEqual([25, 15]);
  });

  it("RECTANG makes a closed polyline, with Dimensions too", () => {
    const ed = editor();
    type(ed, "REC");
    type(ed, "0,0");
    type(ed, "@200,100");
    type(ed, "REC");
    type(ed, "0,0");
    type(ed, "D");
    type(ed, "50");
    type(ed, "20");
    click(ed, -1, -1); // the lower-left side
    const [a, b] = entities(ed) as PolylineEntity[];
    expect(a.closed).toBe(true);
    expect(a.points[2]).toEqual({ x: 200, y: 100 });
    expect(b.points[2]).toEqual({ x: -50, y: -20 });
  });

  it("PLINE is one object", () => {
    const ed = editor();
    type(ed, "PL");
    click(ed, 0, 0);
    click(ed, 100, 0);
    click(ed, 100, 100);
    type(ed, "C");
    const [p] = entities(ed) as PolylineEntity[];
    expect(entities(ed)).toHaveLength(1);
    expect(p.points).toHaveLength(3);
    expect(p.closed).toBe(true);
  });
});

describe("selection and editing", () => {
  function twoLines() {
    const ed = editor();
    type(ed, "L");
    type(ed, "0,0");
    type(ed, "100,0");
    ed.key({ key: "Enter" });
    type(ed, "L");
    type(ed, "0,50");
    type(ed, "100,0");
    ed.key({ key: "Enter" });
    return ed;
  }

  it("picks, windows (inside) and crossings (touching)", () => {
    const ed = twoLines();
    click(ed, 50, 1);
    expect(ed.selection.size).toBe(1);
    ed.key({ key: "Escape" });
    click(ed, -10, -10); // left to right: window
    click(ed, 110, 20);
    expect(ed.selection.size).toBe(1);
    ed.key({ key: "Escape" });
    click(ed, 110, 20); // right to left: crossing
    click(ed, 50, -10);
    expect(ed.selection.size).toBe(1);
    click(ed, 110, 60);
    click(ed, -10, 40);
    expect(ed.selection.size).toBe(2);
  });

  it("MOVE uses the selection, and Delete erases", () => {
    const ed = twoLines();
    click(ed, 50, 1);
    type(ed, "M");
    type(ed, "0,0");
    type(ed, "10,20");
    const moved = entities(ed)[0] as LineEntity;
    expect(moved.a).toEqual({ x: 10, y: 20 });
    expect(ed.selection.size).toBe(0);
    click(ed, 60, 21);
    ed.key({ key: "Delete" });
    expect(entities(ed)).toHaveLength(1);
  });

  it("COPY places copies until Enter", () => {
    const ed = twoLines();
    type(ed, "CO");
    click(ed, 50, 1);
    ed.key({ key: "Enter" }); // done selecting
    type(ed, "0,0");
    type(ed, "0,100");
    type(ed, "0,200");
    ed.key({ key: "Enter" });
    expect(entities(ed)).toHaveLength(4);
  });

  it("stretches with grips", () => {
    const ed = editor();
    type(ed, "L");
    type(ed, "0,0");
    type(ed, "100,0");
    ed.key({ key: "Enter" });
    type(ed, "L");
    type(ed, "0,50");
    type(ed, "#100,0"); // ends where the first line ends
    ed.key({ key: "Enter" });
    click(ed, 50, 1);
    click(ed, 100, 0); // the end grip (both lines' ends meet here: both stretch)
    expect(ed.hotGrip).not.toBeNull();
    click(ed, 120, 0);
    const ends = (entities(ed) as LineEntity[]).map((l) => l.b);
    expect(ends[0]).toEqual({ x: 120, y: 0 });
    expect(ends[1]).toEqual({ x: 100, y: 0 }); // not selected: stays
  });

  it("skips locked layers", () => {
    const ed = twoLines();
    ed.doc.setLayer({ ...ed.doc.layers.get("0")!, locked: true });
    click(ed, 50, 1);
    expect(ed.selection.size).toBe(0);
  });
});

describe("the command line", () => {
  it("suggests commands and reports unknown ones", () => {
    const ed = editor();
    for (const ch of "REC") ed.key({ key: ch });
    expect(ed.getSnapshot().suggestions[0].name).toBe("RECTANG");
    ed.key({ key: "Escape" });
    type(ed, "XYZ");
    expect(ed.history.at(-1)?.kind).toBe("error");
  });

  it("locks a length with Tab and takes its angle", () => {
    const ed = editor();
    type(ed, "L");
    type(ed, "0,0");
    for (const ch of "100") ed.key({ key: ch });
    ed.key({ key: "Tab" });
    type(ed, "90");
    const l = entities(ed)[0] as LineEntity;
    expect(l.b.x).toBeCloseTo(0);
    expect(l.b.y).toBeCloseTo(100);
  });
});
