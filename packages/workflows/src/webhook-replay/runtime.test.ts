import { describe, expect, it, vi } from "vitest";

import {
  FixtureTaxPort,
  type DatabaseWebhookReplayTaskStore,
  type RuntimeDatabase,
} from "@clockwork/db";
import {
  DatabaseWebhookReplayRuntime,
  ProductionWebhookReplayHandler,
} from "./runtime";

const invocation = {
  workflowRunId: "60000000-0000-4000-8000-000000000001",
  triggerRunId: "trigger_1",
  attempt: 1,
};
const event = {
  workflowRunId: invocation.workflowRunId,
  webhookEventId: "60000000-0000-4000-8000-000000000002",
  provider: "support:zendesk",
  providerEventId: "evt_1",
  eventType: "ticket.updated",
  payloadHash: "a".repeat(64),
  payload: { provider: "zendesk", type: "ticket.updated" },
  occurredAt: "2026-08-17T12:00:00.000Z",
};

function fixtures() {
  const store = {
    claim: vi.fn().mockResolvedValue({ status: "claimed", event }),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const handler = { apply: vi.fn().mockResolvedValue(undefined) };
  return {
    store,
    handler,
    runtime: new DatabaseWebhookReplayRuntime(
      store as unknown as DatabaseWebhookReplayTaskStore,
      handler,
    ),
  };
}

describe("webhook replay task runtime", () => {
  it("executes the stored event and completes the fenced run", async () => {
    const { runtime, store, handler } = fixtures();
    await expect(runtime.execute(invocation)).resolves.toEqual({
      status: "processed",
    });
    expect(handler.apply).toHaveBeenCalledWith(event);
    expect(store.complete).toHaveBeenCalledWith({
      workflowRunId: invocation.workflowRunId,
      triggerRunId: invocation.triggerRunId,
      output: { status: "processed" },
    });
  });

  it("records a retryable failure before letting Trigger retry", async () => {
    const { runtime, store, handler } = fixtures();
    handler.apply.mockRejectedValue(new Error("projection failed"));
    await expect(runtime.execute(invocation)).rejects.toThrow(
      "projection failed",
    );
    expect(store.fail).toHaveBeenCalledWith(invocation);
    expect(store.complete).not.toHaveBeenCalled();
  });

  it("returns a completed duplicate without reapplying the projection", async () => {
    const { runtime, store, handler } = fixtures();
    store.claim.mockResolvedValue({
      status: "duplicate",
      output: { status: "processed" },
    });
    await expect(runtime.execute(invocation)).resolves.toEqual({
      status: "processed",
    });
    expect(handler.apply).not.toHaveBeenCalled();
  });
});

describe("production stored-payload dispatch", () => {
  const handler = new ProductionWebhookReplayHandler({
    database: {} as RuntimeDatabase,
    authorizationSecret: "stored-payload-test-secret-at-least-32-bytes",
    tax: new FixtureTaxPort(),
    exceptionRouting: {
      resolve: () => Promise.reject(new Error("not used by support receipt")),
    },
  });

  it("replays the support receipt only when its stored provider binding matches", async () => {
    await expect(handler.apply(event)).resolves.toBeUndefined();
    await expect(
      handler.apply({
        ...event,
        payload: { provider: "foreign", type: "ticket.updated" },
      }),
    ).rejects.toThrow("WEBHOOK_REPLAY_SUPPORT_BINDING_INVALID");
  });

  it("refuses a provider with no production projection", async () => {
    await expect(
      handler.apply({ ...event, provider: "unknown-provider" }),
    ).rejects.toThrow("WEBHOOK_REPLAY_PROVIDER_UNSUPPORTED");
  });
});
