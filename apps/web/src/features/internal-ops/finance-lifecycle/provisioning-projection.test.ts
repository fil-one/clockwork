import { describe, expect, it } from "vitest";

import { projectionRecord } from "./projection-test-support";
import {
  prioritizeProvisioningWork,
  provisioningKind,
  provisioningWorkFromProjection,
  summarizeProvisioningWork,
} from "./provisioning-projection";

const OPERATION = "11111111-1111-4111-8111-111111111111";
const TERMINATION = "22222222-2222-4222-8222-222222222222";

function providerOperation(attemptCount: number, risk = "high") {
  return projectionRecord({
    recordKey: `provider_operation-${OPERATION}`,
    aggregateType: "provider_operation",
    aggregateId: OPERATION,
    channel: "provisioning",
    authoritative: {
      provider: "archivecloud",
      operation: "activate_capability",
      status: "pending",
      attemptCount,
      nextAttemptAt: "2026-08-16T09:00:00.000Z",
    },
    data: {
      reference: "PRV-11111111",
      title: "PRV-11111111 · Activate Capability",
      statusLabel: "Pending",
      risk,
      term: "Retries Aug 16, 2026",
      nextAction: "Needs review",
    },
  });
}

function termination() {
  return projectionRecord({
    recordKey: `termination-${TERMINATION}`,
    aggregateType: "termination",
    aggregateId: TERMINATION,
    channel: "provisioning",
    authoritative: {
      orderId: "33333333-3333-4333-8333-333333333333",
      effectiveAt: "2026-09-01",
      teardownStatus: "scheduled",
      status: "pending",
    },
    data: {
      reference: "TRM-22222222",
      title: "TRM-22222222",
      statusLabel: "Pending",
      risk: "medium",
      nextAction: "Read only",
    },
  });
}

describe("provisioningKind", () => {
  it("reads the aggregate type when the database source supplied one", () => {
    expect(provisioningKind(providerOperation(2))).toBe("provider_operation");
    expect(provisioningKind(termination())).toBe("termination");
  });

  /**
   * The demo source stores the channel in `aggregateType`, so the record key --
   * which the materializer builds as `<aggregateType>-<aggregateId>` -- is the
   * fallback.
   */
  it("falls back to the record key prefix", () => {
    const record = projectionRecord({
      recordKey: `termination-${TERMINATION}`,
      aggregateType: "provisioning",
      aggregateId: TERMINATION,
      channel: "provisioning",
    });

    expect(provisioningKind(record)).toBe("termination");
  });

  it("answers null rather than guessing the more common of the two", () => {
    const record = projectionRecord({
      recordKey: "PRV-DEMO-001",
      aggregateType: "provisioning",
      aggregateId: OPERATION,
      channel: "provisioning",
    });

    expect(provisioningKind(record)).toBeNull();
    expect(provisioningWorkFromProjection(record).kind).toBeNull();
  });
});

describe("provisioningWorkFromProjection", () => {
  it("carries the attempt count for a provider operation", () => {
    const work = provisioningWorkFromProjection(providerOperation(4));

    expect(work.attemptCount).toBe(4);
    expect(work.provider).toBe("archivecloud");
    // The instant, not the materializer's English "Retries Aug 16, 2026": the
    // surface formats it for the reader.
    expect(work.nextAttemptAt).toBe("2026-08-16T09:00:00.000Z");
    expect(work.effectiveAt).toBeNull();
  });

  /** A termination has no attempts, so it reports none rather than zero. */
  it("reports no attempt count on a termination", () => {
    const work = provisioningWorkFromProjection(termination());

    expect(work.attemptCount).toBeNull();
    expect(work.nextAttemptAt).toBeNull();
    expect(work.kind).toBe("termination");
    expect(work.effectiveAt).toBe("2026-09-01");
  });
});

describe("summarizeProvisioningWork", () => {
  it("counts the two aggregates separately", () => {
    const summary = summarizeProvisioningWork(
      [providerOperation(1), termination()].map(provisioningWorkFromProjection),
    );

    expect(summary).toMatchObject({
      providerOperations: 1,
      terminations: 1,
      unclassified: 0,
      highRisk: 1,
    });
  });
});

describe("prioritizeProvisioningWork", () => {
  it("orders by risk, then attempts already spent", () => {
    const ordered = prioritizeProvisioningWork(
      [termination(), providerOperation(3)].map(provisioningWorkFromProjection),
    );

    expect(ordered.map((item) => item.kind)).toEqual([
      "provider_operation",
      "termination",
    ]);
  });
});
