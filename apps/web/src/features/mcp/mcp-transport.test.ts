import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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

describe("MCP SDK client interoperability", () => {
  it("initializes, lists allowed tools, calls whoami and audits the call", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${canonicalOrigin}/api/mcp`),
      {
        requestInit: { headers: { authorization: `Bearer ${secret}` } },
        fetch: (input, init) => handleMcpRequest(new Request(input, init)),
      },
    );
    const client = new Client({
      name: "clockwork-transport-test",
      version: "1",
    });
    try {
      // SDK 1.30.1 declares its concrete sessionId as string | undefined,
      // while Transport makes it optional; both represent the same wire state.
      await client.connect(transport as Parameters<Client["connect"]>[0]);
      expect(client.getServerVersion()?.name).toBe("fil-one-commerce");
      const listed = await client.listTools();
      expect(listed.tools.map(({ name }) => name)).toContain("whoami");
      expect(listed.tools.map(({ name }) => name)).not.toContain(
        "create_partner",
      );
      const result = await client.callTool({ name: "whoami", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.content).toMatchObject([{ type: "text" }]);
      expect(JSON.stringify(result.content)).toContain("Transport tester");
      expect(mocks.recordToolCall).toHaveBeenCalledOnce();
      expect(mocks.recordToolCall).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "whoami", outcome: "ok" }),
      );
    } finally {
      await client.close();
    }
  });
});
