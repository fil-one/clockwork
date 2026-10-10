import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { MoneySchema } from "@clockwork/contracts";
import { createRuntimeDatabase } from "../client";
import type { IndicativePriceBookRecord } from "./core/indicative-price-books";
import { PricingScenarioRepository } from "./pricing-scenarios";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});

const money = (currency: "USD" | "EUR", minor: string) =>
  MoneySchema.parse({ currency, minor });
const rate = (id: string, currency: "USD" | "EUR", minor: string) => ({
  id,
  sku: "STORAGE-TB",
  region: "us-east",
  unit: "TB-month",
  unitPrice: money(currency, minor),
  overageRate: money(currency, "1800"),
  minimumQuantity: "10.000000000000000000",
  commitType: "period_allowance" as const,
});
const usdBook = randomUUID();
const eurBook = randomUUID();
const usdRate = randomUUID();
const archiveRate = randomUUID();
const eurRate = randomUUID();
let unitMinor = "1500";
// The books in force today, as the indicative reader returns them: list
// prices only. Tests change `unitMinor` to stand for a new book version.
const books = {
  listInForce: (): Promise<IndicativePriceBookRecord[]> =>
    Promise.resolve([
      {
        id: usdBook,
        name: "Standard",
        currency: "USD",
        version: 7,
        status: "active",
        effectiveFrom: "2026-09-01",
        effectiveTo: null,
        rateCards: [
          rate(usdRate, "USD", unitMinor),
          rate(archiveRate, "USD", "400"),
        ],
      },
      {
        id: eurBook,
        name: "Europe",
        currency: "EUR",
        version: 2,
        status: "active",
        effectiveFrom: "2026-09-01",
        effectiveTo: null,
        rateCards: [rate(eurRate, "EUR", "1400")],
      },
    ]),
};
const repo = new PricingScenarioRepository(db, books);
const seller = { kind: "user" as const, id: randomUUID(), display: "Seller" };
const other = { kind: "user" as const, id: randomUUID(), display: "Other" };
const own = (actor: { id: string }) => ({
  kind: "own" as const,
  ownerId: actor.id,
});
const created: string[] = [];

afterAll(async () => {
  await client`delete from commerce_pricing_scenarios where id = any(${created})`;
  await client.end();
});

const input = (overrides: Record<string, unknown> = {}) => {
  const id = randomUUID();
  created.push(id);
  return {
    id,
    name: "Pilot",
    company: "Acme, Inc.",
    notes: "Week two",
    lines: [
      {
        bookId: usdBook,
        rateId: usdRate,
        quantity: "500",
        termMonths: 12,
        discountBps: 1000,
      },
      {
        bookId: usdBook,
        rateId: archiveRate,
        quantity: "20",
        termMonths: 12,
        discountBps: 0,
      },
    ],
    ...overrides,
  };
};

