import { defineScheduledTask } from "../tasks/definition";
import { retrySigningMail } from "./runtime";

export const signingMailRetryTask = defineScheduledTask({
  id: "system.signing-mail.retry.v1",
  cron: "*/5 * * * *",
  stages: ["staging", "production"],
  deliveryTtlMs: 5 * 60_000,
  run: () => retrySigningMail(),
});
