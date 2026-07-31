import {
  defineLifecycleScheduledTask,
  defineLifecycleTask,
} from "../onboarding/trigger-runtime";
import { agreementTaskIds } from ".";

export const envelopeDispatchTask = defineLifecycleTask(
  agreementTaskIds.envelopeDispatch,
);
export const signatureReminderTask = defineLifecycleScheduledTask(
  agreementTaskIds.signatureReminder,
  "30 * * * *",
);
export const agreementEvidenceIngestionTask = defineLifecycleTask(
  agreementTaskIds.evidenceIngestion,
);
