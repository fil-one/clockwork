import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_PRODUCTION_ENVIRONMENT_KEYS } from "@clockwork/testing/demo-state";
import { demoAccountIds } from "@clockwork/testing/personas";
import type { UserInfo } from "@workos-inc/authkit-nextjs";

const authMocks = vi.hoisted(() => ({
  assistedCookie: undefined as string | undefined,
  checkRecentAuth: vi.fn(),
  getTokenClaims: vi.fn(),
  listAuthorizedMemberships: vi.fn(),
  listAuthorizedMembershipsForUser: vi.fn(),
  resolveAssistedSession: vi.fn(),
  resolveProviderAssistedSession: vi.fn(),
  resolveReleaseProofIdentity: vi.fn(),
  resolveWorkosIdentity: vi.fn(),
  requestHeaders: new Map<string, string>(),
  withAuth: vi.fn(),
}));

vi.mock("@workos-inc/authkit-nextjs", () => ({
  checkRecentAuth: authMocks.checkRecentAuth,
  getTokenClaims: authMocks.getTokenClaims,
  withAuth: authMocks.withAuth,
}));

vi.mock("@clockwork/db", () => ({
  resolveWorkosIdentity: authMocks.resolveWorkosIdentity,
}));

vi.mock("@/src/auth/identity-repository", async (importOriginal) => ({
  ...(await importOriginal()),
  listAuthorizedMemberships: authMocks.listAuthorizedMemberships,
  listAuthorizedMembershipsForUser: authMocks.listAuthorizedMembershipsForUser,
}));

vi.mock("@/src/auth/release-proof-repository", () => ({
  resolveReleaseProofIdentity: authMocks.resolveReleaseProofIdentity,
}));

vi.mock("@/src/features/internal-ops/assisted-session/repository", () => ({
  resolveAssistedSession: authMocks.resolveAssistedSession,
  resolveProviderAssistedSession: authMocks.resolveProviderAssistedSession,
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "clockwork-assisted-session" && authMocks.assistedCookie
          ? { value: authMocks.assistedCookie }
          : undefined,
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => authMocks.requestHeaders.get(name) ?? null,
    }),
}));

vi.mock("@/src/db/service", () => ({
  getServiceDatabase: () => ({ kind: "deterministic-test-database" }),
}));

import type { AuthorizedMembership } from "./identity-repository";
import { createReleaseProofCookieValue } from "./release-proof";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
  WorkosNextSessionResolver,
} from "./session";

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

function workosSession(email = "owner@customer.example"): UserInfo {
  return {
    sessionId: fixture.sessionId,
    organizationId: fixture.workosOrganizationId,
    user: { id: fixture.workosUserId, email },
    accessToken: "access-token-deterministic-001",
  } as unknown as UserInfo;
}

