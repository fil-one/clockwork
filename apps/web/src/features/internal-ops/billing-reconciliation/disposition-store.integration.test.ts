import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase, withInternalTransaction } from "@clockwork/db";

import { recordVarianceDisposition } from "./disposition-store";
import { readReconciliationWorkspace } from "./reconciliation-repository";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 1,
  role: "clockwork_service",
  ssl: false,
});

const accountId = "10000000-0000-4000-8000-000000000004";
const operatorId = "20000000-0000-4000-8000-000000000001";

/** Fresh ids per run: `exception_open_object_unique` is a partial unique. */
const reconciliationCaseId = crypto.randomUUID();
const otherQueueCaseId = crypto.randomUUID();
const reconciliationObjectId = crypto.randomUUID();
const otherObjectId = crypto.randomUUID();

async function seedCase(input: {
  id: string;
  queue: string;
  objectId: string;
}): Promise<void> {
  await withInternalTransaction(
    db,
    `reconciliation-fixture:${input.id}`,
    (transaction) =>
      transaction.execute(sql`
        insert into public.exception_cases (
          id, account_id, queue, object_type, object_id, owner_user_id,
          target_at, status, separation_required
        ) values (
          ${input.id}::uuid, ${accountId}::uuid, ${input.queue}, 'invoice',
          ${input.objectId}::uuid, ${operatorId}::uuid,
          now() + interval '1 day', 'open', false
        )
      `),
  );
}

beforeAll(async () => {
  await seedCase({
    id: reconciliationCaseId,
    queue: "reconciliation",
    objectId: reconciliationObjectId,
  });
  await seedCase({
    id: otherQueueCaseId,
    queue: "billing_operations",
    objectId: otherObjectId,
  });
});

afterAll(async () => {
  // The cases are removed; their audit rows are append-only and stay.
  await withInternalTransaction(
    db,
    `reconciliation-cleanup:${crypto.randomUUID()}`,
    (transaction) =>
      transaction.execute(sql`
        delete from public.exception_cases
        where id in (${reconciliationCaseId}::uuid, ${otherQueueCaseId}::uuid)
      `),
  );
  await client.end();
});

