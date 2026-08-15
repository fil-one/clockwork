import { describe, expect, it, vi } from "vitest";

import {
  createLifecycleTaskOutboxHandlers,
  TriggerLifecycleTaskSubmitter,
} from "./lifecycle-task-dispatch";

const sdk = vi.hoisted(() => ({
  submissions: [] as {
    id: string;
    payload: unknown;
    options: { idempotencyKey?: unknown } | undefined;
  }[],
}));

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: (
      id: string,
      payload: unknown,
      options?: { idempotencyKey?: unknown },
    ) => {
      sdk.submissions.push({ id, payload, options });
      return Promise.resolve({ id: `run_${sdk.submissions.length}` });
    },
  },
  idempotencyKeys: {
    create: (key: string, scope: unknown) =>
      Promise.resolve({ key, scope } as unknown),
  },
}));

describe("lifecycle outbox task dispatch", () => {
  it("maps accepted-order provisioning to one replay-safe task identity", async () => {
    const executions = new Set<string>();
    const execute = vi.fn((idempotencyKey: string) => {
      if (executions.has(idempotencyKey)) return Promise.resolve("duplicate");
      executions.add(idempotencyKey);
      return Promise.resolve("executed");
    });
    const handlers = createLifecycleTaskOutboxHandlers({
      submit: (invocation) => execute(invocation.idempotencyKey),
    });
    const handler = handlers.get("order.provisioning_requested");
    const delivery = {
      messageId: "40000000-0000-4000-8000-000000000001",
      eventId: "40000000-0000-4000-8000-000000000002",
      topic: "order.provisioning_requested",
      idempotencyKey: "outbox:40000000-0000-4000-8000-000000000001",
      payload: {
        eventType: "order.provisioning_requested",
        aggregateType: "provider_operation",
        aggregateId: "40000000-0000-4000-8000-000000000003",
        aggregateVersion: 1,
        data: {
          orderId: "50000000-0000-4000-8000-000000000001",
          organizationId: "30000000-0000-4000-8000-000000000001",
        },
      },
    };

    await handler?.(delivery);
    await handler?.(delivery);
    expect(executions).toEqual(
      new Set(["outbox:40000000-0000-4000-8000-000000000001"]),
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(handlers.has("core.invoices.create")).toBe(false);
  });

  it("rejects a topic/payload mismatch", async () => {
    const handler = createLifecycleTaskOutboxHandlers({
      submit: () => Promise.resolve(),
    }).get("order.provisioning_requested");
    await expect(
      handler?.({
        messageId: "message-1",
        eventId: "event-1",
        topic: "order.provisioning_requested",
        idempotencyKey: "outbox:message-1",
        payload: {
          eventType: "termination.approved",
          aggregateType: "termination",
          aggregateId: "termination-1",
          aggregateVersion: 1,
          data: {},
        },
      }),
    ).rejects.toThrow("LIFECYCLE_OUTBOX_TOPIC_EVENT_MISMATCH");
  });
});

describe("Trigger lifecycle task submitter", () => {
  it("carries the outbox key into the payload the worker rebuilds from", async () => {
    sdk.submissions.length = 0;
    await new TriggerLifecycleTaskSubmitter().submit({
      taskId: "lifecycle-offboarding-teardown-v1",
      triggerRunId: "outbox:60000000-0000-4000-8000-000000000001",
      attempt: 1,
      idempotencyKey: "outbox:60000000-0000-4000-8000-000000000001",
      payload: { eventType: "termination.approved", data: {} },
    });

    // `taskInvocation` in the worker reads `payload.idempotencyKey` back out.
    // Without it the worker would hash the payload instead, and the
    // dead-letter redrive -- which re-enters on `outbox:<messageId>` -- would
    // open a second workflow run rather than the stopped one.
    expect(sdk.submissions).toEqual([
      {
        id: "lifecycle-offboarding-teardown-v1",
        payload: {
          eventType: "termination.approved",
          data: {},
          idempotencyKey: "outbox:60000000-0000-4000-8000-000000000001",
        },
        options: {
          idempotencyKey: {
            key: "outbox:60000000-0000-4000-8000-000000000001",
            scope: { scope: "global" },
          },
        },
      },
    ]);
  });

  it("leaves a non-object payload alone rather than spreading it", async () => {
    sdk.submissions.length = 0;
    await new TriggerLifecycleTaskSubmitter().submit({
      taskId: "lifecycle-migrations-review-wait-v1",
      triggerRunId: "outbox:70000000-0000-4000-8000-000000000001",
      attempt: 1,
      idempotencyKey: "outbox:70000000-0000-4000-8000-000000000001",
      payload: null,
    });
    expect(sdk.submissions[0]?.payload).toBeNull();
  });
});
