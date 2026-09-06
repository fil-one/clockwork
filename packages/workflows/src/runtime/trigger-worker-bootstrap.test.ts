import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activateTriggerWorkerRuntime,
  createEnvironmentProductionWorkflowRuntime,
  resetTriggerWorkerBootstrapForTests,
  triggerWorkerBootstrapStatus,
  validateTriggerWorkerEnvironment,
  WorkflowBootstrapConfigurationError,
} from "./trigger-worker-bootstrap";

afterEach(() => resetTriggerWorkerBootstrapForTests());

const validEnvironment = {
  NODE_ENV: "test",
  DIRECT_DATABASE_URL:
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  TRIGGER_PROJECT_REF: "proj_clockwork_test",
  TRIGGER_SECRET_KEY: "tr_test_clockwork_1234567890",
};

describe("Trigger production worker bootstrap", () => {
  it("constructs and activates a runtime exactly once", async () => {
    const activate = vi.fn();
    const load = vi.fn(() => Promise.resolve({ activate }));

    const [first, second] = await Promise.all([
      activateTriggerWorkerRuntime(load),
      activateTriggerWorkerRuntime(load),
    ]);

    expect(first).toBe(second);
    expect(load).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
    expect(triggerWorkerBootstrapStatus()).toBe("active");
  });

  it("fails closed on missing worker or live provider environment", async () => {
    expect(() => validateTriggerWorkerEnvironment({})).toThrow(
      "WORKFLOW_BOOTSTRAP_INCOMPLETE:NODE_ENV",
    );
    const failure: unknown = await createEnvironmentProductionWorkflowRuntime({
      source: validEnvironment,
      readCapabilities: () =>
        Promise.resolve([
          {
            capabilityKey: "new_business",
            enabled: true,
            recoveryEnabled: false,
          },
        ]),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WorkflowBootstrapConfigurationError);
    if (!(failure instanceof WorkflowBootstrapConfigurationError))
      throw new Error("Expected a workflow bootstrap configuration error");
    expect(failure.code).toBe("WORKFLOW_BOOTSTRAP_INCOMPLETE");
    expect(failure.missing).toContain("WORKFLOW_PROVIDER_CONTROL_BASE_URL");
  });

  it("never leaves a failed production runtime dormant", async () => {
    const failure = new WorkflowBootstrapConfigurationError(
      ["notifications"],
      ["EXT-PROVIDER-01"],
    );
    const load = vi.fn(() => Promise.reject(failure));

    await expect(activateTriggerWorkerRuntime(load)).rejects.toBe(failure);
    expect(triggerWorkerBootstrapStatus()).toBe("inactive");
    expect(load).toHaveBeenCalledOnce();
  });
});
