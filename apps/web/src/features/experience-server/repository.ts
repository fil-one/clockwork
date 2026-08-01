import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import type { SessionClaims } from "@clockwork/api";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
  type RuntimeDatabase,
  type RuntimeTransaction,
} from "@clockwork/db";

import { getRuntimeDatabase, getServiceDatabase } from "@/src/db/service";

import { authorizationContext } from "./authorization";
import {
  ExperienceProblem,
  type ArtifactKind,
  type ArtifactRepresentation,
  type EsignReturnStatus,
  type EvidenceKind,
  type EvidenceJourney,
  type EvidenceUploadRecord,
  type ExperienceAudience,
  type ProjectionActionInput,
  type ProjectionActionReceipt,
  type ProjectionChannel,
  type ProjectionListInput,
  type ProjectionPage,
  type ProjectionRecord,
} from "./model";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FRESHNESS_SECONDS = 300;

type Row = Readonly<Record<string, unknown>>;

function textValue(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Expected text column ${key}`);
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new Error(`Expected nullable text column ${key}`);
  return value;
}

function numberValue(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  throw new Error(`Expected integer column ${key}`);
}

function booleanValue(row: Row, key: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean")
    throw new Error(`Expected boolean column ${key}`);
  return value;
}

function objectValue(row: Row, key: string): Readonly<Record<string, unknown>> {
  const value = row[key];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected object column ${key}`);
  return value as Readonly<Record<string, unknown>>;
}

function dateText(row: Row, key: string): string {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  return textValue(row, key);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function databaseSecret(): string {
  const secret = process.env.AUTHORIZATION_CONTEXT_SECRET?.trim();
  if (!secret || secret.length < 32)
    throw new ExperienceProblem(
      503,
      "DATABASE_AUTHORIZATION_UNAVAILABLE",
      "Authorized experience database access is not configured",
    );
  return secret;
}

function cursorValue(
  cursor?: string,
): { updatedAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("updatedAt" in parsed) ||
      typeof parsed.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.updatedAt)) ||
      !("id" in parsed) ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id)
    )
      throw new Error("invalid");
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new ExperienceProblem(
      422,
      "INVALID_CURSOR",
      "Projection cursor is invalid",
    );
  }
}

function nextCursor(row: Row | undefined): string | null {
  if (!row) return null;
  return Buffer.from(
    JSON.stringify({
      updatedAt: dateText(row, "source_updated_at"),
      id: textValue(row, "id"),
    }),
    "utf8",
  ).toString("base64url");
}

function projectionRecord(row: Row, now: Date): ProjectionRecord {
  const sourceUpdatedAt = dateText(row, "source_updated_at");
  return {
    id: textValue(row, "id"),
    recordKey: textValue(row, "record_key"),
    aggregateType: textValue(row, "aggregate_type"),
    aggregateId: textValue(row, "aggregate_id"),
    accountId: nullableText(row, "audience_account_id"),
    audience: textValue(row, "audience") as ExperienceAudience,
    channel: textValue(row, "channel") as ProjectionChannel,
    version: numberValue(row, "row_version"),
    sourceUpdatedAt,
    projectedAt: dateText(row, "projected_at"),
    stale:
      now.getTime() - Date.parse(sourceUpdatedAt) >
      MAX_FRESHNESS_SECONDS * 1000,
    data: objectValue(row, "payload"),
  };
}

function actionReceipt(row: Row): ProjectionActionReceipt {
  return {
    id: textValue(row, "id"),
    projectionId: textValue(row, "projection_id"),
    aggregateType: textValue(row, "aggregate_type"),
    aggregateId: textValue(row, "aggregate_id"),
    action: textValue(row, "action"),
    expectedVersion: numberValue(row, "expected_version"),
    status: textValue(row, "status") as ProjectionActionReceipt["status"],
    createdAt: dateText(row, "created_at"),
    auditEventId: textValue(row, "audit_event_id"),
    outboxMessageId: textValue(row, "outbox_message_id"),
  };
}

function evidenceRecord(row: Row): EvidenceUploadRecord {
  return {
    id: textValue(row, "id"),
    uploadId: textValue(row, "public_upload_id"),
    providerUploadId: nullableText(row, "provider_upload_id"),
    ownerUserId: textValue(row, "owner_user_id"),
    accountId: nullableText(row, "account_id"),
    journey: textValue(row, "journey") as EvidenceJourney,
    targetId: textValue(row, "target_id"),
    kind: textValue(row, "evidence_kind") as EvidenceKind,
    contentHash: textValue(row, "declared_content_hash"),
    mimeType: textValue(row, "declared_mime_type"),
    byteLength: textValue(row, "declared_byte_length"),
    retainUntil: dateText(row, "retain_until"),
    expiresAt: dateText(row, "expires_at"),
    legalHold: booleanValue(row, "legal_hold"),
    status: textValue(row, "status") as EvidenceUploadRecord["status"],
    scanReference: nullableText(row, "scan_reference"),
    documentId: nullableText(row, "document_id"),
    immutableStorageKey: nullableText(row, "immutable_storage_key"),
    storageVersionId: nullableText(row, "storage_version_id"),
    version: numberValue(row, "row_version"),
  };
}

