import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalSessionResolver } from "./session";

const ids = {
  selectedAccount: "10000000-0000-4000-8000-000000000004",
  externalUser: "20000000-0000-4000-8000-000000000002",
  internalUser: "20000000-0000-4000-8000-000000000001",
  organization: "30000000-0000-4000-8000-000000000001",
} as const;

describe("LocalSessionResolver", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps an external persona to the explicitly selected account", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const session = await new LocalSessionResolver().resolve(
      new Request("https://commerce.clockwork.test/v1/core/status", {
        headers: {
          "x-clockwork-account": ids.selectedAccount,
          "x-clockwork-persona": "partner_seller",
        },
      }),
    );

    expect(session).toEqual({
      userId: ids.externalUser,
      organizationId: ids.organization,
      accountIds: [ids.selectedAccount],
      roles: ["partner_seller"],
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
  });

  it("keeps internal staff outside customer account scope", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const session = await new LocalSessionResolver().resolve(
      new Request("https://commerce.clockwork.test/v1/system/status", {
        headers: {
          "x-clockwork-account": ids.selectedAccount,
          "x-clockwork-persona": "internal_operator",
        },
      }),
    );

    expect(session).toMatchObject({
      userId: ids.internalUser,
      accountIds: [],
      roles: ["internal_operator"],
      isInternalStaff: true,
    });
  });

  it("fails closed instead of creating a local identity in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      new LocalSessionResolver().resolve(
        new Request("https://commerce.clockwork.test/v1/core/status", {
          headers: { "x-clockwork-persona": "owner" },
        }),
      ),
    ).resolves.toBeNull();
  });

  it("gives an unidentified request the least privileged role", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const session = await new LocalSessionResolver().resolve(
      new Request("https://commerce.clockwork.test/v1/core/status"),
    );

    expect(session).toEqual({
      userId: ids.externalUser,
      organizationId: ids.organization,
      accountIds: ["10000000-0000-4000-8000-000000000001"],
      roles: ["member"],
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
  });

  it.each(["", "staging", "preview", "prod"])(
    "fails closed when NODE_ENV is %o rather than a known local runtime",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);

      await expect(
        new LocalSessionResolver().resolve(
          new Request("https://commerce.clockwork.test/v1/system/status", {
            headers: { "x-clockwork-persona": "internal_operator" },
          }),
        ),
      ).resolves.toBeNull();
    },
  );

  it.each([
    ["NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "production"],
    ["VERCEL_ENV", "production"],
    ["CLOCKWORK_ENV", " Production "],
    ["DEPLOYMENT_ENVIRONMENT", "production"],
    ["ENVIRONMENT", "production"],
  ])("fails closed when %s marks a real environment", async (key, value) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(key, value);

    await expect(
      new LocalSessionResolver().resolve(
        new Request("https://commerce.clockwork.test/v1/system/status", {
          headers: { "x-clockwork-persona": "internal_operator" },
        }),
      ),
    ).resolves.toBeNull();
  });
});
