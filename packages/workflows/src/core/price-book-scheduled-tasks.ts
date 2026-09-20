import { defineScheduledTask } from "../tasks/definition";
import { runPriceBookScheduleOccurrence } from "./price-book-scheduled-runtime";

export const priceBookActivationSchedule = defineScheduledTask({
  id: "core.schedule.price-book-activation.v1",
  cron: "* * * * *",
  stages: ["staging", "production"],
  run: (payload) => runPriceBookScheduleOccurrence(payload.scheduledAt),
});
