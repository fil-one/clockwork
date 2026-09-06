import { describe, expect, it } from "vitest";
import {
  assertCapabilityDecision,
  capabilityApprovalRole,
} from "./capability-policy";

const valid = {
  requestedBy: "operator",
  actorId: "finance",
  requestedAt: new Date("2026-09-06T12:00:00Z"),
  now: new Date("2026-09-06T12:30:00Z"),
  baseVersion: 5,
  currentVersion: 5,
};
describe("capability activation safeguards", () => {
  it("assigns legal and destructive authority separately from finance", () => {
    expect(capabilityApprovalRole("legal")).toBe("legal_approver");
    expect(capabilityApprovalRole("teardown")).toBe(
      "destructive_action_approver",
    );
    expect(capabilityApprovalRole("new_business")).toBe("finance_approver");
  });
  it("requires a distinct approver even if the requester has approval authority", () => {
    expect(() =>
      assertCapabilityDecision({ ...valid, actorId: "operator" }),
    ).toThrow("CAPABILITY_DISTINCT_APPROVER_REQUIRED");
  });
  it("rejects stale evidence, clock skew, and capabilities changed after proposal", () => {
    expect(() =>
      assertCapabilityDecision({
        ...valid,
        now: new Date("2026-09-07T12:00:01Z"),
      }),
    ).toThrow("CAPABILITY_REQUEST_EXPIRED");
    expect(() =>
      assertCapabilityDecision({
        ...valid,
        now: new Date("2026-09-06T11:59:59Z"),
      }),
    ).toThrow("CAPABILITY_REQUEST_EXPIRED");
    expect(() =>
      assertCapabilityDecision({ ...valid, currentVersion: 6 }),
    ).toThrow("CAPABILITY_VERSION_CONFLICT");
  });
  it("allows the exact reviewed state and current evidence", () => {
    expect(() => assertCapabilityDecision(valid)).not.toThrow();
  });
});
