import { describe, expect, it } from "vitest";
import { findBoundary } from "./boundary";
import { Editor } from "./editor";
import { distanceTo, graphicsOf, reflection, transform } from "./geometry";
import { dimMeasurement, dimText } from "./graphics";
import { emptyDrawing, type DimensionEntity, type Entity, type HatchEntity, type LeaderEntity, type MTextEntity, type TextEntity } from "./types";

// Phase 3: text, dimensions, multileaders and hatches, driven as an AutoCAD user would.

function editor(units: "mm" | "architectural" = "mm") {
  const ed = new Editor(emptyDrawing(units), { osnap: false, polar: false, grid: false, dynamic: false });
  ed.setSize(1000, 800);
  ed.view = { cx: 0, cy: 0, scale: 1 };
  return ed;
}
const type = (ed: Editor, text: string) => {
  for (const ch of text) ed.key({ key: ch });
  ed.key({ key: "Enter" });
};
const enter = (ed: Editor) => ed.key({ key: "Enter" });
const click = (ed: Editor, x: number, y: number) => {
  const s = ed.toScreen({ x, y });
  ed.pointerMove(s);
  ed.pointerDown(s, 0);
  ed.pointerUp(s, 0);
};
const ofType = <T extends Entity>(ed: Editor, t: T["type"]) => [...ed.doc.entities.values()].filter((e): e is T => e.type === t);
const line = (ed: Editor, a: string, b: string) => {
  type(ed, "L");
  type(ed, a);
  type(ed, b);
  enter(ed);
};

describe("text", () => {
  it("TEXT: start point, height, rotation, then each typed line is a text object", () => {
    const ed = editor();
    type(ed, "DT");
    type(ed, "10,20");
    type(ed, "5");
    enter(ed); // rotation 0
    expect(ed.textEdit).not.toBeNull();
    ed.closeTextEditor("First line\nSecond line");
    const texts = ofType<TextEntity>(ed, "text");
    expect(texts.map((t) => t.text)).toEqual(["First line", "Second line"]);
    expect(texts[0].at).toEqual({ x: 10, y: 20 });
    expect(texts[1].at.y).toBeLessThan(20);
    expect(ed.command).toBeNull();
  });

  it("MTEXT: a box, then text wrapped to its width", () => {
    const ed = editor();
    type(ed, "T");
    type(ed, "0,100");
    type(ed, "200,50");
    ed.closeTextEditor("General notes: verify all dimensions on site before starting work.");
    const [m] = ofType<MTextEntity>(ed, "mtext");
    expect(m.width).toBe(200);
    expect(m.at).toEqual({ x: 0, y: 100 });
    expect(graphicsOf(m).texts.length).toBeGreaterThan(1); // wrapped
  });

  it("is picked inside its box and edited by double-click", () => {
    const ed = editor();
    type(ed, "DT");
    type(ed, "0,0");
    type(ed, "10");
    enter(ed);
    ed.closeTextEditor("HELLO");
    const [t] = ofType<TextEntity>(ed, "text");
    expect(distanceTo(t, { x: 5, y: 4 })).toBe(0);
    ed.doubleClick(ed.toScreen({ x: 5, y: 4 }));
    expect(ed.textEdit?.value).toBe("HELLO");
    ed.closeTextEditor("GOODBYE");
    expect(ofType<TextEntity>(ed, "text")[0].text).toBe("GOODBYE");
  });

  it("still reads forwards when mirrored", () => {
    const t: TextEntity = { id: "t", layer: "0", color: null, lineweight: -1, linetype: "ByLayer", type: "text", at: { x: 10, y: 0 }, text: "A", height: 1, rotation: 0, style: "Standard", halign: "left", valign: "baseline" };
    const mirrored = transform(t, reflection({ x: 0, y: 0 }, { x: 0, y: 1 })); // about the Y axis
    expect(mirrored.at.x).toBeCloseTo(-10);
    expect(Math.cos(mirrored.rotation)).toBeCloseTo(1); // not backwards
  });
});

