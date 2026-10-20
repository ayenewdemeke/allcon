import { describe, expect, it } from "vitest";
import { ifcGuid } from "./compile";
import { modelElements } from "./elements";
import { modelSpecSchema } from "./spec";

const house = modelSpecSchema.parse({
  units: "m",
  levels: [{ id: "L1", name: "Ground floor", elevation: 0 }],
  materials: [
    { id: "cmu", name: "CMU", category: "masonry" },
    { id: "conc", name: "Concrete", category: "concrete", grade: "C30" },
  ],
  elements: [
    { id: "W1", type: "wall", level: "L1", material: "cmu", anchor: "bottom", mark: "W1", profile: { kind: "rect", width: 0.2, depth: 3 }, path: [[0, 0, 0], [5, 0, 0]] },
    { id: "W2", type: "wall", level: "L1", material: "cmu", anchor: "bottom", profile: { kind: "rect", width: 0.2, depth: 3 }, path: [[5, 0, 0], [5, 4, 0]] },
    { id: "S1", type: "slab", level: "L1", material: "conc", profile: { kind: "polygon", points: [[0, 0], [5, 0], [5, 4], [0, 4]] }, path: [[0, 0, -0.15], [0, 0, 0]] },
    { id: "B1", type: "beam", material: "conc", profile: { kind: "rect", width: 0.3, depth: 0.5 }, path: [[0, 2, 3], [5, 2, 3]] },
  ],
  openings: [{ id: "D1", kind: "door", host: "W1", offset: 1, width: 1, height: 2 }],
  spaces: [{ id: "R1", name: "Office", number: "101", level: "L1", outline: [[0, 0], [5, 0], [5, 4], [0, 4]], base: 0, height: 2.7 }],
});

describe("model elements for mapping", () => {
  const rows = modelElements("m1", house);
  const byId = (part: string) => rows.find((r) => r.stableId === ifcGuid(`m1:${part}`))!;

  it("uses the compiled IFC's GlobalIds and Revit-style categories", () => {
    expect(byId("el:W1").category).toBe("Walls");
    expect(byId("el:S1").category).toBe("Floors");
    expect(byId("el:B1").category).toBe("Structural Framing");
    expect(byId("fill:D1").category).toBe("Doors");
    expect(byId("sp:R1").category).toBe("Rooms");
  });

  it("groups like elements by material and size", () => {
    expect(byId("el:W1").typeName).toBe("CMU · 200 mm thick");
    expect(byId("el:W2").typeName).toBe(byId("el:W1").typeName);
    expect(byId("el:S1").typeName).toBe("Concrete C30 · 150 mm thick");
    expect(byId("el:B1").typeName).toBe("Concrete C30 · 300 mm × 500 mm");
  });

  it("measures walls net of their openings, slabs by plan area, rooms by area and perimeter", () => {
    const w1 = byId("el:W1").quantities;
    expect(w1.area).toBeCloseTo(5 * 3 - 1 * 2); // face area less the door
    expect(w1.volume).toBeCloseTo((5 * 3 - 2) * 0.2);
    expect(w1.length).toBeCloseTo(5);
    expect(byId("el:S1").quantities.area).toBeCloseTo(20);
    expect(byId("el:S1").quantities.volume).toBeCloseTo(3);
    expect(byId("el:B1").quantities.area).toBeUndefined();
    expect(byId("fill:D1").quantities.area).toBeCloseTo(2);
    expect(byId("sp:R1").quantities).toMatchObject({ area: 20, perimeter: 18 });
    expect(byId("el:W1").level).toBe("Ground floor");
  });
});
