import { z } from "zod";

import { durableRetryPolicy } from "../policy";
import { registerTask } from "./registry";

/**
 * The vendor-neutral task contract.
 *
 * A task is an id, a payload parser, a retry policy and a run function. Which
 * runtime hosts it (Trigger.dev Cloud or the in-process SQS poller) is decided
 * by `CLOCKWORK_TASK_RUNTIME` at the composition root, never here: a task
 * module sees only this file. Defining a task registers it, matching the
 * import-is-registration semantics the Trigger SDK had, so the runtime
 * adapters discover tasks by importing the same modules.
 */
export interface TaskContext {
  /** The runtime's id for this attempt: a Trigger run id or an SQS message id. */
  readonly runId: string;
  /** 1 for the first attempt. */
  readonly attempt: number;
  /** ISO-8601, present for scheduled tasks. */
  readonly scheduledAt?: string;
}

export interface TaskRetryPolicy {
  readonly maxAttempts: number;
  readonly factor: number;
  readonly minTimeoutInMs: number;
  readonly maxTimeoutInMs: number;
  readonly randomize: boolean;
}

export type TaskStage = "staging" | "production";

export interface TaskDefinition<TPayload = unknown> {
  readonly id: string;
  readonly kind: "on_demand" | "scheduled";
  /** Five-field POSIX cron in UTC; scheduled tasks only. */
  readonly cron?: string;
  /** Stages the schedule runs in; undefined means every stage. */
  readonly stages?: readonly TaskStage[];
  /** A delivery older than this is dropped unrun; for tasks a later tick supersedes. */
  readonly deliveryTtlMs?: number;
  readonly retry: TaskRetryPolicy;
  readonly parse: (raw: unknown) => TPayload;
  readonly run: (payload: TPayload, ctx: TaskContext) => Promise<unknown>;
}

export interface ScheduledPayload {
  readonly scheduledAt: string;
}

export type ScheduledTaskContext = TaskContext & {
  readonly scheduledAt: string;
};

const ScheduledPayloadSchema = z.object({ scheduledAt: z.string().min(1) });

const CRON_FIELDS = 5;

export interface DefineTaskInput<TPayload> {
  readonly id: string;
  readonly retry?: TaskRetryPolicy;
  readonly schema?: { parse(raw: unknown): TPayload };
  readonly run: (payload: TPayload, ctx: TaskContext) => Promise<unknown>;
}

export function defineTask<TPayload = unknown>(
  input: DefineTaskInput<TPayload>,
): TaskDefinition<TPayload> {
  const schema = input.schema;
  const definition: TaskDefinition<TPayload> = {
    id: input.id,
    kind: "on_demand",
    retry: input.retry ?? durableRetryPolicy,
    parse: schema ? (raw) => schema.parse(raw) : (raw) => raw as TPayload,
    run: input.run,
  };
  return registerTask(definition);
}

export interface DefineScheduledTaskInput {
  readonly id: string;
  readonly cron: string;
  readonly stages?: readonly TaskStage[];
  readonly retry?: TaskRetryPolicy;
  readonly deliveryTtlMs?: number;
  readonly run: (
    payload: ScheduledPayload,
    ctx: ScheduledTaskContext,
  ) => Promise<unknown>;
}

export function defineScheduledTask(
  input: DefineScheduledTaskInput,
): TaskDefinition<ScheduledPayload> {
  if (input.cron.trim().split(/\s+/u).length !== CRON_FIELDS)
    throw new Error(`TASK_CRON_INVALID:${input.id}:${input.cron}`);
  const definition: TaskDefinition<ScheduledPayload> = {
    id: input.id,
    kind: "scheduled",
    cron: input.cron,
    ...(input.stages ? { stages: input.stages } : {}),
    ...(input.deliveryTtlMs === undefined
      ? {}
      : { deliveryTtlMs: input.deliveryTtlMs }),
    retry: input.retry ?? durableRetryPolicy,
    parse: (raw) => ScheduledPayloadSchema.parse(raw),
    run: (payload, ctx) =>
      input.run(payload, {
        ...ctx,
        scheduledAt: ctx.scheduledAt ?? payload.scheduledAt,
      }),
  };
  return registerTask(definition);
}
