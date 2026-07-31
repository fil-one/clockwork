import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  checkRecentAuth: vi.fn(),
  resolveActiveImpersonation: vi.fn(),
  resolveWorkosIdentity: vi.fn(),
  withAuth: vi.fn(),
}));

vi.mock("@workos-inc/authkit-nextjs", () => ({
  checkRecentAuth: authMocks.checkRecentAuth,
  withAuth: authMocks.withAuth,
}));

vi.mock("@clockwork/db", () => ({
  resolveActiveImpersonation: authMocks.resolveActiveImpersonation,
  resolveWorkosIdentity: authMocks.resolveWorkosIdentity,
}));

vi.mock("@/src/db/service", () => ({
  getServiceDatabase: () => ({ kind: "deterministic-test-database" }),
}));

import { getCommerceSession, WorkosNextSessionResolver } from "./session";

const fixture = {
  accountId: "10000000-0000-4000-8000-000000000004",
  commerceOrganizationId: "30000000-0000-4000-8000-000000000004",
  commerceUserId: "20000000-0000-4000-8000-000000000004",
  sessionId: "session-deterministic-001",
  workosOrganizationId: "org_workos_selected",
  workosUserId: "user_workos_selected",
} as const;

function configuredEnvironment() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("WORKOS_API_KEY", "sk_test_clockwork");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test_clockwork");
  vi.stubEnv(
    "WORKOS_COOKIE_PASSWORD",
    "test-cookie-password-that-is-long-enough",
  );
  vi.stubEnv("INTERNAL_EMAIL_DOMAINS", "filone.com");
  vi.stubEnv(
    "WORKOS_MFA_POLICY_ORGANIZATION_IDS",
    fixture.workosOrganizationId,
  );
}

function workosSession(email = "owner@customer.example") {
  return {
    sessionId: fixture.sessionId,
    organizationId: fixture.workosOrganizationId,
    user: { id: fixture.workosUserId, email },
  };
}

function commerceIdentity(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    userId: fixture.commerceUserId,
    organizationId: fixture.commerceOrganizationId,
    accountId: fixture.accountId,
    role: "owner",
    isInternalStaff: false,
    mfaEnrolled: true,
    ...overrides,
  };
}

describe("WorkOS commerce session mapping", () => {
  beforeEach(() => {
    configuredEnvironment();
    authMocks.withAuth.mockResolvedValue(workosSession());
    authMocks.resolveWorkosIdentity.mockResolvedValue(commerceIdentity());
    authMocks.checkRecentAuth.mockResolvedValue({ isStale: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("maps the selected WorkOS organization to its commerce account", async () => {
    const session = await getCommerceSession();

    expect(authMocks.resolveWorkosIdentity).toHaveBeenCalledWith(
      { kind: "deterministic-test-database" },
      {
        workosUserId: fixture.workosUserId,
        workosOrganizationId: fixture.workosOrganizationId,
        requestId: `auth:${fixture.sessionId}`,
      },
    );
    expect(session).toEqual({
      userId: fixture.commerceUserId,
      organizationId: fixture.commerceOrganizationId,
      accountIds: [fixture.accountId],
      roles: ["owner"],
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
  });

  it("allows the verified registration bootstrap before a membership exists", async () => {
    const resolver = new WorkosNextSessionResolver();

    await expect(
      resolver.resolve(
        new Request(
          "https://commerce.clockwork.test/v1/lifecycle/registrations",
          {
            method: "POST",
          },
        ),
      ),
    ).resolves.toBeNull();
    expect(authMocks.withAuth).not.toHaveBeenCalled();
    expect(authMocks.resolveWorkosIdentity).not.toHaveBeenCalled();
  });

  it("denies a privileged role when the selected organization lacks MFA policy", async () => {
    vi.stubEnv("WORKOS_MFA_POLICY_ORGANIZATION_IDS", "org_other");

    await expect(getCommerceSession()).rejects.toThrow(
      "Privileged commerce roles require an MFA-policy-enforced session",
    );
  });

  it("requires an explicitly selected organization", async () => {
    authMocks.withAuth.mockResolvedValue({
      ...workosSession(),
      organizationId: undefined,
    });

    await expect(getCommerceSession()).rejects.toThrow(
      "Organization selection is required",
    );
    expect(authMocks.resolveWorkosIdentity).not.toHaveBeenCalled();
  });

  it("rejects an internal role assigned to a non-staff commerce identity", async () => {
    authMocks.resolveWorkosIdentity.mockResolvedValue(
      commerceIdentity({ role: "internal_operator" }),
    );

    await expect(getCommerceSession()).rejects.toThrow(
      "Commerce role violates the internal-staff identity boundary",
    );
  });

  it("rejects internal staff whose WorkOS email is outside staff domains", async () => {
    authMocks.withAuth.mockResolvedValue(workosSession("operator@example.com"));
    authMocks.resolveWorkosIdentity.mockResolvedValue(
      commerceIdentity({
        role: "internal_operator",
        isInternalStaff: true,
      }),
    );

    await expect(getCommerceSession()).rejects.toThrow(
      "Commerce role violates the internal-staff identity boundary",
    );
  });

  it("uses the actual staff role and empty direct scope during assisted action", async () => {
    vi.stubEnv("WORKOS_MFA_POLICY_ORGANIZATION_IDS", "org_clockwork_staff");
    authMocks.withAuth.mockResolvedValue({
      ...workosSession(),
      impersonator: {
        email: "operator@filone.com",
        reason: "Customer requested assisted checkout",
      },
    });
    authMocks.resolveActiveImpersonation.mockResolvedValue({
      sessionId: "assisted-session-001",
      actualUserId: "20000000-0000-4000-8000-000000000001",
      actualActorEmail: "operator@filone.com",
      isInternalStaff: true,
      actualRoles: ["internal_operator"],
      actualWorkosOrganizationIds: ["org_clockwork_staff"],
    });

    await expect(getCommerceSession()).resolves.toMatchObject({
      userId: fixture.commerceUserId,
      accountIds: [],
      roles: ["internal_operator"],
      isInternalStaff: true,
      mfaVerified: true,
      impersonation: {
        accountId: fixture.accountId,
        actualUserId: "20000000-0000-4000-8000-000000000001",
      },
    });
  });
});
