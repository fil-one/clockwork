import { createHash, randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  ActorSchema,
  ids,
  uuidV7,
  type Actor,
  type EntityName,
} from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import {
  assertRecoverableOffboardingSourceStatus,
  derivePocPartnerAccountId,
} from "@clockwork/domain/core";
import {
  acceptPassThroughTerms,
  applyEnvelopeEvent,
  applyProvisioningConfirmation,
  approveAgreementTemplate,
  authorizePartnerInitiation,
  beginProvisioning,
  buildRenewalCommandCenter,
  captureClickAcceptance,
  confirmTeardown,
  convertPocInPlace,
  createAgreementTemplate,
  createCounterSignatureEnvelope,
  createNovationPlan,
  createPocEnvironmentPlan,
  deletionCertificateData,
  decideException,
  evaluateProcurementOnboarding,
  hashEvidence,
  hashExactText,
  hashPocEvidence,
  ingestCounterSignatureEvidence,
  openExceptionCase,
  planOffboarding,
  prepopulateRenewalRequest,
  presentPassThroughTerms,
  qualifyPoc,
  recordDestructiveApproval,
  recordInboundNotice,
  recordRenewalDecline,
  recoverDeadLetter,
  registerLegalEntity,
  requestTeardown,
  resolvePartnerBranding,
  selectAccount,
  startMigration,
  validateQueuePolicies,
} from "@clockwork/domain/lifecycle";
import type {
  CounterSignatureEnvelope,
  DiscoveryRecord,
  ImmutableEvidenceObject,
  MigrationApprovalEvidence,
  MigrationCheckpoint,
  OffboardingPlan,
  ProvisioningCommand,
  ProvisioningAttempt,
  QueuePolicy,
  RenewableOrder,
  SnapshotAccessAuthorization,
} from "@clockwork/domain/lifecycle";
import { z } from "zod";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  accounts,
  agreementTemplates,
  agreements,
  approvals,
  auditEvents,
  commerceUsers,
  dealRegistrations,
  documents,
  entitlements,
  exceptionCases,
  inboundNotices,
  invites,
  invoices,
  memberships,
  novations,
  orderLines,
  orders,
  organizations,
  pocs,
  procurementProfiles,
  providerOperations,
  quotes,
  terminations,
} from "../../schema";
import {
  marketplaceEvents,
  orderCommercialProfiles,
  orderLineSnapshots,
  quoteSnapshots,
} from "../../schema/core/finance";
import {
  lifecycleAgreementDrafts,
  lifecycleAgreementTemplateTexts,
  lifecycleClickAcceptances,
  lifecycleDomainEvents,
  lifecycleFeatureGateApprovals,
  lifecycleIdempotencyRecords,
  lifecycleMigrationMatches,
  lifecycleMigrationRuns,
  lifecycleOffboardingPlans,
  lifecyclePartnerDomains,
  lifecyclePassThroughAcceptances,
  lifecyclePocEvidence,
  lifecycleProvisioningAttempts,
  lifecycleRenewalActions,
  lifecycleSignatureEnvelopes,
} from "../../schema/lifecycle/platform";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import { claimIdempotencyKey, completeIdempotencyKey } from "../idempotency";
import {
  acceptPassThroughPayloadSchema,
  convertPocPayloadSchema,
  createNovationPayloadSchema,
  createPocPayloadSchema,
  createSignatureEnvelopePayloadSchema,
  decideExceptionPayloadSchema,
  decideMigrationMatchPayloadSchema,
  decidePocPayloadSchema,
  decideTerminationPayloadSchema,
  declineRenewalPayloadSchema,
  executeClickThroughPayloadSchema,
  inviteMemberPayloadSchema,
  lifecyclePayloadSchemas,
  listSupportSignalsPayloadSchema,
  marketplaceEventPayloadSchema,
  openExceptionPayloadSchema,
  provisioningEventPayloadSchema,
  publishAgreementTemplatePayloadSchema,
  recordInboundNoticePayloadSchema,
  recoverProvisioningPayloadSchema,
  registrationPayloadSchema,
  renewalCommandCenterPayloadSchema,
  requestRenewalPayloadSchema,
  requestTerminationPayloadSchema,
  signatureEventPayloadSchema,
  startMigrationPayloadSchema,
  switchAccountPayloadSchema,
  updateProcurementPayloadSchema,
  uploadCustomerPaperPayloadSchema,
  verifyPartnerDomainPayloadSchema,
  type LifecycleCommandName,
} from "./schemas";
import { provisioningLinesFromSnapshots } from "./accepted-order-provisioning";
import {
  deletionCertificateRequestHash,
  type DeletionCertificateRequest,
} from "./deletion-certificates";

const JsonRecordSchema = z.record(z.string(), z.unknown());
const CertificateAddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  region: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(2),
});
const LifecycleResultSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    eventType: z.string().min(1).optional(),
  })
  .catchall(z.unknown());

export interface LifecycleRepositoryOperationContext {
  requestId: string;
  actor: Actor;
  idempotencyKey: string | null;
  ip: string | null;
  userAgent: string | null;
  occurredAt: string;
  authorization: AuthorizationContext | null;
}

export interface TrustedMigrationSource {
  sourceKind: "fixture" | "real_snapshot";
  sourceBytes: Uint8Array;
  sourceRecords: readonly DiscoveryRecord[];
  snapshotAccessAuthorization?: SnapshotAccessAuthorization;
}

export interface LifecycleMigrationSourcePort {
  load(input: {
    sourceSnapshotHash: string;
    executionMode: "discovery" | "rehearsal" | "execute";
    requestId: string;
  }): Promise<TrustedMigrationSource>;
}

export interface DatabaseLifecyclePolicies {
  clickThroughThresholdMinor: string;
  migrationFeatureEnabled: boolean;
  automatedTeardownEnabled: boolean;
  deletionCertificateRetentionYears?: number;
  exceptionQueues: readonly QueuePolicy[];
}

export interface LifecycleExceptionRoutingPort {
  resolve(input: {
    queue: string;
    aggregateId: string;
    occurredAt: string;
    severity: "warning" | "blocking";
    requestedBy?: string;
  }): Promise<{
    accountId: string;
    ownerUserId: string;
    backupUserId: string;
    escalationUserId: string;
    objectType: string;
    targetAt: string;
    absenceEscalated: boolean;
    rosterEntryIds: readonly string[];
  }>;
}

export interface DatabaseLifecycleCommandRepositoryOptions {
  database: RuntimeDatabase;
  serviceDatabase?: RuntimeDatabase;
  authorizationSecret: string;
  now?: () => Date;
  policies: DatabaseLifecyclePolicies;
  exceptionRouting?: LifecycleExceptionRoutingPort;
  migrationSource?: LifecycleMigrationSourcePort;
}

export interface DatabaseLifecycleCommandInput {
  command: LifecycleCommandName;
  payload: unknown;
  context: LifecycleRepositoryOperationContext;
}

export type DatabaseLifecycleCommandResult = z.output<
  typeof LifecycleResultSchema
>;

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_FINITE_JSON_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = JsonRecordSchema.parse(value);
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function marketplaceEventCategory(
  eventType: string,
):
  | "order"
  | "entitlement"
  | "metering"
  | "fee"
  | "invoice"
  | "settlement"
  | "refund" {
  const category = eventType.split(".", 1)[0];
  return z
    .enum([
      "order",
      "entitlement",
      "metering",
      "fee",
      "invoice",
      "settlement",
      "refund",
    ])
    .parse(category);
}

function localIsoDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return z
    .string()
    .date()
    .parse(`${values.year}-${values.month}-${values.day}`);
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function userId(context: LifecycleRepositoryOperationContext): string {
  if (context.actor.kind !== "user") throw new Error("USER_ACTOR_REQUIRED");
  return ids.user.parse(context.actor.id);
}

function requireAuthorization(
  context: LifecycleRepositoryOperationContext,
): AuthorizationContext {
  if (!context.authorization) throw new Error("AUTHORIZATION_REQUIRED");
  return context.authorization;
}

function requireRecentAuthentication(
  context: LifecycleRepositoryOperationContext,
): AuthorizationContext {
  const authorization = requireAuthorization(context);
  if (!authorization.recentAuthenticationVerified)
    throw new Error("RECENT_AUTHENTICATION_REQUIRED");
  return authorization;
}

function databaseAuthorization(context: LifecycleRepositoryOperationContext) {
  const authorization = requireAuthorization(context);
  return {
    userId: authorization.userId,
    accountIds: authorization.accountIds,
    roles: authorization.roles,
    isInternalStaff: authorization.isInternalStaff,
    requestId: context.requestId,
  };
}

function result(
  id: string,
  status: string,
  eventType?: string,
  extra: Record<string, unknown> = {},
): DatabaseLifecycleCommandResult {
  return LifecycleResultSchema.parse({ id, status, eventType, ...extra });
}

function actor(context: LifecycleRepositoryOperationContext): Actor {
  return ActorSchema.parse(context.actor);
}

function assertAccountScope(
  context: LifecycleRepositoryOperationContext,
  accountId: string,
): void {
  const authorization = requireAuthorization(context);
  if (
    !authorization.accountIds.includes(ids.account.parse(accountId)) &&
    (!authorization.isInternalStaff ||
      authorization.impersonation?.accountId !== accountId)
  )
    throw new Error("ACCOUNT_SCOPE");
}

function evidenceKind(kind: string): ImmutableEvidenceObject["kind"] {
  switch (kind) {
    case "canonical_text":
    case "customer_paper":
    case "signed_pdf":
    case "completion_certificate":
    case "click_acceptance":
      return kind;
    default:
      return "other";
  }
}

async function immutableEvidence(
  transaction: RuntimeTransaction,
  documentId: string,
  expectedAccountId?: string,
): Promise<ImmutableEvidenceObject> {
  const document = await transaction.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!document) throw new Error("EVIDENCE_DOCUMENT_NOT_FOUND");
  if (
    expectedAccountId &&
    document.accountId !== null &&
    document.accountId !== expectedAccountId
  )
    throw new Error("EVIDENCE_DOCUMENT_ACCOUNT_SCOPE");
  return {
    documentId: document.id,
    kind: evidenceKind(document.kind),
    sha256: document.contentHash,
    storageKey: document.storageKey,
    versionId: document.storageVersionId,
    retainedUntil: document.retainUntil.toISOString(),
    legalHold: document.legalHold,
    malwareScan: "clean",
    recordedAt: document.createdAt.toISOString(),
  };
}

async function appendEvent(
  transaction: RuntimeTransaction,
  input: {
    accountId?: string;
    aggregateType: EntityName;
    aggregateId: string;
    aggregateVersion: number;
    eventType: string;
    context: LifecycleRepositoryOperationContext;
    before?: Record<string, unknown>;
    after: Record<string, unknown>;
  },
): Promise<void> {
  await appendAuditAndOutbox(transaction, {
    ...(input.accountId ? { accountId: input.accountId } : {}),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    eventType: input.eventType,
    topic: input.eventType,
    actor: actor(input.context),
    requestId: input.context.requestId,
    ...(input.before ? { before: input.before } : {}),
    after: input.after,
    occurredAt: new Date(input.context.occurredAt),
  });
}

function providerCommand(command: LifecycleCommandName): boolean {
  return (
    command === "ingest_signature_event" ||
    command === "ingest_provisioning_event" ||
    command === "ingest_marketplace_event"
  );
}

function readCommand(command: LifecycleCommandName): boolean {
  return (
    command === "renewal_command_center" || command === "list_support_signals"
  );
}

function staffServiceCommand(command: LifecycleCommandName): boolean {
  return [
    "publish_agreement_template",
    "recover_provisioning",
    "decide_termination",
    "open_exception",
    "decide_exception",
    "start_migration",
    "decide_migration_match",
  ].includes(command);
}

const OffboardingPlanSchema: z.ZodType<OffboardingPlan> = z.object({
  terminationId: z.string(),
  accountId: z.string(),
  orderId: z.string(),
  organizationId: z.string(),
  reason: z.enum([
    "customer_request",
    "non_renewal",
    "partner_request",
    "partner_default",
    "material_breach",
  ]),
  requestedBy: z.string(),
  effectiveAt: z.string(),
  finalBillingStatus: z.enum(["pending", "settled", "credit_due"]),
  retrievalStartsAt: z.string(),
  retrievalEndsAt: z.string(),
  maximumRetentionAt: z.string().nullable(),
  status: z.enum([
    "pending_final_billing",
    "retrieval_window",
    "retention_blocked",
    "pending_approval",
    "ready_for_teardown",
    "teardown_requested",
    "teardown_confirmed",
    "complete",
  ]),
  lockedExclusions: z.array(
    z
      .object({
        objectId: z.string(),
        scope: z.string(),
        retainUntil: z.string(),
        legalHold: z.boolean(),
        reason: z.enum(["legal_hold", "object_lock_retention"]),
      })
      .refine(
        (value) =>
          value.reason ===
          (value.legalHold ? "legal_hold" : "object_lock_retention"),
        { message: "RETAINED_OBJECT_REASON_INVALID" },
      ),
  ),
  deletionScheduledAt: z.string().nullable(),
  approvals: z.array(
    z.object({
      approvalId: z.string(),
      approverId: z.string(),
      decision: z.enum(["approved", "rejected"]),
      reason: z.string(),
      decidedAt: z.string(),
      evidenceHash: z.string(),
      recentAuthentication: z.object({
        authenticatedAt: z.string(),
        evidenceHash: z.string(),
      }),
    }),
  ),
  teardownOperationId: z.string().nullable(),
  teardownConfirmedAt: z.string().nullable(),
  teardownExcludedObjectIds: z.array(z.string()),
});

const ProvisioningAttemptSchema: z.ZodType<ProvisioningAttempt> = z.object({
  command: z.object({
    commandId: z.string(),
    idempotencyKey: z.string(),
    orderId: z.string(),
    orderVersion: z.number(),
    organizationId: z.string(),
    operation: z.enum(["provision", "upgrade_poc", "sandbox", "teardown"]),
    tenantId: z.string().nullable(),
    entitlements: z.array(
      z.object({
        sku: z.string(),
        productCode: z.string(),
        entitlementKind: z.enum(["storage", "egress", "sandbox", "feature"]),
        quantity: z.string(),
        region: z.string(),
      }),
    ),
    requestedAt: z.string(),
  }),
  state: z.enum([
    "pending",
    "in_flight",
    "retry_scheduled",
    "dead_letter",
    "confirmed",
  ]),
  attempts: z.number(),
  nextAttemptAt: z.string().nullable(),
  lastError: z
    .object({
      code: z.string(),
      message: z.string(),
      kind: z.enum(["transient", "permanent"]),
    })
    .nullable(),
  providerOperationId: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  operatorRecovery: z
    .object({
      operatorId: z.string(),
      reason: z.string(),
      recoveredAt: z.string(),
    })
    .nullable(),
});

const PocSuccessSnapshotSchema = z.object({
  snapshotId: z.string(),
  pocId: z.string(),
  source: z.literal("poc_milestone_ledger"),
  evaluatedAt: z.string(),
  evaluatorId: z.string(),
  tests: z.array(
    z.object({
      testId: z.string(),
      passed: z.boolean(),
      evidenceHash: z.string(),
    }),
  ),
  evidenceHash: z.string(),
});

const MigrationCheckpointSchema: z.ZodType<MigrationCheckpoint> = z.object({
  runId: z.string(),
  sourceKind: z.enum(["fixture", "real_snapshot"]),
  sourceSnapshotHash: z.string(),
  fixtureSnapshotHash: z.string(),
  inputOrderHash: z.string(),
  recordSetHash: z.string(),
  recordsHash: z.string(),
  runAuthorization: z.object({
    requesterId: z.string(),
    dryRun: z.boolean(),
    realCustomerExecution: z.boolean(),
    featureFlagEnabled: z.boolean(),
    approvalActors: z.array(z.string()),
    approvalTimes: z.array(z.string()),
    approvalEvidenceHashes: z.array(z.string()),
    approvalAuthenticationEvidenceHashes: z.array(z.string()),
    snapshotAccessActor: z.string().nullable(),
    snapshotAccessEvidenceHash: z.string().nullable(),
    snapshotAuthenticationEvidenceHash: z.string().nullable(),
  }),
  bindingHash: z.string(),
  cursor: z.number(),
  processedKeys: z.array(z.string()),
  results: z.array(
    z.object({
      idempotencyKey: z.string(),
      legacyAccountId: z.string(),
      action: z.enum(["created", "attached", "review_queued", "skipped"]),
      accountId: z.string().nullable(),
      reacceptanceRequired: z.boolean(),
      reacceptanceEvidenceHash: z.string().nullable(),
      activationStatus: z.enum([
        "ready",
        "blocked_pending_reacceptance",
        "blocked_review",
        "not_applicable",
      ]),
    }),
  ),
  phase: z.enum(["discovery", "accounts", "orders", "complete", "failed"]),
  rollbackBoundary: z.enum(["none", "before_orders", "forward_only"]),
});

/**
 * Production lifecycle persistence boundary. User commands execute under the
 * signed tenant authorization context. Verified provider callbacks and the
 * registration bootstrap use the service role, but still derive scope from
 * persisted records and append state/audit/outbox atomically.
 */
export class DatabaseLifecycleCommandRepository {
  private readonly serviceDatabase: RuntimeDatabase;
  private readonly now: () => Date;
  private readonly queuePolicies: ReadonlyMap<
    QueuePolicy["queue"],
    QueuePolicy
  >;
  private readonly exceptionRouting: LifecycleExceptionRoutingPort | undefined;

  public constructor(
    private readonly options: DatabaseLifecycleCommandRepositoryOptions,
  ) {
    if (options.authorizationSecret.length < 32)
      throw new Error(
        "Database authorization secret must be at least 32 bytes",
      );
    if (!/^(0|[1-9]\d*)$/.test(options.policies.clickThroughThresholdMinor))
      throw new Error("CLICK_THRESHOLD_INVALID");
    if (
      options.policies.automatedTeardownEnabled &&
      (!Number.isSafeInteger(
        options.policies.deletionCertificateRetentionYears,
      ) ||
        (options.policies.deletionCertificateRetentionYears ?? 0) < 1)
    )
      throw new Error("DELETION_CERTIFICATE_RETENTION_POLICY_REQUIRED");
    this.serviceDatabase = options.serviceDatabase ?? options.database;
    this.now = options.now ?? (() => new Date());
    this.queuePolicies = options.exceptionRouting
      ? new Map()
      : validateQueuePolicies(options.policies.exceptionQueues);
    this.exceptionRouting = options.exceptionRouting;
  }

