import { afterAll, describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase } from "../../client";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "../../transaction";
import { DatabaseCoreFinanceRepository } from "../core/database-finance";
import { FixtureTaxPort } from "../core/tax-fixture";
import {
  findActiveCustomerQuoteOffers,
  findCustomerQuoteCurrency,
  type DatabaseQuoteCurrency,
} from "./quote-offers";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";
const accountId = "10000000-0000-4000-8000-000000000001";
const otherAccountId = "10000000-0000-4000-8000-000000000002";
const userId = "20000000-0000-4000-8000-000000000002";
const parsedUserId = ids.user.parse(userId);
const onDate = new Date("2026-08-16T12:00:00.000Z");
const runId = crypto.randomUUID();

const runtime = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseCoreFinanceRepository({
  database: runtime.db,
  pricingDatabase: runtime.db,
  authorizationSecret,
  tax: new FixtureTaxPort(),
});
const authorization: AuthorizationContext = {
  userId: parsedUserId,
  accountIds: [ids.account.parse(accountId)],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

afterAll(async () => runtime.client.end());

async function scopedCurrency(
  scopedAccountId: string,
  targetAccountId: string,
): Promise<DatabaseQuoteCurrency | null> {
  return withAuthorizedTransaction(
    runtime.db,
    {
      userId: parsedUserId,
      accountIds: [scopedAccountId],
      roles: ["owner"],
      isInternalStaff: false,
      requestId: `quote-offer-currency-${runId}`,
    },
    { secret: authorizationSecret },
    (transaction) =>
      findCustomerQuoteCurrency(transaction, { accountId: targetAccountId }),
  );
}

describe("customer quote offers", () => {
  it("lets tenant RLS reveal only the selected account currency", async () => {
    await expect(scopedCurrency(accountId, accountId)).resolves.toBe("USD");
    await expect(scopedCurrency(otherAccountId, accountId)).resolves.toBeNull();
  });

  it("returns the complete compatible active set and every option drives quotes:create", async () => {
    const currency = await scopedCurrency(accountId, accountId);
    if (!currency) throw new Error("seed account currency unavailable");
    const offers = await withInternalTransaction(
      runtime.db,
      `quote-offer-active-${runId}`,
      (transaction) =>
        findActiveCustomerQuoteOffers(transaction, { currency, now: onDate }),
    );

    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((offer) => offer.currency === currency)).toBe(true);
    for (const [index, offer] of offers.entries()) {
      const quoteId = crypto.randomUUID();
      const created = await repository.mutate({
        resource: "quotes",
        id: quoteId,
        accountId,
        action: "create",
        payload: {
          priceBookId: offer.price_book_id,
          seriesId: crypto.randomUUID(),
          route: "direct",
          lines: [
            {
              lineId: crypto.randomUUID(),
              sku: offer.sku,
              region: offer.region,
              quantity: "10",
              termMonths: 12,
            },
          ],
          expiresAt: "2026-08-30T12:00:00.000Z",
        },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: `quote-offer-create-${runId}-${index}`,
        idempotencyKey: `quote-offer-create-${runId}-${index}`,
        occurredAt: onDate.toISOString(),
      });

      expect(created.record).toMatchObject({
        id: quoteId,
        resource: "quotes",
        rowVersion: 1,
        data: {
          priceBookId: offer.price_book_id,
          currency,
        },
      });
    }
  });

  it("counterproves the former demo fixture as an authoritative offer", async () => {
    const quoteId = crypto.randomUUID();

    await expect(
      repository.mutate({
        resource: "quotes",
        id: quoteId,
        accountId,
        action: "create",
        payload: {
          priceBookId: "44444444-4444-4444-8444-444444444444",
          seriesId: crypto.randomUUID(),
          route: "direct",
          lines: [
            {
              lineId: crypto.randomUUID(),
              sku: "FIL-ARCHIVE-CAPACITY",
              region: "us-east",
              quantity: "10",
              termMonths: 12,
            },
          ],
          expiresAt: "2026-08-30T12:00:00.000Z",
        },
        actor: { kind: "user", id: userId },
        authorization,
        requestId: `quote-offer-fixture-refusal-${runId}`,
        idempotencyKey: `quote-offer-fixture-refusal-${runId}`,
        occurredAt: onDate.toISOString(),
      }),
    ).rejects.toThrow();
  });
});
