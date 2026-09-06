function first<T>(items: readonly T[]): T {
  const value = items[0];
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}
import { describe, expect, it } from "vitest";

import {
  ratePaygPeriod,
  type PaygBinding,
  type PaygMeasurement,
  type PaygPeriod,
  type PaygPolicySnapshot,
} from "./index";

const binding: PaygBinding = {
  mappingVersionId: "mapping-1",
  accountId: "account-1",
  filOneOrganizationId: "org-1",
  tenantId: "tenant-1",
  entitlementId: "entitlement-1",
  sku: "OBJECT_PAYG",
  region: "france",
  source: "fil-one",
  meters: ["storage_bytes", "egress_bytes", "api_operations"],
  status: "active",
};
const policy: PaygPolicySnapshot = {
  id: "approved-offer",
  version: 1,
  approvalEvidenceId: "finance-evidence",
  currency: "USD",
  storageTbMonthMinor: "499",
  monthlyMinimumMinor: "499",
  partialMonthMinimum: "full",
  correctionWindowDays: 90,
  aggregation: "hourly_average_daily_utc",
  egressRateMinor: "0",
  apiRateMinor: "0",
  stripeTaxCode: "txcd_10103001",
  qboIncomeAccount: "4000-Storage",
};
const period: PaygPeriod = {
  month: "2028-02",
  serviceStartsAt: "2028-02-01T00:00:00.000Z",
  serviceEndsAt: "2028-03-01T00:00:00.000Z",
  final: false,
};

function measurements(
  bytes: string,
  selectedPeriod = period,
): PaygMeasurement[] {
  return Array.from(
    {
      length:
        (Date.parse(selectedPeriod.serviceEndsAt) -
          Date.parse(selectedPeriod.serviceStartsAt)) /
        3_600_000,
    },
    (_, hour) => {
      const startsAt = new Date(
        Date.parse(selectedPeriod.serviceStartsAt) + hour * 3_600_000,
      ).toISOString();
      const endsAt = new Date(Date.parse(startsAt) + 3_600_000).toISOString();
      return {
        sourceMeasurementId: `hour-${hour}`,
        source: binding.source,
        filOneOrganizationId: binding.filOneOrganizationId,
        tenantId: binding.tenantId,
        entitlementId: binding.entitlementId,
        sku: binding.sku,
        region: binding.region,
        meter: "storage_bytes",
        startsAt,
        endsAt,
        quantity: bytes,
        recordedAt: endsAt,
        kind: "usage",
      };
    },
  );
}

function rate(
  events = measurements("1000000000000"),
  override: Partial<Parameters<typeof ratePaygPeriod>[0]> = {},
) {
  return ratePaygPeriod({
    binding,
    policy,
    period,
    measurements: events,
    sourceClosedThrough: period.serviceEndsAt,
    sourceCompleteCountMeters: ["egress_bytes", "api_operations"],
    ...override,
  });
}

