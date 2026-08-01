import { exceptionQueues } from "@clockwork/domain/lifecycle";
import {
  beginProvisioning,
  type OffboardingPlan,
} from "@clockwork/domain/lifecycle";
import {
  approvals as durableApprovals,
  createRuntimeDatabase,
  DatabaseDeletionCertificateStore,
  DatabaseLifecycleCommandRepository,
  type DatabaseLifecycleCommandInput,
  orders,
  providerOperations,
  quotes,
  terminations,
  withInternalTransaction,
} from "@clockwork/db";
import {
  lifecycleOffboardingPlans,
  lifecycleProvisioningAttempts,
} from "@clockwork/db/schema";
import { FakeEvidenceStorageAdapter } from "@clockwork/integrations";
import { afterAll, describe, expect, it } from "vitest";

import {
  createDeletionCertificateOutboxHandler,
  type DeletionCertificatePersistencePort,
  type DeletionCertificateRenderer,
} from "./deletion-certificate-handler";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const certificateRenderer: DeletionCertificateRenderer = {
  render(request) {
    const bytes = new TextEncoder().encode(JSON.stringify(request));
    return Promise.resolve({
      bytes,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      mimeType: "application/pdf",
    });
  },
};
const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 4,
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseLifecycleCommandRepository({
  database: db,
  serviceDatabase: db,
  authorizationSecret,
  policies: {
    clickThroughThresholdMinor: "1000000",
    migrationFeatureEnabled: false,
    automatedTeardownEnabled: true,
    deletionCertificateRetentionYears: 7,
    exceptionQueues: exceptionQueues.map((queue) => ({
      queue,
      ownerId: "20000000-0000-4000-8000-000000000001",
      backupId: "20000000-0000-4000-8000-000000000005",
      targetBusinessHours: 8,
      escalationOwnerId: "20000000-0000-4000-8000-000000000006",
      separationRequired: true,
    })),
  },
});
const issuer = {
  legalName: "Fil One, Inc.",
  address: {
    line1: "9 Fiction Way",
    locality: "Wilmington",
    region: "DE",
    postalCode: "19801",
    countryCode: "US",
  },
};

afterAll(async () => {
  await client.end();
});

