import { createHash } from "node:crypto";

import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";

import type {
  TaskSubmission,
  TaskSubmissionReceipt,
  TaskSubmitter,
} from "./submitter";

export interface SqsTaskSubmitterOptions {
  readonly client: SQSClient;
  readonly queueUrl: string;
}

/**
 * Submission onto the FIFO workflows queue, which the in-process poller drains.
 *
 * FIFO content-based deduplication hashes the whole body, so the explicit id
 * carries the application's own notion of a duplicate instead: two deliveries
 * of one outbox message share an idempotency key and only one is accepted
 * inside the five-minute window. The key is hashed because it is unbounded
 * application text and SQS caps the id at 128 characters.
 *
 * `MessageGroupId` defaults to the task id, which serialises each task. That is
 * wanted for a schedule and a cap of one for a lane; `groupKey` is the escape
 * hatch for a caller that needs the lane wider.
 */
export class SqsTaskSubmitter implements TaskSubmitter {
  private readonly client: SQSClient;
  private readonly queueUrl: string;

  public constructor(options: SqsTaskSubmitterOptions) {
    this.client = options.client;
    this.queueUrl = options.queueUrl;
  }

  public async submit(input: TaskSubmission): Promise<TaskSubmissionReceipt> {
    const output = await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({
          taskId: input.taskId,
          payload: input.payload,
          idempotencyKey: input.idempotencyKey,
        }),
        MessageGroupId: input.groupKey ?? input.taskId,
        MessageDeduplicationId: createHash("sha256")
          .update(input.idempotencyKey)
          .digest("hex"),
      }),
    );
    if (!output.MessageId)
      throw new Error("TASK_SUBMISSION_MESSAGE_ID_MISSING");
    return { runId: output.MessageId };
  }
}
