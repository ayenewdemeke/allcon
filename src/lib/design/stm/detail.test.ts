import { describe, expect, it } from "vitest";
import { classBLap, hookLeg, splitRun, unitWeight } from "../rebar/bars";
import { bar } from "./aashto";
import { detailCap } from "./detail";
import { barsFit } from "./nodal-zones";
import { STM_DEFAULTS } from "./strut-tie";
import { buildTemplate, HAMMERHEAD_DEFAULTS, MULTICOLUMN_DEFAULTS } from "./templates";

// A standard cap's bars detailed from its design, and its quantities, checked by hand.

describe("cap detailing and quantities", () => {
  const m = buildTemplate(HAMMERHEAD_DEFAULTS, STM_DEFAULTS);
  const d = detailCap(m);
  const g = (use: string) => d.schedule.groups.filter((x) => x.use === use);

  it("top bars: the design's 26 #11, end cover to end cover, hooked down at the ends (5.10.2.1), lengths rounded down to the inch", () => {
    const [top] = g("Top bars");
    expect(top.count).toBe(26);
    expect(top.size).toBe(11);
    // 12 db tail + half the 8 db bend + db: 16.92 + 5.64 + 1.41 = 23.97 in out to out.
    expect(hookLeg(11).leg).toBeCloseTo(12 * 1.41 + 4 * 1.41 + 1.41, 6);
    // Each dimension rounded down to the inch, then summed: 476 + 2 × 23.
    expect(top.length).toBe(40 * 12 - 2 * 2 + 2 * Math.floor(hookLeg(11).leg));
    expect(top.callout).toBe("#11 Cont (Tot 26)");
  });

  it("stirrups: closed, 4 legs as two nested hoops, at the design's spacing; a series in each tapered arm", () => {
    const outer = g("Stirrups (outer)");
    const inner = g("Stirrups (inner)");
    expect(outer.reduce((s, x) => s + x.count, 0)).toBe(inner.reduce((s, x) => s + x.count, 0));
    const sets = outer.reduce((s, x) => s + x.count, 0);
    // First and last 3 in inside the end cover, at 6 in or closer.
    expect(sets).toBe(Math.floor((480 - 2 * 5) / 6) + 1);
    const series = outer.find((x) => x.series)!;
    expect(series.series!.max).toBeGreaterThan(series.series!.min);
    // Over the column: 7 ft deep less 2 in cover top and bottom; W = 72 - 4 in.
    const mid = outer.find((x) => !x.series)!;
    expect(mid.shape.dims).toEqual([68, 80]);
    // Inner hoop: the middle third of the width, so the four legs are evenly spaced.
    expect(inner.find((x) => !x.series)!.shape.dims[0]).toBe(22); // 68 / 3 = 22.67, rounded down
  });

  it("each section calls out the stirrups it cuts: a tapered arm's series, the constant ones over the column", () => {
    const series = d.schedule.groups.find((x) => x.use === "Stirrups (outer)" && x.series)!.mark;
    const constant = d.schedule.groups.find((x) => x.use === "Stirrups (outer)" && !x.series)!.mark;
    expect(d.sections[0].hoops[0].mark).toBe(series);
    expect(d.sections[1].hoops[0].mark).toBe(constant);
  });

  it("weights by the bars' unit weights, and the cap's concrete from its outline", () => {
    const total = d.schedule.groups.reduce((s, x) => s + ((x.count * x.length) / 12) * unitWeight(x.size), 0);
    expect(d.schedule.total).toBeCloseTo(total, 6);
    // 40 ft by 7 ft, less the two tapered triangles (17 ft by 3 ft), by 6 ft wide.
    expect(d.schedule.concreteTotal).toBeCloseTo(((40 * 7 - 2 * (17 * 3) / 2) * 6) / 27, 6);
  });

  it("a C-bent's top bars turn down into the column and lap its bars (Class B, 5.10.8.4.3a)", () => {
    const c = detailCap(buildTemplate({ ...HAMMERHEAD_DEFAULTS, length: 28.42, depth: 8.5, tipDepth: 8.5, capWidth: 96, columns: [5], columnWidth: 10, topCover: 5.16, bearings: [{ x: 6.97, P: 2005 }, { x: 22.99, P: 926 }], topBars: { size: 11, count: 20 } }, STM_DEFAULTS));
    const top = c.schedule.groups.find((x) => x.use === "Top bars")!;
    const fit = barsFit(96, 2, 5, 20, 11);
    const lap = classBLap(11, { fy: 60, fc: STM_DEFAULTS.fc, clearCover: 2 + bar(5).db, clearSpacing: fit.clearSpacing, horizontal: true, concreteBelow: 8.5 * 12 - 2 })!;
    expect(top.shape.dims[0]).toBeGreaterThan(hookLeg(11).leg);
    expect(top.shape.dims[0]).toBe(Math.floor(lap));
    expect(c.notes.some((n) => n.includes("lap its bars"))).toBe(true);
  });

  it("bars longer than stock are cut and lapped, the laps counted (CDOT 4.7, 4.12)", () => {
    const sp = splitRun(11, 900, 80);
    expect(sp.pieces).toBe(2);
    expect(sp.piece * 2).toBeCloseTo(900 + 80, 6);
    expect(splitRun(14, 900, null).mechanical).toBe(true);
    const long = detailCap(buildTemplate({ ...HAMMERHEAD_DEFAULTS, length: 70, depth: 6, columns: [35], bearings: [{ x: 4, P: 300 }, { x: 66, P: 300 }] }, STM_DEFAULTS));
    const top = long.schedule.groups.filter((x) => x.use === "Top bars");
    expect(top.reduce((s, x) => s + x.count, 0)).toBe(2 * 26);
    expect(top[0].splice).toMatch(/Class B laps/);
  });

  it("a bent cap: straight-soffit stirrups, no series; regions and sections", () => {
    const b = detailCap(buildTemplate(MULTICOLUMN_DEFAULTS, STM_DEFAULTS));
    expect(b.schedule.groups.some((x) => x.series)).toBe(false);
    expect(b.sections.map((s) => s.label)).toEqual(["A", "B"]);
    expect(b.sections[0].dots.length).toBeGreaterThanOrEqual(16);
  });
});
