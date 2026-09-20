import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { durableRetryPolicy } from "../policy";
import { defineScheduledTask, defineTask } from "../tasks/definition";
import { resetTaskRegistryForTests } from "../tasks/registry";
import {
  createEnvironmentSqsTaskPoller,
  createSqsTaskPoller,
  retryVisibilitySeconds,
} from "./sqs-task-poller";

const queueUrl =
  "https://sqs.us-east-1.amazonaws.com/000000000000/clockwork-workflows.fifo";

interface Call {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/**
 * A queue that hands out one batch and then holds the long poll open, which is
 * what a real twenty-second receive does between deliveries.
 */
function fakeQueue(
  batches: Record<string, unknown>[][],
  /** A command name the queue accepts but never answers, as a slow round trip does. */
  hold?: string,
) {
  const calls: Call[] = [];
  const pending = [...batches];
  let releaseIdle: (() => void) | undefined;
  return {
    calls,
    named: (name: string) => calls.filter((call) => call.name === name),
    releaseIdle: () => releaseIdle?.(),
    client: {
      send: (
        command: {
          constructor: { name: string };
          input: Record<string, unknown>;
        },
        options?: { abortSignal?: AbortSignal },
      ) => {
        const name = command.constructor.name;
        calls.push({ name, input: command.input });
        if (name === hold) return new Promise(() => {});
        if (name !== "ReceiveMessageCommand") return Promise.resolve({});
        const next = pending.shift();
        if (next) return Promise.resolve({ Messages: next });
        return new Promise((resolve, reject) => {
          releaseIdle = () => resolve({ Messages: [] });
          // A stopped poller aborts the open receive, which is how the SDK
          // reports a long poll cut short.
          options?.abortSignal?.addEventListener("abort", () =>
            reject(new Error("AbortError")),
          );
        });
      },
    },
  };
}

function message(
  overrides: {
    id?: string;
    taskId?: string;
    /** Defaults to the task id, which is what both submitters send. */
    groupId?: string;
    body?: Record<string, unknown>;
    receiveCount?: number;
    sentAt?: number;
  } = {},
) {
  const id = overrides.id ?? "message-1";
  return {
    MessageId: id,
    ReceiptHandle: `receipt-${id}`,
    Body: JSON.stringify(
      overrides.body ?? {
        taskId: overrides.taskId ?? "test.task.v1",
        payload: { value: 1 },
        idempotencyKey: `key-${id}`,
      },
    ),
    Attributes: {
      ApproximateReceiveCount: String(overrides.receiveCount ?? 1),
      SentTimestamp: String(overrides.sentAt ?? Date.now()),
      MessageGroupId: overrides.groupId ?? overrides.taskId ?? "test.task.v1",
    },
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => resetTaskRegistryForTests());
afterEach(() => vi.useRealTimers());

describe("retry visibility", () => {
  it("delays an attempt by the policy's backoff, jittered downwards", () => {
    // Attempt 3 of the durable policy is a four-second backoff; full jitter
    // spreads a herd of runs across the half-interval below it.
    expect(retryVisibilitySeconds(durableRetryPolicy, 3, () => 1)).toBe(4);
    expect(retryVisibilitySeconds(durableRetryPolicy, 3, () => 0)).toBe(2);
    expect(retryVisibilitySeconds(durableRetryPolicy, 1, () => 1)).toBe(1);
  });

  it("clamps to the policy ceiling and to the queue's own maximum", () => {
    expect(retryVisibilitySeconds(durableRetryPolicy, 20, () => 1)).toBe(300);
    expect(
      retryVisibilitySeconds(
        { ...durableRetryPolicy, maxTimeoutInMs: 90_000_000, randomize: false },
        20,
      ),
    ).toBe(43_200);
  });
});

describe("SQS task poller", () => {
  it("runs the task and deletes the message it succeeded on", async () => {
    const ran: unknown[] = [];
    defineTask({
      id: "test.task.v1",
      run: (payload) => {
        ran.push(payload);
        return Promise.resolve();
      },
    });
    const queue = fakeQueue([[message()]]);
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
    });

    poller.start();
    await vi.waitUntil(() => queue.named("DeleteMessageCommand").length === 1);
    await poller.stop();

    expect(ran).toEqual([{ value: 1 }]);
    expect(queue.named("ReceiveMessageCommand")[0]?.input).toMatchObject({
      QueueUrl: queueUrl,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 300,
    });
    expect(queue.named("DeleteMessageCommand")[0]?.input).toMatchObject({
      QueueUrl: queueUrl,
      ReceiptHandle: "receipt-message-1",
    });
  });

  it("returns a failed message to the queue after the policy's backoff", async () => {
    defineTask({
      id: "test.task.v1",
      run: () => Promise.reject(new Error("PROVIDER_UNAVAILABLE")),
    });
    const queue = fakeQueue([[message({ receiveCount: 3 })]]);
    const logged: Record<string, unknown>[] = [];
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
      random: () => 1,
      log: (entry) => logged.push(entry),
    });

    poller.start();
    await vi.waitUntil(
      () => queue.named("ChangeMessageVisibilityCommand").length === 1,
    );
    await poller.stop();

    expect(queue.named("DeleteMessageCommand")).toHaveLength(0);
    expect(
      queue.named("ChangeMessageVisibilityCommand")[0]?.input,
    ).toMatchObject({
      ReceiptHandle: "receipt-message-1",
      VisibilityTimeout: retryVisibilitySeconds(durableRetryPolicy, 3, () => 1),
    });
    // The failure is reported by task id and attempt; the payload it failed on
    // may carry customer data and never reaches a log line.
    expect(logged).toContainEqual(
      expect.objectContaining({
        event: "TASK_FAILED",
        taskId: "test.task.v1",
        attempt: 3,
      }),
    );
    expect(JSON.stringify(logged)).not.toContain("key-message-1");
  });

  it("extends the visibility of a message it is still working on", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    defineTask({ id: "test.task.v1", run: () => gate.promise });
    const queue = fakeQueue([[message()]]);
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(queue.named("DeleteMessageCommand")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(
      queue.named("ChangeMessageVisibilityCommand")[0]?.input,
    ).toMatchObject({
      ReceiptHandle: "receipt-message-1",
      VisibilityTimeout: 300,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(queue.named("ChangeMessageVisibilityCommand")).toHaveLength(2);

    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.named("DeleteMessageCommand")).toHaveLength(1);
    // The heartbeat stops with the run rather than extending a deleted message.
    await vi.advanceTimersByTimeAsync(180_000);
    expect(queue.named("ChangeMessageVisibilityCommand")).toHaveLength(2);
    await poller.stop();
  });

  it("sends a message for an unknown task id back for immediate redelivery", async () => {
    const queue = fakeQueue([[message({ taskId: "test.retired.v1" })]]);
    const logged: Record<string, unknown>[] = [];
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
      log: (entry) => logged.push(entry),
    });

    poller.start();
    await vi.waitUntil(() =>
      logged.some((entry) => entry.event === "TASK_UNKNOWN"),
    );
    await poller.stop();

    // Deleting it would discard the work; the queue's redrive policy moves it
    // to the dead-letter queue, where an operator can see it. Holding the
    // five-minute lease eight times first would take forty minutes, and on a
    // FIFO queue it blocks that message group the whole time.
    expect(queue.named("DeleteMessageCommand")).toHaveLength(0);
    expect(
      queue.named("ChangeMessageVisibilityCommand")[0]?.input,
    ).toMatchObject({
      ReceiptHandle: "receipt-message-1",
      VisibilityTimeout: 0,
    });
  });

  it("sends an unreadable message back for immediate redelivery", async () => {
    const queue = fakeQueue([
      [{ ...message(), Body: "{not json" }] as Record<string, unknown>[],
    ]);
    const logged: Record<string, unknown>[] = [];
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
      log: (entry) => logged.push(entry),
    });

    poller.start();
    await vi.waitUntil(() =>
      logged.some((entry) => entry.event === "TASK_MESSAGE_INVALID"),
    );
    await poller.stop();

    expect(queue.named("DeleteMessageCommand")).toHaveLength(0);
    expect(
      queue.named("ChangeMessageVisibilityCommand")[0]?.input,
    ).toMatchObject({ VisibilityTimeout: 0 });
  });

  it("stops the heartbeat before it deletes the message it succeeded on", async () => {
    vi.useFakeTimers();
    defineTask({ id: "test.task.v1", run: () => Promise.resolve() });
    // The delete never answers, which is the window a heartbeat would fire in
    // and extend the visibility of a message that is already gone.
    const queue = fakeQueue([[message()]], "DeleteMessageCommand");
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(queue.named("DeleteMessageCommand")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(queue.named("ChangeMessageVisibilityCommand")).toHaveLength(0);
  });

  it("stops the heartbeat before it schedules the retry of a failed run", async () => {
    vi.useFakeTimers();
    defineTask({
      id: "test.task.v1",
      run: () => Promise.reject(new Error("PROVIDER_UNAVAILABLE")),
    });
    const queue = fakeQueue(
      [[message({ receiveCount: 3 })]],
      "ChangeMessageVisibilityCommand",
    );
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
      random: () => 1,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(300_000);
    // Exactly one, carrying the computed backoff: a heartbeat firing during
    // that round trip would put the message back five minutes out instead.
    expect(queue.named("ChangeMessageVisibilityCommand")).toHaveLength(1);
    expect(
      queue.named("ChangeMessageVisibilityCommand")[0]?.input,
    ).toMatchObject({
      VisibilityTimeout: retryVisibilitySeconds(durableRetryPolicy, 3, () => 1),
    });
  });

  it("logs the shape of a rejected payload and never its values", async () => {
    defineTask({
      id: "test.task.v1",
      schema: z.object({ email: z.email() }),
      run: () => Promise.resolve(),
    });
    const queue = fakeQueue([
      [
        message({
          body: {
            taskId: "test.task.v1",
            payload: { email: "ada-at-customer.example" },
          },
        }),
      ],
    ]);
    const logged: Record<string, unknown>[] = [];
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
      log: (entry) => logged.push(entry),
    });

    poller.start();
    await vi.waitUntil(() =>
      logged.some((entry) => entry.event === "TASK_FAILED"),
    );
    await poller.stop();

    // A ZodError's own message serializes the value it rejected, and a payload
    // value is customer data. The log line carries the path and the issue code.
    expect(JSON.stringify(logged)).not.toContain("ada-at-customer.example");
    expect(logged).toContainEqual(
      expect.objectContaining({
        event: "TASK_FAILED",
        name: "ZodError",
        issues: ["email:invalid_format"],
      }),
    );
  });

  it("summarizes an ordinary failure by name and a bounded message", async () => {
    const long = `PROVIDER_REJECTED ${"x".repeat(500)}`;
    defineTask({
      id: "test.task.v1",
      run: () => Promise.reject(new Error(long)),
    });
    const queue = fakeQueue([[message()]]);
    const logged: Record<string, unknown>[] = [];
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
      log: (entry) => logged.push(entry),
    });

    poller.start();
    await vi.waitUntil(() =>
      logged.some((entry) => entry.event === "TASK_FAILED"),
    );
    await poller.stop();

    const failure = logged.find((entry) => entry.event === "TASK_FAILED");
    expect(failure).toMatchObject({ name: "Error" });
    expect(failure?.message).toBe(long.slice(0, 200));
  });

  it("drops a delivery older than the task's delivery window unrun", async () => {
    const ran = vi.fn(() => Promise.resolve());
    // The outbox dispatcher runs every minute and a later tick supersedes an
    // undelivered one, so a backlog is dropped rather than replayed.
    defineScheduledTask({
      id: "test.scheduled.v1",
      cron: "* * * * *",
      deliveryTtlMs: 60_000,
      run: ran,
    });
    const queue = fakeQueue([
      [
        message({
          body: {
            taskId: "test.scheduled.v1",
            scheduledAt: new Date(Date.now() - 300_000).toISOString(),
          },
          sentAt: Date.now() - 300_000,
        }),
      ],
    ]);
    const logged: Record<string, unknown>[] = [];
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
      log: (entry) => logged.push(entry),
    });

    poller.start();
    await vi.waitUntil(() => queue.named("DeleteMessageCommand").length === 1);
    await poller.stop();

    expect(ran).not.toHaveBeenCalled();
    expect(logged).toContainEqual(
      expect.objectContaining({ event: "TASK_TTL_EXPIRED" }),
    );
  });

  it("never runs more than its concurrency and drains what is in flight", async () => {
    const gates = [deferred(), deferred(), deferred()];
    let started = 0;
    let peak = 0;
    let active = 0;
    defineTask({
      id: "test.task.v1",
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        const gate = gates[started];
        started += 1;
        await gate?.promise;
        active -= 1;
      },
    });
    // Distinct groups: the concurrency cap is what this measures, and
    // messages sharing a group are serialized by the test below.
    const queue = fakeQueue([
      [
        message({ id: "message-1", groupId: "group-1" }),
        message({ id: "message-2", groupId: "group-2" }),
        message({ id: "message-3", groupId: "group-3" }),
      ],
    ]);
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
      concurrency: 2,
    });

    poller.start();
    await vi.waitUntil(() => started === 2);
    expect(peak).toBe(2);
    expect(queue.named("ReceiveMessageCommand")[0]?.input).toMatchObject({
      MaxNumberOfMessages: 2,
    });

    for (const gate of gates) gate.resolve();
    await vi.waitUntil(() => started === 3);
    const stopped = poller.stop();
    queue.releaseIdle();
    await stopped;

    // stop() returns only once every accepted message has been accounted for.
    expect(queue.named("DeleteMessageCommand")).toHaveLength(3);
  });

  it("keeps the lease alive on a message waiting for its lane", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    let started = 0;
    defineTask({
      id: "test.task.v1",
      run: () => {
        started += 1;
        return gate.promise;
      },
    });
    const queue = fakeQueue([
      [message({ id: "message-1" }), message({ id: "message-2" })],
    ]);
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toBe(1);

    // A lease is 300 seconds; the head is still running well past it.
    await vi.advanceTimersByTimeAsync(360_000);
    const extended = queue
      .named("ChangeMessageVisibilityCommand")
      .filter((call) => call.input.ReceiptHandle === "receipt-message-2");
    expect(extended.length).toBeGreaterThan(0);
    expect(extended[0]?.input).toMatchObject({ VisibilityTimeout: 300 });

    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toBe(2);
    await poller.stop();
  });

  it("waits for a heartbeat already in flight before scheduling the retry", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    defineTask({ id: "test.task.v1", run: () => gate.promise });
    const queue = fakeQueue([[message()]]);
    // The first beat never answers until this is called, which is a beat still
    // on the wire when the run fails.
    let releaseBeat: (() => void) | undefined;
    let firstBeat = true;
    const client = {
      send: (
        command: {
          constructor: { name: string };
          input: Record<string, unknown>;
        },
        options?: { abortSignal?: AbortSignal },
      ) => {
        if (
          command.constructor.name === "ChangeMessageVisibilityCommand" &&
          firstBeat
        ) {
          firstBeat = false;
          queue.calls.push({ name: command.constructor.name, ...command });
          return new Promise((resolve) => {
            releaseBeat = () => resolve({});
          });
        }
        return queue.client.send(command, options);
      },
    };
    const poller = createSqsTaskPoller({
      client: client as never,
      queueUrl,
      random: () => 1,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(queue.named("ChangeMessageVisibilityCommand")).toHaveLength(1);

    gate.reject(new Error("PROVIDER_UNAVAILABLE"));
    await vi.advanceTimersByTimeAsync(0);
    // The backoff is not applied while the beat could still land on top of it.
    expect(queue.named("ChangeMessageVisibilityCommand")).toHaveLength(1);

    releaseBeat?.();
    await vi.waitUntil(
      () => queue.named("ChangeMessageVisibilityCommand").length === 2,
    );
    expect(
      queue.named("ChangeMessageVisibilityCommand")[1]?.input,
    ).toMatchObject({
      VisibilityTimeout: retryVisibilitySeconds(durableRetryPolicy, 1, () => 1),
    });
  });

  it("runs one message group at a time, in the order the batch arrived", async () => {
    const gates = [deferred(), deferred(), deferred()];
    const order: string[] = [];
    let active = 0;
    let peak = 0;
    defineTask({
      id: "test.task.v1",
      run: async (payload: { value: number }) => {
        active += 1;
        peak = Math.max(peak, active);
        order.push(`start-${payload.value}`);
        await gates[payload.value - 1]?.promise;
        order.push(`end-${payload.value}`);
        active -= 1;
      },
    });
    // One group, which is what a task id gives every message it sends.
    const queue = fakeQueue([
      [1, 2, 3].map((value) =>
        message({
          id: `message-${value}`,
          body: {
            taskId: "test.task.v1",
            payload: { value },
            idempotencyKey: `key-${value}`,
          },
        }),
      ),
    ]);
    const poller = createSqsTaskPoller({
      client: queue.client as never,
      queueUrl,
      concurrency: 3,
    });

    poller.start();
    await vi.waitUntil(() => order.length === 1);
    expect(peak).toBe(1);
    expect(order).toEqual(["start-1"]);

    for (const gate of gates) gate.resolve();
    await vi.waitUntil(() => queue.named("DeleteMessageCommand").length === 3);
    const stopped = poller.stop();
    queue.releaseIdle();
    await stopped;

    expect(peak).toBe(1);
    expect(order).toEqual([
      "start-1",
      "end-1",
      "start-2",
      "end-2",
      "start-3",
      "end-3",
    ]);
  });
});

describe("poller from the environment", () => {
  it("reads the queue, the region and the tuning the host is given", () => {
    const poller = createEnvironmentSqsTaskPoller({
      WORKFLOWS_QUEUE_ID: queueUrl,
      AWS_REGION: "us-east-1",
      CLOCKWORK_TASK_POLL_CONCURRENCY: "8",
      CLOCKWORK_TASK_VISIBILITY_SECONDS: "600",
    });
    expect(poller.options).toMatchObject({
      queueUrl,
      concurrency: 8,
      visibilityTimeoutSeconds: 600,
    });
  });

  it("refuses to poll a queue it was not given", () => {
    expect(() => createEnvironmentSqsTaskPoller({})).toThrow(
      "WORKFLOWS_QUEUE_ID",
    );
  });

  it("ignores tuning that is not a usable number", () => {
    const poller = createEnvironmentSqsTaskPoller({
      WORKFLOWS_QUEUE_ID: queueUrl,
      CLOCKWORK_TASK_POLL_CONCURRENCY: "none",
      CLOCKWORK_TASK_VISIBILITY_SECONDS: "0",
    });
    expect(poller.options).toMatchObject({
      concurrency: 4,
      visibilityTimeoutSeconds: 300,
    });
  });
});