describe("pricing scenarios", () => {
  it("saves list prices from the book in force and recomputes totals on read", async () => {
    unitMinor = "1500";
    const saved = await repo.save(input(), seller, own(seller), "2026-10-10");
    expect(saved).toMatchObject({
      ownerId: seller.id,
      ownerName: "Seller",
      company: "Acme, Inc.",
      currency: "USD",
      asOf: "2026-10-10",
      priceBooks: [{ id: usdBook, version: 7 }],
      version: 1,
    });
    expect(saved.lines[0]).toEqual({
      bookId: usdBook,
      bookVersion: 7,
      rateId: usdRate,
      sku: "STORAGE-TB",
      region: "us-east",
      unit: "TB-month",
      unitPrice: { currency: "USD", minor: "1500" },
      minimumQuantity: "10.000000000000000000",
      quantity: "500",
      termMonths: 12,
      discountBps: 1000,
    });
    const [row] = (await repo.list(own(seller))).filter(
      ({ id }) => id === saved.id,
    );
    // 15.00 less 10% = 13.50 x 500 x 12 = 81,000.00; 4.00 x 20 x 12 = 960.00.
    expect(row?.total).toEqual({ currency: "USD", minor: "8196000" });
    expect(row?.lineCount).toBe(2);
  });

  it("never takes a price from the caller", async () => {
    await expect(
      repo.save(
        input({
          lines: [
            {
              bookId: usdBook,
              rateId: usdRate,
              quantity: "1",
              termMonths: 1,
              discountBps: 0,
              unitPrice: { currency: "USD", minor: "1" },
            },
          ],
        }),
        seller,
        own(seller),
        "2026-10-10",
      ),
    ).rejects.toThrow();
  });

  it("refuses a rate no longer in force and lines in two currencies", async () => {
    await expect(
      repo.save(
        input({
          lines: [
            {
              bookId: usdBook,
              rateId: randomUUID(),
              quantity: "1",
              termMonths: 1,
              discountBps: 0,
            },
          ],
        }),
        seller,
        own(seller),
        "2026-10-10",
      ),
    ).rejects.toThrow("PRICING_SCENARIO_RATE_UNAVAILABLE");
    const mixed = input();
    await expect(
      repo.save(
        {
          ...mixed,
          lines: [
            ...mixed.lines,
            {
              bookId: eurBook,
              rateId: eurRate,
              quantity: "1",
              termMonths: 1,
              discountBps: 0,
            },
          ],
        },
        seller,
        own(seller),
        "2026-10-10",
      ),
    ).rejects.toThrow("PRICING_SCENARIO_CURRENCY_MISMATCH");
  });

  it("keeps a seller to their own scenarios and lets an administrator reach all", async () => {
    const saved = await repo.save(input(), seller, own(seller), "2026-10-10");
    await expect(repo.get(saved.id, own(other))).rejects.toThrow(
      "PRICING_SCENARIO_NOT_FOUND",
    );
    expect(
      (await repo.list(own(other))).some(({ id }) => id === saved.id),
    ).toBe(false);
    expect((await repo.get(saved.id, { kind: "all" })).id).toBe(saved.id);
    await expect(repo.delete(saved.id, 1, other, own(other))).rejects.toThrow(
      "PRICING_SCENARIO_NOT_FOUND",
    );
    await expect(
      repo.save(
        { ...input(), id: saved.id, name: "Taken over", expectedVersion: 1 },
        other,
        own(other),
        "2026-10-10",
      ),
    ).rejects.toThrow("PRICING_SCENARIO_NOT_FOUND");
    expect((await repo.get(saved.id, own(seller))).name).toBe("Pilot");
  });

  it("refuses a quantity below the minimum and a company the summary cannot print", async () => {
    const short = input();
    await expect(
      repo.save(
        {
          ...short,
          lines: [{ ...short.lines[0], quantity: "9.5" }],
        },
        seller,
        own(seller),
        "2026-10-10",
      ),
    ).rejects.toThrow("PRICING_SCENARIO_BELOW_MINIMUM");
    await expect(
      repo.save(
        input({ company: "株式会社アクメ" }),
        seller,
        own(seller),
        "2026-10-10",
      ),
    ).rejects.toThrow("unprintable");
  });

  it("overwrites at today's prices, refuses a stale edit and is idempotent on create", async () => {
    unitMinor = "1500";
    const first = input();
    const saved = await repo.save(first, seller, own(seller), "2026-10-10");
    expect(
      (await repo.save(first, seller, own(seller), "2026-10-10")).version,
    ).toBe(1);
    await expect(
      repo.save(first, other, own(other), "2026-10-10"),
    ).rejects.toThrow("PRICING_SCENARIO_IDEMPOTENCY_CONFLICT");
    unitMinor = "1600";
    const edited = await repo.save(
      { ...first, company: "Acme Corp", expectedVersion: 1 },
      seller,
      own(seller),
      "2026-10-12",
    );
    expect(edited).toMatchObject({
      id: saved.id,
      version: 2,
      asOf: "2026-10-12",
      createdAt: saved.createdAt,
    });
    expect(edited.lines[0]?.unitPrice.minor).toBe("1600");
    await expect(
      repo.save(
        { ...first, expectedVersion: 1 },
        seller,
        own(seller),
        "2026-10-12",
      ),
    ).rejects.toThrow("PRICING_SCENARIO_VERSION_CONFLICT");
    unitMinor = "1500";
  });

  it("lists newest first and audits every save, delete and download", async () => {
    const owner = { kind: "user" as const, id: randomUUID(), display: "O" };
    const a = await repo.save(input(), owner, own(owner), "2026-10-10");
    const b = await repo.save(input(), owner, own(owner), "2026-10-10");
    await repo.save(
      { ...input(), id: a.id, name: "Pilot, revised", expectedVersion: 1 },
      owner,
      own(owner),
      "2026-10-10",
    );
    expect((await repo.list(own(owner))).map(({ id }) => id)).toEqual([
      a.id,
      b.id,
    ]);
    await repo.recordDownload(owner, a.id);
    await repo.delete(b.id, 1, owner, own(owner));
    await expect(repo.get(b.id, own(owner))).rejects.toThrow(
      "PRICING_SCENARIO_NOT_FOUND",
    );
    const events = await client<
      { event_type: string; aggregate_version: number }[]
    >`select event_type, aggregate_version from audit_events
      where actor->>'id' = ${owner.id} order by occurred_at, id`;
    expect(events.map(({ event_type }) => event_type).toSorted()).toEqual([
      "pricing_scenario.created",
      "pricing_scenario.created",
      "pricing_scenario.deleted",
      "pricing_scenario.downloaded",
      "pricing_scenario.updated",
    ]);
  });
});
