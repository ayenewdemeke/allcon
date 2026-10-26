import { describe, expect, it } from "vitest";
import { ACI, displayColor } from "./aci";
import { arcThrough, bounds, crossesBox, distanceTo, grips, insideBox, intersect, moveGrip, sweepOf } from "./geometry";
import { findSnap } from "./snaps";
import type { ArcEntity, CircleEntity, LineEntity, PolylineEntity } from "./types";

const props = { layer: "0", color: null, lineweight: -1, linetype: "ByLayer" };
const line = (ax: number, ay: number, bx: number, by: number, id = "l"): LineEntity => ({ ...props, id, type: "line", a: { x: ax, y: ay }, b: { x: bx, y: by } });
const circle = (x: number, y: number, r: number, id = "c"): CircleEntity => ({ ...props, id, type: "circle", center: { x, y }, radius: r });

describe("AutoCAD colours", () => {
  it("has the standard index", () => {
    expect(ACI[1]).toBe("#ff0000");
    expect(ACI[5]).toBe("#0000ff");
    expect(ACI[10]).toBe("#ff0000");
    expect(ACI[11]).toBe("#ff8080");
    expect(ACI[12]).toBe("#cc0000");
    expect(ACI[250]).toBe("#333333");
  });
  it("draws colour 7 black on light and white on dark", () => {
    expect(displayColor(7, false)).toBe("#000000");
    expect(displayColor(7, true)).toBe("#ffffff");
  });
});

describe("geometry", () => {
  it("measures distance to lines and circles", () => {
    expect(distanceTo(line(0, 0, 10, 0), { x: 5, y: 3 })).toBeCloseTo(3);
    expect(distanceTo(line(0, 0, 10, 0), { x: 13, y: 4 })).toBeCloseTo(5);
    expect(distanceTo(circle(0, 0, 5), { x: 8, y: 0 })).toBeCloseTo(3);
  });

  it("finds intersections", () => {
    const [p] = intersect({ kind: "seg", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }, { kind: "seg", a: { x: 0, y: 10 }, b: { x: 10, y: 0 } });
    expect(p).toEqual({ x: 5, y: 5 });
    const hits = intersect({ kind: "seg", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } }, { kind: "arc", c: { x: 0, y: 0 }, r: 5, start: 0, end: Math.PI * 2, full: true });
    expect(hits.map((h) => Math.round(h.x)).sort((a, b) => a - b)).toEqual([-5, 5]);
    // An upper half arc only meets the x axis at its ends... and a line above it twice.
    const upper = { kind: "arc" as const, c: { x: 0, y: 0 }, r: 5, start: 0, end: Math.PI, full: false };
    expect(intersect({ kind: "seg", a: { x: -10, y: -3 }, b: { x: 10, y: -3 } }, upper)).toHaveLength(0);
    expect(intersect({ kind: "seg", a: { x: -10, y: 3 }, b: { x: 10, y: 3 } }, upper)).toHaveLength(2);
  });

  it("makes an arc through three points, counter-clockwise", () => {
    const cw = arcThrough({ x: -5, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 0 })!; // drawn clockwise over the top
    expect(cw.radius).toBeCloseTo(5);
    expect(sweepOf(cw.start, cw.end)).toBeCloseTo(Math.PI);
    const arc: ArcEntity = { ...props, id: "a", type: "arc", ...cw };
    const box = bounds(arc);
    expect(box.maxY).toBeCloseTo(5); // the top quadrant is on the arc
    expect(box.minY).toBeCloseTo(0);
  });

  it("selects by window and crossing", () => {
    const l = line(2, 2, 8, 8);
    expect(insideBox(l, { minX: 0, minY: 0, maxX: 10, maxY: 10 })).toBe(true);
    expect(insideBox(l, { minX: 0, minY: 0, maxX: 5, maxY: 10 })).toBe(false);
    expect(crossesBox(l, { minX: 0, minY: 0, maxX: 5, maxY: 10 })).toBe(true);
    expect(crossesBox(l, { minX: 6, minY: 0, maxX: 10, maxY: 1 })).toBe(false);
    // A circle crossing a small window off its centre.
    expect(crossesBox(circle(0, 0, 5), { minX: 4, minY: -1, maxX: 6, maxY: 1 })).toBe(true);
    expect(crossesBox(circle(0, 0, 5), { minX: -1, minY: -1, maxX: 1, maxY: 1 })).toBe(false);
  });

  it("edits with grips", () => {
    const l = line(0, 0, 10, 0);
    const [start, middle] = grips(l);
    expect(moveGrip(l, start, { x: -5, y: 0 }).a).toEqual({ x: -5, y: 0 });
    expect(moveGrip(l, middle, { x: 5, y: 5 })).toMatchObject({ a: { x: 0, y: 5 }, b: { x: 10, y: 5 } });
    const pl: PolylineEntity = { ...props, id: "p", type: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], bulges: [0, 0, 0], closed: false };
    const segment = grips(pl).find((g) => g.kind === "segment" && g.index === 1)!;
    expect(moveGrip(pl, segment, { x: 15, y: 5 }).points).toEqual([{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 10 }]);
    const c = circle(0, 0, 5);
    expect(moveGrip(c, grips(c)[1], { x: 0, y: 8 }).radius).toBeCloseTo(8);
  });
});

describe("object snaps", () => {
  const kinds = new Set(["endpoint", "midpoint", "center", "intersection", "perpendicular"] as const);
  it("snap to the nearest point within the aperture", () => {
    expect(findSnap([line(0, 0, 10, 0)], { x: 0.4, y: 0.3 }, 1, kinds, null)).toEqual({ kind: "endpoint", point: { x: 0, y: 0 } });
    expect(findSnap([line(0, 0, 10, 0)], { x: 5.2, y: 0.2 }, 1, kinds, null)).toEqual({ kind: "midpoint", point: { x: 5, y: 0 } });
    expect(findSnap([line(0, 0, 10, 0)], { x: 3, y: 4 }, 1, kinds, null)).toBeNull();
  });
  it("offer a circle's centre from its edge", () => {
    expect(findSnap([circle(0, 0, 5)], { x: 3.6, y: 3.5 }, 1, kinds, null)?.kind).toBe("center");
  });
  it("find intersections", () => {
    const snap = findSnap([line(0, 0, 10, 10, "a"), line(0, 8, 12, 2, "b")], { x: 5.4, y: 5.3 }, 1, kinds, null);
    expect(snap?.kind).toBe("intersection");
    expect(snap?.point.x).toBeCloseTo(16 / 3);
  });
  it("find the perpendicular from the last point", () => {
    const snap = findSnap([line(0, 0, 10, 0)], { x: 4.2, y: 0.3 }, 1, new Set(["perpendicular"]), { x: 4, y: 7 });
    expect(snap?.kind).toBe("perpendicular");
    expect(snap?.point.x).toBeCloseTo(4);
  });
});
