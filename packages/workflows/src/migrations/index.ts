import {
  durableHumanWait,
  type DurableHumanWait,
  workflowEffect,
  type WorkflowEffect,
  type WorkflowIdentity,
} from "../onboarding/durable";

export const migrationTaskIds = Object.freeze({
  discovery: "lifecycle-migrations-discovery-v1",
  scheduledBatch: "lifecycle-migrations-scheduled-batch-v1",
  reviewWait: "lifecycle-migrations-review-wait-v1",
});

export interface LegacyProduct {
  legacyProductId: string;
  stripeProductId: string | null;
  skuHint: string | null;
  region: string | null;
}

export interface ProductCandidate {
  sku: string;
  stripeProductIds: readonly string[];
  legacyAliases: readonly string[];
  supportedRegions: readonly string[];
}

export interface ProductDiscovery {
  legacyProductId: string;
  status: "matched" | "ambiguous" | "unmatched";
  matchedSku: string | null;
  candidateSkus: readonly string[];
  reason: string;
}

export type MigrationEffect = WorkflowEffect<
  | "open_ambiguous_migration_review"
  | "migrate_existing_account"
  | "require_agreement_reacceptance"
  | "checkpoint_migration"
  | "schedule_migration_batch"
  | "record_migration_rollback_boundary",
  Readonly<Record<string, unknown>>
>;

export interface ExistingAccountMigration {
  legacyAccountId: string;
  accountId: string;
  sourceRevision: string;
  emailDomain: string;
  products: readonly LegacyProduct[];
  acceptedAgreementHash: string | null;
}

export interface MigrationFeatureGate {
  featureEnabled: boolean;
  executionMode: "dry_run" | "rehearsal" | "execute";
  environment: "test" | "staging" | "production";
  realCustomerAuthorization: boolean;
}

export interface MigrationCheckpoint {
  runId: string;
  lastLegacyAccountId: string | null;
  processedSourceRevisions: ReadonlySet<string>;
  status: "pending" | "running" | "paused" | "complete" | "failed";
}

export function scheduleMigrationBatch(input: {
  runId: string;
  runVersion: number;
  batchNumber: number;
  executeAt: string;
}): MigrationEffect {
  if (!Number.isInteger(input.batchNumber) || input.batchNumber < 1)
    throw new Error("MIGRATION_BATCH_NUMBER_INVALID");
  return workflowEffect(
    {
      aggregateType: "migration_run",
      aggregateId: input.runId,
      aggregateVersion: input.runVersion,
      operation: "scheduled-batch",
    },
    `batch:${input.batchNumber}`,
    "schedule_migration_batch",
    { runId: input.runId, batchNumber: input.batchNumber },
    input.executeAt,
  );
}

export function waitForMigrationReview(input: {
  runId: string;
  runVersion: number;
  legacyAccountId: string;
  expiresAt: string;
}): DurableHumanWait {
  return durableHumanWait({
    identity: {
      aggregateType: "migration_run",
      aggregateId: input.runId,
      aggregateVersion: input.runVersion,
      operation: "ambiguous-product-review",
    },
    discriminator: input.legacyAccountId,
    subjectType: "legacy_account",
    subjectId: input.legacyAccountId,
    resumeEvents: ["migration.mapping-approved", "migration.account-skipped"],
    expiresAt: input.expiresAt,
  });
}

function normalized(value: string | null): string | null {
  const result = value?.trim().toLowerCase() ?? null;
  return result === "" ? null : result;
}

export function discoverProductMatches(
  products: readonly LegacyProduct[],
  candidates: readonly ProductCandidate[],
): readonly ProductDiscovery[] {
  return products.map((product) => {
    const stripeId = normalized(product.stripeProductId);
    const alias = normalized(product.skuHint);
    const possible = candidates.filter((candidate) => {
      const regionMatches =
        product.region === null ||
        candidate.supportedRegions.includes(product.region);
      const identifierMatches =
        (stripeId !== null &&
          candidate.stripeProductIds.map(normalized).includes(stripeId)) ||
        (alias !== null &&
          [candidate.sku, ...candidate.legacyAliases]
            .map((value) => value.toLowerCase())
            .includes(alias));
      return regionMatches && identifierMatches;
    });
    if (possible.length === 1)
      return {
        legacyProductId: product.legacyProductId,
        status: "matched",
        matchedSku: possible[0]?.sku ?? null,
        candidateSkus: [possible[0]?.sku ?? ""].filter(Boolean),
        reason: "EXACT_IDENTIFIER_MATCH",
      };
    return {
      legacyProductId: product.legacyProductId,
      status: possible.length > 1 ? "ambiguous" : "unmatched",
      matchedSku: null,
      candidateSkus: possible.map((candidate) => candidate.sku).sort(),
      reason:
        possible.length > 1 ? "MULTIPLE_PRODUCT_MATCHES" : "NO_PRODUCT_MATCH",
    };
  });
}

