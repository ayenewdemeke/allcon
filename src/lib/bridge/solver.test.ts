import { describe, expect, it } from "vitest";
import { emptyModel, ModelError, type Dof6, type Model } from "./model";
import { analyze, elementIndex } from "./solver";

// The frame solver against closed-form solutions (kip, ft).

const E = 4000 * 144; // ksf
const G = E / 2.4;
const FIX: Dof6<boolean> = [true, true, true, true, true, true];
const PIN: Dof6<boolean> = [true, true, true, true, false, false]; // held against twist, free to rotate in bending
const ROLLER: Dof6<boolean> = [false, true, true, false, false, false];
const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

/** A straight beam along X in n elements, with one material and section. */
function beam(L: number, n: number, sec: Partial<Model["sections"][0]> = {}): Model {
  const m = emptyModel();
  m.materials.push({ id: 1, name: "C", E, G, density: 0.15, alpha: 6e-6 });
  m.sections.push({ id: 1, name: "S", A: 4, Asy: 0, Asz: 0, J: 1.2, Iy: 2, Iz: 0.5, ...sec });
  for (let k = 0; k <= n; k++) m.nodes.push({ id: k + 1, x: (L * k) / n, y: 0, z: 0 });
  for (let k = 0; k < n; k++) m.elements.push({ id: k + 1, type: "beam", mat: 1, sec: 1, n1: k + 1, n2: k + 2 });
  m.loadCases.push({ name: "w", type: "USER" });
  return m;
}
const uniform = (m: Model, w: number, dir: "GZ" | "GY" = "GZ") => m.elements.forEach((e) => m.loads.push({ case: "w", kind: "uniform", element: e.id, dir, w }));

