import { createHash } from "node:crypto";

const sha256Pattern = /^[a-f0-9]{64}$/;
const instantWithOffsetPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function assertInstant(value: string, code: string): void {
  if (
    !instantWithOffsetPattern.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error(code);
}

export type TerminationReason =
  | "customer_request"
  | "non_renewal"
  | "partner_request"
  | "partner_default"
  | "material_breach";
export type OffboardingStatus =
  | "pending_final_billing"
  | "retrieval_window"
  | "retention_blocked"
  | "pending_approval"
  | "ready_for_teardown"
  | "teardown_requested"
  | "teardown_confirmed"
  | "complete";

export interface RetainedObject {
  objectId: string;
  scope: string;
  retainUntil: string;
  legalHold: boolean;
}

export function maximumObjectLockDate(
  objects: readonly RetainedObject[],
): string | null {
  if (objects.length === 0) return null;
  return objects.reduce(
    (latest, object) =>
      Date.parse(object.retainUntil) > Date.parse(latest)
        ? object.retainUntil
        : latest,
    objects[0]?.retainUntil ?? "",
  );
}

export interface OffboardingPlan {
  terminationId: string;
  accountId: string;
  orderId: string;
  organizationId: string;
  reason: TerminationReason;
  requestedBy: string;
  effectiveAt: string;
  finalBillingStatus: "pending" | "settled" | "credit_due";
  retrievalStartsAt: string;
  retrievalEndsAt: string;
  maximumRetentionAt: string | null;
  status: OffboardingStatus;
  lockedExclusions: readonly RetainedObject[];
  deletionScheduledAt: string | null;
  approvals: readonly DestructiveApproval[];
  teardownOperationId: string | null;
  teardownConfirmedAt: string | null;
  teardownExcludedObjectIds: readonly string[];
}

export function planOffboarding(input: {
  terminationId: string;
  accountId: string;
  orderId: string;
  organizationId: string;
  reason: TerminationReason;
  requestedBy: string;
  effectiveAt: string;
  finalBillingStatus: OffboardingPlan["finalBillingStatus"];
  retrievalDays: number;
  retainedObjects: readonly RetainedObject[];
  now: string;
}): OffboardingPlan {
  if (!Number.isInteger(input.retrievalDays) || input.retrievalDays < 1)
    throw new Error("RETRIEVAL_WINDOW_INVALID");
  assertInstant(input.effectiveAt, "TERMINATION_EFFECTIVE_AT_INVALID");
  assertInstant(input.now, "OFFBOARDING_NOW_INVALID");
  for (const object of input.retainedObjects) {
    if (!object.objectId.trim() || !object.scope.trim())
      throw new Error("RETAINED_OBJECT_IDENTITY_REQUIRED");
    assertInstant(object.retainUntil, "OBJECT_LOCK_DATE_INVALID");
  }
  const retrievalStartsAt =
    Date.parse(input.effectiveAt) > Date.parse(input.now)
      ? input.effectiveAt
      : input.now;
  const retrievalEndsAt = new Date(
    Date.parse(retrievalStartsAt) + input.retrievalDays * 86_400_000,
  ).toISOString();
  const lockedExclusions = input.retainedObjects.filter(
    (object) =>
      object.legalHold ||
      Date.parse(object.retainUntil) > Date.parse(retrievalEndsAt),
  );
  const maximumRetentionAt = maximumObjectLockDate(input.retainedObjects);
  const status =
    input.finalBillingStatus === "settled"
      ? "retrieval_window"
      : "pending_final_billing";
  return {
    terminationId: input.terminationId,
    accountId: input.accountId,
    orderId: input.orderId,
    organizationId: input.organizationId,
    reason: input.reason,
    requestedBy: input.requestedBy,
    effectiveAt: input.effectiveAt,
    finalBillingStatus: input.finalBillingStatus,
    retrievalStartsAt,
    retrievalEndsAt,
    maximumRetentionAt,
    status,
    lockedExclusions,
    deletionScheduledAt: lockedExclusions.some((object) => object.legalHold)
      ? null
      : maximumRetentionAt &&
          Date.parse(maximumRetentionAt) > Date.parse(retrievalEndsAt)
        ? maximumRetentionAt
        : retrievalEndsAt,
    approvals: [],
    teardownOperationId: null,
    teardownConfirmedAt: null,
    teardownExcludedObjectIds: [],
  };
}

export interface DestructiveApproval {
  approvalId: string;
  approverId: string;
  decision: "approved" | "rejected";
  reason: string;
  decidedAt: string;
  evidenceHash: string;
  recentAuthentication: {
    authenticatedAt: string;
    evidenceHash: string;
  };
}

export function recordDestructiveApproval(
  plan: OffboardingPlan,
  approval: DestructiveApproval,
): OffboardingPlan {
  if (!approval.approvalId.trim() || !approval.approverId.trim())
    throw new Error("APPROVAL_IDENTITY_REQUIRED");
  if (approval.approverId === plan.requestedBy)
    throw new Error("DESTRUCTIVE_SELF_APPROVAL_FORBIDDEN");
  if (!sha256Pattern.test(approval.evidenceHash))
    throw new Error("APPROVAL_EVIDENCE_HASH_INVALID");
  if (!sha256Pattern.test(approval.recentAuthentication.evidenceHash))
    throw new Error("AUTHENTICATION_EVIDENCE_HASH_INVALID");
  assertInstant(approval.decidedAt, "APPROVAL_TIME_INVALID");
  assertInstant(
    approval.recentAuthentication.authenticatedAt,
    "AUTHENTICATION_TIME_INVALID",
  );
  const authenticationAge =
    Date.parse(approval.decidedAt) -
    Date.parse(approval.recentAuthentication.authenticatedAt);
  if (authenticationAge < 0 || authenticationAge > 15 * 60_000)
    throw new Error("RECENT_AUTHENTICATION_REQUIRED");
  if (approval.reason.trim().length < 8)
    throw new Error("APPROVAL_REASON_REQUIRED");
  if (
    plan.approvals.some(
      (item) =>
        item.approverId === approval.approverId ||
        item.approvalId === approval.approvalId,
    )
  )
    throw new Error("APPROVER_MUST_BE_DISTINCT");
  const approvals = Object.freeze([
    ...plan.approvals,
    Object.freeze({
      ...approval,
      reason: approval.reason.trim(),
      recentAuthentication: Object.freeze({
        ...approval.recentAuthentication,
      }),
    }),
  ]);
  return {
    ...plan,
    approvals,
    status: approvals.some((item) => item.decision === "rejected")
      ? "pending_approval"
      : approvals.filter((item) => item.decision === "approved").length >= 2
        ? "ready_for_teardown"
        : "pending_approval",
  };
}

export function requestTeardown(
  plan: OffboardingPlan,
  input: {
    automatedTeardownAuthorized: boolean;
    now: string;
  },
): {
  plan: OffboardingPlan;
  command: {
    organizationId: string;
    approvalIds: readonly [string, string];
    approvalEvidenceHashes: readonly [string, string];
    scope: "deletable_remainder";
    excludedObjectIds: readonly string[];
    excludedScopes: readonly string[];
    idempotencyKey: string;
  };
} {
  if (!input.automatedTeardownAuthorized)
    throw new Error("AUTOMATED_TEARDOWN_EXTERNALLY_GATED");
  assertInstant(input.now, "TEARDOWN_REQUEST_TIME_INVALID");
  if (plan.finalBillingStatus !== "settled")
    throw new Error("FINAL_BILLING_INCOMPLETE");
  if (Date.parse(input.now) < Date.parse(plan.retrievalEndsAt))
    throw new Error("RETRIEVAL_WINDOW_ACTIVE");
  const approved = plan.approvals.filter(
    (approval) => approval.decision === "approved",
  );
  if (
    approved.length < 2 ||
    approved[0]?.approverId === approved[1]?.approverId
  )
    throw new Error("TWO_PERSON_APPROVAL_REQUIRED");
  if (plan.status !== "ready_for_teardown")
    throw new Error("TEARDOWN_NOT_APPROVED");
  const activeExclusions = plan.lockedExclusions.filter(
    (object) =>
      object.legalHold ||
      Date.parse(object.retainUntil) > Date.parse(input.now),
  );
  const excludedObjectIds = activeExclusions.map((object) => object.objectId);
  const excludedScopes = activeExclusions.map((object) => object.scope);
  const approvalIds = [
    approved[0]?.approvalId ?? "",
    approved[1]?.approvalId ?? "",
  ] as const;
  const approvalEvidenceHashes = [
    approved[0]?.evidenceHash ?? "",
    approved[1]?.evidenceHash ?? "",
  ] as const;
  const idempotencyKey = `teardown:${createHash("sha256")
    .update(
      [
        plan.terminationId,
        plan.organizationId,
        ...approvalIds,
        ...approvalEvidenceHashes,
        ...excludedObjectIds.slice().sort(),
      ].join(":"),
    )
    .digest("hex")}`;
  return {
    plan: {
      ...plan,
      status: "teardown_requested",
      teardownExcludedObjectIds: excludedObjectIds,
    },
    command: {
      organizationId: plan.organizationId,
      approvalIds,
      approvalEvidenceHashes,
      scope: "deletable_remainder",
      excludedObjectIds,
      excludedScopes,
      idempotencyKey,
    },
  };
}

export function confirmTeardown(
  plan: OffboardingPlan,
  input: {
    operationId: string;
    confirmedAt: string;
    excludedObjectIds: readonly string[];
  },
): OffboardingPlan {
  if (plan.status !== "teardown_requested")
    throw new Error("TEARDOWN_NOT_REQUESTED");
  if (!input.operationId.trim())
    throw new Error("TEARDOWN_OPERATION_ID_REQUIRED");
  assertInstant(input.confirmedAt, "TEARDOWN_CONFIRMATION_TIME_INVALID");
  if (
    [...new Set(input.excludedObjectIds)].sort().join("\0") !==
    [...new Set(plan.teardownExcludedObjectIds)].sort().join("\0")
  )
    throw new Error("TEARDOWN_EXCLUSION_CONFIRMATION_MISMATCH");
  return {
    ...plan,
    status: "teardown_confirmed",
    teardownOperationId: input.operationId,
    teardownConfirmedAt: input.confirmedAt,
  };
}

export function deletionCertificateData(
  plan: OffboardingPlan,
  input: { completedAt: string; method: string },
): {
  terminationId: string;
  scope: string;
  method: string;
  completedAt: string;
  lockedExclusions: readonly {
    scope: string;
    retainedUntil: string;
    reason: string;
  }[];
} {
  if (
    plan.status !== "teardown_confirmed" ||
    !plan.teardownOperationId ||
    !plan.teardownConfirmedAt
  )
    throw new Error("TEARDOWN_CONFIRMATION_REQUIRED");
  assertInstant(input.completedAt, "DELETION_COMPLETED_AT_INVALID");
  if (Date.parse(input.completedAt) < Date.parse(plan.teardownConfirmedAt))
    throw new Error("DELETION_PRECEDES_TEARDOWN_CONFIRMATION");
  if (!input.method.trim()) throw new Error("DELETION_METHOD_REQUIRED");
  return {
    terminationId: plan.terminationId,
    scope: `deletable_remainder:organization:${plan.organizationId}`,
    method: input.method,
    completedAt: input.completedAt,
    lockedExclusions: plan.lockedExclusions
      .filter((object) =>
        plan.teardownExcludedObjectIds.includes(object.objectId),
      )
      .map((object) => ({
        scope: object.scope,
        retainedUntil: object.retainUntil,
        reason: object.legalHold ? "legal_hold" : "object_lock_retention",
      })),
  };
}

export function authorizePartnerInitiation(input: {
  sourcing: "direct" | "referral" | "resale";
  orderPartnerAccountId: string | null;
  actorPartnerAccountId: string;
}): void {
  if (
    input.sourcing !== "resale" ||
    !input.orderPartnerAccountId ||
    input.orderPartnerAccountId !== input.actorPartnerAccountId
  )
    throw new Error("PARTNER_TERMINATION_SCOPE");
}

export interface NovationPlan {
  formerPartnerAccountId: string;
  endClientAccountId: string;
  sourceOrderId: string;
  newAgreementId: string;
  newOrderId: string;
  organizationId: string;
  tenantId: string;
  resourceIds: readonly string[];
  billingIdentityChanged: true;
  serviceContinuity: true;
  partnerEconomicsDisclosed: false;
  reason: "partner_default" | "partner_exit" | "agreed_handoff";
}

export function createNovationPlan(
  input: Omit<
    NovationPlan,
    "billingIdentityChanged" | "serviceContinuity" | "partnerEconomicsDisclosed"
  >,
): NovationPlan {
  if (!input.newAgreementId || !input.newOrderId)
    throw new Error("DIRECT_CHAIN_REQUIRED");
  if (input.resourceIds.length === 0)
    throw new Error("CONTINUITY_RESOURCES_REQUIRED");
  return {
    ...input,
    resourceIds: [...input.resourceIds],
    billingIdentityChanged: true,
    serviceContinuity: true,
    partnerEconomicsDisclosed: false,
  };
}
