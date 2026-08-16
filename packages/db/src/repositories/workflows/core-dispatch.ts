import { createHash } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { ids, type TaxPort } from "@clockwork/contracts";
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
  invoiceDocumentSnapshots,
  invoiceEndClientAllocations,
  orderLineSnapshots,
} from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import {
  acceptedAmendmentDeltaMinor,
  DatabaseCoreError,
  DatabaseCoreFinanceRepository,
  initialInvoiceId,
  orderTaxDetermination,
} from "../core/database-finance";
import { persistInvoiceTaxDetermination } from "../core/tax-determination";

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
    | "core.procurement.certificate-expiry.v1"
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

const InvoiceLineSourceSchema = z
  .object({
    id: z.uuid(),
    sku: z.string().min(1),
    quantity: z.string().min(1),
    unitPrice: z.object({
      currency: z.enum(["USD", "EUR", "GBP"]),
      minor: z.string().regex(/^(0|[1-9]\d*)$/),
    }),
    lineTotal: z.object({
      currency: z.enum(["USD", "EUR", "GBP"]),
      minor: z.string().regex(/^(0|[1-9]\d*)$/),
    }),
  })
  .passthrough();

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_FINITE_JSON_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (!value || typeof value !== "object")
    throw new Error("NON_JSON_INVOICE_SOURCE");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
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

  /**
   * `tax` is the deprecated {@link TaxPort} and is read by nothing: the
   * determination is made from the persisted rule books by the engine in
   * `@clockwork/domain`. It stays, optional, because `packages/workflows`
   * still passes it positionally and that composition is outside this lane's
   * edit scope; deleting the parameter is a one-line change there.
   */
  public constructor(
    private readonly database: RuntimeDatabase,
    authorizationSecret: string,
    tax?: TaxPort,
  ) {
    this.finance = new DatabaseCoreFinanceRepository({
      database,
      pricingDatabase: database,
      authorizationSecret,
      ...(tax ? { tax } : {}),
    });
  }

  public async ensureInvoiceDraftForProvisionedOrder(input: {
    orderId: string;
    requestId: string;
    occurredAt: string;
  }): Promise<InvoiceDraftResult> {
    const occurredAt = new Date(input.occurredAt);
    if (!Number.isFinite(occurredAt.valueOf()))
      throw new Error("PROVISIONING_EVENT_TIME_INVALID");
    // Both writers of this row reach the same tax figure by the same rule, and
    // the determination is made before the write transaction opens so no
    // invoice row is held locked while it runs. Its failure is carried rather
    // than thrown: an order that is not invoice-eligible must still fail with
    // the reason it is not eligible, not with a tax error about an order this
    // writer was never going to bill.
    //
    // The tax point is the provisioning event's own time, not a clock read
    // here: rule books resolve by date, and a determination that cannot say
    // which day it was made for cannot be reproduced.
    const determination = await orderTaxDetermination({
      database: this.database,
      requestId: input.requestId,
      orderId: input.orderId,
      taxPointDate: occurredAt.toISOString(),
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
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
        // What the order owes, not what it quoted. This draft runs at
        // provisioning, before any amendment exists, so the delta is normally
        // zero. When it is not, the draft cannot be written here at all: the
        // immutable document snapshot below is bound by 001300 to the quoted
        // order-line snapshots — its subtotal must equal their sum, its total
        // must equal the invoice amount, and the only slack between them is a
        // tax line constrained non-negative. An amended amount is therefore
        // representable only as tax, and a downgrade not at all. Refusing beats
        // billing the quote total and losing the amendment, or filing an
        // upgrade the customer signed as tax it never owed. It is checked
        // before the entitlement and PO preconditions because it is a
        // commercial fact about the order, not a gap in its provisioning.
        const amendmentDeltaMinor = await acceptedAmendmentDeltaMinor(
          transaction,
          order,
          quote.currency,
        );
        if (amendmentDeltaMinor !== 0n)
          throw new Error("PROVISIONED_ORDER_AMENDED_BEFORE_INVOICE");
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
        if (!determination.ok) throw determination.error;
        if (
          determination.value.currency !== quote.currency ||
          determination.value.netMinor !==
            quote.totalMinor + amendmentDeltaMinor
        )
          throw new Error("PROVISIONED_ORDER_TAX_DETERMINATION_STALE");

        const persistedLineSnapshots =
          await transaction.query.orderLineSnapshots.findMany({
            where: inArray(
              orderLineSnapshots.orderLineId,
              lines.map((line) => line.id),
            ),
          });
        if (persistedLineSnapshots.length !== lines.length)
          throw new Error("PROVISIONED_ORDER_LINE_SNAPSHOTS_INCOMPLETE");
        const invoiceLines = persistedLineSnapshots
          .map((snapshot) => InvoiceLineSourceSchema.parse(snapshot.snapshot))
          .sort((left, right) => left.id.localeCompare(right.id));
        if (
          invoiceLines.some(
            (line) =>
              line.unitPrice.currency !== quote.currency ||
              line.lineTotal.currency !== quote.currency,
          ) ||
          invoiceLines.reduce(
            (sum, line) => sum + BigInt(line.lineTotal.minor),
            0n,
          ) !== quote.totalMinor
        )
          throw new Error("PROVISIONED_ORDER_INVOICE_LINE_TOTAL_MISMATCH");

        // One definition, imported, rather than the same derivation written
        // twice: the core writer collides with this row on the primary key
        // only while both sides derive the identifier identically.
        const invoiceId = initialInvoiceId(order.id);
        const dueAt = addDays(occurredAt, policy.termsDays ?? 0);
        const [invoice] = await transaction
          .insert(invoices)
          .values({
            id: invoiceId,
            orderId: order.id,
            accountId: order.invoicingAccountId,
            stripeInvoiceId: null,
            currency: quote.currency,
            amountMinor:
              quote.totalMinor +
              amendmentDeltaMinor +
              determination.value.taxMinor,
            // Refused above unless it is zero, and written rather than defaulted
            // so this writer and the core writer state the same thing about the
            // same row (001393). The projection trigger checks the stored figure
            // against the live sum at insert, so a zero written here while an
            // amendment exists is refused rather than persisted.
            amendmentDeltaMinor,
            taxMinor: determination.value.taxMinor,
            taxTreatment: determination.value.treatment,
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

        const documentLines = invoiceLines.map((line) => ({
          id: line.id,
          description: line.sku,
          quantity: line.quantity,
          unitPrice: {
            currency: line.unitPrice.currency,
            minorUnits: line.unitPrice.minor,
          },
          amount: {
            currency: line.lineTotal.currency,
            minorUnits: line.lineTotal.minor,
          },
        }));
        const snapshotSource = {
          invoiceId: invoice.id,
          orderId: order.id,
          quoteId: quote.id,
          currency: quote.currency,
          lineItems: documentLines,
          subtotalMinor: (invoice.amountMinor - invoice.taxMinor).toString(),
          taxMinor: invoice.taxMinor.toString(),
          totalMinor: invoice.amountMinor.toString(),
          sourceVersion: `quote:${quote.id}:r${quote.revision}`,
        };
        await transaction.insert(invoiceDocumentSnapshots).values({
          invoiceId: invoice.id,
          orderId: order.id,
          quoteId: quote.id,
          currency: quote.currency,
          lineItems: documentLines,
          subtotalMinor: invoice.amountMinor - invoice.taxMinor,
          taxMinor: invoice.taxMinor,
          totalMinor: invoice.amountMinor,
          sourceHash: createHash("sha256")
            .update(canonicalJson(snapshotSource))
            .digest("hex"),
          sourceVersion: snapshotSource.sourceVersion,
          createdAt: occurredAt,
        });

        // THE DETERMINATION, PERSISTED WITH THE BILL IT PRODUCED. One row per
        // invoice and one per line per jurisdiction (001417), including the
        // canonical question, so this figure can be replayed against the books
        // it was pinned to rather than merely believed.
        if (!determination.value.detail)
          throw new Error("PROVISIONED_ORDER_TAX_DETERMINATION_NOT_RECORDED");
        await persistInvoiceTaxDetermination(transaction, {
          invoiceId: invoice.id,
          orderId: order.id,
          currency: invoice.currency,
          netMinor: invoice.amountMinor - invoice.taxMinor,
          taxMinor: invoice.taxMinor,
          treatment: determination.value.treatment,
          detail: determination.value.detail,
        });

        if (order.sourcing === "resale" || order.sourcing === "distributor") {
          if (invoice.accountId !== order.partnerAccountId)
            throw new Error("PARTNER_INVOICE_MERCHANT_SCOPE_MISMATCH");
          await transaction.insert(invoiceEndClientAllocations).values({
            invoiceId: invoice.id,
            orderId: order.id,
            endClientAccountId: order.accountId,
            currency: invoice.currency,
            subtotalMinor: invoice.amountMinor - invoice.taxMinor,
            taxMinor: invoice.taxMinor,
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
