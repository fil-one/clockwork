import { schedules } from "@trigger.dev/sdk";
import { durableRetryPolicy } from "../policy";
import { runPriceBookScheduleOccurrence } from "./price-book-scheduled-runtime";

export const priceBookActivationSchedule = schedules.task({
  id: "core.schedule.price-book-activation.v1",
  cron: {
    pattern: "* * * * *",
    timezone: "UTC",
    environments: ["STAGING", "PRODUCTION"],
  },
  retry: durableRetryPolicy,
  run: (payload) =>
    runPriceBookScheduleOccurrence(payload.timestamp.toISOString()),
});
