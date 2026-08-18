import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionClaims } from "@clockwork/api";

const mocks = vi.hoisted(() => ({
  authkit: vi.fn(),
  getTokenClaims: vi.fn(),
  boundBodyReads: [] as Promise<string>[],
  resolvedBodies: [] as string[],
  resolvedRequests: [] as Request[],
  workosConfigured: true,
}));

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkit: mocks.authkit,
  getTokenClaims: mocks.getTokenClaims,
  isAuthkitRequestHeader: (name: string) => {
    const normalized = name.toLowerCase();
    return (
      normalized.startsWith("x-workos-") ||
      ["x-url", "x-redirect-uri", "x-sign-up-paths"].includes(normalized)
    );
  },
  partitionAuthkitHeaders: (request: Request, authkitHeaders: Headers) => {
    const requestHeaders = new Headers(request.headers);
    for (const name of [...requestHeaders.keys()])
      if (
        name.startsWith("x-workos-") ||
        ["x-url", "x-redirect-uri", "x-sign-up-paths"].includes(name)
      )
        requestHeaders.delete(name);
    const responseHeaders = new Headers();
    const allowed = new Set(["set-cookie", "cache-control", "vary"]);
    for (const [name, value] of authkitHeaders)
      if (allowed.has(name.toLowerCase())) responseHeaders.append(name, value);
    return { requestHeaders, responseHeaders };
  },
  applyResponseHeaders: (response: Response, headers: Headers) => {
    for (const [name, value] of headers) response.headers.append(name, value);
    return response;
  },
}));

const authorization: SessionClaims = {
  userId: "20000000-0000-4000-8000-000000000004",
  organizationId: "30000000-0000-4000-8000-000000000004",
  accountIds: ["10000000-0000-4000-8000-000000000004"],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

vi.mock("@/src/auth/session", () => ({
  workosAuthenticationConfigured: () => mocks.workosConfigured,
  WorkosNextSessionResolver: class {
    readonly #sessions = new WeakMap<Request, unknown>();

    public bindVerifiedSession(request: Request, session: unknown): void {
      this.#sessions.set(request, session);
      if (request.body) mocks.boundBodyReads.push(request.clone().text());
    }

    public async resolve(request: Request): Promise<SessionClaims | null> {
      mocks.resolvedRequests.push(request);
      const session = this.#sessions.get(request);
      this.#sessions.delete(request);
      if (!session) return null;
      if (request.body) mocks.resolvedBodies.push(await request.clone().text());
      return authorization;
    }
  },
}));

vi.mock("@/src/auth/release-proof", () => ({
  releaseProofConfiguration: () => undefined,
}));

vi.stubEnv("NODE_ENV", "test");
vi.stubEnv("APP_ORIGIN", "https://api.clockwork.test");
vi.stubEnv("WORKOS_API_KEY", "workos-api-key-for-boundary-test");
vi.stubEnv("WORKOS_CLIENT_ID", "workos-client-for-boundary-test");
vi.stubEnv(
  "WORKOS_COOKIE_PASSWORD",
  "workos-cookie-password-for-boundary-test",
);
vi.stubEnv("DATABASE_URL", "");
vi.stubEnv("CLOCKWORK_SERVICE_DATABASE_URL", "");

const userInfo = {
  user: {
    id: "user_workos_boundary",
    email: "owner@customer.example",
  },
  sessionId: "session_workos_boundary",
  organizationId: "org_workos_boundary",
  accessToken: "verified-access-token",
};

const { handle } = await import("./hono-app");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.boundBodyReads.length = 0;
  mocks.resolvedBodies.length = 0;
  mocks.resolvedRequests.length = 0;
  mocks.workosConfigured = true;
  vi.stubEnv("NODE_ENV", "test");
  mocks.getTokenClaims.mockResolvedValue({ sub: userInfo.user.id });
  mocks.authkit.mockResolvedValue({
    session: userInfo,
    headers: new Headers(),
  });
});