describe("dimensions", () => {
  it("DIMLINEAR picks horizontal or vertical from where the line goes", () => {
    const ed = editor();
    type(ed, "DLI");
    type(ed, "0,0");
    type(ed, "300,400");
    type(ed, "150,500"); // above: horizontal
    type(ed, "DLI");
    type(ed, "0,0");
    type(ed, "300,400");
    type(ed, "400,200"); // to the right: vertical
    const [h, v] = ofType<DimensionEntity>(ed, "dimension");
    expect(dimMeasurement(h)).toBeCloseTo(300);
    expect(dimMeasurement(v)).toBeCloseTo(400);
    expect(dimText(h)).toBe("300");
  });

  it("DIMALIGNED measures the true distance, in feet and inches for architectural drawings", () => {
    const ed = editor("architectural");
    type(ed, "DAL");
    type(ed, "0,0");
    type(ed, "36,48");
    type(ed, "0,100");
    const [d] = ofType<DimensionEntity>(ed, "dimension");
    expect(dimText(d)).toBe(`5'-0"`);
  });

  it("text override with <> for the measurement", () => {
    const ed = editor();
    type(ed, "DLI");
    type(ed, "0,0");
    type(ed, "100,0");
    type(ed, "T");
    type(ed, "<> TYP.");
    type(ed, "50,30");
    expect(dimText(ofType<DimensionEntity>(ed, "dimension")[0])).toBe("100 TYP.");
  });

  it("DIMRADIUS, DIMDIAMETER and DIMANGULAR", () => {
    const ed = editor();
    type(ed, "C");
    type(ed, "0,0");
    type(ed, "50");
    type(ed, "DRA");
    click(ed, 50, 0);
    type(ed, "100,100");
    type(ed, "DDI");
    click(ed, -50, 0);
    type(ed, "-100,-100");
    line(ed, "200,0", "400,0");
    line(ed, "200,0", "300,100");
    type(ed, "DAN");
    click(ed, 350, 0);
    click(ed, 250, 50);
    type(ed, "350,60");
    const dims = ofType<DimensionEntity>(ed, "dimension");
    expect(dims.map(dimText)).toEqual(["R50", "Ø100", "45°"]);
  });

  it("DIMCONTINUE and DIMBASELINE chain from the last dimension", () => {
    const ed = editor();
    type(ed, "DLI");
    type(ed, "0,0");
    type(ed, "100,0");
    type(ed, "50,-30");
    type(ed, "DCO");
    type(ed, "250,0");
    type(ed, "300,0");
    enter(ed);
    type(ed, "DBA");
    type(ed, "500,0");
    enter(ed);
    const dims = ofType<DimensionEntity>(ed, "dimension");
    // Baseline from the last dimension's first extension line (250), as AutoCAD.
    expect(dims.map((d) => Math.round(dimMeasurement(d)))).toEqual([100, 150, 50, 250]);
    // The continued ones share the first's dimension line; the baseline one sits further out.
    expect(dims[1].loc.y).toBeCloseTo(-30);
    expect(dims[3].loc.y).toBeLessThan(-30);
  });

  it("stretch with what they measure", () => {
    const ed = editor();
    line(ed, "0,0", "100,0");
    type(ed, "DLI");
    type(ed, "0,0");
    type(ed, "100,0");
    type(ed, "50,-30");
    type(ed, "S");
    click(ed, 120, 10); // crossing over the right ends
    click(ed, 80, -50);
    enter(ed);
    type(ed, "0,0");
    type(ed, "50,0");
    expect(dimMeasurement(ofType<DimensionEntity>(ed, "dimension")[0])).toBeCloseTo(150);
  });
});

describe("multileaders", () => {
  it("MLEADER: arrowhead, landing, then text", () => {
    const ed = editor();
    type(ed, "MLD");
    type(ed, "0,0");
    type(ed, "100,50");
    ed.closeTextEditor("SEE DETAIL 3");
    const [l] = ofType<LeaderEntity>(ed, "leader");
    expect(l.points).toHaveLength(2);
    expect(graphicsOf(l).texts[0].text).toBe("SEE DETAIL 3");
    expect(graphicsOf(l).fills.length).toBe(1); // the arrowhead
  });
});

describe("hatches", () => {
  it("finds the enclosed area around a picked point, with islands", () => {
    const ed = editor();
    line(ed, "0,0", "100,0");
    line(ed, "100,0", "100,100");
    line(ed, "100,100", "0,100");
    line(ed, "0,100", "0,0");
    line(ed, "50,-50", "50,150"); // splits the square in two
    type(ed, "C");
    type(ed, "25,50");
    type(ed, "10");
    const loops = findBoundary([...ed.doc.entities.values()], { x: 10, y: 10 }, 0.01);
    expect(loops).not.toBeNull();
    const [outer, ...islands] = loops!;
    const xs = outer.map((p) => Math.round(p.x));
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(50); // only the left half
    expect(islands).toHaveLength(1); // the circle
    expect(findBoundary([...ed.doc.entities.values()], { x: 500, y: 500 }, 0.01)).toBeNull();
  });

  it("HATCH picks make one hatch; SOLID fills and patterns draw lines", () => {
    const ed = editor();
    type(ed, "REC");
    type(ed, "0,0");
    type(ed, "100,100");
    type(ed, "H");
    type(ed, "P");
    type(ed, "SOLID");
    click(ed, 50, 50);
    enter(ed);
    const [solid] = ofType<HatchEntity>(ed, "hatch");
    expect(solid.pattern).toBe("SOLID");
    expect(graphicsOf(solid).fills).toHaveLength(2); // a square in two triangles
    expect(distanceTo(solid, { x: 30, y: 30 })).toBe(0); // picked by clicking inside
    // Text inside is left clear, as an island.
    type(ed, "DT");
    type(ed, "20,20");
    type(ed, "10");
    enter(ed);
    ed.closeTextEditor("ROOM");
    expect(findBoundary([...ed.doc.entities.values()], { x: 80, y: 80 }, 0.01)).toHaveLength(2);
    const lines: HatchEntity = { ...solid, id: "x", pattern: "ANSI31", scale: 10 / 3.175 }; // 10 mm apart
    expect(graphicsOf(lines).lines.length).toBeGreaterThan(10);
  });
});
