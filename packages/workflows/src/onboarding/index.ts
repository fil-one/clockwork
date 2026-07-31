import {
  durableHumanWait,
  type DurableHumanWait,
  workflowEffect,
  type WorkflowEffect,
  type WorkflowIdentity,
} from "./durable";

export const onboardingTaskIds = Object.freeze({
  screeningRefresh: "lifecycle-onboarding-screening-refresh-v1",
  procurementReminders: "lifecycle-onboarding-procurement-reminders-v1",
});

export interface ProcurementTaskState {
  id: string;
  kind:
    | "collect_ap_contact"
    | "configure_invoice_delivery"
    | "collect_exemption_certificate"
    | "furnish_supplier_document"
    | "buyer_supplier_portal";
  ownerId: string;
  status: "open" | "blocked" | "complete";
  dueAt: string;
  reminderEveryHours: number;
  lastReminderAt: string | null;
}

export type OnboardingEffect = WorkflowEffect<
  "screen_account" | "send_procurement_reminder" | "escalate_procurement_task",
  Readonly<Record<string, unknown>>
>;

export function planRegistrationScreening(input: {
  accountId: string;
  version: number;
  legalName: string;
  country: string;
  reason: "registration" | "pre_signature" | "partner_activation" | "refresh";
}): OnboardingEffect {
  const identity: WorkflowIdentity = {
    aggregateType: "account",
    aggregateId: input.accountId,
    aggregateVersion: input.version,
    operation: "restricted-party-screening",
  };
  return workflowEffect(identity, input.reason, "screen_account", {
    accountId: input.accountId,
    legalName: input.legalName,
    country: input.country,
    reason: input.reason,
  });
}

/** A clear decision is required; review and blocked decisions stop transactions. */
export function restrictedPartyGate(
  decision: "pending" | "clear" | "review" | "blocked" | "stale",
): { canTransact: boolean; queueRequired: boolean; reason: string } {
  if (decision === "clear")
    return { canTransact: true, queueRequired: false, reason: "CLEAR" };
  return {
    canTransact: false,
    queueRequired: decision === "review" || decision === "blocked",
    reason:
      decision === "stale"
        ? "SCREENING_REFRESH_REQUIRED"
        : `SCREENING_${decision.toUpperCase()}`,
  };
}

export function planScreeningRefresh(input: {
  accountId: string;
  version: number;
  legalName: string;
  country: string;
  lastScreenedAt: string;
  refreshEveryDays: number;
  now: string;
}): readonly OnboardingEffect[] {
  if (!Number.isInteger(input.refreshEveryDays) || input.refreshEveryDays < 1)
    throw new Error("SCREENING_REFRESH_INTERVAL_INVALID");
  const dueAt =
    Date.parse(input.lastScreenedAt) + input.refreshEveryDays * 86_400_000;
  if (Date.parse(input.now) < dueAt) return [];
  return [planRegistrationScreening({ ...input, reason: "refresh" })];
}

export function planProcurementReminders(input: {
  accountId: string;
  version: number;
  tasks: readonly ProcurementTaskState[];
  now: string;
  escalationAfterHours: number;
}): readonly OnboardingEffect[] {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error("NOW_INVALID");
  return input.tasks.flatMap((task) => {
    if (task.status === "complete") return [];
    if (!task.ownerId.trim())
      throw new Error("PROCUREMENT_TASK_OWNER_REQUIRED");
    if (
      !Number.isInteger(task.reminderEveryHours) ||
      task.reminderEveryHours < 1
    )
      throw new Error("PROCUREMENT_REMINDER_INTERVAL_INVALID");
    const dueMs = Date.parse(task.dueAt);
    const reminderBaseline = task.lastReminderAt
      ? Date.parse(task.lastReminderAt)
      : dueMs - task.reminderEveryHours * 3_600_000;
    const effects: OnboardingEffect[] = [];
    const identity: WorkflowIdentity = {
      aggregateType: "procurement_task",
      aggregateId: task.id,
      aggregateVersion: input.version,
      operation: "procurement-follow-up",
    };
    if (nowMs >= reminderBaseline + task.reminderEveryHours * 3_600_000) {
      const interval = Math.floor(
        (nowMs - dueMs) / (task.reminderEveryHours * 3_600_000),
      );
      effects.push(
        workflowEffect(
          identity,
          `reminder:${Math.max(0, interval)}`,
          "send_procurement_reminder",
          {
            accountId: input.accountId,
            taskId: task.id,
            ownerId: task.ownerId,
            taskKind: task.kind,
          },
        ),
      );
    }
    if (nowMs >= dueMs + input.escalationAfterHours * 3_600_000) {
      effects.push(
        workflowEffect(
          identity,
          "overdue-escalation",
          "escalate_procurement_task",
          {
            accountId: input.accountId,
            taskId: task.id,
            ownerId: task.ownerId,
            dueAt: task.dueAt,
          },
        ),
      );
    }
    return effects;
  });
}

export function waitForProcurementCompletion(input: {
  accountId: string;
  version: number;
  expiresAt: string;
}): DurableHumanWait {
  return durableHumanWait({
    identity: {
      aggregateType: "account",
      aggregateId: input.accountId,
      aggregateVersion: input.version,
      operation: "procurement-onboarding",
    },
    discriminator: "completion",
    subjectType: "account",
    subjectId: input.accountId,
    resumeEvents: [
      "procurement.completed",
      "procurement.waived",
      "onboarding.cancelled",
    ],
    expiresAt: input.expiresAt,
  });
}
