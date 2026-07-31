import { defineLifecycleScheduledTask } from "../onboarding/trigger-runtime";
import { renewalTaskIds } from ".";

export const renewalTermAlertsTask = defineLifecycleScheduledTask(
  renewalTaskIds.termAlerts,
  "0 8 * * *",
);
export const renewalNoticeWindowsTask = defineLifecycleScheduledTask(
  renewalTaskIds.noticeWindows,
  "15 8 * * *",
);
export const autoRenewEvaluationTask = defineLifecycleScheduledTask(
  renewalTaskIds.autoRenewEvaluation,
  "30 8 * * *",
);
