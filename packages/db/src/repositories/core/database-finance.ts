import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  ids,
  MoneySchema,
  uuidV7,
  type Actor,
  type EntityName,
} from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import {
  accrueCommission,
  acceptOrder,
  approveQuoteException,
  createAmendment,
  createQuoteDraft,
  creditAmount,
  dunningDecision,
  evaluateRegistration,
  expireQuote,
  issueQuote,
  merchantOfRecord,
  normalizeDomain,
  normalizeLegalName,
  priceQuote,
  registerDeal,
  redactPartnerQuoteData,
  validateCommitmentContract,
} from "@clockwork/domain/core";
import type {
  AccountCommercialRecord,
  AcceptedOrder,
  DealRegistration,
  GoverningAgreement,
  PriceBook,
  PricedQuoteLine,
  QuoteSnapshot,
  WhiteLabelMetadata,
} from "@clockwork/domain/core";
import {
  accounts,
  agreements,
  amendments,
  commerceUsers,
  commissionAccruals,
  commitmentEntries,
  commitmentLedgers,
  creditNotes,
  dealRegistrations,
  disputeCases,
  entitlements,
  invoices,
  orderLines,
  orders,
  payments,
  priceBooks,
  procurementProfiles,
  quoteLines,
  quotes,
  rateCards,
  refunds,
  reportExports,
  usageEvents,
  webhookEvents,
  workflowRuns,
} from "../../schema";
import {
  accountCommercialProfiles,
  billingPolicies,
  collectionActions,
  collectionCases,
  commitmentAllowanceAdjustments,
  commitmentPeriods,
  orderCommercialProfiles,
  orderLineSnapshots,
  quoteCommercialProfiles,
  quoteSnapshots,
  usageReconciliations,
  dealRegistrationExclusions,
} from "../../schema/core/finance";
import { lifecycleIdempotencyRecords } from "../../schema/lifecycle/platform";
import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import { createAcceptedOrderProvisioningAttempt } from "../lifecycle/accepted-order-provisioning";
import {
  amendmentArtifactDefinition,
  orderArtifactDefinition,
  persistCommercialArtifactRequest,
  quoteArtifactDefinition,
} from "./artifact-definitions";
import { assertCommercialArtifactBinding } from "./commercial-artifacts";
import {
  applyCommitmentDecision,
  ingestUsageEvents,
  reconcileLedgerToSource,
  replayCommitmentLedger,
  type LedgerTrailCorrection,
} from "./commitments";
import { CoreFinanceRepository, coreSnapshotHash } from "./finance";
import { z } from "zod";

type JsonRecord = Record<string, unknown>;
type CoreCapabilityKey =
  "new_business" | "legal" | "billing" | "partner" | "marketplace" | "teardown";

export const databaseCoreResourceNames = [
  "accounts",
  "procurement_profiles",
  "price_books",
  "quotes",
  "orders",
  "amendments",
  "commitments",
  "invoices",
  "credit_notes",
  "refunds",
  "disputes",
  "deal_registrations",
  "commissions",
  "accounting_exports",
  "marketplace_reconciliations",
  "reports",
] as const;
export type DatabaseCoreResourceName =
  (typeof databaseCoreResourceNames)[number];

