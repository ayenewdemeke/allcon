import { describe, expect, it } from "vitest";
import { StmSketch } from "@/components/design/stm-sketch";
import { svgMarkup } from "../figures";
import { girderInputs } from "../kinds";
import { girderSide, type GirderLink } from "./cap-loads";
import { nodeLpSolver } from "./lp-node";
import { optimize } from "./optimizer";
import { designStm, STM_DEFAULTS, type StmInputs } from "./strut-tie";
import { buildTemplate, HAMMERHEAD_DEFAULTS } from "./templates";

// Case-by-case results, the nonsimultaneous envelope, supports and reactions, the column's
// boundary assumption, and check coverage. The six-girder hammerhead here is an illustrative
// example (the template's defaults with a girder design's defaults), not a project design.

const g = girderInputs({});
const link: GirderLink = { enabled: true, back: girderSide({ ...g, nGirders: 6, S: 8, overhang: 3.5, barrierWidth: 1.5 }, 0, "b", "Illustrative girders"), ahead: null, x0: 21.5, reverse: false, loadNodes: [], selfWeight: true, soffit: 0, wc: 0.15 };
const sixGirderExample: StmInputs = buildTemplate({ ...HAMMERHEAD_DEFAULTS, length: 43, bearings: [1.5, 9.5, 17.5, 25.5, 33.5, 41.5].map((x) => ({ x, P: 0 })) }, { ...STM_DEFAULTS, fc: 4.5, girders: link });

describe("case-by-case results", () => {
  it("each case is in equilibrium, checked apart from the solver (nodal, force and moment)", async () => {
    const r = await designStm(sixGirderExample, nodeLpSolver);
    expect(r.perCase.length).toBe(r.cases.length);
    for (const p of r.perCase) {
      expect(p.equilibrium.ok).toBe(true);
      expect(p.equilibrium.nodal).toBeLessThan(1e-6);
      expect(Math.abs(p.equilibrium.Fy)).toBeLessThan(1e-6);
      expect(Math.abs(p.equilibrium.M)).toBeLessThan(1e-4);
      // The reactions carry the case's whole load.
      expect(p.reactions.reduce((s, v, k) => s + (r.supportReport[k].direction === "y" ? v : 0), 0)).toBeCloseTo(p.applied, 6);
    }
    expect(r.status.equilibrium).toBe(true);
  });

  it("the envelope keeps tension and compression apart, each with the case it comes from", async () => {
    const r = await designStm(sixGirderExample, nodeLpSolver);
    for (const m of r.members.filter((x) => x.active)) {
      if (m.tension > 0) expect(r.forces[m.tensionCase!][r.members.indexOf(m)]).toBeCloseTo(m.tension, 9);
      if (m.compression > 0) expect(r.forces[m.compressionCase!][r.members.indexOf(m)]).toBeCloseTo(-m.compression, 9);
    }
    // The maxima come from more than one case: the envelope is not one state of equilibrium.
    const governing = new Set(r.members.filter((m) => m.active).flatMap((m) => [m.tensionCase, m.compressionCase]).filter((c) => c !== null));
    expect(governing.size).toBeGreaterThan(1);
  });

  it("angles are checked case by case", async () => {
    const r = await designStm(sixGirderExample, nodeLpSolver);
    expect(r.perCase.every((p) => p.smallestAngle !== null && p.smallestAngle > 25)).toBe(true);
    expect(r.status.angles).toBe(r.perCase.every((p) => p.angleOk));
  });

  it("reports each support's restraint and its reaction in every case", async () => {
    const r = await designStm(sixGirderExample, nodeLpSolver);
    expect(r.supportReport.map((s) => `${s.node}:${s.direction}`)).toEqual(r.supports.map(([n, a]) => `${r.labels[n]}:${a === 0 ? "x" : "y"}`));
    for (const s of r.supportReport) expect(s.reactions.length).toBe(r.cases.length);
  });
});

