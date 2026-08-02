import { defineLifecycleScheduledTask } from "../onboarding/trigger-runtime";
import { quoteTaskIds } from ".";

export const quoteExpiryAlertsTask = defineLifecycleScheduledTask(
  quoteTaskIds.expiryAlerts,
  "45 * * * *",
);
