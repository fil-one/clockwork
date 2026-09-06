import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  PaygOfferTermsSchema,
  type PaygOfferRecord,
} from "@clockwork/domain/core";

import { createRuntimeDatabase } from "../../client";
import { auditEvents, commerceUsers, memberships } from "../../schema";
import { paygOfferVersions } from "../../schema/core/payg-offers";
import { withInternalTransaction } from "../../transaction";
import { DatabasePaygOfferRepository } from "./payg-offers";

const { db, client } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabasePaygOfferRepository(db);
const creator = randomUUID();
const approver = randomUUID();
const operator = randomUUID();
const runId = randomUUID();
const now = "2026-09-06T00:00:00.000Z";
const terms = PaygOfferTermsSchema.parse({
  name: "PAYG integration test",
  sku: `PAYG-${runId}`,
  region: "test-region",
  version: 1,
  effectiveFrom: "2026-09-01",
  sourceUri: "https://docs.fil.one/billing/trial",
  sourceCheckedAt: now,
  sourceDocumentId: "test-source",
  owner: "Test finance",
  payg: {
    currency: "USD",
    storageTbMonthMinor: "499",
    monthlyMinimumMinor: "499",
    partialMonthMinimum: "full",
    correctionWindowDays: 90,
    aggregation: "hourly_average_daily_utc",
    egressRateMinor: "0",
    apiRateMinor: "0",
    stripeTaxCode: "txcd_10103001",
    qboIncomeAccount: "4000-Storage",
  },
  trial: {
    durationDays: 30,
    gracePeriodDays: 7,
    storageLimitBytes: "1000000000000",
    cumulativeEgressLimitBytes: "2000000000000",
    maximumCounterAgeSeconds: 60,
    egressExhaustion: "disable_all",
  },
});
const call = (
  command: Parameters<typeof repository.command>[0]["command"],
  userId = creator,
) =>
  repository.command({
    command,
    actor: { kind: "user", id: userId },
    requestId: randomUUID(),
    now,
  });
let draft: PaygOfferRecord;

beforeAll(async () => {
  await withInternalTransaction(db, randomUUID(), async (tx) => {
    for (const id of [creator, approver, operator]) {
      await tx.insert(commerceUsers).values({
        id,
        workosUserId: `payg-${id}`,
        email: `payg-${id}@clockwork.test`,
        name: "PAYG test finance",
        isInternalStaff: true,
        mfaEnrolled: true,
      });
      await tx.insert(memberships).values({
        userId: id,
        organizationId: "30000000-0000-4000-8000-000000000008",
        role: id === operator ? "internal_operator" : "finance_approver",
      });
    }
  });
});
afterAll(async () => client.end());

describe.sequential("persisted PAYG offer administration", () => {
  it("requires persisted finance authority and saves an audited draft", async () => {
    await expect(call({ action: "create", terms }, operator)).rejects.toThrow(
      "PAYG_OFFER_FINANCE_AUTHORITY_REQUIRED",
    );
    draft = await call({ action: "create", terms });
    expect(draft.status).toBe("draft");
    const [audit] = await withInternalTransaction(db, randomUUID(), (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.aggregateId, draft.id)),
    );
    expect(audit?.eventType).toBe("payg.offer.create");
    expect(audit?.after).toMatchObject({ terms });
  });
  it("serializes concurrent edits and refuses stale versions without partial audit writes", async () => {
    const command = {
      action: "save" as const,
      id: draft.id,
      expectedRowVersion: draft.rowVersion,
      terms: { ...terms, name: "Edited policy" },
    };
    const results = await Promise.allSettled([call(command), call(command)]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    draft = (
      results.find(
        (result) => result.status === "fulfilled",
      ) as PromiseFulfilledResult<PaygOfferRecord>
    ).value;
    const audits = await withInternalTransaction(db, randomUUID(), (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.aggregateId, draft.id)),
    );
    expect(audits).toHaveLength(2);
  });
  it("freezes a proposed version, requires a second finance user, and records approval evidence", async () => {
    draft = await call({
      action: "propose",
      id: draft.id,
      expectedRowVersion: draft.rowVersion,
      reason: "Review full commercial policy",
    });
    await expect(
      call({
        action: "save",
        id: draft.id,
        expectedRowVersion: draft.rowVersion,
        terms,
      }),
    ).rejects.toThrow("PAYG_OFFER_NOT_DRAFT");
    const approve = {
      action: "approve" as const,
      id: draft.id,
      expectedRowVersion: draft.rowVersion,
      reason: "Approved for future qualification",
      approvalEvidenceId: "signed-finance-review",
    };
    await expect(call(approve)).rejects.toThrow(
      "PAYG_OFFER_DISTINCT_APPROVER_REQUIRED",
    );
    await expect(
      withInternalTransaction(db, randomUUID(), (tx) =>
        tx.execute(
          sql`update core_payg_offer_versions set status='approved', approved_by=${approver}, approval_evidence_id=null, row_version=row_version+1 where id=${draft.id}`,
        ),
      ),
    ).rejects.toThrow();
    draft = await call(approve, approver);
    expect(draft.status).toBe("approved");
    expect(draft.approvedBy).toBe(approver);
  });
  it("database guard protects approved economics and retained history from direct writes", async () => {
    await expect(
      withInternalTransaction(db, randomUUID(), (tx) =>
        tx
          .update(paygOfferVersions)
          .set({
            terms: {
              ...draft.terms,
              payg: { ...draft.terms.payg, monthlyMinimumMinor: "999" },
            },
            rowVersion: draft.rowVersion + 1,
          })
          .where(eq(paygOfferVersions.id, draft.id)),
      ),
    ).rejects.toThrow();
    await expect(
      withInternalTransaction(db, randomUUID(), (tx) =>
        tx.execute(
          sql`delete from core_payg_offer_versions where id=${draft.id}`,
        ),
      ),
    ).rejects.toThrow();
    draft = await call(
      {
        action: "retire",
        id: draft.id,
        expectedRowVersion: draft.rowVersion,
        reason: "Superseded by a future approved policy",
      },
      approver,
    );
    expect(draft.status).toBe("retired");
    expect(draft.terms.payg.monthlyMinimumMinor).toBe("499");
    await expect(
      call({
        action: "save",
        id: draft.id,
        expectedRowVersion: draft.rowVersion,
        terms,
      }),
    ).rejects.toThrow("PAYG_OFFER_NOT_DRAFT");
  });
});
