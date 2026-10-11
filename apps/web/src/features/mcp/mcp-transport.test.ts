import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  recordToolCall: vi.fn(),
  session: {
    userId: "20000000-0000-4000-8000-0000000000aa",
    profile: { name: "Transport tester", email: "tester@clockwork.test" },
    roles: ["revenue"],
    permissions: ["contract:read"],
    mfaVerified: true,
    accessToken: {
      id: "019a44ae-0000-7000-8000-0000000e0001",
      name: "Transport test",
      scope: "read",
      expiresAt: "2027-01-01T00:00:00.000Z",
    },
  },
}));

vi.mock("@/src/auth/access-token-session", () => ({
  accessTokenRepository: () => mocks,
  accessTokenCommerceSession: () => Promise.resolve(mocks.session),
}));
vi.mock("@/src/auth/session", () => ({
  explicitDemoIdentityEnabled: () => false,
  runWithAccessTokenSession: (_session: unknown, run: () => unknown) => run(),
}));
vi.mock("@/src/auth/demo-deploy", () => ({
  demoDeployIdentityEnabled: () => false,
}));
vi.mock("@/src/db/service", () => ({
  getOptionalServiceDatabase: () => ({}),
}));
vi.mock("@workos-inc/authkit-nextjs", () => {
  const unreachable = () => {
    throw new Error("Token transport must not use browser authentication");
  };
  return {
    withAuth: unreachable,
    getTokenClaims: unreachable,
    getWorkOS: unreachable,
    signOut: unreachable,
  };
});

const { handleMcpRequest } = await import("./handler");

const canonicalOrigin = "https://commerce.fil.one";
const secret = `fo_pat_${"a".repeat(43)}`;
const request = (origin?: string, method = "POST") =>
  new Request(`${canonicalOrigin}/api/mcp`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(origin !== undefined ? { origin } : {}),
    },
    ...(method === "POST"
      ? { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }
      : {}),
  });

beforeEach(() => {
  vi.stubEnv("CLOCKWORK_CANONICAL_ORIGIN", canonicalOrigin);
  vi.stubEnv("NODE_ENV", "production");
  mocks.authenticate.mockReset().mockResolvedValue({
    id: mocks.session.accessToken.id,
    windowCount: 1,
    windowResetSeconds: 60,
  });
  mocks.recordToolCall.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("MCP transport origin validation", () => {
  it.each([
    "https://unrelated.invalid",
    "https://commerce.fil.one.unrelated.invalid",
    "http://commerce.fil.one",
    "https://commerce.fil.one:8443",
    "null",
    "not an origin",
    "https://commerce.fil.one/path",
  ])(
    "refuses the untrusted origin %s before authenticating",
    async (origin) => {
      const response = await handleMcpRequest(request(origin));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "MCP_ORIGIN_FORBIDDEN",
        title: "This origin is not allowed",
      });
      expect(mocks.authenticate).not.toHaveBeenCalled();
      expect(mocks.recordToolCall).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "DELETE"])("also validates Origin on %s", async (method) => {
    const response = await handleMcpRequest(
      request("https://unrelated.invalid", method),
    );
    expect(response.status).toBe(403);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it.each([undefined, canonicalOrigin])(
    "accepts a CLI or same-origin request (%s)",
    async (origin) => {
      const response = await handleMcpRequest(request(origin));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: {},
      });
    },
  );

  it("trusts the configured origin rather than the incoming request host", async () => {
    const incoming = request("https://unrelated.invalid");
    const response = await handleMcpRequest(
      new Request("https://unrelated.invalid/api/mcp", {
        method: incoming.method,
        headers: incoming.headers,
        body: await incoming.text(),
      }),
    );
    expect(response.status).toBe(403);
  });

  it.each(["not a URL", "file:///tmp/commerce", "https://user@example.test"])(
    "does not use metadata fallbacks for invalid canonical configuration (%s)",
    async (configured) => {
      vi.stubEnv("CLOCKWORK_CANONICAL_ORIGIN", configured);
      vi.stubEnv(
        "WORKOS_REDIRECT_URI",
        "https://fallback.example.test/callback",
      );
      const response = await handleMcpRequest(request());
      expect(response.status).toBe(503);
      expect(mocks.authenticate).not.toHaveBeenCalled();
    },
  );
});

describe("MCP HTTP protocol exchange", () => {
  it("initializes, lists allowed tools, calls whoami and audits the call", async () => {
    const protocolVersion = "2025-11-25";
    const exchange = (message: Record<string, unknown>, initialized = true) =>
      handleMcpRequest(
        new Request(`${canonicalOrigin}/api/mcp`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            ...(initialized ? { "mcp-protocol-version": protocolVersion } : {}),
          },
          body: JSON.stringify({ jsonrpc: "2.0", ...message }),
        }),
      );
    const initialized = await exchange(
      {
        id: 1,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: "clockwork-transport-test", version: "1" },
        },
      },
      false,
    );
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get("content-type")).toContain(
      "application/json",
    );
    expect(initialized.headers.get("mcp-session-id")).toBeNull();
    expect(await initialized.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fil-one-commerce" },
      },
    });

    const acknowledged = await exchange({
      method: "notifications/initialized",
    });
    expect(acknowledged.status).toBe(202);
    expect(await acknowledged.text()).toBe("");

    const listed = await exchange({ id: 2, method: "tools/list", params: {} });
    expect(listed.status).toBe(200);
    const listing = (await listed.json()) as {
      jsonrpc: string;
      id: number;
      result: { tools: { name: string }[] };
    };
    expect(listing).toMatchObject({ jsonrpc: "2.0", id: 2 });
    const names = listing.result.tools.map(({ name }) => name);
    expect(names).toContain("whoami");
    expect(names).not.toContain("create_partner");

    const called = await exchange({
      id: 3,
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    });
    expect(called.status).toBe(200);
    const result = (await called.json()) as {
      jsonrpc: string;
      id: number;
      result: { isError?: boolean; content: { type: string; text: string }[] };
    };
    expect(result).toMatchObject({ jsonrpc: "2.0", id: 3 });
    expect(result.result.isError).not.toBe(true);
    expect(result.result.content).toHaveLength(1);
    expect(result.result.content[0]?.type).toBe("text");
    expect(JSON.parse(result.result.content[0]?.text ?? "{}")).toMatchObject({
      user: { id: mocks.session.userId, name: "Transport tester" },
      token: { id: mocks.session.accessToken.id, scope: "read" },
    });
    expect(mocks.recordToolCall).toHaveBeenCalledOnce();
    expect(mocks.recordToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "whoami", outcome: "ok" }),
    );
  });
});
