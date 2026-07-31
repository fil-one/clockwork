import { z } from "zod";

import { RoleSchema } from "./auth";
import { ActorSchema } from "./events";
import {
  CountryCodeSchema,
  CurrencySchema,
  EmailSchema,
  entityNames,
  IdempotencyKeySchema,
  ids,
  IsoDateTimeSchema,
  LocalDateSchema,
  MoneySchema,
  PercentageSchema,
  QuantitySchema,
  Sha256Schema,
} from "./primitives";

const mutableRecord = {
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  rowVersion: z.int().positive(),
};
const immutableRecord = {
  createdAt: IsoDateTimeSchema,
  version: z.int().positive(),
  immutableAt: IsoDateTimeSchema.nullable(),
};
const jsonObject = z.record(z.string(), z.unknown());
const EntityNameSchema = z.enum(entityNames);

export const RelationshipRoleSchema = z.enum([
  "direct_client",
  "partner",
  "end_client",
]);
export const AddressSchema = z
  .object({
    line1: z.string(),
    line2: z.string().optional(),
    city: z.string(),
    region: z.string().optional(),
    postalCode: z.string(),
    country: CountryCodeSchema,
  })
  .strict();
export const ContactSchema = z
  .object({
    name: z.string(),
    email: EmailSchema,
    phone: z.string().optional(),
  })
  .strict();

export const AccountSchema = z
  .object({
    id: ids.account,
    legalName: z.string().min(1),
    relationshipRoles: z.array(RelationshipRoleSchema).min(1),
    registeredAddress: AddressSchema,
    taxIds: z.array(
      z.object({
        jurisdiction: CountryCodeSchema,
        value: z.string(),
        validatedAt: IsoDateTimeSchema.nullable(),
      }),
    ),
    billingContact: ContactSchema,
    apContact: ContactSchema,
    invoiceDeliveryEmail: EmailSchema,
    domain: z.string().min(3),
    country: CountryCodeSchema,
    currency: CurrencySchema,
    screeningStatus: z.enum(["pending", "clear", "review", "blocked"]),
    stripeCustomerId: z.string().nullable(),
    crmRecordId: z.string().nullable(),
    parentPartnerId: ids.account.nullable(),
    partnerAgreementType: z
      .enum(["referral", "resale", "msp", "embedded"])
      .nullable(),
    partnerDiscountTier: z.string().nullable(),
    commissionRate: PercentageSchema.nullable(),
    aggregateCreditLimit: MoneySchema.nullable(),
    ...mutableRecord,
  })
  .strict();

export const ProcurementProfileSchema = z
  .object({
    id: ids.procurementProfile,
    accountId: ids.account,
    poRequired: z.boolean(),
    supplierPortalStatus: z.enum([
      "not_required",
      "not_started",
      "in_progress",
      "complete",
      "blocked",
    ]),
    exemptions: z.array(
      z.object({
        jurisdiction: z.string(),
        certificateId: z.string(),
        expiresOn: LocalDateSchema.nullable(),
        documentId: ids.document,
      }),
    ),
    supplierDocuments: z.array(
      z.object({
        kind: z.enum(["w9", "w8", "coi", "bank_verification", "other"]),
        furnishedAt: IsoDateTimeSchema,
        documentId: ids.document,
      }),
    ),
    ...mutableRecord,
  })
  .strict();

export const OrganizationSchema = z
  .object({
    id: ids.organization,
    accountId: ids.account,
    name: z.string().min(1),
    isolated: z.boolean(),
    externalProvisioningId: z.string().nullable(),
    workosOrganizationId: z.string().nullable(),
    ...mutableRecord,
  })
  .strict();
export const UserSchema = z
  .object({
    id: ids.user,
    workosUserId: z.string().min(1),
    email: EmailSchema,
    name: z.string(),
    isInternalStaff: z.boolean(),
    mfaEnrolled: z.boolean(),
    ...mutableRecord,
  })
  .strict();
export const MembershipSchema = z
  .object({
    id: ids.membership,
    organizationId: ids.organization,
    userId: ids.user,
    role: RoleSchema,
    workosMembershipId: z.string().nullable(),
    approvalLimit: MoneySchema.nullable(),
    ...mutableRecord,
  })
  .strict();
