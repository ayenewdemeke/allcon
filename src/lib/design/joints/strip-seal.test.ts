import { describe, expect, it } from "vitest";
import { designStripSeal, STRIP_SEAL_DEFAULTS } from "./strip-seal";

// Validation against a state DOT's worked example (170 ft of precast girders to a 0–4 in strip
// seal, skewed 20°, installed at 60°F, and its table of settings).

const near = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
const r = designStripSeal(STRIP_SEAL_DEFAULTS);

describe("strip seal: a DOT worked example", () => {
  it("total movement normal to the joint", () => {
    near(r.total, 2.0397);
    expect(r.range).toBe(3.5); // the example compared it with the 4 in largest opening
  });
  it("installed at 60°F: movements, openings, A and W", () => {
    const d = r.design;
    near(d.cold, 1.3495);
    near(d.hot, 0.3067);
    near(d.Amax, 2.6505);
    near(d.Amin, 0.8067);
    near(d.A, 1.7286);
    near(d.W, 4.2286);
    expect(r.ok).toBe(true);
  });
  it("the table of settings, with its warnings", () => {
    const row = (T: number) => r.table.find((x) => x.Ti === T)!;
    near(row(-30).A, 2.9708);
    near(row(-30).W, 5.4708);
    near(row(10).A, 2.4187);
    near(row(80).A, 1.4525);
    expect(row(70).status).toBe("ok");
    expect(row(80).status).toBe("wait"); // under the 1.5 in needed to place the gland
    expect(row(120).status).toBe("outside");
  });
  it("a seal too small for the movement fails", () => {
    expect(designStripSeal({ ...STRIP_SEAL_DEFAULTS, L: 400 }).checks.find((c) => c.id === "range")!.ok).toBe(false);
  });
});
