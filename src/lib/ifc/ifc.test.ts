import { describe, expect, it } from "vitest";
import * as WebIFC from "web-ifc";
import { compileIfc, ifcGuid, str } from "./compile";
import { profileArea, sweepFrame } from "./geometry";
import { applyPatch, modelPatchSchema, modelSpecSchema, type ModelSpec } from "./spec";
import { specErrors, summarizeModel } from "./summary";

// A small two-span bridge using every profile kind, in feet.
const bridge: ModelSpec = modelSpecSchema.parse({
  units: "ft",
  facility: "bridge",
  materials: [
    { id: "conc", name: "Concrete", category: "concrete", grade: "Class D" },
    { id: "stl", name: "Steel", category: "steel", grade: "A709 Gr50" },
  ],
  elements: [
    { id: "F1", type: "footing", material: "conc", profile: { kind: "rect", width: 12, depth: 8 }, path: [[0, 0, -4], [0, 0, 0]] },
    { id: "P1", type: "pier", material: "conc", profile: { kind: "circle", radius: 2 }, path: [[0, 0, 0], [0, 0, 20]] },
    { id: "PIPE", type: "member", material: "stl", profile: { kind: "tube", radius: 0.5, wall: 0.05 }, path: [[5, 0, 0], [5, 0, 10]] },
    // A curved girder as segments, hung from the deck line
    { id: "G1", type: "girder", material: "stl", anchor: "top", profile: { kind: "i", depth: 4, flange_width: 1.5, web_thickness: 0.05, flange_thickness: 0.1 }, path: [[-60, -4, 24], [0, -3, 24], [60, -4, 24]] },
    { id: "T1", type: "beam", material: "stl", profile: { kind: "tee", depth: 1, flange_width: 1, web_thickness: 0.05, flange_thickness: 0.08 }, path: [[0, 4, 22], [10, 4, 22]] },
    { id: "L1", type: "brace", material: "stl", profile: { kind: "angle", depth: 0.5, width: 0.5, thickness: 0.04 }, path: [[0, -4, 20], [0, 4, 23]] },
    { id: "C1", type: "member", material: "stl", rotation: 90, profile: { kind: "channel", depth: 1, flange_width: 0.3, web_thickness: 0.03, flange_thickness: 0.05 }, path: [[2, 0, 18], [2, 6, 18]] },
    // Deck described top-down with a plan outline (should not be mirrored)
    { id: "D1", type: "deck", material: "conc", profile: { kind: "polygon", points: [[-60, -8], [60, -8], [60, 8], [-60, 8]] }, path: [[0, 0, 24.75], [0, 0, 24]] },
    { id: "R1", type: "barrier", material: "conc", anchor: "bottom", profile: { kind: "rect", width: 1, depth: 3 }, path: [[-60, 7.5, 24.75], [60, 7.5, 24.75]] },
    { id: "B1", type: "bearing", material: "stl", profile: { kind: "rect", width: 2, depth: 1 }, path: [[0, -3, 20], [0, -3, 20.2]] },
    { id: "X1", type: "pile", material: "conc", profile: { kind: "circle", radius: 1 }, path: [[3, 3, -40], [3, 3, -4]] },
    { id: "S1", type: "stair", profile: { kind: "rect", width: 4, depth: 0.5 }, path: [[70, 0, 0], [80, 0, 6]] },
    { id: "BAD", type: "other", profile: { kind: "rect", width: 1, depth: 1 }, path: [[1, 1, 1], [1, 1, 1]] },
  ],
});

async function parse(text: string) {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const model = api.OpenModel(new TextEncoder().encode(text));
  return { api, model };
}