async function teardownFixture(input: { suffix: string; failed?: boolean }) {
  const terminationId = crypto.randomUUID();
  const commandId = `teardown-${crypto.randomUUID()}`;
  const accountId = input.failed
    ? "10000000-0000-4000-8000-000000000004"
    : "10000000-0000-4000-8000-000000000001";
  const sourceOrderId = input.failed
    ? "80000000-0000-4000-8000-000000000007"
    : "80000000-0000-4000-8000-000000000001";
  const orderId = crypto.randomUUID();
  const organizationId = input.failed
    ? "30000000-0000-4000-8000-000000000003"
    : "30000000-0000-4000-8000-000000000001";
  const requestedBy = input.failed
    ? "20000000-0000-4000-8000-000000000004"
    : "20000000-0000-4000-8000-000000000002";
  const exclusionId = input.failed
    ? "40000000-0000-4000-8000-000000000007"
    : "40000000-0000-4000-8000-000000000002";
  const approvals = [
    {
      approvalId: crypto.randomUUID(),
      approverId: "20000000-0000-4000-8000-000000000005",
      decision: "approved" as const,
      reason: "Approved after isolated teardown simulation",
      decidedAt: "2026-07-31T15:50:00.000Z",
      evidenceHash: "a".repeat(64),
      recentAuthentication: {
        authenticatedAt: "2026-07-31T15:49:00.000Z",
        evidenceHash: "b".repeat(64),
      },
    },
    {
      approvalId: crypto.randomUUID(),
      approverId: "20000000-0000-4000-8000-000000000006",
      decision: "approved" as const,
      reason: "Second approval after retained-object review",
      decidedAt: "2026-07-31T15:55:00.000Z",
      evidenceHash: "c".repeat(64),
      recentAuthentication: {
        authenticatedAt: "2026-07-31T15:54:00.000Z",
        evidenceHash: "d".repeat(64),
      },
    },
  ];
  const plan: OffboardingPlan = {
    terminationId,
    accountId,
    orderId,
    organizationId,
    reason: "customer_request",
    requestedBy,
    effectiveAt: "2026-07-01T00:00:00.000Z",
    finalBillingStatus: "settled",
    retrievalStartsAt: "2026-07-01T00:00:00.000Z",
    retrievalEndsAt: "2026-07-30T00:00:00.000Z",
    maximumRetentionAt: "2033-07-31T16:00:00.000Z",
    status: "teardown_requested",
    lockedExclusions: [
      {
        objectId: exclusionId,
        scope: "document:retained-agreement",
        retainUntil: "2033-07-31T16:00:00.000Z",
        legalHold: false,
      },
    ],
    deletionScheduledAt: "2033-07-31T16:00:00.000Z",
    approvals,
    teardownOperationId: null,
    teardownConfirmedAt: null,
    teardownExcludedObjectIds: [exclusionId],
  };
  const command = {
    commandId,
    idempotencyKey: `teardown:${terminationId}`,
    orderId,
    orderVersion: 1,
    organizationId,
    operation: "teardown" as const,
    tenantId: null,
    entitlements: [],
    requestedAt: "2026-07-31T15:55:00.000Z",
  };
  await withInternalTransaction(db, `fixture-${input.suffix}`, async (tx) => {
    const sourceOrder = await tx.query.orders.findFirst({
      where: (row, { eq: equals }) => equals(row.id, sourceOrderId),
    });
    const sourceQuote = sourceOrder
      ? await tx.query.quotes.findFirst({
          where: (row, { eq: equals }) => equals(row.id, sourceOrder.quoteId),
        })
      : undefined;
    if (!sourceOrder || !sourceQuote)
      throw new Error("OFFBOARDING_SOURCE_FIXTURE_MISSING");
    const quoteId = crypto.randomUUID();
    await tx.insert(quotes).values({
      ...sourceQuote,
      id: quoteId,
      seriesId: crypto.randomUUID(),
      previousRevisionId: null,
      rowVersion: 1,
    });
    await tx.insert(orders).values({
      ...sourceOrder,
      id: orderId,
      quoteId,
      rowVersion: 1,
    });
    await tx.insert(terminations).values({
      id: terminationId,
      accountId,
      orderId,
      effectiveAt: new Date(plan.effectiveAt),
      finalBillingStatus: "settled",
      teardownStatus: "teardown_requested",
      deletionScheduledAt: new Date("2033-07-31T16:00:00.000Z"),
    });
    await tx.insert(durableApprovals).values(
      approvals.map((approval) => ({
        id: approval.approvalId,
        accountId,
        action: "termination_teardown",
        objectType: "termination",
        objectId: terminationId,
        requestedBy,
        approvedBy: approval.approverId,
        status: approval.decision,
        requestedAt: new Date(plan.effectiveAt),
        decidedAt: new Date(approval.decidedAt),
      })),
    );
    const retryingAttempt = {
      ...beginProvisioning(command),
      state: "retry_scheduled" as const,
      nextAttemptAt: command.requestedAt,
    };
    await tx.insert(lifecycleProvisioningAttempts).values({
      commandId,
      accountId,
      orderId,
      organizationId,
      operation: "teardown",
      state: "retry_scheduled",
      attempt: retryingAttempt,
    });
    await tx.insert(providerOperations).values({
      provider: "provisioning",
      operation: "teardown",
      idempotencyKey: command.idempotencyKey,
      aggregateType: "termination",
      aggregateId: terminationId,
      status: "retrying",
      nextAttemptAt: new Date(command.requestedAt),
    });
    await tx.insert(lifecycleOffboardingPlans).values({
      terminationId,
      accountId,
      organizationId,
      requestedBy,
      reason: plan.reason,
      plan,
    });
  });
  const occurredAt = "2026-07-31T16:00:00.000Z";
  const providerExecution: DatabaseLifecycleCommandInput = {
    command: "ingest_provisioning_event",
    payload: {
      type: "provisioning.confirmed",
      confirmationId: `confirmation-${input.suffix}`,
      commandId,
      operationId: `operation-${input.suffix}`,
      status: input.failed ? "failed" : "succeeded",
      tenantId: `tenant-${input.suffix}`,
      resources: [],
      excludedObjectIds: [exclusionId],
      deletedScope: [`organization:${organizationId}:deletable-remainder`],
      deletionMethod: "provider-verified cryptographic erasure",
      occurredAt,
    },
    context: {
      requestId: `provider-${input.suffix}`,
      actor: { kind: "provider", id: "provisioning-platform" },
      idempotencyKey: `provider:${commandId}:${input.suffix}`,
      ip: null,
      userAgent: null,
      occurredAt,
      authorization: null,
    },
  };
  const result = await repository.executeInTransaction(providerExecution);
  return { terminationId, commandId, orderId, result, providerExecution };
}

async function certificateInvocation(terminationId: string) {
  return withInternalTransaction(db, `request-${terminationId}`, async (tx) => {
    const events = await tx.query.auditEvents.findMany({
      orderBy: (table, { desc }) => [desc(table.occurredAt)],
    });
    const event = events.find(
      (candidate) =>
        candidate.eventType === "termination.deletion_certificate_requested" &&
        JSON.stringify(candidate.after).includes(terminationId),
    );
    if (!event)
      throw new Error("Deletion certificate request event was not persisted");
    const messages = await tx.query.outboxMessages.findMany();
    const message = messages.find(
      (candidate) => candidate.eventId === event.id,
    );
    if (!message)
      throw new Error("Deletion certificate request outbox was not persisted");
    const payload = message.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      !JSON.stringify(payload).includes(terminationId)
    )
      throw new Error("Deletion certificate request scope mismatch");
    return {
      messageId: message.id,
      eventId: event.id,
      topic: message.topic,
      payload,
      idempotencyKey: `outbox:${message.id}`,
    };
  });
}

