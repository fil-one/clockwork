import { createHash } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  accounts,
  commerceUsers,
  commissionAccruals,
  creditNotes,
  disputeCases,
  entitlements,
  invoices,
  orderLines,
  orders,
  payments,
  procurementProfiles,
  quotes,
  refunds,
} from "../../schema";
import {
  billingPolicies,
  commissionStatementLines,
  commissionStatements,
  invoiceEndClientAllocations,
} from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import {
  DatabaseCoreError,
  DatabaseCoreFinanceRepository,
} from "../core/database-finance";

export type PersistedCommissionSourceType =
  "payment" | "credit_note" | "credit_note_void" | "refund" | "chargeback";

export interface CoreWorkflowDispatchContext {
  aggregateId: string;
  aggregateVersion: number;
  requestId: string;
  occurredAt: string;
}

export interface CoreWorkflowTaskDispatch {
  taskId:
    | "core.billing.issue-invoice.v1"
    | "core.billing.sync-overage.v1"
    | "core.collections.dunning.v1"
    | "core.collections.partner-credit.v1"
    | "core.commissions.settle.v1"
    | "core.reconciliation.usage.v1"
    | "core.reconciliation.three-way.v1"
    | "core.reporting.export.v1";
  payload: unknown;
  idempotencyKey: string;
}

export interface InvoiceDraftResult {
  invoiceId: string;
  created: boolean;
}

export interface CommissionProjectionResult {
  status: "projected" | "duplicate" | "not_applicable";
  accrualId?: string;
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

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function collectionMethod(input: {
  collectionMethod: string;
  paymentRail: string;
}): "auto_charge" | "bank_transfer" | "net_terms" {
  if (input.collectionMethod === "net_terms") return "net_terms";
  if (input.collectionMethod === "auto_charge") return "auto_charge";
  if (input.collectionMethod !== "prepay")
    throw new Error("BILLING_COLLECTION_METHOD_UNSUPPORTED");
  return ["wire", "sepa_credit", "bacs"].includes(input.paymentRail)
    ? "bank_transfer"
    : "auto_charge";
}

/**
 * Converts durable core events into workflow payloads exclusively from current
 * persisted truth. Outbox payload money, account, policy, and provider IDs are
 * deliberately ignored.
 */
export class DatabaseCoreWorkflowDispatchStore {
  private readonly finance: DatabaseCoreFinanceRepository;

  public constructor(
    private readonly database: RuntimeDatabase,
    authorizationSecret: string,
  ) {
    this.finance = new DatabaseCoreFinanceRepository({
      database,
      pricingDatabase: database,
      authorizationSecret,
    });
  }