export interface DatabaseCoreRecord {
  id: string;
  resource: DatabaseCoreResourceName;
  accountId?: string;
  rowVersion: number;
  data: JsonRecord;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseCoreMutation {
  resource: DatabaseCoreResourceName;
  id: string;
  accountId?: string;
  action: string;
  expectedVersion?: number;
  payload: JsonRecord;
  actor: Actor;
  authorization: AuthorizationContext;
  requestId: string;
  idempotencyKey: string;
  occurredAt: string;
}

export interface DatabaseCoreMutationResult {
  record: DatabaseCoreRecord;
  auditEventId: string;
  outboxMessageId: string;
}

export interface DatabaseCoreListInput {
  resource: DatabaseCoreResourceName;
  accountId?: string;
  cursor?: string;
  limit: number;
  authorization: AuthorizationContext;
}

export const databaseCoreReportNames = [
  "revenue_forecast",
  "capacity_planning",
  "renewal_churn_exposure",
  "partner_performance",
  "funnel_cycle_time",
  "margin_poc_cost",
  "three_way_tie_out",
  "weekly_scorecard",
] as const;
export type DatabaseCoreReportName = (typeof databaseCoreReportNames)[number];

export interface DatabaseCoreReportInput {
  report: DatabaseCoreReportName;
  accountId?: string;
  cursor?: string;
  limit: number;
  authorization: AuthorizationContext;
}

export type DatabaseCoreErrorCode =
  "NOT_FOUND" | "VERSION_CONFLICT" | "DUPLICATE" | "INVALID_STATE";

export class DatabaseCoreError extends Error {
  public constructor(
    public readonly code: DatabaseCoreErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type CoreResourceName = DatabaseCoreResourceName;
type CoreRecord = DatabaseCoreRecord;
type CoreMutation = DatabaseCoreMutation;
type CoreMutationResult = DatabaseCoreMutationResult;
type CoreListInput = DatabaseCoreListInput;
const CoreServiceError = DatabaseCoreError;

interface CoreFinanceService {
  mutate(input: DatabaseCoreMutation): Promise<DatabaseCoreMutationResult>;
  list(input: DatabaseCoreListInput): Promise<{
    items: DatabaseCoreRecord[];
    nextCursor: string | null;
  }>;
  report(input: DatabaseCoreReportInput): Promise<{
    items: DatabaseCoreRecord[];
    nextCursor: string | null;
  }>;
  replay(input: {
    provider: string;
    eventId: string;
    actor: Actor;
    requestId: string;
  }): Promise<{ replayed: boolean; workflowRunId: string }>;
}

interface DealRegistrationDecisionContext {
  partner: AccountCommercialRecord;
  endClient: AccountCommercialRecord;
  houseAccountIds: ReadonlySet<string>;
  priorActiveDeals: readonly {
    endClientAccountId: string;
    workload: string;
  }[];
}

interface QuoteCommercialContext {
  buyer: AccountCommercialRecord;
  buyerScreeningStatus: string;
  partner?: AccountCommercialRecord;
  partnerScreeningStatus?: string;
  registration?: {
    id: string;
    partnerAccountId: string;
    endClientAccountId: string;
    status: string;
    protectionStartsAt: Date;
    protectionEndsAt: Date;
  };
}

interface OrderAcceptanceContext {
  quote: typeof quotes.$inferSelect;
  snapshot: QuoteSnapshot;
  buyer: AccountCommercialRecord;
  partner?: AccountCommercialRecord;
  buyerAgreement: GoverningAgreement;
  partnerAgreement?: GoverningAgreement;
  dealRegistrationId?: string;
  reviewOwnerUserId: string;
}

type CommissionSourceType =
  "payment" | "credit_note" | "credit_note_void" | "refund" | "dispute";

type CommissionSourceContext =
  | {
      existing: typeof commissionAccruals.$inferSelect;
    }
  | {
      existing?: never;
      sourceType: CommissionSourceType;
      sourceId: string;
      eventType:
        | "payment"
        | "credit_note"
        | "credit_note_void"
        | "refund"
        | "chargeback";
      invoiceId: string;
      partnerAccountId: string;
      occurredAt: string;
      currency: "USD" | "EUR" | "GBP";
      amountMinor: string;
      agreementType: "referral";
      rateBps: number;
      holdbackBps: number;
      adjustmentSourceId?: string;
    };

const JsonRecordSchema = z.record(z.string(), z.unknown());
const CoreMutationResultSchema = z.object({
  record: z.object({
    id: z.string(),
    resource: z.enum(databaseCoreResourceNames),
    accountId: z.string().optional(),
    rowVersion: z.number().int().positive(),
    data: JsonRecordSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  auditEventId: z.string(),
  outboxMessageId: z.string(),
});
const CurrencySchema = z.enum(["USD", "EUR", "GBP"]);
const CommercialRoleSchema = z.enum(["direct_client", "partner", "end_client"]);
const OrderAcceptanceReservationSchema = z.object({
  order_id: z.uuid(),
  decision: z.enum(["approved", "rejected", "released"]),
  reason: z.string().min(1),
  review_case_id: z.uuid().nullable(),
});

function parsedMoney(currency: unknown, minor: string) {
  return MoneySchema.parse({ currency, minor });
}

function whiteLabelMetadata(
  input: z.output<typeof QuoteSnapshotSchema.shape.whiteLabel>,
): WhiteLabelMetadata | undefined {
  if (!input) return undefined;
  return {
    displayName: input.displayName,
    commercialContactEmail: input.commercialContactEmail,
    ...(input.logoDocumentId ? { logoDocumentId: input.logoDocumentId } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    ...(input.footer ? { footer: input.footer } : {}),
  };
}
const QuoteLineSnapshotSchema = z.object({
  id: z.uuid(),
  rateCardId: z.uuid(),
  sku: z.string().min(1),
  region: z.string().min(1),
  unit: z.string().min(1),
  approvedClaim: z.string().min(1),
  quantity: z.string().regex(/^(0|[1-9]\d*)(?:\.\d+)?$/),
  termMonths: z.number().int().positive(),
  unitPrice: MoneySchema,
  listUnitPrice: MoneySchema,
  floorPrice: MoneySchema.optional(),
  overageRate: MoneySchema,
  lineTotal: MoneySchema,
  discountBps: z.number().int().min(0).max(10_000),
  commitType: z.enum(["period_allowance", "term_drawdown"]),
  stripeTaxCode: z.string().min(1),
  qboIncomeAccount: z.string().min(1),
  marginResult: z.enum(["not_configured", "pass", "exception_required"]),
  discountCeilingBps: z.number().int().min(0).max(10_000).optional(),
  marginImpact: MoneySchema.optional(),
});
const QuoteSnapshotSchema = z.object({
  id: z.uuid(),
  seriesId: z.uuid(),
  revision: z.number().int().positive(),
  previousRevisionId: z.uuid().optional(),
  accountId: z.uuid(),
  endClientAccountId: z.uuid().optional(),
  partnerAccountId: z.uuid().optional(),
  priceBook: z.object({ id: z.uuid(), version: z.number().int().positive() }),
  route: z.enum(["direct", "referral", "resale", "distributor", "marketplace"]),
  status: z.enum([
    "draft",
    "issued",
    "accepted",
    "expired",
    "superseded",
    "rejected",
  ]),
  lines: z.array(QuoteLineSnapshotSchema).min(1),
  total: MoneySchema,
  partnerResaleTotal: MoneySchema.optional(),
  marginResult: z.enum([
    "not_configured",
    "pass",
    "exception_required",
    "approved",
    "rejected",
  ]),
  exceptionReasons: z.array(z.string()),
  exceptionDecision: z
    .object({
      actorId: z.string(),
      reason: z.string(),
      decidedAt: z.iso.datetime(),
    })
    .optional(),
  expiresAt: z.iso.datetime(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  issuedAt: z.iso.datetime().optional(),
  immutableSnapshot: z.string().optional(),
  renderedDocumentId: z.uuid().optional(),
  partnerDocumentId: z.uuid().optional(),
  whiteLabel: z
    .object({
      displayName: z.string(),
      logoDocumentId: z.uuid().optional(),
      accentColor: z.string().optional(),
      commercialContactEmail: z.email(),
      footer: z.string().optional(),
    })
    .optional(),
});
const QuoteCreateCommandSchema = z.object({
  priceBookId: z.uuid(),
  seriesId: z.uuid(),
  route: z.enum(["direct", "referral", "resale", "distributor", "marketplace"]),
  endClientAccountId: z.uuid().optional(),
  partnerAccountId: z.uuid().optional(),
  lines: z
    .array(
      z.object({
        lineId: z.uuid().optional(),
        sku: z.string().min(1),
        region: z.string().min(1),
        quantity: z.string(),
        termMonths: z.number().int().positive(),
        discountBps: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .min(1),
  partnerTier: z.string().optional(),
  marketplaceProvider: z.enum(["aws", "azure", "gcp"]).optional(),
  partnerResaleTotal: MoneySchema.optional(),
  expiresAt: z.iso.datetime(),
  whiteLabel: QuoteSnapshotSchema.shape.whiteLabel,
});
const OrderLineSnapshotSchema = z.object({
  id: z.string().min(1),
  quoteLineId: z.string().min(1),
  sku: z.string().min(1),
  region: z.string().min(1),
  quantity: z.string(),
  termMonths: z.number().int().positive(),
  unitPrice: MoneySchema,
  overageRate: MoneySchema,
  lineTotal: MoneySchema,
  commitType: z.enum(["period_allowance", "term_drawdown"]),
  stripeTaxCode: z.string().min(1),
  qboIncomeAccount: z.string().min(1),
  supersededByAmendmentId: z.string().optional(),
});
const AmendmentInputSchema = z.object({
  id: z.string().min(1),
  order: z.object({ id: z.uuid() }),
  effectiveOn: z.iso.date(),
  kind: z.enum([
    "upgrade",
    "downgrade",
    "term_extension",
    "co_termination",
    "mixed",
  ]),
  prorationMethod: z.enum(["daily", "monthly", "none"]),
  deltas: z.array(
    z.object({
      orderLineId: z.string().optional(),
      sku: z.string().min(1),
      quantityDelta: z.string(),
      fullPeriodPriceDelta: MoneySchema,
    }),
  ),
  newServiceEndsOn: z.iso.date().optional(),
  documentId: z.uuid().optional(),
  acceptedAt: z.iso.datetime(),
});
const OrderCreateCommandSchema = z
  .object({
    quoteId: z.uuid(),
    signerUserId: z.uuid(),
    authorityTitle: z.string().min(1),
    authorityAttested: z.literal(true),
    poNumber: z.string().optional(),
    poDocumentId: z.uuid().optional(),
    serviceStartsOn: z.iso.date(),
    serviceEndsOn: z.iso.date().optional(),
    coTerminateOn: z.iso.date().optional(),
    noticeOn: z.iso.date().optional(),
    acceptedAt: z.iso.datetime(),
    orderFormDocumentId: z.uuid(),
    orderLineIds: z.array(z.uuid()).min(1),
  })
  .strict();
const OrderArtifactCommandSchema = OrderCreateCommandSchema.omit({
  orderFormDocumentId: true,
})
  .extend({ retainUntil: z.iso.datetime({ offset: true }) })
  .strict();
const ArtifactPreparationSchema = z.object({
  audience: z.enum(["end_client", "partner"]),
  issuedAt: z.iso.datetime({ offset: true }),
  retainUntil: z.iso.datetime({ offset: true }),
});
const ReportExportCreateCommandSchema = z
  .object({
    reportType: z.enum([
      "revenue_forecast",
      "capacity_planning",
      "renewal_churn_exposure",
      "partner_performance",
      "funnel_cycle_time",
      "margin_poc_cost",
      "weekly_scorecard",
    ]),
    asOf: z.iso.datetime({ offset: true }),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    accountId: z.uuid().optional(),
    partnerAccountId: z.uuid().optional(),
    requestedColumns: z.array(z.string().min(1).max(255)).max(250).optional(),
    costIngestionComplete: z.boolean().default(false),
    retainUntil: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to)
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Report range must not end before it starts",
      });
    if (Date.parse(value.retainUntil) <= Date.parse(value.asOf))
      context.addIssue({
        code: "custom",
        path: ["retainUntil"],
        message: "Report retention must follow its as-of time",
      });
  });
const CommissionSourceCommandSchema = z
  .object({
    sourceType: z.enum([
      "payment",
      "credit_note",
      "credit_note_void",
      "refund",
      "chargeback",
    ]),
    sourceId: z.uuid(),
  })
  .strict();
const CreditNoteIssueCommandSchema = z
  .object({
    invoiceId: z.uuid(),
    amount: MoneySchema,
    providerReason: z.enum([
      "duplicate",
      "fraudulent",
      "order_change",
      "product_unsatisfactory",
    ]),
    internalReasonCode: z.string().min(3).max(120),
  })
  .strict();
const RefundSubmitCommandSchema = z
  .object({
    paymentId: z.uuid(),
    amount: MoneySchema,
    providerReason: z.enum([
      "duplicate",
      "fraudulent",
      "requested_by_customer",
    ]),
    internalReasonCode: z.string().min(3).max(120),
  })
  .strict();
const DisputeCreateCommandSchema = z
  .object({
    paymentId: z.uuid(),
    stripeDisputeId: z.string().regex(/^dp_[A-Za-z0-9_]+$/),
    amount: MoneySchema,
    evidenceDueAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const DunningCommandSchema = z.object({}).strict();

/** Canonical numeric(38,18) quantity strings; never a float. */
const QuantitySchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/);
const SignedQuantitySchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/);
const CommitmentPeriodInputSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    allowanceQuantity: QuantitySchema,
  })
  .strict();
const CommitmentCreateCommandSchema = z
  .object({
    orderId: z.uuid(),
    orderLineId: z.uuid(),
    commitType: z.enum(["period_allowance", "term_drawdown"]),
    contractualTimeZone: z.string().min(1).max(80),
    periods: z.array(CommitmentPeriodInputSchema).min(1).max(120),
  })
  .strict();
const CommitmentUsageCommandSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            externalEventId: z.string().min(1).max(255),
            measuredAt: z.iso.datetime({ offset: true }),
            quantity: QuantitySchema,
            meter: z.string().min(1).max(120),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
const CommitmentCorrectionCommandSchema = z
  .object({
    externalEventId: z.string().min(1).max(255),
    correctsExternalEventId: z.string().min(1).max(255),
    measuredAt: z.iso.datetime({ offset: true }),
    quantityDelta: SignedQuantitySchema,
    meter: z.string().min(1).max(120),
    reasonCode: z.string().min(3).max(120),
    sourceReference: z.string().min(1).max(255),
  })
  .strict();
const CommitmentAllowanceCommandSchema = z
  .object({
    effectiveAt: z.iso.datetime({ offset: true }),
    quantityDelta: SignedQuantitySchema,
    reason: z.enum(["amendment", "renewal", "correction"]),
    sourceReference: z.string().min(1).max(255),
    periodId: z.uuid().optional(),
  })
  .strict();
const CommitmentRenewCommandSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    allowanceQuantity: QuantitySchema,
    sourceReference: z.string().min(1).max(255),
  })
  .strict();
const CommitmentReconcileCommandSchema = z
  .object({
    sourceSystem: z.string().min(1).max(120),
    records: z
      .array(
        z
          .object({
            externalEventId: z.string().min(1).max(255),
            quantity: QuantitySchema,
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();

function pricedQuoteLine(
  input: z.output<typeof QuoteLineSnapshotSchema>,
): PricedQuoteLine {
  return {
    id: input.id,
    rateCardId: input.rateCardId,
    sku: input.sku,
    region: input.region,
    unit: input.unit,
    approvedClaim: input.approvedClaim,
    quantity: input.quantity,
    termMonths: input.termMonths,
    unitPrice: input.unitPrice,
    listUnitPrice: input.listUnitPrice,
    ...(input.floorPrice ? { floorPrice: input.floorPrice } : {}),
    overageRate: input.overageRate,
    lineTotal: input.lineTotal,
    discountBps: input.discountBps,
    commitType: input.commitType,
    stripeTaxCode: input.stripeTaxCode,
    qboIncomeAccount: input.qboIncomeAccount,
    marginResult: input.marginResult,
    ...(input.discountCeilingBps === undefined
      ? {}
      : { discountCeilingBps: input.discountCeilingBps }),
    ...(input.marginImpact ? { marginImpact: input.marginImpact } : {}),
  };
}

function quoteSnapshot(value: unknown): QuoteSnapshot {
  const input = QuoteSnapshotSchema.parse(value);
  const whiteLabel = whiteLabelMetadata(input.whiteLabel);
  return {
    id: input.id,
    seriesId: input.seriesId,
    revision: input.revision,
    ...(input.previousRevisionId
      ? { previousRevisionId: input.previousRevisionId }
      : {}),
    accountId: input.accountId,
    ...(input.endClientAccountId
      ? { endClientAccountId: input.endClientAccountId }
      : {}),
    ...(input.partnerAccountId
      ? { partnerAccountId: input.partnerAccountId }
      : {}),
    priceBook: input.priceBook,
    route: input.route,
    status: input.status,
    lines: input.lines.map(pricedQuoteLine),
    total: input.total,
    ...(input.partnerResaleTotal
      ? { partnerResaleTotal: input.partnerResaleTotal }
      : {}),
    marginResult: input.marginResult,
    exceptionReasons: input.exceptionReasons,
    ...(input.exceptionDecision
      ? { exceptionDecision: input.exceptionDecision }
      : {}),
    expiresAt: input.expiresAt,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
    ...(input.immutableSnapshot
      ? { immutableSnapshot: input.immutableSnapshot }
      : {}),
    ...(input.renderedDocumentId
      ? { renderedDocumentId: input.renderedDocumentId }
      : {}),
    ...(input.partnerDocumentId
      ? { partnerDocumentId: input.partnerDocumentId }
      : {}),
    ...(whiteLabel ? { whiteLabel } : {}),
  };
}

function acceptedOrder(value: AcceptedOrder): AcceptedOrder {
  return {
    id: value.id,
    quoteId: value.quoteId,
    quoteRevision: value.quoteRevision,
    agreementId: value.agreementId,
    agreementVersion: value.agreementVersion,
    buyerAgreementId: value.buyerAgreementId,
    buyerAgreementVersion: value.buyerAgreementVersion,
    ...(value.partnerAgreementId
      ? { partnerAgreementId: value.partnerAgreementId }
      : {}),
    ...(value.partnerAgreementVersion
      ? { partnerAgreementVersion: value.partnerAgreementVersion }
      : {}),
    accountId: value.accountId,
    invoicingAccountId: value.invoicingAccountId,
    ...(value.partnerAccountId
      ? { partnerAccountId: value.partnerAccountId }
      : {}),
    merchantOfRecord: value.merchantOfRecord,
    sourcing: value.sourcing,
    ...(value.poNumber ? { poNumber: value.poNumber } : {}),
    ...(value.poDocumentId ? { poDocumentId: value.poDocumentId } : {}),
    signerUserId: value.signerUserId,
    authorityTitle: value.authorityTitle,
    authorityAttested: true,
    status: value.status,
    serviceStartsOn: value.serviceStartsOn,
    ...(value.serviceEndsOn ? { serviceEndsOn: value.serviceEndsOn } : {}),
    ...(value.noticeOn ? { noticeOn: value.noticeOn } : {}),
    lines: value.lines.map((line) => ({
      id: line.id,
      quoteLineId: line.quoteLineId,
      sku: line.sku,
      region: line.region,
      quantity: line.quantity,
      termMonths: line.termMonths,
      unitPrice: line.unitPrice,
      overageRate: line.overageRate,
      lineTotal: line.lineTotal,
      commitType: line.commitType,
      stripeTaxCode: line.stripeTaxCode,
      qboIncomeAccount: line.qboIncomeAccount,
      ...(line.supersededByAmendmentId
        ? { supersededByAmendmentId: line.supersededByAmendmentId }
        : {}),
    })),
    acceptedAt: value.acceptedAt,
    orderFormDocumentId: value.orderFormDocumentId,
    provisioningKey: value.provisioningKey,
  };
}

async function persistedAcceptedOrder(
  transaction: RuntimeTransaction,
  orderId: string,
): Promise<AcceptedOrder> {
  const order = await transaction.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });
  if (!order || !order.orderFormDocumentId || !order.immutableAt)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Amendment requires an immutable accepted order",
    );
  const [profile, quote, lines] = await Promise.all([
    transaction.query.orderCommercialProfiles.findFirst({
      where: eq(orderCommercialProfiles.orderId, order.id),
    }),
    transaction.query.quotes.findFirst({ where: eq(quotes.id, order.quoteId) }),
    transaction.query.orderLines.findMany({
      where: eq(orderLines.orderId, order.id),
    }),
  ]);
  if (!profile || !quote || lines.length === 0)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Accepted order snapshots are incomplete",
    );
  const snapshots = await transaction.query.orderLineSnapshots.findMany({
    where: inArray(
      orderLineSnapshots.orderLineId,
      lines.map((line) => line.id),
    ),
  });
  if (snapshots.length !== lines.length)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Accepted order line snapshots are incomplete",
    );
  return acceptedOrder({
    id: order.id,
    quoteId: order.quoteId,
    quoteRevision: quote.revision,
    agreementId: order.agreementId,
    agreementVersion: profile.governingAgreementVersion,
    buyerAgreementId: profile.buyerAgreementId,
    buyerAgreementVersion: profile.buyerAgreementVersion,
    ...(profile.partnerAgreementId
      ? { partnerAgreementId: profile.partnerAgreementId }
      : {}),
    ...(profile.partnerAgreementVersion
      ? { partnerAgreementVersion: profile.partnerAgreementVersion }
      : {}),
    accountId: order.accountId,
    invoicingAccountId: order.invoicingAccountId,
    ...(order.partnerAccountId
      ? { partnerAccountId: order.partnerAccountId }
      : {}),
    merchantOfRecord: z
      .enum(["fil_one", "partner", "marketplace"])
      .parse(profile.merchantOfRecord),
    sourcing: z
      .enum(["direct", "referral", "resale", "distributor", "marketplace"])
      .parse(order.sourcing),
    ...(order.poNumber ? { poNumber: order.poNumber } : {}),
    ...(order.poDocumentId ? { poDocumentId: order.poDocumentId } : {}),
    signerUserId: order.signerUserId,
    authorityTitle: order.authorityTitle,
    authorityAttested: true,
    status: z
      .enum([
        "accepted",
        "provisioning",
        "active",
        "amended",
        "completed",
        "cancelled",
        "terminated",
      ])
      .parse(order.status),
    serviceStartsOn: order.serviceStartsOn,
    ...(order.serviceEndsOn ? { serviceEndsOn: order.serviceEndsOn } : {}),
    ...(order.noticeOn ? { noticeOn: order.noticeOn } : {}),
    lines: snapshots
      .map((snapshot) => {
        const line = OrderLineSnapshotSchema.parse(snapshot.snapshot);
        const { supersededByAmendmentId, ...persisted } = line;
        return {
          ...persisted,
          ...(supersededByAmendmentId ? { supersededByAmendmentId } : {}),
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
    acceptedAt: profile.acceptedAt.toISOString(),
    orderFormDocumentId: order.orderFormDocumentId,
    provisioningKey: profile.provisioningIdempotencyKey,
  });
}

export interface DatabaseCoreFinanceRepositoryOptions {
  database: RuntimeDatabase;
  pricingDatabase: RuntimeDatabase;
  authorizationSecret: string;
  now?: () => Date;
}

function object(value: unknown, name = "payload"): JsonRecord {
  const parsed = JsonRecordSchema.safeParse(value);
  if (!parsed.success)
    throw new CoreServiceError("INVALID_STATE", `${name} must be an object`);
  return parsed.data;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new CoreServiceError("INVALID_STATE", `${name} is required`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return string(value, name);
}

function integer(value: unknown, name: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new CoreServiceError("INVALID_STATE", `${name} must be an integer`);
  return value;
}

function date(value: unknown, name: string): Date {
  const result = new Date(string(value, name));
  if (!Number.isFinite(result.valueOf()))
    throw new CoreServiceError("INVALID_STATE", `${name} is invalid`);
  return result;
}

function json(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(json);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, json(item)]),
    );
  return value;
}

function coreRecord(
  resource: CoreResourceName,
  row: JsonRecord,
  accountId?: string,
): CoreRecord {
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date();
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : createdAt;
  return {
    id: string(row.id, "record.id"),
    resource,
    ...(accountId ? { accountId } : {}),
    rowVersion:
      typeof row.rowVersion === "number"
        ? row.rowVersion
        : typeof row.version === "number"
          ? row.version
          : 1,
    data: JsonRecordSchema.parse(json(row)),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

function artifactRequestResult(
  input: CoreMutation,
  source: JsonRecord,
  prepared: Awaited<ReturnType<typeof persistCommercialArtifactRequest>>,
): CoreMutationResult {
  const record = coreRecord(input.resource, source, input.accountId);
  return {
    record: {
      ...record,
      data: JsonRecordSchema.parse({
        ...record.data,
        artifactRequest: prepared.request,
      }),
    },
    auditEventId: prepared.auditEventId,
    outboxMessageId: prepared.outboxMessageId,
  };
}

const entityByResource: Record<CoreResourceName, EntityName> = {
  accounts: "account",
  procurement_profiles: "procurement_profile",
  price_books: "price_book",
  quotes: "quote",
  orders: "order",
  amendments: "amendment",
  commitments: "commitment_ledger",
  invoices: "invoice",
  credit_notes: "credit_note",
  refunds: "refund",
  disputes: "dispute_case",
  deal_registrations: "deal_registration",
  commissions: "commission_accrual",
  accounting_exports: "report_export",
  marketplace_reconciliations: "report_export",
  reports: "report_export",
};

async function audited(
  transaction: RuntimeTransaction,
  input: CoreMutation,
  record: CoreRecord,
  before?: JsonRecord,
  auditAggregate?: {
    type: EntityName;
    id: string;
    version: number;
  },
): Promise<CoreMutationResult> {
  const result = await appendAuditAndOutbox(transaction, {
    ...(record.accountId ? { accountId: record.accountId } : {}),
    aggregateType: auditAggregate?.type ?? entityByResource[input.resource],
    aggregateId: auditAggregate?.id ?? record.id,
    aggregateVersion: auditAggregate?.version ?? record.rowVersion,
    eventType: `core.${input.resource}.${input.action}`,
    actor: input.actor,
    requestId: input.requestId,
    ...(before ? { before: JsonRecordSchema.parse(json(before)) } : {}),
    after: record.data,
    occurredAt: new Date(input.occurredAt),
  });
  return {
    record,
    auditEventId: result.event.id,
    outboxMessageId: result.message.id,
  };
}

function authorization(input: {
  authorization: AuthorizationContext;
  requestId?: string;
}) {
  return {
    userId: input.authorization.userId,
    accountIds: input.authorization.accountIds,
    roles: input.authorization.roles,
    isInternalStaff: input.authorization.isInternalStaff,
    requestId: input.requestId ?? uuidV7(),
  };
}

function assertFinanceApproval(input: CoreMutation): void {
  if (
    !input.authorization.isInternalStaff ||
    !input.authorization.roles.includes("finance_approver") ||
    input.actor.kind !== "user" ||
    input.actor.id !== input.authorization.userId
  )
    throw new CoreServiceError(
      "INVALID_STATE",
      "Finance approval authority is required for this operation",
    );
}

function assertBillingAccount(input: CoreMutation, accountId: string): void {
  if (input.accountId !== accountId)
    throw new CoreServiceError(
      "NOT_FOUND",
      "The billing source was not found in the requested account",
    );
}

async function accountCommercial(
  transaction: RuntimeTransaction,
  accountId: string,
): Promise<AccountCommercialRecord> {
  const account = await transaction.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  if (!account)
    throw new CoreServiceError("NOT_FOUND", "Account was not found");
  const procurement = await transaction.query.procurementProfiles.findFirst({
    where: eq(procurementProfiles.accountId, accountId),
  });
  return {
    id: account.id,
    legalName: account.legalName,
    country: account.country,
    domain: normalizeDomain(account.domain),
    roles: z
      .array(CommercialRoleSchema)
      .min(1)
      .parse(account.relationshipRoles),
    contacts: [],
    taxIds: [],
    currency: CurrencySchema.parse(account.currency),
    procurement: {
      poRequired: procurement?.poRequired ?? false,
      ...(z
        .string()
        .email()
        .safeParse(JsonRecordSchema.parse(account.apContact).email).success
        ? {
            apContactEmail: z
              .string()
              .email()
              .parse(JsonRecordSchema.parse(account.apContact).email),
          }
        : {}),
      invoiceDeliveryEmail: account.invoiceDeliveryEmail,
      supplierPortalStatus: z
        .enum([
          "not_required",
          "not_started",
          "in_progress",
          "complete",
          "blocked",
        ])
        .parse(procurement?.supplierPortalStatus ?? "not_required"),
      certificates: [],
      furnishedDocuments: [],
    },
    paymentTerms: { kind: "auto_charge" },
    rowVersion: account.rowVersion,
    ...(account.relationshipRoles.includes("partner")
      ? {
          partner: {
            agreementType:
              z
                .enum(["referral", "resale", "msp", "embedded"])
                .nullable()
                .parse(account.partnerAgreementType) ?? "referral",
            ...(account.parentPartnerId
              ? { parentPartnerId: account.parentPartnerId }
              : {}),
            creditLimit: {
              ...parsedMoney(
                CurrencySchema.parse(account.currency),
                account.aggregateCreditLimitMinor.toString(),
              ),
            },
            ...(account.partnerDiscountTier
              ? { transferTier: account.partnerDiscountTier }
              : {}),
            ...(account.commissionRateBps === null
              ? {}
              : { commissionRateBps: account.commissionRateBps }),
          },
        }
      : {}),
  };
}

function assertQuoteIdentity(
  persisted: typeof quotes.$inferSelect,
  snapshot: QuoteSnapshot,
): void {
  if (
    persisted.id !== snapshot.id ||
    persisted.accountId !== snapshot.accountId ||
    persisted.priceBookId !== snapshot.priceBook.id ||
    persisted.seriesId !== snapshot.seriesId ||
    persisted.revision !== snapshot.revision ||
    persisted.currency !== snapshot.total.currency ||
    persisted.totalMinor !== BigInt(snapshot.total.minor)
  )
    throw new CoreServiceError(
      "INVALID_STATE",
      "Quote snapshot does not match the persisted quote",
    );
}

const DiscountMatrixSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(0),
  defaultMaxDiscountBps: z.number().int().min(0).max(10_000),
  rules: z.array(
    z.object({
      id: z.string().min(1),
      sku: z.string().min(1).optional(),
      region: z.string().min(1).optional(),
      route: z
        .enum(["direct", "referral", "resale", "distributor", "marketplace"])
        .optional(),
      partnerTier: z.string().min(1).optional(),
      minTermMonths: z.number().int().positive().optional(),
      minQuantity: z.string().optional(),
      maxDiscountBps: z.number().int().min(0).max(10_000),
    }),
  ),
});

/**
 * An empty column is a book published before signed discount policy exists;
 * pricing then falls back to its conservative zero-discount ceiling. Anything
 * else must parse, so a malformed matrix surfaces instead of silently changing
 * the authority a quote is priced under.
 */
function serverDiscountMatrix(
  persisted: unknown,
): PriceBook["discountMatrix"] | undefined {
  if (
    !persisted ||
    typeof persisted !== "object" ||
    Object.keys(persisted).length === 0
  )
    return undefined;
  const matrix = DiscountMatrixSchema.parse(persisted);
  return {
    id: matrix.id,
    version: matrix.version,
    defaultMaxDiscountBps: matrix.defaultMaxDiscountBps,
    rules: matrix.rules.map((rule) => ({
      id: rule.id,
      maxDiscountBps: rule.maxDiscountBps,
      ...(rule.sku === undefined ? {} : { sku: rule.sku }),
      ...(rule.region === undefined ? {} : { region: rule.region }),
      ...(rule.route === undefined ? {} : { route: rule.route }),
      ...(rule.partnerTier === undefined
        ? {}
        : { partnerTier: rule.partnerTier }),
      ...(rule.minTermMonths === undefined
        ? {}
        : { minTermMonths: rule.minTermMonths }),
      ...(rule.minQuantity === undefined
        ? {}
        : { minQuantity: rule.minQuantity }),
    })),
  };
}

async function serverPriceBook(
  transaction: RuntimeTransaction,
  priceBookId: string,
): Promise<PriceBook> {
  const [header, persistedRates] = await Promise.all([
    transaction.query.priceBooks.findFirst({
      where: eq(priceBooks.id, priceBookId),
    }),
    transaction.query.rateCards.findMany({
      where: eq(rateCards.priceBookId, priceBookId),
    }),
  ]);
  if (!header)
    throw new CoreServiceError("NOT_FOUND", "Price book was not found");
  const currency = CurrencySchema.parse(header.currency);
  const discountMatrix = serverDiscountMatrix(header.discountMatrix);
  return {
    id: header.id,
    name: header.name,
    version: header.version,
    currency,
    effectiveFrom: header.effectiveFrom,
    ...(header.effectiveTo ? { effectiveTo: header.effectiveTo } : {}),
    status: z.enum(["draft", "active", "retired"]).parse(header.status),
    ...(discountMatrix ? { discountMatrix } : {}),
    rateCards: persistedRates.map((rate) => ({
      id: rate.id,
      sku: rate.sku,
      region: rate.region,
      unit: rate.unit,
      approvedClaim: rate.approvedClaim,
      unitPrice: parsedMoney(currency, rate.unitPriceMinor.toString()),
      ...(rate.floorPriceMinor === null
        ? {}
        : {
            floorPrice: parsedMoney(currency, rate.floorPriceMinor.toString()),
          }),
      overageRate: parsedMoney(currency, rate.overageRateMinor.toString()),
      minimumQuantity: rate.minimumQuantity,
      ...(rate.trialLimit === null ? {} : { trialLimit: rate.trialLimit }),
      egressTreatment: rate.egressTreatment,
      commitType: z
        .enum(["period_allowance", "term_drawdown"])
        .parse(rate.commitType),
      stripeTaxCode: rate.stripeTaxCode,
      qboIncomeAccount: rate.qboIncomeAccount,
      partnerTransferPrices: z
        .record(z.string(), MoneySchema)
        .parse(rate.partnerTransferPrices),
    })),
  };
}

async function persistedQuoteSnapshot(
  transaction: RuntimeTransaction,
  persisted: typeof quotes.$inferSelect,
  book: PriceBook,
): Promise<QuoteSnapshot> {
  const [lines, profile] = await Promise.all([
    transaction.query.quoteLines.findMany({
      where: eq(quoteLines.quoteId, persisted.id),
    }),
    transaction.query.quoteCommercialProfiles.findFirst({
      where: eq(quoteCommercialProfiles.quoteId, persisted.id),
    }),
  ]);
  if (!profile)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Quote commercial profile is missing",
    );
  const inputEvidence = z
    .object({
      exceptionReasons: z.array(z.string()),
      whiteLabel: QuoteSnapshotSchema.shape.whiteLabel,
      lineGuardrails: z
        .record(
          z.string(),
          z.object({
            discountCeilingBps: z.number().int().min(0).max(10_000),
            marginImpact: MoneySchema,
          }),
        )
        .optional(),
    })
    .parse(profile.pricingInputs);
  const rateById = new Map(book.rateCards.map((rate) => [rate.id, rate]));
  const snapshotLines = lines.map((line) => {
    const rate = rateById.get(line.rateCardId);
    if (!rate)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Quote line rate card is missing",
      );
    return {
      ...rate,
      id: line.id,
      rateCardId: rate.id,
      quantity: line.quantity,
      termMonths: line.termMonths,
      unitPrice: {
        ...parsedMoney(book.currency, line.unitPriceMinor.toString()),
      },
      listUnitPrice: rate.unitPrice,
      overageRate: {
        ...parsedMoney(book.currency, line.overageRateMinor.toString()),
      },
      lineTotal: {
        ...parsedMoney(book.currency, line.lineTotalMinor.toString()),
      },
      discountBps: line.discountBps,
      marginResult:
        persisted.marginFloorResult === "exception_required"
          ? ("exception_required" as const)
          : ("pass" as const),
      ...(inputEvidence.lineGuardrails?.[line.id] ?? {}),
    };
  });
  return quoteSnapshot({
    id: persisted.id,
    seriesId: persisted.seriesId,
    revision: persisted.revision,
    ...(persisted.previousRevisionId
      ? { previousRevisionId: persisted.previousRevisionId }
      : {}),
    accountId: persisted.accountId,
    ...(persisted.endClientAccountId
      ? { endClientAccountId: persisted.endClientAccountId }
      : {}),
    ...(persisted.partnerAccountId
      ? { partnerAccountId: persisted.partnerAccountId }
      : {}),
    priceBook: { id: book.id, version: book.version },
    route: profile.channelShape,
    status: persisted.status,
    lines: snapshotLines,
    total: parsedMoney(book.currency, persisted.totalMinor.toString()),
    ...(persisted.partnerResaleTotalMinor === null
      ? {}
      : {
          partnerResaleTotal: parsedMoney(
            book.currency,
            persisted.partnerResaleTotalMinor.toString(),
          ),
        }),
    marginResult: persisted.marginFloorResult,
    exceptionReasons: inputEvidence.exceptionReasons,
    expiresAt: persisted.expiresAt.toISOString(),
    createdBy: persisted.createdBy,
    createdAt: persisted.createdAt.toISOString(),
    ...(persisted.renderedDocumentId
      ? { renderedDocumentId: persisted.renderedDocumentId }
      : {}),
    ...(persisted.partnerDocumentId
      ? { partnerDocumentId: persisted.partnerDocumentId }
      : {}),
    ...(inputEvidence.whiteLabel
      ? { whiteLabel: inputEvidence.whiteLabel }
      : {}),
  });
}

async function verifyImmutablePriceBookHeader(
  transaction: RuntimeTransaction,
  snapshot: PriceBook,
  occurredAt: string,
): Promise<void> {
  const header = await transaction.query.priceBooks.findFirst({
    where: eq(priceBooks.id, snapshot.id),
  });
  const occurredOn = occurredAt.slice(0, 10);
  if (
    !header ||
    header.version !== snapshot.version ||
    header.currency !== snapshot.currency ||
    header.effectiveFrom !== snapshot.effectiveFrom ||
    header.effectiveTo !== (snapshot.effectiveTo ?? null) ||
    header.status !== "active" ||
    snapshot.status !== "active" ||
    occurredOn < header.effectiveFrom ||
    (header.effectiveTo !== null && occurredOn > header.effectiveTo)
  )
    throw new CoreServiceError(
      "INVALID_STATE",
      "Price book changed or is not active for this quote",
    );
}

interface PersistedCommissionSource {
  invoiceId: string;
  orderId: string;
  paymentId?: string;
  currency: string;
  amountMinor: bigint;
  occurredAt: string;
}

async function persistedCommissionSource(
  transaction: RuntimeTransaction,
  sourceType: CommissionSourceType,
  sourceId: string,
): Promise<PersistedCommissionSource> {
  if (sourceType === "payment") {
    const payment = await transaction.query.payments.findFirst({
      where: eq(payments.id, sourceId),
    });
    if (!payment || payment.status !== "succeeded" || !payment.receivedAt)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Collected payment source is not eligible for commission",
      );
    return {
      invoiceId: payment.invoiceId,
      orderId: payment.orderId,
      paymentId: payment.id,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      occurredAt: payment.receivedAt.toISOString(),
    };
  }
  if (sourceType === "credit_note") {
    const creditNote = await transaction.query.creditNotes.findFirst({
      where: eq(creditNotes.id, sourceId),
    });
    if (!creditNote || creditNote.status !== "issued")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Issued credit-note source is not eligible for commission clawback",
      );
    return {
      invoiceId: creditNote.invoiceId,
      orderId: creditNote.orderId,
      currency: creditNote.currency,
      amountMinor: creditNote.amountMinor,
      occurredAt: creditNote.createdAt.toISOString(),
    };
  }
  if (sourceType === "credit_note_void") {
    const creditNote = await transaction.query.creditNotes.findFirst({
      where: eq(creditNotes.id, sourceId),
    });
    if (
      !creditNote ||
      creditNote.status !== "void" ||
      !creditNote.stripeLastOccurredAt
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Only a signed voided credit note can reverse its commission clawback",
      );
    return {
      invoiceId: creditNote.invoiceId,
      orderId: creditNote.orderId,
      currency: creditNote.currency,
      amountMinor: creditNote.amountMinor,
      occurredAt: creditNote.stripeLastOccurredAt.toISOString(),
    };
  }
  if (sourceType === "refund") {
    const refund = await transaction.query.refunds.findFirst({
      where: eq(refunds.id, sourceId),
    });
    if (!refund || refund.status !== "succeeded")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Succeeded refund source is not eligible for commission clawback",
      );
    const payment = await transaction.query.payments.findFirst({
      where: eq(payments.id, refund.paymentId),
    });
    if (
      !payment ||
      payment.orderId !== refund.orderId ||
      payment.currency !== refund.currency ||
      refund.amountMinor > payment.amountMinor
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Refund source does not match its collected payment",
      );
    return {
      invoiceId: payment.invoiceId,
      orderId: refund.orderId,
      paymentId: payment.id,
      currency: refund.currency,
      amountMinor: refund.amountMinor,
      occurredAt: refund.createdAt.toISOString(),
    };
  }
  const dispute = await transaction.query.disputeCases.findFirst({
    where: eq(disputeCases.id, sourceId),
  });
  if (!dispute || dispute.status !== "lost")
    throw new CoreServiceError(
      "INVALID_STATE",
      "Lost chargeback source is not eligible for commission clawback",
    );
  const payment = await transaction.query.payments.findFirst({
    where: eq(payments.id, dispute.paymentId),
  });
  if (
    !payment ||
    payment.orderId !== dispute.orderId ||
    payment.currency !== dispute.currency ||
    dispute.amountMinor > payment.amountMinor
  )
    throw new CoreServiceError(
      "INVALID_STATE",
      "Chargeback source does not match its collected payment",
    );
  return {
    invoiceId: payment.invoiceId,
    orderId: dispute.orderId,
    paymentId: payment.id,
    currency: dispute.currency,
    amountMinor: dispute.amountMinor,
    occurredAt: dispute.updatedAt.toISOString(),
  };
}

