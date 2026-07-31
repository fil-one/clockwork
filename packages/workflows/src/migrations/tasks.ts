import {
  defineLifecycleScheduledTask,
  defineLifecycleTask,
} from "../onboarding/trigger-runtime";
import { migrationTaskIds } from ".";

export const migrationDiscoveryTask = defineLifecycleTask(
  migrationTaskIds.discovery,
);
export const migrationScheduledBatchTask = defineLifecycleScheduledTask(
  migrationTaskIds.scheduledBatch,
  "0 2 * * *",
);
export const migrationReviewWaitTask = defineLifecycleTask(
  migrationTaskIds.reviewWait,
);
