import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureLifecycleTaskRuntime,
  executeLifecycleTask,
  resetLifecycleTaskRuntimeForTests,
  taskInvocation,
} from "./trigger-runtime";

afterEach(() => resetLifecycleTaskRuntimeForTests());

describe("Trigger lifecycle runtime", () => {
  it("derives a stable invocation key independently of object key order", () => {
    const first = taskInvocation({
      taskId: "lifecycle-test-v1",
      triggerRunId: "run-1",
      attempt: 1,
      payload: { b: 2, a: 1 },
    });
    const retry = taskInvocation({
      taskId: "lifecycle-test-v1",
      triggerRunId: "run-2",
      attempt: 4,
      payload: { a: 1, b: 2 },
    });
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("persists claim, execution, and completion and returns durable duplicates", async () => {
    const claim = vi
      .fn()
      .mockResolvedValueOnce({ status: "claimed", leaseToken: "lease-1" })
      .mockResolvedValueOnce({ status: "duplicate", output: { ok: true } });
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const complete = vi.fn().mockResolvedValue(undefined);
    configureLifecycleTaskRuntime({
      claim,
      execute,
      complete,
      fail: vi.fn(),
    });
    const invocation = taskInvocation({
      taskId: "lifecycle-test-v1",
      triggerRunId: "run-1",
      attempt: 1,
      payload: { idempotencyKey: "lifecycle-effect-0001" },
    });
    await expect(executeLifecycleTask(invocation)).resolves.toEqual({
      ok: true,
    });
    await expect(executeLifecycleTask(invocation)).resolves.toEqual({
      ok: true,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(invocation, "lease-1", { ok: true });
  });

  it("persists failed attempts before allowing Trigger retry", async () => {
    const fail = vi.fn().mockResolvedValue(undefined);
    configureLifecycleTaskRuntime({
      claim: vi
        .fn()
        .mockResolvedValue({ status: "claimed", leaseToken: "lease-2" }),
      execute: vi.fn().mockRejectedValue(new Error("provider timeout")),
      complete: vi.fn(),
      fail,
    });
    const invocation = taskInvocation({
      taskId: "lifecycle-test-v1",
      triggerRunId: "run-1",
      attempt: 1,
      payload: {},
    });
    await expect(executeLifecycleTask(invocation)).rejects.toThrow(
      "provider timeout",
    );
    expect(fail).toHaveBeenCalledWith(invocation, "lease-2", expect.any(Error));
  });
});
