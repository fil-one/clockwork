import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  IdempotencyKeySchema,
  MoneySchema,
  type Currency,
  type IdempotencyKey,
  type Money,
} from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { creditNotes, invoices, payments, refunds } from "../../schema";
import { stripeAdjustmentOperations } from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

const CurrencySchema = z.enum(["USD", "EUR", "GBP"]);

export interface DatabaseStripeAdjustmentOperation {
  adjustmentId: string;
  expectedVersion: number;
  orderId: string;
  sourceId: string;
  sourceCurrency: Currency;
  kind: "credit_note" | "refund";
  providerInvoiceId?: string;
  providerPaymentIntentId?: string;
  amount: Money;
  individualCapMinor: string;
  aggregateCapMinor: string;
  alreadyAdjustedMinor: string;
  reason:
    | "duplicate"
    | "fraudulent"
    | "order_change"
    | "product_unsatisfactory"
    | "requested_by_customer";
  internalReasonCode: string;
  providerIdempotencyKey: IdempotencyKey;
}

export type DatabaseStripeAdjustmentClaim =
  | {
      status: "claimed";
      leaseToken: string;
      operation: DatabaseStripeAdjustmentOperation;
    }
  | { status: "in_progress" }
  | {
      status: "provider_accepted";
      providerObjectId: string;
      providerStatus: string;
    }
  | { status: "stale" | "not_approved" | "cap_exceeded" };

type AdjustmentRow = typeof stripeAdjustmentOperations.$inferSelect;

