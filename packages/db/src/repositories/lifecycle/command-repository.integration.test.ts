import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { exceptionQueues } from "@clockwork/domain/lifecycle";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import {
  orders,
  organizations,
  pocs,
  quotes,
  terminations,
} from "../../schema";
import {
  orderCommercialProfiles,
  quoteCommercialProfiles,
} from "../../schema/core/finance";
import {
  lifecycleDomainEvents,
  lifecycleRenewalActions,
} from "../../schema/lifecycle/platform";
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
const createdPocIds: string[] = [];
const createdPocOrganizationIds: string[] = [];

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
  if (createdPocIds.length > 0)
    await withInternalTransaction(db, "lifecycle-poc-cleanup", async (tx) => {
      await tx.delete(pocs).where(inArray(pocs.id, createdPocIds));
      await tx
        .delete(organizations)
        .where(inArray(organizations.id, createdPocOrganizationIds));
    });
  await client.end();
});

async function cloneResaleOrder(suffix: string): Promise<string> {
  return withInternalTransaction(
    db,
    `lifecycle-resale-fixture-${suffix}`,
    async (tx) => {
      const sourceOrder = await tx.query.orders.findFirst({
        where: eq(orders.id, "80000000-0000-4000-8000-000000000003"),
      });
      const sourceQuote = sourceOrder
        ? await tx.query.quotes.findFirst({
            where: eq(quotes.id, sourceOrder.quoteId),
          })
        : undefined;
      const sourceProfile = sourceOrder
        ? await tx.query.orderCommercialProfiles.findFirst({
            where: eq(orderCommercialProfiles.orderId, sourceOrder.id),
          })
        : undefined;
      const sourceQuoteProfile = sourceOrder
        ? await tx.query.quoteCommercialProfiles.findFirst({
            where: eq(quoteCommercialProfiles.quoteId, sourceOrder.quoteId),
          })
        : undefined;
      if (!sourceOrder || !sourceQuote || !sourceProfile || !sourceQuoteProfile)
        throw new Error("RESALE_RENEWAL_SOURCE_FIXTURE_MISSING");
      const quoteId = crypto.randomUUID();
      const orderId = crypto.randomUUID();
      await tx.insert(quotes).values({
        ...sourceQuote,
        id: quoteId,
        seriesId: crypto.randomUUID(),
        previousRevisionId: null,
        rowVersion: 1,
      });
      await tx.insert(quoteCommercialProfiles).values({
        ...sourceQuoteProfile,
        quoteId,
      });
      await tx.insert(orders).values({
        ...sourceOrder,
        id: orderId,
        quoteId,
        rowVersion: 1,
      });
      await tx.insert(orderCommercialProfiles).values({
        ...sourceProfile,
        orderId,
        provisioningIdempotencyKey: `lifecycle:resale:${suffix}:${orderId}`,
      });
      return orderId;
    },
  );
}

