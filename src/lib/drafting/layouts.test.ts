import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { setViewportScale } from "./commands-layout";
import { MODEL } from "./document";
import { Editor } from "./editor";
import { layoutSheet, sheetFacts } from "./layouts";
import { plotPdf } from "./plot";
import { emptyDrawing, type DimensionEntity, type Entity, type InsertEntity, type TextEntity, type ViewportEntity } from "./types";

// Phase 5: layouts, viewports, floating model space, plotting and sheet facts.

function editor() {
  const ed = new Editor(emptyDrawing("architectural"), { osnap: false, polar: false, grid: false, dynamic: false });
  ed.setSize(1000, 800);
  ed.view = { cx: 0, cy: 0, scale: 1 };
  return ed;
}
const type = (ed: Editor, text: string) => {
  for (const ch of text) ed.key({ key: ch });
  ed.key({ key: "Enter" });
};
const ofType = <T extends Entity>(entities: Iterable<Entity>, t: T["type"]) => [...entities].filter((e): e is T => e.type === t);

/** A 40' x 20' rectangle in model space, and a layout. */
function withLayout() {
  const ed = editor();
  type(ed, "REC");
  type(ed, "0,0");
  type(ed, "480,240");
  const id = ed.newLayout("A-101");
  return { ed, id };
}

describe("layouts", () => {
  it("a new layout has a title block and a viewport on the whole model, on a layer that doesn't plot", () => {
    const { ed, id } = withLayout();
    expect(ed.layoutId).toBe(id);
    expect(ed.doc.space).toBe(id);
    const paper = [...ed.doc.entities.values()];
    const [vp] = ofType<ViewportEntity>(paper, "viewport");
    expect(vp.layer).toBe("Viewports");
    expect(ed.doc.layers.get("Viewports")?.plot).toBe(false);
    expect(vp.scale).toBe(1 / 24); // 40' fits at 1/2" = 1'-0" on ARCH D, inside the border
    expect(vp.view).toEqual({ x: 240, y: 120 });
    expect(ofType<InsertEntity>(paper, "insert")[0].attribs.SCALE).toBe('1/2" = 1\'-0"');
    // Model and paper are separate spaces.
    ed.setLayout(null);
    expect(ofType(ed.doc.entities.values(), "viewport")).toHaveLength(0);
    // One undo step takes the layout away.
    ed.undo();
    expect(ed.doc.layouts.size).toBe(0);
  });

  it("a new viewport scale shows in the title block", () => {
    const { ed } = withLayout();
    const vp = ofType<ViewportEntity>(ed.doc.entities.values(), "viewport")[0];
    ed.selection = new Set([vp.id]);
    setViewportScale(ed, 1 / 48);
    expect(ofType<InsertEntity>(ed.doc.entities.values(), "insert")[0].attribs.SCALE).toBe('1/4" = 1\'-0"');
    ed.undo();
    expect(ofType<InsertEntity>(ed.doc.entities.values(), "insert")[0].attribs.SCALE).toBe('1/2" = 1\'-0"');
  });

  it("saves and loads with its layouts", () => {
    const { ed, id } = withLayout();
    const again = new Editor(ed.doc.toData());
    expect(again.doc.layouts.get(id)?.name).toBe("A-101");
    expect(again.doc.entitiesIn(id).size).toBe(2);
    expect(again.doc.entitiesIn(MODEL).size).toBe(1);
  });

  it("text and dimensions on paper are 1:1", () => {
    const { ed } = withLayout();
    type(ed, "DT");
    type(ed, "2,2");
    ed.key({ key: "Enter" });
    ed.key({ key: "Enter" });
    ed.closeTextEditor("NOTES");
    expect(ofType<TextEntity>(ed.doc.entities.values(), "text")[0].height).toBeCloseTo(3 / 32);
    type(ed, "DLI");
    type(ed, "1,1");
    type(ed, "5,1");
    type(ed, "3,0.5");
    expect(ofType<DimensionEntity>(ed.doc.entities.values(), "dimension")[0].dimScale).toBe(1);
  });
});

describe("working through a viewport", () => {
  it("maps the model into the viewport, draws in model space, and zooms the viewport", () => {
    const { ed } = withLayout();
    ed.zoomExtents();
    const vp = ofType<ViewportEntity>(ed.doc.entities.values(), "viewport")[0];
    const paper = { ...ed.view };
    ed.enterViewport(vp.id);
    expect(ed.doc.space).toBe(MODEL);
    // The model's centre shows at the viewport's centre on the paper.
    const s = ed.toScreen(vp.view);
    expect(s.x).toBeCloseTo((vp.center.x - paper.cx) * paper.scale + 500);
    expect(s.y).toBeCloseTo(400 - (vp.center.y - paper.cy) * paper.scale);
    type(ed, "C");
    type(ed, "100,100");
    type(ed, "10");
    expect(ofType(ed.doc.entitiesIn(MODEL).values(), "circle")).toHaveLength(1);
    // Zooming in changes the viewport's scale; the paper stays put.
    ed.zoomAt(s, 2);
    const zoomed = ed.drawing.entitiesIn(ed.layoutId!).get(vp.id) as ViewportEntity;
    expect(zoomed.scale).toBeCloseTo(vp.scale * 2);
    ed.exitViewport();
    expect(ed.view).toEqual(paper);
  });

  it("a locked viewport keeps its scale: zooming moves the paper instead", () => {
    const { ed } = withLayout();
    ed.zoomExtents();
    const vp = ofType<ViewportEntity>(ed.doc.entities.values(), "viewport")[0];
    ed.updateEntity({ ...vp, locked: true });
    ed.enterViewport(vp.id);
    ed.zoomAt({ x: 500, y: 400 }, 2);
    expect((ed.drawing.entitiesIn(ed.layoutId!).get(vp.id) as ViewportEntity).scale).toBe(vp.scale);
    expect(ed.paperView!.scale).toBeGreaterThan(0);
  });
});

describe("plotting and publishing", () => {
  it("sheet facts: number and title from the title block, scale from the viewport", () => {
    const { ed, id } = withLayout();
    const tb = ofType<InsertEntity>(ed.doc.entities.values(), "insert")[0];
    ed.updateEntity({ ...tb, attribs: { ...tb.attribs, SHEET_NUMBER: "A-101", SHEET_TITLE: "FLOOR PLAN" } });
    const facts = sheetFacts(ed.doc, id);
    expect(facts).toMatchObject({ number: "A-101", title: "FLOOR PLAN", width: 36 * 72, height: 24 * 72, scaleLabel: '1/2" = 1\'-0"' });
    // 1/2" = 1'-0": a point on paper is 1/72" × 24 = 1/3" of the model.
    expect(facts.metersPerPoint).toBeCloseTo((0.0254 * 24) / 72);
  });

  it("plots a layout as a vector PDF page of its paper size", async () => {
    const { ed, id } = withLayout();
    const bytes = await plotPdf(ed.doc, [layoutSheet(ed.doc, id)], { title: "Test" });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 36 * 72, height: 24 * 72 });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
