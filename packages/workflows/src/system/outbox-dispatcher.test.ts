import { describe, expect, it, vi } from "vitest";

import type { ClaimedOutboxMessage } from "@clockwork/db";

import {
  DurableOutboxDispatcher,
  type OutboxDispatcherStore,
  type OutboxTopicHandler,
} from "./outbox-dispatcher";

function message(topic = "commerce.order.accepted"): ClaimedOutboxMessage {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    eventId: "20000000-0000-4000-8000-000000000001",
    topic,
    payload: { orderId: "30000000-0000-4000-8000-000000000001" },
    attempt: 1,
    leaseToken: "lease-1",
  };
}

function store(claimed: ClaimedOutboxMessage | null): {
  store: OutboxDispatcherStore;
  claimNext: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
} {
  const claimNext = vi.fn().mockResolvedValue(claimed);
  const complete = vi.fn().mockResolvedValue(undefined);
  const fail = vi.fn().mockResolvedValue(undefined);
  return {
    store: {
      claimNext,
      complete,
      fail,
    },
    claimNext,
    complete,
    fail,
  };
}

describe("durable outbox dispatcher", () => {
  it("routes a claimed row and completes it only after delivery", async () => {
    const claimed = message();
    const fixture = store(claimed);
    const handler = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new DurableOutboxDispatcher(
      fixture.store,
      new Map([[claimed.topic, handler]]),
    );

    await expect(dispatcher.dispatchOne("worker-1")).resolves.toEqual({
      status: "delivered",
      messageId: claimed.id,
      topic: claimed.topic,
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `outbox:${claimed.id}` }),
    );
    expect(fixture.complete).toHaveBeenCalledWith(claimed);
    expect(fixture.fail).not.toHaveBeenCalled();
  });

  it("records a safe retry when delivery partially fails", async () => {
    const claimed = message();
    const fixture = store(claimed);
    const dispatcher = new DurableOutboxDispatcher(
      fixture.store,
      new Map([
        [claimed.topic, vi.fn().mockRejectedValue(new Error("secret=live"))],
      ]),
    );

    await expect(dispatcher.dispatchOne("worker-2")).rejects.toThrow(
      "secret=live",
    );
    expect(fixture.fail).toHaveBeenCalledWith(claimed);
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it("defensively rejects a store that returns an unregistered topic", async () => {
    const claimed = message("commerce.unregistered.v1");
    const fixture = store(claimed);
    const dispatcher = new DurableOutboxDispatcher(
      fixture.store,
      new Map([["commerce.order.accepted", vi.fn()]]),
    );

    await expect(dispatcher.dispatchOne("worker-3")).rejects.toThrow(
      "OUTBOX_TOPIC_NOT_CONFIGURED:commerce.unregistered.v1",
    );
    expect(fixture.fail).toHaveBeenCalledWith(claimed);
  });

  it("claims only topics backed by registered handlers", async () => {
    const fixture = store(null);
    const dispatcher = new DurableOutboxDispatcher(
      fixture.store,
      new Map([
        ["organization.created", vi.fn()],
        ["termination.deletion_certificate_requested", vi.fn()],
      ]),
    );

    await dispatcher.dispatchOne("worker-topics");
    expect(fixture.claimNext).toHaveBeenCalledWith({
      workerId: "worker-topics",
      topics: [
        "organization.created",
        "termination.deletion_certificate_requested",
      ],
    });
  });

  it("uses the same downstream key when a recovered delivery is replayed", async () => {
    const first = message();
    const replay = { ...first, attempt: 2, leaseToken: "lease-2" };
    const complete = vi.fn().mockResolvedValue(undefined);
    const claimNext = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(replay);
    const downstreamKeys: string[] = [];
    const handler = vi.fn<OutboxTopicHandler>((input) => {
      downstreamKeys.push(input.idempotencyKey);
      return Promise.resolve();
    });
    const dispatcher = new DurableOutboxDispatcher(
      { claimNext, complete, fail: vi.fn() },
      new Map([[first.topic, handler]]),
    );

    await dispatcher.dispatchOne("worker-1");
    await dispatcher.dispatchOne("worker-2");
    expect(downstreamKeys).toEqual([
      `outbox:${first.id}`,
      `outbox:${first.id}`,
    ]);
  });

  it("drains available rows in one bounded worker run", async () => {
    const first = message();
    const second = {
      ...message(),
      id: "10000000-0000-4000-8000-000000000002",
      eventId: "20000000-0000-4000-8000-000000000002",
    };
    const claimNext = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(null);
    const handler = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new DurableOutboxDispatcher(
      { claimNext, complete: vi.fn(), fail: vi.fn() },
      new Map([[first.topic, handler]]),
    );

    await expect(dispatcher.dispatchBatch("worker-batch", 10)).resolves.toEqual(
      { delivered: 2, idle: true },
    );
    expect(handler).toHaveBeenCalledTimes(2);
    expect(claimNext).toHaveBeenNthCalledWith(1, {
      workerId: "worker-batch:0",
      topics: [first.topic],
    });
    expect(claimNext).toHaveBeenNthCalledWith(3, {
      workerId: "worker-batch:2",
      topics: [first.topic],
    });
  });

  it("stops at the batch limit and rejects unsafe limits", async () => {
    const claimed = message();
    const claimNext = vi.fn().mockResolvedValue(claimed);
    const dispatcher = new DurableOutboxDispatcher(
      { claimNext, complete: vi.fn(), fail: vi.fn() },
      new Map([[claimed.topic, vi.fn().mockResolvedValue(undefined)]]),
    );

    await expect(dispatcher.dispatchBatch("worker-limit", 2)).resolves.toEqual({
      delivered: 2,
      idle: false,
    });
    expect(claimNext).toHaveBeenCalledTimes(2);
    await expect(dispatcher.dispatchBatch("worker-limit", 0)).rejects.toThrow(
      "OUTBOX_BATCH_LIMIT_INVALID",
    );
  });
});
