import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  accounts,
  agreementTemplates,
  agreements,
  commerceUsers,
  documents,
  organizations,
  orders,
  pocs,
  terminations,
} from "../../schema";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const rowVersion = () => integer("row_version").notNull().default(1);

export const lifecyclePartnerDomains = pgTable(
  "lifecycle_partner_domains",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    domain: text("domain").notNull(),
    verificationTokenHash: text("verification_token_hash").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    brandName: text("brand_name").notNull(),
    logoUrl: text("logo_url"),
    primaryColor: text("primary_color").notNull(),
    communicationOwner: text("communication_owner").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("lifecycle_partner_domain_unique").on(table.domain),
    index("lifecycle_partner_domain_account_idx").on(table.accountId),
    check(
      "lifecycle_partner_domain_token_hash_check",
      sql`${table.verificationTokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "lifecycle_partner_domain_color_check",
      sql`${table.primaryColor} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
    check(
      "lifecycle_partner_domain_owner_check",
      sql`${table.communicationOwner} in ('fil_one','partner')`,
    ),
  ],
);

export const lifecycleAgreementDrafts = pgTable(
  "lifecycle_agreement_drafts",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    templateId: uuid("template_id").references(() => agreementTemplates.id),
    customerPaperDocumentId: uuid("customer_paper_document_id").references(
      () => documents.id,
    ),
    paper: text("paper").notNull(),
    executionMode: text("execution_mode").notNull(),
    negotiationStatus: text("negotiation_status").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    keyTerms: jsonb("key_terms").notNull().default({}),
    status: text("status").notNull().default("draft"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => commerceUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("lifecycle_agreement_draft_account_idx").on(
      table.accountId,
      table.status,
    ),
    check(
      "lifecycle_agreement_draft_paper_check",
      sql`${table.paper} in ('ours','theirs')`,
    ),
    check(
      "lifecycle_agreement_draft_mode_check",
      sql`${table.executionMode} in ('click_through','counter_signed')`,
    ),
    check(
      "lifecycle_agreement_draft_status_check",
      sql`${table.status} in ('draft','executed','void')`,
    ),
    check(
      "lifecycle_agreement_draft_negotiation_check",
      sql`${table.negotiationStatus} in ('standard','uploaded','redlining','counsel_review','agreed','rejected')`,
    ),
    check(
      "lifecycle_agreement_draft_source_check",
      sql`(${table.paper} = 'ours' and ${table.templateId} is not null and ${table.customerPaperDocumentId} is null) or (${table.paper} = 'theirs' and ${table.templateId} is null and ${table.customerPaperDocumentId} is not null)`,
    ),
  ],
);