export const InviteSchema = z
  .object({
    id: ids.invite,
    organizationId: ids.organization,
    email: EmailSchema,
    role: RoleSchema,
    expiresAt: IsoDateTimeSchema,
    acceptedAt: IsoDateTimeSchema.nullable(),
    ...mutableRecord,
  })
  .strict();

export const AgreementTemplateSchema = z
  .object({
    id: ids.agreementTemplate,
    type: z.enum([
      "tos",
      "csa",
      "dpa",
      "msa",
      "order_form",
      "poc_terms",
      "end_user_terms",
      "partner_agreement",
      "addendum",
      "nda",
      "security_addendum",
      "sla",
      "support_policy",
      "aup",
    ]),
    semanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    jurisdiction: z.string(),
    effectiveOn: LocalDateSchema,
    canonicalDocumentId: ids.document,
    textHash: Sha256Schema,
    executionMode: z.enum(["click_through", "counter_signed"]),
    approvalStatus: z.enum(["draft", "approved", "retired"]),
    approvedBy: ids.user.nullable(),
    ...immutableRecord,
  })
  .strict();

export const KeyTermsSchema = z
  .object({
    id: ids.keyTerms,
    agreementId: ids.agreement,
    slaCreditSchedule: z.record(z.string(), z.unknown()),
    liabilityCap: MoneySchema.nullable(),
    breachNoticeHours: z.int().positive(),
    renewalPriceProtection: PercentageSchema.nullable(),
    auditRights: z.string(),
    retentionLiabilityRule: z.enum([
      "liable_through_retention",
      "capped_at_paid_term",
      "custom",
    ]),
    customTerms: z.record(z.string(), z.unknown()),
    ...immutableRecord,
  })
  .strict();
export const AgreementSchema = z
  .object({
    id: ids.agreement,
    accountId: ids.account,
    templateId: ids.agreementTemplate.nullable(),
    paper: z.enum(["ours", "theirs"]),
    executionMode: z.enum(["click_through", "counter_signed"]),
    executedDocumentId: ids.document,
    evidenceDocumentId: ids.document.nullable(),
    envelopeId: z.string().nullable(),
    negotiationStatus: z.enum(["standard", "redlining", "agreed"]),
    effectiveOn: LocalDateSchema,
    termMonths: z.int().positive().nullable(),
    renewalType: z.enum(["auto_renew", "expires"]),
    noticeDays: z.int().nonnegative(),
    status: z.enum(["active", "in_notice", "expired", "terminated"]),
    supersededById: ids.agreement.nullable(),
    signerUserId: ids.user,
    authorityTitle: z.string(),
    authorityAttested: z.literal(true),
    acceptedIp: z.string(),
    acceptedUserAgent: z.string(),
    textHash: Sha256Schema,
    ...immutableRecord,
  })
  .strict();

export const PriceBookSchema = z
  .object({
    id: ids.priceBook,
    name: z.string(),
    currency: CurrencySchema,
    effectiveFrom: LocalDateSchema,
    effectiveTo: LocalDateSchema.nullable(),
    status: z.enum(["draft", "active", "retired"]),
    ...immutableRecord,
  })
  .strict();
export const RateCardSchema = z
  .object({
    id: ids.rateCard,
    priceBookId: ids.priceBook,
    sku: z.string(),
    approvedClaim: z.string(),
    region: z.string(),
    unit: z.string(),
    unitPrice: MoneySchema,
    floorPrice: MoneySchema.nullable(),
    overageRate: MoneySchema,
    minimumQuantity: QuantitySchema,
    trialLimit: QuantitySchema.nullable(),
    egressTreatment: z.string(),
    commitType: z.enum(["period_allowance", "term_drawdown"]),
    stripeTaxCode: z.string(),
    qboIncomeAccount: z.string(),
    partnerTransferPrices: z.record(z.string(), MoneySchema),
    ...immutableRecord,
  })
  .strict();

