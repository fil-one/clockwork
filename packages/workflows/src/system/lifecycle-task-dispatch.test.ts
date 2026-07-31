import { describe, expect, it, vi } from "vitest";

import { createLifecycleTaskOutboxHandlers } from "./lifecycle-task-dispatch";

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
