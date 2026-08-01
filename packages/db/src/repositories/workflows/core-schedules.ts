import { createHash } from "node:crypto";

import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  sql,
} from "drizzle-orm";

import { multiplyMinorByQuantity } from "@clockwork/domain/core";

import type { RuntimeDatabase } from "../../client";
import {
  accounts,
  auditEvents,
  commerceUsers,
  commitmentEntries,
  commitmentLedgers,
  entitlements,
  invoices,
  orderLines,
  orders,
  outboxMessages,
  quoteLines,
  quotes,
  rateCards,
  reportExports,
  usageEvents,
} from "../../schema";
import {
  accountingExports,
  accountCommercialProfiles,
  billingPolicies,
  collectionCases,
  commissionStatements,
  commitmentPeriods,
} from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";
import {
  DatabaseCoreWorkflowDispatchStore,
  type CoreWorkflowTaskDispatch,
} from "./core-dispatch";

export const coreScheduleIds = [
  "core.schedule.sync-overage.v1",
  "core.schedule.dunning.v1",
  "core.schedule.partner-credit.v1",
  "core.schedule.commission-settlement.v1",
  "core.schedule.usage-reconciliation.v1",
  "core.schedule.three-way-reconciliation.v1",
  "core.schedule.report-export-weekly.v1",
  "core.schedule.report-export-monthly.v1",
] as const;

export type CoreScheduleId = (typeof coreScheduleIds)[number];

/**
 * A dunning decision is stable within an aging stage. Encoding the stage in
 * the aggregate version lets the next threshold run while duplicate daily
 * deliveries inside one threshold retain an identical workflow payload.
 */
export function scheduledDunningStage(
  daysPastDue: number,
  firstThresholdDays = 7,
  secondThresholdDays = 30,
): { ordinal: 0 | 1 | 2; decisionDaysPastDue: number } {
  if (daysPastDue >= secondThresholdDays)
    return { ordinal: 2, decisionDaysPastDue: secondThresholdDays };
  if (daysPastDue >= firstThresholdDays)
    return { ordinal: 1, decisionDaysPastDue: firstThresholdDays };
  return { ordinal: 0, decisionDaysPastDue: 0 };
}

export function scheduledDunningVersion(
  invoiceRowVersion: number,
  stageOrdinal: 0 | 1 | 2,
): number {
  return invoiceRowVersion * 3 + stageOrdinal;
}

export interface CoreScheduleOccurrence {
  scheduleId: CoreScheduleId;
  scheduledAt: string;
  triggerRunId: string;
}

export interface EnqueuedCoreScheduleOccurrence {
  occurrenceId: string;
  eventId: string;
  queued: boolean;
}

export interface CoreScheduleDispatchRequest {
  scheduleId: CoreScheduleId;
  occurrenceId: string;
  scheduledAt: string;
  requestId: string;
  idempotencyPrefix: string;
  limit?: number;
}

function deterministicUuid(namespace: string, value: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(namespace).update("\0").update(value).digest(),
  ).subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function occurrenceIdentity(input: CoreScheduleOccurrence): string {
  return `${input.scheduleId}:${input.scheduledAt}`;
}

/**
 * Persists each Trigger schedule occurrence before any downstream scan starts.
 * The audit aggregate identity is deterministic, so duplicate Trigger delivery
 * and retry after a post-commit crash converge on one outbox message.
 */
export class DatabaseCoreScheduleOccurrenceStore {
  public constructor(private readonly db: RuntimeDatabase) {}

