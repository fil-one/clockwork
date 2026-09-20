import { defineScheduledTask } from "../tasks/definition";
import { executeConfiguredOutboxDispatcher } from "./outbox-dispatcher";

/**
 * The dispatcher runs every minute and drains whatever is pending, so a
 * delivery that waited out its minute has already been superseded by the next
 * tick; dropping it unrun is cheaper than running a redundant sweep.
 */
export const outboxDispatcherTask = defineScheduledTask({
  id: "system.outbox.dispatch.v1",
  cron: "* * * * *",
  stages: ["staging", "production"],
  deliveryTtlMs: 60_000,
  run: (_payload, ctx) => executeConfiguredOutboxDispatcher(ctx.runId),
});