export class DatabaseCoreFinanceRepository implements CoreFinanceService {
  private readonly now: () => Date;

  public constructor(
    private readonly options: DatabaseCoreFinanceRepositoryOptions,
  ) {
    if (options.authorizationSecret.length < 32)
      throw new Error(
        "Database authorization secret must be at least 32 bytes",
      );
    this.now = options.now ?? (() => new Date());
  }

  public async mutate(input: CoreMutation): Promise<CoreMutationResult> {
    return (await this.mutateWithReplay(input)).result;
  }

  /**
   * Execute a Core command while preserving whether the exact persisted
   * idempotency response was replayed. API callers use mutate(); durable
   * workflow joins use this metadata to recover post-commit receipt gaps.
   */
  public async mutateWithReplay(input: CoreMutation): Promise<{
    result: CoreMutationResult;
    replayed: boolean;
  }> {
    const [
      confidentialPriceBook,
      dealRegistrationContext,
      quoteCommercialContext,
      orderAcceptanceContext,
      commissionContext,
    ] = await Promise.all([
      this.loadConfidentialPriceBook(input),
      this.loadDealRegistrationContext(input),
      this.loadQuoteCommercialContext(input),
      this.loadOrderAcceptanceContext(input),
      this.loadCommissionContext(input),
    ]);
    const run = (transaction: RuntimeTransaction) =>
      this.mutateIdempotently(
        transaction,
        input,
        confidentialPriceBook,
        dealRegistrationContext,
        quoteCommercialContext,
        orderAcceptanceContext,
        commissionContext,
      );
    // The commitment ledger, its periods, and its corrections are deliberately
    // not writable by the tenant runtime role. Metering runs on the service
    // connection; the account binding of every commitment command is checked
    // against persisted order ownership rather than left to row policies.
    return input.resource === "commitments"
      ? withInternalTransaction(this.options.database, input.requestId, run)
      : withAuthorizedTransaction(
          this.options.database,
          authorization(input),
          { secret: this.options.authorizationSecret, now: this.now() },
          run,
        );
  }

  private async mutateIdempotently(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    confidentialPriceBook?: PriceBook,
    dealRegistrationContext?: DealRegistrationDecisionContext,
    quoteCommercialContext?: QuoteCommercialContext,
    orderAcceptanceContext?: OrderAcceptanceContext,
    commissionContext?: CommissionSourceContext,
  ): Promise<{ result: CoreMutationResult; replayed: boolean }> {
    const key = z.string().min(16).max(255).parse(input.idempotencyKey);
    const ownerUserId = input.authorization.userId;
    const scope = `core:${input.resource}`;
    const requestHash = coreSnapshotHash({
      resource: input.resource,
      id: input.id,
      accountId: input.accountId,
      action: input.action,
      expectedVersion: input.expectedVersion,
      payload: input.payload,
    });
    const claimed = await this.claimUserIdempotency(
      transaction,
      ownerUserId,
      scope,
      key,
      requestHash,
    );
    if (claimed.kind === "conflict")
      throw new CoreServiceError(
        "DUPLICATE",
        "Idempotency key was already used for a different core command",
      );
    if (claimed.kind === "in_progress")
      throw new CoreServiceError(
        "DUPLICATE",
        "Idempotent core command is already in progress",
      );
    if (claimed.kind === "replay") {
      const parsed = CoreMutationResultSchema.parse(claimed.responseBody);
      const { accountId, ...record } = parsed.record;
      return {
        result: {
          ...parsed,
          record: { ...record, ...(accountId ? { accountId } : {}) },
        },
        replayed: true,
      };
    }

    await this.assertPersistedCapabilities(
      transaction,
      input,
      orderAcceptanceContext,
    );

    const response = await this.mutateInTransaction(
      transaction,
      input,
      confidentialPriceBook,
      dealRegistrationContext,
      quoteCommercialContext,
      orderAcceptanceContext,
      commissionContext,
    );
    const [completed] = await transaction
      .update(lifecycleIdempotencyRecords)
      .set({
        responseStatus: 200,
        responseBody: response,
        completedAt: this.now(),
      })
      .where(
        and(
          eq(lifecycleIdempotencyRecords.ownerUserId, ownerUserId),
          eq(lifecycleIdempotencyRecords.scope, scope),
          eq(lifecycleIdempotencyRecords.key, key),
          eq(lifecycleIdempotencyRecords.requestHash, requestHash),
          eq(lifecycleIdempotencyRecords.lockToken, claimed.lockToken),
          isNull(lifecycleIdempotencyRecords.completedAt),
        ),
      )
      .returning({ id: lifecycleIdempotencyRecords.id });
    if (!completed)
      throw new Error("STALE_CORE_IDEMPOTENCY_LEASE_CANNOT_COMPLETE_RESPONSE");
    return { result: response, replayed: false };
  }

  private async assertPersistedCapabilities(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    orderAcceptanceContext?: OrderAcceptanceContext,
  ): Promise<void> {
    let capabilities: readonly CoreCapabilityKey[] = [];
    let recovery = false;
    switch (input.resource) {
      case "accounts":
        capabilities = ["new_business", "legal"];
        break;
      case "procurement_profiles":
      case "price_books":
        capabilities = ["legal"];
        break;
      case "quotes":
        capabilities = ["new_business", "legal"];
        break;
      case "orders": {
        capabilities = ["new_business", "legal", "billing"];
        const route = orderAcceptanceContext?.snapshot.route;
        if (["referral", "resale", "distributor"].includes(route ?? ""))
          capabilities = [...capabilities, "partner"];
        if (route === "marketplace")
          capabilities = [...capabilities, "marketplace"];
        break;
      }
      case "amendments":
      case "commitments":
        capabilities = ["new_business", "legal", "billing"];
        break;
      case "invoices":
        capabilities = ["billing"];
        recovery = input.action === "evaluate_dunning";
        break;
      case "credit_notes":
      case "refunds":
      case "disputes":
        capabilities = ["billing"];
        recovery = true;
        break;
      case "deal_registrations":
        capabilities = ["new_business", "partner"];
        break;
      case "commissions":
        capabilities = ["billing", "partner"];
        recovery = true;
        break;
      case "accounting_exports":
      case "reports":
        capabilities = ["billing"];
        recovery = true;
        break;
      case "marketplace_reconciliations":
        capabilities = ["marketplace"];
        recovery = true;
        break;
    }
    for (const capability of new Set(capabilities)) {
      const [row] = await transaction.execute<{ enabled: boolean }>(sql`
        select public.system_capability_is_enabled(
          ${capability}::text,
          ${recovery}::boolean
        ) as enabled
      `);
      if (row?.enabled !== true)
        throw new CoreServiceError(
          "INVALID_STATE",
          `Persisted ${capability} capability is disabled for this command`,
        );
    }
  }

  private async claimUserIdempotency(
    transaction: RuntimeTransaction,
    ownerUserId: string,
    scope: string,
    key: string,
    requestHash: string,
  ) {
    const now = this.now();
    const existing =
      await transaction.query.lifecycleIdempotencyRecords.findFirst({
        where: and(
          eq(lifecycleIdempotencyRecords.ownerUserId, ownerUserId),
          eq(lifecycleIdempotencyRecords.scope, scope),
          eq(lifecycleIdempotencyRecords.key, key),
        ),
      });
    if (existing) {
      if (existing.requestHash !== requestHash)
        return { kind: "conflict" as const };
      if (
        existing.completedAt &&
        existing.responseStatus === 200 &&
        existing.responseBody !== null
      )
        return {
          kind: "replay" as const,
          responseBody: existing.responseBody,
        };
      if (existing.lockedUntil > now) return { kind: "in_progress" as const };
    }
    const lockToken = randomUUID();
    const lockedUntil = new Date(now.getTime() + 30_000);
    const expiresAt = new Date(now.getTime() + 24 * 3_600_000);
    const [claimed] = existing
      ? await transaction
          .update(lifecycleIdempotencyRecords)
          .set({ lockToken, lockedUntil, rowVersion: existing.rowVersion + 1 })
          .where(
            and(
              eq(lifecycleIdempotencyRecords.id, existing.id),
              eq(lifecycleIdempotencyRecords.rowVersion, existing.rowVersion),
              lte(lifecycleIdempotencyRecords.lockedUntil, now),
            ),
          )
          .returning()
      : await transaction
          .insert(lifecycleIdempotencyRecords)
          .values({
            ownerUserId,
            scope,
            key,
            requestHash,
            lockToken,
            lockedUntil,
            expiresAt,
          })
          .onConflictDoNothing()
          .returning();
    return claimed
      ? { kind: "claimed" as const, lockToken }
      : { kind: "in_progress" as const };
  }

