import type {
  contractStatusFilterExtras,
  ContractApprovalState,
  ContractFileKind,
  ContractPaper,
  ContractSigningState,
  ContractStatus,
  ContractType,
} from "@clockwork/contracts";
import { contractDaysBetween } from "@clockwork/domain/contract-terms";
import type { MessageId } from "@/src/i18n";

export const contractTypeLabels: Readonly<Record<ContractType, MessageId>> = {
  mnda: "operations.contracts.type.mnda",
  nda_one_way: "operations.contracts.type.ndaOneWay",
  customer_msa: "operations.contracts.type.customerMsa",
  order_form: "operations.contracts.type.orderForm",
  dpa: "operations.contracts.type.dpa",
  security_annex: "operations.contracts.type.securityAnnex",
  channel_partnership: "operations.contracts.type.channelPartnership",
  technology_partner: "operations.contracts.type.technologyPartner",
  sow: "operations.contracts.type.sow",
  other: "operations.contracts.type.other",
};

export const contractPaperLabels: Readonly<Record<ContractPaper, MessageId>> = {
  ours: "operations.contracts.paper.ours",
  theirs: "operations.contracts.paper.theirs",
};

export const contractStatusLabels: Readonly<Record<ContractStatus, MessageId>> =
  {
    draft: "operations.contracts.status.draft",
    in_negotiation: "operations.contracts.status.inNegotiation",
    out_for_signature: "operations.contracts.status.outForSignature",
    executed: "operations.contracts.status.executed",
    expired: "operations.contracts.status.expired",
    terminated: "operations.contracts.status.terminated",
  };

export const contractStatusTone: Readonly<
  Record<ContractStatus, "neutral" | "info" | "success" | "warning" | "danger">
> = {
  draft: "neutral",
  in_negotiation: "info",
  out_for_signature: "info",
  executed: "success",
  expired: "neutral",
  terminated: "neutral",
};

/** Status filter options for drafts whose signing ended unsigned. */
export const statusFilterExtraLabels: Readonly<
  Record<(typeof contractStatusFilterExtras)[number], MessageId>
> = {
  signing_declined: "operations.contracts.filters.signingDeclined",
  signing_expired: "operations.contracts.filters.signingExpired",
  signing_canceled: "operations.contracts.filters.signingCanceled",
  signing_approval: "operations.contracts.filters.signingApproval",
  signing_attention: "operations.contracts.filters.signingAttention",
};

export const contractFileKindLabels: Readonly<
  Record<ContractFileKind, MessageId>
> = {
  main: "operations.contracts.file.main",
  attachment: "operations.contracts.file.attachment",
  counterparty_draft: "operations.contracts.file.counterpartyDraft",
  redline: "operations.contracts.file.redline",
  generated: "operations.contracts.file.generated",
  executed: "operations.contracts.file.executed",
};

export const signingStateLabels: Readonly<
  Record<ContractSigningState, MessageId>
> = {
  draft: "operations.contracts.signing.state.draft",
  preparing: "operations.contracts.signing.state.preparing",
  ready: "operations.contracts.signing.state.ready",
  sending: "operations.contracts.signing.state.sending",
  sent: "operations.contracts.signing.state.sent",
  viewed: "operations.contracts.signing.state.viewed",
  awaiting_countersignature:
    "operations.contracts.signing.state.awaitingCountersignature",
  completed: "operations.contracts.signing.state.completed",
  declined: "operations.contracts.signing.state.declined",
  expired: "operations.contracts.signing.state.expired",
  canceled: "operations.contracts.signing.state.canceled",
  attention: "operations.contracts.signing.state.attention",
};

export const approvalStateLabels: Readonly<
  Record<ContractApprovalState, MessageId>
> = {
  not_required: "operations.contracts.approval.notRequired",
  pending: "operations.contracts.approval.pending",
  approved: "operations.contracts.approval.approved",
  rejected: "operations.contracts.approval.rejected",
};

/**
 * Coded failures from the server, worded for the person who hit them. A
 * code with no entry reads as the generic message, never as the code.
 */
