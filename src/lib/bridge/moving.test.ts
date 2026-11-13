import { describe, expect, it } from "vitest";
import { continuousBeam } from "../design/girders/continuous";
import { analyzeBridge } from "./bridge";
import { BRIDGE_DEFAULTS, bridgeDefinition, supportsFor } from "./definition";
import { emptyModel, type Model } from "./model";
import { Grid, laneArrangements, laneEffect, loadedLanes, movingLoad, multiplePresence } from "./moving";
import { analyze } from "./solver";

// The moving load analysis: the vehicle engine on a single beam's influence lines against the
// girder design check's HL-93 envelopes (themselves held to PGSuper), then the grillage by statics.

const within = (ours: number, theirs: number, rel: number, label: string) => expect(Math.abs(ours - theirs), `${label}: ours ${ours.toFixed(2)}, reference ${theirs.toFixed(2)}`).toBeLessThanOrEqual(rel * Math.abs(theirs) + 0.5);

/** A beam of the spans given, on knife-edge supports, with its influence lines by unit loads every 2 ft and at the tenth points. */
function line(spans: number[]) {
  const m: Model = emptyModel();
  m.materials.push({ id: 1, name: "C", E: 576000, G: 240000, density: 0, alpha: 0 });
  m.sections.push({ id: 1, name: "S", A: 5, Asy: 0, Asz: 0, J: 1, Iy: 3, Iz: 1 });
  const xs = new Set<number>([0]);
  let x0 = 0;
  const supports = [0];
  for (const L of spans) {
    for (let k = 1; k <= 10; k++) xs.add(+(x0 + (L * k) / 10).toFixed(6));
    x0 += L;
    supports.push(x0);
  }
  const stations = [...xs].sort((a, b) => a - b);
  stations.forEach((x, k) => m.nodes.push({ id: k + 1, x, y: 0, z: 0 }));
  for (let k = 0; k < stations.length - 1; k++) m.elements.push({ id: k + 1, type: "beam", mat: 1, sec: 1, n1: k + 1, n2: k + 2 });
  supports.forEach((x, k) => m.supports.push({ node: stations.findIndex((s) => Math.abs(s - x) < 1e-6) + 1, fixed: [k === 0, true, true, true, false, false] }));
  const a = analyze(m);
  const total = x0;
  const pos = new Set<number>(stations);
  for (let x = 0; x <= total; x += 2) pos.add(x);
  const positions = [...pos].sort((p, q) => p - q);
  const grid = new Grid(positions);
  const want = { elements: m.elements.map((_, k) => k), links: [] };
  const eta = new Float32Array(12 * m.elements.length * positions.length);
  positions.forEach((X, j) => {
    let st = 0;
    while (st < stations.length - 2 && stations[st + 1] <= X) st++;
    const r = a.respond([{ case: "", kind: "point", element: st + 1, dir: "GZ", P: -1, a: X - stations[st] }], want);
    for (let q = 0; q < r.length; q++) eta[q * positions.length + j] = r[q];
  });
  /** The influence line's start for an element's end and component (Vz 2, My 4). */
  const at = (station: number, component: number) => {
    const el = Math.min(station, m.elements.length - 1);
    const end = station === m.elements.length ? 1 : 0;
    return (12 * el + 6 * end + component) * positions.length;
  };
  return { grid, eta, at, stations };
}

