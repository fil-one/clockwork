import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { z } from "zod";

import type { TaskDefinition, TaskRetryPolicy } from "../tasks/definition";
import { getTask } from "../tasks/registry";

/** What a submitter or an EventBridge schedule puts on the queue. */
export const TaskMessageSchema = z.object({
  taskId: z.string().min(1),
  payload: z.unknown().optional(),
  idempotencyKey: z.string().min(1).optional(),
  scheduledAt: z.string().min(1).optional(),
});

export type TaskMessage = z.infer<typeof TaskMessageSchema>;

/** SQS caps a visibility timeout at twelve hours. */
const MAX_VISIBILITY_SECONDS = 43_200;
const DEFAULT_VISIBILITY_SECONDS = 300;
const DEFAULT_HEARTBEAT_MS = 60_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_WAIT_SECONDS = 20;
const MAX_MESSAGES_PER_RECEIVE = 10;
const RECEIVE_FAILURE_PAUSE_MS = 1_000;

/**
 * The delay before a failed attempt becomes visible again.
 *
 * Trigger computed this delay itself from the same policy. Here the queue
 * holds the delay, so the number has to be produced rather than declared:
 * exponential from the policy's floor, clamped to its ceiling, and spread over
 * the half-interval below when the policy asks for jitter, so a herd of runs
 * failed by one provider outage does not return together.
 */
export function retryVisibilitySeconds(
  policy: TaskRetryPolicy,
  attempt: number,
  random: () => number = Math.random,
): number {
  const backoff = Math.min(
    Math.max(
      policy.minTimeoutInMs * policy.factor ** Math.max(attempt - 1, 0),
      policy.minTimeoutInMs,
    ),
    policy.maxTimeoutInMs,
  );
  const jittered = policy.randomize
    ? backoff * (0.5 + 0.5 * random())
    : backoff;
  return Math.min(MAX_VISIBILITY_SECONDS, Math.ceil(jittered / 1000));
}

export interface SqsPollerOptions {
  readonly client: SQSClient;
  readonly queueUrl: string;
  readonly concurrency?: number;
  readonly waitTimeSeconds?: number;
  readonly visibilityTimeoutSeconds?: number;
  readonly heartbeatIntervalMs?: number;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly log?: (entry: Record<string, unknown>) => void;
}

export interface TaskPoller {
  start(): void;
  stop(): Promise<void>;
}

interface QueueMessage {
  MessageId?: string | undefined;
  ReceiptHandle?: string | undefined;
  Body?: string | undefined;
  Attributes?: Record<string, string | undefined> | undefined;
}

/** How much of an error message a log line carries. */
const MAX_MESSAGE_CHARS = 200;

interface ZodLikeIssue {
  readonly path?: readonly (string | number | symbol)[];
  readonly code?: string;
}

/**
 * What a log line may say about a failure.
 *
 * An error message is not a safe log field here: a schema rejection serializes
 * the value it rejected, and a provider error routinely quotes the customer
 * identifier it refused. So a validation error contributes the paths and codes
 * of its issues and nothing else, and every other error contributes its name,
 * its string code when it has one, and a bounded prefix of its message.
 */
export function summarizeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error))
    return {
      name: typeof error,
      message: String(error).slice(0, MAX_MESSAGE_CHARS),
    };
  const summary: Record<string, unknown> = { name: error.name };
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") summary.code = code;
  const issues = (error as { issues?: unknown }).issues;
  if (Array.isArray(issues)) {
    summary.issues = (issues as ZodLikeIssue[]).map(
      (issue) =>
        `${issue.path?.map(String).join(".") || "(root)"}:${issue.code ?? "invalid"}`,
    );
    return summary;
  }
  summary.message = error.message.slice(0, MAX_MESSAGE_CHARS);
  return summary;
}

/**
 * Drains the workflows queue in the process that owns it.
 *
 * The queue holds what Trigger.dev held: the retry schedule (a failed attempt
 * goes back with the policy's backoff on its visibility), the dead letter (a
 * message the queue has redelivered past its ceiling), and the lease (the
 * visibility timeout, re-extended while a run is still working so a crashed
 * consumer surfaces its message in five minutes rather than an hour).
 *
 * Nothing a message carries is logged: a payload is customer data and an
 * idempotency key identifies a customer record. A log line names the task, the
 * attempt and the failure.
 */