async function lockAdjustment(
  transaction: RuntimeTransaction,
  adjustmentId: string,
): Promise<AdjustmentRow | undefined> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${adjustmentId}, 0))`,
  );
  return transaction.query.stripeAdjustmentOperations.findFirst({
    where: eq(stripeAdjustmentOperations.adjustmentId, adjustmentId),
  });
}

async function assertPersistedBinding(
  transaction: RuntimeTransaction,
  operation: AdjustmentRow,
): Promise<void> {
  if (operation.kind === "credit_note") {
    const adjustment = await transaction.query.creditNotes.findFirst({
      where: eq(creditNotes.id, operation.adjustmentId),
    });
    const source = adjustment
      ? await transaction.query.invoices.findFirst({
          where: eq(invoices.id, adjustment.invoiceId),
        })
      : undefined;
    if (
      !adjustment ||
      !source?.stripeInvoiceId ||
      adjustment.orderId !== operation.orderId ||
      adjustment.invoiceId !== operation.sourceId ||
      adjustment.currency !== operation.sourceCurrency ||
      adjustment.amountMinor !== operation.amountMinor ||
      source.orderId !== operation.orderId ||
      source.currency !== operation.sourceCurrency ||
      source.stripeInvoiceId !== operation.providerInvoiceId ||
      source.amountMinor !== operation.aggregateCapMinor
    )
      throw new Error("STRIPE_ADJUSTMENT_PERSISTED_BINDING_MISMATCH");
    return;
  }
  if (operation.kind !== "refund")
    throw new Error("STRIPE_ADJUSTMENT_KIND_INVALID");
  const adjustment = await transaction.query.refunds.findFirst({
    where: eq(refunds.id, operation.adjustmentId),
  });
  const source = adjustment
    ? await transaction.query.payments.findFirst({
        where: eq(payments.id, adjustment.paymentId),
      })
    : undefined;
  const invoice = source
    ? await transaction.query.invoices.findFirst({
        where: eq(invoices.id, source.invoiceId),
      })
    : undefined;
  if (
    !adjustment ||
    !source ||
    !invoice ||
    adjustment.orderId !== operation.orderId ||
    adjustment.paymentId !== operation.sourceId ||
    adjustment.currency !== operation.sourceCurrency ||
    adjustment.amountMinor !== operation.amountMinor ||
    source.orderId !== operation.orderId ||
    source.currency !== operation.sourceCurrency ||
    source.stripePaymentIntentId !== operation.providerPaymentIntentId ||
    source.amountMinor !== operation.individualCapMinor ||
    invoice.amountMinor !== operation.aggregateCapMinor
  )
    throw new Error("STRIPE_ADJUSTMENT_PERSISTED_BINDING_MISMATCH");
}

/** Database claim/commit implementation for persisted-only Stripe commands. */
export class DatabasePersistedStripeAdjustmentStore {
  public constructor(
    private readonly database: RuntimeDatabase,
    private readonly options: { clock?: () => Date; leaseMs?: number } = {},
  ) {}

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private leaseMs(): number {
    return this.options.leaseMs ?? 5 * 60_000;
  }

  public claim(input: {
    adjustmentId: string;
    expectedVersion: number;
  }): Promise<DatabaseStripeAdjustmentClaim> {
    const adjustmentId = z.uuid().parse(input.adjustmentId);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)
      return Promise.resolve({ status: "stale" });
    return withInternalTransaction(
      this.database,
      `stripe-adjustment-claim:${adjustmentId}`,
      async (transaction) => {
        let operation = await lockAdjustment(transaction, adjustmentId);
        if (!operation || operation.state === "rejected")
          return { status: "not_approved" };
        if (operation.commandVersion !== input.expectedVersion)
          return { status: "stale" };
        const now = this.now();
        if (operation.state === "submitting") {
          if (!operation.leaseToken || !operation.leaseUntil)
            throw new Error("STRIPE_ADJUSTMENT_LEASE_INCOMPLETE");
          const expiredLeaseToken = operation.leaseToken;
          if (operation.leaseUntil.valueOf() > now.valueOf())
            return { status: "in_progress" };
          const [recovered] = await transaction
            .update(stripeAdjustmentOperations)
            .set({
              state: "retrying",
              leaseToken: null,
              leaseUntil: null,
              lastErrorCode: "LEASE_EXPIRED_CRASH_RECOVERY",
              updatedAt: now,
            })
            .where(
              and(
                eq(stripeAdjustmentOperations.adjustmentId, adjustmentId),
                eq(stripeAdjustmentOperations.rowVersion, operation.rowVersion),
                eq(stripeAdjustmentOperations.state, "submitting"),
                eq(stripeAdjustmentOperations.leaseToken, expiredLeaseToken),
              ),
            )
            .returning();
          if (!recovered) return { status: "in_progress" };
          operation = recovered;
        }
        if (operation.state === "provider_accepted") {
          if (!operation.providerObjectId || !operation.providerStatus)
            throw new Error("STRIPE_ADJUSTMENT_ACCEPTANCE_INCOMPLETE");
          return {
            status: "provider_accepted",
            providerObjectId: operation.providerObjectId,
            providerStatus: operation.providerStatus,
          };
        }
        if (
          !(["approved", "retrying"] as const).includes(
            operation.state as "approved" | "retrying",
          )
        )
          return { status: "not_approved" };
        await assertPersistedBinding(transaction, operation);
        const reserved =
          await transaction.query.stripeAdjustmentOperations.findMany({
            where: and(
              eq(stripeAdjustmentOperations.orderId, operation.orderId),
              eq(
                stripeAdjustmentOperations.sourceCurrency,
                operation.sourceCurrency,
              ),
              inArray(stripeAdjustmentOperations.state, [
                "submitting",
                "provider_accepted",
              ]),
            ),
          });
        const alreadyAdjustedMinor = reserved
          .filter((candidate) => candidate.adjustmentId !== adjustmentId)
          .reduce((sum, candidate) => sum + candidate.amountMinor, 0n);
        if (
          operation.amountMinor <= 0n ||
          operation.amountMinor > operation.individualCapMinor ||
          alreadyAdjustedMinor + operation.amountMinor >
            operation.aggregateCapMinor
        )
          return { status: "cap_exceeded" };
        const leaseToken = randomUUID();
        const leaseUntil = new Date(now.valueOf() + this.leaseMs());
        const [claimed] = await transaction
          .update(stripeAdjustmentOperations)
          .set({
            state: "submitting",
            leaseToken,
            leaseUntil,
            lastErrorCode: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(stripeAdjustmentOperations.adjustmentId, adjustmentId),
              eq(stripeAdjustmentOperations.rowVersion, operation.rowVersion),
              inArray(stripeAdjustmentOperations.state, [
                "approved",
                "retrying",
              ]),
            ),
          )
          .returning();
        if (!claimed) return { status: "in_progress" };
        const currency = CurrencySchema.parse(claimed.sourceCurrency);
        const reason = z
          .enum([
            "duplicate",
            "fraudulent",
            "order_change",
            "product_unsatisfactory",
            "requested_by_customer",
          ])
          .parse(claimed.providerReason);
        return {
          status: "claimed",
          leaseToken,
          operation: {
            adjustmentId,
            expectedVersion: claimed.commandVersion,
            orderId: claimed.orderId,
            sourceId: claimed.sourceId,
            sourceCurrency: currency,
            kind: z.enum(["credit_note", "refund"]).parse(claimed.kind),
            ...(claimed.providerInvoiceId
              ? { providerInvoiceId: claimed.providerInvoiceId }
              : {}),
            ...(claimed.providerPaymentIntentId
              ? {
                  providerPaymentIntentId: claimed.providerPaymentIntentId,
                }
              : {}),
            amount: MoneySchema.parse({
              currency,
              minor: claimed.amountMinor.toString(),
            }),
            individualCapMinor: claimed.individualCapMinor.toString(),
            aggregateCapMinor: claimed.aggregateCapMinor.toString(),
            alreadyAdjustedMinor: alreadyAdjustedMinor.toString(),
            reason,
            internalReasonCode: claimed.internalReasonCode,
            providerIdempotencyKey: IdempotencyKeySchema.parse(
              claimed.providerIdempotencyKey,
            ),
          },
        };
      },
    );
  }

  public recordProviderAcceptance(input: {
    adjustmentId: string;
    leaseToken: string;
    providerObjectId: string;
    providerStatus: string;
  }): Promise<void> {
    return this.complete(input, "provider_accepted");
  }

  public recordRetrying(input: {
    adjustmentId: string;
    leaseToken: string;
    code: string;
  }): Promise<void> {
    return this.complete(input, "retrying");
  }

  public recordProviderRejection(input: {
    adjustmentId: string;
    leaseToken: string;
    code: string;
  }): Promise<void> {
    return this.complete(input, "rejected");
  }

  private complete(
    input: {
      adjustmentId: string;
      leaseToken: string;
      code?: string;
      providerObjectId?: string;
      providerStatus?: string;
    },
    state: "provider_accepted" | "retrying" | "rejected",
  ): Promise<void> {
    const adjustmentId = z.uuid().parse(input.adjustmentId);
    const leaseToken = z.uuid().parse(input.leaseToken);
    if (
      state === "provider_accepted" &&
      (!input.providerObjectId?.trim() || !input.providerStatus?.trim())
    )
      return Promise.reject(new Error("STRIPE_PROVIDER_ACCEPTANCE_INVALID"));
    return withInternalTransaction(
      this.database,
      `stripe-adjustment-complete:${adjustmentId}`,
      async (transaction) => {
        const operation = await lockAdjustment(transaction, adjustmentId);
        if (
          !operation ||
          operation.state !== "submitting" ||
          operation.leaseToken !== leaseToken
        )
          throw new Error("STRIPE_ADJUSTMENT_LEASE_CONFLICT");
        const [completed] = await transaction
          .update(stripeAdjustmentOperations)
          .set({
            state,
            leaseToken: null,
            leaseUntil: null,
            ...(state === "provider_accepted"
              ? {
                  providerObjectId: input.providerObjectId,
                  providerStatus: input.providerStatus,
                  lastErrorCode: null,
                }
              : { lastErrorCode: input.code ?? "PROVIDER_REJECTED" }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(stripeAdjustmentOperations.adjustmentId, adjustmentId),
              eq(stripeAdjustmentOperations.rowVersion, operation.rowVersion),
              eq(stripeAdjustmentOperations.state, "submitting"),
              eq(stripeAdjustmentOperations.leaseToken, leaseToken),
            ),
          )
          .returning();
        if (!completed) throw new Error("STRIPE_ADJUSTMENT_LEASE_CONFLICT");
        let adjustmentVersion: number | undefined;
        if (state !== "retrying" && operation.kind === "credit_note") {
          const updated = await transaction
            .update(creditNotes)
            .set({
              status: state === "provider_accepted" ? "pending" : "failed",
              version: sql`${creditNotes.version} + 1`,
              ...(state === "provider_accepted"
                ? { stripeCreditNoteId: input.providerObjectId }
                : {}),
            })
            .where(
              and(
                eq(creditNotes.id, adjustmentId),
                eq(creditNotes.version, operation.commandVersion),
              ),
            )
            .returning({ id: creditNotes.id, version: creditNotes.version });
          if (updated.length !== 1)
            throw new Error("STRIPE_ADJUSTMENT_LOCAL_VERSION_CONFLICT");
          const updatedAdjustment = updated[0];
          if (!updatedAdjustment)
            throw new Error("STRIPE_ADJUSTMENT_LOCAL_VERSION_CONFLICT");
          adjustmentVersion = updatedAdjustment.version;
        } else if (state !== "retrying") {
          const updated = await transaction
            .update(refunds)
            .set({
              status: state === "provider_accepted" ? "pending" : "failed",
              version: sql`${refunds.version} + 1`,
              ...(state === "provider_accepted"
                ? { stripeRefundId: input.providerObjectId }
                : {}),
            })
            .where(
              and(
                eq(refunds.id, adjustmentId),
                eq(refunds.version, operation.commandVersion),
              ),
            )
            .returning({ id: refunds.id, version: refunds.version });
          if (updated.length !== 1)
            throw new Error("STRIPE_ADJUSTMENT_LOCAL_VERSION_CONFLICT");
          const updatedAdjustment = updated[0];
          if (!updatedAdjustment)
            throw new Error("STRIPE_ADJUSTMENT_LOCAL_VERSION_CONFLICT");
          adjustmentVersion = updatedAdjustment.version;
        }
        const aggregateVersion =
          state === "retrying" ? completed.rowVersion : adjustmentVersion;
        if (aggregateVersion === undefined)
          throw new Error("STRIPE_ADJUSTMENT_LOCAL_VERSION_CONFLICT");
        await appendAuditAndOutbox(transaction, {
          aggregateType:
            state === "retrying"
              ? "provider_operation"
              : operation.kind === "credit_note"
                ? "credit_note"
                : "refund",
          aggregateId: adjustmentId,
          aggregateVersion,
          eventType:
            state === "provider_accepted"
              ? `core.${operation.kind}.provider_accepted`
              : state === "retrying"
                ? `core.${operation.kind}.provider_retrying`
                : `core.${operation.kind}.provider_rejected`,
          actor: { kind: "system", id: "stripe-adjustment-workflow" },
          requestId: `stripe-adjustment-complete:${adjustmentId}`,
          before: { state: operation.state },
          after: {
            state,
            providerObjectId: input.providerObjectId ?? null,
            providerStatus: input.providerStatus ?? null,
            errorCode: input.code ?? null,
          },
        });
      },
    );
  }
}
