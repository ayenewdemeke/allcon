import { describe, expect, it } from "vitest";
import { abutmentInputs } from "../foundations/kinds";
import { bearingText, deckElevation, horizontalElements, pointAt, profileAt, stationOffset, stationText, type Alignment } from "./alignment";
import { BRIDGE_DEFAULTS, bridgeLayout, girderInputsFor, runBridge, spanGroups, type BridgeInputs } from "./bridge";
import { bridgeInputs } from "./kinds";
import { abutmentFromBridge, designLanes, multiplePresence, unitLength } from "./loadpath";

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe("alignment (PGSuper's alignment, profile and crown)", () => {
  const a: Alignment = { refStation: 0, northing: 0, easting: 0, azimuth: 90, curves: [{ pi: 2000, radius: 1000, azimuth: 180 }] };
  it("a tangent runs along its azimuth", () => {
    const p = pointAt(a, 500);
    close(p.x, 500);
    close(p.y, 0);
  });
  it("a 90° curve right: T = R, Lc = πR/2, the PT a radius east and south of the PC", () => {
    const { details } = horizontalElements(a);
    close(details[0].T, 1000);
    close(details[0].Lc, (Math.PI * 1000) / 2);
    close(details[0].pc, 1000);
    const pt = pointAt(a, details[0].pt);
    close(pt.x, 2000, 1e-9);
    close(pt.y, -1000, 1e-9);
    close(pt.az, 180, 1e-9);
    // Past the PT, due south.
    const q = pointAt(a, details[0].pt + 100);
    close(q.x, 2000, 1e-9);
    close(q.y, -1100, 1e-9);
  });
  it("a point's station and offset round trip on the curve", () => {
    const s = 1500;
    const p = pointAt(a, s);
    const n = ((p.az + 90) * Math.PI) / 180;
    const x = p.x + 25 * Math.sin(n);
    const y = p.y + 25 * Math.cos(n);
    const so = stationOffset(a, x, y, s + 10);
    close(so.station, s, 1e-7);
    close(so.offset, 25, 1e-7);
  });
  it("a symmetric vertical curve: the middle ordinate (g2 − g1)·L/8 at the PVI, the grades at its ends", () => {
    const p = { station: 0, elevation: 100, grade: -2, curves: [{ pvi: 500, grade: 3, length: 400 }] };
    close(profileAt(p, 500).elevation, 100 - 10 + ((0.03 + 0.02) * 400) / 8);
    close(profileAt(p, 300).grade, -0.02);
    close(profileAt(p, 700).grade, 0.03);
    close(profileAt(p, 800).elevation, 90 + 0.03 * 300);
  });
  it("the crown: −2 % each way from the alignment", () => {
    const p = { station: 0, elevation: 100, grade: 0, curves: [] };
    close(deckElevation(p, { leftSlope: -0.02, rightSlope: -0.02, crownOffset: 0 }, 50, 10), 99.8);
    close(deckElevation(p, { leftSlope: -0.02, rightSlope: -0.02, crownOffset: 0 }, 50, -10), 99.8);
    close(deckElevation(p, { leftSlope: -0.02, rightSlope: -0.02, crownOffset: 6 }, 50, 10), 100 + 0.12 - 0.08);
  });
  it("bearings and stations read as a surveyor writes them", () => {
    expect(bearingText(45.5)).toBe(`N 45°30'00" E`);
    expect(bearingText(200)).toBe(`S 20°00'00" W`);
    expect(stationText(1234.5)).toBe("12+34.50");
  });
});

