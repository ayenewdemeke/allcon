import { describe, expect, it } from "vitest";
import { girderInputs } from "../kinds";
import { brakingPerLane, superstructureWind, windKz, windPressure } from "../girders/substructure-loads";
import { capLoadCases, girderSide, IM, laneReaction, leverShares, multiplePresence, type GirderLink } from "./cap-loads";
import { nodeLpSolver } from "./lp-node";
import { designStm, STM_DEFAULTS } from "./strut-tie";
import { buildTemplate, HAMMERHEAD_DEFAULTS } from "./templates";

// Loads on a pier cap from its girders: hand solutions for the lane's reaction, the lever rule and
// the dead load reactions, and a cap carried through the strut-and-tie design.

describe("live load at the pier (3.6.1.2, 3.6.1.3.1)", () => {
  it("one 100 ft simple span: the design truck with its rear axle on the pier", () => {
    const r = laneReaction(100, 0);
    expect(r.kind).toBe("design truck");
    expect(r.truck.back).toBeCloseTo((32 + 32 * 0.86 + 8 * 0.72) * (1 + IM));
    expect(r.truck.ahead).toBe(0);
    expect(r.lane.back).toBeCloseTo(32);
  });

  it("short span: the tandem governs", () => {
    const r = laneReaction(20, 0);
    expect(r.kind).toBe("design tandem");
    expect(r.truck.back).toBeCloseTo((25 + 25 * 0.8) * (1 + IM));
  });

  it("two 100 ft spans: the middle axle over the pier, or two trucks at 90%", () => {
    const r = laneReaction(100, 100);
    // One truck: 32 on the pier, 32 and 8 at 14 ft either side: 32 + 0.86(32 + 8) = 66.4 kip.
    const single = 66.4 * (1 + IM) + 64;
    const total = r.truck.back + r.truck.ahead + r.lane.back + r.lane.ahead;
    expect(total).toBeGreaterThanOrEqual(single - 1e-9);
    // Two trucks 50 ft apart (rear axle on the pier and the next truck's front 50 ft beyond) give more on long spans.
    const long = laneReaction(200, 200);
    expect(long.kind).toBe("two design trucks at 90%");
  });

  it("multiple presence", () => {
    expect([1, 2, 3, 4, 6].map(multiplePresence)).toEqual([1.2, 1, 0.85, 0.65, 0.65]);
  });
});

describe("lever rule across the girders", () => {
  const z = [-12, -4, 4, 12];
  it("over a girder, between girders and on the overhang", () => {
    expect(leverShares(z, -4)).toEqual([0, 1, 0, 0]);
    expect(leverShares(z, 0)).toEqual([0, 0.5, 0.5, 0]);
    const over = leverShares(z, -14); // 2 ft outside the exterior girder, 8 ft spacing
    expect(over[0]).toBeCloseTo(1.25);
    expect(over[1]).toBeCloseTo(-0.25);
    expect(over.reduce((s, v) => s + v, 0)).toBeCloseTo(1);
  });
});

describe("girder dead load reactions", () => {
  it("match the girder design's loads (w L / 2 per component)", () => {
    const g = girderInputs({});
    const s = girderSide(g, 0, "id", "Girders");
    expect(s.n).toBe(g.nGirders);
    expect(s.dc.exterior).toBeGreaterThan(0);
    expect(s.dc.interior).toBeGreaterThan(0);
    // DW: the wearing surface over the roadway, shared equally, over half the span.
    const roadway = (g.nGirders - 1) * g.S + 2 * g.overhang - 2 * g.barrierWidth;
    expect(s.dw.interior).toBeCloseTo((((g.fws / 1000) * roadway) / g.nGirders) * (g.L / 2));
  });
});