  public async executeInTransaction(
    input: DatabaseLifecycleCommandInput,
  ): Promise<DatabaseLifecycleCommandResult> {
    if (!(input.command in lifecyclePayloadSchemas))
      throw new Error("LIFECYCLE_COMMAND_UNKNOWN");
    if (input.command === "ingest_marketplace_event")
      input = {
        ...input,
        // Validate persistence-bound numerics before opening the service-role
        // transaction or claiming an idempotency record.
        payload: marketplaceEventPayloadSchema.parse(input.payload),
      };
    if (!readCommand(input.command) && !input.context.idempotencyKey)
      throw new Error("LIFECYCLE_IDEMPOTENCY_KEY_REQUIRED");
    if (providerCommand(input.command)) {
      if (input.context.actor.kind !== "provider")
        throw new Error("PROVIDER_ACTOR_REQUIRED");
      return withInternalTransaction(
        this.serviceDatabase,
        input.context.requestId,
        (transaction) => this.executeClaimed(transaction, input),
      );
    }
    if (input.command === "register")
      return withInternalTransaction(
        this.serviceDatabase,
        input.context.requestId,
        (transaction) => this.executeClaimed(transaction, input),
      );
    if (
      staffServiceCommand(input.command) &&
      requireAuthorization(input.context).isInternalStaff
    )
      return withInternalTransaction(
        this.serviceDatabase,
        input.context.requestId,
        (transaction) => this.executeClaimed(transaction, input),
      );
    return withAuthorizedTransaction(
      this.options.database,
      databaseAuthorization(input.context),
      { secret: this.options.authorizationSecret, now: this.now() },
      (transaction) => this.executeClaimed(transaction, input),
    );
  }

  private async capabilityEnabled(
    transaction: RuntimeTransaction,
    capability: "teardown",
    recovery = false,
  ): Promise<boolean> {
    const [row] = await transaction.execute<{ enabled: boolean }>(sql`
      select public.system_capability_is_enabled(
        ${capability}::text,
        ${recovery}::boolean
      ) as enabled
    `);
    return row?.enabled === true;
  }

  private async executeClaimed(
    transaction: RuntimeTransaction,
    input: DatabaseLifecycleCommandInput,
  ): Promise<DatabaseLifecycleCommandResult> {
    if (readCommand(input.command)) return this.dispatch(transaction, input);
    const key = input.context.idempotencyKey;
    if (!key) throw new Error("LIFECYCLE_IDEMPOTENCY_KEY_REQUIRED");
    const requestHash = hashJson({
      command: input.command,
      payload: input.payload,
    });
    const scope = `lifecycle:${input.command}`;
    const claimed =
      input.context.actor.kind === "user" && input.command !== "register"
        ? await this.claimUserIdempotency(
            transaction,
            userId(input.context),
            scope,
            key,
            requestHash,
          )
        : await claimIdempotencyKey(transaction, {
            scope,
            key,
            requestHash,
            now: this.now(),
          });
    if (claimed.kind === "conflict")
      throw new Error("IDEMPOTENCY_KEY_CONFLICT");
    if (claimed.kind === "in_progress")
      throw new Error("IDEMPOTENCY_REQUEST_IN_PROGRESS");
    if (claimed.kind === "replay")
      return LifecycleResultSchema.parse(claimed.response.body);
    const response = await this.dispatch(transaction, input);
    if (input.context.actor.kind === "user" && input.command !== "register")
      await this.completeUserIdempotency(
        transaction,
        userId(input.context),
        scope,
        key,
        requestHash,
        claimed.lockToken,
        response,
      );
    else
      await completeIdempotencyKey(
        transaction,
        { scope, key, requestHash, lockToken: claimed.lockToken },
        { status: 200, headers: {}, body: response },
      );
    return response;
  }

  private dispatch(
    transaction: RuntimeTransaction,
    input: DatabaseLifecycleCommandInput,
  ): Promise<DatabaseLifecycleCommandResult> {
    switch (input.command) {
      case "register":
        return this.register(transaction, input.payload, input.context);
      case "invite_member":
        return this.inviteMember(transaction, input.payload, input.context);
      case "switch_account":
        return this.switchAccount(transaction, input.payload, input.context);
      case "verify_partner_domain":
        return this.verifyPartnerDomain(
          transaction,
          input.payload,
          input.context,
        );
      case "update_procurement":
        return this.updateProcurement(
          transaction,
          input.payload,
          input.context,
        );
      case "publish_agreement_template":
        return this.publishAgreementTemplate(
          transaction,
          input.payload,
          input.context,
        );
      case "upload_customer_paper":
        return this.uploadCustomerPaper(
          transaction,
          input.payload,
          input.context,
        );
      case "execute_click_through":
        return this.executeClickThrough(
          transaction,
          input.payload,
          input.context,
        );
      case "create_signature_envelope":
        return this.createSignatureEnvelope(
          transaction,
          input.payload,
          input.context,
        );
      case "ingest_signature_event":
        return this.ingestSignatureEvent(
          transaction,
          input.payload,
          input.context,
        );
      case "ingest_provisioning_event":
        return this.ingestProvisioningEvent(
          transaction,
          input.payload,
          input.context,
        );
      case "ingest_marketplace_event":
        return this.ingestMarketplaceEvent(
          transaction,
          input.payload,
          input.context,
        );
      case "create_poc":
        return this.createPoc(transaction, input.payload, input.context);
      case "decide_poc":
        return this.decidePoc(transaction, input.payload, input.context);
      case "convert_poc":
        return this.convertPoc(transaction, input.payload, input.context);
      case "recover_provisioning":
        return this.recoverProvisioning(
          transaction,
          input.payload,
          input.context,
        );
      case "accept_pass_through_terms":
        return this.acceptPassThrough(
          transaction,
          input.payload,
          input.context,
        );
      case "record_inbound_notice":
        return this.recordInboundNotice(
          transaction,
          input.payload,
          input.context,
        );
      case "renewal_command_center":
        return this.renewalCommandCenter(
          transaction,
          input.payload,
          input.context,
        );
      case "request_renewal":
        return this.requestRenewal(transaction, input.payload, input.context);
      case "decline_renewal":
        return this.declineRenewal(transaction, input.payload, input.context);
      case "request_termination":
        return this.requestTermination(
          transaction,
          input.payload,
          input.context,
        );
      case "decide_termination":
        return this.decideTermination(
          transaction,
          input.payload,
          input.context,
        );
      case "create_novation":
        return this.createNovation(transaction, input.payload, input.context);
      case "open_exception":
        return this.openException(transaction, input.payload, input.context);
      case "decide_exception":
        return this.decideException(transaction, input.payload, input.context);
      case "list_support_signals":
        return this.listSupportSignals(
          transaction,
          input.payload,
          input.context,
        );
      case "start_migration":
        return this.startMigration(transaction, input.payload, input.context);
      case "decide_migration_match":
        return this.decideMigrationMatch(
          transaction,
          input.payload,
          input.context,
        );
    }
  }

  private async register(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = registrationPayloadSchema.parse(raw);
    const registration = registerLegalEntity({
      legalName: payload.legalName,
      country: payload.country,
      registeredAddress: {
        line1: payload.registeredAddress.line1,
        city: payload.registeredAddress.city,
        ...(payload.registeredAddress.region
          ? { region: payload.registeredAddress.region }
          : {}),
        postalCode: payload.registeredAddress.postalCode,
        country: payload.registeredAddress.country,
      },
      // Provider verification is deliberately not inferred from user-entered
      // tax identifiers. The account remains screening-restricted until the
      // screening adapter records authoritative verification evidence.
      taxIds: [],
      relationshipRoles: payload.relationshipRoles,
      businessDomain: payload.businessDomain,
      registrantEmail: payload.registrantEmail,
      domainVerification: {
        domain: payload.businessDomain,
        method: "workos",
        verifiedAt: payload.domainVerifiedAt,
      },
      screeningDecision: "review",
    });
    const now = new Date(context.occurredAt);
    const [account] = await transaction
      .insert(accounts)
      .values({
        legalName: registration.legalName,
        relationshipRoles: [...registration.relationshipRoles],
        registeredAddress: payload.registeredAddress,
        taxIds: payload.taxIds,
        billingContact: payload.billingContact,
        apContact: payload.apContact ?? {},
        invoiceDeliveryEmail: payload.invoiceDeliveryEmail,
        domain: registration.normalizedDomain,
        country: payload.country,
        currency: payload.country === "GB" ? "GBP" : "USD",
        screeningStatus: "review",
      })
      .returning();
    if (!account) throw new Error("ACCOUNT_INSERT_FAILED");
    const [organization] = await transaction
      .insert(organizations)
      .values({
        accountId: account.id,
        name: account.legalName,
        isolated: false,
      })
      .returning();
    if (!organization) throw new Error("ORGANIZATION_INSERT_FAILED");
    const [commerceUser] = await transaction
      .insert(commerceUsers)
      .values({
        workosUserId: payload.workosUserId,
        email: payload.registrantEmail.toLowerCase(),
        name: payload.billingContact.name,
        mfaEnrolled: false,
      })
      .returning();
    if (!commerceUser) throw new Error("USER_INSERT_FAILED");
    await transaction.insert(memberships).values({
      organizationId: organization.id,
      userId: commerceUser.id,
      role: "owner",
    });
    await transaction.insert(procurementProfiles).values({
      accountId: account.id,
      poRequired: false,
      exemptions: [],
      supplierDocuments: [],
    });
    await appendEvent(transaction, {
      accountId: account.id,
      aggregateType: "account",
      aggregateId: account.id,
      aggregateVersion: 1,
      eventType: "account.registered",
      context,
      after: {
        accountId: account.id,
        organizationId: organization.id,
        userId: commerceUser.id,
        status: registration.status,
        canTransact: registration.canTransact,
        domainVerifiedAt: payload.domainVerifiedAt,
      },
    });
    await appendEvent(transaction, {
      accountId: account.id,
      aggregateType: "organization",
      aggregateId: organization.id,
      aggregateVersion: 1,
      eventType: "organization.created",
      context,
      after: {
        organizationId: organization.id,
        accountId: account.id,
        workosUserId: payload.workosUserId,
        requestedAt: now.toISOString(),
      },
    });
    return result(account.id, registration.status, "account.registered", {
      organizationId: organization.id,
      userId: commerceUser.id,
    });
  }

