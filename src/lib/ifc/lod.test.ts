import { describe, expect, it } from "vitest";
import { parseLod } from "@/lib/mcp/model-prompts";
import { lodGuide, lodSummary } from "./lod";

describe("level of development", () => {
  it("reads the LOD a person asks for, defaulting to 300", () => {
    expect(parseLod("LOD 350")).toBe("350");
    expect(parseLod("200")).toBe("200");
    expect(parseLod("400")).toBe("300"); // not offered
    expect(parseLod(undefined)).toBe("300");
    expect(lodGuide("300")).toContain("Doors, windows and storefronts");
  });

  it("counts elements by LOD and flags ones below target or claiming more than their basis", () => {
    const s = lodSummary("300", [{ lod: "300", basis: "dimensioned" }, { lod: "300", basis: "scaled" }, { lod: "200" }, {}]);
    expect(s.byLevel).toEqual({ "300": 2, "200": 1 });
    expect(s.unset).toBe(1);
    expect(s.warnings.join(" ")).toMatch(/1 element has no LOD.*1 element is below.*1 element claims/);
  });
});