  private async loadCommissionContext(
    input: CoreMutation,
  ): Promise<CommissionSourceContext | undefined> {
    if (input.resource !== "commissions") return undefined;
    const command = CommissionSourceCommandSchema.parse(input.payload);
    const sourceType: CommissionSourceType =
      command.sourceType === "chargeback" ? "dispute" : command.sourceType;
    return withInternalTransaction(
      this.options.pricingDatabase,
      input.requestId,
      async (transaction) => {
        const existing = await transaction.query.commissionAccruals.findFirst({
          where: and(
            eq(commissionAccruals.sourceType, sourceType),
            eq(commissionAccruals.sourceId, command.sourceId),
          ),
        });
        if (existing) return { existing };

        const source = await persistedCommissionSource(
          transaction,
          sourceType,
          command.sourceId,
        );
        const [invoice, order] = await Promise.all([
          transaction.query.invoices.findFirst({
            where: eq(invoices.id, source.invoiceId),
          }),
          transaction.query.orders.findFirst({
            where: eq(orders.id, source.orderId),
          }),
        ]);
        if (
          !invoice ||
          !order ||
          order.id !== invoice.orderId ||
          order.sourcing !== "referral" ||
          !order.partnerAccountId ||
          invoice.currency !== source.currency ||
          source.amountMinor <= 0n ||
          source.amountMinor > invoice.amountMinor
        )
          throw new CoreServiceError(
            "INVALID_STATE",
            "Eligible persisted referral commission source was not found",
          );
        const partner = await transaction.query.accounts.findFirst({
          where: eq(accounts.id, order.partnerAccountId),
        });
        if (!partner || partner.partnerAgreementType !== "referral")
          throw new CoreServiceError(
            "INVALID_STATE",
            "Commission source is not governed by a referral agreement",
          );

        let rateBps = partner.commissionRateBps;
        let holdbackBps = partner.commissionHoldbackBps;
        let adjustmentSourceId: string | undefined;
        if (sourceType !== "payment") {
          const original =
            sourceType === "credit_note_void"
              ? await transaction.query.commissionAccruals.findFirst({
                  where: and(
                    eq(commissionAccruals.sourceType, "credit_note"),
                    eq(commissionAccruals.sourceId, command.sourceId),
                    eq(commissionAccruals.invoiceId, invoice.id),
                    eq(
                      commissionAccruals.partnerAccountId,
                      order.partnerAccountId,
                    ),
                  ),
                })
              : source.paymentId
                ? await transaction.query.commissionAccruals.findFirst({
                    where: and(
                      eq(commissionAccruals.sourceType, "payment"),
                      eq(commissionAccruals.sourceId, source.paymentId),
                      eq(commissionAccruals.invoiceId, invoice.id),
                      eq(
                        commissionAccruals.partnerAccountId,
                        order.partnerAccountId,
                      ),
                    ),
                  })
                : await transaction.query.commissionAccruals.findFirst({
                    where: and(
                      eq(commissionAccruals.sourceType, "payment"),
                      eq(commissionAccruals.invoiceId, invoice.id),
                      eq(
                        commissionAccruals.partnerAccountId,
                        order.partnerAccountId,
                      ),
                    ),
                    orderBy: (row, { asc: ascending }) => [
                      ascending(row.createdAt),
                      ascending(row.id),
                    ],
                  });
          if (!original)
            throw new CoreServiceError(
              "INVALID_STATE",
              sourceType === "credit_note_void"
                ? "A credit-note void requires its persisted commission clawback"
                : "A clawback requires a persisted collected-payment accrual",
            );
          rateBps = original.rateBps;
          holdbackBps = original.holdbackBps;
          adjustmentSourceId = original.id;
        }
        if (rateBps === null || holdbackBps === null)
          throw new CoreServiceError(
            "INVALID_STATE",
            "Persisted referral commission rate and holdback policy are required",
          );
        return {
          sourceType,
          sourceId: command.sourceId,
          eventType: command.sourceType,
          invoiceId: invoice.id,
          partnerAccountId: order.partnerAccountId,
          occurredAt: source.occurredAt,
          currency: CurrencySchema.parse(source.currency),
          amountMinor: source.amountMinor.toString(),
          agreementType: "referral" as const,
          rateBps,
          holdbackBps,
          ...(adjustmentSourceId ? { adjustmentSourceId } : {}),
        };
      },
    );
  }

  private async loadDealRegistrationContext(
    input: CoreMutation,
  ): Promise<DealRegistrationDecisionContext | undefined> {
    if (input.resource !== "deal_registrations" || input.action !== "create")
      return undefined;
    const partnerId =
      input.accountId ??
      string(input.payload.partnerAccountId, "partnerAccountId");
    const endClientId = string(
      input.payload.endClientAccountId,
      "endClientAccountId",
    );
    return withInternalTransaction(
      this.options.pricingDatabase,
      input.requestId,
      async (transaction) => {
        const [partner, endClient, priorActiveDeals] = await Promise.all([
          accountCommercial(transaction, partnerId),
          accountCommercial(transaction, endClientId),
          transaction.query.dealRegistrations.findMany({
            where: and(
              eq(dealRegistrations.endClientAccountId, endClientId),
              inArray(dealRegistrations.status, [
                "registered",
                "approved",
                "disputed",
              ]),
            ),
            columns: { endClientAccountId: true, workload: true },
          }),
        ]);
        return {
          partner,
          endClient,
          houseAccountIds: new Set(
            endClient.roles.includes("direct_client") ? [endClient.id] : [],
          ),
          priorActiveDeals,
        };
      },
    );
  }

  private async loadOrderAcceptanceContext(
    input: CoreMutation,
  ): Promise<OrderAcceptanceContext | undefined> {
    if (
      input.resource !== "orders" ||
      (input.action !== "create" && input.action !== "prepare_artifact")
    )
      return undefined;
    if (!input.accountId)
      throw new CoreServiceError("INVALID_STATE", "Order account is required");
    const command =
      input.action === "prepare_artifact"
        ? OrderArtifactCommandSchema.parse(input.payload)
        : OrderCreateCommandSchema.parse(input.payload);
    return withInternalTransaction(
      this.options.pricingDatabase,
      input.requestId,
      async (transaction) => {
        const [quote, snapshotEvidence, quoteProfile] = await Promise.all([
          transaction.query.quotes.findFirst({
            where: eq(quotes.id, command.quoteId),
          }),
          transaction.query.quoteSnapshots.findFirst({
            where: eq(quoteSnapshots.quoteId, command.quoteId),
          }),
          transaction.query.quoteCommercialProfiles.findFirst({
            where: eq(quoteCommercialProfiles.quoteId, command.quoteId),
          }),
        ]);
        if (!quote || !snapshotEvidence || !quoteProfile)
          throw new CoreServiceError("NOT_FOUND", "Issued quote was not found");
        const snapshot = quoteSnapshot(snapshotEvidence.snapshot);
        if (
          quote.accountId !== input.accountId ||
          snapshot.accountId !== input.accountId ||
          snapshot.id !== quote.id
        )
          throw new CoreServiceError(
            "NOT_FOUND",
            "Issued quote was not found for the order account",
          );
        const partnerRoute =
          snapshot.route === "referral" ||
          snapshot.route === "resale" ||
          snapshot.route === "distributor";
        const partnerId = partnerRoute
          ? z.uuid().parse(snapshot.partnerAccountId)
          : undefined;
        const acceptanceAuthorityAccountId =
          snapshot.route === "resale" || snapshot.route === "distributor"
            ? z.uuid().parse(partnerId)
            : input.accountId;
        if (
          !input.authorization.isInternalStaff &&
          !input.authorization.accountIds.includes(
            ids.account.parse(acceptanceAuthorityAccountId),
          )
        )
          throw new CoreServiceError(
            "NOT_FOUND",
            "Issued quote was not found for its authorized accepting party",
          );
        const billingAccountId =
          snapshot.route === "resale" || snapshot.route === "distributor"
            ? z.uuid().parse(partnerId)
            : input.accountId;
        const agreementOn = async (
          accountId: string,
        ): Promise<GoverningAgreement> => {
          const agreement = await transaction.query.agreements.findFirst({
            where: and(
              eq(agreements.accountId, accountId),
              eq(agreements.status, "active"),
              lte(agreements.effectiveOn, command.serviceStartsOn),
              isNull(agreements.supersededById),
            ),
            orderBy: (row, { desc }) => [
              desc(row.effectiveOn),
              desc(row.version),
              desc(row.createdAt),
              desc(row.id),
            ],
          });
          if (!agreement)
            throw new CoreServiceError(
              "INVALID_STATE",
              `No authoritative governing agreement is effective for account ${accountId}`,
            );
          return {
            id: agreement.id,
            accountId: agreement.accountId,
            version: agreement.version,
            status: z
              .enum(["active", "in_notice", "expired", "terminated"])
              .parse(agreement.status),
            effectiveOn: agreement.effectiveOn,
          };
        };
        const reviewOwnerFor = async (accountId: string): Promise<string> => {
          const profile =
            await transaction.query.accountCommercialProfiles.findFirst({
              where: eq(accountCommercialProfiles.accountId, accountId),
              columns: { collectionsOwnerId: true },
            });
          if (profile?.collectionsOwnerId) {
            const configuredOwner =
              await transaction.query.commerceUsers.findFirst({
                where: and(
                  eq(commerceUsers.id, profile.collectionsOwnerId),
                  eq(commerceUsers.isInternalStaff, true),
                ),
                columns: { id: true },
              });
            if (!configuredOwner)
              throw new CoreServiceError(
                "INVALID_STATE",
                "Configured order review owner is not an internal finance user",
              );
            return configuredOwner.id;
          }
          const fallbackOwner = await transaction.query.commerceUsers.findFirst(
            {
              where: eq(commerceUsers.isInternalStaff, true),
              columns: { id: true },
              orderBy: (row, { asc: ascending }) => [ascending(row.id)],
            },
          );
          if (!fallbackOwner)
            throw new CoreServiceError(
              "INVALID_STATE",
              "Order acceptance requires an internal review owner",
            );
          return fallbackOwner.id;
        };
        const [
          buyer,
          partner,
          buyerAgreement,
          rawPartnerAgreement,
          reviewOwnerUserId,
        ] = await Promise.all([
          accountCommercial(transaction, input.accountId),
          partnerId
            ? accountCommercial(transaction, partnerId)
            : Promise.resolve(undefined),
          agreementOn(input.accountId),
          partnerId ? agreementOn(partnerId) : Promise.resolve(undefined),
          reviewOwnerFor(billingAccountId),
        ]);
        const partnerAgreement =
          rawPartnerAgreement && partner?.partner
            ? {
                ...rawPartnerAgreement,
                partnerAgreementType: partner.partner.agreementType,
              }
            : rawPartnerAgreement;
        const pricingInputs = JsonRecordSchema.parse(
          quoteProfile.pricingInputs,
        );
        const persistedRegistrationId = z
          .uuid()
          .safeParse(pricingInputs.dealRegistrationId);
        if (
          pricingInputs.dealRegistrationId &&
          !persistedRegistrationId.success
        )
          throw new CoreServiceError(
            "INVALID_STATE",
            "Quote deal-registration provenance is malformed",
          );
        if (persistedRegistrationId.success) {
          const registration =
            await transaction.query.dealRegistrations.findFirst({
              where: eq(dealRegistrations.id, persistedRegistrationId.data),
            });
          if (
            !registration ||
            registration.partnerAccountId !== partnerId ||
            registration.endClientAccountId !== input.accountId ||
            (registration.status !== "approved" &&
              registration.status !== "converted")
          )
            throw new CoreServiceError(
              "INVALID_STATE",
              "Quote deal-registration provenance no longer matches its commercial parties",
            );
        }
        return {
          quote,
          snapshot,
          buyer,
          ...(partner ? { partner } : {}),
          buyerAgreement,
          ...(partnerAgreement ? { partnerAgreement } : {}),
          ...(persistedRegistrationId.success
            ? { dealRegistrationId: persistedRegistrationId.data }
            : {}),
          reviewOwnerUserId,
        };
      },
    );
  }

  private async loadQuoteCommercialContext(
    input: CoreMutation,
  ): Promise<QuoteCommercialContext | undefined> {
    if (input.resource !== "quotes" || input.action !== "create")
      return undefined;
    if (!input.accountId)
      throw new CoreServiceError("INVALID_STATE", "Quote account is required");
    const buyerId = input.accountId;
    const command = QuoteCreateCommandSchema.parse(input.payload);
    const partnerRoute =
      command.route === "referral" ||
      command.route === "resale" ||
      command.route === "distributor";
    return withInternalTransaction(
      this.options.pricingDatabase,
      input.requestId,
      async (transaction) => {
        const buyerRow = await transaction.query.accounts.findFirst({
          where: eq(accounts.id, buyerId),
          columns: { screeningStatus: true },
        });
        if (!buyerRow)
          throw new CoreServiceError("NOT_FOUND", "Quote buyer was not found");
        const buyer = await accountCommercial(transaction, buyerId);
        if (!partnerRoute)
          return {
            buyer,
            buyerScreeningStatus: buyerRow.screeningStatus,
          };

        const partnerId = z.uuid().parse(command.partnerAccountId);
        const endClientId = z.uuid().parse(command.endClientAccountId);
        const [partner, partnerRow, registration] = await Promise.all([
          accountCommercial(transaction, partnerId),
          transaction.query.accounts.findFirst({
            where: eq(accounts.id, partnerId),
            columns: { screeningStatus: true },
          }),
          transaction.query.dealRegistrations.findFirst({
            where: and(
              eq(dealRegistrations.partnerAccountId, partnerId),
              eq(dealRegistrations.endClientAccountId, endClientId),
              eq(dealRegistrations.status, "approved"),
              lte(
                dealRegistrations.protectionStartsAt,
                new Date(input.occurredAt),
              ),
              gt(
                dealRegistrations.protectionEndsAt,
                new Date(input.occurredAt),
              ),
            ),
            orderBy: (row, { desc }) => [desc(row.protectionEndsAt)],
          }),
        ]);
        if (!partnerRow)
          throw new CoreServiceError(
            "NOT_FOUND",
            "Quote partner was not found",
          );
        return {
          buyer,
          buyerScreeningStatus: buyerRow.screeningStatus,
          partner,
          partnerScreeningStatus: partnerRow.screeningStatus,
          ...(registration ? { registration } : {}),
        };
      },
    );
  }

  private async loadConfidentialPriceBook(
    input: CoreMutation,
  ): Promise<PriceBook | undefined> {
    if (input.resource !== "quotes") return undefined;
    return withInternalTransaction(
      this.options.pricingDatabase,
      input.requestId,
      async (transaction) => {
        const priceBookId =
          input.action === "create"
            ? QuoteCreateCommandSchema.parse(input.payload).priceBookId
            : (
                await transaction.query.quotes.findFirst({
                  where: eq(quotes.id, input.id),
                  columns: { priceBookId: true },
                })
              )?.priceBookId;
        if (!priceBookId)
          throw new CoreServiceError("NOT_FOUND", "Quote was not found");
        return serverPriceBook(transaction, priceBookId);
      },
    );
  }

  private async mutateInTransaction(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    confidentialPriceBook?: PriceBook,
    dealRegistrationContext?: DealRegistrationDecisionContext,
    quoteCommercialContext?: QuoteCommercialContext,
    orderAcceptanceContext?: OrderAcceptanceContext,
    commissionContext?: CommissionSourceContext,
  ): Promise<CoreMutationResult> {
    switch (input.resource) {
      case "accounts":
        return this.mutateAccount(transaction, input);
      case "procurement_profiles":
        return this.mutateProcurement(transaction, input);
      case "price_books":
        return this.mutatePriceBook(transaction, input);
      case "quotes":
        return this.mutateQuote(
          transaction,
          input,
          confidentialPriceBook,
          quoteCommercialContext,
        );
      case "orders":
        return this.mutateOrder(transaction, input, orderAcceptanceContext);
      case "amendments":
        return this.mutateAmendment(transaction, input);
      case "commitments":
        return this.mutateCommitment(transaction, input);
      case "invoices":
        return this.mutateInvoice(transaction, input);
      case "credit_notes":
        return this.mutateCreditNote(transaction, input);
      case "refunds":
        return this.mutateRefund(transaction, input);
      case "disputes":
        return this.mutateDispute(transaction, input);
      case "deal_registrations":
        return this.mutateDealRegistration(
          transaction,
          input,
          dealRegistrationContext,
        );
      case "commissions":
        return this.mutateCommission(transaction, input, commissionContext);
      case "reports":
        return this.mutateReportExport(transaction, input);
      default:
        throw new CoreServiceError(
          "INVALID_STATE",
          `${input.resource} commands require their dedicated workflow or provider boundary`,
        );
    }
  }

  private async mutateReportExport(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ): Promise<CoreMutationResult> {
    if (
      input.action !== "create" ||
      !input.authorization.isInternalStaff ||
      input.authorization.impersonation ||
      input.actor.kind !== "user" ||
      input.actor.id !== input.authorization.userId ||
      !input.authorization.roles.some((role) =>
        ["internal_operator", "finance_approver"].includes(role),
      )
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Report exports require a non-assisted internal operator",
      );
    const command = ReportExportCreateCommandSchema.parse(input.payload);
    const [row] = await transaction
      .insert(reportExports)
      .values({
        id: input.id,
        requestedBy: input.authorization.userId,
        report: command.reportType,
        parameters: command,
        status: "pending",
        createdAt: new Date(input.occurredAt),
        updatedAt: new Date(input.occurredAt),
      })
      .returning();
    if (!row)
      throw new CoreServiceError("DUPLICATE", "Report export already exists");
    return audited(transaction, input, coreRecord("reports", row));
  }

