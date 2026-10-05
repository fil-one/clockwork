import { describe, expect, it } from "vitest";

import { ids, permissionsForRoles } from "@clockwork/contracts";

import type { AuthorizationContext } from "./authorization";
import {
  applyChannelPolicyCommand,
  type ChannelPolicyRecord,
} from "./core/channel-policy";
import {
  applyPaygOfferCommand,
  PaygOfferTermsSchema,
  type PaygOfferRecord,
} from "./core/payg/offers";
import {
  decideException,
  openExceptionCase,
  validateQueuePolicies,
  exceptionQueues,
} from "./exceptions";
import {
  assertDistinctOrSelfApproved,
  assertSelfApprovalSession,
  selfApprovalReason,
} from "./self-approval";
import {
  planOffboarding,
  recordDestructiveApproval,
  requestTeardown,
} from "./terminations";

const admin = "20000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const reason = "Second approver is away this week";

function session(
  roles: AuthorizationContext["roles"],
  extra: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    userId: ids.user.parse(admin),
    accountIds: [],
    roles,
    permissions: permissionsForRoles(roles, {
      side: "fil_one",
      assisted: Boolean(extra.impersonation),
    }),
    side: "fil_one",
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
    ...extra,
  };
}

describe("self-approval authority and reason", () => {
  it("admits a commerce administrator in their own MFA-verified session", () => {
    expect(() =>
      assertSelfApprovalSession(session(["commerce_admin"])),
    ).not.toThrow();
  });
  it("refuses every other role, an unverified session and an assisted one", () => {
    expect(() =>
      assertSelfApprovalSession(session(["finance_approver"])),
    ).toThrow("SELF_APPROVAL_NOT_PERMITTED");
    expect(() =>
      assertSelfApprovalSession(
        session(["commerce_admin"], { mfaVerified: false }),
      ),
    ).toThrow("SELF_APPROVAL_MFA_REQUIRED");
    expect(() =>
      assertSelfApprovalSession(
        session(["commerce_admin"], {
          impersonation: {
            accountId: ids.account.parse(
              "10000000-0000-4000-8000-000000000001",
            ),
            reason: "Helping",
            sessionId: "s",
            actualUserId: ids.user.parse(admin),
            actualActorEmail: "ada@fil.one",
          },
        }),
      ),
    ).toThrow("SELF_APPROVAL_DIRECT_SESSION_REQUIRED");
  });
  it("needs a reason of 8 to 500 characters, trimmed", () => {
    expect(selfApprovalReason(`  ${reason}  `)).toBe(reason);
    expect(() => selfApprovalReason("short")).toThrow(
      "SELF_APPROVAL_REASON_REQUIRED",
    );
    expect(() => selfApprovalReason("x".repeat(501))).toThrow(
      "SELF_APPROVAL_REASON_REQUIRED",
    );
    expect(() => selfApprovalReason(undefined)).toThrow(
      "SELF_APPROVAL_REASON_REQUIRED",
    );
  });
  it("keeps the distinct rule without a self-approval and refuses one on someone else's request", () => {
    const base = { deciderId: admin, distinctError: "DISTINCT" };
    expect(() =>
      assertDistinctOrSelfApproved({
        ...base,
        requesterIds: [admin],
        selfApproval: undefined,
      }),
    ).toThrow("DISTINCT");
    expect(
      assertDistinctOrSelfApproved({
        ...base,
        requesterIds: [other],
        selfApproval: undefined,
      }),
    ).toBe(false);
    expect(
      assertDistinctOrSelfApproved({
        ...base,
        requesterIds: [admin],
        selfApproval: { reason },
      }),
    ).toBe(true);
    expect(() =>
      assertDistinctOrSelfApproved({
        ...base,
        requesterIds: [other],
        selfApproval: { reason },
      }),
    ).toThrow("SELF_APPROVAL_NOT_OWN_REQUEST");
  });
});

