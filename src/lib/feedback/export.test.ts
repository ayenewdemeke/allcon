import { describe, expect, it } from "vitest";
import { bearerMatches } from "./export";

const token = "a".repeat(40);

describe("bearerMatches", () => {
  it("accepts the token as a bearer", () => {
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true);
  });

  it("refuses a missing, wrong or malformed header", () => {
    expect(bearerMatches(null, token)).toBe(false);
    expect(bearerMatches(`Bearer ${"b".repeat(40)}`, token)).toBe(false);
    expect(bearerMatches(`Bearer ${token.slice(1)}`, token)).toBe(false);
    expect(bearerMatches(token, token)).toBe(false);
    expect(bearerMatches("Bearer ", token)).toBe(false);
  });

  it("refuses everything when no token, or a short one, is set", () => {
    expect(bearerMatches("Bearer ", undefined)).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer short", "short")).toBe(false);
  });
});
