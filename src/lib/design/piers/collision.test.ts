import { describe, expect, it } from "vitest";
import { bent, COLLISION_DEFAULTS, designCollision, roundSection } from "./collision";

// The column's shear against a state DOT's worked example (a 4 ft round column, 22 #10, #4 ties at
// 6 in, Vu = 396.2 kip from a frame analysis), and the round section against slicing the circle.

const near = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe("pier collision: shear, a DOT worked example", () => {
  // The example counts 0.8 in² of ties in each 6 in (two hoops' legs) and uses φ = 0.9.
  const r = designCollision({ ...COLLISION_DEFAULTS, useFrame: true, Vu: 396.2, tieLegs: 4, tieSpacing: 6, phiV: 0.9 });
  it("depths for a circular section (C5.7.2.8)", () => {
    near(r.shear.Dr, 41.73);
    near(r.shear.de, 37.2831);
    // dv need not be less than 0.72 h (34.56 in); the example took 0.9 de = 33.55 in.
    near(r.shear.dv, 0.72 * 48);
  });
  it("Vc and Vs per inch of dv as in the example, and the minimum ties", () => {
    near(r.shear.Vc / r.shear.dv, 215.9329 / 33.5548);
    near(r.shear.Vs / r.shear.dv, 268.4381 / 33.5548);
    near(r.shear.AvMin, 0.3218);
    expect(r.checks.find((c) => c.id === "shear")!.ok).toBe(true);
  });
  it("maximum spacing: 0.8 dv, but never over 24 in (the example omitted the cap)", () => {
    near(r.shear.sMax, 24);
  });
});

describe("pier collision: the column's forces in a swaying bent", () => {
  const r = designCollision(COLLISION_DEFAULTS);
  it("the column on its shaft: impact 20.5 ft above the fixity, the shears adding up to the load", () => {
    near(r.L, 35.5);
    near(r.a, 20.5);
    near(r.fixed.Vbottom + r.fixed.Vtop, 600, 1e-6);
  });
  it("uniform, fixed at both ends (many columns): Roark's shears and moments", () => {
    const [L, a, P] = [30, 12, 100];
    const b = L - a;
    const f = bent(L, 6, a, 1, P, 1e7);
    near(f.Vtop, (P * a ** 2 * (a + 3 * b)) / L ** 3, 1e-5);
    near(f.Mbottom, (P * a * b ** 2) / L ** 2, 1e-5);
    near(f.Mtop, (P * a ** 2 * b) / L ** 2, 1e-5);
    near(f.Mimpact, (2 * P * a ** 2 * b ** 2) / L ** 3, 1e-5);
  });
  it("a column alone sways freely: the whole load goes to its base, with P a there", () => {
    const f = bent(30, 6, 12, 1, 100, 1);
    near(f.Vbottom, 100, 1e-6);
    near(f.Vtop, 0, 1e-6);
    near(f.Mbottom, 100 * 12 * (1 - 12 / 60), 1e-6); // P a (1 − a / 2L)
    near(f.Mbottom + f.Mtop, 100 * 12, 1e-6); // opposite senses, P a apart
  });
  it("three columns on stiffer shafts: the shear below the impact within 10% of the example's 3D frame analysis (396.2 kip, with P-delta and the force at 15°)", () => {
    near(r.fixed.Vbottom, 396.2, 0.1);
  });
});

describe("round section by strain compatibility", () => {
  const sec = roundSection(48, 41.73, 22, 1.27, 4.5, 60);
  it("agrees with slicing the circle into strips", () => {
    for (const c of [6, 15, 24, 40]) {
      const R = 24;
      const a = sec.beta1 * c;
      let Cc = 0;
      let Mc = 0;
      const N = 20000;
      for (let k = 0; k < N; k++) {
        const y = ((k + 0.5) / N) * a; // from the compression face
        const half = Math.sqrt(Math.max(R ** 2 - (R - y) ** 2, 0));
        const dA = 2 * half * (a / N);
        Cc += 0.85 * 4.5 * dA;
        Mc += 0.85 * 4.5 * dA * (R - y);
      }
      let P = Cc;
      let M = Mc;
      for (let k = 0; k < 22; k++) {
        const d = R - (41.73 / 2) * Math.cos((2 * Math.PI * k) / 22);
        const fs = Math.max(-60, Math.min(60, (29000 * 0.003 * (c - d)) / c));
        const f = d < a ? fs - 0.85 * 4.5 : fs;
        P += 1.27 * f;
        M += 1.27 * f * (R - d);
      }
      const s = sec.at(c);
      near(s.P, P, 1e-4);
      near(s.M, M, 1e-4);
    }
  });
  it("finds the moment at an axial load, and P0", () => {
    near(sec.momentAt(500).P, 500, 1e-6);
    near(sec.P0, 0.85 * 4.5 * (Math.PI * 576 - 22 * 1.27) + 60 * 22 * 1.27);
  });
  it("the example's 22 #10 column carries the collision with the dead load at either factor", () => {
    expect(designCollision(COLLISION_DEFAULTS).ok).toBe(true);
  });
});
