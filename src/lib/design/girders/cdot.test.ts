import { describe, expect, it } from "vitest";
import { trainAt, CDOT_VEHICLES } from "./vehicles";
import type { Check } from "../walls/cip";
import { CDOT, designGirder, GIRDER_DEFAULTS, governingRatio, STRENGTH_II_VEHICLES, type GirderInputs, type StrandRow } from "./prestressed";
import { girderCalcLines } from "./prestressed-calc";

// The CDOT Bridge Design Manual criteria (criteria: "cdot"), and a benchmark against PGSuper 8.0.8 with a
// "CDOT" project criteria (AASHTO LRFD 10th ed. with the BDM): a three-span CBT-54 bridge, 6 girders at
// 7.2 ft, spans 61-126-61 ft bearing to bearing, envelope analysis, 52 strands in the center span.

const endRows: StrandRow[] = [{ y: 2.25, count: 16 }, { y: 4.25, count: 4 }];
const midRows: StrandRow[] = [
  { y: 2.25, count: 16, debonded: 4, debondLength: 8 },
  { y: 4.25, count: 16, debonded: 2, debondLength: 14 },
  { y: 6.25, count: 4 },
];
const harped = { count: 16, yEnd: 43, yHarp: 9.25, harpPoint: 0.4 };
const bridge = (over: Partial<GirderInputs> = {}): GirderInputs => ({
  ...GIRDER_DEFAULTS,
  shape: "cbt-54",
  L: 61,
  nGirders: 6,
  S: 7.2,
  overhang: 3.5,
  barrierWidth: 1.5,
  deckT: 8,
  sacrificial: 0.5,
  haunch: 6.5,
  fcDeck: 4.5,
  fci: 6.5,
  fc: 8.5,
  wc: 0.155,
  strands: endRows,
  harped: { ...harped, count: 0 },
  humidity: 55,
  tDeck: 122,
  tContinuity: 121,
  diaphragmWeight: 2.53,
  barrierWeight: 0.48,
  fws: 36.75,
  stirrups: [
    { length: 20 / 12, bar: 6, legs: 2, spacing: 2.5 },
    { length: 44 / 12, bar: 4, legs: 2, spacing: 4 },
    { length: 10, bar: 4, legs: 2, spacing: 6 },
    { length: 11, bar: 4, legs: 2, spacing: 12 },
    { length: 0, bar: 4, legs: 2, spacing: 18 },
  ],
  extraSpans: [
    { L: 126, strands: midRows, harped },
    { L: 61, strands: endRows, harped: { ...harped, count: 0 } },
  ],
  pierBearingOffset: 2,
  pierBars: { topBar: 9, topSpacing: 5.45, botBar: 4, botSpacing: 5.1, coverTop: 2.5, coverBottom: 2 },
  connection: { count: 10, bar: 6, y: 3 },
  handling: { ...GIRDER_DEFAULTS.handling, liftPoint: 3, bunkPoint: 6 },
  criteria: "cdot",
  continuity: "envelope",
  ...over,
});
const at = (d: ReturnType<typeof designGirder>, span: number, side: "interior" | "exterior", label = "0.5L") => d.spans[span][side].stations.find((s) => s.label === label)!;
const check = (d: ReturnType<typeof designGirder>, span: number, side: "interior" | "exterior", id: string) => d.spans[span][side].checks.find((c) => c.id === id);

