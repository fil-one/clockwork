import type { CheckedSelfApproval } from "@clockwork/domain";
import { describe, expect, it } from "vitest";

import {
  decideExceptionCase,
  exceptionQueues,
  openExceptionCase,
  planExceptionEscalation,
  validateQueuePolicies,
  type ExceptionQueuePolicy,
} from "./index";

const policies: readonly ExceptionQueuePolicy[] = exceptionQueues.map(
  (queue) => ({
    queue,
    ownerUserId: `owner-${queue}`,
    backupUserId: `backup-${queue}`,
    escalationUserId: "operations-lead",
    slaHours: queue === "legal" ? 72 : 24,
    separationRequired: true,
  }),
);
const legalPolicy: ExceptionQueuePolicy = {
  queue: "legal",
  ownerUserId: "owner-legal",
  backupUserId: "backup-legal",
  escalationUserId: "operations-lead",
  slaHours: 72,
  slaBusinessDays: 3,
  separationRequired: true,
};
const exceptionCase = {
  caseId: "case-1",
  version: 1,
  queue: "legal" as const,
  objectType: "agreement",
  objectId: "agreement-1",
  requestedBy: "requester-1",
  openedAt: "2026-07-31T16:00:00.000Z",
  status: "open" as const,
};

describe("exception workflows", () => {
  it("requires an owner, distinct backup, SLA, and escalation for every queue", () => {
    expect(validateQueuePolicies(policies).size).toBe(exceptionQueues.length);
    expect(() => validateQueuePolicies(policies.slice(1))).toThrow(
      "QUEUE_POLICIES_MISSING",
    );
    expect(() =>
      validateQueuePolicies(
        policies.map((policy) =>
          policy.queue === "legal"
            ? { ...policy, backupUserId: policy.ownerUserId }
            : policy,
        ),
      ),
    ).toThrow("QUEUE_BACKUP_MUST_BE_DISTINCT:legal");
  });

  it("accepts a two-person staff, the second escalation returning to the owner", () => {
    const staff = {
      ownerUserId: "cfo",
      backupUserId: "revenue-lead",
      escalationUserId: "cfo",
    };
    const twoPerson = policies.map((policy) => ({ ...policy, ...staff }));
    expect(validateQueuePolicies(twoPerson).size).toBe(exceptionQueues.length);
    const legal = { ...legalPolicy, ...staff };
    expect(
      planExceptionEscalation({
        exceptionCase,
        policy: legal,
        now: "2026-08-06T16:00:00.000Z",
        targetAt: "2026-08-05T16:00:00.000Z",
        escalationLevel: 1,
      })?.payload,
    ).toMatchObject({ recipient: "cfo", escalationLevel: 2 });
  });

  it("creates a durable wait and escalates an overdue case to backup", () => {
    const workflow = openExceptionCase({ exceptionCase, policy: legalPolicy });
    expect(workflow.targetAt).toBe("2026-08-05T16:00:00.000Z");
    expect(workflow.wait.kind).toBe("human_wait");
    expect(
      planExceptionEscalation({
        exceptionCase,
        policy: legalPolicy,
        now: "2026-08-05T16:00:00.000Z",
        targetAt: workflow.targetAt,
        escalationLevel: 0,
      })?.payload,
    ).toMatchObject({ recipient: "backup-legal", escalationLevel: 1 });
  });

  it("lets a requester holding approval:self approve their own case with a reason", () => {
    const own = { ...exceptionCase, requestedBy: "owner-legal" };
    const decision = {
      decision: "approved" as const,
      decidedBy: "owner-legal",
      decidedAt: "2026-08-01T16:00:00.000Z",
      reason: "Approved alone while legal is out",
      evidenceDocumentIds: ["document-1"],
      actualActorId: "owner-legal",
      effectiveActorId: "owner-legal",
    };
    const selfApproval = {
      reason: "Approved alone while legal is out",
    } as CheckedSelfApproval;
    expect(
      decideExceptionCase({
        exceptionCase: own,
        policy: legalPolicy,
        decision,
        selfApproval,
      }).payload,
    ).toMatchObject({ selfApproved: true });
    expect(() =>
      decideExceptionCase({
        exceptionCase: own,
        policy: legalPolicy,
        decision,
      }),
    ).toThrow("EXCEPTION_SELF_APPROVAL_FORBIDDEN");
    expect(() =>
      decideExceptionCase({
        exceptionCase: own,
        policy: legalPolicy,
        decision,
        selfApproval: { reason: "short" } as CheckedSelfApproval,
      }),
    ).toThrow("SELF_APPROVAL_REASON_REQUIRED");
    expect(() =>
      decideExceptionCase({
        exceptionCase: own,
        policy: legalPolicy,
        decision: { ...decision, decision: "rejected" },
        selfApproval,
      }),
    ).toThrow("SELF_APPROVAL_APPROVE_ONLY");
  });

  it("forbids self-approval and requires immutable evidence", () => {
    expect(() =>
      decideExceptionCase({
        exceptionCase: { ...exceptionCase, requestedBy: "owner-legal" },
        policy: legalPolicy,
        decision: {
          decision: "approved",
          decidedBy: "owner-legal",
          decidedAt: "2026-08-01T16:00:00.000Z",
          reason: "Approved after review",
          evidenceDocumentIds: ["document-1"],
          actualActorId: "owner-legal",
          effectiveActorId: "owner-legal",
        },
      }),
    ).toThrow("EXCEPTION_SELF_APPROVAL_FORBIDDEN");
    expect(
      decideExceptionCase({
        exceptionCase,
        policy: legalPolicy,
        decision: {
          decision: "rejected",
          decidedBy: "owner-legal",
          decidedAt: "2026-08-01T16:00:00.000Z",
          reason: "Terms are not acceptable",
          evidenceDocumentIds: ["document-1"],
          actualActorId: "owner-legal",
          effectiveActorId: "owner-legal",
        },
      }).payload,
    ).toMatchObject({ immutable: true, decision: "rejected" });
  });
});
