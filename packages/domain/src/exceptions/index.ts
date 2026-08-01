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

export function assertExceptionRoutingQueue(value: string): string {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(value))
    throw new Error("EXCEPTION_ROUTING_QUEUE_INVALID");
  return value;
}

export interface QueuePolicy {
  queue: ExceptionQueue;
  ownerId: string;
  backupId: string;
  targetBusinessHours: number;
  escalationOwnerId: string;
  separationRequired: boolean;
}

export const exceptionRosterRoles = [
  "primary",
  "backup",
  "escalation",
] as const;
export type ExceptionRosterRole = (typeof exceptionRosterRoles)[number];

export interface ExceptionRosterMember {
  rosterEntryId: string;
  accountId: string;
  queue: string;
  userId: string;
  role: ExceptionRosterRole;
  active: boolean;
  internalStaff: boolean;
  mfaEnrolled: boolean;
  qualificationEvidenceReference: string;
  qualifiedUntil: string;
  absentFrom: string | null;
  absentUntil: string | null;
  targetMinutes: number;
  priority: number;
}

export interface ResolvedExceptionOwners {
  accountId: string;
  queue: string;
  ownerUserId: string;
  backupUserId: string;
  escalationUserId: string;
  targetMinutes: number;
  absenceEscalated: boolean;
  rosterEntryIds: readonly string[];
}

function rosterMemberIsQualified(
  member: ExceptionRosterMember,
  now: Date,
  excludedUserIds: ReadonlySet<string>,
): boolean {
  if (
    !member.active ||
    !member.internalStaff ||
    !member.mfaEnrolled ||
    !member.qualificationEvidenceReference.trim() ||
    excludedUserIds.has(member.userId)
  )
    return false;
  const qualifiedUntil = Date.parse(member.qualifiedUntil);
  if (!Number.isFinite(qualifiedUntil) || qualifiedUntil < now.getTime())
    return false;
  if (!member.absentFrom && !member.absentUntil) return true;
  if (!member.absentFrom || !member.absentUntil) return false;
  const absentFrom = Date.parse(member.absentFrom);
  const absentUntil = Date.parse(member.absentUntil);
  return (
    Number.isFinite(absentFrom) &&
    Number.isFinite(absentUntil) &&
    absentFrom < absentUntil
  );
}

function rosterMemberIsPresent(
  member: ExceptionRosterMember,
  now: Date,
): boolean {
  if (!member.absentFrom || !member.absentUntil) return true;
  return (
    now.getTime() < Date.parse(member.absentFrom) ||
    now.getTime() >= Date.parse(member.absentUntil)
  );
}

function ranked(
  members: readonly ExceptionRosterMember[],
): readonly ExceptionRosterMember[] {
  return [...members].sort(
    (left, right) =>
      left.priority - right.priority || left.userId.localeCompare(right.userId),
  );
}

/**
 * Resolves only account-scoped, persisted, currently qualified people. A
 * primary absence promotes a qualified backup and retains a distinct
 * escalation owner. Missing authority always fails closed.
 */
export function resolveExceptionOwners(input: {
  accountId: string;
  queue: string;
  roster: readonly ExceptionRosterMember[];
  now: Date;
  excludedUserIds?: readonly string[];
}): ResolvedExceptionOwners {
  assertExceptionRoutingQueue(input.queue);
  const scoped = input.roster.filter(
    (entry) =>
      entry.accountId === input.accountId && entry.queue === input.queue,
  );
  const excluded = new Set(input.excludedUserIds ?? []);
  const qualified = ranked(
    scoped.filter((entry) =>
      rosterMemberIsQualified(entry, input.now, excluded),
    ),
  );
  const eligible = qualified.filter((entry) =>
    rosterMemberIsPresent(entry, input.now),
  );
  const primaries = eligible.filter((entry) => entry.role === "primary");
  const backups = eligible.filter((entry) => entry.role === "backup");
  const escalations = eligible.filter((entry) => entry.role === "escalation");
  const qualifiedPrimaryExists = qualified.some(
    (entry) => entry.role === "primary",
  );
  const primary = primaries[0];
  const promotedBackup = backups[0];
  const owner = primary ?? promotedBackup;
  const backup = primary
    ? backups.find((entry) => entry.userId !== primary.userId)
    : escalations.find((entry) => entry.userId !== owner?.userId);
  const escalation = escalations.find(
    (entry) =>
      entry.userId !== owner?.userId && entry.userId !== backup?.userId,
  );
  if (!qualifiedPrimaryExists)
    throw new Error(`EXCEPTION_NO_ELIGIBLE_PRIMARY:${input.queue}`);
  if (!owner) throw new Error(`EXCEPTION_NO_ELIGIBLE_OWNER:${input.queue}`);
  if (!backup) throw new Error(`EXCEPTION_NO_ELIGIBLE_BACKUP:${input.queue}`);
  if (!escalation)
    throw new Error(`EXCEPTION_NO_ELIGIBLE_ESCALATION:${input.queue}`);
  const userIds = new Set([owner.userId, backup.userId, escalation.userId]);
  if (userIds.size !== 3)
    throw new Error(`EXCEPTION_SEPARATION_OF_DUTIES_FAILED:${input.queue}`);
  if (
    !Number.isSafeInteger(owner.targetMinutes) ||
    owner.targetMinutes < 1 ||
    owner.targetMinutes > 43_200
  )
    throw new Error(`EXCEPTION_TARGET_INVALID:${input.queue}`);
  return {
    accountId: input.accountId,
    queue: input.queue,
    ownerUserId: owner.userId,
    backupUserId: backup.userId,
    escalationUserId: escalation.userId,
    targetMinutes: owner.targetMinutes,
    absenceEscalated: !primary,
    rosterEntryIds: [
      owner.rosterEntryId,
      backup.rosterEntryId,
      escalation.rosterEntryId,
    ],
  };
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
