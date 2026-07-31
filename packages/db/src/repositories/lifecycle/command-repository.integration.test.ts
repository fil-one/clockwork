import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { exceptionQueues } from "@clockwork/domain/lifecycle";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { lifecycleDomainEvents } from "../../schema/lifecycle/platform";
import { withInternalTransaction } from "../../transaction";
import { DatabaseLifecycleCommandRepository } from "./command-repository";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const occurredAt = "2026-07-31T16:00:00.000Z";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 6,
  role: "clockwork_service",
  ssl: false,
});

const queuePolicies = exceptionQueues.map((queue) => ({
  queue,
  ownerId: "20000000-0000-4000-8000-000000000001",
  backupId: "20000000-0000-4000-8000-000000000005",
  targetBusinessHours: 8,
  escalationOwnerId: "20000000-0000-4000-8000-000000000006",
  separationRequired: true,
}));

const repository = new DatabaseLifecycleCommandRepository({
  database: db,
  serviceDatabase: db,
  authorizationSecret,
  policies: {
    clickThroughThresholdMinor: "1000000",
    migrationFeatureEnabled: false,
    automatedTeardownEnabled: false,
    exceptionQueues: queuePolicies,
  },
});

function authorization(
  userId: string,
  accountId: string,
  role: "owner" | "partner_admin",
): AuthorizationContext {
  return {
    userId: ids.user.parse(userId),
    accountIds: [ids.account.parse(accountId)],
    roles: [role],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
}

function userContext(
  requestId: string,
  userId: string,
  accountId: string,
  role: "owner" | "partner_admin",
  idempotencyKey: string,
) {
  return {
    requestId,
    actor: { kind: "user" as const, id: userId },
    idempotencyKey,
    ip: "192.0.2.10",
    userAgent: "Clockwork lifecycle integration",
    occurredAt,
    authorization: authorization(userId, accountId, role),
  };
}

afterAll(async () => {
  await client.end();
});

// Cases own separate account/aggregate IDs. Only idempotency replay operations
// on the same aggregate are ordered within their individual test.
describe.concurrent("database lifecycle production repository", () => {
  it("persists a partner domain once and replays the completed response", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const context = userContext(
      `lifecycle-partner-${suffix}`,
      "20000000-0000-4000-8000-000000000003",
      "10000000-0000-4000-8000-000000000002",
      "partner_admin",
      `lifecycle-partner-domain-${suffix}`,
    );
    const input = {
      command: "verify_partner_domain" as const,
      payload: {
        accountId: "10000000-0000-4000-8000-000000000002",
        domain: `brand-${suffix}.redwood.test`,
        verificationToken: `verified-token-${suffix}-1234567890`,
        brandName: "Redwood Channel",
        logoUrl: "https://assets.redwood.test/logo.png",
        primaryColor: "#123456",
        communicationOwner: "partner",
        verificationEvidence: {
          verifiedAt: "2026-07-31T16:00:00.000Z",
          evidenceReference: `dns-txt:_clockwork-domain.brand-${suffix}.redwood.test`,
        },
      },
      context,
    };
    const first = await repository.executeInTransaction(input);
    const replay = await repository.executeInTransaction(input);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      status: "verified",
      eventType: "account.partner_domain_verified",
    });
  });

  it("fails closed before a tenant can choose another account scope", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    await expect(
      repository.executeInTransaction({
        command: "verify_partner_domain",
        payload: {
          accountId: "10000000-0000-4000-8000-000000000004",
          domain: `cross-${suffix}.juniper.test`,
          verificationToken: `verified-token-${suffix}-1234567890`,
          brandName: "Cross Account",
          logoUrl: null,
          primaryColor: "#654321",
          communicationOwner: "fil_one",
          verificationEvidence: {
            verifiedAt: "2026-07-31T16:00:00.000Z",
            evidenceReference: `dns-txt:_clockwork-domain.cross-${suffix}.juniper.test`,
          },
        },
        context: userContext(
          `lifecycle-cross-${suffix}`,
          "20000000-0000-4000-8000-000000000003",
          "10000000-0000-4000-8000-000000000002",
          "partner_admin",
          `lifecycle-cross-account-${suffix}`,
        ),
      }),
    ).rejects.toThrow("ACCOUNT_SCOPE");
  });

  it("creates an isolated POC from server-derived qualification state", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const created = await repository.executeInTransaction({
      command: "create_poc",
      payload: {
        accountId: "10000000-0000-4000-8000-000000000004",
        partnerAccountId: null,
        workload: `Immutable archive evaluation ${suffix}`,
        buyerUserId: "20000000-0000-4000-8000-000000000004",
        permittedDataClass: "confidential",
        successTests: [
          {
            id: `retention-${suffix}`,
            description: "Retention proof succeeds",
          },
        ],
        capacityCap: "10",
        egressCap: "1",
        expiresAt: "2026-08-31T16:00:00.000Z",
        supportOwnerId: "20000000-0000-4000-8000-000000000001",
      },
      context: userContext(
        `lifecycle-poc-${suffix}`,
        "20000000-0000-4000-8000-000000000004",
        "10000000-0000-4000-8000-000000000004",
        "owner",
        `lifecycle-poc-create-${suffix}`,
      ),
    });
    expect(created).toMatchObject({
      status: "proposed",
      eventType: "poc.qualification_submitted",
    });
    expect(created.organizationId).toEqual(expect.any(String));
  });

  it("applies a marketplace projection once and ignores delayed delivery", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const prior = await withInternalTransaction(
      db,
      `marketplace-sequence-${suffix}`,
      (tx) =>
        tx.query.lifecycleDomainEvents.findFirst({
          where: and(
            eq(lifecycleDomainEvents.provider, "aws"),
            eq(
              lifecycleDomainEvents.aggregateId,
              "83000000-0000-4000-8000-000000000006",
            ),
          ),
          orderBy: [desc(lifecycleDomainEvents.sequence)],
        }),
    );
    const sequence = (prior?.sequence ?? 1_500_000) + 1;
    const base = {
      provider: "aws" as const,
      providerAccountReference: "aws-demo-marketplace",
      accountId: "10000000-0000-4000-8000-000000000004",
      orderId: "80000000-0000-4000-8000-000000000006",
      entitlementId: "83000000-0000-4000-8000-000000000006",
      occurredAt,
      currency: null,
      grossMinor: null,
      feeMinor: null,
      taxMinor: null,
      netMinor: null,
      quantity: null,
    };
    const first = await repository.executeInTransaction({
      command: "ingest_marketplace_event",
      payload: {
        ...base,
        type: "entitlement.activated",
        eventId: `aws-current-${suffix}`,
        sequence,
      },
      context: {
        requestId: `marketplace-current-${suffix}`,
        actor: { kind: "provider", id: "marketplaces-platform" },
        idempotencyKey: `marketplaces-platform:current:${suffix}`,
        ip: null,
        userAgent: null,
        occurredAt,
        authorization: null,
      },
    });
    const stale = await repository.executeInTransaction({
      command: "ingest_marketplace_event",
      payload: {
        ...base,
        type: "entitlement.suspended",
        eventId: `aws-delayed-${suffix}`,
        sequence: sequence - 1,
      },
      context: {
        requestId: `marketplace-delayed-${suffix}`,
        actor: { kind: "provider", id: "marketplaces-platform" },
        idempotencyKey: `marketplaces-platform:delayed:${suffix}`,
        ip: null,
        userAgent: null,
        occurredAt,
        authorization: null,
      },
    });
    expect(first.status).toBe("processed");
    expect(stale).toMatchObject({
      status: "stale",
      lastAppliedSequence: sequence,
    });
  });
});