describe("girders made continuous over the pier (5.12.3.3)", () => {
  // Six girders at 7.2 ft (as D-11-Z's 6 CBT-54 alternative), on a 40 ft hammerhead with a node under each.
  const g = { ...girderInputs({}), nGirders: 6, S: 7.2, L: 100, extraSpans: [{ L: 100, strands: null, harped: null }], pierBearingOffset: 0 };
  const cap = buildTemplate({ ...HAMMERHEAD_DEFAULTS, bearings: [-18, -10.8, -3.6, 3.6, 10.8, 18].map((z) => ({ x: 20 + z, P: 0 })) }, STM_DEFAULTS);
  const tops = cap.nodes.filter((n) => n.label.startsWith("T")).map((n) => n.label);
  it("dead loads after continuity and the live load come from the continuous beam; the girders' own weight and the deck stay simple", () => {
    const back = girderSide(g, 0, "d", "Two spans", "end");
    const ahead = girderSide(g, 1, "d", "Two spans", "start");
    const simple = girderSide({ ...g, extraSpans: [] }, 0, "d", "One span", "end");
    // Two equal spans, uniform load: each span's end shear at the middle support is 5/8 wL (against wL/2 simple).
    const dwSimple = simple.dw.interior;
    expect(back.dw.interior).toBeCloseTo(dwSimple * 1.25, 6);
    expect(ahead.dw.interior).toBeCloseTo(dwSimple * 1.25, 6);
    // DC: the girder and deck as before; only the barriers and other DC2 gain the 1.25.
    expect(back.dc.interior).toBeGreaterThan(simple.dc.interior);
    // One lane's reaction: the continuous beam's influence line at the pier (it exceeds the simple spans' over two 100 ft spans).
    expect(back.liveContinuous?.pier).toBe(1);
    const l = back.liveContinuous!;
    const total = l.truck.back + l.truck.ahead + l.lane.back + l.lane.ahead;
    const s = laneReaction(100, 100);
    expect(total).toBeGreaterThan(s.truck.back + s.truck.ahead + s.lane.back + s.lane.ahead);
    // The lane load on both spans of a two-span beam: 1.25 × 0.64 × 100 = 80 kip at the pier, half each side.
    expect(l.lane.back + l.lane.ahead).toBeCloseTo(l.kind.includes("two") ? 0.9 * 80 : 80, 0);
    // Linked both sides: the cases use it.
    const c = capLoadCases({ enabled: true, back, ahead, x0: 20, reverse: false, loadNodes: tops, selfWeight: false, soffit: 0, wc: 0.15 }, cap.nodes, cap.outline, cap.b, 20);
    expect(c.lane.kind).toContain("continuous");
    expect(c.warnings.some((w) => w.includes("continuous over this pier"))).toBe(false);
  });
});