function artifactRepresentation(row: Row): ArtifactRepresentation {
  const id = textValue(row, "id");
  const kind = textValue(row, "document_kind") as ArtifactKind;
  return {
    id,
    kind,
    subjectType: textValue(row, "subject_type"),
    subjectId: textValue(row, "subject_id"),
    accountId: textValue(row, "account_id"),
    audience: textValue(row, "audience") as ExperienceAudience,
    audienceAccountId: nullableText(row, "audience_account_id"),
    documentId: textValue(row, "document_id"),
    version: textValue(row, "immutable_version"),
    sourceHash: textValue(row, "source_hash"),
    contentHash: textValue(row, "content_hash"),
    mimeType: "application/pdf",
    byteLength: textValue(row, "byte_length"),
    filename: textValue(row, "filename"),
    retainUntil: dateText(row, "retain_until"),
    createdAt: dateText(row, "created_at"),
    downloadHref: `/api/experience/artifacts/${kind}/${id}`,
  };
}

export interface SigningTarget {
  agreementId: string;
  accountId: string;
  documentId: string;
  signerUserId: string;
  signerEmail: string;
}

export interface RenderRequestRecord {
  id: string;
  accountId: string;
  audience: ExperienceAudience;
  audienceAccountId: string | null;
  subjectType: string;
  subjectId: string;
  kind: ArtifactKind;
  input: Readonly<Record<string, unknown>>;
  sourceHash: string;
  retainUntil: string;
  status: "pending" | "rendering" | "stored" | "failed";
  version: number;
}

export interface SignedDocumentDownload {
  envelopeId: string;
  agreementId: string;
  documentId: string;
  storageKey: string;
  storageVersionId: string;
  contentHash: string;
  byteLength: string;
  mimeType: "application/pdf";
  filename: string;
}

export class DatabaseExperienceRepository {
  public constructor(
    private readonly runtime: RuntimeDatabase = getRuntimeDatabase(),
    private readonly service: RuntimeDatabase = getServiceDatabase(),
  ) {}

  private authorized<T>(
    session: SessionClaims,
    requestId: string,
    operation: (transaction: RuntimeTransaction) => Promise<T>,
  ): Promise<T> {
    return withAuthorizedTransaction(
      this.runtime,
      authorizationContext(session, requestId),
      { secret: databaseSecret() },
      operation,
    );
  }

  public listProjections(input: ProjectionListInput): Promise<ProjectionPage> {
    return this.authorized(
      input.session,
      `projection:${crypto.randomUUID()}`,
      async (transaction) => {
        const cursor = cursorValue(input.cursor);
        const rows = await transaction.execute(sql<Row>`
        select id, audience, audience_account_id, channel, record_key,
               aggregate_type, aggregate_id, payload, source_updated_at,
               projected_at, row_version
        from experience_portal_projections
        where audience = ${input.audience}
          and audience_account_id is not distinct from ${input.accountId}::uuid
          and channel = ${input.channel}
          and (
            ${input.audience} <> 'internal'
            or experience_session_assisted_account() is null
            or subject_account_id = experience_session_assisted_account()
          )
          and (
            ${cursor?.updatedAt ?? null}::timestamptz is null
            or (source_updated_at, id) < (
              ${cursor?.updatedAt ?? null}::timestamptz,
              ${cursor?.id ?? null}::uuid
            )
          )
        order by source_updated_at desc, id desc
        limit ${input.limit + 1}
      `);
        const hasMore = rows.length > input.limit;
        const selected = hasMore ? rows.slice(0, input.limit) : rows;
        return {
          items: selected.map((row) => projectionRecord(row, input.now)),
          nextCursor: hasMore ? nextCursor(selected.at(-1)) : null,
          generatedAt: input.now.toISOString(),
          freshnessSeconds: MAX_FRESHNESS_SECONDS,
        };
      },
    );
  }

  public findProjection(
    input: Omit<ProjectionListInput, "cursor" | "limit"> & {
      recordKey: string;
    },
  ) {
    return this.authorized(
      input.session,
      `projection-detail:${crypto.randomUUID()}`,
      async (transaction) => {
        const rows = await transaction.execute(sql<Row>`
        select id, audience, audience_account_id, channel, record_key,
               aggregate_type, aggregate_id, payload, source_updated_at,
               projected_at, row_version
        from experience_portal_projections
        where audience = ${input.audience}
          and audience_account_id is not distinct from ${input.accountId}::uuid
          and channel = ${input.channel}
          and (
            ${input.audience} <> 'internal'
            or experience_session_assisted_account() is null
            or subject_account_id = experience_session_assisted_account()
          )
          and record_key = ${input.recordKey}
        limit 1
      `);
        const row = rows[0];
        if (!row)
          throw new ExperienceProblem(
            404,
            "PROJECTION_NOT_FOUND",
            "Projection record not found",
          );
        return projectionRecord(row, input.now);
      },
    );
  }

