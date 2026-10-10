import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { HandoffRequestRepository } from "./handoff-requests";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});

const repo = new HandoffRequestRepository(db);
const seller = { kind: "user" as const, id: randomUUID(), display: "Seller" };
const otherSeller = { kind: "user" as const, id: randomUUID(), display: "B" };
const operator = { kind: "user" as const, id: randomUUID(), display: "Ops" };
const company = `Handoff Test ${randomUUID().slice(0, 8)}, Inc.`;
const executed = randomUUID();
const secondExecuted = randomUUID();
const unsigned = randomUUID();
const mnda = randomUUID();
const third = randomUUID();
const otherMnda = randomUUID();
const otherScenario = randomUUID();
const requests: string[] = [];

beforeAll(async () => {
  await client`insert into commerce_contracts
    (id, counterparty_name, contract_type, paper, status, owner_name, created_by_id, created_by_name)
    values
      (${executed}, ${company}, 'customer_msa', 'ours', 'executed', 'Seller', ${seller.id}, 'Seller'),
      (${secondExecuted}, ${company}, 'order_form', 'ours', 'executed', 'Seller', ${seller.id}, 'Seller'),
      (${unsigned}, ${company}, 'order_form', 'ours', 'out_for_signature', 'Seller', ${seller.id}, 'Seller'),
      (${third}, ${company}, 'dpa', 'ours', 'executed', 'Seller', ${seller.id}, 'Seller')`;
  await client`insert into commerce_mnda_requests
    (id, input, countersigner, owner_id, owner_name, state, template_hash, test_mode, completed_at)
    values (${otherMnda}, ${JSON.stringify({ company: "Unrelated Holdings Ltd", signerName: "Kim" })}::jsonb,
      '{}', ${otherSeller.id}, 'B', 'completed', ${"a".repeat(64)}, true, now())`;
  await client`insert into commerce_pricing_scenarios
    (id, owner_id, owner_name, name, company, currency, as_of, price_books, lines)
    values (${otherScenario}, ${otherSeller.id}, 'B', 'Their pilot', ${company}, 'USD', '2026-10-10',
      '[{"id":"60000000-0000-4000-8000-000000000001","version":1}]', '[{"sku":"STORAGE-TB"}]')`;
  await client`insert into commerce_mnda_requests
    (id, input, countersigner, owner_id, owner_name, state, template_hash, test_mode, completed_at)
    values (${mnda}, ${JSON.stringify({ company, signerName: "Pat Lee" })}::jsonb, '{}', ${seller.id},
      'Seller', 'completed', ${"a".repeat(64)}, true, now())`;
});

afterAll(async () => {
  await client`delete from commerce_handoff_requests where id = any(${requests})`;
  await client`delete from commerce_mnda_requests where id = any(${[mnda, otherMnda]})`;
  await client`delete from commerce_pricing_scenarios where id = ${otherScenario}`;
  await client`delete from commerce_contracts where id = any(${[executed, secondExecuted, unsigned, third]})`;
  await client.end();
});

const input = (overrides: Record<string, unknown> = {}) => {
  const id = randomUUID();
  requests.push(id);
  return {
    id,
    contractIds: [executed],
    counterpartyLegalName: company,
    signerName: "Pat Lee",
    signerEmail: "Pat@Acme.test",
    requestedSide: "customer",
    notes: "Live from 1 November",
    ...overrides,
  };
};

const auditTypes = async (id: string) =>
  (
    await client<{ event_type: string }[]>`
      select event_type from audit_events
      where aggregate_type = 'handoff_request' and aggregate_id = ${id}
      order by aggregate_version`
  ).map((row) => row.event_type);

