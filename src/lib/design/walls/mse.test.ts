import { describe, expect, it } from "vitest";
import { DesignError } from "./cip";
import { activeLength, designMseWall, inextensibleH1, layerFactors, MSE_DEFAULTS, panelFlexure, pulloutLength, REINFORCEMENTS, type MseInputs } from "./mse";

// The engine against the MSE workbook (Design Check.xlsx) wherever its formulas agree with AASHTO.
// The workbook takes the retained fill's φ and γ from the reinforced fill (34°, 135 pcf) and a wall
// friction of RADIANS(0.675) read as degrees; the tests feed it the same.

const near = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));
const SHEET = { phiRet: 34, gammaRet: 0.135, delta: (0.675 * Math.PI) / 180, wallType: "abutment", liveLoad: true, seismic: true, pga: 0.047, fpga: 1.6, khFactor: 1 } as const;

describe("MSE wall, external stability", () => {
  it("matches the abutment sheet (level backfill, H = 10 ft, L = 9 ft)", () => {
    const r = designMseWall({ ...MSE_DEFAULTS, ...SHEET, H: 10, L: 9, backslope: 0 });
    near(r.soil.heq, 3);
    near(r.soil.Ka, 0.28271491971777263, 1e-3);
    near(r.soil.KAE!, 0.3253483446987778, 1e-6);
    near(r.loads.LSV, 3.645);
    near(r.loads.EV1, 12.15);
    near(r.loads.PEH, 1.9083257080949652, 1e-3);
    near(r.loads.LSH, 1.1449954248569791, 1e-3);
    near(r.loads.PEQ!, 2.44990132671675, 1e-6);
    near(r.loads.MEQ!, 8.5893377557225, 1e-6);
    // Strength I: bearing (E97, L97, G125), eccentricity (K125), sliding (M125, O125).
    near(r.groups.StrMax.V, 22.78125);
    near(r.groups.StrMax.M, 19.560338507973395, 1e-3);
    near(r.groups.StrMax.sigma, 3.1281029426158584, 1e-3);
    near(r.groups.StrMin.e, 1.6099044039484276, 1e-3);
    near(r.groups.StrMin.H, 4.8662305556421614, 1e-3);
    near(r.checks.find((c) => c.id === "ext-slide-str")!.capacity, 7.592162625698329);
    // Extreme Event I (G97, N97, G152, K152, M152, O152).
    near(r.groups.EEMax!.V, 13.9725);
    near(r.groups.EEMax!.M, 11.451826317864949, 1e-3);
    near(r.groups.EEMax!.sigma, 1.8982298903023347, 1e-3);
    near(r.groups.EEMin!.e, 0.9425371455032879, 1e-3);
    near(r.groups.EEMin!.H, 3.02239903914524, 1e-3);
    near(r.checks.find((c) => c.id === "ext-slide-ee")!.capacity, 7.592162625698329);
  });

  it("matches the wings sheet's loads under a 2.5H:1V backslope (H = 10 ft, L = 9 ft)", () => {
    const r = designMseWall({ ...MSE_DEFAULTS, ...SHEET, H: 10, L: 9, backslope: 2.5 });
    // The sheet rounds β to 21.8°.
    near(r.soil.Ka, 0.37334611432236736, 1e-3);
    near(r.loads.EV1, 12.15);
    near(r.loads.EV2, 2.186843979828819, 1e-3);
    near(r.loads.PEH, 4.660975526746216, 1e-3);
    near(r.loads.EHH * (r.soil.h / 3), 19.618308232169948, 1e-3);
    near(r.loads.EHV * (9 / 2), 7.789213768141611, 1e-3);
    near(r.loads.PIR!, 0.5076);
    // Strength I, sliding and eccentricity (I142, K114, L114, K142).
    near(r.groups.StrMin.V, 16.933248569209354, 1e-3);
    near(r.groups.StrMin.H, 9.137565159293771, 1e-3);
    near(r.groups.StrMin.M, 27.69382865259817, 1e-3);
    near(r.groups.StrMin.e, 1.635470508769083, 1e-3);
  });

  it("refuses a backslope steeper than φ, and Mononobe–Okabe where it doesn't apply", () => {
    expect(() => designMseWall({ ...MSE_DEFAULTS, backslope: 1.5 })).toThrow(DesignError);
    expect(() => designMseWall({ ...MSE_DEFAULTS, backslope: 1.65, pga: 0.4 })).toThrow(/Mononobe/);
  });
});

