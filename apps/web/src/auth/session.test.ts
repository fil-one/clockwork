import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  internalRoles,
  type OrganizationSide,
  type Role,
} from "@clockwork/contracts";
import { DEMO_PRODUCTION_ENVIRONMENT_KEYS } from "@clockwork/testing/demo-state";
import { demoAccountIds } from "@clockwork/testing/personas";
import type { UserInfo } from "@workos-inc/authkit-nextjs";
import type * as WorkosNode from "@workos-inc/node";

const authMocks = vi.hoisted(() => ({
  assistedCookie: undefined as string | undefined,
  getTokenClaims: vi.fn(),
  listAuthorizedMemberships: vi.fn(),
  listAuthorizedMembershipsForUser: vi.fn(),
  resolveAssistedSession: vi.fn(),
  resolveProviderAssistedSession: vi.fn(),
  resolveReleaseProofIdentity: vi.fn(),
  resolveWorkosIdentity: vi.fn(),
  findMfaReceipt: vi.fn(),
  requestHeaders: new Map<string, string>(),
  requestCookies: new Map<string, string>(),
  authenticateCookie: vi.fn(),
  loadSealedSession: vi.fn(),
  withAuth: vi.fn(),
}));

vi.mock("@workos-inc/authkit-nextjs", () => ({
  getTokenClaims: authMocks.getTokenClaims,
  withAuth: authMocks.withAuth,
}));

vi.mock("@workos-inc/node", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkosNode>()),
  WorkOS: class {
    userManagement = { loadSealedSession: authMocks.loadSealedSession };
    constructor(_apiKey: string, options: { clientId: string }) {
      if (options.clientId !== "client_test_clockwork")
        throw new Error(
          "Explicit clientId is required for cookie verification",
        );
    }
  },
}));