describe("the bridge's layout", () => {
  it("parallel skewed supports on a tangent: each girder spans the station difference less the bearing offsets over cos θ", () => {
    const b: BridgeInputs = { ...BRIDGE_DEFAULTS, profile: { station: 1000, elevation: 100, grade: 0, curves: [] }, supports: BRIDGE_DEFAULTS.supports.map((s) => ({ ...s, skew: 30 })) };
    const lay = bridgeLayout(b);
    const span = lay.spans[0];
    for (const g of span.girders) close(g.L, 122 - (2 * 1) / Math.cos(Math.PI / 6), 1e-6);
    expect(span.skew).toBe(30);
  });
  it("the seat elevation: the deck less the slab offset, the girder's depth and the bearing", () => {
    const b: BridgeInputs = { ...BRIDGE_DEFAULTS, profile: { station: 1000, elevation: 100, grade: 0, curves: [] }, roadway: { leftSlope: 0, rightSlope: 0, crownOffset: 0 } };
    const lay = bridgeLayout(b);
    const g = lay.spans[0].girders[0];
    close(g.start.deck, 100);
    close(g.start.seat, 100 - 10.5 / 12 - lay.depth / 12 - 1 / 12);
    close(g.ordinate, 0, 1e-9);
  });
  it("a sag curve's ordinate is negative (the haunch thins at midspan)", () => {
    const lay = bridgeLayout(BRIDGE_DEFAULTS);
    expect(lay.spans[0].girders[0].ordinate).toBeLessThan(0);
  });
  it("span groups: continuous across continuous piers, split at simple ones", () => {
    expect(spanGroups(BRIDGE_DEFAULTS)).toEqual([[0, 1]]);
    const b = { ...BRIDGE_DEFAULTS, supports: BRIDGE_DEFAULTS.supports.map((s, k) => (k === 1 ? { ...s, type: "simple-pier" as const } : s)) };
    expect(spanGroups(b)).toEqual([[0], [1]]);
  });
  it("the girder check's inputs from the layout: spans, spacing, overhang, haunch from the slab offset", () => {
    const b = BRIDGE_DEFAULTS;
    const lay = bridgeLayout(b);
    const g = girderInputsFor(b, lay, [0, 1]);
    close(g.L, lay.spans[0].L);
    expect(g.extraSpans.length).toBe(1);
    close(g.overhang, 23.5 - 2.5 * 8);
    close(g.haunch, 10.5 - 8.5);
    expect(g.nGirders).toBe(6);
  });
  it("saved inputs fill in from the defaults", () => {
    const b = bridgeInputs({ nGirders: 5, alignment: { azimuth: 45 } });
    expect(b.nGirders).toBe(5);
    expect(b.alignment.azimuth).toBe(45);
    expect(b.alignment.curves).toEqual([]);
    expect(b.supports.length).toBe(3);
  });
});

describe("the run and the load path", () => {
  const r = runBridge(BRIDGE_DEFAULTS);
  it("the default bridge's girder check passes", () => {
    const checks = r.groups.flatMap((g) => [...g.result.spans.flatMap((s) => [...s.interior.checks, ...s.exterior.checks]), ...g.result.piers.flatMap((p) => [...p.interior.checks, ...p.exterior.checks])]);
    expect(checks.filter((c) => !c.ok && !c.advisory).map((c) => c.id)).toEqual([]);
  });
  it("reactions: the abutments alike, the continuous pier carrying more than both ends' simple shares of the barrier and wearing surface", () => {
    close(r.reactions[0].DC, r.reactions[2].DC, 1e-3);
    expect(r.reactions[1].DC).toBeGreaterThan(r.reactions[0].DC);
    expect(r.reactions[1].LL).toBeGreaterThan(r.reactions[0].LL);
    expect(r.reactions[0].LLIM).toBeGreaterThan(r.reactions[0].LL);
  });
  it("lanes and multiple presence (3.6.1.1): 44 ft clear roadway → 3 lanes, 0.85", () => {
    expect(designLanes(BRIDGE_DEFAULTS)).toBe(3);
    expect(multiplePresence(3)).toBe(0.85);
  });
  it("an integral abutment's unit is the whole continuous bridge; a simple pier ends it", () => {
    expect(unitLength(BRIDGE_DEFAULTS, 0)).toBe(244);
    const b = { ...BRIDGE_DEFAULTS, supports: BRIDGE_DEFAULTS.supports.map((s, k) => (k === 1 ? { ...s, type: "simple-pier" as const } : s)) };
    expect(unitLength(b, 0)).toBe(122);
  });
  it("the abutment's bridge inputs from the run, its own details kept", () => {
    const before = { ...abutmentInputs({}), nPiles: 9, section: "HP14x89" };
    const a = abutmentFromBridge(BRIDGE_DEFAULTS, r, 0, before);
    expect(a.type).toBe("integral-piles");
    expect(a.unitLength).toBe(244);
    expect(a.nGirders).toBe(6);
    close(a.RDC, Math.round(r.reactions[0].DC * 10) / 10);
    expect(a.nPiles).toBe(9);
    expect(a.section).toBe("HP14x89");
    close(a.length, 47, 1e-9);
  });
});

