export * from "../agreements";
export * from "../exceptions";
export * from "../migrations";
export * from "../offboarding";
export * from "../onboarding";
export * from "../onboarding/trigger-runtime";
export * from "../pocs";
export * from "../provisioning";
export * from "../renewals";

import { agreementTaskIds } from "../agreements";
import { exceptionTaskIds } from "../exceptions";
import { migrationTaskIds } from "../migrations";
import { offboardingTaskIds } from "../offboarding";
import { onboardingTaskIds } from "../onboarding";
import { pocTaskIds } from "../pocs";
import { provisioningTaskIds } from "../provisioning";
import { renewalTaskIds } from "../renewals";

/** Lifecycle-platform task IDs are versioned and must never be reused. */
export const lifecycleWorkflowRegistry = [
  ...Object.values(onboardingTaskIds),
  ...Object.values(agreementTaskIds),
  ...Object.values(provisioningTaskIds),
  ...Object.values(pocTaskIds),
  ...Object.values(renewalTaskIds),
  ...Object.values(offboardingTaskIds),
  ...Object.values(exceptionTaskIds),
  ...Object.values(migrationTaskIds),
] as const;
