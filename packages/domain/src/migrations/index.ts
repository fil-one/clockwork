import { createHash } from "node:crypto";

export interface LegacyCustomer {
  legacyAccountId: string;
  stripeCustomerId: string | null;
  legalName: string;
  country: string;
  domain: string;
  productOrganizationId: string;
  subscriptions: readonly {
    stripeSubscriptionId: string;
    sku: string;
    status: string;
  }[];
  termsAcceptance: {
    templateVersion: string | null;
    acceptedAt: string | null;
    evidenceHash: string | null;
  } | null;
}

export interface CommerceCandidate {
  accountId: string;
  stripeCustomerId: string | null;
  legalName: string;
  country: string;
  domain: string;
  productOrganizationIds: readonly string[];
}

export type DiscoveryDisposition = "create" | "attach" | "review" | "skip";

export interface DiscoveryRecord {
  legacyAccountId: string;
  disposition: DiscoveryDisposition;
  matchedAccountId: string | null;
  matchReasons: readonly string[];
  candidateAccountIds: readonly string[];
  reacceptanceRequired: boolean;
  idempotencyKey: string;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function discoverExistingCustomers(
  legacy: readonly LegacyCustomer[],
  commerce: readonly CommerceCandidate[],
): readonly DiscoveryRecord[] {
  return legacy.map((customer) => {
    const candidates = commerce.flatMap((candidate) => {
      const reasons: string[] = [];
      if (
        customer.stripeCustomerId &&
        candidate.stripeCustomerId === customer.stripeCustomerId
      )
        reasons.push("stripe_customer_id");
      if (
        candidate.productOrganizationIds.includes(
          customer.productOrganizationId,
        )
      )
        reasons.push("product_organization_id");
      if (
        normalized(candidate.domain) === normalized(customer.domain) &&
        candidate.country === customer.country
      )
        reasons.push("domain_country");
      if (
        normalized(candidate.legalName) === normalized(customer.legalName) &&
        candidate.country === customer.country
      )
        reasons.push("legal_entity");
      return reasons.length === 0 ? [] : [{ candidate, reasons }];
    });
    const exact = candidates.filter(({ reasons }) =>
      reasons.some((reason) =>
        ["stripe_customer_id", "product_organization_id"].includes(reason),
      ),
    );
    const selected =
      exact.length === 1
        ? exact[0]
        : candidates.length === 1
          ? candidates[0]
          : undefined;
    const ambiguous = exact.length > 1 || (!selected && candidates.length > 1);
    const validEvidence = Boolean(
      customer.termsAcceptance?.templateVersion?.trim() &&
      Number.isFinite(
        Date.parse(customer.termsAcceptance?.acceptedAt ?? "invalid"),
      ) &&
      customer.termsAcceptance?.evidenceHash?.match(/^[a-f0-9]{64}$/),
    );
    const canonical = `${customer.legacyAccountId}:${customer.stripeCustomerId ?? "none"}:${customer.productOrganizationId}`;
    return {
      legacyAccountId: customer.legacyAccountId,
      disposition: ambiguous ? "review" : selected ? "attach" : "create",
      matchedAccountId: ambiguous
        ? null
        : (selected?.candidate.accountId ?? null),
      matchReasons: selected?.reasons ?? [],
      candidateAccountIds: candidates
        .map(({ candidate }) => candidate.accountId)
        .sort(),
      reacceptanceRequired: !validEvidence,
      idempotencyKey: `migration:${createHash("sha256").update(canonical).digest("hex")}`,
    };
  });
}

export interface MigrationCheckpoint {
  readonly runId: string;
  readonly sourceKind: "fixture" | "real_snapshot";
  readonly sourceSnapshotHash: string;
  /** Compatibility alias. It is the source hash even for an authorized snapshot. */
  readonly fixtureSnapshotHash: string;
  readonly inputOrderHash: string;
  readonly recordSetHash: string;
  readonly recordsHash: string;
  readonly runAuthorization: {
    readonly requesterId: string;
    readonly dryRun: boolean;
    readonly realCustomerExecution: boolean;
    readonly featureFlagEnabled: boolean;
    readonly approvalActors: readonly string[];
    readonly approvalTimes: readonly string[];
    readonly approvalEvidenceHashes: readonly string[];
    readonly approvalAuthenticationEvidenceHashes: readonly string[];
    readonly snapshotAccessActor: string | null;
    readonly snapshotAccessEvidenceHash: string | null;
    readonly snapshotAuthenticationEvidenceHash: string | null;
  };
  readonly bindingHash: string;
  /** Diagnostic count only. Resumption is driven exclusively by processedKeys. */
  readonly cursor: number;
  readonly processedKeys: readonly string[];
  readonly results: readonly {
    idempotencyKey: string;
    legacyAccountId: string;
    action: "created" | "attached" | "review_queued" | "skipped";
    accountId: string | null;
    reacceptanceRequired: boolean;
    reacceptanceEvidenceHash: string | null;
    activationStatus:
      | "ready"
      | "blocked_pending_reacceptance"
      | "blocked_review"
      | "not_applicable";
  }[];
  readonly phase: "discovery" | "accounts" | "orders" | "complete" | "failed";
  readonly rollbackBoundary: "none" | "before_orders" | "forward_only";
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const instantWithOffsetPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface MigrationApprovalEvidence {
  readonly actorId: string;
  readonly approved: boolean;
  readonly approvedAt: string;
  readonly evidenceHash: string;
  readonly recentAuthentication: {
    readonly authenticatedAt: string;
    readonly evidenceHash: string;
  };
}

export interface SnapshotAccessAuthorization {
  readonly actorId: string;
  readonly authorized: boolean;
  readonly authorizedAt: string;
  readonly evidenceHash: string;
  readonly recentAuthentication: {
    readonly authenticatedAt: string;
    readonly evidenceHash: string;
  };
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashKeys(keys: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify(keys), "utf8")
    .digest("hex");
}

function hashRecords(records: readonly DiscoveryRecord[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        records.map((record) => [
          record.legacyAccountId,
          record.disposition,
          record.matchedAccountId,
          record.matchReasons,
          record.candidateAccountIds,
          record.reacceptanceRequired,
          record.idempotencyKey,
        ]),
      ),
      "utf8",
    )
    .digest("hex");
}

function checkpointBinding(input: {
  runId: string;
  sourceKind: MigrationCheckpoint["sourceKind"];
  sourceSnapshotHash: string;
  inputOrderHash: string;
  recordSetHash: string;
  recordsHash: string;
  runAuthorization: MigrationCheckpoint["runAuthorization"];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.runId,
        input.sourceKind,
        input.sourceSnapshotHash,
        input.inputOrderHash,
        input.recordSetHash,
        input.recordsHash,
        input.runAuthorization,
      ]),
      "utf8",
    )
    .digest("hex");
}

