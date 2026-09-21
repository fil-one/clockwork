import { describe, expect, it } from "vitest";

import { SqsTaskSubmitter } from "./sqs-submitter";
import {
  configuredTaskRuntime,
  resolveTaskSubmitter,
  taskSubmitterConfigured,
} from "./submitter";
import { TriggerTaskSubmitter } from "./trigger-submitter";

const triggerEnvironment = {
  TRIGGER_PROJECT_REF: "proj_clockwork_test",
  TRIGGER_SECRET_KEY: "tr_test_clockwork_1234567890",
};

const sqsEnvironment = {
  CLOCKWORK_TASK_RUNTIME: "sqs",
  AWS_REGION: "us-east-1",
  WORKFLOWS_QUEUE_ID:
    "https://sqs.us-east-1.amazonaws.com/000000000000/clockwork-workflows.fifo",
};

describe("task submitter selection", () => {
  it("defaults to Trigger so an existing deployment is unchanged", () => {
    expect(configuredTaskRuntime({})).toBe("trigger");
    expect(resolveTaskSubmitter(triggerEnvironment)).toBeInstanceOf(
      TriggerTaskSubmitter,
    );
  });

  it("selects the queue submitter on CLOCKWORK_TASK_RUNTIME=sqs", () => {
    expect(resolveTaskSubmitter(sqsEnvironment)).toBeInstanceOf(
      SqsTaskSubmitter,
    );
  });

  it("refuses an unknown runtime rather than falling back to a default", () => {
    expect(() =>
      resolveTaskSubmitter({ CLOCKWORK_TASK_RUNTIME: "kafka" }),
    ).toThrow("TASK_RUNTIME_INVALID:kafka");
  });

  it("requires the queue address the selected runtime submits to", () => {
    expect(() =>
      resolveTaskSubmitter({ CLOCKWORK_TASK_RUNTIME: "sqs" }),
    ).toThrow("WORKFLOWS_QUEUE_ID");
  });

  it("reports whether the selected runtime can accept a submission", () => {
    expect(taskSubmitterConfigured(triggerEnvironment)).toBe(true);
    expect(taskSubmitterConfigured({ TRIGGER_SECRET_KEY: "tr_only" })).toBe(
      false,
    );
    expect(taskSubmitterConfigured(sqsEnvironment)).toBe(true);
    expect(taskSubmitterConfigured({ CLOCKWORK_TASK_RUNTIME: "sqs" })).toBe(
      false,
    );
    // An unusable value is a misconfiguration to report, not a crash at import.
    expect(taskSubmitterConfigured({ CLOCKWORK_TASK_RUNTIME: "kafka" })).toBe(
      false,
    );
  });
});
