import {
  durableHumanWait,
  type DurableHumanWait,
  workflowEffect,
  type WorkflowEffect,
  type WorkflowIdentity,
} from "../onboarding/durable";

export * from "./deletion-certificate-handler";

export const offboardingTaskIds = Object.freeze({
  retrievalWindow: "lifecycle-offboarding-retrieval-window-v1",
  retentionRelease: "lifecycle-offboarding-retention-release-v1",
  teardown: "lifecycle-offboarding-teardown-v1",
  confirmation: "lifecycle-offboarding-confirmation-v1",
});

export interface RetainedObject {
  scope: string;
  retainedUntil: string;
  reason: string;
  legalHold: boolean;
}

export type OffboardingEffect = WorkflowEffect<
  | "coordinate_final_billing"
  | "notify_retrieval_window"
  | "request_teardown"
  | "record_teardown_confirmation"
  | "schedule_retained_deletion"
  | "request_deletion_certificate"
  | "reparent_novated_tenant"
  | "confirm_novation_continuity",
  Readonly<Record<string, unknown>>
>;

function terminationIdentity(
  terminationId: string,
  version: number,
  operation = "offboarding",
): WorkflowIdentity {
  return {
    aggregateType: "termination",
    aggregateId: terminationId,
    aggregateVersion: version,
    operation,
  };
}

export function startOffboarding(input: {
  terminationId: string;
  orderId: string;
  version: number;
  sourcing: "direct" | "referral" | "resale";
  invoicingAccountId: string;
  partnerAccountId: string | null;
  initiatedByAccountId: string;
  effectiveAt: string;
  retrievalEndsAt: string;
  waitExpiresAt: string;
}): { effects: readonly OffboardingEffect[]; wait: DurableHumanWait } {
  if (
    input.sourcing === "resale" &&
    (!input.partnerAccountId ||
      input.initiatedByAccountId !== input.partnerAccountId)
  )
    throw new Error("PARTNER_INITIATION_REQUIRED");
  if (Date.parse(input.retrievalEndsAt) <= Date.parse(input.effectiveAt))
    throw new Error("RETRIEVAL_WINDOW_INVALID");
  const identity = terminationIdentity(input.terminationId, input.version);
  return {
    effects: [
      workflowEffect(identity, "final-billing", "coordinate_final_billing", {
        terminationId: input.terminationId,
        orderId: input.orderId,
        invoicingAccountId: input.invoicingAccountId,
        effectiveAt: input.effectiveAt,
      }),
      workflowEffect(identity, "retrieval-window", "notify_retrieval_window", {
        terminationId: input.terminationId,
        orderId: input.orderId,
        retrievalEndsAt: input.retrievalEndsAt,
        egressTermsMustBeIncluded: true,
      }),
    ],
    wait: durableHumanWait({
      identity,
      discriminator: "final-billing-and-retrieval",
      subjectType: "termination",
      subjectId: input.terminationId,
      resumeEvents: [
        "billing.finalized",
        "retrieval.window-ended",
        "offboarding.cancelled",
      ],
      expiresAt: input.waitExpiresAt,
    }),
  };
}

export function maximumObjectLockDate(
  objects: readonly RetainedObject[],
): string | null {
  if (objects.length === 0) return null;
  for (const object of objects) {
    if (!Number.isFinite(Date.parse(object.retainedUntil)))
      throw new Error("RETENTION_DATE_INVALID");
  }
  return (
    [...objects].sort(
      (left, right) =>
        Date.parse(right.retainedUntil) - Date.parse(left.retainedUntil),
    )[0]?.retainedUntil ?? null
  );
}

export function evaluateRetention(input: {
  objects: readonly RetainedObject[];
  requestedDeletionAt: string;
}): {
  branch: "ready_for_teardown" | "retention_blocked";
  deletionScheduledAt: string;
  lockedExclusions: readonly RetainedObject[];
} {
  const requested = Date.parse(input.requestedDeletionAt);
  if (!Number.isFinite(requested)) throw new Error("DELETION_DATE_INVALID");
  const lockedExclusions = input.objects.filter(
    (object) =>
      object.legalHold || Date.parse(object.retainedUntil) > requested,
  );
  const maximum = maximumObjectLockDate(lockedExclusions);
  return {
    branch:
      lockedExclusions.length === 0
        ? "ready_for_teardown"
        : "retention_blocked",
    deletionScheduledAt:
      maximum && Date.parse(maximum) > requested
        ? maximum
        : input.requestedDeletionAt,
    lockedExclusions,
  };
}

export interface DestructiveApproval {
  approvalId: string;
  requestedBy: string;
  approvedBy: string;
  status: "approved" | "rejected" | "pending" | "expired";
  action: string;
}

