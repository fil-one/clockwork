// End to end through the real route handler and a real database: a personal
// access token, the MCP JSON-RPC exchange, the same server actions the pages
// use, and the audit trail. Next's cache revalidation is stubbed, and so is
// AuthKit, which a token request must never reach.
import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AccessTokenRepository, createRuntimeDatabase } from "@clockwork/db";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// No browser state: the request carries no cookies and no route audience.
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("@workos-inc/authkit-nextjs", () => {
  const unreachable = () => {
    throw new Error("AuthKit is not used by token requests");
  };
  return {
    withAuth: unreachable,
    getTokenClaims: unreachable,
    getWorkOS: unreachable,
    signOut: unreachable,
  };
});

const directUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
process.env.CLOCKWORK_SERVICE_DATABASE_URL ??= directUrl;
process.env.INTERNAL_EMAIL_DOMAINS = "clockwork.test";
delete process.env.CLOCKWORK_EXPERIENCE_ADAPTER;
delete process.env.CLOCKWORK_DEMO_DEPLOY;

const { POST } = await import("@/app/api/mcp/route");

const sql = postgres(directUrl, { max: 1, prepare: false, ssl: false });
const { client, db } = createRuntimeDatabase({
  url: directUrl,
  role: "clockwork_service",
  ssl: false,
});
const tokens = new AccessTokenRepository(db);

const filOneOrganization = "30000000-0000-4000-8000-000000000008";
const tag = randomUUID().slice(0, 8);
const seller = {
  id: randomUUID(),
  membership: randomUUID(),
  email: `mcp.seller.${tag}@clockwork.test`,
  name: `MCP Seller ${tag}`,
};
const partners: string[] = [];
let readWrite = "";
let readOnly = "";
let readWriteId = "";
let next = 1;

beforeAll(async () => {
  await sql`insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled)
    values (${seller.id}, ${`mcp_${tag}`}, ${seller.email}, ${seller.name}, true, true)`;
  await sql`insert into memberships (id, organization_id, user_id, role)
    values (${seller.membership}, ${filOneOrganization}, ${seller.id}, 'revenue')`;
  const actor = { kind: "user" as const, id: seller.id, display: seller.name };
  const created = await tokens.create({
    userId: seller.id,
    organizationId: filOneOrganization,
    name: "Claude Code",
    scope: "read_write",
    expiresInDays: 90,
    mfaFactorId: null,
    actor,
  });
  readWrite = created.secret;
  readWriteId = created.record.id;
  readOnly = (
    await tokens.create({
      userId: seller.id,
      organizationId: filOneOrganization,
      name: "Read only",
      scope: "read",
      expiresInDays: 30,
      mfaFactorId: null,
      actor,
    })
  ).secret;
});

afterAll(async () => {
  // Audit events, tokens and recorded contracts stay behind.
  await sql`delete from commerce_partner_deals where partner_id = any(${partners})`;
  await sql`delete from commerce_partners where id = any(${partners})`;
  await sql`delete from memberships where user_id = ${seller.id}`;
  await client.end();
  await sql.end();
});

function rpc(
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string>,
) {
  return POST(
    new Request("https://commerce.fil.one/api/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: next++, method, params }),
    }),
  );
}
const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

/** A tool's JSON result, or the SDK's own refusal text. */
function parsed(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text };
  }
}

async function call(secret: string, name: string, args: unknown = {}) {
  const response = await rpc(
    "tools/call",
    { name, arguments: args },
    bearer(secret),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result?: { isError?: boolean; content: { text: string }[] };
    error?: { message: string };
  };
  return {
    isError: Boolean(body.result?.isError || body.error),
    value: body.result
      ? parsed(body.result.content[0]?.text ?? "null")
      : { error: body.error?.message },
  };
}