  public queueProjectionAction(
    input: ProjectionActionInput,
  ): Promise<ProjectionActionReceipt> {
    return this.authorized(
      input.session,
      input.requestId,
      async (transaction) => {
        const replayRows = await transaction.execute(sql<Row>`
        select action.id, action.projection_id, action.aggregate_type,
               action.aggregate_id, action.action, action.expected_version,
               action.status, action.created_at, action.request_payload,
               action.audit_event_id, action.outbox_message_id
        from experience_projection_action_requests action
        join experience_portal_projections projection on projection.id = action.projection_id
        where action.actor_user_id = ${input.session.userId}::uuid
          and action.idempotency_key = ${input.idempotencyKey}
          and action.projection_id = ${input.projectionId}::uuid
          and action.audience_account_id is not distinct from ${input.accountId}::uuid
          and projection.audience = ${input.audience}
          and projection.channel = ${input.channel}
          and projection.record_key = ${input.recordKey}
          and action.action = ${input.action}
          and action.expected_version = ${input.expectedVersion}
          and action.request_payload = ${JSON.stringify(input.payload)}::jsonb
        limit 1
      `);
        if (replayRows[0]) return actionReceipt(replayRows[0]);
        const conflictingReplay = await transaction.execute(sql<Row>`
        select id from experience_projection_action_requests
        where actor_user_id = ${input.session.userId}::uuid
          and idempotency_key = ${input.idempotencyKey}
        limit 1
      `);
        if (conflictingReplay[0])
          throw new ExperienceProblem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for a different record action",
          );
        const projectionRows = await transaction.execute(sql<Row>`
        select id, aggregate_type, aggregate_id, command_resource,
               subject_account_id, row_version
        from experience_portal_projections
        where id = ${input.projectionId}::uuid
          and audience = ${input.audience}
          and audience_account_id is not distinct from ${input.accountId}::uuid
          and channel = ${input.channel}
          and record_key = ${input.recordKey}
          and (
            ${input.audience} <> 'internal'
            or experience_session_assisted_account() is null
            or subject_account_id = experience_session_assisted_account()
          )
        limit 1
      `);
        const projection = projectionRows[0];
        if (!projection)
          throw new ExperienceProblem(
            404,
            "PROJECTION_NOT_FOUND",
            "Projection record not found",
          );
        if (numberValue(projection, "row_version") !== input.expectedVersion)
          throw new ExperienceProblem(
            409,
            "VERSION_CONFLICT",
            "Projection record changed",
          );
        const resource = nullableText(projection, "command_resource");
        if (!resource)
          throw new ExperienceProblem(
            403,
            "RECORD_READ_ONLY",
            "Projection record is read-only",
          );
        try {
          const rows = await transaction.execute(sql<Row>`
          insert into experience_projection_action_requests (
            projection_id, audience_account_id, subject_account_id,
            aggregate_type, aggregate_id,
            command_resource, action, expected_version, actor_user_id,
            effective_account_id, assisted_session_id, assisted_reason,
            idempotency_key, request_payload
          ) values (
            ${input.projectionId}::uuid, ${input.accountId}::uuid,
            ${nullableText(projection, "subject_account_id")}::uuid,
            ${textValue(projection, "aggregate_type")},
            ${textValue(projection, "aggregate_id")}::uuid,
            ${resource}, ${input.action}, ${input.expectedVersion},
            ${input.session.userId}::uuid,
            ${input.session.impersonation?.accountId ?? input.accountId}::uuid,
            ${input.session.impersonation?.sessionId ?? null}::uuid,
            ${input.session.impersonation?.reason ?? null},
            ${input.idempotencyKey},
            ${JSON.stringify(input.payload)}::jsonb
          )
          on conflict (actor_user_id, idempotency_key) do nothing
          returning id, projection_id, aggregate_type, aggregate_id, action,
                    expected_version, status, created_at,
                    audit_event_id, outbox_message_id
        `);
          const row = rows[0];
          if (!row)
            throw new ExperienceProblem(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Idempotency key was already used for a different record action",
            );
          return actionReceipt(row);
        } catch (error) {
          if (
            error instanceof Error &&
            /version conflict|could not serialize/i.test(error.message)
          )
            throw new ExperienceProblem(
              409,
              "VERSION_CONFLICT",
              "Projection record changed",
            );
          if (
            error instanceof Error &&
            /not allowed|binding mismatch/i.test(error.message)
          )
            throw new ExperienceProblem(
              403,
              "ACTION_FORBIDDEN",
              "Action is not allowed for this record",
            );
          throw error;
        }
      },
    );
  }

  public signingTarget(
    session: SessionClaims,
    agreementId: string,
    accountId: string,
    requestId: string,
  ) {
    return this.authorized(
      session,
      requestId,
      async (transaction): Promise<SigningTarget> => {
        const rows = await transaction.execute(sql<Row>`
        select draft.id as agreement_id, draft.account_id,
               coalesce(draft.customer_paper_document_id, template.canonical_document_id) as document_id,
               app_user.id as signer_user_id, lower(app_user.email) as signer_email
        from lifecycle_agreement_drafts draft
        left join agreement_templates template on template.id = draft.template_id
        join commerce_users app_user on app_user.id = ${session.userId}::uuid
        join memberships membership on membership.user_id = app_user.id
        join organizations organization
          on organization.id = membership.organization_id
         and organization.account_id = draft.account_id
        join documents document
          on document.id = coalesce(draft.customer_paper_document_id, template.canonical_document_id)
         and (document.account_id is null or document.account_id = draft.account_id)
        where draft.id = ${agreementId}::uuid
          and draft.account_id = ${accountId}::uuid
          and draft.status = 'draft'
          and draft.execution_mode = 'counter_signed'
        limit 1
      `);
        const row = rows[0];
        if (!row)
          throw new ExperienceProblem(
            404,
            "SIGNING_TARGET_NOT_FOUND",
            "Authorized signing target not found",
          );
        return {
          agreementId: textValue(row, "agreement_id"),
          accountId: textValue(row, "account_id"),
          documentId: textValue(row, "document_id"),
          signerUserId: textValue(row, "signer_user_id"),
          signerEmail: textValue(row, "signer_email"),
        };
      },
    );
  }

  public createEsignCorrelation(input: {
    session: SessionClaims;
    target: SigningTarget;
    envelopeId: string;
    opaqueState: string;
    expiresAt: string;
    requestId: string;
  }): Promise<void> {
    return this.authorized(
      input.session,
      input.requestId,
      async (transaction) => {
        const result = await transaction.execute(sql<Row>`
        insert into experience_esign_return_correlations (
          state_hash, envelope_id, agreement_draft_id, account_id,
          signer_user_id, signer_email, document_id, expires_at
        ) values (
          ${sha256(input.opaqueState)}, ${input.envelopeId}::uuid,
          ${input.target.agreementId}::uuid, ${input.target.accountId}::uuid,
          ${input.target.signerUserId}::uuid, ${input.target.signerEmail},
          ${input.target.documentId}::uuid, ${input.expiresAt}::timestamptz
        )
        on conflict (envelope_id) do nothing
        returning id
      `);
        if (result.length === 0) {
          const existing = await transaction.execute(sql<Row>`
          select state_hash from experience_esign_return_correlations
          where envelope_id = ${input.envelopeId}::uuid
        `);
          if (
            nullableText(existing[0] ?? {}, "state_hash") !==
            sha256(input.opaqueState)
          )
            throw new ExperienceProblem(
              409,
              "ESIGN_CORRELATION_CONFLICT",
              "Envelope correlation conflict",
            );
        }
      },
    );
  }

  public readEsignReturn(input: {
    session: SessionClaims;
    opaqueState: string;
    now: Date;
    requestId: string;
  }): Promise<EsignReturnStatus> {
    return this.authorized(
      input.session,
      input.requestId,
      async (transaction) => {
        const rows = await transaction.execute(sql<Row>`
        select correlation.id as correlation_id, correlation.envelope_id,
               correlation.agreement_draft_id, correlation.document_id,
               correlation.expires_at, envelope.state,
               envelope.signed_pdf_document_id,
               envelope.completion_certificate_document_id,
               envelope.updated_at
        from experience_esign_return_correlations correlation
        join lifecycle_signature_envelopes envelope
          on envelope.id = correlation.envelope_id
         and envelope.account_id = correlation.account_id
         and envelope.agreement_draft_id = correlation.agreement_draft_id
         and envelope.document_id = correlation.document_id
        where correlation.state_hash = ${sha256(input.opaqueState)}
          and correlation.signer_user_id = ${input.session.userId}::uuid
        limit 1
      `);
        const row = rows[0];
        if (!row)
          throw new ExperienceProblem(
            404,
            "ESIGN_RETURN_NOT_FOUND",
            "Signing return state is invalid",
          );
        if (Date.parse(dateText(row, "expires_at")) <= input.now.getTime())
          throw new ExperienceProblem(
            410,
            "ESIGN_RETURN_EXPIRED",
            "Signing return state expired",
          );
        const envelopeState = textValue(row, "state");
        const state = publicEnvelopeState(envelopeState);
        await transaction.execute(sql`
        insert into experience_esign_return_receipts (
          correlation_id, actor_user_id, observed_envelope_state, observed_at, request_id
        ) values (
          ${textValue(row, "correlation_id")}::uuid,
          ${input.session.userId}::uuid, ${envelopeState},
          ${input.now.toISOString()}::timestamptz, ${input.requestId}
        )
        on conflict (correlation_id, request_id) do nothing
      `);
        return {
          state,
          envelopeId: textValue(row, "envelope_id"),
          agreementId: textValue(row, "agreement_draft_id"),
          documentId: textValue(row, "document_id"),
          signedDocumentId: nullableText(row, "signed_pdf_document_id"),
          completionCertificateDocumentId: nullableText(
            row,
            "completion_certificate_document_id",
          ),
          updatedAt: dateText(row, "updated_at"),
        };
      },
    );
  }

  public readEsignSignedDocument(input: {
    session: SessionClaims;
    opaqueState: string;
    now: Date;
    requestId: string;
  }): Promise<SignedDocumentDownload> {
    return this.authorized(
      input.session,
      input.requestId,
      async (transaction) => {
        const rows = await transaction.execute(sql<Row>`
        select correlation.envelope_id, correlation.agreement_draft_id,
               document.id as document_id, document.storage_key,
               document.storage_version_id, document.content_hash,
               document.byte_length, document.mime_type
        from experience_esign_return_correlations correlation
        join lifecycle_signature_envelopes envelope
          on envelope.id = correlation.envelope_id
         and envelope.account_id = correlation.account_id
         and envelope.agreement_draft_id = correlation.agreement_draft_id
         and envelope.document_id = correlation.document_id
         and envelope.state = 'completed'
        join documents document
          on document.id = envelope.signed_pdf_document_id
         and document.account_id = correlation.account_id
        where correlation.state_hash = ${sha256(input.opaqueState)}
          and correlation.signer_user_id = ${input.session.userId}::uuid
          and correlation.expires_at > ${input.now.toISOString()}::timestamptz
        limit 1
      `);
        const row = rows[0];
        if (!row)
          throw new ExperienceProblem(
            404,
            "ESIGN_SIGNED_DOCUMENT_NOT_FOUND",
            "The signed agreement is not available for this return state",
          );
        if (textValue(row, "mime_type") !== "application/pdf")
          throw new ExperienceProblem(
            502,
            "ESIGN_SIGNED_DOCUMENT_INVALID",
            "The signed agreement metadata is invalid",
          );
        const agreementId = textValue(row, "agreement_draft_id");
        return {
          envelopeId: textValue(row, "envelope_id"),
          agreementId,
          documentId: textValue(row, "document_id"),
          storageKey: textValue(row, "storage_key"),
          storageVersionId: textValue(row, "storage_version_id"),
          contentHash: textValue(row, "content_hash"),
          byteLength: textValue(row, "byte_length"),
          mimeType: "application/pdf",
          filename: `agreement-${agreementId}.pdf`,
        };
      },
    );
  }

  public async reserveEvidence(input: {
    session: SessionClaims;
    accountId: string | null;
    organizationId: string | null;
    journey: EvidenceJourney;
    targetId: string;
    kind: EvidenceKind;
    contentHash: string;
    mimeType: string;
    byteLength: number;
    retainUntil: string;
    expiresAt: string;
    legalHold: boolean;
    idempotencyKey: string;
    requestId: string;
  }): Promise<EvidenceUploadRecord> {
    if (!HASH_PATTERN.test(input.contentHash))
      throw new ExperienceProblem(
        422,
        "INVALID_CONTENT_HASH",
        "A lowercase SHA-256 hash is required",
      );
    const sessionAccountId =
      input.session.impersonation?.accountId ??
      input.session.accountIds[0] ??
      null;
    if (
      (!input.session.isInternalStaff &&
        (!input.accountId || input.accountId !== sessionAccountId)) ||
      (input.session.impersonation && input.accountId !== sessionAccountId) ||
      (!input.session.isInternalStaff &&
        input.organizationId !== null &&
        input.organizationId !== input.session.organizationId)
    )
      throw new ExperienceProblem(
        403,
        "EVIDENCE_SCOPE_FORBIDDEN",
        "Evidence scope is not authorized",
      );
    if (
      input.session.isInternalStaff &&
      !input.session.impersonation &&
      !["exception", "approval"].includes(input.journey)
    )
      throw new ExperienceProblem(
        403,
        "EVIDENCE_JOURNEY_FORBIDDEN",
        "Internal evidence journey is not authorized",
      );
    const targetScope = await withInternalTransaction(
      this.service,
      input.requestId,
      (transaction) => resolveEvidenceTargetScope(transaction, input),
    );
    return this.authorized(
      input.session,
      input.requestId,
      async (transaction) => {
        const uploadId = `upl_${randomBytes(24).toString("base64url")}`;
        const rows = await transaction.execute(sql<Row>`
        insert into experience_evidence_uploads (
          public_upload_id, idempotency_key, owner_user_id, account_id, organization_id,
          journey, target_id, evidence_kind, declared_content_hash,
          declared_mime_type, declared_byte_length, retain_until, expires_at,
          legal_hold
        ) values (
          ${uploadId}, ${input.idempotencyKey}, ${input.session.userId}::uuid, ${targetScope.accountId}::uuid,
          ${targetScope.organizationId}::uuid, ${input.journey}, ${input.targetId}::uuid,
          ${input.kind}, ${input.contentHash}, ${input.mimeType}, ${input.byteLength},
          ${input.retainUntil}::timestamptz, ${input.expiresAt}::timestamptz,
          ${input.legalHold}
        )
        on conflict (owner_user_id, idempotency_key) do nothing
        returning *
      `);
        const replayRows = rows[0]
          ? []
          : await transaction.execute(sql<Row>`
            select * from experience_evidence_uploads
            where owner_user_id = ${input.session.userId}::uuid
              and idempotency_key = ${input.idempotencyKey}
            limit 1
          `);
        const row = rows[0] ?? replayRows[0];
        if (!row) throw new Error("Evidence upload was not reserved");
        if (
          nullableText(row, "account_id") !== targetScope.accountId ||
          nullableText(row, "organization_id") !== targetScope.organizationId ||
          textValue(row, "journey") !== input.journey ||
          textValue(row, "target_id") !== input.targetId ||
          textValue(row, "evidence_kind") !== input.kind ||
          textValue(row, "declared_content_hash") !== input.contentHash ||
          textValue(row, "declared_mime_type") !== input.mimeType ||
          textValue(row, "declared_byte_length") !== String(input.byteLength) ||
          dateText(row, "retain_until") !==
            new Date(input.retainUntil).toISOString() ||
          Boolean(row.legal_hold) !== input.legalHold
        )
          throw new ExperienceProblem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for different evidence",
          );
        return evidenceRecord(row);
      },
    );
  }

  public readEvidence(
    session: SessionClaims,
    uploadId: string,
    requestId: string,
  ): Promise<EvidenceUploadRecord> {
    return this.authorized(session, requestId, async (transaction) => {
      const rows = await transaction.execute(sql<Row>`
        select * from experience_evidence_uploads
        where public_upload_id = ${uploadId}
        limit 1
      `);
      const row = rows[0];
      if (!row)
        throw new ExperienceProblem(
          404,
          "EVIDENCE_UPLOAD_NOT_FOUND",
          "Evidence upload not found",
        );
      return evidenceRecord(row);
    });
  }

  public async bindEvidenceProvider(input: {
    session: SessionClaims;
    uploadId: string;
    providerUploadId: string;
    quarantineKey: string;
    requestId: string;
  }): Promise<EvidenceUploadRecord> {
    const current = await this.readEvidence(
      input.session,
      input.uploadId,
      input.requestId,
    );
    return withInternalTransaction(
      this.service,
      input.requestId,
      async (transaction) => {
        const rows = await transaction.execute(sql<Row>`
        update experience_evidence_uploads
        set provider_upload_id = ${input.providerUploadId},
            quarantine_storage_key = ${input.quarantineKey}, status = 'uploaded',
            updated_at = now(), row_version = row_version + 1
        where id = ${current.id}::uuid and status = 'pending'
          and row_version = ${current.version}
        returning *
      `);
        const row = rows[0];
        if (!row)
          throw new ExperienceProblem(
            409,
            "EVIDENCE_VERSION_CONFLICT",
            "Evidence upload changed",
          );
        return evidenceRecord(row);
      },
    );
  }

  public async markEvidenceScanning(
    session: SessionClaims,
    uploadId: string,
    requestId: string,
  ): Promise<EvidenceUploadRecord> {
    const current = await this.readEvidence(session, uploadId, requestId);
    if (current.status === "promoted" || current.status === "quarantined")
      return current;
    return withInternalTransaction(
      this.service,
      requestId,
      async (transaction) => {
        const rows = await transaction.execute(sql<Row>`
        update experience_evidence_uploads
        set status = 'scanning', updated_at = now(), row_version = row_version + 1
        where id = ${current.id}::uuid and status = 'uploaded'
          and row_version = ${current.version}
        returning *
      `);
        const row = rows[0];
        if (!row)
          throw new ExperienceProblem(
            409,
            "EVIDENCE_VERSION_CONFLICT",
            "Evidence upload changed",
          );
        return evidenceRecord(row);
      },
    );
  }

  public async expireEvidence(
    session: SessionClaims,
    uploadId: string,
    requestId: string,
  ): Promise<EvidenceUploadRecord> {
    const current = await this.readEvidence(session, uploadId, requestId);
    if (
      ["expired", "promoted", "quarantined", "failed"].includes(current.status)
    )
      return current;
    return withInternalTransaction(
      this.service,
      requestId,
      async (transaction) => {
        const rows = await transaction.execute(sql<Row>`
        update experience_evidence_uploads
        set status = 'expired', failure_code = 'UPLOAD_EXPIRED',
            updated_at = now(), row_version = row_version + 1
        where id = ${current.id}::uuid and status in ('pending','uploaded','scanning')
          and row_version = ${current.version}
        returning *
      `);
        const row = rows[0];
        if (!row)
          throw new ExperienceProblem(
            409,
            "EVIDENCE_VERSION_CONFLICT",
            "Evidence upload changed",
          );
        return evidenceRecord(row);
      },
    );
  }

  public async quarantineEvidence(input: {
    session: SessionClaims;
    uploadId: string;
    scanReference: string;
    failureCode: string;
    requestId: string;
  }): Promise<EvidenceUploadRecord> {
    const current = await this.readEvidence(
      input.session,
      input.uploadId,
      input.requestId,
    );
    if (current.status === "quarantined") return current;
    return withInternalTransaction(
      this.service,
      input.requestId,
      async (transaction) => {
        const rows = await transaction.execute(sql<Row>`
        update experience_evidence_uploads
        set status = 'quarantined', scan_reference = ${input.scanReference},
            failure_code = ${input.failureCode}, updated_at = now(),
            row_version = row_version + 1
        where id = ${current.id}::uuid and status = 'scanning'
          and row_version = ${current.version}
        returning *
      `);
        const row = rows[0];
        if (!row)
          throw new ExperienceProblem(
            409,
            "EVIDENCE_VERSION_CONFLICT",
            "Evidence upload changed",
          );
        return evidenceRecord(row);
      },
    );
  }

  public async promoteEvidence(input: {
    session: SessionClaims;
    uploadId: string;
    immutableStorageKey: string;
    storageVersionId: string;
    scanReference: string;
    requestId: string;
  }): Promise<EvidenceUploadRecord> {
    const current = await this.readEvidence(
      input.session,
      input.uploadId,
      input.requestId,
    );
    if (current.status === "promoted") return current;
    return withInternalTransaction(
      this.service,
      input.requestId,
      async (transaction) => {
        const documentId = crypto.randomUUID();
        await transaction.execute(sql`
        insert into documents (
          id, account_id, kind, storage_key, content_hash, mime_type,
          byte_length, object_lock_mode, retain_until, legal_hold,
          storage_version_id
        ) values (
          ${documentId}::uuid, ${current.accountId}::uuid, ${current.kind},
          ${input.immutableStorageKey}, ${current.contentHash}, ${current.mimeType},
          ${current.byteLength}::bigint, 'COMPLIANCE',
          ${current.retainUntil}::timestamptz, ${current.legalHold},
          ${input.storageVersionId}
        )
      `);
        const rows = await transaction.execute(sql<Row>`
        update experience_evidence_uploads
        set status = 'promoted', immutable_storage_key = ${input.immutableStorageKey},
            storage_version_id = ${input.storageVersionId},
            scan_reference = ${input.scanReference}, document_id = ${documentId}::uuid,
            failure_code = null, updated_at = now(), row_version = row_version + 1
        where id = ${current.id}::uuid and status = 'scanning'
          and row_version = ${current.version}
        returning *
      `);
        const row = rows[0];
        if (!row)
          throw new ExperienceProblem(
            409,
            "EVIDENCE_VERSION_CONFLICT",
            "Evidence upload changed",
          );
        return evidenceRecord(row);
      },
    );
  }

  public findRenderRequest(
    session: SessionClaims,
    id: string,
    requestId: string,
  ) {
    return this.authorized(
      session,
      requestId,
      async (transaction): Promise<RenderRequestRecord> => {
        const rows = await transaction.execute(sql<Row>`
        select * from experience_document_render_requests where id = ${id}::uuid limit 1
      `);
        const row = rows[0];
        if (!row)
          throw new ExperienceProblem(
            404,
            "RENDER_REQUEST_NOT_FOUND",
            "Render request not found",
          );
        return {
          id: textValue(row, "id"),
          accountId: textValue(row, "account_id"),
          audience: textValue(row, "audience") as ExperienceAudience,
          audienceAccountId: nullableText(row, "audience_account_id"),
          subjectType: textValue(row, "subject_type"),
          subjectId: textValue(row, "subject_id"),
          kind: textValue(row, "document_kind") as ArtifactKind,
          input: objectValue(row, "input"),
          sourceHash: textValue(row, "source_hash"),
          retainUntil: dateText(row, "retain_until"),
          status: textValue(row, "status") as RenderRequestRecord["status"],
          version: numberValue(row, "row_version"),
        };
      },
    );
  }

  public claimRenderRequest(request: RenderRequestRecord, requestId: string) {
    return withInternalTransaction(
      this.service,
      requestId,
      async (transaction) => {
        const rows = await transaction.execute(sql<Row>`
        update experience_document_render_requests
        set status = 'rendering', updated_at = now(), row_version = row_version + 1
        where id = ${request.id}::uuid and status = 'pending'
          and row_version = ${request.version}
        returning row_version
      `);
        if (!rows[0])
          throw new ExperienceProblem(
            409,
            "RENDER_VERSION_CONFLICT",
            "Render request changed",
          );
      },
    );
  }

  public failRenderRequest(
    request: RenderRequestRecord,
    failureCode: string,
    requestId: string,
  ) {
    return withInternalTransaction(
      this.service,
      requestId,
      async (transaction) => {
        await transaction.execute(sql`
        update experience_document_render_requests
        set status = 'failed', failure_code = ${failureCode}, updated_at = now(),
            row_version = row_version + 1
        where id = ${request.id}::uuid and status = 'rendering'
      `);
      },
    );
  }

  public storeArtifact(input: {
    request: RenderRequestRecord;
    contentHash: string;
    byteLength: number;
    filename: string;
    immutableVersion: string;
    storageKey: string;
    storageVersionId: string;
    requestId: string;
  }): Promise<ArtifactRepresentation> {
    return withInternalTransaction(
      this.service,
      input.requestId,
      async (transaction) => {
        const documentId = crypto.randomUUID();
        await transaction.execute(sql`
        insert into documents (
          id, account_id, kind, storage_key, content_hash, mime_type,
          byte_length, object_lock_mode, retain_until, legal_hold,
          storage_version_id
        ) values (
          ${documentId}::uuid, ${input.request.accountId}::uuid,
          ${input.request.kind}, ${input.storageKey}, ${input.contentHash},
          'application/pdf', ${input.byteLength}, 'COMPLIANCE',
          ${input.request.retainUntil}::timestamptz, false,
          ${input.storageVersionId}
        )
      `);
        const rows = await transaction.execute(sql<Row>`
        insert into experience_artifact_deliveries (
          render_request_id, account_id, audience, audience_account_id,
          subject_type, subject_id, document_kind, document_id,
          immutable_version, source_hash, content_hash, storage_version_id,
          mime_type, byte_length, filename, retain_until
        ) values (
          ${input.request.id}::uuid, ${input.request.accountId}::uuid,
          ${input.request.audience}, ${input.request.audienceAccountId}::uuid,
          ${input.request.subjectType}, ${input.request.subjectId}::uuid,
          ${input.request.kind}, ${documentId}::uuid, ${input.immutableVersion},
          ${input.request.sourceHash}, ${input.contentHash},
          ${input.storageVersionId}, 'application/pdf', ${input.byteLength},
          ${input.filename}, ${input.request.retainUntil}::timestamptz
        )
        returning *
      `);
        await transaction.execute(sql`
        update experience_document_render_requests
        set status = 'stored', failure_code = null, updated_at = now(),
            row_version = row_version + 1
        where id = ${input.request.id}::uuid and status = 'rendering'
      `);
        const row = rows[0];
        if (!row) throw new Error("Artifact delivery was not stored");
        return artifactRepresentation(row);
      },
    );
  }

  public findArtifact(
    session: SessionClaims,
    kind: ArtifactKind,
    id: string,
    requestId: string,
  ): Promise<
    ArtifactRepresentation & { storageKey: string; storageVersionId: string }
  > {
    return this.authorized(session, requestId, async (transaction) => {
      const rows = await transaction.execute(sql<Row>`
        select delivery.*, document.storage_key
        from experience_artifact_deliveries delivery
        join documents document on document.id = delivery.document_id
        where delivery.id = ${id}::uuid and delivery.document_kind = ${kind}
        limit 1
      `);
      const row = rows[0];
      if (!row)
        throw new ExperienceProblem(
          404,
          "ARTIFACT_NOT_FOUND",
          "Artifact not found",
        );
      return {
        ...artifactRepresentation(row),
        storageKey: textValue(row, "storage_key"),
        storageVersionId: textValue(row, "storage_version_id"),
      };
    });
  }
}

