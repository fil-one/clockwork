import { describe, expect, it, vi } from "vitest";

import type { ClaimedOutboxMessage } from "@clockwork/db";
import {
  ClockworkTelemetry,
  InMemoryTelemetrySink,
  RuntimeBoundaryInstrumentation,
} from "@clockwork/integrations";

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

  it("parent-links queue delivery, outbox dispatch, and complete durable correlation", async () => {
    const claimed = message();
    const fixture = store(claimed);
    const sink = new InMemoryTelemetrySink();
    const dispatcher = new DurableOutboxDispatcher(
      fixture.store,
      new Map([[claimed.topic, vi.fn().mockResolvedValue(undefined)]]),
      new RuntimeBoundaryInstrumentation(new ClockworkTelemetry(sink)),
    );

    await dispatcher.dispatchOne("worker-correlated");

    const delivery = sink.spans.find(
      (span) => span.name === "queue.outbox.deliver",
    );
    const outbox = sink.spans.find((span) => span.name === "outbox.dispatch");
    expect(delivery).toBeDefined();
    expect(outbox).toBeDefined();
    expect(outbox?.traceId).toBe(delivery?.traceId);
    expect(outbox?.parentSpanId).toBe(delivery?.spanId);
    for (const span of [delivery, outbox])
      expect(span?.attributes).toMatchObject({
        "clockwork.request.id": `outbox:${claimed.id}`,
        "clockwork.workflow.id": claimed.topic,
        "clockwork.task.id": "worker-correlated",
        "clockwork.audit.id": claimed.eventId,
        "clockwork.outbox.id": claimed.id,
      });
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

  /**
   * Contract pin, not a nicety. The outbox is the durable delivery record for
   * the whole audit log, not a work queue: ADR 0005 appends an
   * `outbox_messages` row inside the same transaction as every `audit_events`
   * row, and `appendAuditAndOutbox` defaults the topic to the event type. The
   * dispatch map is the exception, not the rule -- `lifecycle-task-dispatch.ts`
   * says so outright: "Only domain events with an immediate task have outbox
   * dispatch mappings." So the great majority of topics in the table have no
   * handler by design and never will.
   *
   * A dispatcher that claimed *without* the topic filter in order to fail and
   * eventually dead-letter whatever it could not route would therefore march
   * every audit-only row up the eight-attempt ladder in
   * `DatabaseOutboxDispatcherStore` -- on a one-minute cron -- writing a
   * `workflow_runs` row per message, stamping `OUTBOX_DISPATCH_DEAD_LETTERED`
   * on rows that are working exactly as designed, and burying the dead-letter
   * surface the runbooks depend on. It would also mutate `attempt_count` and
   * `available_at` on the audit stream's own delivery record.
   *
   * Hence the invariant pinned here: every claim this dispatcher issues is
   * filtered to its registered topics, and an empty routable queue ends the
   * run. The mock returns a stranded row for any unfiltered claim, so
   * reintroducing that survey fails this test on all three assertions.
   */
  it("never claims outside its registered topics, leaving audit-only rows untouched", async () => {
    const auditOnly = message("core.accounts.create");
    const claimNext = vi.fn(
      (input: {
        workerId: string;
        topics?: readonly string[];
      }): Promise<ClaimedOutboxMessage | null> =>
        Promise.resolve(input.topics ? null : auditOnly),
    );
    const fail = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new DurableOutboxDispatcher(
      { claimNext, complete: vi.fn(), fail },
      new Map([["commerce.order.accepted", vi.fn()]]),
    );

    await expect(
      dispatcher.dispatchBatch("worker-audit-only"),
    ).resolves.toEqual({ delivered: 0, idle: true });
    for (const [input] of claimNext.mock.calls)
      expect(input.topics).toEqual(["commerce.order.accepted"]);
    expect(fail).not.toHaveBeenCalled();
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
