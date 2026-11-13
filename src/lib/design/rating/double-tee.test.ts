import { describe, expect, it } from "vitest";
import fixtures from "./cdot-bridges.json";
import { DT_DEFAULTS, dtInputsFromBridgeFile, isSidewalkTruckCase, rateDoubleTee, type DtInputs } from "./double-tee";
import { CDOT_VEHICLES, laneAt, tons, trainAt, trainMax } from "./vehicles";

// The double-tee LFR rating, against the rating scripts' results for five CDOT bridges without plans
// (cdot-bridges.json: their inputs, and the prestress and ratings the scripts worked out by the
// midspan hand method). The tool's own analysis rates every point of interest; with the back-
// calculation at midspan it must reproduce those results exactly.

const near = (a: number, b: number, rel = 1e-9, label = "") => expect(Math.abs(a - b), `${label} ${a} vs ${b}`).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));
const gname = (n: string) => n.replace(" mnt", " (trucks on sidewalk)");

describe("vehicles", () => {
  it("weigh what CDOT posts: Type 3 27 T, 3S2 42.5 T, the permit 96 T, HS-20 36 T", () => {
    const w = Object.fromEntries(CDOT_VEHICLES.map((v) => [v.name, tons(v)]));
    // The permit's three 10.84 kip wheel lines sum to 96.02 T; CDOT posts it as 96 T.
    [36, 27, 42.5, 96].forEach((t, k) => expect(w[["HS-20", "CO Type 3", "CO Type 3S2", "CO Permit"][k]]).toBeCloseTo(t, k === 3 ? 1 : 9));
  });
  it("give the CDOT workbook's moment at 32.75 ft: HS-20 162.10 kip·ft (0.1%)", () => {
    near(trainMax(CDOT_VEHICLES[0], 32.75).M, 162.1, 1e-3, "HS-20");
  });
  it("moment at midspan by influence line: a single wheel load P·L/4; the lane load wL²/8 + PL/4", () => {
    near(trainAt({ P: [10], S: [] }, 40, 20).M, 100, 1e-9);
    near(laneAt(40, 20).M, (0.32 * 1600) / 8 + (9 * 40) / 4, 1e-12);
  });
});

type Expected = {
  nStrands: number; Pj: number; gov: string; govRF: number; crackGoverns: boolean; M_HS20: number;
  girders: { name: string; dfMulti: number; dfSingle: number; Mnow: number; Mn: number }[];
  ratings: { name: string; Mw: number; gov: string; per: { g: string; inv: number; opr: number }[] }[];
};
it("sets the prestress with trucks between the curbs, then rates trucks on a mountable sidewalk with it", () => {
  const i: DtInputs = { ...DT_DEFAULTS, span: 22, structureLength: 23, loads: { ...DT_DEFAULTS.loads, sidewalks: [{ width: 5, thk: 8 }], sidewalkMountable: true, pedestrians: true } };
  const r = rateDoubleTee(i);
  expect(isSidewalkTruckCase(r.solve.gov)).toBe(false);
  const hs = r.ratings[0];
  for (const p of hs.per.filter((x) => !isSidewalkTruckCase(x.g))) expect(p.flexInv.inv).toBeGreaterThanOrEqual(1 - 1e-9);
  expect(hs.per.some((x) => isSidewalkTruckCase(x.g))).toBe(true);
});

describe("curbs", () => {
  const base: DtInputs = { ...DT_DEFAULTS, span: 24, structureLength: 25, roadway: { ...DT_DEFAULTS.roadway, curbToCurb: 27.5, curbFaceOffset: 15 } };
  const curbs = { ...base, loads: { ...base.loads, sidewalks: [{ width: 1.25, thk: 11, curb: true }, { width: 1.25, thk: 11, curb: true }] } };
  it("carry dead load on their exterior unit without a deck, but no pedestrians and no trucks on them", () => {
    const r = rateDoubleTee(curbs);
    const g1 = r.girders.find((g) => g.name === "G1")!;
    expect(g1.dlNow.sidewalk).toBeCloseTo(1.25 * (11 / 12) * 0.15, 6);
    expect(r.girders.find((g) => g.name === "G2")!.dlNow.sidewalk).toBe(0);
    expect(r.ped.pedKlf).toBe(0);
    expect(r.ped.mountable).toBe(false);
    expect(r.girders.some((g) => g.name.includes("trucks on sidewalk"))).toBe(false);
  });
  it("the same entries as sidewalks carry pedestrians and are mountable", () => {
    const r = rateDoubleTee({ ...curbs, loads: { ...curbs.loads, sidewalks: curbs.loads.sidewalks.map(({ width, thk }) => ({ width, thk })) } });
    expect(r.ped.pedKlf).toBeGreaterThan(0);
    expect(r.ped.mountable).toBe(true);
  });
});

