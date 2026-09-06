import { z } from "zod";

export const entityNames = [
  "account",
  "organization",
  "user",
  "membership",
  "invite",
  "procurement_profile",
  "agreement_template",
  "agreement",
  "key_terms",
  "price_book",
  "payg_offer_version",
  "payg_enrollment",
  "trial",
  "rate_card",
  "quote",
  "quote_line",
  "poc",
  "order",
  "order_line",
  "amendment",
  "amendment_line",
  "commitment_ledger",
  "commitment_entry",
  "entitlement",
  "invoice",
  "collection_case",
  "payment",
  "credit_note",
  "refund",
  "dispute_case",
  "inbound_notice",
  "termination",
  "deletion_certificate",
  "deal_registration",
  "novation",
  "commission_accrual",
  "audit_event",
  "outbox_message",
  "document",
  "exception_case",
  "approval",
  "webhook_event",
  "usage_event",
  "cost_record",
  "report_export",
  "idempotency_record",
  "impersonation_session",
  "provider_operation",
  "provisioning_attempt",
  "role_sync_event",
  "workflow_run",
  "external_gate",
  "system_capability",
  "system_bootstrap",
  "experience_action_request",
  "experience_action_claim",
  "portal_projection",
] as const;

export type EntityName = (typeof entityNames)[number];

const id = <T extends string>() => z.uuid().brand<T>();

export const ids = {
  account: id<"AccountId">(),
  organization: id<"OrganizationId">(),
  user: id<"UserId">(),
  membership: id<"MembershipId">(),
  invite: id<"InviteId">(),
  procurementProfile: id<"ProcurementProfileId">(),
  agreementTemplate: id<"AgreementTemplateId">(),
  agreement: id<"AgreementId">(),
  keyTerms: id<"KeyTermsId">(),
  priceBook: id<"PriceBookId">(),
  rateCard: id<"RateCardId">(),
  quote: id<"QuoteId">(),
  quoteLine: id<"QuoteLineId">(),
  poc: id<"PocId">(),
  order: id<"OrderId">(),
  orderLine: id<"OrderLineId">(),
  amendment: id<"AmendmentId">(),
  amendmentLine: id<"AmendmentLineId">(),
  commitmentLedger: id<"CommitmentLedgerId">(),
  commitmentEntry: id<"CommitmentEntryId">(),
  entitlement: id<"EntitlementId">(),
  invoice: id<"InvoiceId">(),
  payment: id<"PaymentId">(),
  creditNote: id<"CreditNoteId">(),
  refund: id<"RefundId">(),
  disputeCase: id<"DisputeCaseId">(),
  inboundNotice: id<"InboundNoticeId">(),
  termination: id<"TerminationId">(),
  deletionCertificate: id<"DeletionCertificateId">(),
  dealRegistration: id<"DealRegistrationId">(),
  novation: id<"NovationId">(),
  commissionAccrual: id<"CommissionAccrualId">(),
  auditEvent: id<"AuditEventId">(),
  outboxMessage: id<"OutboxMessageId">(),
  document: id<"DocumentId">(),
  exceptionCase: id<"ExceptionCaseId">(),
  approval: id<"ApprovalId">(),
  webhookEvent: id<"WebhookEventId">(),
  usageEvent: id<"UsageEventId">(),
  costRecord: id<"CostRecordId">(),
  reportExport: id<"ReportExportId">(),
  idempotencyRecord: id<"IdempotencyRecordId">(),
  impersonationSession: id<"ImpersonationSessionId">(),
  providerOperation: id<"ProviderOperationId">(),
  roleSyncEvent: id<"RoleSyncEventId">(),
  workflowRun: id<"WorkflowRunId">(),
  externalGate: id<"ExternalGateId">(),
  request: z.string().min(8).max(128).brand<"RequestId">(),
  external: z.string().min(1).max(255).brand<"ExternalId">(),
} as const;

export const CurrencySchema = z.enum(["USD", "EUR", "GBP"]);
export type Currency = z.infer<typeof CurrencySchema>;

/** Integer minor units serialized as a string so JSON never loses precision. */
const minimumPostgresBigint = -9_223_372_036_854_775_808n;
const maximumPostgresBigint = 9_223_372_036_854_775_807n;
const minorUnitPattern = /^-?(0|[1-9]\d*)$/;
export const MinorUnitSchema = z
  .string()
  .regex(minorUnitPattern)
  .refine((value) => {
    // Zod refinements can still run after a failed regex check. Guarding the
    // conversion keeps malformed input on the controlled validation path.
    if (!minorUnitPattern.test(value)) return true;
    const parsed = BigInt(value);
    return parsed >= minimumPostgresBigint && parsed <= maximumPostgresBigint;
  }, "Minor units must fit a signed PostgreSQL bigint")
  .brand<"MinorUnit">();
