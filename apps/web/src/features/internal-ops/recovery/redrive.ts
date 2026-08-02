import "server-only";

import {
  loadDeadLetterDispatch,
  type DeadLetterSource,
  type RuntimeDatabase,
} from "@clockwork/db";
import {
  submitDeadLetterRedrive,
  TriggerLifecycleRedriveSubmitter,
  type LifecycleTaskSubmissionPort,
} from "@clockwork/workflows/system";

export type RedriveOutcome =
  | { status: "not_required" }
  | { status: "submitted" }
  | { status: "unmapped" }
  | { status: "unavailable"; code: string };

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z][A-Z0-9_:-]{3,}$/.test(message)
    ? message
    : "LIFECYCLE_REDRIVE_FAILED";
}

/**
 * Re-invokes the task behind a retried record.
 *
 * The outbox owns its own redelivery, so clearing its ceiling is the whole
 * retry and it never reaches here. The other two shapes only leave their
 * terminal state in the recovery store, and the re-invocation is this caller's
 * to supply: the dispatch read recovers the original payload and the workflow
 * seam rebuilds the invocation around it.
 *
 * The decision and its audit row are already committed by the time this runs,
 * so a submission that fails is reported rather than thrown. The operator
 * re-submits the invocation; the decision is not repeated.
 */
export async function redriveRetriedWork(
  database: RuntimeDatabase,
  input: {
    source: DeadLetterSource;
    id: string;
    requestedBy: string;
    reason: string;
    requestId: string;
  },
  submission: LifecycleTaskSubmissionPort = new TriggerLifecycleRedriveSubmitter(),
): Promise<RedriveOutcome> {
  if (input.source === "outbox_message") return { status: "not_required" };
  try {
    const dispatch = await loadDeadLetterDispatch(database, {
      source: input.source,
      id: input.id,
      requestId: input.requestId,
    });
    if (!dispatch) return { status: "unmapped" };
    const result = await submitDeadLetterRedrive(
      dispatch,
      { requestedBy: input.requestedBy, reason: input.reason },
      submission,
    );
    return result.status === "submitted"
      ? { status: "submitted" }
      : { status: "unmapped" };
  } catch (error) {
    return { status: "unavailable", code: failureCode(error) };
  }
}
