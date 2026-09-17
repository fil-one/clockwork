import { defineScheduledTask } from "../tasks/definition";
import { runPaygBillingSweep } from "./payg-scheduled-runtime";

export const paygBillingCloseSchedule = defineScheduledTask({
  id: "core.schedule.payg-close.v1",
  cron: "0 3 * * *",
  stages: ["staging", "production"],
  run: (payload) => runPaygBillingSweep(payload.scheduledAt),
});
