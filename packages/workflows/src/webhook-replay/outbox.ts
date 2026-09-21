import {
  WEBHOOK_REPLAY_REQUESTED_TOPIC,
  WEBHOOK_REPLAY_TASK_ID,
} from "@clockwork/db";
import { z } from "zod";

import type { OutboxTopicHandler } from "../system/outbox-dispatcher";
import { resolveTaskSubmitter, type TaskSubmitter } from "../tasks/submitter";

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

export class QueuedWebhookReplayTaskSubmitter implements WebhookReplayTaskSubmitter {
  private readonly submitter: TaskSubmitter;

  public constructor(submitter: TaskSubmitter = resolveTaskSubmitter()) {
    this.submitter = submitter;
  }

  public submit(input: {
    workflowRunId: string;
    idempotencyKey: string;
  }): Promise<unknown> {
    return this.submitter.submit({
      taskId: WEBHOOK_REPLAY_TASK_ID,
      payload: { workflowRunId: input.workflowRunId },
      idempotencyKey: input.idempotencyKey,
    });
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
