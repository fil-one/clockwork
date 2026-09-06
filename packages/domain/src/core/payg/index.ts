import { createHash } from "node:crypto";

import type { Currency, Money } from "@clockwork/contracts";
export * from "./offers";

const HOUR = 3_600_000;
const TB = 1_000_000_000_000n;
const integerPattern = /^(0|[1-9]\d*)$/;
const signedIntegerPattern = /^(0|-?[1-9]\d*)$/;
export type PaygMeter = "storage_bytes" | "egress_bytes" | "api_operations";
const meters: readonly PaygMeter[] = [
  "storage_bytes",
  "egress_bytes",
  "api_operations",
];

/** Resolved at enrollment, then retained unchanged on every period and invoice. */
export interface PaygPolicySnapshot {
  id: string;
  version: number;
  approvalEvidenceId: string;
  currency: Currency;
  storageTbMonthMinor: string;
  monthlyMinimumMinor: string;
  partialMonthMinimum: "full" | "prorated";
  correctionWindowDays: number;
  aggregation: "hourly_average_daily_utc";
  egressRateMinor: "0";
  apiRateMinor: "0";
  stripeTaxCode: string;
  qboIncomeAccount: string;
}

/** Immutable, verified product mapping; never resolve by email or display name. */
export interface PaygBinding {
  mappingVersionId: string;
  accountId: string;
  filOneOrganizationId: string;
  tenantId: string;
  entitlementId: string;
  sku: string;
  region: string;
  source: string;
  meters: readonly PaygMeter[];
  status: "active" | "retired";
}

export interface PaygMeasurement {
  sourceMeasurementId: string;
  source: string;
  filOneOrganizationId: string;
  tenantId: string;
  entitlementId: string;
  sku: string;
  region: string;
  meter: PaygMeter;
  startsAt: string;
  endsAt: string;
  /** Storage is the hour's time-weighted average bytes; other meters are counts. */
  quantity: string;
  recordedAt: string;
  kind: "usage" | "correction";
  /** Corrections are additive deltas against an original measurement. */
  correctsSourceMeasurementId?: string;
}

export interface PaygPeriod {
  /** UTC calendar month. Service boundaries can cover a partial first/final month. */
  month: string;
  serviceStartsAt: string;
  serviceEndsAt: string;
  final: boolean;
}

export function paygInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new Error("PAYG_CANONICAL_UTC_INSTANT_REQUIRED");
  return parsed;
}

export function paygEvidenceHash(value: unknown): string {
  function canonical(item: unknown): string {
    if (item === null || typeof item !== "object") {
      const result = JSON.stringify(item);
      if (result === undefined) throw new Error("PAYG_EVIDENCE_INVALID");
      return result;
    }
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    const record = item as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function integer(value: string, signed = false): bigint {
  if (!(signed ? signedIntegerPattern : integerPattern).test(value))
    throw new Error("PAYG_INTEGER_QUANTITY_REQUIRED");
  return BigInt(value);
}

export function validatePaygPolicy(policy: PaygPolicySnapshot): void {
  if (
    !policy.id.trim() ||
    !Number.isSafeInteger(policy.version) ||
    policy.version < 1 ||
    !["USD", "EUR", "GBP"].includes(policy.currency) ||
    !policy.approvalEvidenceId.trim()
  )
    throw new Error("PAYG_APPROVED_POLICY_REQUIRED");
  integer(policy.storageTbMonthMinor);
  integer(policy.monthlyMinimumMinor);
  if (
    !["full", "prorated"].includes(policy.partialMonthMinimum) ||
    !Number.isSafeInteger(policy.correctionWindowDays) ||
    policy.correctionWindowDays < 0 ||
    policy.aggregation !== "hourly_average_daily_utc" ||
    policy.egressRateMinor !== "0" ||
    policy.apiRateMinor !== "0"
  )
    throw new Error("PAYG_UNSUPPORTED_METER_POLICY");
}

export function validatePaygBinding(binding: PaygBinding): void {
  if (
    binding.status !== "active" ||
    [
      binding.mappingVersionId,
      binding.accountId,
      binding.filOneOrganizationId,
      binding.tenantId,
      binding.entitlementId,
      binding.sku,
      binding.region,
      binding.source,
    ].some((id) => !id.trim()) ||
    binding.meters.length !== meters.length ||
    !meters.every((meter) => binding.meters.includes(meter))
  )
    throw new Error("PAYG_UNKNOWN_OR_RETIRED_MAPPING");
}

export function paygPeriodBounds(period: PaygPeriod): {
  monthStartsAt: number;
  monthEndsAt: number;
  startsAt: number;
  endsAt: number;
} {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period.month))
    throw new Error("PAYG_MONTH_INVALID");
  const monthStartsAt = Date.parse(`${period.month}-01T00:00:00.000Z`);
  const next = new Date(monthStartsAt);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const monthEndsAt = next.getTime();
  const startsAt = paygInstant(period.serviceStartsAt);
  const endsAt = paygInstant(period.serviceEndsAt);
  if (
    startsAt < monthStartsAt ||
    endsAt > monthEndsAt ||
    endsAt <= startsAt ||
    startsAt % HOUR !== 0 ||
    endsAt % HOUR !== 0
  )
    throw new Error("PAYG_SERVICE_PERIOD_INVALID");
  return { monthStartsAt, monthEndsAt, startsAt, endsAt };
}

