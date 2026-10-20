import { describe, expect, it } from "vitest";
import { regionalDefaults } from "./defaults";

describe("regional defaults", () => {
  it("defaults to the US when there's no location or it names no known country", () => {
    expect(regionalDefaults(undefined)).toEqual({ currency: "USD", measurementStandard: "CSI", unitSystem: "imperial" });
    expect(regionalDefaults("Fargo, ND")).toMatchObject({ currency: "USD", measurementStandard: "CSI" });
  });

  it("picks currency, standard and units from a country or city", () => {
    expect(regionalDefaults("London, UK")).toEqual({ currency: "GBP", measurementStandard: "NRM2", unitSystem: "metric" });
    expect(regionalDefaults("Bole, Addis Ababa")).toMatchObject({ currency: "ETB", measurementStandard: "NRM2", unitSystem: "metric" });
    expect(regionalDefaults("Toronto, Canada")).toMatchObject({ currency: "CAD", measurementStandard: "CSI", unitSystem: "metric" });
  });

  it("matches whole words only", () => {
    expect(regionalDefaults("Ukiah, California")).toMatchObject({ currency: "USD" }); // not "uk"
  });
});
