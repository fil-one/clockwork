import { defineLifecycleScheduledTask } from "./trigger-runtime";
import { onboardingTaskIds } from ".";

export const screeningRefreshTask = defineLifecycleScheduledTask(
  onboardingTaskIds.screeningRefresh,
  "0 * * * *",
);
export const procurementRemindersTask = defineLifecycleScheduledTask(
  onboardingTaskIds.procurementReminders,
  "15 * * * *",
);
