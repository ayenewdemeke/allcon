import { describe, expect, it } from "vitest";
import { roundSection } from "./round-section";
import { columnSection } from "./column-section";
import { COLUMN_DEFAULTS, designColumn, type ColumnInputs } from "./column";
import { columnLinkFrom } from "./column-link";
import { solveFrame } from "./frame2d";
import { columnCalcLines } from "./column-calc";
import { columnTakeoff } from "./column-detail";
import { takeoffPayLines } from "../takeoff";
import { DEFAULT_SETTINGS, evaluateSheet, type SheetItem, type Value } from "@/lib/calcs/evaluate";
import { layout, type Line } from "@/lib/calcs/library/templates";
import { readingOrder } from "@/lib/calcs/types";
import { STM_DEFAULTS } from "../stm/strut-tie";
import { girderSide } from "../stm/cap-loads";
import { girderInputs } from "../kinds";
import { buildTemplate, HAMMERHEAD_DEFAULTS, MULTICOLUMN_DEFAULTS } from "../stm/templates";

const close = (a: number, b: number, tol = 0.01) => expect(Math.abs(a - b) / Math.max(1, Math.abs(b))).toBeLessThan(tol);

describe("pier column section", () => {
  it("a round section agrees with the closed-form round section's strain compatibility", () => {
    const s = columnSection({ shape: "round", T: 48, W: 48, cover: 2, bar: 10, bars: 22, barsT: 0, barsL: 0, barsEnd: 0, tieBar: 4, transverse: "spiral", fc: 4.5, fy: 60 });
    const ring = 48 - 2 * 2 - 2 * 0.5 - 1.27;
    const ref = roundSection(48, ring, 22, 1.27, 4.5, 60);
    close(s.P0, ref.P0, 0.001);
    for (const Pu of [0, 600, 1500]) {
      const r = s.resistance(Pu, 1000, 0, 1.0)!;
      const m = ref.momentAt(Pu).M;
      close(r.Mn, m, 0.02);
    }
  });

  it("a rectangle's pure bending matches the hand calculation, and the direction is kept", () => {
    // 24 x 48 in, #9 bars 4 on each long face, 2 per short face (corners only): bending across, P = 0.
    const s = columnSection({ shape: "rectangular", T: 48, W: 24, cover: 2, bar: 9, bars: 0, barsT: 4, barsL: 2, barsEnd: 0, tieBar: 4, transverse: "ties", fc: 4, fy: 60 });
    expect(s.bars.length).toBe(8);
    close(s.Ag, 1152, 1e-9);
    // Biaxial: the resisting moment points the demand's way.
    const r = s.resistance(300, 3000, 1500, 1.0)!;
    close(Math.atan2(r.MnL, r.MnT), Math.atan2(1500, 3000), 0.01);
    // Uniaxial about the strong axis exceeds the weak one.
    expect(s.resistance(0, 1, 0, 1)!.Mn).toBeGreaterThan(s.resistance(0, 0, 1, 1)!.Mn);
  });

  it("an oblong section sits between its inscribed rectangle and its bounding one", () => {
    const base = { T: 96, W: 48, cover: 2, bar: 10, bars: 0, barsT: 5, barsL: 2, barsEnd: 3, tieBar: 4, transverse: "ties" as const, fc: 4.5, fy: 60 };
    const o = columnSection({ ...base, shape: "oblong" });
    close(o.Ag, 48 * 48 + Math.PI * 24 * 24, 0.01);
    expect(o.bars.length).toBe(16);
  });
});

describe("plane frame", () => {
  it("a fixed-base cantilever under a lateral load", () => {
    const [r] = solveFrame([{ x: 0, y: 0, fixed: true }, { x: 0, y: 10 }], [{ a: 0, b: 1, EA: 1e6, EI: 1e4 }], [[{ node: 1, fx: 5 }]]);
    // Base moment 50, shear 5; tip drift PL³/3EI.
    close(Math.abs(r.ends[0][2]), 50, 1e-6);
    close(Math.abs(r.ends[0][1]), 5, 1e-6);
    close(r.d[3], (5 * 1000) / 3e4, 1e-6);
  });
});

