import type { WorkOS } from "@workos-inc/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyWorkosHostedMfaSession } from "./workos-mfa-assurance";

const now = "2026-10-11T12:00:00.000Z";
const binding = {
  sessionId: "session_current",
  workosUserId: "user_current",
  workosOrganizationId: "org_current",
};
const session = {
  id: binding.sessionId,
  userId: binding.workosUserId,
  organizationId: binding.workosOrganizationId,
  authMethod: "password",
  status: "active",
  endedAt: null,
  impersonator: null,
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T11:00:00.000Z",
  expiresAt: "2026-10-12T10:00:00.000Z",
};
const factor = {
  id: "factor_current",
  userId: binding.workosUserId,
  type: "totp",
  createdAt: "2026-10-10T10:00:00.000Z",
};

function provider(
  sessions: unknown[] = [session],
  factors: unknown[] = [factor],
) {
  const paginateSessions = vi.fn().mockResolvedValue(sessions);
  const paginateFactors = vi.fn().mockResolvedValue(factors);
  const listSessions = vi.fn().mockResolvedValue({
    data: sessions.slice(0, 1),
    autoPagination: paginateSessions,
  });
  const listUserAuthFactors = vi.fn().mockResolvedValue({
    data: factors.slice(0, 1),
    autoPagination: paginateFactors,
  });
  const client = {
    userManagement: { listSessions },
    multiFactorAuth: { listUserAuthFactors },
  } as unknown as WorkOS;
  return {
    client,
    listSessions,
    listUserAuthFactors,
    paginateSessions,
    paginateFactors,
  };
}