describe("MSE wall, internal stability", () => {
  it("has the sheet's pullout lengths, active zone and reinforcement factors", () => {
    // Wings sheet, top layer at Z = 2.25 ft of H = 21 ft (I77, I102, L77).
    near(pulloutLength(0.9603247028838502, 0.9, 0.45192070628442593, 0.6, 0.6859227339234453, 2, 0.8), 3.5856419519604916);
    near(pulloutLength(0.9603247028838502, 0.9, 0.45192070628442593, 0.8, 0.6859227339234453, 2, 0.8), 2.6892314639703683);
    near(activeLength(true, 21, 2.25, 34, 21.8), 9.969551843652727);
    // Steel grid (C129, D129/KA) and ribbed strip (C163, D163/KA).
    const grid = layerFactors({ ...MSE_DEFAULTS, reinforcement: "steelgrid", gridTransDia: 0.375, gridTransSpacing: 4 }, 2.25);
    near(grid.Fstar, 1.76953125);
    near(grid.krKa, 0.8787634165862721 / 0.37334611432236736);
    const strip = layerFactors({ ...MSE_DEFAULTS, reinforcement: "steelstrip", phiR: 34, cu: 4 }, 2.25);
    near(strip.Fstar, 1.6752104504483394);
    near(strip.krKa, 0.6136876754173913 / 0.37334611432236736);
    // Below 20 ft: kr/Ka = 1.2 and F* = tan φ (strips), 10 t/St (grids).
    near(layerFactors({ ...MSE_DEFAULTS, reinforcement: "steelstrip" }, 25).krKa, 1.2);
    near(layerFactors({ ...MSE_DEFAULTS, reinforcement: "steelstrip", phiR: 34 }, 25).Fstar, Math.tan((34 * Math.PI) / 180));
  });

  it("puts the inextensible active zone's break at H1 = H + 0.3H tanβ / (1 − 0.3 tanβ)", () => {
    near(inextensibleH1(21, Math.atan(0.4) * (180 / Math.PI)), 21 + (0.3 * 21 * 0.4) / (1 - 0.3 * 0.4));
    near(activeLength(false, 20, 2, 34, 0), 6); // 0.3 H
    near(activeLength(false, 20, 15, 34, 0), 3); // 0.6 (H − z)
  });

  it("works each layer out by hand", () => {
    const i = { ...MSE_DEFAULTS, seismic: false };
    const r = designMseWall(i);
    const l = r.internal.layers[2];
    const Ka = Math.tan(((45 - 34 / 2) * Math.PI) / 180) ** 2;
    const S = 0.5 * 0.7 * 21 * 0.4;
    near(l.z, 6.25);
    near(l.Svi, 2.5);
    near(l.sigmaV, 0.135 * 6.25 + 0.13 * S);
    near(l.Tstr, 2.5 * Ka * (1.35 * l.sigmaV + 1.75 * 0.135 * 2));
    near(l.LA, (21 - 6.25) * Math.tan(((45 - 17) * Math.PI) / 180));
    near(l.Pr, 0.9 * 0.67 * Math.tan((34 * Math.PI) / 180) * 0.8 * l.sigmaV * 2 * 1 * (15 - l.LA));
    near(l.Tr, 0.9 * 5 * 1);
    // Tributary heights add up to the wall.
    near(r.internal.layers.reduce((s, x) => s + x.Svi, 0), 21);
  });

  it("spreads the active zone's inertia over the layers by their resistant lengths", () => {
    const r = designMseWall(MSE_DEFAULTS);
    near(r.internal.Pi, 0.0752 * 0.135 * 0.5 * 21 ** 2 * Math.tan((28 * Math.PI) / 180));
    near(r.internal.layers.reduce((s, l) => s + l.Tmd, 0), r.internal.Pi);
  });

  it("works out every reinforcement type and passes with the defaults", () => {
    for (const k of REINFORCEMENTS) {
      const r = designMseWall({ ...MSE_DEFAULTS, reinforcement: k.id } as MseInputs);
      expect(r.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual([]);
    }
  });
});

describe("MSE wall, facing panel", () => {
  // The panel sheet: 6 in panel, #5 @ 6 in each way in one mat at 2 in, f'c 4.5 ksi, w = 8.9695 kip/ft
  // over a 30 in strip spanning 30 in. The engine works per foot: the sheet's values over 2.5 ft.
  const w = 8.96953169763817;
  const Mu = (w * 2.5 ** 2) / 8 / 2.5;
  const flex = (d: number, bars = { bar: 5, spacing: 6 }) => panelFlexure({ Mu, Ms: Mu / 1.35, t: 6, d, bars, fc: 4.5, fy: 60, n: 8, exposure: 1 });
  it("has the sheet's flexural resistance, φ and minimum reinforcement", () => {
    // The sheet takes a #5 bar's area as π/4 · 0.625² = 0.307 in², the engine 0.31 in² (ASTM A615): 1% apart.
    const hp = flex(3.0625);
    near(hp.Mn, 20.413136948352143 / 2.5, 0.015);
    near(hp.MR, 18.37182325351693 / 2.5, 0.015);
    near(hp.Mcr, (1.6 * 0.67 * 7.636753236814712) / 2.5); // the sheet applies γ1 γ3 afterwards
    near(hp.Mdesign, 8.186599469865373 / 2.5);
    const vn = flex(2.3125);
    near(vn.epsT, 0.004135730972118299, 0.02);
    near(vn.phi, 0.856786548605915, 0.01);
    near(vn.MR, 12.561098258897312 / 2.5, 0.015);
  });
});