describe("channel policy self-approval", () => {
  const proposed: ChannelPolicyRecord = {
    id: "90000000-0000-4000-8000-000000001449",
    rowVersion: 2,
    status: "proposed",
    terms: {
      version: 1,
      effectiveFrom: "2026-10-06",
      selfServeThresholdTb: 250,
      defaultProtectionDays: 30,
      maximumProtectionDays: 60,
      extensionDays: 30,
      maximumExtensions: 1,
      sourceEvidence: "approved-source",
    },
    createdBy: admin,
    lastEditedBy: admin,
    proposedBy: admin,
    approvedBy: null,
    approvalEvidence: null,
    decisionReason: "Ready",
    createdAt: "2026-10-05T00:00:00Z",
    updatedAt: "2026-10-05T00:00:00Z",
  };
  const approve = {
    action: "approve" as const,
    id: proposed.id,
    expectedRowVersion: 2,
    reason,
    approvalEvidence: "signed-evidence",
  };
  const now = "2026-10-05T12:00:00Z";
  it("records the author's own approval", () => {
    expect(
      applyChannelPolicyCommand({
        current: proposed,
        command: approve,
        userId: admin,
        now,
        selfApproval: { reason },
      }),
    ).toMatchObject({
      status: "approved",
      approvedBy: admin,
      selfApproved: true,
      selfApprovalReason: reason,
    });
  });
  it("refuses the author without it, and a self-approved return", () => {
    expect(() =>
      applyChannelPolicyCommand({
        current: proposed,
        command: approve,
        userId: admin,
        now,
      }),
    ).toThrow("CHANNEL_POLICY_DISTINCT_APPROVER_REQUIRED");
    expect(() =>
      applyChannelPolicyCommand({
        current: proposed,
        command: {
          action: "reject",
          id: proposed.id,
          expectedRowVersion: 2,
          reason,
        },
        userId: admin,
        now,
        selfApproval: { reason },
      }),
    ).toThrow("SELF_APPROVAL_APPROVE_ONLY");
    expect(
      applyChannelPolicyCommand({
        current: proposed,
        command: approve,
        userId: other,
        now,
      }).selfApproved,
    ).toBeUndefined();
  });
});

