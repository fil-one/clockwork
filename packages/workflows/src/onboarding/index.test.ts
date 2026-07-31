import { describe, expect, it } from "vitest";

import { disposeEffectFailure, effectIdempotencyKey } from "./durable";
import {
  planProcurementReminders,
  planRegistrationScreening,
  planScreeningRefresh,
  restrictedPartyGate,
  waitForProcurementCompletion,
} from "./index";

describe("onboarding durable workflows", () => {
  it("uses stable per-effect keys and blocks restricted parties", () => {
    const effect = planRegistrationScreening({
      accountId: "account-1",
      version: 3,
      legalName: "Acme Ltd",
      country: "GB",
      reason: "registration",
    });
    expect(effect.idempotencyKey).toBe(
      planRegistrationScreening({
        accountId: "account-1",
        version: 3,
        legalName: "Changed payload",
        country: "US",
        reason: "registration",
      }).idempotencyKey,
    );
    expect(restrictedPartyGate("review")).toEqual({
      canTransact: false,
      queueRequired: true,
      reason: "SCREENING_REVIEW",
    });
  });

  it("plans repeatable procurement reminders and one overdue escalation", () => {
    const effects = planProcurementReminders({
      accountId: "account-1",
      version: 2,
      now: "2026-08-03T12:00:00.000Z",
      escalationAfterHours: 24,
      tasks: [
        {
          id: "task-1",
          kind: "buyer_supplier_portal",
          ownerId: "owner-1",
          status: "open",
          dueAt: "2026-08-01T12:00:00.000Z",
          reminderEveryHours: 24,
          lastReminderAt: "2026-08-02T12:00:00.000Z",
        },
      ],
    });
    expect(effects.map((effect) => effect.kind)).toEqual([
      "send_procurement_reminder",
      "escalate_procurement_task",
    ]);
    expect(new Set(effects.map((effect) => effect.idempotencyKey)).size).toBe(
      2,
    );
  });

  it("refreshes stale screening and models a durable human wait", () => {
    expect(
      planScreeningRefresh({
        accountId: "account-1",
        version: 1,
        legalName: "Acme",
        country: "US",
        lastScreenedAt: "2026-01-01T00:00:00.000Z",
        refreshEveryDays: 180,
        now: "2026-07-31T16:00:00.000Z",
      }),
    ).toHaveLength(1);
    const wait = waitForProcurementCompletion({
      accountId: "account-1",
      version: 1,
      expiresAt: "2026-09-01T00:00:00.000Z",
    });
    expect(wait.kind).toBe("human_wait");
    expect(wait.resumeEvents).toContain("procurement.completed");
  });

  it("bounds retries and dead-letters permanent or exhausted failures", () => {
    const identity = {
      aggregateType: "order",
      aggregateId: "order-1",
      aggregateVersion: 1,
      operation: "provision",
    };
    const retry = disposeEffectFailure({
      identity,
      effectDiscriminator: "command",
      attempt: 2,
      failure: { kind: "transient", code: "TIMEOUT", message: "try again" },
      failedAt: "2026-07-31T16:00:00.000Z",
    });
    expect(retry).toMatchObject({
      status: "retry_scheduled",
      nextAttemptAt: "2026-07-31T16:00:02.000Z",
    });
    const dead = disposeEffectFailure({
      identity,
      effectDiscriminator: "command",
      attempt: 1,
      failure: { kind: "permanent", code: "INVALID", message: "bad command" },
      failedAt: "2026-07-31T16:00:00.000Z",
    });
    expect(dead.status).toBe("dead_lettered");
    expect(dead.idempotencyKey).toBe(effectIdempotencyKey(identity, "command"));
  });
});
