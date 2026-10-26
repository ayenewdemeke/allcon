import { describe, expect, it } from "vitest";
import { Editor } from "./editor";
import { sweepOf } from "./geometry";
import { emptyDrawing, type ArcEntity, type CircleEntity, type EllipseEntity, type Entity, type LineEntity, type PolylineEntity, type RayEntity, type SplineEntity } from "./types";

// Phase 2 commands, driven as an AutoCAD user would: typed commands and points, picks, Enter.

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
const click = (ed: Editor, x: number, y: number, shift = false) => {
  const s = ed.toScreen({ x, y });
  ed.pointerMove(s);
  ed.pointerDown(s, 0);
  ed.pointerUp(s, 0, shift);
};
const all = (ed: Editor) => [...ed.doc.entities.values()];
const ofType = <T extends Entity>(ed: Editor, t: T["type"]) => all(ed).filter((e): e is T => e.type === t);
const line = (ed: Editor, a: string, b: string) => {
  type(ed, "L");
  type(ed, a);
  type(ed, b);
  enter(ed);
};
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("ROTATE, SCALE, MIRROR", () => {
  it("rotates by a typed angle, and a copy with the Copy option", () => {
    const ed = editor();
    line(ed, "0,0", "100,0");
    type(ed, "RO");
    click(ed, 50, 0);
    enter(ed);
    type(ed, "0,0");
    type(ed, "90");
    const [l] = ofType<LineEntity>(ed, "line");
    close(l.b.x, 0);
    close(l.b.y, 100);
    type(ed, "RO");
    click(ed, 0, 50);
    enter(ed);
    type(ed, "0,0");
    type(ed, "C");
    type(ed, "90");
    expect(ofType(ed, "line")).toHaveLength(2);
  });

  it("scales by a factor and by reference lengths", () => {
    const ed = editor();
    type(ed, "C");
    type(ed, "0,0");
    type(ed, "10");
    type(ed, "SC");
    click(ed, 10, 0);
    enter(ed);
    type(ed, "0,0");
    type(ed, "2");
    expect(ofType<CircleEntity>(ed, "circle")[0].radius).toBeCloseTo(20);
    type(ed, "SC");
    click(ed, 20, 0);
    enter(ed);
    type(ed, "0,0");
    type(ed, "R");
    type(ed, "40"); // the diameter now
    type(ed, "100"); // should be
    expect(ofType<CircleEntity>(ed, "circle")[0].radius).toBeCloseTo(50);
  });

  it("mirrors, keeping or erasing the source", () => {
    const ed = editor();
    line(ed, "10,10", "30,10");
    type(ed, "MI");
    click(ed, 20, 10);
    enter(ed);
    type(ed, "0,0");
    type(ed, "0,100");
    enter(ed); // No: keep the source
    const xs = ofType<LineEntity>(ed, "line").map((l) => Math.round(l.a.x));
    expect(xs.sort((a, b) => a - b)).toEqual([-10, 10]);
  });
});

