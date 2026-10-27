import { describe, expect, it } from "vitest";
import { dimMeasurement } from "./graphics";
import { runScript } from "./script";
import { emptyDrawing, type DimensionEntity, type Entity, type InsertEntity, type PolylineEntity, type TextEntity } from "./types";

// Scripts, as an AI app sends them through the connector: AutoCAD command lines.

const ofType = <T extends Entity>(entities: Entity[], t: T["type"]) => entities.filter((e): e is T => e.type === t);

describe("scripts", () => {
  it("draws a small plan the way an AutoCAD script would", () => {
    const script = `; a 20' x 12' room
-LAYER
M
A-WALL
C
1

LW
0.5


-LAYER
M
A-ANNO

-LAYER
S
A-WALL

RECTANG
0,0
240,144
-LAYER
S
A-ANNO

TEXT
J
MC
120,72
9
0
LIVING ROOM

DIMLINEAR
0,0
240,0
120,-24
`;
    const r = runScript(emptyDrawing("architectural"), script);
    expect(r.errors).toEqual([]);
    const layers = Object.fromEntries(r.data.layers.map((l) => [l.name, l]));
    expect(layers["A-WALL"]).toMatchObject({ color: 1, lineweight: 50 });
    expect(r.data.currentLayer).toBe("A-ANNO");
    const [room] = ofType<PolylineEntity>(r.data.entities, "polyline");
    expect(room.layer).toBe("A-WALL");
    const [label] = ofType<TextEntity>(r.data.entities, "text");
    expect(label).toMatchObject({ text: "LIVING ROOM", layer: "A-ANNO", halign: "center", valign: "middle", height: 9 });
    expect(dimMeasurement(ofType<DimensionEntity>(r.data.entities, "dimension")[0])).toBeCloseTo(240);
    expect(r.added).toHaveLength(3);
    expect(r.transcript.some((l) => l.startsWith("Command: RECTANG"))).toBe(true);
  });

  it("selects with Last, Window and typed points; blocks with -BLOCK and -INSERT", () => {
    const script = `CIRCLE
0,0
10
LINE
-10,0
10,0

-BLOCK
COLUMN
0,0
W
-20,-20
20,20

-INSERT
COLUMN
100,0
2

0
COPY
L

0,0
50,0

ERASE
150,0

`;
    const r = runScript(emptyDrawing("mm"), script);
    expect(r.errors).toEqual([]);
    expect(r.data.blocks?.map((b) => b.name)).toEqual(["COLUMN"]);
    const refs = ofType<InsertEntity>(r.data.entities, "insert");
    // Inserted at 100,0 (scale 2), copied 50 to the right, and the copy erased by picking it.
    expect(refs.map((e) => e.at.x)).toEqual([100]);
    expect(refs[0].scale).toEqual({ x: 2, y: 2 });
  });

  it("reports what it couldn't do", () => {
    const r = runScript(emptyDrawing("mm"), "FOO\nCIRCLE\n0,0\nabc\n");
    expect(r.errors.join(" ")).toMatch(/Unknown command "FOO"/);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});