describe("HL-93 on influence lines, against the girder check's envelopes", () => {
  it("a 120 ft simple span: moment and shear at the tenth points (1%)", () => {
    const { grid, eta, at, stations } = line([120]);
    const ref = continuousBeam([120]);
    stations.slice(0, 6).forEach((x, k) => {
      const e = ref.liveEnvelope(0, x);
      if (k > 0) within(laneEffect(grid, eta, at(k, 4), 1, 0.33, false).value, e.Mpos, 0.01, `M+ at ${x}`);
      const v = Math.max(laneEffect(grid, eta, at(k, 2), 1, 0.33, false).value, -laneEffect(grid, eta, at(k, 2), -1, 0.33, false).value);
      within(v, e.V, 0.01, `V at ${x}`);
    });
  });

  it("two continuous spans, 100 and 120 ft: positive moments, and the pier's negative moment with two trucks (1.5%)", () => {
    const { grid, eta, at, stations } = line([100, 120]);
    const ref = continuousBeam([100, 120]);
    for (const k of [4, 5, 14, 15, 16]) {
      const s = k <= 10 ? 0 : 1;
      const x = stations[k] - (s ? 100 : 0);
      within(laneEffect(grid, eta, at(k, 4), 1, 0.33, false).value, ref.liveEnvelope(s, x).Mpos, 0.015, `M+ at ${stations[k]}`);
    }
    const pier = ref.liveEnvelope(0, 100);
    expect(pier.negGoverns).toMatch(/two trucks/);
    within(laneEffect(grid, eta, at(10, 4), -1, 0.33, true).value, pier.Mneg, 0.015, "M− at the pier");
    // One truck alone gives less there.
    expect(-laneEffect(grid, eta, at(10, 4), -1, 0.33, false).value).toBeLessThan(-pier.Mneg);
  });
});

describe("lanes and multiple presence", () => {
  it("factors 1.2, 1.0, 0.85, 0.65, and the lanes loaded are those that give the most", () => {
    expect([1, 2, 3, 4, 5].map(multiplePresence)).toEqual([1.2, 1.0, 0.85, 0.65, 0.65]);
    expect(loadedLanes([100, 90, 10], 1)).toMatchObject({ total: 190, lanes: [0, 1], m: 1 });
    expect(loadedLanes([100, 10, 5], 1)).toMatchObject({ total: 120, lanes: [0], m: 1.2 });
    expect(loadedLanes([100, 95, 90], 1).total).toBeCloseTo(0.85 * 285, 9);
    expect(loadedLanes([-50, 20, -60], -1)).toMatchObject({ total: -110, lanes: [2, 0] });
    expect(loadedLanes([-5, -3], 1).total).toBe(0);
  });
  it("a 44 ft roadway has three lanes, tried against either barrier and centered", () => {
    const { lines, arrangements } = laneArrangements(-22, 22);
    expect(arrangements.map((a) => a.length)).toEqual([3, 3, 3]);
    expect(arrangements[0].map((k) => lines[k])).toEqual([-17, -5, 7]); // trucks 2 ft clear of each lane's edge
    expect(arrangements[1].map((k) => lines[k])).toEqual([17, 5, -7]);
    expect(arrangements[2].map((k) => lines[k])).toEqual([-12, 0, 12]);
  });
});

