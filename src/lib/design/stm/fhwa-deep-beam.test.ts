import { describe, expect, it } from "vitest";
import { nodeLpSolver } from "./lp-node";
import { designStm, STM_DEFAULTS } from "./strut-tie";
import { buildTemplate, MULTICOLUMN_DEFAULTS, type StmTemplate } from "./templates";

// Benchmark for the bent-cap template and the automatic nodal geometry: FHWA-NHI-17-071, Design
// Example 1, the simply supported deep beam (a span between two supports, as in a bent cap), with
// its direct-strut model: 72 in deep, 48 in wide, f'c 5 ksi, two 600 kip loads 108 in (1.5h) from
// the bearings' centerlines, bearings 1 ft from the ends, 14 in bearing plates (as revised in the
// example), the top node 3 in down and the bottom tie 5 in up (ha = 10 in), 16 #10 bottom bars.
// The example's values: CF = 1,177 kip at 30.7°, BC = EF = 1,013 kip; node F's strut interface
// 12.3 in with 1,239 kip resistance; node F's 6 in back face short of 1,013 kip (the example adds
// bars to the top strut); Vcr = 0.0632 √f'c b d at a/d = 1.61; the tie's anchorage measured from
// the critical section where the strut's edge crosses the bars (Figure 1-21).

const t: StmTemplate = {
  ...MULTICOLUMN_DEFAULTS,
  length: 29,
  depth: 6,
  tipDepth: 6,
  capWidth: 48,
  columns: [1, 28],
  columnWidth: 14 / 12,
  topCover: 3,
  bottomCover: 5,
  bearings: [{ x: 10, P: 600 }, { x: 19, P: 600 }],
  bearingLength: 14,
  bearingWidth: 48,
  topBars: { size: 8, count: 6 },
  bottomBars: { size: 10, count: 16 },
  stirrups: { size: 5, legs: 4, spacing: 8 },
  sideCover: 2,
  barEnds: "hook",
};
const inputs = (() => {
  const m = buildTemplate(t, { ...STM_DEFAULTS, fc: 5, fy: 60, girders: null, grid: { provided: true, Av: 1.24, sv: 8, Ah: 1.76, sh: 12, d: 67 } });
  return { ...m, service: { check: true, V: 400, a: 108, d: 67 } };
})();

