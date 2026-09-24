import { describe, expect, it } from "vitest";
import { normalizeElements, type RawObject, type TreeNode } from "./normalize";

// Shaped like real Model Derivative output for a Revit model: category -> family -> type -> instance.
const tree: TreeNode[] = [
  {
    objectid: 1,
    name: "Model",
    objects: [
      {
        objectid: 70,
        name: "Walls",
        objects: [{ objectid: 71, name: "Basic Wall", objects: [{ objectid: 72, name: "12\" Concrete", objects: [{ objectid: 1341 }] }] }],
      },
      { objectid: 84, name: "Doors", objects: [{ objectid: 85, objects: [{ objectid: 900 }] }] },
    ],
  },
];

const collection: RawObject[] = [
  {
    objectid: 1341,
    name: "Basic Wall [141237]",
    externalId: "ec1a2117-a54f-4fa0-8c3c-0316a10bbb4b-000227b5",
    properties: {
      Dimensions: { Length: "30.458 ft-and-fractional-in", Area: "365.500 ft^2", Volume: "365.500 CF" },
      Constraints: { "Base Constraint": "Basement", "Unconnected Height": "12.000 ft-and-fractional-in" },
      "Identity Data": {
        "Type Name": "12\" Concrete Foundation Wall",
        "Assembly Code": "A1010210",
        "Assembly Description": "Foundation Walls - CIP",
        Cost: "0.000 ฿",
      },
      "IFC Parameters": { IfcGUID: "3i6Y4NfKzFe8my0nQX2Pp_" },
    },
  },
  // A door with no quantities at all
  { objectid: 900, name: "Single-Flush [5]", externalId: "door-1", properties: { "Identity Data": { "Type Name": "36\" x 84\"" } } },
  // A type/family node: in the properties, but not a leaf of the tree, so not an element
  { objectid: 72, name: "12\" Concrete", externalId: "type-node", properties: {} },
];

describe("normalizeElements", () => {
  const elements = normalizeElements(collection, tree);
  const wall = elements.find((e) => e.stableId.startsWith("ec1a"))!;
  const door = elements.find((e) => e.stableId === "door-1")!;

  it("keeps leaf instances only", () => {
    expect(elements.map((e) => e.stableId).sort()).toEqual(["door-1", "ec1a2117-a54f-4fa0-8c3c-0316a10bbb4b-000227b5"]);
  });

  it("takes the category from the tree, since Revit properties don't carry it", () => {
    expect(wall.category).toBe("Walls");
    expect(door.category).toBe("Doors");
  });

  it("reads type, level and classification", () => {
    expect(wall.typeName).toBe("12\" Concrete Foundation Wall");
    expect(wall.level).toBe("Basement");
    expect(wall.properties["Assembly Code"]).toBe("A1010210");
    expect(wall.properties.IfcGUID).toBe("3i6Y4NfKzFe8my0nQX2Pp_");
  });

  it("stores quantities in SI under canonical keys", () => {
    expect(wall.quantitySource).toBe("property");
    expect(wall.quantities.volume).toBeCloseTo(10.3498, 4);
    expect(wall.quantities.area).toBeCloseTo(33.956, 3);
    expect(wall.quantities.height).toBeCloseTo(3.6576, 4);
    expect(wall.quantities.count).toBe(1);
  });

  it("flags elements with no usable quantity", () => {
    expect(door.quantitySource).toBe("missing");
    expect(door.quantities).toEqual({ count: 1 });
  });
});
