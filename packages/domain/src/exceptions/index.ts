import { createHash } from "node:crypto";

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

export interface QueuePolicy {
  queue: ExceptionQueue;
  ownerId: string;
  backupId: string;
  targetBusinessHours: number;
  escalationOwnerId: string;
  separationRequired: boolean;
}

export function validateQueuePolicies(
  policies: readonly QueuePolicy[],
): ReadonlyMap<ExceptionQueue, QueuePolicy> {
  const byQueue = new Map(policies.map((policy) => [policy.queue, policy]));
  for (const queue of exceptionQueues) {
    const policy = byQueue.get(queue);
    if (!policy) throw new Error(`QUEUE_POLICY_MISSING:${queue}`);
    if (!policy.ownerId || !policy.backupId || !policy.escalationOwnerId)
      throw new Error(`QUEUE_OWNERSHIP_INCOMPLETE:${queue}`);
    if (policy.ownerId === policy.backupId)
      throw new Error(`QUEUE_BACKUP_NOT_DISTINCT:${queue}`);
    if (
      !Number.isInteger(policy.targetBusinessHours) ||
      policy.targetBusinessHours < 1
    )
      throw new Error(`QUEUE_SLA_INVALID:${queue}`);
  }
  return byQueue;
}

function nextBusinessHour(instant: Date): Date {
  const next = new Date(instant.getTime() + 3_600_000);
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6)
    next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function addBusinessHours(start: string, hours: number): string {
  let cursor = new Date(start);
  for (let index = 0; index < hours; index += 1)
    cursor = nextBusinessHour(cursor);
  return cursor.toISOString();
}

export interface ExceptionCase {
  caseId: string;
  queue: ExceptionQueue;
  objectType: string;
  objectId: string;
  requestedBy: string;
  ownerId: string;
  backupId: string;
  escalationOwnerId: string;
  openedAt: string;
  targetAt: string;
  status: "open" | "approved" | "rejected" | "closed";
  separationRequired: boolean;
  escalationLevel: number;
  decisions: readonly ExceptionDecision[];
}

export interface ExceptionDecision {
  decisionId: string;
  actorId: string;
  outcome: "approved" | "rejected";
  reason: string;
  evidenceDocumentId: string;
  evidenceHash: string;
  decidedAt: string;
}

export function openExceptionCase(input: {
  caseId: string;
  queue: ExceptionQueue;
  objectType: string;
  objectId: string;
  requestedBy: string;
  openedAt: string;
  policies: ReadonlyMap<ExceptionQueue, QueuePolicy>;
}): ExceptionCase {
  const policy = input.policies.get(input.queue);
  if (!policy) throw new Error(`QUEUE_POLICY_MISSING:${input.queue}`);
  return {
    caseId: input.caseId,
    queue: input.queue,
    objectType: input.objectType,
    objectId: input.objectId,
    requestedBy: input.requestedBy,
    ownerId: policy.ownerId,
    backupId: policy.backupId,
    escalationOwnerId: policy.escalationOwnerId,
    openedAt: input.openedAt,
    targetAt: addBusinessHours(input.openedAt, policy.targetBusinessHours),
    status: "open",
    separationRequired: policy.separationRequired,
    escalationLevel: 0,
    decisions: [],
  };
}

export function decideException(
  exceptionCase: ExceptionCase,
  input: Omit<ExceptionDecision, "decisionId" | "evidenceHash"> & {
    evidenceBytes: Uint8Array;
  },
): ExceptionCase {
  if (exceptionCase.status !== "open")
    throw new Error("EXCEPTION_ALREADY_DECIDED");
  if (
    exceptionCase.separationRequired &&
    input.actorId === exceptionCase.requestedBy
  )
    throw new Error("EXCEPTION_SELF_APPROVAL_FORBIDDEN");
  if (
    ![
      exceptionCase.ownerId,
      exceptionCase.backupId,
      exceptionCase.escalationOwnerId,
    ].includes(input.actorId)
  )
    throw new Error("EXCEPTION_DECIDER_NOT_AUTHORIZED");
  if (input.reason.trim().length < 8)
    throw new Error("DECISION_REASON_REQUIRED");
  if (!input.evidenceDocumentId || input.evidenceBytes.byteLength === 0)
    throw new Error("DECISION_EVIDENCE_REQUIRED");
  const evidenceHash = createHash("sha256")
    .update(input.evidenceBytes)
    .digest("hex");
  const decisionId = createHash("sha256")
    .update(
      `${exceptionCase.caseId}:${input.actorId}:${input.decidedAt}:${input.outcome}`,
    )
    .digest("hex");
  const decision: ExceptionDecision = {
    decisionId,
    actorId: input.actorId,
    outcome: input.outcome,
    reason: input.reason.trim(),
    evidenceDocumentId: input.evidenceDocumentId,
    evidenceHash,
    decidedAt: input.decidedAt,
  };
  return {
    ...exceptionCase,
    status: input.outcome,
    decisions: [...exceptionCase.decisions, Object.freeze(decision)],
  };
}

export function escalateException(
  exceptionCase: ExceptionCase,
  now: string,
): ExceptionCase {
  if (exceptionCase.status !== "open") return exceptionCase;
  if (Date.parse(now) < Date.parse(exceptionCase.targetAt))
    return exceptionCase;
  return {
    ...exceptionCase,
    ownerId:
      exceptionCase.escalationLevel === 0
        ? exceptionCase.backupId
        : exceptionCase.escalationOwnerId,
    escalationLevel: exceptionCase.escalationLevel + 1,
    targetAt: addBusinessHours(now, 4),
  };
}