describe("pier column calc package and take-off", () => {
  const work = (lines: Line[]) => {
    const regions = readingOrder(layout(lines, { x: 0, y: 0 }));
    const items = regions.filter((x) => x.kind !== "text" && x.kind !== "image") as SheetItem[];
    const values = new Map<string, Value>();
    const results = evaluateSheet(items, DEFAULT_SETTINGS, values);
    return regions.flatMap((x) => (results.get(x.id)?.kind === "error" ? [`${x.kind === "math" ? x.latex : x.kind}: ${(results.get(x.id) as { message: string }).message}`] : []));
  };
  const texts = (lines: Line[]) => lines.flatMap((l) => ("math" in l ? [l.math, l.ref ?? ""] : "text" in l ? [l.text] : []));

  for (const shape of ["round", "rectangular", "oblong"] as const)
    it(`${shape}: the calc package works out in Calcs, cites codes only, and its take-off is consistent`, () => {
      const stm = buildTemplate(HAMMERHEAD_DEFAULTS, { ...STM_DEFAULTS, girders: null });
      const link = columnLinkFrom("x", "Cap", stm, new Map());
      const dims = shape === "round" ? { T: 72, W: 72, bars: 30 } : shape === "rectangular" ? { T: 72, W: 48, barsT: 10, barsL: 6, transverse: "ties" as const, legsT: 4, legsL: 4 } : { T: 96, W: 48, barsT: 7, barsEnd: 5 };
      const i: ColumnInputs = { ...COLUMN_DEFAULTS, ...dims, shape, loads: "stm", link, collision: { ...COLUMN_DEFAULTS.collision, enabled: true } };
      const lines = columnCalcLines(i, "Pier 2 column");
      expect(work(lines)).toEqual([]);
      expect(texts(lines).join(" ")).not.toMatch(/allcon|fhwa|example/i);
      const t = columnTakeoff(i);
      expect(t.schedule.total).toBeGreaterThan(0);
      expect(t.schedule.concreteTotal).toBeGreaterThan(0);
      expect(t.quantities.excavation!.value).toBeGreaterThan(t.quantities.backfill!.value);
      const pay = takeoffPayLines("pier-column", t, {}, i, "cdot");
      expect(pay.map((p) => p.code)).toEqual(["601-03040", "602-00020", "206-00000", "206-00200"]);
      // Generic by default: the same quantities under MasterFormat sections.
      expect(takeoffPayLines("pier-column", t, {}, i).map((p) => p.code)).toEqual(["03 30 00", "03 21 00", "31 23 16", "31 23 23.13"]);
    });

  it("a round column's excavation is the M-206-2 frustum", () => {
    const i: ColumnInputs = { ...COLUMN_DEFAULTS, T: 48, ground: 3 };
    const t = columnTakeoff(i);
    const r = 2;
    close(t.quantities.excavation!.value * 27, (Math.PI / 3) * 3 * (r * r + r * (r + 1.5) + (r + 1.5) ** 2), 1e-9);
  });
});

