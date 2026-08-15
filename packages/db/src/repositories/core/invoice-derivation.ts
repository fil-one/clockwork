import { and, desc, eq, inArray, ne } from "drizzle-orm";

import {
  deriveInvoice,
  type DerivationAllowanceAdjustment,
  type DerivationCommitmentPeriod,
  type DerivationEntitlement,
  type DerivationOrderLine,
  type DerivationSupersession,
  type DerivationUsageReconciliation,
  type InvoiceDerivation,
} from "@clockwork/domain/core";

import type { RuntimeTransaction } from "../../client";
import {
  commitmentLedgers,
  entitlements,
  invoices,
  orderLines,
  orders,
} from "../../schema";
import {
  amendmentLineSupersessions,
  commitmentAllowanceAdjustments,
  commitmentPeriods,
  orderLineSnapshots,
  quoteSnapshots,
  usageReconciliations,
} from "../../schema/core/finance";

/**
 * The reader is the only route the application layer has to a derivation, so
 * the shapes it returns travel with it. `apps/web` depends on the database
 * package, not on the domain package.
 */
export type {
  DerivationFact,
  DerivationNote,
  DerivationNoteCode,
  DerivationStep,
  DerivationStepKey,
  InvoiceDerivation,
  InvoiceDerivationLine,
} from "@clockwork/domain/core";

export class InvoiceDerivationError extends Error {
  public constructor(
    public readonly code:
      "INVOICE_NOT_FOUND" | "ORDER_NOT_FOUND" | "LIMIT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "InvoiceDerivationError";
  }
}

function instant(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

const MAXIMUM_ACCOUNT_DERIVATIONS = 25;

/**
 * The account's issued invoices, newest first. Drafts are excluded: they carry
 * no provider binding, so there is no billed amount to explain yet.
 */
export async function loadAccountInvoiceDerivations(
  transaction: RuntimeTransaction,
  accountId: string,
  limit = 5,
): Promise<readonly InvoiceDerivation[]> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new InvoiceDerivationError(
      "LIMIT_INVALID",
      "Derivation limit must be a positive integer",
    );
  const rows = await transaction
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.accountId, accountId), ne(invoices.status, "draft")))
    .orderBy(desc(invoices.createdAt))
    .limit(Math.min(limit, MAXIMUM_ACCOUNT_DERIVATIONS));
  const derivations: InvoiceDerivation[] = [];
  for (const row of rows)
    derivations.push(await loadInvoiceDerivation(transaction, row.id));
  return derivations;
}

/**
 * Reads every persisted input behind one invoice and hands them to the domain
 * assembler. Row visibility is whatever the surrounding transaction already
 * grants: the reader adds no filter of its own, so an account a caller cannot
 * see returns no invoice rather than a redacted derivation.
 */