describe("CDOT criteria", () => {
  it("Strength II vehicles: the permit truck's axles are twice the rating workbook's wheel lines (96 T)", () => {
    const permit = STRENGTH_II_VEHICLES.find((v) => v.name === "Colorado Permit Vehicle")!;
    expect(permit.axles.reduce((s, a) => s + a.P, 0)).toBeCloseTo(192.04, 2);
    expect(permit.axles.map((a) => a.d)).toEqual([0, 14, 18, 30, 34, 69, 73, 77]);
  });

  it("a simple span: Strength II moment from the permit truck with IM 33% and the distribution factor", () => {
    const i = bridge({ extraSpans: [], L: 126, strands: midRows, harped, continuity: "auto" });
    const d = designGirder(i);
    const s = at(d, 0, "exterior");
    const v = CDOT_VEHICLES.find((x) => x.name === "CO Permit")!;
    const perLane = 2 * trainAt(v, 126, s.x, 0.05).M * 1.33;
    expect(s.strengthII!.Mll).toBeCloseTo(perLane * d.exterior.df.moment, -1);
    expect(s.Mu).toBeCloseTo(Math.max(s.strengthII!.Mu, s.Mu), 6);
  });

  it("checks the BDM's limits: f′ci, f′c, hold-down per strand, no tension under dead load", () => {
    const d = designGirder(bridge({ fci: 7, fc: 9 }));
    expect(check(d, 1, "interior", "cdot-fci")!.ok).toBe(false);
    expect(check(d, 1, "interior", "cdot-fc")!.ok).toBe(false);
    const hd = check(d, 1, "interior", "hold-down")!;
    const Lg = 126 + 2 * 0.75;
    const slope = (43 - 9.25) / (0.4 * Lg * 12);
    expect(hd.demand).toBeCloseTo(0.75 * 270 * 0.217 * Math.sin(Math.atan(slope)), 6);
    expect(hd.capacity).toBe(CDOT.holdDownPerStrand);
    expect(check(d, 1, "interior", "cdot-dl-tension")).toBeTruthy();
    expect(check(designGirder(bridge({ criteria: "aashto" })), 1, "interior", "hold-down")).toBeUndefined();
  });

  it("continuity: no restraint moments; fully effective only at 60 days or more (BDM 5.7.2, 5.7.3)", () => {
    const at60 = designGirder(bridge({ continuity: "auto", tContinuity: 60 }));
    expect(at60.restraint!.interior.Mr.every((m) => m === 0)).toBe(true);
    expect(at60.restraint!.interior.effective.every(Boolean)).toBe(true);
    const at59 = designGirder(bridge({ continuity: "auto", tContinuity: 59, tDeck: 59 }));
    expect(at59.restraint!.interior.effective.slice(1, -1).some((e) => !e)).toBe(true);
    // An ineffective joint: the positive moment at least the simple span's.
    expect(at(at59, 1, "interior").Mdc2).toBeGreaterThan(at(at60, 1, "interior").Mdc2);
    // The positive moment connection resists 1.2 Mcr.
    const conn = at60.piers[0].interior.checks.find((c) => c.id === "conn-strength")!;
    expect(conn.ref).toBe("CDOT BDM 5.7.2");
  });

  it("matches PGSuper's CDOT criteria (envelope analysis) at the 126 ft span's midspan", () => {
    const d = designGirder(bridge());
    for (const [side, pg] of [
      ["exterior", { bot: 5.69, Mu: 11194, svc3: 0.554 }],
      ["interior", { bot: 5.427, Mu: 10336, svc3: null }],
    ] as const) {
      const g = d.spans[1][side];
      const m = at(d, 1, side);
      const Mnc = (m.Mg + m.Mdeck) * 12;
      const Mc = (m.Mdc2 + m.Mdw + m.Mll) * 12;
      const loadBot = Mnc / g.g.Sb + Mc / g.comp.Sbc;
      // PGSuper's interior moment distribution factor is 0.583 against allcon's 0.601 (span and deck in Kg).
      expect(Math.abs(loadBot / pg.bot - 1)).toBeLessThan(side === "exterior" ? 0.005 : 0.02);
      expect(Math.abs(m.Mu / pg.Mu - 1)).toBeLessThan(0.02);
      expect(m.strengthIIGoverns).toBe(true);
      // PGSuper: exterior Service III tension at its limit (rating factor 1.00).
      if (pg.svc3) expect(Math.max(0, -m.service.botIII)).toBeCloseTo(pg.svc3, 2);
    }
  });
});

