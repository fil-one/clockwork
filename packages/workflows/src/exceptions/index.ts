import {
  durableHumanWait,
  type DurableHumanWait,
  workflowEffect,
  type WorkflowEffect,
  type WorkflowIdentity,
} from "../onboarding/durable";

export const exceptionTaskIds = Object.freeze({
  escalation: "lifecycle-exceptions-escalation-v1",
  humanDecision: "lifecycle-exceptions-human-decision-v1",
});

export const exceptionQueues = [
  "pricing",
  "legal",
  "credit_collections",
  "restricted_parties",
  "disputes",
  "deal_registration_disputes",
  "poc_qualification",
] as const;

export type ExceptionQueue = (typeof exceptionQueues)[number];

export interface ExceptionQueuePolicy {
  queue: ExceptionQueue;
  ownerUserId: string;
  backupUserId: string;
  slaHours: number;
  slaBusinessDays?: number;
  escalationUserId: string;
  separationRequired: boolean;
}

export interface ExceptionCaseState {
  caseId: string;
  version: number;
  queue: ExceptionQueue;
  objectType: string;
  objectId: string;
  requestedBy: string;
  openedAt: string;
  status: "open" | "approved" | "rejected" | "closed";
}

export type ExceptionEffect = WorkflowEffect<
  "assign_exception" | "escalate_exception" | "record_exception_decision",
  Readonly<Record<string, unknown>>
>;

function exceptionIdentity(
  exceptionCase: Pick<ExceptionCaseState, "caseId" | "version">,
  operation = "exception-case",
): WorkflowIdentity {
  return {
    aggregateType: "exception_case",
    aggregateId: exceptionCase.caseId,
    aggregateVersion: exceptionCase.version,
    operation,
  };
}

export function validateQueuePolicies(
  policies: readonly ExceptionQueuePolicy[],
): ReadonlyMap<ExceptionQueue, ExceptionQueuePolicy> {
  const result = new Map<ExceptionQueue, ExceptionQueuePolicy>();
  for (const policy of policies) {
    if (result.has(policy.queue))
      throw new Error(`DUPLICATE_QUEUE_POLICY:${policy.queue}`);
    if (
      !policy.ownerUserId.trim() ||
      !policy.backupUserId.trim() ||
      !policy.escalationUserId.trim()
    )
      throw new Error(`QUEUE_OWNERSHIP_INCOMPLETE:${policy.queue}`);
    if (policy.ownerUserId === policy.backupUserId)
      throw new Error(`QUEUE_BACKUP_MUST_BE_DISTINCT:${policy.queue}`);
    if (!Number.isInteger(policy.slaHours) || policy.slaHours < 1)
      throw new Error(`QUEUE_SLA_INVALID:${policy.queue}`);
    if (
      policy.slaBusinessDays !== undefined &&
      (!Number.isInteger(policy.slaBusinessDays) || policy.slaBusinessDays < 1)
    )
      throw new Error(`QUEUE_BUSINESS_DAY_SLA_INVALID:${policy.queue}`);
    result.set(policy.queue, Object.freeze({ ...policy }));
  }
  const missing = exceptionQueues.filter((queue) => !result.has(queue));
  if (missing.length > 0)
    throw new Error(`QUEUE_POLICIES_MISSING:${missing.join(",")}`);
  return result;
}