export function validateDestructiveApprovals(input: {
  requestedBy: string;
  approvals: readonly DestructiveApproval[];
}): readonly [string, string] {
  const approved = input.approvals.filter(
    (approval) =>
      approval.status === "approved" && approval.action === "tenant_teardown",
  );
  if (approved.some((approval) => approval.requestedBy !== input.requestedBy))
    throw new Error("APPROVAL_REQUEST_MISMATCH");
  const approvers = [
    ...new Set(approved.map((approval) => approval.approvedBy)),
  ];
  if (approvers.includes(input.requestedBy))
    throw new Error("TEARDOWN_SELF_APPROVAL_FORBIDDEN");
  if (approvers.length !== 2)
    throw new Error("TWO_DISTINCT_APPROVERS_REQUIRED");
  const approvalIds = approved
    .filter(
      (approval, index) =>
        approved.findIndex(
          (item) => item.approvedBy === approval.approvedBy,
        ) === index,
    )
    .map((approval) => approval.approvalId);
  const first = approvalIds[0];
  const second = approvalIds[1];
  if (!first || !second) throw new Error("TWO_DISTINCT_APPROVERS_REQUIRED");
  return [first, second];
}

export function planTeardown(input: {
  terminationId: string;
  organizationId: string;
  version: number;
  requestedBy: string;
  approvals: readonly DestructiveApproval[];
  automationGateEnabled: boolean;
  retention: ReturnType<typeof evaluateRetention>;
  now: string;
}): OffboardingEffect {
  if (!input.automationGateEnabled)
    throw new Error("AUTOMATED_TEARDOWN_EXTERNALLY_GATED");
  if (
    input.retention.branch === "retention_blocked" &&
    Date.parse(input.now) < Date.parse(input.retention.deletionScheduledAt)
  )
    throw new Error("OBJECT_LOCK_RETENTION_ACTIVE");
  const approvalIds = validateDestructiveApprovals(input);
  return workflowEffect(
    terminationIdentity(input.terminationId, input.version),
    `teardown:${input.organizationId}`,
    "request_teardown",
    {
      terminationId: input.terminationId,
      organizationId: input.organizationId,
      approvalIds,
      destructive: true,
    },
  );
}

export function planRetentionExpiry(input: {
  terminationId: string;
  version: number;
  retainedObjects: readonly RetainedObject[];
}): readonly OffboardingEffect[] {
  return input.retainedObjects.map((object) =>
    workflowEffect(
      terminationIdentity(
        input.terminationId,
        input.version,
        "retention-expiry",
      ),
      `${object.scope}:${object.retainedUntil}`,
      "schedule_retained_deletion",
      {
        terminationId: input.terminationId,
        scope: object.scope,
        reason: object.reason,
        skipWhileLegalHold: object.legalHold,
      },
      object.retainedUntil,
    ),
  );
}

export function ingestTeardownConfirmation(input: {
  terminationId: string;
  version: number;
  providerEventId: string;
  operationId: string;
  confirmedAt: string;
  processedProviderEventIds: ReadonlySet<string>;
}): OffboardingEffect | null {
  if (input.processedProviderEventIds.has(input.providerEventId)) return null;
  return workflowEffect(
    terminationIdentity(input.terminationId, input.version),
    `confirmation:${input.providerEventId}`,
    "record_teardown_confirmation",
    {
      terminationId: input.terminationId,
      operationId: input.operationId,
      confirmedAt: input.confirmedAt,
    },
  );
}

export function planDeletionCertificate(input: {
  terminationId: string;
  accountId: string;
  version: number;
  teardownConfirmedAt: string;
  scope: string;
  method: string;
  lockedExclusions: readonly RetainedObject[];
  retainCertificateUntil: string;
}): OffboardingEffect {
  return workflowEffect(
    terminationIdentity(
      input.terminationId,
      input.version,
      "completion-certificate",
    ),
    "certificate",
    "request_deletion_certificate",
    {
      terminationId: input.terminationId,
      accountId: input.accountId,
      scope: input.scope,
      method: input.method,
      completedAt: input.teardownConfirmedAt,
      lockedExclusions: input.lockedExclusions,
      retainUntil: input.retainCertificateUntil,
    },
  );
}

/** Partner default/exit preserves the live tenant and changes its commercial parent. */
export function planNovationContinuity(input: {
  novationId: string;
  version: number;
  sourceOrderId: string;
  newOrderId: string;
  organizationId: string;
  formerPartnerAccountId: string;
  directAccountId: string;
  reason: "partner_default" | "partner_exit" | "agreed_handoff";
}): readonly OffboardingEffect[] {
  const identity: WorkflowIdentity = {
    aggregateType: "novation",
    aggregateId: input.novationId,
    aggregateVersion: input.version,
    operation: "step-in-continuity",
  };
  return [
    workflowEffect(identity, "reparent", "reparent_novated_tenant", {
      ...input,
      preserveTenantAndData: true,
      teardownForbidden: true,
    }),
    workflowEffect(identity, "confirm", "confirm_novation_continuity", {
      novationId: input.novationId,
      sourceOrderId: input.sourceOrderId,
      newOrderId: input.newOrderId,
      organizationId: input.organizationId,
    }),
  ];
}