export const QuoteLineSchema = z
  .object({
    id: ids.quoteLine,
    quoteId: ids.quote,
    rateCardId: ids.rateCard,
    sku: z.string(),
    quantity: QuantitySchema,
    termMonths: z.int().positive(),
    unitPrice: MoneySchema,
    overageRate: MoneySchema,
    discountPercent: PercentageSchema,
    lineTotal: MoneySchema,
    ...immutableRecord,
  })
  .strict();
export const QuoteSchema = z
  .object({
    id: ids.quote,
    accountId: ids.account,
    endClientAccountId: ids.account.nullable(),
    partnerAccountId: ids.account.nullable(),
    priceBookId: ids.priceBook,
    seriesId: z.uuid(),
    previousRevisionId: ids.quote.nullable(),
    revision: z.int().positive(),
    status: z.enum([
      "draft",
      "issued",
      "accepted",
      "expired",
      "superseded",
      "rejected",
    ]),
    total: MoneySchema,
    marginFloorResult: z.enum([
      "not_configured",
      "pass",
      "exception_required",
      "approved",
      "rejected",
    ]),
    expiresAt: IsoDateTimeSchema,
    createdBy: ids.user,
    renderedDocumentId: ids.document.nullable(),
    partnerDocumentId: ids.document.nullable(),
    partnerResaleTotal: MoneySchema.nullable(),
    ...immutableRecord,
  })
  .strict();

export const PocSchema = z
  .object({
    id: ids.poc,
    accountId: ids.account,
    organizationId: ids.organization,
    partnerAccountId: ids.account.nullable(),
    workload: z.string(),
    permittedDataClass: z.string(),
    successTests: z.array(
      z.object({
        description: z.string(),
        passedAt: IsoDateTimeSchema.nullable(),
      }),
    ),
    commercialRange: z.object({ minimum: MoneySchema, maximum: MoneySchema }),
    capacityCap: QuantitySchema,
    egressCap: QuantitySchema,
    durationDays: z.int().positive(),
    namedKeys: z.array(z.string()),
    expiresAt: IsoDateTimeSchema,
    supportOwnerId: ids.user,
    kickoffAt: IsoDateTimeSchema,
    midpointAt: IsoDateTimeSchema,
    finalReportAt: IsoDateTimeSchema,
    infrastructureCost: MoneySchema.nullable(),
    engineeringMinutes: z.int().nonnegative(),
    status: z.enum([
      "proposed",
      "approved",
      "active",
      "expired",
      "converted",
      "closed",
    ]),
    convertedQuoteId: ids.quote.nullable(),
    ...mutableRecord,
  })
  .strict();

export const OrderSchema = z
  .object({
    id: ids.order,
    quoteId: ids.quote,
    agreementId: ids.agreement,
    accountId: ids.account,
    invoicingAccountId: ids.account,
    partnerAccountId: ids.account.nullable(),
    sourcing: z.enum(["direct", "referral", "resale"]),
    poNumber: z.string().nullable(),
    poDocumentId: ids.document.nullable(),
    signerUserId: ids.user,
    authorityTitle: z.string(),
    authorityAttested: z.literal(true),
    status: z.enum([
      "submitted",
      "accepted",
      "provisioning",
      "active",
      "amended",
      "completed",
      "cancelled",
      "terminated",
    ]),
    serviceStartsOn: LocalDateSchema,
    serviceEndsOn: LocalDateSchema.nullable(),
    noticeOn: LocalDateSchema.nullable(),
    orderFormDocumentId: ids.document.nullable(),
    ...immutableRecord,
  })
  .strict();
export const OrderLineSchema = z
  .object({
    id: ids.orderLine,
    orderId: ids.order,
    quoteLineId: ids.quoteLine,
    sku: z.string(),
    quantity: QuantitySchema,
    unitPrice: MoneySchema,
    overageRate: MoneySchema,
    supersededByAmendmentId: ids.amendment.nullable(),
    ...immutableRecord,
  })
  .strict();
