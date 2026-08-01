import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase, type RuntimeTransaction } from "../../client";
import {
  commissionAccruals,
  creditNotes,
  disputeCases,
  payments,
  refunds,
  webhookEvents,
} from "../../schema";
import {
  commissionSettlementExports,
  commissionStatementLines,
  commissionStatements,
  partnerQboVendorMappings,
} from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";
import { DatabaseStripeFinancialProjection } from "../system/providers";
import {
  DatabaseCommissionStatementRepository,
  DatabaseQboVendorMappingResolver,
} from "./commissions";
import { DatabaseCoreFinanceRepository } from "./database-finance";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const internalUserId = "20000000-0000-4000-8000-000000000001";
const referralPartnerId = "10000000-0000-4000-8000-000000000002";
const referralOrderId = "80000000-0000-4000-8000-000000000002";
const referralInvoiceId = "90000000-0000-4000-8000-000000000002";
const resalePartnerId = "10000000-0000-4000-8000-000000000003";
const resalePartnerUserId = "20000000-0000-4000-8000-000000000008";
const resaleOrderId = "80000000-0000-4000-8000-000000000003";
const resaleInvoiceId = "90000000-0000-4000-8000-000000000003";
const prefix = "integration-referral-commission-";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 4,
  role: "clockwork_service",
  ssl: false,
});
const finance = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
});
const statements = new DatabaseCommissionStatementRepository(db);
const qboVendorMappings = new DatabaseQboVendorMappingResolver(db);
const stripeProjection = new DatabaseStripeFinancialProjection(db);

