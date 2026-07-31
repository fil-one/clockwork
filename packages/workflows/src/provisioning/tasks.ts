import {
  defineLifecycleScheduledTask,
  defineLifecycleTask,
} from "../onboarding/trigger-runtime";
import { provisioningTaskIds } from ".";

export const provisioningCommandDispatchTask = defineLifecycleTask(
  provisioningTaskIds.commandDispatch,
);
export const provisioningConfirmationIngestionTask = defineLifecycleTask(
  provisioningTaskIds.confirmationIngestion,
);
export const stuckProvisioningRecoveryTask = defineLifecycleScheduledTask(
  provisioningTaskIds.stuckRecovery,
  "*/15 * * * *",
);
