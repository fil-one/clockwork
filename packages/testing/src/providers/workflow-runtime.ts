import { createHash } from "node:crypto";

import type {
  AuthoritativeLifecycleTaskStore,
  LifecyclePreparedEffect,
  LifecycleTaskExecutionSpec,
} from "@clockwork/workflows";

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24)}`;
}

export class DeterministicAuthoritativeLifecycleTaskStore implements AuthoritativeLifecycleTaskStore {
  public readonly invocations: {
    taskId: string;
    aggregateId: string;
    scheduled: boolean;
    requestId: string;
  }[] = [];
  private readonly effects = new Map<
    string,
    | { status: "provider_succeeded"; reference: string; output?: unknown }
    | { status: "committed"; reference: string; output?: unknown }
    | { status: "permanent_failure"; code: string }
  >();

  public prepare(input: {
    spec: LifecycleTaskExecutionSpec;
    aggregateId: string;
    expectedAggregateVersion: number;
    scheduled: boolean;
    requestId: string;
  }): Promise<readonly LifecyclePreparedEffect[]> {
    this.invocations.push({
      taskId: input.spec.taskId,
      aggregateId: input.aggregateId,
      scheduled: input.scheduled,
      requestId: input.requestId,
    });
    return Promise.resolve([
      {
        effectKey: stableId("effect_sim", {
          taskId: input.spec.taskId,
          aggregateId: input.aggregateId,
          aggregateVersion: input.expectedAggregateVersion,
        }),
        taskId: input.spec.taskId,
        aggregateId: input.aggregateId,
        aggregateVersion: input.expectedAggregateVersion,
        loader: input.spec.loader,
        transition: input.spec.transition,
        effectBoundary: input.spec.effectBoundary,
        persistedState: {},
      },
    ]);
  }

  public claimEffect(input: {
    effect: LifecyclePreparedEffect;
    requestId: string;
  }) {
    const state = this.effects.get(input.effect.effectKey);
    if (state?.status === "provider_succeeded")
      return Promise.resolve({
        status: "provider_succeeded" as const,
        leaseToken: stableId("lease_sim", input.effect.effectKey),
        reference: state.reference,
        ...(state.output === undefined ? {} : { output: state.output }),
      });
    if (state?.status === "committed")
      return Promise.resolve({
        status: "committed" as const,
        reference: state.reference,
        ...(state.output === undefined ? {} : { output: state.output }),
      });
    if (state?.status === "permanent_failure") return Promise.resolve(state);
    return Promise.resolve({
      status: "invoke" as const,
      leaseToken: stableId("lease_sim", input.effect.effectKey),
    });
  }

  public checkpointEffectSuccess(input: {
    effect: LifecyclePreparedEffect;
    leaseToken: string;
    reference: string;
    output?: unknown;
    requestId: string;
  }): Promise<void> {
    this.effects.set(input.effect.effectKey, {
      status: "provider_succeeded",
      reference: input.reference,
      ...(input.output === undefined ? {} : { output: input.output }),
    });
    return Promise.resolve();
  }

  public finalizeEffect(input: {
    effect: LifecyclePreparedEffect;
    leaseToken: string;
    reference: string;
    output?: unknown;
    requestId: string;
  }): Promise<void> {
    this.effects.set(input.effect.effectKey, {
      status: "committed",
      reference: input.reference,
      ...(input.output === undefined ? {} : { output: input.output }),
    });
    return Promise.resolve();
  }

  public failEffect(input: {
    effect: LifecyclePreparedEffect;
    leaseToken: string;
    failure: {
      kind: "transient" | "permanent";
      code: string;
      message: string;
    };
    requestId: string;
  }): Promise<void> {
    if (input.failure.kind === "permanent")
      this.effects.set(input.effect.effectKey, {
        status: "permanent_failure",
        code: input.failure.code,
      });
    else this.effects.delete(input.effect.effectKey);
    return Promise.resolve();
  }
}
