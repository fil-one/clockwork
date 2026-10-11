// The owner rule, held structurally: nothing an MCP tool does may reach a
// partner or any other external party. Every write tool runs here through the
// real route against a real database, with SignWell switched on but its
// clients replaced by spies that allow only reads (`get`, `getContract`,
// `completedPdf`), the staff notification email and Slack ports replaced by
// spies, and every network request off this machine refused. A write tool
// added to the registry without a case here fails the suite.
import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  AccessTokenRepository,
  ContractTemplateRepository,
  MndaRepository,
  createRuntimeDatabase,
} from "@clockwork/db";
import { fixtureSectionsContent } from "../../../../../packages/documents/src/__fixtures__/contract-template";

const contact = vi.hoisted(() => ({
  attempts: [] as string[],
  reads: [] as string[],
  readResponses: new Map<string, unknown>(),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("@workos-inc/authkit-nextjs", () => {
  const unreachable = () => {
    contact.attempts.push("workos");
    throw new Error("AuthKit is not used by token requests");
  };
  return {
    withAuth: unreachable,
    getTokenClaims: unreachable,
    getWorkOS: unreachable,
    signOut: unreachable,
  };
});
vi.mock("@clockwork/integrations", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const reads = new Set(["get", "getContract", "completedPdf"]);
  /** A SignWell client whose every method is a spy. */
  const spyClient = (provider: string) =>
    class {
      constructor() {
        return new Proxy(
          {},
          {
            get:
              (_target, method) =>
              (...args: unknown[]): Promise<unknown> => {
                const name = String(method);
                if (!reads.has(name)) {
                  contact.attempts.push(`${provider}.${name}`);
                } else {
                  const key = `${provider}.${name}:${String(args[0])}`;
                  contact.reads.push(key);
                  if (contact.readResponses.has(key))
                    return Promise.resolve(contact.readResponses.get(key));
                }
                return Promise.reject(new Error("SIGNWELL_UNAVAILABLE"));
              },
          },
        );
      }
    };
  const port = (channel: string) => ({
    configured: true,
    target: `${channel}@spy`,
    port: {
      send: () => {
        contact.attempts.push(`${channel}.send`);
        return Promise.resolve({ ok: true, messageId: null });
      },
      post: () => {
        contact.attempts.push(`${channel}.post`);
        return Promise.resolve({ ok: true, messageId: null });
      },
    },
  });
  return {
    ...original,
    SignWellClient: spyClient("signwell-mnda"),
    SignWellContractClient: spyClient("signwell-contracts"),
    staffNotificationChannels: () => ({
      email: port("email"),
      slack: port("slack"),
    }),
    provisionWorkosStaff: () => {
      contact.attempts.push("workos.provision");
      return Promise.reject(new Error("WORKOS_UNAVAILABLE"));
    },
  };
});

const directUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
process.env.CLOCKWORK_SERVICE_DATABASE_URL ??= directUrl;
process.env.INTERNAL_EMAIL_DOMAINS = "clockwork.test";
// Sending is switched on, so a tool that tried to send would reach the spies
// rather than stop at "not configured".
process.env.COMMERCE_MNDA_ENABLED = "true";
process.env.COMMERCE_CONTRACTS_SIGNING_ENABLED = "true";
process.env.SIGNWELL_API_KEY = "spy-key";
process.env.SIGNWELL_WEBHOOK_ID = "spy-webhook";
delete process.env.CLOCKWORK_EXPERIENCE_ADAPTER;
delete process.env.CLOCKWORK_DEMO_DEPLOY;

const realFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  // Local files and data URLs (fonts for the PDF renderer) are not network.
  if (
    ["http:", "https:"].includes(url.protocol) &&
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    contact.attempts.push(`fetch ${url.host}`);
    return Promise.reject(new Error("Network access is refused in this test"));
  }
  return realFetch(input, init);
};

const { POST } = await import("@/app/api/mcp/route");
const { mcpTools } = await import("./registry");

const sql = postgres(directUrl, { max: 1, prepare: false, ssl: false });
const { client, db } = createRuntimeDatabase({
  url: directUrl,
  role: "clockwork_service",
  ssl: false,
});
const filOneOrganization = "30000000-0000-4000-8000-000000000008";
const tag = randomUUID().slice(0, 8);
const person = {
  id: randomUUID(),
  email: `mcp.rule.${tag}@clockwork.test`,
  name: `MCP Rule ${tag}`,
};
const roleTarget = { id: randomUUID(), membershipId: randomUUID() };
let secret = "";
let next = 1;
const partners: string[] = [];
const templateId = `mcp-rule-${tag}`;
const requestedMndaId = randomUUID();
let countersignerId = "";

beforeAll(async () => {
  await sql`insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled)
    values (${person.id}, ${`mcp_rule_${tag}`}, ${person.email}, ${person.name}, true, true)`;
  await sql`insert into memberships (id, organization_id, user_id, role)
    values (${randomUUID()}, ${filOneOrganization}, ${person.id}, 'commerce_admin')`;
  await sql`insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled)
    values (${roleTarget.id}, ${`mcp_role_target_${tag}`}, ${`mcp.target.${tag}@clockwork.test`}, 'MCP role review target', true, true)`;
  await sql`insert into memberships (id, organization_id, user_id, role)
    values (${roleTarget.membershipId}, ${filOneOrganization}, ${roleTarget.id}, 'revenue')`;
  secret = (
    await new AccessTokenRepository(db).create({
      userId: person.id,
      organizationId: filOneOrganization,
      name: "Owner rule",
      scope: "read_write",
      expiresInDays: 1,
      mfaFactorId: null,
      actor: { kind: "user", id: person.id, display: person.name },
    })
  ).secret;
  const templates = new ContractTemplateRepository(db);
  const template = await templates.createDraft(
    { ...fixtureSectionsContent, id: templateId },
    { kind: "user", id: person.id, display: person.name },
    "import",
  );
  await templates.activate(template.id, 1, {
    kind: "user",
    id: person.id,
    display: person.name,
  });
  const signers = await new MndaRepository(db).signers();
  countersignerId = signers.find((signer) => signer.active)?.id ?? "";
  expect(countersignerId).not.toBe("");
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await sql`delete from commerce_partner_deals where partner_id = any(${partners})`;
  await sql`delete from commerce_partners where id = any(${partners})`;
  await sql`delete from memberships where user_id = ${person.id}`;
  await sql`delete from memberships where user_id = ${roleTarget.id}`;
  await sql`delete from commerce_users where id = ${roleTarget.id}`;
  await client.end();
  await sql.end();
});

async function call(name: string, args: Record<string, unknown>) {
  const response = await POST(
    new Request("https://commerce.fil.one/api/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: next++,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  expect(response.status, name).toBe(200);
  const body = (await response.json()) as {
    result: { isError?: boolean; content: { text: string }[] };
  };
  const text = body.result.content[0]?.text ?? "{}";
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch {
    value = { error: text };
  }
  return { ok: !body.result.isError, value };
}

/** A real PDF to prepare for signature: an MNDA rendered for the test. */
async function samplePdf() {
  const { renderMnda } = await import("@clockwork/documents");
  const { MndaInputSchema } = await import("@clockwork/contracts");
  const rendered = await renderMnda(
    MndaInputSchema.parse({
      id: randomUUID(),
      detailsMode: "mixed",
      company: "Sample Paper Co",
      signerName: "Sam Signer",
      signerEmail: "sam@sample.example",
      countersignerId: randomUUID(),
      effectiveDate: "2026-10-11",
    }),
    {
      id: randomUUID(),
      name: "Fil One Signer",
      email: "signer@clockwork.test",
      title: "CEO",
      active: true,
      isDefault: true,
    },
    { noticeEmail: "legal@clockwork.test" },
  );
  return Buffer.from(rendered.bytes).toString("base64");
}

describe("the owner rule", () => {
  // This sequential journey exercises every write tool and renders real PDFs;
  // allow for shared CI runners without relaxing other integration test budgets.
  it("lets no write tool contact anyone outside Fil One", async () => {
    const state: Record<string, string | number> = {};
    const pdf = await samplePdf();
    // A contract signed outside Commerce and recorded as executed is a
    // legitimate handoff source. This fixture only writes local records.
    const signed = await call("record_contract", {
      id: randomUUID(),
      counterpartyName: `Rule Acme ${tag}, Inc.`,
      paper: "theirs",
      status: "executed",
      files: [{ fileName: "signed-acme.pdf", base64: pdf }],
    });
    expect(signed.ok, JSON.stringify(signed.value)).toBe(true);
    const signedContractId = (signed.value.contract as { id: string }).id;
    // One successful case per write tool, in an order where each can use
    // what the earlier ones made. An early refusal must fail this proof.
    const cases: Record<string, () => Record<string, unknown>> = {
      create_mnda_draft: () => ({
        id: requestedMndaId,
        company: `Rule Acme ${tag}, Inc.`,
        signerName: "Ana Ruiz",
        signerEmail: `ana.${tag}@acme.example`,
        detailsMode: "mixed",
      }),
      prepare_mnda_preview: () => ({
        id: state.mndaId,
        changes: { signerTitle: "CFO" },
      }),
      check_mnda_status: () => ({ id: state.mndaId }),
      record_contract: () => ({
        counterpartyName: `Rule Acme ${tag}, Inc.`,
        paper: "theirs",
        status: "in_negotiation",
        files: [{ fileName: "acme.pdf", base64: pdf }],
      }),
      prepare_contract_for_signature: () => ({
        contractId: state.contractId,
        signerName: "Ana Ruiz",
        signerEmail: `ana.${tag}@acme.example`,
        signerTitle: "CFO",
      }),
      prepare_from_template: () => ({
        templateId,
        counterpartyName: `Rule Acme ${tag}, Inc.`,
        effectiveDate: "2026-10-11",
        signerName: "Ana Ruiz",
        signerEmail: `ana.${tag}@acme.example`,
        signerTitle: "CFO",
        countersignerId,
        sections: ["nfr"],
        values: {
          model: "Referral",
          referral_percent: "15",
          sample_revenue: "100000",
          nfr_capacity: "5 TiB for 60 days",
        },
      }),
      check_contract_status: () => ({
        contractId: state.templateContractId,
        requestNumber: state.signingRequestNumber,
      }),
      create_partner: () => ({ name: `Rule Northwind ${tag}` }),
      update_partner: () => ({
        id: state.partnerId,
        expectedVersion: state.partnerVersion,
        status: "talking",
      }),
      register_partner_deal: () => ({
        partnerId: state.partnerId,
        endClient: `Rule Acme ${tag}, Inc.`,
      }),
      update_partner_deal: () => ({
        partnerId: state.partnerId,
        dealId: state.dealId,
        expectedVersion: state.dealVersion,
        status: "won",
      }),
      save_pricing_scenario: () => ({
        name: "Rule scenario",
        company: `Rule Acme ${tag}`,
        lines: [{ rateId: state.rateId, quantity: "100", termMonths: 12 }],
      }),
      create_handoff_request: () => ({
        contractIds: [signedContractId],
        requestedSide: "customer",
        counterpartyLegalName: `Rule Acme ${tag}, Inc.`,
        signerName: "Ana Ruiz",
        signerEmail: `ana.${tag}@acme.example`,
      }),
      mark_notifications_read: () => ({ all: true }),
      prepare_staff_role_change: () => ({
        userId: roleTarget.id,
        action: "grant",
        role: "internal_operator",
        expectedRowVersion: 1,
      }),
    };
    const writes = mcpTools
      .filter(({ access }) => access === "write")
      .map(({ name }) => name)
      .sort();
    expect(Object.keys(cases).sort()).toEqual(writes);

    const books = await call("list_price_books", {});
    state.rateId =
      (books.value.books as { rates: { id: string }[] }[]).flatMap(
        ({ rates }) => rates,
      )[0]?.id ?? randomUUID();

    const outcomes: Record<string, boolean> = {};
    for (const [name, args] of Object.entries(cases)) {
      if (name === "check_contract_status") {
        // This fixture template needs no approval. Simulate an existing sent
        // provider request, then prove refresh only reads its current state.
        const { contractSigningRepository } =
          await import("@/src/features/internal-ops/contracts/server");
        const repository = contractSigningRepository();
        const id = String(state.templateContractId);
        const { record, token } = await repository.claim(id);
        const providerId = randomUUID();
        await repository.update(
          id,
          token,
          { state: "sent", providerId },
          { kind: "user", id: person.id, display: person.name },
        );
        await repository.release(id, token);
        contact.readResponses.set(
          `signwell-contracts.getContract:${providerId}`,
          {
            id: providerId,
            status: "Viewed",
            test_mode: record.testMode,
            metadata: {
              commerce_contract_id: record.contractId,
              template_sha256: record.templateHash,
            },
            apply_signing_order: true,
            recipients: [
              {
                id: "counterparty",
                name: record.counterpartySigner.name,
                email: record.counterpartySigner.email,
              },
              {
                id: "fil-one",
                name: record.countersigner.name,
                email: record.countersigner.email,
              },
            ],
            fields: [
              ["counterparty", "fil-one"].flatMap((recipient_id) =>
                ["signature", "autofill_date_signed"].map((type) => ({
                  recipient_id,
                  type,
                  required: true,
                })),
              ),
            ],
          },
        );
      }
      if (name === "check_mnda_status") {
        // Simulate an already sent request locally, then let the real sync
        // workflow observe a provider read and advance it to viewed.
        const repository = new MndaRepository(db);
        const id = String(state.mndaId);
        const { record, token } = await repository.claim(id);
        const providerId = randomUUID();
        await repository.update(
          id,
          token,
          { state: "sent", providerId },
          { kind: "user", id: person.id, display: person.name },
        );
        await repository.release(id, token);
        contact.readResponses.set(`signwell-mnda.get:${providerId}`, {
          id: providerId,
          status: "Viewed",
          test_mode: record.testMode,
          metadata: {
            commerce_mnda_id: record.id,
            template_sha256: record.templateHash,
          },
          apply_signing_order: true,
          recipients: [
            {
              id: "counterparty",
              name: record.input.signerName,
              email: record.input.signerEmail,
            },
            {
              id: "fil-one",
              name: record.countersigner.name,
              email: record.countersigner.email,
            },
          ],
          fields: [],
        });
      }
      const result = await call(name, args());
      outcomes[name] = result.ok;
      const value = result.value;
      expect(result.ok, `${name}: ${JSON.stringify(value)}`).toBe(true);
      if (name === "create_mnda_draft") {
        const replay = await call(name, args());
        expect(replay.ok, JSON.stringify(replay.value)).toBe(true);
        expect((replay.value.mnda as { id: string }).id).toBe(requestedMndaId);
        expect((value.mnda as { id: string }).id).toBe(requestedMndaId);
      }
      if (name === "prepare_staff_role_change") {
        expect(value).toMatchObject({
          status: "awaiting_browser_confirmation",
          requiresBrowserConfirmation: true,
          member: { userId: roleTarget.id },
        });
        const membership =
          await sql`select role, row_version from memberships where id = ${roleTarget.membershipId}`;
        expect(membership[0]).toMatchObject({
          role: "revenue",
          row_version: 1,
        });
        const roles = await sql<
          { role: string }[]
        >`select role from membership_roles where membership_id = ${roleTarget.membershipId}`;
        expect(roles.map((row) => row.role)).toEqual(["revenue"]);
        const changes =
          await sql`select id from audit_events where aggregate_id = ${roleTarget.membershipId} and event_type in ('staff.role_granted', 'staff.role_revoked')`;
        expect(changes).toHaveLength(0);
      }
      if (name === "check_mnda_status") {
        expect(value.mnda).toMatchObject({ state: "viewed" });
        expect(
          contact.reads.some((read) => read.startsWith("signwell-mnda.get:")),
        ).toBe(true);
      }
      if (name === "prepare_from_template") {
        state.templateContractId = (value.contract as { id: string }).id;
        state.signingRequestNumber = (
          value.signing as { requestNumber: number }
        ).requestNumber;
      }
      if (name === "check_contract_status") {
        expect(value.signing).toMatchObject({
          state: "viewed",
          requestNumber: state.signingRequestNumber,
        });
        expect(
          contact.reads.some((read) =>
            read.startsWith("signwell-contracts.getContract:"),
          ),
        ).toBe(true);
      }
      if (name === "create_mnda_draft" || name === "prepare_mnda_preview")
        state.mndaId = (value.mnda as { id: string } | undefined)?.id ?? "";
      if (name === "record_contract")
        state.contractId =
          (value.contract as { id: string } | undefined)?.id ?? "";
      if (name === "create_partner") {
        state.partnerId = value.id as string;
        state.partnerVersion = value.version as number;
        partners.push(value.id as string);
      }
      if (name === "register_partner_deal") {
        state.dealId = value.id as string;
        state.dealVersion = value.version as number;
      }
    }
    expect(contact.attempts).toEqual([]);
    // The cases did real work, so the rule was tested on tools that ran.
    expect(outcomes).toMatchObject({
      create_mnda_draft: true,
      prepare_mnda_preview: true,
      check_mnda_status: true,
      check_contract_status: true,
      record_contract: true,
      prepare_contract_for_signature: true,
      prepare_from_template: true,
      create_partner: true,
      update_partner: true,
      register_partner_deal: true,
      update_partner_deal: true,
      save_pricing_scenario: true,
      create_handoff_request: true,
      mark_notifications_read: true,
      prepare_staff_role_change: true,
    });
  }, 30_000);

  it("would notice a tool that sent", async () => {
    const { SignWellClient } = await import("@clockwork/integrations");
    await new SignWellClient("spy-key").send("doc", true).catch(() => null);
    expect(contact.attempts).toEqual(["signwell-mnda.send"]);
    contact.attempts.length = 0;
  });
});
