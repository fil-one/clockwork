import { describe, expect, it } from "vitest";

import {
  AccessTokenCreateSchema,
  accessTokenDefaultDays,
  accessTokenLive,
  accessTokenMaxDays,
} from "./access-tokens";

describe("access token input", () => {
  it("defaults to 90 days and allows at most a year", () => {
    expect(
      AccessTokenCreateSchema.parse({ name: " Laptop ", scope: "read" }),
    ).toEqual({ name: "Laptop", scope: "read", expiresInDays: 90 });
    expect(accessTokenDefaultDays).toBe(90);
    expect(
      AccessTokenCreateSchema.safeParse({
        name: "Laptop",
        scope: "read_write",
        expiresInDays: accessTokenMaxDays + 1,
      }).success,
    ).toBe(false);
  });

  it("knows only read and read_write, and needs a name", () => {
    expect(
      AccessTokenCreateSchema.safeParse({ name: "x", scope: "admin" }).success,
    ).toBe(false);
    expect(
      AccessTokenCreateSchema.safeParse({ name: "  ", scope: "read" }).success,
    ).toBe(false);
  });
});

describe("whether a token is live", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("is live until it expires or is revoked", () => {
    expect(
      accessTokenLive(
        { revokedAt: null, expiresAt: "2026-10-11T00:00:00Z" },
        now,
      ),
    ).toBe(true);
    expect(
      accessTokenLive(
        { revokedAt: null, expiresAt: "2026-10-10T12:00:00Z" },
        now,
      ),
    ).toBe(false);
    expect(
      accessTokenLive(
        {
          revokedAt: "2026-10-09T00:00:00Z",
          expiresAt: "2026-12-01T00:00:00Z",
        },
        now,
      ),
    ).toBe(false);
  });
});
