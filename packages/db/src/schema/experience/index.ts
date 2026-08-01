import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  accounts,
  auditEvents,
  commerceUsers,
  documents,
  organizations,
  outboxMessages,
} from "../../schema";
import {
  lifecycleAgreementDrafts,
  lifecycleSignatureEnvelopes,
} from "../lifecycle";

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`public.uuid_v7()`);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const rowVersion = () => integer("row_version").notNull().default(1);

const audienceCheck = (audience: SQLWrapper) =>
  sql`${audience} in ('customer','partner','internal')`;
const documentKindCheck = (documentKind: SQLWrapper) =>
  sql`${documentKind} in ('direct_quote','partner_transfer_quote','partner_resale_quote','order_form','amendment','poc_summary','poc_final_report','invoice_companion','receipt','commission_statement','renewal_confirmation','decline_confirmation','deletion_certificate','reconciliation_report','report_export')`;

export const experienceAssistedSessions = pgTable(
  "experience_assisted_sessions",
  {
    id: id(),
    authenticationSessionId: text("authentication_session_id").notNull(),
    internalUserId: uuid("internal_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    actorSnapshotName: text("actor_snapshot_name").notNull(),
    actorSnapshotEmail: text("actor_snapshot_email").notNull(),
    targetAccountId: uuid("target_account_id")
      .notNull()
      .references(() => accounts.id),
    reason: text("reason").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    requestId: text("request_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("experience_assisted_session_active_idx").on(
      table.internalUserId,
      table.authenticationSessionId,
      table.endedAt,
      table.expiresAt,
    ),
    uniqueIndex("experience_assisted_session_single_live_idx")
      .on(table.internalUserId, table.authenticationSessionId)
      .where(sql`${table.endedAt} is null`),
    check(
      "experience_assisted_sessions_actor_snapshot_name_check",
      sql`char_length(trim(${table.actorSnapshotName})) > 0`,
    ),
    check(
      "experience_assisted_sessions_actor_snapshot_email_check",
      sql`${table.actorSnapshotEmail} = lower(trim(${table.actorSnapshotEmail}))`,
    ),
    check(
      "experience_assisted_sessions_reason_check",
      sql`char_length(trim(${table.reason})) between 8 and 500`,
    ),
    check(
      "experience_assisted_session_window_check",
      sql`${table.expiresAt} > ${table.startedAt} and ${table.expiresAt} <= ${table.startedAt} + interval '15 minutes'`,
    ),
    check(
      "experience_assisted_session_end_check",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const experienceReleaseProofSessions = pgTable(
  "experience_release_proof_sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => commerceUsers.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    nonceHash: text("nonce_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    recentAuthenticationVerified: boolean("recent_authentication_verified")
      .notNull()
      .default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    unique("experience_release_proof_session_unique").on(
      table.id,
      table.userId,
      table.organizationId,
    ),
    index("experience_release_proof_session_expiry_idx").on(
      table.expiresAt,
      table.revokedAt,
    ),
    check(
      "experience_release_proof_sessions_nonce_hash_check",
      sql`${table.nonceHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const experiencePortalProjections = pgTable(
  "experience_portal_projections",
  {
    id: id(),
    audience: text("audience").notNull(),
    audienceAccountId: uuid("audience_account_id").references(
      () => accounts.id,
    ),
    subjectAccountId: uuid("subject_account_id").references(() => accounts.id),
    channel: text("channel").notNull(),
    recordKey: text("record_key").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    commandResource: text("command_resource"),
    payload: jsonb("payload").notNull(),
    sourceAggregateVersion: integer("source_aggregate_version").notNull(),
    sourceHash: text("source_hash").notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", {
      withTimezone: true,
    }).notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rowVersion: rowVersion(),
  },
  (table) => [
    unique("experience_projection_identity_unique")
      .on(
        table.audience,
        table.audienceAccountId,
        table.channel,
        table.recordKey,
      )
      .nullsNotDistinct(),
    index("experience_projection_page_idx").on(
      table.audience,
      table.audienceAccountId,
      table.channel,
      table.sourceUpdatedAt.desc(),
      table.id.desc(),
    ),
    index("experience_projection_aggregate_idx").on(
      table.aggregateType,
      table.aggregateId,
    ),
    check(
      "experience_portal_projections_audience_check",
      audienceCheck(table.audience),
    ),
    check(
      "experience_portal_projections_channel_check",
      sql`${table.channel} ~ '^[a-z][a-z0-9_-]{1,63}$'`,
    ),
    check(
      "experience_portal_projections_record_key_check",
      sql`length(${table.recordKey}) between 1 and 160`,
    ),
    check(
      "experience_portal_projections_aggregate_type_check",
      sql`length(${table.aggregateType}) between 1 and 80`,
    ),
    check(
      "experience_portal_projections_source_hash_check",
      sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "experience_projection_source_aggregate_version_check",
      sql`${table.sourceAggregateVersion} > 0`,
    ),
    check(
      "experience_portal_projections_row_version_check",
      sql`${table.rowVersion} > 0`,
    ),
    check(
      "experience_projection_audience_scope_check",
      sql`(${table.audience} = 'internal' and ${table.audienceAccountId} is null) or (${table.audience} <> 'internal' and ${table.audienceAccountId} is not null)`,
    ),
    check(
      "experience_projection_payload_check",
      sql`jsonb_typeof(${table.payload}) = 'object' and (not (${table.payload} ? 'allowedActions') or jsonb_typeof(${table.payload}->'allowedActions') = 'array')`,
    ),
  ],
);

export const experienceProjectionActionRequests = pgTable(
  "experience_projection_action_requests",
  {
    id: id(),
    projectionId: uuid("projection_id")
      .notNull()
      .references(() => experiencePortalProjections.id),
    audienceAccountId: uuid("audience_account_id").references(
      () => accounts.id,
    ),
    subjectAccountId: uuid("subject_account_id").references(() => accounts.id),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    commandResource: text("command_resource").notNull(),
    action: text("action").notNull(),
    expectedVersion: integer("expected_version").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    effectiveAccountId: uuid("effective_account_id").references(
      () => accounts.id,
    ),
    assistedSessionId: uuid("assisted_session_id"),
    assistedReason: text("assisted_reason"),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    recentAuthenticationVerified: boolean("recent_authentication_verified")
      .notNull()
      .default(false),
    idempotencyKey: text("idempotency_key").notNull(),
    requestPayload: jsonb("request_payload").notNull().default({}),
    status: text("status").notNull().default("queued"),
    resultReference: text("result_reference"),
    resultCode: text("result_code"),
    authoritativeVersion: integer("authoritative_version"),
    commandReplayed: boolean("command_replayed"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    auditEventId: uuid("audit_event_id")
      .notNull()
      .unique()
      .default(sql`public.uuid_v7()`)
      .references(() => auditEvents.id),
    outboxMessageId: uuid("outbox_message_id")
      .notNull()
      .unique()
      .default(sql`public.uuid_v7()`)
      .references(() => outboxMessages.id),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    unique("experience_action_idempotency_unique").on(
      table.actorUserId,
      table.idempotencyKey,
    ),
    index("experience_action_dispatch_idx").on(table.status, table.createdAt),
    check(
      "experience_projection_action_requests_action_check",
      sql`${table.action} ~ '^[a-z][a-z0-9_]{1,79}$'`,
    ),
    check(
      "experience_projection_action_requests_expected_version_check",
      sql`${table.expectedVersion} > 0`,
    ),
    check(
      "experience_projection_action_requests_idempotency_key_check",
      sql`length(${table.idempotencyKey}) between 16 and 255`,
    ),
    check(
      "experience_projection_action_requests_request_payload_check",
      sql`jsonb_typeof(${table.requestPayload}) = 'object'`,
    ),
    check(
      "experience_projection_action_requests_status_check",
      sql`${table.status} in ('queued','applied','rejected','failed')`,
    ),
    check(
      "experience_action_completion_check",
      sql`(${table.status} = 'queued' and ${table.completedAt} is null and ${table.resultReference} is null and ${table.resultCode} is null and ${table.authoritativeVersion} is null and ${table.commandReplayed} is null) or (${table.status} <> 'queued' and ${table.completedAt} is not null and ${table.resultReference} is not null and ${table.resultCode} is not null and (${table.commandReplayed} is not null or (${table.status} = 'applied' and ${table.resultCode} = 'LEGACY_PORTAL_ACTION_APPLIED') or (${table.status} = 'rejected' and ${table.resultCode} = 'LEGACY_PORTAL_ACTION_REJECTED') or (${table.status} = 'failed' and ${table.resultCode} in ('LEGACY_PORTAL_ACTION_FAILED','LEGACY_PROJECTION_VERSION_UNVERIFIED'))) and (${table.authoritativeVersion} is null or ${table.authoritativeVersion} > 0))`,
    ),
    check(
      "experience_action_assisted_check",
      sql`(${table.assistedSessionId} is null and ${table.assistedReason} is null) or (${table.assistedSessionId} is not null and ${table.effectiveAccountId} is not null and length(trim(${table.assistedReason})) >= 8)`,
    ),
    check(
      "experience_projection_action_requests_row_version_check",
      sql`${table.rowVersion} > 0`,
    ),
  ],
);

export const experienceProjectionActionClaims = pgTable(
  "experience_projection_action_claims",
  {
    actionRequestId: uuid("action_request_id")
      .primaryKey()
      .references(() => experienceProjectionActionRequests.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => auditEvents.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => outboxMessages.id),
    idempotencyKey: text("idempotency_key").notNull(),
    claimToken: uuid("claim_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    unique("experience_action_claim_event_unique").on(table.eventId),
    unique("experience_action_claim_message_unique").on(table.messageId),
    index("experience_projection_action_claim_lease_idx")
      .on(table.leaseUntil)
      .where(sql`${table.claimToken} is not null`),
    check(
      "experience_projection_action_claims_idempotency_key_check",
      sql`length(${table.idempotencyKey}) between 16 and 255`,
    ),
    check(
      "experience_action_claim_lease_check",
      sql`(${table.claimToken} is null and ${table.leaseUntil} is null) or (${table.claimToken} is not null and ${table.leaseUntil} is not null)`,
    ),
    check(
      "experience_projection_action_claims_attempt_count_check",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "experience_projection_action_claims_row_version_check",
      sql`${table.rowVersion} > 0`,
    ),
  ],
);

export const experienceProjectionMaterializationReceipts = pgTable(
  "experience_projection_materialization_receipts",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .unique()
      .references(() => auditEvents.id),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    aggregateVersion: integer("aggregate_version").notNull(),
    eventType: text("event_type").notNull(),
    sourceHash: text("source_hash").notNull(),
    projectionCount: integer("projection_count").notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("experience_projection_receipt_source_unique").on(
      table.aggregateType,
      table.aggregateId,
      table.aggregateVersion,
      table.eventType,
    ),
    check(
      "experience_projection_materialization_aggregate_type_check",
      sql`length(${table.aggregateType}) between 1 and 80`,
    ),
    check(
      "experience_projection_materialization_aggregate_version_check",
      sql`${table.aggregateVersion} > 0`,
    ),
    check(
      "experience_projection_materialization_event_type_check",
      sql`length(${table.eventType}) between 3 and 160`,
    ),
    check(
      "experience_projection_materialization_projection_count_check",
      sql`${table.projectionCount} >= 0`,
    ),
    check(
      "experience_projection_materialization_source_hash_check",
      sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const experienceEsignReturnCorrelations = pgTable(
  "experience_esign_return_correlations",
  {
    id: id(),
    stateHash: text("state_hash").notNull().unique(),
    envelopeId: uuid("envelope_id")
      .notNull()
      .unique()
      .references(() => lifecycleSignatureEnvelopes.id),
    agreementDraftId: uuid("agreement_draft_id")
      .notNull()
      .references(() => lifecycleAgreementDrafts.id),
    accountId: uuid("account_id").references(() => accounts.id),
    signerUserId: uuid("signer_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    signerEmail: text("signer_email").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "experience_esign_return_correlations_state_hash_check",
      sql`${table.stateHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "experience_esign_return_correlations_signer_email_check",
      sql`${table.signerEmail} = lower(${table.signerEmail})`,
    ),
    check(
      "experience_esign_return_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const experienceEsignReturnReceipts = pgTable(
  "experience_esign_return_receipts",
  {
    id: id(),
    correlationId: uuid("correlation_id")
      .notNull()
      .references(() => experienceEsignReturnCorrelations.id),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    observedEnvelopeState: text("observed_envelope_state").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    requestId: text("request_id").notNull(),
  },
  (table) => [
    unique("experience_esign_receipt_request_unique").on(
      table.correlationId,
      table.requestId,
    ),
    index("experience_esign_receipt_correlation_idx").on(
      table.correlationId,
      table.observedAt,
    ),
    check(
      "experience_esign_return_receipts_request_id_check",
      sql`length(${table.requestId}) between 8 and 128`,
    ),
  ],
);

export const experienceEvidenceUploads = pgTable(
  "experience_evidence_uploads",
  {
    id: id(),
    publicUploadId: text("public_upload_id").notNull().unique(),
    idempotencyKey: text("idempotency_key").notNull(),
    providerUploadId: text("provider_upload_id").unique(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => commerceUsers.id),
    accountId: uuid("account_id").references(() => accounts.id),
    organizationId: uuid("organization_id").references(() => organizations.id),
    journey: text("journey").notNull(),
    targetId: uuid("target_id").notNull(),
    evidenceKind: text("evidence_kind").notNull(),
    declaredContentHash: text("declared_content_hash").notNull(),
    declaredMimeType: text("declared_mime_type").notNull(),
    declaredByteLength: bigint("declared_byte_length", {
      mode: "bigint",
    }).notNull(),
    quarantineStorageKey: text("quarantine_storage_key"),
    immutableStorageKey: text("immutable_storage_key"),
    storageVersionId: text("storage_version_id"),
    scanReference: text("scan_reference"),
    documentId: uuid("document_id").references(() => documents.id),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    legalHold: boolean("legal_hold").notNull().default(false),
    status: text("status").notNull().default("pending"),
    failureCode: text("failure_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    unique("experience_evidence_idempotency_unique").on(
      table.ownerUserId,
      table.idempotencyKey,
    ),
    index("experience_evidence_owner_idx").on(
      table.ownerUserId,
      table.createdAt.desc(),
    ),
    index("experience_evidence_pending_idx").on(table.status, table.expiresAt),
    check(
      "experience_evidence_uploads_public_upload_id_check",
      sql`${table.publicUploadId} ~ '^upl_[A-Za-z0-9_-]{20,80}$'`,
    ),
    check(
      "experience_evidence_uploads_idempotency_key_check",
      sql`length(${table.idempotencyKey}) between 16 and 255`,
    ),
    check(
      "experience_evidence_uploads_journey_check",
      sql`${table.journey} in ('customer_paper','poc','procurement','exception','approval')`,
    ),
    check(
      "experience_evidence_uploads_evidence_kind_check",
      sql`${table.evidenceKind} in ('agreement','acceptance','quote','order_form','amendment','notice','completion_certificate','deletion_certificate','screening','approval')`,
    ),
    check(
      "experience_evidence_uploads_declared_content_hash_check",
      sql`${table.declaredContentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "experience_evidence_uploads_declared_mime_type_check",
      sql`${table.declaredMimeType} in ('application/pdf','image/png','image/jpeg','text/plain','text/csv')`,
    ),
    check(
      "experience_evidence_uploads_declared_byte_length_check",
      sql`${table.declaredByteLength} between 1 and 52428800`,
    ),
    check(
      "experience_evidence_uploads_status_check",
      sql`${table.status} in ('pending','uploaded','scanning','quarantined','promoted','expired','failed')`,
    ),
    check(
      "experience_evidence_uploads_row_version_check",
      sql`${table.rowVersion} > 0`,
    ),
    check(
      "experience_evidence_expiry_retention_check",
      sql`${table.expiresAt} > ${table.createdAt} and ${table.retainUntil} > ${table.expiresAt}`,
    ),
    check(
      "experience_evidence_scope_check",
      sql`${table.accountId} is not null`,
    ),
    check(
      "experience_evidence_state_metadata_check",
      sql`(${table.status} = 'pending' and ${table.providerUploadId} is null and ${table.documentId} is null) or (${table.status} in ('uploaded','scanning') and ${table.providerUploadId} is not null and ${table.documentId} is null) or (${table.status} = 'quarantined' and ${table.scanReference} is not null and ${table.documentId} is null) or (${table.status} = 'promoted' and ${table.providerUploadId} is not null and ${table.immutableStorageKey} is not null and ${table.storageVersionId} is not null and ${table.scanReference} is not null and ${table.documentId} is not null and ${table.failureCode} is null) or (${table.status} in ('expired','failed') and ${table.documentId} is null)`,
    ),
  ],
);

export const experienceDocumentRenderRequests = pgTable(
  "experience_document_render_requests",
  {
    id: id(),
    accountId: uuid("account_id").references(() => accounts.id),
    audience: text("audience").notNull(),
    audienceAccountId: uuid("audience_account_id").references(
      () => accounts.id,
    ),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    documentKind: text("document_kind").notNull(),
    input: jsonb("input").notNull(),
    sourceHash: text("source_hash").notNull(),
    sourceVersion: text("source_version").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => commerceUsers.id),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    failureCode: text("failure_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (table) => [
    unique("experience_render_source_unique").on(
      table.subjectType,
      table.subjectId,
      table.documentKind,
      table.sourceHash,
    ),
    check(
      "experience_document_render_requests_audience_check",
      audienceCheck(table.audience),
    ),
    check(
      "experience_document_render_requests_subject_type_check",
      sql`length(${table.subjectType}) between 1 and 80`,
    ),
    check(
      "experience_document_render_requests_document_kind_check",
      documentKindCheck(table.documentKind),
    ),
    check(
      "experience_document_render_requests_input_check",
      sql`jsonb_typeof(${table.input}) = 'object'`,
    ),
    check(
      "experience_document_render_requests_source_hash_check",
      sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "experience_document_render_requests_source_version_check",
      sql`length(${table.sourceVersion}) between 1 and 80`,
    ),
    check(
      "experience_document_render_requests_status_check",
      sql`${table.status} in ('pending','rendering','stored','failed')`,
    ),
    check(
      "experience_document_render_requests_row_version_check",
      sql`${table.rowVersion} > 0`,
    ),
    check(
      "experience_render_audience_check",
      sql`(${table.audience} = 'internal' and ${table.accountId} is null and ${table.audienceAccountId} is null) or (${table.audience} <> 'internal' and ${table.accountId} is not null and ${table.audienceAccountId} is not null)`,
    ),
    check(
      "experience_render_retention_check",
      sql`${table.retainUntil} > ${table.createdAt}`,
    ),
  ],
);

export const experienceArtifactDeliveries = pgTable(
  "experience_artifact_deliveries",
  {
    id: id(),
    renderRequestId: uuid("render_request_id")
      .notNull()
      .unique()
      .references(() => experienceDocumentRenderRequests.id),
    accountId: uuid("account_id").references(() => accounts.id),
    audience: text("audience").notNull(),
    audienceAccountId: uuid("audience_account_id").references(
      () => accounts.id,
    ),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    documentKind: text("document_kind").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .unique()
      .references(() => documents.id),
    immutableVersion: text("immutable_version").notNull(),
    sourceHash: text("source_hash").notNull(),
    contentHash: text("content_hash").notNull(),
    storageVersionId: text("storage_version_id").notNull(),
    mimeType: text("mime_type").notNull(),
    byteLength: bigint("byte_length", { mode: "bigint" }).notNull(),
    filename: text("filename").notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("experience_delivery_subject_idx").on(
      table.subjectType,
      table.subjectId,
      table.documentKind,
    ),
    index("experience_delivery_audience_idx").on(
      table.audience,
      table.audienceAccountId,
      table.createdAt.desc(),
    ),
    check(
      "experience_artifact_deliveries_audience_check",
      audienceCheck(table.audience),
    ),
    check(
      "experience_artifact_deliveries_document_kind_check",
      documentKindCheck(table.documentKind),
    ),
    check(
      "experience_artifact_deliveries_immutable_version_check",
      sql`length(${table.immutableVersion}) between 1 and 80`,
    ),
    check(
      "experience_artifact_deliveries_source_hash_check",
      sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "experience_artifact_deliveries_content_hash_check",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "experience_artifact_deliveries_mime_type_check",
      sql`${table.mimeType} = 'application/pdf'`,
    ),
    check(
      "experience_artifact_deliveries_byte_length_check",
      sql`${table.byteLength} > 0`,
    ),
    check(
      "experience_artifact_deliveries_filename_check",
      sql`${table.filename} ~ '^[a-z0-9][a-z0-9._-]{0,159}\\.pdf$' and ${table.filename} !~ '\\.\\.'`,
    ),
    check(
      "experience_delivery_audience_check",
      sql`(${table.audience} = 'internal' and ${table.accountId} is null and ${table.audienceAccountId} is null) or (${table.audience} <> 'internal' and ${table.accountId} is not null and ${table.audienceAccountId} is not null)`,
    ),
  ],
);

/** Root schema composition must spread this object into runtimeSchema. */
export const experienceSchema = {
  experienceAssistedSessions,
  experienceReleaseProofSessions,
  experiencePortalProjections,
  experienceProjectionActionRequests,
  experienceProjectionActionClaims,
  experienceProjectionMaterializationReceipts,
  experienceEsignReturnCorrelations,
  experienceEsignReturnReceipts,
  experienceEvidenceUploads,
  experienceDocumentRenderRequests,
  experienceArtifactDeliveries,
};