export async function loadInvoiceDerivation(
  transaction: RuntimeTransaction,
  invoiceId: string,
): Promise<InvoiceDerivation> {
  const invoice = await transaction.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
  });
  if (!invoice)
    throw new InvoiceDerivationError(
      "INVOICE_NOT_FOUND",
      "Invoice was not found",
    );
  const order = await transaction.query.orders.findFirst({
    where: eq(orders.id, invoice.orderId),
  });
  if (!order)
    throw new InvoiceDerivationError(
      "ORDER_NOT_FOUND",
      "Invoice order was not found",
    );

  const lineRows = await transaction.query.orderLines.findMany({
    where: eq(orderLines.orderId, order.id),
  });
  const lineIds = lineRows.map((line) => line.id);

  const [
    quoteSnapshot,
    snapshotRows,
    entitlementRows,
    ledgerRows,
    supersessionRows,
  ] = await Promise.all([
    transaction.query.quoteSnapshots.findFirst({
      where: eq(quoteSnapshots.quoteId, order.quoteId),
    }),
    lineIds.length
      ? transaction.query.orderLineSnapshots.findMany({
          where: inArray(orderLineSnapshots.orderLineId, lineIds),
        })
      : [],
    lineIds.length
      ? transaction.query.entitlements.findMany({
          where: inArray(entitlements.orderLineId, lineIds),
        })
      : [],
    lineIds.length
      ? transaction.query.commitmentLedgers.findMany({
          where: inArray(commitmentLedgers.orderLineId, lineIds),
        })
      : [],
    lineIds.length
      ? transaction.query.amendmentLineSupersessions.findMany({
          where: inArray(
            amendmentLineSupersessions.supersededOrderLineId,
            lineIds,
          ),
        })
      : [],
  ]);

  const ledgerIds = ledgerRows.map((ledger) => ledger.id);
  const entitlementIds = entitlementRows.map((entitlement) => entitlement.id);
  const [periodRows, adjustmentRows, reconciliationRows] = await Promise.all([
    ledgerIds.length
      ? transaction.query.commitmentPeriods.findMany({
          where: inArray(commitmentPeriods.ledgerId, ledgerIds),
        })
      : [],
    ledgerIds.length
      ? transaction.query.commitmentAllowanceAdjustments.findMany({
          where: inArray(commitmentAllowanceAdjustments.ledgerId, ledgerIds),
        })
      : [],
    entitlementIds.length
      ? transaction.query.usageReconciliations.findMany({
          where: inArray(usageReconciliations.entitlementId, entitlementIds),
        })
      : [],
  ]);

  const snapshotByLine = new Map(
    snapshotRows.map((snapshot) => [snapshot.orderLineId, snapshot]),
  );
  const orderLineByLedger = new Map(
    ledgerRows.map((ledger) => [ledger.id, ledger.orderLineId]),
  );

  return deriveInvoice({
    invoice: {
      id: invoice.id,
      reference: invoice.stripeInvoiceId ?? invoice.id,
      orderId: invoice.orderId,
      accountId: invoice.accountId,
      currency: invoice.currency,
      amountMinor: invoice.amountMinor.toString(),
      // Gross since 001392. The lines this derivation sums are all net, so the
      // tax has to travel with the amount or the variance is just the tax.
      taxMinor: invoice.taxMinor.toString(),
      status: invoice.status,
      issuedAt: instant(invoice.createdAt),
    },
    order: {
      id: order.id,
      reference: order.id,
      accountId: order.accountId,
      quoteId: order.quoteId,
      status: order.status,
      serviceStartsOn: order.serviceStartsOn,
      serviceEndsOn: order.serviceEndsOn,
    },
    orderLines: lineRows.map((line): DerivationOrderLine => {
      const snapshot = snapshotByLine.get(line.id);
      return {
        id: line.id,
        sku: line.sku,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor.toString(),
        overageRateMinor: line.overageRateMinor.toString(),
        supersededByAmendmentId: line.supersededByAmendmentId,
        snapshotHash: snapshot?.snapshotHash ?? null,
        snapshotCapturedAt: instant(snapshot?.createdAt ?? null),
      };
    }),
    quoteSnapshot: quoteSnapshot
      ? {
          quoteId: quoteSnapshot.quoteId,
          revision: quoteSnapshot.revision,
          snapshotHash: quoteSnapshot.snapshotHash,
          issuedAt: quoteSnapshot.issuedAt.toISOString(),
        }
      : null,
    entitlements: entitlementRows.map((entitlement): DerivationEntitlement => ({
      id: entitlement.id,
      orderLineId: entitlement.orderLineId,
      sku: entitlement.sku,
      committedQuantity: entitlement.committedQuantity,
      region: entitlement.region,
      status: entitlement.status,
      activatedAt: instant(entitlement.activatedAt),
    })),
    usageReconciliations: reconciliationRows.map(
      (reconciliation): DerivationUsageReconciliation => ({
        id: reconciliation.id,
        entitlementId: reconciliation.entitlementId,
        periodStartsAt: reconciliation.periodStartsAt.toISOString(),
        periodEndsAt: reconciliation.periodEndsAt.toISOString(),
        sourceSystem: reconciliation.sourceSystem,
        sourceQuantity: reconciliation.sourceQuantity,
        ledgerQuantity: reconciliation.ledgerQuantity,
        varianceQuantity: reconciliation.varianceQuantity,
        status: reconciliation.status,
        resolution: reconciliation.resolution,
      }),
    ),
    commitmentPeriods: periodRows.flatMap(
      (period): DerivationCommitmentPeriod[] => {
        const orderLineId = orderLineByLedger.get(period.ledgerId);
        if (!orderLineId) return [];
        return [
          {
            id: period.id,
            ledgerId: period.ledgerId,
            orderLineId,
            sequence: period.sequence,
            startsAt: period.startsAt.toISOString(),
            endsAt: period.endsAt.toISOString(),
            allowanceQuantity: period.allowanceQuantity,
            consumedQuantity: period.consumedQuantity ?? "0",
            overageQuantity: period.overageQuantity ?? "0",
            contractedOverageRateMinor:
              period.contractedOverageRateMinor.toString(),
            status: period.status,
          },
        ];
      },
    ),
    allowanceAdjustments: adjustmentRows.map(
      (adjustment): DerivationAllowanceAdjustment => ({
        id: adjustment.id,
        ledgerId: adjustment.ledgerId,
        periodId: adjustment.periodId,
        effectiveAt: adjustment.effectiveAt.toISOString(),
        quantityDelta: adjustment.quantityDelta,
        reason: adjustment.reason,
        sourceReference: adjustment.sourceReference,
      }),
    ),
    supersessions: supersessionRows.map(
      (supersession): DerivationSupersession => ({
        id: supersession.id,
        amendmentId: supersession.amendmentId,
        supersededOrderLineId: supersession.supersededOrderLineId,
        effectiveOn: supersession.effectiveOn,
        netQuantityDelta: supersession.netQuantityDelta,
        netRevenueDeltaMinor: supersession.netRevenueDeltaMinor.toString(),
      }),
    ),
  });
}