  private async inviteMember(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = inviteMemberPayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    const organization = await transaction.query.organizations.findFirst({
      where: and(
        eq(organizations.id, payload.organizationId),
        eq(organizations.accountId, payload.accountId),
      ),
    });
    if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");
    if (Date.parse(payload.expiresAt) <= this.now().getTime())
      throw new Error("INVITE_EXPIRY_INVALID");
    const tokenHash = hashText(
      `${context.idempotencyKey}:${payload.email.toLowerCase()}:${organization.id}`,
    );
    const [invite] = await transaction
      .insert(invites)
      .values({
        organizationId: organization.id,
        email: payload.email.toLowerCase(),
        role: payload.role,
        tokenHash,
        expiresAt: new Date(payload.expiresAt),
      })
      .returning();
    if (!invite) throw new Error("INVITE_INSERT_FAILED");
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "invite",
      aggregateId: invite.id,
      aggregateVersion: invite.rowVersion,
      eventType: "membership.invited",
      context,
      after: {
        inviteId: invite.id,
        organizationId: organization.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
      },
    });
    return result(invite.id, "pending", "membership.invited");
  }

  private async switchAccount(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = switchAccountPayloadSchema.parse(raw);
    const authorization = requireAuthorization(context);
    const rows = await transaction
      .select({
        accountId: organizations.accountId,
        workosOrganizationId: organizations.workosOrganizationId,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(eq(memberships.userId, authorization.userId));
    const workosOrganizationByAccount = Object.fromEntries(
      rows.flatMap((row) =>
        row.workosOrganizationId
          ? [[row.accountId, row.workosOrganizationId]]
          : [],
      ),
    );
    const selected = selectAccount({
      requestedAccountId: payload.accountId,
      membershipAccountIds: rows.map((row) => row.accountId),
      currentWorkosOrganizationId: authorization.organizationId ?? "",
      workosOrganizationByAccount,
    });
    await appendEvent(transaction, {
      accountId: selected.accountId,
      aggregateType: "user",
      aggregateId: authorization.userId,
      aggregateVersion: await this.nextAuditVersion(
        transaction,
        "user",
        authorization.userId,
      ),
      eventType: "account.selected",
      context,
      after: selected,
    });
    return result(selected.accountId, "selected", "account.selected", selected);
  }

  private async verifyPartnerDomain(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = verifyPartnerDomainPayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    const account = await transaction.query.accounts.findFirst({
      where: eq(accounts.id, payload.accountId),
    });
    if (!account || !account.relationshipRoles.includes("partner"))
      throw new Error("PARTNER_ACCOUNT_REQUIRED");
    const branding = resolvePartnerBranding({
      partnerName: payload.brandName,
      ...(payload.logoUrl ? { requestedLogoUrl: payload.logoUrl } : {}),
      requestedPrimaryColor: payload.primaryColor,
      customDomain: payload.domain,
      customDomainVerified: true,
      partnerOwnsCommercialCommunications:
        payload.communicationOwner === "partner",
    });
    if (branding.fallbackApplied || !branding.customDomain)
      throw new Error("PARTNER_DOMAIN_BRANDING_INVALID");
    const [row] = await transaction
      .insert(lifecyclePartnerDomains)
      .values({
        accountId: payload.accountId,
        domain: branding.customDomain,
        verificationTokenHash: hashText(payload.verificationToken),
        verifiedAt: new Date(payload.verificationEvidence.verifiedAt),
        brandName: branding.brandName,
        logoUrl: branding.logoUrl,
        primaryColor: branding.primaryColor,
        communicationOwner: branding.communicationOwner,
      })
      .returning();
    if (!row) throw new Error("PARTNER_DOMAIN_INSERT_FAILED");
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "account",
      aggregateId: payload.accountId,
      aggregateVersion: await this.bumpAccountVersion(
        transaction,
        payload.accountId,
      ),
      eventType: "account.partner_domain_verified",
      context,
      after: {
        partnerDomainId: row.id,
        domain: row.domain,
        brandName: row.brandName,
        logoUrl: row.logoUrl,
        primaryColor: row.primaryColor,
        communicationOwner: row.communicationOwner,
        verificationEvidenceReference:
          payload.verificationEvidence.evidenceReference,
      },
    });
    return result(row.id, "verified", "account.partner_domain_verified");
  }

  private async updateProcurement(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = updateProcurementPayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    const documentIds = [
      ...payload.exemptions.map((item) => item.certificateDocumentId),
      ...payload.supplierDocuments.map((item) => item.documentId),
    ];
    const persistedDocuments =
      documentIds.length === 0
        ? []
        : await transaction.query.documents.findMany({
            where: inArray(documents.id, documentIds),
          });
    if (
      persistedDocuments.length !== new Set(documentIds).size ||
      persistedDocuments.some(
        (document) =>
          document.accountId !== null &&
          document.accountId !== payload.accountId,
      )
    )
      throw new Error("PROCUREMENT_DOCUMENT_INVALID");
    const current = await transaction.query.procurementProfiles.findFirst({
      where: eq(procurementProfiles.accountId, payload.accountId),
    });
    if (!current) throw new Error("PROCUREMENT_PROFILE_NOT_FOUND");
    const evaluation = evaluateProcurementOnboarding({
      paymentTerms: "net_terms",
      apContactEmail: payload.apContact.email,
      invoiceDeliveryEmail: payload.invoiceDeliveryEmail,
      poRequired: payload.poRequired,
      exemptionRequired: payload.exemptions.length > 0,
      validExemptionCertificate: payload.exemptions.every((exemption) => {
        if (!exemption.expiresOn) return true;
        return exemption.expiresOn >= context.occurredAt.slice(0, 10);
      }),
      requiredSupplierDocuments: payload.supplierDocuments.map(
        (document) => document.kind,
      ),
      furnishedSupplierDocuments: payload.supplierDocuments.map(
        (document) => document.kind,
      ),
      supplierPortalRequired: payload.buyerPortalTasks.length > 0,
      supplierPortalComplete: payload.buyerPortalTasks.length === 0,
      tasks: payload.buyerPortalTasks.map((task) => ({
        id: task.taskId,
        kind: "buyer_supplier_portal",
        ownerId: task.ownerId,
        status: "open",
        dueAt: task.dueAt,
        reminderEveryHours: task.reminderEveryHours,
        completedAt: null,
      })),
    });
    const [updated] = await transaction
      .update(procurementProfiles)
      .set({
        poRequired: payload.poRequired,
        exemptions: payload.exemptions,
        supplierDocuments: payload.supplierDocuments,
        supplierPortalStatus: evaluation.complete ? "complete" : "in_progress",
        updatedAt: this.now(),
        rowVersion: current.rowVersion + 1,
      })
      .where(
        and(
          eq(procurementProfiles.id, current.id),
          eq(procurementProfiles.rowVersion, current.rowVersion),
        ),
      )
      .returning();
    if (!updated) throw new Error("VERSION_CONFLICT");
    await transaction
      .update(accounts)
      .set({
        apContact: payload.apContact,
        invoiceDeliveryEmail: payload.invoiceDeliveryEmail,
        updatedAt: this.now(),
      })
      .where(eq(accounts.id, payload.accountId));
    const eventType = evaluation.complete
      ? "procurement_profile.completed"
      : "procurement_profile.updated";
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "procurement_profile",
      aggregateId: updated.id,
      aggregateVersion: updated.rowVersion,
      eventType,
      context,
      before: {
        poRequired: current.poRequired,
        supplierPortalStatus: current.supplierPortalStatus,
        rowVersion: current.rowVersion,
      },
      after: {
        poRequired: updated.poRequired,
        supplierPortalStatus: updated.supplierPortalStatus,
        blockers: evaluation.blockers,
        openTasks: evaluation.openTasks,
        rowVersion: updated.rowVersion,
      },
    });
    return result(updated.id, updated.supplierPortalStatus, eventType, {
      blockers: evaluation.blockers,
    });
  }

  private async publishAgreementTemplate(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = publishAgreementTemplatePayloadSchema.parse(raw);
    requireRecentAuthentication(context);
    const canonical = await immutableEvidence(
      transaction,
      payload.canonicalDocumentId,
    );
    const approvalEvidence = await immutableEvidence(
      transaction,
      payload.approvalEvidenceDocumentId,
    );
    if (canonical.sha256 !== payload.exactTextHash)
      throw new Error("CANONICAL_DOCUMENT_HASH_MISMATCH");
    if (hashExactText(payload.exactText) !== payload.exactTextHash)
      throw new Error("CANONICAL_TEXT_HASH_MISMATCH");
    const approverId = userId(context);
    const templateId = uuidV7();
    const agreementType = z
      .enum([
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
      ])
      .parse(payload.type);
    const template = approveAgreementTemplate(
      createAgreementTemplate({
        id: templateId,
        seriesId: hashText(`${payload.type}:${payload.jurisdiction}`),
        type: agreementType,
        semanticVersion: payload.semanticVersion,
        jurisdiction: payload.jurisdiction,
        variant: "default",
        effectiveOn: payload.effectiveOn,
        executionMode: payload.executionMode,
        canonicalText: payload.exactText,
        canonicalDocument: { ...canonical, kind: "canonical_text" },
        createdAt: context.occurredAt,
      }),
      {
        approvalId: approvalEvidence.documentId,
        approverUserId: approverId,
        authority: "counsel",
        approvedAt: context.occurredAt,
        reviewedTextHash: payload.exactTextHash,
        note: `Approval evidence ${approvalEvidence.sha256}`,
      },
    );
    const [row] = await transaction
      .insert(agreementTemplates)
      .values({
        id: template.id,
        type: template.type,
        semanticVersion: template.semanticVersion,
        jurisdiction: template.jurisdiction,
        effectiveOn: template.effectiveOn,
        canonicalDocumentId: canonical.documentId,
        textHash: template.textHash,
        executionMode: template.executionMode,
        approvalStatus: template.approvalStatus,
        approvedBy: approverId,
      })
      .returning();
    if (!row) throw new Error("AGREEMENT_TEMPLATE_INSERT_FAILED");
    await transaction.insert(lifecycleAgreementTemplateTexts).values({
      templateId: row.id,
      exactText: template.canonicalText,
      exactTextHash: template.textHash,
    });
    await appendEvent(transaction, {
      aggregateType: "agreement_template",
      aggregateId: row.id,
      aggregateVersion: row.version,
      eventType: "agreement.template_approved",
      context,
      after: {
        templateId: row.id,
        semanticVersion: row.semanticVersion,
        textHash: row.textHash,
        canonicalDocumentId: row.canonicalDocumentId,
        approvalEvidenceDocumentId: approvalEvidence.documentId,
      },
    });
    return result(row.id, "approved", "agreement.template_approved");
  }

  private async uploadCustomerPaper(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = uploadCustomerPaperPayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    await immutableEvidence(
      transaction,
      payload.uploadedDocumentId,
      payload.accountId,
    );
    const negotiationStatus = {
      received: "uploaded",
      redlining: "redlining",
      agreed: "agreed",
    }[payload.negotiationStatus];
    const [draft] = await transaction
      .insert(lifecycleAgreementDrafts)
      .values({
        accountId: payload.accountId,
        customerPaperDocumentId: payload.uploadedDocumentId,
        paper: "theirs",
        executionMode: "counter_signed",
        negotiationStatus,
        jurisdiction: payload.jurisdiction,
        keyTerms: payload.keyTerms,
        status: "draft",
        createdBy: userId(context),
      })
      .returning();
    if (!draft) throw new Error("AGREEMENT_DRAFT_INSERT_FAILED");
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "agreement",
      aggregateId: draft.id,
      aggregateVersion: draft.rowVersion,
      eventType: "agreement.customer_paper_uploaded",
      context,
      after: {
        agreementId: draft.id,
        accountId: draft.accountId,
        documentId: draft.customerPaperDocumentId,
        negotiationStatus: draft.negotiationStatus,
        jurisdiction: draft.jurisdiction,
      },
    });
    return result(
      draft.id,
      draft.negotiationStatus,
      "agreement.customer_paper_uploaded",
    );
  }

  private async executeClickThrough(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = executeClickThroughPayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    const acceptingUserId = userId(context);
    if (!context.ip || !context.userAgent)
      throw new Error("CLICK_ACCEPTANCE_NETWORK_EVIDENCE_REQUIRED");
    if (hashExactText(payload.exactText) !== payload.exactTextHash)
      throw new Error("PRESENTED_TEXT_HASH_MISMATCH");
    const [account, template, acceptingUser] = await Promise.all([
      transaction.query.accounts.findFirst({
        where: eq(accounts.id, payload.accountId),
      }),
      transaction.query.agreementTemplates.findFirst({
        where: and(
          eq(agreementTemplates.id, payload.templateId),
          eq(agreementTemplates.semanticVersion, payload.templateVersion),
          eq(agreementTemplates.approvalStatus, "approved"),
        ),
      }),
      transaction.query.commerceUsers.findFirst({
        where: eq(commerceUsers.id, acceptingUserId),
      }),
    ]);
    if (!account || !template || !acceptingUser)
      throw new Error("CLICK_ACCEPTANCE_TARGET_NOT_FOUND");
    if (template.executionMode !== "click_through")
      throw new Error("COUNTER_SIGNATURE_REQUIRED");
    if (template.textHash !== payload.exactTextHash)
      throw new Error("PRESENTED_TEXT_HASH_MISMATCH");
    const canonicalText =
      await transaction.query.lifecycleAgreementTemplateTexts.findFirst({
        where: eq(lifecycleAgreementTemplateTexts.templateId, template.id),
      });
    if (
      !canonicalText ||
      canonicalText.exactTextHash !== payload.exactTextHash ||
      canonicalText.exactText !== payload.exactText
    )
      throw new Error("PRESENTED_TEXT_NOT_CANONICAL");
    const canonicalDocument = await immutableEvidence(
      transaction,
      template.canonicalDocumentId,
    );
    const templateDomain = approveAgreementTemplate(
      createAgreementTemplate({
        id: template.id,
        seriesId: hashText(`${template.type}:${template.jurisdiction}`),
        type: z
          .enum([
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
          ])
          .parse(template.type),
        semanticVersion: template.semanticVersion,
        jurisdiction: template.jurisdiction,
        variant: "default",
        effectiveOn: template.effectiveOn,
        executionMode: "click_through",
        canonicalText: payload.exactText,
        canonicalDocument: { ...canonicalDocument, kind: "canonical_text" },
        createdAt: template.createdAt.toISOString(),
      }),
      {
        approvalId: `persisted:${template.id}`,
        approverUserId: template.approvedBy ?? "persisted-counsel",
        authority: "counsel",
        approvedAt: template.createdAt.toISOString(),
        reviewedTextHash: template.textHash,
        note: "Persisted immutable counsel approval",
      },
    );
    const acceptedQuotes = await transaction
      .select({ totalMinor: quotes.totalMinor, currency: quotes.currency })
      .from(quotes)
      .where(
        and(
          eq(quotes.accountId, payload.accountId),
          eq(quotes.status, "accepted"),
        ),
      );
    const currencies = new Set(acceptedQuotes.map((quote) => quote.currency));
    if (currencies.size > 1) throw new Error("CUMULATIVE_VALUE_CURRENCY_MIXED");
    const cumulativeValueBeforeMinor = acceptedQuotes
      .reduce((total, quote) => total + quote.totalMinor, 0n)
      .toString();
    const agreementId = uuidV7();
    const snapshotSource = "commerce_ledger" as const;
    const snapshotBody = {
      snapshotId: uuidV7(),
      accountId: payload.accountId,
      source: snapshotSource,
      capturedAt: context.occurredAt,
      commercialEventId: agreementId,
      cumulativeValueBeforeMinor,
      commercialEventValueMinor: "0",
      currency: z
        .enum(["USD", "EUR", "GBP"])
        .parse(acceptedQuotes[0]?.currency ?? account.currency),
    };
    const commercialValueSnapshot = {
      ...snapshotBody,
      evidenceHash: hashEvidence(snapshotBody),
    };
    const membership = await transaction
      .select({
        role: memberships.role,
        organizationId: memberships.organizationId,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(
        and(
          eq(memberships.userId, acceptingUserId),
          eq(organizations.accountId, payload.accountId),
        ),
      )
      .limit(1);
    const identity = membership[0];
    if (!identity) throw new Error("ACCEPTING_MEMBERSHIP_NOT_FOUND");
    const clickEvidence = captureClickAcceptance({
      evidenceId: uuidV7(),
      agreementId,
      legalEntityName: account.legalName,
      template: templateDomain,
      exactTextPresented: payload.exactText,
      identity: {
        userId: acceptingUserId,
        email: acceptingUser.email,
        role: identity.role,
        accountId: payload.accountId,
        organizationId: identity.organizationId,
      },
      acceptedAt: context.occurredAt,
      ipAddress: context.ip,
      uiContext: {
        route: payload.uiContext.surface.startsWith("/")
          ? payload.uiContext.surface
          : `/lifecycle/${payload.uiContext.surface}`,
        action: payload.uiContext.actionLabel,
        sessionId: context.requestId,
        requestId: context.requestId,
        userAgent: context.userAgent,
        locale: payload.uiContext.locale,
      },
      authorityTitle: payload.authorityTitle,
      authorityAttested: payload.authorityAttested,
      commercialValueSnapshot,
      thresholdMinor: this.options.policies.clickThroughThresholdMinor,
    });
    const [agreement] = await transaction
      .insert(agreements)
      .values({
        id: agreementId,
        accountId: payload.accountId,
        templateId: template.id,
        paper: "ours",
        executionMode: "click_through",
        executedDocumentId: template.canonicalDocumentId,
        negotiationStatus: "standard",
        effectiveOn: context.occurredAt.slice(0, 10),
        termMonths: null,
        renewalType: "expires",
        noticeDays: 0,
        status: "active",
        signerUserId: acceptingUserId,
        authorityTitle: payload.authorityTitle,
        authorityAttested: true,
        acceptedIp: context.ip,
        acceptedUserAgent: context.userAgent,
        textHash: template.textHash,
      })
      .returning();
    if (!agreement) throw new Error("AGREEMENT_INSERT_FAILED");
    await transaction.insert(lifecycleClickAcceptances).values({
      id: clickEvidence.evidenceId,
      agreementId: agreement.id,
      accountId: payload.accountId,
      templateId: template.id,
      userId: acceptingUserId,
      exactTextHash: template.textHash,
      evidenceHash: clickEvidence.evidenceHash,
      evidence: clickEvidence,
      acceptedAt: new Date(clickEvidence.acceptedAt),
    });
    if (payload.previousAgreementId) {
      const [previous] = await transaction
        .update(agreements)
        .set({
          status: "terminated",
          supersededById: agreement.id,
          version: 2,
        })
        .where(
          and(
            eq(agreements.id, payload.previousAgreementId),
            eq(agreements.accountId, payload.accountId),
            eq(agreements.status, "active"),
            eq(agreements.version, 1),
          ),
        )
        .returning();
      if (!previous) throw new Error("PREVIOUS_AGREEMENT_VERSION_CONFLICT");
    }
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "agreement",
      aggregateId: agreement.id,
      aggregateVersion: agreement.version,
      eventType: "agreement.executed",
      context,
      after: {
        agreementId: agreement.id,
        templateId: template.id,
        templateVersion: template.semanticVersion,
        evidenceId: clickEvidence.evidenceId,
        evidenceHash: clickEvidence.evidenceHash,
        acceptedAt: clickEvidence.acceptedAt,
      },
    });
    return result(agreement.id, "active", "agreement.executed", {
      evidenceHash: clickEvidence.evidenceHash,
    });
  }

  private async createSignatureEnvelope(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = createSignatureEnvelopePayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    const draft = await transaction.query.lifecycleAgreementDrafts.findFirst({
      where: and(
        eq(lifecycleAgreementDrafts.id, payload.agreementId),
        eq(lifecycleAgreementDrafts.accountId, payload.accountId),
        eq(lifecycleAgreementDrafts.status, "draft"),
      ),
    });
    if (!draft || draft.executionMode !== "counter_signed")
      throw new Error("COUNTER_SIGNED_AGREEMENT_DRAFT_NOT_FOUND");
    if (
      draft.customerPaperDocumentId &&
      draft.customerPaperDocumentId !== payload.documentId
    )
      throw new Error("ENVELOPE_DOCUMENT_MISMATCH");
    await immutableEvidence(transaction, payload.documentId, payload.accountId);
    const providerEnvelopeId = `esign-${hashText(
      `${payload.agreementId}:${context.idempotencyKey}`,
    ).slice(0, 40)}`;
    const domainEnvelope = createCounterSignatureEnvelope({
      envelopeId: providerEnvelopeId,
      agreementId: payload.agreementId,
      provider: "esign",
      idempotencyKey: context.idempotencyKey ?? "",
      signingMode: payload.mode,
      ...(payload.mode === "redirect" ? { signingUrl: payload.returnUrl } : {}),
      createdAt: context.occurredAt,
    });
    const [envelope] = await transaction
      .insert(lifecycleSignatureEnvelopes)
      .values({
        agreementDraftId: draft.id,
        accountId: payload.accountId,
        providerEnvelopeId,
        documentId: payload.documentId,
        signerEmail: payload.signerEmail.toLowerCase(),
        signingMode: payload.mode,
        returnUrl: payload.returnUrl,
        state: domainEnvelope.state,
        providerEventIds: [],
      })
      .returning();
    if (!envelope) throw new Error("SIGNATURE_ENVELOPE_INSERT_FAILED");
    await transaction.insert(providerOperations).values({
      provider: "esign",
      operation: "create_envelope",
      idempotencyKey: domainEnvelope.idempotencyKey,
      aggregateType: "agreement",
      aggregateId: draft.id,
      status: "pending",
    });
    const draftVersion = await this.bumpDraftVersion(
      transaction,
      draft.id,
      draft.rowVersion,
    );
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "agreement",
      aggregateId: draft.id,
      aggregateVersion: draftVersion,
      eventType: "agreement.envelope_created",
      context,
      after: {
        envelopeId: envelope.id,
        providerEnvelopeId,
        agreementId: draft.id,
        signingMode: envelope.signingMode,
        signerEmail: envelope.signerEmail,
      },
    });
    return result(envelope.id, "created", "agreement.envelope_created", {
      providerEnvelopeId,
    });
  }

  private async ingestSignatureEvent(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = signatureEventPayloadSchema.parse(raw);
    const envelope =
      await transaction.query.lifecycleSignatureEnvelopes.findFirst({
        where: eq(
          lifecycleSignatureEnvelopes.providerEnvelopeId,
          payload.envelopeId,
        ),
      });
    if (!envelope) throw new Error("SIGNATURE_ENVELOPE_NOT_FOUND");
    const draft = await transaction.query.lifecycleAgreementDrafts.findFirst({
      where: eq(lifecycleAgreementDrafts.id, envelope.agreementDraftId),
    });
    if (!draft) throw new Error("AGREEMENT_DRAFT_NOT_FOUND");
    const knownEvent = envelope.providerEventIds.includes(payload.eventId);
    if (knownEvent)
      return result(envelope.id, envelope.state, undefined, {
        outcome: "duplicate",
      });
    const state = z
      .enum([
        "created",
        "sent",
        "viewed",
        "signed",
        "provider_completed",
        "completed",
        "declined",
        "voided",
        "expired",
      ])
      .parse(envelope.state);
    const domainEnvelope: CounterSignatureEnvelope = {
      envelopeId: envelope.providerEnvelopeId,
      agreementId: draft.id,
      provider: "esign",
      idempotencyKey: `esign:${envelope.providerEnvelopeId}`,
      signingMode: z.enum(["redirect", "embedded"]).parse(envelope.signingMode),
      signingUrl:
        envelope.signingMode === "redirect" ? envelope.returnUrl : null,
      state,
      processedProviderEventIds: envelope.providerEventIds,
      stateChangedAt: envelope.updatedAt.toISOString(),
      signerEmails: [envelope.signerEmail],
      signedPdf: envelope.signedPdfDocumentId
        ? await immutableEvidence(
            transaction,
            envelope.signedPdfDocumentId,
            envelope.accountId,
          )
        : null,
      completionCertificate: envelope.completionCertificateDocumentId
        ? await immutableEvidence(
            transaction,
            envelope.completionCertificateDocumentId,
            envelope.accountId,
          )
        : null,
    };
    const eventType = payload.type.replace("envelope.", "");
    const domainEventType = z
      .enum(["sent", "viewed", "completed", "declined", "expired", "voided"])
      .parse(eventType);
    const applied = applyEnvelopeEvent(domainEnvelope, {
      providerEventId: payload.eventId,
      envelopeId: payload.envelopeId,
      type: domainEventType,
      occurredAt: payload.occurredAt,
      signerEmail: envelope.signerEmail,
    });
    let updatedDomain = applied.envelope;
    if (payload.type === "envelope.completed") {
      if (
        !payload.signedPdfDocumentId ||
        !payload.completionCertificateDocumentId
      )
        throw new Error("COUNTER_SIGNATURE_EVIDENCE_INCOMPLETE");
      const signedPdf = await immutableEvidence(
        transaction,
        payload.signedPdfDocumentId,
        envelope.accountId,
      );
      const completionCertificate = await immutableEvidence(
        transaction,
        payload.completionCertificateDocumentId,
        envelope.accountId,
      );
      updatedDomain = ingestCounterSignatureEvidence(updatedDomain, {
        signedPdf: { ...signedPdf, kind: "signed_pdf" },
        completionCertificate: {
          ...completionCertificate,
          kind: "completion_certificate",
        },
        ingestedAt: payload.occurredAt,
      });
    }
    const nextVersion = envelope.rowVersion + 1;
    const [updated] = await transaction
      .update(lifecycleSignatureEnvelopes)
      .set({
        state: updatedDomain.state,
        providerSequence: Math.max(envelope.providerSequence, payload.sequence),
        providerEventIds: [...updatedDomain.processedProviderEventIds],
        signedPdfDocumentId: payload.signedPdfDocumentId,
        completionCertificateDocumentId:
          payload.completionCertificateDocumentId,
        completedAt:
          updatedDomain.state === "completed"
            ? new Date(payload.occurredAt)
            : null,
        updatedAt: this.now(),
        rowVersion: nextVersion,
      })
      .where(
        and(
          eq(lifecycleSignatureEnvelopes.id, envelope.id),
          eq(lifecycleSignatureEnvelopes.rowVersion, envelope.rowVersion),
        ),
      )
      .returning();
    if (!updated) throw new Error("VERSION_CONFLICT");
    await transaction.insert(lifecycleDomainEvents).values({
      provider: "esign",
      providerEventId: payload.eventId,
      aggregateType: "agreement_envelope",
      aggregateId: envelope.id,
      sequence: payload.sequence,
      eventType: payload.type,
      payloadHash: hashJson(payload),
      payload,
      occurredAt: new Date(payload.occurredAt),
    });
    let emittedEventType = "agreement.envelope_event_ingested";
    if (updatedDomain.state === "completed") {
      const signer = await transaction.query.commerceUsers.findFirst({
        where: eq(commerceUsers.email, envelope.signerEmail),
      });
      if (!signer) throw new Error("SIGNER_IDENTITY_NOT_FOUND");
      const signedPdfDocumentId = payload.signedPdfDocumentId;
      const completionCertificateDocumentId =
        payload.completionCertificateDocumentId;
      if (!signedPdfDocumentId || !completionCertificateDocumentId)
        throw new Error("COUNTER_SIGNATURE_EVIDENCE_INCOMPLETE");
      const [agreement] = await transaction
        .insert(agreements)
        .values({
          id: draft.id,
          accountId: draft.accountId,
          templateId: draft.templateId,
          paper: draft.paper,
          executionMode: "counter_signed",
          executedDocumentId: signedPdfDocumentId,
          evidenceDocumentId: completionCertificateDocumentId,
          envelopeId: envelope.providerEnvelopeId,
          negotiationStatus:
            draft.negotiationStatus === "agreed" ? "agreed" : "standard",
          effectiveOn: payload.occurredAt.slice(0, 10),
          termMonths: null,
          renewalType: "expires",
          noticeDays: 0,
          status: "active",
          signerUserId: signer.id,
          authorityTitle: "Authorized signatory",
          authorityAttested: true,
          acceptedIp: "0.0.0.0",
          acceptedUserAgent: "verified-esign-provider",
          textHash: (await immutableEvidence(transaction, signedPdfDocumentId))
            .sha256,
        })
        .onConflictDoNothing()
        .returning();
      if (!agreement) {
        const existing = await transaction.query.agreements.findFirst({
          where: eq(agreements.id, draft.id),
        });
        if (!existing || existing.envelopeId !== envelope.providerEnvelopeId)
          throw new Error("AGREEMENT_EXECUTION_CONFLICT");
      }
      const draftVersion = await this.bumpDraftVersion(
        transaction,
        draft.id,
        draft.rowVersion,
        "executed",
      );
      emittedEventType = "agreement.envelope_completed";
      await appendEvent(transaction, {
        accountId: draft.accountId,
        aggregateType: "agreement",
        aggregateId: draft.id,
        aggregateVersion: draftVersion,
        eventType: emittedEventType,
        context,
        after: {
          agreementId: draft.id,
          envelopeId: envelope.providerEnvelopeId,
          signedPdfDocumentId,
          completionCertificateDocumentId,
          completedAt: payload.occurredAt,
          providerEventIds: updated.providerEventIds,
        },
      });
    } else {
      await appendEvent(transaction, {
        accountId: draft.accountId,
        aggregateType: "provider_operation",
        aggregateId: envelope.id,
        aggregateVersion: updated.rowVersion,
        eventType: emittedEventType,
        context,
        after: {
          envelopeId: envelope.providerEnvelopeId,
          state: updated.state,
          outcome: applied.outcome,
          providerSequence: updated.providerSequence,
        },
      });
    }
    return result(envelope.id, updated.state, emittedEventType, {
      outcome: applied.outcome,
    });
  }

  private async ingestProvisioningEvent(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = provisioningEventPayloadSchema.parse(raw);
    if (payload.type === "poc.success_recorded") {
      const snapshot = payload.snapshot;
      const { evidenceHash, ...body } = snapshot;
      if (hashPocEvidence(body) !== evidenceHash)
        throw new Error("POC_SUCCESS_EVIDENCE_HASH_MISMATCH");
      const poc = await transaction.query.pocs.findFirst({
        where: eq(pocs.id, snapshot.pocId),
      });
      if (!poc || poc.status !== "active") throw new Error("POC_NOT_ACTIVE");
      const [evidence] = await transaction
        .insert(lifecyclePocEvidence)
        .values({
          pocId: poc.id,
          kind: "success_snapshot",
          sourceId: snapshot.snapshotId,
          payload: snapshot,
          evidenceHash,
          recordedAt: new Date(payload.occurredAt),
        })
        .onConflictDoNothing()
        .returning();
      if (!evidence) {
        const existing = await transaction.query.lifecyclePocEvidence.findFirst(
          {
            where: and(
              eq(lifecyclePocEvidence.pocId, poc.id),
              eq(lifecyclePocEvidence.kind, "success_snapshot"),
              eq(lifecyclePocEvidence.sourceId, snapshot.snapshotId),
            ),
          },
        );
        if (!existing || existing.evidenceHash !== evidenceHash)
          throw new Error("POC_SUCCESS_EVIDENCE_CONFLICT");
        return result(existing.id, "duplicate");
      }
      const version = await this.bumpPocVersion(
        transaction,
        poc.id,
        poc.rowVersion,
      );
      await appendEvent(transaction, {
        accountId: poc.accountId,
        aggregateType: "poc",
        aggregateId: poc.id,
        aggregateVersion: version,
        eventType: "poc.success_recorded",
        context,
        after: {
          pocId: poc.id,
          snapshotId: snapshot.snapshotId,
          evidenceHash,
          evaluatedAt: snapshot.evaluatedAt,
        },
      });
      return result(evidence.id, "recorded", "poc.success_recorded");
    }
    const attemptRow =
      await transaction.query.lifecycleProvisioningAttempts.findFirst({
        where: eq(lifecycleProvisioningAttempts.commandId, payload.commandId),
      });
    if (!attemptRow) throw new Error("PROVISIONING_COMMAND_NOT_FOUND");
    if (
      attemptRow.lastProviderOccurredAt &&
      Date.parse(payload.occurredAt) <
        attemptRow.lastProviderOccurredAt.getTime()
    )
      return result(attemptRow.id, attemptRow.state, undefined, {
        outcome: "stale",
      });
    const attempt = ProvisioningAttemptSchema.parse(attemptRow.attempt);
    if (
      attempt.command.operation === "teardown" &&
      payload.status === "succeeded"
    ) {
      if (!(await this.capabilityEnabled(transaction, "teardown", true)))
        throw new Error("TEARDOWN_RECOVERY_CAPABILITY_BLOCKED");
      if (
        !payload.excludedObjectIds ||
        !payload.deletedScope ||
        !payload.deletionMethod
      )
        throw new Error("TEARDOWN_CERTIFICATE_EVIDENCE_INCOMPLETE");
    }
    const applied = applyProvisioningConfirmation(
      attempt,
      {
        confirmationId: payload.confirmationId,
        commandId: payload.commandId,
        operationId: payload.operationId,
        status: payload.status,
        tenantId: payload.tenantId,
        resources: payload.resources,
        occurredAt: payload.occurredAt,
      },
      new Set<string>(),
    );
    if (applied.duplicate && attempt.command.operation === "teardown")
      return result(attemptRow.id, attemptRow.state, undefined, {
        duplicate: true,
      });
    const nextVersion = attemptRow.rowVersion + 1;
    const [updated] = await transaction
      .update(lifecycleProvisioningAttempts)
      .set({
        state: applied.attempt.state,
        attempt: applied.attempt,
        providerOperationId: payload.operationId,
        lastProviderOccurredAt: new Date(payload.occurredAt),
        updatedAt: this.now(),
        rowVersion: nextVersion,
      })
      .where(
        and(
          eq(lifecycleProvisioningAttempts.id, attemptRow.id),
          eq(lifecycleProvisioningAttempts.rowVersion, attemptRow.rowVersion),
        ),
      )
      .returning();
    if (!updated) throw new Error("VERSION_CONFLICT");
    await transaction
      .update(providerOperations)
      .set({
        status: payload.status === "succeeded" ? "succeeded" : "failed",
        providerReference: payload.operationId,
        lastError:
          payload.status === "failed"
            ? "Provisioning provider reported failure"
            : null,
        updatedAt: this.now(),
        rowVersion: attemptRow.rowVersion + 1,
      })
      .where(
        and(
          eq(providerOperations.provider, "provisioning"),
          eq(providerOperations.idempotencyKey, attempt.command.idempotencyKey),
        ),
      );
    let eventType =
      payload.status === "succeeded"
        ? "order.provisioning_confirmed"
        : "order.provisioning_dead_lettered";
    if (payload.status === "succeeded") {
      if (attempt.command.operation === "provision" && attemptRow.orderId) {
        await this.materializePaidOrderEntitlements(transaction, {
          attempt,
          accountId: attemptRow.accountId,
          orderId: attemptRow.orderId,
          organizationId: attemptRow.organizationId,
          tenantId: payload.tenantId,
          resources: payload.resources,
          occurredAt: new Date(payload.occurredAt),
        });
      } else {
        for (const resource of payload.resources) {
          await transaction
            .update(entitlements)
            .set({
              provisionedResourceId: resource.resourceId,
              activatedAt: new Date(payload.occurredAt),
              status: "active",
              updatedAt: this.now(),
            })
            .where(
              and(
                eq(entitlements.organizationId, attemptRow.organizationId),
                eq(entitlements.sku, resource.entitlementSku),
                eq(entitlements.status, "pending"),
              ),
            );
        }
      }
      if (attempt.command.operation === "sandbox" && attemptRow.pocId) {
        const poc = await transaction.query.pocs.findFirst({
          where: eq(pocs.id, attemptRow.pocId),
        });
        if (!poc || poc.status !== "approved")
          throw new Error("POC_NOT_APPROVED");
        const [activated] = await transaction
          .update(pocs)
          .set({
            status: "active",
            updatedAt: this.now(),
            rowVersion: poc.rowVersion + 1,
          })
          .where(and(eq(pocs.id, poc.id), eq(pocs.rowVersion, poc.rowVersion)))
          .returning();
        if (!activated) throw new Error("VERSION_CONFLICT");
        eventType = "poc.activated";
      }
      if (attempt.command.operation === "teardown")
        eventType = "termination.teardown_confirmed";
    }
    let auditAggregateType: EntityName =
      attempt.command.operation === "teardown"
        ? "provider_operation"
        : attemptRow.pocId
          ? "poc"
          : "order";
    let auditAggregateId =
      attempt.command.operation === "teardown"
        ? attemptRow.id
        : (attemptRow.pocId ?? attemptRow.orderId ?? attemptRow.id);
    let auditAggregateVersion = updated.rowVersion;
    if (
      payload.status === "succeeded" &&
      attempt.command.operation === "teardown" &&
      attemptRow.orderId
    ) {
      if (!payload.excludedObjectIds)
        throw new Error("TEARDOWN_EXCLUSION_CONFIRMATION_REQUIRED");
      const rows = await transaction
        .select({
          terminationId: lifecycleOffboardingPlans.terminationId,
          plan: lifecycleOffboardingPlans.plan,
          planVersion: lifecycleOffboardingPlans.rowVersion,
          terminationVersion: terminations.rowVersion,
        })
        .from(lifecycleOffboardingPlans)
        .innerJoin(
          terminations,
          eq(terminations.id, lifecycleOffboardingPlans.terminationId),
        )
        .where(
          and(
            eq(terminations.orderId, attemptRow.orderId),
            eq(terminations.teardownStatus, "teardown_requested"),
          ),
        )
        .orderBy(desc(terminations.createdAt))
        .limit(1);
      const teardown = rows[0];
      if (!teardown) throw new Error("TEARDOWN_PLAN_NOT_FOUND");
      const confirmed = confirmTeardown(
        OffboardingPlanSchema.parse(teardown.plan),
        {
          operationId: payload.operationId,
          confirmedAt: payload.occurredAt,
          excludedObjectIds: payload.excludedObjectIds,
        },
      );
      const nextPlanVersion = teardown.planVersion + 1;
      const [updatedPlan] = await transaction
        .update(lifecycleOffboardingPlans)
        .set({
          plan: confirmed,
          updatedAt: this.now(),
          rowVersion: nextPlanVersion,
        })
        .where(
          and(
            eq(lifecycleOffboardingPlans.terminationId, teardown.terminationId),
            eq(lifecycleOffboardingPlans.rowVersion, teardown.planVersion),
          ),
        )
        .returning();
      if (!updatedPlan) throw new Error("VERSION_CONFLICT");
      const [updatedTermination] = await transaction
        .update(terminations)
        .set({
          teardownStatus: confirmed.status,
          teardownConfirmedAt: new Date(payload.occurredAt),
          updatedAt: this.now(),
          rowVersion: teardown.terminationVersion + 1,
        })
        .where(
          and(
            eq(terminations.id, teardown.terminationId),
            eq(terminations.rowVersion, teardown.terminationVersion),
          ),
        )
        .returning();
      if (!updatedTermination) throw new Error("VERSION_CONFLICT");
      const [sourceOrder] = await transaction
        .select({
          id: orders.id,
          status: orders.status,
          rowVersion: orders.rowVersion,
        })
        .from(orders)
        .where(eq(orders.id, attemptRow.orderId))
        .for("update");
      if (!sourceOrder) throw new Error("ORDER_NOT_FOUND");
      const unsettledInvoices = await transaction
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.orderId, sourceOrder.id),
            inArray(invoices.status, ["draft", "open"]),
          ),
        )
        .for("update");
      if (unsettledInvoices.length > 0)
        throw new Error("FINAL_BILLING_INCOMPLETE");
      const finalOrderStatus =
        sourceOrder.status === "terminated" ||
        sourceOrder.status === "cancelled"
          ? sourceOrder.status
          : sourceOrder.status === "active" || sourceOrder.status === "amended"
            ? "terminated"
            : "cancelled";
      if (
        sourceOrder.status !== "terminated" &&
        sourceOrder.status !== "cancelled"
      ) {
        assertRecoverableOffboardingSourceStatus(sourceOrder.status);
        const [finalizedOrder] = await transaction
          .update(orders)
          .set({ status: finalOrderStatus, updatedAt: this.now() })
          .where(
            and(
              eq(orders.id, sourceOrder.id),
              eq(orders.rowVersion, sourceOrder.rowVersion),
            ),
          )
          .returning({ id: orders.id });
        if (!finalizedOrder) throw new Error("VERSION_CONFLICT");
      }
      const deletionMethod = payload.deletionMethod;
      const deletedScope = payload.deletedScope;
      if (!deletionMethod || !deletedScope)
        throw new Error("TEARDOWN_CERTIFICATE_EVIDENCE_INCOMPLETE");
      const certificateData = deletionCertificateData(confirmed, {
        completedAt: payload.occurredAt,
        method: deletionMethod,
      });
      const retainedObjectExclusions = confirmed.lockedExclusions.filter(
        (object) =>
          confirmed.teardownExcludedObjectIds.includes(object.objectId),
      );
      if (
        deletedScope.some((scope) =>
          retainedObjectExclusions.some((object) =>
            scope.includes(object.objectId),
          ),
        )
      )
        throw new Error("TEARDOWN_DELETED_SCOPE_INCLUDES_RETAINED_OBJECT");
      const approved = confirmed.approvals.filter(
        (approval) => approval.decision === "approved",
      );
      if (
        approved.length < 2 ||
        !approved[0] ||
        !approved[1] ||
        approved[0].approverId === approved[1].approverId
      )
        throw new Error("TWO_PERSON_APPROVAL_REQUIRED");
      const [account, approvers] = await Promise.all([
        transaction.query.accounts.findFirst({
          where: eq(accounts.id, attemptRow.accountId),
        }),
        transaction.query.commerceUsers.findMany({
          where: inArray(commerceUsers.id, [
            approved[0].approverId,
            approved[1].approverId,
          ]),
        }),
      ]);
      if (!account || approvers.length !== 2)
        throw new Error("DELETION_CERTIFICATE_IDENTITY_EVIDENCE_MISSING");
      const address = CertificateAddressSchema.parse(account.registeredAddress);
      const retainUntil = new Date(payload.occurredAt);
      retainUntil.setUTCFullYear(
        retainUntil.getUTCFullYear() +
          (this.options.policies.deletionCertificateRetentionYears ?? 0),
      );
      const requestBody: Omit<DeletionCertificateRequest, "requestHash"> = {
        requestVersion: 1,
        terminationId: teardown.terminationId,
        accountId: attemptRow.accountId,
        orderId: attemptRow.orderId,
        organizationId: confirmed.organizationId,
        certificateNumber: `DEL-${teardown.terminationId}`,
        account: {
          legalName: account.legalName,
          address: {
            line1: address.line1,
            ...(address.line2 ? { line2: address.line2 } : {}),
            locality: address.city,
            ...(address.region ? { region: address.region } : {}),
            postalCode: address.postalCode,
            countryCode: address.country,
          },
        },
        deletedScope,
        deletionMethod: certificateData.method,
        completedAt: certificateData.completedAt,
        retainedObjectExclusions,
        approvals: [approved[0], approved[1]].map((approval) => {
          const approver = approvers.find(
            (candidate) => candidate.id === approval.approverId,
          );
          if (!approver)
            throw new Error("DELETION_CERTIFICATE_APPROVER_NOT_FOUND");
          return {
            approvalId: approval.approvalId,
            approverId: approval.approverId,
            approverName: approver.name,
            role: "destructive_action_approver",
            approvedAt: approval.decidedAt,
            evidenceHash: approval.evidenceHash,
            authenticationEvidenceHash:
              approval.recentAuthentication.evidenceHash,
          };
        }),
        providerEvidence: {
          commandId: attempt.command.commandId,
          commandIdempotencyKey: attempt.command.idempotencyKey,
          confirmationId: payload.confirmationId,
          operationId: payload.operationId,
          tenantId: payload.tenantId,
          confirmedAt: payload.occurredAt,
        },
        retainUntil: retainUntil.toISOString(),
      };
      const certificateRequest: DeletionCertificateRequest = {
        ...requestBody,
        requestHash: deletionCertificateRequestHash(requestBody),
      };
      await appendEvent(transaction, {
        accountId: attemptRow.accountId,
        aggregateType: "provider_operation",
        aggregateId: attemptRow.id,
        aggregateVersion: updated.rowVersion,
        eventType: "termination.deletion_certificate_requested",
        context,
        after: { certificateRequest },
      });
      auditAggregateType = "termination";
      auditAggregateId = teardown.terminationId;
      auditAggregateVersion = updatedTermination.rowVersion;
    }
    await appendEvent(transaction, {
      accountId: attemptRow.accountId,
      aggregateType: auditAggregateType,
      aggregateId: auditAggregateId,
      aggregateVersion: auditAggregateVersion,
      eventType,
      context,
      after: {
        commandId: attemptRow.commandId,
        operation: attempt.command.operation,
        state: updated.state,
        confirmationId: payload.confirmationId,
        operationId: payload.operationId,
        tenantId: payload.tenantId,
        resources: payload.resources,
        ...(payload.excludedObjectIds
          ? { excludedObjectIds: payload.excludedObjectIds }
          : {}),
        ...(payload.deletedScope ? { deletedScope: payload.deletedScope } : {}),
        ...(payload.deletionMethod
          ? { deletionMethod: payload.deletionMethod }
          : {}),
      },
    });
    return result(updated.id, updated.state, eventType, {
      duplicate: applied.duplicate,
    });
  }

  private async ingestMarketplaceEvent(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = marketplaceEventPayloadSchema.parse(raw);
    const aggregateId =
      payload.entitlementId ?? payload.orderId ?? payload.accountId;
    if (!aggregateId) throw new Error("MARKETPLACE_EVENT_SCOPE_REQUIRED");
    const lastProjectionEvent =
      await transaction.query.lifecycleDomainEvents.findFirst({
        where: and(
          eq(lifecycleDomainEvents.provider, payload.provider),
          eq(lifecycleDomainEvents.aggregateId, aggregateId),
        ),
        orderBy: [desc(lifecycleDomainEvents.sequence)],
      });
    if (
      lastProjectionEvent &&
      payload.sequence <= lastProjectionEvent.sequence
    ) {
      if (
        payload.sequence === lastProjectionEvent.sequence &&
        payload.eventId !== lastProjectionEvent.providerEventId
      )
        throw new Error("MARKETPLACE_PROVIDER_SEQUENCE_CONFLICT");
      return result(aggregateId, "stale", undefined, {
        lastAppliedSequence: lastProjectionEvent.sequence,
      });
    }
    let authoritativeAccountId = payload.accountId;
    if (payload.entitlementId) {
      const entitlement = await transaction
        .select({
          id: entitlements.id,
          accountId: orders.accountId,
          orderId: orders.id,
          status: entitlements.status,
          rowVersion: entitlements.rowVersion,
        })
        .from(entitlements)
        .innerJoin(orders, eq(orders.id, entitlements.orderId))
        .where(eq(entitlements.id, payload.entitlementId))
        .limit(1);
      const persisted = entitlement[0];
      if (!persisted) throw new Error("MARKETPLACE_ENTITLEMENT_NOT_FOUND");
      if (
        (payload.accountId && payload.accountId !== persisted.accountId) ||
        (payload.orderId && payload.orderId !== persisted.orderId)
      )
        throw new Error("MARKETPLACE_EVENT_SCOPE_MISMATCH");
      authoritativeAccountId = persisted.accountId;
      const nextStatus = {
        "entitlement.activated": "active",
        "entitlement.suspended": "suspended_write",
        "entitlement.terminated": "terminated",
      }[payload.type];
      if (nextStatus) {
        const [updated] = await transaction
          .update(entitlements)
          .set({
            status: nextStatus,
            activatedAt:
              nextStatus === "active"
                ? new Date(payload.occurredAt)
                : undefined,
            updatedAt: this.now(),
            rowVersion: persisted.rowVersion + 1,
          })
          .where(
            and(
              eq(entitlements.id, persisted.id),
              eq(entitlements.rowVersion, persisted.rowVersion),
            ),
          )
          .returning();
        if (!updated) throw new Error("VERSION_CONFLICT");
      }
    }
    const payloadHash = hashJson(payload);
    const [marketplaceEvent] = await transaction
      .insert(marketplaceEvents)
      .values({
        provider: payload.provider,
        providerEventId: payload.eventId,
        eventType: marketplaceEventCategory(payload.type),
        providerAccountReference: payload.providerAccountReference,
        accountId: authoritativeAccountId,
        orderId: payload.orderId,
        entitlementId: payload.entitlementId,
        occurredAt: new Date(payload.occurredAt),
        currency: payload.currency,
        grossMinor:
          payload.grossMinor === null ? null : BigInt(payload.grossMinor),
        feeMinor: payload.feeMinor === null ? null : BigInt(payload.feeMinor),
        taxMinor: payload.taxMinor === null ? null : BigInt(payload.taxMinor),
        netMinor: payload.netMinor === null ? null : BigInt(payload.netMinor),
        quantity: payload.quantity,
        payloadHash,
        normalizedPayload: payload,
        processingStatus: "processed",
        processedAt: this.now(),
      })
      .returning();
    if (!marketplaceEvent) throw new Error("MARKETPLACE_EVENT_INSERT_FAILED");
    await transaction.insert(lifecycleDomainEvents).values({
      provider: payload.provider,
      providerEventId: payload.eventId,
      aggregateType: payload.entitlementId ? "entitlement" : "order",
      aggregateId,
      sequence: payload.sequence,
      eventType: payload.type,
      payloadHash,
      payload,
      occurredAt: new Date(payload.occurredAt),
    });
    await appendEvent(transaction, {
      ...(authoritativeAccountId ? { accountId: authoritativeAccountId } : {}),
      aggregateType: payload.entitlementId ? "entitlement" : "order",
      aggregateId,
      aggregateVersion: payload.sequence,
      eventType: "entitlement.marketplace_event_received",
      context,
      after: {
        marketplaceEventId: marketplaceEvent.id,
        provider: payload.provider,
        providerEventId: payload.eventId,
        providerEventType: payload.type,
        sequence: payload.sequence,
      },
    });
    return result(
      marketplaceEvent.id,
      "processed",
      "entitlement.marketplace_event_received",
    );
  }

  private async materializePaidOrderEntitlements(
    transaction: RuntimeTransaction,
    input: {
      attempt: ProvisioningAttempt;
      accountId: string;
      orderId: string;
      organizationId: string;
      tenantId: string;
      resources: readonly { entitlementSku: string; resourceId: string }[];
      occurredAt: Date;
    },
  ): Promise<void> {
    const [order, organization, persistedSnapshots] = await Promise.all([
      transaction.query.orders.findFirst({
        where: and(
          eq(orders.id, input.orderId),
          eq(orders.accountId, input.accountId),
        ),
      }),
      transaction.query.organizations.findFirst({
        where: and(
          eq(organizations.id, input.organizationId),
          eq(organizations.accountId, input.accountId),
        ),
      }),
      transaction
        .select({
          orderLineId: orderLineSnapshots.orderLineId,
          snapshot: orderLineSnapshots.snapshot,
          snapshotHash: orderLineSnapshots.snapshotHash,
        })
        .from(orderLineSnapshots)
        .innerJoin(
          orderLines,
          eq(orderLines.id, orderLineSnapshots.orderLineId),
        )
        .where(eq(orderLines.orderId, input.orderId)),
    ]);
    if (!order || !organization)
      throw new Error("PROVISIONING_ORDER_OR_ORGANIZATION_SCOPE_MISMATCH");
    if (
      organization.externalProvisioningId &&
      organization.externalProvisioningId !== input.tenantId
    )
      throw new Error("PROVISIONING_TENANT_BINDING_MISMATCH");
    if (!organization.externalProvisioningId) {
      const [bound] = await transaction
        .update(organizations)
        .set({ externalProvisioningId: input.tenantId, updatedAt: this.now() })
        .where(
          and(
            eq(organizations.id, organization.id),
            isNull(organizations.externalProvisioningId),
          ),
        )
        .returning({ id: organizations.id });
      if (!bound) throw new Error("PROVISIONING_TENANT_BINDING_CONFLICT");
    }
    const canonicalLines = provisioningLinesFromSnapshots(persistedSnapshots);
    const persistedCommandLines = input.attempt.command.entitlements;
    if (
      canonicalLines.length !== persistedCommandLines.length ||
      canonicalLines.some((line, index) => {
        const persisted = persistedCommandLines[index];
        return (
          !persisted ||
          line.sku !== persisted.sku ||
          line.productCode !== persisted.productCode ||
          line.entitlementKind !== persisted.entitlementKind ||
          line.quantity !== persisted.quantity ||
          line.region !== persisted.region
        );
      })
    )
      throw new Error("PROVISIONING_COMMAND_SNAPSHOT_MISMATCH");

    const expectedSkus = new Set(canonicalLines.map((line) => line.sku));
    const resources = new Map<string, string>();
    for (const resource of input.resources) {
      if (
        !expectedSkus.has(resource.entitlementSku) ||
        resources.has(resource.entitlementSku)
      )
        throw new Error("PROVISIONING_RESOURCE_SCOPE_MISMATCH");
      resources.set(resource.entitlementSku, resource.resourceId);
    }
    if (resources.size !== expectedSkus.size)
      throw new Error("PROVISIONING_RESOURCE_COVERAGE_INCOMPLETE");

    for (const line of canonicalLines) {
      const resourceId = resources.get(line.sku);
      if (!resourceId)
        throw new Error("PROVISIONING_RESOURCE_COVERAGE_INCOMPLETE");
      const existing = await transaction.query.entitlements.findFirst({
        where: eq(entitlements.orderLineId, line.orderLineId),
      });
      if (existing) {
        if (
          existing.orderId !== order.id ||
          existing.organizationId !== organization.id ||
          existing.sku !== line.sku ||
          existing.committedQuantity !== line.quantity ||
          existing.region !== line.region ||
          (existing.provisionedResourceId !== null &&
            existing.provisionedResourceId !== resourceId)
        )
          throw new Error("PROVISIONING_ENTITLEMENT_SNAPSHOT_CONFLICT");
        if (existing.status !== "active") {
          const [activated] = await transaction
            .update(entitlements)
            .set({
              provisionedResourceId: resourceId,
              activatedAt: input.occurredAt,
              status: "active",
              updatedAt: this.now(),
            })
            .where(
              and(
                eq(entitlements.id, existing.id),
                eq(entitlements.rowVersion, existing.rowVersion),
              ),
            )
            .returning({ id: entitlements.id });
          if (!activated) throw new Error("VERSION_CONFLICT");
        }
      } else {
        await transaction.insert(entitlements).values({
          orderId: order.id,
          orderLineId: line.orderLineId,
          organizationId: organization.id,
          sku: line.sku,
          committedQuantity: line.quantity,
          region: line.region,
          provisionedResourceId: resourceId,
          activatedAt: input.occurredAt,
          status: "active",
        });
      }
    }
    let activatingOrder = order;
    if (activatingOrder.status === "accepted") {
      const [provisioningOrder] = await transaction
        .update(orders)
        .set({ status: "provisioning", updatedAt: this.now() })
        .where(
          and(
            eq(orders.id, activatingOrder.id),
            eq(orders.rowVersion, activatingOrder.rowVersion),
          ),
        )
        .returning();
      if (!provisioningOrder) throw new Error("VERSION_CONFLICT");
      activatingOrder = provisioningOrder;
    }
    if (activatingOrder.status === "provisioning") {
      const [activatedOrder] = await transaction
        .update(orders)
        .set({ status: "active", updatedAt: this.now() })
        .where(
          and(
            eq(orders.id, activatingOrder.id),
            eq(orders.rowVersion, activatingOrder.rowVersion),
          ),
        )
        .returning({ id: orders.id });
      if (!activatedOrder) throw new Error("VERSION_CONFLICT");
    } else if (activatingOrder.status !== "active") {
      throw new Error("PROVISIONING_ORDER_STATE_INVALID");
    }
  }

  private async createPoc(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = createPocPayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    const authenticatedBuyerId = userId(context);
    if (payload.buyerUserId !== authenticatedBuyerId)
      throw new Error("POC_BUYER_MUST_BE_AUTHENTICATED_USER");
    const persistedOwnership = this.exceptionRouting
      ? await this.exceptionRouting.resolve({
          queue: "poc_qualification",
          aggregateId: payload.accountId,
          occurredAt: context.occurredAt,
          severity: "blocking",
          requestedBy: authenticatedBuyerId,
        })
      : undefined;
    const supportOwnerId =
      persistedOwnership?.ownerUserId ??
      this.queuePolicies.get("poc_qualification")?.ownerId;
    if (!supportOwnerId) throw new Error("POC_SUPPORT_OWNER_POLICY_MISSING");
    const [account, buyer, persistedRelationships] = await Promise.all([
      transaction.query.accounts.findFirst({
        where: eq(accounts.id, payload.accountId),
      }),
      transaction.query.commerceUsers.findFirst({
        where: eq(commerceUsers.id, authenticatedBuyerId),
      }),
      transaction.query.dealRegistrations.findMany({
        where: and(
          eq(dealRegistrations.endClientAccountId, payload.accountId),
          inArray(dealRegistrations.status, ["approved", "converted"]),
          lte(
            dealRegistrations.protectionStartsAt,
            new Date(context.occurredAt),
          ),
          gt(dealRegistrations.protectionEndsAt, new Date(context.occurredAt)),
        ),
      }),
    ]);
    if (!account || !buyer)
      throw new Error("POC_IDENTITY_OR_ACCOUNT_NOT_FOUND");
    const partnerAccountId = derivePocPartnerAccountId({
      endClientAccountId: payload.accountId,
      workload: payload.workload,
      now: context.occurredAt,
      assertedPartnerAccountId: payload.partnerAccountId,
      relationships: persistedRelationships.map((relationship) => ({
        partnerAccountId: relationship.partnerAccountId,
        endClientAccountId: relationship.endClientAccountId,
        workload: relationship.workload,
        status: z.enum(["approved", "converted"]).parse(relationship.status),
        protectionStartsAt: relationship.protectionStartsAt.toISOString(),
        protectionEndsAt: relationship.protectionEndsAt.toISOString(),
      })),
    });
    const qualification = qualifyPoc({
      workload: payload.workload,
      buyerUserId: payload.buyerUserId,
      permittedDataClass: payload.permittedDataClass,
      successTests: payload.successTests,
      commercialRangeMinor: {
        minimum: "0",
        maximum: "0",
        currency: account.currency,
      },
      expiresAt: payload.expiresAt,
      supportOwnerId,
    });
    if (!qualification.qualified)
      throw new Error(
        `POC_QUALIFICATION_FAILED:${qualification.reasons.join(",")}`,
      );
    const now = new Date(context.occurredAt);
    const expiresAt = new Date(payload.expiresAt);
    const durationDays = Math.ceil(
      (expiresAt.getTime() - now.getTime()) / 86_400_000,
    );
    if (durationDays < 1) throw new Error("POC_EXPIRY_INVALID");
    const pocId = uuidV7();
    const [organization] = await transaction
      .insert(organizations)
      .values({
        accountId: payload.accountId,
        name: `POC ${payload.workload.slice(0, 68)} ${pocId.slice(0, 8)}`,
        isolated: true,
      })
      .returning();
    if (!organization) throw new Error("POC_ORGANIZATION_INSERT_FAILED");
    const [poc] = await transaction
      .insert(pocs)
      .values({
        id: pocId,
        accountId: payload.accountId,
        organizationId: organization.id,
        partnerAccountId,
        workload: payload.workload,
        permittedDataClass: payload.permittedDataClass,
        successTests: payload.successTests,
        commercialRange: {
          minimum: "0",
          maximum: "0",
          currency: account.currency,
        },
        capacityCap: payload.capacityCap,
        egressCap: payload.egressCap,
        durationDays,
        namedKeys: [`poc-${organization.id}`],
        expiresAt,
        supportOwnerId,
        kickoffAt: now,
        midpointAt: new Date(
          now.getTime() + Math.floor(durationDays / 2) * 86_400_000,
        ),
        finalReportAt: new Date(
          Math.max(now.getTime(), expiresAt.getTime() - 86_400_000),
        ),
        currency: account.currency,
        status: "proposed",
      })
      .returning();
    if (!poc) throw new Error("POC_INSERT_FAILED");
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "poc",
      aggregateId: poc.id,
      aggregateVersion: poc.rowVersion,
      eventType: "poc.qualification_submitted",
      context,
      after: {
        pocId: poc.id,
        organizationId: organization.id,
        isolated: organization.isolated,
        qualification,
        partnerAccountId: poc.partnerAccountId,
        expiresAt: poc.expiresAt.toISOString(),
      },
    });
    return result(poc.id, "proposed", "poc.qualification_submitted", {
      organizationId: organization.id,
    });
  }

  private async decidePoc(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = decidePocPayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    const evidence = await immutableEvidence(
      transaction,
      payload.evidenceDocumentId,
      payload.accountId,
    );
    const poc = await transaction.query.pocs.findFirst({
      where: and(
        eq(pocs.id, payload.pocId),
        eq(pocs.accountId, payload.accountId),
      ),
    });
    if (!poc || poc.status !== "proposed") throw new Error("POC_NOT_PROPOSED");
    const status = payload.decision === "approved" ? "approved" : "closed";
    const [updated] = await transaction
      .update(pocs)
      .set({ status, updatedAt: this.now(), rowVersion: poc.rowVersion + 1 })
      .where(and(eq(pocs.id, poc.id), eq(pocs.rowVersion, poc.rowVersion)))
      .returning();
    if (!updated) throw new Error("VERSION_CONFLICT");
    let provisioningCommandId: string | undefined;
    if (payload.decision === "approved") {
      const plan = createPocEnvironmentPlan({
        pocId: poc.id,
        organizationId: poc.organizationId,
        tenantId: poc.organizationId,
        capacityCap: poc.capacityCap,
        egressCap: poc.egressCap,
        permittedDataClass: z
          .enum(["synthetic", "public", "confidential", "regulated"])
          .parse(poc.permittedDataClass),
        keyNames: poc.namedKeys,
        expiresAt: poc.expiresAt.toISOString(),
        version: updated.rowVersion,
      });
      const command: ProvisioningCommand = {
        commandId: `poc-${hashText(plan.idempotencyKey).slice(0, 32)}`,
        idempotencyKey: plan.idempotencyKey,
        orderId: poc.id,
        orderVersion: updated.rowVersion,
        organizationId: poc.organizationId,
        operation: "sandbox",
        tenantId: plan.tenantId,
        entitlements: [
          {
            sku: plan.sandboxEntitlement.sku,
            productCode: "poc-sandbox",
            entitlementKind: "sandbox",
            quantity: poc.capacityCap,
            region: "isolated",
          },
        ],
        requestedAt: context.occurredAt,
      };
      const attempt = beginProvisioning(command);
      const [persistedAttempt] = await transaction
        .insert(lifecycleProvisioningAttempts)
        .values({
          commandId: command.commandId,
          accountId: poc.accountId,
          pocId: poc.id,
          organizationId: poc.organizationId,
          operation: "sandbox",
          state: attempt.state,
          attempt,
        })
        .returning();
      if (!persistedAttempt)
        throw new Error("PROVISIONING_ATTEMPT_INSERT_FAILED");
      await transaction.insert(providerOperations).values({
        provider: "provisioning",
        operation: "sandbox",
        idempotencyKey: command.idempotencyKey,
        aggregateType: "poc",
        aggregateId: poc.id,
        status: "pending",
      });
      provisioningCommandId = command.commandId;
    }
    const eventType =
      payload.decision === "approved" ? "poc.approved" : "poc.rejected";
    await appendEvent(transaction, {
      accountId: poc.accountId,
      aggregateType: "poc",
      aggregateId: poc.id,
      aggregateVersion: updated.rowVersion,
      eventType,
      context,
      before: { status: poc.status, rowVersion: poc.rowVersion },
      after: {
        status: updated.status,
        decision: payload.decision,
        reason: payload.reason,
        evidenceDocumentId: evidence.documentId,
        evidenceHash: evidence.sha256,
        provisioningCommandId,
      },
    });
    return result(poc.id, updated.status, eventType, {
      provisioningCommandId,
    });
  }

  private async convertPoc(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = convertPocPayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    const poc = await transaction.query.pocs.findFirst({
      where: and(
        eq(pocs.id, payload.pocId),
        eq(pocs.accountId, payload.accountId),
      ),
    });
    if (!poc) throw new Error("POC_NOT_FOUND");
    const [quote, order, organization, successEvidence, quoteSnapshot] =
      await Promise.all([
        transaction.query.quotes.findFirst({
          where: and(
            eq(quotes.id, payload.quoteId),
            eq(quotes.accountId, payload.accountId),
            eq(quotes.status, "accepted"),
          ),
        }),
        transaction.query.orders.findFirst({
          where: and(
            eq(orders.id, payload.orderId),
            eq(orders.accountId, payload.accountId),
            eq(orders.quoteId, payload.quoteId),
          ),
        }),
        transaction.query.organizations.findFirst({
          where: eq(organizations.id, poc.organizationId),
        }),
        transaction.query.lifecyclePocEvidence.findFirst({
          where: and(
            eq(lifecyclePocEvidence.pocId, poc.id),
            eq(lifecyclePocEvidence.kind, "success_snapshot"),
          ),
          orderBy: [desc(lifecyclePocEvidence.recordedAt)],
        }),
        transaction.query.quoteSnapshots.findFirst({
          where: eq(quoteSnapshots.quoteId, payload.quoteId),
        }),
      ]);
    if (!quote || !order || !organization || !successEvidence || !quoteSnapshot)
      throw new Error("POC_CONVERSION_AUTHORITATIVE_STATE_INCOMPLETE");
    const profile = await transaction.query.orderCommercialProfiles.findFirst({
      where: eq(orderCommercialProfiles.orderId, order.id),
    });
    if (!profile) throw new Error("ORDER_COMMERCIAL_PROFILE_NOT_FOUND");
    const successSnapshot = PocSuccessSnapshotSchema.parse(
      successEvidence.payload,
    );
    const quoteAcceptanceBody = {
      quoteId: quote.id,
      acceptedAt: profile.acceptedAt.toISOString(),
      acceptedBy: order.signerUserId,
      exactQuoteHash: quoteSnapshot.snapshotHash,
    };
    const quoteAcceptance = {
      ...quoteAcceptanceBody,
      evidenceHash: hashPocEvidence(quoteAcceptanceBody),
    };
    const paidLines = await transaction.query.orderLines.findMany({
      where: eq(orderLines.orderId, order.id),
    });
    const persistedEntitlements = await transaction.query.entitlements.findMany(
      {
        where: eq(entitlements.organizationId, organization.id),
      },
    );
    const tenantId = organization.externalProvisioningId ?? organization.id;
    const conversion = convertPocInPlace({
      pocId: poc.id,
      status: z
        .enum([
          "proposed",
          "approved",
          "active",
          "expired",
          "converted",
          "closed",
        ])
        .parse(poc.status),
      successSnapshot,
      quoteId: quote.id,
      quoteAcceptance,
      orderId: order.id,
      organizationId: organization.id,
      tenantId,
      entitlements: persistedEntitlements.map((entitlement) => ({
        entitlementId: entitlement.id,
        sku: entitlement.sku,
        organizationId: entitlement.organizationId,
        tenantId,
        paidSku:
          paidLines.find((line) => line.sku === entitlement.sku)?.sku ??
          entitlement.sku,
      })),
    });
    const [updated] = await transaction
      .update(pocs)
      .set({
        status: conversion.status,
        convertedQuoteId: quote.id,
        updatedAt: this.now(),
        rowVersion: poc.rowVersion + 1,
      })
      .where(and(eq(pocs.id, poc.id), eq(pocs.rowVersion, poc.rowVersion)))
      .returning();
    if (!updated) throw new Error("VERSION_CONFLICT");
    await transaction.insert(lifecyclePocEvidence).values({
      pocId: poc.id,
      kind: "quote_acceptance",
      sourceId: quote.id,
      payload: quoteAcceptance,
      evidenceHash: quoteAcceptance.evidenceHash,
      recordedAt: profile.acceptedAt,
    });
    await appendEvent(transaction, {
      accountId: poc.accountId,
      aggregateType: "poc",
      aggregateId: poc.id,
      aggregateVersion: updated.rowVersion,
      eventType: "poc.converted",
      context,
      before: { status: poc.status, rowVersion: poc.rowVersion },
      after: JsonRecordSchema.parse(conversion),
    });
    return result(poc.id, "converted", "poc.converted", {
      preserveData: conversion.preserveData,
      organizationId: conversion.organizationId,
      tenantId: conversion.tenantId,
    });
  }

  private async recoverProvisioning(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = recoverProvisioningPayloadSchema.parse(raw);
    requireRecentAuthentication(context);
    const row = await transaction.query.lifecycleProvisioningAttempts.findFirst(
      {
        where: eq(lifecycleProvisioningAttempts.commandId, payload.commandId),
      },
    );
    if (!row) throw new Error("PROVISIONING_COMMAND_NOT_FOUND");
    const recovered = recoverDeadLetter(
      ProvisioningAttemptSchema.parse(row.attempt),
      {
        operatorId: userId(context),
        reason: payload.reason,
        recoveredAt: context.occurredAt,
      },
    );
    const [updated] = await transaction
      .update(lifecycleProvisioningAttempts)
      .set({
        state: recovered.state,
        attempt: recovered,
        updatedAt: this.now(),
        rowVersion: row.rowVersion + 1,
      })
      .where(
        and(
          eq(lifecycleProvisioningAttempts.id, row.id),
          eq(lifecycleProvisioningAttempts.rowVersion, row.rowVersion),
        ),
      )
      .returning();
    if (!updated) throw new Error("VERSION_CONFLICT");
    await transaction
      .update(providerOperations)
      .set({
        status: "retrying",
        lastError: null,
        nextAttemptAt: new Date(context.occurredAt),
        updatedAt: this.now(),
        rowVersion: row.rowVersion + 1,
      })
      .where(
        and(
          eq(providerOperations.provider, "provisioning"),
          eq(
            providerOperations.idempotencyKey,
            recovered.command.idempotencyKey,
          ),
        ),
      );
    await appendEvent(transaction, {
      accountId: row.accountId,
      aggregateType: row.pocId ? "poc" : "order",
      aggregateId: row.pocId ?? row.orderId ?? row.id,
      aggregateVersion: updated.rowVersion,
      eventType: "order.provisioning_requested",
      context,
      before: { state: row.state, rowVersion: row.rowVersion },
      after: {
        commandId: row.commandId,
        state: updated.state,
        recoveredBy: userId(context),
        reason: payload.reason,
      },
    });
    return result(updated.id, updated.state, "order.provisioning_requested");
  }

  private async acceptPassThrough(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = acceptPassThroughPayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    if (!context.ip) throw new Error("PASS_THROUGH_EVIDENCE_INCOMPLETE");
    const acceptingUserId = userId(context);
    const [template, organization, membership] = await Promise.all([
      transaction.query.agreementTemplates.findFirst({
        where: and(
          eq(agreementTemplates.id, payload.templateId),
          eq(agreementTemplates.semanticVersion, payload.templateVersion),
          eq(agreementTemplates.approvalStatus, "approved"),
        ),
      }),
      transaction.query.organizations.findFirst({
        where: and(
          eq(organizations.id, payload.organizationId),
          eq(organizations.accountId, payload.accountId),
        ),
      }),
      transaction
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(
          organizations,
          eq(organizations.id, memberships.organizationId),
        )
        .where(
          and(
            eq(memberships.userId, acceptingUserId),
            eq(organizations.accountId, payload.accountId),
          ),
        )
        .limit(1),
    ]);
    if (!template || !organization || membership.length !== 1)
      throw new Error("PASS_THROUGH_SCOPE_NOT_FOUND");
    if (template.textHash !== payload.exactTextHash)
      throw new Error("PASS_THROUGH_TEXT_MISMATCH");
    const resaleEntitlement = await transaction
      .select({ orderId: orders.id })
      .from(entitlements)
      .innerJoin(orders, eq(orders.id, entitlements.orderId))
      .where(
        and(
          eq(entitlements.organizationId, organization.id),
          eq(orders.sourcing, "resale"),
        ),
      )
      .limit(1);
    if (resaleEntitlement.length !== 1) throw new Error("RESALE_PATH_REQUIRED");
    const presentation = presentPassThroughTerms({
      sourcing: "resale",
      firstLogin: true,
      acceptedVersion: null,
      templateId: template.id,
      templateVersion: template.semanticVersion,
      exactTextHash: template.textHash,
      productOrganizationId: organization.id,
      serviceName: "Fil One",
      endClientAccountId: payload.accountId,
    });
    if (!presentation) throw new Error("PASS_THROUGH_PRESENTATION_REQUIRED");
    const accepted = acceptPassThroughTerms({
      presentation,
      userId: acceptingUserId,
      acceptedHash: payload.exactTextHash,
      acceptedAt: context.occurredAt,
      ip: context.ip,
    });
    const evidenceHash = hashEvidence({
      ...accepted,
      uiContext: payload.uiContext,
    });
    const [row] = await transaction
      .insert(lifecyclePassThroughAcceptances)
      .values({
        accountId: payload.accountId,
        organizationId: organization.id,
        templateId: template.id,
        templateVersion: template.semanticVersion,
        exactTextHash: template.textHash,
        userId: acceptingUserId,
        acceptedAt: new Date(context.occurredAt),
        acceptedIp: context.ip,
        uiContext: payload.uiContext,
        evidenceHash,
      })
      .returning();
    if (!row) throw new Error("PASS_THROUGH_ACCEPTANCE_INSERT_FAILED");
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "agreement",
      aggregateId: row.id,
      aggregateVersion: 1,
      eventType: "agreement.pass_through_terms_accepted",
      context,
      after: {
        acceptanceId: row.id,
        organizationId: row.organizationId,
        templateId: row.templateId,
        templateVersion: row.templateVersion,
        evidenceHash: row.evidenceHash,
      },
    });
    return result(row.id, "accepted", "agreement.pass_through_terms_accepted", {
      evidenceHash,
    });
  }

  private async recordInboundNotice(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = recordInboundNoticePayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    const order = await transaction.query.orders.findFirst({
      where: and(
        eq(orders.id, payload.orderId),
        eq(orders.accountId, payload.accountId),
      ),
    });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    const evidence = await immutableEvidence(
      transaction,
      payload.evidenceDocumentId,
      payload.accountId,
    );
    const noticeId = uuidV7();
    const deliveryChannel = z.enum(["portal", "email", "post", "other"]).parse(
      {
        portal: "portal",
        email: "email",
        mail: "post",
        esign: "other",
      }[payload.source],
    );
    const immutableNotice =
      payload.type === "other"
        ? {
            noticeId,
            accountId: payload.accountId,
            orderId: payload.orderId,
            type: payload.type,
            servedOn: payload.servedOn,
            receivedAt: context.occurredAt,
            recordedByUserId: userId(context),
            deliveryChannel,
            evidence,
            immutableHash: hashEvidence({
              noticeId,
              accountId: payload.accountId,
              orderId: payload.orderId,
              type: payload.type,
              servedOn: payload.servedOn,
              receivedAt: context.occurredAt,
              recordedByUserId: userId(context),
              deliveryChannel,
              evidence,
            }),
          }
        : recordInboundNotice({
            noticeId,
            accountId: payload.accountId,
            orderId: payload.orderId,
            type: payload.type,
            servedOn: payload.servedOn,
            receivedAt: context.occurredAt,
            recordedByUserId: userId(context),
            deliveryChannel,
            evidence,
          });
    const [row] = await transaction
      .insert(inboundNotices)
      .values({
        id: noticeId,
        accountId: payload.accountId,
        orderId: payload.orderId,
        type: payload.type,
        servedOn: payload.servedOn,
        evidenceDocumentId: payload.evidenceDocumentId,
        recordedBy: userId(context),
      })
      .returning();
    if (!row) throw new Error("INBOUND_NOTICE_INSERT_FAILED");
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "inbound_notice",
      aggregateId: row.id,
      aggregateVersion: row.version,
      eventType: "inbound_notice.recorded",
      context,
      after: JsonRecordSchema.parse(immutableNotice),
    });
    return result(row.id, "recorded", "inbound_notice.recorded", {
      immutableHash: immutableNotice.immutableHash,
    });
  }

  private async renewalCommandCenter(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = renewalCommandCenterPayloadSchema.parse(raw);
    const authorization = requireAuthorization(context);
    if (payload.accountId) assertAccountScope(context, payload.accountId);
    const visibleAccountIds = payload.accountId
      ? [payload.accountId]
      : authorization.accountIds;
    const persistedOrders =
      visibleAccountIds.length === 0
        ? []
        : await transaction.query.orders.findMany({
            where: and(
              or(
                inArray(orders.accountId, visibleAccountIds),
                inArray(orders.partnerAccountId, visibleAccountIds),
              ),
              isNotNull(orders.serviceEndsOn),
            ),
            orderBy: [asc(orders.serviceEndsOn)],
          });
    const items: Parameters<
      typeof buildRenewalCommandCenter
    >[0]["items"][number][] = [];
    for (const persisted of persistedOrders) {
      if (!persisted.serviceEndsOn) continue;
      const renewable = await this.renewableOrder(transaction, persisted.id);
      const openSupportIssueCount = await transaction
        .select({ id: exceptionCases.id })
        .from(exceptionCases)
        .where(
          and(
            eq(exceptionCases.accountId, persisted.accountId),
            eq(exceptionCases.status, "open"),
          ),
        );
      const overdue = await transaction.query.invoices.findMany({
        where: and(
          eq(invoices.orderId, persisted.id),
          eq(invoices.status, "open"),
          lte(invoices.dueAt, this.now()),
        ),
      });
      const overdueInvoiceDays = overdue.reduce((maximum, invoice) => {
        if (!invoice.dueAt) return maximum;
        return Math.max(
          maximum,
          Math.floor(
            (this.now().getTime() - invoice.dueAt.getTime()) / 86_400_000,
          ),
        );
      }, 0);
      const unresolvedNotice = Boolean(
        await transaction.query.inboundNotices.findFirst({
          where: and(
            eq(inboundNotices.orderId, persisted.id),
            inArray(inboundNotices.type, ["non_renewal", "termination"]),
          ),
        }),
      );
      const lastAction =
        await transaction.query.lifecycleRenewalActions.findFirst({
          where: eq(lifecycleRenewalActions.orderId, persisted.id),
          orderBy: [desc(lifecycleRenewalActions.createdAt)],
        });
      items.push({
        order: renewable,
        segment:
          persisted.sourcing === "direct"
            ? "direct"
            : persisted.partnerAccountId === persisted.accountId
              ? "partner_agreement"
              : "partner_sourced",
        signals: {
          openSupportIssueCount: openSupportIssueCount.length,
          highestSupportSeverity:
            openSupportIssueCount.length > 0 ? "medium" : "none",
          usageChangeBasisPoints: 0,
          overdueInvoiceDays,
          portalInactivityDays: 0,
          partnerHasActed:
            persisted.sourcing === "direct" ? null : Boolean(lastAction),
          unresolvedNotice,
        },
        lastTouchAt: lastAction?.createdAt.toISOString() ?? null,
        status:
          lastAction?.action === "decline"
            ? "declined"
            : overdueInvoiceDays > 0 || unresolvedNotice
              ? "at_risk"
              : lastAction
                ? "contacted"
                : "uncontacted",
      });
    }
    const rows = buildRenewalCommandCenter({
      asOfDate: localIsoDate(this.now(), payload.timeZone),
      items,
    });
    const filtered = rows.filter((row) => {
      if (payload.window === "all") return true;
      if (payload.window === "30") return row.daysToExpiry <= 30;
      if (payload.window === "60_90")
        return row.daysToExpiry >= 60 && row.daysToExpiry <= 90;
      return row.daysToExpiry <= 180;
    });
    return result("renewals", "ready", undefined, { items: filtered });
  }

  private async requestRenewal(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = requestRenewalPayloadSchema.parse(raw);
    const renewable = await this.renewableOrder(transaction, payload.orderId);
    if (renewable.accountId !== payload.accountId)
      throw new Error("RENEWAL_REQUEST_SCOPE_NOT_FOUND");
    const authorityAccountId =
      renewable.notificationPath === "partner" && renewable.partnerAccountId
        ? renewable.partnerAccountId
        : payload.accountId;
    assertAccountScope(context, authorityAccountId);
    const requestedTermMonths =
      payload.requestedTermMonths ??
      Math.max(
        1,
        Math.round(
          (Date.parse(`${renewable.endsOn}T00:00:00Z`) -
            Date.parse(`${renewable.startsOn}T00:00:00Z`)) /
            (30.436875 * 86_400_000),
        ),
      );
    const proposedEnd = new Date(`${renewable.endsOn}T00:00:00Z`);
    proposedEnd.setUTCMonth(proposedEnd.getUTCMonth() + requestedTermMonths);
    const renewal = prepopulateRenewalRequest({
      requestId: uuidV7(),
      order: renewable,
      proposedEndsOn: proposedEnd.toISOString().slice(0, 10),
      requestedAction: payload.requestedAction,
      createdAt: context.occurredAt,
    });
    const evidenceHash = hashEvidence(renewal);
    const [row] = await transaction
      .insert(lifecycleRenewalActions)
      .values({
        orderId: payload.orderId,
        accountId: payload.accountId,
        action: payload.requestedAction,
        actorUserId: userId(context),
        payload: renewal,
        evidenceHash,
      })
      .returning();
    if (!row) throw new Error("RENEWAL_ACTION_INSERT_FAILED");
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "order",
      aggregateId: payload.orderId,
      aggregateVersion: await this.bumpOrderVersion(
        transaction,
        payload.orderId,
        renewable.rowVersion,
      ),
      eventType: "renewal.requested",
      context,
      after: {
        renewalActionId: row.id,
        requestedAction: renewal.requestedAction,
        proposedStartsOn: renewal.proposedStartsOn,
        proposedEndsOn: renewal.proposedEndsOn,
        sourceOrderVersion: renewal.sourceOrderVersion,
        evidenceHash,
      },
    });
    return result(row.id, "requested", "renewal.requested");
  }

  private async declineRenewal(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = declineRenewalPayloadSchema.parse(raw);
    if (!context.ip || !context.userAgent)
      throw new Error("RENEWAL_DECLINE_NETWORK_EVIDENCE_REQUIRED");
    const renewable = await this.renewableOrder(transaction, payload.orderId);
    if (renewable.accountId !== payload.accountId)
      throw new Error("RENEWAL_DECLINE_SCOPE_NOT_FOUND");
    const authorityAccountId =
      renewable.notificationPath === "partner" && renewable.partnerAccountId
        ? renewable.partnerAccountId
        : payload.accountId;
    assertAccountScope(context, authorityAccountId);
    const [account, currentUser, evidence] = await Promise.all([
      transaction.query.accounts.findFirst({
        where: eq(accounts.id, authorityAccountId),
      }),
      transaction.query.commerceUsers.findFirst({
        where: eq(commerceUsers.id, userId(context)),
      }),
      immutableEvidence(
        transaction,
        payload.evidenceDocumentId,
        authorityAccountId,
      ),
    ]);
    if (!account || !currentUser)
      throw new Error("RENEWAL_DECLINE_SCOPE_NOT_FOUND");
    const role = requireAuthorization(context).roles[0];
    if (!role) throw new Error("RENEWAL_DECLINE_ROLE_REQUIRED");
    const decline = recordRenewalDecline({
      declineId: uuidV7(),
      order: renewable,
      legalEntityName: account.legalName,
      userId: currentUser.id,
      email: currentUser.email,
      role,
      authorityTitle: payload.authorityTitle,
      authorityAttested: payload.authorityAttested,
      declinedAt: context.occurredAt,
      ipAddress: context.ip,
      uiContext: {
        route: `/v1/lifecycle/renewals/${payload.orderId}/declines`,
        action: "decline_renewal",
        sessionId: context.requestId,
        requestId: context.requestId,
        userAgent: context.userAgent,
      },
      exactDeclineText: `Decline renewal of order ${payload.orderId}: ${payload.reason}`,
    });
    const [row] = await transaction
      .insert(lifecycleRenewalActions)
      .values({
        id: decline.declineId,
        orderId: payload.orderId,
        accountId: payload.accountId,
        action: "decline",
        actorUserId: currentUser.id,
        evidenceDocumentId: evidence.documentId,
        payload: decline,
        evidenceHash: decline.evidenceHash,
      })
      .returning();
    if (!row) throw new Error("RENEWAL_DECLINE_INSERT_FAILED");
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "order",
      aggregateId: payload.orderId,
      aggregateVersion: await this.bumpOrderVersion(
        transaction,
        payload.orderId,
        renewable.rowVersion,
      ),
      eventType: "renewal.declined",
      context,
      after: {
        declineId: row.id,
        evidenceHash: decline.evidenceHash,
        timeliness: decline.timeliness,
        servedOn: decline.servedOn,
      },
    });
    const offboarding = await this.requestTermination(
      transaction,
      {
        accountId: payload.accountId,
        orderId: payload.orderId,
        reason: "non_renewal",
        effectiveAt: `${renewable.endsOn}T00:00:00.000Z`,
        retrievalDays: 30,
        partnerAccountId: renewable.partnerAccountId,
      },
      context,
      true,
    );
    return result(row.id, "declined", "renewal.declined", {
      timeliness: decline.timeliness,
      terminationId: offboarding.id,
    });
  }

  private async requestTermination(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
    authorityAlreadyCaptured = false,
  ) {
    const payload = requestTerminationPayloadSchema.parse(raw);
    if (!authorityAlreadyCaptured) requireRecentAuthentication(context);
    const [order] = await transaction
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, payload.orderId),
          eq(orders.accountId, payload.accountId),
        ),
      )
      .for("update");
    if (!order) throw new Error("ORDER_NOT_FOUND");
    assertRecoverableOffboardingSourceStatus(order.status);
    const priorTerminations = await transaction.query.terminations.findMany({
      where: eq(terminations.orderId, order.id),
    });
    if (
      priorTerminations.some(
        (termination) => termination.teardownStatus !== "complete",
      )
    )
      throw new Error("ORDER_OFFBOARDING_ALREADY_OPEN");
    const partnerAuthority =
      payload.reason === "partner_request" ||
      (authorityAlreadyCaptured && payload.partnerAccountId !== null);
    if (partnerAuthority) {
      if (!payload.partnerAccountId)
        throw new Error("PARTNER_ACCOUNT_REQUIRED");
      authorizePartnerInitiation({
        sourcing:
          order.sourcing === "distributor"
            ? "resale"
            : z.enum(["direct", "referral", "resale"]).parse(order.sourcing),
        orderPartnerAccountId: order.partnerAccountId,
        actorPartnerAccountId: payload.partnerAccountId,
      });
      assertAccountScope(context, payload.partnerAccountId);
    } else assertAccountScope(context, payload.accountId);
    const organization = await transaction
      .select({ id: organizations.id })
      .from(entitlements)
      .innerJoin(
        organizations,
        eq(organizations.id, entitlements.organizationId),
      )
      .where(eq(entitlements.orderId, order.id))
      .limit(1);
    const fallbackOrganization =
      organization[0] ??
      (await transaction.query.organizations.findFirst({
        where: eq(organizations.accountId, payload.accountId),
        orderBy: [asc(organizations.createdAt)],
      }));
    if (!fallbackOrganization) throw new Error("ORGANIZATION_NOT_FOUND");
    const [openInvoices, retainedDocuments, retainedEntitlements] =
      await Promise.all([
        transaction.query.invoices.findMany({
          where: and(
            eq(invoices.orderId, order.id),
            inArray(invoices.status, ["draft", "open"]),
          ),
        }),
        transaction.query.documents.findMany({
          where: eq(documents.accountId, payload.accountId),
        }),
        transaction.query.entitlements.findMany({
          where: and(
            eq(entitlements.orderId, order.id),
            gt(entitlements.maximumRetentionAt, this.now()),
          ),
        }),
      ]);
    const terminationId = uuidV7();
    const plan = planOffboarding({
      terminationId,
      accountId: payload.accountId,
      orderId: order.id,
      organizationId: fallbackOrganization.id,
      reason: payload.reason,
      requestedBy: userId(context),
      effectiveAt: payload.effectiveAt,
      finalBillingStatus: openInvoices.length === 0 ? "settled" : "pending",
      retrievalDays: payload.retrievalDays,
      retainedObjects: [
        ...retainedDocuments.map((document) => ({
          objectId: document.id,
          scope: `document:${document.kind}`,
          retainUntil: document.retainUntil.toISOString(),
          legalHold: document.legalHold,
          reason: document.legalHold
            ? ("legal_hold" as const)
            : ("object_lock_retention" as const),
        })),
        ...retainedEntitlements.flatMap((entitlement) =>
          entitlement.maximumRetentionAt
            ? [
                {
                  objectId: entitlement.id,
                  scope: `entitlement:${entitlement.sku}`,
                  retainUntil: entitlement.maximumRetentionAt.toISOString(),
                  legalHold: false,
                  reason: "object_lock_retention" as const,
                },
              ]
            : [],
        ),
      ],
      now: context.occurredAt,
    });
    const [termination] = await transaction
      .insert(terminations)
      .values({
        id: terminationId,
        accountId: payload.accountId,
        orderId: order.id,
        effectiveAt: new Date(payload.effectiveAt),
        finalBillingStatus: plan.finalBillingStatus,
        teardownStatus: plan.status,
        deletionScheduledAt: plan.deletionScheduledAt
          ? new Date(plan.deletionScheduledAt)
          : null,
      })
      .returning();
    if (!termination) throw new Error("TERMINATION_INSERT_FAILED");
    await transaction.insert(lifecycleOffboardingPlans).values({
      terminationId,
      accountId: payload.accountId,
      organizationId: plan.organizationId,
      requestedBy: userId(context),
      reason: plan.reason,
      plan,
    });
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "termination",
      aggregateId: termination.id,
      aggregateVersion: termination.rowVersion,
      eventType: "termination.requested",
      context,
      after: {
        terminationId: termination.id,
        orderId: order.id,
        status: plan.status,
        finalBillingStatus: plan.finalBillingStatus,
        retrievalEndsAt: plan.retrievalEndsAt,
        maximumRetentionAt: plan.maximumRetentionAt,
        deletionScheduledAt: plan.deletionScheduledAt,
        retainedObjectIds: plan.lockedExclusions.map((item) => item.objectId),
      },
    });
    return result(termination.id, plan.status, "termination.requested");
  }

  private async decideTermination(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = decideTerminationPayloadSchema.parse(raw);
    requireRecentAuthentication(context);
    const persisted =
      await transaction.query.lifecycleOffboardingPlans.findFirst({
        where: eq(
          lifecycleOffboardingPlans.terminationId,
          payload.terminationId,
        ),
      });
    if (!persisted) throw new Error("TERMINATION_NOT_FOUND");
    assertAccountScope(context, persisted.accountId);
    const evidence = await immutableEvidence(
      transaction,
      payload.evidenceDocumentId,
      persisted.accountId,
    );
    const persistedPlan = OffboardingPlanSchema.parse(persisted.plan);
    const [billingOrder] = await transaction
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.id, persistedPlan.orderId),
          eq(orders.accountId, persisted.accountId),
        ),
      )
      .for("update");
    if (!billingOrder) throw new Error("ORDER_NOT_FOUND");
    const unsettledInvoices = await transaction
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.orderId, persistedPlan.orderId),
          inArray(invoices.status, ["draft", "open"]),
        ),
      )
      .for("update");
    const currentPlan: OffboardingPlan =
      persistedPlan.finalBillingStatus === "credit_due"
        ? persistedPlan
        : {
            ...persistedPlan,
            finalBillingStatus:
              unsettledInvoices.length === 0 ? "settled" : "pending",
          };
    const approverId = userId(context);
    const approvalId = uuidV7();
    const authenticationEvidenceHash = hashEvidence({
      requestId: context.requestId,
      userId: approverId,
      recentAuthenticationVerified: true,
      occurredAt: context.occurredAt,
    });
    let plan = recordDestructiveApproval(currentPlan, {
      approvalId,
      approverId,
      decision: payload.decision,
      reason: payload.reason,
      decidedAt: context.occurredAt,
      evidenceHash: evidence.sha256,
      recentAuthentication: {
        authenticatedAt: context.occurredAt,
        evidenceHash: authenticationEvidenceHash,
      },
    });
    await transaction.insert(approvals).values({
      id: approvalId,
      accountId: persisted.accountId,
      action: "termination_teardown",
      objectType: "termination",
      objectId: payload.terminationId,
      requestedBy: persisted.requestedBy,
      approvedBy: approverId,
      status: payload.decision,
      requestedAt: new Date(currentPlan.effectiveAt),
      decidedAt: new Date(context.occurredAt),
    });
    let provisioningCommandId: string | undefined;
    const automatedTeardownAuthorized =
      this.options.policies.automatedTeardownEnabled &&
      (await this.capabilityEnabled(transaction, "teardown"));
    if (
      plan.status === "ready_for_teardown" &&
      automatedTeardownAuthorized &&
      Date.parse(context.occurredAt) >= Date.parse(plan.retrievalEndsAt)
    ) {
      const teardown = requestTeardown(plan, {
        automatedTeardownAuthorized: true,
        now: context.occurredAt,
      });
      plan = teardown.plan;
      const command: ProvisioningCommand = {
        commandId: `teardown-${hashText(teardown.command.idempotencyKey).slice(0, 32)}`,
        idempotencyKey: teardown.command.idempotencyKey,
        orderId: plan.orderId,
        orderVersion: 1,
        organizationId: plan.organizationId,
        operation: "teardown",
        tenantId: null,
        entitlements: [],
        requestedAt: context.occurredAt,
      };
      const attempt = beginProvisioning(command);
      const [attemptRow] = await transaction
        .insert(lifecycleProvisioningAttempts)
        .values({
          commandId: command.commandId,
          accountId: persisted.accountId,
          orderId: plan.orderId,
          organizationId: plan.organizationId,
          operation: "teardown",
          state: attempt.state,
          attempt,
        })
        .returning();
      if (!attemptRow) throw new Error("TEARDOWN_ATTEMPT_INSERT_FAILED");
      await transaction.insert(providerOperations).values({
        provider: "provisioning",
        operation: "teardown",
        idempotencyKey: command.idempotencyKey,
        aggregateType: "termination",
        aggregateId: payload.terminationId,
        status: "pending",
      });
      provisioningCommandId = command.commandId;
    }
    const nextVersion = persisted.rowVersion + 1;
    const [updatedPlan] = await transaction
      .update(lifecycleOffboardingPlans)
      .set({
        plan,
        updatedAt: this.now(),
        rowVersion: nextVersion,
      })
      .where(
        and(
          eq(lifecycleOffboardingPlans.terminationId, payload.terminationId),
          eq(lifecycleOffboardingPlans.rowVersion, persisted.rowVersion),
        ),
      )
      .returning();
    if (!updatedPlan) throw new Error("VERSION_CONFLICT");
    const [termination] = await transaction
      .update(terminations)
      .set({
        teardownStatus: plan.status,
        finalBillingStatus: plan.finalBillingStatus,
        updatedAt: this.now(),
        rowVersion: nextVersion,
      })
      .where(
        and(
          eq(terminations.id, payload.terminationId),
          eq(terminations.rowVersion, persisted.rowVersion),
        ),
      )
      .returning();
    if (!termination) throw new Error("VERSION_CONFLICT");
    const eventType =
      payload.decision === "approved"
        ? "termination.approved"
        : "termination.rejected";
    await appendEvent(transaction, {
      accountId: persisted.accountId,
      aggregateType: "termination",
      aggregateId: payload.terminationId,
      aggregateVersion: nextVersion,
      eventType,
      context,
      before: {
        status: currentPlan.status,
        approvals: currentPlan.approvals.length,
        finalBillingStatus: persistedPlan.finalBillingStatus,
      },
      after: {
        status: plan.status,
        finalBillingStatus: plan.finalBillingStatus,
        approvalId,
        decision: payload.decision,
        approverId,
        approvalCount: plan.approvals.length,
        evidenceDocumentId: evidence.documentId,
        evidenceHash: evidence.sha256,
        authenticationEvidenceHash,
        provisioningCommandId,
      },
    });
    return result(payload.terminationId, plan.status, eventType, {
      provisioningCommandId,
    });
  }

  private async createNovation(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = createNovationPayloadSchema.parse(raw);
    requireRecentAuthentication(context);
    assertAccountScope(context, payload.accountId);
    const [sourceOrder, newOrder, newAgreement] = await Promise.all([
      transaction.query.orders.findFirst({
        where: and(
          eq(orders.id, payload.sourceOrderId),
          eq(orders.accountId, payload.accountId),
        ),
      }),
      transaction.query.orders.findFirst({
        where: and(
          eq(orders.id, payload.newOrderId),
          eq(orders.accountId, payload.accountId),
        ),
      }),
      transaction.query.agreements.findFirst({
        where: and(
          eq(agreements.id, payload.newAgreementId),
          eq(agreements.accountId, payload.accountId),
          eq(agreements.status, "active"),
        ),
      }),
    ]);
    if (!sourceOrder || !newOrder || !newAgreement)
      throw new Error("NOVATION_CHAIN_NOT_FOUND");
    if (
      sourceOrder.partnerAccountId !== payload.formerPartnerAccountId ||
      sourceOrder.sourcing !== "resale" ||
      newOrder.partnerAccountId !== null
    )
      throw new Error("NOVATION_BILLING_CHAIN_INVALID");
    const resources = await transaction
      .select({
        organizationId: entitlements.organizationId,
        resourceId: entitlements.provisionedResourceId,
      })
      .from(entitlements)
      .where(eq(entitlements.orderId, sourceOrder.id));
    const resourceIds = resources.flatMap((item) =>
      item.resourceId ? [item.resourceId] : [],
    );
    const organizationId = resources[0]?.organizationId;
    if (!organizationId) throw new Error("NOVATION_ORGANIZATION_NOT_FOUND");
    const organization = await transaction.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
    });
    if (!organization) throw new Error("NOVATION_ORGANIZATION_NOT_FOUND");
    const plan = createNovationPlan({
      formerPartnerAccountId: payload.formerPartnerAccountId,
      endClientAccountId: payload.accountId,
      sourceOrderId: sourceOrder.id,
      newAgreementId: newAgreement.id,
      newOrderId: newOrder.id,
      organizationId,
      tenantId: organization.externalProvisioningId ?? organization.id,
      resourceIds,
      reason: payload.reason,
    });
    const [novation] = await transaction
      .insert(novations)
      .values({
        accountId: payload.accountId,
        formerPartnerAccountId: payload.formerPartnerAccountId,
        sourceOrderId: payload.sourceOrderId,
        newAgreementId: payload.newAgreementId,
        newOrderId: payload.newOrderId,
        reason: payload.reason,
        continuityConfirmedAt: new Date(context.occurredAt),
      })
      .returning();
    if (!novation) throw new Error("NOVATION_INSERT_FAILED");
    await appendEvent(transaction, {
      accountId: payload.accountId,
      aggregateType: "novation",
      aggregateId: novation.id,
      aggregateVersion: novation.version,
      eventType: "novation.completed",
      context,
      after: JsonRecordSchema.parse(plan),
    });
    return result(novation.id, "completed", "novation.completed", {
      organizationId: plan.organizationId,
      tenantId: plan.tenantId,
    });
  }

  private async openException(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = openExceptionPayloadSchema.parse(raw);
    const authoritativeAccountId =
      payload.accountId ??
      (await this.resolveObjectAccount(
        transaction,
        payload.objectType,
        payload.objectId,
      ));
    if (!authoritativeAccountId)
      throw new Error("EXCEPTION_ACCOUNT_SCOPE_REQUIRED");
    assertAccountScope(context, authoritativeAccountId);
    const evidence = await immutableEvidence(
      transaction,
      payload.evidenceDocumentId,
      authoritativeAccountId,
    );
    const caseId = uuidV7();
    const requestedBy = userId(context);
    const routed = this.exceptionRouting
      ? await this.exceptionRouting.resolve({
          queue: payload.queue,
          aggregateId: payload.objectId,
          occurredAt: context.occurredAt,
          severity: "blocking",
          requestedBy,
        })
      : undefined;
    if (
      routed &&
      (routed.accountId !== authoritativeAccountId ||
        routed.objectType !== payload.objectType)
    )
      throw new Error("EXCEPTION_AUTHORITATIVE_ROUTING_MISMATCH");
    const exceptionCase = routed
      ? {
          caseId,
          queue: payload.queue,
          objectType: payload.objectType,
          objectId: payload.objectId,
          requestedBy,
          ownerId: routed.ownerUserId,
          backupId: routed.backupUserId,
          escalationOwnerId: routed.escalationUserId,
          openedAt: context.occurredAt,
          targetAt: routed.targetAt,
          status: "open" as const,
          separationRequired: true,
          escalationLevel: 0,
          decisions: [],
        }
      : openExceptionCase({
          caseId,
          queue: payload.queue,
          objectType: payload.objectType,
          objectId: payload.objectId,
          requestedBy,
          openedAt: context.occurredAt,
          policies: this.queuePolicies,
        });
    const [row] = await transaction
      .insert(exceptionCases)
      .values({
        id: caseId,
        accountId: authoritativeAccountId,
        queue: exceptionCase.queue,
        objectType: exceptionCase.objectType,
        objectId: exceptionCase.objectId,
        ownerUserId: exceptionCase.ownerId,
        backupUserId: exceptionCase.backupId,
        requesterUserId: exceptionCase.requestedBy,
        escalationOwnerUserId: exceptionCase.escalationOwnerId,
        separationRequired: exceptionCase.separationRequired,
        ownershipRosterEntryIds: [...(routed?.rosterEntryIds ?? [])],
        ownershipAbsenceEscalated: routed?.absenceEscalated ?? false,
        targetAt: new Date(exceptionCase.targetAt),
        status: exceptionCase.status,
      })
      .returning();
    if (!row) throw new Error("EXCEPTION_CASE_INSERT_FAILED");
    await appendEvent(transaction, {
      accountId: authoritativeAccountId,
      aggregateType: "exception_case",
      aggregateId: row.id,
      aggregateVersion: row.rowVersion,
      eventType: "exception_case.opened",
      context,
      after: {
        caseId: row.id,
        queue: row.queue,
        objectType: row.objectType,
        objectId: row.objectId,
        requestedBy: exceptionCase.requestedBy,
        ownerId: row.ownerUserId,
        backupId: row.backupUserId,
        escalationOwnerId: exceptionCase.escalationOwnerId,
        ownershipRosterEntryIds: routed?.rosterEntryIds ?? [],
        ownershipAbsenceEscalated: routed?.absenceEscalated ?? false,
        targetAt: row.targetAt.toISOString(),
        reason: payload.reason,
        evidenceDocumentId: evidence.documentId,
        evidenceHash: evidence.sha256,
      },
    });
    return result(row.id, "open", "exception_case.opened");
  }

  private async decideException(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = decideExceptionPayloadSchema.parse(raw);
    const row = await transaction.query.exceptionCases.findFirst({
      where: eq(exceptionCases.id, payload.caseId),
    });
    if (!row) throw new Error("EXCEPTION_CASE_NOT_FOUND");
    if (row.queue !== payload.queue || row.accountId !== payload.accountId)
      throw new Error("EXCEPTION_SCOPE_MISMATCH");
    assertAccountScope(context, row.accountId);
    const evidence = await immutableEvidence(
      transaction,
      payload.evidenceDocumentId,
      row.accountId,
    );
    const policy = this.queuePolicies.get(payload.queue);
    const backupId = row.backupUserId ?? policy?.backupId;
    const escalationOwnerId =
      row.escalationOwnerUserId ?? policy?.escalationOwnerId;
    if (!backupId || !escalationOwnerId)
      throw new Error(`EXCEPTION_PERSISTED_OWNERSHIP_MISSING:${payload.queue}`);
    const exceptionCase = {
      caseId: row.id,
      queue: payload.queue,
      objectType: row.objectType,
      objectId: row.objectId,
      requestedBy:
        row.requesterUserId ??
        (await this.exceptionRequester(transaction, row.id)),
      ownerId: row.ownerUserId,
      backupId,
      escalationOwnerId,
      openedAt: row.createdAt.toISOString(),
      targetAt: row.targetAt.toISOString(),
      status: z
        .enum(["open", "approved", "rejected", "closed"])
        .parse(row.status),
      separationRequired: row.separationRequired,
      escalationLevel: 0,
      decisions: [],
    };
    const decided = decideException(exceptionCase, {
      actorId: userId(context),
      outcome: payload.decision,
      reason: payload.reason,
      evidenceDocumentId: evidence.documentId,
      evidenceBytes: Buffer.from(evidence.sha256, "hex"),
      decidedAt: context.occurredAt,
    });
    const [updated] = await transaction
      .update(exceptionCases)
      .set({
        status: decided.status,
        decisionReason: payload.reason,
        updatedAt: this.now(),
        rowVersion: row.rowVersion + 1,
      })
      .where(
        and(
          eq(exceptionCases.id, row.id),
          eq(exceptionCases.rowVersion, row.rowVersion),
          eq(exceptionCases.status, "open"),
        ),
      )
      .returning();
    if (!updated) throw new Error("VERSION_CONFLICT");
    const decision = decided.decisions[0];
    if (!decision) throw new Error("EXCEPTION_DECISION_MISSING");
    await appendEvent(transaction, {
      accountId: row.accountId,
      aggregateType: "exception_case",
      aggregateId: row.id,
      aggregateVersion: updated.rowVersion,
      eventType: "exception_case.decided",
      context,
      before: { status: row.status, rowVersion: row.rowVersion },
      after: {
        status: updated.status,
        decisionId: decision.decisionId,
        actorId: decision.actorId,
        reason: decision.reason,
        evidenceDocumentId: evidence.documentId,
        evidenceHash: decision.evidenceHash,
        decidedAt: decision.decidedAt,
      },
    });
    return result(row.id, updated.status, "exception_case.decided");
  }

  private async listSupportSignals(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = listSupportSignalsPayloadSchema.parse(raw);
    assertAccountScope(context, payload.accountId);
    const since = payload.since ? new Date(payload.since) : new Date(0);
    const [exceptions, overdueInvoices, accountPocs, recentNotices] =
      await Promise.all([
        transaction.query.exceptionCases.findMany({
          where: and(
            eq(exceptionCases.accountId, payload.accountId),
            gt(exceptionCases.createdAt, since),
          ),
        }),
        transaction.query.invoices.findMany({
          where: and(
            eq(invoices.accountId, payload.accountId),
            eq(invoices.status, "open"),
            lte(invoices.dueAt, this.now()),
          ),
        }),
        transaction.query.pocs.findMany({
          where: and(
            eq(pocs.accountId, payload.accountId),
            gt(pocs.updatedAt, since),
          ),
        }),
        transaction.query.inboundNotices.findMany({
          where: and(
            eq(inboundNotices.accountId, payload.accountId),
            gt(inboundNotices.createdAt, since),
          ),
        }),
      ]);
    return result(payload.accountId, "ready", undefined, {
      sourceRecordIds: {
        exceptionCaseIds: exceptions.map((item) => item.id),
        invoiceIds: overdueInvoices.map((item) => item.id),
        pocIds: accountPocs.map((item) => item.id),
        noticeIds: recentNotices.map((item) => item.id),
      },
      openExceptionCount: exceptions.filter((item) => item.status === "open")
        .length,
      overdueInvoiceCount: overdueInvoices.length,
      activePocCount: accountPocs.filter((item) => item.status === "active")
        .length,
      inboundNoticeCount: recentNotices.length,
    });
  }

  private async startMigration(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = startMigrationPayloadSchema.parse(raw);
    requireRecentAuthentication(context);
    if (payload.resumeRunId) {
      const existing = await transaction.query.lifecycleMigrationRuns.findFirst(
        {
          where: eq(lifecycleMigrationRuns.id, payload.resumeRunId),
        },
      );
      if (
        !existing ||
        existing.sourceSnapshotHash !== payload.sourceSnapshotHash ||
        existing.executionMode !== payload.executionMode
      )
        throw new Error("MIGRATION_RESUME_BINDING_MISMATCH");
      return result(existing.id, existing.status, undefined, { resumed: true });
    }
    const sourcePort = this.options.migrationSource;
    if (!sourcePort) throw new Error("MIGRATION_SOURCE_ADAPTER_REQUIRED");
    const source = await sourcePort.load({
      sourceSnapshotHash: payload.sourceSnapshotHash,
      executionMode: payload.executionMode,
      requestId: context.requestId,
    });
    if (
      createHash("sha256").update(source.sourceBytes).digest("hex") !==
      payload.sourceSnapshotHash
    )
      throw new Error("MIGRATION_SOURCE_SNAPSHOT_MISMATCH");
    const requesterId = userId(context);
    const gate = `existing_customer_migration:${payload.sourceSnapshotHash}`;
    const approvalsRows =
      await transaction.query.lifecycleFeatureGateApprovals.findMany({
        where: and(
          eq(lifecycleFeatureGateApprovals.gate, gate),
          eq(lifecycleFeatureGateApprovals.requesterId, requesterId),
          eq(lifecycleFeatureGateApprovals.approved, true),
        ),
      });
    const approvals: MigrationApprovalEvidence[] = [];
    for (const approval of approvalsRows) {
      const evidence = await immutableEvidence(
        transaction,
        approval.evidenceDocumentId,
      );
      approvals.push({
        actorId: approval.approverId,
        approved: approval.approved,
        approvedAt: approval.approvedAt.toISOString(),
        evidenceHash: evidence.sha256,
        recentAuthentication: {
          authenticatedAt: approval.approvedAt.toISOString(),
          evidenceHash: approval.authenticationEvidenceHash,
        },
      });
    }
    const runId = uuidV7();
    const execution = payload.executionMode === "execute";
    const checkpoint = startMigration({
      runId,
      sourceKind: source.sourceKind,
      sourceBytes: source.sourceBytes,
      sourceRecords: source.sourceRecords,
      dryRun: !execution,
      featureFlagEnabled: this.options.policies.migrationFeatureEnabled,
      realCustomerExecution: execution,
      requesterId,
      approvals,
      ...(source.snapshotAccessAuthorization
        ? { snapshotAccessAuthorization: source.snapshotAccessAuthorization }
        : {}),
    });
    if (checkpoint.sourceSnapshotHash !== payload.sourceSnapshotHash)
      throw new Error("MIGRATION_CHECKPOINT_HASH_MISMATCH");
    const [run] = await transaction
      .insert(lifecycleMigrationRuns)
      .values({
        id: runId,
        executionMode: payload.executionMode,
        sourceSnapshotHash: payload.sourceSnapshotHash,
        sourceKind: source.sourceKind,
        requesterId,
        checkpoint,
        status: checkpoint.phase,
        batchSize: payload.batchSize,
      })
      .returning();
    if (!run) throw new Error("MIGRATION_RUN_INSERT_FAILED");
    await appendEvent(transaction, {
      aggregateType: "workflow_run",
      aggregateId: run.id,
      aggregateVersion: run.rowVersion,
      eventType: "migration.started",
      context,
      after: {
        runId: run.id,
        executionMode: run.executionMode,
        sourceSnapshotHash: run.sourceSnapshotHash,
        sourceKind: run.sourceKind,
        bindingHash: checkpoint.bindingHash,
        dryRun: checkpoint.runAuthorization.dryRun,
        approvalActors: checkpoint.runAuthorization.approvalActors,
      },
    });
    return result(run.id, run.status, "migration.started");
  }

  private async decideMigrationMatch(
    transaction: RuntimeTransaction,
    raw: unknown,
    context: LifecycleRepositoryOperationContext,
  ) {
    const payload = decideMigrationMatchPayloadSchema.parse(raw);
    requireRecentAuthentication(context);
    const run = await transaction.query.lifecycleMigrationRuns.findFirst({
      where: eq(lifecycleMigrationRuns.id, payload.runId),
    });
    if (!run) throw new Error("MIGRATION_RUN_NOT_FOUND");
    const checkpoint = MigrationCheckpointSchema.parse(run.checkpoint);
    if (checkpoint.phase === "complete" || checkpoint.phase === "failed")
      throw new Error("MIGRATION_RUN_TERMINAL");
    if (payload.decision === "attach") {
      if (!payload.accountId)
        throw new Error("MIGRATION_ATTACH_ACCOUNT_REQUIRED");
      assertAccountScope(context, payload.accountId);
      const account = await transaction.query.accounts.findFirst({
        where: eq(accounts.id, payload.accountId),
      });
      if (!account) throw new Error("MIGRATION_ATTACH_ACCOUNT_NOT_FOUND");
    } else if (payload.accountId) {
      throw new Error("MIGRATION_ACCOUNT_ONLY_VALID_FOR_ATTACH");
    }
    const evidence = await immutableEvidence(
      transaction,
      payload.evidenceDocumentId,
      payload.accountId ?? undefined,
    );
    const evidenceHash = hashEvidence({
      runId: run.id,
      legacyAccountId: payload.legacyAccountId,
      decision: payload.decision,
      accountId: payload.accountId,
      reason: payload.reason,
      evidenceDocumentHash: evidence.sha256,
      decidedBy: userId(context),
      decidedAt: context.occurredAt,
    });
    const [match] = await transaction
      .insert(lifecycleMigrationMatches)
      .values({
        runId: run.id,
        legacyAccountId: payload.legacyAccountId,
        disposition: payload.decision,
        accountId: payload.accountId,
        reason: payload.reason,
        evidenceDocumentId: evidence.documentId,
        decidedBy: userId(context),
        decidedAt: new Date(context.occurredAt),
        evidenceHash,
      })
      .returning();
    if (!match) throw new Error("MIGRATION_MATCH_INSERT_FAILED");
    const [updated] = await transaction
      .update(lifecycleMigrationRuns)
      .set({
        status: "discovery",
        updatedAt: this.now(),
        rowVersion: run.rowVersion + 1,
      })
      .where(
        and(
          eq(lifecycleMigrationRuns.id, run.id),
          eq(lifecycleMigrationRuns.rowVersion, run.rowVersion),
        ),
      )
      .returning();
    if (!updated) throw new Error("VERSION_CONFLICT");
    const eventType =
      payload.decision === "skip"
        ? "migration.review_required"
        : "migration.completed";
    await appendEvent(transaction, {
      aggregateType: "workflow_run",
      aggregateId: run.id,
      aggregateVersion: updated.rowVersion,
      eventType,
      context,
      after: {
        matchId: match.id,
        legacyAccountId: match.legacyAccountId,
        decision: match.disposition,
        accountId: match.accountId,
        evidenceHash: match.evidenceHash,
        decidedBy: match.decidedBy,
      },
    });
    return result(match.id, payload.decision, eventType);
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
        existing.responseStatus !== null &&
        existing.responseBody !== null
      )
        return {
          kind: "replay" as const,
          response: {
            status: existing.responseStatus,
            headers: {},
            body: existing.responseBody,
          },
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
      ? { kind: "claimed" as const, id: claimed.id, lockToken }
      : { kind: "in_progress" as const };
  }

  private async completeUserIdempotency(
    transaction: RuntimeTransaction,
    ownerUserId: string,
    scope: string,
    key: string,
    requestHash: string,
    lockToken: string,
    response: DatabaseLifecycleCommandResult,
  ): Promise<void> {
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
          eq(lifecycleIdempotencyRecords.lockToken, lockToken),
          isNull(lifecycleIdempotencyRecords.completedAt),
        ),
      )
      .returning({ id: lifecycleIdempotencyRecords.id });
    if (!completed)
      throw new Error("STALE_IDEMPOTENCY_LEASE_CANNOT_COMPLETE_RESPONSE");
  }

  private async renewableOrder(
    transaction: RuntimeTransaction,
    orderId: string,
  ): Promise<RenewableOrder> {
    const persisted = await transaction.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    if (!persisted || !persisted.serviceEndsOn)
      throw new Error("RENEWABLE_ORDER_NOT_FOUND");
    const [agreement, profile, quote, lines] = await Promise.all([
      transaction.query.agreements.findFirst({
        where: eq(agreements.id, persisted.agreementId),
      }),
      transaction.query.orderCommercialProfiles.findFirst({
        where: eq(orderCommercialProfiles.orderId, persisted.id),
      }),
      transaction.query.quotes.findFirst({
        where: eq(quotes.id, persisted.quoteId),
      }),
      transaction.query.orderLines.findMany({
        where: eq(orderLines.orderId, persisted.id),
      }),
    ]);
    if (!agreement || !profile || !quote)
      throw new Error("RENEWABLE_ORDER_STATE_INCOMPLETE");
    const template = agreement.templateId
      ? await transaction.query.agreementTemplates.findFirst({
          where: eq(agreementTemplates.id, agreement.templateId),
        })
      : undefined;
    return {
      orderId: persisted.id,
      accountId: persisted.accountId,
      endClientAccountId:
        persisted.invoicingAccountId === persisted.accountId
          ? null
          : persisted.accountId,
      partnerAccountId: persisted.partnerAccountId,
      invoicingAccountId: persisted.invoicingAccountId,
      notificationPath:
        persisted.sourcing === "resale" || persisted.sourcing === "distributor"
          ? "partner"
          : "direct",
      startsOn: persisted.serviceStartsOn,
      endsOn: persisted.serviceEndsOn,
      noticeDays: agreement.noticeDays,
      renewalType: z
        .enum(["auto_renew", "expires"])
        .parse(agreement.renewalType),
      timeZone: profile.contractualTimeZone,
      pinnedAgreement: {
        agreementId: agreement.id,
        templateId: agreement.templateId,
        templateVersion: template?.semanticVersion ?? null,
        textHash: agreement.textHash,
      },
      lines: lines.map((line) => ({
        lineId: line.id,
        sku: line.sku,
        quantity: line.quantity,
        region: "contracted",
        unitPriceMinor: line.unitPriceMinor.toString(),
        currency: z.enum(["USD", "EUR", "GBP"]).parse(quote.currency),
      })),
      commercialOwnerId: persisted.signerUserId,
      rowVersion: persisted.rowVersion,
    };
  }

  private async resolveObjectAccount(
    transaction: RuntimeTransaction,
    objectType: string,
    objectId: string,
  ): Promise<string | null> {
    switch (objectType) {
      case "account":
        return (
          (
            await transaction.query.accounts.findFirst({
              columns: { id: true },
              where: eq(accounts.id, objectId),
            })
          )?.id ?? null
        );
      case "quote":
        return (
          (
            await transaction.query.quotes.findFirst({
              columns: { accountId: true },
              where: eq(quotes.id, objectId),
            })
          )?.accountId ?? null
        );
      case "order":
        return (
          (
            await transaction.query.orders.findFirst({
              columns: { accountId: true },
              where: eq(orders.id, objectId),
            })
          )?.accountId ?? null
        );
      case "poc":
        return (
          (
            await transaction.query.pocs.findFirst({
              columns: { accountId: true },
              where: eq(pocs.id, objectId),
            })
          )?.accountId ?? null
        );
      case "agreement":
        return (
          (
            await transaction.query.agreements.findFirst({
              columns: { accountId: true },
              where: eq(agreements.id, objectId),
            })
          )?.accountId ?? null
        );
      default:
        return null;
    }
  }

  private async exceptionRequester(
    transaction: RuntimeTransaction,
    caseId: string,
  ): Promise<string> {
    const event = await transaction.query.auditEvents.findFirst({
      where: and(
        eq(auditEvents.aggregateType, "exception_case"),
        eq(auditEvents.aggregateId, caseId),
        eq(auditEvents.eventType, "exception_case.opened"),
      ),
      orderBy: [asc(auditEvents.aggregateVersion)],
    });
    const after = JsonRecordSchema.parse(event?.after);
    return ids.user.parse(after.requestedBy);
  }

  private async nextAuditVersion(
    transaction: RuntimeTransaction,
    aggregateType: EntityName,
    aggregateId: string,
  ): Promise<number> {
    const last = await transaction.query.auditEvents.findFirst({
      columns: { aggregateVersion: true },
      where: and(
        eq(auditEvents.aggregateType, aggregateType),
        eq(auditEvents.aggregateId, aggregateId),
      ),
      orderBy: [desc(auditEvents.aggregateVersion)],
    });
    return (last?.aggregateVersion ?? 0) + 1;
  }

  private async bumpAccountVersion(
    transaction: RuntimeTransaction,
    accountId: string,
  ): Promise<number> {
    const account = await transaction.query.accounts.findFirst({
      columns: { rowVersion: true },
      where: eq(accounts.id, accountId),
    });
    if (!account) throw new Error("ACCOUNT_NOT_FOUND");
    const nextVersion = account.rowVersion + 1;
    const [updated] = await transaction
      .update(accounts)
      .set({ rowVersion: nextVersion, updatedAt: this.now() })
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.rowVersion, account.rowVersion),
        ),
      )
      .returning({ rowVersion: accounts.rowVersion });
    if (!updated) throw new Error("VERSION_CONFLICT");
    return updated.rowVersion;
  }

  private async bumpDraftVersion(
    transaction: RuntimeTransaction,
    draftId: string,
    expectedVersion: number,
    status?: "draft" | "executed" | "void",
  ): Promise<number> {
    const nextVersion = expectedVersion + 1;
    const [updated] = await transaction
      .update(lifecycleAgreementDrafts)
      .set({
        ...(status ? { status } : {}),
        rowVersion: nextVersion,
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(lifecycleAgreementDrafts.id, draftId),
          eq(lifecycleAgreementDrafts.rowVersion, expectedVersion),
        ),
      )
      .returning({ rowVersion: lifecycleAgreementDrafts.rowVersion });
    if (!updated) throw new Error("VERSION_CONFLICT");
    return updated.rowVersion;
  }

  private async bumpPocVersion(
    transaction: RuntimeTransaction,
    pocId: string,
    expectedVersion: number,
  ): Promise<number> {
    const nextVersion = expectedVersion + 1;
    const [updated] = await transaction
      .update(pocs)
      .set({ rowVersion: nextVersion, updatedAt: this.now() })
      .where(and(eq(pocs.id, pocId), eq(pocs.rowVersion, expectedVersion)))
      .returning({ rowVersion: pocs.rowVersion });
    if (!updated) throw new Error("VERSION_CONFLICT");
    return updated.rowVersion;
  }

  private async bumpOrderVersion(
    transaction: RuntimeTransaction,
    orderId: string,
    expectedVersion: number,
  ): Promise<number> {
    const nextVersion = expectedVersion + 1;
    const [updated] = await transaction
      .update(orders)
      .set({ rowVersion: nextVersion, updatedAt: this.now() })
      .where(
        and(eq(orders.id, orderId), eq(orders.rowVersion, expectedVersion)),
      )
      .returning({ rowVersion: orders.rowVersion });
    if (!updated) throw new Error("VERSION_CONFLICT");
    return updated.rowVersion;
  }
}
