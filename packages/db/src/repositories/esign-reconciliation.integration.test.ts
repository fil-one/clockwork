import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { ContractSigningState } from "@clockwork/contracts";
import { createRuntimeDatabase } from "../client";
import {
  ContractDocumentStores,
  PostgresContractDocumentStore,
} from "./contract-documents";
import { ContractSigningRepository } from "./contracts";
import { ESignReconciliationRepository } from "./esign-reconciliation";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
const signing = new ContractSigningRepository(
  db,
  new ContractDocumentStores(new PostgresContractDocumentStore(db)),
);
const repo = new ESignReconciliationRepository(db);
const actor = { kind: "user" as const, id: randomUUID(), display: "Seller" };
afterAll(() => client.end());

/** A prepared template contract, optionally bound to SignWell in `state`. */
async function contract(
  binding?: { state: ContractSigningState },
  updatedAt?: string,
) {
  const marker = randomUUID();
  const [countersigner] = await signing.countersigners();
  if (!countersigner) throw new Error("seed countersigner missing");
  const id = randomUUID();
  await signing.prepare(
    {
      contract: {
        id,
        counterpartyName: `Bluefin Data ${marker}`,
        title: "",
        contractType: "other",
        paper: "ours",
        status: "draft",
        effectiveDate: "2026-01-01",
        initialTermMonths: 12,
        autoRenew: true,
        renewalTermMonths: 12,
        noticePeriodDays: 60,
        valueMinor: 1_200_000,
        currency: "USD",
        pricingNotes: "",
        ownerName: "R.W. Holleman",
        internalNotes: "",
        tags: [],
      },
      signing: {
        templateId: "test-fixture",
        templateVersion: "1",
        templateHash: "b".repeat(64),
        documentName: `Fil One Engine Test Fixture - Bluefin ${marker}`,
        input: { partner_name: `Bluefin ${marker}` },
        counterpartySigner: {
          name: "Alex Example",
          email: `alex-${marker}@example.com`,
          title: "CEO",
        },
        countersignerId: countersigner.id,
        approvalRequired: false,
        testMode: true,
      },
      pdf: Buffer.from(`%PDF-1.7\n${marker}\n%%EOF`),
      fileName: "Prepared.pdf",
    },
    actor,
  );
  if (binding) {
    const { token } = await signing.claim(id);
    await signing.update(
      id,
      token,
      { providerId: randomUUID(), state: binding.state, error: null },
      actor,
    );
    await signing.release(id, token);
  }
  if (updatedAt)
    await db.execute(
      sql`update commerce_contract_signing set updated_at = ${updatedAt}::timestamptz where contract_id = ${id}`,
    );
  return id;
}

it("finds stale, open, bound and unleased template contract signings, oldest first", async () => {
  const older = await contract({ state: "viewed" }, "2000-01-01T00:00:00Z");
  const old = await contract({ state: "sent" }, "2000-01-02T00:00:00Z");
  const fresh = await contract({ state: "sent" });
  const closed = await contract({ state: "declined" }, "2000-01-01T00:00:00Z");
  const unsent = await contract({ state: "ready" }, "2000-01-01T00:00:00Z");
  const unbound = await contract(undefined, "2000-01-01T00:00:00Z");
  const leased = await contract({ state: "sent" }, "2000-01-01T00:00:00Z");
  const lease = await signing.claim(leased);

  const query = {
    updatedBefore: new Date(Date.now() - 600_000),
    exclude: [] as string[],
    limit: 1000,
  };
  const ids = await repo.staleContractSignings(query);
  expect(ids).toContain(older);
  expect(ids).toContain(old);
  expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(old));
  for (const skipped of [fresh, closed, unsent, unbound, leased])
    expect(ids).not.toContain(skipped);
  expect(
    await repo.staleContractSignings({ ...query, exclude: [older] }),
  ).not.toContain(older);

  await signing.release(leased, lease.token);
  expect(await repo.staleContractSignings(query)).toContain(leased);
  await expect(
    repo.staleContractSignings({ ...query, limit: 0 }),
  ).rejects.toThrow("ESIGN_RECONCILE_LIMIT_INVALID");
});
