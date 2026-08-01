import { describe, expect, it, vi } from "vitest";

import type { CoreWorkflowTaskDispatch } from "@clockwork/db";

import {
  createCoreScheduledOutboxHandlerWithStore,
  type CoreScheduledDispatchStore,
} from "./scheduled-outbox-handler";

const occurrenceId = "10000000-0000-4000-8000-000000000001";
const ledgerId = "20000000-0000-4000-8000-000000000001";
const organizationId = "30000000-0000-4000-8000-000000000001";

function delivery() {
  return {
    messageId: "40000000-0000-4000-8000-000000000001",
    eventId: "50000000-0000-4000-8000-000000000001",
    topic: "core.schedule.dispatch.v1",
    idempotencyKey: "outbox:40000000-0000-4000-8000-000000000001",
    payload: {
      eventType: "core.schedule.dispatch_requested",
      aggregateType: "workflow_run",
      aggregateId: occurrenceId,
      aggregateVersion: 1,
      occurredAt: "2026-07-31T02:30:00.000Z",
      requestId: "scheduled-request-0001",
      data: {
        scheduleId: "core.schedule.usage-reconciliation.v1",
        scheduledAt: "2026-07-31T02:30:00.000Z",
      },
    },
  };
}

function usageDispatch(): CoreWorkflowTaskDispatch {
  return {
    taskId: "core.reconciliation.usage.v1",
    idempotencyKey: `outbox:usage:${ledgerId}:v2`,
    payload: {
      context: {
        aggregateId: ledgerId,
        aggregateVersion: 2,
        requestId: "40000000-0000-4000-8000-000000000001",
        occurredAt: "2026-07-31T02:30:00.000Z",
      },
      ledgerId,
      organizationId,
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-31T00:00:00.000Z",
      expected: [
        { sku: "storage", quantity: "10", sourceUsageIds: ["usage-1"] },
      ],
    },
  };
}

describe("scheduled core outbox dispatch", () => {
  it("reads persisted dispatches and preserves their recovery key", async () => {
    const buildDueDispatches = vi.fn().mockResolvedValue([usageDispatch()]);
    const submit = vi.fn().mockResolvedValue({ runId: "trigger-run-1" });
    const handler = createCoreScheduledOutboxHandlerWithStore({
      store: { buildDueDispatches },
      submit: { submit },
    });

    await handler(delivery());
    await handler(delivery());

    expect(buildDueDispatches).toHaveBeenNthCalledWith(1, {
      scheduleId: "core.schedule.usage-reconciliation.v1",
      occurrenceId,
      scheduledAt: "2026-07-31T02:30:00.000Z",
      requestId: "40000000-0000-4000-8000-000000000001",
      idempotencyPrefix: "outbox:40000000-0000-4000-8000-000000000001",
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]?.[0]).toEqual(submit.mock.calls[1]?.[0]);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      taskId: "core.reconciliation.usage.v1",
      idempotencyKey: `outbox:usage:${ledgerId}:v2`,
    });
  });

  it("does not submit malformed or caller-derived task truth", async () => {
    const forged: CoreWorkflowTaskDispatch = {
      ...usageDispatch(),
      payload: {
        ...(usageDispatch().payload as Record<string, unknown>),
        organizationId: "caller-controlled",
      },
    };
    const store: CoreScheduledDispatchStore = {
      buildDueDispatches: () => Promise.resolve([forged]),
    };
    const submit = vi.fn();
    const handler = createCoreScheduledOutboxHandlerWithStore({
      store,
      submit: { submit },
    });
    await expect(handler(delivery())).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects a forged schedule timestamp before scanning", async () => {
    const buildDueDispatches = vi.fn();
    const handler = createCoreScheduledOutboxHandlerWithStore({
      store: { buildDueDispatches },
      submit: { submit: vi.fn() },
    });
    const forged = delivery();
    forged.payload.data.scheduledAt = "2026-08-01T02:30:00.000Z";
    await expect(handler(forged)).rejects.toThrow(
      "CORE_SCHEDULE_EVENT_TIME_MISMATCH",
    );
    expect(buildDueDispatches).not.toHaveBeenCalled();
  });
});