export function validatePaygMeasurement(
  measurement: PaygMeasurement,
  binding: PaygBinding,
): void {
  if (
    !measurement.sourceMeasurementId.trim() ||
    measurement.source !== binding.source ||
    measurement.filOneOrganizationId !== binding.filOneOrganizationId ||
    measurement.tenantId !== binding.tenantId ||
    measurement.entitlementId !== binding.entitlementId ||
    measurement.sku !== binding.sku ||
    measurement.region !== binding.region ||
    !binding.meters.includes(measurement.meter)
  )
    throw new Error("PAYG_MEASUREMENT_BINDING_MISMATCH");
  const startsAt = paygInstant(measurement.startsAt);
  const endsAt = paygInstant(measurement.endsAt);
  if (startsAt % HOUR !== 0 || endsAt - startsAt !== HOUR)
    throw new Error("PAYG_CLOSED_HOURLY_INTERVAL_REQUIRED");
  if (paygInstant(measurement.recordedAt) < endsAt)
    throw new Error("PAYG_MEASUREMENT_NOT_CLOSED");
  if (
    !["usage", "correction"].includes(measurement.kind) ||
    (measurement.kind === "correction") !==
      (measurement.correctsSourceMeasurementId !== undefined)
  )
    throw new Error("PAYG_CORRECTION_TARGET_REQUIRED");
  integer(measurement.quantity, measurement.kind === "correction");
}

export interface PaygRating {
  binding: PaygBinding;
  policy: PaygPolicySnapshot;
  period: PaygPeriod;
  sourceMeasurementIds: readonly string[];
  sourceMeasurementFingerprints: readonly { id: string; hash: string }[];
  evidenceHash: string;
  storageByteHours: string;
  averageDailyStorageBytes: { numerator: string; denominator: string };
  egressBytes: string;
  apiOperations: string;
  lines: readonly {
    kind: PaygMeter | "monthly_minimum_adjustment";
    serviceStartsAt: string;
    serviceEndsAt: string;
    amount: Money;
  }[];
  total: Money;
}

/**
 * Exact integer arithmetic, with half-up rounding once per monthly charge.
 * Equal UTC days make the average of daily hourly means equal byte-hours /
 * calendar-month hours. Missing hours never silently become free usage.
 */