describe("AASHTO detailing rules for columns", () => {
  const P0 = (r: ReturnType<typeof designColumn>) => r.section.P0;
  it("a spiral short of Eq. 5.6.4.6-1's ratio makes the column tied (0.80 φ P0), advisory not NG; enough spiral, 0.85", () => {
    const light = designColumn({ ...COLUMN_DEFAULTS, tieBar: 4, tieSpacing: 4 }); // 48 in: ρs = 0.8/(44·4) = 0.0045 < 0.0064
    expect(light.spiral).toBe(false);
    close(light.PrMax, 0.75 * 0.8 * P0(light), 1e-9);
    const c = light.checks.find((x) => x.id === "spiral-rho")!;
    expect(c.ok).toBe(true);
    expect(c.advisory).toBe(true);
    const heavy = designColumn({ ...COLUMN_DEFAULTS, tieBar: 5, tieSpacing: 3 }); // ρs = 1.24/(44·3) = 0.0094
    expect(heavy.spiral).toBe(true);
    close(heavy.PrMax, 0.75 * 0.85 * P0(heavy), 1e-9);
  });

  it("restrained bars along a tie no more than 24 in apart (5.10.4.3): cross-ties spread over each face", () => {
    const base: ColumnInputs = { ...COLUMN_DEFAULTS, shape: "rectangular", T: 72, W: 48, barsT: 10, barsL: 6, transverse: "ties", tieSpacing: 6 };
    const two = designColumn({ ...base, legsT: 2, legsL: 2 }).checks.find((x) => x.id === "tie-restrained")!;
    expect(two.ok).toBe(false); // only the corners: the whole 72 in face
    const four = designColumn({ ...base, legsT: 4, legsL: 4 }).checks.find((x) => x.id === "tie-restrained")!;
    expect(four.demand).toBeLessThanOrEqual(24);
    expect(four.ok).toBe(true);
  });

  it("collision: both 2 and 5 ft above the ground; a column 3 ft thick with over 30 ft² is exempt (3.6.5.1)", () => {
    const r = designColumn({ ...COLUMN_DEFAULTS, collision: { ...COLUMN_DEFAULTS.collision, enabled: true } });
    expect(r.collision!.heights).toEqual([2, 5]);
    expect(r.collision!.exempt).toBe(false);
    // A cantilever: the 2 ft impact's base moment is CT × (ground + 2).
    const at2 = r.collision!.rows.filter((x) => x.impact === 2 && x.where === "base" && x.angle === 0);
    expect(Math.max(...at2.map((x) => x.MT))).toBeCloseTo(600 * (COLUMN_DEFAULTS.ground + 2), 6);
    const big = designColumn({ ...COLUMN_DEFAULTS, shape: "rectangular", T: 72, W: 62, barsT: 10, barsL: 8, transverse: "ties", legsT: 4, legsL: 4, tieSpacing: 6, collision: { ...COLUMN_DEFAULTS.collision, enabled: true } });
    expect(big.collision!.exempt).toBe(true);
    expect(big.checks.filter((x) => x.id.startsWith("ct-") && x.id !== "ct-exempt").every((x) => x.advisory)).toBe(true);
  });

  it("Seismic Zone 1, SD1 ≥ 0.10: the hinge regions' spacing and confinement, detailed at the closer spacing", () => {
    const i: ColumnInputs = { ...COLUMN_DEFAULTS, tieBar: 5, tieSpacing: 6, seismic: { hinge: true, spacing: 3 } };
    const r = designColumn(i);
    expect(r.hinge!.length).toBe(Math.max(48, (20 * 12) / 6, 18));
    close(r.hinge!.sMax, 4, 1e-9);
    const conf = r.checks.find((x) => x.id === "seis-conf-0")!;
    close(conf.demand, (0.12 * 4.5) / 60, 1e-9); // Eq. 5.11.4.1.4-1
    close(conf.capacity, (4 * 0.31) / (44 * 3), 1e-9);
    const plain = columnTakeoff({ ...i, seismic: { hinge: false, spacing: 3 } });
    const seis = columnTakeoff(i);
    const spiralOf = (t: ReturnType<typeof columnTakeoff>) => t.schedule.groups.find((g) => g.use === "Spiral")!.length;
    expect(spiralOf(seis)).toBeGreaterThan(spiralOf(plain));
  });
});

