import { isIP } from "node:net";

import type { Currency, ProviderResult, Quantity } from "@clockwork/contracts";
import { QuantitySchema } from "@clockwork/contracts";

import {
  isRecord,
  optionalString,
  stableExternalId,
  toProviderFailure,
} from "../provider-result";
import {
  normalizeAwsMarketplaceEvent,
  normalizeAzureMarketplaceEvent,
  normalizeGoogleMarketplaceEvent,
} from "./normalization";
import type {
  MarketplaceCredentialGate,
  MarketplaceFinanceAdapter,
  MarketplaceFinancialEvent,
  MarketplaceProvider,
  MarketplaceReconciliationLine,
  MarketplaceTransport,
  MarketplaceTransportRequest,
  MarketplaceTransportResponse,
} from "./types";

function responseFailure(
  provider: MarketplaceProvider,
  response: MarketplaceTransportResponse,
): Exclude<ProviderResult<never>, { ok: true }> {
  const transient =
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500;
  return {
    ok: false,
    kind: transient ? "transient" : "permanent",
    code: `${provider.toUpperCase()}_MARKETPLACE_HTTP_${String(response.status)}`,
    message: `${provider.toUpperCase()} marketplace request failed with HTTP ${String(
      response.status,
    )}`,
    ...(transient ? { retryAfterMs: 1000 } : {}),
  };
}

function responseRecord(
  response: MarketplaceTransportResponse,
): Record<string, unknown> {
  if (!isRecord(response.body))
    throw new TypeError("Marketplace provider returned a non-object response");
  return response.body;
}

function operationResult(
  provider: MarketplaceProvider,
  operation: string,
  response: MarketplaceTransportResponse,
): { operationId: string; status: string } {
  const body = responseRecord(response);
  return {
    operationId:
      optionalString(body.operationId) ??
      optionalString(body.id) ??
      response.requestId ??
      stableExternalId(`${provider}_operation`, { operation, body }),
    status:
      optionalString(body.status) ?? optionalString(body.state) ?? "submitted",
  };
}

