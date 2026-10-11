import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { CommerceSession } from "@/src/auth/session";

vi.mock("@workos-inc/authkit-nextjs", () => ({
  getTokenClaims: () => {
    throw new Error("AuthKit is not used by token requests");
  },
  withAuth: () => {
    throw new Error("AuthKit is not used by token requests");
  },
  getWorkOS: () => {
    throw new Error("AuthKit is not used by token requests");
  },
  signOut: () => undefined,
}));
vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("A token request must not read cookies");
  },
  headers: () => {
    throw new Error("A token request must not read request headers");
  },
}));

const { mcpTools } = await import("./registry");
const { runTool, toolAllowed } = await import("./server");
const { bearerSecret, handleMcpRequest } = await import("./handler");
const { defineTool, McpToolError } = await import("./tool");
const { getCommerceSession, runWithAccessTokenSession } =
  await import("@/src/auth/session");

function tokenSession(scope: "read" | "read_write") {
  return {
    userId: "20000000-0000-4000-8000-0000000000aa",
    organizationId: "30000000-0000-4000-8000-000000000008",
    accountIds: [],
    roles: ["revenue"],
    permissions: ["mnda:send", "contract:read", "contract:write", "sales:read"],
    side: "fil_one",
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: false,
    profile: { name: "Rae Seller", email: "rae@clockwork.test" },
    memberships: [],
    providerBacked: true,
    authenticationSource: "access-token",
    accessToken: {
      id: "019a44ae-0000-7000-8000-0000000e0001",
      name: "Laptop",
      scope,
      expiresAt: "2027-01-01T00:00:00.000Z",
    },
  } satisfies CommerceSession;
}

const context = (scope: "read" | "read_write") => ({
  session: tokenSession(scope),
  origin: "https://commerce.fil.one",
});

afterEach(() => vi.unstubAllEnvs());

const toolsDirectory = join(process.cwd(), "src/features/mcp/tools");

/** The text a tool result carries. */
function text(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

describe("the MCP tool set", () => {
  it("names every tool once, in snake_case, with a description", () => {
    const names = mcpTools.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of mcpTools) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/u);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("offers nothing that is kept to the app", () => {
    for (const { name } of mcpTools) {
      if (name === "prepare_staff_role_change") continue;
      expect(name).not.toMatch(
        /approv|decide|role|permission|capabilit|setting|owner_console|assist|impersonat|team|signatory|countersigner_manage|price_book_publish/u,
      );
    }
  });

  it("marks every tool that changes something as a write", () => {
    const writes = mcpTools
      .filter(({ access }) => access === "write")
      .map(({ name }) => name)
      .sort();
    expect(writes).toEqual(
      [
        "check_contract_status",
        "check_mnda_status",
        "create_handoff_request",
        "create_mnda_draft",
        "create_partner",
        "mark_notifications_read",
        "prepare_contract_for_signature",
        "prepare_from_template",
        "prepare_mnda_preview",
        "prepare_staff_role_change",
        "record_contract",
        "register_partner_deal",
        "save_pricing_scenario",
        "update_partner",
        "update_partner_deal",
      ].sort(),
    );
  });
});

/**
 * Owner rule: nothing an MCP tool does may reach a partner or any other
 * external party. Tools may draft and prepare; a person sends from the app.
 * These are the actions and workflow calls that email, message or notify a
 * counterparty, directly or through SignWell.
 */
describe("the rule that MCP never contacts a counterparty", () => {
  const sendingActions = [
    "resendContract",
    "correctMndaSigner",
    "correctContractSigner",
    "voidMnda",
    "voidContract",
    "decideContract",
    "sendNotificationTest",
  ];
  const sendingOperations = /operation:\s*"(send|remind|cancel|void)"/u;
  const sendingCalls =
    /\.(send|remind|resend|void|correctSigner|updateRecipient)\(/u;
  const toolSources = readdirSync(toolsDirectory)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({
      name,
      source: readFileSync(join(toolsDirectory, name), "utf8"),
    }));

  it("registers no tool named for sending, reminding, voiding or fixing an address", () => {
    for (const { name } of mcpTools)
      expect(name).not.toMatch(/send|remind|resend|void|fix_|correct/u);
  });

  it("calls no action or workflow step that reaches a counterparty", () => {
    expect(toolSources.length).toBeGreaterThan(5);
    for (const { name, source } of toolSources) {
      for (const action of sendingActions)
        expect(source, `${name} uses ${action}`).not.toMatch(
          new RegExp(`\\b${action}\\b`, "u"),
        );
      expect(source, `${name} sends through an operation`).not.toMatch(
        sendingOperations,
      );
      expect(source, `${name} calls a sending step`).not.toMatch(sendingCalls);
    }
  });

  it("hands every prepared draft back to the app to send", async () => {
    const { createMndaDraft } = await import("./tools/mndas");
    const { prepareContractForSignature, prepareFromTemplate } =
      await import("./tools/contracts");
    for (const tool of [
      createMndaDraft,
      prepareContractForSignature,
      prepareFromTemplate,
    ])
      expect(tool.description, tool.name).toMatch(/Nothing is sent/u);
  });
});

describe("running a tool", () => {
  const changed = vi.fn(() => Promise.resolve({ changed: true }));
  const write = defineTool({
    name: "change_something",
    title: "Change",
    description: "Changes something for the test.",
    input: {},
    access: "write",
    run: changed,
  });

  it("refuses a write tool for a read-only token without running it, and audits the refusal", async () => {
    const record = vi.fn(() => Promise.resolve());
    const result = await runTool(write, {}, context("read"), record);
    expect(toolAllowed(write, "read")).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result))).toMatchObject({
      error: "READ_ONLY_TOKEN",
    });
    expect(record).toHaveBeenCalledWith({
      tool: "change_something",
      outcome: "refused",
      code: "READ_ONLY_TOKEN",
      targets: {},
    });
  });

  it("returns a tool's result as compact JSON and audits the ids it named", async () => {
    const record = vi.fn(() => Promise.resolve());
    const tool = defineTool({
      name: "read_something",
      title: "Read",
      description: "Reads something for the test.",
      input: {},
      access: "read",
      run: (_args, { targets }) => {
        targets.mndaId = "m-1";
        return Promise.resolve({ id: "m-1" });
      },
    });
    const result = await runTool(tool, {}, context("read"), record);
    expect(result.isError).toBeUndefined();
    expect(text(result)).toBe('{"id":"m-1"}');
    expect(record).toHaveBeenCalledWith({
      tool: "read_something",
      outcome: "ok",
      targets: { mndaId: "m-1" },
    });
  });

  it("points an action that needs a fresh MFA check to the app", async () => {
    const tool = defineTool({
      name: "needs_recent_mfa",
      title: "Sensitive",
      description: "Needs a recent sign-in for the test.",
      input: {},
      access: "read",
      run: () =>
        Promise.reject(
          new Error("Sensitive action requires recent authentication"),
        ),
    });
    const result = await runTool(tool, {}, context("read_write"), () =>
      Promise.resolve(),
    );
    expect(JSON.parse(text(result))).toEqual({
      error: "RECENT_AUTH_REQUIRED",
      message:
        "This needs a fresh MFA check, so it can only be done in the app: https://commerce.fil.one/internal",
    });
  });

  it("words refusals and hides unexpected failures", async () => {
    const refusing = defineTool({
      name: "refuses",
      title: "Refuses",
      description: "Refuses for the test, with a code.",
      input: {},
      access: "read",
      run: () => Promise.reject(new McpToolError("CONTRACT_FORBIDDEN")),
    });
    const failing = defineTool({
      name: "fails",
      title: "Fails",
      description: "Fails for the test with provider detail.",
      input: {},
      access: "read",
      run: () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1")),
    });
    const noop = () => Promise.resolve();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = await runTool(refusing, {}, context("read"), noop);
    const refusal = JSON.parse(text(refused)) as {
      error: string;
      message: string;
    };
    expect(refusal.error).toBe("CONTRACT_FORBIDDEN");
    expect(refusal.message).toMatch(/role does not allow/u);
    const failed = await runTool(failing, {}, context("read"), noop);
    expect(text(failed)).not.toContain("ECONNREFUSED");
    expect(JSON.parse(text(failed))).toMatchObject({
      error: "UNEXPECTED",
    });
  });
});

