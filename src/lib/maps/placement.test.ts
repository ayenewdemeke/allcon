import { describe, expect, it } from "vitest";
import { georefChecked, modelPlacement, placementInput } from "./placement";

const pinned = { latitude: 39.74, longitude: -104.99 };
const unpinned = { latitude: null, longitude: null };
const georef = { lat: 39.7375, lon: -104.987, heading: 30, height: 1609, crs: "EPSG:2232", source: "map" };

describe("modelPlacement", () => {
  it("prefers a placement made by hand", () => {
    const placement = { lat: 1, lon: 2, heading: 90, elevation: 0.5 };
    expect(modelPlacement({ placement, summary: { georef } }, pinned)).toEqual({ ...placement, source: "manual" });
  });

  it("then the model's own georeferencing, on the ground", () => {
    expect(modelPlacement({ placement: null, summary: { georef } }, pinned)).toEqual({ lat: 39.7375, lon: -104.987, heading: 30, elevation: 0, source: "ifc" });
  });

  it("then the project's pin, facing north", () => {
    expect(modelPlacement({ placement: null, summary: { georef: null } }, pinned)).toEqual({ lat: 39.74, lon: -104.99, heading: 0, elevation: 0, source: "project" });
  });

  it("is unknown without any of them", () => {
    expect(modelPlacement({ placement: null, summary: null }, unpinned)).toBeNull();
  });

  it("ignores a malformed saved placement", () => {
    expect(modelPlacement({ placement: { lat: "x" }, summary: null }, pinned)?.source).toBe("project");
  });
});

describe("placementInput", () => {
  it("keeps headings within a turn", () => {
    expect(placementInput.parse({ lat: 0, lon: 0, heading: -30, elevation: 0 }).heading).toBe(330);
    expect(placementInput.parse({ lat: 0, lon: 0, heading: 370, elevation: 0 }).heading).toBe(10);
  });

  it("rejects places off the globe", () => {
    expect(placementInput.safeParse({ lat: 91, lon: 0, heading: 0, elevation: 0 }).success).toBe(false);
  });
});

describe("georefChecked", () => {
  it("tells summaries that looked for georeferencing from older ones", () => {
    expect(georefChecked({ georef: null })).toBe(true);
    expect(georefChecked({ elements: 3 })).toBe(false);
    expect(georefChecked(null)).toBe(false);
  });
});
