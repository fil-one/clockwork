import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { ids, MoneySchema } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { issueQuote, type QuoteSnapshot } from "@clockwork/domain/core";
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
  quoteLines,
  quotes,
} from "../../schema";
import {
  accountCommercialProfiles,
  dealRegistrationExclusions,
  orderCommercialProfiles,
  orderLineSnapshots,
  quoteCommercialProfiles,
  quoteSnapshots,
} from "../../schema/core/finance";
import { commercialArtifactRequests } from "../../schema/core/commercial-artifacts";
import { lifecycleProvisioningAttempts } from "../../schema/lifecycle/platform";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
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

async function issuedChannelQuoteFixture(input: {
  sourceQuoteId: string;
  signerUserId: string;
  suffix: string;
}): Promise<{ quoteId: string; quoteLineId: string }> {
  return withInternalTransaction(
    db,
    `issued-channel-quote-${input.suffix}`,
    async (tx) => {
      const sourceQuote = await tx.query.quotes.findFirst({
        where: eq(quotes.id, input.sourceQuoteId),
      });
      const sourceLine = sourceQuote
        ? await tx.query.quoteLines.findFirst({
            where: eq(quoteLines.quoteId, sourceQuote.id),
          })
        : undefined;
      const sourceProfile = sourceQuote
        ? await tx.query.quoteCommercialProfiles.findFirst({
            where: eq(quoteCommercialProfiles.quoteId, sourceQuote.id),
          })
        : undefined;
      const priceBook = sourceQuote
        ? await tx.query.priceBooks.findFirst({
            where: (row, { eq: equals }) =>
              equals(row.id, sourceQuote.priceBookId),
          })
        : undefined;
      const rateCard = sourceLine
        ? await tx.query.rateCards.findFirst({
            where: (row, { eq: equals }) =>
              equals(row.id, sourceLine.rateCardId),
          })
        : undefined;
      if (
        !sourceQuote ||
        !sourceLine ||
        !sourceProfile ||
        !priceBook ||
        !rateCard
      )
        throw new Error("CHANNEL_ORDER_SOURCE_FIXTURE_MISSING");
      const currency = z
        .enum(["USD", "EUR", "GBP"])
        .parse(sourceQuote.currency);
      const route = z
        .enum(["referral", "resale", "distributor"])
        .parse(sourceProfile.channelShape);
      const quoteId = crypto.randomUUID();
      const quoteLineId = crypto.randomUUID();
      const draft: QuoteSnapshot = {
        id: quoteId,
        seriesId: crypto.randomUUID(),
        revision: 1,
        accountId: sourceQuote.accountId,
        ...(sourceQuote.endClientAccountId
          ? { endClientAccountId: sourceQuote.endClientAccountId }
          : {}),
        ...(sourceQuote.partnerAccountId
          ? { partnerAccountId: sourceQuote.partnerAccountId }
          : {}),
        priceBook: { id: priceBook.id, version: priceBook.version },
        route,
        status: "draft",
        lines: [
          {
            id: quoteLineId,
            rateCardId: rateCard.id,
            sku: sourceLine.sku,
            region: rateCard.region,
            unit: rateCard.unit,
            approvedClaim: rateCard.approvedClaim,
            quantity: sourceLine.quantity,
            termMonths: sourceLine.termMonths,
            unitPrice: testMoney(
              currency,
              sourceLine.unitPriceMinor.toString(),
            ),
            listUnitPrice: testMoney(
              currency,
              sourceLine.unitPriceMinor.toString(),
            ),
            ...(rateCard.floorPriceMinor === null
              ? {}
              : {
                  floorPrice: testMoney(
                    currency,
                    rateCard.floorPriceMinor.toString(),
                  ),
                }),
            overageRate: testMoney(
              currency,
              sourceLine.overageRateMinor.toString(),
            ),
            lineTotal: testMoney(
              currency,
              sourceLine.lineTotalMinor.toString(),
            ),
            discountBps: sourceLine.discountBps,
            commitType: z
              .enum(["period_allowance", "term_drawdown"])
              .parse(rateCard.commitType),
            stripeTaxCode: rateCard.stripeTaxCode,
            qboIncomeAccount: rateCard.qboIncomeAccount,
            marginResult: z
              .enum(["not_configured", "pass", "exception_required"])
              .parse(sourceQuote.marginFloorResult),
          },
        ],
        total: testMoney(currency, sourceQuote.totalMinor.toString()),
        ...(sourceQuote.partnerResaleTotalMinor === null
          ? {}
          : {
              partnerResaleTotal: testMoney(
                currency,
                sourceQuote.partnerResaleTotalMinor.toString(),
              ),
            }),
        marginResult: z
          .enum(["not_configured", "pass", "approved", "rejected"])
          .parse(sourceQuote.marginFloorResult),
        exceptionReasons: [],
        expiresAt: sourceQuote.expiresAt.toISOString(),
        createdBy: input.signerUserId,
        createdAt: occurredAt,
      };
      const issued = issueQuote(draft, {
        issuedAt: occurredAt,
        renderedDocumentId: z.uuid().parse(sourceQuote.renderedDocumentId),
        ...(route === "resale" || route === "distributor"
          ? {
              partnerDocumentId: z.uuid().parse(sourceQuote.partnerDocumentId),
            }
          : {}),
      });
      await tx.insert(quotes).values({
        ...sourceQuote,
        id: quoteId,
        seriesId: issued.seriesId,
        previousRevisionId: null,
        status: "issued",
        createdBy: input.signerUserId,
        rowVersion: 1,
      });
      await tx.insert(quoteLines).values({
        ...sourceLine,
        id: quoteLineId,
        quoteId,
      });
      await tx.insert(quoteCommercialProfiles).values({
        ...sourceProfile,
        quoteId,
        pricingInputs: { source: "isolated-channel-order-fixture" },
      });
      await tx.insert(quoteSnapshots).values({
        quoteId,
        revision: 1,
        snapshot: issued,
        snapshotHash: coreSnapshotHash(issued),
        issuedAt: new Date(issued.issuedAt ?? occurredAt),
        createdBy: input.signerUserId,
      });
      return { quoteId, quoteLineId };
    },
  );
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
    ).rejects.toMatchObject({ cause: { code: "42501" } });
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

  it("rejects caller-supplied partner transfer tiers that differ from persisted policy", async () => {
    const distributorAccountId = "10000000-0000-4000-8000-000000000005";
    const distributorUserId = "20000000-0000-4000-8000-000000000005";
    await expect(
      repository.mutate({
        resource: "quotes",
        id: crypto.randomUUID(),
        accountId: "10000000-0000-4000-8000-000000000004",
        action: "create",
        payload: {
          priceBookId: "60000000-0000-4000-8000-000000000001",
          seriesId: crypto.randomUUID(),
          route: "distributor",
          endClientAccountId: "10000000-0000-4000-8000-000000000004",
          partnerAccountId: distributorAccountId,
          partnerTier: "silver",
          partnerResaleTotal: { currency: "USD", minor: "180000" },
          lines: [
            {
              lineId: crypto.randomUUID(),
              sku: "LOCKED-STORAGE-TB",
              region: "us-east-2",
              quantity: "1",
              termMonths: 12,
            },
          ],
          expiresAt: "2026-12-31T23:59:59.000Z",
        },
        actor: { kind: "user", id: distributorUserId },
        authorization: {
          userId: ids.user.parse(distributorUserId),
          accountIds: [ids.account.parse(distributorAccountId)],
          roles: ["partner_admin"],
          isInternalStaff: false,
          mfaVerified: true,
          recentAuthenticationVerified: true,
        },
        requestId: `forged-partner-tier-${runId}`,
        idempotencyKey: testKey("forged-partner-tier"),
        occurredAt,
      }),
    ).rejects.toThrow(
      "Partner transfer pricing tier must match persisted partner policy",
    );
  });

  it("persists referral, resale, and distributor orders for their authoritative legal parties", async () => {
    const channels = [
      {
        channel: "referral",
        sourceQuoteId: "70000000-0000-4000-8000-000000000002",
        signerUserId: "20000000-0000-4000-8000-000000000004",
        authorizationAccountId: "10000000-0000-4000-8000-000000000004",
        role: "owner" as const,
        invoicingAccountId: "10000000-0000-4000-8000-000000000004",
        governingAgreementId: "51000000-0000-4000-8000-000000000007",
        partnerAgreementId: "51000000-0000-4000-8000-000000000008",
      },
      {
        channel: "resale",
        sourceQuoteId: "70000000-0000-4000-8000-000000000003",
        signerUserId: "20000000-0000-4000-8000-000000000008",
        authorizationAccountId: "10000000-0000-4000-8000-000000000003",
        role: "partner_admin" as const,
        invoicingAccountId: "10000000-0000-4000-8000-000000000003",
        governingAgreementId: "51000000-0000-4000-8000-000000000003",
        partnerAgreementId: "51000000-0000-4000-8000-000000000003",
      },
      {
        channel: "distributor",
        sourceQuoteId: "70000000-0000-4000-8000-000000000004",
        signerUserId: "20000000-0000-4000-8000-000000000005",
        authorizationAccountId: "10000000-0000-4000-8000-000000000005",
        role: "partner_admin" as const,
        invoicingAccountId: "10000000-0000-4000-8000-000000000005",
        governingAgreementId: "51000000-0000-4000-8000-000000000004",
        partnerAgreementId: "51000000-0000-4000-8000-000000000004",
      },
    ];

    for (const channel of channels) {
      const suffix = `${channel.channel}-${crypto.randomUUID().slice(0, 8)}`;
      const fixture = await issuedChannelQuoteFixture({
        sourceQuoteId: channel.sourceQuoteId,
        signerUserId: channel.signerUserId,
        suffix,
      });
      const channelAuthorization: AuthorizationContext = {
        userId: ids.user.parse(channel.signerUserId),
        accountIds: [ids.account.parse(channel.authorizationAccountId)],
        roles: [channel.role],
        isInternalStaff: false,
        mfaVerified: true,
        recentAuthenticationVerified: true,
      };
      const orderId = crypto.randomUUID();
      const channelOrderLineId = crypto.randomUUID();
      const orderCommand = {
        quoteId: fixture.quoteId,
        signerUserId: channel.signerUserId,
        authorityTitle:
          channel.role === "owner" ? "Chief Demo Officer" : "Partner Director",
        authorityAttested: true as const,
        serviceStartsOn: "2026-08-01",
        serviceEndsOn: "2027-07-31",
        noticeOn: "2027-06-01",
        acceptedAt: "2026-08-01T00:00:00.000Z",
        orderLineIds: [channelOrderLineId],
      };

      if (channel.channel === "resale") {
        const endClientUserId = "20000000-0000-4000-8000-000000000004";
        await expect(
          repository.mutate({
            resource: "orders",
            id: crypto.randomUUID(),
            accountId: "10000000-0000-4000-8000-000000000004",
            action: "prepare_artifact",
            payload: {
              ...orderCommand,
              signerUserId: endClientUserId,
              retainUntil: "2033-08-01T00:00:00.000Z",
            },
            actor: { kind: "user", id: endClientUserId },
            authorization: {
              userId: ids.user.parse(endClientUserId),
              accountIds: [
                ids.account.parse("10000000-0000-4000-8000-000000000004"),
              ],
              roles: ["owner"],
              isInternalStaff: false,
              mfaVerified: true,
              recentAuthenticationVerified: true,
            },
            requestId: `forged-resale-acceptance-${suffix}`,
            idempotencyKey: testKey(`forged-resale-acceptance-${suffix}`),
            occurredAt: "2026-08-01T00:00:00.000Z",
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }

      const prepared = await repository.mutate({
        resource: "orders",
        id: orderId,
        accountId: "10000000-0000-4000-8000-000000000004",
        action: "prepare_artifact",
        payload: {
          ...orderCommand,
          retainUntil: "2033-08-01T00:00:00.000Z",
        },
        actor: { kind: "user", id: channel.signerUserId },
        authorization: channelAuthorization,
        requestId: `channel-order-artifact-${suffix}`,
        idempotencyKey: testKey(`channel-order-artifact-${suffix}`),
        occurredAt: "2026-08-01T00:00:00.000Z",
      });
      const orderDocumentId = await persistTestArtifact(
        prepared,
        `channel-order-${suffix}`,
      );
      const accepted = await repository.mutate({
        resource: "orders",
        id: orderId,
        accountId: "10000000-0000-4000-8000-000000000004",
        action: "create",
        payload: { ...orderCommand, orderFormDocumentId: orderDocumentId },
        actor: { kind: "user", id: channel.signerUserId },
        authorization: channelAuthorization,
        requestId: `channel-order-accept-${suffix}`,
        idempotencyKey: testKey(`channel-order-accept-${suffix}`),
        occurredAt: "2026-08-01T00:00:00.000Z",
      });
      expect(accepted.record.data).toMatchObject({
        status: "accepted",
        sourcing: channel.channel,
        accountId: "10000000-0000-4000-8000-000000000004",
        invoicingAccountId: channel.invoicingAccountId,
        acceptanceReservation: { decision: "approved" },
      });
      await withInternalTransaction(
        db,
        `channel-order-assert-${suffix}`,
        async (tx) => {
          const [persistedOrder, profile, attempt] = await Promise.all([
            tx.query.orders.findFirst({ where: eq(orders.id, orderId) }),
            tx.query.orderCommercialProfiles.findFirst({
              where: eq(orderCommercialProfiles.orderId, orderId),
            }),
            tx.query.lifecycleProvisioningAttempts.findFirst({
              where: eq(lifecycleProvisioningAttempts.orderId, orderId),
            }),
          ]);
          expect(persistedOrder).toMatchObject({
            agreementId: channel.governingAgreementId,
            invoicingAccountId: channel.invoicingAccountId,
            signerUserId: channel.signerUserId,
          });
          expect(profile).toMatchObject({
            buyerAgreementId: "51000000-0000-4000-8000-000000000007",
            partnerAgreementId: channel.partnerAgreementId,
          });
          expect(attempt).toMatchObject({
            accountId: "10000000-0000-4000-8000-000000000004",
            orderId,
            organizationId: "30000000-0000-4000-8000-000000000003",
            operation: "provision",
            state: "pending",
          });
          if (channel.channel === "referral") {
            expect(attempt?.accountId).toBe(channel.invoicingAccountId);
          } else {
            expect(attempt?.accountId).not.toBe(channel.invoicingAccountId);
          }
        },
      );
    }
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
      signerUserId: userId,
      authorityTitle: "Chief Demo Officer",
      authorityAttested: true as const,
      serviceStartsOn: "2026-08-01",
      serviceEndsOn: "2027-07-31",
      noticeOn: "2027-06-01",
      acceptedAt: "2026-08-01T00:00:00.000Z",
      orderLineIds: [orderLineId],
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
    await withInternalTransaction(
      db,
      `core-owner-credit-fixture-${runId}`,
      async (tx) => {
        await tx
          .update(accountCommercialProfiles)
          .set({
            creditStatus: "approved",
            approvedCreditLimitMinor: 5_000_000n,
            currentExposureMinor: 0n,
            newServiceBlocked: false,
            blockReason: null,
          })
          .where(eq(accountCommercialProfiles.accountId, accountId));
      },
    );
    await expect(
      repository.mutate({
        resource: "orders",
        id: orderId,
        accountId,
        action: "create",
        payload: {
          ...orderCommand,
          orderFormDocumentId: orderDocumentId,
          agreementId: "51000000-0000-4000-8000-000000000002",
          partnerAccountId: "10000000-0000-4000-8000-000000000003",
        },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: "core-owner-order-forged-counterparty",
        idempotencyKey: testKey("core-owner-order-forged-counterparty"),
        occurredAt: "2026-08-01T00:00:00.000Z",
      }),
    ).rejects.toThrow();
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
      acceptanceReservation: {
        decision: "approved",
        reason: "authoritative_checks_passed",
        reviewCaseId: null,
      },
    });
    await expect(
      repository.mutate({
        resource: "orders",
        id: orderId,
        accountId,
        action: "activate",
        expectedVersion: accepted.record.rowVersion,
        payload: {},
        actor: { kind: "user", id: userId },
        authorization,
        requestId: "core-owner-order-force-activate",
        idempotencyKey: testKey("core-owner-order-force-activate"),
        occurredAt: "2026-08-01T00:02:00.000Z",
      }),
    ).rejects.toThrow(
      "Order state changes require provider confirmation or lifecycle offboarding",
    );

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
          contractualTimeZone: "UTC",
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
        expect(events).toHaveLength(3);
        expect(messages).toHaveLength(3);
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

    await withInternalTransaction(
      db,
      "channel-provisioning-scope",
      async (tx) => {
        const channels = [
          {
            channel: "referral",
            orderId: "80000000-0000-4000-8000-000000000002",
            invoicingAccountId: "10000000-0000-4000-8000-000000000004",
          },
          {
            channel: "resale",
            orderId: "80000000-0000-4000-8000-000000000003",
            invoicingAccountId: "10000000-0000-4000-8000-000000000003",
          },
          {
            channel: "distributor",
            orderId: "80000000-0000-4000-8000-000000000004",
            invoicingAccountId: "10000000-0000-4000-8000-000000000005",
          },
          {
            channel: "marketplace",
            orderId: "80000000-0000-4000-8000-000000000006",
            invoicingAccountId: "10000000-0000-4000-8000-000000000004",
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
        }
      },
    );
  });

  it("meters an accepted order through the commitment ledger and trues it up", async () => {
    const ledgerId = crypto.randomUUID();
    const command = (
      action: string,
      payload: Record<string, unknown>,
      label: string,
    ) =>
      repository.mutate({
        resource: "commitments",
        id: ledgerId,
        accountId,
        action,
        payload,
        actor: { kind: "user", id: userId },
        authorization,
        requestId: `core-commitment-${label}`,
        idempotencyKey: testKey(`core-commitment-${label}`),
        occurredAt: "2026-09-15T00:00:00.000Z",
      });

    const created = await command(
      "create",
      {
        orderId,
        orderLineId,
        commitType: "period_allowance",
        contractualTimeZone: "America/New_York",
        periods: [
          {
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2027-02-01T00:00:00.000Z",
            allowanceQuantity: "10",
          },
          {
            startsAt: "2027-02-01T00:00:00.000Z",
            endsAt: "2027-08-01T00:00:00.000Z",
            allowanceQuantity: "10",
          },
        ],
      },
      "create",
    );
    expect(created.record.data).toMatchObject({
      id: ledgerId,
      orderId,
      commitType: "period_allowance",
    });

    const metered = await command(
      "record_usage",
      {
        events: [
          {
            externalEventId: `meter-${runId}-1`,
            measuredAt: "2026-09-01T00:00:00.000Z",
            quantity: "6",
            meter: "storage",
          },
        ],
      },
      "usage-1",
    );
    expect(metered.record.data).toMatchObject({
      authority: "commitment_ledger",
      totalConsumed: "6",
      totalOverage: "0",
    });

    // A second delivery of the same provider event must not consume twice.
    const redelivered = await repository.mutate({
      resource: "commitments",
      id: ledgerId,
      accountId,
      action: "record_usage",
      payload: {
        events: [
          {
            externalEventId: `meter-${runId}-1`,
            measuredAt: "2026-09-01T00:00:00.000Z",
            quantity: "6",
            meter: "storage",
          },
        ],
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-commitment-usage-redelivery",
      idempotencyKey: testKey("core-commitment-usage-redelivery"),
      occurredAt: "2026-09-16T00:00:00.000Z",
    });
    expect(redelivered.record.data).toMatchObject({
      totalConsumed: "6",
      duplicateUsageEventIds: [`meter-${runId}-1`],
    });

    const exceeded = await command(
      "record_usage",
      {
        events: [
          {
            externalEventId: `meter-${runId}-2`,
            measuredAt: "2026-10-01T00:00:00.000Z",
            quantity: "7",
            meter: "storage",
          },
        ],
      },
      "usage-2",
    );
    expect(exceeded.record.data).toMatchObject({
      totalConsumed: "13",
      totalOverage: "3",
    });

    const corrected = await command(
      "correct_usage",
      {
        externalEventId: `meter-${runId}-2-correction`,
        correctsExternalEventId: `meter-${runId}-2`,
        measuredAt: "2026-10-01T00:00:00.000Z",
        quantityDelta: "-3",
        meter: "storage",
        reasonCode: "over_reported_by_provider",
        sourceReference: `SUP-${runId}-1`,
      },
      "correction",
    );
    expect(corrected.record.data).toMatchObject({
      totalConsumed: "10",
      totalOverage: "0",
    });
    expect(corrected.record.data.correctionId).toBeDefined();

    // Reducing the contracted allowance puts the same consumption into overage.
    const amended = await command(
      "amend_allowance",
      {
        effectiveAt: "2026-09-01T00:00:00.000Z",
        quantityDelta: "-4",
        reason: "amendment",
        sourceReference: `AMD-${runId}-1`,
      },
      "allowance",
    );
    expect(amended.record.data).toMatchObject({
      totalConsumed: "10",
      totalOverage: "4",
    });

    const renewed = await command(
      "renew",
      {
        startsAt: "2027-08-01T00:00:00.000Z",
        endsAt: "2028-02-01T00:00:00.000Z",
        allowanceQuantity: "10",
        sourceReference: `RNW-${runId}-1`,
      },
      "renew",
    );
    expect(renewed.record.data).toMatchObject({
      periodEndsAt: "2028-02-01T00:00:00.000Z",
      totalOverage: "4",
    });

    const reconciled = await command(
      "reconcile",
      {
        sourceSystem: "provisioning-meter",
        records: [
          { externalEventId: `meter-${runId}-1`, quantity: "6" },
          { externalEventId: `meter-${runId}-2`, quantity: "7" },
        ],
      },
      "reconcile",
    );
    expect(reconciled.record.data).toMatchObject({
      status: "variance",
      ledgerQuantity: "10",
      sourceQuantity: "13",
      varianceQuantity: "3",
      missingFromSource: [`meter-${runId}-2-correction`],
    });
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
