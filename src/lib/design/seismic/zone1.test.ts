import { describe, expect, it } from "vitest";
import { designZone1, seismicZone, supportLength, ZONE1_DEFAULTS } from "./zone1";

// Validation against a state DOT's worked example (a 2-span, 235 ft steel girder bridge in Seismic
// Zone 1, fixed at the pier, expansion at the abutments).

const near = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
const r = designZone1(ZONE1_DEFAULTS);

describe("seismic zone 1: a DOT worked example", () => {
  it("zone from SD1 (Table 3.10.6-1)", () => {
    expect(r.zone).toBe(1);
    expect([0.15, 0.3, 0.5, 0.51].map(seismicZone)).toEqual([1, 2, 3, 4]);
  });
  it("connection forces: 0.25 × the permanent reactions (As ≥ 0.05)", () => {
    expect(r.factor).toBe(0.25);
    near(r.total, 2813.7421);
    // Longitudinally the pier's 8 fixed bearings take the whole bridge: 703.4 kip (the example rounds to 704, 88 each).
    near(r.connections[1].long, 703.4355);
    near(r.connections[1].longPerBearing, 87.93, 1e-3);
    near(r.connections[0].transPerBearing, 15.43, 1e-3); // the example rounds 123.5 kip up to 124: 15.5
    near(r.connections[1].transPerBearing, 54.9559);
    near(r.connections[2].transPerBearing, 17.5391);
    expect(r.connections[0].long).toBe(0);
  });
  it("support length at the expansion abutments: N = 14.18 in, 100% for Zone 1 with As ≥ 0.05", () => {
    near(supportLength(235, 18, 5), 14.1842);
    expect(r.percent).toBe(1);
    expect(r.supports.filter((s) => s.expansion).map((s) => s.name)).toEqual(["Abutment 1", "Abutment 3"]);
    expect(r.checks.filter((c) => c.id.startsWith("supp")).every((c) => c.ok)).toBe(true);
  });
  it("confinement: both spiral ratios, and the larger governs ('not less than either')", () => {
    const c = r.columns[0];
    expect(r.confine).toBe(true);
    near(c.Ag, 1385.4424);
    near(c.Ac, 1134.1149);
    near(c.rho1, 0.00748, 0.01);
    near(c.rho2, 0.009);
    near(c.rhoReq, 0.009);
    near(c.length, 28 / 6);
  });
  it("the example's #5 at 4 in passes only the smaller ratio; at 3.5 in it passes both", () => {
    const at4 = designZone1({ ...ZONE1_DEFAULTS, columns: [{ ...ZONE1_DEFAULTS.columns[0], pitch: 4 }] });
    expect(at4.checks.find((x) => x.id === "conf-rho-0")!.ok).toBe(false);
    expect(at4.columns[0].rho).toBeGreaterThan(at4.columns[0].rho1);
    expect(r.ok).toBe(true);
  });
  it("a drilled shaft with 5 in cover: 5.6.4.6 governs (0.0179)", () => {
    const shaft = designZone1({ ...ZONE1_DEFAULTS, columns: [{ name: "Caisson", D: 48, cover: 5, fc: 4, fy: 60, bar: 5, pitch: 4, height: 28 }] });
    near(shaft.columns[0].Ag, 1809.5574);
    near(shaft.columns[0].rho1, 0.0179, 0.01);
    near(shaft.columns[0].rho2, 0.008);
  });
  it("no confinement needed with SD1 ≤ 0.10; a Zone 2 bridge fails the zone check", () => {
    expect(designZone1({ ...ZONE1_DEFAULTS, SD1: 0.09 }).checks.some((c) => c.id.startsWith("conf"))).toBe(false);
    expect(designZone1({ ...ZONE1_DEFAULTS, SD1: 0.2 }).checks.find((c) => c.id === "zone")!.ok).toBe(false);
  });
});
