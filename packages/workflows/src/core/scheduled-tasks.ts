import { schedules } from "@trigger.dev/sdk";

import { durableRetryPolicy } from "../policy";
import {
  coreScheduleDefinitions,
  submitCoreScheduleOccurrence,
} from "./scheduled-runtime";

type CoreScheduleDefinitionId = (typeof coreScheduleDefinitions)[number]["id"];

/**
 * Bound by name, not by array position. The exports below used to index
 * `coreScheduleDefinitions`, so inserting or reordering a definition silently
 * moved every cron after it onto the wrong task id -- a rebinding no type and
 * no test could see.
 */
function defineCoreSchedule(id: CoreScheduleDefinitionId) {
  const definition = coreScheduleDefinitions.find((entry) => entry.id === id);
  if (!definition) throw new Error(`CORE_SCHEDULE_NOT_DEFINED:${id}`);
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
  "core.schedule.sync-overage.v1",
);
export const dunningSchedule = defineCoreSchedule("core.schedule.dunning.v1");
export const partnerCreditSchedule = defineCoreSchedule(
  "core.schedule.partner-credit.v1",
);
export const commissionSettlementSchedule = defineCoreSchedule(
  "core.schedule.commission-settlement.v1",
);
export const usageReconciliationSchedule = defineCoreSchedule(
  "core.schedule.usage-reconciliation.v1",
);
export const threeWayReconciliationSchedule = defineCoreSchedule(
  "core.schedule.three-way-reconciliation.v1",
);
export const weeklyReportExportSchedule = defineCoreSchedule(
  "core.schedule.report-export-weekly.v1",
);
export const monthlyReportExportSchedule = defineCoreSchedule(
  "core.schedule.report-export-monthly.v1",
);
export const procurementCertificateExpirySchedule = defineCoreSchedule(
  "core.schedule.procurement-certificate-expiry.v1",
);
