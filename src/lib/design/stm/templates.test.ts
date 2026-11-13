import { describe, expect, it } from "vitest";
import { girderInputs } from "../kinds";
import { girderSide, type GirderLink } from "./cap-loads";
import { nodeLpSolver } from "./lp-node";
import { designStm, STM_DEFAULTS, stmInputs } from "./strut-tie";
import { buildTemplate, HAMMERHEAD_DEFAULTS, MULTICOLUMN_DEFAULTS, type StmTemplate } from "./templates";

// Standard caps built as strut-and-tie models: valid geometry, every strut-tie angle over 25°,
// equilibrium with the bearing loads, and the load reaching the supports.

const total = (t: StmTemplate) => t.bearings.reduce((s, b) => s + b.P, 0);

describe("strut-and-tie templates", () => {
  for (const [name, t] of [
    ["hammerhead", HAMMERHEAD_DEFAULTS],
    ["tapered hammerhead with unequal arms", { ...HAMMERHEAD_DEFAULTS, columns: [16], bearings: [{ x: 2, P: 700 }, { x: 11, P: 650 }, { x: 24, P: 500 }, { x: 34, P: 400 }] }],
    ["multi-column bent cap", MULTICOLUMN_DEFAULTS],
    ["two-column bent cap", { ...MULTICOLUMN_DEFAULTS, length: 36, columns: [6, 30], bearings: [3, 11, 18, 25, 33].map((x) => ({ x, P: 300 })) }],
  ] as [string, StmTemplate][]) {
    it(`${name}: solves, angles over 25°, loads reach the supports`, async () => {
      const inputs = buildTemplate(t, STM_DEFAULTS);
      const r = await designStm(inputs, nodeLpSolver);
      expect(r.angles.ok).toBe(true);
      const down = r.supports.reduce((s, [, axis], k) => s + (axis === 1 ? r.reactions[0][k] : 0), 0);
      expect(down).toBeCloseTo(total(t), 6);
      // The ties the template proportions carry tension (top chord over the columns, stirrups in the cantilevers).
      expect(r.members.some((m) => m.role === "tie")).toBe(true);
      // The sketch's arrows: one per bearing, carrying its load.
      expect(r.appliedLoads.reduce((s, l) => s + l.P, 0)).toBeCloseTo(total(t), 6);
      // Saved and read back, the model and its template are unchanged.
      expect(stmInputs(JSON.parse(JSON.stringify(inputs)))).toEqual(inputs);
    });
  }

  it("direct struts where steep enough, panels with stirrup ties only farther out", () => {
    // Hammerhead: the bearing 13 ft out reaches the column directly; the one at 4 ft steps in with one stirrup tie.
    const h = buildTemplate(HAMMERHEAD_DEFAULTS, STM_DEFAULTS);
    const inner = h.cases[0].loads.find((l) => h.nodes.find((n) => n.label === l.node)!.x === 13)!.node;
    expect(h.members.some((m) => m.startsWith(`${inner}-C`) && m.endsWith(":strut"))).toBe(true);
    const stirrups = h.ties.filter((t) => t.barSize === HAMMERHEAD_DEFAULTS.stirrups.size && t.member.startsWith("M"));
    expect(stirrups.length).toBe(2); // one panel each side
    // Bent cap: one node per column; each bearing a direct strut to its near column, and (in a span)
    // a path to the far column too, stepping in by panels where a direct strut would be too flat.
    const b = buildTemplate(MULTICOLUMN_DEFAULTS, STM_DEFAULTS);
    expect(b.supports.map((s) => s.node)).toEqual(["C1", "C2", "C3"]);
    const at = (x: number) => b.nodes.find((n) => n.label.startsWith("T") && n.x === x)!.label;
    for (const [x, c] of [[4, "C1"], [13, "C1"], [22, "C2"], [34, "C2"], [43, "C3"], [52, "C3"]] as const) expect(b.members).toContain(`${at(x)}-${c}:strut`);
    // Panel points are shared: no two bottom nodes within a foot of each other.
    const bx = b.nodes.filter((n) => n.label.startsWith("M")).map((n) => n.x).sort((p, q) => p - q);
    bx.forEach((x, k) => k && expect(x - bx[k - 1]).toBeGreaterThan(1));
    expect(b.nodes.find((n) => n.label === "C2")!.x).toBe(28);
  });

  it("places a hammerhead's column struts as FHWA does (Design Example 2: nodes D, E and tie A–A′)", () => {
    // The worked example's cantilever bent: a 10 ft column under the cap's left end, P1 = 2005 kip over
    // the column, P2 = 926 kip on the cantilever. FHWA puts strut E 0.31 ft inside the right face (its
    // 0.64 ft trapezoid of stress, so a face about 7.5 in wide), D 2.17 ft left of it, and the tie at the
    // left face's bars, 8 in in.
    const t: StmTemplate = { ...HAMMERHEAD_DEFAULTS, length: 28.42, depth: 8.5, tipDepth: 8.5, capWidth: 96, columns: [5], columnWidth: 10, topCover: 5.16, bottomCover: 2.23, columnBarInset: 8, bearings: [{ x: 6.97, P: 2005 }, { x: 22.99, P: 926 }] };
    const m = buildTemplate(t, STM_DEFAULTS);
    const col = m.nodes.filter((n) => n.label.startsWith("C")).sort((p, q) => p.x - q.x);
    expect(col[1].x).toBeCloseTo(9.69, 1);
    expect(col[1].x - col[0].x).toBeCloseTo(2.17, 1);
    expect(m.nodeChecks.find((c) => c.node === col[1].label)!.faces[0].width).toBeCloseTo(7.7, 0);
    const tie = m.nodes.find((n) => n.label.startsWith("S") && Math.abs(n.x - 0.667) < 0.01);
    expect(tie).toBeDefined();
  });

  it("builds FHWA-NHI-17-071 Design Example 2's truss (Figure 2-9) and its forces from the template", async () => {
    // The cantilever bent: f'c 6 ksi, 96 in wide, 8.5 ft deep, a 10 ft column under the left end; P1 =
    // 2005 kip over the column, P2 = 926 kip on the arm; top bars' centroid 5.16 in down, column bars 8 in in.
    const t: StmTemplate = { ...HAMMERHEAD_DEFAULTS, length: 28.42, depth: 8.5, tipDepth: 8.5, capWidth: 96, columns: [5], columnWidth: 10, topCover: 5.16, columnBarInset: 8, bearings: [{ x: 6.97, P: 2005 }, { x: 22.99, P: 926 }], bearingLength: 48.2, bearingWidth: 48.2 };
    const m = buildTemplate(t, { ...STM_DEFAULTS, fc: 6 });
    // Node E at a/2 from the moment its back face holds: FHWA 2.23 in (moment at the column's face; here about E itself, 0.31 ft inside it).
    expect(Math.abs(m.template!.chordHeight! - 2.23)).toBeLessThan(0.1);
    const at = (x: number, y: number) => m.nodes.find((n) => Math.abs(n.x - x) < 0.02 && Math.abs(n.y - y) < 0.02)!.label;
    const yT = 8.5 - 5.16 / 12;
    const yB = m.template!.chordHeight! / 12;
    const [A, B, C, D, E] = [at(0.667, yT), at(6.97, yT), at(22.99, yT), at(7.51, yB), at(9.69, yB)];
    const [A1, D1, E1] = [at(0.667, -10), at(7.51, -10), at(9.69, -10)];
    // FHWA's members and nothing else: no strut crosses to the far column node.
    expect(m.members.map((s) => s.split(":")[0].split("-").sort().join("-")).sort()).toEqual([[A, B], [B, C], [A, A1], [A, D], [B, D], [D, E], [C, E], [D, D1], [E, E1]].map((p) => p.sort().join("-")).sort());
    const r = await designStm(m, nodeLpSolver);
    const force = (p: string, q: string) => {
      const x = r.members.find((k) => k.key === `${p}-${q}` || k.key === `${q}-${p}`)!;
      return x.tension > x.compression ? x.tension : -x.compression;
    };
    const near = (ours: number, theirs: number) => expect(Math.abs(ours - theirs) / Math.abs(theirs)).toBeLessThan(0.03);
    near(force(A, B), 1437);
    near(force(B, C), 1573);
    near(force(A, A1), 1664);
    near(force(B, D), -2017);
    near(force(D, E), -1570);
    near(force(C, E), -1783);
    near(force(D, D1), -3751);
    // FHWA's cap top slopes 2.9°; this one is level. Strut AD's horizontal part is tie AB's (2254 cos 50.4°), and
    // EE′ takes the vertical that FHWA's sloped tie BC carries (845 + 1573 sin 2.9°).
    const ad = m.nodes.find((n) => n.label === A)!;
    const dn = m.nodes.find((n) => n.label === D)!;
    near((-force(A, D) * (dn.x - ad.x)) / Math.hypot(dn.x - ad.x, dn.y - ad.y), 2254 * Math.cos((50.4 * Math.PI) / 180));
    near(force(E, E1), -(845 + 1573 * Math.sin((2.9 * Math.PI) / 180)));
    expect(r.angles.ok).toBe(true);
    expect(r.angles.smallest!).toBeCloseTo(30.6, 0); // FHWA 28.3° with the slope
    // The top bars bend into the column bars at A (a curved-bar node), as in FHWA; node E's interface with
    // strut CE is over its strength, as FHWA also finds (1.7% with their slope, accepted by judgment).
    const failing = r.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failing).toContain(`node-${E}-${C}-${E}-interface`);
    expect(failing.filter((id) => id.startsWith("anchor") || id.startsWith("tie") || id === "angle" || id.includes("back"))).toEqual([]);
  });

  it("resolves bearings closer than half the depth into one load at their resultant", () => {
    const pair: StmTemplate = { ...HAMMERHEAD_DEFAULTS, bearings: [{ x: 3, P: 300 }, { x: 5, P: 600 }, { x: 13, P: 600 }, { x: 27, P: 600 }, { x: 36, P: 600 }] };
    const m = buildTemplate(pair, STM_DEFAULTS);
    const loads = m.cases[0].loads.map((l) => ({ x: m.nodes.find((n) => n.label === l.node)!.x, P: -l.fy }));
    expect(loads.length).toBe(4);
    expect(loads[0].x).toBeCloseTo((3 * 300 + 5 * 600) / 900, 4);
    expect(loads[0].P).toBe(900);
    // Its node's bearing is both pads, no longer than they span.
    expect(m.nodeChecks.find((c) => c.node === m.cases[0].loads[0].node)!.faces[0].width).toBe(48);
    expect(buildTemplate({ ...pair, resolveWithin: 0 }, STM_DEFAULTS).cases[0].loads.length).toBe(5);
  });

  it("puts the bottom strut at a/2, a from the moment its node's back face holds, and checks the face with it", async () => {
    const m = buildTemplate(HAMMERHEAD_DEFAULTS, STM_DEFAULTS);
    const h = m.template!.chordHeight!;
    expect(h).toBeGreaterThan(1);
    expect(h).toBeLessThan(HAMMERHEAD_DEFAULTS.bottomCover);
    expect(m.nodes.find((n) => n.label === "C1")!.y * 12).toBeCloseTo(h, 2);
    const r = await designStm(m, nodeLpSolver);
    const back = r.faces.filter((f) => f.type === "back" && f.node.startsWith("C"));
    expect(back.length).toBeGreaterThan(0);
    for (const f of back) {
      expect(f.width).toBeCloseTo(2 * h, 2);
      expect(f.ok).toBe(true);
    }
    // Entered instead: the chord where it's put.
    expect(buildTemplate({ ...HAMMERHEAD_DEFAULTS, bottomChord: "entered" }, STM_DEFAULTS).template!.chordHeight).toBe(HAMMERHEAD_DEFAULTS.bottomCover);
  });

  it("a load over the column, between its two struts, goes to the nearer one only (FHWA's strut BD)", () => {
    const t: StmTemplate = { ...HAMMERHEAD_DEFAULTS, bearings: [{ x: 4, P: 600 }, { x: 13, P: 600 }, { x: 20.3, P: 900 }, { x: 27, P: 600 }, { x: 36, P: 900 }] };
    const m = buildTemplate(t, STM_DEFAULTS);
    const over = m.nodes.find((n) => n.label.startsWith("T") && n.x === 20.3)!.label;
    const cols = m.nodes.filter((n) => n.label.startsWith("C")).sort((p, q) => p.x - q.x);
    const toCols = m.members.filter((s) => s.startsWith(`${over}-C`));
    expect(toCols.length).toBe(1);
    const nearer = cols.reduce((p, q) => (Math.abs(q.x - 20.3) < Math.abs(p.x - 20.3) ? q : p));
    expect(toCols[0]).toBe(`${over}-${nearer.label}:strut`);
  });

  it("your cap with the girder link: laid out for the right-turning cases, every check passes but the bars' anchorage (top bars at the ends, column bars into the cap), the rest named for a second model", async () => {
    const g = girderInputs({});
    const link: GirderLink = { enabled: true, back: girderSide({ ...g, nGirders: 6, S: 8, overhang: 3.5, barrierWidth: 1.5 }, 0, "b", "Girders"), ahead: null, x0: 21.5, reverse: false, loadNodes: [], selfWeight: true, soffit: 0, wc: 0.15 };
    const t = { ...HAMMERHEAD_DEFAULTS, length: 43, bearings: [1.5, 9.5, 17.5, 25.5, 33.5, 41.5].map((x) => ({ x, P: 0 })) };
    const inputs = buildTemplate(t, { ...STM_DEFAULTS, fc: 4.5, girders: link });
    const r = await designStm(inputs, nodeLpSolver);
    expect(inputs.template!.layoutSign).toBe(1);
    expect(r.cases.length).toBeGreaterThan(3);
    expect(r.angles.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("cross"))).toBe(false);
    // The outer girders are 1.5 ft from the cap's ends: the top bars' hooks can't develop there; nor can the
    // column bars (26 #11, as scheduled) in the 7 ft over the column (AASHTO 5.8.2.4.2).
    const failing = (x: typeof r) => x.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failing(r).every((id) => id.startsWith("anchor-T"))).toBe(true);
    expect(failing(r).length).toBe(3);
    expect(r.status.finiteGeometry).toBe("pass");
    expect(r.warnings.some((w) => w.includes('"Lay out for: left"'))).toBe(true);
    // The left-turning cases, in a second model laid out for the left.
    const other = buildTemplate({ ...t, direction: "left" }, { ...STM_DEFAULTS, fc: 4.5, girders: link });
    expect(other.template!.layoutSign).toBe(-1);
    const r2 = await designStm(other, nodeLpSolver);
    expect(r2.angles.ok).toBe(true);
    expect(r2.cases.length).toBeGreaterThan(0);
    expect(failing(r2).every((id) => id.startsWith("anchor-"))).toBe(true);
    expect(r2.warnings.some((w) => w.includes("cross"))).toBe(false);
    expect(r.cases.length + r2.cases.length).toBe(r.cases.length + r.reversedCases.length); // between them, every case
  });

  it("a model laid out for one direction carries the other through the tie at that face", async () => {
    const left: StmTemplate = { ...HAMMERHEAD_DEFAULTS, bearings: [{ x: 4, P: 900 }, { x: 13, P: 800 }, { x: 27, P: 200 }, { x: 36, P: 100 }] };
    const inputs = buildTemplate(left, STM_DEFAULTS);
    const r = await designStm(inputs, nodeLpSolver);
    expect(r.angles.ok).toBe(true);
    expect(inputs.ties.some((x) => x.member.includes("S3"))).toBe(true); // the tie down the lighter (right) face
  });

  it("a shallow cap gets more panels", () => {
    const shallow = buildTemplate({ ...MULTICOLUMN_DEFAULTS, depth: 3, tipDepth: 3, bearings: [{ x: 18, P: 300 }] }, STM_DEFAULTS);
    expect(shallow.ties.some((t) => t.barSize === MULTICOLUMN_DEFAULTS.stirrups.size)).toBe(true);
  });

  it("rejects caps that don't fit", () => {
    expect(() => buildTemplate({ ...HAMMERHEAD_DEFAULTS, columns: [1] }, STM_DEFAULTS)).toThrow(/within the cap/);
    expect(() => buildTemplate({ ...HAMMERHEAD_DEFAULTS, bearings: [{ x: 50, P: 1 }] }, STM_DEFAULTS)).toThrow(/on the cap/);
    expect(() => buildTemplate({ ...HAMMERHEAD_DEFAULTS, tipDepth: 8 }, STM_DEFAULTS)).toThrow();
  });
});