export function openExceptionCase(input: {
  exceptionCase: ExceptionCaseState;
  policy: ExceptionQueuePolicy;
}): { effect: ExceptionEffect; wait: DurableHumanWait; targetAt: string } {
  if (input.policy.queue !== input.exceptionCase.queue)
    throw new Error("QUEUE_POLICY_MISMATCH");
  const target = new Date(
    Date.parse(input.exceptionCase.openedAt) +
      input.policy.slaHours * 3_600_000,
  );
  if (input.policy.slaBusinessDays !== undefined) {
    const businessTarget = new Date(input.exceptionCase.openedAt);
    let remaining = input.policy.slaBusinessDays;
    while (remaining > 0) {
      businessTarget.setUTCDate(businessTarget.getUTCDate() + 1);
      if (![0, 6].includes(businessTarget.getUTCDay())) remaining -= 1;
    }
    target.setTime(businessTarget.getTime());
  }
  const targetAt = target.toISOString();
  const identity = exceptionIdentity(input.exceptionCase);
  return {
    effect: workflowEffect(identity, "assignment", "assign_exception", {
      caseId: input.exceptionCase.caseId,
      queue: input.exceptionCase.queue,
      ownerUserId: input.policy.ownerUserId,
      backupUserId: input.policy.backupUserId,
      targetAt,
    }),
    wait: durableHumanWait({
      identity,
      discriminator: "decision",
      subjectType: input.exceptionCase.objectType,
      subjectId: input.exceptionCase.objectId,
      resumeEvents: [
        "exception.approved",
        "exception.rejected",
        "exception.closed",
      ],
      expiresAt: targetAt,
    }),
    targetAt,
  };
}

export function planExceptionEscalation(input: {
  exceptionCase: ExceptionCaseState;
  policy: ExceptionQueuePolicy;
  now: string;
  targetAt: string;
  escalationLevel: 0 | 1;
}): ExceptionEffect | null {
  if (
    input.exceptionCase.status !== "open" ||
    Date.parse(input.now) < Date.parse(input.targetAt)
  )
    return null;
  const recipient =
    input.escalationLevel === 0
      ? input.policy.backupUserId
      : input.policy.escalationUserId;
  return workflowEffect(
    exceptionIdentity(input.exceptionCase, "exception-escalation"),
    `level:${input.escalationLevel + 1}:target:${input.targetAt}`,
    "escalate_exception",
    {
      caseId: input.exceptionCase.caseId,
      queue: input.exceptionCase.queue,
      recipient,
      escalationLevel: input.escalationLevel + 1,
      breachedAt: input.targetAt,
    },
  );
}

export interface ExceptionDecisionEvidence {
  decision: "approved" | "rejected";
  decidedBy: string;
  decidedAt: string;
  reason: string;
  evidenceDocumentIds: readonly string[];
  actualActorId: string;
  effectiveActorId: string;
}

export function decideExceptionCase(input: {
  exceptionCase: ExceptionCaseState;
  policy: ExceptionQueuePolicy;
  decision: ExceptionDecisionEvidence;
}): ExceptionEffect {
  if (input.exceptionCase.status !== "open")
    throw new Error("EXCEPTION_NOT_OPEN");
  if (input.policy.queue !== input.exceptionCase.queue)
    throw new Error("QUEUE_POLICY_MISMATCH");
  const allowed = new Set([
    input.policy.ownerUserId,
    input.policy.backupUserId,
  ]);
  if (!allowed.has(input.decision.decidedBy))
    throw new Error("EXCEPTION_DECIDER_NOT_ASSIGNED");
  if (
    input.policy.separationRequired &&
    (input.decision.decidedBy === input.exceptionCase.requestedBy ||
      input.decision.effectiveActorId === input.exceptionCase.requestedBy)
  )
    throw new Error("EXCEPTION_SELF_APPROVAL_FORBIDDEN");
  if (input.decision.reason.trim().length < 8)
    throw new Error("DECISION_REASON_REQUIRED");
  if (input.decision.evidenceDocumentIds.length === 0)
    throw new Error("DECISION_EVIDENCE_REQUIRED");
  return workflowEffect(
    exceptionIdentity(input.exceptionCase, "exception-decision"),
    `decision:${input.decision.decision}`,
    "record_exception_decision",
    {
      caseId: input.exceptionCase.caseId,
      queue: input.exceptionCase.queue,
      ...input.decision,
      reason: input.decision.reason.trim(),
      evidenceDocumentIds: [
        ...new Set(input.decision.evidenceDocumentIds),
      ].sort(),
      immutable: true,
    },
  );
}
