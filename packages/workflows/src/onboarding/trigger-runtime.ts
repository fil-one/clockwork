import { createHash } from "node:crypto";

import { schedules, task } from "@trigger.dev/sdk";

import { LIFECYCLE_RETRY_POLICY } from "./durable";

export interface LifecycleTaskInvocation {
  taskId: string;
  triggerRunId: string;
  attempt: number;
  idempotencyKey: string;
  payload: unknown;
  replay?: LifecycleTaskReplay | undefined;
}

export interface LifecycleTaskReplay {
  requestedBy: string;
  reason: string;
  ticketReference?: string | undefined;
}

export interface LifecycleTaskRuntime {
  claim(
    invocation: LifecycleTaskInvocation,
  ): Promise<
    | { status: "claimed"; leaseToken: string }
    | { status: "duplicate"; output: unknown }
  >;
  execute(invocation: LifecycleTaskInvocation): Promise<unknown>;
  complete(
    invocation: LifecycleTaskInvocation,
    leaseToken: string,
    output: unknown,
  ): Promise<void>;
  fail(
    invocation: LifecycleTaskInvocation,
    leaseToken: string,
    error: unknown,
  ): Promise<void>;
}

let configuredRuntime: LifecycleTaskRuntime | undefined;

/** Configure once in the Trigger worker bootstrap with a workflow_runs-backed runtime. */
export function configureLifecycleTaskRuntime(
  runtime: LifecycleTaskRuntime,
): void {
  if (configuredRuntime && configuredRuntime !== runtime)
    throw new Error("LIFECYCLE_TASK_RUNTIME_ALREADY_CONFIGURED");
  configuredRuntime = runtime;
}

export function resetLifecycleTaskRuntimeForTests(): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("TASK_RUNTIME_RESET_FORBIDDEN");
  configuredRuntime = undefined;
}

function stablePayload(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stablePayload).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stablePayload(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function suppliedIdempotencyKey(payload: unknown): string | undefined {
  if (
    payload &&
    typeof payload === "object" &&
    "idempotencyKey" in payload &&
    typeof payload.idempotencyKey === "string" &&
    payload.idempotencyKey.length >= 16
  )
    return payload.idempotencyKey;
  return undefined;
}

export function taskInvocation(input: {
  taskId: string;
  triggerRunId: string;
  attempt: number;
  payload: unknown;
}): LifecycleTaskInvocation {
  const idempotencyKey =
    suppliedIdempotencyKey(input.payload) ??
    `lifecycle-task:${createHash("sha256")
      .update(input.taskId)
      .update("\0")
      .update(stablePayload(input.payload))
      .digest("hex")}`;
  return { ...input, idempotencyKey };
}

/**
 * Builds an explicit operator redrive without changing the original effect
 * identity. Replay authority is supplied by the trusted operator boundary and
 * is never read from the task payload.
 */
export function lifecycleTaskRedrive(
  invocation: LifecycleTaskInvocation,
  replay: LifecycleTaskReplay,
): LifecycleTaskInvocation {
  const requestedBy = replay.requestedBy.trim();
  const reason = replay.reason.trim();
  if (!requestedBy) throw new Error("LIFECYCLE_REDRIVE_ACTOR_REQUIRED");
  if (reason.length < 8) throw new Error("LIFECYCLE_REDRIVE_REASON_REQUIRED");
  const ticketReference = replay.ticketReference?.trim();
  return {
    ...invocation,
    replay: {
      requestedBy,
      reason,
      ...(ticketReference ? { ticketReference } : {}),
    },
  };
}

export async function executeLifecycleTask(
  invocation: LifecycleTaskInvocation,
): Promise<unknown> {
  if (!configuredRuntime)
    throw new Error("LIFECYCLE_TASK_RUNTIME_NOT_CONFIGURED");
  const claim = await configuredRuntime.claim(invocation);
  if (claim.status === "duplicate") return claim.output;
  try {
    const output = await configuredRuntime.execute(invocation);
    await configuredRuntime.complete(invocation, claim.leaseToken, output);
    return output;
  } catch (error) {
    await configuredRuntime.fail(invocation, claim.leaseToken, error);
    throw error;
  }
}

const triggerRetry = {
  maxAttempts: LIFECYCLE_RETRY_POLICY.maxAttempts,
  factor: LIFECYCLE_RETRY_POLICY.factor,
  minTimeoutInMs: LIFECYCLE_RETRY_POLICY.minDelayMs,
  maxTimeoutInMs: LIFECYCLE_RETRY_POLICY.maxDelayMs,
  randomize: false,
} as const;

export function defineLifecycleTask<const TId extends string>(id: TId) {
  return task({
    id,
    retry: triggerRetry,
    run: async (payload: unknown, { ctx }) =>
      executeLifecycleTask(
        taskInvocation({
          taskId: id,
          triggerRunId: ctx.run.id,
          attempt: ctx.attempt.number,
          payload,
        }),
      ),
  });
}

export function defineLifecycleScheduledTask<const TId extends string>(
  id: TId,
  cron: string,
) {
  return schedules.task({
    id,
    cron: { pattern: cron, timezone: "UTC" },
    retry: triggerRetry,
    run: async (payload, { ctx }) =>
      executeLifecycleTask(
        taskInvocation({
          taskId: id,
          triggerRunId: ctx.run.id,
          attempt: ctx.attempt.number,
          payload,
        }),
      ),
  });
}
