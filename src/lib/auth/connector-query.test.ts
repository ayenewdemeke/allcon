import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_SECRET: "x".repeat(32) }) }));

const { authorizeUrl, toSearchParams } = await import("./connector-query");

describe("connector sign-in helpers", () => {
  it("keeps repeated query values", () => {
    const q = toSearchParams({ client_id: "abc", ba_param: ["client_id", "scope"], empty: undefined });
    expect(q.getAll("ba_param")).toEqual(["client_id", "scope"]);
    expect(q.has("empty")).toBe(false);
  });

  it("resumes the original authorization request without the signature or a login prompt", () => {
    const q = new URLSearchParams("client_id=abc&scope=openid%20offline_access&state=s1&prompt=login&sig=zz&exp=1&ba_iat=2&ba_pl=3&ba_param=client_id");
    const url = new URL(authorizeUrl(q), "https://conkit.app");
    expect(url.pathname).toBe("/api/auth/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "abc", scope: "openid offline_access", state: "s1" });
  });
});
