import { describe, expect, it } from "vitest";

import {
  advanceMigrationPhase,
  applyMigrationBatch,
  assertFixtureRehearsal,
  discoverExistingCustomers,
  planMigrationRollback,
  recordMigrationReacceptance,
  startMigration,
} from ".";

const existing = [
  {
    accountId: "account-existing",
    stripeCustomerId: "cus_1",
    legalName: "Existing Ltd",
    country: "GB",
    domain: "existing.test",
    productOrganizationIds: ["org-existing"],
  },
];
const legacy = [
  {
    legacyAccountId: "legacy-1",
    stripeCustomerId: "cus_1",
    legalName: "Existing Ltd",
    country: "GB",
    domain: "existing.test",
    productOrganizationId: "org-existing",
    subscriptions: [
      { stripeSubscriptionId: "sub-1", sku: "PAYG", status: "active" },
    ],
    termsAcceptance: null,
  },
];
const fixtureBytes = new TextEncoder().encode("fixture");

function approval(actorId: string, marker: string) {
  return {
    actorId,
    approved: true,
    approvedAt: "2026-07-31T16:10:00.000Z",
    evidenceHash: marker.repeat(64),
    recentAuthentication: {
      authenticatedAt: "2026-07-31T16:05:00.000Z",
      evidenceHash: marker.toUpperCase().toLowerCase().repeat(64),
    },
  };
}

function snapshotAuthorization() {
  return {
    actorId: "data-custodian-1",
    authorized: true,
    authorizedAt: "2026-07-31T16:10:00.000Z",
    evidenceHash: "c".repeat(64),
    recentAuthentication: {
      authenticatedAt: "2026-07-31T16:05:00.000Z",
      evidenceHash: "d".repeat(64),
    },
  };
}

