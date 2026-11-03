import { describe, expect, it } from "vitest";
import { designWingwall, pressureResultants, WINGWALL_DEFAULTS } from "./wingwall";

// Validation against a state DOT's worked example (a 10 ft cantilever wingwall, 20 ft long, off an
// abutment skewed 30°), and the closed-form pressure resultants against numerical integration.

const near = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
const r = designWingwall(WINGWALL_DEFAULTS);

describe("wingwall: pressure resultants", () => {
  it("agree with integrating W (z + S) over the trapezoidal face", () => {
    const [W, H, h, L, S] = [0.06, 12, 4, 18, 2.5];
    let P = 0, MA = 0, MC = 0;
    const N = 2000;
    for (let a = 0; a < N; a++) {
      const x = ((a + 0.5) / N) * L;
      const d = H + ((h - H) * x) / L;
      for (let b = 0; b < N; b++) {
        const z = ((b + 0.5) / N) * d;
        const dA = (L / N) * (d / N);
        const p = W * (z + S) * dA;
        P += p;
        MA += p * x;
        MC += p * z;
      }
    }
    const f = pressureResultants(W, H, h, L, S);
    near(f.P, P, 1e-5);
    near(f.MA, MA, 1e-5);
    near(f.MC, MC, 1e-5);
  });
});

describe("wingwall: a DOT worked example", () => {
  it("at-rest pressure", () => {
    near(r.soil.k, 0.4408);
    near(r.soil.W, 0.0573);
  });
  it("service moments, thrust and its location", () => {
    near(r.service.MA, 300.8508);
    near(r.service.MC, 188.4377);
    near(r.service.P, 41.4506);
    near(r.service.x, 7.2581);
    near(r.service.y, 4.5461);
  });
  it("strength (surcharge at 1.75, earth pressure at 1.35)", () => {
    near(r.strength.MA, 455.0488);
    near(r.strength.MC, 275.6319);
    near(r.strength.P, 61.918);
    near(r.strength.x, 7.3492);
    near(r.strength.y, 4.4516);
  });
  it("self weight and Section A per foot of height", () => {
    near(r.wall.Vs, 30);
    near(r.wall.Mu, 375);
    near(r.sectionA.Ms, 30.0851);
    near(r.sectionA.Mu, 45.5049);
  });
  it("Section B: the forces the abutment takes", () => {
    near(r.Askew, 3.4641);
    const s = r.sectionB.service;
    near(s.ex, 8.9901);
    near(s.ez, 0.4539);
    near(s.My, 372.6453);
    near(s.Mx, 18.8151);
    near(s.Tz, 351.9615);
    const u = r.sectionB.strength;
    near(u.My, 562.2939);
    near(u.Mx, 33.9579);
    near(u.Tz, 439.9519);
  });
  it("the #8 bars at 6 in the example chose carry Section A", () => {
    expect(r.ok).toBe(true);
    expect(designWingwall({ ...WINGWALL_DEFAULTS, bars: { bar: 5, spacing: 12 } }).checks.find((c) => c.id === "a-flexure")!.ok).toBe(false);
  });
});