describe("the governing span and girder", () => {
  const c = (id: string, demand: number, capacity: number): Check => ({ id, name: id, demand, capacity, unit: "", ref: "", ok: demand <= capacity });
  it("ranks load effects, not inputs sitting at their limits", () => {
    // Jacking at 0.75 fpu, f′c at CDOT's cap and #3 confinement are 1.00 by input: they don't decide.
    const checks = [c("fpj", 202.5, 202.5), c("cdot-fc", 8.5, 8.5), c("conf-bar", 3, 3), c("svc-tens", 0.5, 0.554), c("lift-comp", 4.0, 4.225)];
    expect(governingRatio(checks, false)).toBeCloseTo(4.0 / 4.225, 9);
    // Lifting is the same on every girder, so it doesn't choose between them.
    expect(governingRatio(checks, true)).toBeCloseTo(0.5 / 0.554, 9);
    // A prescriptive check that fails always counts.
    expect(governingRatio([...checks, c("cdot-fci", 7, 6.5)], true)).toBeCloseTo(7 / 6.5, 9);
  });

  it("picks D-11-Z's 126 ft center span and exterior girder, and the calc package works that case out", () => {
    // End spans with 28 strands, so that nothing fails (20 sag under BDM 5.5.2.1 G, below).
    const ends: StrandRow[] = [{ y: 2.25, count: 16 }, { y: 4.25, count: 12 }];
    const b = bridge({ haunchMode: "computed", strands: ends, extraSpans: [{ L: 126, strands: midRows, harped: { ...harped, yEnd: 41 } }, { L: 61, strands: ends, harped: { ...harped, count: 0 } }] });
    const d = designGirder(b);
    const fails = [...d.spans.flatMap((s) => [s.interior, s.exterior].flatMap((g) => g.checks.filter((c) => !c.ok && !c.advisory).map((c) => `S${s.index + 1} ${c.id}`))), ...d.piers.flatMap((p) => [p.interior, p.exterior].flatMap((g) => g.checks.filter((c) => !c.ok).map((c) => `P${p.index} ${c.id}`)))];
    expect(fails).toEqual([]);
    expect(d.controllingSpan).toBe(1);
    expect(d.controlling).toBe("exterior");
    const text = JSON.stringify(girderCalcLines(b, "D-11-Z"));
    expect(text).toContain("this is span 2.");
    expect(text).toContain("Exterior girder, moment");
  });
});

