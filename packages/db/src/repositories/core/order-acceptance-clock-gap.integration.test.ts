import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createRuntimeDatabase } from "../../client";
import { orders } from "../../schema";
import {
  accountCommercialProfiles,
  orderCommercialProfiles,
} from "../../schema/core/finance";
import { orderSupplierBindings } from "../../schema/core/tax";
import { lifecycleProvisioningAttempts } from "../../schema/lifecycle/platform";
import { withInternalTransaction } from "../../transaction";
import {
  CommercialArtifactRequestSchema,
  DatabaseCommercialArtifactStore,
} from "./commercial-artifacts";
import { DatabaseCoreFinanceRepository } from "./database-finance";
import { FixtureTaxPort } from "./tax-fixture";

/**
 * THE JOURNEY WITH A REAL CLOCK GAP BETWEEN THE TWO PASSES.
 *
 * Order acceptance is a two-pass surface. Pass one (`prepare_artifact`) renders
 * the order form the signer reads and hashes over the `acceptedAt` it states;
 * pass two (`create`) must resend that same value or the artifact binding
 * cannot reproduce. Between the two sits a bounded poll for the rendered
 * document and a human reading it, so pass two ALWAYS arrives later than the
 * instant pass one stated.
 *
 * Every other integration test in this package pins `occurredAt` equal to the
 * fixture `acceptedAt`, and the surface tests stub `sendCoreCommand`, so
 * nothing anywhere exercised that gap — which is why `mutateOrder` could carry
 * a `Date.parse(command.acceptedAt) !== Date.parse(input.occurredAt)` refusal
 * that made the journey uncompletable over HTTP without a single test noticing.
 *
 * This test does not pin the two together. It takes a real reading of the wall
 * clock for the documentary instant, lets real time pass, and takes a second
 * real reading for the server's receive instant, exactly as the API does
 * (`routes/core/index.ts` sets `occurredAt` from `requestContext.receivedAt`).
 *
 * It discriminates in BOTH directions:
 *   - keep the clock equality and it fails on "Order acceptance time must be
 *     current server evidence for an unexpired quote";
 *   - drop the equality but let the create pass substitute its own
 *     `occurredAt` for the order's `acceptedAt` and it fails on
 *     COMMERCIAL_ARTIFACT_BINDING_INVALID, because the create-pass hash no
 *     longer reproduces the prepare-pass hash.
 * Carrying `command.acceptedAt` through both passes is what makes it pass.
 */

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const accountId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const runId = crypto.randomUUID();
const testKey = (value: string) => `${value}:${runId}`;

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
const artifactStore = new DatabaseCommercialArtifactStore(db);
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
  const issued = await artifactStore.issue({
    request,
    artifact: {
      documentId,
      storageKey: `test/${request.requestId}.pdf`,
      storageVersionId: `version-${label}`,
      contentHash: createHash("sha256")
        .update(request.requestHash)
        .digest("hex"),
      byteLength: 1024,
      mimeType: "application/pdf" as const,
      retainUntil: request.retainUntil,
      legalHold: false,
    },
    requestId: `clock-gap-${label}-${request.requestId}`,
  });
  expect(issued.duplicate).toBe(false);
  return documentId;
}

afterAll(async () => {
  await client.end();
});

