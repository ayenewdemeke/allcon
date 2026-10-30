import { describe, expect, it } from "vitest";
import { CASES, CBC_DEFAULTS, designCbc, type CbcInputs } from "./cbc";

// The engine against MnDOT's 10'×10' precast box culvert example (Bridge Design Manual 12.5),
// whose moments come from a commercial frame program: the frame here agrees within 1–2%.

const within = (a: number, b: number, rel: number, abs = 0.5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(abs, rel * Math.abs(b)));
/** The example: precast, welded wire (fy 65 ksi, 4 in spacing, 1 in assumed for d). */
const PRECAST: CbcInputs = { ...CBC_DEFAULTS, construction: "precast", phiF: 1.0, phiV: 0.9, reinf: "wwr", fy: 65 };
const EXAMPLE: CbcInputs = { ...PRECAST, steel: { ...PRECAST.steel, topIn: 0.64, botIn: 0.7 } };

// Table 12.5.2, unfactored moments (kip-in): DC, EV, EHmax, EHmin, LS, WA, LL+IM pos, LL+IM neg.
const TABLE: [string, number[]][] = [
  ["Left wall, top (haunch tip)", [-4.31, -44.97, -4.84, -2.42, 0.36, 4.13, 0, -21.57]],
  ["Left wall, center", [-11.06, -39.44, 63.02, 31.51, 10.7, -26.77, 0, -18.82]],
  ["Left wall, bottom (haunch tip)", [-17.73, -33.97, -4.8, -2.4, -1.93, 2.32, 0, -16.21]],
  ["Top slab, center", [17.19, 89.03, -50.54, -25.27, -9.3, 19.93, 42.49, 0]],
  ["Top slab, left end (haunch tip)", [6.39, 12.6, -50.54, -25.27, -9.3, 19.93, 7.93, -2.35]],
  ["Bottom slab, center", [38.43, 103.87, -70.62, -35.31, -11.09, 28.7, 49.57, 0]],
  ["Bottom slab, left end (haunch tip)", [5.5, 27.43, -70.62, -35.31, -11.09, 32.45, 14.47, 0]],
];