function safeHttpsEndpoint(
  value: string,
  label: string,
  expectedHostname?: string,
): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute HTTPS URL`);
  }
  const hostname = endpoint.hostname.toLowerCase().replace(/\.$/, "");
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    (endpoint.port !== "" && endpoint.port !== "443")
  )
    throw new TypeError(
      `${label} must use HTTPS without credentials or a non-standard port`,
    );
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isIP(hostname) !== 0
  )
    throw new TypeError(`${label} must not target a local or literal IP host`);
  if (expectedHostname && hostname !== expectedHostname)
    throw new TypeError(`${label} must target ${expectedHostname}`);
  return endpoint.toString();
}

function expandExponent(value: string): string {
  const [mantissa = "", exponentText] = value.toLowerCase().split("e");
  if (exponentText === undefined) return value;
  const exponent = Number(exponentText);
  const [whole = "0", fraction = ""] = mantissa.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  const point = whole.length + exponent;
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length)
    return `${digits}${"0".repeat(point - digits.length)}`;
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

function exactProviderQuantity(
  value: Quantity,
  provider: MarketplaceProvider,
): ProviderResult<number> {
  const numeric = Number(value);
  try {
    const roundTrip = QuantitySchema.parse(expandExponent(String(numeric)));
    if (
      !Number.isFinite(numeric) ||
      scaledQuantity(roundTrip) !== scaledQuantity(value)
    )
      throw new RangeError();
  } catch {
    return {
      ok: false,
      kind: "permanent",
      code: `${provider.toUpperCase()}_MARKETPLACE_QUANTITY_OUT_OF_RANGE`,
      message: `${provider.toUpperCase()} marketplace usage quantity cannot be represented without decimal precision loss`,
    };
  }
  return { ok: true, value: numeric };
}

abstract class BaseMarketplaceFinanceAdapter implements MarketplaceFinanceAdapter {
  public abstract readonly provider: MarketplaceProvider;
  protected readonly financialEventsUrl: string;

  protected constructor(
    protected readonly gate: MarketplaceCredentialGate,
    protected readonly transport: MarketplaceTransport,
    financialEventsUrl: string,
  ) {
    this.financialEventsUrl = safeHttpsEndpoint(
      financialEventsUrl,
      "Marketplace financial event endpoint",
    );
  }

  public credentialStatus() {
    return this.gate.status();
  }

  public abstract normalize(
    raw: unknown,
  ): ProviderResult<MarketplaceFinancialEvent>;

  public abstract acceptOrder(
    input: Parameters<MarketplaceFinanceAdapter["acceptOrder"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["acceptOrder"]>;

  public abstract getEntitlement(
    input: Parameters<MarketplaceFinanceAdapter["getEntitlement"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["getEntitlement"]>;

  public abstract reportUsage(
    input: Parameters<MarketplaceFinanceAdapter["reportUsage"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["reportUsage"]>;

  protected async call(
    request: Omit<MarketplaceTransportRequest, "provider">,
  ): Promise<ProviderResult<MarketplaceTransportResponse>> {
    try {
      this.gate.assertReady(request.operation);
      const result = await this.transport.request({
        ...request,
        provider: this.provider,
      });
      if (!result.ok) return result;
      if (result.value.status < 200 || result.value.status >= 300)
        return responseFailure(this.provider, result.value);
      return result;
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async listFinancialEvents(
    input: Parameters<MarketplaceFinanceAdapter["listFinancialEvents"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["listFinancialEvents"]> {
    const url = new URL(this.financialEventsUrl);
    url.searchParams.set("from", input.from);
    url.searchParams.set("to", input.to);
    if (input.cursor) url.searchParams.set("cursor", input.cursor);
    const result = await this.call({
      operation: "list-financial-events",
      method: "GET",
      url: url.toString(),
      headers: { accept: "application/json" },
    });
    if (!result.ok) return result;
    try {
      const body = responseRecord(result.value);
      if (!Array.isArray(body.events))
        throw new TypeError("Marketplace financial response is missing events");
      const events: MarketplaceFinancialEvent[] = [];
      for (const raw of body.events) {
        const normalized = this.normalize(raw);
        if (!normalized.ok) return normalized;
        events.push(normalized.value);
      }
      const nextCursor =
        optionalString(body.nextCursor) ?? optionalString(body.next_cursor);
      return {
        ok: true,
        value: {
          events,
          ...(nextCursor === undefined ? {} : { nextCursor }),
        },
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }
}

export class AwsMarketplaceFinanceAdapter extends BaseMarketplaceFinanceAdapter {
  public readonly provider = "aws" as const;
  private readonly entitlementEndpoint: string;
  private readonly meteringEndpoint: string;

  public constructor(input: {
    readonly region: string;
    readonly gate: MarketplaceCredentialGate;
    readonly transport: MarketplaceTransport;
    readonly financialEventsUrl: string;
  }) {
    super(input.gate, input.transport, input.financialEventsUrl);
    if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(input.region))
      throw new TypeError("AWS marketplace region is invalid");
    this.entitlementEndpoint =
      "https://entitlement.marketplace.us-east-1.amazonaws.com/";
    this.meteringEndpoint = `https://metering.marketplace.${input.region}.amazonaws.com/`;
  }

  public normalize(raw: unknown) {
    return normalizeAwsMarketplaceEvent(raw);
  }

  public async acceptOrder(
    input: Parameters<MarketplaceFinanceAdapter["acceptOrder"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["acceptOrder"]> {
    const result = await this.call({
      operation: "observe-order-entitlement",
      method: "POST",
      url: this.entitlementEndpoint,
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "AWSMPEntitlementService.GetEntitlements",
      },
      body: {
        ProductCode: input.productCode,
        Filter: { CustomerIdentifier: [input.buyerReference] },
      },
      idempotencyKey: input.idempotencyKey,
    });
    if (!result.ok) return result;
    const operation = operationResult(
      this.provider,
      "observe-order-entitlement",
      result.value,
    );
    return {
      ok: true,
      value: {
        operationId: operation.operationId,
        status:
          operation.status === "submitted"
            ? "entitlement_observed"
            : operation.status,
      },
    };
  }

  public async getEntitlement(
    input: Parameters<MarketplaceFinanceAdapter["getEntitlement"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["getEntitlement"]> {
    const result = await this.call({
      operation: "get-entitlement",
      method: "POST",
      url: this.entitlementEndpoint,
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "AWSMPEntitlementService.GetEntitlements",
      },
      body: {
        ProductCode: input.productCode,
        Filter: { CustomerIdentifier: [input.buyerReference] },
      },
    });
    if (!result.ok) return result;
    const body = responseRecord(result.value);
    const planId = optionalString(body.productCode);
    return {
      ok: true,
      value: {
        externalEntitlementId: input.externalEntitlementId,
        status: optionalString(body.status) ?? "active",
        ...(planId === undefined ? {} : { planId }),
        raw: result.value.body,
      },
    };
  }

  public async reportUsage(
    input: Parameters<MarketplaceFinanceAdapter["reportUsage"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["reportUsage"]> {
    if (!/^(0|[1-9]\d*)$/.test(input.quantity))
      return {
        ok: false,
        kind: "permanent",
        code: "AWS_MARKETPLACE_QUANTITY_MUST_BE_INTEGER",
        message:
          "AWS BatchMeterUsage accepts whole units; convert fractional usage to the listed dimension unit before reporting",
      };
    const quantity = Number(input.quantity);
    if (!Number.isSafeInteger(quantity))
      return {
        ok: false,
        kind: "permanent",
        code: "AWS_MARKETPLACE_QUANTITY_OUT_OF_RANGE",
        message:
          "AWS marketplace usage quantity exceeds safe integer precision",
      };
    const result = await this.call({
      operation: "batch-meter-usage",
      method: "POST",
      url: this.meteringEndpoint,
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "AWSMPMeteringService.BatchMeterUsage",
      },
      body: {
        ProductCode: input.productCode,
        UsageRecords: [
          {
            CustomerIdentifier: input.buyerReference,
            Dimension: input.dimension,
            Quantity: quantity,
            Timestamp: input.occurredAt,
            UsageAllocations: [
              {
                AllocatedUsageQuantity: quantity,
                Tags: [{ Key: "usage_event_id", Value: input.usageEventId }],
              },
            ],
          },
        ],
      },
      idempotencyKey: input.idempotencyKey,
    });
    if (!result.ok) return result;
    const operation = operationResult(
      this.provider,
      "batch-meter-usage",
      result.value,
    );
    return {
      ok: true,
      value: {
        meteringRecordId: operation.operationId,
        status: operation.status,
      },
    };
  }
}

export class AzureMarketplaceFinanceAdapter extends BaseMarketplaceFinanceAdapter {
  public readonly provider = "azure" as const;
  private readonly baseUrl: string;

  public constructor(input: {
    readonly gate: MarketplaceCredentialGate;
    readonly transport: MarketplaceTransport;
    readonly financialEventsUrl: string;
    readonly baseUrl?: string;
  }) {
    super(input.gate, input.transport, input.financialEventsUrl);
    this.baseUrl = safeHttpsEndpoint(
      input.baseUrl ?? "https://marketplaceapi.microsoft.com",
      "Azure marketplace API endpoint",
      "marketplaceapi.microsoft.com",
    ).replace(/\/$/, "");
  }

  public normalize(raw: unknown) {
    return normalizeAzureMarketplaceEvent(raw);
  }

  public async acceptOrder(
    input: Parameters<MarketplaceFinanceAdapter["acceptOrder"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["acceptOrder"]> {
    const result = await this.call({
      operation: "activate-subscription",
      method: "POST",
      url: `${this.baseUrl}/api/saas/subscriptions/${encodeURIComponent(
        input.externalEntitlementId,
      )}/activate?api-version=2018-08-31`,
      headers: { "content-type": "application/json" },
      body: { planId: input.planId },
      idempotencyKey: input.idempotencyKey,
    });
    return result.ok
      ? {
          ok: true,
          value: operationResult(
            this.provider,
            "activate-subscription",
            result.value,
          ),
        }
      : result;
  }

  public async getEntitlement(
    input: Parameters<MarketplaceFinanceAdapter["getEntitlement"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["getEntitlement"]> {
    const result = await this.call({
      operation: "get-subscription",
      method: "GET",
      url: `${this.baseUrl}/api/saas/subscriptions/${encodeURIComponent(
        input.externalEntitlementId,
      )}?api-version=2018-08-31`,
      headers: { accept: "application/json" },
    });
    if (!result.ok) return result;
    const body = responseRecord(result.value);
    const planId = optionalString(body.planId);
    return {
      ok: true,
      value: {
        externalEntitlementId: input.externalEntitlementId,
        status: optionalString(body.status) ?? "unknown",
        ...(planId === undefined ? {} : { planId }),
        raw: result.value.body,
      },
    };
  }

  public async reportUsage(
    input: Parameters<MarketplaceFinanceAdapter["reportUsage"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["reportUsage"]> {
    const quantity = exactProviderQuantity(input.quantity, this.provider);
    if (!quantity.ok) return quantity;
    const result = await this.call({
      operation: "usage-event",
      method: "POST",
      url: `${this.baseUrl}/api/usageEvent?api-version=2018-08-31`,
      headers: { "content-type": "application/json" },
      body: {
        resourceId: input.externalEntitlementId,
        quantity: quantity.value,
        dimension: input.dimension,
        effectiveStartTime: input.occurredAt,
        planId: input.productCode,
        usageEventId: input.usageEventId,
      },
      idempotencyKey: input.idempotencyKey,
    });
    if (!result.ok) return result;
    const operation = operationResult(
      this.provider,
      "usage-event",
      result.value,
    );
    return {
      ok: true,
      value: {
        meteringRecordId: operation.operationId,
        status: operation.status,
      },
    };
  }
}

export class GoogleMarketplaceFinanceAdapter extends BaseMarketplaceFinanceAdapter {
  public readonly provider = "google" as const;
  private readonly baseUrl: string;
  private readonly providerId: string;
  private readonly serviceControlBaseUrl: string;

  public constructor(input: {
    readonly providerId: string;
    readonly gate: MarketplaceCredentialGate;
    readonly transport: MarketplaceTransport;
    readonly financialEventsUrl: string;
    readonly baseUrl?: string;
    readonly serviceControlBaseUrl?: string;
  }) {
    super(input.gate, input.transport, input.financialEventsUrl);
    if (!input.providerId.trim())
      throw new TypeError("Google marketplace provider ID is required");
    this.providerId = input.providerId;
    this.baseUrl = safeHttpsEndpoint(
      input.baseUrl ?? "https://cloudcommerceprocurement.googleapis.com/v1",
      "Google marketplace procurement endpoint",
      "cloudcommerceprocurement.googleapis.com",
    ).replace(/\/$/, "");
    this.serviceControlBaseUrl = safeHttpsEndpoint(
      input.serviceControlBaseUrl ?? "https://servicecontrol.googleapis.com/v1",
      "Google service control endpoint",
      "servicecontrol.googleapis.com",
    ).replace(/\/$/, "");
  }

  public normalize(raw: unknown) {
    return normalizeGoogleMarketplaceEvent(raw);
  }

  private entitlementUrl(entitlementId: string): string {
    return `${this.baseUrl}/providers/${encodeURIComponent(
      this.providerId,
    )}/entitlements/${encodeURIComponent(entitlementId)}`;
  }

  public async acceptOrder(
    input: Parameters<MarketplaceFinanceAdapter["acceptOrder"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["acceptOrder"]> {
    const result = await this.call({
      operation: "approve-entitlement",
      method: "POST",
      url: `${this.entitlementUrl(input.externalEntitlementId)}:approve`,
      headers: { "content-type": "application/json" },
      body: {
        properties: { planId: input.planId, orderId: input.externalOrderId },
      },
      idempotencyKey: input.idempotencyKey,
    });
    return result.ok
      ? {
          ok: true,
          value: operationResult(
            this.provider,
            "approve-entitlement",
            result.value,
          ),
        }
      : result;
  }

  public async getEntitlement(
    input: Parameters<MarketplaceFinanceAdapter["getEntitlement"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["getEntitlement"]> {
    const result = await this.call({
      operation: "get-entitlement",
      method: "GET",
      url: this.entitlementUrl(input.externalEntitlementId),
      headers: { accept: "application/json" },
    });
    if (!result.ok) return result;
    const body = responseRecord(result.value);
    const planId = optionalString(body.plan);
    return {
      ok: true,
      value: {
        externalEntitlementId: input.externalEntitlementId,
        status:
          optionalString(body.state) ??
          optionalString(body.status) ??
          "unknown",
        ...(planId === undefined ? {} : { planId }),
        raw: result.value.body,
      },
    };
  }

  public async reportUsage(
    input: Parameters<MarketplaceFinanceAdapter["reportUsage"]>[0],
  ): ReturnType<MarketplaceFinanceAdapter["reportUsage"]> {
    const quantity = exactProviderQuantity(input.quantity, this.provider);
    if (!quantity.ok) return quantity;
    const result = await this.call({
      operation: "report-usage",
      method: "POST",
      url: `${this.serviceControlBaseUrl}/services/${encodeURIComponent(
        input.productCode,
      )}:report`,
      headers: { "content-type": "application/json" },
      body: {
        operations: [
          {
            operationId: input.usageEventId,
            operationName: input.dimension,
            consumerId: input.buyerReference,
            startTime: input.occurredAt,
            endTime: input.occurredAt,
            metricValueSets: [
              {
                metricName: input.dimension,
                metricValues: [{ doubleValue: quantity.value }],
              },
            ],
            labels: { entitlement_id: input.externalEntitlementId },
          },
        ],
      },
      idempotencyKey: input.idempotencyKey,
    });
    if (!result.ok) return result;
    const operation = operationResult(
      this.provider,
      "report-usage",
      result.value,
    );
    return {
      ok: true,
      value: {
        meteringRecordId: operation.operationId,
        status: operation.status,
      },
    };
  }
}

const quantityScale = 1_000_000_000_000_000_000n;

function scaledQuantity(value: Quantity): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * quantityScale + BigInt(fraction.padEnd(18, "0"));
}

function quantityFromScaled(value: bigint): Quantity {
  const whole = value / quantityScale;
  const fraction = (value % quantityScale)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");
  return QuantitySchema.parse(
    fraction ? `${whole.toString()}.${fraction}` : whole.toString(),
  );
}

export function reconcileMarketplaceFinancials(input: {
  readonly events: readonly MarketplaceFinancialEvent[];
  /** Required only when a metering row has no financial row from which to infer currency. */
  readonly currencyByOrderSku?: Readonly<Record<string, Currency>>;
}): readonly MarketplaceReconciliationLine[] {
  type Aggregate = {
    provider: MarketplaceProvider;
    externalOrderId: string;
    sku: string;
    currency: Currency;
    metered: bigint;
    invoiced: bigint;
    settled: bigint;
    fee: bigint;
    refunded: bigint;
    invoiceSeen: boolean;
    settlementSeen: boolean;
  };
  const inferredCurrencies = new Map<string, Set<Currency>>();
  for (const event of input.events) {
    const money = event.amount ?? event.fee;
    if (money) {
      const baseKey = `${event.provider}:${event.externalOrderId}:${event.sku}`;
      const currencies = inferredCurrencies.get(baseKey) ?? new Set<Currency>();
      currencies.add(money.currency);
      inferredCurrencies.set(baseKey, currencies);
    }
  }
  const aggregates = new Map<string, Aggregate>();
  for (const event of input.events) {
    const baseKey = `${event.provider}:${event.externalOrderId}:${event.sku}`;
    const eventCurrency = event.amount?.currency ?? event.fee?.currency;
    const configuredCurrency = input.currencyByOrderSku?.[baseKey];
    const candidates = inferredCurrencies.get(baseKey);
    if (
      !eventCurrency &&
      !configuredCurrency &&
      candidates &&
      candidates.size > 1
    )
      throw new TypeError(
        `Cannot reconcile marketplace usage with ambiguous currency ${baseKey}`,
      );
    const currency =
      eventCurrency ??
      configuredCurrency ??
      (candidates?.size === 1 ? [...candidates][0] : undefined);
    if (!currency)
      throw new TypeError(
        `Cannot reconcile currency-less marketplace usage ${baseKey}`,
      );
    const key = `${baseKey}:${currency}`;
    const aggregate = aggregates.get(key) ?? {
      provider: event.provider,
      externalOrderId: event.externalOrderId,
      sku: event.sku,
      currency,
      metered: 0n,
      invoiced: 0n,
      settled: 0n,
      fee: 0n,
      refunded: 0n,
      invoiceSeen: false,
      settlementSeen: false,
    };
    if (event.kind === "metering" && event.quantity)
      aggregate.metered += scaledQuantity(event.quantity);
    if (event.kind === "invoice" && event.amount) {
      aggregate.invoiced += BigInt(event.amount.minor);
      aggregate.invoiceSeen = true;
    }
    if (event.kind === "settlement" && event.amount) {
      aggregate.settled += BigInt(event.amount.minor);
      aggregate.settlementSeen = true;
    }
    if (event.kind === "fee")
      aggregate.fee += BigInt((event.fee ?? event.amount)?.minor ?? "0");
    if (event.kind === "refund" && event.amount)
      aggregate.refunded += BigInt(event.amount.minor);
    aggregates.set(key, aggregate);
  }
  return [...aggregates.values()]
    .sort((left, right) =>
      `${left.provider}:${left.externalOrderId}:${left.sku}:${left.currency}`.localeCompare(
        `${right.provider}:${right.externalOrderId}:${right.sku}:${right.currency}`,
      ),
    )
    .map((aggregate) => {
      const expectedSettlement =
        aggregate.invoiced - aggregate.fee - aggregate.refunded;
      const variance = aggregate.settled - expectedSettlement;
      const status: MarketplaceReconciliationLine["status"] =
        !aggregate.invoiceSeen
          ? "missing_invoice"
          : !aggregate.settlementSeen
            ? "missing_settlement"
            : variance === 0n
              ? "tied"
              : "variance";
      return {
        provider: aggregate.provider,
        externalOrderId: aggregate.externalOrderId,
        sku: aggregate.sku,
        currency: aggregate.currency,
        meteredQuantity: quantityFromScaled(aggregate.metered),
        invoicedMinor: aggregate.invoiced.toString(),
        settledMinor: aggregate.settled.toString(),
        feeMinor: aggregate.fee.toString(),
        refundedMinor: aggregate.refunded.toString(),
        settlementVarianceMinor: variance.toString(),
        status,
      };
    });
}