describe("frame solver: beams", () => {
  it("a simple span under uniform load: wL²/8, 5wL⁴/384EI, reactions wL/2", () => {
    const L = 100, w = 2;
    const m = beam(L, 10);
    m.supports.push({ node: 1, fixed: PIN }, { node: 11, fixed: ROLLER });
    uniform(m, -w);
    const a = analyze(m);
    const c = a.cases[0];
    close(a.forcesAt(0, 4, 1).My, (w * L * L) / 8);
    close(a.forcesAt(0, 0, 0).Vz, (w * L) / 2);
    close(a.forcesAt(0, 9, 1).Vz, (-w * L) / 2);
    close(a.forcesAt(0, 2, 0.5).My, (w * 25 * (L - 25)) / 2); // within an element, from statics
    close(c.displacements[5][2], (-5 * w * L ** 4) / (384 * E * 2));
    close(c.reactions[0].R[2], (w * L) / 2);
    close(c.equilibrium.applied[2] + c.equilibrium.reactions[2], 0, 1e-9);
    expect(c.equilibrium.residual).toBeLessThan(1e-7);
  });

  it("the same in the weak direction uses Iz, with Mz and Vy", () => {
    const L = 60, w = 1.5;
    const m = beam(L, 6);
    m.supports.push({ node: 1, fixed: [true, true, true, true, false, false] }, { node: 7, fixed: [false, true, true, false, false, false] });
    uniform(m, -w, "GY");
    const a = analyze(m);
    close(Math.abs(a.forcesAt(0, 2, 1).Mz), (w * L * L) / 8);
    close(a.cases[0].displacements[3][1], (-5 * w * L ** 4) / (384 * E * 0.5));
  });

  it("a cantilever with shear deformation: PL³/3EI + PL/GAs, in one element or many", () => {
    const L = 12, P = 50, As = 3;
    for (const n of [1, 4]) {
      const m = beam(L, n, { Asz: As });
      m.supports.push({ node: 1, fixed: FIX });
      m.loads.push({ case: "w", kind: "nodal", node: n + 1, F: [0, 0, -P, 0, 0, 0] });
      const a = analyze(m);
      close(a.cases[0].displacements[n][2], -((P * L ** 3) / (3 * E * 2) + (P * L) / (G * As)));
      close(a.forcesAt(0, 0, 0).My, -P * L); // hogging at the root
      close(a.cases[0].reactions[0].R[4], -P * L, 1e-6); // about global Y
    }
  });

  it("a point load within an element, with shear deformation, matches the same load at a node", () => {
    const L = 20, P = 30, a0 = 7;
    const one = beam(L, 1, { Asz: 2.5 });
    one.supports.push({ node: 1, fixed: FIX }, { node: 2, fixed: FIX });
    one.loads.push({ case: "w", kind: "point", element: 1, dir: "GZ", P: -P, a: a0 });
    const two = emptyModel();
    two.materials = one.materials;
    two.sections = one.sections;
    two.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: a0, y: 0, z: 0 }, { id: 3, x: L, y: 0, z: 0 });
    two.elements.push({ id: 1, type: "beam", mat: 1, sec: 1, n1: 1, n2: 2 }, { id: 2, type: "beam", mat: 1, sec: 1, n1: 2, n2: 3 });
    two.supports.push({ node: 1, fixed: FIX }, { node: 3, fixed: FIX });
    two.loadCases.push({ name: "w", type: "USER" });
    two.loads.push({ case: "w", kind: "nodal", node: 2, F: [0, 0, -P, 0, 0, 0] });
    const x = analyze(one), y = analyze(two);
    close(x.forcesAt(0, 0, 0).My, y.forcesAt(0, 0, 0).My);
    close(x.forcesAt(0, 0, 1).My, y.forcesAt(0, 1, 1).My);
    close(x.forcesAt(0, 0, a0 / L).My, y.forcesAt(0, 0, 1).My);
    close(x.cases[0].reactions[0].R[2], y.cases[0].reactions[0].R[2]);
  });

  it("two equal continuous spans: −wL²/8 over the pier, 1.25wL at it", () => {
    const L = 80, w = 1.2;
    const m = beam(2 * L, 16);
    m.supports.push({ node: 1, fixed: PIN }, { node: 9, fixed: ROLLER }, { node: 17, fixed: ROLLER });
    uniform(m, -w);
    const a = analyze(m);
    close(a.forcesAt(0, 7, 1).My, (-w * L * L) / 8);
    close(a.cases[0].reactions[1].R[2], 1.25 * w * L);
    close(a.forcesAt(0, 2, 1).My, (0.375 * w * L * 30) - (w * 30 * 30) / 2); // 30 ft from the end
  });

  it("a moment release at the pier makes two simple spans", () => {
    const L = 80, w = 1.2;
    const m = beam(2 * L, 16);
    m.supports.push({ node: 1, fixed: PIN }, { node: 9, fixed: ROLLER }, { node: 17, fixed: ROLLER });
    const none: Dof6<boolean> = [false, false, false, false, false, false];
    m.elements[7].releases = { i: none, j: [false, false, false, false, true, false] };
    uniform(m, -w);
    const a = analyze(m);
    close(a.forcesAt(0, 7, 1).My, 0, 1e-6);
    close(a.forcesAt(0, 3, 1).My, (w * L * L) / 8);
    close(a.forcesAt(0, 11, 1).My, (w * L * L) / 8);
    close(a.cases[0].reactions[1].R[2], w * L);
  });

  it("a propped cantilever by an end release: 9wL²/128 at 3L/8, −wL²/8 at the wall", () => {
    const L = 40, w = 3;
    const m = beam(L, 8);
    m.supports.push({ node: 1, fixed: FIX }, { node: 9, fixed: [true, true, true, true, true, true] });
    m.elements[7].releases = { i: [false, false, false, false, false, false], j: [false, false, false, false, true, false] };
    uniform(m, -w);
    const a = analyze(m);
    close(a.forcesAt(0, 0, 0).My, (-w * L * L) / 8);
    close(a.forcesAt(0, 4, 1).My, (9 * w * L * L) / 128); // at 5L/8 from the wall = 3L/8 from the prop
    close(a.cases[0].reactions[1].R[2], (3 * w * L) / 8);
  });

  it("torsion and axial load: TL/GJ, PL/EA", () => {
    const L = 15;
    const m = beam(L, 3);
    m.supports.push({ node: 1, fixed: FIX });
    m.loads.push({ case: "w", kind: "nodal", node: 4, F: [100, 0, 0, 20, 0, 0] });
    const a = analyze(m);
    close(a.cases[0].displacements[3][0], (100 * L) / (E * 4));
    close(a.cases[0].displacements[3][3], (20 * L) / (G * 1.2));
    close(a.forcesAt(0, 1, 0.5).N, 100);
    close(a.forcesAt(0, 1, 0.5).T, 20);
  });
});

