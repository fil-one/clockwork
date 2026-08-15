import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import {
  coreReportNames,
  ids,
  MoneySchema,
  uuidV7,
  type Actor,
  type CoreReportName,
  type EntityName,
  type TaxPort,
  type TaxTreatment,
} from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import {
  accrueCommission,
  acceptOrder,
  activatePriceBook,
  amendOrderState,
  applyAmendment,
  approveQuoteException,
  assessExemptionCertificates,
  createAmendment,
  divideRound,
  prorationFraction,
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
  reviseQuote,
  validateCommitmentContract,
  validatePriceBook,
} from "@clockwork/domain/core";
import type {
  AccountCommercialRecord,
  AcceptedOrder,
  AmendmentDelta,
  AmendmentDeltaSet,
  CommercialAmendment,
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
  amendmentLines,
  amendments,
  approvals,
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
} from "../../schema";
import {
  accountCommercialProfiles,
  accountContacts,
  accountingExports,
  accountRelationshipRoles,
  amendmentFinancialTerms,
  amendmentLineSupersessions,
  billingPolicies,
  collectionActions,
  collectionCases,
  commitmentAllowanceAdjustments,
  commitmentPeriods,
  marketplaceReconciliations,
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
import {
  CoreFinanceRepository,
  coreSnapshotHash,
  type CoreMutationAudit,
} from "./finance";
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

// The §17 catalogue, re-exported rather than restated -- see the comment on
// `coreReportNames` in @clockwork/contracts. `coreReportSources` below is a
// total record over it, which is what stops a name being added to the
// catalogue with no relation behind it.
export { coreReportNames as databaseCoreReportNames };
export type DatabaseCoreReportName = CoreReportName;

export interface DatabaseCoreReportInput {
  report: DatabaseCoreReportName;
  accountId?: string;
  cursor?: string;
  limit: number;
  authorization: AuthorizationContext;
}

/**
 * Who a §17 report is for.
 *
 * `internal` reports are refused to a non-internal caller by `report()` AND
 * ungranted to `clockwork_runtime` in SQL. `tenant` reports are reachable by an
 * account party who holds `report:read` and names an account they hold, and are
 * granted `select` to `clockwork_runtime` so the security-invoker view runs
 * under the caller's row-level security rather than the service role's.
 *
 * The two facts are one field here on purpose. They were two lists -- the
 * `internalOnly` set in `report()` and the grants in 000100/000905/001396 --
 * and the three reports 001396 added were in neither, so a non-internal owner
 * holding `report:read` reached `core_commission_settlement` and got
 * `42501 permission denied for view core_commission_settlement`: a raw
 * PostgreSQL error on a report the catalogue advertised to them.
 * `core-reports.integration.test.ts` reads `has_table_privilege` for
 * `clockwork_runtime` on every relation below and fails when it disagrees with
 * the audience declared here, so the binding is measured rather than asserted
 * in a comment.
 */
export type CoreReportAudience = "internal" | "tenant";

export interface CoreReportSource {
  /**
   * The relation the report is read from. Checked to exist -- and to be the
   * relation the audience claims -- by the integration test; never built from
   * caller input.
   */
  relation: string;
  /** Who may read it, in both senses above. */
  audience: CoreReportAudience;
  /**
   * The column an account filter narrows on. Absent where the report has no
   * account dimension at all (capacity, the tie-out, the scorecard), which is
   * part of why those three are internal.
   */
  accountColumn?: string;
  /**
   * Set for the eight views 000100 shipped, which are read through
   * `CoreFinanceRepository.readInternalReport` and its own short keys. The
   * three 001396 added are read by `readReportView`. The split is by migration
   * vintage rather than by anything meaningful.
   */
  shipped?: Parameters<CoreFinanceRepository["readInternalReport"]>[0];
}

/**
 * Where each report in the §17 catalogue is read from, and for whom.
 *
 * Total over `CoreReportName` by its type, which is the binding that stops the
 * catalogue in @clockwork/contracts becoming a list of names nothing serves:
 * add one there and this stops compiling until it names a relation.
 *
 * The audiences, and why each is what it is:
 *
 *   * The five 000905 granted to `clockwork_runtime` stay tenant-reachable.
 *     Its own comment is the authority: "Customer-facing reports must execute
 *     as clockwork_runtime so the security-invoker views apply underlying table
 *     RLS. Internal management views deliberately remain service-only."
 *
 *   * `capacity_planning`, `three_way_tie_out` and `weekly_scorecard` stay
 *     internal. None of them has an account dimension to narrow on, so there is
 *     no such thing as one tenant's row of them.
 *
 *   * `arr_mrr` is tenant-reachable. It reads exactly one relation --
 *     `core_revenue_forecast`, which 000905 already made tenant-reachable --
 *     and adds no table of its own, so its reach is the reach that report
 *     already has and its rows are scoped by the same RLS. Denying it would
 *     deny a tenant the run rate of numbers they can already page through
 *     month by month.
 *
 *   * `billing_collections` is tenant-reachable. Every relation it reads has a
 *     SELECT policy for the account party -- invoices, payments, credit notes,
 *     refunds, disputes, the collection case, the billing policy and the
 *     commercial profile -- so the row an account reads for its own invoice is
 *     column-for-column the row an internal operator reads. Verified against
 *     the demo seed, not assumed: 1397_report_reach_and_partner_credit.test.sql
 *     compares the two reads. What it makes newly reachable in practice is the
 *     collection case -- dunning owner, next action, running-service decision --
 *     because `core_collection_cases` is not on the record-read surface. Its
 *     policy already admits the account party and §17 names the dunning owner
 *     as content of this report; the grant follows the policy rather than
 *     widening it.
 *
 *   * `commission_settlement` is INTERNAL, and it is the one report here whose
 *     content would survive the grant while being wrong. Two reasons, both
 *     measured in the pgTAP test:
 *
 *       1. It joins `invoices` and `orders` inline. A commission accrual only
 *          exists on a referral order (`core_validate_finance_chain`:
 *          "commission must belong to an attributed referral invoice"), and on
 *          a referral the merchant of record is Fil One, so the invoice belongs
 *          to the END CLIENT. The partner cannot read that invoice, the join
 *          drops, and the partner's own commission report comes back EMPTY --
 *          proven against the seed: as an owner on Redwood, `commission_accruals`
 *          returns their accrual and `core_commission_settlement` returns zero
 *          rows.
 *       2. `marketplace_fee_minor` sums `core_marketplace_financial_entries`,
 *          whose only policy is `app_is_internal()`. A tenant reads 0 for a
 *          spec-required column whatever the fee actually was.
 *
 *     A report that silently returns nothing to the exact party it is about,
 *     and zero for a fee that is not zero, is worse than a typed refusal. §17
 *     opens "Internal only; clients and partners see their own data in the
 *     portal", and a partner's settlement position is already reachable
 *     row-by-row through `core_commission_statements`, which is scoped to
 *     `app_has_account(partner_account_id)`. Making this tenant-reachable is a
 *     view change -- the joins have to survive the end client's RLS and the
 *     marketplace fee has to come from somewhere a partner may read -- not a
 *     grant.
 */
export const coreReportSources: Readonly<
  Record<CoreReportName, CoreReportSource>
> = {
  revenue_forecast: {
    relation: "core_revenue_forecast",
    audience: "tenant",
    accountColumn: "account_id",
    shipped: "revenue_forecast",
  },
  capacity_planning: {
    relation: "core_capacity_planning",
    audience: "internal",
    shipped: "capacity",
  },
  renewal_churn_exposure: {
    relation: "core_renewal_churn_exposure",
    audience: "tenant",
    accountColumn: "account_id",
    shipped: "renewal_churn",
  },
  partner_performance: {
    relation: "core_partner_performance",
    audience: "tenant",
    accountColumn: "partner_account_id",
    shipped: "partner_performance",
  },
  funnel_cycle_time: {
    relation: "core_funnel_cycle_time",
    audience: "tenant",
    accountColumn: "account_id",
    shipped: "funnel_cycle",
  },
  margin_poc_cost: {
    relation: "core_margin_poc_cost",
    audience: "tenant",
    accountColumn: "account_id",
    shipped: "margin_poc",
  },
  three_way_tie_out: {
    relation: "core_three_way_tie_out",
    audience: "internal",
    shipped: "three_way_tie_out",
  },
  weekly_scorecard: {
    relation: "core_weekly_scorecard",
    audience: "internal",
    shipped: "weekly_scorecard",
  },
  arr_mrr: {
    relation: "core_arr_mrr",
    audience: "tenant",
    accountColumn: "account_id",
  },
  billing_collections: {
    relation: "core_billing_collections",
    audience: "tenant",
    accountColumn: "account_id",
  },
  commission_settlement: {
    relation: "core_commission_settlement",
    audience: "internal",
    accountColumn: "partner_account_id",
  },
};

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

/**
 * Identifier a webhook replay would have to enqueue under, one per provider.
 * Exported so the test that guards the refusal below and any future task
 * registration derive the string from the same place.
 */
export function webhookReplayTaskIdentifier(provider: string): string {
  return `webhook-replay:${provider}`;
}

/**
 * Raised when an operator asks for a webhook replay. No durable task is
 * registered under the identifier a replay would enqueue, so the command
 * refuses instead of reporting a success that nothing acts on.
 *
 * It is a DatabaseCoreError so that every consumer already treats it as a
 * failure: the API surface renders INVALID_STATE as a non-retryable 422 whose
 * detail names the missing identifier, and the operator server action reports
 * `ok: false`. When the task is registered, delete this and restore the
 * enqueue -- the accompanying test fails until you do.
 */
export class WebhookReplayTaskNotRegisteredError extends DatabaseCoreError {
  public constructor(public readonly taskIdentifier: string) {
    super(
      "INVALID_STATE",
      `Webhook replay is unavailable: no durable task is registered under "${taskIdentifier}", so a replay would clear the processed marker on the inbox row and enqueue nothing. The inbox row was left untouched. Register the task in @clockwork/workflows before enabling this command`,
    );
    this.name = "WebhookReplayTaskNotRegisteredError";
  }
}

type CoreResourceName = DatabaseCoreResourceName;
type CoreRecord = DatabaseCoreRecord;
type CoreMutation = DatabaseCoreMutation;
type CoreMutationResult = DatabaseCoreMutationResult;
type CoreListInput = DatabaseCoreListInput;
const CoreServiceError = DatabaseCoreError;

/**
 * The commands this repository branches on, by resource.
 *
 * Two surfaces advertise commands to callers -- the portal action list in
 * `projection-definitions` and the API command catalogue in the core service --
 * and both are held to this table by `command-catalogue.test.ts`. A verb they
 * offer and this repository does not implement reaches an operator as an
 * unsupported-transition error on the button they were told to press, which is
 * how a draft quote came to show "Price" as its headline action.
 *
 * `mutateInTransaction` refuses anything absent from it before a branch runs,
 * so this is the command surface rather than a description of one.
 */
export const databaseCoreCommands = {
  // `mutateAccount` branches on each of these and writes what its verb names:
  // `add_role` the relationship-role row and the array column, `add_contact`
  // the contact row, `set_payment_terms` the billing policy and the commercial
  // profile's printed terms, `set_partner_credit` both halves of the aggregate
  // credit limit -- the `accounts` column and the approved limit on the
  // commercial profile, which a database trigger requires to be the same
  // number. They shared one three-key patch until
  // 001396's work-stream, which meant a role, a contact, payment terms and a
  // credit limit were each audited under their own event and never written.
  accounts: [
    "create",
    "update",
    "add_role",
    "add_contact",
    "set_payment_terms",
    "set_partner_credit",
  ],
  procurement_profiles: [
    "create",
    "update",
    "add_certificate",
    "record_supplier_document",
  ],
  price_books: [
    "create",
    "add_rate",
    "request_activation",
    "activate",
    "retire",
  ],
  // `accept` is absent because acceptance is the order command: `orders:create`
  // moves the quote to accepted inside the transaction that binds the signatory
  // attestation, so a standalone verb would accept a quote with no order behind
  // it. `price` is absent because pricing is not a transition -- `priceQuote`
  // runs inside `create` and the row is inserted already priced.
  quotes: [
    "create",
    "prepare_artifact",
    "issue",
    "expire",
    "approve_exception",
    "reject_exception",
    "revise",
  ],
  orders: ["prepare_artifact", "create"],
  // `accept` and `apply` are absent for the same reason: the amendment create
  // command carries the acceptance evidence and applies the money in one
  // transaction.
  amendments: ["prepare_artifact", "create"],
  commitments: [
    "create",
    "record_usage",
    "correct_usage",
    "amend_allowance",
    "renew",
    "reconcile",
  ],
  // Invoice status mirrors Stripe (§10: webhooks are the source of payment
  // truth, no manual entry). `issue` runs through
  // `core.billing.issue-invoice.v1`, which requires the row to still be a draft
  // with no provider invoice; `open`, `pay`, `void` and `mark_uncollectible`
  // arrive from the verified webhook through `monotonicInvoiceStatus`. A local
  // write of any of them would both strand the real issuance and make the
  // projection refuse the provider's later truth. `consolidate` is absent
  // because end-client allocations are derived when the partner draft is
  // written, not asked for afterwards.
  invoices: ["create", "evaluate_dunning"],
  credit_notes: ["issue"],
  refunds: ["submit"],
  disputes: ["create"],
  deal_registrations: ["create", "approve", "reject", "extend", "convert"],
  commissions: ["accrue", "clawback"],
  accounting_exports: [],
  marketplace_reconciliations: [],
  reports: ["create"],
} as const satisfies Readonly<Record<CoreResourceName, readonly string[]>>;

/**
 * Commands the API catalogue still advertises that this repository refuses
 * because a workflow or a provider owns the transition. They are listed here so
 * the deferral is a recorded decision next to the code that refuses it, and so
 * the catalogue test can tell a deferral from a gap.
 *
 * No resource the portal can reach may appear here: the portal offers a verb as
 * a button, and a button that cannot run is the defect this table exists to
 * prevent. The catalogue test enforces that.
 */
export const workflowOwnedCoreCommands = {
  deal_registrations: ["expire", "dispute", "decide_dispute"],
  commissions: ["state", "settle"],
  accounting_exports: ["create", "generate", "post", "reconcile"],
  marketplace_reconciliations: ["create", "ingest", "reconcile", "replay"],
  reports: ["generate", "complete", "fail"],
} as const satisfies Readonly<
  Partial<Record<CoreResourceName, readonly string[]>>
>;

/**
 * Why a resource refuses the verbs it does not implement. The guard uses it so
 * a caller is told which boundary owns the transition rather than only that
 * this one does not.
 */
const unimplementedCommandReason: Partial<Record<CoreResourceName, string>> = {
  // Order state is advanced only by the accepted-order transaction,
  // authenticated provider confirmations, or the lifecycle offboarding
  // commands. A generic state verb here would let an ordinary order:write
  // caller bypass those boundaries.
  orders:
    "Order state changes require provider confirmation or lifecycle offboarding",
  amendments:
    "Amendment acceptance and application use the immutable create command",
  invoices:
    "Invoice issuance is workflow-owned and provider status advances only from the verified Stripe webhook",
  commissions: "Statement and settlement run through the commission workflow",
};

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
  // Nothing here says whether the quote continues service the customer already
  // buys, and nothing should until renewal price protection has a call site
  // that can resolve the governing paper. An optional `renewalOfOrderId` was
  // tried and rejected: a protection that only binds the callers who volunteer
  // it binds nobody.
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

const ProcurementPortalStatusSchema = z.enum([
  "not_required",
  "not_started",
  "in_progress",
  "complete",
  "blocked",
]);
/**
 * One entry of `procurement_profiles.exemptions`, in the shape
 * `readProcurementExemptions` reads and the daily expiry sweep
 * (`core-schedules.ts`) upserts `core_procurement_certificates` from. That
 * reader skips an entry it cannot parse rather than guessing at it, so an
 * unreadable entry is a certificate that silently does not exist: it is
 * refused here instead of written and dropped later.
 */
const ProcurementExemptionSchema = z
  .object({
    jurisdiction: z.string().trim().min(1).max(80),
    certificateDocumentId: z.uuid(),
    expiresOn: z.iso.date().nullable().default(null),
  })
  .strict();
/** One entry of `procurement_profiles.supplier_documents`. */
const ProcurementDocumentSchema = z
  .object({
    kind: z.enum(["w9", "w8", "coi", "bank_verification", "other"]),
    documentId: z.uuid(),
    furnishedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
/** `create` is the only command that writes a whole profile. */
const ProcurementCreateCommandSchema = z
  .object({
    accountId: z.uuid().optional(),
    poRequired: z.boolean().default(false),
    supplierPortalStatus: ProcurementPortalStatusSchema.default("not_required"),
    exemptions: z.array(ProcurementExemptionSchema).default([]),
    supplierDocuments: z.array(ProcurementDocumentSchema).default([]),
  })
  .strict();
/**
 * `update` patches the keys it names. An absent key is not an instruction to
 * empty the column: a caller changing the purchase-order policy does not carry
 * the exemption certificates with it, and before P0-60 that omission deleted
 * them.
 */
const ProcurementUpdateCommandSchema = z
  .object({
    accountId: z.uuid().optional(),
    poRequired: z.boolean().optional(),
    supplierPortalStatus: ProcurementPortalStatusSchema.optional(),
    exemptions: z.array(ProcurementExemptionSchema).optional(),
    supplierDocuments: z.array(ProcurementDocumentSchema).optional(),
  })
  .strict();
const ProcurementCertificateCommandSchema = z
  .object({
    accountId: z.uuid().optional(),
    certificate: ProcurementExemptionSchema,
  })
  .strict();
const ProcurementDocumentCommandSchema = z
  .object({
    accountId: z.uuid().optional(),
    document: ProcurementDocumentSchema,
  })
  .strict();

type ProcurementExemptionEntry = z.infer<typeof ProcurementExemptionSchema>;
type ProcurementDocumentEntry = z.infer<typeof ProcurementDocumentSchema>;

/**
 * Supersession compares jurisdictions folded: "us-ca" and "US-CA" are one
 * jurisdiction holding one certificate, not two. The caller's text is what is
 * stored -- the column has no vocabulary to normalize to -- so
 * `core_procurement_cert_identity_unique` (001350), which compares the stored
 * text exactly, still reads a re-typed jurisdiction as a second certificate.
 */
function exemptionJurisdictionKey(jurisdiction: string): string {
  return jurisdiction.trim().toUpperCase();
}

/**
 * Adds one certificate to a profile's exemptions.
 *
 * The sweep identifies a certificate by its jurisdiction and document, so
 * furnishing the same document again refreshes that entry in place rather than
 * recording the certificate twice. A different document for a jurisdiction
 * already on file supersedes it: the profile answers which certificate covers
 * a jurisdiction, and a superseded document left in the array is swept every
 * morning and chased for a replacement that has already arrived. Nothing else
 * retires an entry, so this is the only place that supersession can happen.
 */
function appendExemptionCertificate(
  existing: readonly ProcurementExemptionEntry[],
  added: ProcurementExemptionEntry,
): ProcurementExemptionEntry[] {
  const key = exemptionJurisdictionKey(added.jurisdiction);
  const supersededAt = existing.findIndex(
    (entry) => exemptionJurisdictionKey(entry.jurisdiction) === key,
  );
  if (supersededAt === -1) return [...existing, added];
  return existing.flatMap((entry, position) =>
    position === supersededAt
      ? [added]
      : exemptionJurisdictionKey(entry.jurisdiction) === key
        ? []
        : [entry],
  );
}

/**
 * Records one furnished supplier document.
 *
 * A document is identified by itself: furnishing the same document again
 * refreshes when it was furnished. A second document of the same kind is kept
 * rather than superseding the first, because a furnished document is evidence
 * on file and nothing sweeps these for replacement -- unlike an exemption
 * certificate, where two live entries for one jurisdiction are two answers to
 * the same question.
 */
function appendSupplierDocument(
  existing: readonly ProcurementDocumentEntry[],
  added: ProcurementDocumentEntry,
): ProcurementDocumentEntry[] {
  const replacedAt = existing.findIndex(
    (entry) => entry.documentId === added.documentId,
  );
  if (replacedAt === -1) return [...existing, added];
  return existing.map((entry, position) =>
    position === replacedAt ? added : entry,
  );
}

/**
 * A document the caller does not date was furnished by the command that
 * carries it. Persisted entries are never restamped, so a document already on
 * file keeps the date it arrived with.
 */
function furnishedDocument(
  document: ProcurementDocumentEntry,
  occurredAt: string,
): ProcurementDocumentEntry {
  return { ...document, furnishedAt: document.furnishedAt ?? occurredAt };
}

/** The identity the expiry sweep upserts a durable certificate row on. */
function exemptionCertificateKey(entry: ProcurementExemptionEntry): string {
  return `${exemptionJurisdictionKey(entry.jurisdiction)}:${entry.certificateDocumentId}`;
}

/**
 * The rule the sweep applies, applied to the certificates a command
 * introduces: a certificate that has already lapsed is not evidence of an
 * exemption, and filing one would raise a collection chase the morning after
 * it was accepted. Certificates already on file are not re-judged here -- a
 * profile is amended around a lapsed certificate, not held hostage by it.
 */
function assertCertificatesNotLapsed(
  added: readonly ProcurementExemptionEntry[],
  asOfDate: string,
): void {
  const lapsed = assessExemptionCertificates(added, asOfDate).find(
    (assessment) => assessment.status === "expired",
  );
  if (lapsed)
    throw new CoreServiceError(
      "INVALID_STATE",
      `Exemption certificate for ${lapsed.jurisdiction} expired on ${lapsed.expiresOn ?? "an unknown date"} and cannot be recorded`,
    );
}

/**
 * The five account commands, one payload shape each.
 *
 * Strict, because the failure this replaces was a payload whose keys nobody
 * looked at: `{ role: "partner" }` was accepted, audited as
 * `core.accounts.add_role`, and dropped. An unrecognised key is now an answer.
 */
const AccountRoleCommandSchema = z
  .object({
    role: CommercialRoleSchema,
    source: z.enum(["self_declared", "verified", "operator"]).optional(),
    effectiveFrom: z.iso.date().optional(),
  })
  .strict();
const AccountContactCommandSchema = z
  .object({
    kind: z.enum([
      "billing",
      "accounts_payable",
      "remit_to",
      "tax",
      "procurement",
      "commercial",
      "technical",
    ]),
    name: z.string().min(1).max(255),
    email: z.email().max(320),
    title: z.string().min(1).max(255).optional(),
    phone: z.string().min(1).max(64).optional(),
    isPrimary: z.boolean().default(false),
    receivesInvoices: z.boolean().default(false),
  })
  .strict();
const AccountPaymentTermsCommandSchema = z
  .object({
    collectionMethod: z.enum(["prepay", "auto_charge", "net_terms"]),
    paymentRail: z.enum([
      "card",
      "ach_debit",
      "wire",
      "sepa_credit",
      "bacs",
      "marketplace",
    ]),
    termsDays: z.int().min(1).max(365).optional(),
    dunningPolicyVersion: z.string().min(1).max(64).optional(),
    requirePo: z.boolean().optional(),
    consolidatePartnerInvoices: z.boolean().optional(),
  })
  .strict();
const AccountPartnerCreditCommandSchema = z
  .object({ creditLimit: MoneySchema })
  .strict();

/**
 * Account commands that write service-owned finance configuration.
 *
 * Each of the three writes state whose row policy is `app_is_internal()` or
 * whose meaning depends on it not being self-set. `mutateWithReplay` runs them
 * on the service pool and refuses them to anyone who is not internal staff;
 * `create`, `update` and `add_contact` stay on the tenant transaction, where an
 * account maintaining its own legal name, invoice address and payables contact
 * is ordinary self-service.
 */
const internalAccountCommands = new Set([
  "add_role",
  "set_payment_terms",
  "set_partner_credit",
]);

function accountCommand<Schema extends z.ZodType>(
  schema: Schema,
  input: CoreMutation,
): z.infer<Schema> {
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success)
    throw new CoreServiceError(
      "INVALID_STATE",
      `Account ${input.action} payload is invalid`,
    );
  return parsed.data;
}

function procurementCommand<Schema extends z.ZodType>(
  schema: Schema,
  input: CoreMutation,
): z.infer<Schema> {
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success)
    throw new CoreServiceError(
      "INVALID_STATE",
      `Procurement ${input.action} payload is invalid`,
    );
  return parsed.data;
}

/** Signed price content arrives under EXT-COMMERCIAL-01; this carries it. */
const RateCardCommandSchema = z
  .object({
    id: z.uuid().optional(),
    sku: z.string().min(1).max(80),
    region: z.string().min(1).max(80),
    unit: z.string().min(1).max(40),
    approvedClaim: z.string().min(1).max(500),
    unitPrice: MoneySchema,
    floorPrice: MoneySchema.optional(),
    overageRate: MoneySchema,
    minimumQuantity: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/),
    trialLimit: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/)
      .optional(),
    egressTreatment: z.string().min(1).max(40),
    commitType: z.enum(["period_allowance", "term_drawdown"]),
    stripeTaxCode: z.string().min(1).max(80),
    qboIncomeAccount: z.string().min(1).max(120),
    partnerTransferPrices: z.record(z.string(), MoneySchema).default({}),
  })
  .strict();

