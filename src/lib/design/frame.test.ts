import { describe, expect, it } from "vitest";
import { Frame } from "./frame";

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(b)));

describe("2D frame", () => {
  // A 10 ft beam in 4 elements.
  const nodes = [0, 2.5, 5, 7.5, 10].map((x) => ({ x, y: 0 }));
  const els = [0, 1, 2, 3].map((k) => ({ i: k, j: k + 1, A: 1, I: 1 }));

  it("has the textbook moments for a fixed–fixed beam under a uniform load", () => {
    const f = new Frame(nodes, els, [{ node: 0, ux: true, uy: true, rz: true }, { node: 4, ux: true, uy: true, rz: true }]);
    const r = f.solve({ dist: els.map((_, k) => ({ el: k, dir: "y", s0: 0, s1: 2.5, q0: -1, q1: -1 })) });
    near(r[0].Mi, -100 / 12); // hogging at the support
    near(r[1].Mj, 100 / 24); // sagging at midspan
    near(r[0].Vi, 5);
  });

  it("matches a simply supported beam under a partial triangular load", () => {
    const f = new Frame(nodes, els, [{ node: 0, ux: true, uy: true }, { node: 4, uy: true }]);
    // 0 → 2 kip/ft from x = 1 to x = 6 (spans two elements): total 5 kip at x = 4.333.
    const r = f.solve({ dist: [0, 1, 2].map((k) => ({ el: k, dir: "y" as const, s0: 1 - 2.5 * k, s1: 6 - 2.5 * k, q0: 0, q1: -2 })) });
    const RA = (5 * (10 - 13 / 3)) / 10;
    // Moment at x = 5: RA·5 − (load left of 5: 0→1.6 over 1..5 = 3.2 kip at 1 + 4·2/3 = 3.667) · (5 − 3.667)
    near(r[1].Mj, RA * 5 - 3.2 * (5 - (1 + 8 / 3)));
  });
});