describe("frame solver: frames, links and springs", () => {
  it("a fixed-base portal frame under a lateral load (rigid beam limit: PH³/24EI)", () => {
    const H = 14, B = 20, P = 10;
    const m = emptyModel();
    m.materials.push({ id: 1, name: "C", E, G, density: 0, alpha: 0 });
    m.sections.push({ id: 1, name: "col", A: 1e4, Asy: 0, Asz: 0, J: 1, Iy: 1.5, Iz: 1.5 }, { id: 2, name: "beam", A: 1e4, Asy: 0, Asz: 0, J: 1, Iy: 1e7, Iz: 1e7 });
    m.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 0, z: H }, { id: 3, x: B, y: 0, z: H }, { id: 4, x: B, y: 0, z: 0 });
    m.elements.push({ id: 1, type: "beam", mat: 1, sec: 1, n1: 1, n2: 2 }, { id: 2, type: "beam", mat: 1, sec: 2, n1: 2, n2: 3 }, { id: 3, type: "beam", mat: 1, sec: 1, n1: 4, n2: 3 });
    m.supports.push({ node: 1, fixed: FIX }, { node: 4, fixed: FIX });
    m.loadCases.push({ name: "H", type: "USER" });
    m.loads.push({ case: "H", kind: "nodal", node: 2, F: [P, 0, 0, 0, 0, 0] });
    const a = analyze(m);
    close(a.cases[0].displacements[1][0], (P * H ** 3) / (24 * E * 1.5), 1e-4);
    // Each column carries P/2 in shear and PH/4 at each end.
    const col = a.cases[0].endForces[elementIndex(m, 1)];
    close(Math.hypot(col[1], col[2]), P / 2, 1e-4);
    close(Math.hypot(col[4], col[5]), (P * H) / 4, 1e-4);
    close(a.cases[0].equilibrium.applied[0] + a.cases[0].equilibrium.reactions[0], 0, 1e-8);
    // Overturning: P·H carried by the base moments and the column axial couple.
    const [r1, r4] = a.cases[0].reactions;
    close(r1.R[4] + r4.R[4] - r4.R[2] * B, -P * H, 1e-6); // moments about global Y at node 1 (force Z at x: −x·Fz)
  });

  it("a beam on a spring at midspan shares the load by stiffness", () => {
    const L = 40, P = 60, k = 500;
    const m = beam(L, 2);
    m.supports.push({ node: 1, fixed: PIN }, { node: 3, fixed: ROLLER });
    m.springs.push({ node: 2, k: [0, 0, k, 0, 0, 0] });
    m.loads.push({ case: "w", kind: "nodal", node: 2, F: [0, 0, -P, 0, 0, 0] });
    const a = analyze(m);
    const kb = (48 * E * 2) / L ** 3;
    close(a.cases[0].displacements[1][2], -P / (kb + k));
    close(a.cases[0].springForces[0].R[2], (P * k) / (kb + k));
    close(a.cases[0].equilibrium.applied[2] + a.cases[0].equilibrium.reactions[2], 0, 1e-9);
  });

  it("an elastic link as a bearing: vertical load through, shear with its couple, free where it has no stiffness", () => {
    // A girder node 3 ft above a fixed node, joined by a link stiff vertically and along X.
    const m = beam(30, 3);
    m.nodes.push({ id: 10, x: 0, y: 0, z: -3 }, { id: 11, x: 30, y: 0, z: -3 });
    m.supports.push({ node: 10, fixed: FIX }, { node: 11, fixed: FIX });
    // Link local axes (vertical, first node above): x down, y = global Y, z = global X.
    m.links.push({ id: 1, n1: 1, n2: 10, k: [1e7, 1e7, 1e7, 0, 0, 1e7] }, { id: 2, n1: 4, n2: 11, k: [1e7, 1e7, 0, 0, 0, 1e7] });
    m.loads.push({ case: "w", kind: "nodal", node: 2, F: [12, 0, -90, 0, 0, 0] });
    const a = analyze(m);
    const c = a.cases[0];
    close(c.reactions[0].R[2] + c.reactions[1].R[2], 90, 1e-6);
    // 60 kip from the load's position, less the 12 kip acting 1.5 ft above the springs over the 30 ft span.
    close(c.reactions[0].R[2], 60 - (12 * 1.5) / 30, 1e-4);
    close(c.reactions[0].R[0], -12, 1e-6); // all the longitudinal force at the fixed bearing
    close(c.reactions[1].R[0], 0, 1e-6);
    close(c.reactions[0].R[4], -12 * 1.5, 1e-4); // its couple about the spring at mid-height, on the support
    close(c.linkForces[0][0], -59.4, 1e-4); // compression (the two nodes closing) is negative, as in a member
    expect(c.equilibrium.residual).toBeLessThan(1e-5);
  });

  it("a grillage of two girders and cross beams: symmetric load splits evenly, equilibrium holds", () => {
    const m = emptyModel();
    m.materials.push({ id: 1, name: "C", E, G, density: 0, alpha: 0 });
    m.sections.push({ id: 1, name: "g", A: 5, Asy: 0, Asz: 0, J: 0.3, Iy: 3, Iz: 1 }, { id: 2, name: "x", A: 1, Asy: 0, Asz: 0, J: 0.05, Iy: 0.2, Iz: 1 });
    let id = 1;
    for (const y of [0, 8]) for (let k = 0; k <= 4; k++) m.nodes.push({ id: id++, x: 15 * k, y, z: 0 });
    let e = 1;
    for (const base of [1, 6]) for (let k = 0; k < 4; k++) m.elements.push({ id: e++, type: "beam", mat: 1, sec: 1, n1: base + k, n2: base + k + 1 });
    for (let k = 0; k <= 4; k++) m.elements.push({ id: e++, type: "beam", mat: 1, sec: 2, n1: 1 + k, n2: 6 + k });
    for (const n of [1, 6]) m.supports.push({ node: n, fixed: [true, true, true, false, false, false] });
    for (const n of [5, 10]) m.supports.push({ node: n, fixed: [false, true, true, false, false, false] });
    m.loadCases.push({ name: "P", type: "USER" }, { name: "Q", type: "USER" });
    m.loads.push({ case: "P", kind: "point", element: 11, dir: "GZ", P: -100, a: 4 }); // middle of the middle cross beam
    m.loads.push({ case: "Q", kind: "nodal", node: 3, F: [0, 0, -100, 0, 0, 0] }); // on one girder
    const a = analyze(m);
    close(a.cases[0].reactions[0].R[2], 25, 1e-6);
    close(a.cases[0].displacements[2][2], a.cases[0].displacements[7][2], 1e-9);
    // Loaded on one girder: with bearings that don't hold the girders against twist, statics sends
    // every reaction to that girder's line (no moment about it), yet the other girder bends too,
    // sharing the moment through the cross beams, so the loaded one deflects less than alone.
    const q = a.cases[1];
    const near = q.reactions[0].R[2] + q.reactions[2].R[2];
    const far = q.reactions[1].R[2] + q.reactions[3].R[2];
    close(near, 100, 1e-8);
    close(far, 0, 1e-8);
    const alone = (100 * 60 ** 3) / (48 * E * 3);
    expect(-q.displacements[7][2]).toBeGreaterThan(0.1 * alone);
    expect(-q.displacements[2][2]).toBeLessThan(0.95 * alone);
    close(a.forcesAt(1, 1, 1).My + a.forcesAt(1, 5, 1).My, (100 * 60) / 4, 1e-8); // the two girders' midspan moments add up to PL/4
    expect(q.equilibrium.residual).toBeLessThan(1e-6);
  });

  it("says where a model is unstable, and holds a truss node's free rotations", () => {
    const m = beam(20, 2);
    m.supports.push({ node: 1, fixed: PIN });
    m.loads.push({ case: "w", kind: "nodal", node: 3, F: [0, 0, -1, 0, 0, 0] });
    expect(() => analyze(m)).toThrow(ModelError);
    expect(() => analyze(m)).toThrow(/unstable/);
    const t = emptyModel();
    t.materials.push({ id: 1, name: "S", E: 29000 * 144, G: 11200 * 144, density: 0, alpha: 0 });
    t.sections.push({ id: 1, name: "bar", A: 0.02, Asy: 0, Asz: 0, J: 0, Iy: 0, Iz: 0 });
    t.nodes.push({ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 8, y: 0, z: 0 }, { id: 3, x: 4, y: 0, z: 3 });
    t.elements.push({ id: 1, type: "truss", mat: 1, sec: 1, n1: 1, n2: 3 }, { id: 2, type: "truss", mat: 1, sec: 1, n1: 2, n2: 3 });
    t.supports.push({ node: 1, fixed: [true, true, true, false, false, false] }, { node: 2, fixed: [true, true, true, false, false, false] }, { node: 3, fixed: [false, true, false, false, false, false] });
    t.loadCases.push({ name: "P", type: "USER" });
    t.loads.push({ case: "P", kind: "nodal", node: 3, F: [0, 0, -30, 0, 0, 0] });
    const a = analyze(t);
    close(a.forcesAt(0, 0, 0.5).N, -15 / (3 / 5)); // each bar: 15 kip vertical on a 3-4-5 slope
    expect(a.held.length).toBeGreaterThan(0);
  });
});