export const AmendmentSchema = z
  .object({
    id: ids.amendment,
    orderId: ids.order,
    effectiveOn: LocalDateSchema,
    kind: z.enum([
      "upgrade",
      "downgrade",
      "term_extension",
      "co_termination",
      "mixed",
    ]),
    deltaLines: z.array(
      z.object({
        orderLineId: ids.orderLine.nullable(),
        sku: z.string(),
        quantityDelta: z.string(),
        priceDelta: MoneySchema,
      }),
    ),
    prorationMethod: z.enum(["daily", "monthly", "none", "custom"]),
    documentId: ids.document,
    ...immutableRecord,
  })
  .strict();
export const AmendmentLineSchema = z
  .object({
    id: ids.amendmentLine,
    amendmentId: ids.amendment,
    orderLineId: ids.orderLine.nullable(),
    sku: z.string().min(1),
    quantityDelta: z.string(),
    priceDelta: MoneySchema,
    ...immutableRecord,
  })
  .strict();

export const CommitmentLedgerSchema = z
  .object({
    id: ids.commitmentLedger,
    orderId: ids.order,
    orderLineId: ids.orderLine,
    commitType: z.enum(["period_allowance", "term_drawdown"]),
    committedQuantity: QuantitySchema,
    consumedQuantity: QuantitySchema,
    overageQuantity: QuantitySchema,
    periodStartsAt: IsoDateTimeSchema,
    periodEndsAt: IsoDateTimeSchema,
    ...mutableRecord,
  })
  .strict();
export const CommitmentEntrySchema = z
  .object({
    id: ids.commitmentEntry,
    ledgerId: ids.commitmentLedger,
    usageEventId: ids.usageEvent,
    quantity: QuantitySchema,
    overageQuantity: QuantitySchema,
    recordedAt: IsoDateTimeSchema,
    ...immutableRecord,
  })
  .strict();
export const EntitlementSchema = z
  .object({
    id: ids.entitlement,
    orderId: ids.order,
    orderLineId: ids.orderLine,
    organizationId: ids.organization,
    sku: z.string(),
    committedQuantity: QuantitySchema,
    region: z.string(),
    activatedAt: IsoDateTimeSchema.nullable(),
    maximumRetentionAt: IsoDateTimeSchema.nullable(),
    provisionedResourceId: z.string().nullable(),
    status: z.enum(["pending", "active", "suspended_write", "terminated"]),
    ...mutableRecord,
  })
  .strict();

const financialBase = {
  orderId: ids.order,
  currency: CurrencySchema,
  amount: MoneySchema,
  ...mutableRecord,
};
export const InvoiceSchema = z
  .object({
    id: ids.invoice,
    ...financialBase,
    accountId: ids.account,
    stripeInvoiceId: z.string(),
    poNumber: z.string().nullable(),
    status: z.enum(["draft", "open", "paid", "void", "uncollectible"]),
    dueAt: IsoDateTimeSchema.nullable(),
    paidAt: IsoDateTimeSchema.nullable(),
  })
  .strict();
export const PaymentSchema = z
  .object({
    id: ids.payment,
    invoiceId: ids.invoice,
    ...financialBase,
    stripePaymentIntentId: z.string(),
    status: z.enum(["pending", "succeeded", "failed", "refunded"]),
    receivedAt: IsoDateTimeSchema.nullable(),
  })
  .strict();
export const CreditNoteSchema = z
  .object({
    id: ids.creditNote,
    invoiceId: ids.invoice,
    ...financialBase,
    stripeCreditNoteId: z.string(),
    reasonCode: z.string(),
    approvedBy: ids.user,
    status: z.enum(["issued", "void"]),
    ...immutableRecord,
  })
  .strict();
export const RefundSchema = z
  .object({
    id: ids.refund,
    paymentId: ids.payment,
    ...financialBase,
    stripeRefundId: z.string(),
    reasonCode: z.string(),
    status: z.enum(["pending", "succeeded", "failed"]),
    ...immutableRecord,
  })
  .strict();
export const DisputeCaseSchema = z
  .object({
    id: ids.disputeCase,
    paymentId: ids.payment,
    ...financialBase,
    stripeDisputeId: z.string(),
    evidenceDueAt: IsoDateTimeSchema,
    status: z.enum(["needs_response", "under_review", "won", "lost"]),
    ...mutableRecord,
  })
  .strict();