/** Every price-book decision is reason-bound; the reason reaches the audit. */
const PriceBookDecisionCommandSchema = z
  .object({ reason: z.string().min(8).max(1_000) })
  .strict();

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

/**
 * The order as it stands NOW: the immutable accepted-order snapshot with every
 * amendment already accepted for it folded back on.
 *
 * `persistedAcceptedOrder` reads `core_order_line_snapshots`, which is immutable
 * and correctly so — it is the priced evidence the customer signed — and
 * therefore states the order as ORDERED, not as amended. Judging a new amendment
 * against it compares it to the original order rather than to the current one,
 * so a run of downgrades each sees the original quantity and none of them ever
 * runs out of it. Four further -1 amendments on one line drove committed
 * quantity and revenue negative without limit.
 *
 * The full-period figures come from `amendment_lines`, which is where the writer
 * puts the unprorated contractual delta precisely so it can be re-read without
 * dividing anything back out. `core_amendment_line_supersessions` carries the
 * PRORATED delta and is the wrong source for a line total. The fold itself is
 * `amendOrderState`, which sums the signed deltas addressed to each line onto
 * that line's ordered figures.
 *
 * The rows are read UNORDERED and are deliberately not sorted. The fold is a
 * sum of signed values, so no ordering changes its result; the only thing an
 * ordering can change is which intermediate values a step-by-step check would
 * visit, and those are not states this order was ever in. A previous round
 * sorted by `(effective_on, id)` and floored quantity at every step, which
 * refused any order that had accepted an amendment backdated behind an earlier
 * one — a refusal raised while computing the BASELINE, so it did not refuse one
 * amendment, it refused every future amendment for that order. `amendOrderState`
 * carries the reasoning; the only thing this reader has to get right is not
 * imposing a sequence the data does not have.
 *
 * The order's service window is deliberately NOT folded. A term extension's
 * `resulting_service_ends_on` is not written back to `orders.service_ends_on` by
 * any writer, and 001390 requires an amendment's financial terms to span exactly
 * `orders.service_ends_on`; carrying a longer window here would make the next
 * amendment's own terms unwritable. The window this returns is the one the
 * database will check against.
 *
 * THE INGREDIENTS OF THE FOLD ARE RETURNED ALONGSIDE ITS RESULT, and that is
 * the whole reason this returns a record rather than an order.
 *
 * `current` is the order as it stands, which is what a new amendment is drafted
 * and priced against. It is NOT a sound base to fold a second time, because
 * folding is not idempotent in the one place it matters: `amendOrderState`
 * counts the revenue of lines an amendment ADDED but cannot return them — an
 * added line has no `order_lines` row and no later amendment can address one —
 * so `current` states the order's own lines and drops the added revenue. Fold
 * `current` again and that revenue is gone from the total the floor judges. An
 * order that swapped a line out for a more valuable replacement is comfortably
 * in the black and reads as deeply negative, and every subsequent amendment,
 * down to a term extension moving no money at all, is refused.
 *
 * So the caller gets `ordered` and `persisted` too and folds ONCE, over the
 * immutable snapshot with the persisted amendments and the new one together.
 * Same per-line sums, because addition is associative; correct committed
 * revenue, because the added lines are in scope for the only pass that judges
 * it. The composition gap is removed rather than compensated for.
 */
