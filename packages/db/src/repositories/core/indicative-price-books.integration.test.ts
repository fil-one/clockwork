import { randomUUID } from "node:crypto";

import { afterAll, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import { createRuntimeDatabase } from "../../client";
import { DatabaseCoreFinanceRepository } from "./database-finance";
import {
  DatabaseIndicativePriceBookReader,
  type IndicativePriceBookRecord,
} from "./indicative-price-books";
import {
  DatabasePriceBookAdministrationReader,
  type PriceBookAdministrationRecord,
} from "./price-book-administration";
import { FixtureTaxPort } from "./tax-fixture";

const proposerId = "20000000-0000-4000-8000-000000000001";
const approverId = "20000000-0000-4000-8000-000000000002";
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
// Published version is unique per currency and price books are never deleted,
// so each run claims its own band of Sterling versions, clear of the bands the
// other price book suites use. Every fixture date is in 2020, so the books are
// never in force on the real day and the pricing page never offers them.
const versionBase = 1_500_000_000 + Number.parseInt(runId.slice(0, 6), 16) * 4;

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret:
    process.env.AUTHORIZATION_CONTEXT_SECRET ??
    "clockwork-local-auth-context-secret-change-me",
  tax: new FixtureTaxPort(),
});

afterAll(() => client.end());

const finance = (userId: string): AuthorizationContext => ({
  userId: ids.user.parse(userId),
  accountIds: [],
  roles: ["finance_approver"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
});

const command = (input: {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  userId?: string;
  key: string;
  occurredAt: string;
}) =>
  repository.mutate({
    resource: "price_books",
    id: input.id,
    action: input.action,
    payload: input.payload,
    actor: { kind: "user", id: input.userId ?? proposerId },
    authorization: finance(input.userId ?? proposerId),
    requestId: `indicative-${input.key}-${runId}`,
    idempotencyKey: `indicative-${input.key}-${runId}`,
    occurredAt: input.occurredAt,
  });

const money = (minor: string) => ({ currency: "GBP", minor });

const createDraft = async (
  offset: number,
  dates: { effectiveFrom: string; effectiveTo?: string },
  key: string,
) => {
  const id = randomUUID();
  const occurredAt = `${dates.effectiveFrom}T09:00:00.000Z`;
  await command({
    id,
    action: "create",
    payload: {
      name: `Indicative Sterling ${key}`,
      currency: "GBP",
      version: versionBase + offset,
      ...dates,
    },
    key: `create-${key}`,
    occurredAt,
  });
  for (const [index, sku] of ["STORAGE-TB", "EGRESS-TB"].entries())
    await command({
      id,
      action: "add_rate",
      payload: {
        sku,
        region: "uk-south",
        unit: "TB-month",
        approvedClaim: "Fictional immutable storage capacity",
        unitPrice: money(`${15_000 + index}`),
        floorPrice: money("10000"),
        overageRate: money("18000"),
        minimumQuantity: "1",
        egressTreatment: "metered",
        commitType: "term_drawdown",
        stripeTaxCode: "txcd_demo",
        qboIncomeAccount: "4000-Storage",
        partnerTransferPrices: { gold: money("9000") },
      },
      key: `rate-${key}-${index}`,
      occurredAt,
    });
  return id;
};

const activate = async (id: string, key: string, on: string) => {
  const occurredAt = `${on}T10:00:00.000Z`;
  await command({
    id,
    action: "request_activation",
    payload: { reason: "Indicative pricing fixture." },
    key: `request-${key}`,
    occurredAt,
  });
  await command({
    id,
    action: "activate",
    payload: { reason: "Second authority confirms the fixture." },
    userId: approverId,
    key: `activate-${key}`,
    occurredAt,
  });
};

/** What the pricing page kept from the administration read. */
const filtered = (
  books: readonly PriceBookAdministrationRecord[],
  today: string,
): IndicativePriceBookRecord[] =>
  books
    .filter(
      (book) =>
        book.status === "active" &&
        book.effectiveFrom <= today &&
        (!book.effectiveTo || book.effectiveTo >= today) &&
        (book.rateCards?.length ?? 0) > 0,
    )
    .map((book) => ({
      id: book.id,
      name: book.name,
      currency: book.currency,
      version: book.version,
      status: book.status,
      effectiveFrom: book.effectiveFrom,
      effectiveTo: book.effectiveTo,
      rateCards: (book.rateCards ?? []).map((rate) => ({
        id: rate.id,
        sku: rate.sku,
        region: rate.region,
        unit: rate.unit,
        unitPrice: rate.unitPrice,
        overageRate: rate.overageRate,
        minimumQuantity: rate.minimumQuantity,
        commitType: rate.commitType,
      })),
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));

const byId = (books: readonly IndicativePriceBookRecord[]) =>
  books.toSorted((left, right) => left.id.localeCompare(right.id));

// One currency holds one active book, so activation retires whichever Sterling
// book was active, as the other price book suites do. The fixture is retired
// again at the end, leaving no Sterling book active.
it("reads the same in-force books and rates as filtering the administration read", async () => {
  const retired = await createDraft(
    0,
    { effectiveFrom: "2020-01-15" },
    "retired",
  );
  await activate(retired, "retired", "2020-01-15");
  const active = await createDraft(
    1,
    { effectiveFrom: "2020-02-01", effectiveTo: "2020-06-30" },
    "active",
  );
  await activate(active, "active", "2020-02-01");
  const draft = await createDraft(2, { effectiveFrom: "2020-01-15" }, "draft");

  const administration = new DatabasePriceBookAdministrationReader(db);
  const indicative = new DatabaseIndicativePriceBookReader(db);

  try {
    for (const [today, offered] of [
      // Inside the window.
      ["2020-06-01", true],
      // Before the window opens: future-dated on that day.
      ["2020-01-20", false],
      // The last day of the window: effective_to equals today.
      ["2020-06-30", true],
      // The day after: effective_to is the day before today.
      ["2020-07-01", false],
    ] as const) {
      const [all, read] = await Promise.all([
        administration.list({ limit: 500 }),
        indicative.listInForce({ today }),
      ]);
      const fixture = new Map(all.map((book) => [book.id, book.status]));
      expect(fixture.get(retired)).toBe("retired");
      expect(fixture.get(active)).toBe("active");
      expect(fixture.get(draft)).toBe("draft");

      const kept = filtered(all, today);
      expect(byId(read)).toEqual(kept);
      expect(kept.some(({ id }) => id === active)).toBe(offered);
      const readIds = read.map(({ id }) => id);
      expect(readIds.includes(active)).toBe(offered);
      expect(readIds).not.toContain(retired);
      expect(readIds).not.toContain(draft);
    }

    const [current] = (
      await indicative.listInForce({ today: "2020-06-01" })
    ).filter(({ id }) => id === active);
    expect(current?.rateCards?.map(({ sku }) => sku)).toEqual([
      "EGRESS-TB",
      "STORAGE-TB",
    ]);
    const serialized = JSON.stringify(current);
    for (const hidden of [
      "floorPrice",
      "partnerTransferPrices",
      "stripeTaxCode",
      "txcd_demo",
      "qboIncomeAccount",
      "4000-Storage",
      "approvedClaim",
      "Fictional immutable",
    ])
      expect(serialized).not.toContain(hidden);
  } finally {
    await command({
      id: active,
      action: "retire",
      payload: { reason: "Retire the indicative pricing fixture." },
      key: "retire-active",
      occurredAt: "2020-06-30T18:00:00.000Z",
    });
  }
});
