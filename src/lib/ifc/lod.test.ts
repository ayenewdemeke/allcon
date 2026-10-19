import { describe, expect, it } from "vitest";
import * as WebIFC from "web-ifc";
import { parseLod } from "@/lib/mcp/model-prompts";
import { compileIfc } from "./compile";
import { lodGuide, lodSummary } from "./lod";
import { modelSpecSchema } from "./spec";
import { summarizeModel } from "./summary";

const house = modelSpecSchema.parse({
  units: "ft",
  lod: "300",
  levels: [
    { id: "L1", name: "Finish floor", elevation: 100 },
    { id: "C1", name: "Ceiling", elevation: 104 },
  ],
  materials: [{ id: "cmu", name: "CMU", category: "masonry" }],
  elements: [
    { id: "W1", type: "wall", level: "L1", material: "cmu", anchor: "bottom", lod: "300", basis: "dimensioned", profile: { kind: "rect", width: 0.67, depth: 12 }, path: [[0, 0, 100], [40, 0, 100]] },
    { id: "W2", type: "wall", level: "L1", material: "cmu", anchor: "bottom", lod: "300", basis: "scaled", profile: { kind: "rect", width: 0.67, depth: 12 }, path: [[40, 0, 100], [40, 20, 100]] },
    { id: "W3", type: "wall", level: "L1", material: "cmu", anchor: "bottom", lod: "200", profile: { kind: "rect", width: 0.67, depth: 12 }, path: [[40, 20, 100], [0, 20, 100]] },
  ],
});

describe("level of development", () => {
  it("reads the LOD a person asks for, defaulting to 300", () => {
    expect(parseLod("LOD 350")).toBe("350");
    expect(parseLod("200")).toBe("200");
    expect(parseLod("400")).toBe("300"); // not offered
    expect(parseLod(undefined)).toBe("300");
    expect(lodGuide("300")).toContain("Doors, windows and storefronts");
  });

  it("counts elements by LOD and flags ones below target or claiming more than their basis", () => {
    const s = lodSummary("300", [{ lod: "300", basis: "dimensioned" }, { lod: "300", basis: "scaled" }, { lod: "200" }, {}]);
    expect(s.byLevel).toEqual({ "300": 2, "200": 1 });
    expect(s.unset).toBe(1);
    expect(s.warnings.join(" ")).toMatch(/1 element has no LOD.*1 element is below.*1 element claims/);
  });

  it("puts the LOD in the model summary and warns about levels that are really ceilings", () => {
    const s = summarizeModel(house);
    expect(s.lod).toEqual({ target: "300", byLevel: { "300": 2, "200": 1 }, unset: 0 });
    expect(s.warnings.some((w) => w.includes('Level "Ceiling" looks like a ceiling'))).toBe(true);
    expect(s.warnings.some((w) => w.includes("claims a higher LOD"))).toBe(true);
  });

  it("writes each element's LOD and basis, and the target, into the IFC", async () => {
    const { text } = compileIfc(house, { modelId: "m-lod", name: "LOD house" });
    expect(text).toContain("'TargetLOD'");
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const id = api.OpenModel(new TextEncoder().encode(text));
    const lines = api.GetLineIDsWithType(id, WebIFC.IFCPROPERTYSINGLEVALUE);
    const values: string[] = [];
    for (let i = 0; i < lines.size(); i++) {
      const p = api.GetLine(id, lines.get(i));
      values.push(`${p.Name.value}=${p.NominalValue.value}`);
    }
    expect(values).toEqual(expect.arrayContaining(["LOD=300", "Basis=dimensioned", "Basis=scaled", "LOD=200", "TargetLOD=300"]));
    api.CloseModel(id);
  });
});