export function createOpaqueEsignState(): string {
  return randomBytes(32).toString("base64url");
}

export function publicEnvelopeState(value: string): EsignReturnStatus["state"] {
  switch (value) {
    case "created":
    case "sent":
    case "viewed":
      return "pending";
    case "completed":
      return "completed";
    case "declined":
      return "declined";
    case "expired":
      return "expired";
    case "voided":
      return "failed";
    default:
      throw new ExperienceProblem(
        502,
        "ESIGN_STATE_INVALID",
        "E-sign provider state is invalid",
      );
  }
}

async function resolveEvidenceTargetScope(
  transaction: RuntimeTransaction,
  input: {
    session: SessionClaims;
    accountId: string | null;
    organizationId: string | null;
    journey: EvidenceJourney;
    targetId: string;
  },
): Promise<{ accountId: string; organizationId: string | null }> {
  let rows: Row[];
  switch (input.journey) {
    case "customer_paper":
      rows = await transaction.execute(sql<Row>`
        select account_id from lifecycle_agreement_drafts
        where id = ${input.targetId}::uuid
      `);
      break;
    case "poc":
      rows = await transaction.execute(sql<Row>`
        select case
          when account_id = ${input.accountId}::uuid then account_id
          when partner_account_id = ${input.accountId}::uuid then partner_account_id
          else null
        end as account_id
        from pocs where id = ${input.targetId}::uuid
      `);
      break;
    case "procurement":
      rows = await transaction.execute(sql<Row>`
        select account_id from procurement_profiles
        where account_id = ${input.targetId}::uuid
      `);
      break;
    case "exception":
      rows = await transaction.execute(sql<Row>`
        select account_id from exception_cases where id = ${input.targetId}::uuid
      `);
      break;
    case "approval":
      rows = await transaction.execute(sql<Row>`
        select account_id from approvals where id = ${input.targetId}::uuid
      `);
      break;
  }
  const accountId = nullableText(rows[0] ?? {}, "account_id");
  const expectedAccountId =
    input.session.impersonation?.accountId ?? input.accountId;
  if (!accountId || (expectedAccountId && accountId !== expectedAccountId))
    throw new ExperienceProblem(
      404,
      "EVIDENCE_TARGET_NOT_FOUND",
      "Evidence target not found",
    );
  if (input.organizationId) {
    const organizations = await transaction.execute(sql<Row>`
      select id from organizations
      where id = ${input.organizationId}::uuid and account_id = ${accountId}::uuid
      limit 1
    `);
    if (!organizations[0])
      throw new ExperienceProblem(
        404,
        "EVIDENCE_ORGANIZATION_NOT_FOUND",
        "Evidence organization not found",
      );
  }
  return { accountId, organizationId: input.organizationId };
}
