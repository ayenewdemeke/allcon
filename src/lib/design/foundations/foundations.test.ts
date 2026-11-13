import { describe, expect, it } from "vitest";
import { analyzeLateral, apiSandCoefficients, pyCurve } from "./lateral";
import { axialResistance, fixityEmbedment, flexuralResistance, HP_SECTIONS, interaction } from "./hpile";
import { bearingFactors, designFooting, FOOTING_DEFAULTS, nominalBearing, schmertmann } from "./footing";

const close = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe("p–y lateral analysis", () => {
  // A long pile on linear springs against Hetényi's closed form: β = (k / 4EI)^¼.
  const EI = 1e6;
  const k = 1;
  const beta = (k / (4 * EI)) ** 0.25;
  const base = { length: 80, D: 12, EI, layers: [{ thickness: 80, model: { kind: "linear" as const, k } }], segments: 320 };
  it("free head under a shear: y0 = 2Hβ/k, Mmax = 0.3224 H/β", () => {
    const r = analyzeLateral({ ...base, head: { kind: "free", H: 10, M: 0 } });
    close(r.y0, (2 * 10 * beta) / k, 2e-3);
    close(r.Mmax * 12, (0.3224 * 10) / beta, 5e-3);
  });
  it("free head under a moment: y0 = 2Mβ²/k", () => {
    const r = analyzeLateral({ ...base, head: { kind: "free", H: 0, M: 100 } });
    close(r.y0, (2 * 1200 * beta ** 2) / k, 5e-3);
  });
  it("fixed head: y0 = Hβ/k, M0 = H/(2β)", () => {
    const r = analyzeLateral({ ...base, head: { kind: "fixed", H: 10 } });
    close(r.y0, (10 * beta) / k, 2e-3);
    close(Math.abs(r.M0) * 12, 10 / (2 * beta), 5e-3);
  });
  it("an imposed displacement with no rotation: H = k·y/β, M0 = k·y/(2β²)", () => {
    const r = analyzeLateral({ ...base, head: { kind: "displaced", y: 1 } });
    close(r.H0, k / beta, 5e-3);
    close(Math.abs(r.M0) * 12, k / (2 * beta ** 2), 5e-3);
  });
  it("API sand: coefficients and the curve's limits", () => {
    const c = apiSandCoefficients(35);
    close(c.C1, 3.0, 0.05);
    close(c.C2, 3.4, 0.05);
    close(c.C3, 56, 0.05);
    const s = pyCurve({ kind: "sand", phi: 35, gamma: 120, k: 225 }, 120, 120, 12, 0, 0);
    // At large y the curve flattens at A·pu, A = max(0.9, 3 − 0.8·10) = 0.9.
    const g = 120 / 1728 / 1000;
    const pu = Math.min((c.C1 * 120 + c.C2 * 12) * g * 120, c.C3 * 12 * g * 120);
    close(s.p(100), 0.9 * pu, 1e-6);
    close(s.k0, 0.225 * 120, 1e-9);
  });
  it("soft clay (Matlock): p = 0.5·pu·(y/y50)^⅓ to 8·y50, then pu", () => {
    const s = pyCurve({ kind: "soft-clay", su: 500, gamma: 50, e50: 0.02, J: 0.5 }, 60, 60, 12, 50 / 1728 / 1000, 500);
    const c = 500 / 144 / 1000;
    const pu = Math.min((3 + ((50 / 1728 / 1000) * 60) / c + (0.5 * 60) / 12) * c * 12, 9 * c * 12);
    const y50 = 2.5 * 0.02 * 12;
    close(s.p(y50), 0.5 * pu, 1e-9);
    close(s.p(10 * y50), pu, 1e-9);
  });
  it("a nonlinear sand profile converges, and a fixed head moment is larger than the free head's", () => {
    const layers = [{ thickness: 60, model: { kind: "sand" as const, phi: 34, gamma: 120, k: 90 } }];
    const free = analyzeLateral({ length: 60, D: 12, EI: 29000 * 393, layers, head: { kind: "free", H: 20, M: 0 } });
    const fixed = analyzeLateral({ length: 60, D: 12, EI: 29000 * 393, layers, head: { kind: "fixed", H: 20 } });
    expect(free.converged && fixed.converged).toBe(true);
    expect(fixed.y0).toBeLessThan(free.y0);
    expect(fixed.zZero).not.toBeNull();
  });
});

