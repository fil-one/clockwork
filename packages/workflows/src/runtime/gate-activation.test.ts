import { describe, expect, it, vi } from "vitest";

import type { ExternalGateActivationTask } from "@clockwork/db";

import {
  DurableExternalGateActivationRunner,
  type DurableGateActivationTaskStore,
} from "./gate-activation";

const actor = { kind: "system" as const, id: "activation-runner" };

class CrashAwareTaskStore implements DurableGateActivationTaskStore {
  public task: ExternalGateActivationTask | undefined;
  private sequence = 0;

  public claim(input: Parameters<DurableGateActivationTaskStore["claim"]>[0]) {
    if (
      this.task?.leaseUntil &&
      Date.parse(this.task.leaseUntil) > input.now.getTime()
    )
      return Promise.reject(new Error("EXTERNAL_GATE_ACTIVATION_TASK_BUSY"));
    const leaseToken = `00000000-0000-4000-8000-${String(++this.sequence).padStart(12, "0")}`;
    this.task = {
      id: "10000000-0000-4000-8000-000000000001",
      taskKey: input.taskKey,
      gateKey: input.gateKey,
      provider: input.provider,
      mode: input.mode,
      status:
        this.task?.status === "provider_succeeded"
          ? "provider_succeeded"
          : "probing",
      attemptCount: this.task?.attemptCount ?? 1,
      probeResult: this.task?.probeResult ?? null,
      lastError: null,
      nextAttemptAt: null,
      leaseToken,
      leaseUntil: new Date(
        input.now.getTime() + (input.leaseMs ?? 1_000),
      ).toISOString(),
      completedAt: null,
      rowVersion: (this.task?.rowVersion ?? 0) + 1,
    };
    return Promise.resolve(this.task);
  }

  public recordProviderSuccess(
    input: Parameters<
      DurableGateActivationTaskStore["recordProviderSuccess"]
    >[0],
  ) {
    if (!this.task || this.task.leaseToken !== input.leaseToken)
      return Promise.reject(new Error("STALE"));
    this.task = {
      ...this.task,
      status: "provider_succeeded",
      probeResult: input.result,
      rowVersion: this.task.rowVersion + 1,
    };
    return Promise.resolve(this.task);
  }

  public recordProviderFailure() {
    return Promise.reject(new Error("unexpected failure"));
  }

  public finalize(
    input: Parameters<DurableGateActivationTaskStore["finalize"]>[0],
  ) {
    if (!this.task || this.task.leaseToken !== input.leaseToken)
      return Promise.reject(new Error("STALE"));
    this.task = {
      ...this.task,
      status: "succeeded",
      leaseToken: null,
      leaseUntil: null,
      completedAt: input.now.toISOString(),
      rowVersion: this.task.rowVersion + 1,
    };
    return Promise.resolve({
      task: this.task,
      gate: { activationAllowed: true },
    });
  }
}

describe("durable external-gate activation", () => {
  it("recovers provider success after a simulated crash and lease expiry without probing twice", async () => {
    const store = new CrashAwareTaskStore();
    let now = new Date("2026-07-31T16:00:00.000Z");
    const runner = new DurableExternalGateActivationRunner(store, () => now, {
      leaseMs: 1_000,
    });
    const probe = vi.fn(() =>
      Promise.resolve({
        status: "passed" as const,
        testedAt: now.toISOString(),
        testedBy: "bounded-http-probe",
        evidenceReference: "evidence://activation/runtime-proof",
        simulatorState: "ready" as const,
        simulatorDetails: "bounded provider contract passed",
      }),
    );
    const request = {
      taskKey: "external-gate:EXT-ACC-01:billing:2026-07-31",
      gateKey: "EXT-ACC-01" as const,
      provider: "billing",
      mode: "live" as const,
      runtimeEnvironment: "production" as const,
      actor,
      requestId: "runtime-activation-proof",
      probe,
    };
    await expect(
      runner.run({
        ...request,
        afterProviderSuccessPersisted: () =>
          Promise.reject(new Error("SIMULATED_PROCESS_CRASH")),
      }),
    ).rejects.toThrow("SIMULATED_PROCESS_CRASH");
    expect(store.task?.status).toBe("provider_succeeded");
    await expect(runner.run(request)).rejects.toThrow(
      "EXTERNAL_GATE_ACTIVATION_TASK_BUSY",
    );
    now = new Date("2026-07-31T16:00:01.001Z");
    await expect(runner.run(request)).resolves.toMatchObject({
      recovered: true,
      task: { status: "succeeded" },
    });
    expect(probe).toHaveBeenCalledOnce();
  });

  it("denies production simulators before any durable/provider work", async () => {
    const store = new CrashAwareTaskStore();
    const runner = new DurableExternalGateActivationRunner(store);
    const probe = vi.fn();
    await expect(
      runner.run({
        taskKey: "external-gate:EXT-ACC-01:billing:2026-07-31",
        gateKey: "EXT-ACC-01",
        provider: "billing",
        mode: "simulator",
        runtimeEnvironment: "production",
        actor,
        requestId: "production-simulator-denial",
        probe,
      }),
    ).rejects.toThrow("EXTERNAL_GATE_PRODUCTION_SIMULATOR_FORBIDDEN");
    expect(probe).not.toHaveBeenCalled();
  });
});
