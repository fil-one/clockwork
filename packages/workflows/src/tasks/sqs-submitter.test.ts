import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SqsTaskSubmitter } from "./sqs-submitter";

const queueUrl =
  "https://sqs.us-east-1.amazonaws.com/000000000000/clockwork-workflows.fifo";

function fakeClient(messageId = "11111111-2222-4333-8444-555555555555") {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    client: {
      send: (command: { input: Record<string, unknown> }) => {
        sent.push(command.input);
        return Promise.resolve({ MessageId: messageId });
      },
    },
  };
}

describe("SQS task submitter", () => {
  it("sends the task id, payload and key as the message body", async () => {
    const { client, sent } = fakeClient();

    const receipt = await new SqsTaskSubmitter({
      client: client as never,
      queueUrl,
    }).submit({
      taskId: "lifecycle-offboarding-teardown-v1",
      payload: { eventType: "termination.approved" },
      idempotencyKey: "outbox:90000000-0000-4000-8000-000000000001",
    });

    expect(receipt).toEqual({ runId: "11111111-2222-4333-8444-555555555555" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.QueueUrl).toBe(queueUrl);
    expect(JSON.parse(String(sent[0]?.MessageBody))).toEqual({
      taskId: "lifecycle-offboarding-teardown-v1",
      payload: { eventType: "termination.approved" },
      idempotencyKey: "outbox:90000000-0000-4000-8000-000000000001",
    });
  });

  it("groups by task id and deduplicates on a hash of the key", async () => {
    const { client, sent } = fakeClient();
    const idempotencyKey = "outbox:90000000-0000-4000-8000-000000000002";

    await new SqsTaskSubmitter({ client: client as never, queueUrl }).submit({
      taskId: "lifecycle-pocs-conversion-v1",
      payload: {},
      idempotencyKey,
    });

    // The key is unbounded application text; FIFO caps the deduplication id at
    // 128 characters and rejects characters a key may legitimately carry.
    expect(sent[0]?.MessageGroupId).toBe("lifecycle-pocs-conversion-v1");
    expect(sent[0]?.MessageDeduplicationId).toBe(
      createHash("sha256").update(idempotencyKey).digest("hex"),
    );
  });

  it("orders on the group key when one is given", async () => {
    const { client, sent } = fakeClient();

    await new SqsTaskSubmitter({ client: client as never, queueUrl }).submit({
      taskId: "lifecycle-pocs-conversion-v1",
      payload: {},
      idempotencyKey: "outbox:90000000-0000-4000-8000-000000000003",
      groupKey: "poc-lane-3",
    });

    expect(sent[0]?.MessageGroupId).toBe("poc-lane-3");
  });

  it("fails loudly when the queue accepts a message without an id", async () => {
    const client = { send: () => Promise.resolve({}) };

    await expect(
      new SqsTaskSubmitter({ client: client as never, queueUrl }).submit({
        taskId: "lifecycle-pocs-conversion-v1",
        payload: {},
        idempotencyKey: "outbox:90000000-0000-4000-8000-000000000004",
      }),
    ).rejects.toThrow("TASK_SUBMISSION_MESSAGE_ID_MISSING");
  });
});