export function assertMigrationGate(gate: MigrationFeatureGate): void {
  if (!gate.featureEnabled) throw new Error("MIGRATION_FEATURE_DISABLED");
  if (
    gate.executionMode === "execute" &&
    gate.environment === "production" &&
    !gate.realCustomerAuthorization
  )
    throw new Error("REAL_CUSTOMER_MIGRATION_AUTHORIZATION_REQUIRED");
}

export function assertRehearsalFixtures(
  accounts: readonly ExistingAccountMigration[],
): void {
  if (accounts.length === 0) throw new Error("MIGRATION_FIXTURES_REQUIRED");
  if (accounts.some((account) => !account.emailDomain.endsWith(".test")))
    throw new Error("REHEARSAL_REQUIRES_TEST_DOMAINS");
}

export function planMigrationBatch(input: {
  runId: string;
  runVersion: number;
  accounts: readonly ExistingAccountMigration[];
  candidates: readonly ProductCandidate[];
  checkpoint: MigrationCheckpoint;
  batchSize: number;
  canonicalAgreementHash: string;
  gate: MigrationFeatureGate;
}): readonly MigrationEffect[] {
  assertMigrationGate(input.gate);
  if (input.gate.executionMode === "rehearsal")
    assertRehearsalFixtures(input.accounts);
  if (
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > 100
  )
    throw new Error("MIGRATION_BATCH_SIZE_INVALID");
  if (input.checkpoint.runId !== input.runId)
    throw new Error("MIGRATION_CHECKPOINT_MISMATCH");
  const identity: WorkflowIdentity = {
    aggregateType: "migration_run",
    aggregateId: input.runId,
    aggregateVersion: input.runVersion,
    operation: input.gate.executionMode,
  };
  const accounts = [...input.accounts]
    .sort((left, right) =>
      left.legacyAccountId.localeCompare(right.legacyAccountId),
    )
    .filter(
      (account) =>
        (input.checkpoint.lastLegacyAccountId === null ||
          account.legacyAccountId > input.checkpoint.lastLegacyAccountId) &&
        !input.checkpoint.processedSourceRevisions.has(
          `${account.legacyAccountId}:${account.sourceRevision}`,
        ),
    )
    .slice(0, input.batchSize);
  const effects = accounts.flatMap((account): readonly MigrationEffect[] => {
    const discovery = discoverProductMatches(
      account.products,
      input.candidates,
    );
    const review = discovery.filter((result) => result.status !== "matched");
    if (review.length > 0)
      return [
        workflowEffect(
          identity,
          `account:${account.legacyAccountId}:revision:${account.sourceRevision}:review`,
          "open_ambiguous_migration_review",
          {
            runId: input.runId,
            legacyAccountId: account.legacyAccountId,
            accountId: account.accountId,
            discovery: review,
          },
        ),
      ];
    const accountEffects: MigrationEffect[] = [
      workflowEffect(
        identity,
        `account:${account.legacyAccountId}:revision:${account.sourceRevision}:migrate`,
        "migrate_existing_account",
        {
          runId: input.runId,
          legacyAccountId: account.legacyAccountId,
          accountId: account.accountId,
          sourceRevision: account.sourceRevision,
          productMappings: discovery.map((result) => ({
            legacyProductId: result.legacyProductId,
            sku: result.matchedSku,
          })),
          dryRun: input.gate.executionMode === "dry_run",
        },
      ),
    ];
    if (account.acceptedAgreementHash !== input.canonicalAgreementHash)
      accountEffects.push(
        workflowEffect(
          identity,
          `account:${account.legacyAccountId}:agreement-reacceptance`,
          "require_agreement_reacceptance",
          {
            accountId: account.accountId,
            priorHash: account.acceptedAgreementHash,
            requiredHash: input.canonicalAgreementHash,
            transactionsBlockedUntilAccepted: true,
          },
        ),
      );
    return accountEffects;
  });
  const last = accounts.at(-1);
  if (last)
    effects.push(
      workflowEffect(
        identity,
        `checkpoint:${last.legacyAccountId}`,
        "checkpoint_migration",
        {
          runId: input.runId,
          lastLegacyAccountId: last.legacyAccountId,
          processedSourceRevisions: accounts.map(
            (account) => `${account.legacyAccountId}:${account.sourceRevision}`,
          ),
        },
      ),
    );
  return effects;
}

export function rollbackBoundary(input: {
  runId: string;
  runVersion: number;
  accountId: string;
  phase:
    "discovered" | "records_written" | "external_effects_started" | "completed";
}): {
  reversible: boolean;
  action: "delete_staged_records" | "compensating_migration_required";
  effect: MigrationEffect;
} {
  const reversible = ["discovered", "records_written"].includes(input.phase);
  const identity: WorkflowIdentity = {
    aggregateType: "migration_run",
    aggregateId: input.runId,
    aggregateVersion: input.runVersion,
    operation: "rollback-boundary",
  };
  return {
    reversible,
    action: reversible
      ? "delete_staged_records"
      : "compensating_migration_required",
    effect: workflowEffect(
      identity,
      `account:${input.accountId}:phase:${input.phase}`,
      "record_migration_rollback_boundary",
      { accountId: input.accountId, phase: input.phase, reversible },
    ),
  };
}
