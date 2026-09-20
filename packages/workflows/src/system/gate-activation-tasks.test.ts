import { describe, expect, it } from "vitest";

import type { TaskSubmission } from "../tasks/submitter";
import { QueuedExternalGateActivationTaskSubmitter } from "./gate-activation-tasks";

const submissions: TaskSubmission[] = [];

const runtime = {
  submit: (input: TaskSubmission) => {
    submissions.push(input);
    return Promise.resolve({ runId: "run_1" });
  },
};

const request = {
  gateKey: "EXT-PROVIDER-01" as const,
  expectedGateRowVersion: 4,
  taskKey: "gate-activation-task-key",
  provider: "notifications",
  idempotencyKey: "gate:EXT-PROVIDER-01:4",
  requestId: "request-1",
  now: new Date("2026-09-15T12:00:00.000Z"),
};

describe("queued external gate activation submitter", () => {
  it("returns the queued receipt the API answers with", async () => {
    submissions.length = 0;

    const receipt = await new QueuedExternalGateActivationTaskSubmitter(
      runtime,
    ).enqueue({ ...request, actor: { kind: "user", id: crypto.randomUUID() } });

    expect(receipt).toMatchObject({
      runId: "run_1",
      taskKey: "gate-activation-task-key",
      gateKey: "EXT-PROVIDER-01",
      provider: "notifications",
      expectedGateRowVersion: 4,
      status: "queued",
      submittedAt: "2026-09-15T12:00:00.000Z",
    });
    expect(submissions[0]).toMatchObject({
      taskId: "system.external-gates.activation.v1",
      idempotencyKey: "gate:EXT-PROVIDER-01:4",
    });
  });

  it("refuses an activation no operator asked for", async () => {
    await expect(
      new QueuedExternalGateActivationTaskSubmitter(runtime).enqueue({
        ...request,
        actor: { kind: "system", id: "scheduler" },
      }),
    ).rejects.toThrow("EXTERNAL_GATE_ACTIVATION_OPERATOR_REQUIRED");
  });
});
