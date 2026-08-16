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

  it("keeps the denial off the commands a tenant may actually issue", async () => {
    // The staff denial must not become a blanket deny. `request_termination`
    // is a `staffServiceCommand` neighbour in name only -- it is a tenant flow
    // with a live row policy behind it -- and it still reaches a transaction.
    const { repository, transaction } = createRepository();

    await repository
      .executeInTransaction({
        ...startMigrationCommand(tenantOwner),
        command: "request_termination" as never,
        payload: {
          accountId: "10000000-0000-4000-8000-000000000001",
          orderId: "50000000-0000-4000-8000-000000000001",
        },
      } as never)
      .catch(() => undefined);

    expect(transaction).toHaveBeenCalled();
  });
});

/**
 * The exception queue is internal work, and the router says so.
 *
 * The comment this replaces called `open_exception` and `decide_exception`
 * "deliberately account-scoped tenant flows" that "must keep falling through",
 * and the test below it pinned that fall-through. Nothing implemented it:
 * `exception_cases_scope` has carried `with check (app_is_internal())` since
 * the foundation migration, so the tenant write raised 42501 from the database
 * after the command had already read state -- a refusal, but the wrong one, in
 * the wrong place, and untyped at the API boundary.
 */
describe("exception queue staff boundary", () => {
  const tenantOwner = {
    userId: "30000000-0000-4000-8000-000000000001",
    accountIds: ["10000000-0000-4000-8000-000000000001"],
    roles: ["owner"],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
  const internalOperator = {
    ...tenantOwner,
    userId: "20000000-0000-4000-8000-000000000001",
    roles: ["internal_operator"],
    isInternalStaff: true,
  };

  function createRepository() {
    const transaction = vi.fn();
    const database = { transaction } as unknown as RuntimeDatabase;
    const repository = new DatabaseLifecycleCommandRepository({
      database,
      serviceDatabase: database,
      authorizationSecret: "exception-boundary-secret-32-bytes!!",
      policies: {
        clickThroughThresholdMinor: "1000000",
        migrationFeatureEnabled: false,
        automatedTeardownEnabled: false,
        exceptionQueues: queuePolicies,
      },
    });
    return { repository, transaction };
  }

  function exceptionCommand(
    command: "open_exception" | "decide_exception",
    authorization: unknown,
  ) {
    return {
      command,
      payload:
        command === "open_exception"
          ? {
              accountId: "10000000-0000-4000-8000-000000000001",
              queue: "poc_qualification",
              objectType: "poc",
              objectId: "70000000-0000-4000-8000-000000000001",
              reason: "A proof of concept needs qualification before it starts",
              evidenceDocumentId: "40000000-0000-4000-8000-000000000002",
            }
          : {
              caseId: "80000000-0000-4000-8000-000000000001",
              accountId: "10000000-0000-4000-8000-000000000001",
              queue: "poc_qualification",
              decision: "approved",
              reason: "The tenant approves the review it is the subject of",
              evidenceDocumentId: "40000000-0000-4000-8000-000000000002",
            },
      context: {
        requestId: `exception-boundary-${command}`,
        actor: { kind: "user" as const, id: tenantOwner.userId },
        idempotencyKey: `exception:boundary:${command}`,
        ip: null,
        userAgent: null,
        occurredAt: "2026-08-01T12:00:00.000Z",
        authorization,
      },
    };
  }

  it.each(["open_exception", "decide_exception"] as const)(
    "refuses a tenant %s before a transaction opens",
    async (command) => {
      const { repository, transaction } = createRepository();

      await expect(
        repository.executeInTransaction(
          exceptionCommand(command, tenantOwner) as never,
        ),
      ).rejects.toThrow("EXCEPTION_INTERNAL_STAFF_REQUIRED");
      // Unfixed, the staff test only chose a different pool, so the tenant
      // opened an authorized transaction and got as far as the row policy.
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each(["openException", "decideException"] as const)(
    "refuses inside %s itself",
    async (method) => {
      // Reached directly because the point of this layer is that it holds even
      // if the route gate and the command router above it were both bypassed.
      const { repository } = createRepository();
      const command =
        method === "openException" ? "open_exception" : "decide_exception";
      const invoke = (
        repository as unknown as Record<
          string,
          (
            transaction: unknown,
            raw: unknown,
            context: unknown,
          ) => Promise<unknown>
        >
      )[method]?.bind(repository);

      await expect(
        invoke?.(
          {},
          exceptionCommand(command, tenantOwner).payload,
          exceptionCommand(command, tenantOwner).context,
        ),
      ).rejects.toThrow("EXCEPTION_INTERNAL_STAFF_REQUIRED");
    },
  );

  it.each(["open_exception", "decide_exception"] as const)(
    "still routes an internal operator's %s to the service pool",
    async (command) => {
      // The legitimate operation. The queues page is internal-only and this is
      // the caller it serves; a gate that stopped here would be the defect.
      const { repository, transaction } = createRepository();

      await repository
        .executeInTransaction(
          exceptionCommand(command, internalOperator) as never,
        )
        .catch(() => undefined);

      expect(transaction).toHaveBeenCalled();
    },
  );
});