function validateCheckpointBinding(checkpoint: MigrationCheckpoint): void {
  const expected = checkpointBinding(checkpoint);
  if (
    checkpoint.fixtureSnapshotHash !== checkpoint.sourceSnapshotHash ||
    checkpoint.bindingHash !== expected
  )
    throw new Error("MIGRATION_CHECKPOINT_BINDING_INVALID");
}

function assertInstant(value: string, code: string): void {
  if (
    !instantWithOffsetPattern.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error(code);
}

function assertRecentAuthentication(
  actionAt: string,
  authentication: { authenticatedAt: string; evidenceHash: string },
): void {
  assertInstant(actionAt, "MIGRATION_AUTHORIZATION_TIME_INVALID");
  assertInstant(
    authentication.authenticatedAt,
    "MIGRATION_AUTHENTICATION_TIME_INVALID",
  );
  if (!sha256Pattern.test(authentication.evidenceHash))
    throw new Error("MIGRATION_AUTHENTICATION_EVIDENCE_INVALID");
  const age = Date.parse(actionAt) - Date.parse(authentication.authenticatedAt);
  if (age < 0 || age > 15 * 60_000)
    throw new Error("MIGRATION_RECENT_AUTHENTICATION_REQUIRED");
}

function freezeCheckpoint(
  checkpoint: MigrationCheckpoint,
): MigrationCheckpoint {
  for (const result of checkpoint.results) Object.freeze(result);
  Object.freeze(checkpoint.results);
  Object.freeze(checkpoint.processedKeys);
  Object.freeze(checkpoint.runAuthorization.approvalActors);
  Object.freeze(checkpoint.runAuthorization.approvalTimes);
  Object.freeze(checkpoint.runAuthorization.approvalEvidenceHashes);
  Object.freeze(
    checkpoint.runAuthorization.approvalAuthenticationEvidenceHashes,
  );
  Object.freeze(checkpoint.runAuthorization);
  return Object.freeze(checkpoint);
}

export function startMigration(input: {
  runId: string;
  sourceKind: "fixture" | "real_snapshot";
  sourceBytes: Uint8Array;
  sourceRecords: readonly DiscoveryRecord[];
  dryRun: boolean;
  featureFlagEnabled: boolean;
  realCustomerExecution: boolean;
  requesterId: string;
  approvals: readonly MigrationApprovalEvidence[];
  snapshotAccessAuthorization?: SnapshotAccessAuthorization;
}): MigrationCheckpoint {
  if (!input.runId.trim() || !input.requesterId.trim())
    throw new Error("MIGRATION_IDENTITY_REQUIRED");
  const sourceRecordKeys = input.sourceRecords.map(
    (record) => record.idempotencyKey,
  );
  if (
    sourceRecordKeys.some((key) => !key.trim()) ||
    new Set(sourceRecordKeys).size !== sourceRecordKeys.length
  )
    throw new Error("MIGRATION_SOURCE_KEYS_INVALID");
  if (input.realCustomerExecution && input.dryRun)
    throw new Error("REAL_CUSTOMER_EXECUTION_CANNOT_BE_DRY_RUN");
  if (input.realCustomerExecution && input.sourceKind !== "real_snapshot")
    throw new Error("REAL_CUSTOMER_SOURCE_REQUIRED");
  let snapshotAccessActor: string | null = null;
  let snapshotAccessEvidenceHash: string | null = null;
  let snapshotAuthenticationEvidenceHash: string | null = null;
  if (input.sourceKind === "real_snapshot") {
    const authorization = input.snapshotAccessAuthorization;
    if (
      !authorization?.authorized ||
      !authorization.actorId.trim() ||
      !sha256Pattern.test(authorization.evidenceHash)
    )
      throw new Error("REAL_SNAPSHOT_ACCESS_AUTHORIZATION_REQUIRED");
    assertRecentAuthentication(
      authorization.authorizedAt,
      authorization.recentAuthentication,
    );
    snapshotAccessActor = authorization.actorId;
    snapshotAccessEvidenceHash = authorization.evidenceHash;
    snapshotAuthenticationEvidenceHash =
      authorization.recentAuthentication.evidenceHash;
  }
  let executionApprovals: readonly MigrationApprovalEvidence[] = [];
  if (!input.dryRun || input.realCustomerExecution) {
    if (!input.featureFlagEnabled)
      throw new Error("MIGRATION_FEATURE_FLAG_DISABLED");
    const approved = input.approvals.filter(({ approved }) => approved);
    for (const approval of approved) {
      if (
        !approval.actorId.trim() ||
        approval.actorId === input.requesterId ||
        !sha256Pattern.test(approval.evidenceHash)
      )
        throw new Error("MIGRATION_APPROVAL_EVIDENCE_INVALID");
      assertRecentAuthentication(
        approval.approvedAt,
        approval.recentAuthentication,
      );
    }
    if (new Set(approved.map(({ actorId }) => actorId)).size < 2)
      throw new Error("MIGRATION_TWO_PERSON_APPROVAL_REQUIRED");
    executionApprovals = approved;
  }
  const sourceSnapshotHash = hashBytes(input.sourceBytes);
  const inputOrderHash = hashKeys(sourceRecordKeys);
  const recordSetHash = hashKeys([...sourceRecordKeys].sort());
  const recordsHash = hashRecords(input.sourceRecords);
  const runAuthorization = {
    requesterId: input.requesterId,
    dryRun: input.dryRun,
    realCustomerExecution: input.realCustomerExecution,
    featureFlagEnabled: input.featureFlagEnabled,
    approvalActors: executionApprovals.map((approval) => approval.actorId),
    approvalTimes: executionApprovals.map((approval) => approval.approvedAt),
    approvalEvidenceHashes: executionApprovals.map(
      (approval) => approval.evidenceHash,
    ),
    approvalAuthenticationEvidenceHashes: executionApprovals.map(
      (approval) => approval.recentAuthentication.evidenceHash,
    ),
    snapshotAccessActor,
    snapshotAccessEvidenceHash,
    snapshotAuthenticationEvidenceHash,
  };
  const base = {
    runId: input.runId,
    sourceKind: input.sourceKind,
    sourceSnapshotHash,
    fixtureSnapshotHash: sourceSnapshotHash,
    inputOrderHash,
    recordSetHash,
    recordsHash,
    runAuthorization,
    bindingHash: checkpointBinding({
      runId: input.runId,
      sourceKind: input.sourceKind,
      sourceSnapshotHash,
      inputOrderHash,
      recordSetHash,
      recordsHash,
      runAuthorization,
    }),
    cursor: 0,
    processedKeys: [] as readonly string[],
    results: [] as MigrationCheckpoint["results"],
    phase: "discovery" as const,
    rollbackBoundary: "none" as const,
  };
  return freezeCheckpoint(base);
}

export function assertMigrationWriteAuthorized(
  checkpoint: MigrationCheckpoint,
): void {
  validateCheckpointBinding(checkpoint);
  const authorization = checkpoint.runAuthorization;
  if (authorization.dryRun)
    throw new Error("MIGRATION_DRY_RUN_WRITE_FORBIDDEN");
  if (!authorization.featureFlagEnabled)
    throw new Error("MIGRATION_FEATURE_FLAG_DISABLED");
  if (
    authorization.approvalActors.includes(authorization.requesterId) ||
    new Set(authorization.approvalActors).size < 2 ||
    authorization.approvalEvidenceHashes.length < 2 ||
    authorization.approvalAuthenticationEvidenceHashes.length < 2 ||
    authorization.approvalEvidenceHashes.some(
      (hash) => !sha256Pattern.test(hash),
    ) ||
    authorization.approvalAuthenticationEvidenceHashes.some(
      (hash) => !sha256Pattern.test(hash),
    ) ||
    (checkpoint.sourceKind === "real_snapshot" &&
      (!authorization.snapshotAccessActor ||
        !authorization.snapshotAccessEvidenceHash ||
        !authorization.snapshotAuthenticationEvidenceHash))
  )
    throw new Error("MIGRATION_TWO_PERSON_APPROVAL_REQUIRED");
}

export function applyMigrationBatch(input: {
  checkpoint: MigrationCheckpoint;
  sourceBytes: Uint8Array;
  records: readonly DiscoveryRecord[];
  batchSize: number;
  accountIdFor: (record: DiscoveryRecord) => string;
}): MigrationCheckpoint {
  validateCheckpointBinding(input.checkpoint);
  if (hashBytes(input.sourceBytes) !== input.checkpoint.sourceSnapshotHash)
    throw new Error("MIGRATION_SOURCE_SNAPSHOT_CHANGED");
  const keys = input.records.map((record) => record.idempotencyKey);
  if (
    hashKeys(keys) !== input.checkpoint.inputOrderHash ||
    hashKeys([...keys].sort()) !== input.checkpoint.recordSetHash
  )
    throw new Error("MIGRATION_INPUT_ORDER_CHANGED");
  if (hashRecords(input.records) !== input.checkpoint.recordsHash)
    throw new Error("MIGRATION_INPUT_RECORDS_CHANGED");
  if (
    input.checkpoint.processedKeys.some((key) => !keys.includes(key)) ||
    new Set(input.checkpoint.processedKeys).size !==
      input.checkpoint.processedKeys.length
  )
    throw new Error("MIGRATION_CHECKPOINT_KEYS_INVALID");
  if (input.checkpoint.phase !== "discovery") return input.checkpoint;
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1)
    throw new Error("MIGRATION_BATCH_SIZE_INVALID");
  const processed = new Set(input.checkpoint.processedKeys);
  const batch = input.records
    .filter((record) => !processed.has(record.idempotencyKey))
    .slice(0, input.batchSize);
  const results = [...input.checkpoint.results];
  for (const record of batch) {
    if (processed.has(record.idempotencyKey)) continue;
    const action =
      record.disposition === "review"
        ? "review_queued"
        : record.disposition === "attach"
          ? "attached"
          : record.disposition === "create"
            ? "created"
            : "skipped";
    results.push({
      idempotencyKey: record.idempotencyKey,
      legacyAccountId: record.legacyAccountId,
      action,
      accountId:
        action === "review_queued" || action === "skipped"
          ? null
          : (record.matchedAccountId ?? input.accountIdFor(record)),
      reacceptanceRequired:
        record.reacceptanceRequired &&
        action !== "review_queued" &&
        action !== "skipped",
      reacceptanceEvidenceHash: null,
      activationStatus:
        action === "review_queued"
          ? "blocked_review"
          : action === "skipped"
            ? "not_applicable"
            : record.reacceptanceRequired
              ? "blocked_pending_reacceptance"
              : "ready",
    });
    processed.add(record.idempotencyKey);
  }
  const cursor = processed.size;
  return freezeCheckpoint({
    ...input.checkpoint,
    cursor,
    processedKeys: [...processed],
    results,
    phase: cursor >= input.records.length ? "accounts" : "discovery",
    rollbackBoundary: cursor > 0 ? "before_orders" : "none",
  });
}