describe("a cap loaded from its girders", () => {
  const g = girderInputs({});
  const link = (over: Partial<GirderLink> = {}): GirderLink => ({
    enabled: true,
    back: girderSide({ ...g, nGirders: 4, S: 6, overhang: 3, barrierWidth: 1.5 }, 0, "b", "Back"),
    ahead: null,
    x0: 14.21,
    reverse: false,
    loadNodes: ["B", "C"],
    selfWeight: true,
    soffit: 0,
    wc: 0.15,
    ...over,
  });

  it("conserves the load: node loads equal the factored bearing loads and the cap's weight", () => {
    const l = link({ selfWeight: false });
    const c = capLoadCases(l, STM_DEFAULTS.nodes, STM_DEFAULTS.outline, STM_DEFAULTS.b, 8.6);
    expect(c.cases.length).toBeGreaterThan(1);
    expect(c.cases.length).toBeLessThanOrEqual(20);
    const s = l.back!;
    const dead = 2 * (1.25 * s.dc.exterior + 1.5 * s.dw.exterior) + 2 * (1.25 * s.dc.interior + 1.5 * s.dw.interior);
    // Every case carries at least the factored dead load (live load adds; the lever rule conserves it).
    for (const k of c.cases.filter((x) => !x.name.includes("minimum"))) {
      const total = -k.loads.reduce((t, x) => t + x.fy, 0);
      expect(total).toBeGreaterThan(dead);
    }
    const w = capLoadCases(link(), STM_DEFAULTS.nodes, STM_DEFAULTS.outline, STM_DEFAULTS.b, 8.6);
    expect(w.selfWeight).toBeGreaterThan(0);
  });

  it("girders placed off the cap (its centerline not set) are named, not loaded onto the end", () => {
    const l = { ...link({ selfWeight: false }), x0: 0 };
    expect(() => capLoadCases(l, STM_DEFAULTS.nodes, STM_DEFAULTS.outline, STM_DEFAULTS.b, 8.6)).toThrow(/off the cap.*Cap x at the bridge's centerline/);
  });

  it("Strength IV: the dead loads alone at 1.50 (Table 3.4.1-1)", () => {
    const l = link({ selfWeight: false });
    const c = capLoadCases(l, STM_DEFAULTS.nodes, STM_DEFAULTS.outline, STM_DEFAULTS.b, 8.6);
    const iv = c.cases.find((k) => k.name.startsWith("Strength IV"))!;
    const s = l.back!;
    const dead = 2 * 1.5 * (s.dc.exterior + s.dw.exterior) + 2 * 1.5 * (s.dc.interior + s.dw.interior);
    expect(-iv.loads.reduce((t, x) => t + x.fy, 0)).toBeCloseTo(dead, 9);
  });

  it("wind: Kz by exposure against Table C3.8.1.2.1-1; Strength V and Service I at Kz = 1 (Table C3.8.1.2.1-2)", () => {
    // Table C3.8.1.2.1-1 (Z ≤ 33, 50, 100, 300 ft).
    for (const [Z, B, C, D] of [[33, 0.71, 1.0, 1.15], [50, 0.81, 1.1, 1.25], [100, 0.98, 1.27, 1.41], [300, 1.3, 1.57, 1.68]])
      for (const [e, v] of [["B", B], ["C", C], ["D", D]] as const) expect(windKz(Z, e)).toBeCloseTo(v, 2);
    expect(windKz(10, "C")).toBe(windKz(33, "C")); // Z not less than 33 ft
    const site = { V: 115, exposure: "C" as const, Z: 50 };
    expect(windPressure("Strength III", site).PZ).toBeCloseTo(2.56e-6 * 115 ** 2 * windKz(50, "C") * 1.3, 12);
    expect(windPressure("Strength V", site).PZ).toBeCloseTo(0.0163 * 1.3, 3); // 0.0163 Cd (the table's rounding of 2.56×10⁻⁶ × 80²)
    expect(windPressure("Service I", site).PZ).toBeCloseTo(0.0125 * 1.3, 3); // 0.0125 Cd
    expect(windPressure("Strength V", site).PZ).toBeCloseTo(2.56e-6 * 80 ** 2 * 1.3, 12);
  });

  it("the superstructure's wind from the girder design: depth seen in elevation, line loads, heights", () => {
    const g = { ...girderInputs({}), site: { V: 115, exposure: "C" as const, Z: 40, barrierHeight: 2.67 } };
    const w = superstructureWind(g, g.site);
    expect(w.depth).toBeCloseTo(w.girderDepth + g.haunch / 12 + g.deckT / 12 + 2.67, 9);
    expect(w.arm).toBeCloseTo(w.depth / 2, 12);
    expect(w.armWL).toBeCloseTo(w.deckTop + 6, 12);
    expect(w.strengthIII!.line).toBeCloseTo(windPressure("Strength III", g.site).PZ * w.depth, 12);
    expect(superstructureWind(g, { ...g.site, V: 0 }).strengthIII).toBeNull();
  });

  it("braking (3.6.4): the greater of 25% of the truck's axles and 5% of the truck with the lane load", () => {
    expect(brakingPerLane(100).perLane).toBeCloseTo(18, 9); // 0.25 × 72
    expect(brakingPerLane(600).perLane).toBeCloseTo(0.05 * (72 + 0.64 * 600), 9);
  });

  it("Strength III and V: the wind's force across the cap, its overturning as a couple, the uplift on the deck", () => {
    const g = { ...girderInputs({}), nGirders: 4, S: 6, overhang: 3, barrierWidth: 1.5, site: { V: 115, exposure: "C" as const, Z: 40, barrierHeight: 2.67 } };
    const l = link({ selfWeight: false, wind: { enabled: true }, back: girderSide(g, 0, "b", "Back") });
    const c = capLoadCases(l, STM_DEFAULTS.nodes, STM_DEFAULTS.outline, STM_DEFAULTS.b, 8.6);
    expect(c.cases.length).toBeLessThanOrEqual(20);
    const s = l.back!;
    const trib = s.L / 2;
    const dead = 2 * (1.25 * s.dc.exterior + 1.5 * s.dw.exterior) + 2 * (1.25 * s.dc.interior + 1.5 * s.dw.interior);
    for (const d of [1, -1]) {
      const iii = c.cases.find((k) => k.name.startsWith("Strength III") && k.name.includes(d > 0 ? "larger" : "smaller"))!;
      // Across: the wind on half the span, toward its side.
      expect(iii.loads.reduce((t, x) => t + x.fx, 0)).toBeCloseTo(d * c.wind!.line3 * trib, 6);
      // Down: the dead loads less the deck's uplift (0.020 ksf over the deck's width and half the span).
      const deck = (s.n - 1) * s.S + 2 * s.overhang;
      expect(-iii.loads.reduce((t, x) => t + x.fy, 0)).toBeCloseTo(dead - 0.02 * deck * trib, 6);
      const v = c.cases.find((k) => k.name.startsWith("Strength V") && k.name.includes(d > 0 ? "larger" : "smaller"))!;
      expect(v.loads.reduce((t, x) => t + x.fx, 0)).toBeCloseTo(d * (c.wind!.line5 + 0.1) * trib, 6);
    }
    // Without the site's speed it's an error, not a silent zero.
    expect(() => capLoadCases(link({ wind: { enabled: true } }), STM_DEFAULTS.nodes, STM_DEFAULTS.outline, STM_DEFAULTS.b, 8.6)).toThrow(/wind speed/);
    // Service I's wind (70 mph) is carried into the arms' service shear.
    const calm = capLoadCases(link({ selfWeight: false, back: l.back }), STM_DEFAULTS.nodes, STM_DEFAULTS.outline, STM_DEFAULTS.b, 8.6, [{ x: 10, side: 1, label: "Right arm" }]);
    const windy = capLoadCases(l, STM_DEFAULTS.nodes, STM_DEFAULTS.outline, STM_DEFAULTS.b, 8.6, [{ x: 10, side: 1, label: "Right arm" }]);
    expect(windy.serviceShear[0].V).toBeGreaterThan(calm.serviceShear[0].V);
    // Braking: every lane one way with m, the most over the lane counts.
    expect(windy.braking).toBeCloseTo(Math.max(...Array.from({ length: windy.lanesMax }, (_, k) => (k + 1) * multiplePresence(k + 1) * l.back!.brakingPerLane!)), 9);
  });

  it("a bent's span: Service I shear at each column face as a simple span, less the load between centerline and face", () => {
    const l = link({ selfWeight: false });
    const span = { a: 0, b: 30, faceA: 1.5, faceB: 28.5, label: "Span 1" };
    const c = capLoadCases(l, STM_DEFAULTS.nodes, STM_DEFAULTS.outline, STM_DEFAULTS.b, 8.6, [], [span]);
    const [A, B] = c.serviceShear;
    const inSpan = c.bearings.filter((b) => b.x > 0 && b.x < 30);
    const deadA = inSpan.reduce((t, b) => t + (b.dc + b.dw) * (1 - b.x / 30), 0) - inSpan.filter((b) => b.x < 1.5).reduce((t, b) => t + b.dc + b.dw, 0);
    expect(A.label).toBe("Span 1, left face");
    expect(A.V).toBeGreaterThanOrEqual(deadA - 1e-9);
    expect(B.V).toBeGreaterThan(0);
    expect(A.a).toBeGreaterThanOrEqual(0);
    expect(A.a).toBeLessThanOrEqual(28.5 - 1.5);
  });

  it("Service I shear on an arm at a column face, with its shear span to the load resultant", () => {
    const l = link({ selfWeight: false });
    const face = 10; // ft: the girders beyond it load the arm
    const c = capLoadCases(l, STM_DEFAULTS.nodes, STM_DEFAULTS.outline, STM_DEFAULTS.b, 8.6, [{ x: face, side: 1, label: "Right arm" }]);
    const arm = c.serviceShear[0];
    const beyond = c.bearings.filter((b) => b.x > face);
    const dead = beyond.reduce((t, b) => t + b.dc + b.dw, 0);
    expect(arm.V).toBeGreaterThan(dead); // with the live load that loads the arm most
    expect(arm.lanes).toBeGreaterThan(0);
    // The shear span lies between the nearest and farthest girder on the arm.
    expect(arm.a).toBeGreaterThanOrEqual(Math.min(...beyond.map((b) => b.x)) - face - 1e-9);
    expect(arm.a).toBeLessThanOrEqual(Math.max(...beyond.map((b) => b.x)) - face + 1e-9);
  });

  it("runs through the strut-and-tie design", async () => {
    const r = await designStm({ ...STM_DEFAULTS, girders: link() }, nodeLpSolver);
    expect(r.capLoads).not.toBeNull();
    expect(r.cases.length).toBe(r.capLoads!.cases.length);
    expect(r.forces.length).toBe(r.cases.length);
    // The sketch shows each girder's reaction at its bearing: Strength I with its most live load.
    expect(r.appliedLoads.length).toBe(4);
    for (const l of r.capLoads!.bearingLoads) {
      expect(l.ll).toBeGreaterThan(0);
      expect(l.strength).toBeCloseTo(1.25 * l.dc + 1.5 * l.dw + 1.75 * l.ll);
    }
    expect(r.appliedLoads.map((l) => l.label)).toEqual(["G1", "G2", "G3", "G4"]);
  });
});