describe("deletion certificate production issuance", () => {
  it("issues exactly once with exclusions and survives storage-before-DB crash", async () => {
    const normal = await teardownFixture({ suffix: crypto.randomUUID() });
    expect(normal.result.status).toBe("confirmed");
    const duplicateCallback = await repository.executeInTransaction({
      ...normal.providerExecution,
      context: {
        ...normal.providerExecution.context,
        requestId: `duplicate-${crypto.randomUUID()}`,
        idempotencyKey: `duplicate:${crypto.randomUUID()}`,
      },
    });
    expect(duplicateCallback.duplicate).toBe(true);
    const invocation = await certificateInvocation(normal.terminationId);
    const evidence = new FakeEvidenceStorageAdapter();
    const store = new DatabaseDeletionCertificateStore(db);
    const handler = createDeletionCertificateOutboxHandler({
      evidence,
      persistence: store,
      issuer,
      automatedTeardownEnabled: true,
      renderer: certificateRenderer,
    });
    await handler(invocation);
    await handler({
      ...invocation,
      idempotencyKey: `${invocation.idempotencyKey}:replay`,
    });

    const crash = await teardownFixture({ suffix: crypto.randomUUID() });
    const crashInvocation = await certificateInvocation(crash.terminationId);
    let failBeforeDatabase = true;
    const crashingPersistence: DeletionCertificatePersistencePort = {
      issue(input) {
        if (failBeforeDatabase) {
          failBeforeDatabase = false;
          return Promise.reject(new Error("SIMULATED_DATABASE_CRASH"));
        }
        return store.issue(input);
      },
    };
    const crashHandler = createDeletionCertificateOutboxHandler({
      evidence,
      persistence: crashingPersistence,
      issuer,
      automatedTeardownEnabled: true,
      renderer: certificateRenderer,
    });
    await expect(crashHandler(crashInvocation)).rejects.toThrow(
      "SIMULATED_DATABASE_CRASH",
    );
    await crashHandler({
      ...crashInvocation,
      idempotencyKey: `${crashInvocation.idempotencyKey}:replay`,
    });

    await withInternalTransaction(db, "certificate-assert", async (tx) => {
      const rows = await tx.query.deletionCertificates.findMany();
      const targetTerminationIds = new Set<string>([
        normal.terminationId,
        crash.terminationId,
      ]);
      const issued = rows.filter((row) =>
        targetTerminationIds.has(row.terminationId),
      );
      expect(issued).toHaveLength(2);
      expect(issued[0]?.lockedExclusions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ scope: "document:retained-agreement" }),
        ]),
      );
      const documentRows = (await tx.query.documents.findMany()).filter(
        (document) => document.kind === "deletion_certificate",
      );
      expect(
        documentRows.filter((document) =>
          issued.some((certificate) => certificate.documentId === document.id),
        ),
      ).toHaveLength(2);
      const issuedEvents = (await tx.query.auditEvents.findMany()).filter(
        (event) =>
          event.eventType === "termination.deletion_certificate_issued" &&
          issued.some((certificate) => certificate.id === event.aggregateId),
      );
      expect(issuedEvents).toHaveLength(2);
      const issuedEventIds = new Set(issuedEvents.map((event) => event.id));
      expect(
        (await tx.query.outboxMessages.findMany()).filter((message) =>
          issuedEventIds.has(message.eventId),
        ),
      ).toHaveLength(2);
      expect(
        (await tx.query.orders.findMany()).find(
          (order) => order.id === normal.orderId,
        )?.status,
      ).toBe("terminated");
      expect(
        (await tx.query.orders.findMany()).find(
          (order) => order.id === crash.orderId,
        )?.status,
      ).toBe("terminated");
    });
  });

  it("does not request or issue a certificate for failed teardown", async () => {
    const failed = await teardownFixture({
      suffix: crypto.randomUUID(),
      failed: true,
    });
    expect(failed.result.status).toBe("dead_letter");
    await withInternalTransaction(
      db,
      "failed-certificate-assert",
      async (tx) => {
        const certificates = await tx.query.deletionCertificates.findMany();
        expect(
          certificates.find(
            (certificate) => certificate.terminationId === failed.terminationId,
          ),
        ).toBeUndefined();
        const requestEvents = (await tx.query.auditEvents.findMany()).filter(
          (event) =>
            event.eventType === "termination.deletion_certificate_requested",
        );
        expect(
          requestEvents.some((event) =>
            JSON.stringify(event.after).includes(failed.terminationId),
          ),
        ).toBe(false);
        expect(
          (await tx.query.orders.findMany()).find(
            (order) => order.id === failed.orderId,
          )?.status,
        ).toBe("active");
      },
    );
  });
});
import { createHash } from "node:crypto";