export function recordMigrationReacceptance(
  checkpoint: MigrationCheckpoint,
  input: {
    idempotencyKey: string;
    acceptedAt: string;
    exactTermsEvidenceHash: string;
  },
): MigrationCheckpoint {
  validateCheckpointBinding(checkpoint);
  assertInstant(input.acceptedAt, "MIGRATION_REACCEPTANCE_TIME_INVALID");
  if (!sha256Pattern.test(input.exactTermsEvidenceHash))
    throw new Error("MIGRATION_REACCEPTANCE_EVIDENCE_INVALID");
  const result = checkpoint.results.find(
    (candidate) => candidate.idempotencyKey === input.idempotencyKey,
  );
  if (!result) throw new Error("MIGRATION_RECORD_NOT_FOUND");
  if (!result.reacceptanceRequired) return checkpoint;
  return freezeCheckpoint({
    ...checkpoint,
    results: checkpoint.results.map((candidate) =>
      candidate.idempotencyKey === input.idempotencyKey
        ? {
            ...candidate,
            reacceptanceRequired: false,
            reacceptanceEvidenceHash: input.exactTermsEvidenceHash,
            activationStatus: "ready",
          }
        : { ...candidate },
    ),
  });
}

export function advanceMigrationPhase(
  checkpoint: MigrationCheckpoint,
  next: "orders" | "complete",
): MigrationCheckpoint {
  validateCheckpointBinding(checkpoint);
  if (next === "orders" && checkpoint.phase !== "accounts")
    throw new Error("MIGRATION_ACCOUNTS_INCOMPLETE");
  if (
    next === "orders" &&
    checkpoint.results.some(
      (result) => result.activationStatus === "blocked_pending_reacceptance",
    )
  )
    throw new Error("MIGRATION_REACCEPTANCE_REQUIRED");
  if (next === "complete" && checkpoint.phase !== "orders")
    throw new Error("MIGRATION_ORDERS_INCOMPLETE");
  return freezeCheckpoint({
    ...checkpoint,
    phase: next,
    rollbackBoundary:
      next === "orders" ? "forward_only" : checkpoint.rollbackBoundary,
  });
}

