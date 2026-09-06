import { schedules } from "@trigger.dev/sdk";
import { durableRetryPolicy } from "../policy";
import { runPaygBillingSweep } from "./payg-scheduled-runtime";

export const paygBillingCloseSchedule = schedules.task({
  id: "core.schedule.payg-close.v1",
  cron: {
    pattern: "0 3 * * *",
    timezone: "UTC",
    environments: ["STAGING", "PRODUCTION"],
  },
  retry: durableRetryPolicy,
  run: (payload) => runPaygBillingSweep(payload.timestamp.toISOString()),
});