export const InboundNoticeSchema = z
  .object({
    id: ids.inboundNotice,
    accountId: ids.account,
    orderId: ids.order,
    type: z.enum(["non_renewal", "termination", "breach_claim", "other"]),
    servedOn: LocalDateSchema,
    evidenceDocumentId: ids.document,
    recordedBy: ids.user,
    ...immutableRecord,
  })
  .strict();
export const TerminationSchema = z
  .object({
    id: ids.termination,
    accountId: ids.account,
    orderId: ids.order.nullable(),
    effectiveAt: IsoDateTimeSchema,
    finalBillingStatus: z.string(),
    teardownStatus: z.enum([
      "gated",
      "pending_approval",
      "approved",
      "requested",
      "confirmed",
      "retention_blocked",
      "complete",
    ]),
    deletionScheduledAt: IsoDateTimeSchema.nullable(),
    teardownConfirmedAt: IsoDateTimeSchema.nullable(),
    certificateId: ids.deletionCertificate.nullable(),
    ...mutableRecord,
  })
  .strict();
export const DeletionCertificateSchema = z
  .object({
    id: ids.deletionCertificate,
    terminationId: ids.termination,
    documentId: ids.document,
    scope: z.string(),
    method: z.string(),
    completedAt: IsoDateTimeSchema,
    lockedExclusions: z.array(
      z
        .object({
          scope: z.string(),
          retainedUntil: IsoDateTimeSchema,
          reason: z.string(),
        })
        .strict(),
    ),
    ...immutableRecord,
  })
  .strict();

export const DealRegistrationSchema = z
  .object({
    id: ids.dealRegistration,
    partnerAccountId: ids.account,
    endClientAccountId: ids.account,
    workload: z.string(),
    expectedVolume: QuantitySchema,
    status: z.enum([
      "registered",
      "approved",
      "expired",
      "converted",
      "rejected",
      "disputed",
    ]),
    protectionStartsAt: IsoDateTimeSchema,
    protectionEndsAt: IsoDateTimeSchema,
    decidedAt: IsoDateTimeSchema.nullable(),
    convertedOrderId: ids.order.nullable(),
    ...mutableRecord,
  })
  .strict();
export const NovationSchema = z
  .object({
    id: ids.novation,
    accountId: ids.account,
    formerPartnerAccountId: ids.account,
    sourceOrderId: ids.order,
    newAgreementId: ids.agreement,
    newOrderId: ids.order,
    reason: z.enum(["partner_default", "partner_exit", "agreed_handoff"]),
    continuityConfirmedAt: IsoDateTimeSchema,
    ...immutableRecord,
  })
  .strict();
export const CommissionAccrualSchema = z
  .object({
    id: ids.commissionAccrual,
    partnerAccountId: ids.account,
    invoiceId: ids.invoice,
    adjustmentSourceId: z.uuid().nullable(),
    rate: PercentageSchema,
    netCollectedRevenue: MoneySchema,
    amount: MoneySchema,
    holdbackAmount: MoneySchema,
    period: z.string().regex(/^\d{4}-(?:Q[1-4]|(?:0[1-9]|1[0-2]))$/),
    statementDocumentId: ids.document.nullable(),
    status: z.enum(["accrued", "stated", "paid"]),
    ...immutableRecord,
  })
  .strict();

export const DocumentSchema = z
  .object({
    id: ids.document,
    accountId: ids.account.nullable(),
    kind: z.string(),
    storageKey: z.string(),
    contentHash: Sha256Schema,
    mimeType: z.string(),
    byteLength: z.int().nonnegative(),
    objectLockMode: z.enum(["COMPLIANCE", "GOVERNANCE"]),
    retainUntil: IsoDateTimeSchema,
    legalHold: z.boolean(),
    storageVersionId: z.string(),
    ...immutableRecord,
  })
  .strict();
