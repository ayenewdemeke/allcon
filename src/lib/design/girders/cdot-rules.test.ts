import { describe, expect, it } from "vitest";
import { APPROACH_SLAB_DEFAULTS, designApproachSlab } from "../approach/approach-slab";
import { ABUTMENT_DEFAULTS } from "../foundations/abutment";
import { runFoundation } from "../foundations/run";
import { criteriaInputs, designGirder, GIRDER_DEFAULTS, type GirderInputs } from "./prestressed";

// The CDOT BDM (February 2026) rules as the manual words them: 5.3.1.2 (higher strengths with approval),
// 5.5.1.5 (harp points "should"), 5.3.3 (55 % humidity, "shall"), 11.3.1 (the abutment's depth "typically"),
// and CDOT's standard approach slab against AASHTO 9.7.3.2.

const cdot: GirderInputs = { ...GIRDER_DEFAULTS, criteria: "cdot", fci: 7.5, fc: 9, harped: { ...GIRDER_DEFAULTS.harped, harpPoint: 0.3 } };
const check = (i: GirderInputs, id: string) => designGirder(i).spans[0].interior.checks.find((c) => c.id === id)!;

describe("CDOT BDM rules as worded", () => {
  it("5.3.1.2: f'ci and f'c over 6.5 and 8.5 ksi fail without approval, show for information with it", () => {
    expect(check(cdot, "cdot-fci").ok).toBe(false);
    expect(check(cdot, "cdot-fci").advisory).toBeFalsy();
    expect(check({ ...cdot, highStrengthApproved: true }, "cdot-fci").advisory).toBe(true);
    expect(check({ ...cdot, highStrengthApproved: true }, "cdot-fc").advisory).toBe(true);
  });

  it("5.5.1.5: the harp point's 0.35–0.45 of the girder's length is guidance (\"should\")", () => {
    const h = check(cdot, "harp-point");
    expect(h.ok).toBe(false);
    expect(h.advisory).toBe(true);
  });

  it("5.3.3: under CDOT criteria creep and shrinkage take 55 % humidity, whatever is entered", () => {
    expect(criteriaInputs({ ...cdot, humidity: 70 }).humidity).toBe(55);
    expect(criteriaInputs({ ...GIRDER_DEFAULTS, humidity: 70 }).humidity).toBe(70);
    const a = designGirder({ ...cdot, humidity: 70 }).spans[0].interior.losses;
    const b = designGirder({ ...cdot, humidity: 55 }).spans[0].interior.losses;
    expect(a).toEqual(b);
  });

  it("11.3.1: deck to cap bottom over 13 ft is \"typically\" (information); the 3.5–6 ft pile cap stays a requirement", () => {
    const r = runFoundation("abutment", { ...ABUTMENT_DEFAULTS, criteria: "cdot", type: "integral-piles", totalDepth: 13.6, capDepth: 7.5 });
    const depth = r.checks.find((c) => c.id === "depth")!;
    expect(depth.advisory).toBe(true);
    expect(r.checks.find((c) => c.id === "cap-max")!.ok).toBe(false);
    expect(r.checks.find((c) => c.id === "cap-max")!.advisory).toBeFalsy();
  });

  it("B-601's #5 at 12 in against 9.7.3.2: shown for information; other bars checked as before", () => {
    const std = designApproachSlab({ ...APPROACH_SLAB_DEFAULTS, criteria: "cdot", mainBars: { bar: 9, spacing: 6 } }).checks.find((c) => c.id === "dist")!;
    expect(std.advisory).toBe(true);
    const other = designApproachSlab({ ...APPROACH_SLAB_DEFAULTS, mainBars: { bar: 9, spacing: 6 }, distBars: { bar: 6, spacing: 12 } }).checks.find((c) => c.id === "dist")!;
    expect(other.advisory).toBeFalsy();
  });
});
