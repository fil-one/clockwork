import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { exceptionQueues } from "@clockwork/domain/lifecycle";

import type { RuntimeDatabase } from "../../client";
import { DatabaseLifecycleCommandRepository } from "./command-repository";

const validMarketplacePayload = {
  type: "metering.reported",
  eventId: "marketplace-event-boundary-1",
  provider: "aws" as const,
  providerAccountReference: "seller-account-1",
  accountId: "10000000-0000-4000-8000-000000000001",
  orderId: "50000000-0000-4000-8000-000000000001",
  entitlementId: "60000000-0000-4000-8000-000000000001",
  occurredAt: "2026-08-01T12:00:00.000Z",
  currency: "USD" as const,
  grossMinor: "1",
  feeMinor: "0",
  taxMinor: "0",
  netMinor: "1",
  quantity: "1",
  sequence: 1,
};
const queuePolicies = exceptionQueues.map((queue) => ({
  queue,
  ownerId: "20000000-0000-4000-8000-000000000001",
  backupId: "20000000-0000-4000-8000-000000000002",
  targetBusinessHours: 8,
  escalationOwnerId: "20000000-0000-4000-8000-000000000003",
  separationRequired: true,
}));

describe("marketplace repository pre-write validation", () => {
  it.each([
    ["money overflow", { grossMinor: "9223372036854775808" }],
    ["negative quantity", { quantity: "-1" }],
    ["exponent quantity", { quantity: "1e3" }],
    ["over-precision quantity", { quantity: "0.0000000000000000001" }],
  ])("rejects %s before opening a transaction", async (_label, override) => {
    const transaction = vi.fn();
    const database = { transaction } as unknown as RuntimeDatabase;
    const repository = new DatabaseLifecycleCommandRepository({
      database,
      serviceDatabase: database,
      authorizationSecret: "marketplace-boundary-secret-32-bytes",
      policies: {
        clickThroughThresholdMinor: "1000000",
        migrationFeatureEnabled: false,
        automatedTeardownEnabled: false,
        exceptionQueues: queuePolicies,
      },
    });

    await expect(
      repository.executeInTransaction({
        command: "ingest_marketplace_event",
        payload: { ...validMarketplacePayload, ...override },
        context: {
          requestId: "marketplace-boundary-request-1",
          actor: { kind: "provider", id: "marketplace:aws" },
          idempotencyKey: "marketplace:boundary:event:1",
          ip: null,
          userAgent: null,
          occurredAt: "2026-08-01T12:00:00.000Z",
          authorization: null,
        },
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("migration start staff boundary", () => {
  const tenantOwner = {
    userId: "30000000-0000-4000-8000-000000000001",
    accountIds: ["10000000-0000-4000-8000-000000000001"],
    roles: ["owner"],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };

  function createRepository() {
    const transaction = vi.fn();
    const load = vi.fn();
    const database = { transaction } as unknown as RuntimeDatabase;
    const repository = new DatabaseLifecycleCommandRepository({
      database,
      serviceDatabase: database,
      authorizationSecret: "migration-boundary-secret-32-bytes!!",
      migrationSource: { load },
      policies: {
        clickThroughThresholdMinor: "1000000",
        migrationFeatureEnabled: true,
        automatedTeardownEnabled: false,
        exceptionQueues: queuePolicies,
      },
    });
    return { repository, transaction, load };
  }

  function startMigrationCommand(authorization: unknown) {
    return {
      command: "start_migration" as const,
      payload: {
        executionMode: "discovery",
        sourceSnapshotHash: "a".repeat(64),
        resumeRunId: null,
        batchSize: 10,
      },
      context: {
        requestId: "migration-boundary-request-1",
        actor: {
          kind: "user" as const,
          id: "30000000-0000-4000-8000-000000000001",
        },
        idempotencyKey: "migration:boundary:1",
        ip: null,
        userAgent: null,
        occurredAt: "2026-08-01T12:00:00.000Z",
        authorization,
      },
    };
  }

  it("refuses a tenant owner before a transaction opens or the source loads", async () => {
    const { repository, transaction, load } = createRepository();

    await expect(
      repository.executeInTransaction(
        startMigrationCommand(tenantOwner) as never,
      ),
    ).rejects.toThrow("MIGRATION_INTERNAL_STAFF_REQUIRED");
    // Unfixed, the staff test only chose a different transaction, so the tenant
    // reached `sourcePort.load` -- an authenticated request into the legacy
    // source system -- before the row policy could reject the insert.
    expect(transaction).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses inside startMigration itself, ahead of the source load", async () => {
    // Reached directly because the point of this layer is that it holds even if
    // the route gate and the command router above it were both bypassed.
    const { repository, load } = createRepository();
    const startMigration = (
      repository as unknown as {
        startMigration: (
          transaction: unknown,
          raw: unknown,
          context: unknown,
        ) => Promise<unknown>;
      }
    ).startMigration.bind(repository);

    await expect(
      startMigration({}, startMigrationCommand(tenantOwner).payload, {
        ...startMigrationCommand(tenantOwner).context,
        authorization: tenantOwner,
      }),
    ).rejects.toThrow("MIGRATION_INTERNAL_STAFF_REQUIRED");
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps other account-scoped staff-service commands falling through", async () => {
    const { repository, transaction } = createRepository();

    await repository
      .executeInTransaction({
        ...startMigrationCommand(tenantOwner),
        command: "open_exception" as never,
        payload: {
          queue: exceptionQueues[0],
          accountId: "10000000-0000-4000-8000-000000000001",
        },
      } as never)
      .catch(() => undefined);

    // The migration denial must not become a blanket deny: open_exception and
    // decide_exception are deliberate account-scoped tenant flows.
    expect(transaction).toHaveBeenCalled();
  });
});