describe("existing-customer migration", () => {
  it("matches Stripe and product identities and requires legacy reacceptance", () => {
    const records = discoverExistingCustomers(legacy, existing);
    expect(records[0]).toMatchObject({
      disposition: "attach",
      matchedAccountId: "account-existing",
      reacceptanceRequired: true,
    });
    expect(records[0]?.matchReasons).toContain("stripe_customer_id");
    expect(records[0]?.matchReasons).toContain("product_organization_id");
  });

  it("routes ambiguous legal-entity matches to review", () => {
    const records = discoverExistingCustomers(legacy, [
      ...existing,
      {
        accountId: "account-duplicate",
        stripeCustomerId: "cus_1",
        legalName: "Existing Ltd",
        country: "GB",
        domain: "existing.test",
        productOrganizationIds: ["org-existing"],
      },
    ]);
    expect(records[0]).toMatchObject({
      disposition: "review",
      matchedAccountId: null,
    });
  });

  it("is feature-flagged, resumable, and idempotent across a replayed batch", () => {
    const records = discoverExistingCustomers(legacy, existing);
    expect(() =>
      startMigration({
        runId: "run-1",
        sourceKind: "fixture",
        sourceBytes: fixtureBytes,
        sourceRecords: records,
        dryRun: false,
        featureFlagEnabled: false,
        realCustomerExecution: false,
        requesterId: "migration-requester",
        approvals: [],
      }),
    ).toThrow("MIGRATION_FEATURE_FLAG_DISABLED");
    const started = startMigration({
      runId: "run-1",
      sourceKind: "fixture",
      sourceBytes: fixtureBytes,
      sourceRecords: records,
      dryRun: true,
      featureFlagEnabled: false,
      realCustomerExecution: false,
      requesterId: "migration-requester",
      approvals: [],
    });
    const first = applyMigrationBatch({
      checkpoint: started,
      sourceBytes: fixtureBytes,
      records,
      batchSize: 1,
      accountIdFor: () => "account-new",
    });
    const replay = applyMigrationBatch({
      checkpoint: { ...first, cursor: 0, phase: "discovery" },
      sourceBytes: fixtureBytes,
      records,
      batchSize: 1,
      accountIdFor: () => "account-new",
    });
    expect(replay.results).toHaveLength(1);
    assertFixtureRehearsal({
      expectedLegacyCount: 1,
      records,
      checkpoint: replay,
    });
  });

  it("binds the checkpoint to source bytes and exact discovered input order", () => {
    const firstLegacy = legacy.at(0);
    if (!firstLegacy) throw new Error("test fixture missing");
    const records = discoverExistingCustomers(
      [
        ...legacy,
        {
          ...firstLegacy,
          legacyAccountId: "legacy-2",
          stripeCustomerId: null,
          productOrganizationId: "org-new",
        },
      ],
      existing,
    );
    const checkpoint = startMigration({
      runId: "run-binding",
      sourceKind: "fixture",
      sourceBytes: fixtureBytes,
      sourceRecords: records,
      dryRun: true,
      featureFlagEnabled: false,
      realCustomerExecution: false,
      requesterId: "migration-requester",
      approvals: [],
    });
    expect(() =>
      applyMigrationBatch({
        checkpoint,
        sourceBytes: new TextEncoder().encode("changed fixture"),
        records,
        batchSize: 1,
        accountIdFor: () => "account-new",
      }),
    ).toThrow("MIGRATION_SOURCE_SNAPSHOT_CHANGED");
    expect(() =>
      applyMigrationBatch({
        checkpoint,
        sourceBytes: fixtureBytes,
        records: [...records].reverse(),
        batchSize: 1,
        accountIdFor: () => "account-new",
      }),
    ).toThrow("MIGRATION_INPUT_ORDER_CHANGED");
    expect(() =>
      applyMigrationBatch({
        checkpoint,
        sourceBytes: fixtureBytes,
        records: records.map((record, index) =>
          index === 0 ? { ...record, disposition: "skip" as const } : record,
        ),
        batchSize: 1,
        accountIdFor: () => "account-new",
      }),
    ).toThrow("MIGRATION_INPUT_RECORDS_CHANGED");
  });

  it("requires authorized snapshot access and two evidence-backed non-requester approvers for production", () => {
    const records = discoverExistingCustomers(legacy, existing);
    const base = {
      runId: "run-production",
      sourceKind: "real_snapshot" as const,
      sourceBytes: new TextEncoder().encode("authorized-real-snapshot"),
      sourceRecords: records,
      dryRun: false,
      featureFlagEnabled: true,
      realCustomerExecution: true,
      requesterId: "migration-requester",
      snapshotAccessAuthorization: snapshotAuthorization(),
    };
    expect(() =>
      startMigration({
        ...base,
        approvals: [
          approval("migration-requester", "a"),
          approval("approver-2", "b"),
        ],
      }),
    ).toThrow("MIGRATION_APPROVAL_EVIDENCE_INVALID");
    expect(
      startMigration({
        ...base,
        approvals: [approval("approver-1", "a"), approval("approver-2", "b")],
      }).sourceKind,
    ).toBe("real_snapshot");
    const withoutAuthorization = {
      runId: base.runId,
      sourceKind: base.sourceKind,
      sourceBytes: base.sourceBytes,
      sourceRecords: base.sourceRecords,
      dryRun: base.dryRun,
      featureFlagEnabled: base.featureFlagEnabled,
      realCustomerExecution: base.realCustomerExecution,
      requesterId: base.requesterId,
    };
    expect(() =>
      startMigration({
        ...withoutAuthorization,
        dryRun: true,
        realCustomerExecution: false,
        approvals: [],
      }),
    ).toThrow("REAL_SNAPSHOT_ACCESS_AUTHORIZATION_REQUIRED");
  });

  it("blocks activation until exact reacceptance and forbids rollback after orders", () => {
    const records = discoverExistingCustomers(legacy, existing);
    let checkpoint = startMigration({
      runId: "run-reacceptance",
      sourceKind: "fixture",
      sourceBytes: fixtureBytes,
      sourceRecords: records,
      dryRun: true,
      featureFlagEnabled: false,
      realCustomerExecution: false,
      requesterId: "migration-requester",
      approvals: [],
    });
    checkpoint = applyMigrationBatch({
      checkpoint,
      sourceBytes: fixtureBytes,
      records,
      batchSize: 10,
      accountIdFor: () => "account-new",
    });
    expect(() => advanceMigrationPhase(checkpoint, "orders")).toThrow(
      "MIGRATION_REACCEPTANCE_REQUIRED",
    );
    expect(
      planMigrationRollback(checkpoint, {
        requestedBy: "migration-requester",
        requestedAt: "2026-07-31T17:00:00.000Z",
        evidenceHash: "e".repeat(64),
      }).safeBoundary,
    ).toBe("before_orders");
    const firstRecord = records.at(0);
    if (!firstRecord) throw new Error("test fixture missing");
    checkpoint = recordMigrationReacceptance(checkpoint, {
      idempotencyKey: firstRecord.idempotencyKey,
      acceptedAt: "2026-07-31T17:05:00.000Z",
      exactTermsEvidenceHash: "f".repeat(64),
    });
    checkpoint = advanceMigrationPhase(checkpoint, "orders");
    expect(() =>
      planMigrationRollback(checkpoint, {
        requestedBy: "migration-requester",
        requestedAt: "2026-07-31T17:10:00.000Z",
        evidenceHash: "e".repeat(64),
      }),
    ).toThrow("MIGRATION_ROLLBACK_FORWARD_ONLY");
  });
});
