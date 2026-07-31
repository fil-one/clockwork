import { describe, expect, it } from "vitest";

import {
  decideException,
  exceptionQueues,
  openExceptionCase,
  validateQueuePolicies,
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
    expect(policies.size).toBe(7);
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
