import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { z } from "zod";

import type { LifecycleTaskInvocation } from "../onboarding/trigger-runtime";
import type { OutboxTopicHandler } from "./outbox-dispatcher";

const EventEnvelopeSchema = z.object({
  eventType: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  aggregateVersion: z.number().int().positive(),
  data: z.record(z.string(), z.unknown()),
});

/** Only domain events with an immediate task have outbox dispatch mappings. */
export const lifecycleOutboxTaskMap = Object.freeze({
  "order.provisioning_requested": "lifecycle-provisioning-command-dispatch-v1",
  "order.provisioning_confirmed":
    "lifecycle-provisioning-confirmation-ingestion-v1",
  "agreement.envelope_created": "lifecycle-agreements-envelope-dispatch-v1",
  "agreement.envelope_completed": "lifecycle-agreements-evidence-ingestion-v1",
  "poc.converted": "lifecycle-pocs-conversion-v1",
  "termination.approved": "lifecycle-offboarding-teardown-v1",
  "termination.teardown_confirmed": "lifecycle-offboarding-confirmation-v1",
  "exception_case.decided": "lifecycle-exceptions-human-decision-v1",
  "migration.started": "lifecycle-migrations-discovery-v1",
  "migration.review_required": "lifecycle-migrations-review-wait-v1",
});

export interface LifecycleTaskSubmissionPort {
  submit(invocation: LifecycleTaskInvocation): Promise<unknown>;
}

/**
 * The worker rebuilds its own invocation from the bytes it is handed, so a
 * submitted key only survives the queue hop inside the payload -- which is
 * what `taskInvocation` reads it back out of. Carrying it keeps
 * `outbox:<messageId>` as the workflow-run identity, the identity the
 * dead-letter redrive re-enters on and the runbooks quote.
 */
function payloadCarryingInvocationKey(
  invocation: LifecycleTaskInvocation,
): unknown {
  const { payload } = invocation;
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return payload;
  return { ...payload, idempotencyKey: invocation.idempotencyKey };
}

/**
 * Production submission boundary for the ten event-driven lifecycle tasks.
 *
 * Executing the effect in the caller instead would run it inside whichever
 * process drained the outbox: the one-minute `system.outbox.dispatch.v1` cron
 * with a one-minute TTL, draining a hundred messages per run. That makes
 * LIFECYCLE_RETRY_POLICY and each task's queue and concurrency inert, lets one
 * slow provisioning call starve every message behind it, and collapses a
 * hundred effects into a single provider run the runbooks cannot search.
 */
export class TriggerLifecycleTaskSubmitter implements LifecycleTaskSubmissionPort {
  public async submit(invocation: LifecycleTaskInvocation): Promise<unknown> {
    const idempotencyKey = await idempotencyKeys.create(
      invocation.idempotencyKey,
      { scope: "global" },
    );
    return tasks.trigger(
      invocation.taskId,
      payloadCarryingInvocationKey(invocation),
      { idempotencyKey },
    );
  }
}

/**
 * The submission port is required rather than defaulted: a default that ran the
 * effect in-process is indistinguishable at the call site from one that queues
 * it, and production picked up the in-process default for ten tasks.
 */
export function createLifecycleTaskOutboxHandlers(
  submission: LifecycleTaskSubmissionPort,
): ReadonlyMap<string, OutboxTopicHandler> {
  return new Map(
    Object.entries(lifecycleOutboxTaskMap).map(([topic, taskId]) => [
      topic,
      async (delivery) => {
        const event = EventEnvelopeSchema.parse(delivery.payload);
        if (event.eventType !== topic)
          throw new Error("LIFECYCLE_OUTBOX_TOPIC_EVENT_MISMATCH");
        await submission.submit({
          taskId,
          // Superseded by the durable run's own id once the queue accepts the
          // effect; it survives only for a submitter that runs in-process.
          triggerRunId: `outbox:${delivery.messageId}`,
          attempt: 1,
          idempotencyKey: delivery.idempotencyKey,
          payload: event,
        });
      },
    ]),
  );
}
