import { describe, expect, it } from "vitest";

import {
  accountName,
  accountNamesFromProjection,
  partyNames,
} from "./account-names";
import {
  billingAccountsByOrder,
  collectionCaseFromProjection,
  customerAccountsByOrder,
} from "./collections-projection";
import { projectionRecord } from "./projection-test-support";
import { renewalOrderFromProjection } from "./renewals-projection";

const CUSTOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESELLER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INVOICE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const names = accountNamesFromProjection([
  projectionRecord({
    recordKey: "meridian-archive",
    aggregateType: "account",
    aggregateId: CUSTOMER,
    channel: "dashboard",
    data: { title: "Meridian Archive Labs, Inc." },
  }),
  projectionRecord({
    recordKey: "harborline",
    aggregateType: "account",
    aggregateId: RESELLER,
    channel: "dashboard",
    data: { name: "Harborline Distribution Ltd" },
  }),
  projectionRecord({
    recordKey: "untitled",
    aggregateType: "account",
    aggregateId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    channel: "dashboard",
    data: { title: "   " },
  }),
]);

describe("account names for staff tables", () => {
  it("reads each account's title, then its name, and skips blank ones", () => {
    expect(names.get(CUSTOMER)).toBe("Meridian Archive Labs, Inc.");
    expect(names.get(RESELLER)).toBe("Harborline Distribution Ltd");
    expect(names.size).toBe(2);
  });

  it("takes the first identity that has a name", () => {
    expect(accountName(names, null, "unknown", RESELLER, CUSTOMER)).toBe(
      "Harborline Distribution Ltd",
    );
    expect(accountName(names, null, undefined)).toBeNull();
  });

  it("names a renewal by its customer, not the reseller that invoices it", () => {
    const order = renewalOrderFromProjection(
      projectionRecord({
        recordKey: "ORD-2026-0098",
        aggregateType: "order",
        aggregateId: ORDER,
        channel: "orders",
        authoritative: {
          accountId: CUSTOMER,
          invoicingAccountId: RESELLER,
          noticeOn: "2026-11-01",
        },
      }),
      new Map(),
      new Date("2026-10-04T00:00:00.000Z"),
      names,
    );
    expect(order.accountName).toBe("Meridian Archive Labs, Inc.");
    expect(order.payerName).toBe("Harborline Distribution Ltd");
    expect(order.reference).toBe("ORD-2026-0098");
  });

  it("names a collections case by the same end customer, with the payer beneath", () => {
    const orders = [
      projectionRecord({
        recordKey: "ORD-2026-0098",
        aggregateType: "order",
        aggregateId: ORDER,
        channel: "orders",
        authoritative: { accountId: CUSTOMER, invoicingAccountId: RESELLER },
      }),
    ];
    const entry = collectionCaseFromProjection(
      projectionRecord({
        recordKey: "INV-2026-0781",
        aggregateType: "invoice",
        aggregateId: INVOICE,
        channel: "collections",
        authoritative: { orderId: ORDER, status: "open" },
        data: { reference: "INV-2026-0781" },
      }),
      billingAccountsByOrder(orders),
      new Date("2026-10-04T00:00:00.000Z"),
      names,
      customerAccountsByOrder(orders),
    );
    expect(entry.accountName).toBe("Meridian Archive Labs, Inc.");
    expect(entry.payerName).toBe("Harborline Distribution Ltd");
    expect(entry.billingAccountId).toBe(RESELLER);
    expect(entry.reference).toBe("INV-2026-0781");
  });

  it("names the payer alone when it is also the customer", () => {
    expect(partyNames(names, [CUSTOMER], CUSTOMER)).toEqual({
      customer: "Meridian Archive Labs, Inc.",
      payer: null,
    });
    expect(partyNames(names, [null], RESELLER)).toEqual({
      customer: "Harborline Distribution Ltd",
      payer: null,
    });
  });

  it("falls back to the record's own reference when no account can be read", () => {
    const entry = collectionCaseFromProjection(
      projectionRecord({
        recordKey: "INV-2026-0900",
        aggregateType: "invoice",
        aggregateId: INVOICE,
        channel: "collections",
        authoritative: { orderId: ORDER },
      }),
    );
    expect(entry.accountName).toBeNull();
  });
});
