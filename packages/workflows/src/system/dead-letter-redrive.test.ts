import { describe, expect, it } from "vitest";

import type { LifecycleTaskInvocation } from "../onboarding/trigger-runtime";
import {
  deadLetterRedriveInvocation,
  submitDeadLetterRedrive,
} from "./dead-letter-redrive";

const dispatch = {
  outboxMessageId: "8f2b6c4a-6d3f-4d55-9d1e-6b2a0c5f7e11",
  topic: "order.provisioning_requested",
  payload: {
    eventType: "order.provisioning_requested",
    aggregateType: "order",
    aggregateId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    aggregateVersion: 3,
    data: {},
  },
};

const replay = {
  requestedBy: "20000000-0000-4000-8000-000000000001",
  reason: "Provider capacity restored, the command is safe to re-issue",
};

describe("dead letter redrive", () => {
  it("keeps the dispatcher's own invocation key so the redrive re-enters the same run", () => {
    const invocation = deadLetterRedriveInvocation(dispatch, replay);
    expect(invocation).toMatchObject({
      taskId: "lifecycle-provisioning-command-dispatch-v1",
      idempotencyKey: `outbox:${dispatch.outboxMessageId}`,
      payload: dispatch.payload,
      replay,
    });
  });

  it("refuses a replay reason too short to be evidence", () => {
    expect(() =>
      deadLetterRedriveInvocation(dispatch, { ...replay, reason: "no" }),
    ).toThrow("LIFECYCLE_REDRIVE_REASON_REQUIRED");
  });

  it("reports a topic that drives no lifecycle task instead of submitting one", async () => {
    const submitted: LifecycleTaskInvocation[] = [];
    await expect(
      submitDeadLetterRedrive({ ...dispatch, topic: "order.created" }, replay, {
        submit: (invocation) => {
          submitted.push(invocation);
          return Promise.resolve(undefined);
        },
      }),
    ).resolves.toEqual({ status: "unmapped" });
    expect(submitted).toEqual([]);
  });

  it("submits the rebuilt invocation for a mapped topic", async () => {
    const submitted: LifecycleTaskInvocation[] = [];
    const result = await submitDeadLetterRedrive(dispatch, replay, {
      submit: (invocation) => {
        submitted.push(invocation);
        return Promise.resolve(undefined);
      },
    });
    expect(result.status).toBe("submitted");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.replay).toEqual(replay);
  });
});