describe("compileIfc", () => {
  it("writes a valid IFC4X3 model that web-ifc reads, with geometry for every element", async () => {
    const { text, skipped } = compileIfc(bridge, { modelId: "m1", name: "Test bridge" });
    expect(skipped).toEqual(["BAD"]);
    const { api, model } = await parse(text);
    expect(api.GetModelSchema(model)).toBe("IFC4X3_ADD2");
    const count = (type: number) => api.GetLineIDsWithType(model, type).size();
    expect(count(WebIFC.IFCBRIDGE)).toBe(1);
    expect(count(WebIFC.IFCBEAM)).toBe(2);
    expect(count(WebIFC.IFCCOLUMN)).toBe(1);
    expect(count(WebIFC.IFCMEMBER)).toBe(3);
    expect(count(WebIFC.IFCSLAB)).toBe(1);
    expect(count(WebIFC.IFCPILE)).toBe(1);
    expect(count(WebIFC.IFCSTAIRFLIGHT)).toBe(1);
    expect(count(WebIFC.IFCBEARING)).toBe(1);

    // Every element line parses with its schema, and each one produces a mesh.
    const meshes = new Set<number>();
    api.StreamAllMeshes(model, (mesh) => {
      if (mesh.geometries.size() > 0) meshes.add(mesh.expressID);
    });
    expect(meshes.size).toBe(12);
    const girder = api.GetLine(model, [...api.GetLineIDsWithType(model, WebIFC.IFCBEAM)].find(() => true) ?? 0);
    expect(girder.GlobalId.value).toHaveLength(22);
    api.CloseModel(model);
  });

  it("handles metres and millimetres, and a building with levels", async () => {
    const building = modelSpecSchema.parse({
      units: "mm",
      levels: [{ id: "L1", name: "Level 1", elevation: 0 }, { id: "L2", name: "Level 2", elevation: 3500 }],
      materials: [{ id: "c", name: "Concrete", category: "concrete" }],
      elements: [
        { id: "W1", type: "wall", level: "L1", material: "c", anchor: "bottom", profile: { kind: "rect", width: 200, depth: 3500 }, path: [[0, 0, 0], [6000, 0, 0]] },
        { id: "S2", type: "slab", level: "L2", material: "c", profile: { kind: "polygon", points: [[0, 0], [6000, 0], [6000, 4000], [0, 4000]] }, path: [[0, 0, 3300], [0, 0, 3500]] },
      ],
    });
    const { api, model } = await parse(compileIfc(building, { modelId: "m2", name: "Bürohaus 'A'" }).text);
    expect(api.GetLineIDsWithType(model, WebIFC.IFCBUILDINGSTOREY).size()).toBe(2);
    expect(api.GetLineIDsWithType(model, WebIFC.IFCWALL).size()).toBe(1);
    api.CloseModel(model);
  });
});

describe("helpers", () => {
  it("makes stable 22-character GlobalIds", () => {
    expect(ifcGuid("a")).toHaveLength(22);
    expect(ifcGuid("a")).toBe(ifcGuid("a"));
    expect(ifcGuid("a")).not.toBe(ifcGuid("b"));
    expect("0123".includes(ifcGuid("x")[0])).toBe(true);
  });

  it("escapes STEP strings", () => {
    expect(str("it's")).toBe("'it''s'");
    expect(str("ü")).toBe("'\\X2\\00FC\\X0\\'");
    expect(str("")).toBe("$");
  });

  it("computes profile areas", () => {
    expect(profileArea({ kind: "rect", width: 2, depth: 3 })).toBe(6);
    expect(profileArea({ kind: "polygon", points: [[0, 0], [4, 0], [4, 3]] })).toBe(6);
    expect(profileArea({ kind: "i", depth: 10, flange_width: 4, web_thickness: 1, flange_thickness: 1 })).toBe(16);
  });

  it("builds a right-handed sweep frame with y up for horizontal members", () => {
    const f = sweepFrame([10, 0, 0], 0);
    expect(f.y).toEqual([0, 0, 1]);
    expect(f.x[1]).toBeCloseTo(1);
  });
});

describe("summary and patches", () => {
  it("summarizes quantities and flags problems", () => {
    const s = summarizeModel(bridge);
    expect(s.elements).toBe(13);
    expect(s.byType.find((t) => t.type === "deck")!.volumeM3).toBeCloseTo(120 * 16 * 0.75 * 0.3048 ** 3, 3);
    expect(s.warnings.some((w) => w.startsWith("BAD"))).toBe(true);
    expect(s.warnings.some((w) => /2 elements have no material/.test(w))).toBe(true);
    expect(specErrors({ ...bridge, elements: [...bridge.elements, bridge.elements[0]] })).toEqual(['Duplicate element id "F1"']);
  });

  it("keeps materials and levels when a change doesn't mention them", () => {
    const patch = modelPatchSchema.parse({ upsert_elements: [], remove_element_ids: ["BAD"] });
    const next = applyPatch(bridge, patch);
    expect(next.materials).toHaveLength(2);
    expect(next.elements).toHaveLength(12);
  });

  it("reports extents from the actual geometry", () => {
    const s = summarizeModel(bridge);
    // Deck outline spans x -60..60; the sloped stair ends near x 80 (its width runs across, in y); the pile reaches z -40.
    expect(s.extents!.min[0]).toBeCloseTo(-60, 0);
    expect(s.extents!.max[0]).toBeCloseTo(80.1, 0);
    expect(s.extents!.min[1]).toBeCloseTo(-8, 0);
    expect(s.extents!.min[2]).toBeCloseTo(-40, 0);
  });

  it("applies upserts and removals", () => {
    const next = applyPatch(bridge, {
      upsert_elements: [{ ...bridge.elements[1], profile: { kind: "circle", radius: 3 } }, { ...bridge.elements[0], id: "F2" }],
      remove_element_ids: ["BAD"],
    });
    expect(next.elements).toHaveLength(13);
    expect(next.elements.find((e) => e.id === "P1")!.profile).toEqual({ kind: "circle", radius: 3 });
    expect(next.elements.some((e) => e.id === "BAD")).toBe(false);
  });
});
