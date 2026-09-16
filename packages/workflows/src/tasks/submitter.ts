import { SQSClient } from "@aws-sdk/client-sqs";

import { SqsTaskSubmitter } from "./sqs-submitter";
import { TriggerTaskSubmitter } from "./trigger-submitter";

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

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`TASK_RUNTIME_INCOMPLETE:${name}`);
  return value;
}

/**
 * Builds the submitter the environment selects. Called at the composition root
 * -- a domain class defaults its port to this and never inspects the
 * environment itself.
 */
export function resolveTaskSubmitter(
  source: NodeJS.ProcessEnv = process.env,
): TaskSubmitter {
  if (configuredTaskRuntime(source) === "trigger")
    return new TriggerTaskSubmitter();
  const region = source.AWS_REGION?.trim();
  return new SqsTaskSubmitter({
    client: new SQSClient(region ? { region } : {}),
    queueUrl: required(source, "WORKFLOWS_QUEUE_ID"),
  });
}

/**
 * Whether the selected runtime can accept a submission at all. The web process
 * offers operator actions that queue work only when it can; an unusable
 * `CLOCKWORK_TASK_RUNTIME` reads as unconfigured here rather than throwing,
 * because this is asked while a module is evaluating.
 */
export function taskSubmitterConfigured(source: NodeJS.ProcessEnv): boolean {
  let runtime: TaskRuntimeKind;
  try {
    runtime = configuredTaskRuntime(source);
  } catch {
    return false;
  }
  if (runtime === "sqs") return Boolean(source.WORKFLOWS_QUEUE_ID?.trim());
  return Boolean(
    source.TRIGGER_SECRET_KEY?.trim() && source.TRIGGER_PROJECT_REF?.trim(),
  );
}
