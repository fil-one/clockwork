import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";

import {
  fixtureInput,
  fixtureSigner,
} from "../../../contracts/src/mnda-fixture";
import { ContractListQuerySchema } from "@clockwork/contracts";
import { createRuntimeDatabase } from "../client";
import {
  ContractDocumentStores,
  PostgresContractDocumentStore,
} from "./contract-documents";
import { ContractRepository, ContractSigningRepository } from "./contracts";
import { MndaRepository } from "./mnda";
import {
  contractHomeStatusFilters,
  countSalesHomeContracts,
  countSalesHomeMndas,
  salesHomeMndaGroups,
} from "./sales-home";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
afterAll(() => client.end());

const now = new Date("2026-10-04T12:00:00.000Z");
const since = new Date("2026-09-04T12:00:00.000Z");

async function request(
  ownerId: string,
  state: string,
  completedAt: Date | null = null,
) {
  const input = { ...fixtureInput, id: randomUUID() };
  await client`
    insert into commerce_mnda_requests
      (id, input, countersigner, owner_id, owner_name, state, template_hash,
       test_mode, completed_at)
    values (${input.id}, ${JSON.stringify(input)}::jsonb,
      ${JSON.stringify(fixtureSigner)}::jsonb, ${ownerId}::uuid, 'Seller',
      ${state}, ${"a".repeat(64)}, true,
      ${completedAt?.toISOString() ?? null}::timestamptz)`;
}

it("counts a seller's MNDAs by what they wait on, beside the team's", async () => {
  const seller = randomUUID();
  const colleague = randomUUID();
  const before = await countSalesHomeMndas(db, {
    ownerId: seller,
    completedSince: since,
  });
  expect(before.mine).toEqual({
    attention: 0,
    waitingPartner: 0,
    waitingFilOne: 0,
    completed: 0,
    drafts: 0,
  });

  await request(seller, "sent");
  await request(seller, "viewed");
  // Out with SignWell while the send settles: the seller is told it was sent.
  await request(seller, "sending");
  await request(seller, "awaiting_countersignature");
  await request(seller, "completed", new Date("2026-10-01T00:00:00.000Z"));
  // Completed before the window: archive, not recent work.
  await request(seller, "completed", new Date("2026-08-01T00:00:00.000Z"));
  await request(seller, "ready");
  await request(seller, "canceled");
  await request(seller, "attention");
  await request(seller, "attention");
  await request(colleague, "sent");
  await request(colleague, "draft");
  await request(colleague, "attention");

  const after = await countSalesHomeMndas(db, {
    ownerId: seller,
    completedSince: since,
    requestId: `sales-home-test:${now.toISOString()}`,
  });
  expect(after.mine).toEqual({
    attention: 2,
    waitingPartner: 3,
    waitingFilOne: 1,
    completed: 1,
    drafts: 1,
  });
  expect(after.team.waitingPartner - before.team.waitingPartner).toBe(4);
  expect(after.team.waitingFilOne - before.team.waitingFilOne).toBe(1);
  expect(after.team.completed - before.team.completed).toBe(1);
  expect(after.team.drafts - before.team.drafts).toBe(2);
  expect(after.team.attention - before.team.attention).toBe(3);
  // Each home link opens the register filtered to the group's states, which
  // lists exactly the rows counted.
  for (const group of ["attention", "waitingPartner", "drafts"] as const) {
    const register = await new MndaRepository(db).list(
      { status: [...salesHomeMndaGroups[group]], mine: true },
      seller,
    );
    expect(register.total).toBe(after.mine[group]);
  }
});

it("counts contract work for one reader in a single read, matching the register filters", async () => {
  const seller = { kind: "user" as const, id: randomUUID(), display: "Seller" };
  const colleague = {
    kind: "user" as const,
    id: randomUUID(),
    display: "Colleague",
  };
  const stores = new ContractDocumentStores(
    new PostgresContractDocumentStore(db),
  );
  const signing = new ContractSigningRepository(db, stores);
  const register = new ContractRepository(db, stores);
  const run = randomUUID().slice(0, 8);
  const [countersigner] = await signing.countersigners();
  if (!countersigner) throw new Error("seed countersigner missing");
  const prepare = async (
    preparer: typeof seller,
    approvalRequired: boolean,
  ) => {
    const marker = randomUUID();
    const id = randomUUID();
    await signing.prepare(
      {
        contract: {
          id,
          counterpartyName: `Home ${run} ${marker}`,
          title: "",
          contractType: "other",
          paper: "ours",
          status: "draft",
          effectiveDate: null,
          initialTermMonths: null,
          autoRenew: false,
          renewalTermMonths: null,
          noticePeriodDays: null,
          valueMinor: null,
          currency: null,
          pricingNotes: "",
          ownerName: preparer.display,
          internalNotes: "",
          tags: [],
        },
        signing: {
          templateId: "test-fixture",
          templateVersion: "1",
          templateHash: "c".repeat(64),
          documentName: `Home ${marker}`,
          input: {},
          counterpartySigner: {
            name: "Alex Example",
            email: `alex-${marker}@example.com`,
            title: "CEO",
          },
          countersignerId: countersigner.id,
          approvalRequired,
          testMode: true,
        },
        pdf: Buffer.from(`%PDF-1.7\n${marker}\n%%EOF`),
        fileName: "Prepared.pdf",
      },
      preparer,
    );
    return id;
  };
  const move = async (
    id: string,
    patch: { state?: "sent" | "attention"; error?: string },
  ) => {
    const lease = await signing.claim(id);
    await signing.update(
      id,
      lease.token,
      { providerId: randomUUID(), ...patch },
      seller,
    );
    await signing.release(id, lease.token);
  };
  const count = () =>
    countSalesHomeContracts(db, {
      viewerId: seller.id,
      requestId: `sales-home-test:${randomUUID()}`,
    });
  const before = await count();

  // Waiting for approval: one the seller can decide, one they cannot.
  await prepare(colleague, true);
  await prepare(seller, true);
  // Out for signature: the seller's and a colleague's.
  await move(await prepare(seller, false), { state: "sent" });
  await move(await prepare(colleague, false), { state: "sent" });
  // Attention: deleted in SignWell, and a send that failed.
  await move(await prepare(seller, false), {
    state: "attention",
    error: "deleted_in_signwell",
  });
  await move(await prepare(colleague, false), {
    error: "provider_unavailable",
  });
  // Sent back by an approver: the preparer has to act.
  const rejected = await prepare(seller, true);
  await signing.decide(
    rejected,
    { approve: false, reason: "Too long" },
    colleague,
  );

  const after = await count();
  const delta = (group: keyof typeof after) => ({
    mine: after[group].mine - before[group].mine,
    team: after[group].team - before[group].team,
  });
  expect(delta("awaitingApproval")).toEqual({ mine: 1, team: 2 });
  expect(delta("outForSignature")).toEqual({ mine: 1, team: 2 });
  expect(delta("needsAttention")).toEqual({ mine: 2, team: 3 });

  // Each group's filter in the register lists exactly the rows counted.
  for (const [group, total] of [
    ["awaitingApproval", 2],
    ["needsAttention", 3],
    ["outForSignature", 2],
  ] as const) {
    const listed = await register.list(
      ContractListQuerySchema.parse({
        status: contractHomeStatusFilters[group],
        q: run,
      }),
      "2026-10-09",
      { includeMndas: false, viewerId: seller.id },
    );
    expect(listed.total).toBe(total);
  }
});
