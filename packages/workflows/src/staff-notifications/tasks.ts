import { defineScheduledTask } from "../tasks/definition";
import { runConfiguredPartnerNextStepReminders } from "./partner-reminders";
import { runConfiguredStaffNotificationRetry } from "./retry-runtime";

/**
 * Every five minutes: sends again the notification emails and Slack posts a
 * provider could not take. A delivery that waited out its interval has been
 * superseded by the next tick, so it is dropped unrun.
 */
export const staffNotificationRetryTask = defineScheduledTask({
  id: "system.staff-notifications.retry.v1",
  cron: "*/5 * * * *",
  stages: ["staging", "production"],
  deliveryTtlMs: 5 * 60_000,
  run: (payload) => runConfiguredStaffNotificationRetry(payload.scheduledAt),
});

/**
 * Daily at 13:00 UTC (09:00 in New York): reminds each partner's owner of a
 * next step due today or overdue, once per due date.
 */
export const partnerNextStepReminderTask = defineScheduledTask({
  id: "system.partner-next-steps.remind.v1",
  cron: "0 13 * * *",
  stages: ["staging", "production"],
  run: (payload) => runConfiguredPartnerNextStepReminders(payload.scheduledAt),
});
