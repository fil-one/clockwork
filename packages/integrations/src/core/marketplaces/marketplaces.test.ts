import { IdempotencyKeySchema, QuantitySchema } from "@clockwork/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  AzureMarketplaceFinanceAdapter,
  GoogleMarketplaceFinanceAdapter,
  reconcileMarketplaceFinancials,
} from "./adapters";
import {
  AzureMarketplaceCredentialGate,
  GoogleMarketplaceCredentialGate,
} from "./credential-gates";
import {
  normalizeAwsMarketplaceEvent,
  normalizeAzureMarketplaceEvent,
  normalizeGoogleMarketplaceEvent,
} from "./normalization";
import type { MarketplaceFinancialEvent, MarketplaceTransport } from "./types";

const base = {
  eventTime: "2026-07-31T16:00:00.000Z",
  orderId: "marketplace-order-1",
  customerIdentifier: "buyer-1",
  productCode: "fil-one-storage",
  dimension: "locked-storage-tb",
  status: "recorded",
};

describe("marketplace financial normalization", () => {
  it("normalizes AWS, Azure, and Google fixtures across every financial kind", () => {
    const fixtures = [
      normalizeAwsMarketplaceEvent({
        ...base,
        eventId: "aws-order",
        eventType: "agreement-created",
      }),
      normalizeAzureMarketplaceEvent({
        data: {
          ...base,
          eventId: "azure-entitlement",
          eventType: "subscription-activated",
          resourceId: "buyer-1",
        },
      }),
      normalizeGoogleMarketplaceEvent({
        ...base,
        eventId: "google-meter",
        eventType: "usage-reported",
        accountId: "buyer-1",
        quantity: "1.25",
      }),
      normalizeAwsMarketplaceEvent({
        ...base,
        eventId: "aws-fee",
        eventType: "marketplace-fee",
        feeMinor: "300",
        currency: "USD",
      }),
      normalizeAzureMarketplaceEvent({
        ...base,
        eventId: "azure-invoice",
        eventType: "invoice-issued",
        resourceId: "buyer-1",
        invoiceId: "azure-invoice-1",
        amountMinor: "10000",
        currency: "USD",
      }),
      normalizeGoogleMarketplaceEvent({
        ...base,
        eventId: "google-settlement",
        eventType: "disbursement-settled",
        accountId: "buyer-1",
        settlementId: "google-settlement-1",
        amountMinor: "9200",
        currency: "USD",
      }),
      normalizeAwsMarketplaceEvent({
        ...base,
        eventId: "aws-refund",
        eventType: "customer-refund",
        amountMinor: "500",
        currency: "USD",
      }),
    ];
    expect(fixtures.every((fixture) => fixture.ok)).toBe(true);
    expect(
      fixtures.map((fixture) => (fixture.ok ? fixture.value.kind : "invalid")),
    ).toEqual([
      "order",
      "entitlement",
      "metering",
      "fee",
      "invoice",
      "settlement",
      "refund",
    ]);
    expect(
      fixtures.map((fixture) =>
        fixture.ok ? fixture.value.provider : "invalid",
      ),
    ).toEqual(["aws", "azure", "google", "aws", "azure", "google", "aws"]);
  });

  it.each([
    ["large exact integer", "90071992547409931234"],
    ["exact 18-place fraction", "12345678901234567890.123456789012345678"],
  ])("preserves %s quantity strings exactly", (_label, quantity) => {
    const result = normalizeGoogleMarketplaceEvent({
      ...base,
      eventId: `google-${_label}`,
      eventType: "usage-reported",
      accountId: "buyer-1",
      quantity,
    });
    expect(result).toMatchObject({ ok: true, value: { quantity } });
  });

  it.each([
    ["ordinary numeric", 1.25],
    ["unsafe numeric", Number.MAX_SAFE_INTEGER + 2],
    ["numeric exponent", 1e21],
  ])("rejects %s JSON quantity before normalization", (_label, quantity) => {
    const result = normalizeAwsMarketplaceEvent({
      ...base,
      eventId: `aws-${_label}`,
      eventType: "usage",
      quantity,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it.each(["1e3", "1E+3", "0.0000000000000000001", "100000000000000000000"])(
    "rejects non-canonical quantity string %s",
    (quantity) => {
      const result = normalizeAzureMarketplaceEvent({
        data: {
          ...base,
          eventId: `azure-${quantity}`,
          eventType: "usage",
          resourceId: "buyer-1",
          quantity,
        },
      });
      expect(result).toMatchObject({ ok: false });
    },
  );

  it("enforces signed PostgreSQL bigint bounds for provider money", () => {
    const maximum = normalizeAwsMarketplaceEvent({
      ...base,
      eventId: "aws-money-max",
      eventType: "invoice",
      amountMinor: "9223372036854775807",
      currency: "USD",
    });
    expect(maximum).toMatchObject({
      ok: true,
      value: { amount: { minor: "9223372036854775807" } },
    });
    for (const amountMinor of ["9223372036854775808", "-9223372036854775809"])
      expect(
        normalizeAwsMarketplaceEvent({
          ...base,
          eventId: `aws-money-${amountMinor}`,
          eventType: "invoice",
          amountMinor,
          currency: "USD",
        }),
      ).toMatchObject({ ok: false });
  });

  it("fails closed at the credential gate before issuing any request", async () => {
    const request = vi.fn<MarketplaceTransport["request"]>();
    const adapter = new AzureMarketplaceFinanceAdapter({
      gate: new AzureMarketplaceCredentialGate({ tenantId: "tenant-only" }),
      transport: { request },
      financialEventsUrl: "https://finance.example.test/azure/events",
    });
    const result = await adapter.acceptOrder({
      externalOrderId: "order-1",
      externalEntitlementId: "subscription-1",
      buyerReference: "buyer-1",
      productCode: "storage-product",
      planId: "storage",
      idempotencyKey: IdempotencyKeySchema.parse("azure:order:1:accept"),
    });
    expect(result).toMatchObject({
      ok: false,
      kind: "permanent",
      code: "MARKETPLACE_CREDENTIALS_NOT_CONFIGURED",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("ties metering, invoice, fees, refunds, and settlement at order/SKU grain", () => {
    const normalize = (
      input: Record<string, unknown>,
    ): MarketplaceFinancialEvent => {
      const result = normalizeAwsMarketplaceEvent({ ...base, ...input });
      if (!result.ok) throw new Error(result.message);
      return result.value;
    };
    const lines = reconcileMarketplaceFinancials({
      events: [
        normalize({ eventId: "meter", eventType: "usage", quantity: "2.5" }),
        normalize({
          eventId: "invoice",
          eventType: "invoice",
          amountMinor: "10000",
          currency: "USD",
        }),
        normalize({
          eventId: "fee",
          eventType: "marketplace-fee",
          feeMinor: "300",
          currency: "USD",
        }),
        normalize({
          eventId: "refund",
          eventType: "refund",
          amountMinor: "500",
          currency: "USD",
        }),
        normalize({
          eventId: "settlement",
          eventType: "settlement",
          amountMinor: "9200",
          currency: "USD",
        }),
      ],
    });
    expect(lines).toEqual([
      expect.objectContaining({
        meteredQuantity: "2.5",
        invoicedMinor: "10000",
        feeMinor: "300",
        refundedMinor: "500",
        settledMinor: "9200",
        settlementVarianceMinor: "0",
        status: "tied",
      }),
    ]);
  });

  it("rejects Azure and Google quantities that would lose decimal precision", async () => {
    const request = vi.fn<MarketplaceTransport["request"]>();
    const azure = new AzureMarketplaceFinanceAdapter({
      gate: new AzureMarketplaceCredentialGate({
        tenantId: "tenant",
        clientId: "client",
        clientSecret: "secret",
      }),
      transport: { request },
      financialEventsUrl: "https://finance.example.test/azure/events",
    });
    const google = new GoogleMarketplaceFinanceAdapter({
      providerId: "provider",
      gate: new GoogleMarketplaceCredentialGate({
        projectId: "project",
        serviceAccountEmail: "service@example.test",
        privateKey: "private-key",
      }),
      transport: { request },
      financialEventsUrl: "https://finance.example.test/google/events",
    });
    const input = {
      externalEntitlementId: "entitlement-1",
      buyerReference: "buyer-1",
      productCode: "storage-product",
      dimension: "locked-storage-tb",
      quantity: QuantitySchema.parse("9007199254740993"),
      occurredAt: "2026-07-31T16:00:00.000Z",
      usageEventId: "usage-unsafe-1",
      idempotencyKey: IdempotencyKeySchema.parse("usage:unsafe:precision:1"),
    };

    await expect(azure.reportUsage(input)).resolves.toMatchObject({
      ok: false,
      code: "AZURE_MARKETPLACE_QUANTITY_OUT_OF_RANGE",
    });
    await expect(google.reportUsage(input)).resolves.toMatchObject({
      ok: false,
      code: "GOOGLE_MARKETPLACE_QUANTITY_OUT_OF_RANGE",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects local, literal-IP, and non-provider marketplace endpoints", () => {
    const request = vi.fn<MarketplaceTransport["request"]>();
    const azureGate = new AzureMarketplaceCredentialGate({});
    const googleGate = new GoogleMarketplaceCredentialGate({});

    expect(
      () =>
        new AzureMarketplaceFinanceAdapter({
          gate: azureGate,
          transport: { request },
          financialEventsUrl: "https://127.0.0.1/events",
        }),
    ).toThrow("must not target a local or literal IP host");
    expect(
      () =>
        new AzureMarketplaceFinanceAdapter({
          gate: azureGate,
          transport: { request },
          financialEventsUrl: "https://finance.example.test/events",
          baseUrl: "https://attacker.example.test",
        }),
    ).toThrow("must target marketplaceapi.microsoft.com");
    expect(
      () =>
        new GoogleMarketplaceFinanceAdapter({
          providerId: "provider",
          gate: googleGate,
          transport: { request },
          financialEventsUrl: "https://finance.example.test/events",
          serviceControlBaseUrl: "https://localhost",
        }),
    ).toThrow("must not target a local or literal IP host");
  });

  it("fails closed when currency-less usage has conflicting financial currencies", () => {
    const normalize = (
      input: Record<string, unknown>,
    ): MarketplaceFinancialEvent => {
      const result = normalizeAwsMarketplaceEvent({ ...base, ...input });
      if (!result.ok) throw new Error(result.message);
      return result.value;
    };
    expect(() =>
      reconcileMarketplaceFinancials({
        events: [
          normalize({
            eventId: "meter-ambiguous",
            eventType: "usage",
            quantity: "1",
          }),
          normalize({
            eventId: "invoice-usd",
            eventType: "invoice",
            amountMinor: "100",
            currency: "USD",
          }),
          normalize({
            eventId: "settlement-eur",
            eventType: "settlement",
            amountMinor: "90",
            currency: "EUR",
          }),
        ],
      }),
    ).toThrow("ambiguous currency");
  });
});
