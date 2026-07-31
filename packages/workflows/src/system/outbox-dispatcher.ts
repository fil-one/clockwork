import { task } from "@trigger.dev/sdk";

import { durableRetryPolicy, WorkflowInvocationSchema } from "../policy";

/**
 * The transport-neutral durable entry point. The lane implementation claims a
 * database outbox row before dispatch and records completion in workflow_runs.
 */
export const outboxDispatcherTask = task({
  id: "system.outbox.dispatch.v1",
  retry: durableRetryPolicy,
  run: async (raw: unknown) => {
    const invocation = WorkflowInvocationSchema.parse(raw);
    await Promise.resolve();
    return {
      accepted: true,
      aggregateId: invocation.aggregateId,
      aggregateVersion: invocation.aggregateVersion,
    };
  },
});
