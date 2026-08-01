import { afterAll, describe, expect, it } from "vitest";

import { ids, type Role } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase } from "../../client";
import { webhookEvents } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import {
  DatabaseStripeFinancialProjection,
  type StripeFinancialProjectionEvent,
} from "../system/providers";
import { DatabaseCoreFinanceRepository } from "./database-finance";
import { DatabasePersistedStripeAdjustmentStore } from "./stripe-adjustments";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 2,
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
});
const stripeAdjustments = new DatabasePersistedStripeAdjustmentStore(db);
const stripeProjection = new DatabaseStripeFinancialProjection(db);
const finance: AuthorizationContext = {
  userId: ids.user.parse("20000000-0000-4000-8000-000000000001"),
  accountIds: [ids.account.parse("10000000-0000-4000-8000-000000000009")],
  roles: ["finance_approver"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const runId = crypto.randomUUID().replaceAll("-", "");
const mutation = (input: {
  resource: "invoices" | "credit_notes" | "refunds" | "disputes";
  id: string;
  accountId: string;
  action: string;
  payload: Record<string, unknown>;
  roles?: Role[];
  internal?: boolean;
  idempotencyKey: string;
}) =>
  repository.mutate({
    resource: input.resource,
    id: input.id,
    accountId: input.accountId,
    action: input.action,
    payload: input.payload,
    actor: { kind: "user", id: finance.userId },
    authorization: {
      ...finance,
      roles: input.roles ?? finance.roles,
      isInternalStaff: input.internal ?? finance.isInternalStaff,
    },
    requestId: `collections-${input.idempotencyKey}`,
    idempotencyKey: `${input.idempotencyKey}-${runId}`,
    occurredAt: "2026-07-31T16:00:00.000Z",
  });

afterAll(async () => client.end());

describe("persisted collections and financial corrections", () => {
  it("persists replay-safe dunning, credit, refund, and dispute joins", async () => {
    const dunning = await mutation({
      resource: "invoices",
      id: "90000000-0000-4000-8000-000000000001",
      accountId: "10000000-0000-4000-8000-000000000001",
      action: "evaluate_dunning",
      payload: {},
      idempotencyKey: "dunning",
    });
    expect(dunning.record.data.collectionCase).toMatchObject({
      status: "escalated",
      runningServiceDecision: "human_review",
      newServiceBlocked: true,
    });

    const creditId = crypto.randomUUID();
    const creditInput = {
      resource: "credit_notes" as const,
      id: creditId,
      accountId: "10000000-0000-4000-8000-000000000004",
      action: "issue",
      payload: {
        invoiceId: "90000000-0000-4000-8000-000000000002",
        amount: { currency: "USD", minor: "1000" },
        providerReason: "order_change",
        internalReasonCode: "service_adjustment",
      },
      idempotencyKey: "credit",
    };
    const credit = await mutation(creditInput);
    await expect(mutation(creditInput)).resolves.toEqual(credit);

    const firstCreditClaim = await stripeAdjustments.claim({
      adjustmentId: creditId,
      expectedVersion: 1,
    });
    expect(firstCreditClaim).toMatchObject({
      status: "claimed",
      operation: {
        adjustmentId: creditId,
        orderId: "80000000-0000-4000-8000-000000000002",
        sourceId: "90000000-0000-4000-8000-000000000002",
        sourceCurrency: "USD",
        providerInvoiceId: "in_demo_referral",
        amount: { currency: "USD", minor: "1000" },
      },
    });
    if (firstCreditClaim.status !== "claimed")
      throw new Error("credit adjustment was not claimed");
    await stripeAdjustments.recordRetrying({
      adjustmentId: creditId,
      leaseToken: firstCreditClaim.leaseToken,
      code: "ETIMEDOUT",
    });
    const replayCreditClaim = await stripeAdjustments.claim({
      adjustmentId: creditId,
      expectedVersion: 1,
    });
    if (replayCreditClaim.status !== "claimed")
      throw new Error("credit adjustment retry was not claimed");
    expect(replayCreditClaim.operation.providerIdempotencyKey).toBe(
      firstCreditClaim.operation.providerIdempotencyKey,
    );
    await stripeAdjustments.recordProviderAcceptance({
      adjustmentId: creditId,
      leaseToken: replayCreditClaim.leaseToken,
      providerObjectId: `cn_${runId}`,
      providerStatus: "issued",
    });

    const refundId = crypto.randomUUID();
    const refund = await mutation({
      resource: "refunds",
      id: refundId,
      accountId: "10000000-0000-4000-8000-000000000004",
      action: "submit",
      payload: {
        paymentId: "91000000-0000-4000-8000-000000000002",
        amount: { currency: "USD", minor: "1000" },
        providerReason: "requested_by_customer",
        internalReasonCode: "customer_request",
      },
      idempotencyKey: "refund",
    });
    expect(refund.record.data).toMatchObject({ status: "approved" });
    const refundClaim = await stripeAdjustments.claim({
      adjustmentId: refundId,
      expectedVersion: 1,
    });
    expect(refundClaim).toMatchObject({
      status: "claimed",
      operation: {
        orderId: "80000000-0000-4000-8000-000000000002",
        sourceId: "91000000-0000-4000-8000-000000000002",
        providerPaymentIntentId: "pi_demo_referral",
        amount: { currency: "USD", minor: "1000" },
      },
    });

    const dispute = await mutation({
      resource: "disputes",
      id: crypto.randomUUID(),
      accountId: "10000000-0000-4000-8000-000000000004",
      action: "create",
      payload: {
        paymentId: "91000000-0000-4000-8000-000000000002",
        stripeDisputeId: `dp_${runId}`,
        amount: { currency: "USD", minor: "1000" },
        evidenceDueAt: "2026-08-05T16:00:00.000Z",
      },
      idempotencyKey: "dispute",
    });
    expect(dispute.record.data).toMatchObject({ status: "needs_response" });
  });

  it("fails domain authorization before account-scoped RLS can be abused", async () => {
    await expect(
      mutation({
        resource: "credit_notes",
        id: crypto.randomUUID(),
        accountId: "10000000-0000-4000-8000-000000000004",
        action: "issue",
        payload: {},
        roles: ["owner"],
        internal: false,
        idempotencyKey: "unauthorized-credit",
      }),
    ).rejects.toThrow("Finance approval authority is required");
  });

  it("reclaims an expired crash lease with the same provider idempotency key", async () => {
    let now = new Date("2031-01-01T00:00:00.000Z");
    const recoveryStore = new DatabasePersistedStripeAdjustmentStore(db, {
      clock: () => now,
      leaseMs: 1_000,
    });
    const adjustmentId = crypto.randomUUID();
    await mutation({
      resource: "refunds",
      id: adjustmentId,
      accountId: "10000000-0000-4000-8000-000000000004",
      action: "submit",
      payload: {
        paymentId: "91000000-0000-4000-8000-000000000002",
        amount: { currency: "USD", minor: "1000" },
        providerReason: "requested_by_customer",
        internalReasonCode: "crash_recovery",
      },
      idempotencyKey: `crash-recovery-${adjustmentId}`,
    });
    const first = await recoveryStore.claim({
      adjustmentId,
      expectedVersion: 1,
    });
    if (first.status !== "claimed")
      throw new Error("first lease was not claimed");

    now = new Date("2031-01-01T00:00:02.000Z");
    const recovered = await recoveryStore.claim({
      adjustmentId,
      expectedVersion: 1,
    });
    if (recovered.status !== "claimed")
      throw new Error("expired lease was not recovered");
    expect(recovered.leaseToken).not.toBe(first.leaseToken);
    expect(recovered.operation.providerIdempotencyKey).toBe(
      first.operation.providerIdempotencyKey,
    );
    await recoveryStore.recordProviderRejection({
      adjustmentId,
      leaseToken: recovered.leaseToken,
      code: "TEST_CLEANUP",
    });
  });

  it("projects independent signed refund watermarks and terminal truth", async () => {
    const createPendingRefund = async (suffix: string) => {
      const adjustmentId = crypto.randomUUID();
      await mutation({
        resource: "refunds",
        id: adjustmentId,
        accountId: "10000000-0000-4000-8000-000000000004",
        action: "submit",
        payload: {
          paymentId: "91000000-0000-4000-8000-000000000002",
          amount: { currency: "USD", minor: "1000" },
          providerReason: "requested_by_customer",
          internalReasonCode: `signed_projection_${suffix}`,
        },
        idempotencyKey: `signed-projection-${suffix}-${adjustmentId}`,
      });
      const claim = await stripeAdjustments.claim({
        adjustmentId,
        expectedVersion: 1,
      });
      if (claim.status !== "claimed") throw new Error("refund was not claimed");
      const providerObjectId = `re_${adjustmentId.replaceAll("-", "")}`;
      await stripeAdjustments.recordProviderAcceptance({
        adjustmentId,
        leaseToken: claim.leaseToken,
        providerObjectId,
        providerStatus: "pending",
      });
      return { adjustmentId, providerObjectId };
    };
    const applySigned = async (
      event: StripeFinancialProjectionEvent,
      persistedEvent: StripeFinancialProjectionEvent = event,
    ) => {
      await withInternalTransaction(
        db,
        `collections-webhook-${event.eventId}`,
        async (tx) => {
          await tx.insert(webhookEvents).values({
            provider: "stripe",
            providerEventId: event.eventId,
            eventType: event.eventType,
            signatureVerifiedAt: new Date(event.occurredAt),
            payloadHash: "d".repeat(64),
            payload: {
              type: persistedEvent.eventType,
              event: { provider: "stripe", ...persistedEvent },
            },
            occurredAt: new Date(event.occurredAt),
            lockedUntil: new Date("2032-01-01T00:00:00.000Z"),
          });
        },
      );
      return stripeProjection.apply(event);
    };
    const event = (
      refund: Awaited<ReturnType<typeof createPendingRefund>>,
      eventId: string,
      occurredAt: string,
      eventType: "refund.created" | "refund.updated",
      status: string,
      paymentIntentId = "pi_demo_referral",
    ): StripeFinancialProjectionEvent => ({
      eventId,
      eventType,
      category: "refund",
      aggregateKey: refund.providerObjectId,
      occurredAt,
      refundId: refund.providerObjectId,
      paymentIntentId,
      amount: { currency: "USD", minor: "1000" },
      status,
    });

    const failed = await createPendingRefund("failed");
    const forged = event(
      failed,
      `evt_forged_${failed.adjustmentId}`,
      "2031-02-01T00:00:00.000Z",
      "refund.updated",
      "succeeded",
      "pi_forged",
    );
    await expect(applySigned(forged)).rejects.toThrow(
      "Stripe refund source or money binding mismatched",
    );
    const forgedSignedStatus = event(
      failed,
      `evt_signed_status_${failed.adjustmentId}`,
      "2031-02-01T00:00:30.000Z",
      "refund.updated",
      "succeeded",
    );
    await expect(
      applySigned(forgedSignedStatus, {
        ...forgedSignedStatus,
        status: "pending",
      }),
    ).rejects.toThrow(
      "Stripe projection facts do not match the signed persisted payload",
    );
    await applySigned(
      event(
        failed,
        `evt_created_${failed.adjustmentId}`,
        "2031-02-01T00:01:00.000Z",
        "refund.created",
        "pending",
      ),
    );
    await applySigned(
      event(
        failed,
        `evt_failed_${failed.adjustmentId}`,
        "2031-02-01T00:02:00.000Z",
        "refund.updated",
        "failed",
      ),
    );

    const succeeded = await createPendingRefund("succeeded");
    const successEvent = event(
      succeeded,
      `evt_succeeded_${succeeded.adjustmentId}`,
      "2031-02-01T00:04:00.000Z",
      "refund.updated",
      "succeeded",
    );
    await applySigned(successEvent);
    await applySigned(
      event(
        succeeded,
        `evt_reordered_${succeeded.adjustmentId}`,
        "2031-02-01T00:03:00.000Z",
        "refund.updated",
        "pending",
      ),
    );

    const rows = await withInternalTransaction(
      db,
      `collections-refund-watermarks-${runId}`,
      async (tx) => ({
        failed: await tx.query.refunds.findFirst({
          where: (row, { eq }) => eq(row.id, failed.adjustmentId),
        }),
        succeeded: await tx.query.refunds.findFirst({
          where: (row, { eq }) => eq(row.id, succeeded.adjustmentId),
        }),
      }),
    );
    expect(rows.failed).toMatchObject({
      status: "failed",
      stripeLastEventId: `evt_failed_${failed.adjustmentId}`,
    });
    expect(rows.succeeded).toMatchObject({
      status: "succeeded",
      stripeLastEventId: successEvent.eventId,
    });
    expect(rows.failed?.stripeLastEventId).not.toBe(
      rows.succeeded?.stripeLastEventId,
    );
  });
});