export function planMigrationRollback(
  checkpoint: MigrationCheckpoint,
  input: {
    requestedBy: string;
    requestedAt: string;
    evidenceHash: string;
  },
): {
  readonly runId: string;
  readonly createdAccountIds: readonly string[];
  readonly attachedAccountIds: readonly string[];
  readonly safeBoundary: "before_orders";
  readonly evidenceHash: string;
} {
  validateCheckpointBinding(checkpoint);
  if (checkpoint.rollbackBoundary === "forward_only")
    throw new Error("MIGRATION_ROLLBACK_FORWARD_ONLY");
  if (!input.requestedBy.trim() || !sha256Pattern.test(input.evidenceHash))
    throw new Error("MIGRATION_ROLLBACK_EVIDENCE_INVALID");
  assertInstant(input.requestedAt, "MIGRATION_ROLLBACK_TIME_INVALID");
  return Object.freeze({
    runId: checkpoint.runId,
    createdAccountIds: checkpoint.results.flatMap((result) =>
      result.action === "created" && result.accountId ? [result.accountId] : [],
    ),
    attachedAccountIds: checkpoint.results.flatMap((result) =>
      result.action === "attached" && result.accountId
        ? [result.accountId]
        : [],
    ),
    safeBoundary: "before_orders" as const,
    evidenceHash: input.evidenceHash,
  });
}

