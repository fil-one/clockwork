import {
  defineLifecycleScheduledTask,
  defineLifecycleTask,
} from "../onboarding/trigger-runtime";
import { offboardingTaskIds } from ".";

export const retrievalWindowTask = defineLifecycleScheduledTask(
  offboardingTaskIds.retrievalWindow,
  "0 * * * *",
);
export const retentionReleaseTask = defineLifecycleScheduledTask(
  offboardingTaskIds.retentionRelease,
  "10 * * * *",
);
export const teardownTask = defineLifecycleTask(offboardingTaskIds.teardown);
export const teardownConfirmationTask = defineLifecycleTask(
  offboardingTaskIds.confirmation,
);
