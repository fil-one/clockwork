function first<T>(items: readonly T[]): T {
  const value = items[0];
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}
import { describe, expect, it } from "vitest";
import type { PaygMeasurement } from "@clockwork/domain/core";
import {
  closePaygPeriod,
  type PaygBillingRepository,
  type PaygBillingTransaction,
  type PaygEnrollmentSnapshot,
  type PaygInvoiceEffect,
  type PaygPeriodRevision,
} from "./payg";

class TransactionalFixture implements PaygBillingRepository {
  public enrollment: PaygEnrollmentSnapshot = {
    id: "enrollment-1",
    startsAt: "2026-03-01T00:00:00.000Z",
    endsAt: "2026-03-01T01:00:00.000Z",
    billingAuthority: "clockwork",
    cutoverEvidenceId: "cutover-checkpoint",
    binding: {
      mappingVersionId: "mapping",
      accountId: "account",
      filOneOrganizationId: "org",
      tenantId: "tenant",
      entitlementId: "entitlement",
      sku: "OBJECT_PAYG",
      region: "france",
      source: "fil-one",
      meters: ["storage_bytes", "egress_bytes", "api_operations"],
      status: "active",
    },
    policy: {
      id: "policy",
      version: 1,
      approvalEvidenceId: "signed-policy",
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
    },
  };
  public events: PaygMeasurement[] = [
    {
      sourceMeasurementId: "hour-1",
      source: "fil-one",
      filOneOrganizationId: "org",
      tenantId: "tenant",
      entitlementId: "entitlement",
      sku: "OBJECT_PAYG",
      region: "france",
      meter: "storage_bytes",
      startsAt: "2026-03-01T00:00:00.000Z",
      endsAt: "2026-03-01T01:00:00.000Z",
      quantity: "744000000000000",
      recordedAt: "2026-03-01T01:00:00.000Z",
      kind: "usage",
    },
  ];
  public revisions: PaygPeriodRevision[] = [];
  public effects: PaygInvoiceEffect[] = [];
  public failOutbox = false;
  private lock = Promise.resolve();

  public async transaction<T>(
    _enrollmentId: string,
    _month: string,
    run: (tx: PaygBillingTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.lock;
    let unlock = () => {};
    this.lock = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    const revisions = structuredClone(this.revisions);
    const effects = structuredClone(this.effects);
    try {
      return await run({
        enrollment: () => Promise.resolve(structuredClone(this.enrollment)),
        source: () =>
          Promise.resolve({
            measurements: structuredClone(this.events),
            closedThrough: "2026-03-02T00:00:00.000Z",
            completeCountMeters: ["egress_bytes", "api_operations"],
          }),
        latestRevision: () =>
          Promise.resolve(structuredClone(this.revisions.at(-1))),
        appendRevision: (revision) => {
          this.revisions.push(structuredClone(revision));
          return Promise.resolve();
        },
        enqueueEffect: (effect) => {
          if (this.failOutbox)
            return Promise.reject(new Error("outbox unavailable"));
          this.effects.push(structuredClone(effect));
          return Promise.resolve();
        },
      });
    } catch (error) {
      this.revisions = revisions;
      this.effects = effects;
      throw error;
    } finally {
      unlock();
    }
  }
  public correction(id: string, quantity: string) {
    this.events.push({
      ...first(this.events),
      sourceMeasurementId: id,
      quantity,
      kind: "correction",
      correctsSourceMeasurementId: "hour-1",
      recordedAt: "2026-03-02T00:00:00.000Z",
    });
  }
}
const close = (repository: TransactionalFixture) =>
  closePaygPeriod({
    repository,
    enrollmentId: "enrollment-1",
    month: "2026-03",
    now: "2026-03-02T00:00:00.000Z",
  });

describe("recurring PAYG period close transaction", () => {
  it("concurrent close and replay produce one final invoice and preserve its service period", async () => {
    const repository = new TransactionalFixture();
    const results = await Promise.all([
      close(repository),
      close(repository),
      close(repository),
    ]);
    expect(results.filter((result) => result.replay)).toHaveLength(2);
    expect(repository.effects).toHaveLength(1);
    expect(repository.effects[0]?.amount.minor).toBe("499");
    expect(repository.revisions[0]?.rating.period).toMatchObject({
      final: true,
      serviceEndsAt: repository.enrollment.endsAt,
    });
  });
  it("late corrections append immutable evidence and emit only debit/credit differences", async () => {
    const repository = new TransactionalFixture();
    const original = (await close(repository)).revision;
    repository.correction("plus", "1488000000000000");
    expect((await close(repository)).effect).toMatchObject({
      kind: "debit_adjustment",
      amount: { minor: "998" },
    });
    repository.correction("minus", "-1488000000000000");
    expect((await close(repository)).effect).toMatchObject({
      kind: "credit_adjustment",
      amount: { minor: "998" },
    });
    expect(repository.revisions[0]).toEqual(original);
    expect(
      new Set(repository.effects.map((effect) => effect.originalInvoiceKey))
        .size,
    ).toBe(1);
    expect(
      new Set(repository.effects.map((effect) => effect.idempotencyKey)).size,
    ).toBe(3);
    expect((await close(repository)).replay).toBe(true);
  });
  it("records a zero-financial-impact correction without a second minimum charge", async () => {
    const repository = new TransactionalFixture();
    await close(repository);
    repository.correction("below-minimum", "-1");
    expect((await close(repository)).effect).toBeUndefined();
    expect(repository.revisions).toHaveLength(2);
    expect(repository.effects).toHaveLength(1);
  });
  it("rejects rewritten source history and policy drift across rerates", async () => {
    const repository = new TransactionalFixture();
    await close(repository);
    first(repository.events).quantity = "1488000000000000";
    await expect(close(repository)).rejects.toThrow(
      "PAYG_RETAINED_SOURCE_HISTORY_CHANGED",
    );
    first(repository.events).quantity = "744000000000000";
    repository.enrollment.policy.monthlyMinimumMinor = "599";
    await expect(close(repository)).rejects.toThrow(
      "PAYG_CONTRACT_SNAPSHOT_CHANGED",
    );
    expect(repository.revisions).toHaveLength(1);
  });
  it("rolls back a revision if its invoice effect cannot be enqueued, then retries safely", async () => {
    const repository = new TransactionalFixture();
    repository.failOutbox = true;
    await expect(close(repository)).rejects.toThrow("outbox unavailable");
    expect(repository.revisions).toHaveLength(0);
    repository.failOutbox = false;
    expect((await close(repository)).revision.revision).toBe(1);
    expect(repository.effects).toHaveLength(1);
  });
  it("denies untransferred billing authority, unfinished periods, and future source records", async () => {
    const repository = new TransactionalFixture();
    repository.enrollment.billingAuthority = "fil_one";
    await expect(close(repository)).rejects.toThrow(
      "PAYG_BILLING_AUTHORITY_NOT_TRANSFERRED",
    );
    repository.enrollment.billingAuthority = "clockwork";
    await expect(
      closePaygPeriod({
        repository,
        enrollmentId: "enrollment-1",
        month: "2026-03",
        now: "2026-03-01T00:30:00.000Z",
      }),
    ).rejects.toThrow("PAYG_PERIOD_NOT_ENDED");
    first(repository.events).recordedAt = "2026-03-03T00:00:00.000Z";
    await expect(close(repository)).rejects.toThrow(
      "PAYG_FUTURE_RECORDED_MEASUREMENT",
    );
    expect(repository.effects).toHaveLength(0);
  });
});