describe("HandoffRequestRepository", () => {
  it("raises a request once, refuses unsigned contracts and audits it", async () => {
    const raw = input({ mndaId: mnda });
    const created = await repo.create(raw, seller);
    expect(created).toMatchObject({
      status: "open",
      signerEmail: "pat@acme.test",
      mndaId: mnda,
      requestedByName: "Seller",
      version: 1,
    });
    await expect(repo.create(raw, seller)).resolves.toMatchObject({
      id: created.id,
    });
    await expect(repo.create(raw, otherSeller)).rejects.toThrow(
      "HANDOFF_IDEMPOTENCY_CONFLICT",
    );
    await expect(
      repo.create(input({ contractIds: [unsigned] }), seller),
    ).rejects.toThrow("HANDOFF_CONTRACT_NOT_SIGNED");
    await expect(repo.create(input(), otherSeller)).rejects.toThrow(
      "HANDOFF_ALREADY_REQUESTED",
    );
    expect(await auditTypes(created.id)).toEqual(["handoff.requested"]);

    const context = await repo.contractContext(executed, {
      kind: "own",
      userId: seller.id,
    });
    expect(context.contract).toMatchObject({ id: executed, signed: true });
    expect(context.mndas.map(({ id }) => id)).toContain(mnda);
    expect(context.requests.map(({ id }) => id)).toEqual([created.id]);
  });

  it("lists a seller's own requests and the whole queue", async () => {
    const own = await repo.list({ kind: "own", userId: seller.id });
    expect(own.every((row) => row.requestedById === seller.id)).toBe(true);
    expect(await repo.list({ kind: "own", userId: otherSeller.id })).toEqual(
      [],
    );
    const queue = await repo.list({ kind: "all" }, "open");
    expect(queue.map(({ id }) => id)).toContain(own[0]?.id);
    await expect(
      repo.get(own[0]?.id ?? "", { kind: "own", userId: otherSeller.id }),
    ).rejects.toThrow("HANDOFF_NOT_FOUND");
    const detail = await repo.get(own[0]?.id ?? "", { kind: "all" });
    expect(detail.contracts.map(({ id }) => id)).toEqual([executed]);
    expect(detail.mnda).toMatchObject({ id: mnda, company });
  });

  it("is taken, then completed, with every step audited", async () => {
    const [request] = await repo.list({ kind: "own", userId: seller.id });
    if (!request) throw new Error("request missing");
    await expect(
      repo.complete({ id: request.id, expectedVersion: 1 }, operator),
    ).rejects.toThrow("HANDOFF_TRANSITION_INVALID");
    const taken = await repo.take(
      { id: request.id, expectedVersion: 1 },
      operator,
    );
    expect(taken).toMatchObject({
      status: "in_progress",
      assigneeId: operator.id,
      assigneeName: "Ops",
      version: 2,
    });
    await expect(
      repo.take({ id: request.id, expectedVersion: 1 }, operator),
    ).rejects.toThrow("HANDOFF_VERSION_CONFLICT");
    // Only the person working it completes it.
    await expect(
      repo.complete({ id: request.id, expectedVersion: 2 }, seller),
    ).rejects.toThrow("HANDOFF_NOT_ASSIGNEE");
    const done = await repo.complete(
      { id: request.id, expectedVersion: 2, note: "  Account opened  " },
      operator,
    );
    expect(done).toMatchObject({
      status: "done",
      decisionNote: "Account opened",
    });
    expect(done.decidedAt).not.toBeNull();
    await expect(
      repo.decline(
        { id: request.id, expectedVersion: 3, note: "No" },
        operator,
      ),
    ).rejects.toThrow("HANDOFF_REQUEST_CLOSED");
    expect(await auditTypes(request.id)).toEqual([
      "handoff.requested",
      "handoff.taken",
      "handoff.completed",
    ]);
  });

  it("attaches only the seller's own scenario and an MNDA with the contract's company", async () => {
    await expect(
      repo.create(
        input({ contractIds: [third], pricingScenarioId: otherScenario }),
        seller,
      ),
    ).rejects.toThrow("HANDOFF_PRICING_SCENARIO_NOT_OWNED");
    await expect(
      repo.create(input({ contractIds: [third], mndaId: otherMnda }), seller),
    ).rejects.toThrow("HANDOFF_MNDA_COMPANY_MISMATCH");
    // A commerce administrator reaches every seller's scenarios.
    const admin = await repo.create(
      input({
        contractIds: [third],
        pricingScenarioId: otherScenario,
        mndaId: mnda,
      }),
      operator,
      { anyScenario: true },
    );
    expect(admin).toMatchObject({
      pricingScenarioId: otherScenario,
      mndaId: mnda,
    });
    const detail = await repo.get(admin.id, { kind: "all" });
    expect(detail.contracts).toEqual([
      expect.objectContaining({ id: third, signedVia: "recorded" }),
    ]);
    // A commerce administrator may complete a request someone else took.
    await repo.take({ id: admin.id, expectedVersion: 1 }, operator);
    await expect(
      repo.complete({ id: admin.id, expectedVersion: 2 }, seller, {
        anyAssignee: true,
      }),
    ).resolves.toMatchObject({ status: "done" });
  });

  it("declines only with a note, and the contract can be handed off again", async () => {
    const request = await repo.create(
      input({ contractIds: [secondExecuted], requestedSide: "partner" }),
      seller,
    );
    await expect(
      repo.decline({ id: request.id, expectedVersion: 1 }, operator),
    ).rejects.toThrow("HANDOFF_DECLINE_NOTE_REQUIRED");
    const declined = await repo.decline(
      { id: request.id, expectedVersion: 1, note: "Sign the order form too" },
      operator,
    );
    expect(declined).toMatchObject({
      status: "declined",
      decisionNote: "Sign the order form too",
    });
    await expect(
      repo.create(input({ contractIds: [secondExecuted] }), seller),
    ).resolves.toMatchObject({ status: "open" });
    expect(await auditTypes(request.id)).toEqual([
      "handoff.requested",
      "handoff.declined",
    ]);
  });
});
