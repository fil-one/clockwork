import { randomUUID } from "node:crypto";

import { afterAll, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";

import { createRuntimeDatabase } from "../../client";
import { DatabaseCoreFinanceRepository } from "./database-finance";
import { DatabasePriceBookAdministrationReader } from "./price-book-administration";
import { FixtureTaxPort } from "./tax-fixture";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});

afterAll(() => client.end());

it("retains active comparison evidence when newer drafts exceed the result limit", async () => {
  const repository = new DatabaseCoreFinanceRepository({
    database: db,
    pricingDatabase: db,
    authorizationSecret:
      process.env.AUTHORIZATION_CONTEXT_SECRET ??
      "clockwork-local-auth-context-secret-change-me",
    tax: new FixtureTaxPort(),
  });
  const userId = ids.user.parse("20000000-0000-4000-8000-000000000001");
  const runId = randomUUID();
  await repository.mutate({
    resource: "price_books",
    id: randomUUID(),
    action: "create",
    payload: {
      name: "Later draft must not hide active review evidence",
      currency: "EUR",
      version: 1_000_000_000 + Number.parseInt(runId.slice(0, 7), 16),
      effectiveFrom: "2027-01-01",
    },
    actor: { kind: "user", id: userId },
    authorization: {
      userId,
      accountIds: [],
      roles: ["finance_approver"],
      isInternalStaff: true,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    },
    requestId: `review-limit-${runId}`,
    idempotencyKey: `review-limit-${runId}`,
    occurredAt: "2026-09-06T16:00:00.000Z",
  });

  const books = await new DatabasePriceBookAdministrationReader(db).list({
    limit: 1,
    requestId: `review-limit-read-${runId}`,
  });
  expect(books).toHaveLength(1);
  expect(books[0]?.status).toBe("active");
  expect(books[0]?.rateCards?.length).toBeGreaterThan(0);
});