describe("classifying a reconciliation variance", () => {
  it("refuses a case in another queue", async () => {
    // Without the queue predicate this classifies a billing-operations case as
    // a reconciliation variance and the close reads clean.
    await expect(
      recordVarianceDisposition(db, {
        caseId: otherQueueCaseId,
        expectedRowVersion: 1,
        classification: "delivery_timing",
        reason: "wrong queue for this disposition",
        actor: { kind: "user", id: operatorId },
        requestId: `reconciliation-other:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow("RECONCILIATION_CASE_NOT_FOUND");
  });

  it("refuses a disposition written against a stale view of the case", async () => {
    await expect(
      recordVarianceDisposition(db, {
        caseId: reconciliationCaseId,
        expectedRowVersion: 99,
        classification: "delivery_timing",
        reason: "stale page carrying an old version",
        actor: { kind: "user", id: operatorId },
        requestId: `reconciliation-stale:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow("RECONCILIATION_VERSION_CONFLICT");
  });

  it("refuses a reason too short to be evidence", async () => {
    await expect(
      recordVarianceDisposition(db, {
        caseId: reconciliationCaseId,
        expectedRowVersion: 1,
        classification: "delivery_timing",
        reason: "short",
        actor: { kind: "user", id: operatorId },
        requestId: `reconciliation-reason:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow("RECONCILIATION_REASON_REQUIRED");
  });

  it("records the disposition and leaves the case open", async () => {
    const recorded = await recordVarianceDisposition(db, {
      caseId: reconciliationCaseId,
      expectedRowVersion: 1,
      classification: "delivery_timing",
      reason: "Stripe payout lands after the cut-off; clears next period",
      expectedClearingPeriod: "2026-09",
      evidenceReference: "export:sha256:abc",
      actor: { kind: "user", id: operatorId },
      requestId: `reconciliation-classify:${crypto.randomUUID()}`,
    });
    expect(recorded.rowVersion).toBe(2);
    expect(recorded.blocksClose).toBe(false);

    const rows = await withInternalTransaction(
      db,
      `reconciliation-assert:${crypto.randomUUID()}`,
      (transaction) =>
        transaction.execute(sql`
          select kase.status,
                 kase.row_version,
                 kase.decision_reason,
                 record.event_type,
                 record.aggregate_version,
                 record.after->>'classification' as classification,
                 record.after->>'expectedClearingPeriod' as clearing_period,
                 record.after->>'evidenceReference' as evidence_reference,
                 record.after->>'blocksClose' as blocks_close,
                 record.actor->>'id' as actor_id,
                 message.id::text as outbox_id
          from public.exception_cases kase
          join public.audit_events record
            on record.aggregate_type = 'exception_case'
           and record.aggregate_id = kase.id
          left join public.outbox_messages message
            on message.event_id = record.id
          where kase.id = ${reconciliationCaseId}::uuid
        `),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    // Closing a case is a signed decision with an immutable evidence document.
    // A disposition that closed it here would be a way around that.
    expect(row.status).toBe("open");
    expect(row.row_version).toBe(2);
    expect(row.decision_reason).toContain("Delivery timing:");
    expect(row.event_type).toBe("system.reconciliation.variance_classified");
    // The audit version follows the row version the update produced, which is
    // what keeps operator dispositions and lifecycle decisions in one sequence.
    expect(row.aggregate_version).toBe(2);
    expect(row.classification).toBe("delivery_timing");
    expect(row.clearing_period).toBe("2026-09");
    expect(row.evidence_reference).toBe("export:sha256:abc");
    expect(row.blocks_close).toBe("false");
    expect(row.actor_id).toBe(operatorId);
    expect(row.outbox_id).not.toBeNull();
  });

  it("keeps an unexplained variance blocking the close", async () => {
    const recorded = await recordVarianceDisposition(db, {
      caseId: reconciliationCaseId,
      expectedRowVersion: 2,
      classification: "unexplained",
      reason: "no source identified for the residual difference yet",
      actor: { kind: "user", id: operatorId },
      requestId: `reconciliation-unexplained:${crypto.randomUUID()}`,
    });
    expect(recorded.rowVersion).toBe(3);
    expect(recorded.blocksClose).toBe(true);
  });
});

describe("reading the close back", () => {
  it("returns the case with its latest classification and reads the tie-out view", async () => {
    const workspace = await readReconciliationWorkspace(db, {
      requestId: `reconciliation-read:${crypto.randomUUID()}`,
      limit: 200,
    });
    expect(workspace.readable).toBe(true);

    const variance = workspace.variances.find(
      (candidate) => candidate.caseId === reconciliationCaseId,
    );
    expect(variance).toBeDefined();
    expect(variance?.status).toBe("open");
    expect(variance?.rowVersion).toBe(3);
    expect(variance?.latestClassification).toBe("unexplained");

    // That the owner join resolved is the assertion, not which address it
    // resolved to. `repository.integration.test.ts` renames this same seeded
    // operator while it runs, so any assertion on the address -- literal or
    // re-read -- fails on suite interleaving rather than on anything about
    // this read.
    expect(variance?.ownerUserId).toBe(operatorId);
    expect(variance?.ownerEmail).toMatch(/^[^@\s]+@[^@\s]+$/);

    expect(
      workspace.variances.some(
        (candidate) => candidate.caseId === otherQueueCaseId,
      ),
    ).toBe(false);

    // The tie-out half reads a real relation. `mathematicallyTied` is the
    // view's own comparison of the stored variance columns, not the `status`
    // label, so a row can be `resolved` and still not tie.
    for (const period of workspace.periods)
      expect(period.mathematicallyTied).toBe(
        period.billingProviderVarianceMinor === "0" &&
          period.accountingVarianceMinor === "0",
      );
  });
});
