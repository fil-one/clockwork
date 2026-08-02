import { idempotencyKeys, tasks } from "@trigger.dev/sdk";

import {
  executeLifecycleTask,
  lifecycleTaskRedrive,
  taskInvocation,
  type LifecycleTaskInvocation,
  type LifecycleTaskReplay,
} from "../onboarding/trigger-runtime";
import {
  lifecycleOutboxTaskMap,
  type LifecycleTaskSubmissionPort,
} from "./lifecycle-task-dispatch";

export type {
  LifecycleTaskInvocation,
  LifecycleTaskReplay,
} from "../onboarding/trigger-runtime";

/**
 * The dispatch that produced a stopped lifecycle task.
 *
 * A workflow run stores a lease envelope rather than its payload, so the outbox
 * message it was delivered from is the only surviving copy of the bytes the
 * task ran on. Rebuilding from that message keeps the payload hash and the
 * `outbox:<id>` invocation key the dispatcher itself uses, so the redrive
 * re-enters the same run instead of opening a second one.
 */
export interface DeadLetterRedriveDispatch {
  outboxMessageId: string;
  topic: string;
  payload: unknown;
}

/**
 * Builds the invocation for work an operator returned to its engine, or null
 * when the topic drives no lifecycle task.
 */
export function deadLetterRedriveInvocation(
  dispatch: DeadLetterRedriveDispatch,
  replay: LifecycleTaskReplay,
): LifecycleTaskInvocation | null {
  const taskId = (
    lifecycleOutboxTaskMap as Readonly<Record<string, string | undefined>>
  )[dispatch.topic];
  if (!taskId) return null;
  return lifecycleTaskRedrive(
    {
      ...taskInvocation({
        taskId,
        triggerRunId: `recovery:${dispatch.outboxMessageId}`,
        attempt: 1,
        payload: dispatch.payload,
      }),
      idempotencyKey: `outbox:${dispatch.outboxMessageId}`,
    },
    replay,
  );
}

export type DeadLetterRedriveResult =
  | { status: "submitted"; invocation: LifecycleTaskInvocation }
  | { status: "unmapped" };

/**
 * Web/API submission boundary, matching the external-gate activation
 * submitter. The durable runtime is activated in the Trigger worker, so a
 * server action reaches a lifecycle task through the queue rather than by
 * executing it in the request process.
 *
 * The worker rebuilds its own invocation from the payload, which is why replay
 * authority does not survive the queue hop. It does not need to: the recovery
 * store has already moved the run out of `failed`, so the claim path that
 * requires a replay marker is not the one this re-entry takes, and the operator
 * and reason are already on the audit decision.
 */
export class TriggerLifecycleRedriveSubmitter implements LifecycleTaskSubmissionPort {
  public async submit(invocation: LifecycleTaskInvocation): Promise<unknown> {
    const idempotencyKey = await idempotencyKeys.create(
      invocation.idempotencyKey,
      { scope: "global" },
    );
    return tasks.trigger(invocation.taskId, invocation.payload, {
      idempotencyKey,
    });
  }
}

/**
 * Re-invokes a provisioning attempt or workflow run after the recovery store
 * has moved it out of its terminal state. The outbox owns its own redelivery
 * and never reaches here.
 *
 * The default submission executes the task in this process, which only works
 * inside the Trigger worker. A caller in the web or API process passes
 * `TriggerLifecycleRedriveSubmitter`.
 */
export async function submitDeadLetterRedrive(
  dispatch: DeadLetterRedriveDispatch,
  replay: LifecycleTaskReplay,
  submission: LifecycleTaskSubmissionPort = { submit: executeLifecycleTask },
): Promise<DeadLetterRedriveResult> {
  const invocation = deadLetterRedriveInvocation(dispatch, replay);
  if (!invocation) return { status: "unmapped" };
  await submission.submit(invocation);
  return { status: "submitted", invocation };
}
