import type { Actor } from "@clockwork/contracts";
import {
  DatabaseExternalGateActivationTaskStore,
  type ExternalGateActivationTask,
} from "@clockwork/db";
import type {
  ExternalGateActivationTestResult,
  ExternalGateKey,
} from "@clockwork/domain/system";

/**
 * One id, because there is one behaviour.
 *
 * A second `system.external-gates.activation-recovery.v1` id was registered
 * alongside this one from the first commit and never acquired a caller: no
 * route, no cron, no outbox topic map, no dead-letter redrive and no operator
 * control could reach it, and its handler was the activation handler with a
 * different requestId prefix. Recovery is not a separate invocation here --
 * `DurableExternalGateActivationRunner.run` below recovers a `succeeded` or
 * `provider_succeeded` task on whatever invocation arrives next, so the
 * activation id already carries it. Re-adding a recovery id would restate that
 * behaviour rather than add one.
 */
export const externalGateActivationTaskIds = Object.freeze({
  activate: "system.external-gates.activation.v1",
});

export interface DurableGateActivationTaskStore {
  claim(input: {
    taskKey: string;
    gateKey: ExternalGateKey;
    provider: string;
    mode: "live" | "simulator";
    runtimeEnvironment: "development" | "test" | "production";
    requestId: string;
    now: Date;
    leaseMs?: number;
  }): Promise<ExternalGateActivationTask>;
  recordProviderSuccess(input: {
    taskKey: string;
    expectedRowVersion: number;
    leaseToken: string;
    result: ExternalGateActivationTestResult;
    requestId: string;
    now: Date;
  }): Promise<ExternalGateActivationTask>;
  recordProviderFailure(input: {
    taskKey: string;
    expectedRowVersion: number;
    leaseToken: string;
    error: unknown;
    maxAttempts: number;
    requestId: string;
    now: Date;
    retryAt: Date;
  }): Promise<ExternalGateActivationTask>;
  finalize(input: {
    taskKey: string;
    leaseToken: string;
    actor: Actor;
    requestId: string;
    now: Date;
  }): Promise<{ task: ExternalGateActivationTask; gate: unknown }>;
}

export interface ExternalGateActivationRunInput {
  taskKey: string;
  gateKey: ExternalGateKey;
  provider: string;
  mode: "live" | "simulator";
  runtimeEnvironment: "development" | "test" | "production";
  actor: Actor;
  requestId: string;
  probe(): Promise<ExternalGateActivationTestResult>;
  afterProviderSuccessPersisted?: () => Promise<void>;
}

/**
 * Persists intent before HTTP, persists the provider result before local gate
 * state, and recovers that result after lease expiry without a second probe.
 */
export class DurableExternalGateActivationRunner {
  public constructor(
    private readonly store: DurableGateActivationTaskStore,
    private readonly clock: () => Date = () => new Date(),
    private readonly options: {
      leaseMs?: number;
      maxAttempts?: number;
      retryDelayMs?: number;
    } = {},
  ) {}

  public async run(input: ExternalGateActivationRunInput) {
    if (input.runtimeEnvironment === "production" && input.mode !== "live")
      throw new Error("EXTERNAL_GATE_PRODUCTION_SIMULATOR_FORBIDDEN");
    const claimedAt = this.clock();
    const task = await this.store.claim({
      taskKey: input.taskKey,
      gateKey: input.gateKey,
      provider: input.provider,
      mode: input.mode,
      runtimeEnvironment: input.runtimeEnvironment,
      requestId: `${input.requestId}:claim`,
      now: claimedAt,
      ...(this.options.leaseMs ? { leaseMs: this.options.leaseMs } : {}),
    });
    if (task.status === "succeeded") return { task, recovered: true };
    if (!task.leaseToken)
      throw new Error("EXTERNAL_GATE_ACTIVATION_LEASE_MISSING");
    if (task.status === "provider_succeeded") {
      const result = await this.store.finalize({
        taskKey: task.taskKey,
        leaseToken: task.leaseToken,
        actor: input.actor,
        requestId: `${input.requestId}:recover`,
        now: this.clock(),
      });
      return { ...result, recovered: true };
    }
    if (task.status !== "probing")
      throw new Error(
        `EXTERNAL_GATE_ACTIVATION_TASK_NOT_CLAIMED:${task.status}`,
      );
    let probeResult: ExternalGateActivationTestResult;
    try {
      probeResult = await input.probe();
    } catch (error) {
      const now = this.clock();
      await this.store.recordProviderFailure({
        taskKey: task.taskKey,
        expectedRowVersion: task.rowVersion,
        leaseToken: task.leaseToken,
        error,
        maxAttempts: this.options.maxAttempts ?? 3,
        requestId: `${input.requestId}:probe-failed`,
        now,
        retryAt: new Date(
          now.getTime() + (this.options.retryDelayMs ?? 30_000),
        ),
      });
      throw error;
    }
    const providerSucceeded = await this.store.recordProviderSuccess({
      taskKey: task.taskKey,
      expectedRowVersion: task.rowVersion,
      leaseToken: task.leaseToken,
      result: probeResult,
      requestId: `${input.requestId}:provider-succeeded`,
      now: this.clock(),
    });
    if (input.afterProviderSuccessPersisted)
      await input.afterProviderSuccessPersisted();
    if (!providerSucceeded.leaseToken)
      throw new Error("EXTERNAL_GATE_ACTIVATION_LEASE_MISSING");
    const result = await this.store.finalize({
      taskKey: providerSucceeded.taskKey,
      leaseToken: providerSucceeded.leaseToken,
      actor: input.actor,
      requestId: `${input.requestId}:finalize`,
      now: this.clock(),
    });
    return { ...result, recovered: false };
  }
}

export function createDatabaseExternalGateActivationRunner(
  database: ConstructorParameters<
    typeof DatabaseExternalGateActivationTaskStore
  >[0],
  clock?: () => Date,
) {
  return new DurableExternalGateActivationRunner(
    new DatabaseExternalGateActivationTaskStore(database),
    clock,
  );
}

export function activationTaskKey(input: {
  gateKey: ExternalGateKey;
  provider: string;
  now: Date;
}): string {
  return `external-gate:${input.gateKey}:${input.provider}:${input.now
    .toISOString()
    .slice(0, 10)}`;
}