export const ExceptionCaseSchema = z
  .object({
    id: ids.exceptionCase,
    queue: z.enum([
      "pricing",
      "legal",
      "credit_collections",
      "restricted_parties",
      "disputes",
      "deal_registration_disputes",
      "poc_qualification",
    ]),
    objectType: z.string(),
    objectId: z.uuid(),
    ownerUserId: ids.user,
    backupUserId: ids.user.nullable(),
    targetAt: IsoDateTimeSchema,
    status: z.enum(["open", "approved", "rejected", "closed"]),
    decisionReason: z.string().nullable(),
    ...mutableRecord,
  })
  .strict();
export const ApprovalSchema = z
  .object({
    id: ids.approval,
    action: z.string(),
    objectType: z.string(),
    objectId: z.uuid(),
    requestedBy: ids.user,
    approvedBy: ids.user.nullable(),
    status: z.enum(["pending", "approved", "rejected", "expired"]),
    requestedAt: IsoDateTimeSchema,
    decidedAt: IsoDateTimeSchema.nullable(),
    ...mutableRecord,
  })
  .strict();
export const UsageEventSchema = z
  .object({
    id: ids.usageEvent,
    entitlementId: ids.entitlement,
    externalEventId: z.string(),
    measuredAt: IsoDateTimeSchema,
    quantity: QuantitySchema,
    kind: z.enum(["storage", "egress", "request", "other"]),
    ...immutableRecord,
  })
  .strict();
export const CostRecordSchema = z
  .object({
    id: ids.costRecord,
    entitlementId: ids.entitlement,
    period: z.string().regex(/^\d{4}-\d{2}$/),
    amount: MoneySchema,
    source: z.string(),
    ...immutableRecord,
  })
  .strict();
export const ReportExportSchema = z
  .object({
    id: ids.reportExport,
    report: z.enum([
      "revenue_forecast",
      "capacity",
      "renewal_churn",
      "partner_performance",
      "funnel_cycle",
      "margin_poc",
      "three_way_tie_out",
    ]),
    requestedBy: ids.user,
    parameters: z.record(z.string(), z.unknown()),
    documentId: ids.document.nullable(),
    status: z.enum(["pending", "running", "complete", "failed"]),
    ...mutableRecord,
  })
  .strict();

