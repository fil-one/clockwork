import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeDatabase } from "@clockwork/db";

import { triggerWorkerBootstrapStatus } from "./trigger-worker-bootstrap";
import {
  activateWorkflowRuntime,
  createWorkflowRuntime,
  resetWorkflowRuntimeBootstrapForTests,
  validateWorkflowRuntimeEnvironment,
  WorkflowBootstrapConfigurationError,
  workflowRuntimeStatus,
} from "./workflow-runtime";

afterEach(() => resetWorkflowRuntimeBootstrapForTests());

describe("workflow runtime bootstrap", () => {
  it("asks only for the runtime environment, not for a queue vendor", () => {
    expect(validateWorkflowRuntimeEnvironment({ NODE_ENV: "test" })).toEqual({
      runtimeEnvironment: "test",
    });
    expect(() => validateWorkflowRuntimeEnvironment({})).toThrow(
      "WORKFLOW_BOOTSTRAP_INCOMPLETE:NODE_ENV",
    );
    expect(() =>
      validateWorkflowRuntimeEnvironment({ NODE_ENV: "staging" }),
    ).toThrow("WORKFLOW_BOOTSTRAP_INCOMPLETE:NODE_ENV");
  });

  it("builds adapters from a database the host already owns", async () => {
    // The host supplies the pool -- the Trigger worker its own direct
    // connection, the web process its service pool -- so nothing here reads
    // DIRECT_DATABASE_URL.
    const failure: unknown = await createWorkflowRuntime({
      db: {} as RuntimeDatabase,
      source: { NODE_ENV: "test" },
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
    expect(failure.missing).toContain("WORKFLOW_PROVIDER_CONTROL_BASE_URL");
  });

  it("constructs and activates a runtime exactly once", async () => {
    const activate = vi.fn();
    const load = vi.fn(() => Promise.resolve({ activate }));

    const [first, second] = await Promise.all([
      activateWorkflowRuntime(load),
      activateWorkflowRuntime(load),
    ]);

    expect(first).toBe(second);
    expect(load).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
    expect(workflowRuntimeStatus()).toBe("active");
    // One activation serves both hosts: the Trigger worker's entry point is
    // this one under its historical name.
    expect(triggerWorkerBootstrapStatus()).toBe("active");
  });

  it("never leaves a failed runtime dormant", async () => {
    const failure = new WorkflowBootstrapConfigurationError(
      ["notifications"],
      ["EXT-PROVIDER-01"],
    );
    const load = vi.fn(() => Promise.reject(failure));

    await expect(activateWorkflowRuntime(load)).rejects.toBe(failure);
    expect(workflowRuntimeStatus()).toBe("inactive");
  });
});
