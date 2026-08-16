import { createHash } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { ids, MoneySchema } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { issueQuote, type QuoteSnapshot } from "@clockwork/domain/core";
import { exceptionQueues } from "@clockwork/domain/lifecycle";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createRuntimeDatabase } from "../../client";
import {
  accounts,
  agreements,
  amendmentLines,
  amendments,
  auditEvents,
  entitlements,
  invoices,
  keyTerms,
  orderLines,
  orders,
  organizations,
  outboxMessages,
  procurementProfiles,
  quoteLines,
  quotes,
} from "../../schema";
import {
  accountCommercialProfiles,
  amendmentFinancialTerms,
  amendmentLineSupersessions,
  billingPolicies,
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
import { DatabaseCoreWorkflowDispatchStore } from "../workflows/core-dispatch";
import { quoteArtifactDefinition } from "./artifact-definitions";
import {
  assertCommercialArtifactBinding,
  CommercialArtifactRequestSchema,
  DatabaseCommercialArtifactStore,
} from "./commercial-artifacts";
import {
  DatabaseCoreError,
  DatabaseCoreFinanceRepository,
  initialInvoiceId,
  invoiceAmendmentDrift,
} from "./database-finance";
import { FixtureTaxPort } from "./tax-fixture";
import { coreSnapshotHash } from "./finance";
import { loadInvoiceDerivation } from "./invoice-derivation";

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
  tax: new FixtureTaxPort(),
});
// Three engines, three answers, none of them a rule this repository ships. The
// rates and the jurisdiction lists live in the fixture; EXT-TAX-01 owns the
// real ones, and until it lands the only thing production can compose is an
// HTTP adapter it has no endpoint for.
const taxedRepository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
  tax: new FixtureTaxPort({ rateBasisPoints: { txcd_demo: 2_000 } }),
});
const reverseChargedRepository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
  tax: new FixtureTaxPort({
    rateBasisPoints: { txcd_demo: 2_000 },
    reverseChargeJurisdictions: ["ES"],
  }),
});
const undeterminedTaxRepository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
  // Every jurisdiction the seeded channels invoice in, so the probe below is
  // the same refusal whichever party the route makes merchant of record.
  tax: new FixtureTaxPort({ unavailableJurisdictions: ["US", "ES", "GB"] }),
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
      // EXT-TAX-01's stated behaviour until an approved engine exists: refuse
      // the acceptance rather than accept an order that can only ever be
      // invoiced net. prepare_artifact above is deliberately not gated — it
      // renders an unsigned order form and commits the customer to nothing.
      const refusedAcceptance = await undeterminedTaxRepository
        .mutate({
          resource: "orders",
          id: orderId,
          accountId: "10000000-0000-4000-8000-000000000004",
          action: "create",
          payload: { ...orderCommand, orderFormDocumentId: orderDocumentId },
          actor: { kind: "user", id: channel.signerUserId },
          authorization: channelAuthorization,
          requestId: `channel-order-accept-no-tax-${suffix}`,
          idempotencyKey: testKey(`channel-order-accept-no-tax-${suffix}`),
          occurredAt: "2026-08-01T00:00:00.000Z",
        })
        .catch((error: unknown) => error);
      expect(refusedAcceptance).toBeInstanceOf(DatabaseCoreError);
      expect(refusedAcceptance).toMatchObject({ code: "INVALID_STATE" });
      expect((refusedAcceptance as Error).message).toContain("EXT-TAX-01");
      const unaccepted = await withInternalTransaction(
        db,
        `channel-order-unaccepted-${suffix}`,
        async (tx) =>
          tx.query.orders.findFirst({ where: eq(orders.id, orderId) }),
      );
      expect(unaccepted).toBeUndefined();

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

      // The merchant of record bills the partner on a resale route, so the
      // jurisdiction the determination is made in is Blue Harbor's (ES), not
      // the end client's (US). A reverse-charged supply is billed net and says
      // so: `reverse_charge_eligible` had exactly one hit in the tree before
      // this work — a Drizzle column nothing read and nothing wrote — and no
      // code determined EU or UK treatment at all.
      if (channel.channel === "resale") {
        const reverseCharged = await reverseChargedRepository.mutate({
          resource: "invoices",
          id: crypto.randomUUID(),
          accountId: channel.invoicingAccountId,
          action: "create",
          payload: { orderId, dueAt: "2026-10-01T00:00:00.000Z" },
          actor: { kind: "user", id: channel.signerUserId },
          // The acceptance role signs orders; invoices are written under the
          // partner's billing role, which is what invoices' insert policy
          // admits.
          authorization: { ...channelAuthorization, roles: ["billing"] },
          requestId: `channel-order-reverse-charge-${suffix}`,
          idempotencyKey: testKey(`channel-order-reverse-charge-${suffix}`),
          occurredAt: "2026-08-01T01:00:00.000Z",
        });
        // The same fixture rates txcd_demo at 2000 bps. It is not applied here,
        // and that is the point: the treatment decides, not the rate table.
        expect(reverseCharged.record.data).toMatchObject({
          orderId,
          currency: "EUR",
          amountMinor: "168000",
          taxMinor: "0",
          taxTreatment: "reverse_charge",
        });
      }
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

    // The provisioning-draft writer is the other writer of this invoice row and
    // fails closed on the same input. It used to reach the insert with a
    // literal zero in every tax column; now the order is provisioned, eligible
    // and still unbilled when no determination can be had.
    //
    // The seeded policy for this account requires a PO and this order carries
    // none, which the writer checks first — deliberately, so an ineligible
    // order fails with the reason it is ineligible rather than with a tax error
    // about an invoice it was never going to write. The requirement is lifted
    // for the probe and put back immediately.
    const restoreRequirePo = async (requirePo: boolean) =>
      withInternalTransaction(
        db,
        `core-owner-draft-no-tax-policy-${runId}-${String(requirePo)}`,
        async (tx) => {
          await tx
            .update(billingPolicies)
            .set({ requirePo })
            .where(eq(billingPolicies.accountId, accountId));
        },
      );
    await restoreRequirePo(false);
    await expect(
      new DatabaseCoreWorkflowDispatchStore(
        db,
        authorizationSecret,
        new FixtureTaxPort({ unavailableJurisdictions: ["US"] }),
      ).ensureInvoiceDraftForProvisionedOrder({
        orderId,
        requestId: `core-owner-draft-no-tax-${runId}`,
        occurredAt: "2026-08-15T12:00:00.000Z",
      }),
    ).rejects.toThrow("EXT-TAX-01");
    await restoreRequirePo(true);
    const undraftedInvoices = await withInternalTransaction(
      db,
      `core-owner-draft-no-tax-count-${runId}`,
      async (tx) =>
        tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.orderId, orderId)),
    );
    expect(undraftedInvoices).toEqual([]);

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

    // The amendment is worth money, so the money has to be at rest. One more
    // unit for the whole term is a 10000 minor full-period delta taken daily
    // from 2026-09-01: 333 of the term's 364 days remain, so 10000 x 333 / 364
    // = 9148.35..., which rounds to 9148 minor billable, and the run-rate moves
    // by 10000 / 12 = 833 a month.
    const amendmentMoney = await withInternalTransaction(
      db,
      `core-owner-amendment-money-${runId}`,
      async (tx) => {
        const [deltaLines, terms, supersessions, line, persistedQuote] =
          await Promise.all([
            tx.query.amendmentLines.findMany({
              where: eq(amendmentLines.amendmentId, amendmentId),
            }),
            tx.query.amendmentFinancialTerms.findFirst({
              where: eq(amendmentFinancialTerms.amendmentId, amendmentId),
            }),
            tx.query.amendmentLineSupersessions.findMany({
              where: eq(amendmentLineSupersessions.amendmentId, amendmentId),
            }),
            tx.query.orderLines.findFirst({
              where: eq(orderLines.id, orderLineId),
            }),
            tx.query.quotes.findFirst({ where: eq(quotes.id, quoteId) }),
          ]);
        return { deltaLines, terms, supersessions, line, persistedQuote };
      },
    );
    expect(amendmentMoney.deltaLines).toHaveLength(1);
    expect(amendmentMoney.deltaLines[0]).toMatchObject({
      orderLineId,
      sku: "LOCKED-STORAGE-TB",
      quantityDelta: "1.000000000000000000",
      // The unprorated contractual delta. The prorated one lives on the
      // supersession; storing only the quotient would lose this.
      priceDeltaMinor: 10_000n,
    });
    expect(amendmentMoney.terms).toMatchObject({
      prorationConvention: "actual_actual",
      periodStartsOn: "2026-08-01",
      periodEndsOn: "2027-07-31",
      billableNumerator: 333,
      billableDenominator: 364,
      currency: "USD",
      forecastDeltaMinor: 9_148n,
      monthlyDeltaMinor: 833n,
    });
    expect(amendmentMoney.supersessions).toHaveLength(1);
    expect(amendmentMoney.supersessions[0]).toMatchObject({
      supersededOrderLineId: orderLineId,
      effectiveOn: "2026-09-01",
      netQuantityDelta: "1.000000000000000000",
      netRevenueDeltaMinor: 9_148n,
    });
    expect(amendmentMoney.line?.supersededByAmendmentId).toBe(amendmentId);

    // The provisioning-time draft writer bills the same truth. It cannot
    // render an amended amount into the immutable document snapshot 001300
    // binds to the quoted lines, so it refuses rather than bills the quote
    // total past the amendment. Reached by returning the order to `active`,
    // the one status that path accepts, which is a transition the order state
    // machine already allows.
    const dispatchStore = new DatabaseCoreWorkflowDispatchStore(
      db,
      authorizationSecret,
      new FixtureTaxPort(),
    );
    await withInternalTransaction(
      db,
      `core-owner-amended-active-${runId}`,
      async (tx) => {
        await tx
          .update(orders)
          .set({ status: "active" })
          .where(eq(orders.id, orderId));
      },
    );
    await expect(
      dispatchStore.ensureInvoiceDraftForProvisionedOrder({
        orderId,
        requestId: `core-owner-amended-draft-${runId}`,
        occurredAt: "2026-08-16T12:00:00.000Z",
      }),
    ).rejects.toThrow("PROVISIONED_ORDER_AMENDED_BEFORE_INVOICE");
    await withInternalTransaction(
      db,
      `core-owner-amended-restore-${runId}`,
      async (tx) => {
        await tx
          .update(orders)
          .set({ status: "amended" })
          .where(eq(orders.id, orderId));
      },
    );

    const quoteTotalMinor = amendmentMoney.persistedQuote?.totalMinor;
    const unitPriceMinor = amendmentMoney.line?.unitPriceMinor;
    if (quoteTotalMinor === undefined || unitPriceMinor === undefined)
      throw new Error("amended order fixture is missing its priced truth");
    const amendedInvoiceId = crypto.randomUUID();

    // P0-61. A provider that cannot answer is a refusal, not a zero: billing
    // net because a tax call failed is the under-invoice the whole path exists
    // to prevent, and nothing about it is visible on the invoice afterwards.
    const refusedInvoice = await undeterminedTaxRepository
      .mutate({
        resource: "invoices",
        id: crypto.randomUUID(),
        accountId,
        action: "create",
        payload: { orderId, dueAt: "2026-10-15T00:00:00.000Z" },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: "core-owner-amended-invoice-no-determination",
        idempotencyKey: testKey("core-owner-amended-invoice-no-determination"),
        occurredAt: "2026-08-16T15:00:00.000Z",
      })
      .catch((error: unknown) => error);
    expect(refusedInvoice).toBeInstanceOf(DatabaseCoreError);
    expect(refusedInvoice).toMatchObject({ code: "INVALID_STATE" });
    expect((refusedInvoice as Error).message).toContain("EXT-TAX-01");
    const stillUnbilled = await withInternalTransaction(
      db,
      `core-owner-amended-unbilled-${runId}`,
      async (tx) =>
        tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.orderId, orderId)),
    );
    expect(stillUnbilled).toEqual([]);

    const amendedInvoice = await taxedRepository.mutate({
      resource: "invoices",
      id: amendedInvoiceId,
      accountId,
      action: "create",
      payload: {
        orderId,
        dueAt: "2026-10-15T00:00:00.000Z",
        // Everything below is the caller's and none of it is the invoice's:
        // an invoice states the order's persisted truth, so the writer takes
        // the provider identifier, currency, amount and PO from the order and
        // its accepted quote instead.
        stripeInvoiceId: "in_untrusted",
        currency: "EUR",
        amountMinor: "1",
        poNumber: "PO-UNTRUSTED",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-owner-amended-invoice",
      idempotencyKey: testKey("core-owner-amended-invoice"),
      occurredAt: "2026-08-16T16:00:00.000Z",
    });
    // An invoice written after the amendment bills the amendment. Before this,
    // the customer signed the upgrade and was billed the untouched quote.
    //
    // And it bills the tax on both. The fixture rates txcd_demo at 2000 bps, so
    // the quoted 180000 carries 36000 and the amended 9148 carries 1830 (1829.6
    // rounded away from zero), for 37830 on a net of 189148 and an amount owed
    // of 226978. Before this, all three tax_minor columns took a literal zero
    // and the customer in a tax-bearing jurisdiction was billed net.
    expect(amendedInvoice.record.data).toMatchObject({
      orderId,
      accountId,
      stripeInvoiceId: null,
      currency: amendmentMoney.persistedQuote?.currency,
      amountMinor: (quoteTotalMinor + 9_148n + 37_830n).toString(),
      taxMinor: "37830",
      taxTreatment: "standard",
      poNumber: null,
      status: "draft",
    });
    expect(quoteTotalMinor).toBe(180_000n);
    // The invoice is identified by the order it bills, not by the identifier
    // the caller posted, and it is the identifier the provisioning-draft writer
    // derives for the same order.
    const persistedInvoiceId = amendedInvoice.record.id;
    expect(persistedInvoiceId).toBe(initialInvoiceId(orderId));
    expect(persistedInvoiceId).not.toBe(amendedInvoiceId);

    // A second create with its own identifier and its own idempotency key is
    // the double bill: same order, same accepted quote, same amount, nothing
    // in the payload marking it as a second period because the table has no
    // way to say so. It is refused, and the order still owes one invoice.
    await expect(
      repository.mutate({
        resource: "invoices",
        id: crypto.randomUUID(),
        accountId,
        action: "create",
        payload: { orderId, dueAt: "2026-11-15T00:00:00.000Z" },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: "core-owner-amended-invoice-repeat",
        idempotencyKey: testKey("core-owner-amended-invoice-repeat"),
        occurredAt: "2026-08-16T17:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    const billedOnce = await withInternalTransaction(
      db,
      `core-owner-amended-invoice-count-${runId}`,
      async (tx) =>
        tx
          .select({
            id: invoices.id,
            amountMinor: invoices.amountMinor,
            taxMinor: invoices.taxMinor,
            taxTreatment: invoices.taxTreatment,
          })
          .from(invoices)
          .where(eq(invoices.orderId, orderId)),
    );
    expect(billedOnce).toEqual([
      {
        id: persistedInvoiceId,
        amountMinor: quoteTotalMinor + 9_148n + 37_830n,
        taxMinor: 37_830n,
        taxTreatment: "standard",
      },
    ]);

    const derivation = await withInternalTransaction(
      db,
      `core-owner-amended-derivation-${runId}`,
      async (tx) => loadInvoiceDerivation(tx, persistedInvoiceId),
    );
    // The derivation view no longer reads an amended order as unamended: the
    // supersession is in the line, named, and carried into its amount.
    expect(derivation.lines[0]?.superseded).toBe(true);
    expect(derivation.lines[0]?.amountMinor).toBe(
      (unitPriceMinor + 9_148n).toString(),
    );
    expect(
      derivation.lines.flatMap((line) =>
        line.steps.flatMap((step) => step.notes.map((note) => note.code)),
      ),
    ).toContain("LINE_SUPERSEDED");

    // P0-49, residual A. The BEFORE reading of both candidate signals, taken
    // while the invoice bills exactly the amendments accepted for its order.
    // Whatever is claimed to reveal a post-invoice amendment has to be read
    // here too, or the claim is untestable.
    //
    // The drift view (001394) reads zero, because the invoice's frozen
    // `amendment_delta_minor` is the accepted sum.
    const driftBefore = await withInternalTransaction(
      db,
      `core-owner-drift-before-${runId}`,
      async (tx) => invoiceAmendmentDrift(tx, persistedInvoiceId),
    );
    expect(driftBefore).toEqual({
      billedAmendmentDeltaMinor: 9_148n,
      acceptedAmendmentDeltaMinor: 9_148n,
      unbilledAmendmentDeltaMinor: 0n,
    });
    // `deriveInvoice`'s variance does NOT read zero here, and that is the point.
    // The net-against-gross half of it is fixed — the 37830 of tax on this
    // invoice is no longer counted as a discrepancy — but the derived total is
    // still one month of line revenue (15000) where the invoice bills twelve
    // (180000), so the note fires on an invoice nothing has drifted on. It is
    // recorded exactly, so that the AFTER reading below can be compared against
    // it rather than merely observed to be non-zero.
    expect(derivation.invoicedTotalMinor).toBe(
      (quoteTotalMinor + 9_148n + 37_830n).toString(),
    );
    expect(derivation.invoicedTaxMinor).toBe("37830");
    expect(derivation.invoicedNetTotalMinor).toBe(
      (quoteTotalMinor + 9_148n).toString(),
    );
    expect(derivation.derivedTotalMinor).toBe(
      (unitPriceMinor + 9_148n).toString(),
    );
    expect(derivation.varianceMinor).toBe("-165000");
    expect(derivation.notes.map((entry) => entry.code)).toContain(
      "INVOICE_TOTAL_VARIANCE",
    );

    // A downgrade is the same machinery with the sign the other way. Nothing
    // on the write path clamps it.
    const downgradeId = crypto.randomUUID();
    const downgradeCommand = {
      id: downgradeId,
      order: { id: orderId },
      effectiveOn: "2026-09-01",
      kind: "downgrade" as const,
      prorationMethod: "daily" as const,
      deltas: [
        {
          orderLineId,
          sku: "LOCKED-STORAGE-TB",
          quantityDelta: "-1",
          fullPeriodPriceDelta: { currency: "USD", minor: "-10000" },
        },
      ],
      acceptedAt: "2026-08-17T16:00:00.000Z",
    };
    const downgradeArtifactRequest = await repository.mutate({
      resource: "amendments",
      id: downgradeId,
      accountId,
      action: "prepare_artifact",
      payload: {
        amendment: downgradeCommand,
        retainUntil: "2033-08-17T16:00:00.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-owner-downgrade-artifact",
      idempotencyKey: testKey("core-owner-downgrade-artifact"),
      occurredAt: "2026-08-17T16:00:00.000Z",
    });
    const downgradeDocumentId = await persistTestArtifact(
      downgradeArtifactRequest,
      "downgrade",
    );
    await repository.mutate({
      resource: "amendments",
      id: downgradeId,
      accountId,
      action: "create",
      payload: {
        amendment: { ...downgradeCommand, documentId: downgradeDocumentId },
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-owner-downgrade-accept",
      idempotencyKey: testKey("core-owner-downgrade-accept"),
      occurredAt: "2026-08-17T16:00:00.000Z",
    });
    const downgradeMoney = await withInternalTransaction(
      db,
      `core-owner-downgrade-money-${runId}`,
      async (tx) => {
        const [deltaLines, terms, supersessions] = await Promise.all([
          tx.query.amendmentLines.findMany({
            where: eq(amendmentLines.amendmentId, downgradeId),
          }),
          tx.query.amendmentFinancialTerms.findFirst({
            where: eq(amendmentFinancialTerms.amendmentId, downgradeId),
          }),
          tx.query.amendmentLineSupersessions.findMany({
            where: eq(amendmentLineSupersessions.amendmentId, downgradeId),
          }),
        ]);
        return { deltaLines, terms, supersessions };
      },
    );
    expect(downgradeMoney.deltaLines[0]).toMatchObject({
      quantityDelta: "-1.000000000000000000",
      priceDeltaMinor: -10_000n,
    });
    expect(downgradeMoney.terms).toMatchObject({
      forecastDeltaMinor: -9_148n,
      monthlyDeltaMinor: -833n,
    });
    expect(downgradeMoney.supersessions[0]).toMatchObject({
      netQuantityDelta: "-1.000000000000000000",
      netRevenueDeltaMinor: -9_148n,
    });

    // P0-49, defect 1. The downgrade above was accepted AFTER this order was
    // invoiced. 001390 replaced the projection trigger's stable amount
    // identity with one that sums a set which keeps growing, and the trigger
    // is BEFORE INSERT OR UPDATE, so from the moment that downgrade landed
    // every UPDATE of the invoice row was rejected with "invoice must derive
    // account, currency, amount, and PO from its accepted order and quote".
    // The blocked writers are the money writers: invoice issuance
    // (workflows/core.ts) and the verified Stripe settlement projection
    // (system/providers.ts). A customer pays, the payment can never be
    // recorded, amount_remaining_minor stays at the full amount forever and a
    // paid invoice goes to dunning and collections.
    //
    // Both updates below are exactly what those two writers set. No existing
    // test reaches this state, which is why the suite stayed green.
    const settledAfterAmendment = await withInternalTransaction(
      db,
      `core-owner-post-amendment-settlement-${runId}`,
      async (tx) => {
        const [issued] = await tx
          .update(invoices)
          .set({
            stripeInvoiceId: `in_post_amendment_${runId}`,
            status: "open",
            updatedAt: new Date("2026-08-18T09:00:00.000Z"),
          })
          .where(eq(invoices.id, persistedInvoiceId))
          .returning();
        const [paid] = await tx
          .update(invoices)
          .set({
            amountPaidMinor: 50_000n,
            stripeLastOccurredAt: new Date("2026-08-18T10:00:00.000Z"),
            stripeLastEventId: `evt_post_amendment_${runId}`,
            updatedAt: new Date("2026-08-18T10:00:00.000Z"),
          })
          .where(eq(invoices.id, persistedInvoiceId))
          .returning();
        return { issued, paid };
      },
    );
    expect(settledAfterAmendment.issued?.status).toBe("open");
    expect(settledAfterAmendment.paid?.amountPaidMinor).toBe(50_000n);
    // The invoice keeps the amount it was issued at. A later amendment does not
    // rewrite an issued financial fact.
    expect(settledAfterAmendment.paid?.amountMinor).toBe(
      quoteTotalMinor + 9_148n + 37_830n,
    );
    expect(settledAfterAmendment.paid?.amountRemainingMinor).toBe(
      quoteTotalMinor + 9_148n + 37_830n - 50_000n,
    );

    // P0-49, residual A. The AFTER reading of the same two signals.
    //
    // The previous version of this block asserted only that the derivation
    // variance was `not.toBe("0")` and that INVOICE_TOTAL_VARIANCE was present.
    // Both of those were already true BEFORE the downgrade above was accepted —
    // measured at -202830 against a downgrade worth -9148 — so the test passed
    // identically with the post-invoice amendment deleted and proved nothing at
    // all. Every assertion here is a delta against the reading taken before the
    // amendment, which is the only form that can fail if the amendment is
    // removed.
    const driftAfter = await withInternalTransaction(
      db,
      `core-owner-drift-after-${runId}`,
      async (tx) => invoiceAmendmentDrift(tx, persistedInvoiceId),
    );
    // This is the signal. The bill still says what it said; the order has since
    // accepted -9148 that no invoice carries, and the view says so exactly.
    expect(driftAfter).toEqual({
      billedAmendmentDeltaMinor: 9_148n,
      acceptedAmendmentDeltaMinor: 0n,
      unbilledAmendmentDeltaMinor: -9_148n,
    });
    expect(
      driftAfter.unbilledAmendmentDeltaMinor -
        driftBefore.unbilledAmendmentDeltaMinor,
    ).toBe(-9_148n);
    // What settles it is a credit note, and no writer issues one: 001394 and
    // `acceptedAmendmentDeltaMinor` both name the remedy as open. It is open
    // and detected, which is the difference this fix makes.
    const creditNotesForInvoice = await withInternalTransaction(
      db,
      `core-owner-credit-note-count-${runId}`,
      async (tx) =>
        tx.execute<{ total: string }>(
          sql`select count(*)::text as total from public.credit_notes
              where invoice_id = ${persistedInvoiceId}::uuid`,
        ),
    );
    expect(creditNotesForInvoice[0]?.total).toBe("0");

    // And the derivation variance moves by the same 9148 — but it does NOT
    // reach zero, and it was not zero to begin with. It is reported here as the
    // measured artefact it is, not as the amendment signal: the derived total
    // is one month of line revenue where the invoice bills twelve, so this
    // number stays saturated whatever amendments do. 001394 records why nothing
    // should read it as a detection.
    const varianceDerivation = await withInternalTransaction(
      db,
      `core-owner-post-amendment-variance-${runId}`,
      async (tx) => loadInvoiceDerivation(tx, persistedInvoiceId),
    );
    expect(varianceDerivation.varianceMinor).toBe("-174148");
    expect(
      BigInt(varianceDerivation.varianceMinor) -
        BigInt(derivation.varianceMinor),
    ).toBe(-9_148n);
    expect(varianceDerivation.notes.map((entry) => entry.code)).toContain(
      "INVOICE_TOTAL_VARIANCE",
    );

    // P0-49, defect 2. `persistedAcceptedOrder` built the amendment baseline
    // from `core_order_line_snapshots`, which is immutable and never reflects a
    // prior amendment, so every amendment was validated against the ORIGINAL
    // order. Sequential downgrades therefore never ran out of quantity: four
    // more -1 amendments drove committed quantity and revenue negative without
    // limit. The baseline is now the order's current amended state.
    //
    // State here: ordered 1, upgraded +1, downgraded -1, so the current
    // committed quantity is 1 and the current committed line total is 180000.
    const acceptAmendment = async (input: {
      label: string;
      quantityDelta: string;
      fullPeriodPriceDeltaMinor: string;
      kind?: "upgrade" | "downgrade";
      effectiveOn?: string;
    }) => {
      const id = crypto.randomUUID();
      const command = {
        id,
        order: { id: orderId },
        effectiveOn: input.effectiveOn ?? "2026-09-01",
        kind: input.kind ?? ("downgrade" as const),
        prorationMethod: "daily" as const,
        deltas: [
          {
            orderLineId,
            sku: "LOCKED-STORAGE-TB",
            quantityDelta: input.quantityDelta,
            fullPeriodPriceDelta: {
              currency: "USD",
              minor: input.fullPeriodPriceDeltaMinor,
            },
          },
        ],
        acceptedAt: "2026-08-19T16:00:00.000Z",
      };
      const prepared = await repository.mutate({
        resource: "amendments",
        id,
        accountId,
        action: "prepare_artifact",
        payload: {
          amendment: command,
          retainUntil: "2033-08-19T16:00:00.000Z",
        },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: `core-owner-${input.label}-artifact`,
        idempotencyKey: testKey(`core-owner-${input.label}-artifact`),
        occurredAt: "2026-08-19T16:00:00.000Z",
      });
      const documentId = await persistTestArtifact(prepared, input.label);
      return repository.mutate({
        resource: "amendments",
        id,
        accountId,
        action: "create",
        payload: { amendment: { ...command, documentId } },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: `core-owner-${input.label}-accept`,
        idempotencyKey: testKey(`core-owner-${input.label}-accept`),
        occurredAt: "2026-08-19T16:00:00.000Z",
      });
    };

    // Revenue first: quantity 1 -> 0 is legitimate, but a full-period credit
    // larger than the line ever cost takes the order's committed revenue below
    // zero. That is a credit note, not an amendment, and `mutateInvoice`
    // already refuses to bill it; refusing it here stops it being persisted at
    // all. A clean domain error, not a constraint violation.
    const revenueRefusal = await acceptAmendment({
      label: "downgrade-revenue-floor",
      quantityDelta: "-1",
      fullPeriodPriceDeltaMinor: "-1000000",
    }).catch((error: unknown) => error);
    expect(revenueRefusal).toBeInstanceOf(DatabaseCoreError);
    expect(revenueRefusal).toMatchObject({ code: "INVALID_STATE" });
    expect((revenueRefusal as Error).message).toContain("committed revenue");

    // 1 -> 0 is the last downgrade this line can carry.
    await acceptAmendment({
      label: "downgrade-to-zero",
      quantityDelta: "-1",
      fullPeriodPriceDeltaMinor: "-10000",
    });
    const quantityRefusal = await acceptAmendment({
      label: "downgrade-below-zero",
      quantityDelta: "-1",
      fullPeriodPriceDeltaMinor: "-10000",
    }).catch((error: unknown) => error);
    expect(quantityRefusal).toBeInstanceOf(DatabaseCoreError);
    expect(quantityRefusal).toMatchObject({ code: "INVALID_STATE" });
    expect((quantityRefusal as Error).message).toContain("quantity negative");

    // Nothing from either refusal reached rest.
    const persistedDowngrades = await withInternalTransaction(
      db,
      `core-owner-downgrade-floor-count-${runId}`,
      async (tx) =>
        tx
          .select({ id: amendments.id })
          .from(amendments)
          .where(eq(amendments.orderId, orderId)),
    );
    // upgrade, downgrade, downgrade-to-zero.
    expect(persistedDowngrades).toHaveLength(3);

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

  it("accepts a backdated amendment without bricking the order", async () => {
    // P0-49, defect 2, round 3. The baseline fold was right to read the order's
    // CURRENT amended state; it was wrong to sort the persisted amendments by
    // `(effective_on, id)` and apply the per-line quantity floor at every step
    // of that replay.
    //
    // Two things are wrong with judging the replay step by step. The sort is
    // not the order the amendments were ACCEPTED in — `amendments.id` is the
    // caller's uuid, so for same-date amendments the tiebreaker is effectively
    // random — and the intermediate states it walks through were never states
    // the order was in and were never validated by anything. The sequence below
    // is three amendments each of which is legitimate against the state that
    // existed when it was accepted, and under the step-by-step floor the THIRD
    // one is refused for a corruption that does not exist. Every amendment
    // after it is refused too, because they all fail in the baseline fold
    // before anything else runs: the order is permanently unamendable.
    //
    // `createAmendment` requires only that `effectiveOn` fall inside the order
    // term, so amendment 2 — backdated behind amendment 1 — is an ordinary
    // commercial act, not an exotic one.
    const replayQuoteId = crypto.randomUUID();
    const replayQuoteSeriesId = crypto.randomUUID();
    const replayQuoteLineId = crypto.randomUUID();
    const replayOrderId = crypto.randomUUID();
    const replayOrderLineId = crypto.randomUUID();
    const label = (value: string) => `replay-${value}`;

    await repository.mutate({
      resource: "quotes",
      id: replayQuoteId,
      accountId,
      action: "create",
      payload: {
        priceBookId: "60000000-0000-4000-8000-000000000001",
        seriesId: replayQuoteSeriesId,
        route: "direct",
        lines: [
          {
            lineId: replayQuoteLineId,
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
      requestId: label("quote-create"),
      idempotencyKey: testKey(label("quote-create")),
      occurredAt,
    });
    const replayQuoteArtifact = await repository.mutate({
      resource: "quotes",
      id: replayQuoteId,
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
      requestId: label("quote-artifact"),
      idempotencyKey: testKey(label("quote-artifact")),
      occurredAt,
    });
    const replayQuoteDocumentId = await persistTestArtifact(
      replayQuoteArtifact,
      label("quote"),
    );
    await repository.mutate({
      resource: "quotes",
      id: replayQuoteId,
      accountId,
      action: "issue",
      expectedVersion: 1,
      payload: {
        artifactIssuedAt: occurredAt,
        renderedDocumentId: replayQuoteDocumentId,
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: label("quote-issue"),
      idempotencyKey: testKey(label("quote-issue")),
      occurredAt,
    });

    const replayOrderCommand = {
      quoteId: replayQuoteId,
      signerUserId: userId,
      authorityTitle: "Chief Demo Officer",
      authorityAttested: true as const,
      serviceStartsOn: "2026-08-01",
      serviceEndsOn: "2027-07-31",
      noticeOn: "2027-06-01",
      acceptedAt: "2026-08-01T00:00:00.000Z",
      orderLineIds: [replayOrderLineId],
    };
    const replayOrderArtifact = await repository.mutate({
      resource: "orders",
      id: replayOrderId,
      accountId,
      action: "prepare_artifact",
      payload: {
        ...replayOrderCommand,
        retainUntil: "2033-08-01T00:00:00.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: label("order-artifact"),
      idempotencyKey: testKey(label("order-artifact")),
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const replayOrderDocumentId = await persistTestArtifact(
      replayOrderArtifact,
      label("order"),
    );
    await withInternalTransaction(
      db,
      `core-replay-credit-fixture-${runId}`,
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
    await repository.mutate({
      resource: "orders",
      id: replayOrderId,
      accountId,
      action: "create",
      payload: {
        ...replayOrderCommand,
        orderFormDocumentId: replayOrderDocumentId,
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: label("order-accept"),
      idempotencyKey: testKey(label("order-accept")),
      occurredAt: "2026-08-01T00:00:00.000Z",
    });

    // An order is amendable once it is live. The provisioning round trip is
    // exercised by the test above; here it is just the state the amendment
    // path requires.
    const orderedLine = await withInternalTransaction(
      db,
      `core-replay-ordered-${runId}`,
      async (tx) => {
        for (const status of ["provisioning", "active"] as const)
          await tx
            .update(orders)
            .set({ status })
            .where(eq(orders.id, replayOrderId));
        return tx.query.orderLines.findFirst({
          where: eq(orderLines.id, replayOrderLineId),
        });
      },
    );
    expect(orderedLine).toMatchObject({
      quantity: "1.000000000000000000",
      unitPriceMinor: 15_000n,
    });

    const amend = async (input: {
      label: string;
      kind: "upgrade" | "downgrade";
      effectiveOn: string;
      quantityDelta: string;
      fullPeriodPriceDeltaMinor: string;
    }) => {
      const id = crypto.randomUUID();
      const command = {
        id,
        order: { id: replayOrderId },
        effectiveOn: input.effectiveOn,
        kind: input.kind,
        prorationMethod: "daily" as const,
        deltas: [
          {
            orderLineId: replayOrderLineId,
            sku: "LOCKED-STORAGE-TB",
            quantityDelta: input.quantityDelta,
            fullPeriodPriceDelta: {
              currency: "USD",
              minor: input.fullPeriodPriceDeltaMinor,
            },
          },
        ],
        acceptedAt: "2026-08-20T16:00:00.000Z",
      };
      const prepared = await repository.mutate({
        resource: "amendments",
        id,
        accountId,
        action: "prepare_artifact",
        payload: {
          amendment: command,
          retainUntil: "2033-08-20T16:00:00.000Z",
        },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: label(`${input.label}-artifact`),
        idempotencyKey: testKey(label(`${input.label}-artifact`)),
        occurredAt: "2026-08-20T16:00:00.000Z",
      });
      const documentId = await persistTestArtifact(prepared, input.label);
      await repository.mutate({
        resource: "amendments",
        id,
        accountId,
        action: "create",
        payload: { amendment: { ...command, documentId } },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: label(`${input.label}-accept`),
        idempotencyKey: testKey(label(`${input.label}-accept`)),
        occurredAt: "2026-08-20T16:00:00.000Z",
      });
      return id;
    };

    // 1. Forward-dated upgrade. Committed quantity 1 -> 3, line total 200000.
    await amend({
      label: "forward-upgrade",
      kind: "upgrade",
      effectiveOn: "2027-01-01",
      quantityDelta: "2",
      fullPeriodPriceDeltaMinor: "20000",
    });
    // 2. Backdated downgrade, effective BEFORE the upgrade above and accepted
    //    after it. Committed quantity 3 -> 1, line total 200000 -> 180000.
    //    Legitimate against the state that existed when it was accepted.
    await amend({
      label: "backdated-downgrade",
      kind: "downgrade",
      effectiveOn: "2026-08-15",
      quantityDelta: "-2",
      fullPeriodPriceDeltaMinor: "-20000",
    });
    // 3. This is the one the step-by-step replay refused. Sorted by effective
    //    date the backdated -2 folds FIRST, against the immutable snapshot
    //    quantity of 1, reaches -1 and throws — reporting a corruption of a
    //    perfectly consistent history and locking the order out of every
    //    future amendment. Committed quantity 1 -> 2, line total 190000.
    await amend({
      label: "later-upgrade",
      kind: "upgrade",
      effectiveOn: "2027-02-01",
      quantityDelta: "1",
      fullPeriodPriceDeltaMinor: "10000",
    });

    const foldedAfterThree = await withInternalTransaction(
      db,
      `core-replay-folded-${runId}`,
      async (tx) =>
        tx
          .select({ id: amendments.id })
          .from(amendments)
          .where(eq(amendments.orderId, replayOrderId)),
    );
    expect(foldedAfterThree).toHaveLength(3);

    // The order-level revenue floor is unchanged. Committed quantity is 2 and
    // the committed line total is 190000, so dropping one unit is fine and
    // crediting a million minor against it is not: that is a credit note, not
    // an amendment.
    const belowRevenue = await amend({
      label: "revenue-floor",
      kind: "downgrade",
      effectiveOn: "2027-01-15",
      quantityDelta: "-1",
      fullPeriodPriceDeltaMinor: "-1000000",
    }).catch((error: unknown) => error);
    expect(belowRevenue).toBeInstanceOf(DatabaseCoreError);
    expect(belowRevenue).toMatchObject({ code: "INVALID_STATE" });
    expect((belowRevenue as Error).message).toContain("committed revenue");

    // The closest legitimate input to the new refusal boundary: a further
    // backdated downgrade that lands the committed quantity exactly ON zero.
    // It is admitted, which is the proof that the fold reached 2 and that the
    // floor is on the final state rather than on any ordering of the replay.
    await amend({
      label: "downgrade-to-zero",
      kind: "downgrade",
      effectiveOn: "2026-12-01",
      quantityDelta: "-2",
      fullPeriodPriceDeltaMinor: "-20000",
    });

    // And one unit past it is still refused, so nothing was widened.
    const belowZero = await amend({
      label: "downgrade-below-zero",
      kind: "downgrade",
      effectiveOn: "2026-12-15",
      quantityDelta: "-1",
      fullPeriodPriceDeltaMinor: "-10000",
    }).catch((error: unknown) => error);
    expect(belowZero).toBeInstanceOf(DatabaseCoreError);
    expect(belowZero).toMatchObject({ code: "INVALID_STATE" });
    expect((belowZero as Error).message).toContain("quantity negative");

    const persisted = await withInternalTransaction(
      db,
      `core-replay-persisted-${runId}`,
      async (tx) =>
        tx
          .select({ id: amendments.id })
          .from(amendments)
          .where(eq(amendments.orderId, replayOrderId)),
    );
    // Four accepted, two refused, and neither refusal left a row behind.
    expect(persisted).toHaveLength(4);
  });

  it("keeps amending an order after a line swap adds a replacement line", async () => {
    // P0-49, defect 2, round 4. The baseline fold and the acceptance check used
    // to be TWO folds composed, and the composition lost the revenue of every
    // line an amendment ADDED.
    //
    // `amendOrderState` counts an added line's revenue in the order-level floor
    // — it has to, or a downgrade the added revenue plainly covers is refused —
    // but it returns only the order's OWN lines, because an added line has no
    // `order_lines` row and no later amendment can address one. So the added
    // revenue exists inside one call and is gone from the `AcceptedOrder` that
    // call hands back. `mutateAmendment` then folded a SECOND time over that
    // return value and re-derived committed revenue from the order lines alone.
    //
    // A line swap is the ordinary shape that exposes it: supersede the original
    // line for its book value plus a negotiated credit, and add a replacement
    // line worth more than both. Committed revenue afterwards is plainly
    // positive, and the swap is admitted BECAUSE the added line is counted.
    // Under the two-fold composition every follow-on amendment then saw only
    // the original line, sitting at the negotiated credit alone, and was
    // refused for a negative committed revenue the order does not have —
    // including a term extension moving no money at all. The order was bricked
    // by an amendment the same control had just accepted.
    //
    // The fix is one fold: the immutable snapshot with the persisted amendments
    // AND the new one folded together, so added revenue is in scope for the
    // decision that needs it. This test is the branch the unit suite never
    // reached, because the defect lives in the delta that omits `orderLineId`.
    const swapQuoteId = crypto.randomUUID();
    const swapQuoteSeriesId = crypto.randomUUID();
    const swapQuoteLineId = crypto.randomUUID();
    const swapOrderId = crypto.randomUUID();
    const swapOrderLineId = crypto.randomUUID();
    const label = (value: string) => `swap-${value}`;

    await repository.mutate({
      resource: "quotes",
      id: swapQuoteId,
      accountId,
      action: "create",
      payload: {
        priceBookId: "60000000-0000-4000-8000-000000000001",
        seriesId: swapQuoteSeriesId,
        route: "direct",
        lines: [
          {
            lineId: swapQuoteLineId,
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
      requestId: label("quote-create"),
      idempotencyKey: testKey(label("quote-create")),
      occurredAt,
    });
    const swapQuoteArtifact = await repository.mutate({
      resource: "quotes",
      id: swapQuoteId,
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
      requestId: label("quote-artifact"),
      idempotencyKey: testKey(label("quote-artifact")),
      occurredAt,
    });
    const swapQuoteDocumentId = await persistTestArtifact(
      swapQuoteArtifact,
      label("quote"),
    );
    await repository.mutate({
      resource: "quotes",
      id: swapQuoteId,
      accountId,
      action: "issue",
      expectedVersion: 1,
      payload: {
        artifactIssuedAt: occurredAt,
        renderedDocumentId: swapQuoteDocumentId,
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: label("quote-issue"),
      idempotencyKey: testKey(label("quote-issue")),
      occurredAt,
    });

    const swapOrderCommand = {
      quoteId: swapQuoteId,
      signerUserId: userId,
      authorityTitle: "Chief Demo Officer",
      authorityAttested: true as const,
      serviceStartsOn: "2026-08-01",
      serviceEndsOn: "2027-07-31",
      noticeOn: "2027-06-01",
      acceptedAt: "2026-08-01T00:00:00.000Z",
      orderLineIds: [swapOrderLineId],
    };
    const swapOrderArtifact = await repository.mutate({
      resource: "orders",
      id: swapOrderId,
      accountId,
      action: "prepare_artifact",
      payload: {
        ...swapOrderCommand,
        retainUntil: "2033-08-01T00:00:00.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: label("order-artifact"),
      idempotencyKey: testKey(label("order-artifact")),
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const swapOrderDocumentId = await persistTestArtifact(
      swapOrderArtifact,
      label("order"),
    );
    await withInternalTransaction(
      db,
      `core-swap-credit-fixture-${runId}`,
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
    await repository.mutate({
      resource: "orders",
      id: swapOrderId,
      accountId,
      action: "create",
      payload: {
        ...swapOrderCommand,
        orderFormDocumentId: swapOrderDocumentId,
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: label("order-accept"),
      idempotencyKey: testKey(label("order-accept")),
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const swapOrderedLine = await withInternalTransaction(
      db,
      `core-swap-ordered-${runId}`,
      async (tx) => {
        for (const status of ["provisioning", "active"] as const)
          await tx
            .update(orders)
            .set({ status })
            .where(eq(orders.id, swapOrderId));
        return tx.query.orderLines.findFirst({
          where: eq(orderLines.id, swapOrderLineId),
        });
      },
    );
    // Ordered: 1 unit at 15000 a month for 12 months, so the committed line
    // total is 180000 and the order's committed revenue is 180000.
    expect(swapOrderedLine).toMatchObject({
      quantity: "1.000000000000000000",
      unitPriceMinor: 15_000n,
    });

    const amendSwap = async (input: {
      label: string;
      kind: "upgrade" | "downgrade" | "term_extension" | "mixed";
      effectiveOn: string;
      deltas: {
        orderLineId?: string;
        quantityDelta: string;
        fullPeriodPriceDeltaMinor: string;
      }[];
      newServiceEndsOn?: string;
    }) => {
      const id = crypto.randomUUID();
      const command = {
        id,
        order: { id: swapOrderId },
        effectiveOn: input.effectiveOn,
        kind: input.kind,
        prorationMethod: "daily" as const,
        deltas: input.deltas.map((delta) => ({
          ...(delta.orderLineId ? { orderLineId: delta.orderLineId } : {}),
          sku: "LOCKED-STORAGE-TB",
          quantityDelta: delta.quantityDelta,
          fullPeriodPriceDelta: {
            currency: "USD",
            minor: delta.fullPeriodPriceDeltaMinor,
          },
        })),
        ...(input.newServiceEndsOn
          ? { newServiceEndsOn: input.newServiceEndsOn }
          : {}),
        acceptedAt: "2026-08-21T16:00:00.000Z",
      };
      const prepared = await repository.mutate({
        resource: "amendments",
        id,
        accountId,
        action: "prepare_artifact",
        payload: {
          amendment: command,
          retainUntil: "2033-08-21T16:00:00.000Z",
        },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: label(`${input.label}-artifact`),
        idempotencyKey: testKey(label(`${input.label}-artifact`)),
        occurredAt: "2026-08-21T16:00:00.000Z",
      });
      const documentId = await persistTestArtifact(
        prepared,
        label(input.label),
      );
      await repository.mutate({
        resource: "amendments",
        id,
        accountId,
        action: "create",
        payload: { amendment: { ...command, documentId } },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: label(`${input.label}-accept`),
        idempotencyKey: testKey(label(`${input.label}-accept`)),
        occurredAt: "2026-08-21T16:00:00.000Z",
      });
      return id;
    };

    // 1. The swap. The original line goes away for its 180000 book value plus a
    //    negotiated 20000 credit, and a replacement line worth 250000 is added
    //    with no `orderLineId` because it has no `order_lines` row to name.
    //    Committed revenue afterwards is (180000 - 200000) + 250000 = 230000.
    await amendSwap({
      label: "line-swap",
      kind: "mixed",
      effectiveOn: "2026-09-01",
      deltas: [
        {
          orderLineId: swapOrderLineId,
          quantityDelta: "-1",
          fullPeriodPriceDeltaMinor: "-200000",
        },
        { quantityDelta: "1", fullPeriodPriceDeltaMinor: "250000" },
      ],
    });

    // 2. An ordinary upgrade of the surviving original line, one more unit at
    //    list. Under the two-fold composition this was refused for "committed
    //    revenue negative": the second fold saw the original line at -20000 and
    //    the 250000 the same order is committed to was nowhere in scope.
    //    Committed revenue: (-20000 + 15000) + 250000 = 245000.
    await amendSwap({
      label: "post-swap-upgrade",
      kind: "upgrade",
      effectiveOn: "2026-10-01",
      deltas: [
        {
          orderLineId: swapOrderLineId,
          quantityDelta: "1",
          fullPeriodPriceDeltaMinor: "15000",
        },
      ],
    });

    // 3. A term extension carrying no deltas at all. It moves no money, so no
    //    money control has anything to say about it, and it was refused too.
    await amendSwap({
      label: "post-swap-term-extension",
      kind: "term_extension",
      effectiveOn: "2026-11-01",
      deltas: [],
      newServiceEndsOn: "2027-09-30",
    });

    // 4. A downgrade of the ADDED capacity: the customer hands back the
    //    replacement line's unit for a 180000 credit, keeping the 70000 of it
    //    already consumed. Committed revenue: -5000 + (250000 - 180000) =
    //    65000. Also refused before, for the same reason.
    //
    //    The credit is smaller than the 250000 the line was added at, and
    //    deliberately: the order still carries the 20000 negotiated credit on
    //    the superseded line, so unwinding the addition in full would leave
    //    committed revenue at -20000 and the ORDER-LEVEL revenue floor refuses
    //    that. It should — an order that owes the customer money is a credit
    //    note, and that floor is not what this test changes.
    await amendSwap({
      label: "post-swap-added-downgrade",
      kind: "downgrade",
      effectiveOn: "2027-01-01",
      deltas: [{ quantityDelta: "-1", fullPeriodPriceDeltaMinor: "-180000" }],
    });

    const swapAmendments = await withInternalTransaction(
      db,
      `core-swap-persisted-${runId}`,
      async (tx) =>
        tx
          .select({ id: amendments.id })
          .from(amendments)
          .where(eq(amendments.orderId, swapOrderId)),
    );
    expect(swapAmendments).toHaveLength(4);

    // The floor still bites on the state the order is actually in. Committed
    // revenue is 65000, so a 100000 credit against the original line takes the
    // order below zero and is refused — one fold, judged on the real total,
    // added revenue included.
    const swapRevenueRefusal = await amendSwap({
      label: "post-swap-revenue-floor",
      kind: "downgrade",
      effectiveOn: "2027-02-01",
      deltas: [
        {
          orderLineId: swapOrderLineId,
          quantityDelta: "-1",
          fullPeriodPriceDeltaMinor: "-100000",
        },
      ],
    }).catch((error: unknown) => error);
    expect(swapRevenueRefusal).toBeInstanceOf(DatabaseCoreError);
    expect(swapRevenueRefusal).toMatchObject({ code: "INVALID_STATE" });
    expect((swapRevenueRefusal as Error).message).toContain(
      "committed revenue",
    );

    // And the per-line quantity floor is unchanged: the original line is at 1
    // unit after the swap and the upgrade, so two more off it is refused.
    const swapQuantityRefusal = await amendSwap({
      label: "post-swap-quantity-floor",
      kind: "downgrade",
      effectiveOn: "2027-03-01",
      deltas: [
        {
          orderLineId: swapOrderLineId,
          quantityDelta: "-2",
          fullPeriodPriceDeltaMinor: "-15000",
        },
      ],
    }).catch((error: unknown) => error);
    expect(swapQuantityRefusal).toBeInstanceOf(DatabaseCoreError);
    expect(swapQuantityRefusal).toMatchObject({ code: "INVALID_STATE" });
    expect((swapQuantityRefusal as Error).message).toContain(
      "quantity negative",
    );

    const swapAmendmentsAfterRefusals = await withInternalTransaction(
      db,
      `core-swap-persisted-after-${runId}`,
      async (tx) =>
        tx
          .select({ id: amendments.id })
          .from(amendments)
          .where(eq(amendments.orderId, swapOrderId)),
    );
    // Four accepted, two refused, and neither refusal left a row behind.
    expect(swapAmendmentsAfterRefusals).toHaveLength(4);
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

describe("database core quote revision", () => {
  const seriesId = crypto.randomUUID();
  const originalId = crypto.randomUUID();
  const originalLineId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const revisionLineId = crypto.randomUUID();
  const priceBookId = "60000000-0000-4000-8000-000000000001";
  const quoteLine = (lineId: string, quantity: string) => ({
    lineId,
    sku: "LOCKED-STORAGE-TB",
    region: "us-east-2",
    quantity,
    termMonths: 12,
  });

  it("reprices a revision from the price book and supersedes the issued parent", async () => {
    const created = await repository.mutate({
      resource: "quotes",
      id: originalId,
      accountId,
      action: "create",
      payload: {
        priceBookId,
        seriesId,
        route: "direct",
        lines: [quoteLine(originalLineId, "1")],
        expiresAt: "2026-12-31T23:59:59.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-quote-revision-create",
      idempotencyKey: testKey("core-quote-revision-create"),
      occurredAt,
    });
    const artifactRequest = await repository.mutate({
      resource: "quotes",
      id: originalId,
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
      requestId: "core-quote-revision-artifact",
      idempotencyKey: testKey("core-quote-revision-artifact"),
      occurredAt,
    });
    const documentId = await persistTestArtifact(
      artifactRequest,
      "quote-revision",
    );
    const issued = await repository.mutate({
      resource: "quotes",
      id: originalId,
      accountId,
      action: "issue",
      expectedVersion: 1,
      payload: { artifactIssuedAt: occurredAt, renderedDocumentId: documentId },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-quote-revision-issue",
      idempotencyKey: testKey("core-quote-revision-issue"),
      occurredAt,
    });
    expect(issued.record.data.status).toBe("issued");

    // Refused while the parent is still revisable, so each rejection is the
    // rule under test rather than the status guard.
    const refusal = {
      resource: "quotes" as const,
      id: originalId,
      accountId,
      action: "revise",
      expectedVersion: issued.record.rowVersion,
      actor: { kind: "user" as const, id: userId },
      authorization,
      occurredAt: "2026-07-31T16:45:00.000Z",
    };
    const refusedPayload = {
      revisionId: crypto.randomUUID(),
      priceBookId,
      seriesId,
      route: "direct",
      lines: [quoteLine(crypto.randomUUID(), "2")],
      expiresAt: "2026-12-31T23:59:59.000Z",
    };
    await expect(
      repository.mutate({
        ...refusal,
        payload: { ...refusedPayload, seriesId: crypto.randomUUID() },
        requestId: "core-quote-revision-series",
        idempotencyKey: testKey("core-quote-revision-series"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      repository.mutate({
        ...refusal,
        payload: { ...refusedPayload, revisionId: originalId },
        requestId: "core-quote-revision-identity",
        idempotencyKey: testKey("core-quote-revision-identity"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      repository.mutate({
        ...refusal,
        payload: {
          ...refusedPayload,
          priceBookId: "60000000-0000-4000-8000-000000000002",
        },
        requestId: "core-quote-revision-book",
        idempotencyKey: testKey("core-quote-revision-book"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    const revised = await repository.mutate({
      resource: "quotes",
      id: originalId,
      accountId,
      action: "revise",
      expectedVersion: issued.record.rowVersion,
      payload: {
        revisionId,
        priceBookId,
        seriesId,
        route: "direct",
        lines: [quoteLine(revisionLineId, "3")],
        expiresAt: "2026-12-31T23:59:59.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: "core-quote-revision-revise",
      idempotencyKey: testKey("core-quote-revision-revise"),
      occurredAt: "2026-07-31T17:00:00.000Z",
    });

    // The revision is the record the caller goes on to act on, and it is a
    // fresh draft rather than a copy of the issued parent.
    expect(revised.record.id).toBe(revisionId);
    expect(revised.record.data.status).toBe("draft");
    expect(revised.record.data.revision).toBe(2);
    expect(revised.record.data.seriesId).toBe(seriesId);
    expect(revised.record.data.previousRevisionId).toBe(originalId);

    const originalTotal = BigInt(
      z.string().parse(created.record.data.totalMinor),
    );
    const revisedTotal = BigInt(
      z.string().parse(revised.record.data.totalMinor),
    );
    // Three of the one line the parent priced: the revision re-prices against
    // the confidential book instead of carrying the parent's total forward.
    expect(revisedTotal).toBe(originalTotal * 3n);

    await withInternalTransaction(
      db,
      "core-quote-revision-read",
      async (tx) => {
        const parent = await tx.query.quotes.findFirst({
          where: eq(quotes.id, originalId),
        });
        expect(parent?.status).toBe("superseded");
        const revision = await tx.query.quotes.findFirst({
          where: eq(quotes.id, revisionId),
        });
        expect(revision?.revision).toBe(2);
        expect(revision?.previousRevisionId).toBe(originalId);
        expect(revision?.totalMinor).toBe(revisedTotal);
        expect(revision?.currency).toBe(parent?.currency);
        const lines = await tx.query.quoteLines.findMany({
          where: eq(quoteLines.quoteId, revisionId),
        });
        expect(lines).toHaveLength(1);
        expect(Number(lines[0]?.quantity)).toBe(3);
        expect(lines[0]?.lineTotalMinor).toBe(revisedTotal);
        const profile = await tx.query.quoteCommercialProfiles.findFirst({
          where: eq(quoteCommercialProfiles.quoteId, revisionId),
        });
        expect(profile?.merchantOfRecord).toBe("fil_one");
        const event = await tx.query.auditEvents.findFirst({
          where: eq(auditEvents.id, revised.auditEventId),
        });
        expect(event?.eventType).toBe("core.quotes.revise");
        expect(event?.aggregateId).toBe(revisionId);
      },
    );
  });

  it("refuses a second revision of a superseded parent", async () => {
    // `protect_issued_quote` (000001:1287) has no transition out of superseded,
    // so a second revision of the same parent would branch the series.
    const parent = await withInternalTransaction(
      db,
      "core-quote-revision-parent-version",
      async (tx) =>
        tx.query.quotes.findFirst({ where: eq(quotes.id, originalId) }),
    );
    const parentVersion = z.number().parse(parent?.rowVersion);
    await expect(
      repository.mutate({
        resource: "quotes",
        id: originalId,
        accountId,
        action: "revise",
        expectedVersion: parentVersion,
        payload: {
          revisionId: crypto.randomUUID(),
          priceBookId,
          seriesId,
          route: "direct",
          lines: [quoteLine(crypto.randomUUID(), "2")],
          expiresAt: "2026-12-31T23:59:59.000Z",
        },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: "core-quote-revision-superseded",
        idempotencyKey: testKey("core-quote-revision-superseded"),
        occurredAt: "2026-07-31T17:30:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("database core procurement profile", () => {
  // Internal operations is the one seeded account with no orders behind it, so
  // a profile that requires a purchase order here cannot change what any other
  // suite's order acceptance decides.
  const procurementAccountId = "10000000-0000-4000-8000-000000000009";
  const operatorUserId = "20000000-0000-4000-8000-000000000001";
  const procurementAuthorization: AuthorizationContext = {
    userId: ids.user.parse(operatorUserId),
    accountIds: [ids.account.parse(procurementAccountId)],
    roles: ["internal_operator"],
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
  const profileId = crypto.randomUUID();
  const massachusettsCertificateId = crypto.randomUUID();
  const newYorkCertificateId = crypto.randomUUID();
  const newYorkReplacementId = crypto.randomUUID();
  const taxFormDocumentId = crypto.randomUUID();
  const insuranceDocumentId = crypto.randomUUID();

  function procurementCommand(input: {
    action: string;
    payload: Record<string, unknown>;
    label: string;
    occurredAt?: string;
    expectedVersion?: number;
  }) {
    return {
      resource: "procurement_profiles" as const,
      id: profileId,
      accountId: procurementAccountId,
      action: input.action,
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion }),
      payload: input.payload,
      actor: { kind: "user" as const, id: operatorUserId },
      authorization: procurementAuthorization,
      requestId: `core-procurement-${input.label}`,
      idempotencyKey: testKey(`core-procurement-${input.label}`),
      occurredAt: input.occurredAt ?? "2026-08-01T09:00:00.000Z",
    };
  }

  function persistedProfile() {
    return withInternalTransaction(db, `core-procurement-read-${runId}`, (tx) =>
      tx.query.procurementProfiles.findFirst({
        where: eq(procurementProfiles.accountId, procurementAccountId),
      }),
    );
  }

  it("refuses a certificate for an account that has no profile", async () => {
    // `procurement_profiles.account_id` is unique, so the row this suite writes
    // is the only one the account can have; this file does not reset the
    // database between runs.
    await withInternalTransaction(db, `core-procurement-clean-${runId}`, (tx) =>
      tx
        .delete(procurementProfiles)
        .where(eq(procurementProfiles.accountId, procurementAccountId)),
    );
    await expect(
      repository.mutate(
        procurementCommand({
          action: "add_certificate",
          label: "absent-profile",
          payload: {
            certificate: {
              jurisdiction: "US-MA",
              certificateDocumentId: massachusettsCertificateId,
              expiresOn: "2027-12-31",
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await persistedProfile()).toBeUndefined();
  });

  it("adds a certificate without erasing the profile it lands in", async () => {
    const created = await repository.mutate(
      procurementCommand({
        action: "create",
        label: "create",
        payload: {
          poRequired: true,
          supplierPortalStatus: "in_progress",
          exemptions: [
            {
              jurisdiction: "US-MA",
              certificateDocumentId: massachusettsCertificateId,
              expiresOn: "2027-12-31",
            },
          ],
          supplierDocuments: [{ kind: "w9", documentId: taxFormDocumentId }],
        },
      }),
    );
    expect(created.record.id).toBe(profileId);

    const added = await repository.mutate(
      procurementCommand({
        action: "add_certificate",
        label: "add-new-york",
        payload: {
          certificate: {
            jurisdiction: "US-NY",
            certificateDocumentId: newYorkCertificateId,
            expiresOn: "2028-06-30",
          },
        },
      }),
    );

    // The certificate command names one certificate. Everything it does not
    // name -- the certificate already validated, the purchase-order policy, the
    // supplier portal state and the furnished W-9 -- survives it.
    expect(added.record.data.exemptions).toEqual([
      {
        jurisdiction: "US-MA",
        certificateDocumentId: massachusettsCertificateId,
        expiresOn: "2027-12-31",
      },
      {
        jurisdiction: "US-NY",
        certificateDocumentId: newYorkCertificateId,
        expiresOn: "2028-06-30",
      },
    ]);
    expect(added.record.data.poRequired).toBe(true);
    expect(added.record.data.supplierPortalStatus).toBe("in_progress");
    expect(added.record.data.supplierDocuments).toEqual([
      {
        kind: "w9",
        documentId: taxFormDocumentId,
        furnishedAt: "2026-08-01T09:00:00.000Z",
      },
    ]);

    const row = await persistedProfile();
    expect(row?.poRequired).toBe(true);
    expect(
      z.array(z.object({ jurisdiction: z.string() })).parse(row?.exemptions),
    ).toHaveLength(2);
  });

  it("supersedes the certificate on file for the same jurisdiction", async () => {
    const superseding = await repository.mutate(
      procurementCommand({
        action: "add_certificate",
        label: "supersede-new-york",
        payload: {
          certificate: {
            jurisdiction: "us-ny",
            certificateDocumentId: newYorkReplacementId,
            expiresOn: "2029-06-30",
          },
        },
      }),
    );
    // The expiry sweep chases every certificate in this array for a
    // replacement, so the document the replacement supersedes must leave it --
    // and a jurisdiction typed in another case is the same jurisdiction.
    expect(superseding.record.data.exemptions).toEqual([
      {
        jurisdiction: "US-MA",
        certificateDocumentId: massachusettsCertificateId,
        expiresOn: "2027-12-31",
      },
      {
        jurisdiction: "us-ny",
        certificateDocumentId: newYorkReplacementId,
        expiresOn: "2029-06-30",
      },
    ]);

    const repeated = await repository.mutate(
      procurementCommand({
        action: "add_certificate",
        label: "repeat-new-york",
        payload: {
          certificate: {
            jurisdiction: "us-ny",
            certificateDocumentId: newYorkReplacementId,
            expiresOn: "2029-12-31",
          },
        },
      }),
    );
    // The same document furnished again is the same certificate with a
    // corrected expiry, not a second one.
    expect(repeated.record.data.exemptions).toEqual([
      {
        jurisdiction: "US-MA",
        certificateDocumentId: massachusettsCertificateId,
        expiresOn: "2027-12-31",
      },
      {
        jurisdiction: "us-ny",
        certificateDocumentId: newYorkReplacementId,
        expiresOn: "2029-12-31",
      },
    ]);
  });

  it("records a furnished document beside the certificates", async () => {
    const recorded = await repository.mutate(
      procurementCommand({
        action: "record_supplier_document",
        label: "record-coi",
        occurredAt: "2026-08-02T09:00:00.000Z",
        payload: {
          document: { kind: "coi", documentId: insuranceDocumentId },
        },
      }),
    );
    expect(recorded.record.data.supplierDocuments).toEqual([
      {
        kind: "w9",
        documentId: taxFormDocumentId,
        furnishedAt: "2026-08-01T09:00:00.000Z",
      },
      {
        kind: "coi",
        documentId: insuranceDocumentId,
        furnishedAt: "2026-08-02T09:00:00.000Z",
      },
    ]);
    expect(recorded.record.data.exemptions).toHaveLength(2);
    expect(recorded.record.data.poRequired).toBe(true);
  });

  it("patches only the keys an update names", async () => {
    const updated = await repository.mutate(
      procurementCommand({
        action: "update",
        label: "update-po-policy",
        payload: { poRequired: false },
      }),
    );
    expect(updated.record.data.poRequired).toBe(false);
    // An absent key is not an instruction to empty the column.
    expect(updated.record.data.exemptions).toHaveLength(2);
    expect(updated.record.data.supplierDocuments).toHaveLength(2);
    expect(updated.record.data.supplierPortalStatus).toBe("in_progress");
  });

  it("refuses a lapsed certificate and an unreadable one, and writes neither", async () => {
    const before = await persistedProfile();
    await expect(
      repository.mutate(
        procurementCommand({
          action: "add_certificate",
          label: "lapsed",
          payload: {
            certificate: {
              jurisdiction: "US-CA",
              certificateDocumentId: crypto.randomUUID(),
              expiresOn: "2026-07-31",
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      repository.mutate(
        procurementCommand({
          action: "add_certificate",
          label: "unreadable",
          payload: {
            // `readProcurementExemptions` skips an entry with no document, so
            // this would be persisted as a certificate and then swept as if it
            // had never been filed.
            certificate: { jurisdiction: "US-CA", expiresOn: "2028-01-31" },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const after = await persistedProfile();
    expect(after?.rowVersion).toBe(before?.rowVersion);
    expect(after?.exemptions).toEqual(before?.exemptions);
  });

  it("refuses an append that raced another writer", async () => {
    const row = await persistedProfile();
    await expect(
      repository.mutate(
        procurementCommand({
          action: "add_certificate",
          label: "stale-version",
          expectedVersion: z.number().parse(row?.rowVersion) - 1,
          payload: {
            certificate: {
              jurisdiction: "US-CA",
              certificateDocumentId: crypto.randomUUID(),
              expiresOn: "2028-01-31",
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});

/**
 * P1 renewal price protection is ENFORCED, and these are the flipped
 * characterization tests, changed on purpose as their previous version
 * instructed.
 *
 * What changed is not the rule -- `applyRenewalPriceProtection` in
 * `packages/domain/src/agreements` is untouched -- but how a quote learns it is
 * a renewal. It no longer resolves the governing paper on a date. It names a
 * persisted `lifecycle_renewal_actions` row (`renewalRequestId`), and the
 * repository reads the source order, the agreement that order PINS under §8,
 * and the prior unit price of the specific line being renewed out of persisted
 * rows. The caller supplies one identifier and cannot supply, shade or omit any
 * input to the cap.
 *
 * THE CONTROL NEVER REFUSES A DRAFT. That is the whole difference from the two
 * reverted adoptions. A breach raises `margin_floor_result` to
 * `exception_required` and states itself, exactly as the margin floor does; the
 * draft is always written, and the refusal arrives at issuance, from a
 * `issueQuote` invariant that already existed.
 *
 * Every scenario gets its own account, so a second run against the same
 * database cannot resolve the first run's papers.
 *
 * The prior price is made lower than the book by quoting the prior order at an
 * approved pricing exception, which is how a discount is legitimately reached.
 * The renewal then prices at list, 15000 against a prior 12000, which is a 2500
 * bps uplift: above the 500 bps protection the fixture negotiates.
 */
describe("database core renewal price protection", () => {
  const priceBookId = "60000000-0000-4000-8000-000000000001";
  const listUnitPriceMinor = 15_000n;
  const priorUnitPriceMinor = 12_000n;
  const termMonths = 12n;
  const pricedAt = "2026-08-20T16:00:00.000Z";

  interface RenewalAccount {
    accountId: string;
    authorization: AuthorizationContext;
  }

  const seedAccount = async (label: string): Promise<RenewalAccount> => {
    const id = crypto.randomUUID();
    await withInternalTransaction(
      db,
      `renewal-account-${label}-${runId}`,
      async (tx) => {
        await tx.insert(accounts).values({
          id,
          legalName: `Renewal ${label} ${runId}`,
          relationshipRoles: ["direct_client"],
          registeredAddress: {
            line1: "1 Fiction Way",
            city: "Boston",
            postalCode: "02108",
            country: "US",
          },
          billingContact: {
            name: "Dana Direct",
            email: `billing-${label}-${runId}@renewal.test`,
          },
          apContact: {
            name: "Alex AP",
            email: `ap-${label}-${runId}@renewal.test`,
          },
          invoiceDeliveryEmail: `ap-${label}-${runId}@renewal.test`,
          domain: `${label}-${runId}.renewal.test`,
          country: "US",
          currency: "USD",
          screeningStatus: "clear",
        });
      },
    );
    return {
      accountId: id,
      authorization: {
        ...authorization,
        accountIds: [ids.account.parse(id)],
      },
    };
  };

  const seedAgreement = async (input: {
    account: RenewalAccount;
    effectiveOn: string;
    label: string;
    protectionBps: number | null;
    keyTerms: boolean;
  }): Promise<string> => {
    const id = crypto.randomUUID();
    await withInternalTransaction(
      db,
      `renewal-agreement-${input.label}-${runId}`,
      async (tx) => {
        await tx.insert(agreements).values({
          id,
          accountId: input.account.accountId,
          templateId: "50000000-0000-4000-8000-000000000001",
          paper: "ours",
          executionMode: "click_through",
          executedDocumentId: "40000000-0000-4000-8000-000000000002",
          negotiationStatus: "standard",
          effectiveOn: input.effectiveOn,
          termMonths: 12,
          renewalType: "auto_renew",
          noticeDays: 60,
          status: "active",
          signerUserId: userId,
          authorityTitle: "Chief Demo Officer",
          authorityAttested: true,
          acceptedIp: "192.0.2.1",
          acceptedUserAgent: "Clockwork renewal protection fixture",
          textHash: "b".repeat(64),
        });
        // `key_terms` is immutable, so each protection value needs its own
        // agreement. That is also how it works commercially: renegotiating the
        // protection is a new agreement, not an edit.
        if (input.keyTerms)
          await tx.insert(keyTerms).values({
            agreementId: id,
            breachNoticeHours: 72,
            renewalPriceProtectionBps: input.protectionBps,
            auditRights: "Annual evidence review",
            retentionLiabilityRule: "liable_through_retention",
          });
      },
    );
    return id;
  };

  /**
   * An accepted order priced below list through an approved pricing exception,
   * which is what makes it renewable at a price the protection can bite on.
   */
  const acceptDiscountedOrder = async (input: {
    account: RenewalAccount;
    label: string;
    // Order acceptance derives the governing agreement from the account rather
    // than taking it from the caller, so the fixture asserts which one it got.
    // Without that, an agreement landing between the seed and the acceptance
    // would silently bind a different protection and the refusal below would
    // read as "the rule does not fire" instead of "the fixture drifted".
    expectedAgreementId: string;
    /** Defaults to a term already running on the pricing date. */
    service?: { startsOn: string; endsOn: string; noticeOn: string };
  }): Promise<string> => {
    const { label } = input;
    const service = input.service ?? {
      startsOn: "2026-08-01",
      endsOn: "2027-07-31",
      noticeOn: "2027-06-01",
    };
    const quote = crypto.randomUUID();
    const series = crypto.randomUUID();
    const line = crypto.randomUUID();
    const order = crypto.randomUUID();
    const orderLine = crypto.randomUUID();
    const context = {
      accountId: input.account.accountId,
      actor: { kind: "user" as const, id: userId },
      authorization: input.account.authorization,
    };
    await repository.mutate({
      ...context,
      resource: "quotes",
      id: quote,
      action: "create",
      payload: {
        priceBookId,
        seriesId: series,
        route: "direct",
        lines: [
          {
            lineId: line,
            sku: "LOCKED-STORAGE-TB",
            region: "us-east-2",
            quantity: "1",
            termMonths: 12,
            // 15000 -> 12000. Above the 10000 floor, above the unconfigured
            // matrix ceiling, so it needs an exception approval.
            discountBps: 2_000,
          },
        ],
        expiresAt: "2026-12-31T23:59:59.000Z",
      },
      requestId: `renewal-prior-quote-${label}`,
      idempotencyKey: testKey(`renewal-prior-quote-${label}`),
      occurredAt,
    });
    await repository.mutate({
      ...context,
      resource: "quotes",
      id: quote,
      action: "approve_exception",
      expectedVersion: 1,
      payload: { reason: "Renewal protection fixture prices below the matrix" },
      requestId: `renewal-prior-approve-${label}`,
      idempotencyKey: testKey(`renewal-prior-approve-${label}`),
      occurredAt,
    });
    const quoteArtifact = await repository.mutate({
      ...context,
      resource: "quotes",
      id: quote,
      action: "prepare_artifact",
      expectedVersion: 2,
      payload: {
        audience: "end_client",
        issuedAt: occurredAt,
        retainUntil: "2033-07-31T16:00:00.000Z",
      },
      requestId: `renewal-prior-quote-artifact-${label}`,
      idempotencyKey: testKey(`renewal-prior-quote-artifact-${label}`),
      occurredAt,
    });
    const quoteDocumentId = await persistTestArtifact(
      quoteArtifact,
      `renewal-prior-quote-${label}`,
    );
    await repository.mutate({
      ...context,
      resource: "quotes",
      id: quote,
      action: "issue",
      expectedVersion: 2,
      payload: {
        artifactIssuedAt: occurredAt,
        renderedDocumentId: quoteDocumentId,
      },
      requestId: `renewal-prior-issue-${label}`,
      idempotencyKey: testKey(`renewal-prior-issue-${label}`),
      occurredAt,
    });
    const orderCommand = {
      quoteId: quote,
      signerUserId: userId,
      authorityTitle: "Chief Demo Officer",
      authorityAttested: true as const,
      serviceStartsOn: service.startsOn,
      serviceEndsOn: service.endsOn,
      noticeOn: service.noticeOn,
      acceptedAt: "2026-08-01T00:00:00.000Z",
      orderLineIds: [orderLine],
    };
    const orderArtifact = await repository.mutate({
      ...context,
      resource: "orders",
      id: order,
      action: "prepare_artifact",
      payload: { ...orderCommand, retainUntil: "2033-08-01T00:00:00.000Z" },
      requestId: `renewal-prior-order-artifact-${label}`,
      idempotencyKey: testKey(`renewal-prior-order-artifact-${label}`),
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const orderDocumentId = await persistTestArtifact(
      orderArtifact,
      `renewal-prior-order-${label}`,
    );
    await repository.mutate({
      ...context,
      resource: "orders",
      id: order,
      action: "create",
      payload: { ...orderCommand, orderFormDocumentId: orderDocumentId },
      requestId: `renewal-prior-order-${label}`,
      idempotencyKey: testKey(`renewal-prior-order-${label}`),
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const persisted = await withInternalTransaction(
      db,
      `renewal-prior-snapshot-${label}-${runId}`,
      async (tx) => {
        const [snapshot, row] = await Promise.all([
          tx.query.orderLineSnapshots.findFirst({
            where: eq(orderLineSnapshots.orderLineId, orderLine),
          }),
          tx.query.orders.findFirst({ where: eq(orders.id, order) }),
        ]);
        return { snapshot, row };
      },
    );
    expect(
      z
        .object({ unitPrice: z.object({ minor: z.string() }) })
        .parse(persisted.snapshot?.snapshot).unitPrice.minor,
    ).toBe(priorUnitPriceMinor.toString());
    expect(persisted.row?.agreementId).toBe(input.expectedAgreementId);
    return order;
  };

  /**
   * The bridge. `requestRenewal` has always written this row; nothing in
   * finance read it until now, which is the reason the protection sat
   * unenforced. The id it returns is the ONE thing a renewal quote supplies.
   */
  const requestRenewalFor = async (input: {
    account: RenewalAccount;
    orderId: string;
    label: string;
  }): Promise<string> => {
    const requested = await lifecycleRepository.executeInTransaction({
      command: "request_renewal",
      payload: {
        orderId: input.orderId,
        accountId: input.account.accountId,
        requestedAction: "renew",
        requestedTermMonths: 12,
      },
      context: {
        requestId: `renewal-request-${input.label}-${runId}`,
        idempotencyKey: testKey(`renewal-request-${input.label}`),
        occurredAt: pricedAt,
        actor: { kind: "user", id: userId },
        authorization: input.account.authorization,
        ip: "192.0.2.20",
        userAgent: "renewal-protection-fixture",
      },
    });
    return requested.id;
  };

  /**
   * An ordinary quote. Without `renewalRequestId` it says nothing about
   * renewing anything and is priced as new business -- which is what it then
   * also is on the order side, because the order it becomes carries no renewal
   * provenance either.
   */
  const quoteFor = (input: {
    account: RenewalAccount;
    label: string;
    discountBps?: number;
    renewalRequestId?: string;
  }) =>
    repository.mutate({
      resource: "quotes",
      id: crypto.randomUUID(),
      accountId: input.account.accountId,
      action: "create",
      payload: {
        priceBookId,
        seriesId: crypto.randomUUID(),
        route: "direct",
        lines: [
          {
            lineId: crypto.randomUUID(),
            sku: "LOCKED-STORAGE-TB",
            region: "us-east-2",
            quantity: "1",
            termMonths: 12,
            ...(input.discountBps === undefined
              ? {}
              : { discountBps: input.discountBps }),
          },
        ],
        expiresAt: "2026-12-31T23:59:59.000Z",
        ...(input.renewalRequestId
          ? { renewalRequestId: input.renewalRequestId }
          : {}),
      },
      actor: { kind: "user", id: userId },
      authorization: input.account.authorization,
      requestId: `renewal-quote-${input.label}`,
      idempotencyKey: testKey(`renewal-quote-${input.label}`),
      occurredAt: pricedAt,
    });

  /** The exception reasons the command persisted alongside the judgement. */
  const reasonsFor = async (quoteId: string, label: string) =>
    withInternalTransaction(
      db,
      `renewal-reasons-${label}-${runId}`,
      async (tx) => {
        const profile = await tx.query.quoteCommercialProfiles.findFirst({
          where: eq(quoteCommercialProfiles.quoteId, quoteId),
        });
        return z
          .object({ exceptionReasons: z.array(z.string()) })
          .parse(profile?.pricingInputs).exceptionReasons;
      },
    );

  /** The persisted judgement, read back from the profile the command wrote. */
  const protectionFor = async (quoteId: string, label: string) =>
    withInternalTransaction(
      db,
      `renewal-protection-${label}-${runId}`,
      async (tx) => {
        const profile = await tx.query.quoteCommercialProfiles.findFirst({
          where: eq(quoteCommercialProfiles.quoteId, quoteId),
        });
        return z
          .object({
            renewalPriceProtection: z
              .object({
                renewalRequestId: z.string(),
                sourceOrderId: z.string(),
                agreementId: z.string(),
                lines: z.array(
                  z.object({
                    sku: z.string(),
                    region: z.string(),
                    priorUnitPriceMinor: z.string(),
                    proposedUnitPriceMinor: z.string(),
                    maximumUnitPriceMinor: z.string().nullable(),
                    enforcedUnitPriceMinor: z.string(),
                    exceededByMinor: z.string(),
                    reason: z.string(),
                    withinProtection: z.boolean(),
                  }),
                ),
              })
              .optional(),
          })
          .parse(profile?.pricingInputs).renewalPriceProtection;
      },
    );

  /**
   * The write the second adoption attempt blocked, and the case that decided
   * the shape of this one. Kept, and now asserted twice.
   *
   * The account's protected paper is superseded by one both parties signed
   * that takes effect on 1 September and states NO price protection. A
   * date-resolving adoption refused the quote outright -- "No governing
   * agreement is in force" -- because on the 20 August quote date there is a
   * gap between the two papers. That refusal is gone in both arms below, and
   * it is gone for a structural reason and not because the resolver was
   * widened: nothing here resolves a paper on a date at all.
   *
   * The second arm names the quote as the renewal it is, and it still prices
   * at list with no exception. Governing by pinned identity sends the rule to
   * the paper the SOURCE ORDER pins -- the original -- and that paper has been
   * superseded, so `evaluateRenewalPriceProtection` returns
   * `agreement_not_in_force` with a null ceiling. Price protection is a term of
   * an agreement and stops binding when the agreement does; the rule has always
   * said so, and the two reverted adoptions failed before they could ask it.
   */
  it("prices a renewal whose signed successor paper carries no protection", async () => {
    const account = await seedAccount("successor");
    const original = await seedAgreement({
      account,
      effectiveOn: "2026-03-01",
      label: "successor-original",
      protectionBps: 500,
      keyTerms: true,
    });
    const order = await acceptDiscountedOrder({
      account,
      label: "successor",
      expectedAgreementId: original,
    });
    const successor = await seedAgreement({
      account,
      effectiveOn: "2026-09-01",
      label: "successor-paper",
      protectionBps: null,
      keyTerms: true,
    });
    await withInternalTransaction(
      db,
      `renewal-successor-${runId}`,
      async (tx) => {
        await tx
          .update(agreements)
          .set({ supersededById: successor })
          .where(eq(agreements.id, original));
      },
    );
    // Arm one: no renewal provenance. New business, priced at list, no
    // exception. This is the exact write the reverted adoption refused.
    const renewed = await quoteFor({ account, label: "successor-renewal" });
    expect(renewed.record.data).toMatchObject({
      status: "draft",
      totalMinor: (listUnitPriceMinor * termMonths).toString(),
      marginFloorResult: "pass",
    });

    // Arm two: the same quote, named as the renewal it is. Still written, still
    // at list, and still with no exception -- and now for a reason the rule
    // states rather than one a resolver stumbled into. The source order pins
    // the ORIGINAL paper, that paper has been superseded, and
    // `evaluateRenewalPriceProtection` answers `agreement_not_in_force` with a
    // null ceiling. The rule was always total over this state; what the two
    // reverted adoptions could not do was reach it.
    const renewalRequestId = await requestRenewalFor({
      account,
      orderId: order,
      label: "successor",
    });
    const named = await quoteFor({
      account,
      label: "successor-renewal-named",
      renewalRequestId,
    });
    expect(named.record.data).toMatchObject({
      status: "draft",
      totalMinor: (listUnitPriceMinor * termMonths).toString(),
      marginFloorResult: "pass",
    });
    const judged = await protectionFor(
      String(named.record.data.id),
      "successor-named",
    );
    expect(judged?.lines).toMatchObject([
      {
        reason: "agreement_not_in_force",
        maximumUnitPriceMinor: null,
        withinProtection: true,
      },
    ]);
  });

  /**
   * FLIPPED. The previous version of this test asserted that a 2500 bps uplift
   * past a 500 bps ceiling was written with no exception, and instructed
   * whoever adopted the rule to come here and change it on purpose. This is
   * that change.
   *
   * 500 bps over a prior 12000 is a ceiling of 12600; the renewal quotes the
   * same SKU and region at list, 15000, which is 2400 minor over. The draft is
   * still written -- the control computes and never refuses -- and the
   * judgement is persisted in `pricing_inputs` against the source order and
   * the agreement it pins, so the breach can be read back rather than
   * inferred.
   */
  it("caps a renewal that exceeds the negotiated ceiling with a pricing exception", async () => {
    const account = await seedAccount("uncapped");
    const agreement = await seedAgreement({
      account,
      effectiveOn: "2026-03-01",
      label: "uncapped",
      protectionBps: 500,
      keyTerms: true,
    });
    const order = await acceptDiscountedOrder({
      account,
      label: "uncapped",
      expectedAgreementId: agreement,
    });
    const renewalRequestId = await requestRenewalFor({
      account,
      orderId: order,
      label: "uncapped",
    });
    const uplifted = await quoteFor({
      account,
      label: "uncapped-uplift",
      renewalRequestId,
    });
    expect(uplifted.record.data).toMatchObject({
      status: "draft",
      totalMinor: (listUnitPriceMinor * termMonths).toString(),
      marginFloorResult: "exception_required",
    });

    const persisted = await protectionFor(
      String(uplifted.record.data.id),
      "uncapped",
    );
    expect(persisted).toMatchObject({
      renewalRequestId,
      sourceOrderId: order,
      agreementId: agreement,
    });
    expect(persisted?.lines).toEqual([
      {
        sku: "LOCKED-STORAGE-TB",
        region: "us-east-2",
        priorUnitPriceMinor: priorUnitPriceMinor.toString(),
        proposedUnitPriceMinor: listUnitPriceMinor.toString(),
        maximumUnitPriceMinor: "12600",
        // The clamped price the rule offers. Nothing bills it today, because
        // no unattended renewal path exists to clamp -- see the note on the
        // rule -- but it is recorded so the one that gets built has it.
        enforcedUnitPriceMinor: "12600",
        exceededByMinor: "2400",
        reason: "protected",
        withinProtection: false,
      },
    ]);
  });

  /**
   * The half that proves this is a cap and not a wall, which is the assertion
   * the two reverted adoptions could not have made.
   *
   * The same protected paper, the same prior 12000, and a renewal quoted at a
   * 2000 bps discount -- 12000, exactly the price the customer already pays.
   * Nothing is refused, nothing needs approving, and the margin floor's own
   * verdict is left alone: this quote is below the discount matrix and so
   * requires an exception for THAT reason, not for a renewal reason.
   */
  it("leaves a renewal at or under the ceiling to the margin floor alone", async () => {
    const account = await seedAccount("within");
    const agreement = await seedAgreement({
      account,
      effectiveOn: "2026-03-01",
      label: "within",
      protectionBps: 500,
      keyTerms: true,
    });
    const order = await acceptDiscountedOrder({
      account,
      label: "within",
      expectedAgreementId: agreement,
    });
    const renewalRequestId = await requestRenewalFor({
      account,
      orderId: order,
      label: "within",
    });
    const held = await quoteFor({
      account,
      label: "within-hold",
      discountBps: 2_000,
      renewalRequestId,
    });
    expect(held.record.data).toMatchObject({
      status: "draft",
      totalMinor: (priorUnitPriceMinor * termMonths).toString(),
    });
    await expect(
      reasonsFor(String(held.record.data.id), "within"),
    ).resolves.not.toContain(
      "renewal_price_protection_exceeded:LOCKED-STORAGE-TB:us-east-2:0",
    );
    const persisted = await protectionFor(
      String(held.record.data.id),
      "within",
    );
    expect(persisted?.lines).toMatchObject([
      {
        priorUnitPriceMinor: priorUnitPriceMinor.toString(),
        proposedUnitPriceMinor: priorUnitPriceMinor.toString(),
        maximumUnitPriceMinor: "12600",
        enforcedUnitPriceMinor: priorUnitPriceMinor.toString(),
        exceededByMinor: "0",
        withinProtection: true,
      },
    ]);
  });

  /**
   * The enforcement point that came free. `issueQuote` has always refused a
   * draft carrying `exception_required`; the renewal breach raises that flag,
   * so the refusal needed no new code and lifts the ordinary way.
   *
   * Both halves are asserted, because a control whose refusal cannot be lifted
   * is the same defect as one that never fires.
   */
  it("refuses issuance while the renewal exception stands, and admits it once approved", async () => {
    const account = await seedAccount("issuance");
    const agreement = await seedAgreement({
      account,
      effectiveOn: "2026-03-01",
      label: "issuance",
      protectionBps: 500,
      keyTerms: true,
    });
    const order = await acceptDiscountedOrder({
      account,
      label: "issuance",
      expectedAgreementId: agreement,
    });
    const renewalRequestId = await requestRenewalFor({
      account,
      orderId: order,
      label: "issuance",
    });
    const uplifted = await quoteFor({
      account,
      label: "issuance-uplift",
      renewalRequestId,
    });
    const quoteId = String(uplifted.record.data.id);
    const context = {
      accountId: account.accountId,
      actor: { kind: "user" as const, id: userId },
      authorization: account.authorization,
    };
    // One artifact, used by both attempts. The rendered document binds to the
    // quote's commercial content and not to its row version, and preparing it
    // twice would only exercise the artifact replay path, which is not what
    // this test is about.
    const documentId = await persistTestArtifact(
      await repository.mutate({
        ...context,
        resource: "quotes",
        id: quoteId,
        action: "prepare_artifact",
        expectedVersion: 1,
        payload: {
          audience: "end_client",
          issuedAt: pricedAt,
          retainUntil: "2033-07-31T16:00:00.000Z",
        },
        requestId: "renewal-issue-artifact",
        idempotencyKey: testKey("renewal-issue-artifact"),
        occurredAt: pricedAt,
      }),
      "renewal-issue",
    );
    await expect(
      repository.mutate({
        ...context,
        resource: "quotes",
        id: quoteId,
        action: "issue",
        expectedVersion: 1,
        payload: {
          artifactIssuedAt: pricedAt,
          renderedDocumentId: documentId,
        },
        requestId: "renewal-issue-blocked",
        idempotencyKey: testKey("renewal-issue-blocked"),
        occurredAt: pricedAt,
      }),
    ).rejects.toThrow("Pricing exception approval is required before issuance");

    await repository.mutate({
      ...context,
      resource: "quotes",
      id: quoteId,
      action: "approve_exception",
      expectedVersion: 1,
      payload: { reason: "Commercially agreed uplift, approved by finance" },
      requestId: "renewal-issue-approve",
      idempotencyKey: testKey("renewal-issue-approve"),
      occurredAt: pricedAt,
    });
    const issued = await repository.mutate({
      ...context,
      resource: "quotes",
      id: quoteId,
      action: "issue",
      expectedVersion: 2,
      payload: {
        artifactIssuedAt: pricedAt,
        renderedDocumentId: documentId,
      },
      requestId: "renewal-issue-approved",
      idempotencyKey: testKey("renewal-issue-approved"),
      occurredAt: pricedAt,
    });
    expect(issued.record.data.status).toBe("issued");
  });

  /**
   * The bridge's own refused set, stated in full: a caller who names a renewal
   * request that is not a renewal request of theirs. Nothing else about the
   * bridge can refuse, because nothing else about it is caller-supplied.
   */
  it("refuses a renewal reference the account did not produce", async () => {
    const owner = await seedAccount("provenance-owner");
    const stranger = await seedAccount("provenance-stranger");
    const agreement = await seedAgreement({
      account: owner,
      effectiveOn: "2026-03-01",
      label: "provenance",
      protectionBps: 500,
      keyTerms: true,
    });
    const order = await acceptDiscountedOrder({
      account: owner,
      label: "provenance",
      expectedAgreementId: agreement,
    });
    const renewalRequestId = await requestRenewalFor({
      account: owner,
      orderId: order,
      label: "provenance",
    });
    await expect(
      quoteFor({
        account: stranger,
        label: "provenance-stolen",
        renewalRequestId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      quoteFor({
        account: owner,
        label: "provenance-unknown",
        renewalRequestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The reachability arm, and the reason it exists. The provenance is loaded
    // on the INTERNAL pool -- a cap must not depend on what the caller can see
    // -- so row-level security is not there to turn this away. A DIFFERENT
    // user, holding neither the request's account nor having raised it, would
    // otherwise have the owner's prior line prices computed into a quote and
    // persisted in `pricing_inputs`. Refused in code, as NOT_FOUND, before the
    // 42501 the quote insert would eventually have raised.
    const outsider = "20000000-0000-4000-8000-000000000005";
    await expect(
      repository.mutate({
        resource: "quotes",
        id: crypto.randomUUID(),
        accountId: owner.accountId,
        action: "create",
        payload: {
          priceBookId,
          seriesId: crypto.randomUUID(),
          route: "direct",
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
          renewalRequestId,
        },
        actor: { kind: "user", id: outsider },
        authorization: {
          ...stranger.authorization,
          userId: ids.user.parse(outsider),
        },
        requestId: "renewal-quote-provenance-unreachable",
        idempotencyKey: testKey("renewal-quote-provenance-unreachable"),
        occurredAt: pricedAt,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/**
 * The partner quote-creation write, end to end, under row-level security.
 *
 * This is the gap that let a partner quote stay broken while the suite stayed
 * green. The only success-path partner-quote coverage ran against
 * `MemoryCoreFinanceService`, which has no Postgres and therefore no RLS and no
 * `RETURNING`, and every `DatabaseCoreFinanceRepository` partner-quote case
 * here is a rejection that returns before the insert. So nothing executed the
 * one statement that failed: `insert into quotes ... returning`, which Postgres
 * evaluates against the SELECT policies, and `quotes_read`
 * (001000_commercial_database_integrity.sql:192) admits a partner only through
 * `core_quote_is_visible`, a `security definer` function that re-queries
 * `public.quotes` by id and cannot see a row the current statement is still
 * inserting. SQLSTATE 42501, "new row violates row-level security policy for
 * table \"quotes\"".
 *
 * `DatabaseCoreFinanceService` is a translate-only wrapper over
 * `DatabaseCoreFinanceRepository` (packages/api/src/runtime/
 * database-core-finance-service.ts) -- it constructs the repository, forwards
 * `mutate` unchanged and only re-labels `DatabaseCoreError`. Driving the
 * repository here drives every statement the service executes, in the package
 * that owns the SQL.
 *
 * The direct-customer case runs beside it deliberately: the customer arm of
 * `quotes_read` is inline and evaluates against the new row, so it always
 * succeeded, and it is the path a fix could silently break.
 */
describe("database core quote persistence under row-level security", () => {
  const distributorAccountId = "10000000-0000-4000-8000-000000000005";
  const distributorUserId = "20000000-0000-4000-8000-000000000005";
  const endClientAccountId = "10000000-0000-4000-8000-000000000004";
  const seededUsdPriceBookId = "60000000-0000-4000-8000-000000000001";

  const line = () => ({
    lineId: crypto.randomUUID(),
    sku: "LOCKED-STORAGE-TB",
    region: "us-east-2",
    quantity: "1",
    termMonths: 12,
  });

  it("writes and reads back a partner-priced quote for a partner caller", async () => {
    const id = crypto.randomUUID();
    const created = await repository.mutate({
      resource: "quotes",
      id,
      accountId: endClientAccountId,
      action: "create",
      payload: {
        priceBookId: seededUsdPriceBookId,
        seriesId: crypto.randomUUID(),
        route: "distributor",
        endClientAccountId,
        partnerAccountId: distributorAccountId,
        partnerTier: "distributor",
        partnerResaleTotal: { currency: "USD", minor: "180000" },
        lines: [line()],
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
      requestId: `rls-partner-quote-${id}`,
      idempotencyKey: `rls-partner-quote-${id}`,
      occurredAt,
    });
    expect(created.record.data).toMatchObject({
      status: "draft",
      accountId: endClientAccountId,
      partnerAccountId: distributorAccountId,
    });
    // The command is not the deliverable; the row is. A `returning` that never
    // ran would still let the command report a record it assembled in memory.
    await withInternalTransaction(
      db,
      `rls-partner-quote-assert-${id}`,
      async (tx) => {
        const [persisted, profile, lines] = await Promise.all([
          tx.query.quotes.findFirst({ where: eq(quotes.id, id) }),
          tx.query.quoteCommercialProfiles.findFirst({
            where: eq(quoteCommercialProfiles.quoteId, id),
          }),
          tx.select().from(quoteLines).where(eq(quoteLines.quoteId, id)),
        ]);
        expect(persisted).toMatchObject({
          id,
          status: "draft",
          accountId: endClientAccountId,
          partnerAccountId: distributorAccountId,
          currency: "USD",
        });
        expect(profile).toMatchObject({
          channelShape: "distributor",
          merchantOfRecord: "partner",
          billingAccountId: distributorAccountId,
        });
        expect(lines).toHaveLength(1);
      },
    );
  });

  it("writes and reads back a direct customer quote for an owner caller", async () => {
    const id = crypto.randomUUID();
    const created = await repository.mutate({
      resource: "quotes",
      id,
      accountId,
      action: "create",
      payload: {
        priceBookId: seededUsdPriceBookId,
        seriesId: crypto.randomUUID(),
        route: "direct",
        lines: [line()],
        expiresAt: "2026-12-31T23:59:59.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: `rls-direct-quote-${id}`,
      idempotencyKey: `rls-direct-quote-${id}`,
      occurredAt,
    });
    expect(created.record.data).toMatchObject({ status: "draft", accountId });
    await withInternalTransaction(
      db,
      `rls-direct-quote-assert-${id}`,
      async (tx) => {
        const [persisted, profile, lines] = await Promise.all([
          tx.query.quotes.findFirst({ where: eq(quotes.id, id) }),
          tx.query.quoteCommercialProfiles.findFirst({
            where: eq(quoteCommercialProfiles.quoteId, id),
          }),
          tx.select().from(quoteLines).where(eq(quoteLines.quoteId, id)),
        ]);
        expect(persisted).toMatchObject({
          id,
          status: "draft",
          accountId,
          partnerAccountId: null,
          currency: "USD",
        });
        expect(profile).toMatchObject({
          channelShape: "direct",
          merchantOfRecord: "fil_one",
          billingAccountId: accountId,
        });
        expect(lines).toHaveLength(1);
      },
    );
  });
});

/**
 * The other half of the EXT-TAX-01 gate: what it must NOT refuse.
 *
 * The gate was briefly a composition precondition -- no tax provider, no
 * `DatabaseCoreFinanceService` at all -- which refused every command in the
 * lane, on every surface, with "Core-finance route dependencies are not
 * configured". Quote creation writes no `tax_minor` and never calls the port;
 * refusing it protected nobody from anything.
 *
 * `undeterminedTaxRepository` is the closest fixture there is to a deployment
 * with no engine wired: it refuses every jurisdiction the seeded channels
 * invoice in. The refusals it produces on `orders:create` and `invoices:create`
 * are asserted above; this is the complement, and the two together are the
 * refused set.
 */
describe("core finance commands that never ask the tax port", () => {
  it("prices and persists a quote with no tax determination available", async () => {
    const id = crypto.randomUUID();
    const created = await undeterminedTaxRepository.mutate({
      resource: "quotes",
      id,
      accountId,
      action: "create",
      payload: {
        priceBookId: "60000000-0000-4000-8000-000000000001",
        seriesId: crypto.randomUUID(),
        route: "direct",
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
      actor: { kind: "user", id: userId },
      authorization,
      requestId: `no-tax-quote-${id}`,
      idempotencyKey: `no-tax-quote-${id}`,
      occurredAt,
    });
    expect(created.record.data).toMatchObject({ status: "draft", accountId });
    const persisted = await withInternalTransaction(
      db,
      `no-tax-quote-assert-${id}`,
      async (tx) => tx.query.quotes.findFirst({ where: eq(quotes.id, id) }),
    );
    expect(persisted).toMatchObject({ id, status: "draft" });
  });
});