export function ratePaygPeriod(input: {
  binding: PaygBinding;
  policy: PaygPolicySnapshot;
  period: PaygPeriod;
  measurements: readonly PaygMeasurement[];
  sourceClosedThrough: string;
  /** Retained source manifest explicitly certifies sparse count streams complete. */
  sourceCompleteCountMeters?: readonly ("egress_bytes" | "api_operations")[];
}): PaygRating {
  validatePaygBinding(input.binding);
  validatePaygPolicy(input.policy);
  const bounds = paygPeriodBounds(input.period);
  if (paygInstant(input.sourceClosedThrough) < bounds.endsAt)
    throw new Error("PAYG_SOURCE_PERIOD_NOT_CLOSED");
  const byId = new Map<string, PaygMeasurement>();
  for (const event of input.measurements) {
    validatePaygMeasurement(event, input.binding);
    if (
      event.kind === "correction" &&
      paygInstant(event.recordedAt) >
        bounds.endsAt + input.policy.correctionWindowDays * 86_400_000
    )
      throw new Error("PAYG_CORRECTION_WINDOW_EXCEEDED");
    const startsAt = paygInstant(event.startsAt);
    if (startsAt < bounds.startsAt || startsAt >= bounds.endsAt)
      throw new Error("PAYG_MEASUREMENT_OUTSIDE_SERVICE_PERIOD");
    const prior = byId.get(event.sourceMeasurementId);
    if (prior && paygEvidenceHash(prior) !== paygEvidenceHash(event))
      throw new Error("PAYG_SOURCE_ID_PAYLOAD_CONFLICT");
    byId.set(event.sourceMeasurementId, event);
  }
  const originalSlots = new Map<string, PaygMeasurement>();
  const quantities = new Map<string, bigint>();
  for (const event of byId.values()) {
    const key = `${event.meter}:${event.startsAt}`;
    if (event.kind === "usage") {
      if (originalSlots.has(key))
        throw new Error("PAYG_OVERLAPPING_MEASUREMENT");
      originalSlots.set(key, event);
    } else {
      const target = byId.get(event.correctsSourceMeasurementId ?? "");
      if (
        !target ||
        target.kind !== "usage" ||
        target.meter !== event.meter ||
        target.startsAt !== event.startsAt ||
        target.endsAt !== event.endsAt
      )
        throw new Error("PAYG_CORRECTION_TARGET_MISMATCH");
    }
    quantities.set(
      key,
      (quantities.get(key) ?? 0n) + integer(event.quantity, true),
    );
  }
  const sums: Record<PaygMeter, bigint> = {
    storage_bytes: 0n,
    egress_bytes: 0n,
    api_operations: 0n,
  };
  for (let hour = bounds.startsAt; hour < bounds.endsAt; hour += HOUR) {
    for (const meter of meters) {
      const key = `${meter}:${new Date(hour).toISOString()}`;
      if (
        !originalSlots.has(key) &&
        !(
          meter !== "storage_bytes" &&
          input.sourceCompleteCountMeters?.includes(meter)
        )
      )
        throw new Error("PAYG_MISSING_HOURLY_MEASUREMENT");
      const quantity = quantities.get(key) ?? 0n;
      if (quantity < 0n) throw new Error("PAYG_CORRECTED_USAGE_NEGATIVE");
      sums[meter] += quantity;
    }
  }
  const monthHours = BigInt((bounds.monthEndsAt - bounds.monthStartsAt) / HOUR);
  const serviceHours = BigInt((bounds.endsAt - bounds.startsAt) / HOUR);
  const round = (numerator: bigint, denominator: bigint): bigint =>
    (numerator + denominator / 2n) / denominator;
  const storage = round(
    sums.storage_bytes * integer(input.policy.storageTbMonthMinor),
    monthHours * TB,
  );
  const minimum =
    input.policy.partialMonthMinimum === "full"
      ? integer(input.policy.monthlyMinimumMinor)
      : round(
          integer(input.policy.monthlyMinimumMinor) * serviceHours,
          monthHours,
        );
  const topUp = minimum > storage ? minimum - storage : 0n;
  const money = (minor: bigint): Money =>
    ({ currency: input.policy.currency, minor: minor.toString() }) as Money;
  const sorted = [...byId.values()].sort((left, right) =>
    left.sourceMeasurementId.localeCompare(right.sourceMeasurementId),
  );
  return {
    binding: structuredClone(input.binding),
    policy: structuredClone(input.policy),
    period: { ...input.period },
    sourceMeasurementIds: sorted.map((event) => event.sourceMeasurementId),
    sourceMeasurementFingerprints: sorted.map((event) => ({
      id: event.sourceMeasurementId,
      hash: paygEvidenceHash(event),
    })),
    evidenceHash: paygEvidenceHash({
      binding: input.binding,
      policy: input.policy,
      period: input.period,
      measurements: sorted,
      completeCountMeters: [
        ...new Set(input.sourceCompleteCountMeters ?? []),
      ].sort(),
    }),
    storageByteHours: sums.storage_bytes.toString(),
    averageDailyStorageBytes: {
      numerator: sums.storage_bytes.toString(),
      denominator: monthHours.toString(),
    },
    egressBytes: sums.egress_bytes.toString(),
    apiOperations: sums.api_operations.toString(),
    lines: [
      { kind: "storage_bytes", amount: money(storage) },
      { kind: "egress_bytes", amount: money(0n) },
      { kind: "api_operations", amount: money(0n) },
      { kind: "monthly_minimum_adjustment", amount: money(topUp) },
    ].map((line) => ({
      ...line,
      serviceStartsAt: input.period.serviceStartsAt,
      serviceEndsAt: input.period.serviceEndsAt,
    })) as PaygRating["lines"],
    total: money(storage + topUp),
  };
}
