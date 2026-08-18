import { describe, expect, it, vi } from "vitest";

import { WEBHOOK_REPLAY_REQUESTED_TOPIC } from "@clockwork/db";
import { createWebhookReplayOutboxHandler } from "./outbox";

const workflowRunId = "60000000-0000-4000-8000-000000000001";
const eventId = "60000000-0000-4000-8000-000000000002";
const delivery = {
  messageId: "60000000-0000-4000-8000-000000000003",
  eventId,
  topic: WEBHOOK_REPLAY_REQUESTED_TOPIC,
  idempotencyKey: "outbox:60000000-0000-4000-8000-000000000003",
  payload: {
    eventId,
    eventType: WEBHOOK_REPLAY_REQUESTED_TOPIC,
    aggregateType: "workflow_run",
    aggregateId: workflowRunId,
    data: {
      workflowRunId,
      webhookEventId: "60000000-0000-4000-8000-000000000004",
      provider: "stripe",
      providerEventId: "evt_1",
      payloadHash: "a".repeat(64),
      reason: "INC-9001 verified replay",
    },
  },
};

describe("webhook replay outbox dispatch", () => {
  it("submits only the trusted run reference under a stable key", async () => {
    const submitter = { submit: vi.fn().mockResolvedValue(undefined) };
    await createWebhookReplayOutboxHandler(submitter)(delivery);
    expect(submitter.submit).toHaveBeenCalledWith({
      workflowRunId,
      idempotencyKey: `webhook-replay:${workflowRunId}`,
    });
    expect(JSON.stringify(submitter.submit.mock.calls)).not.toContain("evt_1");
  });

  it("refuses an aggregate/run mismatch", async () => {
    const submitter = { submit: vi.fn().mockResolvedValue(undefined) };
    await expect(
      createWebhookReplayOutboxHandler(submitter)({
        ...delivery,
        payload: {
          ...delivery.payload,
          aggregateId: "60000000-0000-4000-8000-000000000099",
        },
      }),
    ).rejects.toThrow("WEBHOOK_REPLAY_OUTBOX_BINDING_INVALID");
    expect(submitter.submit).not.toHaveBeenCalled();
  });
});
