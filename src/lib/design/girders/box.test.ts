import { describe, expect, it } from "vitest";
import { takeoffFor, takeoffPayLines } from "../takeoff";
import { GIRDER_DEFAULTS, leverRule, leverRuleAll, type GirderInputs } from "./prestressed";
import { profileProps, shapeById } from "./sections";

// Prestressed boxes and the lever rule for every girder.

describe("the 35 x 66 in box", () => {
  const s = shapeById("box-35x66")!;
  it("its net-width profile gives the IDC's area, centroid and moment of inertia within 1 %", () => {
    const p = profileProps(s.profile);
    expect(Math.abs(p.A - 996.1) / 996.1).toBeLessThan(0.01);
    expect(Math.abs(p.yb - 15.95) / 15.95).toBeLessThan(0.01);
    expect(Math.abs(p.I - 166615) / 166615).toBeLessThan(0.01);
    expect(s.web).toBe(12); // both walls for shear
  });

  it("is paid by the square foot of box (CDOT 618-01994, 32 to 48 in deep)", () => {
    const i: GirderInputs = { ...GIRDER_DEFAULTS, shape: "box-35x66", nGirders: 16, S: 5.5, overhang: 4.75, L: 92.06 - 0.5, endDist: 0.25 };
    const t = takeoffFor("lrfd-girder-check", i, { length: 92.06 })!;
    const box = takeoffPayLines("lrfd-girder-check", t, {}, i, "cdot").find((l) => l.role === "girder")!;
    expect(box.code).toBe("618-01994");
    expect(box.unit).toBe("SF");
    expect(box.quantity).toBeCloseTo(16 * 5.5 * 92.06, -1); // 8,101 SF a span
  });
});

describe("the lever rule for every girder (4.6.2.2.2)", () => {
  it("an interior girder at 8 ft, one lane: a wheel over it and the other 6 ft away, with 1.2", () => {
    const r = leverRuleAll(6, 8, 3.5, 1.5, false);
    expect(r.one).toBeCloseTo(1.2 * 0.5 * (1 + 2 / 8), 6);
  });

  it("an exterior girder, one lane: as the exterior lever rule (wheel 2 ft from the barrier)", () => {
    const S = 8;
    const de = 3.5 - 1.5;
    expect(leverRuleAll(6, S, 3.5, 1.5, true).one).toBeCloseTo(leverRule(S, de), 6);
  });

  it("two lanes load an interior girder more than one when the girders are close", () => {
    const r = leverRuleAll(16, 5.5, 4.75, 1.5, false);
    expect(r.multi).toBeGreaterThan(0);
    expect(r.best).toBe(Math.max(r.one, r.multi));
  });
});
