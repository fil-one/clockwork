import { describe, expect, it } from "vitest";

import {
  confirmTeardown,
  createNovationPlan,
  deletionCertificateData,
  planOffboarding,
  recordDestructiveApproval,
  requestTeardown,
} from ".";

function lockedPlan() {
  return planOffboarding({
    terminationId: "termination-1",
    accountId: "account-1",
    orderId: "order-1",
    organizationId: "org-1",
    reason: "customer_request",
    requestedBy: "requester-1",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    finalBillingStatus: "settled",
    retrievalDays: 30,
    retainedObjects: [
      {
        objectId: "object-1",
        scope: "bucket-1/key-1",
        retainUntil: "2027-08-01T00:00:00.000Z",
        legalHold: false,
        reason: "object_lock_retention",
      },
    ],
    now: "2026-07-31T16:00:00.000Z",
  });
}

function approval(
  approvalId: string,
  approverId: string,
  decidedAt = "2026-08-01T00:10:00.000Z",
) {
  return {
    approvalId,
    approverId,
    decision: "approved" as const,
    reason: "Independently verified destructive scope",
    decidedAt,
    evidenceHash: approvalId.endsWith("1") ? "a".repeat(64) : "b".repeat(64),
    recentAuthentication: {
      authenticatedAt: new Date(
        Date.parse(decidedAt) - 5 * 60_000,
      ).toISOString(),
      evidenceHash: approvalId.endsWith("1") ? "c".repeat(64) : "d".repeat(64),
    },
  };
}

function approveTwice(plan: ReturnType<typeof planOffboarding>) {
  return recordDestructiveApproval(
    recordDestructiveApproval(plan, approval("approval-1", "approver-1")),
    approval("approval-2", "approver-2", "2026-08-01T00:11:00.000Z"),
  );
}

