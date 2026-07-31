import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type {
  IdempotencyKey,
  OrganizationId,
  ProviderResult,
  WebhookVerificationResult,
  WebhookVerifier,
} from "@clockwork/contracts";

export type MarketplacePlatformEvent =
  | {
      type: "marketplace.provisioning.requested";
      marketplace: string;
      marketplaceOrderId: string;
      organizationId: OrganizationId;
      offerId: string;
      occurredAt: string;
    }
  | {
      type: "marketplace.entitlement.updated";
      marketplace: string;
      marketplaceOrderId: string;
      organizationId: OrganizationId;
      entitlementId: string;
      quantity: string;
      status: "active" | "suspended" | "ended";
      occurredAt: string;
    };

export interface MarketplaceEventDelivery {
  deliveryId: string;
  providerEventId: string;
  accepted: boolean;
}

export interface MarketplacePlatformPort {
  publish(input: {
    event: MarketplacePlatformEvent;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<MarketplaceEventDelivery>>;
}

export interface MarketplaceProviderClient {
  publish(input: {
    event: MarketplacePlatformEvent;
    idempotencyKey: string;
  }): Promise<{ eventId: string; accepted: boolean }>;
}

export class MarketplacePlatformAdapter implements MarketplacePlatformPort {
  public constructor(private readonly client: MarketplaceProviderClient) {}

  public async publish(input: {
    event: MarketplacePlatformEvent;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<MarketplaceEventDelivery>> {
    try {
      const result = await this.client.publish(input);
      return {
        ok: true,
        value: {
          deliveryId: stableId("marketplace_delivery", input.idempotencyKey),
          providerEventId: result.eventId,
          accepted: result.accepted,
        },
      };
    } catch (error) {
      return {
        ok: false,
        kind: "transient",
        code: "MARKETPLACE_PROVIDER_ERROR",
        message:
          error instanceof Error ? error.message : "Unknown marketplace error",
      };
    }
  }
}

export class FakeMarketplacePlatformAdapter implements MarketplacePlatformPort {
  private readonly deliveries = new Map<
    string,
    { fingerprint: string; result: MarketplaceEventDelivery }
  >();
  private nextFailure: "transient" | "permanent" | undefined;

  public readonly published: MarketplacePlatformEvent[] = [];

  public failNext(kind: "transient" | "permanent"): void {
    this.nextFailure = kind;
  }

  public publish(input: {
    event: MarketplacePlatformEvent;
    idempotencyKey: IdempotencyKey;
  }): Promise<ProviderResult<MarketplaceEventDelivery>> {
    if (this.nextFailure) {
      const kind = this.nextFailure;
      this.nextFailure = undefined;
      return Promise.resolve({
        ok: false,
        kind,
        code: "MARKETPLACE_SIMULATED_FAILURE",
        message: "Simulated marketplace provider failure",
        ...(kind === "transient" ? { retryAfterMs: 1_000 } : {}),
      });
    }
    const fingerprint = hash(JSON.stringify(input.event));
    const prior = this.deliveries.get(input.idempotencyKey);
    if (prior && prior.fingerprint !== fingerprint)
      return Promise.resolve({
        ok: false,
        kind: "permanent",
        code: "IDEMPOTENCY_CONFLICT",
        message: "Marketplace event key input changed",
      });
    if (prior)
      return Promise.resolve({
        ok: true,
        value: prior.result,
        duplicate: true,
      });
    const result = {
      deliveryId: stableId("marketplace_delivery", input.idempotencyKey),
      providerEventId: stableId("marketplace_event", input.idempotencyKey),
      accepted: true,
    };
    this.deliveries.set(input.idempotencyKey, { fingerprint, result });
    this.published.push(input.event);
    return Promise.resolve({ ok: true, value: result });
  }
}

export type MarketplaceProviderResourceType =
  "order" | "entitlement" | "subscription";

export interface MarketplaceWebhookBinding {
  marketplace: string;
  marketplaceAccountId: string;
  providerResourceType: MarketplaceProviderResourceType;
  providerResourceId: string;
  marketplaceOrderId: string;
  organizationId: OrganizationId;
  entitlementId?: string;
}

/**
 * Durable provider-resource binding. Production implementations must create
 * bindings atomically and reject changes to any identity field.
 */
export interface MarketplaceWebhookBindingStore {
  save(binding: MarketplaceWebhookBinding): Promise<void>;
  find(input: {
    marketplace: string;
    providerResourceType: MarketplaceProviderResourceType;
    providerResourceId: string;
  }): Promise<MarketplaceWebhookBinding | undefined>;
}

/** Deterministic test helper. Production wiring must inject durable storage. */
export class InMemoryMarketplaceWebhookBindingStore implements MarketplaceWebhookBindingStore {
  private readonly bindings = new Map<string, MarketplaceWebhookBinding>();

  public constructor(bindings: readonly MarketplaceWebhookBinding[] = []) {
    for (const binding of bindings) this.store(binding);
  }

  public save(binding: MarketplaceWebhookBinding): Promise<void> {
    try {
      this.store(binding);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error("Marketplace webhook binding failure"),
      );
    }
  }

  public find(input: {
    marketplace: string;
    providerResourceType: MarketplaceProviderResourceType;
    providerResourceId: string;
  }): Promise<MarketplaceWebhookBinding | undefined> {
    const binding = this.bindings.get(bindingKey(input));
    return Promise.resolve(binding ? { ...binding } : undefined);
  }

  private store(binding: MarketplaceWebhookBinding): void {
    if (
      binding.providerResourceType !== "order" &&
      !binding.entitlementId?.trim()
    )
      throw new Error(
        "Marketplace entitlement binding requires an expected entitlement ID",
      );
    const key = bindingKey(binding);
    const current = this.bindings.get(key);
    if (current && canonical(current) !== canonical(binding))
      throw new Error("Marketplace webhook binding conflict");
    this.bindings.set(key, { ...binding });
  }
}

export type VerifiedMarketplaceWebhookEvent = MarketplacePlatformEvent & {
  providerEventId: string;
  marketplaceAccountId: string;
  providerResourceType: MarketplaceProviderResourceType;
  providerResourceId: string;
};

interface MarketplaceProviderWebhookEvent {
  providerEventId: string;
  type: MarketplacePlatformEvent["type"];
  marketplace: string;
  marketplaceAccountId: string;
  providerResourceType: MarketplaceProviderResourceType;
  providerResourceId: string;
  marketplaceOrderId: string;
  organizationId: string;
  occurredAt: string;
  offerId?: string;
  entitlementId?: string;
  quantity?: string;
  status?: "active" | "suspended" | "ended";
}

export class MarketplaceWebhookVerifier implements WebhookVerifier<VerifiedMarketplaceWebhookEvent> {
  public constructor(
    private readonly secret: string,
    private readonly bindingStore: Pick<MarketplaceWebhookBindingStore, "find">,
    private readonly nowEpochSeconds: () => number = () =>
      Math.floor(Date.now() / 1000),
  ) {
    if (secret.length < 16)
      throw new Error(
        "Marketplace webhook secret must be at least 16 characters",
      );
  }

  public async verify(
    input: Parameters<
      WebhookVerifier<VerifiedMarketplaceWebhookEvent>["verify"]
    >[0],
  ): Promise<WebhookVerificationResult<VerifiedMarketplaceWebhookEvent>> {
    const parsedHeader = parseSignatureHeader(input.signature);
    const age = Math.abs(this.nowEpochSeconds() - parsedHeader.timestamp);
    if (age > (input.toleranceSeconds ?? 300))
      throw new Error("Marketplace webhook timestamp is outside tolerance");
    const expected = createHmac("sha256", this.secret)
      .update(concatForSignature(parsedHeader.timestamp, input.rawBody))
      .digest("hex");
    if (!safeEqual(expected, parsedHeader.signature))
      throw new Error("Invalid marketplace webhook signature");
    const providerEvent = parseProviderWebhookEvent(input.rawBody);
    assertResourceShape(providerEvent);
    const binding = await this.bindingStore.find({
      marketplace: providerEvent.marketplace,
      providerResourceType: providerEvent.providerResourceType,
      providerResourceId: providerEvent.providerResourceId,
    });
    if (!binding) throw new Error("Marketplace webhook resource is not bound");
    assertExpectedBinding(providerEvent, binding);
    const payload = normalizeMarketplaceEvent(providerEvent, binding);
    return {
      eventId: providerEvent.providerEventId,
      occurredAt: providerEvent.occurredAt,
      payload,
    };
  }
}

export function signFakeMarketplaceWebhook(input: {
  secret: string;
  timestamp: number;
  rawBody: Uint8Array;
}): string {
  const signature = createHmac("sha256", input.secret)
    .update(concatForSignature(input.timestamp, input.rawBody))
    .digest("hex");
  return `t=${input.timestamp},v1=${signature}`;
}

function safeEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${hash(value).slice(0, 24)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bindingKey(input: {
  marketplace: string;
  providerResourceType: MarketplaceProviderResourceType;
  providerResourceId: string;
}): string {
  return `${input.marketplace}:${input.providerResourceType}:${input.providerResourceId}`;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

function parseSignatureHeader(header: string): {
  timestamp: number;
  signature: string;
} {
  let timestampText: string | undefined;
  let signature: string | undefined;
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestampText = value;
    if (key === "v1") signature = value;
  }
  const timestamp = Number(timestampText);
  if (!Number.isInteger(timestamp) || !signature)
    throw new Error("Malformed marketplace webhook signature header");
  return { timestamp, signature };
}

function concatForSignature(timestamp: number, body: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const result = new Uint8Array(prefix.length + body.length);
  result.set(prefix);
  result.set(body, prefix.length);
  return result;
}

function parseProviderWebhookEvent(
  rawBody: Uint8Array,
): MarketplaceProviderWebhookEvent {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new Error("Malformed marketplace webhook event");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("providerEventId" in value) ||
    typeof value.providerEventId !== "string" ||
    !("type" in value) ||
    (value.type !== "marketplace.provisioning.requested" &&
      value.type !== "marketplace.entitlement.updated") ||
    !("marketplace" in value) ||
    typeof value.marketplace !== "string" ||
    !("marketplaceAccountId" in value) ||
    typeof value.marketplaceAccountId !== "string" ||
    !("providerResourceType" in value) ||
    !["order", "entitlement", "subscription"].includes(
      String(value.providerResourceType),
    ) ||
    !("providerResourceId" in value) ||
    typeof value.providerResourceId !== "string" ||
    !("marketplaceOrderId" in value) ||
    typeof value.marketplaceOrderId !== "string" ||
    !("organizationId" in value) ||
    typeof value.organizationId !== "string" ||
    !("occurredAt" in value) ||
    typeof value.occurredAt !== "string" ||
    !isInstant(value.occurredAt)
  )
    throw new Error("Malformed marketplace webhook event");
  return value as MarketplaceProviderWebhookEvent;
}

function assertResourceShape(event: MarketplaceProviderWebhookEvent): void {
  if (
    event.type === "marketplace.provisioning.requested" &&
    (event.providerResourceType !== "order" ||
      event.providerResourceId !== event.marketplaceOrderId ||
      typeof event.offerId !== "string" ||
      event.offerId.length === 0)
  )
    throw new Error("Marketplace provisioning resource identity mismatch");
  if (
    event.type === "marketplace.entitlement.updated" &&
    (event.providerResourceType === "order" ||
      typeof event.entitlementId !== "string" ||
      event.entitlementId.length === 0 ||
      typeof event.quantity !== "string" ||
      !["active", "suspended", "ended"].includes(String(event.status)))
  )
    throw new Error("Marketplace entitlement resource identity mismatch");
}

function assertExpectedBinding(
  event: MarketplaceProviderWebhookEvent,
  binding: MarketplaceWebhookBinding,
): void {
  if (
    event.marketplaceAccountId !== binding.marketplaceAccountId ||
    event.marketplaceOrderId !== binding.marketplaceOrderId ||
    event.organizationId !== binding.organizationId ||
    (binding.providerResourceType !== "order" &&
      (!binding.entitlementId || event.entitlementId !== binding.entitlementId))
  )
    throw new Error("Marketplace webhook binding mismatch");
}

function normalizeMarketplaceEvent(
  event: MarketplaceProviderWebhookEvent,
  binding: MarketplaceWebhookBinding,
): VerifiedMarketplaceWebhookEvent {
  const provider = {
    providerEventId: event.providerEventId,
    marketplaceAccountId: binding.marketplaceAccountId,
    providerResourceType: binding.providerResourceType,
    providerResourceId: binding.providerResourceId,
  };
  if (event.type === "marketplace.provisioning.requested")
    return {
      ...provider,
      type: event.type,
      marketplace: binding.marketplace,
      marketplaceOrderId: binding.marketplaceOrderId,
      organizationId: binding.organizationId,
      offerId: event.offerId as string,
      occurredAt: event.occurredAt,
    };
  return {
    ...provider,
    type: event.type,
    marketplace: binding.marketplace,
    marketplaceOrderId: binding.marketplaceOrderId,
    organizationId: binding.organizationId,
    entitlementId: event.entitlementId as string,
    quantity: event.quantity as string,
    status: event.status as "active" | "suspended" | "ended",
    occurredAt: event.occurredAt,
  };
}

function isInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