vi.mock("@clockwork/db", () => ({
  resolveWorkosIdentity: authMocks.resolveWorkosIdentity,
  findMfaReceipt: authMocks.findMfaReceipt,
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
          : authMocks.requestCookies.has(name)
            ? { value: authMocks.requestCookies.get(name) }
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
import { demoAccessCookieName, issueDemoAccessCookie } from "./demo-access";
import {
  createReleaseProofCookieValue,
  releaseProofCookieName,
} from "./release-proof";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
  requireRecentAuthentication,
  SessionExpiredError,
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
  // The identity reads the same membership rows as the membership list, so
  // by default it carries the same roles and side for its primary role.
  const role = (overrides.role ?? "owner") as Role;
  return {
    userId: fixture.commerceUserId,
    organizationId: fixture.commerceOrganizationId,
    accountId: fixture.accountId,
    role,
    roles: [role],
    side: naturalSide(role),
    isInternalStaff: false,
    mfaEnrolled: true,
    ...overrides,
  };
}

function naturalSide(role: Role): OrganizationSide {
  if ((internalRoles as readonly Role[]).includes(role)) return "fil_one";
  if (role === "partner_admin" || role === "partner_seller")
    return "channel_partner";
  return "customer";
}

function membership(
  overrides: Partial<AuthorizedMembership> = {},
): AuthorizedMembership {
  const role = overrides.role ?? "owner";
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
    role,
    roles: [role],
    side: naturalSide(role),
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
    authMocks.requestCookies.clear();
    configuredEnvironment();
    authMocks.findMfaReceipt.mockResolvedValue(undefined);
    authMocks.assistedCookie = undefined;
    authMocks.withAuth.mockResolvedValue(workosSession());
    authMocks.requestCookies.set("wos-session", "sealed-session");
    authMocks.loadSealedSession.mockReturnValue({
      authenticate: authMocks.authenticateCookie,
    });
    authMocks.authenticateCookie.mockResolvedValue({
      authenticated: true,
      ...workosSession(),
    });
    authMocks.resolveWorkosIdentity.mockResolvedValue(commerceIdentity());
    authMocks.listAuthorizedMemberships.mockResolvedValue([membership()]);
    authMocks.getTokenClaims.mockResolvedValue({
      sub: fixture.workosUserId,
      amr: ["pwd", "mfa"],
      auth_time: Math.floor(Date.now() / 1000),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("accepts an actual session-bound MFA receipt when WorkOS omits assurance claims", async () => {
    authMocks.getTokenClaims.mockResolvedValue({});
    authMocks.findMfaReceipt.mockResolvedValue(Date.now());
    const session = await getCommerceSession();
    expect(session.mfaVerified).toBe(true);
    expect(session.recentAuthenticationVerified).toBe(true);
    expect(authMocks.findMfaReceipt).toHaveBeenCalledWith(expect.anything(), {
      sessionId: workosSession().sessionId,
      workosUserId: workosSession().user.id,
      workosOrganizationId: workosSession().organizationId,
    });
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

  it("authenticates a skipped fetch action from the read-only sealed cookie path", async () => {
    authMocks.requestHeaders.set("next-action", "a".repeat(40));
    authMocks.requestHeaders.set("origin", "https://commerce.clockwork.test");
    authMocks.requestHeaders.set("host", "commerce.clockwork.test");

    await expect(getCommerceSession()).resolves.toMatchObject({
      userId: fixture.commerceUserId,
      authenticationSource: "workos",
    });
    expect(authMocks.authenticateCookie).toHaveBeenCalledOnce();
    expect(authMocks.loadSealedSession).toHaveBeenCalledWith({
      sessionData: "sealed-session",
      cookiePassword: process.env.WORKOS_COOKIE_PASSWORD,
    });
    expect(authMocks.withAuth).not.toHaveBeenCalled();
  });

  it("refuses an expired access token on the direct action path as session expired", async () => {
    authMocks.requestHeaders.set(
      "content-type",
      "multipart/form-data; boundary=x",
    );
    authMocks.authenticateCookie.mockResolvedValue({
      authenticated: false,
      reason: "invalid_jwt",
    });

    const refusal = getCommerceSession();
    await expect(refusal).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(refusal).rejects.toThrow("SESSION_EXPIRED");
    expect(authMocks.resolveWorkosIdentity).not.toHaveBeenCalled();
    expect(authMocks.withAuth).not.toHaveBeenCalled();
  });

  it("refuses a direct action without a session cookie as session expired", async () => {
    authMocks.requestHeaders.set("next-action", "a".repeat(40));
    authMocks.requestCookies.delete("wos-session");

    await expect(getCommerceSession()).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
    expect(authMocks.loadSealedSession).not.toHaveBeenCalled();
  });

  it("keeps other sealed-cookie failures as a plain authentication refusal", async () => {
    authMocks.requestHeaders.set("next-action", "a".repeat(40));
    authMocks.authenticateCookie.mockResolvedValue({
      authenticated: false,
      reason: "invalid_session_cookie",
    });

    const refusal = getCommerceSession();
    await expect(refusal).rejects.toThrow("WorkOS authentication is required");
    await expect(refusal).rejects.not.toBeInstanceOf(SessionExpiredError);
    expect(authMocks.resolveWorkosIdentity).not.toHaveBeenCalled();
  });

  it("can authenticate again during the read-only post-action render", async () => {
    authMocks.requestHeaders.set("next-action", "a".repeat(40));
    await getCommerceSession();
    await expect(getCommerceSession()).resolves.toMatchObject({
      userId: fixture.commerceUserId,
    });
    expect(authMocks.authenticateCookie).toHaveBeenCalledTimes(2);
  });

  it("rejects a sealed identity that differs from the verified token subject", async () => {
    authMocks.requestHeaders.set("next-action", "a".repeat(40));
    authMocks.getTokenClaims.mockResolvedValue({ sub: "another-user" });
    await expect(getCommerceSession()).rejects.toThrow(
      "WorkOS authentication is required",
    );
    expect(authMocks.resolveWorkosIdentity).not.toHaveBeenCalled();
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

  it("does not synthesize demo identity without the configured access grant", async () => {
    vi.stubEnv("WORKOS_API_KEY", "");
    vi.stubEnv("WORKOS_CLIENT_ID", "");
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    vi.stubEnv("CLOCKWORK_DEMO_ACCESS_PASSWORD", "demo-session-test-password");
    authMocks.requestHeaders.set("x-clockwork-persona", "owner");

    await expect(getCommerceSession()).rejects.toThrow(
      "A valid demo access grant is required",
    );
    await expect(
      new WorkosNextSessionResolver().resolve(
        new Request("https://demo.clockwork.test/api/experience/projections", {
          headers: { "x-clockwork-persona": "owner" },
        }),
      ),
    ).resolves.toBeNull();

    const grant = await issueDemoAccessCookie("demo-session-test-password");
    authMocks.requestCookies.set(demoAccessCookieName, grant.value);
    await expect(getCommerceSession()).resolves.toMatchObject({
      roles: ["owner"],
      authenticationSource: "local",
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

  it("re-establishes release-proof origin at a skipped action destination", async () => {
    const secret = "proof-action-secret-at-least-thirty-two-bytes";
    const origin = "http://localhost:3200";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKOS_API_KEY", "");
    vi.stubEnv("WORKOS_CLIENT_ID", "");
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "");
    vi.stubEnv("CLOCKWORK_RELEASE_PROOF", "1");
    vi.stubEnv("CLOCKWORK_PROOF_AUTH_SECRET", secret);
    vi.stubEnv("APP_ORIGIN", origin);
    const payload = {
      sessionId: "12000000-0000-4000-8000-000000000002",
      expiresAt: "2030-07-31T16:15:00.000Z",
      nonce: "0123456789abcdef0123456789abcdef",
    };
    authMocks.requestCookies.set(
      releaseProofCookieName,
      createReleaseProofCookieValue(payload, secret),
    );
    authMocks.resolveReleaseProofIdentity.mockResolvedValue({
      sessionId: payload.sessionId,
      selected: membership(),
      memberships: [membership()],
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
    authMocks.requestHeaders.set("next-action", "b".repeat(40));
    authMocks.requestHeaders.set("host", "localhost:3200");
    authMocks.requestHeaders.set("origin", origin);
    authMocks.requestHeaders.set("sec-fetch-site", "same-origin");
    // A direct caller can supply this header, so it must have no authority on
    // the skipped path.
    authMocks.requestHeaders.set(
      "x-clockwork-proof-origin",
      "https://attacker.example",
    );

    await expect(getCommerceSession()).resolves.toMatchObject({
      authenticationSessionId: payload.sessionId,
    });

    authMocks.requestHeaders.set("origin", "https://attacker.example");
    await expect(getCommerceSession()).rejects.toThrow(
      "Release-proof authentication is unavailable",
    );
    authMocks.requestHeaders.set("origin", origin);
    authMocks.requestHeaders.set("host", "attacker.example");
    await expect(getCommerceSession()).rejects.toThrow(
      "Release-proof authentication is unavailable",
    );
    authMocks.requestHeaders.set("host", "localhost:3200");
    authMocks.requestHeaders.set("sec-fetch-site", "cross-site");
    await expect(getCommerceSession()).rejects.toThrow(
      "Release-proof authentication is unavailable",
    );
  });

  it("returns the session that satisfied recent authentication", async () => {
    await expect(requireRecentAuthentication()).resolves.toMatchObject({
      userId: fixture.commerceUserId,
      recentAuthenticationVerified: true,
    });
    authMocks.getTokenClaims.mockResolvedValue({ amr: ["mfa"], auth_time: 0 });
    await expect(requireRecentAuthentication()).rejects.toThrow(
      "Sensitive action requires recent authentication",
    );
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
      sub: fixture.workosUserId,
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

  it("carries every role of the selected membership and the union of their permissions", async () => {
    authMocks.resolveWorkosIdentity.mockResolvedValue(
      commerceIdentity({
        role: "revenue",
        roles: ["revenue", "legal_approver"],
        isInternalStaff: true,
      }),
    );
    authMocks.listAuthorizedMemberships.mockResolvedValue([
      {
        ...staffMembership(),
        role: "revenue",
        roles: ["revenue", "legal_approver"],
      },
    ]);

    const session = await getCommerceSession();

    expect(session.roles).toEqual(["revenue", "legal_approver"]);
    expect(session.permissions).toEqual(
      expect.arrayContaining([
        "mnda:send",
        "contract:write",
        "agreement:approve",
        "contract:approve",
      ]),
    );
    expect(session.permissions).not.toContain("operations:write");
    expect(session.permissions).not.toContain("staff:manage");
  });

  it("refuses a membership list that disagrees with the identity about roles or side", async () => {
    authMocks.resolveWorkosIdentity.mockResolvedValue(
      commerceIdentity({ role: "revenue", isInternalStaff: true }),
    );
    authMocks.listAuthorizedMemberships.mockResolvedValue([
      {
        ...staffMembership(),
        role: "revenue",
        roles: ["revenue", "commerce_admin"],
      },
    ]);

    await expect(getCommerceSession()).rejects.toThrow(
      "Selected WorkOS membership does not match commerce scope",
    );
  });

  it("withholds what a referral partner's side never confers", async () => {
    authMocks.resolveWorkosIdentity.mockResolvedValue(
      commerceIdentity({ role: "partner_admin", side: "referral_partner" }),
    );
    authMocks.listAuthorizedMemberships.mockResolvedValue([
      membership({
        role: "partner_admin",
        side: "referral_partner",
        audience: "partner",
        home: "/partner",
      }),
    ]);

    const session = await getCommerceSession();

    expect(session.permissions).toContain("deal:register");
    expect(session.permissions).toContain("account:write");
    expect(session.permissions).not.toContain("partner:quote:write");
  });

  it("drops approver permissions inside an assisted session", async () => {
    authMocks.assistedCookie = "12000000-0000-4000-8000-000000000001";
    authMocks.resolveWorkosIdentity.mockResolvedValue(
      commerceIdentity({ role: "commerce_admin", isInternalStaff: true }),
    );
    authMocks.listAuthorizedMemberships.mockResolvedValue([
      membership({
        ...staffMembership(),
        role: "commerce_admin",
        roles: ["commerce_admin"],
      }),
    ]);
    authMocks.resolveAssistedSession.mockResolvedValue({
      id: authMocks.assistedCookie,
      authenticationSessionId: fixture.sessionId,
      actualUserId: fixture.commerceUserId,
      actualActorName: "Iris Operator",
      actualActorEmail: "iris@filone.com",
      actualRoles: ["commerce_admin"],
      targetAccountId: "10000000-0000-4000-8000-000000000001",
      targetAccountName: "Authorized customer",
      reason: "Customer requested quote correction in case CASE-4812",
      startedAt: new Date("2030-07-31T16:00:00.000Z"),
      expiresAt: new Date("2030-07-31T16:15:00.000Z"),
    });

    const assisted = await getCommerceSession();

    expect(assisted.roles).toEqual(["commerce_admin"]);
    expect(assisted.side).toBe("fil_one");
    expect(assisted.permissions).toContain("impersonation:assume");
    expect(assisted.permissions).toContain("operations:write");
    for (const withheld of [
      "quote:approve",
      "billing:approve",
      "agreement:approve",
      "contract:approve",
      "destructive:approve",
      "signatory:manage",
      "staff:manage",
    ] as const)
      expect(assisted.permissions).not.toContain(withheld);

    authMocks.assistedCookie = undefined;
    const own = await getCommerceSession();
    expect(own.permissions).toEqual(
      expect.arrayContaining(["quote:approve", "staff:manage"]),
    );
  });

  it("drops approver permissions inside a release-proof assisted session", async () => {
    const secret = "proof-assisted-secret-at-least-thirty-two-bytes";
    const origin = "http://localhost:3200";
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKOS_API_KEY", "");
    vi.stubEnv("WORKOS_CLIENT_ID", "");
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "");
    vi.stubEnv("CLOCKWORK_RELEASE_PROOF", "1");
    vi.stubEnv("CLOCKWORK_PROOF_AUTH_SECRET", secret);
    vi.stubEnv("APP_ORIGIN", origin);
    const payload = {
      sessionId: "12000000-0000-4000-8000-000000000002",
      expiresAt: "2030-07-31T16:15:00.000Z",
      nonce: "0123456789abcdef0123456789abcdef",
    };
    authMocks.requestCookies.set(
      releaseProofCookieName,
      createReleaseProofCookieValue(payload, secret),
    );
    authMocks.requestHeaders.set("x-clockwork-proof-origin", origin);
    const staff = membership({
      ...staffMembership(),
      role: "commerce_admin",
      roles: ["commerce_admin"],
    });
    authMocks.resolveReleaseProofIdentity.mockResolvedValue({
      sessionId: payload.sessionId,
      selected: staff,
      memberships: [staff],
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
    authMocks.assistedCookie = "12000000-0000-4000-8000-000000000003";
    authMocks.resolveAssistedSession.mockResolvedValue({
      id: authMocks.assistedCookie,
      authenticationSessionId: payload.sessionId,
      actualUserId: fixture.commerceUserId,
      actualActorName: "Iris Operator",
      actualActorEmail: "iris@filone.com",
      actualRoles: ["commerce_admin"],
      targetAccountId: "10000000-0000-4000-8000-000000000001",
      targetAccountName: "Authorized customer",
      reason: "Customer requested quote correction in case CASE-4813",
      startedAt: new Date("2030-07-31T16:00:00.000Z"),
      expiresAt: new Date("2030-07-31T16:15:00.000Z"),
    });

    const assisted = await getCommerceSession();

    expect(assisted.authenticationSource).toBe("release-proof");
    expect(assisted.impersonation?.sessionId).toBe(authMocks.assistedCookie);
    expect(assisted.accountIds).toEqual([
      "10000000-0000-4000-8000-000000000001",
    ]);
    expect(assisted.side).toBe("fil_one");
    expect(assisted.permissions).toContain("impersonation:assume");
    expect(assisted.permissions).toContain("operations:write");
    for (const withheld of [
      "quote:approve",
      "billing:approve",
      "agreement:approve",
      "contract:approve",
      "destructive:approve",
      "signatory:manage",
      "staff:manage",
    ] as const)
      expect(assisted.permissions).not.toContain(withheld);

    authMocks.assistedCookie = undefined;
    const own = await getCommerceSession();
    expect(own).not.toHaveProperty("impersonation");
    expect(own.permissions).toEqual(
      expect.arrayContaining(["quote:approve", "staff:manage"]),
    );
  });

  it("refuses staff sign-in when no staff email domain is configured", async () => {
    vi.stubEnv("INTERNAL_EMAIL_DOMAINS", "");
    authMocks.resolveWorkosIdentity.mockResolvedValue(
      commerceIdentity({ role: "internal_operator", isInternalStaff: true }),
    );
    authMocks.listAuthorizedMemberships.mockResolvedValue([staffMembership()]);

    await expect(getCommerceSession()).rejects.toThrow(
      "Staff sign-in is unavailable until INTERNAL_EMAIL_DOMAINS is configured",
    );
  });

  it("keeps customers signed in when no staff email domain is configured", async () => {
    vi.stubEnv("INTERNAL_EMAIL_DOMAINS", "");

    await expect(getCommerceSession()).resolves.toMatchObject({
      roles: ["owner"],
      isInternalStaff: false,
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
