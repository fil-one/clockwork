import { describe, expect, it } from "vitest";

import type { ProjectionRecord } from "@/src/features/experience-server/model";

import { recordById } from "@/src/features/customer-partner/commercial/model";
import { translatorFor } from "@/src/i18n/catalogs";

import {
  offboardableService,
  requestedOrderAggregateId,
} from "./select-service";

function record(
  channel: ProjectionRecord["channel"],
  recordKey: string,
  aggregateId: string,
  data: Readonly<Record<string, unknown>> = {},
): ProjectionRecord {
  return {
    id: `projection-${recordKey}`,
    recordKey,
    aggregateType: channel,
    aggregateId,
    accountId: "10000000-0000-4000-8000-000000000001",
    audience: "customer",
    channel,
    version: 1,
    sourceUpdatedAt: "2026-07-31T16:00:00.000Z",
    projectedAt: "2026-07-31T16:00:00.000Z",
    stale: false,
    data,
  };
}

const primary = record(
  "orders",
  "ORD-2026-0098",
  "50000000-0000-4000-8000-000000000008",
);
const replica = record(
  "orders",
  "ORD-2026-0112",
  "50000000-0000-4000-8000-000000000009",
);
const openOrders = [primary, replica];

describe("requestedOrderAggregateId", () => {
  it("selects nothing when no reference was requested", () => {
    expect(
      requestedOrderAggregateId(undefined, openOrders, []),
    ).toBeUndefined();
  });

  it("selects an open order named directly by its record key", () => {
    expect(requestedOrderAggregateId("ORD-2026-0112", openOrders, [])).toBe(
      replica.aggregateId,
    );
  });

  /**
   * The materialized shape. A customer `services` row is the `termination`
   * aggregate, whose authoritative payload carries `orderId` -- the order's
   * aggregate id, which is what the offboarding command is issued against.
   */
  it("resolves a service that names its order as an authoritative orderId", () => {
    const service = record(
      "services",
      "termination-70000000-0000-4000-8000-000000000001",
      "70000000-0000-4000-8000-000000000001",
      { authoritative: { orderId: replica.aggregateId } },
    );

    expect(
      requestedOrderAggregateId(service.recordKey, openOrders, [service]),
    ).toBe(replica.aggregateId);
  });

  /** The fixture shape: the service states its order as its own detail route. */
  it("resolves a service that names its order as an orders detail route", () => {
    const service = record(
      "services",
      "SVC-PRIMARY-01",
      "50000000-0000-4000-8000-000000000010",
      { href: "/orders/ORD-2026-0098" },
    );

    expect(
      requestedOrderAggregateId("SVC-PRIMARY-01", openOrders, [service]),
    ).toBe(primary.aggregateId);
  });

  it("decodes a reference the detail route escaped", () => {
    const encoded = record("orders", "ORD/2026 0098", "aggregate-encoded");
    const service = record("services", "SVC-ENCODED", "service-encoded", {
      href: "/orders/ORD%2F2026%200098",
    });

    expect(requestedOrderAggregateId("SVC-ENCODED", [encoded], [service])).toBe(
      "aggregate-encoded",
    );
  });

  it("selects nothing for a service whose order is not open to this reader", () => {
    const service = record("services", "SVC-CLOSED", "service-closed", {
      authoritative: { orderId: "50000000-0000-4000-8000-00000000ffff" },
      href: "/orders/ORD-NOT-OPEN",
    });

    expect(
      requestedOrderAggregateId("SVC-CLOSED", openOrders, [service]),
    ).toBeUndefined();
  });

  it("selects nothing for a service that names no order", () => {
    const service = record("services", "SVC-BARE", "service-bare", {
      title: "Northstar primary archive",
    });

    expect(
      requestedOrderAggregateId("SVC-BARE", openOrders, [service]),
    ).toBeUndefined();
  });

  it("reads no reference out of a route that is not one order detail path", () => {
    const services = [
      record("services", "SVC-LIST", "a", { href: "/orders" }),
      record("services", "SVC-DEEP", "b", { href: "/orders/ORD-2026-0098/x" }),
      record("services", "SVC-QUERY", "c", {
        href: "/orders/ORD-2026-0098?tab=1",
      }),
      record("services", "SVC-OTHER", "d", { href: "/services/ORD-2026-0098" }),
    ];

    for (const service of services)
      expect(
        requestedOrderAggregateId(service.recordKey, openOrders, services),
      ).toBeUndefined();
  });

  it("selects nothing for a reference no channel holds", () => {
    expect(
      requestedOrderAggregateId(
        "50000000-0000-4000-8000-000000000010",
        openOrders,
        [],
      ),
    ).toBeUndefined();
  });
});

describe("the service picker's labels", () => {
  /**
   * The picker read the order's English display term, so a Spanish customer
   * chose "Archivo principal de Northstar · Jan 1–Dec 31, 2026 · auto-renews".
   */
  it("states an order's term in the reader's language", () => {
    const fixture = recordById("ORD-2026-0098", "en");
    if (!fixture?.facts) throw new Error("the demo order carries facts");
    const order = record("orders", "ORD-2026-0098", "order-0098", {
      title: "Archivo principal de Northstar",
      status: fixture.status,
      term: "Jan 1 – Dec 31, 2026 · auto-renews",
      facts: fixture.facts,
    });
    const { label } = offboardableService(order, translatorFor("es"), "es-ES");
    expect(label).toMatch(/^Archivo principal de Northstar · /u);
    expect(label).not.toMatch(/Jan|Dec|auto-renews/u);
    expect(label).toMatch(/2026/u);
  });

  it("keeps the term as written when the order has no facts", () => {
    const order = record("orders", "ORD-X", "order-x", {
      title: "Archive",
      term: "Written term",
    });
    expect(offboardableService(order, translatorFor("es"), "es-ES").label).toBe(
      translatorFor("es")("common.join.labels", {
        first: "Archive",
        second: "Written term",
      }),
    );
  });
});