describe("the pier's load path: Bridge → cap → column → footing", () => {
  it("a standard multicolumn cap rebuilt on the bridge's girders, the column from it, the footing from the column's base", async () => {
    const { stmInputs } = await import("../stm/strut-tie");
    const { buildTemplate, MULTICOLUMN_DEFAULTS } = await import("../stm/templates");
    const { columnInputs, designColumn } = await import("../piers/column");
    const { columnLinkFrom } = await import("../piers/column-link");
    const { footingInputs } = await import("../foundations/kinds");
    const { runFoundation } = await import("../foundations/run");
    const { capFromBridge, footingFromColumn } = await import("./loadpath");
    const r = runBridge(BRIDGE_DEFAULTS);
    const cap = capFromBridge(BRIDGE_DEFAULTS, r, 1, buildTemplate(MULTICOLUMN_DEFAULTS, stmInputs({})), ["g"], ["Girders"]);
    // The Bridge's pier sets the cap (46 ft): six girders at 8 ft about its middle, 3 … 43 ft, each on a load node.
    expect(cap.template!.bearings.map((b) => b.x)).toEqual([3, 11, 19, 27, 35, 43]);
    expect(cap.girders!.loadNodes.length).toBe(6);
    expect(cap.girders!.back!.n).toBe(6);
    const link = columnLinkFrom("cap", "Cap", cap, new Map([["g", r.groups[0].inputs]]));
    expect(link.cases.length).toBeGreaterThan(0);
    const col = designColumn({ ...columnInputs({}), loads: "stm", link });
    const f = footingFromColumn(col, footingInputs({}));
    expect(f.cases.length).toBe(new Set(col.rows.filter((x) => x.where === "base").map((x) => x.case)).size);
    expect(Math.max(...f.cases.map((c) => c.P))).toBeGreaterThan(r.reactions[1].DC);
    expect(runFoundation("spread-footing", f).checks.length).toBeGreaterThan(0);
  });
});

describe("the pier from the Bridge (PGSuper's physical pier)", () => {
  it("the cap built from the pier's description, the column's height from the elevations, a Service I case down to the footing", async () => {
    const { stmInputs } = await import("../stm/strut-tie");
    const { columnInputs, designColumn } = await import("../piers/column");
    const { columnLinkFrom } = await import("../piers/column-link");
    const { footingInputs } = await import("../foundations/kinds");
    const { runFoundation } = await import("../foundations/run");
    const { capFromBridge, columnFromBridge, footingFromColumn } = await import("./loadpath");
    const r = runBridge(BRIDGE_DEFAULTS);
    const lp = r.layout.piers[1]!;
    expect(lp.columnsX).toEqual([5, 23, 41]);
    close(lp.soffit, lp.capTop - 4.5);
    close(lp.columnHeight, 20);
    // From nothing: the cap is made from the pier's description.
    const cap = capFromBridge(BRIDGE_DEFAULTS, r, 1, stmInputs({}), ["g"], ["Girders"]);
    expect(cap.template!.kind).toBe("multicolumn");
    expect(cap.template!.columns).toEqual([5, 23, 41]);
    expect(cap.template!.length).toBe(46);
    expect(cap.girders!.loadNodes.length).toBe(6);
    const link = columnLinkFrom("cap", "Cap", cap, new Map([["g", r.groups[0].inputs]]));
    expect(link.cases.some((c) => c.name.startsWith("Service I"))).toBe(true);
    const col = columnFromBridge(BRIDGE_DEFAULTS, r, 1, columnInputs({}), link);
    expect(col.height).toBe(20);
    expect(col.T).toBe(42);
    expect(col.loads).toBe("stm");
    const res = designColumn(col);
    // The Service row is reported but not held to the strength checks.
    expect(res.rows.some((x) => x.limit === "Service I")).toBe(true);
    expect(res.checks.some((c) => c.id.includes("Service"))).toBe(false);
    const f = footingFromColumn(res, footingInputs({}));
    expect(f.cases.some((c) => c.limit === "service")).toBe(true);
    const fr = runFoundation("spread-footing", f);
    expect(fr.checks.some((c) => c.id === "settlement")).toBe(true);
  });
  it("the approach slab and wingwall from the abutment", async () => {
    const { approachSlabFromBridge, wingwallFromBridge } = await import("./loadpath");
    const { approachSlabInputs, wingwallInputs } = await import("../kinds");
    const b = { ...BRIDGE_DEFAULTS, supports: BRIDGE_DEFAULTS.supports.map((s, k) => (k === 0 ? { ...s, skew: 15 } : s)) };
    const s = approachSlabFromBridge(b, 0, approachSlabInputs({}));
    expect(s.W).toBe(47);
    expect(s.roadway).toBe(44);
    expect(s.skew).toBe(15);
    const w = wingwallFromBridge(b, 0, abutmentInputs({}), wingwallInputs({}));
    expect(w.H).toBe(10);
    expect(w.A).toBe(3);
    expect(w.skew).toBe(15);
  });
});
