import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pointAt } from "./alignment";
import { BRIDGE_DEFAULTS, runBridge, type BridgeInputs } from "./bridge";
import { bridgeIfc, earcut, meshVolume, type IfcElement } from "./ifc";

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const count = (els: IfcElement[], cls: string) => els.filter((e) => e.cls === cls).length;

describe("the Bridge as an IFC 4.3 model", () => {
  const m = bridgeIfc(BRIDGE_DEFAULTS, runBridge(BRIDGE_DEFAULTS));
  // ALLCON_DUMP_BRIDGE_IFC=path writes the description, for checking the Python writer (api/_bridge.py).
  if (process.env.ALLCON_DUMP_BRIDGE_IFC) writeFileSync(process.env.ALLCON_DUMP_BRIDGE_IFC, JSON.stringify(m));

  it("has a part for each support and the elements of a two-span bridge", () => {
    expect(m.parts.filter((p) => p.type === "ABUTMENT")).toHaveLength(2);
    expect(m.parts.filter((p) => p.type === "PIER")).toHaveLength(1);
    expect(count(m.elements, "IfcBeam")).toBe(12 + 2 + 1); // 6 girders × 2 spans, 2 end diaphragms, 1 pier cap
    expect(count(m.elements, "IfcBearing")).toBe(24);
    expect(count(m.elements, "IfcSlab")).toBe(2 + 2); // the deck per span, two approach slabs
    expect(count(m.elements, "IfcColumn")).toBe(3);
    expect(count(m.elements, "IfcPile")).toBe(24); // 12 H-piles under each integral abutment
  });

  it("places each element in a right-handed frame", () => {
    for (const e of m.elements) {
      expect(Math.abs(dot(e.xdir, e.zdir))).toBeLessThan(1e-6);
      expect(e.depth).toBeGreaterThan(0);
    }
  });

  it("puts the girders on their bearings, the slab offset under the deck's top", () => {
    const lay = runBridge(BRIDGE_DEFAULTS).layout;
    const deck = m.elements.find((e) => e.name === "Deck, span 1")!;
    if (deck.profile.kind !== "mesh") throw new Error("the deck is a surface solid");
    const pts = deck.profile.pts;
    for (const g of lay.spans[0].girders) {
      const e = m.elements.find((x) => x.name === `Girder ${g.k + 1}, span 1`)!;
      expect(e.depth).toBeGreaterThan(g.L); // bearing to bearing plus both end distances
      // The deck's top over the girder's start bearing (the nearest surface point) less the girder's top: the slab offset.
      const x = g.start.x - lay.supports[0].x;
      const y = g.start.y - lay.supports[0].y;
      const near = pts.slice(0, pts.length / 2).reduce((p, q) => (Math.hypot(q[0] - x, q[1] - y) < Math.hypot(p[0] - x, p[1] - y) ? q : p));
      expect(Math.hypot(near[0] - x, near[1] - y)).toBeLessThan(25);
      const girderTop = g.start.seat + lay.supports[0].bearingHeight / 12 + lay.depth / 12;
      expect(g.start.deck - girderTop).toBeCloseTo(BRIDGE_DEFAULTS.slabOffset / 12, 6);
    }
  });

  it("closes the deck: a positive volume by the divergence theorem", () => {
    const deck = m.elements.find((e) => e.name === "Deck, span 1")!;
    if (deck.profile.kind !== "mesh") throw new Error("mesh");
    const { pts, tris } = deck.profile;
    const vol = tris.reduce((v, [a, b, c]) => {
      const [p, q, r] = [pts[a], pts[b], pts[c]];
      return v + (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
    }, 0);
    const lay = runBridge(BRIDGE_DEFAULTS).layout;
    const plan = (BRIDGE_DEFAULTS.leftEdge + BRIDGE_DEFAULTS.rightEdge) * (lay.supports[1].station - lay.supports[0].station);
    expect(vol / (plan * (BRIDGE_DEFAULTS.deckT / 12))).toBeCloseTo(1, 3);
  });

  it("runs the alignment past both ends, with the profile's PVI", () => {
    expect(m.alignment.segments.map((g) => g.type)).toEqual(["LINE"]); // a tangent
    expect(m.alignment.vpoints).toHaveLength(3);
    expect(m.alignment.lengths).toHaveLength(1);
    expect(m.alignment.startStation).toBe(BRIDGE_DEFAULTS.supports[0].station - 100);
  });

  it("follows a curved alignment with skewed supports", () => {
    const b: BridgeInputs = {
      ...BRIDGE_DEFAULTS,
      alignment: { ...BRIDGE_DEFAULTS.alignment, curves: [{ pi: 1150, radius: 1000, azimuth: 80 }] },
      supports: BRIDGE_DEFAULTS.supports.map((s) => ({ ...s, skew: 15 })),
    };
    const c = bridgeIfc(b, runBridge(b));
    expect(c.alignment.segments.map((g) => g.type)).toEqual(["LINE", "CIRCULARARC", "LINE"]);
    expect(c.alignment.segments[1].r0).toBe(1000); // turning left: + in IFC
    expect(count(c.elements, "IfcBeam")).toBe(15);
  });
});

describe("a curved, superelevated, flared bridge as IFC", () => {
  const b: BridgeInputs = {
    ...BRIDGE_DEFAULTS,
    alignment: { ...BRIDGE_DEFAULTS.alignment, refStation: 800, curves: [{ pi: 1150, radius: 1200, azimuth: 105, spiralIn: 120, spiralOut: 120 }] },
    roadway: {
      ...BRIDGE_DEFAULTS.roadway,
      sections: [
        { station: 1000, leftSlope: -0.02, rightSlope: -0.02, crownOffset: 0 },
        { station: 1100, leftSlope: 0.06, rightSlope: -0.06, crownOffset: 0 },
      ],
    },
    rail: { type: "type10-mash", testLevel: "TL-5", steel: "A1035" },
    supports: BRIDGE_DEFAULTS.supports.map((s, k) => ({ ...s, skew: 10, spacing: k === 2 ? 7.5 : 8, ...(s.pier ? { pier: { ...s.pier, foundation: "pile-foundation" as const } } : {}) })),
  };
  const m = bridgeIfc(b, runBridge(b));
  if (process.env.ALLCON_DUMP_BRIDGE_IFC2) {
    // With the alignment sampled every foot, for checking IfcOpenShell's own evaluation of it.
    const lay = runBridge(b).layout;
    const s0 = m.alignment.startStation;
    const L = m.alignment.segments.reduce((a, g) => a + g.length, 0);
    const samples = Array.from({ length: Math.floor(L) + 1 }, (_, k) => {
      const p = pointAt(b.alignment, s0 + k);
      return [p.x - lay.supports[0].x, p.y - lay.supports[0].y];
    });
    writeFileSync(process.env.ALLCON_DUMP_BRIDGE_IFC2, JSON.stringify({ ...m, samples }));
  }

  it("lays the alignment out as line, clothoid, arc, clothoid, line", () => {
    expect(m.alignment.segments.map((g) => g.type)).toEqual(["LINE", "CLOTHOID", "CIRCULARARC", "CLOTHOID", "LINE"]);
    const [, inS, arc, outS] = m.alignment.segments;
    expect([inS.r0, inS.r1, arc.r0, outS.r0, outS.r1]).toEqual([0, -1200, -1200, -1200, 0]); // turning right: − in IFC
    expect(inS.length).toBeCloseTo(120, 6);
  });

  it("piles under the pier's footings, a deck that follows the superelevation", () => {
    expect(count(m.elements, "IfcPile")).toBeGreaterThan(24);
    const deck = m.elements.find((e) => e.name === "Deck, span 1")!;
    if (deck.profile.kind !== "mesh") throw new Error("mesh");
    // Across the deck at the pier end the right edge is lower than the left (6% falling right) by about width × 0.06.
    const zs = deck.profile.pts.slice(0, deck.profile.pts.length / 2).map((p) => p[2]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(47 * 0.05);
  });
});

describe("barriers and colours", () => {
  it("sweeps the bridge rail along both deck edges, a closed solid of the rail's section", () => {
    const b: BridgeInputs = { ...BRIDGE_DEFAULTS, rail: { type: "type9-4", testLevel: "TL-5", steel: "A1035" } };
    const m = bridgeIfc(b, runBridge(b));
    const rails = m.elements.filter((e) => e.cls === "IfcRailing");
    expect(rails).toHaveLength(4); // two edges × two spans
    const r = rails[0];
    if (r.profile.kind !== "mesh") throw new Error("mesh");
    // Volume ≈ the Type 9 section × the span: about 0.12 CY per foot (the worksheet's quantity, 8 in deck).
    const vol = meshVolume(r.profile.pts, r.profile.tris);
    const lay = runBridge(b).layout;
    const L = lay.supports[1].station - lay.supports[0].station;
    expect(vol / L / 27).toBeGreaterThan(0.1);
    expect(vol / L / 27).toBeLessThan(0.14);
  });

  it("adds the steel tubes of a curb-and-post rail", () => {
    const b: BridgeInputs = { ...BRIDGE_DEFAULTS, rail: { type: "type10-mash", testLevel: "TL-5", steel: "A1035" } };
    expect(bridgeIfc(b, runBridge(b)).elements.filter((e) => e.cls === "IfcRailing")).toHaveLength(4 + 8);
  });

  it("gives every element a colour", () => {
    const m = bridgeIfc(BRIDGE_DEFAULTS, runBridge(BRIDGE_DEFAULTS));
    expect(m.elements.every((e) => e.color && e.color.length === 3)).toBe(true);
  });

  it("triangulates a non-convex outline by ear clipping", () => {
    const L: [number, number][] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]];
    const t = earcut(L);
    expect(t).toHaveLength(4);
    const area = t.reduce((s, [a, b, c]) => s + Math.abs((L[b][0] - L[a][0]) * (L[c][1] - L[a][1]) - (L[c][0] - L[a][0]) * (L[b][1] - L[a][1])) / 2, 0);
    expect(area).toBeCloseTo(6, 9);
  });
});