const errorMessages: Readonly<Record<string, MessageId>> = {
  CONTRACT_FORBIDDEN: "operations.contracts.error.forbidden",
  CONTRACT_MFA_REQUIRED: "operations.contracts.error.mfa",
  CONTRACT_DEMO_UNAVAILABLE: "operations.contracts.error.demo",
  CONTRACT_NOT_FOUND: "operations.contracts.error.notFound",
  CONTRACT_FILE_NOT_FOUND: "operations.contracts.error.fileNotFound",
  CONTRACT_VERSION_CONFLICT: "operations.contracts.error.versionConflict",
  COLLATERAL_VERSION_CONFLICT: "operations.contracts.error.versionConflict",
  CONTRACT_IDEMPOTENCY_CONFLICT: "operations.contracts.error.duplicate",
  COLLATERAL_IDEMPOTENCY_CONFLICT: "operations.contracts.error.duplicate",
  DOCUMENT_TOO_LARGE: "operations.contracts.error.tooLarge",
  DOCUMENT_NOT_PDF: "operations.contracts.error.notPdf",
  DOCUMENT_EMPTY: "operations.contracts.error.empty",
  DOCUMENT_INTEGRITY: "operations.contracts.error.integrity",
  CONTRACT_FILE_PERMANENT: "operations.contracts.error.filePermanent",
  CONTRACT_EXECUTED_FINAL: "operations.contracts.error.executedFinal",
  DOCUMENT_BUSY: "operations.contracts.error.documentBusy",
  CONTRACT_STATUS_FOLLOWS_SIGNING:
    "operations.contracts.error.statusFollowsSigning",
  CONTRACT_APPROVER_IS_PREPARER: "operations.contracts.error.selfApproval",
  CONTRACT_RECENT_AUTH_REQUIRED: "operations.decision.recentAuth",
  SELF_APPROVAL_REASON_REQUIRED: "common.selfApproval.error.reason",
  SELF_APPROVAL_NOT_PERMITTED: "common.selfApproval.error.notPermitted",
  SELF_APPROVAL_NOT_OWN_REQUEST: "common.selfApproval.error.notOwn",
  SELF_APPROVAL_SERVICE_ONLY: "common.selfApproval.error.directSession",
  CONTRACT_APPROVAL_NOT_PENDING: "operations.contracts.error.alreadyDecided",
  CONTRACT_APPROVAL_REQUIRED: "operations.contracts.error.approvalRequired",
  CONTRACT_REJECTION_REASON_REQUIRED:
    "operations.contracts.error.reasonRequired",
  CONTRACT_BUSY: "operations.contracts.error.busy",
  CONTRACT_LEASE_LOST: "operations.contracts.error.busy",
  CONTRACT_REMINDER_TOO_SOON: "operations.contracts.error.reminderTooSoon",
  CONTRACT_NOT_PENDING: "operations.contracts.error.notPending",
  CONTRACT_VOID_REQUIRED: "operations.contracts.error.voidRequired",
  CONTRACT_ALREADY_COMPLETED: "operations.contracts.error.alreadyCompleted",
  CONTRACT_NOT_VOIDABLE: "operations.contracts.error.notVoidable",
  CONTRACT_NOT_PREPARER: "operations.contracts.error.notPreparer",
  CONTRACT_NEEDS_ATTENTION: "operations.contracts.error.needsAttention",
  CONTRACT_STILL_PREPARING: "operations.contracts.error.stillPreparing",
  CONTRACT_DISTINCT_SIGNERS_REQUIRED:
    "operations.contracts.error.distinctSigners",
  CONTRACT_COUNTERSIGNER_UNAVAILABLE:
    "operations.contracts.error.countersignerUnavailable",
  CONTRACT_TEMPLATE_PENDING_LEGAL: "operations.contracts.error.pendingLegal",
  CONTRACT_TEMPLATE_NOT_FOUND: "operations.contracts.error.templateNotFound",
  CONTRACT_TEMPLATE_VALUE_CHARACTERS:
    "operations.contracts.error.valueCharacters",
  CONTRACT_TEMPLATE_LINE_ITEMS_INVALID:
    "operations.contracts.lineItems.error.invalid",
  CONTRACT_TEMPLATE_FIELD_INVALID:
    "operations.contracts.lineItems.error.invalid",
  PRICING_SCENARIO_NOT_FOUND:
    "operations.sales.pricing.scenario.error.notFound",
  PRICING_SCENARIOS_UNAVAILABLE:
    "operations.contracts.lineItems.import.unavailable",
  CONTRACT_SIGNING_NOT_CONFIGURED:
    "operations.contracts.error.signingNotConfigured",
  COLLATERAL_LINK_OR_FILE: "operations.salesLibrary.error.linkOrFile",
  COLLATERAL_NOT_FOUND: "operations.contracts.error.notFound",
  SESSION_EXPIRED: "operations.session.expired",
  COLLATERAL_FILE_NOT_FOUND: "operations.contracts.error.fileNotFound",
  UPLOAD_INTERRUPTED: "operations.contracts.error.uploadInterrupted",
  provider_unavailable: "operations.contracts.error.provider",
};

export function errorMessage(code: string | null | undefined): MessageId {
  if (code?.startsWith("SIGNWELL_"))
    return "operations.contracts.error.provider";
  return (code && errorMessages[code]) || "operations.contracts.error.generic";
}

/** Zod issue messages and codes, as field-level guidance. */
const fieldMessages: Readonly<Record<string, MessageId>> = {
  required: "operations.contracts.field.error.required",
  too_big: "operations.contracts.field.error.tooLong",
  too_small: "operations.contracts.field.error.required",
  invalid_format: "operations.contracts.field.error.format",
  invalid_type: "operations.contracts.field.error.required",
  invalid_value: "operations.contracts.field.error.required",
  value_format: "operations.contracts.field.error.amount",
  value_and_currency: "operations.contracts.field.error.amountAndCurrency",
  required_for_auto_renew: "operations.contracts.field.error.autoRenew",
  required_for_term: "operations.contracts.field.error.termNeedsDate",
  tag_characters: "operations.contracts.field.error.tag",
  control_character: "operations.contracts.field.error.characters",
  https: "operations.salesLibrary.error.https",
  number: "operations.contracts.field.error.number",
  email: "operations.contracts.field.error.email",
  characters: "operations.contracts.lineItems.error.characters",
  below_minimum: "operations.contracts.lineItems.error.belowMinimum",
  line_total: "operations.contracts.lineItems.error.lineTotal",
  line_items: "operations.contracts.lineItems.error.lines",
};

export function fieldMessage(code: string): MessageId {
  return fieldMessages[code] ?? "operations.contracts.field.error.check";
}

/** A calendar date (YYYY-MM-DD) in the reader's language, never shifted by
 * time zone. */
export function formatContractDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function daysUntil(date: string, today: string) {
  return contractDaysBetween(today, date);
}

export function formatContractValue(
  minor: number,
  currency: string,
  locale: string,
) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

export function formatFileSize(bytes: number, locale: string) {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1
    ? new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "megabyte",
        maximumFractionDigits: 1,
      }).format(megabytes)
    : new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "kilobyte",
        maximumFractionDigits: 0,
      }).format(Math.max(1, bytes / 1024));
}
