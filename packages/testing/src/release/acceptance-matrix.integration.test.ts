import { describe, expect, it } from "vitest";

import { demoAccountIds } from "../personas/catalog";
import { createDemoSeed, demoIds } from "../demo/seed";

function one<T>(items: readonly T[], predicate: (item: T) => boolean): T {
  const matches = items.filter(predicate);
  expect(matches).toHaveLength(1);
  const match = matches[0];
  if (!match) throw new Error("Expected exactly one release fixture");
  return match;
}

describe("release-candidate artifact joins", () => {
  it("carries the direct agreement, quote, order, PO, service, invoice, payment, and receipt chain", () => {
    const seed = createDemoSeed();
    const order = one(seed.orders, ({ id }) => id === demoIds.orders.direct);
    const quote = one(seed.quotes, ({ id }) => id === order.quoteId);
    const agreement = one(
      seed.agreements,
      ({ id }) => id === order.agreementId,
    );
    const service = one(seed.services, ({ orderId }) => orderId === order.id);
    const invoice = one(
      seed.invoices,
      ({ purchaseOrderNumber, accountId, state }) =>
        purchaseOrderNumber === order.purchaseOrderNumber &&
        accountId === order.invoicingPartyAccountId &&
        accountId === order.accountId &&
        state === "paid",
    );
    const payment = one(
      seed.payments,
      ({ invoiceId, state }) =>
        invoiceId === invoice.id && state === "succeeded",
    );

    expect(quote).toMatchObject({
      accountId: demoAccountIds.direct,
      governingAgreementId: agreement.id,
      state: "accepted",
    });
    expect(quote.documentId).toBeTruthy();
    expect(agreement).toMatchObject({
      accountId: demoAccountIds.direct,
      executionState: "active",
    });
    expect(agreement.documentHash).toMatch(/^sha256:/);
    expect(service).toMatchObject({
      accountId: order.accountId,
      state: "live",
    });
    expect(invoice.purchaseOrderNumber).toBe(order.purchaseOrderNumber);
    expect(payment).toMatchObject({
      amount: invoice.amount,
    });
    expect(payment.receiptDocumentId).toBeTruthy();
  });

  it("keeps referral billing direct and ties collected revenue to statements and clawbacks", () => {
    const seed = createDemoSeed();
    const registration = one(
      seed.dealRegistrations,
      ({ path }) => path === "referral",
    );
    const order = one(seed.orders, ({ id }) => id === demoIds.orders.endClient);
    const quote = one(seed.quotes, ({ id }) => id === order.quoteId);
    const statements = seed.commissions.filter(
      ({ partnerAccountId }) =>
        partnerAccountId === registration.partnerAccountId,
    );

    expect(registration.endClientAccountId).toBe(order.accountId);
    expect(order.invoicingPartyAccountId).toBe(order.accountId);
    expect(quote).toMatchObject({
      accountId: order.accountId,
      endClientAccountId: order.accountId,
      path: "referral",
    });
    expect(statements).not.toHaveLength(0);
    expect(statements.some(({ clawback }) => BigInt(clawback.minor) > 0n)).toBe(
      true,
    );
    expect(
      seed.invoices.some(
        ({ accountId }) => accountId === registration.partnerAccountId,
      ),
    ).toBe(false);
  });

  it("keeps resale and distributor economics on the partner invoice only", () => {
    const seed = createDemoSeed();

    for (const path of ["resale", "distributor"] as const) {
      const registration = one(
        seed.dealRegistrations,
        (item) => item.path === path,
      );
      const orderId =
        path === "resale" ? demoIds.orders.resale : demoIds.orders.distributor;
      const order = one(seed.orders, ({ id }) => id === orderId);
      const invoice = one(
        seed.invoices,
        ({ accountId, purchaseOrderNumber }) =>
          accountId === registration.partnerAccountId &&
          purchaseOrderNumber === order.purchaseOrderNumber,
      );

      expect(order.accountId).toBe(registration.endClientAccountId);
      expect(order.invoicingPartyAccountId).toBe(registration.partnerAccountId);
      expect(invoice.consolidatedEndClientCount).toBeGreaterThan(0);
      expect(
        seed.invoices.some(
          ({ accountId, purchaseOrderNumber }) =>
            accountId === registration.endClientAccountId &&
            purchaseOrderNumber === order.purchaseOrderNumber,
        ),
      ).toBe(false);
    }

    const resaleDocuments = seed.quotes.filter(({ path }) =>
      ["resale_customer", "resale_transfer"].includes(path),
    );
    expect(resaleDocuments).toHaveLength(2);
    expect(resaleDocuments.every(({ documentId }) => Boolean(documentId))).toBe(
      true,
    );
  });

  it("covers each marketplace settlement projection without changing commerce ownership", () => {
    const seed = createDemoSeed();
    expect(new Set(seed.marketplaces.map(({ provider }) => provider))).toEqual(
      new Set(["aws", "azure", "gcp"]),
    );
    expect(seed.marketplaces.every(({ readOnly }) => readOnly)).toBe(true);
    for (const connection of seed.marketplaces)
      expect(seed.accounts.some(({ id }) => id === connection.accountId)).toBe(
        true,
      );
  });

  it("preserves the paid-conversion chain and isolates every POC account", () => {
    const seed = createDemoSeed();
    const converted = one(seed.pocs, ({ state }) => state === "converted");
    const quote = one(
      seed.quotes,
      ({ id }) => id === converted.convertedQuoteId,
    );
    const order = one(seed.orders, ({ quoteId }) => quoteId === quote.id);
    const service = one(seed.services, ({ orderId }) => orderId === order.id);

    expect(quote.accountId).toBe(converted.accountId);
    expect(order.accountId).toBe(converted.accountId);
    expect(service.accountId).toBe(converted.accountId);
    expect(converted.successTestsPassed).toBe(converted.successTestsTotal);
    expect(seed.pocs.every(({ accountId }) => Boolean(accountId))).toBe(true);
  });

  it("joins amendments, notices, retention exclusions, and renewal routing to one service clock", () => {
    const seed = createDemoSeed();
    for (const amendment of seed.amendments) {
      const order = one(seed.orders, ({ id }) => id === amendment.orderId);
      expect(amendment.effectiveOn >= order.startsOn).toBe(true);
      expect(amendment.effectiveOn <= order.endsOn).toBe(true);
    }
    for (const renewal of seed.renewals) {
      const agreement = one(
        seed.agreements,
        ({ id }) => id === renewal.agreementId,
      );
      expect(agreement.accountId).toBe(
        renewal.orderId
          ? one(seed.orders, ({ id }) => id === renewal.orderId)
              .invoicingPartyAccountId
          : renewal.accountId,
      );
    }
    for (const offboarding of seed.offboarding) {
      const service = one(
        seed.services,
        ({ id }) => id === offboarding.serviceId,
      );
      expect(service.accountId).toBe(offboarding.accountId);
      expect(offboarding.deletionEligibleOn > offboarding.effectiveOn).toBe(
        true,
      );
      for (const exclusion of offboarding.retentionExclusions)
        expect(offboarding.deletionEligibleOn > exclusion.retainedUntil).toBe(
          true,
        );
    }
  });

  it("keeps co-mingled partner/end-client visibility tied to each order", () => {
    const seed = createDemoSeed();
    for (const order of seed.orders) {
      const account = one(seed.accounts, ({ id }) => id === order.accountId);
      const invoicingParty = one(
        seed.accounts,
        ({ id }) => id === order.invoicingPartyAccountId,
      );
      if (account.relationship === "end_client" && account.parentAccountId) {
        const registration = seed.dealRegistrations.find(
          ({ endClientAccountId }) => endClientAccountId === account.id,
        );
        expect(registration?.partnerAccountId).toBe(account.parentAccountId);
        expect([account.id, account.parentAccountId]).toContain(
          invoicingParty.id,
        );
      } else {
        expect(invoicingParty.id).toBe(account.id);
      }
    }
  });

  it("attributes assisted execution to the actual actor without changing the artifact chain", () => {
    const seed = createDemoSeed();
    const assisted = one(
      seed.timeline,
      ({ kind }) => kind === "assisted_action",
    );
    const order = one(
      seed.orders,
      ({ accountId }) => accountId === assisted.accountId,
    );
    const quote = one(seed.quotes, ({ id }) => id === order.quoteId);

    expect(assisted.actor).toMatch(/.+ for .+/);
    expect(order.quoteId).toBe(quote.id);
    expect(quote.endClientAccountId).toBe(order.accountId);
    expect(order.agreementId).not.toHaveLength(0);
  });
});
