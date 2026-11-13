import { describe, expect, it } from "vitest";
import { candidates, type Pt } from "./geometry";
import { nodeLpSolver } from "./lp-node";
import { angleScreen } from "./model";
import { optimize } from "./optimizer";
import { screen } from "./stability";

// The port against the Python solver's regression suite (benchmarks/test_solver.py): the same
// models give the same optimum objectives, mechanism counts and hand solutions.

const boundary: Pt[] = [[-144, 0], [144, 0], [144, 72], [-144, 72]];
const cases = (n: number): Pt[][] => [
  [[0, -100], [0, -100]],
  [[0, -100], [0, -150]],
  [[0, -150], [0, -100]],
].map((c) => [...(c as Pt[]), ...Array.from({ length: n - 2 }, () => [0, 0] as Pt)]);
const supports: [number, number][] = [[2, 0], [2, 1], [3, 1]];

async function run(nodes: Pt[], tension = 30, compression = 2, loads = cases(nodes.length)) {
  return optimize(nodes, candidates(nodes, boundary), supports, loads, nodeLpSolver, tension, compression, [1, 2]);
}

describe("strut-and-tie layout optimizer", () => {
  it("matches the compact pier cap: objective and a stable layout", async () => {
    const r = await run([[-120, 60], [120, 60], [-24, 0], [24, 0]]);
    if (!r.ok) throw new Error(r.message);
    expect(r.objective).toBeCloseTo(66984, 3);
    expect(r.stability.stable).toBe(true);
    expect(r.residual).toBeLessThan(1e-6);
    // As in the Python release: the compact layout fails the Article 5.8.2.2 angle limit.
    expect(angleScreen([[-120, 60], [120, 60], [-24, 0], [24, 0]], r.active, r.forces.map((f) => r.activeIndex.map((k) => f[k]))).ok).toBe(false);
  });

  it("matches the refined pier cap: objective, two mechanisms, scaling", async () => {
    const nodes: Pt[] = [[-120, 60], [120, 60], [-24, 0], [24, 0], [-72, 30], [0, 30], [72, 30], [0, 60]];
    const r = await run(nodes);
    if (!r.ok) throw new Error(r.message);
    expect(r.objective).toBeCloseTo(46184, 3);
    expect(r.stability.mechanisms).toBe(2);
    const doubled = await run(nodes, 60, 4);
    if (!doubled.ok) throw new Error(doubled.message);
    expect(doubled.objective).toBeCloseTo(r.objective / 2, 4);
    const scaled = await run(nodes, 30, 2, cases(nodes.length).map((c) => c.map(([x, y]) => [7 * x, 7 * y] as Pt)));
    if (!scaled.ok) throw new Error(scaled.message);
    expect(scaled.objective).toBeCloseTo(7 * r.objective, 2);
  });

  it("reports uplift on an upward-only support as infeasible", async () => {
    const nodes: Pt[] = [[-120, 60], [120, 60], [-24, 0], [24, 0], [-72, 30], [0, 30], [72, 30], [0, 60]];
    const loads = cases(nodes.length).slice(0, 1);
    loads[0][1] = [0, 200];
    const r = await run(nodes, 30, 2, loads);
    expect(r.ok).toBe(false);
  });

  it("shares envelopes across reversing cases (hand solution 120 in³)", async () => {
    const r = await optimize([[0, 0], [10, 0]], [[0, 1]], [[0, 0], [0, 1], [1, 1]], [[[0, 0], [10, 0]], [[0, 0], [-20, 0]]], nodeLpSolver, 5, 2);
    if (!r.ok) throw new Error(r.message);
    expect(r.tensionArea[0]).toBeCloseTo(2);
    expect(r.compressionArea[0]).toBeCloseTo(10);
    expect(r.objective).toBeCloseTo(120);
  });

  it("finds equilibrium yet flags the mechanism of a lone bar", async () => {
    const r = await optimize([[0, 0], [10, 0]], [[0, 1]], [[0, 0], [0, 1]], [[[0, 0], [10, 0]]], nodeLpSolver);
    if (!r.ok) throw new Error(r.message);
    expect(r.stability.stable).toBe(false);
    expect(r.stability.mechanisms).toBe(1);
  });

  it("screens a stable triangle and free bodies", () => {
    const nodes: Pt[] = [[0, 0], [10, 0], [5, 5]];
    expect(screen(nodes, [[0, 1], [0, 2], [1, 2]], [[0, 0], [0, 1], [1, 1]]).stable).toBe(true);
    expect(screen(nodes, [[0, 1], [0, 2]], [[0, 0], [0, 1], [1, 1]], [2]).stable).toBe(false);
    const four: Pt[] = [[0, 0], [10, 0], [5, 5], [20, 20]];
    expect(screen(four, [[0, 1], [0, 2], [1, 2]], []).mechanisms).toBe(3);
    expect(screen(four, [[0, 1], [0, 2], [1, 2]], [[0, 0], [0, 1], [1, 1]], [3]).mechanisms).toBe(2);
  });

  it("rejects invalid outlines and nodes", () => {
    const bad: Pt[][] = [
      [[0, 0], [10, 10], [0, 10], [10, 0]],
      [[0, 0], [10, 0], [20, 0]],
      [[0, 0], [10, 0], [10, 0], [0, 10]],
      [[0, 0], [10, 0], [5, 0], [0, 10]],
    ];
    for (const b of bad) expect(() => candidates([[1, 1], [9, 9]], b)).toThrow();
    expect(() => candidates([[1, 1], [9, 9]], [[0, 0], [10, 0], [10, 10], [0, 10]], [[[0, 1], [2, 1], [2, 2], [0, 2]]])).toThrow();
    expect(() => candidates([[0, 0], [0, 0]], [[0, 0], [10, 0], [10, 10], [0, 10]])).toThrow();
  });

  it("flags strut-tie pairs at or below 25 degrees", () => {
    expect(angleScreen([[0, 0], [10, 0], [10, 1]], [[0, 1], [0, 2]], [[10, -10]]).ok).toBe(false);
    expect(angleScreen([[0, 0], [10, 0], [0, 10]], [[0, 1], [0, 2]], [[10, -10]]).ok).toBe(true);
    const t = (25 * Math.PI) / 180;
    expect(angleScreen([[0, 0], [10, 0], [10 * Math.cos(t), 10 * Math.sin(t)]], [[0, 1], [0, 2]], [[10, -10]]).ok).toBe(false);
    // A chord changing from tie to strut straight through a node isn't a strut-tie angle...
    expect(angleScreen([[0, 0], [10, 0], [-10, 0]], [[0, 1], [0, 2]], [[10, -10]]).ok).toBe(true);
    // ...but a strut on the far side at 20° to the tie's line still is.
    const u = (160 * Math.PI) / 180;
    expect(angleScreen([[0, 0], [10, 0], [10 * Math.cos(u), 10 * Math.sin(u)]], [[0, 1], [0, 2]], [[10, -10]]).ok).toBe(false);
  });
});