describe("FHWA Design Example 1 (deep beam) through the bent-cap template", () => {
  it("finds the direct-strut model's forces", async () => {
    const r = await designStm(inputs, nodeLpSolver);
    const theta = (Math.atan2(64, 108) * 180) / Math.PI;
    expect(theta).toBeCloseTo(30.65, 1);
    const strut = r.members.filter((m) => m.compression > 0 && m.key.includes("C")); // the direct struts to the bearings
    expect(strut.length).toBe(2);
    for (const s of strut) expect(s.compression).toBeCloseTo(600 / Math.sin((theta * Math.PI) / 180), 0); // 1,177 kip
    expect(Math.max(...r.members.map((m) => m.tension))).toBeCloseTo(600 / Math.tan((theta * Math.PI) / 180), 0); // 1,013 kip
    for (const s of r.supportReport.filter((x) => x.direction === "y")) expect(s.reactions[0]).toBeCloseTo(600, 3);
  });

  it("works out node F's faces as the example does, and flags its back face", async () => {
    const r = await designStm(inputs, nodeLpSolver);
    const top = r.labels.find((l, n) => l.startsWith("T") && Math.abs(r.nodes[n][0] - 228) < 1)!; // the load at 19 ft: FHWA's node F
    const iface = r.faces.find((f) => f.node === top && f.type === "interface")!;
    expect(iface.width).toBeCloseTo(12.3, 1); // 14 sin θ + a cos θ
    expect(iface.thickness).toBe(48);
    expect(iface.nodeType).toBe("CCC");
    expect(iface.nu).toBeCloseTo(0.6, 9);
    expect(iface.capacity).toBeCloseTo(1239, -1);
    expect(iface.ok).toBe(true);
    // The back face of a CCC node: the compression block a = As fy / (0.85 f'c b) = 16(1.27)(60)/(0.85·5·48) = 5.98 in
    // (the example rounds it to 6 in), 5.8.2.5.2.
    const back = r.faces.find((f) => f.node === top && f.type === "back")!;
    expect(back.width).toBeCloseTo((16 * 1.27 * 60) / (0.85 * 5 * 48), 9);
    expect(back.demand).toBeCloseTo(1013, 0);
    // The concrete alone is short (about 853 kip against 1,013), as the example finds; its fix, 6 #8 bars in the top
    // strut, augments the face by their yield (5.8.2.5.1) and it passes.
    const concrete = back.capacity - 0.7 * (back.steel ?? 0);
    expect(concrete).toBeCloseTo(0.7 * 0.85 * 5 * back.width * 48, 6);
    expect(concrete).toBeLessThan(back.demand);
    expect(back.steel).toBeCloseTo(6 * 0.79 * 60, 9);
    expect(back.ok).toBe(true);
    const bearing = r.faces.find((f) => f.node === top && f.source === "external")!;
    expect(bearing.m).toBe(1); // the bearing spans the beam's width
  });

  it("works out node C's faces (CCT over the bearing)", async () => {
    const r = await designStm(inputs, nodeLpSolver);
    const c = r.labels.find((l, n) => l.startsWith("C") && Math.abs(r.nodes[n][0] - 336) < 1)!;
    const iface = r.faces.find((f) => f.node === c && f.type === "interface")!;
    const s = Math.sin(Math.atan2(64, 108));
    expect(iface.width).toBeCloseTo(14 * s + 10 * Math.cos(Math.atan2(64, 108)), 3); // 15.7 in (nodes are held to 0.0001 ft)
    expect(iface.nodeType).toBe("CCT");
    expect(iface.ok).toBe(true);
    const bearing = r.faces.find((f) => f.node === c && f.type === "bearing")!;
    expect(bearing.nu).toBe(0.7);
    expect(bearing.capacity).toBeCloseTo(0.7 * 0.7 * 5 * 14 * 48, 6);
  });

  it("measures the tie's anchorage from the critical section of Figure 1-21", async () => {
    const r = await designStm(inputs, nodeLpSolver);
    const ends = r.ties.flatMap((x) => x.ends);
    expect(ends.length).toBe(2); // one at each bearing; the bars continue between
    // 12 in from the bearing's centerline to the end, less 2 in cover, plus lb/2 + (ha/2) cot θ = 7 + 8.4 in: 25.4 in, as in Figure 1-21.
    for (const e of ends) expect(e.available).toBeCloseTo(10 + 7 + 5 / Math.tan(Math.atan2(64, 108)), 1);
    // The hook's length differs by edition: the example (8th Edition) needs 20 in, crediting the excess steel (λer = 0.92);
    // the 10th Edition's unified length for the tie's full yield (λer = 1) is 25.9 in, half an inch more than is available.
    for (const e of ends) {
      expect(e.kind).toBe("hook");
      expect(e.required).toBeCloseTo(25.9, 1);
      expect(e.ok).toBe(false);
    }
  });

  it("struts and nodal zones fit; the bars fit in two layers; the diagonal-cracking screen", async () => {
    const r = await designStm(inputs, nodeLpSolver);
    expect(r.coverage.filter((c) => c.group === "strut").every((c) => c.status === "pass")).toBe(true);
    expect(r.coverage.filter((c) => c.item.startsWith("Nodal zone")).every((c) => c.status === "pass")).toBe(true);
    expect(r.checks.find((c) => c.id === "fit-bottom")!.name).toContain("2 layers");
    expect(r.checks.find((c) => c.id === "fit-bottom")!.ok).toBe(true);
    expect(r.service!.Vcr).toBeCloseTo(0.0632 * Math.sqrt(5) * 48 * 67, 6); // 455 kip against 400
    expect(r.service!.ok).toBe(true);
  });
});