async function cloneDirectOrder(suffix: string): Promise<string> {
  return withInternalTransaction(
    db,
    `lifecycle-direct-fixture-${suffix}`,
    async (tx) => {
      const sourceOrder = await tx.query.orders.findFirst({
        where: eq(orders.id, "80000000-0000-4000-8000-000000000007"),
      });
      const sourceQuote = sourceOrder
        ? await tx.query.quotes.findFirst({
            where: eq(quotes.id, sourceOrder.quoteId),
          })
        : undefined;
      if (!sourceOrder || !sourceQuote)
        throw new Error("DIRECT_OFFBOARDING_SOURCE_FIXTURE_MISSING");
      const quoteId = crypto.randomUUID();
      const orderId = crypto.randomUUID();
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
      return orderId;
    },
  );
}

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
    if (typeof created.organizationId !== "string")
      throw new Error("POC_ORGANIZATION_ID_MISSING");
    createdPocIds.push(created.id);
    createdPocOrganizationIds.push(created.organizationId);
  });

  it("derives POC partner identity and rejects a forged relationship", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const basePayload = {
      accountId: "10000000-0000-4000-8000-000000000004",
      workload: "Referral archive modernization",
      buyerUserId: "20000000-0000-4000-8000-000000000004",
      permittedDataClass: "confidential" as const,
      successTests: [
        {
          id: `relationship-${suffix}`,
          description: "Approved relationship remains tenant isolated",
        },
      ],
      capacityCap: "10",
      egressCap: "1",
      expiresAt: "2026-08-31T16:00:00.000Z",
      supportOwnerId: "20000000-0000-4000-8000-000000000001",
    };
    const created = await repository.executeInTransaction({
      command: "create_poc",
      payload: {
        ...basePayload,
        partnerAccountId: "10000000-0000-4000-8000-000000000002",
      },
      context: userContext(
        `lifecycle-related-poc-${suffix}`,
        basePayload.buyerUserId,
        basePayload.accountId,
        "owner",
        `lifecycle-related-poc-create-${suffix}`,
      ),
    });
    const persisted = await withInternalTransaction(
      db,
      `lifecycle-related-poc-assert-${suffix}`,
      (tx) => tx.query.pocs.findFirst({ where: eq(pocs.id, created.id) }),
    );
    expect(persisted?.partnerAccountId).toBe(
      "10000000-0000-4000-8000-000000000002",
    );
    if (typeof created.organizationId !== "string")
      throw new Error("POC_ORGANIZATION_ID_MISSING");
    createdPocIds.push(created.id);
    createdPocOrganizationIds.push(created.organizationId);

    await expect(
      repository.executeInTransaction({
        command: "create_poc",
        payload: {
          ...basePayload,
          partnerAccountId: "10000000-0000-4000-8000-000000000003",
        },
        context: userContext(
          `lifecycle-forged-poc-${suffix}`,
          basePayload.buyerUserId,
          basePayload.accountId,
          "owner",
          `lifecycle-forged-poc-create-${suffix}`,
        ),
      }),
    ).rejects.toThrow("POC_PARTNER_RELATIONSHIP_FORGED");
  });

  it("authorizes resale renewals from the persisted partner and rejects a forged partner", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const orderId = await cloneResaleOrder(suffix);
    const partnerContext = userContext(
      `lifecycle-resale-renewal-${suffix}`,
      "20000000-0000-4000-8000-000000000008",
      "10000000-0000-4000-8000-000000000003",
      "partner_admin",
      `lifecycle-resale-renewal-command-${suffix}`,
    );

    const center = await repository.executeInTransaction({
      command: "renewal_command_center",
      payload: {
        accountId: "10000000-0000-4000-8000-000000000003",
        window: "all",
        timeZone: "Europe/Madrid",
      },
      context: partnerContext,
    });
    const centerItems = center.items;
    if (!Array.isArray(centerItems))
      throw new Error("RENEWAL_COMMAND_CENTER_ITEMS_MISSING");
    expect(
      centerItems.some((item: unknown) => {
        return (
          typeof item === "object" &&
          item !== null &&
          "orderId" in item &&
          item.orderId === orderId
        );
      }),
    ).toBe(true);

    const requested = await repository.executeInTransaction({
      command: "request_renewal",
      payload: {
        orderId,
        accountId: "10000000-0000-4000-8000-000000000004",
        requestedAction: "renew",
        requestedTermMonths: 12,
      },
      context: partnerContext,
    });
    expect(requested).toMatchObject({
      status: "requested",
      eventType: "renewal.requested",
    });
    const persisted = await withInternalTransaction(
      db,
      `lifecycle-resale-renewal-assert-${suffix}`,
      (tx) =>
        tx.query.lifecycleRenewalActions.findFirst({
          where: and(
            eq(lifecycleRenewalActions.orderId, orderId),
            eq(lifecycleRenewalActions.action, "renew"),
          ),
        }),
    );
    expect(persisted).toMatchObject({
      accountId: "10000000-0000-4000-8000-000000000004",
      actorUserId: "20000000-0000-4000-8000-000000000008",
    });

    await expect(
      repository.executeInTransaction({
        command: "request_renewal",
        payload: {
          orderId,
          accountId: "10000000-0000-4000-8000-000000000004",
          requestedAction: "change_term",
          requestedTermMonths: 6,
        },
        context: userContext(
          `lifecycle-forged-resale-renewal-${suffix}`,
          "20000000-0000-4000-8000-000000000005",
          "10000000-0000-4000-8000-000000000005",
          "partner_admin",
          `lifecycle-forged-resale-renewal-command-${suffix}`,
        ),
      }),
    ).rejects.toThrow("RENEWABLE_ORDER_NOT_FOUND");
  });

  it("serializes concurrent offboarding requests so only one review is opened", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const orderId = await cloneDirectOrder(suffix);
    const command = (attempt: string) =>
      repository.executeInTransaction({
        command: "request_termination" as const,
        payload: {
          accountId: "10000000-0000-4000-8000-000000000004",
          orderId,
          reason: "customer_request" as const,
          effectiveAt: "2026-08-31T00:00:00.000Z",
          retrievalDays: 30,
          partnerAccountId: null,
        },
        context: userContext(
          `lifecycle-concurrent-offboarding-${suffix}-${attempt}`,
          "20000000-0000-4000-8000-000000000004",
          "10000000-0000-4000-8000-000000000004",
          "owner",
          `lifecycle-concurrent-offboarding-command-${suffix}-${attempt}`,
        ),
      });
    const outcomes = await Promise.allSettled([command("a"), command("b")]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected")
      expect(String(rejected.reason)).toContain(
        "ORDER_OFFBOARDING_ALREADY_OPEN",
      );
    const persisted = await withInternalTransaction(
      db,
      `lifecycle-concurrent-offboarding-assert-${suffix}`,
      (tx) =>
        tx.query.terminations.findMany({
          where: eq(terminations.orderId, orderId),
        }),
    );
    expect(persisted).toHaveLength(1);
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