function commerceIdentity(overrides: Record<string, unknown> = {}) {
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

function membership(
  overrides: Partial<AuthorizedMembership> = {},
): AuthorizedMembership {
  return {
    userId: fixture.commerceUserId,
    userName: "Customer owner",
    userEmail: "owner@customer.example",
    isInternalStaff: false,
    organizationId: fixture.commerceOrganizationId,
    workosOrganizationId: fixture.workosOrganizationId,
    organizationName: "Customer workspace",
    accountId: fixture.accountId,
    accountName: "Customer account",
    role: "owner",
    audience: "customer",
    home: "/dashboard",
    ...overrides,
  };
}

function staffMembership(): AuthorizedMembership {
  return membership({
    userName: "Iris Operator",
    userEmail: "iris@filone.com",
    isInternalStaff: true,
    role: "internal_operator",
    audience: "internal",
    home: "/internal",
    accountName: "Fil One operations",
  });
}

describe("WorkOS commerce session mapping", () => {
  beforeEach(() => {
    authMocks.requestHeaders.clear();
    configuredEnvironment();
    authMocks.assistedCookie = undefined;
    authMocks.withAuth.mockResolvedValue(workosSession());
    authMocks.resolveWorkosIdentity.mockResolvedValue(commerceIdentity());
    authMocks.listAuthorizedMemberships.mockResolvedValue([membership()]);
    authMocks.checkRecentAuth.mockResolvedValue({ isStale: false });
    authMocks.getTokenClaims.mockResolvedValue({
      amr: ["pwd", "mfa"],
      auth_time: Math.floor(Date.now() / 1000),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("maps only the selected server membership to its commerce account", async () => {
    const session = await getCommerceSession();

    expect(authMocks.resolveWorkosIdentity).toHaveBeenCalledWith(
      { kind: "deterministic-test-database" },
      {
        workosUserId: fixture.workosUserId,
        workosOrganizationId: fixture.workosOrganizationId,
        requestId: `auth:${fixture.sessionId}`,
      },
    );
    expect(authMocks.listAuthorizedMemberships).toHaveBeenCalledWith(
      { kind: "deterministic-test-database" },
      {
        workosUserId: fixture.workosUserId,
        requestId: `auth-memberships:${fixture.sessionId}`,
      },
    );
    expect(session).toMatchObject({
      userId: fixture.commerceUserId,
      organizationId: fixture.commerceOrganizationId,
      accountIds: [fixture.accountId],
      roles: ["owner"],
      selectedAccountId: fixture.accountId,
      effectiveAccountId: fixture.accountId,
      profile: {
        name: "Customer owner",
        email: "owner@customer.example",
      },
      memberships: [membership()],
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
      providerBacked: true,
      authenticationSource: "workos",
    });
  });

  it("maps a request-bound verified AuthKit session without middleware state", async () => {
    const resolver = new WorkosNextSessionResolver({
      requireBoundSession: true,
    });
    const request = new Request("https://commerce.clockwork.test/v1/orders");
    resolver.bindVerifiedSession(request, workosSession());

    await expect(resolver.resolve(request)).resolves.toMatchObject({
      userId: fixture.commerceUserId,
      organizationId: fixture.commerceOrganizationId,
      accountIds: [fixture.accountId],
      recentAuthenticationVerified: true,
      authenticationSource: "workos",
    });
    expect(authMocks.withAuth).not.toHaveBeenCalled();
    expect(authMocks.checkRecentAuth).not.toHaveBeenCalled();
    // The binding is single-use and tied to this exact Request object.
    await expect(resolver.resolve(request)).resolves.toBeNull();
  });

  it("preserves middleware-backed resolution outside the strict API boundary", async () => {
    const resolver = new WorkosNextSessionResolver();

    await expect(
      resolver.resolve(
        new Request("https://commerce.clockwork.test/api/experience/customer"),
      ),
    ).resolves.toMatchObject({
      userId: fixture.commerceUserId,
      authenticationSource: "workos",
    });
    expect(authMocks.withAuth).toHaveBeenCalledOnce();
  });

  it("does not invent a named local identity unless the demo adapter is explicit", async () => {
    vi.stubEnv("WORKOS_API_KEY", "");
    vi.stubEnv("WORKOS_CLIENT_ID", "");
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "");

    await expect(getCommerceSession()).rejects.toThrow(
      "without an explicit non-production demo adapter",
    );
    await expect(
      new WorkosNextSessionResolver().resolve(
        new Request("http://localhost:3000/v1/orders"),
      ),
    ).rejects.toThrow("without an explicit non-production demo adapter");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    await expect(getCommerceSession()).resolves.toMatchObject({
      authenticationSource: "local",
      providerBacked: false,
      profile: { email: "operator@filone.test" },
    });
  });

  /**
   * The functional browser shard uses these role headers without enabling the
   * public persona picker. Both fallback identities must still name the same
   * tenant accounts as the explicit demo projection; the former `100…` IDs
   * returned valid sessions whose every collection read was empty.
   */
  it.each([
    ["member", demoAccountIds.direct],
    ["partner_seller", demoAccountIds.reseller],
  ] as const)(
    "scopes the %s demo fallback to its projection account",
    async (role, expectedAccountId) => {
      vi.stubEnv("WORKOS_API_KEY", "");
      vi.stubEnv("WORKOS_CLIENT_ID", "");
      vi.stubEnv("WORKOS_COOKIE_PASSWORD", "");
      vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
      authMocks.requestHeaders.set("x-clockwork-persona", role);

      await expect(getCommerceSession()).resolves.toMatchObject({
        roles: [role],
        selectedAccountId: expectedAccountId,
        effectiveAccountId: expectedAccountId,
        accountIds: [expectedAccountId],
      });
    },
  );

  it.each(DEMO_PRODUCTION_ENVIRONMENT_KEYS)(
    "cannot enable demo identity when %s marks production",
    (productionKey) => {
      const environment: Record<string, string | undefined> = {
        NODE_ENV: "test",
        NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "local",
        CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      };
      environment[productionKey] = " Production ";
      expect(explicitDemoIdentityEnabled(environment)).toBe(false);
    },
  );

  it("cannot enable demo identity through the public runtime marker", () => {
    expect(
      explicitDemoIdentityEnabled({
        NODE_ENV: "test",
        NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "production",
        CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      }),
    ).toBe(false);
  });

  it("enables demo identity only when every production marker is clear", () => {
    expect(
      explicitDemoIdentityEnabled({
        NODE_ENV: "test",
        NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "local",
        CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
      }),
    ).toBe(true);
  });

  it("keeps the persisted staff actor authoritative during provider impersonation", async () => {
    const actualUserId = "20000000-0000-4000-8000-000000000001";
    const staffOrganizationId = "30000000-0000-4000-8000-000000000008";
    const staffAccountId = "10000000-0000-4000-8000-000000000009";
    const staffWorkosOrganizationId = "org_clockwork_staff";
    vi.stubEnv("WORKOS_MFA_POLICY_ORGANIZATION_IDS", staffWorkosOrganizationId);
    authMocks.withAuth.mockResolvedValue({
      ...workosSession(),
      impersonator: {
        email: "iris@filone.com",
        reason: "Customer requested assisted checkout in case CASE-4816",
      },
    });
    authMocks.resolveProviderAssistedSession.mockResolvedValue({
      id: "12000000-0000-4000-8000-000000000003",
      authenticationSessionId: fixture.sessionId,
      actualUserId,
      actualActorName: "iris@filone.com",
      actualActorEmail: "iris@filone.com",
      actualRoles: ["internal_operator"],
      targetAccountId: fixture.accountId,
      targetAccountName: "Customer account",
      reason: "Customer requested assisted checkout in case CASE-4816",
      startedAt: new Date("2030-07-31T16:00:00.000Z"),
      expiresAt: new Date("2030-07-31T16:15:00.000Z"),
    });
    authMocks.listAuthorizedMembershipsForUser.mockResolvedValue([
      membership({
        userId: actualUserId,
        userName: "Iris Operator",
        userEmail: "iris@filone.com",
        isInternalStaff: true,
        organizationId: staffOrganizationId,
        workosOrganizationId: staffWorkosOrganizationId,
        organizationName: "Fil One staff",
        accountId: staffAccountId,
        accountName: "Fil One operations",
        role: "internal_operator",
        audience: "internal",
        home: "/internal",
      }),
    ]);

    const session = await getCommerceSession();

    expect(session).toMatchObject({
      userId: actualUserId,
      organizationId: staffOrganizationId,
      accountIds: [fixture.accountId],
      selectedAccountId: staffAccountId,
      effectiveAccountId: fixture.accountId,
      roles: ["internal_operator"],
      assistedSessionProvider: "workos",
      profile: {
        name: "iris@filone.com",
        email: "iris@filone.com",
      },
      impersonation: {
        accountId: fixture.accountId,
        actualUserId,
        actualActorEmail: "iris@filone.com",
      },
    });
    expect(session.userId).toBe(session.impersonation?.actualUserId);
  });

  it("rejects a forged or inconsistent selected membership", async () => {
    authMocks.listAuthorizedMemberships.mockResolvedValue([
      membership({ accountId: "10000000-0000-4000-8000-000000000099" }),
    ]);

    await expect(getCommerceSession()).rejects.toThrow(
      "Selected WorkOS membership does not match commerce scope",
    );
  });

  it("allows the verified registration bootstrap before a membership exists", async () => {
    const resolver = new WorkosNextSessionResolver();

    await expect(
      resolver.resolve(
        new Request(
          "https://commerce.clockwork.test/v1/lifecycle/registrations",
          { method: "POST" },
        ),
      ),
    ).resolves.toBeNull();
    expect(authMocks.withAuth).not.toHaveBeenCalled();
    expect(authMocks.resolveWorkosIdentity).not.toHaveBeenCalled();
  });

  it("requires exact request-origin equality for release-proof API authentication", async () => {
    const secret = "proof-secret-at-least-thirty-two-bytes-long";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKOS_API_KEY", "");
    vi.stubEnv("WORKOS_CLIENT_ID", "");
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "");
    vi.stubEnv("CLOCKWORK_RELEASE_PROOF", "1");
    vi.stubEnv("CLOCKWORK_PROOF_AUTH_SECRET", secret);
    vi.stubEnv("APP_ORIGIN", "http://localhost:3200");
    const payload = {
      sessionId: "12000000-0000-4000-8000-000000000002",
      expiresAt: "2030-07-31T16:15:00.000Z",
      nonce: "0123456789abcdef0123456789abcdef",
    };
    const cookie = createReleaseProofCookieValue(payload, secret);
    authMocks.resolveReleaseProofIdentity.mockResolvedValue({
      sessionId: payload.sessionId,
      selected: membership(),
      memberships: [membership()],
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
    const resolver = new WorkosNextSessionResolver();

    await expect(
      resolver.resolve(
        new Request("http://localhost:3200/v1/orders", {
          headers: { cookie: `__Host-clockwork-proof=${cookie}` },
        }),
      ),
    ).resolves.toMatchObject({
      authenticationSessionId: payload.sessionId,
      accountIds: [fixture.accountId],
    });
    await expect(
      resolver.resolve(
        new Request("http://localhost:3201/v1/orders", {
          headers: {
            cookie: `__Host-clockwork-proof=${cookie}`,
            "x-clockwork-proof-origin": "http://localhost:3200",
          },
        }),
      ),
    ).rejects.toThrow("Release-proof authentication is unavailable");
    expect(authMocks.resolveReleaseProofIdentity).toHaveBeenCalledTimes(1);
  });

  it("denies a privileged role when the selected organization lacks MFA policy", async () => {
    vi.stubEnv("WORKOS_MFA_POLICY_ORGANIZATION_IDS", "org_other");

    await expect(getCommerceSession()).rejects.toThrow(
      "Privileged commerce roles require an MFA-policy-enforced session",
    );
  });

  it("reads the second factor from the session token, not the organization list", async () => {
    const session = await getCommerceSession();

    expect(authMocks.getTokenClaims).toHaveBeenCalledWith(
      "access-token-deterministic-001",
    );
    expect(session.mfaVerified).toBe(true);
  });

  it.each([
    ["the claim is absent", {}],
    ["the claim is null", { amr: null }],
    ["the claim is a number", { amr: 2 }],
    ["the claim is an object", { amr: { mfa: true } }],
    ["the claim is an empty list", { amr: [] }],
    ["only a first factor was presented", { amr: ["pwd"] }],
    ["the claim holds non-string members", { amr: [{ method: "mfa" }] }],
  ])(
    "denies a privileged role when %s, however the organization is configured",
    async (_case, claims) => {
      // The organization is in WORKOS_MFA_POLICY_ORGANIZATION_IDS throughout,
      // which is exactly the state that used to authorize a single-factor
      // session for every owner, admin and approver in it.
      authMocks.getTokenClaims.mockResolvedValue(claims);

      await expect(getCommerceSession()).rejects.toThrow(
        "Privileged commerce roles require an MFA-policy-enforced session",
      );
    },
  );

  it("denies a privileged role when the assurance claim cannot be read", async () => {
    authMocks.getTokenClaims.mockRejectedValue(new Error("malformed token"));

    await expect(getCommerceSession()).rejects.toThrow(
      "Privileged commerce roles require an MFA-policy-enforced session",
    );
  });

  it("reads the assurance claim and its accepted values from configuration", async () => {
    vi.stubEnv("WORKOS_MFA_ASSURANCE_CLAIM", "acr");
    vi.stubEnv("WORKOS_MFA_ASSURANCE_VALUES", "urn:workos:mfa");
    authMocks.getTokenClaims.mockResolvedValue({
      amr: ["mfa"],
      acr: "urn:workos:mfa",
    });

    await expect(getCommerceSession()).resolves.toMatchObject({
      mfaVerified: true,
    });

    authMocks.getTokenClaims.mockResolvedValue({ amr: ["mfa"] });

    await expect(getCommerceSession()).rejects.toThrow(
      "Privileged commerce roles require an MFA-policy-enforced session",
    );
  });

  it("keeps a non-privileged role signed in without claiming a second factor", async () => {
    vi.stubEnv("WORKOS_MFA_POLICY_ORGANIZATION_IDS", "org_other");
    authMocks.getTokenClaims.mockResolvedValue({});
    authMocks.resolveWorkosIdentity.mockResolvedValue(
      commerceIdentity({ role: "member" }),
    );
    authMocks.listAuthorizedMemberships.mockResolvedValue([
      membership({ role: "member" }),
    ]);

    await expect(getCommerceSession()).resolves.toMatchObject({
      roles: ["member"],
      mfaVerified: false,
    });
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
    authMocks.listAuthorizedMemberships.mockResolvedValue([
      membership({ role: "internal_operator" }),
    ]);

    await expect(getCommerceSession()).rejects.toThrow(
      "Commerce role violates the internal-staff identity boundary",
    );
  });

  it("rejects internal staff whose immutable profile is outside staff domains", async () => {
    authMocks.resolveWorkosIdentity.mockResolvedValue(
      commerceIdentity({ role: "internal_operator", isInternalStaff: true }),
    );
    authMocks.listAuthorizedMemberships.mockResolvedValue([
      membership({
        userEmail: "operator@example.com",
        isInternalStaff: true,
        role: "internal_operator",
        audience: "internal",
        home: "/internal",
      }),
    ]);

    await expect(getCommerceSession()).rejects.toThrow(
      "Commerce role violates the internal-staff identity boundary",
    );
  });

  it("binds assisted scope to the auth session and immutable actual staff actor", async () => {
    authMocks.assistedCookie = "12000000-0000-4000-8000-000000000001";
    authMocks.resolveWorkosIdentity.mockResolvedValue(
      commerceIdentity({ role: "internal_operator", isInternalStaff: true }),
    );
    authMocks.listAuthorizedMemberships.mockResolvedValue([staffMembership()]);
    authMocks.resolveAssistedSession.mockResolvedValue({
      id: authMocks.assistedCookie,
      authenticationSessionId: fixture.sessionId,
      actualUserId: fixture.commerceUserId,
      actualActorName: "Iris Operator",
      actualActorEmail: "iris@filone.com",
      actualRoles: ["internal_operator"],
      targetAccountId: "10000000-0000-4000-8000-000000000001",
      targetAccountName: "Authorized customer",
      reason: "Customer requested quote correction in case CASE-4812",
      startedAt: new Date("2030-07-31T16:00:00.000Z"),
      expiresAt: new Date("2030-07-31T16:15:00.000Z"),
    });

    const session = await getCommerceSession();

    expect(authMocks.resolveAssistedSession).toHaveBeenCalledWith(
      { kind: "deterministic-test-database" },
      expect.objectContaining({
        id: authMocks.assistedCookie,
        authenticationSessionId: fixture.sessionId,
        internalUserId: fixture.commerceUserId,
      }),
    );
    expect(session).toMatchObject({
      accountIds: ["10000000-0000-4000-8000-000000000001"],
      selectedAccountId: fixture.accountId,
      effectiveAccountId: "10000000-0000-4000-8000-000000000001",
      roles: ["internal_operator"],
      profile: { name: "Iris Operator", email: "iris@filone.com" },
      impersonation: {
        sessionId: authMocks.assistedCookie,
        actualUserId: fixture.commerceUserId,
        actualActorEmail: "iris@filone.com",
      },
    });
  });

  it.each(["expired", "ended", "forged", "role-revoked"])(
    "grants no account scope when assisted authorization is %s",
    async () => {
      authMocks.assistedCookie = "12000000-0000-4000-8000-000000000001";
      authMocks.resolveWorkosIdentity.mockResolvedValue(
        commerceIdentity({ role: "internal_operator", isInternalStaff: true }),
      );
      authMocks.listAuthorizedMemberships.mockResolvedValue([
        staffMembership(),
      ]);
      authMocks.resolveAssistedSession.mockRejectedValue(
        new Error("No active assisted-action authorization exists"),
      );

      const session = await getCommerceSession();

      expect(session.accountIds).toEqual([]);
      expect(session).not.toHaveProperty("assistedSession");
      expect(session).not.toHaveProperty("impersonation");
    },
  );
});
