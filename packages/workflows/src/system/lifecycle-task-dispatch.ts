import { z } from "zod";

import { executeLifecycleTask } from "../onboarding/trigger-runtime";
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

export function createLifecycleTaskOutboxHandlers(
  submission: LifecycleTaskSubmissionPort = {
    submit: executeLifecycleTask,
  },
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
          triggerRunId: `outbox:${delivery.messageId}`,
          attempt: 1,
          idempotencyKey: delivery.idempotencyKey,
          payload: event,
        });
      },
    ]),
  );
}