describe("the token session", () => {
  it("is the session every reader sees, with no cookie read", async () => {
    const session = tokenSession("read");
    await expect(
      runWithAccessTokenSession(session, () => getCommerceSession()),
    ).resolves.toBe(session);
  });

  it("binds only an access-token session", () => {
    expect(() =>
      runWithAccessTokenSession(
        { ...tokenSession("read"), authenticationSource: "workos" },
        () => null,
      ),
    ).toThrow();
  });
});

describe("the endpoint", () => {
  const request = (init: RequestInit = {}) =>
    new Request("https://commerce.fil.one/api/mcp", {
      method: "POST",
      body: "{}",
      ...init,
    });

  it("reads a bearer token from the Authorization header only", () => {
    const secret = `fo_pat_${"a".repeat(43)}`;
    expect(
      bearerSecret(request({ headers: { authorization: `Bearer ${secret}` } })),
    ).toBe(secret);
    expect(
      bearerSecret(request({ headers: { authorization: `bearer ${secret}` } })),
    ).toBe(secret);
    expect(bearerSecret(request({ headers: { authorization: secret } }))).toBe(
      null,
    );
    expect(
      bearerSecret(request({ headers: { cookie: `token=${secret}` } })),
    ).toBe(null);
  });

  it("asks for a token, and answers only POST", async () => {
    const missing = await handleMcpRequest(request());
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toMatch(/^Bearer /u);
    const get = await handleMcpRequest(request({ method: "GET", body: null }));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("builds no links from the request's Host in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLOCKWORK_CANONICAL_ORIGIN", "");
    const response = await handleMcpRequest(
      request({
        headers: { authorization: `Bearer fo_pat_${"a".repeat(43)}` },
      }),
    );
    expect(response.status).toBe(503);
  });

  it("is turned off in the demo", async () => {
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "development");
    const response = await handleMcpRequest(
      request({
        headers: { authorization: `Bearer fo_pat_${"a".repeat(43)}` },
      }),
    );
    expect(response.status).toBe(404);
  });
});