describe("check coverage: a missing check is never a pass", () => {
  it("names what isn't checked, and why", async () => {
    // A model drawn by hand, with the geometry entered: what isn't given stays open.
    const r = await designStm({ ...sixGirderExample, nodeGeometry: "entered" }, nodeLpSolver);
    const by = (s: string) => r.coverage.filter((c) => c.status === s);
    // No anchorage is given, so the ends where bars stop are missing input, not passes.
    expect(by("missing-input").some((c) => c.group === "anchorage")).toBe(true);
    expect(r.coverage.filter((c) => c.group === "anchorage").every((c) => c.status !== "pass")).toBe(true);
    // Strut widths and finite nodal zones aren't worked out.
    expect(r.coverage.filter((c) => c.group === "strut").every((c) => c.status === "not-implemented")).toBe(true);
    expect(r.status.finiteGeometry).toBe("not-implemented");
    // Every tie in tension is covered, with its governing case.
    for (const m of r.members.filter((x) => x.tension > 0)) expect(r.coverage.some((c) => c.item === `Tie ${m.key}`)).toBe(true);
  });

  it("a standard cap's geometry is worked out: every strut, node and anchorage is checked or exempt with a reason", async () => {
    const r = await designStm(sixGirderExample, nodeLpSolver);
    expect(r.status.finiteGeometry === "pass" || r.status.finiteGeometry === "fail").toBe(true);
    // No anchorage is left without input: each end is checked, or continues, or is column bars or stirrups.
    expect(r.coverage.filter((c) => c.group === "anchorage").every((c) => c.status !== "missing-input")).toBe(true);
    expect(r.coverage.filter((c) => c.group === "anchorage" && c.status === "not-required").every((c) => c.detail.length > 20)).toBe(true);
    // Every strut's width and fit is evaluated; every node is checked, or smeared or curved-bar with the reason.
    expect(r.coverage.filter((c) => c.group === "strut").every((c) => c.status === "pass" || c.status === "fail" || (c.status === "not-required" && c.detail.includes("smeared")))).toBe(true);
    expect(r.coverage.filter((c) => c.group === "node" && c.status === "not-required").every((c) => /smeared|curved-bar/.test(c.detail))).toBe(true);
    // Each node face carries its width, thickness and basis.
    for (const f of r.faces) expect(f.basis && f.thickness > 0 && f.width > 0).toBeTruthy();
  });

  it("an anchorage that is given is checked and reported", async () => {
    const r = await designStm(STM_DEFAULTS, nodeLpSolver);
    expect(r.coverage.find((c) => c.item === "Anchorage of tie B-C at C")!.status).toBe("pass");
  });
});

describe("anchorage of the column bars, and what would fix a short anchorage", () => {
  it("a hammerhead's column bars develop up into the cap where it continues past the column", async () => {
    const r = await designStm(sixGirderExample, nodeLpSolver);
    const col = r.coverage.filter((c) => c.group === "anchorage" && c.detail.includes("column's bars run up into the cap"));
    expect(col.length).toBeGreaterThan(0);
    for (const c of col) expect(c.status === "pass" || c.status === "fail").toBe(true);
    // A short anchorage names its fixes: headed bars, smaller bars of the same area, or more length.
    for (const c of r.coverage.filter((x) => x.group === "anchorage" && x.status === "fail")) expect(c.detail).toMatch(/Options:.*headed.*by \d/);
  });

  it("at a cap's corner the bars bend round it (the least bend); the curved-bar node stays open for review", async () => {
    // The column's face at the cap's left end, as in a cantilever bent.
    const corner = buildTemplate({ ...HAMMERHEAD_DEFAULTS, length: 30, columns: [3], bearings: [{ x: 3, P: 500 }, { x: 14, P: 600 }, { x: 24, P: 600 }], direction: "right" }, { ...STM_DEFAULTS, girders: null });
    const r = await designStm(corner, nodeLpSolver);
    const bend = r.coverage.find((c) => c.group === "anchorage" && c.detail.includes("around the cap's corner"));
    expect(bend?.status).toBe("not-required");
    expect(bend?.detail).toMatch(/Table 5\.10\.2\.3-1/);
    // The 10th Edition doesn't cover curved-bar nodes (C5.8.2.2): not a pass, not exempt.
    const node = r.coverage.find((c) => c.group === "node" && c.detail.includes("curved-bar node"));
    expect(node?.status).toBe("not-checked");
  });
});

