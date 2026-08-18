import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import {
  WEBHOOK_REPLAY_REQUESTED_TOPIC,
  WEBHOOK_REPLAY_TASK_ID,
} from "@clockwork/db";
import { z } from "zod";

import type { OutboxTopicHandler } from "../system/outbox-dispatcher";

const EnvelopeSchema = z
  .object({
    eventId: z.uuid(),
    eventType: z.literal(WEBHOOK_REPLAY_REQUESTED_TOPIC),
    aggregateType: z.literal("workflow_run"),
    aggregateId: z.uuid(),
    data: z.object({
      workflowRunId: z.uuid(),
      webhookEventId: z.uuid(),
      provider: z.string().min(1),
      providerEventId: z.string().min(1),
      payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
      reason: z.string().min(8),
    }),
  })
  .passthrough();

export interface WebhookReplayTaskSubmitter {
  submit(input: {
    workflowRunId: string;
    idempotencyKey: string;
  }): Promise<unknown>;
}

export class TriggerWebhookReplayTaskSubmitter implements WebhookReplayTaskSubmitter {
  public async submit(input: {
    workflowRunId: string;
    idempotencyKey: string;
  }): Promise<unknown> {
    const idempotencyKey = await idempotencyKeys.create(input.idempotencyKey, {
      scope: "global",
    });
    return tasks.trigger(
      WEBHOOK_REPLAY_TASK_ID,
      { workflowRunId: input.workflowRunId },
      { idempotencyKey },
    );
  }
}

export function createWebhookReplayOutboxHandler(
  submitter: WebhookReplayTaskSubmitter,
): OutboxTopicHandler {
  return async (delivery) => {
    if (delivery.topic !== WEBHOOK_REPLAY_REQUESTED_TOPIC)
      throw new Error("WEBHOOK_REPLAY_OUTBOX_TOPIC_INVALID");
    const event = EnvelopeSchema.parse(delivery.payload);
    if (
      event.aggregateId !== event.data.workflowRunId ||
      delivery.eventId !== event.eventId
    )
      throw new Error("WEBHOOK_REPLAY_OUTBOX_BINDING_INVALID");
    await submitter.submit({
      workflowRunId: event.data.workflowRunId,
      idempotencyKey: `webhook-replay:${event.data.workflowRunId}`,
    });
  };
}
