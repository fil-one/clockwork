/**
 * How the application hands work to whichever runtime hosts the tasks.
 *
 * The domain ports (gate activation, lifecycle dispatch, core workflow
 * submission, webhook replay) are implemented once over this interface; the
 * Trigger.dev and SQS adapters implement it. `CLOCKWORK_TASK_RUNTIME` selects
 * the adapter and defaults to Trigger so an existing deployment is unchanged.
 */
export interface TaskSubmission {
  readonly taskId: string;
  readonly payload: unknown;
  /** Globally unique per logical invocation; the runtime deduplicates on it. */
  readonly idempotencyKey: string;
  /** Ordering domain for runtimes that order deliveries; defaults to the task id. */
  readonly groupKey?: string;
}

export interface TaskSubmissionReceipt {
  readonly runId: string;
}

export interface TaskSubmitter {
  submit(input: TaskSubmission): Promise<TaskSubmissionReceipt>;
}

export type TaskRuntimeKind = "trigger" | "sqs";

export function configuredTaskRuntime(
  source: NodeJS.ProcessEnv = process.env,
): TaskRuntimeKind {
  const value = source.CLOCKWORK_TASK_RUNTIME?.trim().toLowerCase();
  if (!value || value === "trigger") return "trigger";
  if (value === "sqs") return "sqs";
  throw new Error(`TASK_RUNTIME_INVALID:${value}`);
}