describe("wind across the bridge (Strength III and V) through the model", () => {
  it("the cases with wind stay in equilibrium, horizontal loads included", async () => {
    const site = { V: 115, exposure: "C" as const, Z: 40, barrierHeight: 2.67 };
    const back = girderSide({ ...g, nGirders: 6, S: 8, overhang: 3.5, barrierWidth: 1.5, site }, 0, "b", "Illustrative girders");
    const r = await designStm({ ...sixGirderExample, girders: { ...sixGirderExample.girders!, back, wind: { enabled: true } } }, nodeLpSolver);
    const windy = r.perCase.filter((p) => /Strength (III|V) /.test(p.name));
    expect(windy.length).toBeGreaterThan(0);
    for (const p of windy) expect(p.equilibrium.ok).toBe(true);
    expect(r.coverage.find((c) => c.item === "Wind on the superstructure")!.status).toBe("pass");
    // Without wind, it's named as needing input.
    const calm = await designStm(sixGirderExample, nodeLpSolver);
    expect(calm.coverage.find((c) => c.item === "Wind on the superstructure")!.status).toBe("missing-input");
  });
});

describe("the column's boundary below the cap", () => {
  it("target reactions: met exactly where statics allows", async () => {
    // A bar resting on three vertical supports: statics leaves one reaction free, so a target distribution can be met.
    const nodes: [number, number][] = [[0, 10], [-10, 0], [0, 0], [10, 0]];
    const members: [number, number][] = [[0, 1], [0, 2], [0, 3]];
    // Both outer supports pinned (the inclined members need their horizontal reactions).
    const supports: [number, number][] = [[1, 0], [1, 1], [2, 1], [3, 0], [3, 1]];
    const loads = [[[0, -90], [0, 0], [0, 0], [0, 0]] as [number, number][]];
    const free = await optimize(nodes, members, supports, loads, nodeLpSolver, 30, 2);
    if (!free.ok) throw new Error(free.message);
    const r = await optimize(nodes, members, supports, loads, nodeLpSolver, 30, 2, [], [], [[null, 30, 30, null, 30]]);
    if (!r.ok) throw new Error(r.message);
    expect([r.reactions[0][1], r.reactions[0][2], r.reactions[0][4]]).toEqual([expect.closeTo(30, 4), expect.closeTo(30, 4), expect.closeTo(30, 4)]);
    expect(r.deviation).toBeLessThan(1e-5);
    // Unachievable targets: met as nearly as statics allows, and the departure reported.
    const far = await optimize(nodes, members, supports, loads, nodeLpSolver, 30, 2, [], [], [[null, 100, 100, null, 100]]);
    if (!far.ok) throw new Error(far.message);
    expect(far.deviation).toBeCloseTo(210, 6); // the reactions can only total 90 kip
    expect(free.deviation).toBe(0);
  });

  it("linear-stress boundary: targets carry each case's load, equilibrium holds, the departure is reported", async () => {
    const r = await designStm({ ...sixGirderExample, columnBoundary: "linear-stress" }, nodeLpSolver);
    expect(r.boundary.kind).toBe("linear-stress");
    expect(r.boundary.deviation).toBeGreaterThanOrEqual(0);
    r.perCase.forEach((p, c) => {
      expect(p.equilibrium.ok).toBe(true);
      const sum = r.supportReport.reduce((s, sp) => s + (sp.target?.[c] ?? 0), 0);
      expect(sum).toBeCloseTo(p.applied, 6);
    });
    // The default leaves the reactions to statics.
    const free = await designStm(sixGirderExample, nodeLpSolver);
    expect(free.boundary.kind).toBe("solver");
    expect(free.supportReport.every((s) => s.target === null)).toBe(true);
  });
});

describe("plots", () => {
  it("one case is labeled as that case, with its equilibrium; the envelope as nonsimultaneous", async () => {
    const r = await designStm(sixGirderExample, nodeLpSolver);
    const one = svgMarkup(StmSketch({ result: r, view: { case: 0 } }));
    const env = svgMarkup(StmSketch({ result: r, view: "envelope" }));
    expect(one).toContain(`Case 1 of ${r.cases.length}`);
    expect(one).toContain("In equilibrium (residual");
    expect(one).toContain("reactions");
    // One number per member; the governing cases are on hover.
    expect(env).not.toContain("(c1)");
    expect(env).toContain("(case ");
    expect(env).toContain("nonsimultaneous");
    expect(env).toContain("not one equilibrium state");
  });
});
