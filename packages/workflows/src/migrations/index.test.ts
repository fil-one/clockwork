import { describe, expect, it } from "vitest";

import {
  assertMigrationGate,
  discoverProductMatches,
  planMigrationBatch,
  rollbackBoundary,
  scheduleMigrationBatch,
  waitForMigrationReview,
} from "./index";

const candidates = [
  {
    sku: "storage-standard",
    stripeProductIds: ["prod_storage"],
    legacyAliases: ["storage"],
    supportedRegions: ["us-east"],
  },
  {
    sku: "storage-archive",
    stripeProductIds: ["prod_archive"],
    legacyAliases: ["archive"],
    supportedRegions: ["us-east"],
  },
];
const legacyProduct = {
  legacyProductId: "legacy-product-1",
  stripeProductId: "prod_storage",
  skuHint: null,
  region: "us-east",
};
const account = {
  legacyAccountId: "legacy-001",
  accountId: "account-1",
  sourceRevision: "rev-3",
  emailDomain: "customer.test",
  products: [legacyProduct],
  acceptedAgreementHash: null,
};

describe("migration workflows", () => {
  it("discovers exact Stripe matches and queues ambiguity", () => {
    expect(
      discoverProductMatches(account.products, candidates)[0],
    ).toMatchObject({
      status: "matched",
      matchedSku: "storage-standard",
    });
    expect(
      discoverProductMatches(
        [{ ...legacyProduct, stripeProductId: null, skuHint: "shared" }],
        candidates.map((candidate) => ({
          ...candidate,
          legacyAliases: ["shared"],
        })),
      )[0],
    ).toMatchObject({
      status: "ambiguous",
      candidateSkus: ["storage-archive", "storage-standard"],
    });
  });

  it("keeps real execution feature-gated", () => {
    expect(() =>
      assertMigrationGate({
        featureEnabled: true,
        executionMode: "execute",
        environment: "production",
        realCustomerAuthorization: false,
      }),
    ).toThrow("REAL_CUSTOMER_MIGRATION_AUTHORIZATION_REQUIRED");
  });

  it("resumes after a checkpoint, deduplicates revisions, and requires reacceptance", () => {
    const common = {
      runId: "migration-1",
      runVersion: 1,
      accounts: [account],
      candidates,
      batchSize: 10,
      canonicalAgreementHash: "a".repeat(64),
      gate: {
        featureEnabled: true,
        executionMode: "rehearsal" as const,
        environment: "test" as const,
        realCustomerAuthorization: false,
      },
    };
    const effects = planMigrationBatch({
      ...common,
      checkpoint: {
        runId: "migration-1",
        lastLegacyAccountId: null,
        processedSourceRevisions: new Set(),
        status: "running",
      },
    });
    expect(effects.map((effect) => effect.kind)).toEqual([
      "migrate_existing_account",
      "require_agreement_reacceptance",
      "checkpoint_migration",
    ]);
    expect(
      planMigrationBatch({
        ...common,
        checkpoint: {
          runId: "migration-1",
          lastLegacyAccountId: null,
          processedSourceRevisions: new Set(["legacy-001:rev-3"]),
          status: "running",
        },
      }),
    ).toEqual([]);
  });

  it("defines rollback boundaries after external effects", () => {
    expect(
      rollbackBoundary({
        runId: "migration-1",
        runVersion: 1,
        accountId: "account-1",
        phase: "external_effects_started",
      }),
    ).toMatchObject({
      reversible: false,
      action: "compensating_migration_required",
    });
  });

  it("schedules resumable batches and waits durably for ambiguous review", () => {
    expect(
      scheduleMigrationBatch({
        runId: "migration-1",
        runVersion: 1,
        batchNumber: 2,
        executeAt: "2026-08-01T16:00:00.000Z",
      }),
    ).toMatchObject({
      kind: "schedule_migration_batch",
      executeAt: "2026-08-01T16:00:00.000Z",
    });
    expect(
      waitForMigrationReview({
        runId: "migration-1",
        runVersion: 1,
        legacyAccountId: "legacy-001",
        expiresAt: "2026-08-02T16:00:00.000Z",
      }).resumeEvents,
    ).toContain("migration.mapping-approved");
  });
});
