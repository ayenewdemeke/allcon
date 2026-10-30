import { describe, expect, it } from "vitest";
import { CIP_DEFAULTS, DesignError, designCipWall, liveLoadHeq } from "./cip";

// The example wall in the firm's sheet (EB Retaining Wall): the engine agrees with it wherever the
// sheet follows AASHTO, and the corrected quantities are checked from first principles.

const r = designCipWall(CIP_DEFAULTS);
const close = (a: number, b: number, rel = 1e-5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));

describe("CIP cantilever wall: the sheet's example", () => {
  it("earth pressure coefficients and equivalent fluid weights", () => {
    close(r.soil.Ka, 0.36080778192895924);
    close(r.soil.KpCoulomb, 4.079483415241531);
    expect(r.soil.Kp).toBe(9);
    close(r.soil.efwA, 0.045100972741119905);
    close(r.soil.efwP, 1.125);
    close(r.soil.mu, 0.4663076581549986);
  });

  it("geometry and dead loads", () => {
    close(r.geometry.H, 3.5);
    close(r.geometry.hStem, 2.8333333333333335);
    close(r.geometry.C, 0.41666666666666663);
    close(r.loads.vertical.DC2.force, 0.2833333333333333);
    close(r.loads.vertical.DC2.moment, 0.2125);
    close(r.loads.vertical.DC4.force, 0.15);
    close(r.loads.vertical.EV1.force, 0.14756944444444445);
    close(r.loads.vertical.EV3.force, 0.017361111111111115);
  });

  it("corrects the sheet: earth pressure over the full height, no backslope fill on level ground", () => {
    close(r.loads.Pa, 0.5 * r.soil.efwA * 3.5 ** 2); // the sheet used the stem height (2.83 ft)
    expect(r.loads.vertical.EV4.force).toBe(0); // the sheet used tan δ in place of tan β
  });

  it("stem: moment, flexural resistance, minimum steel, crack control, temperature steel", () => {
    close(r.stem.EH.force, 0.1734251224537843);
    close(r.stem.Mu, 0.24568559014286112);
    close(r.stem.flex.MR, 5.042647058823529);
    close(r.stem.flex.Mcr, 5.48864);
    close(r.concrete.n, 6.797581708358912);
    close(r.stem.flex.sMax, 180.725590449435);
    close(r.stem.temp.required, 0.052);
  });

  it("stem shear: the strain uses Mu in kip·in (the sheet divided by 12)", () => {
    const s = r.stem.shear;
    close(s.dv, 5.76);
    const eps = ((Math.max(r.stem.Mu, (r.stem.V * s.dv) / 12) * 12) / s.dv + 0.5 * s.Nu + r.stem.V) / (29000 * 0.2);
    close(s.epsS, eps);
    expect(s.beta).toBeLessThan(5.408595778103687); // the sheet's β, from the smaller strain
    expect(s.VR).toBeGreaterThan(r.stem.V);
  });

  it("heel: moment, resistance, crack control and shear", () => {
    close(r.heel.Mu, 0.05452473958333333);
    close(r.heel.flex.MR, 5.042647058823529);
    close(r.heel.flex.sMax, 765.0319161981213);
    close(r.heel.VR, 7.8630911999999995);
  });

  it("toe and shear key: resistance, inert block and passive resistance", () => {
    close(r.toe.flex.MR, 4.14264705882353);
    close(r.toe.VR, 7.8630911999999995);
    close(r.stability.key.c, 1.1496901735478704);
    close(r.stability.key.y1, 0);
    close(r.stability.key.Rep, 0.7435054660232995);
  });

  it("needs its shear key, as in the sheet; with the full earth pressure its 18 in base fails bearing", () => {
    expect(r.stability.keyNeeded).toBe(true);
    // The sheet passed bearing (0.73 and 0.80 ksf) with the pressure over the stem height only.
    expect(r.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["Bearing, Strength Ib", "Bearing, Strength IV"]);
    close(r.checks.find((c) => c.id === "brg-StrIV")!.demand, 1.057, 1e-3);
    expect(designCipWall({ ...CIP_DEFAULTS, B: 24 }).ok).toBe(true);
  });

  it("live load surcharge heights interpolate AASHTO Table 3.11.6.4-2", () => {
    expect(liveLoadHeq(5, 0)).toBe(5);
    close(liveLoadHeq(7.5, 0), 4.25);
    expect(liveLoadHeq(15, 2)).toBe(2);
  });

  it("a taller wall without a key fails sliding and says so", () => {
    const tall = designCipWall({ ...CIP_DEFAULTS, He: 10, shearKey: false });
    expect(tall.checks.find((c) => c.id === "slide-StrIa")!.ok).toBe(false);
  });

  it("says why it can't design a wall from impossible inputs", () => {
    expect(() => designCipWall({ ...CIP_DEFAULTS, backslope: 2 })).toThrow(DesignError);
    expect(() => designCipWall({ ...CIP_DEFAULTS, B: 10 })).toThrow(/no heel/);
  });
});
