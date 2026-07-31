import type { WebhookVerifier } from "@clockwork/contracts";
import { IdempotencyKeySchema, ids } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import {
  FakeMarketplacePlatformAdapter,
  InMemoryMarketplaceWebhookBindingStore,
  MarketplaceWebhookVerifier,
  signFakeMarketplaceWebhook,
  type VerifiedMarketplaceWebhookEvent,
} from "./index";

const organizationId = ids.organization.parse(
  "30000000-0000-4000-8000-000000000309",
);

describe("marketplace platform provider contract", () => {
  it("publishes provisioning and entitlement events idempotently", async () => {
    const adapter = new FakeMarketplacePlatformAdapter();
    const input = {
      event: {
        type: "marketplace.provisioning.requested" as const,
        marketplace: "fixture-marketplace",
        marketplaceOrderId: "mp-order-309",
        organizationId,
        offerId: "offer-309",
        occurredAt: "2026-07-31T16:00:00.000Z",
      },
      idempotencyKey: IdempotencyKeySchema.parse(
        "marketplace:provision:contract:309",
      ),
    };
    const first = await adapter.publish(input);
    const replay = await adapter.publish(input);
    expect(first.ok && replay.ok).toBe(true);
    expect(replay.ok && replay.duplicate).toBe(true);
    expect(adapter.published).toHaveLength(1);
  });

  it("returns the exact verifier contract and leaves replay claims to the API", async () => {
    const secret = "marketplace_contract_secret_309";
    const timestamp = 1_775_059_200;
    const store = bindingStore();
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        providerEventId: "mp-event-309",
        type: "marketplace.entitlement.updated",
        marketplace: "fixture-marketplace",
        marketplaceAccountId: "seller-account-309",
        providerResourceType: "subscription",
        providerResourceId: "subscription-309",
        marketplaceOrderId: "mp-order-309",
        organizationId,
        entitlementId: "entitlement-309",
        quantity: "5",
        status: "active",
        occurredAt: "2026-07-31T16:00:00.000Z",
      }),
    );
    const signature = signFakeMarketplaceWebhook({
      secret,
      timestamp,
      rawBody,
    });
    const verifier = new MarketplaceWebhookVerifier(
      secret,
      store,
      () => timestamp,
    );
    const contract: WebhookVerifier<VerifiedMarketplaceWebhookEvent> = verifier;
    const first = await contract.verify({ rawBody, signature });
    expect(first).toEqual({
      eventId: "mp-event-309",
      occurredAt: "2026-07-31T16:00:00.000Z",
      payload: {
        providerEventId: "mp-event-309",
        type: "marketplace.entitlement.updated",
        marketplace: "fixture-marketplace",
        marketplaceAccountId: "seller-account-309",
        providerResourceType: "subscription",
        providerResourceId: "subscription-309",
        marketplaceOrderId: "mp-order-309",
        organizationId,
        entitlementId: "entitlement-309",
        quantity: "5",
        status: "active",
        occurredAt: "2026-07-31T16:00:00.000Z",
      },
    });
    await expect(verifier.verify({ rawBody, signature })).resolves.toEqual(
      first,
    );
  });

  it("rejects signed events that conflict with durable resource bindings", async () => {
    const secret = "marketplace_contract_secret_309";
    const timestamp = 1_775_059_200;
    const verifier = new MarketplaceWebhookVerifier(
      secret,
      bindingStore(),
      () => timestamp,
    );
    const base = {
      providerEventId: "mp-event-309",
      type: "marketplace.entitlement.updated",
      marketplace: "fixture-marketplace",
      marketplaceAccountId: "seller-account-309",
      providerResourceType: "subscription",
      providerResourceId: "subscription-309",
      marketplaceOrderId: "mp-order-309",
      organizationId,
      entitlementId: "entitlement-309",
      quantity: "5",
      status: "active",
      occurredAt: "2026-07-31T16:00:00.000Z",
    };

    await expectSignedFailure(
      verifier,
      secret,
      timestamp,
      { ...base, organizationId: "30000000-0000-4000-8000-000000000999" },
      "binding mismatch",
    );
    await expectSignedFailure(
      verifier,
      secret,
      timestamp,
      { ...base, marketplaceAccountId: "other-seller-account" },
      "binding mismatch",
    );
    await expectSignedFailure(
      verifier,
      secret,
      timestamp,
      { ...base, providerResourceId: "subscription-unbound" },
      "not bound",
    );
    await expectSignedFailure(
      verifier,
      secret,
      timestamp,
      { ...base, providerResourceType: "order" },
      "identity mismatch",
    );
  });

  it("rejects altered and stale messages before resolving bindings", async () => {
    const secret = "marketplace_contract_secret_309";
    const timestamp = 1_775_059_200;
    const event = entitlementEvent();
    const rawBody = encode(event);
    const signature = signFakeMarketplaceWebhook({
      secret,
      timestamp,
      rawBody,
    });
    const verifier = new MarketplaceWebhookVerifier(
      secret,
      bindingStore(),
      () => timestamp,
    );
    const altered = encode({ ...event, quantity: "500" });
    await expect(
      verifier.verify({ rawBody: altered, signature }),
    ).rejects.toThrow("signature");
    const stale = new MarketplaceWebhookVerifier(
      secret,
      bindingStore(),
      () => timestamp + 301,
    );
    await expect(stale.verify({ rawBody, signature })).rejects.toThrow(
      "outside tolerance",
    );
  });

  it("keeps marketplace resource bindings immutable", async () => {
    const store = bindingStore();
    await expect(
      store.save({
        marketplace: "fixture-marketplace",
        marketplaceAccountId: "seller-account-309",
        providerResourceType: "subscription",
        providerResourceId: "subscription-309",
        marketplaceOrderId: "mp-order-309",
        organizationId: ids.organization.parse(
          "30000000-0000-4000-8000-000000000999",
        ),
        entitlementId: "entitlement-309",
      }),
    ).rejects.toThrow("binding conflict");
  });
});

function bindingStore(): InMemoryMarketplaceWebhookBindingStore {
  return new InMemoryMarketplaceWebhookBindingStore([
    {
      marketplace: "fixture-marketplace",
      marketplaceAccountId: "seller-account-309",
      providerResourceType: "subscription",
      providerResourceId: "subscription-309",
      marketplaceOrderId: "mp-order-309",
      organizationId,
      entitlementId: "entitlement-309",
    },
  ]);
}

function entitlementEvent() {
  return {
    providerEventId: "mp-event-309",
    type: "marketplace.entitlement.updated",
    marketplace: "fixture-marketplace",
    marketplaceAccountId: "seller-account-309",
    providerResourceType: "subscription",
    providerResourceId: "subscription-309",
    marketplaceOrderId: "mp-order-309",
    organizationId,
    entitlementId: "entitlement-309",
    quantity: "5",
    status: "active",
    occurredAt: "2026-07-31T16:00:00.000Z",
  };
}

async function expectSignedFailure(
  verifier: MarketplaceWebhookVerifier,
  secret: string,
  timestamp: number,
  event: unknown,
  message: string,
): Promise<void> {
  const rawBody = encode(event);
  await expect(
    verifier.verify({
      rawBody,
      signature: signFakeMarketplaceWebhook({
        secret,
        timestamp,
        rawBody,
      }),
    }),
  ).rejects.toThrow(message);
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