describe("PAYG offer self-approval", () => {
  const terms = PaygOfferTermsSchema.parse({
    name: "PAYG",
    sku: "OBJECT_PAYG",
    region: "france",
    version: 1,
    effectiveFrom: "2026-09-01",
    sourceUri: "https://docs.fil.one/billing/trial",
    sourceCheckedAt: "2026-09-01T00:00:00.000Z",
    sourceDocumentId: "source",
    owner: "Finance",
    payg: {
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
    trial: {
      durationDays: 30,
      gracePeriodDays: 7,
      storageLimitBytes: "1000000000000",
      cumulativeEgressLimitBytes: "2000000000000",
      maximumCounterAgeSeconds: 60,
      egressExhaustion: "disable_all",
    },
  });
  const now = "2026-09-02T00:00:00.000Z";
  const proposed: PaygOfferRecord = {
    id: "20000000-0000-4000-8000-000000001449",
    rowVersion: 2,
    status: "proposed",
    terms,
    createdBy: admin,
    lastEditedBy: admin,
    proposedBy: admin,
    approvedBy: null,
    approvalEvidenceId: null,
    decisionReason: "Ready",
    createdAt: now,
    updatedAt: now,
  };
  const approve = {
    action: "approve" as const,
    id: proposed.id,
    expectedRowVersion: 2,
    reason,
    approvalEvidenceId: "signed-decision",
  };
  it("records the author's own approval and keeps the rule otherwise", () => {
    expect(
      applyPaygOfferCommand({
        current: proposed,
        command: approve,
        userId: admin,
        now,
        selfApproval: { reason },
      }),
    ).toMatchObject({ status: "approved", selfApproved: true });
    expect(() =>
      applyPaygOfferCommand({
        current: proposed,
        command: approve,
        userId: admin,
        now,
      }),
    ).toThrow("PAYG_OFFER_DISTINCT_APPROVER_REQUIRED");
    expect(() =>
      applyPaygOfferCommand({
        current: proposed,
        command: approve,
        userId: admin,
        now,
        selfApproval: { reason: "short" },
      }),
    ).toThrow("SELF_APPROVAL_REASON_REQUIRED");
  });
});

describe("exception self-approval", () => {
  const policies = validateQueuePolicies(
    exceptionQueues.map((queue) => ({
      queue,
      ownerId: admin,
      backupId: other,
      targetBusinessHours: 8,
      escalationOwnerId: "20000000-0000-4000-8000-000000000003",
      separationRequired: true,
    })),
  );
  const open = openExceptionCase({
    caseId: "case-1",
    queue: "pricing",
    objectType: "quote",
    objectId: "quote-1",
    requestedBy: admin,
    openedAt: "2026-10-05T00:00:00.000Z",
    policies,
  });
  const decision = {
    actorId: admin,
    outcome: "approved" as const,
    reason,
    evidenceDocumentId: "evidence-1",
    evidenceBytes: new Uint8Array([1]),
    decidedAt: "2026-10-05T01:00:00.000Z",
  };
  it("lets the requester approve their own below-floor case with a self-approval", () => {
    expect(() => decideException(open, decision)).toThrow(
      "EXCEPTION_SELF_APPROVAL_FORBIDDEN",
    );
    const decided = decideException(open, {
      ...decision,
      selfApproval: { reason },
    });
    expect(decided.status).toBe("approved");
    expect(decided.decisions[0]?.selfApproved).toBe(true);
    expect(() =>
      decideException(open, {
        ...decision,
        outcome: "rejected",
        selfApproval: { reason },
      }),
    ).toThrow("SELF_APPROVAL_APPROVE_ONLY");
  });
});

describe("termination and teardown self-approval", () => {
  const plan = planOffboarding({
    terminationId: "termination-1",
    accountId: "account-1",
    orderId: "order-1",
    organizationId: "org-1",
    reason: "customer_request",
    requestedBy: admin,
    effectiveAt: "2026-08-01T00:00:00.000Z",
    finalBillingStatus: "settled",
    retrievalDays: 30,
    retainedObjects: [],
    now: "2026-07-31T16:00:00.000Z",
  });
  const approval = (approverId: string, approvalId = "approval-1") => ({
    approvalId,
    approverId,
    decision: "approved" as const,
    reason,
    decidedAt: "2026-08-01T00:10:00.000Z",
    evidenceHash: "a".repeat(64),
    recentAuthentication: {
      authenticatedAt: "2026-08-01T00:05:00.000Z",
      evidenceHash: "b".repeat(64),
    },
  });
  it("fills both slots with one self-approval, each marked", () => {
    expect(() => recordDestructiveApproval(plan, approval(admin))).toThrow(
      "DESTRUCTIVE_SELF_APPROVAL_FORBIDDEN",
    );
    const approved = recordDestructiveApproval(plan, approval(admin), {
      selfApproval: { reason },
    });
    expect(approved.status).toBe("ready_for_teardown");
    expect(approved.approvals).toHaveLength(2);
    expect(approved.approvals.every((item) => item.selfApproved)).toBe(true);
    expect(
      requestTeardown(approved, {
        automatedTeardownAuthorized: true,
        now: "2026-09-02T00:00:00.000Z",
      }).command.approvalIds,
    ).toEqual(["approval-1", "approval-1"]);
  });
  it("fills only the open slot after a second person approved", () => {
    const once = recordDestructiveApproval(plan, approval(other, "approval-0"));
    const both = recordDestructiveApproval(once, approval(admin), {
      selfApproval: { reason },
    });
    expect(both.approvals.map((item) => item.selfApproved ?? false)).toEqual([
      false,
      true,
    ]);
    expect(both.status).toBe("ready_for_teardown");
  });
  it("refuses a self-approval on someone else's termination", () => {
    expect(() =>
      recordDestructiveApproval(plan, approval(other), {
        selfApproval: { reason },
      }),
    ).toThrow("SELF_APPROVAL_NOT_OWN_REQUEST");
  });
});