interface AmendableOrderState {
  /** The order as it stands now, for drafting and pricing a new amendment. */
  readonly current: AcceptedOrder;
  /** The immutable accepted-order snapshot: the order as ORDERED. */
  readonly ordered: AcceptedOrder;
  /** Every amendment already accepted for this order, deliberately unordered. */
  readonly persisted: readonly AmendmentDeltaSet[];
}

async function currentAmendedOrder(
  transaction: RuntimeTransaction,
  orderId: string,
): Promise<AmendableOrderState> {
  const ordered = await persistedAcceptedOrder(transaction, orderId);
  const accepted = await transaction
    .select({
      id: amendments.id,
      effectiveOn: amendments.effectiveOn,
      orderLineId: amendmentLines.orderLineId,
      sku: amendmentLines.sku,
      quantityDelta: amendmentLines.quantityDelta,
      priceDeltaMinor: amendmentLines.priceDeltaMinor,
    })
    .from(amendments)
    .innerJoin(amendmentLines, eq(amendmentLines.amendmentId, amendments.id))
    .where(eq(amendments.orderId, orderId));
  if (accepted.length === 0)
    return { current: ordered, ordered, persisted: [] };
  const currency = ordered.lines[0]?.unitPrice.currency;
  if (!currency)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Accepted order snapshots are incomplete",
    );
  const grouped = new Map<
    string,
    { id: string; effectiveOn: string; deltas: AmendmentDelta[] }
  >();
  for (const row of accepted) {
    const set = grouped.get(row.id) ?? {
      id: row.id,
      effectiveOn: row.effectiveOn,
      deltas: [],
    };
    set.deltas.push({
      sku: row.sku,
      quantityDelta: row.quantityDelta,
      fullPeriodPriceDelta: MoneySchema.parse({
        currency,
        minor: row.priceDeltaMinor.toString(),
      }),
      ...(row.orderLineId ? { orderLineId: row.orderLineId } : {}),
    });
    grouped.set(row.id, set);
  }
  const persisted = [...grouped.values()];
  try {
    return { current: amendOrderState(ordered, persisted), ordered, persisted };
  } catch (error) {
    // Only reachable when the SUM of the persisted deltas leaves the order at a
    // negative committed quantity or a negative committed revenue. Every
    // acceptance checks that same folded state for itself before it writes, so
    // no sequence of amendments accepted through this path can land here; a row
    // that does was written around the writer. The order's current state is
    // therefore not something to judge a new amendment against, and this fails
    // rather than falling back to the snapshot and billing off it.
    throw new CoreServiceError(
      "INVALID_STATE",
      `Order's persisted amendment deltas do not sum onto its lines: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Persists everything an accepted amendment moves. `createAmendment` has
 * already derived the quantity, full-period and prorated deltas; this writes
 * them where the readers look for them: `amendment_lines` for the contractual
 * delta lines, `core_amendment_financial_terms` for the proration those deltas
 * were billed at and the forecast they move, and one
 * `core_amendment_line_supersessions` row per replaced order line for the
 * invoice derivation. It belongs to the transaction that writes the header —
 * an order that carries the header and none of the money bills an amount
 * nobody signed.
 *
 * `amendment_lines.price_delta_minor` holds the FULL-PERIOD delta and the
 * supersession holds the PRORATED one. Division loses information, so the
 * unprorated figure is stored once and the billable figure is recoverable from
 * it through the billable fraction on the financial terms.
 */
async function persistAmendmentMoney(
  transaction: RuntimeTransaction,
  input: {
    amendment: CommercialAmendment;
    order: AcceptedOrder;
    contractualTimeZone: string;
    billingMonths: number;
  },
): Promise<void> {
  const { amendment, order } = input;
  const periodEndsOn = order.serviceEndsOn;
  const currency = order.lines[0]?.unitPrice.currency;
  if (!periodEndsOn || !currency)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Amendment money requires a terminated order with priced lines",
    );
  const fraction = prorationFraction({
    method: amendment.prorationMethod,
    effectiveOn: amendment.effectiveOn,
    periodStartsOn: order.serviceStartsOn,
    periodEndsOn,
  });
  // billable_numerator and billable_denominator are integer columns; a day or
  // month count that does not fit is a corrupt term, not a rounding problem.
  if (
    fraction.numerator > BigInt(Number.MAX_SAFE_INTEGER) ||
    fraction.denominator > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new CoreServiceError(
      "INVALID_STATE",
      "Amendment proration period is out of range",
    );
  const fullPeriodDeltaMinor = amendment.deltas.reduce(
    (total, delta) => total + BigInt(delta.fullPeriodPriceDelta.minor),
    0n,
  );
  const forecastDeltaMinor = amendment.deltas.reduce(
    (total, delta) => total + BigInt(delta.proratedPriceDelta.minor),
    0n,
  );

  if (amendment.deltas.length > 0)
    await transaction.insert(amendmentLines).values(
      amendment.deltas.map((delta) => ({
        amendmentId: amendment.id,
        ...(delta.orderLineId ? { orderLineId: delta.orderLineId } : {}),
        sku: delta.sku,
        quantityDelta: delta.quantityDelta,
        priceDeltaMinor: BigInt(delta.fullPeriodPriceDelta.minor),
      })),
    );

  await transaction.insert(amendmentFinancialTerms).values({
    amendmentId: amendment.id,
    contractualTimeZone: input.contractualTimeZone,
    prorationConvention: fraction.convention,
    periodStartsOn: order.serviceStartsOn,
    periodEndsOn,
    billableNumerator: Number(fraction.numerator),
    billableDenominator: Number(fraction.denominator),
    currency,
    forecastDeltaMinor,
    // core_revenue_forecast (000900:307) adds this to every forecast month at
    // or after the effective month, so it is the run-rate change: the
    // full-period delta over the same billing months the base total is spread
    // across.
    monthlyDeltaMinor: divideRound(
      fullPeriodDeltaMinor,
      BigInt(input.billingMonths),
    ),
  });

  if (amendment.supersededLineIds.length === 0) return;
  // The line is marked before the supersession is written: 001390 holds a
  // supersession to an order line that already names its amendment, so the
  // mark is a precondition of the money row rather than a follow-up to it.
  await transaction
    .update(orderLines)
    .set({ supersededByAmendmentId: amendment.id })
    .where(
      and(
        eq(orderLines.orderId, amendment.orderId),
        inArray(orderLines.id, [...amendment.supersededLineIds]),
      ),
    );
  // The replacement each superseded line resolves to is the domain's answer,
  // not a second one assembled here.
  const amended = applyAmendment(order, amendment);
  const replacements = new Map(amended.lines.map((line) => [line.id, line]));
  await transaction.insert(amendmentLineSupersessions).values(
    amendment.supersededLineIds.map((orderLineId) => {
      const delta = amendment.deltas.find(
        (candidate) => candidate.orderLineId === orderLineId,
      );
      const replacement = replacements.get(`${amendment.id}:${orderLineId}`);
      if (!delta || !replacement)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Amendment supersedes an order line it carries no delta for",
        );
      return {
        amendmentId: amendment.id,
        supersededOrderLineId: orderLineId,
        replacementSnapshot: replacement,
        effectiveOn: amendment.effectiveOn,
        netQuantityDelta: delta.quantityDelta,
        netRevenueDeltaMinor: BigInt(delta.proratedPriceDelta.minor),
      };
    }),
  );
}

/**
 * The net revenue every amendment already accepted for this order adds to the
 * invoice that covers its service window, signed.
 *
 * Effective dating: these writers issue the one term invoice for an order and
 * bill its whole contracted period, so the invoiced period is the order's
 * service window and `createAmendment` has already refused any effective date
 * outside it. What is left open is the moment: an amendment accepted after an
 * invoice was written does not rewrite an issued financial fact. So an invoice
 * carries exactly the amendments persisted for its order when it is written,
 * and the domain's own net — the prorated delta `netForecast` sums and the
 * amendment document's `netChange` — is the amount.
 *
 * OPEN, and deliberately not decided here: the difference is DETECTED and not
 * settled. The customer is still billed the old amount and nothing moves the
 * gap. A post-invoice downgrade owes a credit note; a post-invoice upgrade owes
 * a supplementary invoice. `credit_notes` exists and no writer issues one for
 * this case, and `invoices` cannot express a second bill for one order at all.
 * That is a commercial policy nobody has stated, so it is named rather than
 * invented; 001393 records the same thing beside the constraint that makes the
 * issued row stable.
 *
 * What detects it is `core_invoice_amendment_drift` (001394):
 * `unbilled_amendment_delta_minor` is this same sum less the immutable
 * `invoices.amendment_delta_minor` the row was written with, which is exactly
 * the amendment value accepted after the bill went out and is zero when nothing
 * has moved.
 *
 * It is NOT `deriveInvoice`'s `varianceMinor` / `INVOICE_TOTAL_VARIANCE`, which
 * this comment used to claim. That comparison was already saturated before any
 * amendment landed — it put a net derived total against a gross invoiced one,
 * measured at -202830 on the taxed fixture while the amendment it was supposed
 * to reveal was worth -9148 — and a second basis mismatch in it is still
 * unfixed. 001394 records both. Nothing should read that note as an amendment
 * signal.
 *
 * The sum is over `core_amendment_financial_terms.forecast_delta_minor`, which
 * 001393 requires the invoice's stored `amendment_delta_minor` to equal at the
 * moment it is inserted, so the writer and the constraint can never reach
 * different totals — and requires the AMOUNT to agree with that stored figure
 * for the rest of the row's life, so a later amendment cannot make an issued
 * invoice fail its own constraint and block every settlement write against it.
 *
 * An amendment carrying no financial terms adds nothing, because there is no
 * fraction to price its delta lines through and therefore no billable figure to
 * add — `amendment_lines` alone states a full-period delta, not an amount owed.
 * No code path can produce that row: `mutateAmendment` writes the terms in the
 * transaction that writes the header. What it cannot add and will not ignore is
 * the half-persisted case, a supersession the derivation bills from with no
 * terms behind it; that is a corrupt order and it fails rather than bills.
 *
 * The forecast delta covers every delta line, including one that adds a SKU
 * rather than replacing a line. `deriveInvoice` can only attribute the ones
 * that supersede a line, because `core_amendment_line_supersessions` is the
 * only amendment row its input carries, so an added line bills correctly and
 * shows up as a derivation variance until the derivation input grows a channel
 * for it. Billing it is not optional; naming it in the derivation is the gap.
 */
export async function acceptedAmendmentDeltaMinor(
  transaction: RuntimeTransaction,
  order: { id: string; serviceStartsOn: string; serviceEndsOn: string | null },
  currency: string,
): Promise<bigint> {
  const rows = await transaction
    .select({
      id: amendments.id,
      effectiveOn: amendments.effectiveOn,
      currency: amendmentFinancialTerms.currency,
      forecastDeltaMinor: amendmentFinancialTerms.forecastDeltaMinor,
    })
    .from(amendments)
    .leftJoin(
      amendmentFinancialTerms,
      eq(amendmentFinancialTerms.amendmentId, amendments.id),
    )
    .where(eq(amendments.orderId, order.id));
  if (rows.length === 0) return 0n;
  const unpriced = rows
    .filter((row) => row.forecastDeltaMinor === null)
    .map((row) => row.id);
  if (unpriced.length > 0) {
    const orphaned =
      await transaction.query.amendmentLineSupersessions.findMany({
        where: inArray(amendmentLineSupersessions.amendmentId, unpriced),
        columns: { id: true },
      });
    if (orphaned.length > 0)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Order carries a supersession with no persisted amendment financial terms",
      );
  }
  return rows.reduce((total, row) => {
    if (row.forecastDeltaMinor === null || row.currency === null) return total;
    if (row.currency !== currency)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Amendment currency does not match the invoiced order",
      );
    if (
      !order.serviceEndsOn ||
      row.effectiveOn < order.serviceStartsOn ||
      row.effectiveOn > order.serviceEndsOn
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        "Amendment takes effect outside the invoiced service period",
      );
    return total + row.forecastDeltaMinor;
  }, 0n);
}

/** One invoice's row of `core_invoice_amendment_drift` (001394). */
export interface InvoiceAmendmentDrift {
  /** The net amendment delta the invoice was written with. Frozen and immutable. */
  billedAmendmentDeltaMinor: bigint;
  /** The net amendment delta accepted for the order right now. */
  acceptedAmendmentDeltaMinor: bigint;
  /**
   * The signed difference, and exactly the amendment value accepted after the
   * bill went out. Zero when nothing has moved. Negative owes the customer a
   * credit note; positive owes a supplementary invoice; neither writer exists.
   */
  unbilledAmendmentDeltaMinor: bigint;
}

/**
 * Whether an amendment landed after this invoice was written, and for how much.
 *
 * The two figures it differences are both exact and both already at rest: the
 * immutable `invoices.amendment_delta_minor` 001393 froze onto the row, and the
 * live sum of `core_amendment_financial_terms.forecast_delta_minor` the 001393
 * insert check required it to equal at that moment. Nothing is inferred, no tax
 * enters it, and it reads zero — not "small" — while the bill and the order
 * agree.
 *
 * Read it, and not `deriveInvoice`'s `INVOICE_TOTAL_VARIANCE`, for this
 * question. 001394 records what is wrong with that note and why fixing the rest
 * of it is a separate decision.
 *
 * A reader, not a control. Nothing here refuses a write.
 */
export async function invoiceAmendmentDrift(
  transaction: RuntimeTransaction,
  invoiceId: string,
): Promise<InvoiceAmendmentDrift> {
  const rows = await transaction.execute<{
    billed_amendment_delta_minor: string | number | bigint;
    accepted_amendment_delta_minor: string | number | bigint;
    unbilled_amendment_delta_minor: string | number | bigint;
  }>(sql`
    select billed_amendment_delta_minor,
           accepted_amendment_delta_minor,
           unbilled_amendment_delta_minor
      from public.core_invoice_amendment_drift
     where invoice_id = ${invoiceId}::uuid
  `);
  const row = rows[0];
  if (!row) throw new CoreServiceError("NOT_FOUND", "Invoice was not found");
  return {
    billedAmendmentDeltaMinor: BigInt(row.billed_amendment_delta_minor),
    acceptedAmendmentDeltaMinor: BigInt(row.accepted_amendment_delta_minor),
    unbilledAmendmentDeltaMinor: BigInt(row.unbilled_amendment_delta_minor),
  };
}

/**
 * The identity of an order's invoice is the order. `invoices` carries no
 * billing period, no sequence and no parent invoice, and the projection trigger
 * (000920:65, rewritten at 001390) requires every row on an order to state the
 * same account, currency, PO and amount — the quote total plus the order's
 * accepted amendments. A second row is therefore not a second period or a
 * partial bill, which the table cannot express; it is the same bill twice.
 * Everything that moves money after the invoice exists moves it against the row
 * that exists: partial settlement in `amount_paid_minor` (001340), overage in
 * `invoice_adjustments`, a reduction in `credit_notes`, and `consolidateInvoices`
 * folds several orders into one invoice rather than one order into several.
 *
 * Deriving the identifier is what holds that, not a lookup before the insert.
 * The two writers — this repository and `ensureInvoiceDraftForProvisionedOrder`
 * — run in separate READ COMMITTED transactions where neither sees the other's
 * uncommitted insert, so a caller-supplied identifier still admits two invoices
 * however carefully each writer looks first. A derived one makes `invoices_pkey`
 * the row both writers contend for.
 *
 * A unique index on `order_id` was the alternative. It says something stronger
 * than the defect: it also forbids ever re-billing an order whose only invoice
 * was voided, which the `void` status admits and no writer does today. This
 * fix closes the duplicate without deciding that question, and it closes it for
 * the workflow writer too, which the index would not have — the workflow was
 * already deriving this identifier and the disagreement was the defect.
 */
export function initialInvoiceId(orderId: string): string {
  const bytes = Buffer.from(
    createHash("sha256")
      .update("initial-invoice")
      .update("\0")
      .update(orderId)
      .digest(),
  ).subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * What the tax provider answered about one billable net, resolved before the
 * command's transaction opens. A provider call inside the write transaction
 * would hold the order's and the invoice's row locks across the network, so the
 * determination is fetched first and re-checked against the net the transaction
 * actually computes; a determination that no longer describes the amount being
 * billed is refused rather than applied to a different number.
 *
 * The platform decides none of this. Which jurisdictions charge, at what rate,
 * which registrations admit reverse charge and which supplies are exempt are
 * `EXT-TAX-01` inputs, and until that gate is satisfied the only implementation
 * of the port is a repository fixture. What is repository work — the column, the
 * call, the arithmetic and the refusal — is here; the rates are not, and are not
 * defaulted to zero anywhere on this path.
 */
export interface TaxDetermination {
  currency: string;
  netMinor: bigint;
  taxMinor: bigint;
  treatment: TaxTreatment;
}

/**
 * The taxable composition of a quote, as its priced lines and their rate-card
 * tax codes. `order_lines` carries neither a line total nor a tax code, so the
 * quote is the only place both exist together, and it is the same evidence the
 * invoice's amount is derived from.
 *
 * `soleTaxCode` is absent when the lines disagree. An amendment delta is a
 * single amount against the whole order and there is no rule here for splitting
 * it across codes, so a mixed-code order with an amendment is refused at the
 * caller instead of being taxed at whichever code happened to sort first.
 */
async function taxableQuoteLines(
  transaction: RuntimeTransaction,
  quoteId: string,
  currency: string,
): Promise<{
  lines: readonly {
    taxCode: string;
    amount: { currency: string; minor: string };
  }[];
  netMinor: bigint;
  soleTaxCode?: string;
}> {
  const rows = await transaction
    .select({
      taxCode: rateCards.stripeTaxCode,
      lineTotalMinor: quoteLines.lineTotalMinor,
    })
    .from(quoteLines)
    .innerJoin(rateCards, eq(rateCards.id, quoteLines.rateCardId))
    .where(eq(quoteLines.quoteId, quoteId));
  if (rows.length === 0)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Quote carries no priced lines to determine tax against",
    );
  const codes = new Set(rows.map((row) => row.taxCode));
  const sole = codes.size === 1 ? [...codes][0] : undefined;
  return {
    lines: rows.map((row) => ({
      taxCode: row.taxCode,
      amount: { currency, minor: row.lineTotalMinor.toString() },
    })),
    netMinor: rows.reduce((total, row) => total + row.lineTotalMinor, 0n),
    ...(sole ? { soleTaxCode: sole } : {}),
  };
}

/** What a determination is made against, before any provider has answered. */
interface TaxBasis {
  accountId: string;
  jurisdiction: string;
  currency: string;
  netMinor: bigint;
  lines: readonly {
    taxCode: string;
    amount: { currency: string; minor: string };
  }[];
}

async function quoteTaxBasis(
  transaction: RuntimeTransaction,
  quote: {
    accountId: string;
    jurisdiction: string;
    quoteId: string;
    currency: string;
    totalMinor: bigint;
  },
): Promise<TaxBasis> {
  const composition = await taxableQuoteLines(
    transaction,
    quote.quoteId,
    quote.currency,
  );
  if (composition.netMinor !== quote.totalMinor)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Quote line totals do not sum to the quote total",
    );
  return {
    accountId: quote.accountId,
    jurisdiction: quote.jurisdiction,
    currency: quote.currency,
    netMinor: composition.netMinor,
    lines: composition.lines,
  };
}

/**
 * The taxable basis of an order's one invoice: its accepted quote's lines plus
 * the signed net delta of every amendment accepted on it, in the jurisdiction
 * of the account that is invoiced rather than the account that is served.
 */
async function orderTaxBasis(
  transaction: RuntimeTransaction,
  orderId: string,
): Promise<TaxBasis> {
  const order = await transaction.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });
  if (!order)
    throw new CoreServiceError("NOT_FOUND", "Billable order was not found");
  const [quote, invoicedAccount] = await Promise.all([
    transaction.query.quotes.findFirst({
      where: and(eq(quotes.id, order.quoteId), eq(quotes.status, "accepted")),
    }),
    transaction.query.accounts.findFirst({
      where: eq(accounts.id, order.invoicingAccountId),
      columns: { id: true, country: true },
    }),
  ]);
  if (!quote || !invoicedAccount)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Invoice drafts require an immutable accepted order and quote",
    );
  const basis = await quoteTaxBasis(transaction, {
    accountId: invoicedAccount.id,
    jurisdiction: invoicedAccount.country,
    quoteId: quote.id,
    currency: quote.currency,
    totalMinor: quote.totalMinor,
  });
  // Amendments move the amount owed, so they move the amount taxed. The delta
  // is one signed figure for the whole order; attributing it needs a tax code,
  // and the only defensible one is the code the order already bills every line
  // under.
  const amendmentDeltaMinor = await acceptedAmendmentDeltaMinor(
    transaction,
    order,
    quote.currency,
  );
  if (amendmentDeltaMinor === 0n) return basis;
  const composition = await taxableQuoteLines(
    transaction,
    quote.id,
    quote.currency,
  );
  if (!composition.soleTaxCode)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Amended order carries mixed tax codes; the amendment delta cannot be attributed to one",
    );
  return {
    ...basis,
    netMinor: basis.netMinor + amendmentDeltaMinor,
    lines: [
      ...basis.lines,
      {
        taxCode: composition.soleTaxCode,
        amount: {
          currency: quote.currency,
          minor: amendmentDeltaMinor.toString(),
        },
      },
    ],
  };
}

/**
 * Asks the provider and refuses anything it cannot use. A provider failure is a
 * refusal, never a zero: `ok: false` is the provider saying it does not know,
 * and billing zero because a network call failed is exactly the wrong number
 * this path exists to prevent.
 */
async function determineTax(
  tax: TaxPort,
  basis: TaxBasis,
): Promise<TaxDetermination> {
  const calculated = await tax.calculate({
    accountId: ids.account.parse(basis.accountId),
    jurisdiction: basis.jurisdiction,
    lines: basis.lines.map((line) => ({
      taxCode: line.taxCode,
      amount: MoneySchema.parse(line.amount),
    })),
  });
  if (!calculated.ok)
    throw new CoreServiceError(
      "INVALID_STATE",
      `Tax could not be determined for jurisdiction ${basis.jurisdiction} (EXT-TAX-01): ${calculated.code}`,
    );
  if (calculated.value.tax.currency !== basis.currency)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Tax was determined in a currency the order does not bill in",
    );
  const taxMinor = BigInt(calculated.value.tax.minor);
  // Mirrors invoices_tax_amount_check. A provider that charges against a
  // reverse-charged or exempt supply is answering inconsistently, and the
  // command fails here with a message that names the inconsistency rather than
  // surfacing a raw constraint violation from the insert.
  if (calculated.value.treatment !== "standard" && taxMinor !== 0n)
    throw new CoreServiceError(
      "INVALID_STATE",
      "Tax was charged against a reverse-charged or exempt supply",
    );
  return {
    currency: basis.currency,
    netMinor: basis.netMinor,
    taxMinor,
    treatment: calculated.value.treatment,
  };
}

/**
 * The determination for an order's invoice, for a caller that is not running a
 * Core command — `ensureInvoiceDraftForProvisionedOrder` is the other writer of
 * the same row and must reach the same figure by the same rule. The reads run
 * in their own short transaction and the provider is called outside it, so no
 * write transaction ever holds a row lock across the network; the caller
 * re-checks `netMinor` against the net it computes for itself.
 */
export async function orderTaxDetermination(input: {
  database: RuntimeDatabase;
  tax: TaxPort;
  requestId: string;
  orderId: string;
}): Promise<TaxDetermination> {
  const basis = await withInternalTransaction(
    input.database,
    input.requestId,
    (transaction) => orderTaxBasis(transaction, input.orderId),
  );
  return determineTax(input.tax, basis);
}

export interface DatabaseCoreFinanceRepositoryOptions {
  database: RuntimeDatabase;
  pricingDatabase: RuntimeDatabase;
  authorizationSecret: string;
  /**
   * Required, not optional. An optional tax source is a source that is absent
   * in production and silently zero everywhere else, which is the defect. A
   * composition that cannot name one cannot build this repository, and the
   * production composition can only name one once `EXT-TAX-01` supplies the
   * endpoint and credential it needs.
   */
  tax: TaxPort;
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

/**
 * One page of a §17 report view.
 *
 * Same shape as `CoreFinanceRepository.readInternalReport`, for the views that
 * arrived after it: the relation and the account column are chosen from
 * `coreReportSources`, never from caller input, and the offset and limit are
 * clamped the same way, so nothing here interpolates a value a caller supplied.
 */
async function readReportView(
  transaction: RuntimeTransaction,
  source: { relation: string; accountColumn?: string },
  options: { limit: number; offset: number; accountId?: string },
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const limit = Math.min(Math.max(options.limit, 1), 101);
  const offset = Math.min(Math.max(options.offset, 0), 10_000);
  const view = sql.identifier(source.relation);
  return source.accountColumn && options.accountId
    ? transaction.execute(
        sql`select * from ${view} where ${sql.identifier(source.accountColumn)} = ${options.accountId} limit ${limit} offset ${offset}`,
      )
    : transaction.execute(
        sql`select * from ${view} limit ${limit} offset ${offset}`,
      );
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

function priceBookAudit(
  input: CoreMutation,
  book: { id: string; rowVersion: number },
  eventType: string,
): CoreMutationAudit {
  return {
    aggregateType: "price_book",
    aggregateId: book.id,
    aggregateVersion: book.rowVersion,
    eventType,
    actor: input.actor,
    requestId: input.requestId,
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
    // Sequenced after the acceptance context rather than beside it: which
    // account is invoiced — and therefore whose jurisdiction the determination
    // is made in — is the resale/distributor answer that context already
    // resolved, and re-deriving it here would be a second place for it to
    // disagree.
    const taxDetermination = await this.loadTaxDetermination(
      input,
      orderAcceptanceContext,
    );
    const run = (transaction: RuntimeTransaction) =>
      this.mutateIdempotently(
        transaction,
        input,
        confidentialPriceBook,
        dealRegistrationContext,
        quoteCommercialContext,
        orderAcceptanceContext,
        commissionContext,
        taxDetermination,
      );
    // The commitment ledger, its periods, and its corrections are deliberately
    // not writable by the tenant runtime role. Metering runs on the service
    // connection; the account binding of every commitment command is checked
    // against persisted order ownership rather than left to row policies.
    // A price book belongs to no account, so its row policies admit the service
    // connection alone and there is no ownership for a row policy to check.
    // Finance authority, the two-authority record, and the pricing guardrails
    // carry the authorization instead, every one of them before any write.
    // The internal branch therefore runs on the service pool. `database` is the
    // tenant-facing runtime pool: it authenticates as clockwork_runtime, which
    // is not a member of clockwork_service, so opening an internal transaction
    // on it raises SQLSTATE 42501 rather than escalating.
    // Three account commands write the same kind of state. A relationship role,
    // a billing policy and an aggregate credit limit are finance configuration,
    // not customer self-service: `core_account_roles_write` and
    // `core_billing_policy_write` admit the service connection alone, the
    // tenant role holds SELECT and nothing else on either table, and a credit
    // limit an account sets for itself is not a credit limit. They therefore
    // run on the service pool for the same reason `price_books` does, and carry
    // the authorization in code -- the refusal below, before any transaction is
    // opened. It turns away exactly the callers the two row policies already
    // turn away, and no portal surface offers any of the three (`actionsFor`
    // renders none of them), so nothing legitimate is inside it.
    const serviceOwnedAccountCommand =
      input.resource === "accounts" &&
      internalAccountCommands.has(input.action);
    if (serviceOwnedAccountCommand && !input.authorization.isInternalStaff)
      throw new CoreServiceError(
        "INVALID_STATE",
        `Account ${input.action} is internal finance configuration`,
      );
    return input.resource === "commitments" ||
      input.resource === "price_books" ||
      serviceOwnedAccountCommand
      ? withInternalTransaction(
          this.options.pricingDatabase,
          input.requestId,
          run,
        )
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
    taxDetermination?: TaxDetermination,
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
      taxDetermination,
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

  /**
   * Obtains the tax determination for the two commands that decide what a
   * customer owes: accepting a quote and drafting the invoice for it.
   *
   * Acceptance is gated as well as invoicing on purpose. Accepting an order the
   * platform cannot determine tax for produces a commitment it can only bill
   * net, and `EXT-TAX-01` is explicit that the correct behaviour until an
   * approved engine exists is to refuse the acceptance rather than to issue a
   * zero-tax invoice against it. Nothing is stored at acceptance — `quotes` and
   * `orders` carry no tax column and a determination made months before the
   * bill would be stale anyway; the acceptance call proves a determination is
   * obtainable, and the invoice call is the one whose answer is persisted.
   */
  private async loadTaxDetermination(
    input: CoreMutation,
    orderAcceptanceContext?: OrderAcceptanceContext,
  ): Promise<TaxDetermination | undefined> {
    const accepting = input.resource === "orders" && input.action === "create";
    const invoicing =
      input.resource === "invoices" && input.action === "create";
    if (!accepting && !invoicing) return undefined;
    const orderId = invoicing
      ? string(input.payload.orderId, "orderId")
      : undefined;
    const basis = await withInternalTransaction(
      this.options.pricingDatabase,
      input.requestId,
      (transaction) => {
        if (orderId) return orderTaxBasis(transaction, orderId);
        if (!orderAcceptanceContext)
          throw new CoreServiceError(
            "INVALID_STATE",
            "Authoritative order acceptance context is unavailable",
          );
        const { quote, snapshot, buyer, partner } = orderAcceptanceContext;
        // The merchant of record bills the partner on a resale or distributor
        // route, so the jurisdiction that matters is the partner's. This is the
        // same branch loadOrderAcceptanceContext takes for billingAccountId; it
        // is read from the context rather than recomputed so the two cannot
        // drift.
        const invoiced =
          snapshot.route === "resale" || snapshot.route === "distributor"
            ? partner
            : buyer;
        if (!invoiced)
          throw new CoreServiceError(
            "INVALID_STATE",
            "Invoiced party is unresolved for the accepted route",
          );
        return quoteTaxBasis(transaction, {
          accountId: invoiced.id,
          jurisdiction: invoiced.country,
          quoteId: quote.id,
          currency: quote.currency,
          totalMinor: quote.totalMinor,
        });
      },
    );
    return determineTax(this.options.tax, basis);
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
    // A revision is priced and screened exactly as a new quote is, so it needs
    // the same persisted commercial truth behind it.
    if (
      input.resource !== "quotes" ||
      (input.action !== "create" && input.action !== "revise")
    )
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
    taxDetermination?: TaxDetermination,
  ): Promise<CoreMutationResult> {
    const implemented: readonly string[] = databaseCoreCommands[input.resource];
    if (!implemented.includes(input.action)) {
      const deferred: readonly string[] =
        workflowOwnedCoreCommands[
          input.resource as keyof typeof workflowOwnedCoreCommands
        ] ?? [];
      throw new CoreServiceError(
        "INVALID_STATE",
        unimplementedCommandReason[input.resource] ??
          (deferred.includes(input.action)
            ? `${input.resource}:${input.action} is owned by its workflow or provider boundary`
            : `${input.resource} does not implement the ${input.action} command`),
      );
    }
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
        return this.mutateOrder(
          transaction,
          input,
          orderAcceptanceContext,
          taxDetermination,
        );
      case "amendments":
        return this.mutateAmendment(transaction, input);
      case "commitments":
        return this.mutateCommitment(transaction, input);
      case "invoices":
        return this.mutateInvoice(transaction, input, taxDetermination);
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
    // The verb's own write happens first, so a payload this account cannot
    // accept never advances its version, and the touch below is what carries
    // the aggregate version the audit event is chained on.
    const command = await this.applyAccountCommand(transaction, input, prior);
    const [row] = await transaction
      .update(accounts)
      .set({ ...command.patch, updatedAt: this.now() })
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
    await command.after?.();
    return audited(
      transaction,
      input,
      coreRecord("accounts", row, row.id),
      prior,
    );
  }

  /**
   * What each account command writes.
   *
   * All five non-create verbs used to land on one patch of three optional keys
   * -- `legalName`, `invoiceDeliveryEmail`, `billingContact`. A caller sending
   * `add_role`, `add_contact`, `set_payment_terms` or `set_partner_credit` got
   * a 200, an audit event named after the verb, and a row version increment,
   * and not one of the four things they asked for was written anywhere. That is
   * worse than a refusal: a refusal is visible, and this was a receipt for work
   * nobody did.
   *
   * Each branch now writes only what its verb names. `patch` is the columns of
   * `accounts` that go with it, applied by the single versioned update in
   * `mutateAccount`; `after` is work that has to follow that update, because
   * `core_validate_finance_chain` requires the relationship-role register to
   * agree with the array column and so the register row cannot be written
   * before the array holds the role. The `default` is what a verb no branch
   * implements now gets, which `accounts` previously had no way to say.
   */
  private async applyAccountCommand(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    prior: typeof accounts.$inferSelect,
  ): Promise<{
    patch: Partial<typeof accounts.$inferInsert>;
    after?: () => Promise<void>;
  }> {
    switch (input.action) {
      case "update":
        return {
          patch: {
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
          },
        };
      case "add_role": {
        const command = accountCommand(AccountRoleCommandSchema, input);
        // `core_account_relationship_roles` is keyed on (account, role) and the
        // array column on `accounts` is what every reader parses, so both move
        // or neither does. Re-adding a role the account already holds is one of
        // the two things this refuses, and the primary key refuses it anyway --
        // this only turns a constraint violation into an answer.
        if (prior.relationshipRoles.includes(command.role))
          throw new CoreServiceError(
            "DUPLICATE",
            `Account already holds the ${command.role} role`,
          );
        // The other. `core_validate_finance_chain` requires an account holding
        // the partner role to have `approved_credit_limit_minor` equal to
        // `aggregate_credit_limit_minor`, and it checks that ON THE PROFILE.
        // Granting the role to an account whose two limits already differ is
        // therefore accepted here and fails LATER -- on the next statement to
        // touch the profile, which for a partner is
        // `core_reserve_order_acceptance` reserving exposure for an order.
        // Refusing names the fix; accepting hands someone a partner that cannot
        // accept an order and no reason why. The refusal is exactly this state,
        // and only when the role being added is `partner`: an account with no
        // commercial profile, or one whose limits already agree, is unaffected.
        if (command.role === "partner") {
          const commercial =
            await transaction.query.accountCommercialProfiles.findFirst({
              where: eq(accountCommercialProfiles.accountId, prior.id),
            });
          if (
            commercial &&
            commercial.approvedCreditLimitMinor !==
              prior.aggregateCreditLimitMinor
          )
            throw new CoreServiceError(
              "INVALID_STATE",
              `A partner account requires its approved credit limit (${commercial.approvedCreditLimitMinor}) to equal its aggregate credit limit (${prior.aggregateCreditLimitMinor}); send accounts:set_partner_credit first, which writes both`,
            );
        }
        return {
          patch: {
            relationshipRoles: [...prior.relationshipRoles, command.role],
          },
          after: async () => {
            await transaction.insert(accountRelationshipRoles).values({
              accountId: prior.id,
              role: command.role,
              ...(command.source ? { source: command.source } : {}),
              ...(command.effectiveFrom
                ? { effectiveFrom: command.effectiveFrom }
                : {}),
            });
          },
        };
      }
      case "add_contact": {
        const command = accountCommand(AccountContactCommandSchema, input);
        // One active primary per kind, which is the partial unique index on the
        // table. Nothing else is refused: a second non-primary contact of the
        // same kind is ordinary, and so is a primary for a kind that has none.
        if (command.isPrimary) {
          const held = await transaction.query.accountContacts.findFirst({
            where: and(
              eq(accountContacts.accountId, prior.id),
              eq(accountContacts.kind, command.kind),
              eq(accountContacts.isPrimary, true),
              eq(accountContacts.active, true),
            ),
          });
          if (held)
            throw new CoreServiceError(
              "DUPLICATE",
              `Account already has a primary ${command.kind} contact`,
            );
        }
        await transaction.insert(accountContacts).values({
          accountId: prior.id,
          kind: command.kind,
          name: command.name,
          email: command.email,
          ...(command.title ? { title: command.title } : {}),
          ...(command.phone ? { phone: command.phone } : {}),
          isPrimary: command.isPrimary,
          receivesInvoices: command.receivesInvoices,
        });
        return { patch: {} };
      }
      case "set_payment_terms": {
        const command = accountCommand(AccountPaymentTermsCommandSchema, input);
        // Both check constraints say the same thing -- a term in days belongs
        // to net terms and to nothing else -- so the command says it too, and
        // the caller gets an answer instead of a constraint violation. The set
        // this refuses is exactly {net terms with no days, other terms with
        // days}, and neither is a policy anyone can hold.
        if (
          (command.collectionMethod === "net_terms") !==
          (command.termsDays !== undefined)
        )
          throw new CoreServiceError(
            "INVALID_STATE",
            "A term in days belongs to net terms and to no other collection method",
          );
        const existing = await transaction.query.billingPolicies.findFirst({
          where: eq(billingPolicies.accountId, prior.id),
        });
        const dunningPolicyVersion =
          command.dunningPolicyVersion ?? existing?.dunningPolicyVersion;
        if (!dunningPolicyVersion)
          throw new CoreServiceError(
            "INVALID_STATE",
            "A first billing policy must name the dunning policy version it runs under",
          );
        const policy = {
          collectionMethod: command.collectionMethod,
          paymentRail: command.paymentRail,
          termsDays: command.termsDays ?? null,
          dunningPolicyVersion,
          requirePo: command.requirePo ?? existing?.requirePo ?? false,
          consolidatePartnerInvoices:
            command.consolidatePartnerInvoices ??
            existing?.consolidatePartnerInvoices ??
            false,
        };
        await transaction
          .insert(billingPolicies)
          .values({ accountId: prior.id, ...policy })
          .onConflictDoUpdate({
            target: billingPolicies.accountId,
            set: { ...policy, updatedAt: this.now() },
          });
        // The order form prints "Net N days" off the commercial profile
        // (`artifact-definitions.ts`), so leaving it behind would put stale
        // terms on a document. The profile is written by the acceptance path
        // and carries a legal-entity fingerprint this command cannot invent, so
        // an account that has none is left alone rather than given one.
        const commercial =
          await transaction.query.accountCommercialProfiles.findFirst({
            where: eq(accountCommercialProfiles.accountId, prior.id),
          });
        if (commercial)
          await transaction
            .update(accountCommercialProfiles)
            .set({
              billingModel: command.collectionMethod,
              paymentTermsDays: command.termsDays ?? null,
              updatedAt: this.now(),
            })
            .where(eq(accountCommercialProfiles.accountId, prior.id));
        return { patch: {} };
      }
      /**
       * The aggregate partner credit limit, written on BOTH sides of the
       * invariant that says they are one number.
       *
       * `core_validate_finance_chain` refuses a `core_account_commercial_profiles`
       * row whose `approved_credit_limit_minor` differs from
       * `accounts.aggregate_credit_limit_minor` when the account holds the
       * partner role -- `23514 partner credit limit must match the account
       * aggregate limit` -- and supabase/seed.sql seeds the profile FROM the
       * account column for exactly that reason ("Credit limits remain exactly
       * the account limits above").
       *
       * The first implementation of this verb wrote only `accounts`. The
       * trigger is on the profile, not on `accounts`, so that write SUCCEEDED
       * and left the invariant broken behind it. The next statement to touch
       * the profile is the one that failed -- and on a partner that is
       * `core_reserve_order_acceptance`, which increments
       * `current_exposure_minor` for the invoicing account and again for the
       * partner account on EVERY accepted order (001000). One call on a partner
       * therefore rolled back every subsequent order acceptance for that
       * partner, which is why the profile update below is not optional and is
       * not a separate command.
       *
       * The ordering matters and is not incidental: `mutateAccount` applies
       * `patch` to `accounts` first and runs `after` second, so by the time the
       * trigger reads `accounts` it reads the new limit and the two agree.
       *
       * The complete set of inputs this refuses:
       *   1. a payload that is not `{ creditLimit: { currency, minor } }`;
       *   2. a limit stated in a currency other than the account's -- the
       *      columns are minor units with no currency of their own, so it would
       *      be recorded as a number that means something else;
       *   3. a negative limit, which `accounts_credit_nonnegative_check` and
       *      the profile's own check refuse as a raw 23514 -- answered here
       *      instead.
       * Nothing else: raising, lowering, and lowering BELOW current exposure
       * are all allowed. The last is a real commercial act -- the partner is
       * over its limit and `core_reserve_order_acceptance` starts rejecting new
       * orders, which is what a reduced limit is for.
       *
       * It does NOT refuse an account that holds no partner role, though §4
       * attaches the aggregate limit to partner accounts. A draft of this verb
       * did, and that guard blocked a legitimate write: `add_role` refuses the
       * partner role to an account whose two limits differ, this verb is the
       * only writer of either column in the tree, and between them a direct
       * client with an approved limit could never become a partner at all.
       * Writing both columns for every account is also what supabase/seed.sql
       * does -- it seeds the profile from the account limit for ALL accounts,
       * not only partners -- so the pair stays equal everywhere and an account
       * is always safe to grant the partner role to.
       *
       * What it deliberately does NOT write is `credit_status`. Approving
       * credit is the credit exception queue's decision (§9); this verb sets
       * the cap. A net-terms partner sitting at `not_requested` stays blocked
       * after this command, with the limit it will get when credit is approved.
       */
      case "set_partner_credit": {
        const command = accountCommand(
          AccountPartnerCreditCommandSchema,
          input,
        );
        if (command.creditLimit.currency !== prior.currency)
          throw new CoreServiceError(
            "INVALID_STATE",
            `Partner credit limit must be stated in ${prior.currency}`,
          );
        const limitMinor = BigInt(command.creditLimit.minor);
        if (limitMinor < 0n)
          throw new CoreServiceError(
            "INVALID_STATE",
            "Partner credit limit cannot be negative",
          );
        return {
          patch: { aggregateCreditLimitMinor: limitMinor },
          after: async () => {
            // Absent for an account whose commercial profile has not been
            // written yet -- it is created by the acceptance path and carries a
            // legal-entity fingerprint this command cannot invent. There is
            // nothing to diverge from in that state, and the same trigger
            // checks the profile against `accounts` when it is finally
            // inserted, so the limit set here is the one it has to match.
            const commercial =
              await transaction.query.accountCommercialProfiles.findFirst({
                where: eq(accountCommercialProfiles.accountId, prior.id),
              });
            if (!commercial) return;
            await transaction
              .update(accountCommercialProfiles)
              .set({
                approvedCreditLimitMinor: limitMinor,
                updatedAt: this.now(),
              })
              .where(eq(accountCommercialProfiles.accountId, prior.id));
          },
        };
      }
      default:
        throw new CoreServiceError(
          "INVALID_STATE",
          "Unsupported account command",
        );
    }
  }

  /**
   * Procurement is a record that accumulates. Certificates and furnished
   * documents arrive one at a time under their own verbs, and the tax position
   * and purchase-order policy they establish outlive the command that adds the
   * next one -- so every command here writes only what it names. Building a
   * whole value set from the payload and defaulting the absent keys is P0-60:
   * one `add_certificate` erased every validated certificate, reset
   * `poRequired` to false, and emptied the furnished documents, and the next
   * invoice was issued against a profile nobody had edited.
   */
  private async mutateProcurement(
    transaction: RuntimeTransaction,
    input: CoreMutation,
  ) {
    const accountId =
      input.accountId ?? string(input.payload.accountId, "accountId");
    const prior = await transaction.query.procurementProfiles.findFirst({
      where: eq(procurementProfiles.accountId, accountId),
    });
    const asOfDate = input.occurredAt.slice(0, 10);
    if (input.action === "create") {
      if (prior)
        throw new CoreServiceError(
          "DUPLICATE",
          "Procurement profile already exists",
        );
      const command = procurementCommand(ProcurementCreateCommandSchema, input);
      // Folded through the same rules the single-entry verbs use, so a profile
      // cannot be created holding two live certificates for one jurisdiction.
      const exemptions = command.exemptions.reduce<ProcurementExemptionEntry[]>(
        appendExemptionCertificate,
        [],
      );
      assertCertificatesNotLapsed(exemptions, asOfDate);
      const [row] = await transaction
        .insert(procurementProfiles)
        .values({
          id: input.id,
          accountId,
          poRequired: command.poRequired,
          supplierPortalStatus: command.supplierPortalStatus,
          exemptions,
          supplierDocuments: command.supplierDocuments
            .map((document) => furnishedDocument(document, input.occurredAt))
            .reduce<ProcurementDocumentEntry[]>(appendSupplierDocument, []),
        })
        .returning();
      if (!row) throw new Error("Procurement profile insert returned no row");
      return audited(
        transaction,
        input,
        coreRecord("procurement_profiles", row, accountId),
      );
    }
    if (!prior)
      throw new CoreServiceError(
        "NOT_FOUND",
        "Procurement profile was not found",
      );
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== prior.rowVersion
    )
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        "Procurement profile changed since it was read",
      );
    // Appending to a set requires reading it. An entry that cannot be read
    // cannot be preserved or superseded, so the command fails rather than
    // rewriting the column around it.
    const persisted = z
      .object({
        exemptions: z.array(ProcurementExemptionSchema),
        supplierDocuments: z.array(ProcurementDocumentSchema),
      })
      .safeParse(prior);
    if (!persisted.success)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Persisted procurement profile cannot be read and must be corrected before it is amended",
      );
    const values = this.procurementPatch(input, persisted.data, asOfDate);
    if (Object.keys(values).length === 0)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Procurement command carries no change",
      );
    const [row] = await transaction
      .update(procurementProfiles)
      .set({ ...values, updatedAt: this.now() })
      .where(
        and(
          eq(procurementProfiles.id, prior.id),
          eq(procurementProfiles.rowVersion, prior.rowVersion),
        ),
      )
      .returning();
    // Two callers adding a certificate at once each read the array they are
    // appending to; without this guard the later write would carry the earlier
    // caller's certificate away with it.
    if (!row)
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        "Procurement profile changed since it was read",
      );
    return audited(
      transaction,
      input,
      coreRecord("procurement_profiles", row, accountId),
      prior,
    );
  }

  /** Only the keys the command names; an absent key is not an empty value. */
  private procurementPatch(
    input: CoreMutation,
    persisted: {
      exemptions: ProcurementExemptionEntry[];
      supplierDocuments: ProcurementDocumentEntry[];
    },
    asOfDate: string,
  ): {
    poRequired?: boolean;
    supplierPortalStatus?: string;
    exemptions?: ProcurementExemptionEntry[];
    supplierDocuments?: ProcurementDocumentEntry[];
  } {
    switch (input.action) {
      case "update": {
        const command = procurementCommand(
          ProcurementUpdateCommandSchema,
          input,
        );
        const exemptions = command.exemptions?.reduce<
          ProcurementExemptionEntry[]
        >(appendExemptionCertificate, []);
        if (exemptions) {
          // A replacement set may keep certificates that lapsed while they were
          // on file; only the ones it introduces are held to the expiry rule.
          const onFile = new Set(
            persisted.exemptions.map(exemptionCertificateKey),
          );
          assertCertificatesNotLapsed(
            exemptions.filter(
              (entry) => !onFile.has(exemptionCertificateKey(entry)),
            ),
            asOfDate,
          );
        }
        return {
          ...(command.poRequired === undefined
            ? {}
            : { poRequired: command.poRequired }),
          ...(command.supplierPortalStatus === undefined
            ? {}
            : { supplierPortalStatus: command.supplierPortalStatus }),
          ...(exemptions ? { exemptions } : {}),
          ...(command.supplierDocuments
            ? {
                supplierDocuments: command.supplierDocuments
                  .map((document) =>
                    furnishedDocument(document, input.occurredAt),
                  )
                  .reduce<ProcurementDocumentEntry[]>(
                    appendSupplierDocument,
                    [],
                  ),
              }
            : {}),
        };
      }
      case "add_certificate": {
        const command = procurementCommand(
          ProcurementCertificateCommandSchema,
          input,
        );
        assertCertificatesNotLapsed([command.certificate], asOfDate);
        return {
          exemptions: appendExemptionCertificate(
            persisted.exemptions,
            command.certificate,
          ),
        };
      }
      case "record_supplier_document": {
        const command = procurementCommand(
          ProcurementDocumentCommandSchema,
          input,
        );
        return {
          supplierDocuments: appendSupplierDocument(
            persisted.supplierDocuments,
            furnishedDocument(command.document, input.occurredAt),
          ),
        };
      }
      default:
        throw new CoreServiceError(
          "INVALID_STATE",
          `Procurement profiles do not implement the ${input.action} command`,
        );
    }
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
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== prior.rowVersion
    )
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        "Price book changed since it was read",
      );
    if (input.action === "add_rate")
      return this.addPriceBookRate(transaction, input, prior);
    if (input.action === "request_activation")
      return this.requestPriceBookActivation(transaction, input, prior);
    if (input.action === "activate")
      return this.activatePersistedPriceBook(transaction, input, prior);
    if (input.action !== "retire")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Unsupported price book action",
      );
    assertFinanceApproval(input);
    const command = PriceBookDecisionCommandSchema.parse(input.payload);
    if (prior.status !== "active")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Only an active price book can be retired",
      );
    const [row] = await transaction
      .update(priceBooks)
      .set({ status: "retired", effectiveTo: input.occurredAt.slice(0, 10) })
      .where(
        and(
          eq(priceBooks.id, prior.id),
          eq(priceBooks.status, prior.status),
          eq(priceBooks.rowVersion, prior.rowVersion),
        ),
      )
      .returning();
    if (!row)
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        "Price book was retired concurrently",
      );
    await new CoreFinanceRepository(transaction).recordPriceBookActivation({
      priceBookId: row.id,
      action: "retire",
      previousStatus: prior.status,
      resultingStatus: row.status,
      effectiveAt: new Date(input.occurredAt),
      actorUserId: input.authorization.userId,
      reason: command.reason,
      requestId: input.requestId,
    });
    return audited(transaction, input, coreRecord("price_books", row), prior);
  }

  /** Advances the book's concurrency counter when only its contents changed. */
  private async touchPriceBook(
    transaction: RuntimeTransaction,
    prior: typeof priceBooks.$inferSelect,
  ) {
    const [row] = await transaction
      .update(priceBooks)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(priceBooks.id, prior.id),
          eq(priceBooks.rowVersion, prior.rowVersion),
        ),
      )
      .returning();
    if (!row)
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        "Price book changed during this command",
      );
    return row;
  }

  /**
   * A rate card is signed price content, so it may only join a draft book and
   * only if the resulting book still passes the pricing guardrails whole.
   */
  private async addPriceBookRate(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    prior: typeof priceBooks.$inferSelect,
  ) {
    assertFinanceApproval(input);
    const command = RateCardCommandSchema.parse(input.payload);
    if (prior.status !== "draft")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Rate cards may only be added to a draft price book",
      );
    const book = await serverPriceBook(transaction, prior.id);
    const candidate = {
      id: command.id ?? uuidV7(),
      sku: command.sku,
      region: command.region,
      unit: command.unit,
      approvedClaim: command.approvedClaim,
      unitPrice: command.unitPrice,
      ...(command.floorPrice ? { floorPrice: command.floorPrice } : {}),
      overageRate: command.overageRate,
      minimumQuantity: command.minimumQuantity,
      ...(command.trialLimit ? { trialLimit: command.trialLimit } : {}),
      egressTreatment: command.egressTreatment,
      commitType: command.commitType,
      stripeTaxCode: command.stripeTaxCode,
      qboIncomeAccount: command.qboIncomeAccount,
      partnerTransferPrices: command.partnerTransferPrices,
    };
    try {
      validatePriceBook({
        ...book,
        rateCards: [...book.rateCards, candidate],
      });
    } catch (error) {
      throw new CoreServiceError(
        "INVALID_STATE",
        error instanceof Error ? error.message : "Rate card is invalid",
      );
    }
    const [row] = await transaction
      .insert(rateCards)
      .values({
        id: candidate.id,
        priceBookId: prior.id,
        sku: candidate.sku,
        region: candidate.region,
        unit: candidate.unit,
        approvedClaim: candidate.approvedClaim,
        unitPriceMinor: BigInt(candidate.unitPrice.minor),
        floorPriceMinor: candidate.floorPrice
          ? BigInt(candidate.floorPrice.minor)
          : null,
        overageRateMinor: BigInt(candidate.overageRate.minor),
        minimumQuantity: candidate.minimumQuantity,
        trialLimit: candidate.trialLimit ?? null,
        egressTreatment: candidate.egressTreatment,
        commitType: candidate.commitType,
        stripeTaxCode: candidate.stripeTaxCode,
        qboIncomeAccount: candidate.qboIncomeAccount,
        partnerTransferPrices: candidate.partnerTransferPrices,
      })
      .returning();
    if (!row) throw new Error("Rate card insert returned no row");
    const touched = await this.touchPriceBook(transaction, prior);
    return audited(
      transaction,
      input,
      coreRecord("price_books", { ...touched, addedRateCardId: row.id }),
      prior,
    );
  }

  /**
   * Activation is a two-authority decision. The request records who proposed
   * it; a second finance approver decides it. The persisted approval carries
   * both identities and the database refuses to let them be the same person.
   */
  private async requestPriceBookActivation(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    prior: typeof priceBooks.$inferSelect,
  ) {
    assertFinanceApproval(input);
    const command = PriceBookDecisionCommandSchema.parse(input.payload);
    if (prior.status !== "draft")
      throw new CoreServiceError(
        "INVALID_STATE",
        "Only a draft price book can be proposed for activation",
      );
    const book = await serverPriceBook(transaction, prior.id);
    try {
      validatePriceBook(book);
    } catch (error) {
      throw new CoreServiceError(
        "INVALID_STATE",
        error instanceof Error ? error.message : "Price book is invalid",
      );
    }
    const pending = await transaction.query.approvals.findFirst({
      where: and(
        eq(approvals.action, "price_book_activation"),
        eq(approvals.objectId, prior.id),
        eq(approvals.status, "pending"),
      ),
    });
    if (pending)
      throw new CoreServiceError(
        "DUPLICATE",
        "This price book already awaits a second approver",
      );
    const [approval] = await transaction
      .insert(approvals)
      .values({
        id: input.id === prior.id ? uuidV7() : input.id,
        action: "price_book_activation",
        objectType: "price_book",
        objectId: prior.id,
        requestedBy: input.authorization.userId,
        status: "pending",
        requestedAt: new Date(input.occurredAt),
      })
      .returning();
    if (!approval)
      throw new Error("Price book approval insert returned no row");
    await new CoreFinanceRepository(transaction).recordPriceBookActivation({
      priceBookId: prior.id,
      action: "schedule",
      previousStatus: prior.status,
      resultingStatus: prior.status,
      effectiveAt: new Date(`${prior.effectiveFrom}T00:00:00.000Z`),
      actorUserId: input.authorization.userId,
      reason: command.reason,
      requestId: input.requestId,
    });
    const touched = await this.touchPriceBook(transaction, prior);
    return audited(
      transaction,
      input,
      coreRecord("price_books", {
        ...touched,
        activationApprovalId: approval.id,
        activationRequestedBy: approval.requestedBy,
      }),
      prior,
    );
  }

  private async activatePersistedPriceBook(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    prior: typeof priceBooks.$inferSelect,
  ) {
    assertFinanceApproval(input);
    const command = PriceBookDecisionCommandSchema.parse(input.payload);
    const request = await transaction.query.approvals.findFirst({
      where: and(
        eq(approvals.action, "price_book_activation"),
        eq(approvals.objectId, prior.id),
        eq(approvals.status, "pending"),
      ),
    });
    if (!request)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Activation requires a pending request from another finance approver",
      );
    if (request.requestedBy === input.authorization.userId)
      throw new CoreServiceError(
        "INVALID_STATE",
        "The approver of an activation cannot be the person who requested it",
      );
    const currencyBooks = await transaction.query.priceBooks.findMany({
      where: eq(priceBooks.currency, prior.currency),
    });
    const allBooks = await Promise.all(
      currencyBooks.map((row) => serverPriceBook(transaction, row.id)),
    );
    const candidate = allBooks.find((book) => book.id === prior.id);
    if (!candidate) throw new Error("Price book candidate was not loaded");
    let decision;
    try {
      decision = activatePriceBook({
        candidate,
        allBooks,
        actorId: input.authorization.userId,
        occurredAt: input.occurredAt,
      });
    } catch (error) {
      throw new CoreServiceError(
        "INVALID_STATE",
        error instanceof Error ? error.message : "Price book cannot activate",
      );
    }
    const repository = new CoreFinanceRepository(transaction);
    const effectiveAt = new Date(input.occurredAt);
    // One active book per currency is a partial unique index, so the retirement
    // the domain decided has to land before the activation it makes room for.
    let activated: typeof priceBooks.$inferSelect | undefined;
    for (const change of [
      ...decision.audits.filter((audit) => audit.action === "retired"),
      ...decision.audits.filter((audit) => audit.action === "activated"),
    ]) {
      const retiring = change.action === "retired";
      const [row] = await transaction
        .update(priceBooks)
        .set({
          status: retiring ? "retired" : "active",
          ...(retiring
            ? { effectiveTo: input.occurredAt.slice(0, 10) }
            : { effectiveTo: null }),
        })
        .where(
          and(
            eq(priceBooks.id, change.priceBookId),
            eq(priceBooks.status, change.beforeStatus),
          ),
        )
        .returning();
      if (!row)
        throw new CoreServiceError(
          "VERSION_CONFLICT",
          "A price book in this currency changed during activation",
        );
      if (!retiring) activated = row;
      // The activated book is audited by the command itself. A book retired to
      // make room for it is not, so its transition carries its own audit.
      await repository.recordPriceBookActivation(
        {
          priceBookId: row.id,
          action: retiring ? "retire" : "activate",
          previousStatus: change.beforeStatus,
          resultingStatus: row.status,
          effectiveAt,
          actorUserId: input.authorization.userId,
          reason: command.reason,
          requestId: input.requestId,
        },
        retiring ? priceBookAudit(input, row, "price_book.retired") : undefined,
      );
    }
    if (!activated) throw new Error("Price book activation produced no row");
    const [decided] = await transaction
      .update(approvals)
      .set({
        approvedBy: input.authorization.userId,
        status: "approved",
        decidedAt: effectiveAt,
      })
      .where(and(eq(approvals.id, request.id), eq(approvals.status, "pending")))
      .returning();
    if (!decided)
      throw new CoreServiceError(
        "VERSION_CONFLICT",
        "The activation request was decided concurrently",
      );
    return audited(
      transaction,
      input,
      coreRecord("price_books", {
        ...activated,
        activationApprovalId: decided.id,
        activationRequestedBy: decided.requestedBy,
        activationApprovedBy: decided.approvedBy,
        retiredPriceBookIds: decision.audits
          .filter((audit) => audit.action === "retired")
          .map((audit) => audit.priceBookId),
      }),
      prior,
    );
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

  /**
   * Prices a draft against the confidential book and writes the three rows that
   * have to agree about it: the quote, the commercial profile the partner
   * economics live on, and the priced lines.
   *
   * Creation and revision share it so a revision cannot drift from what
   * creation persists. Both take every money column from this one `priceQuote`
   * result -- a revision re-prices its own lines rather than copying the prior
   * quote's totals, which is the only way a changed quantity can be believed.
   */
  private async persistQuoteDraft(
    transaction: RuntimeTransaction,
    input: CoreMutation,
    context: {
      quoteId: string;
      accountId: string;
      command: z.output<typeof QuoteCreateCommandSchema>;
      book: PriceBook;
      commercialContext?: QuoteCommercialContext;
      /** The quote being revised; absent for the first revision of a series. */
      previous?: QuoteSnapshot;
    },
  ): Promise<{
    row: typeof quotes.$inferSelect;
    draft: QuoteSnapshot;
    /** The prior quote as the revision leaves it: superseded when it was issued. */
    superseded?: QuoteSnapshot;
  }> {
    const { command, book } = context;
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
        ? context.commercialContext?.partner?.partner?.transferTier
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
    // P1 renewal price protection is deliberately NOT enforced here. The rule
    // exists and is tested (`assertRenewalPriceProtection`,
    // packages/domain/src/agreements), but no call site can yet resolve which
    // agreement governs a renewal quote — see the adoption note on the rule.
    // Two adoptions have been attempted here and both refused legitimate
    // quotes; the protection stays open rather than half-enforced.
    const draftInput = {
      id: context.quoteId,
      accountId: context.accountId,
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
    };
    // `reviseQuote` owns the chain: it carries the series forward, numbers the
    // revision, links it to its parent, and returns the parent as the
    // supersession leaves it. `validate_quote_revision_chain` (000001:959)
    // rejects any numbering that disagrees.
    const revised = context.previous
      ? reviseQuote(context.previous, draftInput)
      : undefined;
    const draft =
      revised?.revision ??
      createQuoteDraft({ ...draftInput, seriesId: command.seriesId });
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
          : context.accountId,
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
        ...(context.commercialContext?.registration
          ? { dealRegistrationId: context.commercialContext.registration.id }
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
    return {
      row,
      draft,
      ...(revised ? { superseded: revised.prior } : {}),
    };
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
      const { row } = await this.persistQuoteDraft(transaction, input, {
        quoteId: input.id,
        accountId: input.accountId,
        command,
        book,
        ...(commercialContext ? { commercialContext } : {}),
      });
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
    if (input.action === "revise") {
      if (!input.accountId || input.accountId !== prior.accountId)
        throw new CoreServiceError(
          "INVALID_STATE",
          "A revision stays on the account its series was quoted for",
        );
      // Same rule the domain applies, stated here so an operator revising the
      // wrong quote gets a 422 rather than a thrown invariant.
      if (
        snapshot.status !== "issued" &&
        snapshot.status !== "expired" &&
        snapshot.status !== "rejected"
      )
        throw new CoreServiceError(
          "INVALID_STATE",
          "Only an issued or terminal quote can be revised",
        );
      const command = QuoteCreateCommandSchema.parse(input.payload);
      const revisionId = z
        .uuid()
        .parse(string(input.payload.revisionId, "revisionId"));
      if (revisionId === prior.id)
        throw new CoreServiceError(
          "INVALID_STATE",
          "A revision needs its own identifier",
        );
      // The revision is priced on the book the series was quoted on. Moving a
      // series to another book would reprice it against rates the customer
      // never saw, so a new book is a new quote.
      if (confidentialPriceBook.id !== command.priceBookId)
        throw new CoreServiceError(
          "INVALID_STATE",
          "A revision keeps the price book its series was quoted on",
        );
      if (command.seriesId !== prior.seriesId)
        throw new CoreServiceError(
          "INVALID_STATE",
          "A revision stays in its own quote series",
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
        confidentialPriceBook,
        commercialContext,
      );
      const { row, superseded } = await this.persistQuoteDraft(
        transaction,
        input,
        {
          quoteId: revisionId,
          accountId: input.accountId,
          command,
          book: confidentialPriceBook,
          ...(commercialContext ? { commercialContext } : {}),
          previous: snapshot,
        },
      );
      // Only an issued parent is superseded; an expired or rejected one is
      // already terminal and `protect_issued_quote` (000001:1287) has no
      // transition out of it.
      if (superseded && superseded.status !== snapshot.status) {
        const [supersededRow] = await transaction
          .update(quotes)
          .set({ status: superseded.status, updatedAt: this.now() })
          .where(
            and(
              eq(quotes.id, prior.id),
              eq(quotes.rowVersion, prior.rowVersion),
            ),
          )
          .returning();
        if (!supersededRow)
          throw new CoreServiceError(
            "VERSION_CONFLICT",
            "Quote version is stale",
          );
      }
      // The audit aggregate is the revision, so the event carries the quote a
      // reader would go on to act on; `before` is the parent as it stood.
      return audited(
        transaction,
        input,
        coreRecord("quotes", row, row.accountId),
        prior,
      );
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
    taxDetermination?: TaxDetermination,
  ) {
    if (input.action === "create" || input.action === "prepare_artifact") {
      if (!acceptanceContext)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Authoritative order acceptance context is unavailable",
        );
      // prepare_artifact renders an unaccepted order form and commits the
      // customer to nothing, so it is deliberately not gated. Acceptance is.
      if (input.action === "create" && !taxDetermination)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Order acceptance requires a tax determination (EXT-TAX-01)",
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
      // The determination was made outside this transaction. If the quote it
      // was made against is not the quote being accepted here, it proves
      // nothing about this acceptance.
      if (
        taxDetermination &&
        (taxDetermination.currency !== persistedQuote.currency ||
          taxDetermination.netMinor !== persistedQuote.totalMinor)
      )
        throw new CoreServiceError(
          "INVALID_STATE",
          "Tax determination does not describe the quote being accepted",
        );
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
    // The order as amended, not as ordered. Validating against the immutable
    // snapshot compared every amendment to the original order, so sequential
    // downgrades never ran out of quantity.
    const orderState = await currentAmendedOrder(transaction, parsed.order.id);
    const persistedOrder = orderState.current;
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
    // What this amendment would leave the order committed to. `createAmendment`
    // decides whether the document is well formed; this decides whether the
    // order can carry it. Both floors are domain refusals rather than constraint
    // violations, and both are checked before the artifact is bound so a
    // refused amendment leaves nothing behind.
    //
    // ONE fold, over the immutable snapshot with the persisted amendments and
    // this one together. Folding `orderState.current` — which is itself already
    // a fold — instead would judge a total the added lines had dropped out of:
    // `amendOrderState` counts an added line's revenue but cannot return the
    // line, so a second fold over its result re-derives committed revenue from
    // the order's own lines alone. An order that had swapped a line out for a
    // more valuable replacement then read as negative and refused every
    // subsequent amendment, a zero-delta term extension included.
    try {
      amendOrderState(orderState.ordered, [...orderState.persisted, amendment]);
    } catch (error) {
      throw new CoreServiceError(
        "INVALID_STATE",
        error instanceof Error ? error.message : String(error),
      );
    }
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
    const [commercialProfile, quotedLines] = await Promise.all([
      transaction.query.orderCommercialProfiles.findFirst({
        where: eq(orderCommercialProfiles.orderId, parent.id),
      }),
      transaction.query.quoteLines.findMany({
        where: eq(quoteLines.quoteId, parent.quoteId),
        columns: { termMonths: true },
      }),
    ]);
    if (!commercialProfile || quotedLines.length === 0)
      throw new CoreServiceError(
        "INVALID_STATE",
        "Accepted order snapshots are incomplete",
      );
    await persistAmendmentMoney(transaction, {
      amendment,
      order: persistedOrder,
      contractualTimeZone: commercialProfile.contractualTimeZone,
      // core_revenue_forecast spreads the order total across exactly these
      // months (000900:270), so the run-rate delta uses the same denominator.
      billingMonths: Math.max(1, ...quotedLines.map((line) => line.termMonths)),
    });
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
    taxDetermination?: TaxDetermination,
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
      // The quote total is what was ordered; the invoice bills what is owed.
      // A downgrade's delta is negative, and one large enough to invert the
      // invoice is a credit note rather than a bill, so it fails here instead
      // of being clamped into the non-negative amount constraint.
      const amendmentDeltaMinor = await acceptedAmendmentDeltaMinor(
        transaction,
        order,
        acceptedQuote.currency,
      );
      const netMinor = acceptedQuote.totalMinor + amendmentDeltaMinor;
      if (netMinor < 0n)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Amended order owes a credit rather than an invoice",
        );
      // A tax figure is not optional and is not defaulted. The determination is
      // re-checked against the net this transaction computed, because it was
      // fetched before the transaction opened and an amendment accepted in
      // between would have moved the amount underneath it. Billing the old tax
      // on the new net, or the new net with no tax, are both wrong numbers that
      // would persist; failing is not.
      if (!taxDetermination)
        throw new CoreServiceError(
          "INVALID_STATE",
          "Invoice drafts require a tax determination (EXT-TAX-01)",
        );
      if (
        taxDetermination.currency !== acceptedQuote.currency ||
        taxDetermination.netMinor !== netMinor
      )
        throw new CoreServiceError(
          "INVALID_STATE",
          "Tax determination does not describe the amount being invoiced",
        );
      const amountMinor = netMinor + taxDetermination.taxMinor;
      // `input.id` is deliberately not the invoice identifier: it is the
      // caller's, and two callers hold two of them for the one bill this order
      // owes. `initialInvoiceId` is the same identifier the provisioning draft
      // writer derives, so a second create — from this route, from that
      // workflow, or from both at once — collides on the primary key instead of
      // billing the quote total again.
      const invoiceId = initialInvoiceId(order.id);
      const [row] = await transaction
        .insert(invoices)
        .values({
          id: invoiceId,
          orderId: order.id,
          accountId: order.invoicingAccountId,
          stripeInvoiceId: null,
          currency: acceptedQuote.currency,
          amountMinor,
          // The delta this bill carries, stored beside the amount it moved
          // (001393). The invoice is checked against the stored figure for the
          // rest of its life, so an amendment accepted after this row exists
          // cannot make the row fail its own constraint and block settlement.
          amendmentDeltaMinor,
          taxMinor: taxDetermination.taxMinor,
          taxTreatment: taxDetermination.treatment,
          poNumber: order.poNumber,
          status: "draft",
          dueAt: payload.dueAt ? date(payload.dueAt, "dueAt") : undefined,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        // The conflicting row is read after the insert, so it is the committed
        // one whichever writer landed it. A create that arrives second is
        // refused rather than answered with the existing invoice: its due date
        // is not the persisted one, and returning a record the caller did not
        // ask for reads as success.
        const existing = await transaction.query.invoices.findFirst({
          where: eq(invoices.id, invoiceId),
        });
        if (!existing || existing.orderId !== order.id)
          throw new CoreServiceError(
            "INVALID_STATE",
            "Invoice identifier for this order is held by another record",
          );
        throw new CoreServiceError(
          "DUPLICATE",
          "Order has already been invoiced",
        );
      }
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
        outstanding: parsedMoney(
          invoice.currency,
          invoice.amountRemainingMinor.toString(),
        ),
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
        // An open invoice can only be credited down to what is still owed; a
        // paid invoice is creditable against its full settled total.
        invoiceRemaining: parsedMoney(
          invoice.currency,
          (invoice.status === "open"
            ? invoice.amountRemainingMinor
            : invoice.amountMinor
          ).toString(),
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
    // Two of the sixteen carry no account dimension and their row-level policy
    // is `app_is_internal()`, which is false for every tenant-pool session --
    // so on the authorized transaction they can only ever return an empty page,
    // whatever the caller asked for. Reading them on the internal pool the way
    // `report()` does is what makes the read real, and the refusal below is
    // what keeps that pool behind the same door: it turns away exactly the
    // callers whose policy already gives them nothing, and no tenant has a row
    // in either table to be turned away from.
    const internalOnly = new Set<CoreResourceName>([
      "accounting_exports",
      "marketplace_reconciliations",
    ]);
    if (
      internalOnly.has(input.resource) &&
      !input.authorization.isInternalStaff
    )
      throw new CoreServiceError(
        "INVALID_STATE",
        `${input.resource} reads are restricted to internal operators`,
      );
    const readList = async (transaction: RuntimeTransaction) => {
      const decodedCursor: unknown = input.cursor
        ? JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"))
        : undefined;
      const cursor = z.object({ id: z.string() }).safeParse(decodedCursor);
      const after = cursor.success ? cursor.data.id : undefined;
      const whereId = after
        ? gt(sql`${sql.identifier("id")}`, after)
        : undefined;
      /** Orders this account is the client on. */
      const accountOrders = (accountId: string) =>
        transaction
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.accountId, accountId));
      /** Invoices billed to this account. */
      const accountInvoices = (accountId: string) =>
        transaction
          .select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.accountId, accountId));
      /** Payments settling an invoice billed to this account. */
      const accountPayments = (accountId: string) =>
        transaction
          .select({ id: payments.id })
          .from(payments)
          .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
          .where(eq(invoices.accountId, accountId));
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
        // A price book belongs to no account. Reads are internal-only and
        // carry the rate-card count the activation surface scans on.
        case "price_books": {
          if (!input.authorization.isInternalStaff)
            throw new CoreServiceError(
              "INVALID_STATE",
              "Price book reads require internal staff",
            );
          rows = await transaction
            .select({
              id: priceBooks.id,
              name: priceBooks.name,
              currency: priceBooks.currency,
              effectiveFrom: priceBooks.effectiveFrom,
              effectiveTo: priceBooks.effectiveTo,
              status: priceBooks.status,
              version: priceBooks.version,
              createdAt: priceBooks.createdAt,
              rateCardCount: sql<number>`count(${rateCards.id})::int`,
            })
            .from(priceBooks)
            .leftJoin(rateCards, eq(rateCards.priceBookId, priceBooks.id))
            .where(whereId)
            .groupBy(priceBooks.id)
            .orderBy(asc(priceBooks.id))
            .limit(input.limit + 1);
          break;
        }
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
        case "procurement_profiles":
          rows = await transaction
            .select()
            .from(procurementProfiles)
            .where(
              input.accountId
                ? and(
                    eq(procurementProfiles.accountId, input.accountId),
                    whereId,
                  )
                : whereId,
            )
            .orderBy(asc(procurementProfiles.id))
            .limit(input.limit + 1);
          break;
        // The five below hang off an order or an invoice rather than carrying
        // an account of their own, so the `accountId` narrowing walks the same
        // chain the row-level policy does -- `amendments_scope` and
        // `commitment_ledgers_scope` reach the order, `credit_notes_scope` the
        // invoice, `refunds_scope` and `dispute_cases_scope` the payment's
        // invoice. RLS is still what decides visibility; this only narrows an
        // already-visible page the way the caller asked.
        case "amendments":
          rows = await transaction
            .select()
            .from(amendments)
            .where(
              input.accountId
                ? and(
                    inArray(amendments.orderId, accountOrders(input.accountId)),
                    whereId,
                  )
                : whereId,
            )
            .orderBy(asc(amendments.id))
            .limit(input.limit + 1);
          break;
        case "commitments":
          rows = await transaction
            .select()
            .from(commitmentLedgers)
            .where(
              input.accountId
                ? and(
                    inArray(
                      commitmentLedgers.orderId,
                      accountOrders(input.accountId),
                    ),
                    whereId,
                  )
                : whereId,
            )
            .orderBy(asc(commitmentLedgers.id))
            .limit(input.limit + 1);
          break;
        case "credit_notes":
          rows = await transaction
            .select()
            .from(creditNotes)
            .where(
              input.accountId
                ? and(
                    inArray(
                      creditNotes.invoiceId,
                      accountInvoices(input.accountId),
                    ),
                    whereId,
                  )
                : whereId,
            )
            .orderBy(asc(creditNotes.id))
            .limit(input.limit + 1);
          break;
        case "refunds":
          rows = await transaction
            .select()
            .from(refunds)
            .where(
              input.accountId
                ? and(
                    inArray(
                      refunds.paymentId,
                      accountPayments(input.accountId),
                    ),
                    whereId,
                  )
                : whereId,
            )
            .orderBy(asc(refunds.id))
            .limit(input.limit + 1);
          break;
        case "disputes":
          rows = await transaction
            .select()
            .from(disputeCases)
            .where(
              input.accountId
                ? and(
                    inArray(
                      disputeCases.paymentId,
                      accountPayments(input.accountId),
                    ),
                    whereId,
                  )
                : whereId,
            )
            .orderBy(asc(disputeCases.id))
            .limit(input.limit + 1);
          break;
        // Ledger and provider-statement rows with no account dimension at
        // all. `core_accounting_exports_internal` and
        // `core_marketplace_reconciliation_internal` are internal-only
        // policies, so a tenant caller reads an empty page rather than an
        // error, and `accountId` has nothing to narrow. `report_exports` is
        // the same shape: its policy scopes to the requesting user, not to an
        // account.
        case "accounting_exports":
          rows = await transaction
            .select()
            .from(accountingExports)
            .where(whereId)
            .orderBy(asc(accountingExports.id))
            .limit(input.limit + 1);
          break;
        case "marketplace_reconciliations":
          rows = await transaction
            .select()
            .from(marketplaceReconciliations)
            .where(whereId)
            .orderBy(asc(marketplaceReconciliations.id))
            .limit(input.limit + 1);
          break;
        case "reports":
          rows = await transaction
            .select()
            .from(reportExports)
            .where(whereId)
            .orderBy(asc(reportExports.id))
            .limit(input.limit + 1);
          break;
        // Unreachable, and that is the point: the switch is total over
        // `coreResourceNames`, so a resource added to the advertised read
        // surface with no branch here fails to compile instead of reaching a
        // caller as an error on a URL the OpenAPI document told them to call.
        // Sixteen resources were advertised and seven were implemented.
        default: {
          const unread: never = input.resource;
          throw new CoreServiceError(
            "INVALID_STATE",
            `${String(unread)} has no read`,
          );
        }
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
            ? Buffer.from(JSON.stringify({ id: last.id })).toString("base64url")
            : null,
      };
    };
    if (internalOnly.has(input.resource))
      return withInternalTransaction(
        this.options.pricingDatabase,
        uuidV7(),
        readList,
      );
    return withAuthorizedTransaction(
      this.options.database,
      authorization(input),
      { secret: this.options.authorizationSecret, now: this.now() },
      readList,
    );
  }

  public report(input: DatabaseCoreReportInput) {
    // Derived, not restated. This used to be a hand-written set of three, and
    // the grants that have to agree with it lived in three migrations, so the
    // three reports 001396 added were absent from both and a tenant caller got
    // `42501 permission denied for view core_commission_settlement` instead of
    // either rows or a refusal. There is now one declaration --
    // `coreReportSources[report].audience` -- and the integration test reads the
    // SQL grant back to hold it to that.
    const source = coreReportSources[input.report];
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
      if (source.audience === "internal")
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
    const readReport = async (transaction: RuntimeTransaction) => {
      const readOptions = {
        limit: input.limit + 1,
        offset: cursor.offset,
        ...(input.accountId ? { accountId: input.accountId } : {}),
      };
      const rows =
        source.shipped === undefined
          ? await readReportView(transaction, source, readOptions)
          : await new CoreFinanceRepository(transaction).readInternalReport(
              source.shipped,
              readOptions,
            );
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
    // FAIL CLOSED. A replay is only a replay if something re-processes the
    // stored bytes. No durable task is registered under this identifier --
    // packages/workflows/src/trigger/discovery.ts imports thirteen production
    // task modules and none declares it, and the only readers of workflow_runs
    // filter on identifiers that exclude it. Enqueuing the row anyway reported
    // success while nothing ran, and clearing processed_at/processing_error on
    // the inbox row destroyed the dedupe guard, so a provider redelivery of the
    // same event was claimed instead of rejected and the projection re-entered.
    //
    // The repair is to register the task in @clockwork/workflows and then
    // restore the enqueue here. Until that exists the command refuses and
    // touches nothing: the refusal is raised before any transaction is opened,
    // so the inbox row is not mutated on this path.
    return Promise.reject(
      new WebhookReplayTaskNotRegisteredError(
        webhookReplayTaskIdentifier(input.provider),
      ),
    );
  }
}