export function assertFixtureRehearsal(input: {
  expectedLegacyCount: number;
  records: readonly DiscoveryRecord[];
  checkpoint: MigrationCheckpoint;
}): void {
  validateCheckpointBinding(input.checkpoint);
  if (input.records.length !== input.expectedLegacyCount)
    throw new Error("FIXTURE_DISCOVERY_COUNT_MISMATCH");
  const duplicateKeys =
    input.records.length -
    new Set(input.records.map((record) => record.idempotencyKey)).size;
  if (duplicateKeys > 0) throw new Error("FIXTURE_DEDUPE_FAILED");
  const recordKeys = input.records.map((record) => record.idempotencyKey);
  if (
    hashKeys(recordKeys) !== input.checkpoint.inputOrderHash ||
    hashKeys([...recordKeys].sort()) !== input.checkpoint.recordSetHash ||
    hashRecords(input.records) !== input.checkpoint.recordsHash
  )
    throw new Error("FIXTURE_INPUT_BINDING_MISMATCH");
  const processedCounts = new Map<string, number>();
  for (const result of input.checkpoint.results)
    processedCounts.set(
      result.legacyAccountId,
      (processedCounts.get(result.legacyAccountId) ?? 0) + 1,
    );
  if ([...processedCounts.values()].some((count) => count > 1))
    throw new Error("MIGRATION_RESULT_DUPLICATED");
}
