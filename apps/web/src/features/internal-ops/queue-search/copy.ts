import type { MessageId, Translator } from "@/src/i18n";

import type { QueueRisk, QueueSla, QueueStatus } from "./model";
import type { SearchGroup } from "./search-model";

/**
 * Closed sets the queue and search surfaces show, mapped to message IDs.
 *
 * The projections carry machine codes (`legal_review`, `agreement_draft`,
 * `review_exception`). A code that is not listed here is shown as the code
 * itself: it is an identifier the reader can quote to support, and guessing
 * English words for it is how "Legal Review" reached a Japanese screen.
 */

/** `exception_cases.queue`: the vocabulary in `@clockwork/domain` exceptions. */
export const queueLabels: Readonly<Record<string, MessageId>> = {
  pricing: "operations.queue.type.pricing",
  legal: "operations.queue.type.legal",
  credit_collections: "operations.queue.type.creditCollections",
  restricted_parties: "operations.queue.type.restrictedParties",
  disputes: "operations.queue.type.disputes",
  deal_registration_disputes: "operations.queue.type.dealRegistrationDisputes",
  poc_qualification: "operations.queue.type.pocQualification",
  provisioning_recovery: "operations.queue.type.provisioningRecovery",
  migration_review: "operations.queue.type.migrationReview",
  offboarding_destructive: "operations.queue.type.offboardingDestructive",
  order_acceptance_review: "operations.queue.type.orderAcceptanceReview",
  billing_operations: "operations.queue.type.billingOperations",
  commissions: "operations.queue.type.commissions",
  reconciliation: "operations.queue.type.reconciliation",
  reporting: "operations.queue.type.reporting",
  workflow_operations: "operations.queue.type.workflowOperations",
  // Written by the demo fixtures.
  legal_review: "operations.queue.type.legalReview",
  price_exception: "operations.queue.type.priceException",
};

/** `authoritative.objectType`: what the case is about. */
export const subjectLabels: Readonly<Record<string, MessageId>> = {
  account: "recordKind.account",
  agreement: "recordKind.agreement",
  agreement_draft: "operations.queue.subject.agreementDraft",
  amendment: "recordKind.amendment",
  credit_note: "recordKind.creditNote",
  deal_registration: "recordKind.dealRegistration",
  dispute: "recordKind.dispute",
  invoice: "recordKind.invoice",
  migration: "operations.queue.subject.migration",
  order: "recordKind.order",
  payment: "recordKind.payment",
  poc: "recordKind.poc",
  price_book: "recordKind.priceBook",
  quote: "recordKind.quote",
  report_export: "operations.queue.subject.reportExport",
  tax_rule_book: "operations.queue.subject.taxRuleBook",
  termination: "operations.queue.subject.termination",
  workflow_exception: "operations.queue.subject.workflowException",
};

/** `allowedActions`: projection action codes a queue record can offer. */
export const actionLabels: Readonly<Record<string, MessageId>> = {
  review_exception: "operations.queue.action.reviewException",
  approve_exception: "operations.queue.action.approveException",
  reject_exception: "operations.queue.action.rejectException",
  evaluate_dunning: "operations.queue.action.evaluateDunning",
  prepare_artifact: "operations.queue.action.prepareArtifact",
  replay_provider_event: "operations.queue.action.replayProviderEvent",
};

export const statusLabels: Readonly<Record<QueueStatus, MessageId>> = {
  open: "status.open",
  pending: "status.pending",
  blocked: "status.blocked",
  resolved: "status.resolved",
};

/** Where a column or a `dt` already says "Risk": "High", not "High risk". */
export const riskLabels: Readonly<Record<QueueRisk, MessageId>> = {
  high: "risk.level.high",
  medium: "risk.level.medium",
  low: "risk.level.low",
};

/** The SLA state in a table cell, where the column already says "SLA". */
export const slaLabels: Readonly<Record<QueueSla, MessageId>> = {
  breached: "operations.queue.sla.breached",
  "due-soon": "operations.queue.sla.dueSoon",
  healthy: "operations.queue.sla.healthy",
};

/** The SLA state on its own, in the detail header. */
export const slaChipLabels: Readonly<Record<QueueSla, MessageId>> = {
  breached: "operations.queue.view.slaBreached",
  "due-soon": "operations.queue.sla.dueSoon",
  healthy: "operations.queue.sla.chip.healthy",
};

/** The SLA filter's options, which describe a window rather than a state. */
export const slaFilterLabels: Readonly<Record<QueueSla, MessageId>> = {
  breached: "operations.queue.sla.breached",
  "due-soon": "operations.queue.sla.dueWithin24Hours",
  healthy: "operations.queue.sla.healthy",
};

export const ageLabels: Readonly<Record<string, MessageId>> = {
  "7": "operations.queue.age.upTo7Days",
  "8-30": "operations.queue.age.from8To30Days",
  "30+": "operations.queue.age.over30Days",
};

export const sortLabels: Readonly<Record<string, MessageId>> = {
  "sla-risk-age": "operations.queue.sort.slaRiskAge",
  risk: "common.sort.riskDesc",
  oldest: "common.sort.oldest",
  updated: "operations.queue.sort.updated",
};

export const searchGroupLabels: Readonly<Record<SearchGroup, MessageId>> = {
  accounts: "operations.search.group.accounts",
  agreements: "operations.search.group.agreements",
  quotes: "operations.search.group.quotes",
  orders: "operations.search.group.orders",
  invoices: "operations.search.group.invoices",
  endClients: "operations.search.group.endClients",
  queues: "operations.search.group.queues",
  documents: "operations.search.group.documents",
};

/**
 * Generic record statuses a search result can carry when the source wrote no
 * status label of its own.
 */
export const recordStatusLabels: Readonly<Record<string, MessageId>> = {
  active: "status.active",
  approved: "status.approved",
  attention: "status.attention",
  blocked: "status.blocked",
  canceled: "status.canceled",
  complete: "status.complete",
  converted: "status.converted",
  declined: "status.declined",
  draft: "status.draft",
  expired: "status.expired",
  failed: "status.failed",
  issued: "status.issued",
  open: "status.open",
  overdue: "status.overdue",
  paid: "status.paid",
  pending: "status.pending",
  provisioning: "status.provisioning",
  ready: "status.ready",
  recovering: "status.recovering",
  rejected: "status.rejected",
  resolved: "status.resolved",
  signed: "status.signed",
  submitted: "status.submitted",
  superseded: "status.superseded",
  terminated: "status.terminated",
};

/** A code's label in the reader's language, or the code when it is not known. */
export function codeLabel(
  labels: Readonly<Record<string, MessageId>>,
  code: string,
  t: Translator,
): string {
  const id = Object.hasOwn(labels, code) ? labels[code] : undefined;
  return id ? t(id) : code;
}