describe("order acceptance across a real clock gap", () => {
  it("completes both passes when the create arrives after the instant the order form states", async () => {
    const quoteId = crypto.randomUUID();
    const quoteSeriesId = crypto.randomUUID();
    const quoteLineId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    const orderLineId = crypto.randomUUID();
    const quoteAt = new Date().toISOString();

    await repository.mutate({
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
      requestId: `clock-gap-quote-create-${runId}`,
      idempotencyKey: testKey("clock-gap-quote-create"),
      occurredAt: quoteAt,
    });
    const quoteArtifactRequest = await repository.mutate({
      resource: "quotes",
      id: quoteId,
      accountId,
      action: "prepare_artifact",
      expectedVersion: 1,
      payload: {
        audience: "end_client",
        issuedAt: quoteAt,
        retainUntil: "2033-07-31T16:00:00.000Z",
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: `clock-gap-quote-artifact-${runId}`,
      idempotencyKey: testKey("clock-gap-quote-artifact"),
      occurredAt: quoteAt,
    });
    const quoteDocumentId = await persistTestArtifact(
      quoteArtifactRequest,
      "quote",
    );
    const issued = await repository.mutate({
      resource: "quotes",
      id: quoteId,
      accountId,
      action: "issue",
      expectedVersion: 1,
      payload: {
        artifactIssuedAt: quoteAt,
        renderedDocumentId: quoteDocumentId,
      },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: `clock-gap-quote-issue-${runId}`,
      idempotencyKey: testKey("clock-gap-quote-issue"),
      occurredAt: quoteAt,
    });
    expect(issued.record.data.status).toBe("issued");

    await withInternalTransaction(
      db,
      `clock-gap-credit-fixture-${runId}`,
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

    // PASS ONE. The signer's order form states this instant, and the
    // artifact hash covers it. It is a real clock reading, not a fixture.
    const acceptedAt = new Date().toISOString();
    const orderCommand = {
      quoteId,
      signerUserId: userId,
      authorityTitle: "Chief Demo Officer",
      authorityAttested: true as const,
      serviceStartsOn: "2026-08-01",
      serviceEndsOn: "2027-07-31",
      noticeOn: "2027-06-01",
      acceptedAt,
      orderLineIds: [orderLineId],
    };
    const orderArtifactRequest = await repository.mutate({
      resource: "orders",
      id: orderId,
      accountId,
      action: "prepare_artifact",
      payload: { ...orderCommand, retainUntil: "2033-08-01T00:00:00.000Z" },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: `clock-gap-order-artifact-${runId}`,
      idempotencyKey: testKey("clock-gap-order-artifact"),
      occurredAt: acceptedAt,
    });
    const orderDocumentId = await persistTestArtifact(
      orderArtifactRequest,
      "order",
    );

    // THE GAP. Real time, not a fabricated string: the poll for the rendered
    // order form and the human reading it live here.
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    // PASS TWO. `occurredAt` is the server's own receive instant, which is
    // now strictly later than the instant the order form states. The payload
    // resends the pass-one `acceptedAt` unchanged, because the hash covers
    // it.
    const receivedAt = new Date().toISOString();
    expect(Date.parse(receivedAt)).toBeGreaterThan(Date.parse(acceptedAt));
    expect(Date.parse(receivedAt) - Date.parse(acceptedAt)).toBeGreaterThan(
      1_000,
    );

    const accepted = await repository.mutate({
      resource: "orders",
      id: orderId,
      accountId,
      action: "create",
      payload: { ...orderCommand, orderFormDocumentId: orderDocumentId },
      actor: { kind: "user", id: userId },
      authorization,
      requestId: `clock-gap-order-accept-${runId}`,
      idempotencyKey: testKey("clock-gap-order-accept"),
      occurredAt: receivedAt,
    });
    expect(accepted.record.data).toMatchObject({
      status: "accepted",
      sourcing: "direct",
      accountId,
      acceptanceReservation: { decision: "approved" },
    });

    await withInternalTransaction(
      db,
      `clock-gap-order-assert-${runId}`,
      async (tx) => {
        const [order, commercial, binding, attempt] = await Promise.all([
          tx.query.orders.findFirst({ where: eq(orders.id, orderId) }),
          tx.query.orderCommercialProfiles.findFirst({
            where: eq(orderCommercialProfiles.orderId, orderId),
          }),
          tx.query.orderSupplierBindings.findFirst({
            where: eq(orderSupplierBindings.orderId, orderId),
          }),
          tx.query.lifecycleProvisioningAttempts.findFirst({
            where: eq(lifecycleProvisioningAttempts.orderId, orderId),
          }),
        ]);
        if (!order || !commercial || !binding || !attempt)
          throw new Error("CLOCK_GAP_ACCEPTANCE_DID_NOT_PERSIST");
        // The DOCUMENTARY instant, from pass one, is what the order form
        // states and the artifact hashed. It survives the create untouched.
        expect(commercial.acceptedAt.toISOString()).toBe(acceptedAt);
        // The SERVER facts all take the receive instant. `boundAt`
        // especially: 001416 resolves the selling entity by its UTC DATE,
        // and the pre-check resolved on `occurredAt`, so a documentary
        // `boundAt` straddling midnight would let the buyer choose which
        // legal entity sells them the order.
        expect(order.immutableAt?.toISOString()).toBe(receivedAt);
        expect(binding.boundAt.toISOString()).toBe(receivedAt);
        expect(
          z
            .object({ command: z.object({ requestedAt: z.string() }) })
            .parse(attempt.attempt).command.requestedAt,
        ).toBe(receivedAt);
      },
    );
  }, 60_000);
});
