import { describe, expect, it, vi } from "vitest";

import { TriggerTaskSubmitter } from "./trigger-submitter";

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

describe("Trigger task submitter", () => {
  it("scopes the idempotency key globally and returns the run id", async () => {
    sdk.submissions.length = 0;

    const receipt = await new TriggerTaskSubmitter().submit({
      taskId: "lifecycle-offboarding-teardown-v1",
      payload: { eventType: "termination.approved" },
      idempotencyKey: "outbox:80000000-0000-4000-8000-000000000001",
    });

    expect(receipt).toEqual({ runId: "run_1" });
    expect(sdk.submissions).toEqual([
      {
        id: "lifecycle-offboarding-teardown-v1",
        payload: { eventType: "termination.approved" },
        options: {
          idempotencyKey: {
            key: "outbox:80000000-0000-4000-8000-000000000001",
            scope: { scope: "global" },
          },
        },
      },
    ]);
  });

  it("ignores the group key, which only orders a queue-backed runtime", async () => {
    sdk.submissions.length = 0;

    await new TriggerTaskSubmitter().submit({
      taskId: "lifecycle-pocs-conversion-v1",
      payload: null,
      idempotencyKey: "outbox:80000000-0000-4000-8000-000000000002",
      groupKey: "poc-lane-3",
    });

    expect(sdk.submissions[0]?.payload).toBeNull();
  });
});
