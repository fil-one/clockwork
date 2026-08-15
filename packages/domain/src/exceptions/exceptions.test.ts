import { describe, expect, it } from "vitest";

import {
  assertExceptionRoutingQueue,
  decideException,
  exceptionQueues,
  openExceptionCase,
  resolveExceptionOwners,
  validateQueuePolicies,
  type ExceptionRosterMember,
} from ".";

const policies = validateQueuePolicies(
  exceptionQueues.map((queue, index) => ({
    queue,
    ownerId: `owner-${index}`,
    backupId: `backup-${index}`,
    escalationOwnerId: `escalation-${index}`,
    targetBusinessHours: queue === "legal" ? 24 : 8,
    separationRequired: true,
  })),
);

describe("exception queues", () => {
  it("requires owner, distinct backup, SLA, and escalation for every queue", () => {
    expect(policies.size).toBe(exceptionQueues.length);
    expect(() =>
      validateQueuePolicies(
        exceptionQueues.slice(1).map((queue, index) => ({
          queue,
          ownerId: `owner-${index}`,
          backupId: `backup-${index}`,
          escalationOwnerId: `escalation-${index}`,
          targetBusinessHours: 8,
          separationRequired: true,
        })),
      ),
    ).toThrow("QUEUE_POLICY_MISSING:pricing");
  });

  it("opens a case on the §16 queues no declaration in the tree could name", () => {
    // Provisioning recovery, migration review and offboarding/destructive are
    // rows in §16 that every one of the four declarations omitted (P0-43), so
    // there was no policy for them and a case could not be opened at all.
    for (const queue of [
      "provisioning_recovery",
      "migration_review",
      "offboarding_destructive",
    ] as const) {
      const opened = openExceptionCase({
        caseId: `case-${queue}`,
        queue,
        objectType: "order",
        objectId: "order-1",
        requestedBy: "requester-1",
        openedAt: "2026-07-31T16:00:00.000Z",
        policies,
      });
      expect(opened).toMatchObject({ queue, status: "open" });
      expect(opened.ownerId).not.toBe(opened.backupId);
      expect(Date.parse(opened.targetAt)).toBeGreaterThan(
        Date.parse(opened.openedAt),
      );
    }
  });

  it("refuses to route a shape-valid queue that is not in the vocabulary", () => {
    // `provider_recovery` is what a live packages/api fixture calls §16's
    // provisioning recovery. It satisfies the identifier shape, so the routing
    // guard used to pass it through to a roster lookup that could never match.
    expect(() => assertExceptionRoutingQueue("provider_recovery")).toThrow(
      "EXCEPTION_ROUTING_QUEUE_UNKNOWN:provider_recovery",
    );
    expect(() => assertExceptionRoutingQueue("Not A Queue")).toThrow(
      "EXCEPTION_ROUTING_QUEUE_INVALID",
    );
    expect(assertExceptionRoutingQueue("provisioning_recovery")).toBe(
      "provisioning_recovery",
    );
  });

  it("prevents self approval and captures immutable decision evidence", () => {
    const exceptionCase = openExceptionCase({
      caseId: "case-1",
      queue: "pricing",
      objectType: "quote",
      objectId: "quote-1",
      requestedBy: "requester-1",
      openedAt: "2026-07-31T16:00:00.000Z",
      policies,
    });
    expect(() =>
      decideException(exceptionCase, {
        actorId: "requester-1",
        outcome: "approved",
        reason: "Margin impact accepted",
        evidenceDocumentId: "evidence-1",
        evidenceBytes: new TextEncoder().encode("approval record"),
        decidedAt: "2026-07-31T17:00:00.000Z",
      }),
    ).toThrow("EXCEPTION_SELF_APPROVAL_FORBIDDEN");
    const decided = decideException(exceptionCase, {
      actorId: "owner-0",
      outcome: "approved",
      reason: "Margin impact accepted",
      evidenceDocumentId: "evidence-1",
      evidenceBytes: new TextEncoder().encode("approval record"),
      decidedAt: "2026-07-31T17:00:00.000Z",
    });
    expect(decided.status).toBe("approved");
    expect(decided.decisions[0]?.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("persisted exception roster resolution", () => {
  const now = new Date("2026-07-31T16:00:00.000Z");
  const member = (
    role: ExceptionRosterMember["role"],
    userId: string,
    priority: number,
  ): ExceptionRosterMember => ({
    rosterEntryId: `roster-${userId}`,
    accountId: "account-1",
    queue: "legal",
    userId,
    role,
    active: true,
    internalStaff: true,
    mfaEnrolled: true,
    qualificationEvidenceReference: `evidence://approver/${userId}`,
    qualifiedUntil: "2027-07-31T16:00:00.000Z",
    absentFrom: null,
    absentUntil: null,
    targetMinutes: 240,
    priority,
  });

  it("chooses deterministic qualified primary, backup, and escalation owners", () => {
    expect(
      resolveExceptionOwners({
        accountId: "account-1",
        queue: "legal",
        now,
        roster: [
          member("backup", "backup-1", 10),
          member("escalation", "escalation-1", 10),
          member("primary", "primary-1", 10),
        ],
      }),
    ).toMatchObject({
      ownerUserId: "primary-1",
      backupUserId: "backup-1",
      escalationUserId: "escalation-1",
      absenceEscalated: false,
    });
  });

  it("escalates absence and fails closed when distinct eligible people are unavailable", () => {
    const absentPrimary = {
      ...member("primary", "primary-1", 10),
      absentFrom: "2026-07-31T15:00:00.000Z",
      absentUntil: "2026-08-01T15:00:00.000Z",
    };
    expect(
      resolveExceptionOwners({
        accountId: "account-1",
        queue: "legal",
        now,
        roster: [
          absentPrimary,
          member("backup", "backup-1", 10),
          member("escalation", "escalation-1", 10),
          member("escalation", "escalation-2", 20),
        ],
      }),
    ).toMatchObject({
      ownerUserId: "backup-1",
      backupUserId: "escalation-1",
      escalationUserId: "escalation-2",
      absenceEscalated: true,
    });
    expect(() =>
      resolveExceptionOwners({
        accountId: "account-1",
        queue: "legal",
        now,
        excludedUserIds: ["primary-1"],
        roster: [
          member("primary", "primary-1", 10),
          member("backup", "backup-1", 10),
        ],
      }),
    ).toThrow("EXCEPTION_NO_ELIGIBLE_PRIMARY:legal");
  });
});