export const AuditEventSchema = z
  .object({
    id: ids.auditEvent,
    accountId: ids.account.nullable(),
    aggregateType: EntityNameSchema,
    aggregateId: z.uuid(),
    aggregateVersion: z.int().positive(),
    eventType: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
    eventVersion: z.int().positive(),
    actor: ActorSchema,
    occurredAt: IsoDateTimeSchema,
    requestId: ids.request,
    before: jsonObject.nullable(),
    after: jsonObject.nullable(),
    metadata: jsonObject,
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export const OutboxMessageSchema = z
  .object({
    id: ids.outboxMessage,
    eventId: ids.auditEvent,
    topic: z.string().min(1),
    payload: jsonObject,
    availableAt: IsoDateTimeSchema,
    attemptCount: z.int().nonnegative(),
    processedAt: IsoDateTimeSchema.nullable(),
    lastError: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export const IdempotencyRecordSchema = z
  .object({
    id: ids.idempotencyRecord,
    scope: z.string().min(1),
    key: IdempotencyKeySchema,
    requestHash: Sha256Schema,
    responseStatus: z.int().min(100).max(599).nullable(),
    responseHeaders: z.record(z.string(), z.string()).nullable(),
    responseBody: z.unknown().nullable(),
    lockToken: z.uuid(),
    lockedUntil: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
    expiresAt: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export const WebhookEventSchema = z
  .object({
    id: ids.webhookEvent,
    provider: z.string().min(1),
    providerEventId: z.string().min(1),
    eventType: z.string().min(1),
    signatureVerifiedAt: IsoDateTimeSchema,
    payloadHash: Sha256Schema,
    payload: jsonObject,
    occurredAt: IsoDateTimeSchema,
    lockedUntil: IsoDateTimeSchema,
    attemptCount: z.int().positive(),
    processedAt: IsoDateTimeSchema.nullable(),
    processingError: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export const ProviderOperationSchema = z
  .object({
    id: ids.providerOperation,
    provider: z.string().min(1),
    operation: z.string().min(1),
    idempotencyKey: IdempotencyKeySchema,
    aggregateType: EntityNameSchema,
    aggregateId: z.uuid(),
    status: z.enum(["pending", "running", "succeeded", "retrying", "failed"]),
    attemptCount: z.int().nonnegative(),
    providerReference: z.string().nullable(),
    lastError: z.string().nullable(),
    nextAttemptAt: IsoDateTimeSchema.nullable(),
    ...mutableRecord,
  })
  .strict();
export const WorkflowRunSchema = z
  .object({
    id: ids.workflowRun,
    taskIdentifier: z.string().min(1),
    idempotencyKey: IdempotencyKeySchema,
    aggregateType: EntityNameSchema,
    aggregateId: z.uuid(),
    triggerRunId: z.string().nullable(),
    status: z.enum([
      "pending",
      "running",
      "succeeded",
      "retrying",
      "failed",
      "cancelled",
    ]),
    attemptCount: z.int().nonnegative(),
    input: jsonObject,
    output: jsonObject.nullable(),
    lastError: z.string().nullable(),
    ...mutableRecord,
  })
  .strict();
export const ImpersonationSessionSchema = z
  .object({
    id: ids.impersonationSession,
    internalUserId: ids.user,
    targetAccountId: ids.account,
    reason: z.string().trim().min(8).max(500),
    startedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    endedAt: IsoDateTimeSchema.nullable(),
    requestId: ids.request,
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export const RoleSyncEventSchema = z
  .object({
    id: ids.roleSyncEvent,
    workosEventId: z.string().min(1),
    organizationId: ids.organization.nullable(),
    userId: ids.user.nullable(),
    action: z.enum(["upsert", "delete"]),
    payload: jsonObject,
    providerOccurredAt: IsoDateTimeSchema,
    processedAt: IsoDateTimeSchema.nullable(),
    error: z.string().nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const DomainSchemas = {
  account: AccountSchema,
  procurementProfile: ProcurementProfileSchema,
  organization: OrganizationSchema,
  user: UserSchema,
  membership: MembershipSchema,
  invite: InviteSchema,
  agreementTemplate: AgreementTemplateSchema,
  agreement: AgreementSchema,
  keyTerms: KeyTermsSchema,
  priceBook: PriceBookSchema,
  rateCard: RateCardSchema,
  quote: QuoteSchema,
  quoteLine: QuoteLineSchema,
  poc: PocSchema,
  order: OrderSchema,
  orderLine: OrderLineSchema,
  amendment: AmendmentSchema,
  amendmentLine: AmendmentLineSchema,
  commitmentLedger: CommitmentLedgerSchema,
  commitmentEntry: CommitmentEntrySchema,
  entitlement: EntitlementSchema,
  invoice: InvoiceSchema,
  payment: PaymentSchema,
  creditNote: CreditNoteSchema,
  refund: RefundSchema,
  disputeCase: DisputeCaseSchema,
  inboundNotice: InboundNoticeSchema,
  termination: TerminationSchema,
  deletionCertificate: DeletionCertificateSchema,
  dealRegistration: DealRegistrationSchema,
  novation: NovationSchema,
  commissionAccrual: CommissionAccrualSchema,
  document: DocumentSchema,
  exceptionCase: ExceptionCaseSchema,
  approval: ApprovalSchema,
  usageEvent: UsageEventSchema,
  costRecord: CostRecordSchema,
  reportExport: ReportExportSchema,
  auditEvent: AuditEventSchema,
  outboxMessage: OutboxMessageSchema,
  idempotencyRecord: IdempotencyRecordSchema,
  webhookEvent: WebhookEventSchema,
  providerOperation: ProviderOperationSchema,
  workflowRun: WorkflowRunSchema,
  impersonationSession: ImpersonationSessionSchema,
  roleSyncEvent: RoleSyncEventSchema,
} as const;

export type Account = z.infer<typeof AccountSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type Agreement = z.infer<typeof AgreementSchema>;
export type Entitlement = z.infer<typeof EntitlementSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
