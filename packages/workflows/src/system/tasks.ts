import { schedules } from "@trigger.dev/sdk";

import { durableRetryPolicy } from "../policy";
import { executeConfiguredOutboxDispatcher } from "./outbox-dispatcher";

export const outboxDispatcherTask = schedules.task({
  id: "system.outbox.dispatch.v1",
  cron: {
    pattern: "* * * * *",
    timezone: "UTC",
    environments: ["STAGING", "PRODUCTION"],
  },
  ttl: "1m",
  retry: durableRetryPolicy,
  run: async (_raw: unknown, { ctx }) =>
    executeConfiguredOutboxDispatcher(ctx.run.id),
});
