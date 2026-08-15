import { describe, expect, it } from "vitest";

import { projectionRecord } from "./projection-test-support";
import {
  groupRenewalOrders,
  invoiceTotalsByOrder,
  renewalOrderFromProjection,
} from "./renewals-projection";

const now = new Date("2026-08-15T00:00:00.000Z");

function order(id: string, noticeOn: string | null, sourcing = "resale") {
  return projectionRecord({
    recordKey: `order-${id}`,
    aggregateType: "order",
    aggregateId: id,
    channel: "orders",
    authoritative: {
      sourcing,
      status: "active",
      serviceStartsOn: "2026-01-01",
      serviceEndsOn: "2026-12-31",
      invoicingAccountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ...(noticeOn ? { noticeOn } : {}),
    },
    data: {
      reference: `ORD-${id.slice(0, 4).toUpperCase()}`,
      statusLabel: "Active",
      risk: "low",
      term: "Jan 1, 2026 – Dec 31, 2026",
    },
  });
}

function invoice(
  id: string,
  orderId: string,
  amountMinor: string,
  currency = "USD",
) {
  return projectionRecord({
    recordKey: `invoice-${id}`,
    aggregateType: "invoice",
    aggregateId: id,
    channel: "collections",
    authoritative: { orderId, amountMinor, currency, status: "paid" },
  });
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

describe("renewalOrderFromProjection", () => {
  it("derives the notice window from the order's own notice date", () => {
    const windows = [
      order(A, "2026-08-01"),
      order(B, "2026-09-01"),
      order(C, "2026-11-01"),
      order(D, null),
    ].map(
      (record) => renewalOrderFromProjection(record, new Map(), now).window,
    );

    expect(windows).toEqual(["notice-passed", "30", "60-90", "unscheduled"]);
  });

  it("counts the days to notice with the right sign", () => {
    expect(
      renewalOrderFromProjection(order(A, "2026-08-01"), new Map(), now)
        .daysToNotice,
    ).toBe(-14);
    expect(
      renewalOrderFromProjection(order(B, "2026-09-01"), new Map(), now)
        .daysToNotice,
    ).toBe(17);
  });

  /**
   * No projection carries an order amount, so the only money attributable to a
   * renewing order is the invoices raised against it. It is labelled invoice
   * truth on the surface, never exposure.
   */
  it("attaches invoice truth joined from the collections channel", () => {
    const totals = invoiceTotalsByOrder([
      invoice(B, A, "150000"),
      invoice(C, A, "50000"),
      invoice(D, "other-order", "999999"),
    ]);
    const renewal = renewalOrderFromProjection(
      order(A, "2026-09-01"),
      totals,
      now,
    );

    expect(renewal.invoicedToDate).toBe("$2,000.00");
    expect(renewal.invoiceCount).toBe(2);
  });

  it("reports no invoice total when the order has none", () => {
    const renewal = renewalOrderFromProjection(
      order(A, "2026-09-01"),
      new Map(),
      now,
    );

    expect(renewal.invoicedToDate).toBeNull();
    expect(renewal.invoiceCount).toBe(0);
  });

  it("takes the route from the order's sourcing column", () => {
    expect(
      renewalOrderFromProjection(
        order(A, "2026-09-01", "distributor"),
        new Map(),
        now,
      ).route,
    ).toBe("distributor");
    expect(
      renewalOrderFromProjection(
        projectionRecord({
          recordKey: `order-${A}`,
          aggregateType: "order",
          aggregateId: A,
          channel: "orders",
          authoritative: { noticeOn: "2026-09-01" },
        }),
        new Map(),
        now,
      ).route,
    ).toBeNull();
  });
});

describe("groupRenewalOrders", () => {
  it("orders each window by how soon notice falls due", () => {
    const grouped = groupRenewalOrders(
      [
        order(B, "2026-09-10"),
        order(A, "2026-08-20"),
        order(C, "2026-11-01"),
      ].map((record) => renewalOrderFromProjection(record, new Map(), now)),
    );

    expect(grouped["30"].map((entry) => entry.daysToNotice)).toEqual([5, 26]);
    expect(grouped["60-90"].map((entry) => entry.daysToNotice)).toEqual([78]);
  });
});