export function createSqsTaskPoller(options: SqsPollerOptions): TaskPoller {
  const {
    client,
    queueUrl,
    concurrency = DEFAULT_CONCURRENCY,
    waitTimeSeconds = DEFAULT_WAIT_SECONDS,
    visibilityTimeoutSeconds = DEFAULT_VISIBILITY_SECONDS,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
    now = () => new Date(),
    random = Math.random,
    log = () => {},
  } = options;

  let running = false;
  let pump: Promise<void> | undefined;
  let abort: AbortController | undefined;
  const inFlight = new Set<Promise<void>>();
  let active = 0;
  const waiting: (() => void)[] = [];

  async function acquire(): Promise<void> {
    if (active < concurrency) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
  }

  function release(): void {
    active -= 1;
    waiting.shift()?.();
  }

  function deleteMessage(receiptHandle: string): Promise<unknown> {
    return client.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  function changeVisibility(
    receiptHandle: string,
    seconds: number,
  ): Promise<unknown> {
    return client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  }

  /**
   * Hands a message nothing here can run straight back to the queue.
   *
   * Deleting it would discard the work; holding the lease would make the eight
   * receives it takes to reach the dead-letter queue cost forty minutes, and on
   * a FIFO queue it blocks that message group for all of them. A zero
   * visibility gets it to the dead letter in seconds instead.
   */
  async function redeliverNow(
    receiptHandle: string,
    reason: string,
  ): Promise<void> {
    await changeVisibility(receiptHandle, 0).catch((error: unknown) =>
      log({
        event: "TASK_REDELIVERY_FAILED",
        reason,
        ...summarizeError(error),
      }),
    );
  }

  function expired(definition: TaskDefinition, message: QueueMessage): boolean {
    if (definition.deliveryTtlMs === undefined) return false;
    const sentAt = Number(message.Attributes?.SentTimestamp);
    if (!Number.isFinite(sentAt)) return false;
    return now().getTime() - sentAt > definition.deliveryTtlMs;
  }

  async function handle(message: QueueMessage): Promise<void> {
    const receiptHandle = message.ReceiptHandle;
    if (!receiptHandle) {
      log({ event: "TASK_RECEIPT_MISSING" });
      return;
    }
    let body: TaskMessage;
    try {
      body = TaskMessageSchema.parse(JSON.parse(message.Body ?? ""));
    } catch {
      // Unreadable bytes cannot be routed to an owner; the redrive policy
      // moves the message to the dead-letter queue for an operator to read.
      log({ event: "TASK_MESSAGE_INVALID", messageId: message.MessageId });
      await redeliverNow(receiptHandle, "TASK_MESSAGE_INVALID");
      return;
    }
    const definition = getTask(body.taskId);
    if (!definition) {
      log({ event: "TASK_UNKNOWN", taskId: body.taskId });
      await redeliverNow(receiptHandle, "TASK_UNKNOWN");
      return;
    }
    if (expired(definition, message)) {
      log({ event: "TASK_TTL_EXPIRED", taskId: definition.id });
      await deleteMessage(receiptHandle);
      return;
    }
    const attempt = Math.max(
      Number(message.Attributes?.ApproximateReceiveCount ?? 1) || 1,
      1,
    );
    const heartbeat = setInterval(() => {
      void changeVisibility(receiptHandle, visibilityTimeoutSeconds).catch(
        (error: unknown) =>
          log({
            event: "TASK_HEARTBEAT_FAILED",
            taskId: definition.id,
            ...summarizeError(error),
          }),
      );
    }, heartbeatIntervalMs);
    // The heartbeat covers the run and nothing after it. A beat landing during
    // the delete extends a message that is already gone; one landing during the
    // retry's ChangeMessageVisibility overwrites the computed backoff with the
    // full lease.
    let beating = true;
    const stopHeartbeat = (): void => {
      if (!beating) return;
      beating = false;
      clearInterval(heartbeat);
    };
    await acquire();
    try {
      try {
        // A scheduled delivery carries no payload; its `scheduledAt` is the body.
        const raw = body.payload === undefined ? body : body.payload;
        await definition.run(definition.parse(raw), {
          runId: message.MessageId ?? receiptHandle.slice(0, 32),
          attempt,
          ...(body.scheduledAt ? { scheduledAt: body.scheduledAt } : {}),
        });
      } finally {
        stopHeartbeat();
      }
      await deleteMessage(receiptHandle);
    } catch (error) {
      stopHeartbeat();
      log({
        event: "TASK_FAILED",
        taskId: definition.id,
        attempt,
        ...summarizeError(error),
      });
      await changeVisibility(
        receiptHandle,
        retryVisibilitySeconds(definition.retry, attempt, random),
      ).catch((visibilityError: unknown) =>
        log({
          event: "TASK_RETRY_SCHEDULE_FAILED",
          taskId: definition.id,
          ...summarizeError(visibilityError),
        }),
      );
    } finally {
      stopHeartbeat();
      release();
    }
  }

  function accept(message: QueueMessage): void {
    const run: Promise<void> = handle(message)
      .catch((error: unknown) =>
        log({ event: "TASK_DISPATCH_FAILED", ...summarizeError(error) }),
      )
      .then(() => {
        inFlight.delete(run);
      });
    inFlight.add(run);
  }

  async function loop(): Promise<void> {
    while (running) {
      const free = concurrency - inFlight.size;
      if (free <= 0) {
        await Promise.race(inFlight);
        continue;
      }
      let received: { Messages?: QueueMessage[] | undefined };
      try {
        received = await client.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: Math.min(MAX_MESSAGES_PER_RECEIVE, free),
            WaitTimeSeconds: waitTimeSeconds,
            VisibilityTimeout: visibilityTimeoutSeconds,
            MessageSystemAttributeNames: [
              "ApproximateReceiveCount",
              "SentTimestamp",
            ],
          }),
          abort ? { abortSignal: abort.signal } : {},
        );
      } catch (error) {
        if (!running) break;
        log({ event: "TASK_RECEIVE_FAILED", ...summarizeError(error) });
        await new Promise((resolve) =>
          setTimeout(resolve, RECEIVE_FAILURE_PAUSE_MS),
        );
        continue;
      }
      for (const message of received.Messages ?? []) accept(message);
    }
    await Promise.allSettled([...inFlight]);
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      abort = new AbortController();
      pump = loop();
    },
    async stop(): Promise<void> {
      running = false;
      abort?.abort();
      await pump;
      pump = undefined;
    },
  };
}