describe("retention-aware offboarding", () => {
  it("branches retained objects into certificate exclusions", () => {
    let plan = lockedPlan();
    expect(plan.maximumRetentionAt).toBe("2027-08-01T00:00:00.000Z");
    expect(plan.lockedExclusions).toHaveLength(1);
    expect(() =>
      deletionCertificateData(plan, {
        completedAt: "2026-09-01T00:00:00.000Z",
        method: "tenant resources removed; retained object excluded",
      }),
    ).toThrow("TEARDOWN_CONFIRMATION_REQUIRED");
    plan = approveTwice(plan);
    const requested = requestTeardown(plan, {
      automatedTeardownAuthorized: true,
      now: "2026-09-02T00:00:00.000Z",
    });
    expect(requested.command).toMatchObject({
      scope: "deletable_remainder",
      excludedObjectIds: ["object-1"],
      excludedScopes: ["bucket-1/key-1"],
    });
    plan = confirmTeardown(requested.plan, {
      operationId: "teardown-remainder-1",
      confirmedAt: "2026-09-02T00:01:00.000Z",
      excludedObjectIds: ["object-1"],
    });
    expect(
      deletionCertificateData(plan, {
        completedAt: "2026-09-02T00:02:00.000Z",
        method: "tenant resources removed; retained object excluded",
      }).lockedExclusions,
    ).toEqual([
      {
        scope: "bucket-1/key-1",
        retainedUntil: "2027-08-01T00:00:00.000Z",
        reason: "object_lock_retention",
      },
    ]);
  });

  it("enforces two distinct, recently authenticated approvers", () => {
    let plan = lockedPlan();
    expect(() =>
      recordDestructiveApproval(plan, {
        approvalId: "approval-self",
        approverId: "requester-1",
        decision: "approved",
        reason: "Reviewed complete teardown scope",
        decidedAt: "2026-08-01T00:00:00.000Z",
        evidenceHash: "a".repeat(64),
        recentAuthentication: {
          authenticatedAt: "2026-07-31T23:55:00.000Z",
          evidenceHash: "b".repeat(64),
        },
      }),
    ).toThrow("DESTRUCTIVE_SELF_APPROVAL_FORBIDDEN");
    plan = recordDestructiveApproval(
      plan,
      approval("approval-1", "approver-1"),
    );
    plan = recordDestructiveApproval(
      plan,
      approval("approval-2", "approver-2", "2026-08-01T00:11:00.000Z"),
    );
    expect(plan.status).toBe("ready_for_teardown");
    expect(() =>
      requestTeardown(plan, {
        automatedTeardownAuthorized: false,
        now: "2027-08-02T00:00:00.000Z",
      }),
    ).toThrow("AUTOMATED_TEARDOWN_EXTERNALLY_GATED");
  });

  it("issues a stable teardown command only after two approvals and retrieval", () => {
    let plan = planOffboarding({
      terminationId: "termination-2",
      accountId: "account-1",
      orderId: "order-2",
      organizationId: "org-2",
      reason: "non_renewal",
      requestedBy: "requester-1",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      finalBillingStatus: "settled",
      retrievalDays: 1,
      retainedObjects: [],
      now: "2026-08-01T00:00:00.000Z",
    });
    plan = approveTwice(plan);
    const requested = requestTeardown(plan, {
      automatedTeardownAuthorized: true,
      now: "2026-08-03T00:00:00.000Z",
    });
    expect(requested.command.approvalIds).toEqual(["approval-1", "approval-2"]);
    expect(requested.command.idempotencyKey).toMatch(/^teardown:[a-f0-9]{64}$/);
    expect(
      confirmTeardown(requested.plan, {
        operationId: "teardown-operation-1",
        confirmedAt: "2026-08-03T00:01:00.000Z",
        excludedObjectIds: [],
      }),
    ).toMatchObject({
      status: "teardown_confirmed",
      teardownOperationId: "teardown-operation-1",
    });
  });

  it("blocks credit-due billing and validates approval/authentication evidence", () => {
    let plan = planOffboarding({
      terminationId: "termination-credit",
      accountId: "account-1",
      orderId: "order-credit",
      organizationId: "org-credit",
      reason: "customer_request",
      requestedBy: "requester-1",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      finalBillingStatus: "credit_due",
      retrievalDays: 1,
      retainedObjects: [],
      now: "2026-08-01T00:00:00.000Z",
    });
    expect(() =>
      recordDestructiveApproval(plan, {
        ...approval("approval-1", "approver-1"),
        evidenceHash: "not-a-hash",
      }),
    ).toThrow("APPROVAL_EVIDENCE_HASH_INVALID");
    expect(() =>
      recordDestructiveApproval(plan, {
        ...approval("approval-1", "approver-1"),
        recentAuthentication: {
          authenticatedAt: "2026-07-31T23:00:00.000Z",
          evidenceHash: "c".repeat(64),
        },
      }),
    ).toThrow("RECENT_AUTHENTICATION_REQUIRED");
    plan = approveTwice(plan);
    expect(() =>
      requestTeardown(plan, {
        automatedTeardownAuthorized: true,
        now: "2026-08-03T00:00:00.000Z",
      }),
    ).toThrow("FINAL_BILLING_INCOMPLETE");
  });

  it("never schedules a finite deletion while a legal hold exists", () => {
    expect(
      planOffboarding({
        terminationId: "termination-hold",
        accountId: "account-1",
        orderId: "order-hold",
        organizationId: "org-hold",
        reason: "material_breach",
        requestedBy: "requester-1",
        effectiveAt: "2026-08-01T00:00:00.000Z",
        finalBillingStatus: "settled",
        retrievalDays: 1,
        retainedObjects: [
          {
            objectId: "held-1",
            scope: "bucket/held",
            retainUntil: "2027-08-01T00:00:00.000Z",
            legalHold: true,
            reason: "legal_hold",
          },
        ],
        now: "2026-08-01T00:00:00.000Z",
      }).deletionScheduledAt,
    ).toBeNull();
  });

  it("preserves resources and hides partner economics during Novation", () => {
    expect(
      createNovationPlan({
        formerPartnerAccountId: "partner-1",
        endClientAccountId: "client-1",
        sourceOrderId: "order-old",
        newAgreementId: "agreement-new",
        newOrderId: "order-new",
        organizationId: "org-existing",
        tenantId: "tenant-existing",
        resourceIds: ["bucket-existing"],
        reason: "partner_default",
      }),
    ).toMatchObject({
      serviceContinuity: true,
      partnerEconomicsDisclosed: false,
      tenantId: "tenant-existing",
    });
  });
});
