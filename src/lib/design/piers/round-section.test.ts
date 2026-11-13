import { describe, expect, it } from "vitest";
import { roundSection } from "./round-section";

const near = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

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
});
