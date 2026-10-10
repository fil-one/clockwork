import { defineScheduledTask } from "../tasks/definition";
import { runESignReconciliation } from "./reconciliation";

/**
 * Every 15 minutes. While one run covers every open request, a missed webhook
 * is corrected within about 25 minutes: the 10-minute freshness window plus
 * one interval. A run reads at most 50 requests per register, one at a time,
 * in rotation, and stops at a SignWell 429. A delivery that waited out its
 * interval has been superseded by the next tick, so it is dropped unrun.
 */
export const eSignReconciliationTask = defineScheduledTask({
  id: "system.esign.reconcile.v1",
  cron: "*/15 * * * *",
  stages: ["staging", "production"],
  deliveryTtlMs: 15 * 60_000,
  run: (payload) => runESignReconciliation(payload.scheduledAt),
});