describe("the direct WorkOS API boundary", () => {
  it("authenticates without middleware headers on a bodyless AuthKit request", async () => {
    const response = await handle(
      new Request("https://api.clockwork.test/api/v1/core/status", {
        headers: { cookie: "wos-session=sealed-session" },
      }),
    );

    expect(response.status).toBe(200);
    const authRequest = mocks.authkit.mock.calls[0]?.[0] as unknown;
    expect(authRequest).toBeInstanceOf(Request);
    expect((authRequest as Request).body).toBeNull();
    expect((authRequest as Request).headers.get("x-workos-session")).toBeNull();
    expect(mocks.resolvedRequests).toHaveLength(1);
    expect(response.headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u,
    );
  });

  it("returns a problem response instead of redirecting an unauthenticated API caller", async () => {
    mocks.authkit.mockResolvedValueOnce({
      session: { user: null },
      headers: new Headers({
        "cache-control": "no-store",
        "set-cookie": "wos-session=; Max-Age=0; Path=/; HttpOnly",
      }),
      authorizationUrl: "https://auth.example/sign-in",
    });

    const response = await handle(
      new Request("https://api.clockwork.test/api/v1/core/status"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("wos-session=");
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      status: 401,
    });
  });

  it("fails closed when production authentication is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.workosConfigured = false;

    const response = await handle(
      new Request("https://api.clockwork.test/api/v1/core/status"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.authkit).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTHENTICATION_NOT_CONFIGURED",
      retryable: true,
    });
  });

  it("bounds an AuthKit verification exception as a retryable problem", async () => {
    mocks.authkit.mockRejectedValueOnce(new Error("auth provider unavailable"));

    const response = await handle(
      new Request("https://api.clockwork.test/api/v1/core/status"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTHKIT_UNAVAILABLE",
      retryable: true,
    });
  });

  it("rejects caller-supplied AuthKit internal headers", async () => {
    const response = await handle(
      new Request("https://api.clockwork.test/api/v1/core/status", {
        headers: { "x-workos-session": "forged-session" },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(mocks.authkit).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTHKIT_HEADER_REJECTED",
    });
  });

  it("propagates only allowlisted AuthKit refresh response headers", async () => {
    const headers = new Headers({
      "cache-control": "private, no-store",
      vary: "Cookie",
      "set-cookie": "wos-session=rotated; Path=/; HttpOnly",
      "x-workos-session": "trusted-but-internal",
      "x-not-allowlisted": "must-not-escape",
    });
    mocks.authkit.mockResolvedValueOnce({ session: userInfo, headers });

    const response = await handle(
      new Request("https://api.clockwork.test/api/v1/core/status", {
        headers: { cookie: "wos-session=sealed-session" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("wos-session=rotated");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("x-workos-session")).toBeNull();
    expect(response.headers.get("x-not-allowlisted")).toBeNull();
    expect(response.headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u,
    );
  });

  it("binds the sealed user to the verified access-token subject", async () => {
    mocks.getTokenClaims.mockResolvedValueOnce({ sub: "user_someone_else" });

    const response = await handle(
      new Request("https://api.clockwork.test/api/v1/core/status", {
        headers: { cookie: "wos-session=sealed-session" },
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.resolvedRequests).toHaveLength(0);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTHKIT_IDENTITY_MISMATCH",
    });
  });

  it("does not let AuthKit consume or replace the raw API body", async () => {
    const rawBody = JSON.stringify({
      action: "create",
      payload: { marker: 1 },
    });
    const csrf = "12345678901234567890123456789012";
    const response = await handle(
      new Request("https://api.clockwork.test/api/v1/core/commands/quotes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `wos-session=sealed-session; clockwork-csrf=${csrf}`,
          origin: "https://api.clockwork.test",
          "x-csrf-token": csrf,
          "idempotency-key": "workos-body-boundary-0001",
        },
        body: rawBody,
      }),
    );

    const authRequest = mocks.authkit.mock.calls[0]?.[0] as Request;
    expect(authRequest.body).toBeNull();
    expect(response.status).not.toBe(401);
    await expect(Promise.all(mocks.boundBodyReads)).resolves.toEqual([rawBody]);
  });
});