describe("pier column design", () => {
  it("a hammerhead's column carries the cap's loads and their moment by statics", () => {
    const stm = buildTemplate(HAMMERHEAD_DEFAULTS, { ...STM_DEFAULTS, girders: null });
    const link = columnLinkFrom("x", "Cap", stm, new Map());
    const i: ColumnInputs = { ...COLUMN_DEFAULTS, shape: "rectangular", T: 72, W: 48, barsT: 10, barsL: 6, transverse: "ties", legsT: 4, legsL: 4, loads: "stm", link };
    const r = designColumn(i);
    const lc = link.cases[0];
    const P = lc.loads.reduce((p, l) => p - l.fy, 0);
    const M = lc.loads.reduce((p, l) => p - l.fy * (l.x - 20), 0);
    const base = r.rows.find((x) => x.case === lc.name && x.where === "base")!;
    close(base.P, P + 1.25 * 0.15 * ((72 * 48) / 144) * 20, 1e-6);
    close(Math.abs(base.MT), Math.abs(M), 1e-4);
    expect(r.checks.length).toBeGreaterThan(10);
  });

  it("along the bridge: braking, wind and temperature from the girder design, at the bearings", () => {
    const g = { ...girderInputs({}), nGirders: 4, S: 6, overhang: 3, barrierWidth: 1.5, site: { V: 115, exposure: "C" as const, Z: 30, barrierHeight: 2.67 } };
    const glink = { enabled: true, wind: { enabled: true }, back: girderSide(g, 0, "g", "Span 1"), ahead: null, x0: 20, reverse: false, loadNodes: [], selfWeight: true, soffit: 0, wc: 0.15 };
    const stm = buildTemplate(HAMMERHEAD_DEFAULTS, { ...STM_DEFAULTS, girders: glink });
    const link = columnLinkFrom("x", "Cap", stm, new Map([["g", g]]));
    expect(link.wind).toBe(true);
    const b = link.bridge!;
    expect(b.length).toBe(g.L);
    expect(b.lanes).toBe(Math.floor((3 * 6 + 6 - 3) / 12));
    const i: ColumnInputs = { ...COLUMN_DEFAULTS, T: 60, W: 60, bars: 24, loads: "stm", link, longitudinal: { ...COLUMN_DEFAULTS.longitudinal, share: 0.5, distance: 100 } };
    const r = designColumn(i);
    close(r.long.BR, b.braking * 0.5, 1e-9);
    // The usual girder bridge (span ≤ 150 ft, Z ≤ 33 ft): longitudinal wind 25% of the transverse.
    expect(r.long.coefLong).toBe(0.25);
    close(r.long.WS5, 0.25 * b.lineV * b.length * 0.5, 1e-9);
    close(r.long.TU, r.long.kCol * 6e-6 * 40 * 1200, 1e-9);
    // Strength I's moment along the bridge at the base: BR at 1.75 and TU at 0.5, over the column and the cap to the bearings.
    const s1 = r.rows.find((x) => x.limit === "Strength I" && x.where === "base" && !x.case.includes("minimum"))!;
    close(s1.ML, (1.75 * r.long.BR + 0.5 * r.long.TU) * (i.height + link.capDepth), 1e-9);
  });

  it("a bent's columns share the cap's load, and the collision toggle adds Extreme Event II", () => {
    const stm = buildTemplate(MULTICOLUMN_DEFAULTS, { ...STM_DEFAULTS, girders: null });
    const link = columnLinkFrom("x", "Bent", stm, new Map());
    const i: ColumnInputs = { ...COLUMN_DEFAULTS, T: 42, W: 42, bars: 16, bar: 9, loads: "stm", link, K: { T: 1.2, L: 2.1 }, collision: { ...COLUMN_DEFAULTS.collision, enabled: true } };
    const r = designColumn(i);
    const lc = link.cases[0];
    const total = lc.loads.reduce((p, l) => p - l.fy, 0);
    const sum = r.rows.filter((x) => x.case === lc.name && x.where === "top").reduce((p, x) => p + x.P, 0);
    close(sum, total, 1e-4);
    expect(r.checks.some((c) => c.id === "ct-pm")).toBe(true);
    expect(r.collision!.Vt).toBeGreaterThan(0);
  });
});