describe("PAYG calendar rating", () => {
  it.each([
    ["0", "499"],
    ["100000000000", "499"],
    ["1000000000000", "499"],
    ["2500000000000", "1248"],
    ["1000000000000000000000", "499000000000"],
  ])("rates %s bytes without floating-point loss", (bytes, minor) => {
    const result = rate(measurements(bytes));
    expect(result.total.minor).toBe(minor);
    expect(result.averageDailyStorageBytes.denominator).toBe("696");
    expect(result.lines.slice(1, 3).map((line) => line.amount.minor)).toEqual([
      "0",
      "0",
    ]);
  });

  it("weights varying hourly storage, charges monthly minimum once, and is replay-order independent", () => {
    const events = measurements("4000000000000").map((event, index) => ({
      ...event,
      quantity: index < 348 ? "0" : event.quantity,
    }));
    expect(rate(events).total.minor).toBe("998");
    expect(rate([...events].reverse()).evidenceHash).toBe(
      rate(events).evidenceHash,
    );
    expect(rate([...events, first(events)]).evidenceHash).toBe(
      rate(events).evidenceHash,
    );
  });

  it("requires explicit source completeness for absent count meters and always requires hourly storage", () => {
    expect(() => rate(undefined, { sourceCompleteCountMeters: [] })).toThrow(
      "PAYG_MISSING_HOURLY_MEASUREMENT",
    );
    expect(() => rate(measurements("0").slice(1))).toThrow(
      "PAYG_MISSING_HOURLY_MEASUREMENT",
    );
    expect(() =>
      rate(undefined, { sourceClosedThrough: period.serviceStartsAt }),
    ).toThrow("PAYG_SOURCE_PERIOD_NOT_CLOSED");
  });

  it("zero-rates substantial egress and API volumes while retaining them for economics", () => {
    const events = measurements("1000000000000");
    for (const meter of ["egress_bytes", "api_operations"] as const)
      events.push({
        ...first(events),
        sourceMeasurementId: meter,
        meter,
        quantity: "10000000000000000000",
      });
    const result = rate(events);
    expect(result.total.minor).toBe("499");
    expect(result.egressBytes).toBe("10000000000000000000");
    expect(result.apiOperations).toBe("10000000000000000000");
  });

  it("supports configured partial-month minimum and confirmed final service boundaries", () => {
    const final = {
      ...period,
      serviceEndsAt: "2028-02-15T12:00:00.000Z",
      final: true,
    };
    expect(rate(measurements("0", final), { period: final }).total.minor).toBe(
      "499",
    );
    expect(
      rate(measurements("0", final), {
        period: final,
        policy: { ...policy, partialMonthMinimum: "prorated" },
      }).total.minor,
    ).toBe("250");
    expect(
      rate(measurements("4000000000000", final), { period: final }).total.minor,
    ).toBe("998");
    expect(() =>
      rate([], {
        period: { ...final, serviceEndsAt: "2028-02-15T12:30:00.000Z" },
      }),
    ).toThrow("PAYG_SERVICE_PERIOD_INVALID");
  });

  it("applies additive late corrections and rejects missing or cross-meter targets", () => {
    const events = measurements("2000000000000");
    const correction: PaygMeasurement = {
      ...first(events),
      sourceMeasurementId: "correction",
      kind: "correction",
      correctsSourceMeasurementId: "hour-0",
      quantity: "696000000000000",
      recordedAt: "2028-03-02T00:00:00.000Z",
    };
    expect(rate([correction, ...events]).total.minor).toBe("1497");
    expect(() =>
      rate([{ ...correction, meter: "api_operations" }, ...events]),
    ).toThrow("PAYG_CORRECTION_TARGET_MISMATCH");
    expect(() =>
      rate([
        { ...correction, correctsSourceMeasurementId: "missing" },
        ...events,
      ]),
    ).toThrow("PAYG_CORRECTION_TARGET_MISMATCH");
    expect(() =>
      rate([{ ...correction, quantity: "-2000000000001" }, ...events]),
    ).toThrow("PAYG_CORRECTED_USAGE_NEGATIVE");
    expect(() =>
      rate([
        { ...correction, recordedAt: "2029-03-02T00:00:00.000Z" },
        ...events,
      ]),
    ).toThrow("PAYG_CORRECTION_WINDOW_EXCEEDED");
  });

  it("rejects source collisions, overlap, foreign bindings, retired mappings and unapproved policy", () => {
    const events = measurements("0");
    expect(() =>
      rate([...events, { ...first(events), quantity: "1" }]),
    ).toThrow("PAYG_SOURCE_ID_PAYLOAD_CONFLICT");
    expect(() =>
      rate([...events, { ...first(events), sourceMeasurementId: "another" }]),
    ).toThrow("PAYG_OVERLAPPING_MEASUREMENT");
    expect(() =>
      rate([
        { ...first(events), tenantId: "other-tenant" },
        ...events.slice(1),
      ]),
    ).toThrow("PAYG_MEASUREMENT_BINDING_MISMATCH");
    expect(() =>
      rate(events, { binding: { ...binding, status: "retired" } }),
    ).toThrow("PAYG_UNKNOWN_OR_RETIRED_MAPPING");
    expect(() =>
      rate(events, { policy: { ...policy, approvalEvidenceId: "" } }),
    ).toThrow("PAYG_APPROVED_POLICY_REQUIRED");
  });
});