  private async mutateAccount(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ) {
    if (input.action === "create") {
      const payload = input.payload;
      const hasCommissionRate = payload.commissionRateBps !== undefined;
      const hasCommissionHoldback = payload.commissionHoldbackBps !== undefined;
      if (hasCommissionRate !== hasCommissionHoldback)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Commission rate and holdback policy must be configured together",
        );
      if (hasCommissionRate && !input.authorization.isInternalStaff)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Commission policy is internal finance configuration",
        );
      const [row] = await transaction
        .insert(accounts)
        .values({
          id: input.id,
          legalName: normalizeLegalName(string(payload.legalName, "legalName")),
          relationshipRoles: z
            .array(CommercialRoleSchema)
            .min(1)
            .parse(payload.relationshipRoles),
          registeredAddress: object(
            payload.registeredAddress,
            "registeredAddress",
          ),
          taxIds: Array.isArray(payload.taxIds) ? payload.taxIds : [],
          billingContact: object(payload.billingContact, "billingContact"),
          apContact: payload.apContact ?? {},
          invoiceDeliveryEmail: string(
            payload.invoiceDeliveryEmail,
            "invoiceDeliveryEmail",
          ),
          domain: normalizeDomain(string(payload.domain, "domain")),
          country: string(payload.country, "country"),
          currency: string(payload.currency, "currency"),
          screeningStatus:
            optionalString(payload.screeningStatus, "screeningStatus") ??
            "pending",
          ...(optionalString(payload.parentPartnerId, "parentPartnerId")
            ? {
                parentPartnerId: string(
                  payload.parentPartnerId,
                  "parentPartnerId",
                ),
              }
            : {}),
          ...(optionalString(
            payload.partnerAgreementType,
            "partnerAgreementType",
          )
            ? {
                partnerAgreementType: string(
                  payload.partnerAgreementType,
                  "partnerAgreementType",
                ),
              }
            : {}),
          ...(payload.commissionRateBps === undefined
            ? {}
            : {
                commissionRateBps: integer(
                  payload.commissionRateBps,
                  "commissionRateBps",
                ),
                commissionHoldbackBps: integer(
                  payload.commissionHoldbackBps,
                  "commissionHoldbackBps",
                ),
              }),
        })
        .returning();
      if (!row) throw new Error("Account insert returned no row");
      return audited(transaction, input, coreRecord("accounts", row, row.id));
    }
    const prior = await transaction.query.accounts.findFirst({
      where: eq(accounts.id, input.id),
    });
    if (!prior)
      throw new CoreServiceError("NOT_FOUND", "Account was not found");
    if (input.expectedVersion !== prior.rowVersion)
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        "Account version is stale",
      );
    const [row] = await transaction
      .update(accounts)
      .set({
        ...(input.payload.legalName
          ? {
              legalName: normalizeLegalName(
                string(input.payload.legalName, "legalName"),
              ),
            }
          : {}),
        ...(input.payload.invoiceDeliveryEmail
          ? {
              invoiceDeliveryEmail: string(
                input.payload.invoiceDeliveryEmail,
                "invoiceDeliveryEmail",
              ),
            }
          : {}),
        ...(input.payload.billingContact
          ? {
              billingContact: object(
                input.payload.billingContact,
                "billingContact",
              ),
            }
          : {}),
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(accounts.id, input.id),
          eq(accounts.rowVersion, prior.rowVersion),
        ),
      )
      .returning();
    if (!row)
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        "Account version is stale",
      );
    return audited(
      transaction,
      input,
      coreRecord("accounts", row, row.id),
      prior,
    );
  }

  private async mutateProcurement(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ) {
    const accountId =
      input.accountId ?? string(input.payload.accountId, "accountId");
    const prior = await transaction.query.procurementProfiles.findFirst({
      where: eq(procurementProfiles.accountId, accountId),
    });
    if (input.action === "create" && prior)
      throw new CoreServiceError(
        "DUPLICATE",
        "Procurement profile already exists",
      );
    const values = {
      poRequired: Boolean(input.payload.poRequired),
      exemptions: Array.isArray(input.payload.exemptions)
        ? input.payload.exemptions
        : [],
      supplierPortalStatus:
        optionalString(
          input.payload.supplierPortalStatus,
          "supplierPortalStatus",
        ) ?? "not_required",
      supplierDocuments: Array.isArray(input.payload.supplierDocuments)
        ? input.payload.supplierDocuments
        : [],
    };
    const [row] = prior
      ? await transaction
          .update(procurementProfiles)
          .set({ ...values, updatedAt: this.now() })
          .where(eq(procurementProfiles.id, prior.id))
          .returning()
      : await transaction
          .insert(procurementProfiles)
          .values({ id: input.id, accountId, ...values })
          .returning();
    if (!row) throw new Error("Procurement mutation returned no row");
    return audited(
      transaction,
      input,
      coreRecord("procurement_profiles", row, accountId),
      prior,
    );
  }

  private async mutatePriceBook(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ) {
    if (input.action === "create") {
      const [row] = await transaction
        .insert(priceBooks)
        .values({
          id: input.id,
          name: string(input.payload.name, "name"),
          currency: string(input.payload.currency, "currency"),
          effectiveFrom: string(input.payload.effectiveFrom, "effectiveFrom"),
          effectiveTo: optionalString(input.payload.effectiveTo, "effectiveTo"),
          status: "draft",
          version: integer(input.payload.version, "version", 1),
        })
        .returning();
      if (!row) throw new Error("Price book insert returned no row");
      return audited(transaction, input, coreRecord("price_books", row));
    }
    const prior = await transaction.query.priceBooks.findFirst({
      where: eq(priceBooks.id, input.id),
    });
    if (!prior)
      throw new CoreServiceError("NOT_FOUND", "Price book was not found");
    const status =
      input.action === "activate"
        ? "active"
        : input.action === "retire"
          ? "retired"
          : undefined;
    if (!status)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Unsupported price book action",
      );
    if (
      prior.status !== "draft" &&
      !(prior.status === "active" && status === "retired")
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Invalid price book transition",
      );
    const [row] = await transaction
      .update(priceBooks)
      .set({ status })
      .where(eq(priceBooks.id, prior.id))
      .returning();
    if (!row) throw new Error("Price book update returned no row");
    return audited(transaction, input, coreRecord("price_books", row), prior);
  }

  private assertQuoteCommercialContext(
    input: CoreMutation,
    command: z.output<typeof QuoteCreateCommandSchema>,
    book: PriceBook,
    context?: QuoteCommercialContext,
  ): void {
    if (!input.accountId || !context || context.buyer.id !== input.accountId)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Persisted quote buyer context is unavailable",
      );
    if (context.buyerScreeningStatus !== "clear")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Quote buyer has not passed commercial screening",
      );

    const partnerRoute =
      command.route === "referral" ||
      command.route === "resale" ||
      command.route === "distributor";
    if (!partnerRoute) {
      if (
        command.partnerAccountId ||
        command.endClientAccountId ||
        command.partnerTier
      )
        throw new CoreServiceError(
          "INVALID_STATE",
          "Direct and marketplace quotes cannot carry partner relationship or pricing identifiers",
        );
      if (context.buyer.currency !== book.currency)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Quote buyer currency does not match the price book",
        );
      return;
    }

    if (
      !command.partnerAccountId ||
      !command.endClientAccountId ||
      command.endClientAccountId !== input.accountId ||
      command.partnerAccountId === input.accountId ||
      !context.partner ||
      context.partner.id !== command.partnerAccountId
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Partner quote must bind one distinct persisted partner and named end client",
      );
    if (
      !input.authorization.isInternalStaff &&
      !input.authorization.accountIds.some(
        (accountId) => accountId === command.partnerAccountId,
      )
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Partner quote actor lacks the persisted partner scope",
      );
    if (
      context.partnerScreeningStatus !== "clear" ||
      !context.partner.roles.includes("partner") ||
      !context.partner.partner
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Quote partner is inactive or has not passed commercial screening",
      );
    const agreementType = context.partner.partner.agreementType;
    if (
      (command.route === "referral" && agreementType !== "referral") ||
      (command.route !== "referral" && agreementType === "referral")
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Quote route conflicts with the persisted partner agreement",
      );
    const partnerPriced =
      command.route === "resale" || command.route === "distributor";
    const authoritativePartnerTier = context.partner.partner.transferTier;
    if (
      (!partnerPriced && command.partnerTier) ||
      (partnerPriced &&
        (!authoritativePartnerTier ||
          (command.partnerTier !== undefined &&
            command.partnerTier !== authoritativePartnerTier)))
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Partner transfer pricing tier must match persisted partner policy",
      );
    if (
      command.route === "distributor" &&
      context.partner.partner.transferTier !== "distributor"
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Distributor quote requires a persisted distributor relationship",
      );
    if (
      !context.registration ||
      context.registration.partnerAccountId !== command.partnerAccountId ||
      context.registration.endClientAccountId !== command.endClientAccountId
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Partner quote requires an approved active deal registration",
      );
    const billingCurrency =
      command.route === "referral"
        ? context.buyer.currency
        : context.partner.currency;
    if (billingCurrency !== book.currency)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Commercial billing currency does not match the price book",
      );
  }

  private async mutateQuote(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    confidentialPriceBook?: PriceBook,
    commercialContext?: QuoteCommercialContext,
  ) {
    if (!confidentialPriceBook)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Confidential pricing repository is unavailable",
      );
    await verifyImmutablePriceBookHeader(
      transaction,
      confidentialPriceBook,
      input.occurredAt,
    );
    if (input.action === "create") {
      if (!input.accountId)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Quote account is required",
        );
      const command = QuoteCreateCommandSchema.parse(input.payload);
      const book = confidentialPriceBook;
      if (book.id !== command.priceBookId)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Confidential price book identity mismatch",
        );
      if (
        (command.route === "marketplace") !==
        Boolean(command.marketplaceProvider)
      )
        throw new CoreServiceError(
          "INVALID_STATE",
          "Marketplace quotes must bind exactly one marketplace provider",
        );
      this.assertQuoteCommercialContext(
        input,
        command,
        book,
        commercialContext,
      );
      const requestLines = command.lines.map((line) => ({
        sku: line.sku,
        region: line.region,
        quantity: line.quantity,
        termMonths: line.termMonths,
        ...(line.lineId ? { lineId: line.lineId } : {}),
        ...(line.discountBps === undefined
          ? {}
          : { discountBps: line.discountBps }),
      }));
      const whiteLabel = whiteLabelMetadata(command.whiteLabel);
      const authoritativePartnerTier =
        command.route === "resale" || command.route === "distributor"
          ? commercialContext?.partner?.partner?.transferTier
          : undefined;
      const priced = priceQuote({
        book,
        lines: requestLines,
        route: command.route,
        ...(authoritativePartnerTier
          ? { partnerTier: authoritativePartnerTier }
          : {}),
        ...(command.partnerResaleTotal
          ? { partnerResaleTotal: command.partnerResaleTotal }
          : {}),
        quotedAt: input.occurredAt,
      });
      const draft = createQuoteDraft({
        id: input.id,
        seriesId: command.seriesId,
        accountId: input.accountId,
        ...(command.endClientAccountId
          ? { endClientAccountId: command.endClientAccountId }
          : {}),
        ...(command.partnerAccountId
          ? { partnerAccountId: command.partnerAccountId }
          : {}),
        priceBook: { id: book.id, version: book.version },
        route: command.route,
        lines: priced.lines,
        total: priced.total,
        ...(command.partnerResaleTotal
          ? { partnerResaleTotal: command.partnerResaleTotal }
          : {}),
        marginResult: priced.marginResult,
        exceptionReasons: priced.exceptionReasons,
        expiresAt: command.expiresAt,
        createdBy: input.authorization.userId,
        createdAt: input.occurredAt,
        ...(whiteLabel ? { whiteLabel } : {}),
      });
      const [row] = await transaction
        .insert(quotes)
        .values({
          id: draft.id,
          accountId: draft.accountId,
          endClientAccountId: draft.endClientAccountId,
          partnerAccountId: draft.partnerAccountId,
          priceBookId: draft.priceBook.id,
          seriesId: draft.seriesId,
          previousRevisionId: draft.previousRevisionId,
          revision: draft.revision,
          status: draft.status,
          currency: draft.total.currency,
          totalMinor: BigInt(draft.total.minor),
          marginFloorResult: draft.marginResult,
          expiresAt: new Date(draft.expiresAt),
          createdBy: draft.createdBy,
          partnerResaleTotalMinor: draft.partnerResaleTotal
            ? BigInt(draft.partnerResaleTotal.minor)
            : undefined,
        })
        .returning();
      if (!row) throw new Error("Quote insert returned no row");
      const mor = merchantOfRecord(command.route);
      await transaction.insert(quoteCommercialProfiles).values({
        quoteId: row.id,
        channelShape: command.route,
        merchantOfRecord: mor,
        pricingAuthority:
          command.route === "resale" || command.route === "distributor"
            ? "partner"
            : command.route === "marketplace"
              ? "marketplace"
              : "fil_one",
        billingAccountId:
          mor === "partner"
            ? string(command.partnerAccountId, "partnerAccountId")
            : input.accountId,
        ...(command.route === "distributor" && command.partnerAccountId
          ? { distributorAccountId: command.partnerAccountId }
          : {}),
        ...(command.marketplaceProvider
          ? { marketplaceProvider: command.marketplaceProvider }
          : {}),
        transferTotalMinor:
          mor === "partner" ? BigInt(priced.total.minor) : undefined,
        partnerResaleTotalMinor: command.partnerResaleTotal
          ? BigInt(command.partnerResaleTotal.minor)
          : undefined,
        whiteLabelMetadata: whiteLabel ?? {},
        pricingInputs: {
          request: {
            ...command,
            ...(authoritativePartnerTier
              ? { partnerTier: authoritativePartnerTier }
              : {}),
          },
          ...(commercialContext?.registration
            ? { dealRegistrationId: commercialContext.registration.id }
            : {}),
          exceptionReasons: priced.exceptionReasons,
          marginImpact: priced.marginImpact,
          guardrailBreaches: priced.guardrailBreaches,
          lineGuardrails: Object.fromEntries(
            priced.lines.flatMap((line) =>
              line.discountCeilingBps === undefined || !line.marginImpact
                ? []
                : [
                    [
                      line.id,
                      {
                        discountCeilingBps: line.discountCeilingBps,
                        marginImpact: line.marginImpact,
                      },
                    ],
                  ],
            ),
          ),
          ...(whiteLabel ? { whiteLabel } : {}),
        },
        pricingCalculatedAt: new Date(input.occurredAt),
      });
      await transaction.insert(quoteLines).values(
        draft.lines.map((line) => ({
          id: line.id,
          quoteId: draft.id,
          rateCardId: line.rateCardId,
          sku: line.sku,
          quantity: line.quantity,
          termMonths: line.termMonths,
          unitPriceMinor: BigInt(line.unitPrice.minor),
          overageRateMinor: BigInt(line.overageRate.minor),
          discountBps: line.discountBps,
          lineTotalMinor: BigInt(line.lineTotal.minor),
        })),
      );
      return audited(
        transaction,
        input,
        coreRecord("quotes", row, row.accountId),
      );
    }
    const prior = await transaction.query.quotes.findFirst({
      where: eq(quotes.id, input.id),
    });
    if (!prior) throw new CoreServiceError("NOT_FOUND", "Quote was not found");
    if (input.expectedVersion !== prior.rowVersion)
      throw new CoreServiceError("VERSION_CONFLICT", "Quote version is stale");
    if (confidentialPriceBook.id !== prior.priceBookId)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Confidential price book identity mismatch",
      );
    const snapshot = await persistedQuoteSnapshot(
      transaction,
      prior,
      confidentialPriceBook,
    );
    assertQuoteIdentity(prior, snapshot);
    if (input.action === "prepare_artifact") {
      const preparation = ArtifactPreparationSchema.parse(input.payload);
      if (
        Date.parse(preparation.retainUntil) <= Date.parse(preparation.issuedAt)
      )
        throw new CoreServiceError(
          "INVALID_STATE",
          "Commercial artifact retention must follow issuance",
        );
      const artifact = await quoteArtifactDefinition(transaction, {
        quote: snapshot,
        audience: preparation.audience,
        issuedAt: preparation.issuedAt,
      });
      const prepared = await persistCommercialArtifactRequest(transaction, {
        subjectType: "quote",
        subjectId: snapshot.id,
        commercialAccountId: snapshot.accountId,
        audienceAccountId: artifact.audienceAccountId,
        audience: preparation.audience,
        definition: artifact.definition,
        retainUntil: preparation.retainUntil,
        requestedBy: input.authorization.userId,
        actor: input.actor,
        requestId: input.requestId,
        occurredAt: input.occurredAt,
      });
      return artifactRequestResult(input, { ...prior, id: prior.id }, prepared);
    }
    let quoteIssuance:
      | {
          issuedAt: string;
          renderedDocumentId: string;
          partnerDocumentId?: string;
        }
      | undefined;
    if (input.action === "issue") {
      const issuedAt = string(
        input.payload.artifactIssuedAt,
        "artifactIssuedAt",
      );
      const renderedDocumentId = z
        .uuid()
        .parse(string(input.payload.renderedDocumentId, "renderedDocumentId"));
      const endClientArtifact = await quoteArtifactDefinition(transaction, {
        quote: snapshot,
        audience: "end_client",
        issuedAt,
      });
      await assertCommercialArtifactBinding(transaction, {
        documentId: renderedDocumentId,
        subjectType: "quote",
        subjectId: snapshot.id,
        commercialAccountId: snapshot.accountId,
        audienceAccountId: endClientArtifact.audienceAccountId,
        audience: "end_client",
        documentKind: endClientArtifact.documentKind,
        sourceHash: endClientArtifact.sourceHash,
      });
      const partnerDocumentId = optionalString(
        input.payload.partnerDocumentId,
        "partnerDocumentId",
      );
      if (snapshot.route === "resale" || snapshot.route === "distributor") {
        const parsedPartnerDocumentId = z.uuid().parse(partnerDocumentId);
        const partnerArtifact = await quoteArtifactDefinition(transaction, {
          quote: snapshot,
          audience: "partner",
          issuedAt,
        });
        await assertCommercialArtifactBinding(transaction, {
          documentId: parsedPartnerDocumentId,
          subjectType: "quote",
          subjectId: snapshot.id,
          commercialAccountId: snapshot.accountId,
          audienceAccountId: partnerArtifact.audienceAccountId,
          audience: "partner",
          documentKind: partnerArtifact.documentKind,
          sourceHash: partnerArtifact.sourceHash,
        });
        quoteIssuance = {
          issuedAt,
          renderedDocumentId,
          partnerDocumentId: parsedPartnerDocumentId,
        };
      } else {
        if (partnerDocumentId)
          throw new CoreServiceError(
            "INVALID_STATE",
            "Non-resale quotes cannot bind a partner-priced artifact",
          );
        quoteIssuance = { issuedAt, renderedDocumentId };
      }
    }
    const next =
      input.action === "expire"
        ? expireQuote(snapshot, input.occurredAt)
        : input.action === "approve_exception" ||
            input.action === "reject_exception"
          ? approveQuoteException(snapshot, {
              approved: input.action === "approve_exception",
              actorId: input.actor.id,
              reason: string(input.payload.reason, "reason"),
              decidedAt: input.occurredAt,
            })
          : quoteIssuance
            ? issueQuote(snapshot, quoteIssuance)
            : undefined;
    if (input.action === "expire" && next?.status !== "expired")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Issued quote has not reached its authoritative expiry time",
      );
    if (!next)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Unsupported quote transition",
      );
    const [row] = await transaction
      .update(quotes)
      .set({
        status: next.status,
        marginFloorResult: next.marginResult,
        renderedDocumentId: next.renderedDocumentId,
        partnerDocumentId: next.partnerDocumentId,
        updatedAt: this.now(),
      })
      .where(
        and(eq(quotes.id, prior.id), eq(quotes.rowVersion, prior.rowVersion)),
      )
      .returning();
    if (!row)
      throw new CoreServiceError("VERSION_CONFLICT", "Quote version is stale");
    if (next.status === "issued")
      await transaction.insert(quoteSnapshots).values({
        quoteId: prior.id,
        revision: prior.revision,
        snapshot: next,
        snapshotHash: coreSnapshotHash(next),
        issuedAt: new Date(next.issuedAt ?? input.occurredAt),
        createdBy: input.authorization.userId,
      });
    return audited(
      transaction,
      input,
      coreRecord("quotes", row, row.accountId),
      prior,
    );
  }

  private async mutateOrder(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    acceptanceContext?: OrderAcceptanceContext,
  ) {
    if (input.action === "create" || input.action === "prepare_artifact") {
      if (!acceptanceContext)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Authoritative order acceptance context is unavailable",
        );
      const preparingArtifact = input.action === "prepare_artifact";
      const command = preparingArtifact
        ? OrderArtifactCommandSchema.parse(input.payload)
        : OrderCreateCommandSchema.parse(input.payload);
      const orderFormDocumentId = preparingArtifact
        ? "00000000-0000-4000-8000-000000000000"
        : OrderCreateCommandSchema.parse(input.payload).orderFormDocumentId;
      if (
        input.actor.kind !== "user" ||
        command.signerUserId !== input.authorization.userId ||
        command.signerUserId !== input.actor.id
      )
        throw new CoreServiceError(
          "INVALID_STATE",
          "Order signer must be the authenticated acting user",
        );
      const [persistedQuote, snapshotEvidence] = await Promise.all([
        transaction.query.quotes.findFirst({
          where: eq(quotes.id, command.quoteId),
        }),
        transaction.query.quoteSnapshots.findFirst({
          where: eq(quoteSnapshots.quoteId, command.quoteId),
        }),
      ]);
      if (!persistedQuote || !snapshotEvidence)
        throw new CoreServiceError("NOT_FOUND", "Issued quote was not found");
      const snapshot = quoteSnapshot(snapshotEvidence.snapshot);
      if (
        snapshot.id !== persistedQuote.id ||
        acceptanceContext.quote.id !== persistedQuote.id ||
        acceptanceContext.quote.rowVersion !== persistedQuote.rowVersion ||
        coreSnapshotHash(snapshot) !== snapshotEvidence.snapshotHash ||
        coreSnapshotHash(acceptanceContext.snapshot) !==
          snapshotEvidence.snapshotHash ||
        persistedQuote.status !== "issued" ||
        snapshot.status !== "issued"
      )
        throw new CoreServiceError("INVALID_STATE", "Quote is not issuable");
      if (
        !preparingArtifact &&
        (Date.parse(command.acceptedAt) !== Date.parse(input.occurredAt) ||
          Date.parse(input.occurredAt) >= Date.parse(snapshot.expiresAt))
      )
        throw new CoreServiceError(
          "INVALID_STATE",
          "Order acceptance time must be current server evidence for an unexpired quote",
        );
      const accepted = acceptOrder({
        orderId: input.id,
        quote: snapshot,
        agreement: acceptanceContext.buyerAgreement,
        ...(acceptanceContext.partnerAgreement
          ? { partnerAgreement: acceptanceContext.partnerAgreement }
          : {}),
        buyer: acceptanceContext.buyer,
        ...(acceptanceContext.partner
          ? { partner: acceptanceContext.partner }
          : {}),
        signerUserId: command.signerUserId,
        authorityTitle: command.authorityTitle,
        authorityAttested: command.authorityAttested,
        ...(command.poNumber ? { poNumber: command.poNumber } : {}),
        ...(command.poDocumentId ? { poDocumentId: command.poDocumentId } : {}),
        serviceStartsOn: command.serviceStartsOn,
        ...(command.serviceEndsOn
          ? { serviceEndsOn: command.serviceEndsOn }
          : {}),
        ...(command.coTerminateOn
          ? { coTerminateOn: command.coTerminateOn }
          : {}),
        ...(command.noticeOn ? { noticeOn: command.noticeOn } : {}),
        acceptedAt: preparingArtifact ? command.acceptedAt : input.occurredAt,
        orderFormDocumentId,
        orderLineIds: command.orderLineIds,
      });
      const artifact = await orderArtifactDefinition(transaction, {
        order: accepted,
        issuedAt: command.acceptedAt,
      });
      const artifactAudience =
        accepted.sourcing === "resale" || accepted.sourcing === "distributor"
          ? "partner"
          : "end_client";
      if (preparingArtifact) {
        const retainUntil = z.iso
          .datetime({ offset: true })
          .parse(input.payload.retainUntil);
        if (Date.parse(retainUntil) <= Date.parse(command.acceptedAt))
          throw new CoreServiceError(
            "INVALID_STATE",
            "Commercial artifact retention must follow acceptance",
          );
        const prepared = await persistCommercialArtifactRequest(transaction, {
          subjectType: "order",
          subjectId: accepted.id,
          commercialAccountId: accepted.accountId,
          audienceAccountId: artifact.audienceAccountId,
          audience: artifactAudience,
          definition: artifact.definition,
          retainUntil,
          requestedBy: input.authorization.userId,
          actor: input.actor,
          requestId: input.requestId,
          occurredAt: input.occurredAt,
        });
        return artifactRequestResult(
          input,
          {
            id: accepted.id,
            quoteId: accepted.quoteId,
            accountId: accepted.accountId,
            invoicingAccountId: accepted.invoicingAccountId,
            status: "artifact_requested",
            createdAt: new Date(input.occurredAt),
            updatedAt: new Date(input.occurredAt),
            rowVersion: 1,
          },
          prepared,
        );
      }
      await assertCommercialArtifactBinding(transaction, {
        documentId: accepted.orderFormDocumentId,
        subjectType: "order",
        subjectId: accepted.id,
        commercialAccountId: accepted.accountId,
        audienceAccountId: artifact.audienceAccountId,
        audience: artifactAudience,
        documentKind: "order_form",
        sourceHash: artifact.sourceHash,
      });
      const [acceptedQuote] = await transaction
        .update(quotes)
        .set({ status: "accepted", updatedAt: this.now() })
        .where(
          and(
            eq(quotes.id, persistedQuote.id),
            eq(quotes.status, "issued"),
            eq(quotes.rowVersion, persistedQuote.rowVersion),
          ),
        )
        .returning({ id: quotes.id });
      if (!acceptedQuote)
        throw new CoreServiceError(
          "VERSION_CONFLICT",
          "Quote was accepted concurrently",
        );
      const [row] = await transaction
        .insert(orders)
        .values({
          id: accepted.id,
          quoteId: accepted.quoteId,
          agreementId: accepted.agreementId,
          accountId: accepted.accountId,
          invoicingAccountId: accepted.invoicingAccountId,
          partnerAccountId: accepted.partnerAccountId,
          sourcing: accepted.sourcing,
          poNumber: accepted.poNumber,
          poDocumentId: accepted.poDocumentId,
          signerUserId: accepted.signerUserId,
          authorityTitle: accepted.authorityTitle,
          authorityAttested: true,
          status: accepted.status,
          serviceStartsOn: accepted.serviceStartsOn,
          serviceEndsOn: accepted.serviceEndsOn,
          noticeOn: accepted.noticeOn,
          orderFormDocumentId: accepted.orderFormDocumentId,
          immutableAt: new Date(accepted.acceptedAt),
        })
        .returning();
      if (!row) throw new Error("Order insert returned no row");
      await transaction.insert(orderLines).values(
        accepted.lines.map((line) => ({
          id: line.id,
          orderId: accepted.id,
          quoteLineId: line.quoteLineId,
          sku: line.sku,
          quantity: line.quantity,
          unitPriceMinor: BigInt(line.unitPrice.minor),
          overageRateMinor: BigInt(line.overageRate.minor),
        })),
      );
      const invoiceGroupingKey =
        accepted.sourcing === "resale" || accepted.sourcing === "distributor"
          ? `partner:${z.uuid().parse(accepted.partnerAccountId)}:${accepted.serviceStartsOn.slice(0, 7)}`
          : accepted.sourcing === "marketplace"
            ? `marketplace:${accepted.accountId}:${accepted.serviceStartsOn.slice(0, 7)}`
            : undefined;
      await transaction.insert(orderCommercialProfiles).values({
        orderId: accepted.id,
        merchantOfRecord: accepted.merchantOfRecord,
        billingShape: accepted.sourcing,
        provisioningIdempotencyKey: accepted.provisioningKey,
        governingAgreementVersion: accepted.agreementVersion,
        buyerAgreementId: accepted.buyerAgreementId,
        buyerAgreementVersion: accepted.buyerAgreementVersion,
        partnerAgreementId: accepted.partnerAgreementId,
        partnerAgreementVersion: accepted.partnerAgreementVersion,
        ...(acceptanceContext.dealRegistrationId
          ? { dealRegistrationId: acceptanceContext.dealRegistrationId }
          : {}),
        ...(accepted.sourcing === "distributor" && accepted.partnerAccountId
          ? { distributorAccountId: accepted.partnerAccountId }
          : {}),
        ...(invoiceGroupingKey ? { invoiceGroupingKey } : {}),
        contractualTimeZone: "UTC",
        acceptedAt: new Date(accepted.acceptedAt),
      });
      const persistedLineSnapshots = await transaction
        .insert(orderLineSnapshots)
        .values(
          accepted.lines.map((line) => ({
            orderLineId: line.id,
            snapshot: line,
            snapshotHash: coreSnapshotHash(line),
          })),
        )
        .returning();
      const [reservationResult] = await transaction.execute<{
        reservation: unknown;
      }>(sql`
        select to_jsonb(reservation_row) as reservation
        from public.core_reserve_order_acceptance(
          ${row.id}::uuid,
          ${row.rowVersion}::integer,
          ${acceptanceContext.reviewOwnerUserId}::uuid,
          ${input.requestId}::text
        ) as reservation_row
      `);
      const reservation = OrderAcceptanceReservationSchema.parse(
        reservationResult?.reservation,
      );
      if (reservation.order_id !== row.id)
        throw new Error("ORDER_ACCEPTANCE_RESERVATION_ID_MISMATCH");
      if (reservation.decision === "approved")
        await createAcceptedOrderProvisioningAttempt(transaction, {
          orderId: row.id,
          orderVersion: row.rowVersion,
          accountId: row.accountId,
          provisioningIdempotencyKey: accepted.provisioningKey,
          requestedAt: new Date(accepted.acceptedAt),
          actor: input.actor,
          requestId: input.requestId,
          lineSnapshots: persistedLineSnapshots,
        });
      const orderRecord = coreRecord("orders", row, row.accountId);
      return audited(transaction, input, {
        ...orderRecord,
        data: {
          ...orderRecord.data,
          acceptanceReservation: {
            decision: reservation.decision,
            reason: reservation.reason,
            reviewCaseId: reservation.review_case_id,
          },
        },
      });
    }
    throw new CoreServiceError(
      "INVALID_STATE",
      "Order state changes require provider confirmation or lifecycle offboarding",
    );
  }

  private async mutateAmendment(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ) {
    if (input.action !== "create" && input.action !== "prepare_artifact")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Amendment acceptance and application use the immutable create command",
      );
    const amendmentInput = AmendmentInputSchema.safeParse(
      input.payload.amendment,
    );
    if (!amendmentInput.success)
      throw new CoreServiceError(
        "INVALID_STATE",
        "payload.amendment is invalid",
      );
    const parsed = amendmentInput.data;
    const persistedOrder = await persistedAcceptedOrder(
      transaction,
      parsed.order.id,
    );
    if (
      persistedOrder.id !== parsed.order.id ||
      persistedOrder.accountId !== input.accountId
    )
      throw new CoreServiceError("NOT_FOUND", "Order was not found");
    const preparingArtifact = input.action === "prepare_artifact";
    const documentId = preparingArtifact
      ? "00000000-0000-4000-8000-000000000000"
      : z.uuid().parse(parsed.documentId);
    const amendment = createAmendment({
      id: parsed.id,
      order: persistedOrder,
      effectiveOn: parsed.effectiveOn,
      kind: parsed.kind,
      prorationMethod: parsed.prorationMethod,
      deltas: parsed.deltas.map((delta) => ({
        sku: delta.sku,
        quantityDelta: delta.quantityDelta,
        fullPeriodPriceDelta: delta.fullPeriodPriceDelta,
        ...(delta.orderLineId ? { orderLineId: delta.orderLineId } : {}),
      })),
      ...(parsed.newServiceEndsOn
        ? { newServiceEndsOn: parsed.newServiceEndsOn }
        : {}),
      documentId,
      acceptedAt: parsed.acceptedAt,
    });
    if (amendment.id !== input.id)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Amendment identity mismatch",
      );
    const parent = await transaction.query.orders.findFirst({
      where: eq(orders.id, amendment.orderId),
    });
    if (!parent || parent.accountId !== input.accountId)
      throw new CoreServiceError("NOT_FOUND", "Order was not found");
    const artifact = await amendmentArtifactDefinition(transaction, {
      order: persistedOrder,
      amendment,
      issuedAt: parsed.acceptedAt,
    });
    const artifactAudience =
      persistedOrder.sourcing === "resale" ||
      persistedOrder.sourcing === "distributor"
        ? "partner"
        : "end_client";
    if (preparingArtifact) {
      const retainUntil = z.iso
        .datetime({ offset: true })
        .parse(input.payload.retainUntil);
      if (Date.parse(retainUntil) <= Date.parse(parsed.acceptedAt))
        throw new CoreServiceError(
          "INVALID_STATE",
          "Commercial artifact retention must follow acceptance",
        );
      const prepared = await persistCommercialArtifactRequest(transaction, {
        subjectType: "amendment",
        subjectId: amendment.id,
        commercialAccountId: persistedOrder.accountId,
        audienceAccountId: artifact.audienceAccountId,
        audience: artifactAudience,
        definition: artifact.definition,
        retainUntil,
        requestedBy: input.authorization.userId,
        actor: input.actor,
        requestId: input.requestId,
        occurredAt: input.occurredAt,
      });
      return artifactRequestResult(
        input,
        {
          id: amendment.id,
          orderId: amendment.orderId,
          status: "artifact_requested",
          createdAt: new Date(input.occurredAt),
          updatedAt: new Date(input.occurredAt),
          version: 1,
        },
        prepared,
      );
    }
    await assertCommercialArtifactBinding(transaction, {
      documentId: amendment.documentId,
      subjectType: "amendment",
      subjectId: amendment.id,
      commercialAccountId: persistedOrder.accountId,
      audienceAccountId: artifact.audienceAccountId,
      audience: artifactAudience,
      documentKind: "amendment",
      sourceHash: artifact.sourceHash,
    });
    const [row] = await transaction
      .insert(amendments)
      .values({
        id: amendment.id,
        orderId: amendment.orderId,
        effectiveOn: amendment.effectiveOn,
        kind: amendment.kind,
        prorationMethod: amendment.prorationMethod,
        documentId: amendment.documentId,
      })
      .returning();
    if (!row) throw new Error("Amendment insert returned no row");
    await transaction
      .update(orders)
      .set({ status: "amended", updatedAt: this.now() })
      .where(eq(orders.id, parent.id));
    return audited(
      transaction,
      input,
      coreRecord("amendments", row, parent.accountId),
    );
  }

  private mutateCommitment(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ): Promise<CoreMutationResult> {
    // Metering runs on the service connection, so the account scope a row
    // policy would apply is asserted here before any ledger row is read.
    const scope = input.accountId;
    if (
      !scope ||
      (!input.authorization.isInternalStaff &&
        !input.authorization.accountIds.some((granted) => granted === scope))
    )
      throw new CoreServiceError("NOT_FOUND", "Commitment was not found");
    if (input.action === "create")
      return this.createCommitment(transaction, input);
    if (input.action === "reconcile")
      return this.reconcileCommitment(transaction, input);
    if (
      input.action === "record_usage" ||
      input.action === "correct_usage" ||
      input.action === "amend_allowance" ||
      input.action === "renew"
    )
      return this.advanceCommitment(transaction, input);
    throw new CoreServiceError(
      "INVALID_STATE",
      "Unsupported commitment command",
    );
  }

  private async createCommitment(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ): Promise<CoreMutationResult> {
    const parsed = CommitmentCreateCommandSchema.safeParse(input.payload);
    if (!parsed.success)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Commitment create payload is invalid",
      );
    const command = parsed.data;
    const order = await transaction.query.orders.findFirst({
      where: eq(orders.id, command.orderId),
    });
    if (!order || order.accountId !== input.accountId)
      throw new CoreServiceError("NOT_FOUND", "Order was not found");
    const line = await transaction.query.orderLines.findFirst({
      where: eq(orderLines.id, command.orderLineId),
    });
    if (!line || line.orderId !== order.id)
      throw new CoreServiceError("NOT_FOUND", "Order line was not found");
    const quote = await transaction.query.quotes.findFirst({
      where: eq(quotes.id, order.quoteId),
    });
    if (!quote)
      throw new CoreServiceError("NOT_FOUND", "Order quote was not found");
    const existing = await transaction.query.commitmentLedgers.findFirst({
      where: eq(commitmentLedgers.orderLineId, line.id),
    });
    if (existing)
      throw new CoreServiceError(
        "DUPLICATE",
        "Order line already carries a commitment ledger",
      );
    const ordered = [...command.periods].sort(
      (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
    );
    // Contiguity, ordering, and zone validity are decided by the domain before
    // any row is written, so an invalid contract never reaches the ledger.
    validateCommitmentContract({
      ledgerId: input.id,
      orderId: order.id,
      orderLineId: line.id,
      commitType: command.commitType,
      timeZone: command.contractualTimeZone,
      periods: ordered.map((period, index) => ({
        id: `period-${index + 1}`,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        allowance: period.allowanceQuantity,
        partial: false,
      })),
      contractedOverageRate: MoneySchema.parse({
        currency: quote.currency,
        minor: line.overageRateMinor.toString(),
      }),
      allowanceAdjustments: [],
    });
    const opening = ordered[0];
    const closing = ordered[ordered.length - 1];
    if (!opening || !closing)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Commitment requires at least one contracted period",
      );
    const [ledger] = await transaction
      .insert(commitmentLedgers)
      .values({
        id: input.id,
        orderId: order.id,
        orderLineId: line.id,
        commitType: command.commitType,
        committedQuantity: line.quantity,
        periodStartsAt: new Date(opening.startsAt),
        periodEndsAt: new Date(closing.endsAt),
      })
      .returning();
    if (!ledger) throw new Error("Commitment ledger insert returned no row");
    const repository = new CoreFinanceRepository(transaction);
    for (const [index, period] of ordered.entries()) {
      // Each period carries its own audit aggregate so the ledger's own version
      // line stays free for the commands that change its balance.
      const periodId = uuidV7();
      await repository.createCommitmentPeriod(
        {
          id: periodId,
          ledgerId: ledger.id,
          sequence: index + 1,
          startsAt: new Date(period.startsAt),
          endsAt: new Date(period.endsAt),
          contractualTimeZone: command.contractualTimeZone,
          allowanceQuantity: period.allowanceQuantity,
          contractedOverageRateMinor: line.overageRateMinor,
        },
        {
          accountId: order.accountId,
          aggregateType: "commitment_ledger",
          aggregateId: periodId,
          aggregateVersion: 1,
          eventType: "core.commitments.period_created",
          actor: input.actor,
          requestId: input.requestId,
        },
      );
    }
    return audited(
      transaction,
      input,
      coreRecord("commitments", ledger, order.accountId),
    );
  }

  private async advanceCommitment(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ): Promise<CoreMutationResult> {
    const binding = await this.authorizedCommitment(transaction, input);
    const now = new Date(input.occurredAt);
    const trail = await this.applyCommitmentSource(
      transaction,
      input,
      binding,
      now,
    );
    const replay = await replayCommitmentLedger(transaction, input.id);
    const applied = await applyCommitmentDecision(
      transaction,
      replay,
      trail,
      now,
    );
    const ledger = await transaction.query.commitmentLedgers.findFirst({
      where: eq(commitmentLedgers.id, input.id),
    });
    if (!ledger) throw new Error("Commitment ledger disappeared mid-command");
    const record = coreRecord("commitments", ledger, binding.accountId);
    return audited(transaction, input, {
      ...record,
      data: JsonRecordSchema.parse({
        ...record.data,
        authority: applied.decision.authority,
        totalConsumed: applied.decision.totalConsumed,
        totalOverage: applied.decision.totalOverage,
        overageAmount: applied.decision.overageAmount,
        entriesAppended: applied.entriesAppended,
        duplicateExternalEventIds:
          applied.decision.duplicateExternalEventIds.length,
        ...(applied.correctionId ? { correctionId: applied.correctionId } : {}),
        ...(trail.ingested ? { ingestedUsageEventIds: trail.ingested } : {}),
        ...(trail.duplicates
          ? { duplicateUsageEventIds: trail.duplicates }
          : {}),
      }),
    });
  }

  /**
   * Writes the source fact for one commitment command and returns how the
   * append-only correction trail should record it.
   */
  private async applyCommitmentSource(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    binding: {
      accountId: string;
      entitlementId: string;
      ledgerRowVersion: number;
    },
    now: Date,
  ): Promise<
    LedgerTrailCorrection & {
      ingested?: readonly string[];
      duplicates?: readonly string[];
    }
  > {
    const recordedBy = z.uuid().parse(input.authorization.userId);
    if (input.action === "record_usage") {
      const parsed = CommitmentUsageCommandSchema.safeParse(input.payload);
      if (!parsed.success)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Commitment usage payload is invalid",
        );
      const result = await ingestUsageEvents(
        transaction,
        binding.entitlementId,
        parsed.data.events,
      );
      return {
        reasonCode: "late_usage_replay",
        sourceReference: `usage:${input.idempotencyKey}`,
        recordedBy,
        recordedAt: now,
        append: "on_drift",
        ingested: result.ingested,
        duplicates: result.duplicates,
      };
    }
    if (input.action === "correct_usage") {
      const parsed = CommitmentCorrectionCommandSchema.safeParse(input.payload);
      if (!parsed.success)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Commitment correction payload is invalid",
        );
      const command = parsed.data;
      const corrected = await transaction.query.usageEvents.findFirst({
        where: and(
          eq(usageEvents.entitlementId, binding.entitlementId),
          eq(usageEvents.externalEventId, command.correctsExternalEventId),
        ),
      });
      if (!corrected)
        throw new CoreServiceError(
          "NOT_FOUND",
          "Corrected usage event was not found on this commitment",
        );
      const [appended] = await transaction
        .insert(usageEvents)
        .values({
          entitlementId: binding.entitlementId,
          externalEventId: command.externalEventId,
          measuredAt: new Date(command.measuredAt),
          quantity: command.quantityDelta,
          kind: command.meter,
          ledgerKind: "correction",
          correctsUsageEventId: corrected.id,
        })
        .onConflictDoNothing({
          target: [usageEvents.entitlementId, usageEvents.externalEventId],
        })
        .returning({ id: usageEvents.id });
      if (!appended)
        throw new CoreServiceError(
          "DUPLICATE",
          "Correction event id was already recorded",
        );
      const reversed = await transaction.query.commitmentEntries.findFirst({
        where: eq(commitmentEntries.usageEventId, corrected.id),
      });
      return {
        reasonCode: command.reasonCode,
        sourceReference: command.sourceReference,
        recordedBy,
        recordedAt: now,
        append: "always",
        quantityDelta: command.quantityDelta,
        ...(reversed ? { reversesEntryId: reversed.id } : {}),
      };
    }
    if (input.action === "amend_allowance") {
      const parsed = CommitmentAllowanceCommandSchema.safeParse(input.payload);
      if (!parsed.success)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Commitment allowance payload is invalid",
        );
      const command = parsed.data;
      const [adjustment] = await transaction
        .insert(commitmentAllowanceAdjustments)
        .values({
          ledgerId: input.id,
          ...(command.periodId ? { periodId: command.periodId } : {}),
          effectiveAt: new Date(command.effectiveAt),
          quantityDelta: command.quantityDelta,
          reason: command.reason,
          sourceReference: command.sourceReference,
          recordedBy,
          recordedAt: now,
        })
        .onConflictDoNothing({
          target: [
            commitmentAllowanceAdjustments.ledgerId,
            commitmentAllowanceAdjustments.sourceReference,
          ],
        })
        .returning({ id: commitmentAllowanceAdjustments.id });
      if (!adjustment)
        throw new CoreServiceError(
          "DUPLICATE",
          "Allowance adjustment reference was already recorded",
        );
      return {
        reasonCode: "allowance_amendment",
        sourceReference: `allowance:${command.sourceReference}`,
        recordedBy,
        recordedAt: now,
        append: "on_drift",
        ...(command.periodId ? { periodId: command.periodId } : {}),
      };
    }
    const parsed = CommitmentRenewCommandSchema.safeParse(input.payload);
    if (!parsed.success)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Commitment renewal payload is invalid",
      );
    const command = parsed.data;
    const periods = await transaction.query.commitmentPeriods.findMany({
      where: eq(commitmentPeriods.ledgerId, input.id),
      orderBy: [asc(commitmentPeriods.sequence)],
    });
    const last = periods[periods.length - 1];
    if (!last)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Commitment has no period to renew from",
      );
    if (Date.parse(command.startsAt) !== last.endsAt.getTime())
      throw new CoreServiceError(
        "INVALID_STATE",
        "A renewal period must begin where the prior period ended",
      );
    const renewedPeriodId = uuidV7();
    await new CoreFinanceRepository(transaction).createCommitmentPeriod(
      {
        id: renewedPeriodId,
        ledgerId: input.id,
        sequence: last.sequence + 1,
        startsAt: new Date(command.startsAt),
        endsAt: new Date(command.endsAt),
        contractualTimeZone: last.contractualTimeZone,
        allowanceQuantity: command.allowanceQuantity,
        contractedOverageRateMinor: last.contractedOverageRateMinor,
      },
      {
        accountId: binding.accountId,
        aggregateType: "commitment_ledger",
        aggregateId: renewedPeriodId,
        aggregateVersion: 1,
        eventType: "core.commitments.period_renewed",
        actor: input.actor,
        requestId: input.requestId,
      },
    );
    const [extended] = await transaction
      .update(commitmentLedgers)
      .set({ periodEndsAt: new Date(command.endsAt) })
      .where(
        and(
          eq(commitmentLedgers.id, input.id),
          eq(commitmentLedgers.rowVersion, binding.ledgerRowVersion),
        ),
      )
      .returning({ id: commitmentLedgers.id });
    if (!extended)
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        "Commitment ledger changed during renewal",
      );
    return {
      reasonCode: "renewal",
      sourceReference: `renewal:${command.sourceReference}`,
      recordedBy,
      recordedAt: now,
      append: "on_drift",
    };
  }

  private async reconcileCommitment(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ): Promise<CoreMutationResult> {
    const parsed = CommitmentReconcileCommandSchema.safeParse(input.payload);
    if (!parsed.success)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Commitment reconciliation payload is invalid",
      );
    const binding = await this.authorizedCommitment(transaction, input);
    const replay = await replayCommitmentLedger(transaction, input.id);
    const result = reconcileLedgerToSource(
      replay.decision,
      parsed.data.records,
    );
    const status = result.matched ? "matched" : "variance";
    const [reconciliation] = await transaction
      .insert(usageReconciliations)
      .values({
        entitlementId: binding.entitlementId,
        periodStartsAt: replay.binding.ledger.periodStartsAt,
        periodEndsAt: replay.binding.ledger.periodEndsAt,
        sourceSystem: parsed.data.sourceSystem,
        sourceQuantity: result.sourceQuantity,
        ledgerQuantity: result.ledgerQuantity,
        varianceQuantity: result.varianceQuantity,
        status,
      })
      .onConflictDoUpdate({
        target: [
          usageReconciliations.entitlementId,
          usageReconciliations.periodStartsAt,
          usageReconciliations.periodEndsAt,
          usageReconciliations.sourceSystem,
        ],
        set: {
          sourceQuantity: result.sourceQuantity,
          ledgerQuantity: result.ledgerQuantity,
          varianceQuantity: result.varianceQuantity,
          status,
        },
      })
      .returning();
    if (!reconciliation)
      throw new Error("Usage reconciliation insert returned no row");
    const record = coreRecord(
      "commitments",
      replay.binding.ledger,
      binding.accountId,
    );
    return audited(
      transaction,
      input,
      {
        ...record,
        data: JsonRecordSchema.parse({
          ...record.data,
          reconciliationId: reconciliation.id,
          sourceSystem: parsed.data.sourceSystem,
          status,
          ledgerQuantity: result.ledgerQuantity,
          sourceQuantity: result.sourceQuantity,
          varianceQuantity: result.varianceQuantity,
          missingFromLedger: result.missingFromLedger,
          missingFromSource: result.missingFromSource,
        }),
      },
      undefined,
      // Reconciliation compares the ledger against a source without changing
      // its balance, so it audits against the reconciliation it produced.
      {
        type: "commitment_ledger",
        id: reconciliation.id,
        version: reconciliation.rowVersion,
      },
    );
  }

  private async authorizedCommitment(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ): Promise<{
    accountId: string;
    entitlementId: string;
    ledgerRowVersion: number;
  }> {
    const ledger = await transaction.query.commitmentLedgers.findFirst({
      where: eq(commitmentLedgers.id, input.id),
    });
    if (!ledger)
      throw new CoreServiceError("NOT_FOUND", "Commitment was not found");
    const order = await transaction.query.orders.findFirst({
      where: eq(orders.id, ledger.orderId),
    });
    if (!order || order.accountId !== input.accountId)
      throw new CoreServiceError("NOT_FOUND", "Commitment was not found");
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== ledger.rowVersion
    )
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        "Commitment ledger version does not match",
      );
    const entitlement = await transaction.query.entitlements.findFirst({
      where: eq(entitlements.orderLineId, ledger.orderLineId),
    });
    if (!entitlement)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Commitment has no metered entitlement",
      );
    return {
      accountId: order.accountId,
      entitlementId: entitlement.id,
      ledgerRowVersion: ledger.rowVersion,
    };
  }

  private async mutateInvoice(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ) {
    if (input.action === "create") {
      const payload = input.payload;
      const order = await transaction.query.orders.findFirst({
        where: eq(orders.id, string(payload.orderId, "orderId")),
      });
      if (!order || order.invoicingAccountId !== input.accountId)
        throw new CoreServiceError("NOT_FOUND", "Billable order was not found");
      const acceptedQuote = await transaction.query.quotes.findFirst({
        where: and(eq(quotes.id, order.quoteId), eq(quotes.status, "accepted")),
      });
      if (!acceptedQuote || !order.immutableAt)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Invoice drafts require an immutable accepted order and quote",
        );
      const [row] = await transaction
        .insert(invoices)
        .values({
          id: input.id,
          orderId: order.id,
          accountId: order.invoicingAccountId,
          stripeInvoiceId: null,
          currency: acceptedQuote.currency,
          amountMinor: acceptedQuote.totalMinor,
          poNumber: order.poNumber,
          status: "draft",
          dueAt: payload.dueAt ? date(payload.dueAt, "dueAt") : undefined,
        })
        .returning();
      if (!row) throw new Error("Invoice insert returned no row");
      return audited(
        transaction,
        input,
        coreRecord("invoices", row, row.accountId),
      );
    }
    if (input.action === "evaluate_dunning") {
      assertFinanceApproval(input);
      DunningCommandSchema.parse(input.payload);
      await transaction.execute(
        sql`select id from invoices where id = ${input.id} for update`,
      );
      const invoice = await transaction.query.invoices.findFirst({
        where: eq(invoices.id, input.id),
      });
      if (!invoice)
        throw new CoreServiceError("NOT_FOUND", "Invoice not found");
      assertBillingAccount(input, invoice.accountId);
      if (invoice.status !== "open" || !invoice.dueAt)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Dunning requires an open invoice with a persisted due date",
        );
      const [policy, serviceEntitlements, priorCase] = await Promise.all([
        transaction.query.billingPolicies.findFirst({
          where: eq(billingPolicies.accountId, invoice.accountId),
        }),
        transaction.query.entitlements.findMany({
          where: eq(entitlements.orderId, invoice.orderId),
          columns: { maximumRetentionAt: true },
        }),
        transaction.query.collectionCases.findFirst({
          where: eq(collectionCases.invoiceId, invoice.id),
        }),
      ]);
      if (!policy)
        throw new CoreServiceError(
          "INVALID_STATE",
          "A persisted billing policy is required for dunning",
        );
      const maximumRetentionAt = serviceEntitlements.reduce<Date | undefined>(
        (latest, entitlement) =>
          entitlement.maximumRetentionAt &&
          (!latest || entitlement.maximumRetentionAt > latest)
            ? entitlement.maximumRetentionAt
            : latest,
        undefined,
      );
      const collectionPolicy =
        policy.collectionMethod === "net_terms"
          ? {
              kind: "net_terms" as const,
              days: policy.termsDays ?? 30,
              collectionsOwnerId: input.authorization.userId,
            }
          : policy.collectionMethod === "auto_charge"
            ? {
                kind: "auto_charge" as const,
                retryPolicy: "stripe_smart_retries" as const,
              }
            : { kind: "prepay" as const };
      const decision = dunningDecision({
        policy: collectionPolicy,
        dueAt: invoice.dueAt.toISOString(),
        now: input.occurredAt,
        firstThresholdDays: 7,
        secondThresholdDays: 30,
        ...(maximumRetentionAt
          ? { maximumRetentionAt: maximumRetentionAt.toISOString() }
          : {}),
        retentionLiabilityRule: "custom",
      });
      const secondThreshold = decision.actions.includes(
        "human_suspension_review",
      );
      const firstThreshold = decision.actions.includes("pause_new_orders");
      const caseValues = {
        accountId: invoice.accountId,
        ownerUserId: input.authorization.userId,
        agingBucket: secondThreshold
          ? "second_threshold"
          : firstThreshold
            ? "first_threshold"
            : "current",
        nextActionAt: new Date(Date.parse(input.occurredAt) + 86_400_000),
        status: secondThreshold ? "escalated" : "open",
        newServiceBlocked: firstThreshold,
        runningServiceDecision: secondThreshold ? "human_review" : "continue",
        maximumRetentionAt,
      };
      const [collectionCase] = priorCase
        ? await transaction
            .update(collectionCases)
            .set(caseValues)
            .where(
              and(
                eq(collectionCases.id, priorCase.id),
                eq(collectionCases.rowVersion, priorCase.rowVersion),
              ),
            )
            .returning()
        : await transaction
            .insert(collectionCases)
            .values({
              id: uuidV7(),
              invoiceId: invoice.id,
              ...caseValues,
            })
            .returning();
      if (!collectionCase)
        throw new CoreServiceError(
          "VERSION_CONFLICT",
          "Collection case was evaluated concurrently",
        );
      await transaction.insert(collectionActions).values({
        collectionCaseId: collectionCase.id,
        action: "dunning_evaluated",
        actorUserId: input.authorization.userId,
        outcome: caseValues.agingBucket,
        metadata: {
          actions: decision.actions,
          agingDays: decision.agingDays,
          dunningPolicyVersion: policy.dunningPolicyVersion,
          deletionPermitted: false,
        },
        occurredAt: new Date(input.occurredAt),
      });
      const record = coreRecord("invoices", invoice, invoice.accountId);
      return audited(
        transaction,
        input,
        {
          ...record,
          data: JsonRecordSchema.parse({
            ...record.data,
            collectionCase: json(collectionCase),
            dunningDecision: json(decision),
          }),
        },
        undefined,
        {
          type: "collection_case",
          id: collectionCase.id,
          version: collectionCase.rowVersion,
        },
      );
    }
    throw new CoreServiceError(
      "INVALID_STATE",
      "Invoice issuance is workflow-owned and provider status advances only from the verified Stripe webhook",
    );
  }

  private async mutateCreditNote(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ) {
    assertFinanceApproval(input);
    if (input.action !== "issue")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Unsupported credit-note action",
      );
    const command = CreditNoteIssueCommandSchema.parse(input.payload);
    const invoice = await transaction.query.invoices.findFirst({
      where: eq(invoices.id, command.invoiceId),
    });
    if (!invoice) throw new CoreServiceError("NOT_FOUND", "Invoice not found");
    assertBillingAccount(input, invoice.accountId);
    if (
      !(["open", "paid"] as const).includes(
        invoice.status as "open" | "paid",
      ) ||
      !invoice.stripeInvoiceId
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Credit notes require an open or paid provider-bound invoice",
      );
    const prior = await transaction.query.creditNotes.findMany({
      where: and(
        eq(creditNotes.invoiceId, invoice.id),
        inArray(creditNotes.status, ["approved", "pending", "issued"]),
      ),
      columns: { amountMinor: true },
    });
    try {
      creditAmount({
        invoiceRemaining: parsedMoney(
          invoice.currency,
          invoice.amountMinor.toString(),
        ),
        requested: command.amount,
        alreadyRefundedOrCredited: parsedMoney(
          invoice.currency,
          prior.reduce((sum, row) => sum + row.amountMinor, 0n).toString(),
        ),
      });
    } catch {
      throw new CoreServiceError(
        "INVALID_STATE",
        "Credit exceeds the remaining invoice amount or currency",
      );
    }
    const [row] = await transaction
      .insert(creditNotes)
      .values({
        id: input.id,
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        stripeCreditNoteId: null,
        currency: invoice.currency,
        amountMinor: BigInt(command.amount.minor),
        reasonCode: command.internalReasonCode,
        approvedBy: input.authorization.userId,
        status: "approved",
      })
      .returning();
    if (!row) throw new Error("Credit-note insert returned no row");
    await transaction.execute(sql`
      select public.core_create_stripe_adjustment_operation(
        ${row.id}::uuid,
        'credit_note'::text,
        ${command.providerReason}::text,
        ${command.internalReasonCode}::text
      )
    `);
    return audited(
      transaction,
      input,
      coreRecord("credit_notes", row, invoice.accountId),
    );
  }

  private async mutateRefund(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ) {
    assertFinanceApproval(input);
    if (input.action !== "submit")
      throw new CoreServiceError("INVALID_STATE", "Unsupported refund action");
    const command = RefundSubmitCommandSchema.parse(input.payload);
    const payment = await transaction.query.payments.findFirst({
      where: eq(payments.id, command.paymentId),
    });
    const invoice = payment
      ? await transaction.query.invoices.findFirst({
          where: eq(invoices.id, payment.invoiceId),
        })
      : undefined;
    if (!payment || !invoice)
      throw new CoreServiceError("NOT_FOUND", "Collected payment not found");
    assertBillingAccount(input, invoice.accountId);
    if (payment.status !== "succeeded")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Refunds require a succeeded payment",
      );
    if (
      command.amount.currency !== payment.currency ||
      BigInt(command.amount.minor) <= 0n
    )
      throw new CoreServiceError("INVALID_STATE", "Refund amount is invalid");
    if (BigInt(command.amount.minor) > payment.amountMinor)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Refund exceeds the persisted payment ceiling",
      );
    const [row] = await transaction
      .insert(refunds)
      .values({
        id: input.id,
        paymentId: payment.id,
        orderId: payment.orderId,
        stripeRefundId: null,
        currency: payment.currency,
        amountMinor: BigInt(command.amount.minor),
        reasonCode: command.internalReasonCode,
        status: "approved",
      })
      .returning();
    if (!row) throw new Error("Refund insert returned no row");
    await transaction.execute(sql`
      select public.core_create_stripe_adjustment_operation(
        ${row.id}::uuid,
        'refund'::text,
        ${command.providerReason}::text,
        ${command.internalReasonCode}::text
      )
    `);
    return audited(
      transaction,
      input,
      coreRecord("refunds", row, invoice.accountId),
    );
  }

  private async mutateDispute(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ) {
    assertFinanceApproval(input);
    if (input.action !== "create")
      throw new CoreServiceError("INVALID_STATE", "Unsupported dispute action");
    const command = DisputeCreateCommandSchema.parse(input.payload);
    const payment = await transaction.query.payments.findFirst({
      where: eq(payments.id, command.paymentId),
    });
    const invoice = payment
      ? await transaction.query.invoices.findFirst({
          where: eq(invoices.id, payment.invoiceId),
        })
      : undefined;
    if (!payment || !invoice)
      throw new CoreServiceError("NOT_FOUND", "Collected payment not found");
    assertBillingAccount(input, invoice.accountId);
    if (
      payment.status !== "succeeded" ||
      command.amount.currency !== payment.currency ||
      BigInt(command.amount.minor) <= 0n
    )
      throw new CoreServiceError("INVALID_STATE", "Dispute amount is invalid");
    const [row] = await transaction
      .insert(disputeCases)
      .values({
        id: input.id,
        paymentId: payment.id,
        orderId: payment.orderId,
        stripeDisputeId: command.stripeDisputeId,
        currency: payment.currency,
        amountMinor: BigInt(command.amount.minor),
        evidenceDueAt: new Date(command.evidenceDueAt),
        status: "needs_response",
      })
      .returning();
    if (!row) throw new Error("Dispute insert returned no row");
    return audited(
      transaction,
      input,
      coreRecord("disputes", row, invoice.accountId),
    );
  }

  private async mutateDealRegistration(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    decisionContext?: DealRegistrationDecisionContext,
  ) {
    if (input.action === "create") {
      const partnerId =
        input.accountId ??
        string(input.payload.partnerAccountId, "partnerAccountId");
      const endClientId = string(
        input.payload.endClientAccountId,
        "endClientAccountId",
      );
      if (
        !decisionContext ||
        decisionContext.partner.id !== partnerId ||
        decisionContext.endClient.id !== endClientId
      )
        throw new CoreServiceError(
          "INVALID_STATE",
          "Deal registration decision context is unavailable",
        );
      const { partner, endClient, houseAccountIds, priorActiveDeals } =
        decisionContext;
      const workload = string(input.payload.workload, "workload");
      const expectedVolume = string(
        input.payload.expectedVolume,
        "expectedVolume",
      );
      if (!/^(0|[1-9]\d*)(?:\.\d+)?$/.test(expectedVolume))
        throw new CoreServiceError(
          "INVALID_STATE",
          "expectedVolume must be a nonnegative decimal quantity",
        );
      const registration = registerDeal({
        id: input.id,
        partner,
        endClient,
        workload,
        expectedVolume,
        registeredAt: input.occurredAt,
        protectionDays: integer(input.payload.protectionDays, "protectionDays"),
        // House-account and prior-deal policy is derived from the unified
        // account/deal records. A command caller cannot attest its own
        // exclusion result.
        houseAccountIds,
        priorActiveDeals,
      });
      const [row] = await transaction
        .insert(dealRegistrations)
        .values({
          id: registration.id,
          partnerAccountId: registration.partnerAccountId,
          endClientAccountId: registration.endClientAccountId,
          workload: registration.workload,
          expectedVolume: registration.expectedVolume,
          status: registration.status,
          protectionStartsAt: new Date(registration.protectionStartsAt),
          protectionEndsAt: new Date(registration.protectionEndsAt),
        })
        .returning();
      if (!row) throw new Error("Deal registration insert returned no row");
      if (registration.exclusion)
        await transaction.insert(dealRegistrationExclusions).values({
          registrationId: row.id,
          kind: registration.exclusion,
          matchedAccountId: endClient.id,
          evidence: {
            source: "unified_account_and_active_deal_records",
            endClientAccountId: endClient.id,
            workload,
          },
          status: "detected",
        });
      return audited(
        transaction,
        input,
        coreRecord("deal_registrations", row, row.partnerAccountId),
      );
    }
    const prior = await transaction.query.dealRegistrations.findFirst({
      where: eq(dealRegistrations.id, input.id),
    });
    if (!prior)
      throw new CoreServiceError(
        "NOT_FOUND",
        "Deal registration was not found",
      );
    const registration: DealRegistration = {
      id: prior.id,
      partnerAccountId: prior.partnerAccountId,
      endClientAccountId: prior.endClientAccountId,
      workload: prior.workload,
      expectedVolume: prior.expectedVolume,
      status: z
        .enum([
          "registered",
          "approved",
          "expired",
          "converted",
          "rejected",
          "disputed",
        ])
        .parse(prior.status),
      protectionStartsAt: prior.protectionStartsAt.toISOString(),
      protectionEndsAt: prior.protectionEndsAt.toISOString(),
      credit: prior.status === "approved" ? "sourced" : "none",
    };
    const next =
      input.action === "approve" ||
      input.action === "reject" ||
      input.action === "extend"
        ? evaluateRegistration(registration, {
            now: input.occurredAt,
            action:
              input.action === "approve"
                ? "approve"
                : input.action === "reject"
                  ? "reject"
                  : "extend",
            ...(input.payload.extensionDays === undefined
              ? {}
              : {
                  extensionDays: integer(
                    input.payload.extensionDays,
                    "extensionDays",
                  ),
                }),
          })
        : input.action === "convert"
          ? { ...registration, status: "converted" as const }
          : undefined;
    if (!next)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Unsupported deal registration transition",
      );
    const [row] = await transaction
      .update(dealRegistrations)
      .set({
        status: next.status,
        protectionEndsAt: new Date(next.protectionEndsAt),
        decidedAt: new Date(input.occurredAt),
        ...(input.action === "convert"
          ? { convertedOrderId: string(input.payload.orderId, "orderId") }
          : {}),
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(dealRegistrations.id, prior.id),
          eq(dealRegistrations.rowVersion, prior.rowVersion),
        ),
      )
      .returning();
    if (!row)
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        "Deal registration version is stale",
      );
    return audited(
      transaction,
      input,
      coreRecord("deal_registrations", row, row.partnerAccountId),
      prior,
    );
  }

  private async mutateCommission(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    context?: CommissionSourceContext,
  ) {
    if (input.action !== "accrue" && input.action !== "clawback")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Statement and settlement run through the commission workflow",
      );
    if (!context)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Persisted commission source context is unavailable",
      );
    if (context.existing) {
      const existingIsClawback = context.existing.amountMinor < 0n;
      if (
        context.existing.partnerAccountId !== input.accountId ||
        (input.action === "clawback") !== existingIsClawback
      )
        throw new CoreServiceError(
          "NOT_FOUND",
          "Eligible commission source was not found in partner scope",
        );
      throw new CoreServiceError(
        "DUPLICATE",
        "Commission source was already accrued",
      );
    }
    if (context.partnerAccountId !== input.accountId)
      throw new CoreServiceError(
        "NOT_FOUND",
        "Eligible commission source was not found in partner scope",
      );
    const accrual = accrueCommission({
      event: {
        id: context.sourceId,
        invoiceId: context.invoiceId,
        partnerAccountId: context.partnerAccountId,
        occurredAt: context.occurredAt,
        type: context.eventType,
        amount: MoneySchema.parse({
          currency: context.currency,
          minor: context.amountMinor,
        }),
      },
      agreementType: context.agreementType,
      rateBps: context.rateBps,
      holdbackBps: context.holdbackBps,
    });
    if (
      (input.action === "clawback") !== (accrual.kind === "clawback") ||
      accrual.partnerAccountId !== input.accountId
    )
      throw new CoreServiceError("INVALID_STATE", "Commission path mismatch");
    if (accrual.kind === "clawback") {
      const prior = await transaction
        .select({
          netCollectedRevenueMinor: commissionAccruals.netCollectedRevenueMinor,
        })
        .from(commissionAccruals)
        .where(
          and(
            eq(commissionAccruals.invoiceId, accrual.invoiceId),
            eq(commissionAccruals.partnerAccountId, accrual.partnerAccountId),
          ),
        );
      const remaining = prior.reduce(
        (sum, item) => sum + item.netCollectedRevenueMinor,
        BigInt(accrual.netCollectedRevenue.minor),
      );
      if (remaining < 0n)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Commission clawbacks cannot exceed persisted collected revenue",
        );
    }
    const [row] = await transaction
      .insert(commissionAccruals)
      .values({
        id: input.id,
        partnerAccountId: accrual.partnerAccountId,
        invoiceId: accrual.invoiceId,
        sourceType: context.sourceType,
        sourceId: context.sourceId,
        adjustmentSourceId: context.adjustmentSourceId,
        rateBps: context.rateBps,
        holdbackBps: context.holdbackBps,
        currency: accrual.payable.currency,
        netCollectedRevenueMinor: BigInt(accrual.netCollectedRevenue.minor),
        amountMinor: BigInt(accrual.grossCommission.minor),
        holdbackMinor: BigInt(accrual.holdback.minor),
        period: accrual.period,
        status: "accrued",
      })
      .onConflictDoNothing()
      .returning();
    if (!row)
      throw new CoreServiceError(
        "DUPLICATE",
        "Commission source was already accrued",
      );
    return audited(
      transaction,
      input,
      coreRecord("commissions", row, row.partnerAccountId),
    );
  }

  public list(input: CoreListInput) {
    return withAuthorizedTransaction(
      this.options.database,
      authorization(input),
      { secret: this.options.authorizationSecret, now: this.now() },
      async (transaction) => {
        const decodedCursor: unknown = input.cursor
          ? JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"))
          : undefined;
        const cursor = z.object({ id: z.string() }).safeParse(decodedCursor);
        const after = cursor.success ? cursor.data.id : undefined;
        const whereId = after
          ? gt(sql`${sql.identifier("id")}`, after)
          : undefined;
        let rows: JsonRecord[];
        switch (input.resource) {
          case "accounts":
            rows = await transaction
              .select()
              .from(accounts)
              .where(
                input.accountId
                  ? and(eq(accounts.id, input.accountId), whereId)
                  : whereId,
              )
              .orderBy(asc(accounts.id))
              .limit(input.limit + 1);
            break;
          case "quotes":
            rows = await transaction
              .select()
              .from(quotes)
              .where(
                input.accountId
                  ? and(eq(quotes.accountId, input.accountId), whereId)
                  : whereId,
              )
              .orderBy(asc(quotes.id))
              .limit(input.limit + 1);
            break;
          case "orders":
            rows = await transaction
              .select()
              .from(orders)
              .where(
                input.accountId
                  ? and(eq(orders.accountId, input.accountId), whereId)
                  : whereId,
              )
              .orderBy(asc(orders.id))
              .limit(input.limit + 1);
            break;
          case "invoices":
            rows = await transaction
              .select()
              .from(invoices)
              .where(
                input.accountId
                  ? and(eq(invoices.accountId, input.accountId), whereId)
                  : whereId,
              )
              .orderBy(asc(invoices.id))
              .limit(input.limit + 1);
            break;
          case "deal_registrations":
            rows = await transaction
              .select()
              .from(dealRegistrations)
              .where(
                input.accountId
                  ? and(
                      eq(dealRegistrations.partnerAccountId, input.accountId),
                      whereId,
                    )
                  : whereId,
              )
              .orderBy(asc(dealRegistrations.id))
              .limit(input.limit + 1);
            break;
          case "commissions":
            rows = await transaction
              .select()
              .from(commissionAccruals)
              .where(
                input.accountId
                  ? and(
                      eq(commissionAccruals.partnerAccountId, input.accountId),
                      whereId,
                    )
                  : whereId,
              )
              .orderBy(asc(commissionAccruals.id))
              .limit(input.limit + 1);
            break;
          default:
            throw new CoreServiceError(
              "INVALID_STATE",
              `${input.resource} reads require their dedicated report or repository`,
            );
        }
        const page = rows.slice(0, input.limit);
        const items = page.map((row) => {
          const accountId =
            typeof row.accountId === "string"
              ? row.accountId
              : typeof row.partnerAccountId === "string"
                ? row.partnerAccountId
                : undefined;
          const visibleRow =
            input.resource === "quotes"
              ? redactPartnerQuoteData(row, input.authorization)
              : row;
          return coreRecord(input.resource, visibleRow, accountId);
        });
        const last = page.at(-1);
        return {
          items,
          nextCursor:
            rows.length > input.limit && last
              ? Buffer.from(JSON.stringify({ id: last.id })).toString(
                  "base64url",
                )
              : null,
        };
      },
    );
  }

  public report(input: DatabaseCoreReportInput) {
    const internalOnly = new Set<DatabaseCoreReportName>([
      "capacity_planning",
      "three_way_tie_out",
      "weekly_scorecard",
    ]);
    if (!input.authorization.isInternalStaff) {
      if (
        !input.accountId ||
        !input.authorization.accountIds.some(
          (accountId) => accountId === input.accountId,
        )
      )
        throw new CoreServiceError(
          "NOT_FOUND",
          "Report account scope was not found",
        );
      if (internalOnly.has(input.report))
        throw new CoreServiceError(
          "INVALID_STATE",
          "This management report is restricted to internal operators",
        );
    }
    const cursor = input.cursor
      ? z
          .object({ offset: z.number().int().nonnegative().max(10_000) })
          .parse(
            JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
          )
      : { offset: 0 };
    const reportNames = {
      revenue_forecast: "revenue_forecast",
      capacity_planning: "capacity",
      renewal_churn_exposure: "renewal_churn",
      partner_performance: "partner_performance",
      funnel_cycle_time: "funnel_cycle",
      margin_poc_cost: "margin_poc",
      three_way_tie_out: "three_way_tie_out",
      weekly_scorecard: "weekly_scorecard",
    } as const;
    const readReport = async (transaction: RuntimeTransaction) => {
      const rows = await new CoreFinanceRepository(
        transaction,
      ).readInternalReport(reportNames[input.report], {
        limit: input.limit + 1,
        offset: cursor.offset,
        ...(input.accountId ? { accountId: input.accountId } : {}),
      });
      const page = rows.slice(0, input.limit);
      return {
        items: page.map((raw) => {
          const data = JsonRecordSchema.parse(json(raw));
          const explicitSourceIds = JsonRecordSchema.safeParse(
            data.source_record_ids,
          );
          const accountId =
            typeof data.account_id === "string"
              ? data.account_id
              : typeof data.partner_account_id === "string"
                ? data.partner_account_id
                : undefined;
          return {
            id: `${input.report}:${coreSnapshotHash(data)}`,
            resource: "reports" as const,
            ...(accountId ? { accountId } : {}),
            rowVersion:
              typeof data.row_version === "number" ? data.row_version : 1,
            data: {
              report: input.report,
              sourceRecordIds: {
                ...(explicitSourceIds.success ? explicitSourceIds.data : {}),
                ...Object.fromEntries(
                  Object.entries(data).filter(
                    ([key, value]) =>
                      (key === "id" || key.endsWith("_id")) &&
                      typeof value === "string",
                  ),
                ),
              },
              ...data,
            },
            createdAt:
              typeof data.created_at === "string"
                ? data.created_at
                : this.now().toISOString(),
            updatedAt:
              typeof data.updated_at === "string"
                ? data.updated_at
                : this.now().toISOString(),
          };
        }),
        nextCursor:
          rows.length > input.limit
            ? Buffer.from(
                JSON.stringify({ offset: cursor.offset + input.limit }),
              ).toString("base64url")
            : null,
      };
    };
    if (input.authorization.isInternalStaff)
      return withInternalTransaction(
        this.options.pricingDatabase,
        uuidV7(),
        readReport,
      );
    return withAuthorizedTransaction(
      this.options.database,
      authorization(input),
      { secret: this.options.authorizationSecret, now: this.now() },
      readReport,
    );
  }

  public replay(input: {
    provider: string;
    eventId: string;
    actor: Actor;
    requestId: string;
  }): Promise<{ replayed: boolean; workflowRunId: string }> {
    return withInternalTransaction(
      this.options.pricingDatabase,
      input.requestId,
      async (transaction) => {
        const event = await transaction.query.webhookEvents.findFirst({
          where: and(
            eq(webhookEvents.provider, input.provider),
            eq(webhookEvents.providerEventId, input.eventId),
          ),
        });
        if (!event)
          throw new CoreServiceError(
            "NOT_FOUND",
            "Verified provider event was not found",
          );
        const taskIdentifier = `webhook-replay:${input.provider}`;
        const prior = await transaction.query.workflowRuns.findFirst({
          where: and(
            eq(workflowRuns.taskIdentifier, taskIdentifier),
            eq(workflowRuns.idempotencyKey, event.id),
          ),
        });
        if (prior && (prior.status === "pending" || prior.status === "running"))
          return { replayed: false, workflowRunId: prior.id };
        await transaction
          .update(webhookEvents)
          .set({
            processedAt: null,
            processingError: null,
            lockedUntil: new Date(),
          })
          .where(eq(webhookEvents.id, event.id));
        const replayInput = {
          provider: input.provider,
          providerEventId: input.eventId,
          webhookEventId: event.id,
          requestedBy: input.actor,
          requestId: input.requestId,
        };
        if (prior) {
          const [run] = await transaction
            .update(workflowRuns)
            .set({
              status: "pending",
              input: replayInput,
              output: null,
              lastError: null,
              updatedAt: new Date(),
            })
            .where(eq(workflowRuns.id, prior.id))
            .returning({ id: workflowRuns.id });
          if (!run) throw new Error("Replay workflow update returned no row");
          return { replayed: true, workflowRunId: run.id };
        }
        const [run] = await transaction
          .insert(workflowRuns)
          .values({
            taskIdentifier,
            idempotencyKey: event.id,
            aggregateType: "webhook_event",
            aggregateId: event.id,
            status: "pending",
            input: replayInput,
          })
          .returning({ id: workflowRuns.id });
        if (!run) throw new Error("Replay workflow insert returned no row");
        return { replayed: true, workflowRunId: run.id };
      },
    );
  }
}
