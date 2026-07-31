import {
  defineLifecycleScheduledTask,
  defineLifecycleTask,
} from "../onboarding/trigger-runtime";
import { exceptionTaskIds } from ".";

export const exceptionEscalationTask = defineLifecycleScheduledTask(
  exceptionTaskIds.escalation,
  "*/15 * * * *",
);
export const exceptionHumanDecisionTask = defineLifecycleTask(
  exceptionTaskIds.humanDecision,
);