  public ensureInvoiceDraftForProvisionedOrder(input: {
    orderId: string;
    requestId: string;
    occurredAt: string;
  }): Promise<InvoiceDraftResult> {
    const occurredAt = new Date(input.occurredAt);
    if (!Number.isFinite(occurredAt.valueOf()))
      throw new Error("PROVISIONING_EVENT_TIME_INVALID");
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const existing = await transaction.query.invoices.findFirst({
          where: eq(invoices.orderId, input.orderId),
          orderBy: [asc(invoices.createdAt), asc(invoices.id)],
        });
        if (existing) return { invoiceId: existing.id, created: false };

        const order = await transaction.query.orders.findFirst({
          where: eq(orders.id, input.orderId),
        });
        if (!order) throw new Error("PROVISIONED_ORDER_NOT_FOUND");
        if (
          order.status !== "active" ||
          !order.immutableAt ||
          order.sourcing === "marketplace"
        )
          throw new Error("PROVISIONED_ORDER_NOT_INVOICE_ELIGIBLE");
        if (
          !["direct", "referral", "resale", "distributor"].includes(
            order.sourcing,
          )
        )
          throw new Error("PROVISIONED_ORDER_CHANNEL_UNSUPPORTED");

        const [quote, policy, lines, activeEntitlements] = await Promise.all([
          transaction.query.quotes.findFirst({
            where: and(
              eq(quotes.id, order.quoteId),
              eq(quotes.status, "accepted"),
            ),
          }),
          transaction.query.billingPolicies.findFirst({
            where: eq(billingPolicies.accountId, order.invoicingAccountId),
          }),
          transaction.query.orderLines.findMany({
            where: eq(orderLines.orderId, order.id),
          }),
          transaction.query.entitlements.findMany({
            where: and(
              eq(entitlements.orderId, order.id),
              eq(entitlements.status, "active"),
            ),
          }),
        ]);
        if (!quote || !policy)
          throw new Error("PROVISIONED_ORDER_BILLING_TRUTH_INCOMPLETE");
        if (
          lines.length === 0 ||
          activeEntitlements.length !== lines.length ||
          activeEntitlements.some(
            (entitlement) =>
              !entitlement.provisionedResourceId || !entitlement.activatedAt,
          )
        )
          throw new Error("PROVISIONED_ORDER_ENTITLEMENTS_INCOMPLETE");
        if (policy.requirePo && !order.poNumber)
          throw new Error("PROVISIONED_ORDER_REQUIRED_PO_MISSING");

        const invoiceId = deterministicUuid("initial-invoice", order.id);
        const dueAt = addDays(occurredAt, policy.termsDays ?? 0);
        const [invoice] = await transaction
          .insert(invoices)
          .values({
            id: invoiceId,
            orderId: order.id,
            accountId: order.invoicingAccountId,
            stripeInvoiceId: null,
            currency: quote.currency,
            amountMinor: quote.totalMinor,
            poNumber: order.poNumber,
            status: "draft",
            dueAt,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          })
          .onConflictDoNothing()
          .returning();
        if (!invoice) {
          const concurrent = await transaction.query.invoices.findFirst({
            where: eq(invoices.id, invoiceId),
          });
          if (!concurrent || concurrent.orderId !== order.id)
            throw new Error("INVOICE_DRAFT_CONCURRENT_CONFLICT");
          return { invoiceId: concurrent.id, created: false };
        }

        if (order.sourcing === "resale" || order.sourcing === "distributor") {
          if (invoice.accountId !== order.partnerAccountId)
            throw new Error("PARTNER_INVOICE_MERCHANT_SCOPE_MISMATCH");
          await transaction.insert(invoiceEndClientAllocations).values({
            invoiceId: invoice.id,
            orderId: order.id,
            endClientAccountId: order.accountId,
            currency: invoice.currency,
            subtotalMinor: invoice.amountMinor,
            taxMinor: 0n,
            totalMinor: invoice.amountMinor,
            stripeInvoiceLineIds: [],
          });
        }

        await appendAuditAndOutbox(transaction, {
          accountId: invoice.accountId,
          aggregateType: "invoice",
          aggregateId: invoice.id,
          aggregateVersion: invoice.rowVersion,
          eventType: "core.invoice.draft_ready",
          topic: "core.invoice.draft_ready",
          actor: { kind: "system", id: "provisioning-billing-join" },
          requestId: input.requestId,
          occurredAt,
          after: {
            invoiceId: invoice.id,
            orderId: invoice.orderId,
            billingAccountId: invoice.accountId,
          },
        });
        return { invoiceId: invoice.id, created: true };
      },
    );
  }

  public buildIssueInvoiceDispatch(input: {
    invoiceId: string;
    context: CoreWorkflowDispatchContext;
    idempotencyKey: string;
  }): Promise<CoreWorkflowTaskDispatch> {
    return withInternalTransaction(
      this.database,
      input.context.requestId,
      async (transaction) => {
        const invoice = await transaction.query.invoices.findFirst({
          where: eq(invoices.id, input.invoiceId),
        });
        if (
          !invoice ||
          invoice.status !== "draft" ||
          invoice.stripeInvoiceId !== null
        )
          throw new Error("INVOICE_DRAFT_NOT_ISSUE_ELIGIBLE");
        const [order, account, policy, procurement, allocations] =
          await Promise.all([
            transaction.query.orders.findFirst({
              where: eq(orders.id, invoice.orderId),
            }),
            transaction.query.accounts.findFirst({
              where: eq(accounts.id, invoice.accountId),
            }),
            transaction.query.billingPolicies.findFirst({
              where: eq(billingPolicies.accountId, invoice.accountId),
            }),
            transaction.query.procurementProfiles.findFirst({
              where: eq(procurementProfiles.accountId, invoice.accountId),
            }),
            transaction.query.invoiceEndClientAllocations.findMany({
              where: eq(invoiceEndClientAllocations.invoiceId, invoice.id),
              orderBy: [asc(invoiceEndClientAllocations.endClientAccountId)],
            }),
          ]);
        if (!order || !account?.stripeCustomerId || !policy)
          throw new Error("INVOICE_ISSUE_PERSISTED_TRUTH_INCOMPLETE");
        if (
          order.id !== invoice.orderId ||
          order.invoicingAccountId !== invoice.accountId ||
          order.status !== "active"
        )
          throw new Error("INVOICE_ISSUE_ORDER_BINDING_INVALID");
        const partnerInvoice =
          order.sourcing === "resale" || order.sourcing === "distributor";
        if (
          partnerInvoice !== allocations.length > 0 ||
          allocations.some(
            (allocation) =>
              allocation.orderId !== order.id ||
              allocation.currency !== invoice.currency ||
              allocation.endClientAccountId !== order.accountId,
          ) ||
          allocations.reduce(
            (sum, allocation) => sum + allocation.totalMinor,
            0n,
          ) !== (partnerInvoice ? invoice.amountMinor : 0n)
        )
          throw new Error("INVOICE_ISSUE_ALLOCATION_BINDING_INVALID");
        const vendorSetupComplete =
          !policy.requireVendorSetup ||
          procurement?.supplierPortalStatus === "complete";
        const method = collectionMethod(policy);
        if (
          method === "net_terms" &&
          (!invoice.poNumber || !vendorSetupComplete)
        )
          throw new Error("NET_TERMS_ISSUE_PREREQUISITES_INCOMPLETE");

        return {
          taskId: "core.billing.issue-invoice.v1",
          idempotencyKey: input.idempotencyKey,
          payload: {
            context: {
              aggregateId: invoice.id,
              aggregateVersion: invoice.rowVersion,
              requestId: input.context.requestId,
              occurredAt: input.context.occurredAt,
            },
            invoiceId: invoice.id,
            orderId: order.id,
            billingAccountId: invoice.accountId,
            customerId: account.stripeCustomerId,
            commercialShape: order.sourcing,
            collectionMethod: method,
            amount: {
              currency: invoice.currency,
              minor: invoice.amountMinor.toString(),
            },
            ...(invoice.poNumber ? { poNumber: invoice.poNumber } : {}),
            apEmail: account.invoiceDeliveryEmail,
            vendorSetupComplete,
            groups: allocations.map((allocation) => ({
              endClientAccountId: allocation.endClientAccountId,
              amount: {
                currency: allocation.currency,
                minor: allocation.totalMinor.toString(),
              },
              description: `Consolidated order ${allocation.orderId}`,
            })),
          },
        };
      },
    );
  }

  public buildCommissionSettlementDispatch(input: {
    statementId: string;
    context: CoreWorkflowDispatchContext;
    idempotencyKey: string;
  }): Promise<CoreWorkflowTaskDispatch> {
    return withInternalTransaction(
      this.database,
      input.context.requestId,
      async (transaction) => {
        const statement =
          await transaction.query.commissionStatements.findFirst({
            where: eq(commissionStatements.id, input.statementId),
          });
        if (!statement || statement.status !== "approved")
          throw new Error("COMMISSION_STATEMENT_NOT_SETTLEMENT_ELIGIBLE");
        const lines = await transaction
          .select({
            accrualId: commissionStatementLines.accrualId,
            invoiceId: commissionAccruals.invoiceId,
            currency: commissionAccruals.currency,
            collectedRevenueMinor:
              commissionStatementLines.netCollectedRevenueMinor,
            commissionMinor: commissionStatementLines.commissionMinor,
            holdbackMinor: commissionStatementLines.holdbackMinor,
          })
          .from(commissionStatementLines)
          .innerJoin(
            commissionAccruals,
            eq(commissionAccruals.id, commissionStatementLines.accrualId),
          )
          .where(eq(commissionStatementLines.statementId, statement.id));
        if (lines.length === 0)
          throw new Error("COMMISSION_STATEMENT_HAS_NO_LINES");
        return {
          taskId: "core.commissions.settle.v1",
          idempotencyKey: input.idempotencyKey,
          payload: {
            context: {
              aggregateId: statement.id,
              aggregateVersion: statement.rowVersion,
              requestId: input.context.requestId,
              occurredAt: input.context.occurredAt,
            },
            statementId: statement.id,
            partnerAccountId: statement.partnerAccountId,
            periodStart: statement.periodStartsOn,
            periodEnd: statement.periodEndsOn,
            currency: statement.currency,
            accruals: lines.map((line) => ({
              accrualId: line.accrualId,
              invoiceId: line.invoiceId,
              currency: line.currency,
              collectedRevenueMinor: line.collectedRevenueMinor.toString(),
              commissionMinor: line.commissionMinor.toString(),
              holdbackMinor: line.holdbackMinor.toString(),
              status: "stated",
            })),
          },
        };
      },
    );
  }

  public async projectReferralCommission(input: {
    sourceType: PersistedCommissionSourceType;
    sourceId: string;
    requestId: string;
  }): Promise<CommissionProjectionResult> {
    const target = await withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => this.commissionTarget(transaction, input),
    );
    if (!target) return { status: "not_applicable" };
    const accrualId = deterministicUuid(
      "referral-commission",
      `${input.sourceType}:${input.sourceId}`,
    );
    try {
      await this.finance.mutate({
        resource: "commissions",
        id: accrualId,
        accountId: target.partnerAccountId,
        action: ["payment", "credit_note_void"].includes(input.sourceType)
          ? "accrue"
          : "clawback",
        payload: { sourceType: input.sourceType, sourceId: input.sourceId },
        actor: { kind: "system", id: "stripe-commission-projection" },
        authorization: target.authorization,
        requestId: input.requestId,
        idempotencyKey: `commission:${input.sourceType}:${input.sourceId}`,
        occurredAt: target.occurredAt,
      });
      return { status: "projected", accrualId };
    } catch (error: unknown) {
      if (error instanceof DatabaseCoreError && error.code === "DUPLICATE")
        return { status: "duplicate", accrualId };
      throw error;
    }
  }

  private async commissionTarget(
    transaction: RuntimeTransaction,
    input: { sourceType: PersistedCommissionSourceType; sourceId: string },
  ): Promise<
    | {
        partnerAccountId: string;
        occurredAt: string;
        authorization: AuthorizationContext;
      }
    | undefined
  > {
    let orderId: string | undefined;
    let occurredAt: Date | undefined;
    if (input.sourceType === "payment") {
      const row = await transaction.query.payments.findFirst({
        where: eq(payments.id, input.sourceId),
      });
      if (row?.status !== "succeeded" || !row.receivedAt) return undefined;
      orderId = row.orderId;
      occurredAt = row.receivedAt;
    } else if (
      input.sourceType === "credit_note" ||
      input.sourceType === "credit_note_void"
    ) {
      const row = await transaction.query.creditNotes.findFirst({
        where: eq(creditNotes.id, input.sourceId),
      });
      const requiredStatus =
        input.sourceType === "credit_note_void" ? "void" : "issued";
      if (row?.status !== requiredStatus) return undefined;
      orderId = row.orderId;
      occurredAt = row.createdAt;
    } else if (input.sourceType === "refund") {
      const row = await transaction.query.refunds.findFirst({
        where: eq(refunds.id, input.sourceId),
      });
      if (row?.status !== "succeeded") return undefined;
      orderId = row.orderId;
      occurredAt = row.createdAt;
    } else {
      const row = await transaction.query.disputeCases.findFirst({
        where: eq(disputeCases.id, input.sourceId),
      });
      if (row?.status !== "lost") return undefined;
      orderId = row.orderId;
      occurredAt = row.updatedAt;
    }
    const order = await transaction.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    if (!order || order.sourcing !== "referral" || !order.partnerAccountId)
      return undefined;
    const [partner, internalUser] = await Promise.all([
      transaction.query.accounts.findFirst({
        where: eq(accounts.id, order.partnerAccountId),
      }),
      transaction.query.commerceUsers.findFirst({
        where: eq(commerceUsers.isInternalStaff, true),
        orderBy: [asc(commerceUsers.id)],
      }),
    ]);
    if (
      !partner ||
      partner.partnerAgreementType !== "referral" ||
      !internalUser
    )
      return undefined;
    return {
      partnerAccountId: partner.id,
      occurredAt: occurredAt.toISOString(),
      authorization: {
        userId: ids.user.parse(internalUser.id),
        accountIds: [ids.account.parse(partner.id)],
        roles: ["internal_operator"],
        isInternalStaff: true,
        mfaVerified: true,
        recentAuthenticationVerified: true,
      },
    };
  }
}