describe("H-piles (AASHTO 6.9.4, 6.12.2.2, 6.9.2.2)", () => {
  const s = HP_SECTIONS["HP12x53"];
  it("fully embedded HP 12x53, Grade 50: the slender flanges reduce Fy·Ag a little", () => {
    const r = axialResistance(s, 50, 0);
    expect(r.slender).toBe(true); // bf/2tf = 13.8 > 0.56√(E/Fy) = 13.49
    expect(r.Pn).toBeLessThan(50 * s.A);
    expect(r.Pn).toBeGreaterThan(0.98 * 50 * s.A);
  });
  it("weak-axis flexure: noncompact flanges, between 0.7·Fy·Sy and Fy·Zy", () => {
    const f = flexuralResistance(s, 50, "y");
    expect(f.compact).toBe(false);
    expect(f.Mn).toBeLessThan(50 * s.Zy);
    expect(f.Mn).toBeGreaterThan(0.7 * 50 * s.Sy);
  });
  it("interaction: Eq. 6.9.2.2.1-3 for noncompact sections", () => {
    expect(interaction(100, 400, 0, 1, 50, 200, false).value).toBeCloseTo(0.25 + 0.25, 9);
    expect(interaction(100, 400, 0, 1, 50, 200, true).value).toBeCloseTo(0.25 + (8 / 9) * 0.25, 9);
  });
  it("fixity embedment reproduces CDOT BDM Table 10-1 (20, 24, 26 in)", () => {
    expect(Math.round(fixityEmbedment(HP_SECTIONS["HP12x53"], 50, 4.5))).toBe(20);
    expect(Math.round(fixityEmbedment(HP_SECTIONS["HP12x74"], 50, 4.5))).toBe(24);
    expect(Math.round(fixityEmbedment(HP_SECTIONS["HP14x89"], 50, 4.5))).toBe(26);
  });
});

describe("spread footing", () => {
  it("bearing factors (AASHTO Table 10.6.3.1.2a-1): φ = 20° gives 14.8, 6.4, 5.4", () => {
    const f = bearingFactors(20);
    close(f.Nc, 14.8, 5e-3);
    close(f.Nq, 6.4, 5e-3);
    close(f.Ng, 5.4, 5e-3);
  });
  it("FHWA NHI-06-089 Example 8-1: qult = 13,425 psf; 12,414 psf with the water at the base", () => {
    const o = { c: 500, phi: 20, gammaAbove: 125, gammaBelow: 125, Df: 5, B: 6, L: 6e5, depthFactor: false };
    close(nominalBearing({ ...o, Dw: 100 }).qn, 13.425, 2e-3);
    close(nominalBearing({ ...o, Dw: 5 }).qn, 12.414, 2e-3);
  });
  it("FHWA NHI-06-089 Example 8-2: Schmertmann, Si = 0.130 in at the end of construction", () => {
    const r = schmertmann({
      B: 6,
      L: 24,
      dp: 1.655,
      p0: 0.345,
      years: 0.1,
      layers: [
        { thickness: 3, gamma: 125, E: 0, source: "silt", N160: 25 },
        { thickness: 5, gamma: 120, E: 0, source: "coarse-sand", N160: 30 },
        { thickness: 25, gamma: 128, E: 0, source: "gravel", N160: 68 },
      ],
    });
    close(r.IzB, 0.1333, 2e-3);
    close(r.DI, 16, 1e-6);
    close(r.DIP, 4, 1e-6);
    close(r.X, 1.4167, 1e-3);
    close(r.pop, 0.84, 1e-6);
    close(r.Izp, 0.64, 5e-3);
    close(r.C1, 0.896, 2e-3);
    // The example sums four coarse layers at their midpoints; the slices here integrate the diagram.
    close(r.Si, 0.13, 0.1);
    close(schmertmann({ ...{ B: 6, L: 24, dp: 1.655, p0: 0.345, layers: [{ thickness: 30, gamma: 120, E: 400, source: "entered" as const, N160: 0 }] }, years: 1 }).C2, 1.2, 1e-9);
  });
  it("the default footing passes, and an undersized one fails bearing and punching", () => {
    const r = designFooting(FOOTING_DEFAULTS);
    expect(r.checks.filter((c) => !c.ok && !c.advisory).map((c) => c.id)).toEqual([]);
    const small = designFooting({ ...FOOTING_DEFAULTS, B: 6, L: 6, t: 18 });
    const failing = small.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failing).toContain("bearing");
    expect(failing).toContain("punching");
  });
});
