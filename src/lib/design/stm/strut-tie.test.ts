import { describe, expect, it } from "vitest";
import { nodeLpSolver } from "./lp-node";
import { designStm, STM_DEFAULTS, stmInputs, type StmInputs } from "./strut-tie";

// The defaults are a published worked example of a cantilever bent cap (strut-and-tie design to
// AASHTO LRFD, one Strength I load case, f'c = 6 ksi, fy = 60 ksi), rebuilt from its figure's
// dimensions to 0.01 ft. Its forces and node capacities are matched here; the documented
// differences (one interface 1.7% over its strength, and anchorage by the newer development
// equation) are checked to stay as they are.

const published: Record<string, number> = { "A-B": 1437, "B-C": 1573, "A-A'": 1664, "A-D": -2254, "B-D": -2017, "D-E": -1570, "C-E": -1783, "D-D'": -3751, "E-E'": -845 };

describe("strut-and-tie design: cantilever bent cap benchmark", () => {
  it("member forces within 2% of the worked example", async () => {
    const r = await designStm(STM_DEFAULTS, nodeLpSolver);
    for (const m of r.members) {
      const p = published[m.key];
      const ours = m.tension > m.compression ? m.tension : -m.compression;
      expect(Math.abs(ours - p) / Math.abs(p), m.key).toBeLessThan(0.02);
    }
    expect(r.stability.mechanisms).toBe(1); // the example's model rests on the concrete, not a stable truss
    expect(r.angles.ok).toBe(true);
    expect(r.angles.smallest!).toBeGreaterThan(25);
  });

  it("node faces, ties, grid, anchorage and the cracking screen", async () => {
    const r = await designStm(STM_DEFAULTS, nodeLpSolver);
    const eBearing = r.faces.find((f) => f.node === "E" && f.type === "bearing")!;
    const eBack = r.faces.find((f) => f.node === "E" && f.type === "back")!;
    const eInterface = r.faces.find((f) => f.node === "E" && f.type === "interface")!;
    expect(eBearing.capacity).toBeCloseTo(2570.4, 0);
    expect(eBack.capacity).toBeCloseTo(1679.3, 0);
    expect(eInterface.capacity).toBeCloseTo(1751.9, 0);
    expect(eInterface.ok).toBe(false); // 1.7% over: reported as a failure
    expect(eInterface.nodeType).toBe("CCC");
    const bInterface = r.faces.find((f) => f.node === "B" && f.type === "interface")!;
    expect(bInterface.nodeType).toBe("CCT");
    expect(bInterface.m).toBeCloseTo(1.992, 3);
    expect(Math.abs(bInterface.capacity - 10934) / 10934).toBeLessThan(0.01);
    const cInterface = r.faces.find((f) => f.node === "C" && f.type === "interface")!;
    expect(cInterface.m).toBe(2);
    expect(cInterface.capacity).toBeCloseTo(5257, -1);
    const bc = r.ties.find((t) => t.member === "B-C")!;
    expect(bc.ok).toBe(true);
    expect(bc.ends[0].required).toBeCloseTo(48.2, 1); // straight bars by Eq. 5.10.8.2.1a-2; 91.3 in available
    expect(bc.ends[0].ok).toBe(true);
    expect(r.grid).toBe(true);
    expect(r.service!.Vcr).toBeCloseTo(1439, -1);
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(["node-E-C-E-interface"]);
  });

  it("saved inputs round-trip, and a missing grid in a pier cap is reported", async () => {
    expect(stmInputs(JSON.parse(JSON.stringify(STM_DEFAULTS)))).toEqual(STM_DEFAULTS);
    expect(stmInputs({})).toEqual(STM_DEFAULTS);
    const noGrid: StmInputs = { ...STM_DEFAULTS, grid: { ...STM_DEFAULTS.grid, provided: false } };
    const r = await designStm(noGrid, nodeLpSolver);
    expect(r.warnings.some((w) => w.includes("5.8.2.6"))).toBe(true);
    expect(r.faces.every((f) => f.nu === 0.45)).toBe(true);
  });

  it("optimized layout on the same nodes, and bad inputs", async () => {
    const r = await designStm({ ...STM_DEFAULTS, layout: "optimized", ties: [], nodeChecks: [] }, nodeLpSolver);
    expect(r.objective).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.includes("optimization"))).toBe(true);
    await expect(designStm({ ...STM_DEFAULTS, members: [...STM_DEFAULTS.members, "A-Q"] }, nodeLpSolver)).rejects.toThrow(/doesn't join/);
    await expect(designStm({ ...STM_DEFAULTS, members: [...STM_DEFAULTS.members, "A-C"] }, nodeLpSolver)).rejects.toThrow(/runs through node B/);
    await expect(designStm({ ...STM_DEFAULTS, members: [...STM_DEFAULTS.members, "C-D"] }, nodeLpSolver)).resolves.toBeTruthy();
    await expect(designStm({ ...STM_DEFAULTS, supports: [] }, nodeLpSolver)).rejects.toThrow(/supports/);
  });
});