it("ignores the final tension when asked, for a back-calculated prestress only (BRM 1.7.2)", () => {
  const i: DtInputs = { ...DT_DEFAULTS, options: { ...DT_DEFAULTS.options, ignoreTension: true } };
  const r = rateDoubleTee(i);
  const hs = r.ratings[0];
  expect(hs.per.flatMap((p) => p.points).some((q) => q.check === "tension")).toBe(false);
  expect(hs.govInv.inv.inv).toBeGreaterThanOrEqual(1 - 1e-9);
  expect(hs.govInv.inv.check).toBe("flexure");
  const known = rateDoubleTee({ ...i, prestress: { mode: "known", strands: r.solve.nStrands } });
  expect(known.ratings[0].per.flatMap((p) => p.points).some((q) => q.check === "tension")).toBe(true);
});

describe.each(fixtures as unknown as { name: string; bridge: Record<string, unknown>; expected: Expected }[])("CDOT bridge $name", (f) => {
  const base = dtInputsFromBridgeFile(f.bridge);
  const hand: DtInputs = { ...base, options: { ...base.options, solveAt: "midspan", poi: "tenth-and-max" } };
  const r = rateDoubleTee(hand);
  const e = f.expected;

  it("back-calculates the same strands and BrR force (midspan, as the scripts)", () => {
    near(r.solve.nStrands, e.nStrands, 1e-9, "strands");
    // The scripts floored 15 × 0.144 × 175 = 377.99… (floating point) to 377 kip; it's 378.
    expect(r.solve.Pj).toBe(f.name === "AUR07.0-H.0" ? 378 : e.Pj);
    // The prestress is set with trucks between the curbs; where the scripts let trucks on a mountable
    // sidewalk govern, it's now rated with that prestress instead (the same whole strands here).
    if (isSidewalkTruckCase(gname(e.gov))) {
      expect(isSidewalkTruckCase(r.solve.gov)).toBe(false);
      expect(r.solve.govRF).toBeGreaterThanOrEqual(1);
    } else {
      expect(r.solve.gov).toBe(gname(e.gov));
      near(r.solve.govRF, e.govRF, 1e-9, "governing RF");
    }
    expect(r.solve.crackGoverns).toBe(e.crackGoverns);
    near(r.M_HS20, e.M_HS20, 1e-9, "HS-20 moment");
  });
  it("has the same distribution factors, dead loads and capacities for every girder", () => {
    for (const g of e.girders) {
      const ours = r.girders.find((x) => x.name === gname(g.name))!;
      near(ours.dfMulti, g.dfMulti, 1e-12, `${g.name} DF multi`);
      near(ours.dfSingle, g.dfSingle, 1e-12, `${g.name} DF single`);
      const mid = r.midspan[0].per.find((x) => x.g === ours.name)!;
      near(mid.D, g.Mnow, 1e-12, `${g.name} dead load`);
      near(mid.C, g.Mn, 1e-12, `${g.name} Mn`);
    }
  });
  it("rates every vehicle and girder the same at midspan", () => {
    for (const ev of e.ratings) {
      const ours = r.midspan.find((x) => x.name === ev.name)!;
      near(ours.Mw, ev.Mw, 1e-12, `${ev.name} moment`);
      for (const p of ev.per) {
        const o = ours.per.find((x) => x.g === gname(p.g))!;
        near(o.inv, p.inv, 1e-9, `${ev.name} ${p.g} inv`);
        near(o.opr, p.opr, 1e-9, `${ev.name} ${p.g} opr`);
      }
      expect(ours.gov.g).toBe(gname(ev.gov));
    }
  });
  it("the full analysis's flexure ratings at the points of interest are no lower than the midspan hand method's", () => {
    for (const rt of r.ratings) {
      const mid = r.midspan.find((x) => x.name === rt.name)!;
      for (const p of rt.per) {
        const m = mid.per.find((x) => x.g === p.g)!;
        // Each vehicle's own maximum is a point of interest; the dead load there is no more than at midspan.
        expect(p.flexOpr.opr!, `${rt.name} ${p.g}`).toBeGreaterThanOrEqual(m.opr - 1e-9);
        expect(p.flexOpr.opr!, `${rt.name} ${p.g}`).toBeLessThanOrEqual(m.opr * 1.02);
      }
    }
  });
});

describe("the back-calculation over the points of interest (as BrR rates)", () => {
  it("rates HS-20 inventory at exactly 1.0 in flexure before rounding to whole strands", () => {
    const i: DtInputs = { ...DT_DEFAULTS, options: { ...DT_DEFAULTS.options, roundStrands: false } };
    const r = rateDoubleTee(i);
    near(r.solve.govRF, 1, 1e-6, "RF");
    const hs = r.ratings.find((x) => x.name === "HS-20")!;
    near(Math.min(...hs.per.map((p) => p.flexInv.inv)), 1, 1e-6, "flexure inventory");
  });
  it("with whole strands rates HS-20 inventory at 1.0 or a little more", () => {
    const r = rateDoubleTee(DT_DEFAULTS);
    expect(r.solve.govRF).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(Number.isInteger(Math.round(r.solve.nStrands * 1e9) / 1e9)).toBe(true);
  });
});
