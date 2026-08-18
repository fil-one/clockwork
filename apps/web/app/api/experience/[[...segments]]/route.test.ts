import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionClaims } from "@clockwork/api";

const mocks = vi.hoisted(() => ({
  authkit: vi.fn(),
  getTokenClaims: vi.fn(),
  controller: vi.fn(),
  boundRequests: [] as Request[],
  resolvedRequests: [] as Request[],
  demoSecret: undefined as string | undefined,
  demoGrantValid: true,
  demoIdentity: false,
  workosConfigured: true,
}));

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkit: mocks.authkit,
  getTokenClaims: mocks.getTokenClaims,
  isAuthkitRequestHeader: (name: string) =>
    name.toLowerCase().startsWith("x-workos-") ||
    ["x-url", "x-redirect-uri", "x-sign-up-paths"].includes(name.toLowerCase()),
  partitionAuthkitHeaders: (_request: Request, headers: Headers) => ({
    requestHeaders: new Headers(),
    responseHeaders: new Headers(
      [...headers].filter(([name]) =>
        ["set-cookie", "cache-control", "vary"].includes(name.toLowerCase()),
      ),
    ),
  }),
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
      mocks.boundRequests.push(request);
      this.#sessions.set(request, session);
    }

    public resolve(request: Request): Promise<SessionClaims | null> {
      mocks.resolvedRequests.push(request);
      return Promise.resolve(
        this.#sessions.has(request) ? authorization : null,
      );
    }
  },
}));

vi.mock("@/src/auth/demo-deploy", () => ({
  demoDeployIdentityEnabled: () => mocks.demoIdentity,
}));

vi.mock("@/src/auth/release-proof", () => ({
  releaseProofConfiguration: () => undefined,
}));

vi.mock("@/src/auth/demo-access", () => ({
  demoAccessCookieName: "clockwork-demo-access",
  demoAccessConfiguration: () => mocks.demoSecret,
  verifyDemoAccessCookie: () => Promise.resolve(mocks.demoGrantValid),
}));

vi.mock("@/src/features/experience-server/controller", () => ({
  handleExperienceRequest: mocks.controller,
}));

const userInfo = {
  user: { id: "user_workos_experience", email: "owner@customer.example" },
  sessionId: "session_workos_experience",
  organizationId: "org_workos_experience",
  accessToken: "verified-access-token",
};

const { GET, POST } = await import("./route");

const segments = ["projections", "customer", "quotes"];

function context(routeSegments = segments) {
  return { params: Promise.resolve({ segments: routeSegments }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.boundRequests.length = 0;
  mocks.resolvedRequests.length = 0;
  mocks.demoSecret = undefined;
  mocks.demoGrantValid = true;
  mocks.demoIdentity = false;
  mocks.workosConfigured = true;
  vi.stubEnv("NODE_ENV", "test");
  mocks.getTokenClaims.mockResolvedValue({ sub: userInfo.user.id });
  mocks.authkit.mockResolvedValue({
    session: userInfo,
    headers: new Headers(),
  });
  mocks.controller.mockImplementation(
    async (request: Request, _segments: string[], dependencies: unknown) => {
      const resolver = (
        dependencies as {
          sessionResolver: {
            resolve(value: Request): Promise<SessionClaims | null>;
          };
        }
      ).sessionResolver;
      const session = await resolver.resolve(request);
      return Response.json({
        body: request.body ? await request.text() : null,
        sessionUserId: session?.userId ?? null,
      });
    },
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("experience API direct authentication boundary", () => {
  it("authenticates on a bodyless request and binds the exact dispatched request", async () => {
    const response = await GET(
      new Request(
        "https://app.example/api/experience/projections/customer/quotes",
        { headers: { cookie: "wos-session=sealed-session" } },
      ),
      context(),
    );

    expect(response.status).toBe(200);
    const authRequest = mocks.authkit.mock.calls[0]?.[0] as Request;
    expect(authRequest.body).toBeNull();
    expect(mocks.boundRequests).toHaveLength(1);
    expect(mocks.resolvedRequests).toEqual(mocks.boundRequests);
    await expect(response.json()).resolves.toMatchObject({
      sessionUserId: authorization.userId,
    });
    expect(response.headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u,
    );
  });

  it("returns the authoritative API span while preserving upstream trace identity", async () => {
    const traceId = "1234567890abcdef1234567890abcdef";
    const upstream = `00-${traceId}-1234567890abcdef-01`;
    const response = await GET(
      new Request(
        "https://app.example/api/experience/projections/customer/quotes",
        { headers: { traceparent: upstream } },
      ),
      context(),
    );

    expect(response.headers.get("traceparent")).toMatch(
      new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`, "u"),
    );
    expect(response.headers.get("traceparent")).not.toBe(upstream);
  });

  it("preserves a distinctive mutation body until the controller reads it", async () => {
    const rawBody =
      '{"projectionId":"90000000-0000-4000-8000-000000000001","payload":{"nested":["naïve",{"marker":"雪"}]}}';
    const response = await POST(
      new Request(
        "https://app.example/api/experience/projections/customer/quotes/Q-1/actions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "wos-session=sealed-session",
          },
          body: rawBody,
        },
      ),
      context([...segments, "Q-1", "actions"]),
    );

    expect((mocks.authkit.mock.calls[0]?.[0] as Request).body).toBeNull();
    expect(mocks.boundRequests).toHaveLength(1);
    expect(mocks.resolvedRequests).toEqual(mocks.boundRequests);
    await expect(response.json()).resolves.toMatchObject({ body: rawBody });
    expect(response.headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u,
    );
  });

  it("rejects an internal AuthKit header before dispatch", async () => {
    const response = await GET(
      new Request(
        "https://app.example/api/experience/projections/customer/quotes",
        { headers: { "x-workos-session": "forged" } },
      ),
      context(),
    );

    expect(response.status).toBe(403);
    expect(mocks.authkit).not.toHaveBeenCalled();
    expect(mocks.controller).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTHKIT_HEADER_REJECTED",
    });
  });

  it("propagates only allowlisted AuthKit refresh headers", async () => {
    mocks.authkit.mockResolvedValueOnce({
      session: userInfo,
      headers: new Headers({
        "set-cookie": "wos-session=rotated; Path=/; HttpOnly",
        vary: "Cookie",
        "x-workos-session": "internal",
        "x-not-allowlisted": "drop-me",
      }),
    });
    const response = await GET(
      new Request(
        "https://app.example/api/experience/projections/customer/quotes",
      ),
      context(),
    );

    expect(response.headers.get("set-cookie")).toContain("wos-session=rotated");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("x-workos-session")).toBeNull();
    expect(response.headers.get("x-not-allowlisted")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u,
    );
  });

  it("replaces the proxy password gate for a direct demo request", async () => {
    mocks.demoSecret = "demo-password";
    mocks.demoGrantValid = false;
    const response = await GET(
      new Request(
        "https://app.example/api/experience/projections/customer/quotes",
      ),
      context(),
    );

    expect(response.status).toBe(403);
    expect(mocks.authkit).not.toHaveBeenCalled();
    expect(mocks.controller).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_ACCESS_REQUIRED",
    });
  });

  it("accepts an authorized explicit demo deploy without WorkOS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.demoIdentity = true;
    mocks.workosConfigured = false;
    mocks.demoSecret = "demo-password";
    const response = await GET(
      new Request(
        "https://app.example/api/experience/projections/customer/quotes",
        { headers: { cookie: "clockwork-demo-access=valid-grant" } },
      ),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.authkit).not.toHaveBeenCalled();
    expect(mocks.controller).toHaveBeenCalledOnce();
  });
});