describe("the MCP endpoint", () => {
  it("refuses a request without a bearer token, whatever cookies it carries", async () => {
    const none = await rpc("tools/list", {}, {});
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toMatch(/^Bearer /u);
    const cookie = await rpc(
      "tools/list",
      {},
      { cookie: "wos-session=anything; clockwork-csrf=abc" },
    );
    expect(cookie.status).toBe(401);
    const unknown = await rpc(
      "tools/list",
      {},
      bearer(`fo_pat_${"x".repeat(43)}`),
    );
    expect(unknown.status).toBe(401);
  });

  it("initializes and lists the tools the token's scope allows", async () => {
    const init = await rpc(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1" },
      },
      bearer(readWrite),
    );
    expect(init.status).toBe(200);
    expect(init.headers.get("cache-control")).toBe("private, no-store");
    const initialized = (await init.json()) as {
      result: {
        serverInfo: { name: string };
        capabilities: { tools: unknown };
      };
    };
    expect(initialized.result.serverInfo.name).toBe("fil-one-commerce");
    expect(initialized.result.capabilities.tools).toBeDefined();

    const names = async (secret: string) => {
      const listed = (await (
        await rpc("tools/list", {}, bearer(secret))
      ).json()) as { result: { tools: { name: string }[] } };
      return listed.result.tools.map(({ name }) => name);
    };
    const full = await names(readWrite);
    expect(full).toEqual(
      expect.arrayContaining(["whoami", "create_partner", "create_mnda_draft"]),
    );
    const limited = await names(readOnly);
    expect(limited).toContain("list_partners");
    expect(limited).not.toContain("create_partner");
    expect(limited).not.toContain("create_mnda_draft");
    // Nothing reaches a counterparty from MCP: people send from the app.
    expect(full.filter((name) => /send|remind|void/u.test(name))).toEqual([]);
  });

  it("acts as the token's owner with their current roles", async () => {
    const me = await call(readWrite, "whoami");
    expect(me.isError).toBe(false);
    expect(me.value).toMatchObject({
      user: { id: seller.id, email: seller.email },
      roles: ["revenue"],
      token: { id: readWriteId, scope: "read_write" },
    });
    expect(me.value.permissions).toContain("contract:write");
  });

  it("records a partner through the same action as the page, audited as the person", async () => {
    const name = `MCP Northwind ${tag}`;
    const created = await call(readWrite, "create_partner", {
      name,
      models: ["referral"],
      terms: { commissionPct: "17.5" },
    });
    expect(created.isError).toBe(false);
    const id = created.value.id as string;
    partners.push(id);
    expect(created.value.link).toBe(
      `https://commerce.fil.one/internal/partners/${id}`,
    );
    const listed = await call(readOnly, "list_partners", { search: tag });
    expect(
      (listed.value.partners as { id: string }[]).map((row) => row.id),
    ).toContain(id);

    const [partnerEvent] = await sql<{ actor_id: string }[]>`
      select actor->>'id' as actor_id from audit_events
      where aggregate_type = 'partner' and aggregate_id = ${id}
        and event_type = 'partner.created'`;
    expect(partnerEvent?.actor_id).toBe(seller.id);
    const calls = await sql<
      { tool: string; outcome: string; channel: string; actor_id: string }[]
    >`
      select metadata->>'tool' as tool, metadata->>'outcome' as outcome,
             metadata->>'channel' as channel, actor->>'id' as actor_id
      from audit_events
      where aggregate_type = 'access_token' and aggregate_id = ${readWriteId}
        and event_type = 'mcp.tool_called'
      order by aggregate_version`;
    expect(calls.map(({ tool }) => tool)).toEqual(
      expect.arrayContaining(["whoami", "create_partner"]),
    );
    expect(
      calls.every(
        ({ channel, actor_id }) => channel === "mcp" && actor_id === seller.id,
      ),
    ).toBe(true);
  });

  it("answers every read tool from the app's own loaders", async () => {
    for (const [name, args] of [
      ["home_summary", {}],
      ["list_mndas", { group: "completed" }],
      ["list_contracts", { search: "a" }],
      ["renewal_notices", {}],
      ["list_contract_templates", {}],
      ["partner_next_steps_due", { withinDays: 30 }],
      ["list_price_books", {}],
      ["list_pricing_scenarios", {}],
      ["list_handoffs", {}],
      ["list_sales_library", {}],
      ["list_notifications", {}],
    ] as const) {
      const result = await call(readOnly, name, args);
      expect(result.isError, `${name}: ${JSON.stringify(result.value)}`).toBe(
        false,
      );
    }
  });

  it("records a contract with a PDF, prices a scenario and registers a deal", async () => {
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    const recorded = await call(readWrite, "record_contract", {
      counterpartyName: `MCP Acme ${tag}`,
      contractType: "order_form",
      paper: "theirs",
      status: "in_negotiation",
      value: "120000.00",
      currency: "USD",
      files: [{ fileName: "acme.pdf", base64: pdf.toString("base64") }],
    });
    expect(recorded.isError, JSON.stringify(recorded.value)).toBe(false);
    const contract = recorded.value.contract as { id: string; version: number };
    expect(recorded.value.files).toHaveLength(1);
    const edited = await call(readWrite, "record_contract", {
      id: contract.id,
      expectedVersion: contract.version,
      tags: ["mcp"],
    });
    expect(edited.isError, JSON.stringify(edited.value)).toBe(false);
    expect((edited.value.contract as { tags: string[] }).tags).toEqual(["mcp"]);
    const stale = await call(readWrite, "record_contract", {
      id: contract.id,
      expectedVersion: contract.version,
      tags: ["stale"],
    });
    expect(stale.isError).toBe(true);

    const books = await call(readOnly, "list_price_books");
    const rate = (
      books.value.books as { rates: { id: string; unit: string }[] }[]
    ).flatMap(({ rates }) => rates)[0];
    expect(rate, "the seed has a price book in force").toBeDefined();
    if (rate) {
      const priced = await call(readOnly, "indicative_price", {
        lines: [{ rateId: rate.id, quantity: "500", termMonths: 12 }],
        partnerEconomics: { model: "referral", commissionBps: 1500 },
      });
      expect(priced.isError, JSON.stringify(priced.value)).toBe(false);
      expect((priced.value.total as { amount: string }).amount).toMatch(
        /^\d+\.\d{2}$/u,
      );
      expect(priced.value.partnerEconomics).toBeDefined();
      const saved = await call(readWrite, "save_pricing_scenario", {
        name: "MCP scenario",
        company: `MCP Acme ${tag}`,
        lines: [{ rateId: rate.id, quantity: "500", termMonths: 12 }],
      });
      expect(saved.isError, JSON.stringify(saved.value)).toBe(false);
      const link = await call(readOnly, "pricing_summary_pdf_link", {
        id: saved.value.id,
      });
      expect(link.value.link).toMatch(
        /\/internal\/pricing\/scenarios\/.+\/summary$/u,
      );
    }

    const partner = await call(readWrite, "create_partner", {
      name: `MCP Southwind ${tag}`,
    });
    partners.push(partner.value.id as string);
    const deal = await call(readWrite, "register_partner_deal", {
      partnerId: partner.value.id,
      endClient: `MCP Acme ${tag}, Inc.`,
      estimatedSize: "2",
      sizeUnit: "PB",
    });
    expect(deal.isError, JSON.stringify(deal.value)).toBe(false);
    const won = await call(readWrite, "update_partner_deal", {
      partnerId: partner.value.id,
      dealId: deal.value.id,
      expectedVersion: deal.value.version,
      status: "won",
    });
    expect(won.isError, JSON.stringify(won.value)).toBe(false);
    expect(won.value.status).toBe("won");
    const updated = await call(readWrite, "update_partner", {
      id: partner.value.id,
      expectedVersion: partner.value.version,
      status: "talking",
    });
    expect(updated.isError, JSON.stringify(updated.value)).toBe(false);
  });

  it("refuses a call with invalid arguments, and audits it", async () => {
    const attempt = await call(readWrite, "get_mnda", { id: "not-an-id" });
    expect(attempt.isError).toBe(true);
    const [audited] = await sql<{ code: string }[]>`
      select metadata->>'code' as code from audit_events
      where aggregate_type = 'access_token' and aggregate_id = ${readWriteId}
        and metadata->>'tool' = 'get_mnda'`;
    expect(audited?.code).toBe("INVALID_ARGUMENTS");
  });

  it("refuses what the person's role does not allow, and audits the refusal", async () => {
    const queue = await call(readWrite, "list_handoffs", { scope: "queue" });
    expect(queue.isError).toBe(true);
    expect(queue.value.error).toBe("CONTRACT_FORBIDDEN");
    const [refused] = await sql<{ outcome: string; code: string }[]>`
      select metadata->>'outcome' as outcome, metadata->>'code' as code
      from audit_events
      where aggregate_type = 'access_token' and aggregate_id = ${readWriteId}
        and metadata->>'tool' = 'list_handoffs'`;
    expect(refused).toEqual({ outcome: "refused", code: "CONTRACT_FORBIDDEN" });
  });

  it("does not run a write tool for a read-only token", async () => {
    const attempt = await call(readOnly, "create_partner", { name: "Nope" });
    expect(attempt.isError).toBe(true);
    expect(String(attempt.value.error)).toMatch(/create_partner disabled/u);
    const [nope] = await sql<{ count: number }[]>`
      select count(*)::int as count from commerce_partners where name = 'Nope'`;
    expect(nope?.count).toBe(0);
    const [audited] = await sql<{ outcome: string; code: string }[]>`
      select a.metadata->>'outcome' as outcome, a.metadata->>'code' as code
      from audit_events a
      join commerce_access_tokens t on t.id = a.aggregate_id
      where a.aggregate_type = 'access_token' and t.user_id = ${seller.id}
        and t.scope = 'read' and a.metadata->>'tool' = 'create_partner'`;
    expect(audited).toEqual({ outcome: "refused", code: "READ_ONLY_TOKEN" });
  });

  it("refuses a batch, so every call counts against the rate limit", async () => {
    const response = await POST(
      new Request("https://commerce.fil.one/api/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          ...bearer(readOnly),
        },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
        ]),
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      "MCP_BATCH_REFUSED",
    );
  });

  it("audits a call the transport refused with its HTTP status", async () => {
    const response = await POST(
      new Request("https://commerce.fil.one/api/mcp", {
        method: "POST",
        headers: {
          accept: "text/plain",
          "content-type": "application/json",
          ...bearer(readOnly),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_partners", arguments: {} },
        }),
      }),
    );
    expect(response.status).toBe(406);
    const [audited] = await sql<{ code: string; status: string }[]>`
      select a.metadata->>'code' as code, a.metadata->>'httpStatus' as status
      from audit_events a
      join commerce_access_tokens t on t.id = a.aggregate_id
      where a.aggregate_type = 'access_token' and t.user_id = ${seller.id}
        and t.scope = 'read' and a.metadata->>'tool' = 'list_partners'
        and a.metadata->>'outcome' = 'refused'`;
    expect(audited).toEqual({ code: "TRANSPORT_REFUSED", status: "406" });
  });

  it("stops reading a body past the limit, whatever length it declares", async () => {
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.length;
        if (sent > 40 * chunk.length) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const response = await POST(
      new Request("https://commerce.fil.one/api/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          ...bearer(readOnly),
        },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(sent).toBeLessThan(20 * chunk.length);
  });

  it("limits each token to its requests per minute", async () => {
    const limited = await tokens.create({
      userId: seller.id,
      organizationId: filOneOrganization,
      name: "Busy",
      scope: "read",
      expiresInDays: 1,
      mfaFactorId: null,
      actor: { kind: "user", id: seller.id, display: seller.name },
    });
    await sql`update commerce_access_tokens
      set rate_window_started_at = now(), rate_window_count = 120
      where id = ${limited.record.id}`;
    const response = await rpc("tools/list", {}, bearer(limited.secret));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("stops a revoked token, and every token when staff access is removed", async () => {
    await tokens.revoke({
      id: readWriteId,
      actor: { kind: "user", id: seller.id, display: seller.name },
      reason: "owner",
      ownerId: seller.id,
    });
    expect((await rpc("tools/list", {}, bearer(readWrite))).status).toBe(401);
    expect((await rpc("tools/list", {}, bearer(readOnly))).status).toBe(200);
    await sql`delete from memberships where id = ${seller.membership}`;
    expect((await rpc("tools/list", {}, bearer(readOnly))).status).toBe(401);
    const [revoked] = await sql<{ revoked_reason: string }[]>`
      select revoked_reason from commerce_access_tokens
      where user_id = ${seller.id} and name = 'Read only'`;
    expect(revoked?.revoked_reason).toBe("membership_removed");
  });
});