export type MinorUnit = z.infer<typeof MinorUnitSchema>;

export const MoneySchema = z
  .object({ currency: CurrencySchema, minor: MinorUnitSchema })
  .strict();
export type Money = z.infer<typeof MoneySchema>;

/** PostgreSQL numeric(38,18) non-negative decimal, serialized without exponent notation. */
export const QuantitySchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,19})(\.\d{1,18})?$/)
  .brand<"Quantity">();
export type Quantity = z.infer<typeof QuantitySchema>;

export const PercentageSchema = z.number().min(0).max(100);
export const IsoDateTimeSchema = z.iso
  .datetime({ offset: true })
  .brand<"IsoDateTime">();
export const LocalDateSchema = z.iso.date().brand<"LocalDate">();
export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<"Sha256">();
export const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .brand<"CountryCode">();
export const EmailSchema = z.email().max(320);
export const UrlSchema = z.url();

export const VersionSchema = z
  .object({ sequence: z.int().positive(), immutable: z.boolean() })
  .strict();

export const TimestampsSchema = z
  .object({ createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema })
  .strict();

export const PaginationRequestSchema = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.int().min(1).max(100).default(50),
  })
  .strict();

export const paginationResponse = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      nextCursor: z.string().max(512).nullable(),
    })
    .strict();

export const IdempotencyKeySchema = z
  .string()
  .min(16)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .brand<"IdempotencyKey">();

export type RequestId = z.infer<typeof ids.request>;
export type AccountId = z.infer<typeof ids.account>;
export type OrganizationId = z.infer<typeof ids.organization>;
export type UserId = z.infer<typeof ids.user>;
export type MembershipId = z.infer<typeof ids.membership>;
export type InviteId = z.infer<typeof ids.invite>;
export type ProcurementProfileId = z.infer<typeof ids.procurementProfile>;
export type AgreementTemplateId = z.infer<typeof ids.agreementTemplate>;
export type AgreementId = z.infer<typeof ids.agreement>;
export type KeyTermsId = z.infer<typeof ids.keyTerms>;
export type PriceBookId = z.infer<typeof ids.priceBook>;
export type RateCardId = z.infer<typeof ids.rateCard>;
export type QuoteId = z.infer<typeof ids.quote>;
export type QuoteLineId = z.infer<typeof ids.quoteLine>;
export type PocId = z.infer<typeof ids.poc>;
export type OrderId = z.infer<typeof ids.order>;
export type OrderLineId = z.infer<typeof ids.orderLine>;
export type AmendmentId = z.infer<typeof ids.amendment>;
export type AmendmentLineId = z.infer<typeof ids.amendmentLine>;
export type CommitmentLedgerId = z.infer<typeof ids.commitmentLedger>;
export type CommitmentEntryId = z.infer<typeof ids.commitmentEntry>;
export type EntitlementId = z.infer<typeof ids.entitlement>;
export type InvoiceId = z.infer<typeof ids.invoice>;
export type PaymentId = z.infer<typeof ids.payment>;
export type CreditNoteId = z.infer<typeof ids.creditNote>;
export type RefundId = z.infer<typeof ids.refund>;
export type DisputeCaseId = z.infer<typeof ids.disputeCase>;
export type InboundNoticeId = z.infer<typeof ids.inboundNotice>;
export type TerminationId = z.infer<typeof ids.termination>;
export type DeletionCertificateId = z.infer<typeof ids.deletionCertificate>;
export type DealRegistrationId = z.infer<typeof ids.dealRegistration>;
export type NovationId = z.infer<typeof ids.novation>;
export type CommissionAccrualId = z.infer<typeof ids.commissionAccrual>;
export type AuditEventId = z.infer<typeof ids.auditEvent>;
export type OutboxMessageId = z.infer<typeof ids.outboxMessage>;
export type DocumentId = z.infer<typeof ids.document>;
export type ExceptionCaseId = z.infer<typeof ids.exceptionCase>;
export type ApprovalId = z.infer<typeof ids.approval>;
export type WebhookEventId = z.infer<typeof ids.webhookEvent>;
export type UsageEventId = z.infer<typeof ids.usageEvent>;
export type CostRecordId = z.infer<typeof ids.costRecord>;
export type ReportExportId = z.infer<typeof ids.reportExport>;
export type IdempotencyRecordId = z.infer<typeof ids.idempotencyRecord>;
export type ImpersonationSessionId = z.infer<typeof ids.impersonationSession>;
export type ProviderOperationId = z.infer<typeof ids.providerOperation>;
export type RoleSyncEventId = z.infer<typeof ids.roleSyncEvent>;
export type WorkflowRunId = z.infer<typeof ids.workflowRun>;
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