export const lifecycleAgreementTemplateTexts = pgTable(
  "lifecycle_agreement_template_texts",
  {
    templateId: uuid("template_id")
      .primaryKey()
      .references(() => agreementTemplates.id),
    exactText: text("exact_text").notNull(),
    exactTextHash: text("exact_text_hash").notNull().unique(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "lifecycle_agreement_template_text_hash_check",
      sql`${table.exactTextHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "lifecycle_agreement_template_bytes_hash_check",
      sql`encode(extensions.digest(convert_to(${table.exactText}, 'UTF8'), 'sha256'), 'hex') = ${table.exactTextHash}`,
    ),
  ],
);

export const lifecycleClickAcceptances = pgTable(
  "lifecycle_click_acceptances",
  {
    id: id(),
    agreementId: uuid("agreement_id")
      .notNull()
      .unique()
      .references(() => agreements.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => agreementTemplates.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => commerceUsers.id),
    exactTextHash: text("exact_text_hash").notNull(),
    evidenceHash: text("evidence_hash").notNull().unique(),
    evidence: jsonb("evidence").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "lifecycle_click_text_hash_check",
      sql`${table.exactTextHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "lifecycle_click_evidence_hash_check",
      sql`${table.evidenceHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const lifecycleSignatureEnvelopes = pgTable(
  "lifecycle_signature_envelopes",
  {
    id: id(),
    agreementDraftId: uuid("agreement_draft_id")
      .notNull()
      .references(() => lifecycleAgreementDrafts.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    providerEnvelopeId: text("provider_envelope_id").notNull().unique(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    signerEmail: text("signer_email").notNull(),
    signingMode: text("signing_mode").notNull(),
    returnUrl: text("return_url").notNull(),
    state: text("state").notNull(),
    providerSequence: integer("provider_sequence").notNull().default(0),
    providerEventIds: text("provider_event_ids").array().notNull().default([]),
    signedPdfDocumentId: uuid("signed_pdf_document_id").references(
      () => documents.id,
    ),
    completionCertificateDocumentId: uuid(
      "completion_certificate_document_id",
    ).references(() => documents.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("lifecycle_envelope_draft_idx").on(table.agreementDraftId),
    check(
      "lifecycle_envelope_mode_check",
      sql`${table.signingMode} in ('redirect','embedded')`,
    ),
    check(
      "lifecycle_envelope_state_check",
      sql`${table.state} in ('created','sent','viewed','completed','declined','expired','voided')`,
    ),
    check(
      "lifecycle_envelope_sequence_check",
      sql`${table.providerSequence} >= 0`,
    ),
    check(
      "lifecycle_envelope_completion_check",
      sql`${table.state} <> 'completed' or (${table.signedPdfDocumentId} is not null and ${table.completionCertificateDocumentId} is not null and ${table.completedAt} is not null)`,
    ),
  ],
);

export const lifecyclePassThroughAcceptances = pgTable(
  "lifecycle_pass_through_acceptances",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => agreementTemplates.id),
    templateVersion: text("template_version").notNull(),
    exactTextHash: text("exact_text_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => commerceUsers.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    acceptedIp: text("accepted_ip").notNull(),
    uiContext: text("ui_context").notNull(),
    evidenceHash: text("evidence_hash").notNull().unique(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("lifecycle_pass_through_version_unique").on(
      table.organizationId,
      table.templateId,
      table.templateVersion,
      table.userId,
    ),
    check(
      "lifecycle_pass_through_hash_check",
      sql`${table.exactTextHash} ~ '^[a-f0-9]{64}$' and ${table.evidenceHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const lifecyclePocEvidence = pgTable(
  "lifecycle_poc_evidence",
  {
    id: id(),
    pocId: uuid("poc_id")
      .notNull()
      .references(() => pocs.id),
    kind: text("kind").notNull(),
    sourceId: text("source_id").notNull(),
    payload: jsonb("payload").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("lifecycle_poc_evidence_source_unique").on(
      table.pocId,
      table.kind,
      table.sourceId,
    ),
    check(
      "lifecycle_poc_evidence_kind_check",
      sql`${table.kind} in ('success_snapshot','quote_acceptance')`,
    ),
    check(
      "lifecycle_poc_evidence_hash_check",
      sql`${table.evidenceHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const lifecycleProvisioningAttempts = pgTable(
  "lifecycle_provisioning_attempts",
  {
    id: id(),
    commandId: text("command_id").notNull().unique(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    orderId: uuid("order_id").references(() => orders.id),
    pocId: uuid("poc_id").references(() => pocs.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    operation: text("operation").notNull(),
    state: text("state").notNull(),
    attempt: jsonb("attempt").notNull(),
    providerOperationId: text("provider_operation_id"),
    lastProviderOccurredAt: timestamp("last_provider_occurred_at", {
      withTimezone: true,
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("lifecycle_provisioning_state_idx").on(table.state, table.updatedAt),
    check(
      "lifecycle_provisioning_state_check",
      sql`${table.state} in ('pending','in_flight','retry_scheduled','dead_letter','confirmed')`,
    ),
    check(
      "lifecycle_provisioning_operation_check",
      sql`${table.operation} in ('provision','upgrade_poc','sandbox','teardown')`,
    ),
    check(
      "lifecycle_provisioning_scope_check",
      sql`(${table.pocId} is not null and ${table.orderId} is null and ${table.operation} = 'sandbox') or (${table.orderId} is not null and ${table.pocId} is null and ${table.operation} <> 'sandbox')`,
    ),
  ],
);

export const lifecycleRenewalActions = pgTable(
  "lifecycle_renewal_actions",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    evidenceDocumentId: uuid("evidence_document_id").references(
      () => documents.id,
    ),
    payload: jsonb("payload").notNull(),
    evidenceHash: text("evidence_hash").notNull().unique(),
    createdAt: createdAt(),
  },
  (table) => [
    index("lifecycle_renewal_action_order_idx").on(
      table.orderId,
      table.createdAt,
    ),
    check(
      "lifecycle_renewal_action_check",
      sql`${table.action} in ('renew','change_term','request_change','decline')`,
    ),
    check(
      "lifecycle_renewal_evidence_hash_check",
      sql`${table.evidenceHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "lifecycle_renewal_decline_evidence_check",
      sql`${table.action} <> 'decline' or ${table.evidenceDocumentId} is not null`,
    ),
  ],
);

export const lifecycleOffboardingPlans = pgTable(
  "lifecycle_offboarding_plans",
  {
    terminationId: uuid("termination_id")
      .primaryKey()
      .references(() => terminations.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => commerceUsers.id),
    reason: text("reason").notNull(),
    plan: jsonb("plan").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    index("lifecycle_offboarding_account_idx").on(table.accountId),
    check(
      "lifecycle_offboarding_reason_check",
      sql`${table.reason} in ('customer_request','non_renewal','partner_request','partner_default','material_breach')`,
    ),
  ],
);

export const lifecycleMigrationRuns = pgTable(
  "lifecycle_migration_runs",
  {
    id: id(),
    executionMode: text("execution_mode").notNull(),
    sourceSnapshotHash: text("source_snapshot_hash").notNull(),
    sourceKind: text("source_kind").notNull(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => commerceUsers.id),
    checkpoint: jsonb("checkpoint").notNull(),
    status: text("status").notNull(),
    batchSize: integer("batch_size").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("lifecycle_migration_snapshot_mode_unique").on(
      table.sourceSnapshotHash,
      table.executionMode,
    ),
    index("lifecycle_migration_status_idx").on(table.status, table.updatedAt),
    check(
      "lifecycle_migration_mode_check",
      sql`${table.executionMode} in ('discovery','rehearsal','execute')`,
    ),
    check(
      "lifecycle_migration_snapshot_hash_check",
      sql`${table.sourceSnapshotHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "lifecycle_migration_source_kind_check",
      sql`${table.sourceKind} in ('fixture','real_snapshot')`,
    ),
    check(
      "lifecycle_migration_status_check",
      sql`${table.status} in ('discovery','accounts','orders','complete','failed')`,
    ),
    check(
      "lifecycle_migration_batch_size_check",
      sql`${table.batchSize} between 1 and 100`,
    ),
  ],
);

export const lifecycleMigrationMatches = pgTable(
  "lifecycle_migration_matches",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => lifecycleMigrationRuns.id),
    legacyAccountId: text("legacy_account_id").notNull(),
    disposition: text("disposition").notNull(),
    accountId: uuid("account_id").references(() => accounts.id),
    reason: text("reason").notNull(),
    evidenceDocumentId: uuid("evidence_document_id")
      .notNull()
      .references(() => documents.id),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => commerceUsers.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("lifecycle_migration_match_unique").on(
      table.runId,
      table.legacyAccountId,
    ),
    check(
      "lifecycle_migration_disposition_check",
      sql`${table.disposition} in ('create','attach','skip')`,
    ),
    check(
      "lifecycle_migration_match_hash_check",
      sql`${table.evidenceHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "lifecycle_migration_attach_scope_check",
      sql`(${table.disposition} = 'attach' and ${table.accountId} is not null) or (${table.disposition} <> 'attach' and ${table.accountId} is null)`,
    ),
  ],
);

export const lifecycleDomainEvents = pgTable(
  "lifecycle_domain_events",
  {
    id: id(),
    provider: text("provider"),
    providerEventId: text("provider_event_id"),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("lifecycle_provider_event_unique").on(
      table.provider,
      table.providerEventId,
    ),
    uniqueIndex("lifecycle_aggregate_sequence_unique").on(
      table.aggregateType,
      table.aggregateId,
      table.sequence,
    ),
    check(
      "lifecycle_domain_event_hash_check",
      sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check("lifecycle_domain_event_sequence_check", sql`${table.sequence} > 0`),
    check(
      "lifecycle_provider_identity_check",
      sql`(${table.provider} is null and ${table.providerEventId} is null) or (${table.provider} is not null and ${table.providerEventId} is not null)`,
    ),
  ],
);

export const lifecycleFeatureGateApprovals = pgTable(
  "lifecycle_feature_gate_approvals",
  {
    id: id(),
    gate: text("gate").notNull(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => commerceUsers.id),
    approverId: uuid("approver_id")
      .notNull()
      .references(() => commerceUsers.id),
    approved: boolean("approved").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    evidenceDocumentId: uuid("evidence_document_id")
      .notNull()
      .references(() => documents.id),
    authenticationEvidenceHash: text("authentication_evidence_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("lifecycle_gate_approver_unique").on(
      table.gate,
      table.requesterId,
      table.approverId,
    ),
    check(
      "lifecycle_gate_separation_check",
      sql`${table.requesterId} <> ${table.approverId}`,
    ),
    check(
      "lifecycle_gate_authentication_hash_check",
      sql`${table.authenticationEvidenceHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const lifecycleIdempotencyRecords = pgTable(
  "lifecycle_idempotency_records",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    lockToken: uuid("lock_token").notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    uniqueIndex("lifecycle_idempotency_owner_key_unique").on(
      table.ownerUserId,
      table.scope,
      table.key,
    ),
    index("lifecycle_idempotency_expiry_idx").on(table.expiresAt),
    check(
      "lifecycle_idempotency_hash_check",
      sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "lifecycle_idempotency_completion_check",
      sql`(${table.completedAt} is null and ${table.responseStatus} is null and ${table.responseBody} is null) or (${table.completedAt} is not null and ${table.responseStatus} is not null and ${table.responseBody} is not null)`,
    ),
  ],
);
