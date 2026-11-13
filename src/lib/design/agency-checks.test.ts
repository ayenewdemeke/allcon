import { describe, expect, it } from "vitest";
import { agencyChecks } from "./agency-checks";
import { APPROACH_SLAB_DEFAULTS, designApproachSlab } from "./approach/approach-slab";
import { FOUNDATION_KINDS, foundationInputs } from "./foundations/kinds";
import { runFoundation } from "./foundations/run";
import type { Check } from "./walls/cip";

// AASHTO is the base; an agency's own checks show only under its criteria.

const check = (name: string, ref: string): Check => ({ id: name, name, ref, demand: 1, capacity: 2, unit: "", ok: true });
const named = /CDOT|BDM|B-601/;

describe("agency criteria", () => {
  it("drops the agency's own checks and its citations from shared ones, unless its criteria are chosen", () => {
    const all = [check("Embedment", "CDOT BDM 10.4.2"), check("Uplift", "AASHTO 10.8.3.7, CDOT BDM 10.3.3"), check("Bearing", "AASHTO 10.6.3.1"), check("At least B-601-1EA's bars", "AASHTO 5.6.3")];
    expect(agencyChecks(all, "cdot")).toEqual(all);
    expect(agencyChecks(all, undefined).map((c) => [c.name, c.ref])).toEqual([["Uplift", "AASHTO 10.8.3.7"], ["Bearing", "AASHTO 10.6.3.1"]]);
  });
  it.each(FOUNDATION_KINDS)("%s: no agency rule under AASHTO; more checks, none fewer, under CDOT", (kind) => {
    const base = runFoundation(kind, foundationInputs(kind, {})!).checks;
    const cdot = runFoundation(kind, { ...foundationInputs(kind, {})!, criteria: "cdot" }).checks;
    expect(base.filter((c) => named.test(c.name + c.ref))).toEqual([]);
    expect(cdot.length).toBeGreaterThanOrEqual(base.length);
    for (const c of base) expect(cdot.find((x) => x.id === c.id)?.ok).toBe(c.ok);
  });
  it("the abutment and the approach slab gain CDOT's limits and worksheet comparisons under its criteria", () => {
    const ids = (kind: "abutment", criteria?: "cdot") => runFoundation(kind, { ...foundationInputs(kind, {})!, criteria }).checks.map((c) => c.id);
    expect(ids("abutment")).not.toContain("unit-length");
    expect(ids("abutment", "cdot")).toContain("unit-length");
    expect(designApproachSlab(APPROACH_SLAB_DEFAULTS).checks.map((c) => c.id)).not.toContain("main-worksheet");
    expect(designApproachSlab({ ...APPROACH_SLAB_DEFAULTS, criteria: "cdot" }).checks.map((c) => c.id)).toContain("main-worksheet");
  });
});
