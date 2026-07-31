import { describe, expect, it } from "vitest";

import { demoPersonas } from "../personas/catalog";
import {
  createDemoSeed,
  DEMO_NOW,
  DEMO_ORIGIN,
  pristineDemoSeed,
} from "./seed";

function expectUniqueIds(values: readonly { readonly id: string }[]): void {
  const ids = values.map(({ id }) => id);
  expect(new Set(ids).size).toBe(ids.length);
}

describe("deterministic demo seed", () => {
  it("is reproducible and anchored to the shared foundation clock", () => {
    expect(createDemoSeed()).toEqual(createDemoSeed());
    expect(pristineDemoSeed.metadata).toMatchObject({
      fictional: true,
      generatedAt: DEMO_NOW,
      origin: DEMO_ORIGIN,
      resetTarget: "demo",
    });
  });

  it("maintains references across the complete artifact chain", () => {
    const accountIds = new Set(pristineDemoSeed.accounts.map(({ id }) => id));
    const agreementIds = new Set(
      pristineDemoSeed.agreements.map(({ id }) => id),
    );
    const quoteIds = new Set(pristineDemoSeed.quotes.map(({ id }) => id));
    const orderIds = new Set(pristineDemoSeed.orders.map(({ id }) => id));
    const serviceIds = new Set(pristineDemoSeed.services.map(({ id }) => id));
    const invoiceIds = new Set(pristineDemoSeed.invoices.map(({ id }) => id));

    for (const agreement of pristineDemoSeed.agreements) {
      expect(accountIds.has(agreement.accountId)).toBe(true);
    }
    for (const quote of pristineDemoSeed.quotes) {
      expect(accountIds.has(quote.accountId)).toBe(true);
      expect(agreementIds.has(quote.governingAgreementId)).toBe(true);
      if (
        "endClientAccountId" in quote &&
        quote.endClientAccountId !== undefined
      ) {
        expect(accountIds.has(quote.endClientAccountId)).toBe(true);
      }
    }
    for (const order of pristineDemoSeed.orders) {
      expect(accountIds.has(order.accountId)).toBe(true);
      expect(accountIds.has(order.invoicingPartyAccountId)).toBe(true);
      expect(agreementIds.has(order.agreementId)).toBe(true);
      expect(quoteIds.has(order.quoteId)).toBe(true);
    }
    for (const service of pristineDemoSeed.services) {
      expect(accountIds.has(service.accountId)).toBe(true);
      expect(orderIds.has(service.orderId)).toBe(true);
    }
    for (const amendment of pristineDemoSeed.amendments) {
      expect(orderIds.has(amendment.orderId)).toBe(true);
    }
    for (const payment of pristineDemoSeed.payments) {
      expect(invoiceIds.has(payment.invoiceId)).toBe(true);
    }
    for (const item of pristineDemoSeed.offboarding) {
      expect(accountIds.has(item.accountId)).toBe(true);
      expect(serviceIds.has(item.serviceId)).toBe(true);
    }
  });

  it("contains the interesting commercial and recovery states needed by journeys", () => {
    expect(new Set(pristineDemoSeed.quotes.map(({ state }) => state))).toEqual(
      new Set([
        "accepted",
        "awaiting_finance_approval",
        "draft",
        "expired",
        "issued",
      ]),
    );
    expect(new Set(pristineDemoSeed.pocs.map(({ state }) => state))).toEqual(
      new Set(["converted", "expired", "running"]),
    );
    expect(
      new Set(pristineDemoSeed.invoices.map(({ state }) => state)),
    ).toEqual(new Set(["disputed", "due", "overdue", "paid"]));
    expect(
      new Set(pristineDemoSeed.queueItems.map(({ state }) => state)),
    ).toEqual(new Set(["blocked", "due", "recoverable", "stale_version"]));
    expect(
      pristineDemoSeed.services.some(
        ({ state }) => state === "offboarding_retention_locked",
      ),
    ).toBe(true);
  });

  it("uses unique projection IDs and visibly fictional network identities", () => {
    for (const collection of [
      pristineDemoSeed.accounts,
      pristineDemoSeed.agreements,
      pristineDemoSeed.quotes,
      pristineDemoSeed.orders,
      pristineDemoSeed.services,
      pristineDemoSeed.amendments,
      pristineDemoSeed.pocs,
      pristineDemoSeed.invoices,
      pristineDemoSeed.payments,
      pristineDemoSeed.dealRegistrations,
      pristineDemoSeed.commissions,
      pristineDemoSeed.renewals,
      pristineDemoSeed.sandboxes,
      pristineDemoSeed.marketplaces,
      pristineDemoSeed.supportTickets,
      pristineDemoSeed.offboarding,
      pristineDemoSeed.queueItems,
      pristineDemoSeed.timeline,
      pristineDemoSeed.notifications,
    ]) {
      expectUniqueIds(collection);
    }

    for (const account of pristineDemoSeed.accounts) {
      expect(account.billingEmail).toMatch(/\.test$/);
    }
    for (const persona of Object.values(demoPersonas)) {
      expect(persona.email).toMatch(/\.test$/);
    }
  });
});
