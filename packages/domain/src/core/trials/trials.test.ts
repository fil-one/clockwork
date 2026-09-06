import { describe, expect, it } from "vitest";
import {
  convertTrial,
  enrollTrial,
  evaluateTrialOperation,
  type TrialPolicySnapshot,
} from "./index";

const policy: TrialPolicySnapshot = {
  id: "policy",
  version: 1,
  approvalEvidenceId: "finance",
  durationDays: 30,
  gracePeriodDays: 7,
  storageLimitBytes: "1000000000000",
  cumulativeEgressLimitBytes: "2000000000000",
  maximumCounterAgeSeconds: 60,
  egressExhaustion: "disable_all",
};
const enrollment = {
  id: "trial",
  organizationId: "org",
  tenantId: "tenant",
  domain: "Example.COM.",
  domainVerificationEvidenceId: "verified",
  previousTrials: [],
  policy,
  now: "2026-09-01T00:00:00.000Z",
};
const trial = enrollTrial(enrollment);
const now = "2026-09-02T00:00:00.000Z";
const counters = {
  organizationId: "org",
  tenantId: "tenant",
  storedBytes: "999999999999",
  cumulativeEgressBytes: "1999999999999",
  measuredAt: now,
};
const input = {
  trial,
  counters,
  now,
  operation: { kind: "write" as const, additionalBytes: "1" },
};

describe("configurable trial lifecycle", () => {
  it("pins duration and normalized verified identity; denies another organization claiming a used domain", () => {
    expect(trial.expiresAt).toBe("2026-10-01T00:00:00.000Z");
    expect(trial.verifiedDomain).toBe("example.com");
    expect(() =>
      enrollTrial({
        ...enrollment,
        organizationId: "other",
        previousTrials: [trial],
      }),
    ).toThrow("TRIAL_ALREADY_USED");
    expect(() =>
      enrollTrial({ ...enrollment, domainVerificationEvidenceId: "" }),
    ).toThrow("TRIAL_VERIFIED_ORGANIZATION_REQUIRED");
  });
  it("reserves separately against storage and cumulative egress with exact byte boundaries", () => {
    expect(evaluateTrialOperation(input).allowed).toBe(true);
    expect(
      evaluateTrialOperation({
        ...input,
        operation: { kind: "write", additionalBytes: "2" },
      }).reason,
    ).toBe("storage_limit");
    expect(
      evaluateTrialOperation({
        ...input,
        operation: { kind: "egress", bytes: "2" },
      }).reason,
    ).toBe("egress_limit");
    expect(
      evaluateTrialOperation({
        ...input,
        counters: { ...counters, storedBytes: policy.storageLimitBytes },
        operation: { kind: "api" },
      }).allowed,
    ).toBe(true);
    expect(
      evaluateTrialOperation({
        ...input,
        counters: {
          ...counters,
          cumulativeEgressBytes: policy.cumulativeEgressLimitBytes,
        },
        operation: { kind: "api" },
      }).reason,
    ).toBe("egress_limit");
  });
  it("fails closed for stale counters and cross-tenant observations", () => {
    expect(
      evaluateTrialOperation({ ...input, now: "2026-09-02T00:01:01.000Z" })
        .reason,
    ).toBe("stale_usage");
    expect(() =>
      evaluateTrialOperation({
        ...input,
        counters: { ...counters, tenantId: "foreign" },
      }),
    ).toThrow("TRIAL_COUNTER_BINDING_MISMATCH");
  });
  it("suspends writes at expiry, allows grace-period export, then disables all access", () => {
    const at = (
      time: string,
      operation = input.operation as Parameters<
        typeof evaluateTrialOperation
      >[0]["operation"],
    ) =>
      evaluateTrialOperation({
        ...input,
        now: time,
        counters: { ...counters, measuredAt: time },
        operation,
      });
    expect(at(trial.expiresAt).reason).toBe("expired");
    expect(at(trial.expiresAt, { kind: "egress", bytes: "1" }).allowed).toBe(
      true,
    );
    expect(at("2026-10-08T00:00:00.000Z", { kind: "api" }).reason).toBe(
      "disabled",
    );
  });
  it("requires confirmed paid provisioning and preserves data identity on conversion and replay", () => {
    const paid = {
      entitlementId: "paid",
      organizationId: "org",
      tenantId: "tenant",
      status: "active" as const,
      acceptedOrderId: "order",
      provisioningEvidenceId: "provisioning",
    };
    expect(() =>
      convertTrial({ trial, now, paid: { ...paid, status: "pending" } }),
    ).toThrow("TRIAL_PAID_CONVERSION_NOT_CONFIRMED");
    expect(() =>
      convertTrial({ trial, now, paid: { ...paid, tenantId: "new-tenant" } }),
    ).toThrow("TRIAL_PAID_CONVERSION_NOT_CONFIRMED");
    const converted = convertTrial({ trial, now, paid });
    expect(converted.tenantId).toBe("tenant");
    expect(convertTrial({ trial: converted, now, paid })).toEqual(converted);
    expect(() =>
      convertTrial({
        trial: converted,
        now,
        paid: { ...paid, acceptedOrderId: "different-order" },
      }),
    ).toThrow("TRIAL_ALREADY_CONVERTED");
    expect(evaluateTrialOperation({ ...input, trial: converted }).reason).toBe(
      "converted",
    );
  });
});
