import { idempotencyKeys, tasks } from "@trigger.dev/sdk";

import type {
  TaskSubmission,
  TaskSubmissionReceipt,
  TaskSubmitter,
} from "./submitter";

/**
 * Submission through Trigger.dev Cloud, which owns the durable queue, the
 * retry schedule and the deduplication window. The key is registered globally
 * rather than per run so a second submission of the same logical invocation --
 * an outbox redelivery, an operator redrive -- joins the first run instead of
 * opening a second.
 */
export class TriggerTaskSubmitter implements TaskSubmitter {
  public async submit(input: TaskSubmission): Promise<TaskSubmissionReceipt> {
    const idempotencyKey = await idempotencyKeys.create(input.idempotencyKey, {
      scope: "global",
    });
    const run = await tasks.trigger(input.taskId, input.payload, {
      idempotencyKey,
    });
    return { runId: run.id };
  }
}