/** A positive integer, or nothing when the variable is unset or unusable. */
function tuning(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * The poller a host starts from its environment: `WORKFLOWS_QUEUE_ID` (storoku
 * injects the queue URL), `AWS_REGION`, and the two optional tuning knobs. The
 * resolved options are readable on the returned poller so a host can log what
 * it is draining.
 *
 * Building the client here keeps the AWS SDK a dependency of this package
 * alone; a host declares which runtime it wants and nothing more.
 */
export function createEnvironmentSqsTaskPoller(
  source: Readonly<Record<string, string | undefined>> = process.env,
  overrides: Partial<SqsPollerOptions> = {},
): TaskPoller & { readonly options: Readonly<SqsPollerOptions> } {
  const queueUrl = source.WORKFLOWS_QUEUE_ID?.trim();
  if (!queueUrl) throw new Error("TASK_RUNTIME_INCOMPLETE:WORKFLOWS_QUEUE_ID");
  const region = source.AWS_REGION?.trim();
  const concurrency = tuning(source.CLOCKWORK_TASK_POLL_CONCURRENCY);
  const visibility = tuning(source.CLOCKWORK_TASK_VISIBILITY_SECONDS);
  const options: SqsPollerOptions = {
    client: new SQSClient(region ? { region } : {}),
    queueUrl,
    concurrency: concurrency ?? DEFAULT_CONCURRENCY,
    visibilityTimeoutSeconds: visibility ?? DEFAULT_VISIBILITY_SECONDS,
    ...overrides,
  };
  return { ...createSqsTaskPoller(options), options };
}