describe("OFFSET", () => {
  it("offsets lines, circles and polylines to the picked side", () => {
    const ed = editor();
    line(ed, "0,0", "100,0");
    type(ed, "C");
    type(ed, "300,0");
    type(ed, "50");
    type(ed, "REC");
    type(ed, "500,0");
    type(ed, "600,100");
    type(ed, "O");
    type(ed, "10");
    click(ed, 50, 0);
    click(ed, 50, 30);
    click(ed, 350, 0);
    click(ed, 300, 0); // inside: smaller
    click(ed, 550, 0);
    click(ed, 550, -30); // outside the rectangle
    enter(ed);
    const lines = ofType<LineEntity>(ed, "line");
    expect(lines.map((l) => l.a.y).sort()).toEqual([0, 10]);
    expect(ofType<CircleEntity>(ed, "circle").map((c) => c.radius).sort()).toEqual([40, 50]);
    const outer = ofType<PolylineEntity>(ed, "polyline").find((p) => p.points[0].x !== 500)!;
    expect(outer.points.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([
      [490, -10],
      [610, -10],
      [610, 110],
      [490, 110],
    ]);
  });
});

describe("TRIM, EXTEND, BREAK", () => {
  it("trims a line at the lines crossing it, and deletes one nothing crosses", () => {
    const ed = editor();
    line(ed, "0,0", "100,0");
    line(ed, "40,-20", "40,20");
    line(ed, "60,-20", "60,20");
    line(ed, "200,0", "300,0");
    type(ed, "TR");
    click(ed, 50, 0); // between the two crossings
    click(ed, 250, 0); // crossed by nothing: erased (Quick mode)
    enter(ed);
    const horizontal = ofType<LineEntity>(ed, "line").filter((l) => l.a.y === 0 && l.b.y === 0);
    expect(horizontal.map((l) => [Math.round(Math.min(l.a.x, l.b.x)), Math.round(Math.max(l.a.x, l.b.x))]).sort((a, b) => a[0] - b[0])).toEqual([
      [0, 40],
      [60, 100],
    ]);
  });

  it("trims a circle into an arc", () => {
    const ed = editor();
    type(ed, "C");
    type(ed, "0,0");
    type(ed, "50");
    line(ed, "-100,0", "100,0");
    type(ed, "TR");
    click(ed, 0, 50); // the top half goes
    enter(ed);
    const [arc] = ofType<ArcEntity>(ed, "arc");
    expect(sweepOf(arc.start, arc.end)).toBeCloseTo(Math.PI);
    expect(Math.sin(arc.start + sweepOf(arc.start, arc.end) / 2)).toBeCloseTo(-1); // the bottom half stays
  });

  it("extends a line to a boundary, and shift-picks trim instead", () => {
    const ed = editor();
    line(ed, "0,0", "50,0");
    line(ed, "100,-50", "100,50");
    type(ed, "EX");
    click(ed, 45, 0);
    enter(ed);
    const l = ofType<LineEntity>(ed, "line").find((x) => x.a.y === 0)!;
    close(l.b.x, 100);
  });

  it("breaks a line between two points, and an xline into rays", () => {
    const ed = editor();
    line(ed, "0,0", "100,0");
    type(ed, "BR");
    click(ed, 30, 0);
    type(ed, "70,0");
    expect(ofType(ed, "line")).toHaveLength(2);
    type(ed, "XL");
    type(ed, "H");
    type(ed, "0,200");
    enter(ed);
    type(ed, "BR");
    click(ed, 0, 200);
    type(ed, "10,200");
    expect(ofType<RayEntity>(ed, "ray")).toHaveLength(2);
  });
});

describe("FILLET, CHAMFER", () => {
  it("fillets two lines with a radius, or sharp with radius 0", () => {
    const ed = editor();
    line(ed, "0,0", "100,0");
    line(ed, "0,10", "0,100");
    type(ed, "F");
    type(ed, "R");
    type(ed, "20");
    click(ed, 60, 0);
    click(ed, 0, 60);
    const [arc] = ofType<ArcEntity>(ed, "arc");
    expect(arc.radius).toBeCloseTo(20);
    close(arc.center.x, 20);
    close(arc.center.y, 20);
    const ends = ofType<LineEntity>(ed, "line").map((l) => [l.a, l.b]);
    expect(ends.flat().some((p) => Math.abs(p.x - 20) < 1e-6 && Math.abs(p.y) < 1e-6)).toBe(true);
  });

  it("chamfers two lines", () => {
    const ed = editor();
    line(ed, "0,0", "100,0");
    line(ed, "0,0", "0,100");
    type(ed, "CHA");
    type(ed, "D");
    type(ed, "10");
    type(ed, "20");
    click(ed, 60, 0);
    click(ed, 0, 60);
    expect(ofType(ed, "line")).toHaveLength(3);
  });

  it("reports what it can't do", () => {
    const ed = editor();
    line(ed, "0,0", "100,0");
    line(ed, "0,10", "100,10");
    type(ed, "F");
    click(ed, 50, 0);
    click(ed, 50, 10);
    expect(ed.history.at(-1)?.text).toMatch(/parallel/);
  });
});

describe("ARRAY, STRETCH, JOIN, EXPLODE, MATCHPROP", () => {
  it("arrays in rows and columns, and around a centre", () => {
    const ed = editor();
    type(ed, "C");
    type(ed, "0,0");
    type(ed, "5");
    type(ed, "ARRAYRECT");
    click(ed, 5, 0);
    enter(ed);
    type(ed, "3");
    type(ed, "2");
    type(ed, "20");
    type(ed, "30");
    expect(ofType(ed, "circle")).toHaveLength(6);
    type(ed, "ARRAYPOLAR");
    click(ed, 5, 0);
    enter(ed);
    type(ed, "100,0");
    type(ed, "4");
    enter(ed); // 360
    expect(ofType(ed, "circle")).toHaveLength(9);
  });

  it("stretches what a crossing window covers", () => {
    const ed = editor();
    type(ed, "REC");
    type(ed, "0,0");
    type(ed, "100,50");
    type(ed, "S");
    click(ed, 120, 60); // right to left crossing over the right side
    click(ed, 80, -10);
    enter(ed);
    type(ed, "0,0");
    type(ed, "50,0");
    const [r] = ofType<PolylineEntity>(ed, "polyline");
    expect(r.points.map((p) => p.x)).toEqual([0, 150, 150, 0]);
  });

  it("joins lines end to end into a polyline, and explodes it back", () => {
    const ed = editor();
    type(ed, "L");
    type(ed, "0,0");
    type(ed, "100,0");
    type(ed, "100,100");
    type(ed, "0,0");
    enter(ed);
    type(ed, "J");
    type(ed, "ALL");
    enter(ed);
    const [p] = ofType<PolylineEntity>(ed, "polyline");
    expect(p.closed).toBe(true);
    expect(all(ed)).toHaveLength(1);
    type(ed, "X");
    click(ed, 50, 0);
    enter(ed);
    expect(ofType(ed, "line")).toHaveLength(3);
  });

  it("joins collinear lines into one", () => {
    const ed = editor();
    line(ed, "0,0", "50,0");
    line(ed, "50,0", "120,0");
    type(ed, "J");
    type(ed, "ALL");
    enter(ed);
    const lines = ofType<LineEntity>(ed, "line");
    expect(lines).toHaveLength(1);
    expect(Math.abs(lines[0].b.x - lines[0].a.x)).toBeCloseTo(120);
  });

  it("matches properties", () => {
    const ed = editor();
    line(ed, "0,0", "100,0");
    line(ed, "0,50", "100,50");
    const [first] = ofType<LineEntity>(ed, "line");
    ed.updateEntity({ ...first, color: 1 });
    type(ed, "MA");
    click(ed, 50, 0);
    click(ed, 50, 50);
    enter(ed);
    expect(ofType<LineEntity>(ed, "line").map((l) => l.color)).toEqual([1, 1]);
  });
});

describe("new drawing commands", () => {
  it("ELLIPSE by axis endpoints and the other axis", () => {
    const ed = editor();
    type(ed, "EL");
    type(ed, "-100,0");
    type(ed, "100,0");
    type(ed, "50");
    const [e] = ofType<EllipseEntity>(ed, "ellipse");
    close(e.center.x, 0);
    close(Math.hypot(e.major.x, e.major.y), 100);
    close(e.ratio, 0.5);
  });

  it("POLYGON inscribed in a circle", () => {
    const ed = editor();
    type(ed, "POL");
    type(ed, "6");
    type(ed, "0,0");
    type(ed, "I");
    type(ed, "100,0");
    const [p] = ofType<PolylineEntity>(ed, "polyline");
    expect(p.points).toHaveLength(6);
    for (const v of p.points) close(Math.hypot(v.x, v.y), 100);
  });

  it("SPLINE through points", () => {
    const ed = editor();
    type(ed, "SPL");
    type(ed, "0,0");
    type(ed, "50,50");
    type(ed, "100,0");
    enter(ed);
    expect(ofType<SplineEntity>(ed, "spline")[0].fit).toHaveLength(3);
  });

  it("XLINE through a point, trimmed into a ray", () => {
    const ed = editor();
    type(ed, "XL");
    type(ed, "0,0");
    type(ed, "100,0");
    enter(ed);
    line(ed, "50,-50", "50,50");
    type(ed, "TR");
    click(ed, 200, 0); // the right side goes
    enter(ed);
    const [ray] = ofType<RayEntity>(ed, "ray");
    close(ray.base.x, 50);
    expect(ray.dir.x).toBeCloseTo(-1);
  });
});
