import { schedules } from "@trigger.dev/sdk";

import { durableRetryPolicy } from "../policy";
import {
  coreScheduleDefinitions,
  submitCoreScheduleOccurrence,
} from "./scheduled-runtime";

function defineCoreSchedule(
  definition: (typeof coreScheduleDefinitions)[number],
) {
  return schedules.task({
    id: definition.id,
    cron: {
      pattern: definition.cron,
      timezone: "UTC",
      environments: ["STAGING", "PRODUCTION"],
    },
    retry: durableRetryPolicy,
    run: (payload, { ctx }) =>
      submitCoreScheduleOccurrence({
        scheduleId: definition.id,
        scheduledAt: payload.timestamp.toISOString(),
        triggerRunId: ctx.run.id,
      }),
  });
}

export const syncOverageSchedule = defineCoreSchedule(
  coreScheduleDefinitions[0],
);
export const dunningSchedule = defineCoreSchedule(coreScheduleDefinitions[1]);
export const partnerCreditSchedule = defineCoreSchedule(
  coreScheduleDefinitions[2],
);
export const commissionSettlementSchedule = defineCoreSchedule(
  coreScheduleDefinitions[3],
);
export const usageReconciliationSchedule = defineCoreSchedule(
  coreScheduleDefinitions[4],
);
export const threeWayReconciliationSchedule = defineCoreSchedule(
  coreScheduleDefinitions[5],
);
export const weeklyReportExportSchedule = defineCoreSchedule(
  coreScheduleDefinitions[6],
);
export const monthlyReportExportSchedule = defineCoreSchedule(
  coreScheduleDefinitions[7],
);
export const procurementCertificateExpirySchedule = defineCoreSchedule(
  coreScheduleDefinitions[8],
);