  public enqueue(
    input: CoreScheduleOccurrence,
  ): Promise<EnqueuedCoreScheduleOccurrence> {
    const scheduledAt = new Date(input.scheduledAt);
    if (!Number.isFinite(scheduledAt.valueOf()))
      return Promise.reject(new Error("CORE_SCHEDULE_TIME_INVALID"));
    if (!input.triggerRunId.trim())
      return Promise.reject(new Error("CORE_SCHEDULE_RUN_ID_INVALID"));
    const identity = occurrenceIdentity(input);
    const occurrenceId = deterministicUuid(
      "core-schedule-occurrence",
      identity,
    );
    const eventId = deterministicUuid("core-schedule-event", identity);
    const messageId = deterministicUuid("core-schedule-outbox", identity);
    const requestId = `schedule:${createHash("sha256")
      .update(input.triggerRunId)
      .digest("hex")
      .slice(0, 32)}`;
    const after = {
      scheduleId: input.scheduleId,
      scheduledAt: scheduledAt.toISOString(),
    };
    return withInternalTransaction(this.db, requestId, async (transaction) => {
      const inserted = await transaction
        .insert(auditEvents)
        .values({
          id: eventId,
          aggregateType: "workflow_run",
          aggregateId: occurrenceId,
          aggregateVersion: 1,
          eventType: "core.schedule.dispatch_requested",
          eventVersion: 1,
          actor: { kind: "system", id: "trigger-scheduler" },
          occurredAt: scheduledAt,
          requestId,
          after,
          metadata: { triggerRunId: input.triggerRunId },
        })
        .onConflictDoNothing()
        .returning({ id: auditEvents.id });
      if (inserted.length === 0) {
        const existing = await transaction.query.auditEvents.findFirst({
          where: and(
            eq(auditEvents.aggregateType, "workflow_run"),
            eq(auditEvents.aggregateId, occurrenceId),
            eq(auditEvents.aggregateVersion, 1),
          ),
        });
        if (
          !existing ||
          existing.id !== eventId ||
          existing.eventType !== "core.schedule.dispatch_requested"
        )
          throw new Error("CORE_SCHEDULE_OCCURRENCE_CONFLICT");
        return { occurrenceId, eventId, queued: false };
      }
      await transaction.insert(outboxMessages).values({
        id: messageId,
        eventId,
        topic: "core.schedule.dispatch.v1",
        payload: {
          eventId,
          eventType: "core.schedule.dispatch_requested",
          aggregateType: "workflow_run",
          aggregateId: occurrenceId,
          aggregateVersion: 1,
          occurredAt: scheduledAt.toISOString(),
          requestId,
          actor: { kind: "system", id: "trigger-scheduler" },
          data: after,
        },
      });
      return { occurrenceId, eventId, queued: true };
    });
  }
}

function dispatchKey(
  taskId: string,
  aggregateId: string,
  aggregateVersion: number,
): string {
  return `scheduled:${taskId}:${aggregateId}:v${aggregateVersion}`;
}

function context(
  taskId: string,
  aggregateId: string,
  aggregateVersion: number,
  occurredAt: Date | string,
) {
  const identity = dispatchKey(taskId, aggregateId, aggregateVersion);
  return {
    aggregateId,
    aggregateVersion,
    requestId: `schedule-dispatch:${createHash("sha256")
      .update(identity)
      .digest("hex")
      .slice(0, 32)}`,
    occurredAt: new Date(occurredAt).toISOString(),
  };
}

function maximumDate(values: readonly (Date | null)[]): string | null {
  const maximum = values.reduce<number | null>((result, value) => {
    if (!value) return result;
    return result === null
      ? value.valueOf()
      : Math.max(result, value.valueOf());
  }, null);
  return maximum === null ? null : new Date(maximum).toISOString();
}

