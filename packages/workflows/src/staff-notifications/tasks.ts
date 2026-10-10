import { defineScheduledTask } from "../tasks/definition";
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
