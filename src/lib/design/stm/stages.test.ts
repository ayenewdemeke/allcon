import { describe, expect, it } from "vitest";
import { BRIDGE_DEFAULTS, runBridge } from "../bridge/bridge";
import { capFromBridge } from "../bridge/loadpath";
import { nodeLpSolver } from "./lp-node";
import { designStm, stmInputs } from "./strut-tie";

// A pier cap built in two stages: the first-stage cap under the construction loads, then cap and
// diaphragm as one member under every load.

describe("a two-stage pier cap", async () => {
  const run = runBridge(BRIDGE_DEFAULTS);
  const cap = capFromBridge(BRIDGE_DEFAULTS, run, 1, stmInputs({}), ["g"], ["Girders"]);
  const r = await designStm(cap, nodeLpSolver);

  it("is staged at a continuous pier: the diaphragm from the cap's top to the deck's top", () => {
    expect(cap.stages?.enabled).toBe(true);
    const lp = run.layout.piers[1]!;
    // Deck over the cap less the cap's top: the bearing, girder and slab offset (2 in, 72 in, 10.5 in), and the grade.
    expect(cap.stages!.diaphragmHeight).toBeGreaterThan((2 + 72 + 10.5) / 12 - 0.05);
    expect(cap.stages!.diaphragmHeight).toBeLessThan((2 + 72 + 10.5) / 12 + 1);
    expect(lp.capTop).toBeGreaterThan(0);
  });

  it("designs both stages and reports each one's checks", () => {
    expect(r.stages).toBeTruthy();
    expect(r.checks.some((c) => c.name.startsWith("Construction: "))).toBe(true);
    expect(r.checks.some((c) => c.name.startsWith("Completed: "))).toBe(true);
    expect(r.checks.length).toBe(r.stages!.construction.checks.length + r.stages!.completed.checks.length);
  });

  it("loads the first-stage cap with DC1 alone, the completed member with everything", () => {
    const sum = (rr: NonNullable<typeof r.stages>["construction"]) => Math.max(...rr.cases.map((c) => c.loads.reduce((s, l) => s - l.fy, 0)));
    const c1 = sum(r.stages!.construction);
    const c2 = sum(r.stages!.completed);
    expect(c1).toBeGreaterThan(0);
    expect(c1).toBeLessThan(c2);
    expect(r.stages!.construction.cases.every((c) => c.name.startsWith("Construction"))).toBe(true);
  });

  it("makes the completed member the diaphragm's height deeper", () => {
    const depth = (o: [number, number][]) => Math.max(...o.map((p) => p[1])) - Math.min(...o.map((p) => p[1]));
    const d1 = depth(r.stages!.construction.outline.map(([x, y]) => [x / 12, y / 12] as [number, number]));
    const d2 = depth(r.stages!.completed.outline.map(([x, y]) => [x / 12, y / 12] as [number, number]));
    expect(d2 - d1).toBeCloseTo(cap.stages!.diaphragmHeight, 6);
  });
});