describe("CDOT BDM 5.5 and sheet B-618-CBT2", () => {
  it("limits the harp height, the bed's force, harped strands in short girders and the stirrup spacing", () => {
    const d = designGirder(bridge());
    const mid = d.spans[1].interior;
    const hh = mid.checks.find((c) => c.id === "harp-height")!;
    // 16 harped strands in pairs at 2 in, centroid 43 in at the end: the top pair at 50 in, past 54 − 6 = 48 in.
    expect(hh.demand).toBeCloseTo(50, 9);
    expect(hh.capacity).toBe(48);
    expect(hh.ok).toBe(false);
    expect(check(d, 1, "interior", "bed-force")!.demand).toBeCloseTo(52 * 0.217 * 202.5, 6);
    expect(check(d, 1, "interior", "s-max")!.capacity).toBeLessThanOrEqual(CDOT.maxStirrupSpacing);
    // A 90 ft girder with harped strands.
    const short = designGirder(bridge({ L: 90, extraSpans: [], harped: { ...harped, count: 8 }, strands: midRows }));
    expect(short.interior.checks.find((c) => c.id === "harp-span")!.ok).toBe(false);
  });

  it("makes lifting and hauling the fabricator's (information only) and checks the shipping limits", () => {
    const d = designGirder(bridge());
    const g = d.spans[1].exterior;
    const handling = g.checks.filter((c) => /^(lift|haul)-/.test(c.id));
    expect(handling.length).toBeGreaterThan(5);
    expect(handling.every((c) => c.advisory)).toBe(true);
    expect(g.checks.some((c) => c.id === "haul-weight" || c.id === "haul-span")).toBe(false);
    const ship = g.checks.find((c) => c.id === "ship-length")!;
    expect(ship.capacity).toBe(154);
    expect(ship.advisory).toBeFalsy();
    // An advisory check over its limit doesn't fail the girder.
    const over = { ...g, checks: g.checks.map((c) => (c.advisory ? { ...c, ok: false } : c)) };
    expect(over.checks.every((c) => c.ok || c.advisory)).toBe(g.checks.every((c) => c.ok || c.advisory));
  });

  it("works out the camber at 60 days, the no-sag rule and the haunch (BDM 5.5.2.1)", () => {
    const given = designGirder(bridge());
    const end = given.spans[0].interior;
    expect(end.camber.age).toBe(60);
    // The 61 ft end spans' 20 straight strands: a camber under 1 in, with a tolerance of at least 1 in, sags.
    expect(end.camber.cDeck).toBeLessThan(1);
    expect(end.haunch.tolerance).toBe(1);
    expect(end.checks.find((c) => c.id === "no-sag")!.ok).toBe(false);
    // Computed: the least haunch at the supports keeps both minimums; Eq. 5.1 with an under-cambered girder.
    const d = designGirder(bridge({ haunchMode: "computed", crossSlope: 0.02 }));
    const h = d.spans[1].exterior.haunch;
    const c = d.spans[1].exterior.camber;
    expect(h.tolerance).toBeCloseTo(0.3 * c.cDeck, 9);
    expect(h.cross).toBeCloseTo((0.02 * 50) / 2, 9);
    expect(h.D1! % 0.25).toBeCloseTo(0, 9);
    expect(h.D2!).toBeCloseTo(h.D1! - (c.cDeck + c.dTotal), 9);
    expect(h.D2over! - h.cross).toBeGreaterThanOrEqual(-1e-9);
    expect(h.D2over! - h.cross).toBeLessThan(0.25 + 1e-9); // the least D1
    expect(h.design).toBeCloseTo((2 * h.D1! + 10 * (h.D2! + h.tolerance)) / 12, 9);
    // The loads carry the settled haunch: designing again with it as given changes nothing.
    const again = designGirder(bridge({ haunch: h.design }));
    expect(again.spans[1].exterior.camber.dDeck).toBeCloseTo(c.dDeck, 2);
  });
});

describe("AASHTO LRFD 10th ed. 5.9.4.3.3 debonding", () => {
  it("allows 6 terminations at a section only past ten debonded strands, and bonds the strands within a CBT's web", () => {
    const rows: StrandRow[] = [{ y: 2.25, count: 16, debonded: 6, debondLength: 8 }, { y: 4.25, count: 16 }, { y: 6.25, count: 4 }];
    const d = designGirder(bridge({ extraSpans: [{ L: 126, strands: rows, harped }, { L: 61, strands: endRows, harped: { ...harped, count: 0 } }] }));
    const g = d.spans[1].interior;
    // 6 debonded (ten or fewer): at most 4 end at one section (B).
    const sec = g.checks.find((c) => c.id === "deb-section")!;
    expect(sec.capacity).toBe(4);
    expect(sec.ok).toBe(false);
    // bf/bw = 39.5/7 > 4: the 4 strands within the web and the 2 outermost stay bonded, so 10 of 16 may be debonded (I).
    expect(g.checks.find((c) => c.id === "deb-outer")!.capacity).toBe(10);
    // No 25% cap on all strands any more.
    expect(g.checks.some((c) => c.id === "deb-total")).toBe(false);
    // G: within min(0.2 L, L/2 − ℓd).
    expect(g.checks.find((c) => c.id === "deb-max")!.capacity).toBeCloseTo(Math.min(0.2 * 126, 63 - g.strands.ldDebonded), 9);
  });
});