describe("verifyWorkosHostedMfaSession", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(now));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["password", "magic_code"])(
    "recognizes an exact active %s session with a prior TOTP factor",
    async (authMethod) => {
      const api = provider([{ ...session, authMethod }]);
      await expect(
        verifyWorkosHostedMfaSession(api.client, binding),
      ).resolves.toEqual({ factorId: factor.id });
      expect(api.listSessions).toHaveBeenCalledWith(binding.workosUserId);
      expect(api.listUserAuthFactors).toHaveBeenCalledWith({
        userId: binding.workosUserId,
      });
    },
  );

  it.each(["sessionId", "workosUserId", "workosOrganizationId"])(
    "rejects a missing %s before contacting the provider",
    async (key) => {
      const api = provider();
      await expect(
        verifyWorkosHostedMfaSession(api.client, { ...binding, [key]: "" }),
      ).resolves.toBeUndefined();
      expect(api.listSessions).not.toHaveBeenCalled();
      expect(api.listUserAuthFactors).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["different session", { id: "session_other" }],
    ["different user", { userId: "user_other" }],
    ["different organization", { organizationId: "org_other" }],
    ["organization absent", { organizationId: null }],
    ["revoked", { status: "revoked" }],
    ["expired status", { status: "expired" }],
    ["unknown status", { status: "unknown" }],
    ["ended", { endedAt: "2026-10-11T11:00:00.000Z" }],
    ["missing end state", { endedAt: undefined }],
    ["impersonator", { impersonator: { email: "admin@example.com" } }],
    ["expired timestamp", { expiresAt: "2026-10-11T11:59:59.999Z" }],
    ["expiry boundary", { expiresAt: now }],
    ["invalid expiry", { expiresAt: "invalid" }],
    ["missing expiry", { expiresAt: undefined }],
    ["invalid creation", { createdAt: "invalid" }],
    ["missing creation", { createdAt: undefined }],
    ["epoch creation", { createdAt: "1970-01-01T00:00:00.000Z" }],
    ["future creation", { createdAt: "2026-10-11T12:00:00.001Z" }],
  ])("rejects a %s session", async (_name, overrides) => {
    const api = provider([{ ...session, ...(overrides as object) }]);
    await expect(
      verifyWorkosHostedMfaSession(api.client, binding),
    ).resolves.toBeUndefined();
    expect(api.listUserAuthFactors).not.toHaveBeenCalled();
  });

  it.each([
    "sso",
    "oauth",
    "passkey",
    "impersonation",
    "migrated_session",
    "external_auth",
    "cross_app_auth",
    "unknown",
    "",
  ])("rejects the unsupported %s authentication method", async (authMethod) => {
    const api = provider([{ ...session, authMethod }]);
    await expect(
      verifyWorkosHostedMfaSession(api.client, binding),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["no matching session", []],
    ["duplicate session identity", [session, session]],
  ])("rejects %s", async (_name, sessions) => {
    const api = provider(sessions);
    await expect(
      verifyWorkosHostedMfaSession(api.client, binding),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["no factor", []],
    ["multiple factors", [factor, { ...factor, id: "factor_second" }]],
    ["foreign user", [{ ...factor, userId: "user_other" }]],
    ["non-TOTP factor", [{ ...factor, type: "sms" }]],
    ["missing factor id", [{ ...factor, id: "" }]],
    ["invalid enrollment date", [{ ...factor, createdAt: "invalid" }]],
    ["missing enrollment date", [{ ...factor, createdAt: undefined }]],
    [
      "epoch enrollment date",
      [{ ...factor, createdAt: "1970-01-01T00:00:00Z" }],
    ],
    ["simultaneous enrollment", [{ ...factor, createdAt: session.createdAt }]],
    [
      "enrollment after sign-in but before refresh",
      [{ ...factor, createdAt: "2026-10-11T10:30:00.000Z" }],
    ],
    [
      "reset factor after sign-in",
      [{ ...factor, id: "factor_replacement", createdAt: now }],
    ],
    [
      "future enrollment",
      [{ ...factor, createdAt: "2026-10-12T10:00:00.000Z" }],
    ],
  ])("rejects %s", async (_name, factors) => {
    const api = provider([session], factors);
    await expect(
      verifyWorkosHostedMfaSession(api.client, binding),
    ).resolves.toBeUndefined();
  });

  it("finds the original session on a later page", async () => {
    const api = provider([{ ...session, id: "session_other" }, session]);
    await expect(
      verifyWorkosHostedMfaSession(api.client, binding),
    ).resolves.toEqual({ factorId: factor.id });
    expect(api.paginateSessions).toHaveBeenCalledOnce();
    expect(api.paginateFactors).toHaveBeenCalledOnce();
  });

  it("rejects a second factor returned on a later page", async () => {
    const api = provider(
      [session],
      [factor, { ...factor, id: "factor_second" }],
    );
    await expect(
      verifyWorkosHostedMfaSession(api.client, binding),
    ).resolves.toBeUndefined();
    expect(api.paginateFactors).toHaveBeenCalledOnce();
  });

  it.each([
    "listSessions",
    "paginateSessions",
    "listUserAuthFactors",
    "paginateFactors",
  ] as const)("fails closed when %s fails", async (operation) => {
    const api = provider();
    api[operation].mockRejectedValue(new Error("Provider unavailable"));
    await expect(
      verifyWorkosHostedMfaSession(api.client, binding),
    ).resolves.toBeUndefined();
  });

  it("fails closed for an unexpected provider response shape", async () => {
    const api = provider();
    api.paginateSessions.mockResolvedValue(null);
    await expect(
      verifyWorkosHostedMfaSession(api.client, binding),
    ).resolves.toBeUndefined();
  });

  it.each([
    "1",
    "2026-02-30T00:00:00.000Z",
    "2026-10-10",
    "2026-10-10T10:00:00",
  ])(
    "rejects malformed provider timestamp %s in every date field",
    async (value) => {
      for (const field of ["createdAt", "expiresAt"]) {
        const api = provider([{ ...session, [field]: value }]);
        await expect(
          verifyWorkosHostedMfaSession(api.client, binding),
        ).resolves.toBeUndefined();
      }
      const api = provider([session], [{ ...factor, createdAt: value }]);
      await expect(
        verifyWorkosHostedMfaSession(api.client, binding),
      ).resolves.toBeUndefined();
    },
  );
});
