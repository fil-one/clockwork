import {
  defineLifecycleScheduledTask,
  defineLifecycleTask,
} from "../onboarding/trigger-runtime";
import { pocTaskIds } from ".";

export const pocMilestonesTask = defineLifecycleScheduledTask(
  pocTaskIds.milestones,
  "5 * * * *",
);
export const pocExpiryTask = defineLifecycleScheduledTask(
  pocTaskIds.expiry,
  "10 * * * *",
);
export const pocProposalTask = defineLifecycleScheduledTask(
  pocTaskIds.proposal,
  "20 * * * *",
);
export const pocConversionTask = defineLifecycleTask(pocTaskIds.conversion);
