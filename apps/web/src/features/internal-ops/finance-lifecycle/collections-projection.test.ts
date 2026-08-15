import { describe, expect, it } from "vitest";

import {
  billingAccountsByOrder,
  collectionCaseFromProjection,
  prioritizeCollectionCases,
  summarizeCollectionCases,
} from "./collections-projection";
import { projectionRecord } from "./projection-test-support";

const now = new Date("2026-08-15T00:00:00.000Z");
const ORDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function invoice(input: {
  id: string;
  amountMinor?: string;
  currency?: string;
  dueAt?: string | null;
  paidAt?: string | null;
  orderId?: string | null;
  status?: string;
  risk?: string;
}) {
  return projectionRecord({
    recordKey: `invoice-${input.id}`,
    aggregateType: "invoice",
    aggregateId: input.id,
    channel: "collections",
    authoritative: {
      orderId: input.orderId === undefined ? ORDER : input.orderId,
      currency: input.currency ?? "USD",
      amountMinor: input.amountMinor ?? "100000",
      status: input.status ?? "open",
      ...(input.dueAt === null ? {} : { dueAt: input.dueAt ?? "2026-07-01" }),
      ...(input.paidAt ? { paidAt: input.paidAt } : {}),
    },
    data: {
      reference: `INV-${input.id.slice(0, 4).toUpperCase()}`,
      value: `$${input.amountMinor ?? "100000"}`,
      status: input.status ?? "open",
      statusLabel: "Open",
      risk: input.risk ?? "high",
      owner: `INV-${input.id.slice(0, 4).toUpperCase()}`,
      nextAction: "Evaluate Dunning",
      term: "Due Jul 1, 2026 · 45 days ago",
    },
  });
}

function order(id: string, invoicingAccountId: string | null) {
  return projectionRecord({
    recordKey: `order-${id}`,
    aggregateType: "order",
    aggregateId: id,
    channel: "orders",
    authoritative: invoicingAccountId ? { invoicingAccountId } : {},
  });
}

describe("collectionCaseFromProjection", () => {
  it("reads the invoice's own allowlisted columns rather than the display text", () => {
    const entry = collectionCaseFromProjection(
      invoice({ id: "11111111-1111-4111-8111-111111111111" }),
      new Map(),
      now,
    );

    expect(entry.amountMinor).toBe(100000n);
    expect(entry.currency).toBe("USD");
    expect(entry.overdue).toBe(true);
    expect(entry.overdueDays).toBe(45);
    expect(entry.orderId).toBe(ORDER);
  });

  /**
   * `listProjections` selects `audience_account_id`, which is null for every
   * internal row, and the invoice payload carries no account. Without the order
   * join no correction could be bound, so the join is the thing under test.
   */
  it("joins the billing account through the invoice's order", () => {
    const accounts = billingAccountsByOrder([order(ORDER, ACCOUNT)]);
    const entry = collectionCaseFromProjection(
      invoice({ id: "11111111-1111-4111-8111-111111111111" }),
      accounts,
      now,
    );

    expect(entry.billingAccountId).toBe(ACCOUNT);
  });

  it("leaves the billing account null when the order is out of scope", () => {
    const entry = collectionCaseFromProjection(
      invoice({ id: "11111111-1111-4111-8111-111111111111" }),
      billingAccountsByOrder([order("other-order", ACCOUNT)]),
      now,
    );

    expect(entry.billingAccountId).toBeNull();
  });

  it("does not report a paid invoice as overdue", () => {
    const entry = collectionCaseFromProjection(
      invoice({
        id: "22222222-2222-4222-8222-222222222222",
        paidAt: "2026-07-05",
      }),
      new Map(),
      now,
    );

    expect(entry.overdue).toBe(false);
    expect(entry.overdueDays).toBeNull();
  });

  it("drops the owner when it only repeats the record's own reference", () => {
    const entry = collectionCaseFromProjection(
      invoice({ id: "33333333-3333-4333-8333-333333333333" }),
      new Map(),
      now,
    );

    expect(entry.owner).toBeNull();
  });
});

describe("prioritizeCollectionCases", () => {
  it("ranks by amount, then days past due, then reference", () => {
    const cases = [
      invoice({
        id: "11111111-1111-4111-8111-111111111111",
        amountMinor: "5000",
      }),
      invoice({
        id: "22222222-2222-4222-8222-222222222222",
        amountMinor: "90000",
        dueAt: "2026-08-10",
      }),
      invoice({
        id: "33333333-3333-4333-8333-333333333333",
        amountMinor: "90000",
        dueAt: "2026-06-01",
      }),
    ].map((record) => collectionCaseFromProjection(record, new Map(), now));

    expect(
      prioritizeCollectionCases(cases).map((entry) => entry.overdueDays),
    ).toEqual([75, 5, 45]);
  });

  it("sorts an unreadable amount last rather than treating it as zero", () => {
    const cases = [
      invoice({
        id: "11111111-1111-4111-8111-111111111111",
        amountMinor: "not-a-number",
      }),
      invoice({ id: "22222222-2222-4222-8222-222222222222", amountMinor: "1" }),
    ].map((record) => collectionCaseFromProjection(record, new Map(), now));

    expect(
      prioritizeCollectionCases(cases).map((entry) => entry.amountMinor),
    ).toEqual([1n, null]);
  });
});

describe("summarizeCollectionCases", () => {
  it("totals the dominant currency and refuses to add another to it", () => {
    const cases = [
      invoice({
        id: "11111111-1111-4111-8111-111111111111",
        amountMinor: "150000",
      }),
      invoice({
        id: "22222222-2222-4222-8222-222222222222",
        amountMinor: "50000",
      }),
      invoice({
        id: "33333333-3333-4333-8333-333333333333",
        amountMinor: "999999",
        currency: "EUR",
      }),
    ].map((record) => collectionCaseFromProjection(record, new Map(), now));

    const summary = summarizeCollectionCases(cases);
    expect(summary.openTotal).toBe("$2,000.00");
    expect(summary.excludedByCurrency).toBe(1);
    expect(summary.oldestOverdueDays).toBe(45);
  });
});
