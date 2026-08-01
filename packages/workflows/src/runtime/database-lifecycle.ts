import { IdempotencyKeySchema } from "@clockwork/contracts";
import type { DatabaseWorkflowRunStore } from "@clockwork/db";
import { isProviderRuntimeDeniedError } from "@clockwork/integrations";

import { payloadHash } from "../core/determinism";
import { LIFECYCLE_RETRY_POLICY } from "../onboarding/durable";
import type {
  LifecycleTaskInvocation,
  LifecycleTaskRuntime,
} from "../onboarding/trigger-runtime";

export interface LifecycleTaskHandler {
  aggregate(invocation: LifecycleTaskInvocation): {
    aggregateId: string;
    aggregateVersion: number;
  };
  execute(invocation: LifecycleTaskInvocation): Promise<unknown>;
}

export class DatabaseLifecycleTaskRuntime implements LifecycleTaskRuntime {
  public constructor(
    private readonly runs: DatabaseWorkflowRunStore,
    private readonly handlers: ReadonlyMap<string, LifecycleTaskHandler>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async claim(
    invocation: LifecycleTaskInvocation,
  ): ReturnType<LifecycleTaskRuntime["claim"]> {
    const handler = this.handlers.get(invocation.taskId);
    if (!handler)
      throw new Error(`WORKFLOW_PROVIDER_NOT_CONFIGURED:${invocation.taskId}`);
    const aggregate = handler.aggregate(invocation);
    const claimed = await this.runs.claim({
      taskId: invocation.taskId,
      invocationKey: IdempotencyKeySchema.parse(invocation.idempotencyKey),
      payloadHash: payloadHash(invocation.payload),
      aggregateId: aggregate.aggregateId,
      aggregateVersion: aggregate.aggregateVersion,
      requestId: `task:${invocation.triggerRunId}`,
      ...(invocation.replay ? { replay: invocation.replay } : {}),
    });
    if (claimed.status === "completed")
      return { status: "duplicate", output: claimed.output };
    if (claimed.status === "acquired")
      return {
        status: "claimed",
        leaseToken: claimed.leaseToken,
      };
    if (claimed.status === "payload_conflict")
      throw new Error("LIFECYCLE_TASK_PAYLOAD_CONFLICT");
    if (claimed.status === "permanent_failure")
      throw new Error("LIFECYCLE_TASK_PREVIOUSLY_FAILED");
    throw new Error("LIFECYCLE_TASK_ALREADY_IN_PROGRESS");
  }

  public execute(invocation: LifecycleTaskInvocation): Promise<unknown> {
    const handler = this.handlers.get(invocation.taskId);
    if (!handler)
      throw new Error(`WORKFLOW_PROVIDER_NOT_CONFIGURED:${invocation.taskId}`);
    return handler.execute(invocation);
  }

  public complete(
    invocation: LifecycleTaskInvocation,
    leaseToken: string,
    output: unknown,
  ): Promise<void> {
    return this.runs.markCompleted({
      invocationKey: IdempotencyKeySchema.parse(invocation.idempotencyKey),
      leaseToken,
      output,
      completedAt: this.clock().toISOString(),
    });
  }

  public fail(
    invocation: LifecycleTaskInvocation,
    leaseToken: string,
    error: unknown,
  ): Promise<void> {
    const invocationKey = IdempotencyKeySchema.parse(invocation.idempotencyKey);
    if (isProviderRuntimeDeniedError(error))
      return this.runs.markPolicyDenied({
        invocationKey,
        leaseToken,
        code: error.code,
      });
    if (invocation.attempt >= LIFECYCLE_RETRY_POLICY.maxAttempts)
      return this.runs.markPermanentFailure({
        invocationKey,
        leaseToken,
        output: { code: "LIFECYCLE_TASK_FAILED" },
        failedAt: this.clock().toISOString(),
      });
    return this.runs.markRetrying({
      invocationKey,
      leaseToken,
      code: "LIFECYCLE_TASK_FAILED",
      failedAt: this.clock().toISOString(),
    });
  }
}
