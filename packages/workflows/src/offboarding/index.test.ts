import { describe, expect, it } from "vitest";

import {
  evaluateRetention,
  maximumObjectLockDate,
  planDeletionCertificate,
  planNovationContinuity,
  planTeardown,
  startOffboarding,
  validateDestructiveApprovals,
} from "./index";

const approvalOne = {
  approvalId: "approval-1",
  requestedBy: "operator-1",
  approvedBy: "approver-1",
  status: "approved" as const,
  action: "tenant_teardown",
};
const approvalTwo = {
  approvalId: "approval-2",
  requestedBy: "operator-1",
  approvedBy: "approver-2",
  status: "approved" as const,
  action: "tenant_teardown",
};
const approvals = [approvalOne, approvalTwo];

describe("offboarding workflows", () => {
  it("requires partner initiation for resale and tracks final billing/retrieval", () => {
    expect(() =>
      startOffboarding({
        terminationId: "termination-1",
        orderId: "order-1",
        version: 1,
        sourcing: "resale",
        invoicingAccountId: "partner-1",
        partnerAccountId: "partner-1",
        initiatedByAccountId: "end-client-1",
        effectiveAt: "2026-08-01T00:00:00.000Z",
        retrievalEndsAt: "2026-08-31T00:00:00.000Z",
        waitExpiresAt: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow("PARTNER_INITIATION_REQUIRED");
  });

  it("branches on the maximum Object Lock date and preserves exclusions", () => {
    const objects = [
      {
        scope: "bucket/a",
        retainedUntil: "2027-01-01T00:00:00.000Z",
        reason: "WORM",
        legalHold: false,
      },
      {
        scope: "bucket/b",
        retainedUntil: "2028-01-01T00:00:00.000Z",
        reason: "legal",
        legalHold: true,
      },
    ];
    expect(maximumObjectLockDate(objects)).toBe("2028-01-01T00:00:00.000Z");
    expect(
      evaluateRetention({
        objects,
        requestedDeletionAt: "2026-09-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      branch: "retention_blocked",
      deletionScheduledAt: "2028-01-01T00:00:00.000Z",
      lockedExclusions: objects,
    });
  });

  it("requires two distinct non-requesting approvers", () => {
    expect(
      validateDestructiveApprovals({ requestedBy: "operator-1", approvals }),
    ).toEqual(["approval-1", "approval-2"]);
    expect(() =>
      validateDestructiveApprovals({
        requestedBy: "operator-1",
        approvals: [approvalOne],
      }),
    ).toThrow("TWO_DISTINCT_APPROVERS_REQUIRED");
    expect(() =>
      validateDestructiveApprovals({
        requestedBy: "operator-1",
        approvals: [{ ...approvalOne, approvedBy: "operator-1" }, approvalTwo],
      }),
    ).toThrow("TEARDOWN_SELF_APPROVAL_FORBIDDEN");
  });

  it("keeps teardown gated and certificate exclusions explicit", () => {
    const retention = evaluateRetention({
      objects: [],
      requestedDeletionAt: "2026-09-01T00:00:00.000Z",
    });
    expect(() =>
      planTeardown({
        terminationId: "termination-1",
        organizationId: "org-1",
        version: 1,
        requestedBy: "operator-1",
        approvals,
        automationGateEnabled: false,
        retention,
        now: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow("AUTOMATED_TEARDOWN_EXTERNALLY_GATED");
    expect(
      planDeletionCertificate({
        terminationId: "termination-1",
        accountId: "account-1",
        version: 1,
        teardownConfirmedAt: "2026-09-01T00:00:00.000Z",
        scope: "tenant",
        method: "crypto-erase",
        lockedExclusions: [],
        retainCertificateUntil: "2033-09-01T00:00:00.000Z",
      }).kind,
    ).toBe("request_deletion_certificate");
  });

  it("uses Novation to preserve service without teardown", () => {
    const effects = planNovationContinuity({
      novationId: "novation-1",
      version: 1,
      sourceOrderId: "order-partner",
      newOrderId: "order-direct",
      organizationId: "org-1",
      formerPartnerAccountId: "partner-1",
      directAccountId: "account-1",
      reason: "partner_default",
    });
    expect(effects[0]?.payload).toMatchObject({
      preserveTenantAndData: true,
      teardownForbidden: true,
    });
  });
});