const internalAuthorization: AuthorizationContext = {
  userId: ids.user.parse(internalUserId),
  accountIds: [ids.account.parse(referralPartnerId)],
  roles: ["internal_operator"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const resaleAuthorization: AuthorizationContext = {
  userId: ids.user.parse(resalePartnerUserId),
  accountIds: [ids.account.parse(resalePartnerId)],
  roles: ["partner_admin"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

afterAll(async () => {
  await client.end();
});

function internal<T>(
  requestId: string,
  operation: (transaction: RuntimeTransaction) => Promise<T>,
): Promise<T> {
  return withInternalTransaction(db, requestId, operation);
}

function randomQuarter(): {
  occurredAt: string;
  quarter: string;
} {
  const entropy = Number.parseInt(randomUUID().slice(0, 4), 16);
  const year = 2100 + (entropy % 7800);
  const quarter = (entropy % 4) + 1;
  const month = (quarter - 1) * 3;
  return {
    occurredAt: new Date(Date.UTC(year, month, 15, 12)).toISOString(),
    quarter: `${year}-Q${quarter}`,
  };
}

async function insertPayment(input: {
  invoiceId: string;
  orderId: string;
  currency: "USD" | "EUR";
  amountMinor: bigint;
  occurredAt: string;
}): Promise<string> {
  const id = randomUUID();
  await internal(`${prefix}payment-${id}`, async (transaction) => {
    await transaction.insert(payments).values({
      id,
      invoiceId: input.invoiceId,
      orderId: input.orderId,
      stripePaymentIntentId: `pi_${prefix}${id}`,
      currency: input.currency,
      amountMinor: input.amountMinor,
      status: "succeeded",
      receivedAt: new Date(input.occurredAt),
    });
  });
  return id;
}

async function insertReferralPayment(occurredAt: string): Promise<string> {
  return insertPayment({
    invoiceId: referralInvoiceId,
    orderId: referralOrderId,
    currency: "USD",
    amountMinor: 120_000n,
    occurredAt,
  });
}

async function accrue(input: {
  id?: string;
  sourceType:
    "payment" | "credit_note" | "credit_note_void" | "refund" | "chargeback";
  sourceId: string;
  accountId?: string;
  authorization?: AuthorizationContext;
  action?: "accrue" | "clawback";
}) {
  const id = input.id ?? randomUUID();
  const accountId = input.accountId ?? referralPartnerId;
  return finance.mutate({
    resource: "commissions",
    id,
    accountId,
    action: input.action ?? "accrue",
    payload: { sourceType: input.sourceType, sourceId: input.sourceId },
    actor: {
      kind: "user",
      id: input.authorization?.userId ?? internalAuthorization.userId,
    },
    authorization: input.authorization ?? internalAuthorization,
    requestId: `${prefix}mutate-${id}`,
    idempotencyKey: `${prefix}mutate-${id}`,
    occurredAt: new Date().toISOString(),
  });
}

async function accrualBySource(sourceType: string, sourceId: string) {
  return internal(`${prefix}read-${sourceId}`, (transaction) =>
    transaction.query.commissionAccruals.findFirst({
      where: and(
        eq(commissionAccruals.sourceType, sourceType),
        eq(commissionAccruals.sourceId, sourceId),
      ),
    }),
  );
}

describe("persisted referral commissions", () => {
  it("resolves only the verified vendor bound to the persisted partner", async () => {
    await internal(`${prefix}qbo-mapping`, async (transaction) => {
      await transaction
        .insert(partnerQboVendorMappings)
        .values([
          {
            partnerAccountId: referralPartnerId,
            realmReferenceHash: "a".repeat(64),
            vendorId: "vendor_referral_partner",
            verificationStatus: "verified",
            verifiedAt: new Date("2026-07-31T16:00:00.000Z"),
            verifiedBy: internalUserId,
            sourceReference: "repository:verified-vendor-fixture",
          },
          {
            partnerAccountId: resalePartnerId,
            realmReferenceHash: "b".repeat(64),
            vendorId: "vendor_revoked_partner",
            verificationStatus: "revoked",
            verifiedAt: new Date("2026-07-30T16:00:00.000Z"),
            verifiedBy: internalUserId,
            sourceReference: "repository:revoked-vendor-fixture",
            revokedAt: new Date("2026-07-31T16:00:00.000Z"),
          },
        ])
        .onConflictDoNothing();
    });

    await expect(
      qboVendorMappings.resolve({ partnerAccountId: referralPartnerId }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        partnerAccountId: referralPartnerId,
        vendorId: "vendor_referral_partner",
        status: "verified",
      },
    });
    await expect(
      qboVendorMappings.resolve({ partnerAccountId: resalePartnerId }),
    ).resolves.toMatchObject({
      ok: false,
      code: "QBO_VENDOR_MAPPING_NOT_VERIFIED",
    });
  });

  it("derives the referral partner, invoice, money, policy, and quarter from a collected payment", async () => {
    const period = randomQuarter();
    const paymentId = await insertReferralPayment(period.occurredAt);

    await accrue({ sourceType: "payment", sourceId: paymentId });

    await expect(accrualBySource("payment", paymentId)).resolves.toMatchObject({
      partnerAccountId: referralPartnerId,
      invoiceId: referralInvoiceId,
      sourceType: "payment",
      sourceId: paymentId,
      adjustmentSourceId: null,
      rateBps: 1200,
      holdbackBps: 1000,
      currency: "USD",
      netCollectedRevenueMinor: 120_000n,
      amountMinor: 14_400n,
      holdbackMinor: 1_440n,
      period: period.quarter,
      status: "accrued",
    });
  });

  it("deduplicates replay of the same persisted source", async () => {
    const paymentId = await insertReferralPayment(randomQuarter().occurredAt);
    await accrue({ sourceType: "payment", sourceId: paymentId });

    await expect(
      accrue({ sourceType: "payment", sourceId: paymentId }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });

    const rows = await internal(`${prefix}dedupe-${paymentId}`, (transaction) =>
      transaction
        .select({ id: commissionAccruals.id })
        .from(commissionAccruals)
        .where(
          and(
            eq(commissionAccruals.sourceType, "payment"),
            eq(commissionAccruals.sourceId, paymentId),
          ),
        ),
    );
    expect(rows).toHaveLength(1);
  });

  it("rejects resale revenue as ineligible for a referral commission", async () => {
    const paymentId = await insertPayment({
      invoiceId: resaleInvoiceId,
      orderId: resaleOrderId,
      currency: "EUR",
      amountMinor: 168_000n,
      occurredAt: randomQuarter().occurredAt,
    });

    await expect(
      accrue({
        sourceType: "payment",
        sourceId: paymentId,
        accountId: resalePartnerId,
        authorization: resaleAuthorization,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(
      accrualBySource("payment", paymentId),
    ).resolves.toBeUndefined();
  });

  it("fails closed when another partner requests the referral source", async () => {
    const paymentId = await insertReferralPayment(randomQuarter().occurredAt);

    await expect(
      accrue({
        sourceType: "payment",
        sourceId: paymentId,
        accountId: resalePartnerId,
        authorization: resaleAuthorization,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      accrualBySource("payment", paymentId),
    ).resolves.toBeUndefined();
  });

  it("rejects a currency forged outside the repository at the database boundary", async () => {
    const period = randomQuarter();
    const paymentId = await insertReferralPayment(period.occurredAt);

    let rejection: unknown;
    try {
      await internal(`${prefix}forged-currency-${paymentId}`, (transaction) =>
        transaction.insert(commissionAccruals).values({
          id: randomUUID(),
          partnerAccountId: referralPartnerId,
          invoiceId: referralInvoiceId,
          sourceType: "payment",
          sourceId: paymentId,
          rateBps: 1200,
          holdbackBps: 1000,
          currency: "EUR",
          netCollectedRevenueMinor: 120_000n,
          amountMinor: 14_400n,
          holdbackMinor: 1_440n,
          period: period.quarter,
          status: "accrued",
        }),
      );
    } catch (error: unknown) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(Error);
    const cause = rejection instanceof Error ? rejection.cause : undefined;
    expect(cause).toBeInstanceOf(Error);
    if (!(cause instanceof Error)) throw new Error("Database cause was lost");
    expect(cause.message).toContain(
      "commission source must match its persisted referral invoice and partner",
    );
    await expect(
      accrualBySource("payment", paymentId),
    ).resolves.toBeUndefined();
  });

  it("derives an issued credit-note clawback from persisted invoice truth", async () => {
    const period = randomQuarter();
    const paymentId = await insertReferralPayment(period.occurredAt);
    await accrue({ sourceType: "payment", sourceId: paymentId });
    const creditNoteId = randomUUID();
    await internal(
      `${prefix}credit-note-${creditNoteId}`,
      async (transaction) => {
        await transaction.insert(creditNotes).values({
          id: creditNoteId,
          invoiceId: referralInvoiceId,
          orderId: referralOrderId,
          stripeCreditNoteId: `cn_${prefix}${creditNoteId}`,
          currency: "USD",
          amountMinor: 60_000n,
          reasonCode: "commercial_correction",
          approvedBy: internalUserId,
          status: "issued",
          createdAt: new Date(period.occurredAt),
        });
      },
    );

    await accrue({
      sourceType: "credit_note",
      sourceId: creditNoteId,
      action: "clawback",
    });

    const clawback = await accrualBySource("credit_note", creditNoteId);
    expect(clawback).toMatchObject({
      partnerAccountId: referralPartnerId,
      invoiceId: referralInvoiceId,
      sourceType: "credit_note",
      sourceId: creditNoteId,
      rateBps: 1200,
      holdbackBps: 1000,
      currency: "USD",
      netCollectedRevenueMinor: -60_000n,
      amountMinor: -7_200n,
      holdbackMinor: -720n,
      period: period.quarter,
    });
    expect(clawback?.adjustmentSourceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const voidEventId = `evt_void_${creditNoteId}`;
    const voidProjectionEvent = {
      eventId: voidEventId,
      eventType: "credit_note.voided",
      category: "credit_note" as const,
      aggregateKey: `cn_${prefix}${creditNoteId}`,
      occurredAt: period.occurredAt,
      invoiceId: "in_demo_referral",
      creditNoteId: `cn_${prefix}${creditNoteId}`,
      amount: { currency: "USD", minor: "60000" },
      status: "void",
    };
    await internal(`${prefix}void-credit-note-${creditNoteId}`, async (tx) => {
      await tx.insert(webhookEvents).values({
        provider: "stripe",
        providerEventId: voidEventId,
        eventType: "credit_note.voided",
        signatureVerifiedAt: new Date(period.occurredAt),
        payloadHash: "c".repeat(64),
        payload: {
          type: voidProjectionEvent.eventType,
          event: { provider: "stripe", ...voidProjectionEvent },
        },
        occurredAt: new Date(period.occurredAt),
        lockedUntil: new Date(period.occurredAt),
      });
    });
    await stripeProjection.apply(voidProjectionEvent);
    await accrue({
      sourceType: "credit_note_void",
      sourceId: creditNoteId,
      action: "accrue",
    });
    await expect(
      accrualBySource("credit_note_void", creditNoteId),
    ).resolves.toMatchObject({
      partnerAccountId: referralPartnerId,
      invoiceId: referralInvoiceId,
      sourceType: "credit_note_void",
      sourceId: creditNoteId,
      adjustmentSourceId: clawback?.id,
      rateBps: 1200,
      holdbackBps: 1000,
      currency: "USD",
      netCollectedRevenueMinor: 60_000n,
      amountMinor: 7_200n,
      holdbackMinor: 720n,
      period: period.quarter,
    });
  });

  it("maps a lost chargeback to a persisted dispute clawback", async () => {
    const period = randomQuarter();
    const paymentId = await insertReferralPayment(period.occurredAt);
    const positiveId = randomUUID();
    await accrue({
      id: positiveId,
      sourceType: "payment",
      sourceId: paymentId,
    });
    const disputeId = randomUUID();
    await internal(`${prefix}chargeback-${disputeId}`, async (transaction) => {
      await transaction.insert(disputeCases).values({
        id: disputeId,
        paymentId,
        orderId: referralOrderId,
        stripeDisputeId: `dp_${prefix}${disputeId}`,
        currency: "USD",
        amountMinor: 60_000n,
        evidenceDueAt: new Date(period.occurredAt),
        status: "lost",
        createdAt: new Date(period.occurredAt),
        updatedAt: new Date(period.occurredAt),
      });
    });

    await accrue({
      sourceType: "chargeback",
      sourceId: disputeId,
      action: "clawback",
    });

    await expect(accrualBySource("dispute", disputeId)).resolves.toMatchObject({
      partnerAccountId: referralPartnerId,
      invoiceId: referralInvoiceId,
      sourceType: "dispute",
      sourceId: disputeId,
      adjustmentSourceId: positiveId,
      rateBps: 1200,
      holdbackBps: 1000,
      currency: "USD",
      netCollectedRevenueMinor: -60_000n,
      amountMinor: -7_200n,
      holdbackMinor: -720n,
      period: period.quarter,
    });
  });

  it("persists a symmetric refund clawback and generates one replay-safe quarterly statement", async () => {
    const period = randomQuarter();
    const paymentId = await insertReferralPayment(period.occurredAt);
    const positiveId = randomUUID();
    await accrue({
      id: positiveId,
      sourceType: "payment",
      sourceId: paymentId,
    });
    const refundId = randomUUID();
    await internal(`${prefix}refund-${refundId}`, async (transaction) => {
      await transaction.insert(refunds).values({
        id: refundId,
        paymentId,
        orderId: referralOrderId,
        stripeRefundId: `re_${prefix}${refundId}`,
        currency: "USD",
        amountMinor: 120_000n,
        reasonCode: "customer_request",
        status: "succeeded",
        createdAt: new Date(period.occurredAt),
      });
    });

    await accrue({
      sourceType: "refund",
      sourceId: refundId,
      action: "clawback",
    });
    await expect(accrualBySource("refund", refundId)).resolves.toMatchObject({
      partnerAccountId: referralPartnerId,
      invoiceId: referralInvoiceId,
      sourceType: "refund",
      sourceId: refundId,
      adjustmentSourceId: positiveId,
      rateBps: 1200,
      holdbackBps: 1000,
      currency: "USD",
      netCollectedRevenueMinor: -120_000n,
      amountMinor: -14_400n,
      holdbackMinor: -1_440n,
      period: period.quarter,
      status: "accrued",
    });

    const statementId = randomUUID();
    const statement = await statements.generate({
      statementId,
      partnerAccountId: referralPartnerId,
      quarter: period.quarter,
      currency: "USD",
      actor: { kind: "system", id: "commission-statement-workflow" },
      requestId: `${prefix}statement-${statementId}`,
      occurredAt: period.occurredAt,
    });
    expect(statement).toMatchObject({
      statementId,
      partnerAccountId: referralPartnerId,
      quarter: period.quarter,
      currency: "USD",
      grossAccruedMinor: "14400",
      clawbackMinor: "14400",
      holdbackMinor: "0",
      payableMinor: "0",
      lineCount: 2,
    });

    const persisted = await internal(
      `${prefix}statement-read-${statementId}`,
      async (transaction) => {
        const [header, lines, accrualRows] = await Promise.all([
          transaction.query.commissionStatements.findFirst({
            where: eq(commissionStatements.id, statementId),
          }),
          transaction.query.commissionStatementLines.findMany({
            where: eq(commissionStatementLines.statementId, statementId),
          }),
          transaction.query.commissionAccruals.findMany({
            where: and(
              eq(commissionAccruals.partnerAccountId, referralPartnerId),
              eq(commissionAccruals.period, period.quarter),
              eq(commissionAccruals.currency, "USD"),
            ),
          }),
        ]);
        return { header, lines, accrualRows };
      },
    );
    expect(persisted.header).toMatchObject({
      grossAccruedMinor: 14_400n,
      clawbackMinor: 14_400n,
      holdbackMinor: 0n,
      payableMinor: 0n,
      status: "draft",
    });
    expect(persisted.lines.map((line) => line.sourceType).sort()).toEqual([
      "payment",
      "refund",
    ]);
    expect(persisted.accrualRows).toHaveLength(2);
    expect(persisted.accrualRows.every((row) => row.status === "stated")).toBe(
      true,
    );

    await expect(
      statements.generate({
        statementId: randomUUID(),
        partnerAccountId: referralPartnerId,
        quarter: period.quarter,
        currency: "USD",
        actor: { kind: "system", id: "commission-statement-workflow" },
        requestId: `${prefix}statement-replay-${statementId}`,
        occurredAt: period.occurredAt,
      }),
    ).resolves.toMatchObject({
      statementId,
      lineCount: 2,
      duplicate: true,
    });
  });

  it("settles exactly one persisted partner statement and makes concurrent replay harmless", async () => {
    const period = randomQuarter();
    const paymentId = await insertReferralPayment(period.occurredAt);
    await accrue({ sourceType: "payment", sourceId: paymentId });
    const statementId = randomUUID();
    const statement = await statements.generate({
      statementId,
      partnerAccountId: referralPartnerId,
      quarter: period.quarter,
      currency: "USD",
      actor: { kind: "system", id: "commission-statement-workflow" },
      requestId: `${prefix}settlement-statement-${statementId}`,
      occurredAt: period.occurredAt,
    });
    const settlementFixture = await internal(
      `${prefix}settlement-lines-${statementId}`,
      async (transaction) => {
        const [issued] = await transaction
          .update(commissionStatements)
          .set({ status: "issued" })
          .where(
            and(
              eq(commissionStatements.id, statementId),
              eq(commissionStatements.rowVersion, 1),
            ),
          )
          .returning({ rowVersion: commissionStatements.rowVersion });
        if (!issued) throw new Error("statement issuance fixture failed");
        const [approved] = await transaction
          .update(commissionStatements)
          .set({ status: "approved" })
          .where(
            and(
              eq(commissionStatements.id, statementId),
              eq(commissionStatements.rowVersion, issued.rowVersion),
            ),
          )
          .returning({ rowVersion: commissionStatements.rowVersion });
        if (!approved) throw new Error("statement approval fixture failed");
        const accrualIds = (
          await transaction.query.commissionStatementLines.findMany({
            where: eq(commissionStatementLines.statementId, statementId),
          })
        ).map((line) => line.accrualId);
        return { accrualIds, rowVersion: approved.rowVersion };
      },
    );
    const { accrualIds } = settlementFixture;
    const exportKey = `${prefix}qbo-${statementId}`;
    const providerBillId = `qbo_bill_${statementId}`;
    const finalize = () =>
      statements.finalizeSettlement({
        statementId,
        partnerAccountId: referralPartnerId,
        expectedRowVersion: settlementFixture.rowVersion,
        currency: "USD",
        payableMinor: statement.payableMinor,
        accrualIds,
        exportKey,
        providerBillId,
        actor: { kind: "system", id: "commission-settlement-workflow" },
        requestId: `${prefix}settlement-${statementId}`,
        occurredAt: period.occurredAt,
      });

    await expect(
      statements.validateSettlement({
        statementId,
        partnerAccountId: resalePartnerId,
        expectedRowVersion: settlementFixture.rowVersion,
        currency: "USD",
        payableMinor: statement.payableMinor,
        accrualIds,
        exportKey: `${exportKey}:forged-partner`,
      }),
    ).rejects.toThrow("COMMISSION_STATEMENT_BINDING_MISMATCH");
    await expect(
      statements.validateSettlement({
        statementId,
        partnerAccountId: referralPartnerId,
        expectedRowVersion: settlementFixture.rowVersion,
        currency: "USD",
        payableMinor: statement.payableMinor,
        accrualIds: [randomUUID()],
        exportKey: `${exportKey}:forged-lines`,
      }),
    ).rejects.toThrow("COMMISSION_SETTLEMENT_LINE_BINDING_MISMATCH");

    await Promise.all([
      statements.validateSettlement({
        statementId,
        partnerAccountId: referralPartnerId,
        expectedRowVersion: settlementFixture.rowVersion,
        currency: "USD",
        payableMinor: statement.payableMinor,
        accrualIds,
        exportKey,
      }),
      statements.validateSettlement({
        statementId,
        partnerAccountId: referralPartnerId,
        expectedRowVersion: settlementFixture.rowVersion,
        currency: "USD",
        payableMinor: statement.payableMinor,
        accrualIds,
        exportKey,
      }),
    ]);
    const claimed = await internal(
      `${prefix}settlement-claimed-${statementId}`,
      async (transaction) => ({
        statement: await transaction.query.commissionStatements.findFirst({
          where: eq(commissionStatements.id, statementId),
        }),
        settlement:
          await transaction.query.commissionSettlementExports.findFirst({
            where: eq(commissionSettlementExports.statementId, statementId),
          }),
      }),
    );
    expect(claimed.statement?.status).toBe("exported");
    expect(claimed.settlement).toMatchObject({
      exportKey,
      status: "pending",
      providerReference: null,
    });

    const concurrent = await Promise.all([finalize(), finalize()]);
    expect(concurrent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ statementId, accrualCount: 1 }),
        expect.objectContaining({
          statementId,
          accrualCount: 1,
          duplicate: true,
        }),
      ]),
    );
    const persisted = await internal(
      `${prefix}settlement-read-${statementId}`,
      async (transaction) => ({
        statement: await transaction.query.commissionStatements.findFirst({
          where: eq(commissionStatements.id, statementId),
        }),
        accruals: await transaction.query.commissionAccruals.findMany({
          where: eq(commissionAccruals.id, accrualIds[0] ?? ""),
        }),
        exports: await transaction.query.commissionSettlementExports.findMany({
          where: eq(commissionSettlementExports.statementId, statementId),
        }),
      }),
    );
    expect(persisted.statement?.status).toBe("paid");
    expect(persisted.accruals.map((row) => row.status)).toEqual(["paid"]);
    expect(persisted.exports).toHaveLength(1);
    expect(persisted.exports[0]).toMatchObject({
      status: "succeeded",
      providerReference: providerBillId,
    });
  });
});
