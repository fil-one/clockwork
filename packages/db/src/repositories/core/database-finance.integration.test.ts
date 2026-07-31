import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { ids, MoneySchema } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import type { QuoteSnapshot } from "@clockwork/domain/core";
import { exceptionQueues } from "@clockwork/domain/lifecycle";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createRuntimeDatabase } from "../../client";
import {
  auditEvents,
  entitlements,
  orders,
  organizations,
  outboxMessages,
  quotes,
} from "../../schema";
import {
  dealRegistrationExclusions,
  orderCommercialProfiles,
  orderLineSnapshots,
  quoteSnapshots,
} from "../../schema/core/finance";
import { commercialArtifactRequests } from "../../schema/core/commercial-artifacts";
import { lifecycleProvisioningAttempts } from "../../schema/lifecycle/platform";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
import { createAcceptedOrderProvisioningAttempt } from "../lifecycle/accepted-order-provisioning";
import { DatabaseLifecycleCommandRepository } from "../lifecycle/command-repository";
import { quoteArtifactDefinition } from "./artifact-definitions";
import {
  assertCommercialArtifactBinding,
  CommercialArtifactRequestSchema,
  DatabaseCommercialArtifactStore,
} from "./commercial-artifacts";
import { DatabaseCoreFinanceRepository } from "./database-finance";
import { coreSnapshotHash } from "./finance";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const accountId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const quoteId = crypto.randomUUID();
const quoteSeriesId = crypto.randomUUID();
const quoteLineId = crypto.randomUUID();
const orderId = crypto.randomUUID();
const orderLineId = crypto.randomUUID();
const occurredAt = "2026-07-31T16:00:00.000Z";
const runId = crypto.randomUUID();
const testKey = (value: string) => `${value}:${runId}`;
const testMoney = (currency: "USD" | "EUR" | "GBP", minor: string) =>
  MoneySchema.parse({ currency, minor });

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
});
const artifactStore = new DatabaseCommercialArtifactStore(db);
const lifecycleRepository = new DatabaseLifecycleCommandRepository({
  database: db,
  serviceDatabase: db,
  authorizationSecret,
  policies: {
    clickThroughThresholdMinor: "1000000",
    migrationFeatureEnabled: false,
    automatedTeardownEnabled: false,
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
const authorization: AuthorizationContext = {
  userId: ids.user.parse(userId),
  accountIds: [ids.account.parse(accountId)],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

async function persistTestArtifact(
  result: Awaited<ReturnType<typeof repository.mutate>>,
  label: string,
): Promise<string> {
  const request = CommercialArtifactRequestSchema.parse(
    result.record.data.artifactRequest,
  );
  const documentId = crypto.randomUUID();
  const artifact = {
    documentId,
    storageKey: `test/${request.requestId}.pdf`,
    storageVersionId: `version-${label}`,
    contentHash: createHash("sha256").update(request.requestHash).digest("hex"),
    byteLength: 1024,
    mimeType: "application/pdf" as const,
    retainUntil: request.retainUntil,
    legalHold: false,
  };
  const issued = await artifactStore.issue({
    request,
    artifact,
    requestId: `persist-${label}-${request.requestId}`,
  });
  expect(issued.duplicate).toBe(false);
  expect(
    (
      await artifactStore.issue({
        request,
        artifact,
        requestId: `replay-${label}-${request.requestId}`,
      })
    ).duplicate,
  ).toBe(true);
  return documentId;
}

afterAll(async () => {
  await client.end();
});

describe("database core direct-owner artifact chain", () => {
  it("rejects a partner artifact request for an unrelated commercial audience", async () => {
    const partnerAccountId = "10000000-0000-4000-8000-000000000002";
    const partnerUserId = ids.user.parse(
      "20000000-0000-4000-8000-000000000003",
    );
    const requestId = crypto.randomUUID();

    await expect(
      withAuthorizedTransaction(
        db,
        {
          userId: partnerUserId,
          accountIds: [partnerAccountId],
          roles: ["partner_admin"],
          isInternalStaff: false,
          requestId: `unrelated-commercial-artifact-${runId}`,
        },
        { secret: authorizationSecret },
        async (tx) =>
          tx.insert(commercialArtifactRequests).values({
            id: requestId,
            subjectType: "quote",
            subjectId: "70000000-0000-4000-8000-000000000001",
            commercialAccountId: accountId,
            audienceAccountId: partnerAccountId,
            audience: "partner",
            documentKind: "direct_quote",
            sourceDefinition: { adversarial: "unrelated-audience" },
            sourceHash: "a".repeat(64),
            requestHash: "b".repeat(64),
            retainUntil: new Date("2033-07-31T16:00:00.000Z"),
            requestedBy: partnerUserId,
          }),
      ),
    ).rejects.toThrow();
    await withInternalTransaction(
      db,
      `verify-unrelated-commercial-artifact-${runId}`,
      async (tx) => {
        expect(
          await tx.query.commercialArtifactRequests.findFirst({
            where: eq(commercialArtifactRequests.id, requestId),
          }),
        ).toBeUndefined();
      },
    );
  });

  it("separates end-client resale pricing from partner transfer economics", async () => {
    const resaleQuote: QuoteSnapshot = {
      id: crypto.randomUUID(),
      seriesId: crypto.randomUUID(),
      revision: 1,
      accountId: "10000000-0000-4000-8000-000000000004",
      endClientAccountId: "10000000-0000-4000-8000-000000000004",
      partnerAccountId: "10000000-0000-4000-8000-000000000003",
      priceBook: {
        id: "60000000-0000-4000-8000-000000000002",
        version: 1,
      },
      route: "resale",
      status: "draft",
      lines: [
        {
          id: crypto.randomUUID(),
          rateCardId: "61000000-0000-4000-8000-000000000002",
          sku: "LOCKED-STORAGE-TB",
          region: "eu-west-1",
          unit: "TB-month",
          approvedClaim: "Fictional immutable storage capacity",
          quantity: "1",
          termMonths: 12,
          unitPrice: testMoney("EUR", "14000"),
          listUnitPrice: testMoney("EUR", "14000"),
          floorPrice: testMoney("EUR", "9500"),
          overageRate: testMoney("EUR", "17000"),
          lineTotal: testMoney("EUR", "168000"),
          discountBps: 0,
          commitType: "term_drawdown",
          stripeTaxCode: "txcd_demo",
          qboIncomeAccount: "4000-Storage",
          marginResult: "pass",
        },
      ],
      total: testMoney("EUR", "168000"),
      partnerResaleTotal: testMoney("EUR", "216000"),
      marginResult: "pass",
      exceptionReasons: [],
      expiresAt: "2026-12-31T23:59:59.000Z",
      createdBy: userId,
      createdAt: occurredAt,
      whiteLabel: {
        displayName: "Partner Commerce",
        commercialContactEmail: "billing@resale.example",
      },
    };
    await withInternalTransaction(
      db,
      "resale-artifact-isolation",
      async (tx) => {
        const [endClient, partner] = await Promise.all([
          quoteArtifactDefinition(tx, {
            quote: resaleQuote,
            audience: "end_client",
            issuedAt: occurredAt,
          }),
          quoteArtifactDefinition(tx, {
            quote: resaleQuote,
            audience: "partner",
            issuedAt: occurredAt,
          }),
        ]);
        expect(endClient.documentKind).toBe("partner_resale_quote");
        expect(endClient.audienceAccountId).toBe(
          "10000000-0000-4000-8000-000000000004",
        );
        expect(JSON.stringify(endClient.definition)).toContain("216000");
        expect(JSON.stringify(endClient.definition)).not.toContain("168000");
        expect(JSON.stringify(endClient.definition)).not.toContain("14000");
        expect(partner.documentKind).toBe("partner_transfer_quote");
        expect(partner.audienceAccountId).toBe(
          "10000000-0000-4000-8000-000000000003",
        );
        expect(JSON.stringify(partner.definition)).toContain("168000");
        expect(JSON.stringify(partner.definition)).toContain("14000");
      },
    );
  });

  it("accepted-order-creates-provisioning-attempt-and-entitlements", async () => {
    const created = await repository.mutate({
      resource: "quotes",
      id: quoteId,
      accountId,
      action: "create",
      payload: {
        priceBookId: "60000000-0000-4000-8000-000000000001",
        seriesId: quoteSeriesId,
        route: "direct",
        lines: [
          {
            lineId: quoteLineId,
            sku: "LOCKED-STORAGE-TB",
            region: "us-east-2",
            quantity: "1",
            termMonths: 12,
          },
        ],
        expiresAt: "2026-12-31T23:59:59.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-owner-quote-create",
      idempotencyKey: testKey("core-owner-quote-create"),
      occurredAt,
    });
    const replayedAfterResponseLoss = await repository.mutate({
      resource: "quotes",
      id: quoteId,
      accountId,
      action: "create",
      payload: {
        priceBookId: "60000000-0000-4000-8000-000000000001",
        seriesId: quoteSeriesId,
        route: "direct",
        lines: [
          {
            lineId: quoteLineId,
            sku: "LOCKED-STORAGE-TB",
            region: "us-east-2",
            quantity: "1",
            termMonths: 12,
          },
        ],
        expiresAt: "2026-12-31T23:59:59.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-owner-quote-create-retry-after-crash",
      idempotencyKey: testKey("core-owner-quote-create"),
      occurredAt: "2026-07-31T16:00:05.000Z",
    });
    expect(replayedAfterResponseLoss).toEqual(created);
    await expect(
      repository.mutate({
        resource: "quotes",
        id: quoteId,
        accountId,
        action: "create",
        payload: {
          priceBookId: "60000000-0000-4000-8000-000000000001",
          seriesId: quoteSeriesId,
          route: "direct",
          lines: [
            {
              lineId: quoteLineId,
              sku: "LOCKED-STORAGE-TB",
              region: "us-east-2",
              quantity: "2",
              termMonths: 12,
            },
          ],
          expiresAt: "2026-12-31T23:59:59.000Z",
        },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: "core-owner-quote-create-conflict",
        idempotencyKey: testKey("core-owner-quote-create"),
        occurredAt: "2026-07-31T16:00:06.000Z",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    const quoteArtifactRequest = await repository.mutate({
      resource: "quotes",
      id: quoteId,
      accountId,
      action: "prepare_artifact",
      expectedVersion: 1,
      payload: {
        audience: "end_client",
        issuedAt: occurredAt,
        retainUntil: "2033-07-31T16:00:00.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-owner-quote-artifact",
      idempotencyKey: testKey("core-owner-quote-artifact"),
      occurredAt,
    });
    const quoteDocumentId = await persistTestArtifact(
      quoteArtifactRequest,
      "quote",
    );
    const preparedQuoteArtifact = CommercialArtifactRequestSchema.parse(
      quoteArtifactRequest.record.data.artifactRequest,
    );
    await withInternalTransaction(
      db,
      "core-owner-artifact-rejections",
      async (tx) => {
        const binding = {
          documentId: quoteDocumentId,
          subjectType: "quote" as const,
          subjectId: quoteId,
          commercialAccountId: accountId,
          audienceAccountId: accountId,
          audience: "end_client" as const,
          documentKind: "direct_quote" as const,
          sourceHash: preparedQuoteArtifact.sourceHash,
        };
        await expect(
          assertCommercialArtifactBinding(tx, {
            ...binding,
            documentId: crypto.randomUUID(),
          }),
        ).rejects.toThrow("COMMERCIAL_ARTIFACT_BINDING_INVALID");
        await expect(
          assertCommercialArtifactBinding(tx, {
            ...binding,
            documentKind: "order_form",
          }),
        ).rejects.toThrow("COMMERCIAL_ARTIFACT_BINDING_INVALID");
        await expect(
          assertCommercialArtifactBinding(tx, {
            ...binding,
            audienceAccountId: "10000000-0000-4000-8000-000000000004",
          }),
        ).rejects.toThrow("COMMERCIAL_ARTIFACT_BINDING_INVALID");
        await expect(
          assertCommercialArtifactBinding(tx, {
            ...binding,
            sourceHash: "f".repeat(64),
          }),
        ).rejects.toThrow("COMMERCIAL_ARTIFACT_BINDING_INVALID");
      },
    );
    const issued = await repository.mutate({
      resource: "quotes",
      id: quoteId,
      accountId,
      action: "issue",
      expectedVersion: 1,
      payload: {
        artifactIssuedAt: occurredAt,
        renderedDocumentId: quoteDocumentId,
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-owner-quote-issue",
      idempotencyKey: testKey("core-owner-quote-issue"),
      occurredAt,
    });
    expect(issued.record.data.status).toBe("issued");

    const orderCommand = {
      quoteId,
      agreementId: "51000000-0000-4000-8000-000000000001",
      signerUserId: userId,
      authorityTitle: "Chief Demo Officer",
      authorityAttested: true as const,
      serviceStartsOn: "2026-08-01",
      serviceEndsOn: "2027-07-31",
      noticeOn: "2027-06-01",
      acceptedAt: "2026-08-01T00:00:00.000Z",
      orderLineIds: [orderLineId],
      contractualTimeZone: "America/New_York",
    };
    const orderArtifactRequest = await repository.mutate({
      resource: "orders",
      id: orderId,
      accountId,
      action: "prepare_artifact",
      payload: {
        ...orderCommand,
        retainUntil: "2033-08-01T00:00:00.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-owner-order-artifact",
      idempotencyKey: testKey("core-owner-order-artifact"),
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const orderDocumentId = await persistTestArtifact(
      orderArtifactRequest,
      "order",
    );
    const accepted = await repository.mutate({
      resource: "orders",
      id: orderId,
      accountId,
      action: "create",
      payload: {
        ...orderCommand,
        orderFormDocumentId: orderDocumentId,
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-owner-order-accept",
      idempotencyKey: testKey("core-owner-order-accept"),
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    expect(accepted.record.data).toMatchObject({
      status: "accepted",
      sourcing: "direct",
      accountId,
      invoicingAccountId: accountId,
    });
    const provisioningOrder = await repository.mutate({
      resource: "orders",
      id: orderId,
      accountId,
      action: "provision",
      expectedVersion: accepted.record.rowVersion,
      payload: {},
      actor: { kind: "system", id: "artifact-chain-test" },
      authorization,
      requestId: "core-owner-order-provision",
      idempotencyKey: testKey("core-owner-order-provision"),
      occurredAt: "2026-08-01T00:01:00.000Z",
    });
    const activeOrder = await repository.mutate({
      resource: "orders",
      id: orderId,
      accountId,
      action: "activate",
      expectedVersion: provisioningOrder.record.rowVersion,
      payload: {},
      actor: { kind: "provider", id: "provisioning-platform" },
      authorization,
      requestId: "core-owner-order-activate",
      idempotencyKey: testKey("core-owner-order-activate"),
      occurredAt: "2026-08-01T00:02:00.000Z",
    });
    expect(activeOrder.record.data.status).toBe("active");

    const amendmentId = crypto.randomUUID();
    const amendmentCommand = {
      id: amendmentId,
      order: { id: orderId },
      effectiveOn: "2026-09-01",
      kind: "upgrade" as const,
      prorationMethod: "daily" as const,
      deltas: [
        {
          orderLineId,
          sku: "LOCKED-STORAGE-TB",
          quantityDelta: "1",
          fullPeriodPriceDelta: { currency: "USD", minor: "10000" },
        },
      ],
      acceptedAt: "2026-08-15T16:00:00.000Z",
    };
    const amendmentArtifactRequest = await repository.mutate({
      resource: "amendments",
      id: amendmentId,
      accountId,
      action: "prepare_artifact",
      payload: {
        amendment: amendmentCommand,
        retainUntil: "2033-08-15T16:00:00.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-owner-amendment-artifact",
      idempotencyKey: testKey("core-owner-amendment-artifact"),
      occurredAt: "2026-08-15T16:00:00.000Z",
    });
    const amendmentDocumentId = await persistTestArtifact(
      amendmentArtifactRequest,
      "amendment",
    );
    const amendment = await repository.mutate({
      resource: "amendments",
      id: amendmentId,
      accountId,
      action: "create",
      payload: {
        amendment: {
          ...amendmentCommand,
          documentId: amendmentDocumentId,
        },
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-owner-amendment-accept",
      idempotencyKey: testKey("core-owner-amendment-accept"),
      occurredAt: "2026-08-15T16:00:00.000Z",
    });
    expect(amendment.record.data).toMatchObject({
      id: amendmentId,
      orderId,
      documentId: amendmentDocumentId,
    });

    const command = await withInternalTransaction(
      db,
      "core-owner-path-assert",
      async (tx) => {
        const [quote, snapshot, order, commercial, lineSnapshot, attempt] =
          await Promise.all([
            tx.query.quotes.findFirst({ where: eq(quotes.id, quoteId) }),
            tx.query.quoteSnapshots.findFirst({
              where: eq(quoteSnapshots.quoteId, quoteId),
            }),
            tx.query.orders.findFirst({ where: eq(orders.id, orderId) }),
            tx.query.orderCommercialProfiles.findFirst({
              where: eq(orderCommercialProfiles.orderId, orderId),
            }),
            tx.query.orderLineSnapshots.findFirst({
              where: eq(orderLineSnapshots.orderLineId, orderLineId),
            }),
            tx.query.lifecycleProvisioningAttempts.findFirst({
              where: eq(lifecycleProvisioningAttempts.orderId, orderId),
            }),
          ]);
        expect(quote?.status).toBe("accepted");
        expect(snapshot?.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
        expect(order).toMatchObject({
          sourcing: "direct",
          accountId,
          invoicingAccountId: accountId,
        });
        expect(commercial).toMatchObject({
          merchantOfRecord: "fil_one",
          billingShape: "direct",
          governingAgreementVersion: 1,
          contractualTimeZone: "America/New_York",
        });
        expect(lineSnapshot?.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
        expect(attempt).toMatchObject({
          accountId,
          orderId,
          organizationId: "30000000-0000-4000-8000-000000000001",
          operation: "provision",
          state: "pending",
        });
        const parsedCommand = z
          .object({
            command: z.object({
              commandId: z.string().min(1),
              idempotencyKey: z.string().min(1),
              orderId: z.uuid(),
              organizationId: z.uuid(),
              entitlements: z.array(
                z.object({
                  sku: z.string(),
                  quantity: z.string(),
                  region: z.string(),
                }),
              ),
            }),
          })
          .parse(attempt?.attempt).command;
        expect(parsedCommand).toMatchObject({
          idempotencyKey: `order:${orderId}:v1:provision`,
          orderId,
          organizationId: "30000000-0000-4000-8000-000000000001",
          entitlements: [
            {
              sku: "LOCKED-STORAGE-TB",
              quantity: "1.000000000000000000",
              region: "us-east-2",
            },
          ],
        });
        const events = await tx
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(inArray(auditEvents.aggregateId, [quoteId, orderId]));
        const messages = await tx
          .select({ id: outboxMessages.id })
          .from(outboxMessages)
          .where(
            inArray(
              outboxMessages.eventId,
              events.map((event) => event.id),
            ),
          );
        expect(events).toHaveLength(5);
        expect(messages).toHaveLength(5);
        expect(messages.every((message) => message.id.length > 0)).toBe(true);
        if (!attempt) throw new Error("Provisioning attempt was not persisted");
        const provisioningEvent = await tx.query.auditEvents.findFirst({
          where: eq(auditEvents.aggregateId, attempt.id),
        });
        if (!provisioningEvent)
          throw new Error("Provisioning audit event was not persisted");
        const provisioningMessages = await tx.query.outboxMessages.findMany({
          where: and(
            eq(outboxMessages.eventId, provisioningEvent.id),
            eq(outboxMessages.topic, "order.provisioning_requested"),
          ),
        });
        expect(provisioningMessages).toHaveLength(1);
        return parsedCommand;
      },
    );

    const providerContext = (suffix: string, providerOccurredAt: string) => ({
      requestId: `provisioning-${orderId}-${suffix}`,
      actor: { kind: "provider" as const, id: "provisioning-platform" },
      idempotencyKey: `provisioning-platform:${orderId}:${suffix}`,
      ip: null,
      userAgent: null,
      occurredAt: providerOccurredAt,
      authorization: null,
    });
    const provisioningTenantId = await withInternalTransaction(
      db,
      `provisioning-tenant-${orderId}`,
      async (tx) =>
        (
          await tx.query.organizations.findFirst({
            where: eq(organizations.id, "30000000-0000-4000-8000-000000000001"),
          })
        )?.externalProvisioningId ?? "tenant-northstar-production",
    );
    const failed = await lifecycleRepository.executeInTransaction({
      command: "ingest_provisioning_event",
      payload: {
        type: "provisioning.confirmed",
        confirmationId: `failed-${orderId}`,
        commandId: command.commandId,
        operationId: `operation-${orderId}`,
        status: "failed",
        tenantId: provisioningTenantId,
        resources: [],
        occurredAt: "2026-08-01T00:01:00.000Z",
      },
      context: providerContext("failed", "2026-08-01T00:01:00.000Z"),
    });
    expect(failed.status).toBe("dead_letter");

    const recovered = await lifecycleRepository.executeInTransaction({
      command: "recover_provisioning",
      payload: {
        commandId: command.commandId,
        reason: "Provider incident resolved and verified for retry",
      },
      context: {
        requestId: `recover-${orderId}`,
        actor: {
          kind: "user",
          id: "20000000-0000-4000-8000-000000000001",
        },
        idempotencyKey: `recover:${orderId}`,
        ip: "192.0.2.1",
        userAgent: "Clockwork operator integration",
        occurredAt: "2026-08-01T00:02:00.000Z",
        authorization: {
          userId: ids.user.parse("20000000-0000-4000-8000-000000000001"),
          accountIds: [
            ids.account.parse("10000000-0000-4000-8000-000000000009"),
          ],
          roles: ["internal_operator"],
          isInternalStaff: true,
          mfaVerified: true,
          recentAuthenticationVerified: true,
        },
      },
    });
    expect(recovered.status).toBe("retry_scheduled");

    const successPayload = {
      type: "provisioning.confirmed" as const,
      confirmationId: `success-${orderId}`,
      commandId: command.commandId,
      operationId: `operation-${orderId}`,
      status: "succeeded" as const,
      tenantId: provisioningTenantId,
      resources: [
        {
          entitlementSku: "LOCKED-STORAGE-TB",
          resourceId: `resource-${orderId}`,
        },
      ],
      occurredAt: "2026-08-01T00:03:00.000Z",
    };
    const succeeded = await lifecycleRepository.executeInTransaction({
      command: "ingest_provisioning_event",
      payload: successPayload,
      context: providerContext("succeeded", successPayload.occurredAt),
    });
    expect(succeeded.status).toBe("confirmed");
    const duplicate = await lifecycleRepository.executeInTransaction({
      command: "ingest_provisioning_event",
      payload: successPayload,
      context: providerContext(
        "succeeded-duplicate",
        successPayload.occurredAt,
      ),
    });
    expect(duplicate.status).toBe("confirmed");
    const stale = await lifecycleRepository.executeInTransaction({
      command: "ingest_provisioning_event",
      payload: {
        ...successPayload,
        confirmationId: `stale-${orderId}`,
        status: "failed",
        resources: [],
        occurredAt: "2026-08-01T00:00:30.000Z",
      },
      context: providerContext("stale", "2026-08-01T00:00:30.000Z"),
    });
    expect(stale).toMatchObject({ status: "confirmed", outcome: "stale" });

    await withInternalTransaction(
      db,
      "provisioning-result-assert",
      async (tx) => {
        const [order, attempt, persistedEntitlements] = await Promise.all([
          tx.query.orders.findFirst({ where: eq(orders.id, orderId) }),
          tx.query.lifecycleProvisioningAttempts.findFirst({
            where: eq(lifecycleProvisioningAttempts.orderId, orderId),
          }),
          tx.query.entitlements.findMany({
            where: eq(entitlements.orderId, orderId),
          }),
        ]);
        expect(order?.status).toBe("active");
        expect(attempt?.state).toBe("confirmed");
        expect(persistedEntitlements).toHaveLength(1);
        expect(persistedEntitlements[0]).toMatchObject({
          orderId,
          orderLineId,
          organizationId: "30000000-0000-4000-8000-000000000001",
          sku: "LOCKED-STORAGE-TB",
          committedQuantity: "1.000000000000000000",
          region: "us-east-2",
          provisionedResourceId: `resource-${orderId}`,
          status: "active",
        });
      },
    );

    await withInternalTransaction(
      db,
      "channel-provisioning-scope",
      async (tx) => {
        const channelOrganizationId = "30000000-0000-4000-8000-000000000009";
        await tx
          .insert(organizations)
          .values({
            id: channelOrganizationId,
            accountId: "10000000-0000-4000-8000-000000000004",
            name: "Juniper Production",
            isolated: false,
            workosOrganizationId: "org_local_juniper_production",
          })
          .onConflictDoNothing();
        const channels = [
          {
            channel: "referral",
            orderId: "80000000-0000-4000-8000-000000000002",
            orderLineId: "81000000-0000-4000-8000-000000000002",
            invoicingAccountId: "10000000-0000-4000-8000-000000000004",
            region: "us-east-2",
          },
          {
            channel: "resale",
            orderId: "80000000-0000-4000-8000-000000000003",
            orderLineId: "81000000-0000-4000-8000-000000000003",
            invoicingAccountId: "10000000-0000-4000-8000-000000000003",
            region: "eu-west-1",
          },
          {
            channel: "distributor",
            orderId: "80000000-0000-4000-8000-000000000004",
            orderLineId: "81000000-0000-4000-8000-000000000004",
            invoicingAccountId: "10000000-0000-4000-8000-000000000005",
            region: "us-east-2",
          },
          {
            channel: "marketplace",
            orderId: "80000000-0000-4000-8000-000000000006",
            orderLineId: "81000000-0000-4000-8000-000000000006",
            invoicingAccountId: "10000000-0000-4000-8000-000000000008",
            region: "us-east-2",
          },
        ] as const;
        for (const channel of channels) {
          const persistedOrder = await tx.query.orders.findFirst({
            where: eq(orders.id, channel.orderId),
          });
          if (!persistedOrder)
            throw new Error(`${channel.channel} order missing`);
          expect(persistedOrder).toMatchObject({
            accountId: "10000000-0000-4000-8000-000000000004",
            invoicingAccountId: channel.invoicingAccountId,
          });
          const snapshot = {
            id: channel.orderLineId,
            sku: "LOCKED-STORAGE-TB",
            quantity: "1.000000000000000000",
            region: channel.region,
          };
          const [insertedSnapshot] = await tx
            .insert(orderLineSnapshots)
            .values({
              orderLineId: channel.orderLineId,
              snapshot,
              snapshotHash: coreSnapshotHash(snapshot),
            })
            .onConflictDoNothing()
            .returning();
          const persistedSnapshot =
            insertedSnapshot ??
            (await tx.query.orderLineSnapshots.findFirst({
              where: eq(orderLineSnapshots.orderLineId, channel.orderLineId),
            }));
          if (!persistedSnapshot)
            throw new Error(`${channel.channel} snapshot missing`);
          let attempt = await tx.query.lifecycleProvisioningAttempts.findFirst({
            where: eq(lifecycleProvisioningAttempts.orderId, channel.orderId),
          });
          if (!attempt) {
            attempt = (
              await createAcceptedOrderProvisioningAttempt(tx, {
                orderId: persistedOrder.id,
                orderVersion: persistedOrder.rowVersion,
                accountId: persistedOrder.accountId,
                provisioningIdempotencyKey: `order:${persistedOrder.id}:v1:provision`,
                requestedAt: new Date("2026-07-31T16:00:00.000Z"),
                actor: { kind: "system", id: "channel-scope-fixture" },
                requestId: `channel-scope-${channel.channel}`,
                lineSnapshots: [persistedSnapshot],
              })
            ).attempt;
          }
          expect(attempt).toMatchObject({
            accountId: persistedOrder.accountId,
            orderId: persistedOrder.id,
            organizationId: channelOrganizationId,
          });
          if (channel.channel === "referral") {
            expect(attempt.accountId).toBe(persistedOrder.invoicingAccountId);
          } else {
            expect(attempt.accountId).not.toBe(
              persistedOrder.invoicingAccountId,
            );
          }
        }
      },
    );
  });

  it("derives house-account and prior-deal exclusions from persisted truth", async () => {
    const partnerAccountId = "10000000-0000-4000-8000-000000000002";
    const partnerUserId = "20000000-0000-4000-8000-000000000003";
    const partnerAuthorization: AuthorizationContext = {
      userId: ids.user.parse(partnerUserId),
      accountIds: [ids.account.parse(partnerAccountId)],
      roles: ["partner_admin"],
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    };
    const register = (input: {
      id: string;
      endClientAccountId: string;
      workload: string;
      callerHouseAccountIds: readonly string[];
    }) =>
      repository.mutate({
        resource: "deal_registrations",
        id: input.id,
        accountId: partnerAccountId,
        action: "create",
        payload: {
          partnerAccountId,
          endClientAccountId: input.endClientAccountId,
          workload: input.workload,
          expectedVolume: "10",
          protectionDays: 30,
          houseAccountIds: input.callerHouseAccountIds,
        },
        actor: { kind: "user", id: partnerUserId },
        authorization: partnerAuthorization,
        requestId: `deal-registration-${input.id}`,
        idempotencyKey: `deal-registration-${input.id}`,
        occurredAt,
      });

    const houseId = crypto.randomUUID();
    const priorId = crypto.randomUUID();
    const [house, prior] = await Promise.all([
      register({
        id: houseId,
        endClientAccountId: accountId,
        workload: "Caller cannot suppress a house match",
        callerHouseAccountIds: [],
      }),
      register({
        id: priorId,
        endClientAccountId: "10000000-0000-4000-8000-000000000004",
        workload: "REFERRAL ARCHIVE MODERNIZATION",
        callerHouseAccountIds: [crypto.randomUUID()],
      }),
    ]);
    expect(house.record.data.status).toBe("rejected");
    expect(prior.record.data.status).toBe("rejected");

    await withInternalTransaction(
      db,
      "deal-derived-exclusion-assert",
      async (tx) => {
        const exclusions = await tx
          .select()
          .from(dealRegistrationExclusions)
          .where(
            inArray(dealRegistrationExclusions.registrationId, [
              houseId,
              priorId,
            ]),
          );
        expect(exclusions).toHaveLength(2);
        expect(exclusions.map((exclusion) => exclusion.kind).sort()).toEqual([
          "house_account",
          "prior_deal",
        ]);
        expect(
          exclusions.every(
            (exclusion) =>
              (exclusion.evidence as { source?: string }).source ===
              "unified_account_and_active_deal_records",
          ),
        ).toBe(true);
      },
    );
  });
});