describe("HL-93 on the bridge model", () => {
  const def = bridgeDefinition({ ...BRIDGE_DEFAULTS, spans: [100] });
  const a = analyzeBridge(def);
  const g = a.generated;
  const live = movingLoad(g, a.stage(2));
  /** The girders' elements starting at the station at x. */
  const girders = (x: number) => Array.from({ length: def.nGirders }, (_, k) => g.layout.girderElement(k, g.stations.findIndex((s) => Math.abs(s - x) < 1e-6)));

  it("a unit axle anywhere: the girders' moments at a section add up to the beam's (statics)", () => {
    const j = live.positions.findIndex((p) => Math.abs(p - 30) < 1e-6);
    for (let lane = 0; lane < live.lanes.length; lane++) {
      const sum = girders(50).reduce((s, id) => s + live.influence(lane, id, 0, "My")[j], 0); // at midspan, the axle at 30 ft
      expect(sum).toBeCloseTo((30 * 50) / 100, 3);
    }
  });

  it("an interior girder carries a share of a lane near AASHTO's distribution factor; the girders together carry the lanes", () => {
    const perLane = continuousBeam([100]).liveEnvelope(0, 50).Mpos;
    const each = girders(50).map((id) => live.at(id, 0, "My")!.max.value);
    const interior = each[2] / perLane;
    expect(interior).toBeGreaterThan(0.45);
    expect(interior).toBeLessThan(0.8); // Table 4.6.2.2.2b-1 gives 0.66 for this bridge, two lanes or more
    expect(each[0] / perLane).toBeGreaterThan(0.45);
    // Each girder's maximum is its own loading, so the sum is more than any one loading puts on the bridge (3 lanes × 0.85).
    expect(each.reduce((s, v) => s + v, 0)).toBeGreaterThan(3 * 0.85 * perLane * 0.98);
    // Symmetric bridge, symmetric results.
    expect(each[0]).toBeCloseTo(each[5], 0);
    expect(each[2]).toBeCloseTo(each[3], 0);
  });

  it("concurrent forces: at midspan's largest moment the shear is small; at the support's largest shear there is little moment", () => {
    const mid = live.at(girders(50)[2], 0, "My")!.max;
    expect(Math.abs(mid.concurrent.Vz)).toBeLessThan(40);
    expect(mid.concurrent.My).toBe(mid.value);
    const end = live.at(girders(0)[2], 0, "Vz")!.max;
    expect(end.value).toBeGreaterThan(60);
    expect(Math.abs(end.concurrent.My)).toBeLessThan(0.1 * mid.value);
  });

  it("bearings: every one is pressed down by some loading, and the exterior ones can lift a little", () => {
    for (const b of g.bearings) {
      const r = live.bearing(b.link);
      expect(r.max).toBeGreaterThan(40);
      expect(r.min).toBeLessThanOrEqual(0.001);
    }
  });

  it("two spans made continuous: hogging over the pier under two trucks, and the piers' members are followed", () => {
    const two = analyzeBridge(bridgeDefinition({ ...BRIDGE_DEFAULTS, spans: [100, 100], supports: supportsFor(2) }));
    const l2 = movingLoad(two.generated, two.stage(2));
    const atPier = l2.at(two.generated.layout.girderElement(2, two.generated.supportStations[1]), 0, "My")!;
    const perLane = continuousBeam([100, 100]).liveEnvelope(0, 100).Mneg;
    expect(atPier.min.value / perLane).toBeGreaterThan(0.4);
    expect(atPier.min.value / perLane).toBeLessThan(0.85);
    const column = two.generated.members.find((m) => m.kind === "column")!;
    const n = l2.at(column.elements[0], 0, "N")!;
    expect(n.min.value).toBeLessThan(-150); // compression
    expect(Math.abs(n.min.concurrent.My) + Math.abs(n.min.concurrent.Mz)).toBeGreaterThan(0);
  });
});

describe("combinations with live load", () => {
  it("Strength I is the permanent loads plus 1.75 times the live load's envelope; Strength IV has none", () => {
    const a = analyzeBridge(bridgeDefinition({ ...BRIDGE_DEFAULTS, spans: [100] }));
    const live = movingLoad(a.generated, a.stage(2));
    const m = a.generated.members.find((x) => x.id === "G3-S1")!;
    const mid = (s: ReturnType<typeof a.member>) => s.reduce((b, x) => (Math.abs(x.x - 50) < Math.abs(b.x - 50) ? x : b));
    const perm = mid(a.member(m, { kind: "combination", name: "Strength I" }, 1));
    const withLive = mid(a.member(m, { kind: "combination", name: "Strength I" }, 1, live));
    const ll = mid(a.member(m, { kind: "live" }, 1, live));
    expect(perm.max).toBeUndefined();
    expect(withLive.forces.My).toBeCloseTo(perm.forces.My, 6);
    expect(withLive.max!.My).toBeCloseTo(perm.forces.My + 1.75 * ll.max!.My, 3);
    expect(withLive.min!.My).toBeLessThanOrEqual(withLive.forces.My);
    expect(ll.max!.My).toBeGreaterThan(1000);
    expect(mid(a.member(m, { kind: "combination", name: "Strength IV" }, 1, live)).max).toBeUndefined();
    const b = a.bearings({ kind: "combination", name: "Service I" }, live)[0];
    expect(b.max!).toBeGreaterThan(b.vertical + 40);
  });
});
