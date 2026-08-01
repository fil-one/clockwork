import { createHash } from "node:crypto";

import { MoneySchema, QuantitySchema } from "@clockwork/contracts";

import {
  isRecord,
  optionalString,
  parseProviderMinorUnits,
  toProviderFailure,
} from "../provider-result";
import type {
  MarketplaceFinancialEvent,
  MarketplaceFinancialEventKind,
  MarketplaceProvider,
} from "./types";

function firstString(
  records: readonly Record<string, unknown>[],
  ...keys: readonly string[]
): string | undefined {
  for (const record of records)
    for (const key of keys) {
      const found = optionalString(record[key]);
      if (found) return found;
    }
  return undefined;
}

function required(
  label: string,
  records: readonly Record<string, unknown>[],
  ...keys: readonly string[]
): string {
  const found = firstString(records, ...keys);
  if (!found) throw new TypeError(`Marketplace payload is missing ${label}`);
  return found;
}

function instant(value: string, label: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    throw new TypeError(`Marketplace ${label} is not an RFC 3339 instant`);
  return new Date(milliseconds).toISOString();
}

function minorString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new TypeError(
        `Marketplace ${label} must be safe integer minor units`,
      );
    return parseProviderMinorUnits(value);
  }
  if (typeof value === "string" && /^-?(0|[1-9]\d*)$/.test(value)) return value;
  throw new TypeError(`Marketplace ${label} must be integer minor units`);
}

function firstValue(
  records: readonly Record<string, unknown>[],
  ...keys: readonly string[]
): unknown {
  for (const record of records)
    for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
}

function kindFrom(value: string): MarketplaceFinancialEventKind {
  const normalized = value.toLowerCase().replace(/[._ -]+/g, "_");
  if (normalized.includes("refund") || normalized.includes("credit"))
    return "refund";
  if (normalized.includes("settlement") || normalized.includes("disbursement"))
    return "settlement";
  if (normalized.includes("invoice") || normalized.includes("billing"))
    return "invoice";
  if (normalized.includes("fee")) return "fee";
  if (normalized.includes("meter") || normalized.includes("usage"))
    return "metering";
  if (normalized.includes("entitlement") || normalized.includes("subscription"))
    return "entitlement";
  if (
    normalized.includes("order") ||
    normalized.includes("agreement") ||
    normalized.includes("purchase")
  )
    return "order";
  throw new TypeError(`Unsupported marketplace financial event type ${value}`);
}

function normalize(
  provider: MarketplaceProvider,
  raw: unknown,
): MarketplaceFinancialEvent {
  if (!isRecord(raw))
    throw new TypeError("Marketplace payload must be an object");
  const detail = isRecord(raw.detail) ? raw.detail : undefined;
  const data = isRecord(raw.data) ? raw.data : undefined;
  const records = [detail, data, raw].filter(
    (value): value is Record<string, unknown> => value !== undefined,
  );
  const eventType = required(
    "event type",
    records,
    "eventType",
    "event_type",
    "detail-type",
    "type",
    "action",
  );
  const kind = kindFrom(eventType);
  const externalEventId = required(
    "event ID",
    records,
    "externalEventId",
    "eventId",
    "event_id",
    "id",
    "messageId",
  );
  const externalEntitlementId = firstString(
    records,
    "externalEntitlementId",
    "entitlementId",
    "entitlement_id",
    "subscriptionId",
    "subscription_id",
    "agreementId",
  );
  const externalOrderId =
    firstString(
      records,
      "externalOrderId",
      "orderId",
      "order_id",
      "agreementId",
      "purchaseId",
      "subscriptionId",
    ) ?? externalEntitlementId;
  if (!externalOrderId)
    throw new TypeError("Marketplace payload is missing order ID");
  const buyerReference = required(
    "buyer reference",
    records,
    "buyerReference",
    "customerIdentifier",
    "customer_reference",
    "accountId",
    "beneficiaryId",
    "resourceId",
  );
  const productCode = required(
    "product code",
    records,
    "productCode",
    "productId",
    "product_id",
    "offerId",
    "serviceName",
  );
  const sku =
    firstString(records, "sku", "dimension", "metricId", "planId", "plan_id") ??
    productCode;
  const occurredAt = instant(
    required(
      "event time",
      records,
      "occurredAt",
      "eventTime",
      "event_time",
      "time",
    ),
    "event time",
  );
  const quantityValue = firstValue(
    records,
    "quantity",
    "usageQuantity",
    "value",
  );
  if (typeof quantityValue === "number")
    throw new TypeError(
      "Marketplace quantity must be a canonical decimal string; JSON numbers are not exact",
    );
  const quantity =
    quantityValue === undefined
      ? undefined
      : QuantitySchema.parse(quantityValue);
  const amountMinor = minorString(
    firstValue(
      records,
      "amountMinor",
      "amount_minor",
      "grossAmountMinor",
      "netAmountMinor",
    ),
    "amount",
  );
  const feeMinor = minorString(
    firstValue(records, "feeMinor", "fee_minor", "marketplaceFeeMinor"),
    "fee",
  );
  const currency = firstString(
    records,
    "currency",
    "currencyCode",
  )?.toUpperCase();
  if ((amountMinor !== undefined || feeMinor !== undefined) && !currency)
    throw new TypeError("Marketplace financial amount is missing currency");
  const amount =
    amountMinor === undefined
      ? undefined
      : MoneySchema.parse({ currency, minor: amountMinor });
  const fee =
    feeMinor === undefined
      ? undefined
      : MoneySchema.parse({ currency, minor: feeMinor });
  const periodStartsAtValue = firstString(
    records,
    "periodStartsAt",
    "period_start",
    "startTime",
    "usageStartTime",
  );
  const periodEndsAtValue = firstString(
    records,
    "periodEndsAt",
    "period_end",
    "endTime",
    "usageEndTime",
  );
  const externalInvoiceId = firstString(
    records,
    "externalInvoiceId",
    "invoiceId",
    "invoice_id",
  );
  const externalSettlementId = firstString(
    records,
    "externalSettlementId",
    "settlementId",
    "settlement_id",
    "disbursementId",
  );
  return {
    schemaVersion: 1,
    provider,
    kind,
    externalEventId,
    externalOrderId,
    ...(externalEntitlementId === undefined ? {} : { externalEntitlementId }),
    ...(externalInvoiceId === undefined ? {} : { externalInvoiceId }),
    ...(externalSettlementId === undefined ? {} : { externalSettlementId }),
    buyerReference,
    productCode,
    sku,
    occurredAt,
    ...(periodStartsAtValue === undefined
      ? {}
      : { periodStartsAt: instant(periodStartsAtValue, "period start") }),
    ...(periodEndsAtValue === undefined
      ? {}
      : { periodEndsAt: instant(periodEndsAtValue, "period end") }),
    ...(quantity === undefined ? {} : { quantity }),
    ...(amount === undefined ? {} : { amount }),
    ...(fee === undefined ? {} : { fee }),
    status: firstString(records, "status", "state") ?? "recorded",
    sourceHash: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
  };
}

function result(provider: MarketplaceProvider, raw: unknown) {
  try {
    return { ok: true, value: normalize(provider, raw) } as const;
  } catch (error) {
    return toProviderFailure(error);
  }
}

export function normalizeAwsMarketplaceEvent(raw: unknown) {
  return result("aws", raw);
}

export function normalizeAzureMarketplaceEvent(raw: unknown) {
  return result("azure", raw);
}

export function normalizeGoogleMarketplaceEvent(raw: unknown) {
  return result("google", raw);
}
