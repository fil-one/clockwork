import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assistedCookie: undefined as string | undefined,
  cookieDelete: vi.fn(),
  createAssistedSession: vi.fn(),
  endProviderAssistedSession: vi.fn(),
  getCommerceSession: vi.fn(),
  resolveAuthorizedAccountSwitch: vi.fn(),
  requireRecentAuthentication: vi.fn(),
  signOut: vi.fn(),
  switchToOrganization: vi.fn(),
  withAuth: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      delete: mocks.cookieDelete,
      get: (name: string) =>
        name === "clockwork-assisted-session" && mocks.assistedCookie
          ? { value: mocks.assistedCookie }
          : undefined,
      set: vi.fn(),
    }),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@workos-inc/authkit-nextjs", () => ({
  signOut: mocks.signOut,
  switchToOrganization: mocks.switchToOrganization,
  withAuth: mocks.withAuth,
}));

vi.mock("@/src/auth/session", () => ({
  assistedSessionCookieName: "clockwork-assisted-session",
  getCommerceSession: mocks.getCommerceSession,
  requireRecentAuthentication: mocks.requireRecentAuthentication,
}));

vi.mock("@/src/auth/identity-repository", () => ({
  resolveAuthorizedAccountSwitch: mocks.resolveAuthorizedAccountSwitch,
}));

vi.mock("@/src/db/service", () => ({
  getServiceDatabase: () => ({ kind: "deterministic-test-database" }),
}));

vi.mock("@/src/features/internal-ops/assisted-session/repository", () => ({
  createAssistedSession: mocks.createAssistedSession,
  endAssistedSession: vi.fn(),
  endProviderAssistedSession: mocks.endProviderAssistedSession,
}));

import {
  exitProviderAssistedSession,
  startAssistedSession,
  switchCommerceAccount,
} from "./actions";

const accountId = "10000000-0000-4000-8000-000000000004";

describe("organization-switch authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assistedCookie = undefined;
    mocks.getCommerceSession.mockResolvedValue({
      authenticationSource: "workos",
      assistedSession: undefined,
    });
    mocks.withAuth.mockResolvedValue({
      sessionId: "auth-session-001",
      user: { id: "user_workos_selected" },
    });
    mocks.resolveAuthorizedAccountSwitch.mockResolvedValue({
      workosOrganizationId: "org_authorized",
      home: "/dashboard",
    });
  });

  it("denies switching when an active assisted cookie is present", async () => {
    mocks.assistedCookie = "12000000-0000-4000-8000-000000000001";
    mocks.getCommerceSession.mockResolvedValue({
      authenticationSource: "workos",
      assistedSession: { id: mocks.assistedCookie },
    });

    await expect(switchCommerceAccount(accountId)).resolves.toEqual({
      ok: false,
    });
    expect(mocks.getCommerceSession).toHaveBeenCalledTimes(1);
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
    expect(mocks.withAuth).not.toHaveBeenCalled();
    expect(mocks.switchToOrganization).not.toHaveBeenCalled();
  });

  it("denies once and clears a stale invalid assisted cookie", async () => {
    mocks.assistedCookie = "12000000-0000-4000-8000-000000000001";

    await expect(switchCommerceAccount(accountId)).resolves.toEqual({
      ok: false,
    });
    expect(mocks.cookieDelete).toHaveBeenCalledWith(
      "clockwork-assisted-session",
    );
    expect(mocks.withAuth).not.toHaveBeenCalled();
  });

  it("denies an active assisted session even if its cookie was concurrently cleared", async () => {
    mocks.getCommerceSession.mockResolvedValue({
      authenticationSource: "workos",
      assistedSession: { id: "12000000-0000-4000-8000-000000000001" },
    });

    await expect(switchCommerceAccount(accountId)).resolves.toEqual({
      ok: false,
    });
    expect(mocks.withAuth).not.toHaveBeenCalled();
  });

  it("truthfully denies organization switching for release-proof auth", async () => {
    mocks.getCommerceSession.mockResolvedValue({
      authenticationSource: "release-proof",
      assistedSession: undefined,
    });

    await expect(switchCommerceAccount(accountId)).resolves.toEqual({
      ok: false,
    });
    expect(mocks.withAuth).not.toHaveBeenCalled();
  });

  it("switches only to the WorkOS organization returned by server membership resolution", async () => {
    await expect(switchCommerceAccount(accountId)).resolves.toEqual({
      ok: true,
    });
    expect(mocks.resolveAuthorizedAccountSwitch).toHaveBeenCalledWith(
      { kind: "deterministic-test-database" },
      expect.objectContaining({
        workosUserId: "user_workos_selected",
        requestedAccountId: accountId,
      }),
    );
    expect(mocks.switchToOrganization).toHaveBeenCalledWith("org_authorized", {
      returnTo: "/dashboard",
    });
  });

  it("denies a forged account without switching provider state", async () => {
    mocks.resolveAuthorizedAccountSwitch.mockRejectedValue(
      new Error("Requested account is not an authorized membership"),
    );

    await expect(switchCommerceAccount(accountId)).resolves.toEqual({
      ok: false,
    });
    expect(mocks.switchToOrganization).not.toHaveBeenCalled();
  });

  it("durably ends provider authorization before AuthKit revokes the session", async () => {
    mocks.withAuth.mockResolvedValue({
      sessionId: "auth-session-001",
      user: { id: "target_workos_user" },
      impersonator: {
        email: "iris@filone.com",
        reason: "Customer requested assisted checkout",
      },
    });
    mocks.getCommerceSession.mockResolvedValue({
      userId: "20000000-0000-4000-8000-000000000001",
      authenticationSessionId: "auth-session-001",
      authenticationSource: "workos",
      assistedSessionProvider: "workos",
      assistedSession: {
        id: "12000000-0000-4000-8000-000000000001",
        actualActorEmail: "iris@filone.com",
      },
    });

    await exitProviderAssistedSession();

    expect(mocks.endProviderAssistedSession).toHaveBeenCalledWith(
      { kind: "deterministic-test-database" },
      expect.objectContaining({
        id: "12000000-0000-4000-8000-000000000001",
        internalUserId: "20000000-0000-4000-8000-000000000001",
        actualActorEmail: "iris@filone.com",
      }),
    );
    expect(
      mocks.endProviderAssistedSession.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ returnTo: "/" });
  });

  it("cannot start a second assisted mode while any provider-backed mode is active", async () => {
    mocks.getCommerceSession.mockResolvedValue({
      userId: "20000000-0000-4000-8000-000000000001",
      authenticationSessionId: "auth-session-001",
      isInternalStaff: true,
      roles: ["internal_operator"],
      assistedSession: {
        id: "12000000-0000-4000-8000-000000000001",
      },
    });
    const form = new FormData();
    form.set("targetAccountId", accountId);
    form.set("reason", "Customer requested help in case CASE-4817");

    await expect(startAssistedSession(form)).rejects.toThrow(
      "Assisted-action authority is required",
    );
    expect(mocks.createAssistedSession).not.toHaveBeenCalled();
  });
});