function previousUtcMonth(at: Date): {
  start: Date;
  endExclusive: Date;
  startDate: string;
  endDate: string;
} {
  const endExclusive = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1),
  );
  const start = new Date(
    Date.UTC(endExclusive.getUTCFullYear(), endExclusive.getUTCMonth() - 1, 1),
  );
  const end = new Date(endExclusive.valueOf() - 86_400_000);
  return {
    start,
    endExclusive,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

type CurrencyTotal = { currency: string; minor: bigint };

/**
 * Reads every scheduled money-path payload from current persisted truth. The
 * schedule/outbox envelope contains only a schedule identity and timestamp;
 * caller-supplied provider IDs, amounts, currencies, and tenant identities are
 * never accepted by these builders.
 */
export class DatabaseCoreScheduledDispatchStore {
  private readonly eventDispatch: DatabaseCoreWorkflowDispatchStore;

  public constructor(
    private readonly db: RuntimeDatabase,
    authorizationSecret: string,
  ) {
    this.eventDispatch = new DatabaseCoreWorkflowDispatchStore(
      db,
      authorizationSecret,
    );
  }

  public async buildDueDispatches(
    input: CoreScheduleDispatchRequest,
  ): Promise<readonly CoreWorkflowTaskDispatch[]> {
    const scheduledAt = new Date(input.scheduledAt);
    if (!Number.isFinite(scheduledAt.valueOf()))
      throw new Error("CORE_SCHEDULE_TIME_INVALID");
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
      throw new Error("CORE_SCHEDULE_SCAN_LIMIT_INVALID");
    switch (input.scheduleId) {
      case "core.schedule.sync-overage.v1":
        return this.buildOverage(input, scheduledAt, limit);
      case "core.schedule.dunning.v1":
        return this.buildDunning(input, scheduledAt, limit);
      case "core.schedule.partner-credit.v1":
        return this.buildPartnerCredit(input, limit);
      case "core.schedule.commission-settlement.v1":
        return this.buildCommissionSettlement(input, limit);
      case "core.schedule.usage-reconciliation.v1":
        return this.buildUsageReconciliation(input, scheduledAt, limit);
      case "core.schedule.three-way-reconciliation.v1":
        return this.buildThreeWay(input, scheduledAt);
      case "core.schedule.report-export-weekly.v1":
      case "core.schedule.report-export-monthly.v1":
        return this.buildReportExports(input, limit);
    }
  }

  private buildOverage(
    input: CoreScheduleDispatchRequest,
    scheduledAt: Date,
    limit: number,
  ): Promise<readonly CoreWorkflowTaskDispatch[]> {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const periods = await tx.query.commitmentPeriods.findMany({
        where: and(
          eq(commitmentPeriods.status, "closed"),
          lte(commitmentPeriods.endsAt, scheduledAt),
          gt(commitmentPeriods.overageQuantity, "0"),
        ),
        orderBy: [asc(commitmentPeriods.endsAt), asc(commitmentPeriods.id)],
        limit,
      });
      const dispatches: CoreWorkflowTaskDispatch[] = [];
      for (const period of periods) {
        const ledger = await tx.query.commitmentLedgers.findFirst({
          where: eq(commitmentLedgers.id, period.ledgerId),
        });
        if (!ledger) throw new Error("SCHEDULED_OVERAGE_LEDGER_NOT_FOUND");
        const [order, line] = await Promise.all([
          tx.query.orders.findFirst({ where: eq(orders.id, ledger.orderId) }),
          tx.query.orderLines.findFirst({
            where: eq(orderLines.id, ledger.orderLineId),
          }),
        ]);
        if (!order || !line || line.orderId !== order.id)
          throw new Error("SCHEDULED_OVERAGE_ORDER_LINE_BINDING_INVALID");
        const [invoice, account, quoteLine, sourceQuote] = await Promise.all([
          tx.query.invoices.findFirst({
            where: and(
              eq(invoices.orderId, order.id),
              eq(invoices.status, "open"),
              isNotNull(invoices.stripeInvoiceId),
            ),
            orderBy: [asc(invoices.createdAt), asc(invoices.id)],
          }),
          tx.query.accounts.findFirst({
            where: eq(accounts.id, order.invoicingAccountId),
          }),
          tx.query.quoteLines.findFirst({
            where: eq(quoteLines.id, line.quoteLineId),
          }),
          tx.query.quotes.findFirst({ where: eq(quotes.id, order.quoteId) }),
        ]);
        if (
          !invoice?.stripeInvoiceId ||
          !account?.stripeCustomerId ||
          !quoteLine ||
          !sourceQuote
        )
          throw new Error("SCHEDULED_OVERAGE_PROVIDER_BINDING_INCOMPLETE");
        const rateCard = await tx.query.rateCards.findFirst({
          where: eq(rateCards.id, quoteLine.rateCardId),
        });
        if (
          !rateCard ||
          rateCard.sku !== line.sku ||
          rateCard.priceBookId !== sourceQuote.priceBookId ||
          line.overageRateMinor !== period.contractedOverageRateMinor ||
          invoice.currency !== sourceQuote.currency
        )
          throw new Error("SCHEDULED_OVERAGE_RATE_BINDING_INVALID");
        const entryRows = await tx
          .select({
            id: commitmentEntries.id,
            externalEventId: usageEvents.externalEventId,
          })
          .from(commitmentEntries)
          .innerJoin(
            usageEvents,
            eq(usageEvents.id, commitmentEntries.usageEventId),
          )
          .where(
            and(
              eq(commitmentEntries.ledgerId, ledger.id),
              gte(usageEvents.measuredAt, period.startsAt),
              lt(usageEvents.measuredAt, period.endsAt),
            ),
          )
          .orderBy(
            asc(commitmentEntries.recordedAt),
            asc(commitmentEntries.id),
          );
        if (entryRows.length === 0)
          throw new Error("SCHEDULED_OVERAGE_SOURCE_USAGE_MISSING");
        const firstEntry = entryRows[0];
        if (!firstEntry)
          throw new Error("SCHEDULED_OVERAGE_SOURCE_USAGE_MISSING");
        const amountMinor = multiplyMinorByQuantity(
          period.contractedOverageRateMinor,
          period.overageQuantity,
        );
        if (amountMinor <= 0n)
          throw new Error("SCHEDULED_OVERAGE_AMOUNT_INVALID");
        dispatches.push({
          taskId: "core.billing.sync-overage.v1",
          idempotencyKey: dispatchKey(
            "core.billing.sync-overage.v1",
            period.id,
            period.rowVersion,
          ),
          payload: {
            context: context(
              "core.billing.sync-overage.v1",
              period.id,
              period.rowVersion,
              period.endsAt,
            ),
            periodId: period.id,
            ledgerId: ledger.id,
            orderId: order.id,
            invoiceId: invoice.id,
            providerInvoiceId: invoice.stripeInvoiceId,
            customerId: account.stripeCustomerId,
            periodStart: period.startsAt.toISOString(),
            periodEnd: period.endsAt.toISOString(),
            lines: [
              {
                ledgerEntryId: firstEntry.id,
                sku: line.sku,
                taxCode: rateCard.stripeTaxCode,
                quantity: period.overageQuantity,
                contractedUnitRate: {
                  currency: invoice.currency,
                  minor: period.contractedOverageRateMinor.toString(),
                },
                amount: {
                  currency: invoice.currency,
                  minor: amountMinor.toString(),
                },
                sourceUsageIds: entryRows.map((row) => row.externalEventId),
              },
            ],
          },
        });
      }
      return dispatches;
    });
  }

  private buildDunning(
    input: CoreScheduleDispatchRequest,
    scheduledAt: Date,
    limit: number,
  ): Promise<readonly CoreWorkflowTaskDispatch[]> {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const cases = await tx.query.collectionCases.findMany({
        where: and(
          inArray(collectionCases.status, ["open", "promised", "escalated"]),
          lte(collectionCases.nextActionAt, scheduledAt),
        ),
        orderBy: [asc(collectionCases.nextActionAt), asc(collectionCases.id)],
        limit,
      });
      const dispatches: CoreWorkflowTaskDispatch[] = [];
      for (const collectionCase of cases) {
        const [invoice, owner, account] = await Promise.all([
          tx.query.invoices.findFirst({
            where: eq(invoices.id, collectionCase.invoiceId),
          }),
          tx.query.commerceUsers.findFirst({
            where: eq(commerceUsers.id, collectionCase.ownerUserId),
          }),
          tx.query.accounts.findFirst({
            where: eq(accounts.id, collectionCase.accountId),
          }),
        ]);
        if (!invoice || invoice.accountId !== collectionCase.accountId)
          throw new Error("SCHEDULED_DUNNING_INVOICE_BINDING_INVALID");
        if (
          !invoice.dueAt ||
          !["open", "uncollectible"].includes(invoice.status)
        )
          continue;
        if (!owner || !account)
          throw new Error("SCHEDULED_DUNNING_OWNER_BINDING_INCOMPLETE");
        const [order, policy, serviceEntitlements] = await Promise.all([
          tx.query.orders.findFirst({ where: eq(orders.id, invoice.orderId) }),
          tx.query.billingPolicies.findFirst({
            where: eq(billingPolicies.accountId, invoice.accountId),
          }),
          tx.query.entitlements.findMany({
            where: eq(entitlements.orderId, invoice.orderId),
          }),
        ]);
        if (
          !order ||
          !policy ||
          order.invoicingAccountId !== invoice.accountId ||
          !["direct", "referral", "resale", "distributor"].includes(
            order.sourcing,
          )
        )
          throw new Error("SCHEDULED_DUNNING_COMMERCIAL_BINDING_INCOMPLETE");
        const daysPastDue = Math.max(
          0,
          Math.floor(
            (scheduledAt.valueOf() - invoice.dueAt.valueOf()) / 86_400_000,
          ),
        );
        const dunningStage = scheduledDunningStage(daysPastDue);
        const dunningVersion = scheduledDunningVersion(
          invoice.rowVersion,
          dunningStage.ordinal,
        );
        dispatches.push({
          taskId: "core.collections.dunning.v1",
          idempotencyKey: dispatchKey(
            "core.collections.dunning.v1",
            invoice.id,
            dunningVersion,
          ),
          payload: {
            context: context(
              "core.collections.dunning.v1",
              invoice.id,
              dunningVersion,
              new Date(
                invoice.dueAt.valueOf() +
                  dunningStage.decisionDaysPastDue * 86_400_000,
              ),
            ),
            invoiceId: invoice.id,
            billingAccountId: invoice.accountId,
            commercialShape: order.sourcing,
            invoiceStatus:
              invoice.status === "uncollectible" ? "uncollectible" : "past_due",
            daysPastDue: dunningStage.decisionDaysPastDue,
            firstThresholdDays: 7,
            secondThresholdDays: 30,
            maxRetentionUntil: maximumDate(
              serviceEntitlements.map((item) => item.maximumRetentionAt),
            ),
            retentionLiabilityRule: "manual_review",
            serviceRunning: serviceEntitlements.some((item) =>
              ["active", "suspended_write"].includes(item.status),
            ),
            collectionsOwner: owner.email,
            billingRecipients: [account.invoiceDeliveryEmail],
          },
        });
      }
      return dispatches;
    });
  }

  private buildPartnerCredit(
    input: CoreScheduleDispatchRequest,
    limit: number,
  ): Promise<readonly CoreWorkflowTaskDispatch[]> {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const candidates = await tx.query.orders.findMany({
        where: and(
          eq(orders.status, "submitted"),
          inArray(orders.sourcing, ["referral", "resale", "distributor"]),
          isNotNull(orders.partnerAccountId),
        ),
        orderBy: [asc(orders.createdAt), asc(orders.id)],
        limit,
      });
      const dispatches: CoreWorkflowTaskDispatch[] = [];
      for (const order of candidates) {
        if (!order.partnerAccountId)
          throw new Error("SCHEDULED_PARTNER_CREDIT_PARTNER_MISSING");
        const [quote, partner, profile, policy] = await Promise.all([
          tx.query.quotes.findFirst({ where: eq(quotes.id, order.quoteId) }),
          tx.query.accounts.findFirst({
            where: eq(accounts.id, order.partnerAccountId),
          }),
          tx.query.accountCommercialProfiles.findFirst({
            where: eq(
              accountCommercialProfiles.accountId,
              order.partnerAccountId,
            ),
          }),
          tx.query.billingPolicies.findFirst({
            where: eq(billingPolicies.accountId, order.invoicingAccountId),
          }),
        ]);
        if (
          !quote ||
          !partner ||
          !profile ||
          !policy ||
          quote.currency !== partner.currency ||
          order.invoicingAccountId !== order.partnerAccountId
        )
          throw new Error("SCHEDULED_PARTNER_CREDIT_BINDING_INVALID");
        if (!profile.collectionsOwnerId)
          throw new Error("SCHEDULED_PARTNER_CREDIT_OWNER_MISSING");
        const owner = await tx.query.commerceUsers.findFirst({
          where: eq(commerceUsers.id, profile.collectionsOwnerId),
        });
        if (!owner) throw new Error("SCHEDULED_PARTNER_CREDIT_OWNER_MISSING");
        dispatches.push({
          taskId: "core.collections.partner-credit.v1",
          idempotencyKey: dispatchKey(
            "core.collections.partner-credit.v1",
            order.id,
            order.rowVersion,
          ),
          payload: {
            context: context(
              "core.collections.partner-credit.v1",
              order.id,
              order.rowVersion,
              order.createdAt,
            ),
            partnerAccountId: order.partnerAccountId,
            orderId: order.id,
            serviceKind: "new_end_client",
            creditPolicy: policy.collectionMethod,
            currency: quote.currency,
            currentExposureMinor: profile.currentExposureMinor.toString(),
            requestedExposureMinor: quote.totalMinor.toString(),
            creditLimitMinor: partner.aggregateCreditLimitMinor.toString(),
            hasRequiredPaymentHistory: profile.creditStatus === "approved",
            collectionsOwner: owner.email,
          },
        });
      }
      return dispatches;
    });
  }

  private async buildCommissionSettlement(
    input: CoreScheduleDispatchRequest,
    limit: number,
  ): Promise<readonly CoreWorkflowTaskDispatch[]> {
    const candidates = await withInternalTransaction(
      this.db,
      input.requestId,
      (tx) =>
        tx.query.commissionStatements.findMany({
          where: eq(commissionStatements.status, "approved"),
          orderBy: [
            asc(commissionStatements.periodEndsOn),
            asc(commissionStatements.id),
          ],
          limit,
        }),
    );
    const result: CoreWorkflowTaskDispatch[] = [];
    for (const statement of candidates) {
      result.push(
        await this.eventDispatch.buildCommissionSettlementDispatch({
          statementId: statement.id,
          context: context(
            "core.commissions.settle.v1",
            statement.id,
            statement.rowVersion,
            statement.updatedAt,
          ),
          idempotencyKey: dispatchKey(
            "core.commissions.settle.v1",
            statement.id,
            statement.rowVersion,
          ),
        }),
      );
    }
    return result;
  }

  private buildUsageReconciliation(
    input: CoreScheduleDispatchRequest,
    scheduledAt: Date,
    limit: number,
  ): Promise<readonly CoreWorkflowTaskDispatch[]> {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const ledgers = await tx.query.commitmentLedgers.findMany({
        where: lte(commitmentLedgers.periodEndsAt, scheduledAt),
        orderBy: [
          asc(commitmentLedgers.periodEndsAt),
          asc(commitmentLedgers.id),
        ],
        limit,
      });
      const dispatches: CoreWorkflowTaskDispatch[] = [];
      for (const ledger of ledgers) {
        const entitlement = await tx.query.entitlements.findFirst({
          where: eq(entitlements.orderLineId, ledger.orderLineId),
        });
        if (!entitlement)
          throw new Error("SCHEDULED_USAGE_ENTITLEMENT_NOT_FOUND");
        const usage = await tx
          .select({
            externalEventId: usageEvents.externalEventId,
            quantity: commitmentEntries.quantity,
          })
          .from(commitmentEntries)
          .innerJoin(
            usageEvents,
            eq(usageEvents.id, commitmentEntries.usageEventId),
          )
          .where(
            and(
              eq(commitmentEntries.ledgerId, ledger.id),
              gte(usageEvents.measuredAt, ledger.periodStartsAt),
              lt(usageEvents.measuredAt, ledger.periodEndsAt),
            ),
          )
          .orderBy(asc(usageEvents.measuredAt), asc(usageEvents.id));
        // The expected quantity stored on the authoritative ledger is used;
        // source IDs identify the exact persisted events included in the scan.
        dispatches.push({
          taskId: "core.reconciliation.usage.v1",
          idempotencyKey: dispatchKey(
            "core.reconciliation.usage.v1",
            ledger.id,
            ledger.rowVersion,
          ),
          payload: {
            context: context(
              "core.reconciliation.usage.v1",
              ledger.id,
              ledger.rowVersion,
              ledger.periodEndsAt,
            ),
            ledgerId: ledger.id,
            organizationId: entitlement.organizationId,
            from: ledger.periodStartsAt.toISOString(),
            to: ledger.periodEndsAt.toISOString(),
            expected: [
              {
                sku: entitlement.sku,
                quantity: ledger.consumedQuantity,
                sourceUsageIds: usage.map((item) => item.externalEventId),
              },
            ],
          },
        });
      }
      return dispatches;
    });
  }

  private buildThreeWay(
    input: CoreScheduleDispatchRequest,
    scheduledAt: Date,
  ): Promise<readonly CoreWorkflowTaskDispatch[]> {
    const period = previousUtcMonth(scheduledAt);
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const platformRows = await tx
        .select({
          currency: invoices.currency,
          minor: sql<bigint>`coalesce(sum(${invoices.amountMinor}), 0)::bigint`,
        })
        .from(invoices)
        .where(
          and(
            gte(invoices.createdAt, period.start),
            lt(invoices.createdAt, period.endExclusive),
            inArray(invoices.status, ["open", "paid", "uncollectible"]),
          ),
        )
        .groupBy(invoices.currency);
      const stripeRows = await tx
        .select({
          currency: invoices.currency,
          minor: sql<bigint>`coalesce(sum(${invoices.amountMinor}), 0)::bigint`,
        })
        .from(invoices)
        .where(
          and(
            gte(invoices.createdAt, period.start),
            lt(invoices.createdAt, period.endExclusive),
            inArray(invoices.status, ["open", "paid", "uncollectible"]),
            isNotNull(invoices.stripeInvoiceId),
          ),
        )
        .groupBy(invoices.currency);
      const accountingRows = await tx
        .select({
          currency: accountingExports.currency,
          minor: sql<bigint>`coalesce(sum(${accountingExports.totalCreditMinor}), 0)::bigint`,
        })
        .from(accountingExports)
        .where(
          and(
            gte(accountingExports.periodStartsOn, period.startDate),
            lte(accountingExports.periodEndsOn, period.endDate),
            isNotNull(accountingExports.providerReference),
          ),
        )
        .groupBy(accountingExports.currency);
      const totals = (rows: readonly CurrencyTotal[]) =>
        rows.map((row) => ({
          currency: row.currency,
          minor: BigInt(row.minor).toString(),
        }));
      return [
        {
          taskId: "core.reconciliation.three-way.v1",
          idempotencyKey: dispatchKey(
            "core.reconciliation.three-way.v1",
            input.occurrenceId,
            1,
          ),
          payload: {
            context: context(
              "core.reconciliation.three-way.v1",
              input.occurrenceId,
              1,
              period.endExclusive,
            ),
            periodStart: period.startDate,
            periodEnd: period.endDate,
            platform: totals(platformRows),
            billingProvider: totals(stripeRows),
            accounting: totals(accountingRows),
            toleranceMinor: "0",
          },
        },
      ];
    });
  }

  private buildReportExports(
    input: CoreScheduleDispatchRequest,
    limit: number,
  ): Promise<readonly CoreWorkflowTaskDispatch[]> {
    return withInternalTransaction(this.db, input.requestId, async (tx) => {
      const pending = await tx.query.reportExports.findMany({
        where: eq(reportExports.status, "pending"),
        orderBy: [asc(reportExports.createdAt), asc(reportExports.id)],
        limit,
      });
      return pending.map((report): CoreWorkflowTaskDispatch => {
        if (
          !report.parameters ||
          typeof report.parameters !== "object" ||
          Array.isArray(report.parameters)
        )
          throw new Error("SCHEDULED_REPORT_PARAMETERS_INVALID");
        const parameters = report.parameters as Record<string, unknown>;
        return {
          taskId: "core.reporting.export.v1",
          idempotencyKey: dispatchKey(
            "core.reporting.export.v1",
            report.id,
            report.rowVersion,
          ),
          payload: {
            context: context(
              "core.reporting.export.v1",
              report.id,
              report.rowVersion,
              report.updatedAt,
            ),
            reportExportId: report.id,
            reportType: report.report,
            asOf: parameters.asOf,
            ...(parameters.from ? { from: parameters.from } : {}),
            ...(parameters.to ? { to: parameters.to } : {}),
            ...(parameters.accountId
              ? { accountId: parameters.accountId }
              : {}),
            ...(parameters.partnerAccountId
              ? { partnerAccountId: parameters.partnerAccountId }
              : {}),
            ...(parameters.requestedColumns
              ? { requestedColumns: parameters.requestedColumns }
              : {}),
            costIngestionComplete: parameters.costIngestionComplete ?? false,
            retainUntil: parameters.retainUntil,
          },
        };
      });
    });
  }
}