describe("Box culvert, the MnDOT example", () => {
  const r = designCbc(EXAMPLE);
  const idx = (name: string) => r.model.stations.findIndex((s) => s.name === name);

  it("has the example's loads", () => {
    within(r.loads.DCbottom, 0.343, 0.002, 0);
    within(r.loads.Fe, 1.11, 0.005, 0); // the example rounds Ts to 0.67 ft
    within(r.loads.EHbot.max, 1.05, 0.005, 0);
    within(r.loads.heq1, 3.8, 1e-9, 0);
    within(r.loads.heq2, 2.24, 0.002, 0);
    within(r.loads.LStop, 0.15, 0.005, 0);
    within(r.loads.WAbot, 0.624, 1e-9, 0);
    within(r.live.IM, 0.083, 0.01, 0);
    within(r.live.vehicles.find((v) => v.id === "truck")!.w, 0.369, 0.002, 0);
    within(r.live.vehicles.find((v) => v.id === "tandem")!.w, 0.38, 0.002, 0);
  });

  it("has Table 12.5.2's moments from its frame", () => {
    for (const [name, row] of TABLE) {
      const m = idx(name);
      expect(m, name).toBeGreaterThanOrEqual(0);
      CASES.forEach((c, k) => within(r.unfactored[c.id][m].M * 12, row[k], 0.02));
      // The table leaves out ("–") the live load effects it didn't need.
      if (row[6]) within(r.env[m].pos.M * 12, row[6], 0.03);
      if (row[7]) within(r.env[m].neg.M * 12, row[7], 0.03);
    }
  });

  it("designs the members as the example does (Table 12.5.7 and the shear and thrust checks)", () => {
    const check = (id: string) => r.checks.find((c) => c.id === id)!;
    within(check("wall-out-flex").demand * 12, 110.74, 0.01);
    within(check("wall-in-flex").demand * 12, 64.29, 0.01);
    within(check("top-in-flex").demand * 12, 215.66, 0.01);
    within(check("top-out-flex").demand * 12, 71.37, 0.01);
    within(check("bottom-in-flex").demand * 12, 275.01, 0.01);
    within(check("bottom-out-flex").demand * 12, 91.06, 0.01);
    // Required steel: 0.321 (wall outside), 0.54 (top inside), 0.60 (bottom inside) in²/ft.
    const needs = (id: string) => Number(/needs ([\d.]+)/.exec(check(id).note!)![1]);
    within(needs("wall-out-flex"), 0.321, 0.02, 0);
    within(needs("top-in-flex"), 0.54, 0.02, 0);
    within(needs("bottom-in-flex"), 0.6, 0.02, 0);
    // Crack control with the example's final steel: fs at its limit (37.63 and 39.00 ksi).
    within(check("top-in-crack").capacity, 37.63, 0.001, 0);
    within(check("top-in-crack").demand, 37.64, 0.01, 0);
    within(check("bottom-in-crack").demand, 39.0, 0.01, 0);
    within(check("wall-out-crack").capacity, 35.37, 0.001, 0);
    // Shear (8.79, 14.88, 17.17 kips) and thrust (11.44 vs 33.6 kips).
    within(check("wall-shear").capacity, 8.79, 0.002, 0);
    within(check("top-shear").demand, 6.61, 0.01, 0);
    within(check("top-shear").capacity, 14.88, 0.002, 0);
    within(check("bottom-shear").demand, 7.36, 0.01, 0);
    within(check("bottom-shear").capacity, 17.17, 0.002, 0);
    within(check("wall-thrust").demand, 11.44, 0.01, 0);
    within(check("wall-thrust").capacity, 33.6, 1e-9, 0);
  });

  it("has the example's crack control stress at its first try (0.54 in²/ft: 44.60 ksi)", () => {
    const r54 = designCbc({ ...EXAMPLE, steel: { ...EXAMPLE.steel, topIn: 0.54 } });
    within(r54.checks.find((c) => c.id === "top-in-crack")!.demand, 44.6, 0.01, 0);
  });

  it("passes with the example's steel rounded up (0.65, 0.71 in²/ft)", () => {
    expect(designCbc(PRECAST).checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([]);
  });

  it("passes with the defaults: cast in place, bars", () => {
    const r = designCbc(CBC_DEFAULTS);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([]);
    // #6 @ 6 in: 0.88 in²/ft, d = 9 − 2 − 0.375 in.
    const g = r.governs.find((x) => x.face === "topIn")!;
    within(g.As, 0.88, 1e-9, 0);
    within(g.flex.flex.d, 6.625, 1e-9, 0);
    within(g.crack!.crack!.fss, Math.min(525 / ((1 + 2.375 / (0.7 * 6.625)) * (6 + 4.75)), 36), 1e-9, 0);
    expect(r.checks.find((c) => c.id === "top-in-spacing")?.capacity).toBe(13.5);
  });

  it("checks the bar spacing (AASHTO 5.10.3.2)", () => {
    const r = designCbc({ ...CBC_DEFAULTS, bars: { ...CBC_DEFAULTS.bars, topOut: { bar: 8, spacing: 15 } } });
    expect(r.checks.find((c) => c.id === "top-out-spacing")?.ok).toBe(false);
  });
});

describe("Box culvert, more cells", () => {
  it("is symmetric, and the interior wall carries the middle under symmetric loads", () => {
    const r = designCbc({ ...CBC_DEFAULTS, cells: 2 });
    const st = r.model.stations;
    const m = (name: string) => r.unfactored.EV[st.findIndex((s) => s.name === name)];
    expect(Math.abs(m("Interior wall, center").M)).toBeLessThan(1e-6);
    within(m("Top slab (cell 1), center").M, m("Top slab (cell 2), center").M, 1e-6, 1e-9);
    // Vertical equilibrium: the walls carry the EV on the top slab.
    const N = st.filter((s) => s.role === "center" && (s.kind === "wall" || s.kind === "iwall")).reduce((sum, s) => sum + r.unfactored.EV[st.indexOf(s)].N, 0);
    within(N, r.loads.EV * r.model.B, 1e-6, 1e-9);
    // Over the interior wall the top slab hogs.
    expect(m("Top slab (cell 1), right end (haunch tip)").M).toBeLessThan(0);
  });

  it("works out three and four cells", () => {
    for (const cells of [3, 4]) {
      const r = designCbc({ ...CBC_DEFAULTS, cells, span: 8, rise: 6 });
      expect(r.model.stations.filter((s) => s.kind === "iwall" && s.role === "center")).toHaveLength(cells - 1);
      expect(r.checks.length).toBeGreaterThan(20);
    }
  });

  it("distributes live load under shallow fill by the strip method", () => {
    const r = designCbc({ ...CBC_DEFAULTS, span: 16, rise: 12, Tt: 12, Tb: 11, fill: 1 });
    // AASHTO 4.6.2.10 (as MnDOT's 12.6 example): E = 96 + 1.44 S = 119 in, Espan = 10 + 1.15·12 = 23.8 in, IM = 29%; lane load on a 16 ft span.
    within(r.live.Wp * 12, 119.04, 1e-6, 0);
    within(r.live.Lp * 12, 23.8, 1e-6, 0);
    within(r.live.IM, 0.28875, 1e-6, 0);
    expect(r.live.lane).toBe(true);
  });
});
