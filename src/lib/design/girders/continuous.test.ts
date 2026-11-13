import { describe, expect, it } from "vitest";
import { continuousBeam, rotationsFromCurvature } from "./continuous";
import { liveLoad } from "./prestressed";

const near = (a: number, b: number, rel = 1e-6, abs = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b) + abs);

describe("continuous beam (three-moment equation)", () => {
  it("two equal spans under a uniform load: −wL²/8 at the pier, 3wL/8 at the abutment", () => {
    const b = continuousBeam([100, 100]);
    const u = b.uniformAll(0, 0, 2);
    near(u.supports[1], (-2 * 100 ** 2) / 8);
    near(u.V, (3 * 2 * 100) / 8);
    // Contraflexure at 0.75L
    near(b.uniformAll(0, 75, 2).M, 0, 0, 1e-6);
  });

  it("three equal spans under a uniform load: −0.1wL² at the piers, 0.025wL² mid-centre-span", () => {
    const b = continuousBeam([80, 80, 80]);
    const u = b.uniformAll(1, 40, 1);
    near(u.supports[1], -0.1 * 80 ** 2);
    near(u.supports[2], -0.1 * 80 ** 2);
    near(u.M, 0.025 * 80 ** 2);
  });

  it("influence of the pier moment for a load in span 1 of two equal spans: −P·a·(L²−a²)/(4L²)", () => {
    const L = 120;
    const b = continuousBeam([L, L]);
    const il = b.influence(1, 0, "M"); // the moment at the pier, from span 2's left end
    for (const a of [12, 30, 60, 90, 117]) near(il(a), (-a * (L * L - a * a)) / (4 * L * L), 1e-4, 1e-6);
  });

  it("unequal spans: the pier moments match a direct solution", () => {
    const b = continuousBeam([100, 130, 100]);
    const u = b.uniformAll(0, 0, 1);
    // By symmetry M1 = M2 = M: 2·(100+130)·M + 130·M = −(100³ + 130³)/4
    const M = -(100 ** 3 + 130 ** 3) / 4 / (2 * 230 + 130);
    near(u.supports[1], M);
    near(u.supports[2], M);
  });

  it("a single span reproduces the simple-span HL-93 envelope", () => {
    const b = continuousBeam([120]);
    for (const x of [12, 36, 60]) {
      const e = b.liveEnvelope(0, x);
      const s = liveLoad(120, x);
      near(e.Mpos, s.M, 1e-3);
      near(e.V, s.V, 1e-3);
      expect(e.Mneg).toBe(0);
    }
  });

  it("negative moment at the pier of two 120 ft spans: 90% of two trucks with the lane governs", () => {
    const b = continuousBeam([120, 120]);
    const e = b.liveEnvelope(0, 120);
    expect(e.negGoverns).toBe("90% of two trucks with the lane (3.6.1.3.1)");
    // Lane on both spans: −0.64·120²/8.
    const laneOnly = (-0.64 * 120 ** 2) / 8;
    expect(e.Mneg).toBeLessThan(0.9 * laneOnly);
    // One truck alone (14 ft, 32 kip axles near the peak, 0.096L per kip at 0.577L): about −870 kip·ft with IM.
    expect(e.Mneg).toBeGreaterThan(-3000);
  });

  it("end rotations from a uniform curvature: κL/2 at each end", () => {
    const r = rotationsFromCurvature(100, () => 3);
    near(r.left, 150, 1e-6);
    near(r.right, 150, 1e-6);
    // Two equal spans with a uniform curvature everywhere: the pier moment is −3·EIκ/2 (restrained).
    const b = continuousBeam([100, 100]);
    near(b.supportMoments([r, r])[1], -1.5 * 3, 1e-6);
  });
});
